// Runs the desktop app's self-test against mock Gemini, Groq and Notion
// servers and checks the results.   node scripts/desktop-test.mjs [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'test-output', 'desktop');
const electron = createRequire(import.meta.url)('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- mock AI providers ----------
const calls = [];
const styleOf = (prompt) =>
  /one short sentence saying/.test(prompt) ? 'crisp' : /friendly sentences/.test(prompt) ? 'conceptual' : 'elaborate';
function answer(prompt) {
  if (prompt.includes('Work out what the person was trying to accomplish')) {
    return {
      goal: 'Sign in to Northwind Support and open a support ticket.',
      audience: 'Northwind customers',
      sections: [
        { title: 'Sign in', startStep: 1 },
        { title: 'Open the ticket', startStep: 7 },
      ],
    };
  }
  if (prompt.includes('Draft: ')) {
    // Batched step rewrite: one entry per "[i] (...) Draft: ..." line.
    const steps = [...prompt.matchAll(/^\[(\d+)\] \(.*?\) Draft: (.*)$/gm)].map(([, i, draft]) => {
      // A misbehaving model that leaks a value into a password step.
      if (/password/i.test(draft)) return { i: Number(i), text: 'Type "leaked-secret" in the **Password** field', note: '' };
      return { i: Number(i), text: `${draft} ✓`, note: draft.startsWith('Click') ? 'It is in the main form.' : '' };
    });
    return { steps };
  }
  if (prompt.includes('Write a title')) return { title: 'How to sign in and open a support ticket', description: 'Sign in to Northwind Support and file a ticket.', style: styleOf(prompt) };
  if (prompt.includes('Return {"ok": true}')) return { ok: true };
  return {};
}

// ---------- mock Notion ----------
const notion = { calls: [], uploads: 0, sent: [], pages: [], appends: [], trashed: [] };
// Team wiki › How-tos › AWS Trial › (toggle) › some_topic › some_topic_2, and
// Team wiki › (columns) › Archive. Search only returns the top page, like real
// Notion often does, so the picker has to browse each page's children.
const NPAGES = {
  'p-wiki': { title: 'Team wiki', parent: { type: 'workspace', workspace: true }, icon: '📚' },
  'p-howtos': { title: 'How-tos', parent: { type: 'page_id', page_id: 'p-wiki' } },
  'p-archive': { title: 'Archive', parent: { type: 'block_id', block_id: 'b-col1' } },
  'p-aws': { title: 'AWS Trial', parent: { type: 'page_id', page_id: 'p-howtos' } },
  'p-topic': { title: 'some_topic', parent: { type: 'block_id', block_id: 'b-toggle' } },
  'p-topic2': { title: 'some_topic_2', parent: { type: 'page_id', page_id: 'p-topic' } },
};
const NBLOCKS = {
  'b-cols': { type: 'column_list', parent: { type: 'page_id', page_id: 'p-wiki' } },
  'b-col1': { type: 'column', parent: { type: 'block_id', block_id: 'b-cols' } },
  'b-toggle': { type: 'toggle', parent: { type: 'page_id', page_id: 'p-aws' } },
};
const childPage = (id) => ({ object: 'block', id, type: 'child_page', has_children: false, child_page: { title: NPAGES[id].title } });
const container = (id) => ({ object: 'block', id, type: NBLOCKS[id].type, has_children: true, [NBLOCKS[id].type]: {} });
const NCHILDREN = {
  'p-wiki': [childPage('p-howtos'), container('b-cols')],
  'b-cols': [container('b-col1')],
  'b-col1': [childPage('p-archive')],
  'p-howtos': [childPage('p-aws'), { object: 'block', id: 'b-para', type: 'paragraph', has_children: false, paragraph: {} }],
  'p-aws': [container('b-toggle')],
  'b-toggle': [childPage('p-topic')],
  'p-topic': [childPage('p-topic2')],
};
const pageObject = (id) => ({ object: 'page', id, url: `https://www.notion.so/${id}`, parent: NPAGES[id].parent, properties: { title: { type: 'title', title: [{ plain_text: NPAGES[id].title }] } }, ...(NPAGES[id].icon ? { icon: { type: 'emoji', emoji: NPAGES[id].icon } } : {}) });
function notionRoute(req, res, body) {
  const json = body && !req.headers['content-type']?.startsWith('multipart') ? JSON.parse(body) : {};
  notion.calls.push({ method: req.method, url: req.url, version: req.headers['notion-version'], auth: req.headers.authorization });
  const send = (data, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (req.url === '/v1/users/me') return send({ object: 'user', name: 'FlowDoc', bot: { workspace_name: 'Avinash Workspace' } });
  if (req.url === '/v1/search') {
    const q = (json.query || '').toLowerCase();
    const ids = q ? Object.keys(NPAGES).filter((id) => NPAGES[id].title.toLowerCase().includes(q)) : ['p-wiki'];
    const results = ids.map(pageObject);
    if (!q) results.push({ object: 'page', id: 'p-row', url: 'https://www.notion.so/p-row', parent: { type: 'data_source_id', data_source_id: 'ds1' }, properties: { Name: { type: 'title', title: [{ plain_text: 'A database row' }] } } });
    return send({ object: 'list', has_more: false, next_cursor: null, results });
  }
  const childrenMatch = req.url.match(/^\/v1\/blocks\/([\w-]+)\/children(\?.*)?$/);
  if (childrenMatch && req.method === 'GET') return send({ object: 'list', has_more: false, next_cursor: null, results: NCHILDREN[childrenMatch[1]] || [] });
  const getPage = req.url.match(/^\/v1\/pages\/([\w-]+)$/);
  if (getPage && req.method === 'GET' && NPAGES[getPage[1]]) return send(pageObject(getPage[1]));
  const getBlock = req.url.match(/^\/v1\/blocks\/([\w-]+)$/);
  if (getBlock && req.method === 'GET' && NBLOCKS[getBlock[1]]) return send({ object: 'block', id: getBlock[1], type: NBLOCKS[getBlock[1]].type, parent: NBLOCKS[getBlock[1]].parent });
  if (req.url === '/v1/file_uploads' && req.method === 'POST') {
    notion.uploads++;
    return send({ object: 'file_upload', id: `fu-${notion.uploads}`, status: 'pending', filename: json.filename, content_type: json.content_type });
  }
  const sendMatch = req.url.match(/^\/v1\/file_uploads\/(fu-\d+)\/send$/);
  if (sendMatch) {
    notion.sent.push({ id: sendMatch[1], multipart: (req.headers['content-type'] || '').startsWith('multipart/form-data'), bytes: body.length });
    return send({ object: 'file_upload', id: sendMatch[1], status: 'uploaded' });
  }
  if (req.url === '/v1/pages' && req.method === 'POST') {
    notion.pages.push(json);
    return send({ object: 'page', id: 'page-new', url: 'https://www.notion.so/page-new' });
  }
  const appendMatch = req.url.match(/^\/v1\/blocks\/([\w-]+)\/children$/);
  if (appendMatch && req.method === 'PATCH') {
    notion.appends.push(json.children.length);
    return send({ object: 'list', results: [] });
  }
  const pageMatch = req.url.match(/^\/v1\/pages\/([\w-]+)$/);
  if (pageMatch && req.method === 'PATCH') {
    notion.trashed.push(pageMatch[1]);
    return send({ object: 'page', id: pageMatch[1], in_trash: true });
  }
  return send({ object: 'error', status: 404, code: 'object_not_found', message: 'Not found' }, 404);
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const buf = Buffer.concat(chunks);
    const body = buf.toString('latin1');
    const url = req.url;
    if (url.startsWith('/v1/')) return notionRoute(req, res, req.headers['content-type']?.startsWith('multipart') ? buf : body);
    if (url.startsWith('/v1beta/models?')) {
      // "Load models": includes models that can't write text, which must be filtered out.
      const ids = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-image', 'gemini-embedding-001', 'gemini-3.1-pro-preview'];
      return res.end(JSON.stringify({ models: ids.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) }));
    }
    const json = body ? JSON.parse(buf.toString('utf8')) : {};
    if (url.includes(':generateContent')) {
      const parts = json.contents[0].parts;
      const prompt = parts.find((p) => p.text).text;
      const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]);
      const thinking = json.generationConfig?.thinkingConfig;
      calls.push({ provider: 'gemini', key: req.headers['x-goog-api-key'], model, images: parts.filter((p) => p.inline_data).length, json: json.generationConfig?.responseMimeType, thinking, batch: (prompt.match(/^\[\d+\] /gm) || []).length, understand: prompt.includes('Work out what the person') });
      // An older model that rejects thinking settings, to exercise the fallback.
      if (model === 'gemini-legacy' && thinking) {
        res.writeHead(400).end(JSON.stringify({ error: { message: 'Thinking level is not supported for this model.' } }));
        return;
      }
      // An overloaded model (like gemini-3.8-flash on 2026-10-24) and one that
      // never answers: both must hand over to the fallback model.
      if (model === 'gemini-busy') {
        res.writeHead(503).end(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }));
        return;
      }
      if (model === 'gemini-slow') return; // leave the request hanging
      const a = answer(prompt);
      if (a.title) a.title += ` (gemini, ${a.style})`;
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(a) }] } }] }));
    } else if (url.endsWith('/chat/completions')) {
      const user = json.messages.find((m) => m.role === 'user').content;
      const prompt = typeof user === 'string' ? user : user.find((p) => p.type === 'text').text;
      calls.push({ provider: 'groq', key: req.headers.authorization, model: json.model, images: typeof user === 'string' ? 0 : user.filter((p) => p.type === 'image_url').length, json: json.response_format?.type, effort: json.reasoning_effort, format: json.reasoning_format, batch: (prompt.match(/^\[\d+\] /gm) || []).length });
      await sleep(1500); // slow on purpose, so the background run can be watched
      const a = answer(prompt);
      if (a.title) a.title += ` (groq, ${a.style})`;
      // Reasoning models may wrap output in <think> blocks; the client must cope.
      res.end(JSON.stringify({ choices: [{ message: { content: `<think>planning</think>${JSON.stringify(a)}` } }] }));
    } else {
      res.writeHead(404).end('{}');
    }
  });
});
await new Promise((r) => server.listen(5310, r));

