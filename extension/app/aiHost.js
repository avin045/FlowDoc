// Where the AI settings, API keys and requests live.
// Desktop: the main process (keys encrypted with the system keychain).
// Extension: this browser profile's extension storage, and requests go
// straight from the workspace page to the provider.
import { AI_PROVIDERS, complete, listModels } from '../shared/aiClient.js';

const SETTINGS_KEY = 'flowdoc_ai_settings';
const KEYS_KEY = 'flowdoc_ai_keys';

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
  async function read() {
    const got = await store.get([SETTINGS_KEY, KEYS_KEY]);
    return { ai: merge(structuredClone(DEFAULTS), got[SETTINGS_KEY]), keys: got[KEYS_KEY] || {} };
  }
  async function getPublic() {
    const { ai, keys } = await read();
    return { ai, keys: Object.fromEntries(Object.keys(AI_PROVIDERS).map((p) => [p, !!keys[p]])), providers: AI_PROVIDERS, secureStorage: false };
  }
  return {
    kind: 'extension',
    settings: {
      get: getPublic,
      async update(patch) {
        const { ai } = await read();
        await store.set({ [SETTINGS_KEY]: merge(ai, patch?.ai) });
        return getPublic();
      },
      async setKey(provider, apiKey) {
        if (!AI_PROVIDERS[provider]) throw new Error(`Unknown provider ${provider}`);
        const { keys } = await read();
        const value = String(apiKey || '').trim();
        if (value) keys[provider] = value;
        else delete keys[provider];
        await store.set({ [KEYS_KEY]: keys });
        return getPublic();
      },
    },
    ai: {
      async complete(req) {
        const { ai, keys } = await read();
        const provider = req.provider || ai.provider;
        if (!provider || provider === 'off') throw new Error('AI is turned off. Choose a provider in Settings.');
        return complete({ ...req, provider, apiKey: keys[provider], model: req.model || ai.models[provider] });
      },
      async listModels(provider) {
        return listModels(provider, (await read()).keys[provider]);
      },
    },
    openExternal: (url) => chrome.tabs.create({ url }),
  };
}

function desktopHost(d) {
  return { kind: 'desktop', settings: d.settings, ai: d.ai, openExternal: d.openExternal };
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
