// Runs the desktop app's self-test against mock Gemini, Groq and Notion
// servers and checks the results.   node scripts/desktop-test.mjs [outDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNotionMock } from './mock-notion.mjs';

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
  if (prompt.startsWith('Translate these')) {
    // Translation: one entry per "[i] (kind) text" line. The mock "translates"
    // by adding a Tamil prefix, so bold names and typed values survive...
    const items = [...prompt.matchAll(/^\[(\d+)\] \((.*?)\) (.*)$/gm)].map(([, i, , text]) => {
      // ...except here, where it carelessly translates a typed value too.
      const t = text.replace('"Printer offline"', '"அச்சுப்பொறி இணைப்பில் இல்லை"');
      return { i: Number(i), text: `தமிழ்: ${t}` };
    });
    return { items };
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
const { notion, handle: notionHandle } = createNotionMock();
function notionRoute(req, res, body) {
  const { status, data } = notionHandle({ method: req.method, url: req.url, headers: req.headers, body });
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
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
      calls.push({ provider: 'gemini', key: req.headers['x-goog-api-key'], model, images: parts.filter((p) => p.inline_data).length, json: json.generationConfig?.responseMimeType, thinking, batch: (prompt.match(/^\[\d+\] /gm) || []).length, understand: prompt.includes('Work out what the person'), translate: prompt.startsWith('Translate these'), prompt: prompt.startsWith('Translate these') ? prompt : undefined });
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

console.log('\nContinue capturing');
const cc = r.continue || {};
const ca = cc.after || {};
check(cc.scopeDialog?.modes?.join() === 'screen,area,apps' && cc.scopeDialog.checked === 'screen', 'it first asks what to record, starting from the last choice', JSON.stringify(cc.scopeDialog));
check(cc.button && cc.started?.sameGuide && cc.started.continuing, 'the editor button continues the same guide', JSON.stringify(cc.started));
check(cc.started?.stepCount === ca.beforeActions, 'the recorder counts on from the existing steps', `${cc.started?.stepCount} of ${ca.beforeActions}`);
check(cc.locked, 'the guide is locked while capturing');
check(ca.added >= 2 && ca.keptOld && ca.titleKept, 'new steps are added after the old ones; old steps and title kept', `+${ca.added}: ${(ca.newTexts || []).join(' / ')}`);
check(ca.notRecording && ca.editorUnlocked, 'Done reopens the guide unlocked');
check(cc.discard?.exists && cc.discard.sameSteps && cc.discard.notRecording, 'Discard removes only the new steps and keeps the guide', JSON.stringify(cc.discard));
console.log('\nCapture scope');
const near = (a, b, tol) => !!a && !!b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= tol);
const sc = r.scope || {};
const sa = sc.apps || {};
check(sc.list?.shell?.length === 1 && sc.list.shellLast && sc.list.keptClosed, 'app picker: taskbar entry last, chosen apps kept when closed', JSON.stringify(sc.list));
check(sa.bar?.shown && sa.bar.text === 'Notepad', 'recorder bar shows the chosen apps', JSON.stringify(sa.bar));
check(sa.ignored === 0, 'a click in an app that is not chosen is not recorded', `${sa.ignored} steps`);
check(sa.panel?.shown && sa.panel.rows >= 2 && sa.panel.fits && sa.panel.icons.every(Boolean), "the bar's app list opens and fits its window", JSON.stringify(sa.panel));
check(!!sa.stray?.key && sa.notice?.shown && sa.notice.text === `${sa.stray.name} isn't being captured`, 'the bar offers to add that app', JSON.stringify(sa.notice));
check(sa.kept === 1 && sa.barAfter === '2 apps', 'Add keeps the click just made and adds the app', `${sa.kept} steps, bar "${sa.barAfter}"`);
check(sa.steps?.length === 2 && sa.steps.every((s) => near(s.crop, sa.expectedCrop, 0.02)), "app shots are cropped to the app's window", JSON.stringify(sa.steps?.map((s) => s.crop)));
check(sa.saved?.mode === 'apps' && sa.saved.apps.length === 2, 'the guide remembers its apps', JSON.stringify(sa.saved));
const sr = sc.area || {};
const A = sr.area;
check(sr.overlays === sr.displays, 'area picker covers every display', `${sr.overlays} of ${sr.displays}`);
check(sr.started && sr.overlaysClosed && A && Math.abs(A.x - sr.want.x) <= 2 && Math.abs(A.y - sr.want.y) <= 2 && Math.abs(A.width - sr.want.width) <= 2 && Math.abs(A.height - sr.want.height) <= 2 && A.displayId === sr.want.displayId,
  'drag a rectangle and press Start: capture begins with that area', JSON.stringify({ got: A, want: sr.want, sel: sr.selected }));
check(sr.frame?.count === 4 && sr.frame.visible && sr.frame.outside && sr.frame.hugs, 'a border marks the area, just outside it', JSON.stringify(sr.frame));
check(sr.clear?.strips && sr.clear.bar, 'no FlowDoc window covers the area; the recorder bar is shown beside it', JSON.stringify(sr.clear));
check(sr.bar?.shown && sr.bar.text === 'Area', 'recorder bar offers to change the area', JSON.stringify(sr.bar));
const areaTexts = (sr.steps || []).map((s) => s.text);
check(!areaTexts.some((t) => /Submit/.test(t)), 'clicks outside the area are ignored', areaTexts.join(' / '));
check(areaTexts.some((t) => /Subject/.test(t) && t.startsWith('Click')) && (sr.steps || []).every((s) => near(s.crop, sr.expectedCrop, 0.004)), 'clicks inside the area are shots cropped to it', JSON.stringify(sr.steps));
check(areaTexts.some((t) => t.startsWith('Type')), 'typing inside the area is captured', r.checks.demoFocused ? areaTexts.join(' / ') : focusNote);
check(sr.frameHiddenAfter && sr.saved?.mode === 'area', 'the border goes away when done; the guide remembers the area');

console.log('\nRecorder bar visible to other apps');
const bv = r.barVisibility || {};
const allProtected = (list, want) => Array.isArray(list) && list.length === 4 && list.every((p) => p === want);
check(bv.setting === true && bv.barProtected === true && allProtected(bv.borderProtected, true), 'by default the bar and the area border are hidden from screen captures', JSON.stringify({ bar: bv.barProtected, border: bv.borderProtected }));
check(bv.checkbox?.was === true && !bv.checkbox.disabled, 'Settings > Capture shows "Hide the recorder bar…" ticked');
check(bv.off?.saved === false && bv.off.barProtected === false && allProtected(bv.off.borderProtected, false), 'unticking it lets recorders and meetings see the bar and the border', JSON.stringify(bv.off));
check(bv.barShown && bv.barClickIgnored, 'a click on the visible bar is still not a step');
check(process.platform === 'linux' || bv.screenGrab?.meanDiff > 20, 'a real screen grab (as a meeting app sees it) shows the bar only when unticked', JSON.stringify(bv.screenGrab));
if (process.platform === 'linux') {
  check(bv.blurred?.count === 1 && bv.blurred.matches, 'FlowDoc blurs the bar out of its own screenshots (Linux cannot hide it)', JSON.stringify(bv.blurred));
} else {
  const own = bv.ownShot || {};
  check(bv.blurred?.count === 0 && own.toHidden !== null && own.toHidden < own.toVisible / 2, "FlowDoc's own screenshot shows what is behind the bar, not the bar or a blur", JSON.stringify({ ...own, redactions: bv.blurred?.count }));
  check(bv.barProtectedAfterShot === false, 'after the shot the bar is visible to other apps again', String(bv.barProtectedAfterShot));
  const overlap = bv.overlap || [];
  const leaked = overlap.filter((s) => s.error || (s.barHidden && !(s.toHidden < s.toVisible / 2)));
  check(overlap.length === 10 && leaked.length === 0, 'overlapping screenshots never let the bar back into a shot marked as without it', JSON.stringify(leaked.length ? leaked : overlap.map((s) => `${s.barHidden ? 'hidden' : 'blur'}:${s.toHidden}/${s.toVisible}`)));
}
check(bv.discarded, 'the test capture was discarded');
check(bv.restoreBox?.was === false && bv.on?.saved === true && bv.on.barProtected === true && allProtected(bv.on.borderProtected, true), 'ticking it again hides them from captures again', JSON.stringify(bv.on));

console.log('\nRepeated clicks');
const rc = r.repeatedClicks || {};
const count = (list, re) => (list || []).filter((t) => re.test(t)).length;
check(rc.setting === true, 'Settings > Capture > "Ignore repeated clicks that change nothing" is on by default');
const want = [
  'Click **Refresh**',
  'Click **Add one**',
  'Click **Add one**',
  'Click **Add one**',
  'Click **Clear**',
  'Double-click **Refresh**',
  'Right-click **Refresh**',
  'Click **Refresh**',
  'Double-click **Refresh**',
];
check(count(rc.on, /^Click \*\*Refresh/) === 2 && rc.on?.[0] === want[0], 'clicking Refresh 3 times when nothing changes is one step', JSON.stringify(rc.on));
check(count(rc.on, /Add one/) === 3, 'clicking "Add one" 3 times keeps 3 steps (each click changed something)', JSON.stringify(rc.on));
check(count(rc.on, /Clear/) === 1, 'clicking Clear 3 times is one step: only the first click changed anything', JSON.stringify(rc.on));
check(count(rc.on, /Double-click \*\*Refresh/) === 2, 'double-clicking Refresh twice is one step', JSON.stringify(rc.on));
check(count(rc.on, /Right-click/) === 1, 'right-clicking Refresh twice is one step', JSON.stringify(rc.on));
check(JSON.stringify(rc.on?.slice(0, want.length)) === JSON.stringify(want), 'a click then a double-click on the same thing are both kept, in order', JSON.stringify(rc.on));
const tail = (rc.on || []).slice(want.length);
check(tail.length === 2 && /^Double-click \*\*Official/.test(tail[0]), 'double-clicking the same word 4 times (a bubble under it moving each time) is one step', JSON.stringify(tail));
check(tail.length === 2 && tail[1] === 'Click **Help**', 'clicking a button 3 times while its tooltip comes and goes is one step', JSON.stringify(tail));
check(count(rc.off, /Refresh/) === 2, 'with the setting off, every click is a step again', JSON.stringify(rc.off));

console.log('\nBrowser tabs');
const bt = r.browserTabs;
if (!bt) console.log('  - skipped (needs Windows and Microsoft Edge)');
else if (!bt.tabsFound) check(false, "found Edge's tabs to click", JSON.stringify(bt));
else {
  const nav = bt.first?.[0];
  const pages = [bt.pageA, bt.pageB];
  check(bt.first?.length === 1 && nav.action === 'navigate' && pages.includes(nav.href) && nav.text === `Navigate to **${nav.href}**` && nav.shot && !nav.target, 'a click on a browser tab becomes "Navigate to <link>" with a shot of the page', JSON.stringify(bt.first));
  check(JSON.stringify(bt.again) === '["navigate"]', 'clicking the tab already shown again adds nothing (a repeated click that changes nothing)', JSON.stringify(bt.again));
  if (!bt.edgeInFront) console.log('  - Ctrl+Tab skipped: Windows kept another window in front');
  else check(bt.ctrlTab?.action === 'navigate' && pages.includes(bt.ctrlTab.href) && bt.ctrlTab.href !== nav?.href, "Ctrl+Tab to another tab becomes 'Navigate to' that tab's link", JSON.stringify(bt.ctrlTab));
}

// Later checks work on the guide as it is after "Continue capturing".
const finalSteps = r.guide.steps.length + (ca.added || 0);

console.log('\nAI client');
check(direct.thinkingRejected.ok && direct.thinkingRejected.model === 'gemini-legacy', 'models that reject thinking settings are retried with defaults');
check(direct.busy.ok && direct.busy.model === 'gemini-3.6-flash', 'an overloaded model (503) hands over to gemini-3.6-flash', `${direct.busy.model || direct.busy.error} in ${direct.busy.ms} ms`);
check(direct.slow.ok && direct.slow.model === 'gemini-3.6-flash', 'a request that never answers is abandoned at the safety limit', `${direct.slow.model || direct.slow.error} in ${direct.slow.ms} ms`);
check(r.migration?.model === 'gemini-3.6-flash' && r.migration?.keptChoice === 'gemini-3.8-flash', 'old default gemini-3.8-flash migrates once, later choices are kept', JSON.stringify(r.migration));

console.log('\nWriting styles');
const gem = calls.filter((c) => c.provider === 'gemini' && c.key !== 'k'); // 'k' = direct client checks above
const groq = calls.filter((c) => c.provider === 'groq');
const stepCalls = gem.filter((c) => c.batch && !c.translate);
const crispCalls = stepCalls.filter((c) => c.images === 0);
const imageCalls = stepCalls.filter((c) => c.images > 0);
check(gem.length > 0 && gem.every((c) => c.key === 'test-gemini-key' && c.model === 'gemini-3.6-flash'), 'Gemini requests use saved key and model', `${gem.length} calls`);
check(gem.every((c) => c.json === 'application/json' && c.thinking?.thinkingLevel === 'MINIMAL'), 'Gemini requests use JSON mode and minimal thinking');
check(crispCalls.length === 1 && crispCalls[0].batch === finalSteps, 'Crisp sends text only, all steps in one request', `${crispCalls.map((c) => `${c.batch} steps/0 images`).join(', ')}`);
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

console.log('\nTranslate');
const tr = r.translate || {};
const tc = tr.copy || {};
const trCalls = gem.filter((c) => c.translate);
check(tr.offButton?.needsAi && tr.offButton.aria === 'true', 'without AI the Translate button is greyed out', JSON.stringify(tr.offButton));
check(tr.needsAi?.title === 'Translation needs AI' && tr.needsAi.settingsButton && tr.settingsOpened, 'clicking it explains that AI is needed and opens the AI settings', JSON.stringify(tr.needsAi));
check(tr.onButton && !tr.onButton.needsAi, 'with AI set up the button is active');
check(
  tr.dialog?.groups?.join('|') === 'Indian languages|Other languages' && tr.dialog.first === 'தமிழ் (Tamil)' && tr.dialog.hindi === 'हिन्दी (Hindi)' && tr.dialog.english === 'English' && tr.dialog.other,
  'Indian languages first, native name then English; "Other…" for any language',
  `${tr.dialog?.first}, ${tr.dialog?.hindi}, …`,
);
check(tr.dialog?.selected === 'ta' && tr.dialog.parts?.every(Boolean) && tr.dialog.uiNames === 'keep', 'defaults: Tamil, everything ticked, on-screen names kept');
check(tc.from && tc.language?.code === 'ta' && tc.sourceUnchanged, 'a translated copy is made; the original guide is unchanged', JSON.stringify(tc.language));
check(tc.title?.startsWith('தமிழ்: ') && tc.headings?.length && tc.headings.every((h) => h.startsWith('தமிழ்: ')) && tc.notesTranslated, 'title, headings and notes translated', tc.title);
check(tc.stepsTranslated === tc.steps - 1, 'every step translated except the one whose typed value the AI changed', `${tc.stepsTranslated} of ${tc.steps}`);
check(tc.typedValueKept, 'a translation that changes a typed value is rejected (the step keeps its original text)');
check(tc.boldKept, 'on-screen names in bold stay as on screen');
check(tc.editorLang === 'ta' && tc.editorTitle?.startsWith('தமிழ்: ') && tc.editorTamilBlocks >= tc.stepsTranslated, 'the open editor shows the translation and is marked as Tamil', `title "${tc.editorTitle}", ${tc.editorTamilBlocks} translated blocks shown`);
check(trCalls.length > 0 && trCalls.every((c) => c.images === 0) && trCalls.some((c) => c.prompt.includes('Tamil (தமிழ்)')) && trCalls.some((c) => c.prompt.includes('Copy it exactly as written, untranslated')), 'requests are text only, name the language and keep on-screen names', `${trCalls.length} requests`);
const te = tr.exports || {};
check(te.copy?.questionMarks === 0 && te.copy.images > te.source?.images, 'PDF draws Tamil text itself instead of "???"', `${te.copy?.images} images vs ${te.source?.images} in the English PDF`);
check(te.htmlLang && te.htmlTamil, 'HTML export is tagged lang="ta"');
check(/^Translating into தமிழ் \(Tamil\)/.test(tr.stop?.banner || '') && tr.stop.copyRemoved && tr.stop.backToSource, 'Stop removes the half-made copy and reopens the original', tr.stop?.banner);

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
const imagesInGuide = r.guide.steps.filter((s) => s.hasShot).length + (ca.newShots || 0);
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

console.log('\nClick highlights');
const hl = r.highlight || {};
check(hl.normal?.ring && hl.normal.box && hl.normal.centreClear, 'Normal: outline + ring, with a see-through centre', JSON.stringify(hl.normal));
check(hl.box?.box && !hl.box.ring, 'Box only: outline, no ring', JSON.stringify(hl.box));
check(hl.none && !hl.none.box && !hl.none.ring, 'None: no marks', JSON.stringify(hl.none));
check(hl.aiCrop?.ring && hl.aiCrop.box, 'AI screenshots keep full marks even with "None" and a hidden step');
check(JSON.stringify(hl.settings?.options) === '["normal","box","none"]' && hl.settings.checked === 'normal', 'Settings offers Normal / Box only / None (Normal by default)', JSON.stringify(hl.settings?.options));
check(hl.settings?.saved === 'none' && hl.settings.toolbarWhenNone?.disabled, 'choosing None is saved and disables the toolbar toggle');
check(hl.toggle?.before?.pressed === 'true', 'toolbar shows a Highlights toggle, on by default', JSON.stringify(hl.toggle?.before));
check(hl.toggle?.afterHide?.allHidden && hl.toggle.afterHide.button.pressed === 'false' && hl.toggle.afterHide.button.label === 'Highlights off', 'one click hides the highlight on every step', JSON.stringify(hl.toggle?.afterHide));
check(hl.toggle?.afterShow?.allShown && hl.toggle.afterShow.button.pressed === 'true', 'clicking again shows them on every step');

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

console.log('\nSettings sidebar');
const sb = r.settingsSidebar || {};
const side = sb.sidebar || {};
check(JSON.stringify(sb.tabs) === '["general","capture","storage","ai","integrations"]', 'Settings has General, Capture, Storage, AI and Integrations sections', JSON.stringify(sb.tabs));
check(side.orientation === 'vertical' && side.navLeft && side.stacked, 'the sections are in a sidebar on the left, one under another', JSON.stringify({ orientation: side.orientation, navLeft: side.navLeft, stacked: side.stacked }));
const wantHeadings = {
  general: ['Click highlight', 'Keyboard shortcut'],
  capture: ['While capturing', 'Typed text', 'Steps'],
  storage: ['Guides folder'],
  ai: ['AI assistant'],
  integrations: ['Notion'],
};
check(JSON.stringify(side.headings) === JSON.stringify(wantHeadings), 'each section shows only its own settings', JSON.stringify(side.headings));
check(side.sizes?.length === 1, 'the dialog keeps the same size for every section', JSON.stringify(side.sizes));
check(JSON.stringify(side.keys) === '["capture","storage","capture","integrations","general","integrations","general"]', 'Up/Down move through the sections (wrapping), Home/End jump to the first/last', JSON.stringify(side.keys));
check(JSON.stringify(sb.storage) === '["storage"]', 'clicking a section shows only that section', JSON.stringify(sb.storage));
check(sb.reopened === 'storage' && JSON.stringify(sb.reopenedVisible) === '["storage"]' && sb.focused === 'storage', 'Settings reopens on the section used last, with keyboard focus on it', `${sb.reopened} ${JSON.stringify(sb.reopenedVisible)} focus=${sb.focused}`);

console.log('\nStorage and security');
const sec = r.security || {};
const sto = sec.storage || {};
check(!sto.inlineImages && sto.refs > 0 && sto.filesExist, 'screenshots are saved as image files, not inside the guide file', JSON.stringify(sto));
check(sto.webp > 0, 'captured screenshots are WebP', `${sto.webp}/${sto.refs}`);
check(!sto.indexInlineImages, 'the guide list keeps thumbnails as files too');
check(sec.editorImage?.blob && sec.editorImage.width > 0, 'the editor shows screenshots from the stored files', JSON.stringify(sec.editorImage));
check(sec.inlineScriptBlocked === true, 'markup injected into the workspace cannot run script (CSP)');
check(sec.import && sec.import.id === null && sec.import.kind === 'manual' && sec.import.href === null && sec.import.screenshot === null, 'an imported guide file is cleaned of markup, script links and remote images', JSON.stringify(sec.import));
check(sec.navigationBlocked === true, 'the workspace window cannot be navigated away from FlowDoc');
check(sec.geolocation === 'denied', 'permissions FlowDoc does not use are refused', sec.geolocation);
check(sec.notifications === 'granted', 'notifications stay allowed for finished AI work', sec.notifications);

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
