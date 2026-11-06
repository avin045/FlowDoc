// Where the settings, secrets and API requests live (AI and Notion).
// Desktop: the main process (secrets encrypted with the system keychain).
// Extension: this browser profile's extension storage, secrets encrypted
// with a key only the browser can use (secretStore.js), and requests go
// straight from the workspace page to the provider or Notion.
import { AI_PROVIDERS, complete, listModels } from '../shared/aiClient.js';
import { listChildPages, listPages, normalizeSaved, pathTo, saveGuide, whoAmI, withRecent } from '../shared/notionClient.js';
import { isSealed, seal, unseal } from '../shared/secretStore.js';

const SETTINGS_KEY = 'flowdoc_ai_settings';
// AI keys and the Notion secret, each encrypted: { gemini, groq, notion }.
const KEYS_KEY = 'flowdoc_ai_keys';
const SECRET_NAMES = [...Object.keys(AI_PROVIDERS), 'notion'];
// Saved and recent Notion destinations.
const NOTION_KEY = 'flowdoc_notion';
// The extension's capture settings; background.js reads them while recording.
const CAPTURE_KEY = 'flowdoc_capture';
const CAPTURE_DEFAULTS = { ignoreRepeats: true };

const DEFAULTS = {
  provider: 'off',
  models: { gemini: AI_PROVIDERS.gemini.defaultModel, groq: AI_PROVIDERS.groq.defaultModel },
  modelLists: {},
  style: 'elaborate',
  translate: { language: 'ta', custom: '', parts: { title: true, headings: true, steps: true, notes: true }, uiNames: 'keep' },
};

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(into, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (isPlain(v) && isPlain(into[k])) merge(into[k], v);
    else into[k] = structuredClone(v);
  }
  return into;
}

function extensionHost() {
  const store = chrome.storage.local;

  // Keys saved as plain text before they were encrypted: encrypt them once.
  let migrated = null;
  const migrate = () =>
    (migrated ||= (async () => {
      const keys = (await store.get(KEYS_KEY))[KEYS_KEY];
      if (!keys || !Object.values(keys).some((v) => typeof v === 'string')) return;
      const sealed = {};
      for (const [name, v] of Object.entries(keys)) sealed[name] = typeof v === 'string' ? await seal(v) : v;
      await store.set({ [KEYS_KEY]: sealed });
    })().catch((err) => {
      migrated = null;
      throw err;
    }));

  async function read() {
    await migrate();
    const got = await store.get([SETTINGS_KEY, KEYS_KEY, CAPTURE_KEY, NOTION_KEY]);
    return {
      ai: merge(structuredClone(DEFAULTS), got[SETTINGS_KEY]),
      keys: got[KEYS_KEY] || {}, // encrypted
      capture: merge(structuredClone(CAPTURE_DEFAULTS), got[CAPTURE_KEY]),
      notion: { saved: [], recents: [], ...got[NOTION_KEY] },
    };
  }
  // A secret, decrypted only for the request that needs it.
  const secret = async (name) => unseal((await read()).keys[name]);
  async function getPublic() {
    const { ai, keys, capture, notion } = await read();
    const has = (name) => isSealed(keys[name]) || (typeof keys[name] === 'string' && !!keys[name]);
    return { ai, capture, notion, keys: Object.fromEntries(SECRET_NAMES.map((n) => [n, has(n)])), providers: AI_PROVIDERS, encrypted: true };
  }
  const updateNotion = async (patch) => {
    const { notion } = await read();
    await store.set({ [NOTION_KEY]: { ...notion, ...patch } });
    return getPublic();
  };
  const progress = new Set();

  return {
    kind: 'extension',
    settings: {
      get: getPublic,
      async update(patch) {
        const { ai, capture } = await read();
        await store.set({ [SETTINGS_KEY]: merge(ai, patch?.ai), [CAPTURE_KEY]: merge(capture, patch?.capture) });
        return getPublic();
      },
      // AI providers' API keys, and 'notion' (the Notion integration secret).
      async setKey(name, value) {
        if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown provider ${name}`);
        const { keys } = await read();
        const text = String(value || '').trim();
        if (text) keys[name] = await seal(text);
        else delete keys[name];
        await store.set({ [KEYS_KEY]: keys });
        return getPublic();
      },
    },
    ai: {
      async complete(req) {
        const { ai } = await read();
        const provider = req.provider || ai.provider;
        if (!provider || provider === 'off') throw new Error('AI is turned off. Choose a provider in Settings.');
        return complete({ ...req, provider, apiKey: await secret(provider), model: req.model || ai.models[provider] });
      },
      async listModels(provider) {
        return listModels(provider, await secret(provider));
      },
    },
    notion: {
      me: async () => whoAmI(await secret('notion')),
      pages: async (query) => listPages(await secret('notion'), query || ''),
      children: async (pageId) => listChildPages(await secret('notion'), pageId),
      path: async (pageId) => pathTo(await secret('notion'), pageId),
      setSaved: (list) => updateNotion({ saved: normalizeSaved(list) }),
      async save(req) {
        const result = await saveGuide(await secret('notion'), req, (p) => progress.forEach((cb) => cb(p)));
        // Remember the destination under Recent.
        if (req.location?.id) await updateNotion({ recents: withRecent((await read()).notion.recents, req.location) });
        return result;
      },
      onProgress(cb) {
        progress.add(cb);
        return () => progress.delete(cb);
      },
    },
    openExternal: (url) => chrome.tabs.create({ url }),
  };
}

function desktopHost(d) {
  return { kind: 'desktop', settings: d.settings, ai: d.ai, notion: d.notion, openExternal: d.openExternal };
}

export const aiHost = globalThis.flowdocDesktop
  ? desktopHost(globalThis.flowdocDesktop)
  : globalThis.chrome?.storage?.local
    ? extensionHost()
    : null;

// True when a provider is chosen and has a key.
export async function aiEnabled() {
  if (!aiHost) return false;
  const s = await aiHost.settings.get();
  return s.ai.provider !== 'off' && !!s.keys[s.ai.provider];
}
