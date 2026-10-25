// Optional AI write-ups (desktop app only). The renderer prepares the prompt
// and a cropped, highlighted screenshot; the main process holds the API key and
// calls Gemini or Groq.
import { isNumbered, plainText, renderStepCanvas } from './render.js';

const SYSTEM =
  'You are a technical writer who turns recorded screen actions into clear step-by-step software guides. ' +
  'Write plain, friendly, imperative English. Respond with a single JSON object and nothing else.';

const bridge = () => globalThis.flowdocDesktop?.ai;

const quotedValues = (text) => [...String(text || '').matchAll(/["“”]([^"“”]+)["“”]/g)].map((m) => m[1]);

export function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('The AI response was not valid JSON.');
  }
}

// Returns the parsed JSON answer and the model that produced it (the main
// process may fall back to another model when the chosen one is busy).
async function ask(prompt, images = []) {
  const { text, model } = await bridge().complete({ system: SYSTEM, prompt, images, json: true });
  return { data: extractJson(text), model };
}

// The region around the action, with the click highlight drawn in, as a small
// base64 JPEG (≤768 px wide keeps uploads and model latency low).
async function stepImage(step) {
  if (!step.screenshot) return null;
  const full = await renderStepCanvas({ ...step, crop: null }, { crop: false });
  const W = full.width;
  const H = full.height;
  const scale = step.shot?.viewportW ? W / step.shot.viewportW : 1;
  let cx = W / 2;
  let cy = H / 2;
  if (step.click) {
    cx = step.click.x * scale;
    cy = step.click.y * scale;
  } else if (step.target) {
    cx = (step.target.x + step.target.w / 2) * scale;
    cy = (step.target.y + step.target.h / 2) * scale;
  }
  const cw = Math.min(W, 1100 * scale);
  const ch = Math.min(H, 700 * scale);
  const x = Math.max(0, Math.min(W - cw, cx - cw / 2));
  const y = Math.max(0, Math.min(H - ch, cy - ch / 2));
  const outW = Math.min(768, Math.round(cw));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = Math.round((ch * outW) / cw);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, x, y, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.72).split(',')[1];
}

// ---------- writing styles ----------
// crisp:      text only (no screenshots, so it's fastest), one short line per step.
// elaborate:  reads the screenshots; an instruction plus a short, useful note.
// conceptual: first works out what the whole guide achieves, then explains
//             each step in plain, friendly language (and adds sections).
export const STYLES = {
  crisp: {
    label: 'Crisp',
    blurb: 'Short and fast. One line per step, text only (screenshots are not sent).',
    images: false,
    batch: { gemini: 40, groq: 40 },
    rules: [
      '- One sentence per step, at most 18 words, so it never runs past two lines.',
      '- Start with a verb. Put the exact label of the element in **double asterisks**.',
      '- No notes, tips or explanations: "note" must be an empty string.',
    ],
  },
  elaborate: {
    label: 'Elaborate',
    blurb: 'Reads each screenshot. A clear instruction plus a short note with useful detail.',
    images: true,
    batch: { gemini: 5, groq: 3 },
    rules: [
      '- "text": a clear instruction of one or two sentences. Start with a verb, put the exact on-screen label in **double asterisks**, and say where the element is if that helps.',
      '- "note": one to three short sentences of genuinely useful detail: what the action does, what appears next, or which option to pick. Only what the screenshot shows or clearly implies.',
      '- No filler, no repeating the instruction, no generic advice. Use an empty note when there is nothing useful to add.',
    ],
  },
  conceptual: {
    label: 'Conceptual',
    blurb: 'Understands the whole workflow first, then explains each step in plain, friendly language.',
    images: true,
    batch: { gemini: 5, groq: 3 },
    rules: [
      '- "text": a friendly instruction that connects the action to its purpose, e.g. "To keep a copy of your key, click **Copy key**". One or two sentences, exact on-screen labels in **double asterisks**.',
      '- "note": in plain, beginner-friendly language, why this step matters or what is happening behind it (one to three sentences). Explain any jargon you use.',
      '- Stay accurate to the screenshots and the overall goal. Do not add steps, warnings or background the reader does not need.',
    ],
  },
};

