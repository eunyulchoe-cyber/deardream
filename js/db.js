/* IndexedDB 보관함. 기록은 기기에만 저장됩니다. */
(function () {
  const DB = "deardream", VER = 1, STORE = "entries";
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(s)).then((v) => (out = v));
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }
  const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  window.DDDB = {
    put: (e) => tx("readwrite", (s) => req2p(s.put(e))),
    get: (id) => tx("readonly", (s) => req2p(s.get(id))),
    all: async () => (await tx("readonly", (s) => req2p(s.getAll()))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    remove: (id) => tx("readwrite", (s) => req2p(s.delete(id))),
    clear: () => tx("readwrite", (s) => req2p(s.clear()))
  };
})();
