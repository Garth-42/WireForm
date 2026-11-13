const DATABASE_NAME = "wireform-local-data";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
const FALLBACK_PREFIX = "wireform:";

export const AUTOSAVE_KEY = "project-autosave";
export const LIBRARIES_KEY = "user-libraries";
export const LIBRARIES_RECOVERY_KEY = "user-libraries-unreadable";

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
    request.onblocked = () => reject(new Error("IndexedDB is blocked."));
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
      // Quota failures abort the transaction without always firing `error`;
      // without this handler the promise would never settle.
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB write was aborted."));
    });
  } finally {
    database.close();
  }
}

function readFallback<T>(key: string): T | undefined {
  try {
    const value = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}

function clearFallback(key: string) {
  try {
    localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
  } catch {
    // Nothing to clean up when localStorage is unavailable.
  }
}

/**
 * Reads a document saved by `writeLocalDocument`.
 *
 * A localStorage copy only exists when the most recent IndexedDB write failed
 * (successful writes delete it), so when present it is the newest version.
 */
export async function readLocalDocument<T>(key: string): Promise<T | undefined> {
  const fallback = readFallback<T>(key);
  if (fallback !== undefined) return fallback;
  try {
    return await indexedDbGet<T>(key);
  } catch {
    return undefined;
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
    return;
  }
  clearFallback(key);
}
