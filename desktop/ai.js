// Thin clients for the optional AI providers. Requests are made from the main
// process so API keys never reach the renderer. Base URLs can be overridden
// (FLOWDOC_GEMINI_URL / FLOWDOC_GROQ_URL) for testing against a mock.

const BASE = {
  gemini: () => process.env.FLOWDOC_GEMINI_URL || 'https://generativelanguage.googleapis.com',
  groq: () => process.env.FLOWDOC_GROQ_URL || 'https://api.groq.com',
};

// Groq vision models accept a limited number of images per request.
export const MAX_IMAGES = { gemini: 16, groq: 3 };

// Tried in order when the chosen model is overloaded or rate-limited.
// gemini-3.6-flash answered four screenshots in ~4 s on 2026-10-24 while the
// newer gemini-3.8-flash took 90-150 s or returned 503 "high demand".
export const FALLBACK_MODELS = { gemini: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'], groq: [] };

// Safety net per attempt only. AI work runs as a background job with live
// progress, so a slow model is allowed to finish; this just stops a request
// that hangs forever. Overridable for tests.
const timeoutMs = () => Number(process.env.FLOWDOC_AI_TIMEOUT_MS) || 10 * 60_000;

async function request(url, { headers = {}, body, method = body ? 'POST' : 'GET' } = {}) {
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs()),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        const e = new Error(`no answer within ${Math.round(timeoutMs() / 60000)} minutes`);
        e.busy = true;
        throw e;
      }
      throw new Error(`Couldn't reach the AI provider (${err?.cause?.code || err.message}). Check your internet connection.`);
    }
    // One short wait for a per-minute rate limit; anything longer is better
    // spent on a fallback model.
    if (res.status !== 429 || attempt > 0) break;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 3000;
    if (wait > 6000) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.raw || res.statusText;
    const err = new Error(`${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    err.busy = [429, 500, 502, 503, 504].includes(res.status);
    throw err;
  }
  return data;
}

// Models sometimes wrap JSON in prose, code fences or <think> blocks.
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

// Writing a one-line instruction needs no deep reasoning, and default
// "thinking" makes current models many times slower. These settings turn it
// down; models that reject them are retried with the provider's defaults.
function geminiSpeed(model) {
  if (/^gemini-2\.5-(flash|flash-lite)/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-2\.5-pro/.test(model)) return { thinkingConfig: { thinkingBudget: 128 } };
  // 3.6 Flash and the Flash-Lite models accept MINIMAL; newer Flash models start at LOW.
  if (/^gemini-3\.[1-6]-flash/.test(model)) return { thinkingConfig: { thinkingLevel: 'MINIMAL' } };
  if (/^gemini-[3-9]/.test(model)) return { thinkingConfig: { thinkingLevel: 'LOW' } };
  return {};
}

function groqSpeed(model, json) {
  if (/qwen/i.test(model)) return { reasoning_effort: 'none', ...(json ? { reasoning_format: 'hidden' } : {}) };
  if (/gpt-oss/i.test(model)) return { reasoning_effort: 'low', ...(json ? { reasoning_format: 'hidden' } : {}) };
  if (/deepseek|muse|r1/i.test(model)) return json ? { reasoning_format: 'hidden' } : {};
  return {};
}

const rejectedSpeedParams = (err) => err.status === 400 && /think|reason/i.test(err.message);

/**
 * Sends one prompt, falling back to other models when the chosen one is busy.
 * @param {{provider:'gemini'|'groq', apiKey:string, model:string, system?:string,
 *          prompt:string, images?:string[] (base64 JPEG), json?:boolean}} req
 * @returns {Promise<{text: string, model: string}>} output and the model that produced it
 */
export async function complete(req) {
  const chain = [req.model, ...(FALLBACK_MODELS[req.provider] || []).filter((m) => m !== req.model)];
  const failures = [];
  for (const model of chain) {
    try {
      return { text: await completeOnce({ ...req, model }), model };
    } catch (err) {
      if (!err.busy) throw err;
      failures.push(`${model}: ${err.message.replace(/^\d+: /, '').slice(0, 90)}`);
    }
  }
  throw new Error(`The AI provider is overloaded right now (${failures.join('; ')}). Try again in a minute.`);
}

async function completeOnce({ provider, apiKey, model, system = '', prompt, images = [], json = true }) {
  if (!apiKey) throw new Error('No API key saved for this provider.');
  images = images.slice(0, MAX_IMAGES[provider] || 1);

  if (provider === 'gemini') {
    const send = (speed) =>
      request(`${BASE.gemini()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        headers: { 'x-goog-api-key': apiKey },
        body: {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, ...images.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } }))],
            },
          ],
          generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}), ...speed },
        },
      });
    let data;
    try {
      data = await send(geminiSpeed(model));
    } catch (err) {
      if (!rejectedSpeedParams(err)) throw err;
      data = await send({});
    }
    const cand = data.candidates?.[0];
    if (!cand) throw new Error(data.promptFeedback?.blockReason ? `Blocked: ${data.promptFeedback.blockReason}` : 'Empty response from Gemini.');
    // Skip any thought summaries; keep the answer parts.
    return (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  }

  if (provider === 'groq') {
    const content = images.length
      ? [{ type: 'text', text: prompt }, ...images.map((d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } }))]
      : prompt;
    const send = (speed) =>
      request(`${BASE.groq()}/openai/v1/chat/completions`, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model,
          messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }],
          temperature: 0.3,
          max_completion_tokens: 2048,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          ...speed,
        },
      });
    let data;
    try {
      data = await send(groqSpeed(model, json));
    } catch (err) {
      if (!rejectedSpeedParams(err)) throw err;
      data = await send({});
    }
    return data.choices?.[0]?.message?.content || '';
  }
  throw new Error(`Unknown AI provider: ${provider}`);
}

// Models that can't write guide text (speech, image/video/music generation,
// embeddings, transcription, live audio, agents) are left out of the picker.
const NOT_FOR_TEXT = /tts|image|audio|live|embedding|transcribe|robotics|lyria|veo|imagen|omni|aqa|deep-research|antigravity|computer-use|whisper|guard|playai|orpheus|safeguard/i;

export async function listModels(provider, apiKey) {
  if (!apiKey) throw new Error('Save an API key first.');
  if (provider === 'gemini') {
    const data = await request(`${BASE.gemini()}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => !NOT_FOR_TEXT.test(id))
      .sort();
  }
  if (provider === 'groq') {
    const data = await request(`${BASE.groq()}/openai/v1/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    return (data.data || [])
      .filter((m) => m.active !== false && !NOT_FOR_TEXT.test(m.id))
      .map((m) => m.id)
      .sort();
  }
  return [];
}
