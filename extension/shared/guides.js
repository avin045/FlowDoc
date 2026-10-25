// Guide persistence shared by the background worker, the desktop app and the
// workspace UI. Inside the extension everything lives in chrome.storage.local
// (unlimitedStorage); the desktop app stores JSON files through its preload
// bridge; a plain web page falls back to IndexedDB.

const INDEX_KEY = 'guides_index';
const guideKey = (id) => `guide_${id}`;

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const desktop = typeof globalThis !== 'undefined' ? globalThis.flowdocDesktop : undefined;

function idbKv() {
  let dbPromise;
  const db = () =>
    (dbPromise ??= new Promise((resolve, reject) => {
      // Database name predates the FlowDoc rename; kept so web-mode guides survive.
      const req = indexedDB.open('stepcraft', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = async (mode, fn) => {
    const store = (await db()).transaction('kv', mode).objectStore('kv');
    return new Promise((resolve, reject) => {
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)),
    remove: (key) => run('readwrite', (s) => s.delete(key)),
  };
}

export let kv = hasChromeStorage
  ? {
      get: async (key) => (await chrome.storage.local.get(key))[key],
      set: (key, value) => chrome.storage.local.set({ [key]: value }),
      remove: (key) => chrome.storage.local.remove(key),
    }
  : desktop?.kv || idbKv();

// The desktop main process plugs in its file store here.
export function setKv(adapter) {
  kv = adapter;
}

export const isExtension = hasChromeStorage;
export const isDesktop = !!desktop;

export function newId(prefix = '') {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return prefix + Date.now().toString(36) + rand[0].toString(36) + rand[1].toString(36).slice(0, 4);
}

export async function listGuides() {
  const index = (await kv.get(INDEX_KEY)) || [];
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getGuide(id) {
  return (await kv.get(guideKey(id))) || null;
}

function summarize(guide) {
  return {
    id: guide.id,
    title: guide.title,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
    stepCount: guide.steps.filter((s) => s.kind === 'action').length,
    thumb: guide.thumb || null,
    recording: !!guide.recording,
  };
}

export async function saveGuide(guide, { touch = true } = {}) {
  if (touch) guide.updatedAt = Date.now();
  await kv.set(guideKey(guide.id), guide);
  const index = (await kv.get(INDEX_KEY)) || [];
  const at = index.findIndex((g) => g.id === guide.id);
  if (at >= 0) index[at] = summarize(guide);
  else index.push(summarize(guide));
  await kv.set(INDEX_KEY, index);
  return guide;
}

export async function deleteGuide(id) {
  await kv.remove(guideKey(id));
  const index = ((await kv.get(INDEX_KEY)) || []).filter((g) => g.id !== id);
  await kv.set(INDEX_KEY, index);
}

export function createGuide(fields = {}) {
  const now = Date.now();
  return {
    id: newId('g'),
    title: '',
    description: '',
    createdAt: now,
    updatedAt: now,
    steps: [],
    ...fields,
  };
}

// Default title from the pages a recording touched, e.g. "Workflow on github.com".
export function defaultTitle(guide) {
  const hosts = [];
  for (const step of guide.steps) {
    try {
      const host = new URL(step.url).hostname.replace(/^www\./, '');
      if (host && !hosts.includes(host)) hosts.push(host);
    } catch {
      /* step without a URL */
    }
  }
  if (!hosts.length) return 'Untitled guide';
  return `Workflow on ${hosts.slice(0, 2).join(' and ')}${hosts.length > 2 ? ' and more' : ''}`;
}