function batchPrompt(batch, prev, style, context) {
  const cfg = STYLES[style];
  let img = 0;
  const lines = [
    `Rewrite these ${batch.length} recorded steps of a how-to guide.`,
    context?.goal ? `The guide's overall goal: ${context.goal}` : '',
    context?.audience ? `Written for: ${context.audience}` : '',
    cfg.images ? 'Each attached screenshot shows the area around one action; a red outline marks the element that was clicked or typed into, and a red ring marks the exact click point.' : '',
    prev ? `The step before these was: ${plainText(prev.text)}` : '',
    '',
    'Steps:',
    ...batch.map(({ step, n }, i) => {
      const ctx = [step.app && `app: ${step.app}`, step.window && `window: ${step.window}`, step.url && `page: ${step.url}`, step.action && `action: ${step.action}`]
        .filter(Boolean)
        .join('; ');
      const image = cfg.images ? (step.image ? `screenshot #${++img}; ` : 'no screenshot; ') : '';
      return `[${i + 1}] (step ${n}; ${image}${ctx}) Draft: ${step.text}`;
    }),
    '',
    'Rules:',
    ...cfg.rules,
    '- Keep any typed value exactly as written in the draft, in double quotes. Never reveal or invent passwords or values.',
    '- Do not number the steps.',
    `Return {"steps": [{"i": 1, "text": "...", "note": "..."}, ...]} with exactly ${batch.length} entries, in order.`,
  ];
  return lines.filter((l) => l !== '').join('\n');
}

// The model may rephrase, but never invent typed values: a quoted value that
// wasn't in the recorded step (e.g. a made-up password) means the rewrite is
// rejected and the recorded text is kept.
function guard(step, text) {
  const allowed = new Set(quotedValues(step.text));
  if (quotedValues(text).some((v) => !allowed.has(v)) || (step.secret && /"[^"]+"/.test(text))) return step.text;
  return text;
}

const PARALLEL = { gemini: 3, groq: 2 };
const numberedSteps = (guide) => guide.steps.filter((s) => isNumbered(s) && s.text).map((step, i) => ({ step, n: i + 1 }));

/**
 * Conceptual mode, phase 1: read every step (text only) and work out what the
 * guide is for, who it suits and where its natural sections begin.
 */
export async function understandGuide(guide) {
  const steps = numberedSteps(guide);
  const apps = [...new Set(guide.steps.map((s) => s.app).filter(Boolean))];
  const prompt = [
    apps.length ? `Apps used: ${apps.join(', ')}` : '',
    guide.title ? `Current title: ${guide.title}` : '',
    'These are the recorded steps of a how-to guide:',
    ...steps.map(({ step, n }) => `${n}. ${plainText(step.text)}${step.window ? ` (in ${step.window})` : ''}`),
    '',
    'Work out what the person was trying to accomplish.',
    '- goal: one sentence describing the task and its outcome.',
    '- audience: who this guide suits, in a few words.',
    steps.length >= 6
      ? '- sections: 2 to 5 logical phases of the workflow, each with a short heading (max 6 words) and the step number where it starts. The first section starts at step 1.'
      : '- sections: an empty list.',
    'Return {"goal": "...", "audience": "...", "sections": [{"title": "...", "startStep": 1}]}',
  ]
    .filter(Boolean)
    .join('\n');
  const { data, model } = await ask(prompt);
  const sections = (Array.isArray(data.sections) ? data.sections : [])
    .map((x) => ({ title: String(x?.title || '').trim().slice(0, 80), startStep: Math.round(Number(x?.startStep)) }))
    .filter((x) => x.title && x.startStep >= 1 && x.startStep <= steps.length)
    .sort((a, b) => a.startStep - b.startStep)
    .filter((x, i, arr) => i === 0 || x.startStep !== arr[i - 1].startStep);
  return { goal: String(data.goal || '').trim(), audience: String(data.audience || '').trim(), sections, model };
}

/**
 * Rewrites step instructions in the chosen style. Steps are sent in batches,
 * several at a time; onProgress(done, total) fires after each batch.
 * @returns {Promise<{results: Map<string, {text:string, note:string}>, errors: string[], models: Set<string>}>}
 */
export async function improveSteps(guide, { provider = 'gemini', style = 'elaborate', context, onProgress = () => {}, signal } = {}) {
  const cfg = STYLES[style] || STYLES.elaborate;
  const steps = numberedSteps(guide);
  const size = cfg.batch[provider] || 3;
  const batches = [];
  for (let i = 0; i < steps.length; i += size) batches.push(steps.slice(i, i + size));
  const results = new Map();
  const errors = [];
  const models = new Set();
  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < batches.length && !signal?.aborted) {
      const batch = batches[cursor++].map((x) => ({ ...x }));
      try {
        const images = [];
        if (cfg.images) {
          for (const item of batch) {
            item.step = { ...item.step, image: await stepImage(item.step) };
            if (item.step.image) images.push(item.step.image);
          }
        }
        const prev = steps[batch[0].n - 2]?.step;
        const { data: out, model } = await ask(batchPrompt(batch, prev, style, context), images);
        models.add(model);
        if (signal?.aborted) return;
        const list = Array.isArray(out.steps) ? out.steps : [];
        batch.forEach(({ step, n }, i) => {
          const entry = list.find((e) => Number(e?.i) === i + 1) || list[i];
          const text = String(entry?.text || '').trim();
          if (!text || text.length > 400) {
            errors.push(`Step ${n}: no usable answer`);
            return;
          }
          const note = style === 'crisp' ? '' : guard(step, String(entry.note || '').trim()).slice(0, 600);
          results.set(step.id, { text: guard(step, text), note });
        });
      } catch (err) {
        errors.push(`Steps ${batch[0].n}–${batch.at(-1).n}: ${err.message}`);
      }
      done += batch.length;
      onProgress(done, steps.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL[provider] || 2, batches.length) }, worker));
  return { results, errors, models };
}

