export const ErrorCode = Object.freeze({
  NETWORK: 'NetworkError',
  SOURCE: 'SourceError',
  SOURCE_EMPTY: 'SourceEmptyError',
  SOURCE_RESPONSE: 'SourceResponseError',
  PARSE: 'ParseError',
  NORMALIZE: 'NormalizeError',
  PLAYBACK: 'PlaybackError',
  STORAGE: 'StorageError',
  IMAGE: 'ImageError',
  USER_INPUT: 'UserInputError',
  UNKNOWN: 'UnknownError',
});

const SENSITIVE_KEYS = new Set(['token', 'authorization', 'cookie', 'cookies', 'set-cookie', 'password', 'secret', 'signature']);

function sanitizeValue(value, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return typeof value === 'string' && value.length > 500 ? value.slice(0, 500) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));

  return Object.entries(value).reduce((result, [key, item]) => {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitizeValue(item, depth + 1);
    return result;
  }, {});
}

export class AppError extends Error {
  constructor(code = ErrorCode.UNKNOWN, message = code, options = {}) {
    super(String(message || code));
    this.name = 'AppError';
    this.code = code;
    this.cause = options.cause;
    this.context = sanitizeValue(options.context ?? {});
    this.retryable = Boolean(options.retryable);
    this.scope = options.scope ?? 'unknown';
  }
}

export function toAppError(error, options = {}) {
  if (error instanceof AppError) {
    return new AppError(error.code, error.message, {
      cause: error.cause ?? error,
      context: { ...error.context, ...(options.context ?? {}) },
      retryable: error.retryable || Boolean(options.retryable),
      scope: error.scope !== 'unknown' ? error.scope : options.scope,
    });
  }

  const rawCode = String(error?.code ?? error?.message ?? '').toLowerCase();
  let code = options.code ?? ErrorCode.UNKNOWN;
  if (!options.code) {
    if (rawCode.includes('network') || rawCode.includes('timeout') || rawCode.includes('failed to fetch') || rawCode.includes('fetch failed') || rawCode.includes('networkerror') || rawCode.includes('connection')) code = ErrorCode.NETWORK;
    else if (rawCode.includes('parser') || rawCode.includes('manifest') || rawCode.includes('sessionexpired')) code = ErrorCode.PARSE;
    else if (rawCode.includes('storage') || rawCode.includes('serialize') || rawCode.includes('quota')) code = ErrorCode.STORAGE;
    else if (rawCode.includes('player') || rawCode.includes('media_load') || rawCode.includes('unsupported')) code = ErrorCode.PLAYBACK;
  }

  return new AppError(code, options.message ?? error?.message ?? code, {
    cause: error,
    context: options.context ?? {},
    retryable: Boolean(options.retryable),
    scope: options.scope ?? 'unknown',
  });
}

export function errorForUser(error, fallback = '操作失败，请稍后重试。') {
  const known = new Set(Object.values(ErrorCode));
  return known.has(error?.code) ? { code: error.code, message: fallback } : { code: ErrorCode.UNKNOWN, message: fallback };
}

export function serializeError(error) {
  const normalized = toAppError(error);
  return {
    name: normalized.name,
    code: normalized.code,
    message: normalized.message,
    context: normalized.context,
    retryable: normalized.retryable,
    scope: normalized.scope,
  };
}