// The AI client on its own: a model that rejects the speed settings must
// still work by retrying with the provider defaults.
process.env.FLOWDOC_GEMINI_URL = 'http://localhost:5310';
process.env.FLOWDOC_AI_TIMEOUT_MS = '1500'; // keep the hanging-model case short
const { complete } = await import('../desktop/ai.js');
const direct = {};
for (const [name, model] of [['thinkingRejected', 'gemini-legacy'], ['busy', 'gemini-busy'], ['slow', 'gemini-slow']]) {
  const t0 = Date.now();
  try {
    const r = await complete({ provider: 'gemini', apiKey: 'k', model, prompt: 'Return {"ok": true}' });
    direct[name] = { ok: JSON.parse(r.text).ok === true, model: r.model, ms: Date.now() - t0 };
  } catch (err) {
    direct[name] = { ok: false, error: err.message, ms: Date.now() - t0 };
  }
}
delete process.env.FLOWDOC_AI_TIMEOUT_MS;

// ---------- an old StepCraft data folder to carry over ----------
const legacy = mkdtempSync(join(tmpdir(), 'stepcraft-legacy-'));
mkdirSync(join(legacy, 'library'));
const legacyGuide = { id: 'glegacy01', title: 'A guide made in StepCraft', description: '', createdAt: 1, updatedAt: 1, steps: [] };
writeFileSync(join(legacy, 'library', 'guide_glegacy01.json'), JSON.stringify(legacyGuide));
writeFileSync(join(legacy, 'library', 'guides_index.json'), JSON.stringify([{ id: 'glegacy01', title: legacyGuide.title, createdAt: 1, updatedAt: 1, stepCount: 0 }]));

