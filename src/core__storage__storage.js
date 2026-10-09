import { ErrorCode } from './core__models__errors.js';
import { errorService } from './core__services__errorService.js';

const PREFIX = 'tvbox:v2:';
const BACKUP_PREFIX = 'tvbox:backup:';

const memoryStore = new Map();

function getNativeStorageBridge() {
  if (typeof window === 'undefined') return null;
  const bridge = window.TVBoxAndroidBridge || window.Android || window.tvboxBridge;
  if (bridge && typeof bridge.saveUserData === 'function') return bridge;
  return null;
}

function pruneStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(BACKUP_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {}
}

function read(key, fallback) {
  try {
    if (memoryStore.has(key)) return memoryStore.get(key);
    const raw = window.localStorage.getItem(`${PREFIX}${key}`);
    if (raw !== null) return JSON.parse(raw);

    // If not in localStorage, attempt to restore from Android native dual-write storage
    const bridge = getNativeStorageBridge();
    if (bridge && typeof bridge.loadUserData === 'function') {
      const nativeRaw = bridge.loadUserData(key);
      if (nativeRaw) {
        const parsed = JSON.parse(nativeRaw);
        window.localStorage.setItem(`${PREFIX}${key}`, nativeRaw);
        return parsed;
      }
    }

    return fallback;
  } catch (error) {
    errorService.report(error, { scope: 'storage-read', key });
    return memoryStore.get(key) ?? fallback;
  }
}

function write(key, value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw errorService.normalize(new Error('STORAGE_SERIALIZE_FAILED'), {
      code: ErrorCode.STORAGE,
      context: { scope: 'storage-write', key },
    });
  }

  // Dual-write to Android SharedPreferences if native bridge is available
  try {
    const bridge = getNativeStorageBridge();
    if (bridge && typeof bridge.saveUserData === 'function') {
      bridge.saveUserData(key, serialized);
    }
  } catch {}

  try {
    window.localStorage.setItem(`${PREFIX}${key}`, serialized);
    memoryStore.delete(key);
  } catch (error) {
    const isQuota =
      error?.name === 'QuotaExceededError' ||
      error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error?.code === 22 ||
      error?.code === 1014;

    if (isQuota) {
      pruneStorage();
      try {
        // If it's an array (e.g. history, progress, searches), prune older 50%
        if (Array.isArray(value)) {
          const trimmed = value.slice(-Math.max(20, Math.floor(value.length / 2)));
          window.localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(trimmed));
          return;
        }
        window.localStorage.setItem(`${PREFIX}${key}`, serialized);
        return;
      } catch {
        // Safe fallback to memoryStore to avoid uncaught exception breaking the React app
        memoryStore.set(key, value);
        errorService.report(error, { scope: 'storage-write-quota-fallback', key });
        return;
      }
    }
    throw errorService.normalize(error, {
      code: ErrorCode.STORAGE,
      context: { scope: 'storage-write', key },
    });
  }
}

function remove(key) {
  window.localStorage.removeItem(`${PREFIX}${key}`);
}

function has(key) {
  return window.localStorage.getItem(`${PREFIX}${key}`) !== null;
}

function backup(key, value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('STORAGE_BACKUP_SERIALIZE_FAILED');
  window.localStorage.setItem(`${BACKUP_PREFIX}${key}`, serialized);
}

function readBackup(key, fallback) {
  try {
    const raw = window.localStorage.getItem(`${BACKUP_PREFIX}${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    errorService.report(error, { scope: 'storage-backup-read', key });
    return fallback;
  }
}

export const storage = {
  read,
  write,
  remove,
  has,
  backup,
  readBackup,
  PREFIX,
  BACKUP_PREFIX,
};