export async function writeSummary(guide, { style = 'elaborate', context, improved = new Map() } = {}) {
  const steps = guide.steps.filter(isNumbered);
  const apps = [...new Set(guide.steps.map((s) => s.app).filter(Boolean))];
  const descRule = {
    crisp: '- description: one short sentence saying what the reader will accomplish.',
    elaborate: '- description: two or three sentences: what the reader will accomplish and anything they need before starting.',
    conceptual: '- description: two or three friendly sentences explaining what this workflow is for and why someone would do it.',
  }[style] || '- description: one or two sentences saying what the reader will accomplish.';
  const prompt = [
    apps.length ? `Apps used: ${apps.join(', ')}` : '',
    context?.goal ? `Goal of the guide: ${context.goal}` : '',
    'Steps of a recorded how-to guide:',
    ...steps.map((s, i) => `${i + 1}. ${plainText(improved.get(s.id)?.text || s.text)}`),
    '',
    'Write a title and a description for this guide.',
    '- title: starts with "How to", at most 70 characters, names the task and the app.',
    descRule,
    'Return {"title": "...", "description": "..."}',
  ]
    .filter(Boolean)
    .join('\n');
  const { data: out, model } = await ask(prompt);
  return {
    title: String(out.title || '').trim().slice(0, 120),
    description: String(out.description || '').trim().slice(0, 800),
    model,
  };
}

// Returns { ok, model, ms } so Settings can show which model answered and how fast.
export async function testConnection(provider) {
  const t0 = Date.now();
  const { text, model } = await bridge().complete({ provider, system: 'Reply with JSON.', prompt: 'Return {"ok": true}', json: true });
  return { ok: extractJson(text).ok === true, model, ms: Date.now() - t0 };
}
