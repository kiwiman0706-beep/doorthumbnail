// IndexedDB storage layer.
// Two stores: `photos` (image blobs + thumbnails) and `frames` (one instax per year/month slot).

const DB_NAME = 'door-thumbnail';
const DB_VERSION = 1;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains('frames')) {
        const s = db.createObjectStore('frames', { keyPath: 'id' });
        s.createIndex('ym', ['year', 'month']);
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      void e;
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async get(store, key) { return wrap((await tx(store, 'readonly')).get(key)); },
  async put(store, value) { return wrap((await tx(store, 'readwrite')).put(value)); },
  async del(store, key) { return wrap((await tx(store, 'readwrite')).delete(key)); },
  async all(store) { return wrap((await tx(store, 'readonly')).getAll()); },
  async clear(store) { return wrap((await tx(store, 'readwrite')).clear()); },

  async putMany(store, values) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      values.forEach((v) => s.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async setting(key, value) {
    if (value === undefined) {
      const row = await this.get('meta', key);
      return row ? row.value : undefined;
    }
    return this.put('meta', { key, value });
  },
};

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
