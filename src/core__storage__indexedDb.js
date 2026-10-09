/**
 * Native IndexedDB Wrapper for TVBox Cache Storage
 * Completely bypasses browser localStorage 5MB quotas.
 */

const DB_NAME = 'tvbox_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'cache_entries';

let dbPromise = null;

function getDB() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            store.createIndex('namespace', 'namespace', { unique: false });
            store.createIndex('expiresAt', 'expiresAt', { unique: false });
            store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          resolve(event.target.result);
        };

        request.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }

  return dbPromise;
}

export async function idbGet(key) {
  const db = await getDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSet(key, entry) {
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ ...entry, key });
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbDelete(key) {
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbClearNamespace(namespace) {
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('namespace');
      const req = index.openCursor(IDBKeyRange.only(namespace));

      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbClearAll() {
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbPruneLRU(namespace, maxEntries) {
  const db = await getDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('namespace');
      const req = index.openCursor(IDBKeyRange.only(namespace));
      const entries = [];
      const now = Date.now();

      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const item = cursor.value;
          if (item.expiresAt > 0 && item.expiresAt <= now) {
            cursor.delete();
          } else {
            entries.push({ key: item.key, lastAccessedAt: item.lastAccessedAt || item.createdAt || 0 });
          }
          cursor.continue();
        } else {
          if (entries.length > maxEntries) {
            entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
            const toDelete = entries.slice(0, entries.length - maxEntries);
            for (const victim of toDelete) {
              store.delete(victim.key);
            }
          }
          resolve(true);
        }
      };
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbGetAllKeys(namespace) {
  const db = await getDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('namespace');
      const req = index.getAllKeys(IDBKeyRange.only(namespace));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}
