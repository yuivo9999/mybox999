const DEFAULT_CONCURRENCY = 4;

export function createRequestManager({ concurrency = DEFAULT_CONCURRENCY } = {}) {
  const limit = Math.max(1, Number(concurrency) || DEFAULT_CONCURRENCY);
  const entries = new Map();
  const queue = [];
  let active = 0;

  const pump = () => {
    while (active < limit && queue.length) {
      const entry = queue.shift();
      if (entry.controller.signal.aborted) {
        entry.reject(createAbortError());
        entries.delete(entry.key);
        continue;
      }

      active += 1;
      Promise.resolve()
        .then(() => entry.operation(entry.controller.signal))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          if (entries.get(entry.key) === entry) entries.delete(entry.key);
          pump();
        });
    }
  };

  const run = (key, operation) => {
    if (!key) throw new Error('REQUEST_KEY_REQUIRED');
    if (typeof operation !== 'function') throw new Error('REQUEST_OPERATION_REQUIRED');

    const existing = entries.get(key);
    if (existing) return existing.promise;

    const controller = new AbortController();
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry = {
      key,
      controller,
      operation,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
    };

    entries.set(key, entry);
    queue.push(entry);
    pump();
    return promise;
  };

  const cancel = (key) => {
    const entry = entries.get(key);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  };

  const cancelAll = () => {
    entries.forEach((entry) => entry.controller.abort());
  };

  return {
    run,
    cancel,
    cancelAll,
    get size() {
      return entries.size;
    },
  };
}

function createAbortError() {
  const error = new Error('REQUEST_ABORTED');
  error.name = 'AbortError';
  return error;
}

export const requestManager = createRequestManager({ concurrency: 4 });
