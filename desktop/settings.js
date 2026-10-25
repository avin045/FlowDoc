// User settings for the desktop app. API keys are encrypted with the OS
// keychain (Electron safeStorage: DPAPI on Windows, libsecret/kwallet on
// Linux) and never leave the main process.
import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { FALLBACK_MODELS } from './ai.js';

// gemini-3.6-flash: measured 2026-10-24 at ~4 s for four screenshots, while
// the newer gemini-3.8-flash sat at 90–150 s or returned 503 "high demand".
export const AI_PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.6-flash',
    fallbacks: FALLBACK_MODELS.gemini,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  groq: { label: 'Groq', defaultModel: 'qwen/qwen3.8-27b', fallbacks: FALLBACK_MODELS.groq, keyUrl: 'https://console.groq.com/keys' },
};

// Models that were once our default, moved to the current one on upgrade.
const RETIRED_DEFAULTS = { gemini: ['gemini-3.8-flash'] };

const DEFAULTS = {
  ai: {
    provider: 'off', // 'off' | 'gemini' | 'groq'
    models: { gemini: AI_PROVIDERS.gemini.defaultModel, groq: AI_PROVIDERS.groq.defaultModel },
    modelLists: {}, // provider -> model IDs from the last "Load models"
    style: 'elaborate', // 'crisp' | 'elaborate' | 'conceptual'
    autoEnhance: false,
  },
  notion: {
    // Locations are { id, title, path, crumbs: [{ id, title }] }.
    recents: [], // last 5 places a guide was saved, newest first
    saved: [], // up to 10 named locations: { name, ...location }
  },
  capture: {
    hideWindow: true, // minimise FlowDoc while capturing
    typedText: true, // include what was typed (passwords are always masked)
    unknownFieldText: false, // include keystrokes when the field type can't be detected
  },
  ui: {
    theme: 'system', // 'system' | 'light' | 'dark'
  },
  storage: {
    libraryDir: '', // empty = the default folder inside the app's data folder
  },
  migrations: {},
};

export function createSettings(file) {
  let data = null;
  let keys = {}; // provider -> { enc: base64, plain?: true }

  async function load() {
    if (data) return;
    let raw;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      data = structuredClone(DEFAULTS);
      return;
    }
    data = merge(structuredClone(DEFAULTS), raw.settings || {});
    keys = raw.keys || {};
    // One-time move off a retired default. The migration flag stops it from
    // undoing a later, deliberate choice.
    let changed = false;
    for (const [provider, retired] of Object.entries(RETIRED_DEFAULTS)) {
      const flag = `default-${AI_PROVIDERS[provider].defaultModel}`;
      if (!data.migrations[flag] && retired.includes(data.ai.models[provider])) {
        data.ai.models[provider] = AI_PROVIDERS[provider].defaultModel;
        changed = true;
      }
      if (!data.migrations[flag]) {
        data.migrations[flag] = true;
        changed = true;
      }
    }
    if (changed) await persist();
  }

  async function persist() {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ settings: data, keys }, null, 2));
  }

  // Copies known settings from src into target. Objects listed in OPEN_MAPS
  // hold arbitrary keys (flags, per-provider lists) and accept new ones.
  const OPEN_MAPS = new Set(['migrations', 'ai.modelLists']);
  function merge(target, src, path = '') {
    const open = OPEN_MAPS.has(path);
    for (const [k, v] of Object.entries(src)) {
      const here = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) merge(target[k], v, here);
      else if (open || k in target) target[k] = v;
    }
    return target;
  }

  return {
    // What the UI may see: settings plus which providers have a key saved.
    async getPublic() {
      await load();
      return {
        ...structuredClone(data),
        keys: Object.fromEntries([...Object.keys(AI_PROVIDERS), 'notion'].map((p) => [p, !!keys[p]])),
        providers: AI_PROVIDERS,
        secureStorage: safeStorage.isEncryptionAvailable(),
      };
    },
    async get() {
      await load();
      return data;
    },
    async update(patch) {
      await load();
      merge(data, patch || {});
      await persist();
      return this.getPublic();
    },
    async setKey(provider, apiKey) {
      await load();
      // AI providers plus 'notion' (the Notion integration token).
      if (!AI_PROVIDERS[provider] && provider !== 'notion') throw new Error(`Unknown provider ${provider}`);
      const value = String(apiKey || '').trim();
      if (!value) delete keys[provider];
      else if (safeStorage.isEncryptionAvailable()) keys[provider] = { enc: safeStorage.encryptString(value).toString('base64') };
      else keys[provider] = { enc: Buffer.from(value).toString('base64'), plain: true };
      await persist();
      return this.getPublic();
    },
    async getKey(provider) {
      await load();
      const k = keys[provider];
      if (!k) return null;
      const buf = Buffer.from(k.enc, 'base64');
      return k.plain ? buf.toString('utf8') : safeStorage.decryptString(buf);
    },
  };
}
