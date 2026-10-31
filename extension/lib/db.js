// IndexedDB storage for saved form submissions. Shared by the service worker
// and the extension pages (they all run on the same extension origin, so they
// see the same database).

const DB_NAME = "form-keeper";
const DB_VERSION = 1;
const STORE = "submissions";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("createdAt", "createdAt");
      store.createIndex("hostname", "hostname");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode) {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function addSubmission(submission) {
  const store = await tx("readwrite");
  return promisify(store.add(submission));
}

export async function getSubmission(id) {
  const store = await tx("readonly");
  return promisify(store.get(id));
}

export async function updateSubmission(id, patch) {
  const store = await tx("readwrite");
  const current = await promisify(store.get(id));
  if (!current) return null;
  const next = { ...current, ...patch, id };
  await promisify(store.put(next));
  return next;
}

export async function deleteSubmission(id) {
  const store = await tx("readwrite");
  return promisify(store.delete(id));
}

export async function clearSubmissions() {
  const store = await tx("readwrite");
  return promisify(store.clear());
}

/** All submissions, newest first. */
export async function listSubmissions() {
  const store = await tx("readonly");
  const all = await promisify(store.index("createdAt").getAll());
  return all.reverse();
}

/** Submissions created within [from, to] (ms timestamps). */
export async function listSubmissionsBetween(from, to) {
  const store = await tx("readonly");
  return promisify(store.index("createdAt").getAll(IDBKeyRange.bound(from, to)));
}

export async function countSubmissions() {
  const store = await tx("readonly");
  return promisify(store.count());
}

/** Bulk insert for imports. Strips ids so nothing collides with existing rows. */
export async function importSubmissions(items) {
  const db = await openDb();
  const t = db.transaction(STORE, "readwrite");
  const store = t.objectStore(STORE);
  for (const { id, ...rest } of items) store.add(rest);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(items.length);
    t.onerror = () => reject(t.error);
  });
}