// ---------- run the app ----------
const userData = mkdtempSync(join(tmpdir(), 'flowdoc-desktop-'));
const env = {
  ...process.env,
  FLOWDOC_SELFTEST: '1',
  FLOWDOC_NO_HOOK: '1',
  FLOWDOC_USER_DATA: userData,
  FLOWDOC_LEGACY_DIR: legacy,
  FLOWDOC_TEST_OUT: out,
  FLOWDOC_GEMINI_URL: 'http://localhost:5310',
  FLOWDOC_GROQ_URL: 'http://localhost:5310',
  FLOWDOC_NOTION_URL: 'http://localhost:5310',
};
delete env.ELECTRON_RUN_AS_NODE;
const code = await new Promise((resolve) => {
  // FLOWDOC_APP_EXE runs the test against a packaged build instead of the sources.
  const exe = process.env.FLOWDOC_APP_EXE;
  const child = spawn(exe || electron, exe ? [] : [root], { env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill(), 300_000);
  child.on('exit', (c) => {
    clearTimeout(timer);
    resolve(c);
  });
});
server.close();

// ---------- checks ----------
let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
if (code !== 0 || !existsSync(join(out, 'results.json'))) {
  console.error(`Electron exited with ${code} and no results`);
  process.exit(1);
}
const r = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
console.log('\nCaptured steps:');
r.guide.steps.forEach((s, i) => console.log(`   ${i + 1}. [${s.action}] ${s.text}   (${s.app || '?'} · ${s.window || '?'})`));
const texts = r.guide.steps.map((s) => s.text);

console.log('\nRecording');
check(r.checks.hookLoads, 'global input hook (uiohook) starts and stops');
check(r.widget.grip === 'drag' && r.widget.buttons.every((v) => v === 'no-drag'), 'recorder bar buttons are outside the drag region', `grip=${r.widget.grip} buttons=${r.widget.buttons.join(',')}`);
check(r.widget.fits, 'recorder bar fits its window');
check(r.widget.pausedAfterClick && r.widget.resumedAfterClick, 'Pause and Resume buttons drive the recorder');
check(r.widget.doneStopped, 'Done button stops the capture');
check(r.guide.steps.length >= 9, 'steps captured', `${r.guide.steps.length}`);
check(r.guide.steps.every((s) => s.hasShot), 'every step has a screenshot');
check(r.guide.steps.some((s) => s.target), 'element rectangles from the accessibility inspector');
check(texts.some((t) => /Email/.test(t) && t.startsWith('Click')), 'click on Email field named via accessibility', texts[0]);
const focusNote = r.checks.demoFocused ? '' : 'another window kept keyboard focus during the test; leave the PC idle while it runs';
check(texts.some((t) => t === 'Type "alex@northwind.example" in the **Email** field'), 'typed text captured with field label', focusNote);
check(texts.some((t) => t === 'Type your password in the **Password** field'), 'password masked', focusNote);
check(!r.rawContainsPassword, 'password never stored');
check(texts.some((t) => /Remember me/.test(t)), 'checkbox click captured');
check(texts.some((t) => /Sign in/.test(t)), 'button click captured');
check(texts.some((t) => t.startsWith('Double-click')), 'double-click merged into one step');
check(texts.some((t) => t.startsWith('Right-click')), 'right-click captured');
check(texts.some((t) => t === 'Press **Enter**'), 'Enter key captured');
check(texts.some((t) => t === 'Press **Ctrl+S**'), 'keyboard shortcut captured');
check(r.guide.steps.some((s) => s.app), 'app name recorded', r.guide.steps.find((s) => s.app)?.app);
check(/Workflow in/.test(r.guide.title), 'default title from apps', r.guide.title);
const ac = r.afterCapture || {};
check(ac.guideOpen && !ac.aiDialog && !ac.aiBanner, 'a finished capture opens the guide without starting AI', JSON.stringify(ac));
check(ac.autoSettingKept === false, 'the old "improve automatically" setting is ignored and dropped');

console.log('\nAI client');
check(direct.thinkingRejected.ok && direct.thinkingRejected.model === 'gemini-legacy', 'models that reject thinking settings are retried with defaults');
check(direct.busy.ok && direct.busy.model === 'gemini-3.6-flash', 'an overloaded model (503) hands over to gemini-3.6-flash', `${direct.busy.model || direct.busy.error} in ${direct.busy.ms} ms`);
check(direct.slow.ok && direct.slow.model === 'gemini-3.6-flash', 'a request that never answers is abandoned at the safety limit', `${direct.slow.model || direct.slow.error} in ${direct.slow.ms} ms`);
check(r.migration?.model === 'gemini-3.6-flash' && r.migration?.keptChoice === 'gemini-3.8-flash', 'old default gemini-3.8-flash migrates once, later choices are kept', JSON.stringify(r.migration));

console.log('\nWriting styles');
const gem = calls.filter((c) => c.provider === 'gemini' && c.key !== 'k'); // 'k' = direct client checks above
const groq = calls.filter((c) => c.provider === 'groq');
const stepCalls = gem.filter((c) => c.batch);
const crispCalls = stepCalls.filter((c) => c.images === 0);
const imageCalls = stepCalls.filter((c) => c.images > 0);
check(gem.length > 0 && gem.every((c) => c.key === 'test-gemini-key' && c.model === 'gemini-3.6-flash'), 'Gemini requests use saved key and model', `${gem.length} calls`);
check(gem.every((c) => c.json === 'application/json' && c.thinking?.thinkingLevel === 'MINIMAL'), 'Gemini requests use JSON mode and minimal thinking');
check(crispCalls.length === 1 && crispCalls[0].batch === r.guide.steps.length, 'Crisp sends text only, all steps in one request', `${crispCalls.map((c) => `${c.batch} steps/0 images`).join(', ')}`);
check(imageCalls.length >= 4 && imageCalls.every((c) => c.batch <= 5 && c.images >= 1), 'Elaborate and Conceptual send screenshots, 5 steps per request', `${imageCalls.length} requests`);
check(gem.filter((c) => c.understand).length === 1 && gem.find((c) => c.understand).images === 0, 'Conceptual first reads the whole guide (text only)');
check(r.ai.gemini.title === 'How to sign in and open a support ticket (gemini, elaborate)' && r.ai.gemini.notes >= 3, 'Elaborate: title applied and useful notes added', `${r.ai.gemini.notes} notes`);
check(r.ai.gemini.steps.filter((t) => t.endsWith('✓')).length >= 8, 'step rewrites applied');
check(r.ai.crisp.title.endsWith('(gemini, crisp)') && r.ai.crisp.notes === 0, 'Crisp: notes from the earlier AI run removed', `${r.ai.crisp.notes} notes left`);
check(r.ai.conceptual.title.endsWith('(gemini, conceptual)') && r.ai.conceptual.headings.join('|') === 'Sign in|Open the ticket' && r.ai.conceptual.notes >= 3, 'Conceptual: section headings and explanations added', r.ai.conceptual.headings.join(', '));
check(r.ai.gemini.steps.includes('Type your password in the **Password** field'), 'AI cannot inject a value into a password step');
check(![...r.ai.gemini.steps, ...r.ai.crisp.steps, ...r.ai.conceptual.steps, ...r.ai.groq.steps].some((t) => t.includes('leaked-secret')), 'AI cannot invent typed values in any style');

console.log('\nBackground jobs');
check(r.background.dialogProgress && /of \d+ steps/.test(r.background.status), 'dialog shows step-by-step progress', r.background.status);
check(r.background.banner, 'editor shows a live progress banner');
check(r.background.sidebarMark, 'sidebar marks the guide while AI works');
check(r.background.appliedWhileAway && r.ai.groq.title.endsWith('(groq, elaborate)'), 'result applied after closing the dialog and leaving the guide');
check(groq.length > 0 && groq.every((c) => c.key === 'Bearer test-groq-key' && c.model === 'qwen/qwen3.8-27b'), 'Groq requests use saved key and model', `${groq.length} calls`);
check(groq.some((c) => c.images >= 2) && groq.every((c) => c.json === 'json_object' && c.images <= 3), 'Groq receives batched screenshots (max 3) in JSON mode');
check(groq.every((c) => c.effort === 'none' && c.format === 'hidden'), 'Groq requests disable reasoning and hide it (speed + JSON mode)');

console.log('\nSettings');
const models = r.models || [];
check(models.includes('gemini-3.7-flash') && models.includes('gemini-3.1-pro-preview'), 'Load models fills the dropdown with every text model', `${models.length} options`);
check(!models.some((m) => /tts|image|embedding/.test(m)), 'speech, image and embedding models are filtered out');
check(r.theme.dark.html === 'dark' && r.theme.dark.native === 'dark' && r.theme.dark.saved === 'dark', 'Dark theme applies to the page and native window', JSON.stringify(r.theme.dark));
check(r.theme.light.html === 'light' && r.theme.light.native === 'light', 'Light theme applies to the page and native window');
check(r.theme.system.native === 'system', 'System theme follows the OS');

console.log('\nNotion');
const n = r.notion;
const FULL = 'Team wiki / How-tos / AWS Trial / some_topic / some_topic_2';
check(JSON.stringify(n.roots) === JSON.stringify(['Team wiki']), 'top level lists the shared pages (database rows skipped)', JSON.stringify(n.roots));
check(JSON.stringify(n.level1) === JSON.stringify(['How-tos', 'Archive']), 'opening a page lists its subpages, including ones inside columns', JSON.stringify(n.level1));
check(JSON.stringify(n.level2) === JSON.stringify(['AWS Trial']), 'subpages of subpages are reachable');
check(n.path === FULL, 'drilling 5 levels deep sets the destination path', n.path);
check(n.crumbs?.[0] === 'Avinash Workspace' && n.crumbs.at(-1) === 'some_topic_2' && n.crumbs.length === 6, 'path bar shows every level', (n.crumbs || []).join(' › '));
check((n.chips || []).includes('★ AWS LEARNING'), 'location saved with a custom name', JSON.stringify(n.chips));
check(n.done, 'save finishes with an Open in Notion button');
check(n.reopenPath === FULL && (n.recents || [])[0]?.includes('some_topic_2'), 'reopening starts at the last destination, listed under Recent', JSON.stringify(n.recents));
check(n.chipPath === FULL, 'one click on a saved location jumps straight there');
check(n.searchPath === FULL, 'search finds a deep page and resolves its full path (through toggles)', n.searchPath);
check(/up to 10/.test(n.eleventh || ''), 'an 11th saved location is refused', n.eleventh);
check(n.whenFull?.count === '10/10' && n.whenFull.starDisabled && /Remove one/.test(n.whenFull.message), 'with 10 saved, the UI asks to remove one first', JSON.stringify(n.whenFull));
check(n.afterRemove?.count === '9/10' && !n.afterRemove.starDisabled, 'removing one frees a slot');
check(notion.calls.every((c) => c.version === '2026-03-11' && c.auth === 'Bearer ntn_test_secret'), 'every Notion call sends the version header and the saved secret', `${notion.calls.length} calls`);
const imagesInGuide = r.guide.steps.filter((s) => s.hasShot).length;
check(notion.uploads === imagesInGuide && notion.sent.length === imagesInGuide && notion.sent.every((x) => x.multipart && x.bytes > 5000), 'each screenshot uploaded as a file (multipart)', `${notion.sent.length}/${imagesInGuide}`);
const page = notion.pages[0] || {};
const allBlocks = [...(page.children || [])];
check(page.parent?.page_id === 'p-topic2' && /sign in and open a support ticket/.test(page.properties?.title?.title?.[0]?.text?.content || ''), 'page created inside the chosen subpage with the guide title', page.parent?.page_id);
check((page.children || []).length <= 100 && notion.appends.every((x) => x <= 100), 'blocks sent in chunks of at most 100', `${(page.children || []).length} + ${notion.appends.join('+') || 0}`);
const imgBlocks = allBlocks.filter((b) => b.type === 'image');
check(imgBlocks.length === imagesInGuide && imgBlocks.every((b) => /^fu-\d+$/.test(b.image.file_upload.id)), 'image blocks reference the uploaded files');
check(imgBlocks.every((b) => !b.image.caption?.length), 'no "Step N" caption under the screenshots');
check(allBlocks.some((b) => b.type === 'heading_2' && b.heading_2.rich_text[0].text.content === 'Sign in'), 'section headings become Notion headings');
check(allBlocks.some((b) => b.type === 'heading_3' && b.heading_3.rich_text.some((t) => t.annotations.bold)), 'steps keep their bold element names');
check(n.stored?.url === 'https://www.notion.so/page-new' && n.stored?.parentPath === FULL, 'the Notion link is saved on the guide');

console.log('\nGuides folder');
const st = r.storage || {};
check(st.before?.isDefault && st.before.guides >= 2, 'starts in the default folder', JSON.stringify(st.before));
check(st.inspectEmpty?.ok && !st.inspectEmpty.subfolder && st.inspectEmpty.target === st.inspectEmpty.chosen, 'an empty folder is used as it is');
check(st.inspectBusy?.ok && st.inspectBusy.subfolder && /FlowDoc Guides$/.test(st.inspectBusy.target), 'a folder with other files gets a "FlowDoc Guides" subfolder', st.inspectBusy?.target);
check(st.applied && !st.applied.isDefault && st.applied.copied === st.before.guides && st.applied.guides === st.before.guides, 'switching copies every guide to the new folder', JSON.stringify(st.applied));
check(st.filesInNew && st.writesGoToNew, 'guides are read from and saved to the new folder');
check(st.savedSetting === st.applied?.dir, 'the chosen folder is remembered in settings');
check(st.ui?.path === st.applied?.dir && st.ui.kind === 'Custom' && st.ui.resetShown, 'Settings shows the custom folder with a "Use default" option', JSON.stringify(st.ui));
check(/default folder again/.test(st.ui?.confirm || ''), 'switching asks for confirmation first');
check(st.reset?.isDefault && st.reset.savedSetting === '' && st.editCameBack, 'Use default switches back, bringing changes along');
check(st.missingDriveUsable === false, 'a folder on a missing drive is not used at startup (default is used instead)');

console.log('\nRename + exports');
check(r.legacyGuide === 'A guide made in StepCraft', 'guides from StepCraft carried over to FlowDoc');
for (const f of ['pdf', 'docx', 'html', 'markdown', 'json']) {
  const e = r.exports[f];
  check(e && !e.error && e.size > 10_000, `${f} export works in the desktop app`, e?.error || `${Math.round((e?.size || 0) / 1024)} KB`);
}

for (const dir of [userData, legacy]) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll desktop checks passed');
console.log(`Artifacts in ${out}`);
process.exit(failures ? 1 : 0);
