const DATABASE_NAME = "wireform-local-data";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
const FALLBACK_PREFIX = "wireform:";

export const AUTOSAVE_KEY = "project-autosave";
export const LIBRARIES_KEY = "user-libraries";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed."));
  });
}

async function indexedDbGet<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB read failed."));
    });
  } finally {
    database.close();
  }
}

async function indexedDbSet<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("IndexedDB write failed."));
    });
  } finally {
    database.close();
  }
}

export async function readLocalDocument<T>(key: string): Promise<T | undefined> {
  try {
    return await indexedDbGet<T>(key);
  } catch {
    try {
      const value = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
      return value ? (JSON.parse(value) as T) : undefined;
    } catch {
      return undefined;
    }
  }
}

export async function writeLocalDocument<T>(
  key: string,
  value: T,
): Promise<void> {
  try {
    await indexedDbSet(key, value);
  } catch {
    localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(value));
  }
}
