// Encrypts the extension's secrets (AI API keys, the Notion integration secret)
// before they go into chrome.storage.local.
//
// One AES-GCM key (256-bit) is made once by the browser's own crypto engine
// (Web Crypto) and marked non-extractable: no script, FlowDoc's included,
// can ever read its bytes, only ask the browser to encrypt or decrypt with it.
// The key is kept in this extension's IndexedDB, apart from the secrets.
// Each secret is stored as { v, iv, data }: a fresh random 12-byte IV (nonce)
// per encryption, and the ciphertext with AES-GCM's tag, which makes
// decryption fail if the stored bytes were changed.
//
// What it protects: the secrets never sit in extension storage as text, so
// whoever looks at that storage (DevTools, a copy of the data, sync or backup
// tools) sees only random bytes. What it can't: someone with full access to
// this Windows account digging the raw key out of Chrome's profile files.
// Extensions have no access to the system keychain the desktop app uses.

const DB_NAME = 'flowdoc-secrets';
const STORE = 'keys';
const KEY_ID = 'aes-gcm-1';

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let keyPromise = null;
// The extension's key, made on first use. Two pages asking at once both end
// up with the one that was stored first.
function getKey() {
  keyPromise ||= (async () => {
    const db = await openDb();
    try {
      const found = await idb(db, 'readonly', (s) => s.get(KEY_ID));
      if (found) return found;
      const made = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idb(db, 'readwrite', (s) => s.add(made, KEY_ID)).catch(() => {});
      return (await idb(db, 'readonly', (s) => s.get(KEY_ID))) || made;
    } finally {
      db.close();
    }
  })();
  keyPromise.catch(() => (keyPromise = null));
  return keyPromise;
}

/** Whether a stored value is one of ours (encrypted), not plain text from before. */
export const isSealed = (value) => !!value && typeof value === 'object' && value.v === 1 && typeof value.iv === 'string' && typeof value.data === 'string';

/** Encrypts a secret for storage. */
export async function seal(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(text));
  return { v: 1, iv: toB64(iv), data: toB64(data) };
}

/** Decrypts a stored secret. Plain text from before encryption is returned as it is. */
export async function unseal(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (!isSealed(value)) return '';
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(value.iv) }, await getKey(), fromB64(value.data));
    return new TextDecoder().decode(plain);
  } catch {
    // Changed bytes, or the key is gone (site data cleared): the secret can't
    // be read back, so it has to be pasted again.
    throw new Error('A saved key could not be decrypted. Paste it again in Settings.');
  }
}
