import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

const TVBoxHttp = registerPlugin('TVBoxHttp');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ALLOWED_RESPONSE_TYPES = new Set(['text', 'json']);
const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;

function createNativeHttpError(code, message, context = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.context = context;
  return error;
}

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw createNativeHttpError('INVALID_HEADERS', 'headers must be an object');
  }

  return Object.entries(headers).reduce((result, [key, value]) => {
    const name = String(key).trim();
    if (!name) throw createNativeHttpError('INVALID_HEADER_NAME', 'header name is required');
    if (/^[\x00-\x1f\x7f]/.test(name) || /[\r\n]/.test(name)) {
      throw createNativeHttpError('INVALID_HEADER_NAME', 'invalid header name');
    }

    const stringValue = String(value ?? '');
    if (/[\r\n]/.test(stringValue)) {
      throw createNativeHttpError('INVALID_HEADER_VALUE', 'invalid header value');
    }

    result[name] = stringValue;
    return result;
  }, {});
}

function normalizeRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw createNativeHttpError('INVALID_REQUEST', 'request must be an object');
  }

  const url = String(request.url ?? '').trim();
  if (!url) throw createNativeHttpError('URL_REQUIRED', 'url is required');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw createNativeHttpError('INVALID_URL', 'invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createNativeHttpError('UNSUPPORTED_PROTOCOL', 'only http and https are supported');
  }

  const method = String(request.method ?? 'GET').trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw createNativeHttpError('UNSUPPORTED_METHOD', `unsupported method: ${method}`);
  }

  const responseType = String(request.responseType ?? 'text').trim().toLowerCase();
  if (!ALLOWED_RESPONSE_TYPES.has(responseType)) {
    throw createNativeHttpError('UNSUPPORTED_RESPONSE_TYPE', `unsupported responseType: ${responseType}`);
  }

  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, Number(request.timeoutMs) || DEFAULT_TIMEOUT_MS),
  );

  const params = request.params == null ? undefined : request.params;
  if (params !== undefined && (typeof params !== 'object' || Array.isArray(params))) {
    throw createNativeHttpError('INVALID_PARAMS', 'params must be an object');
  }

  let data = request.body ?? null;
  if (data !== null && data !== undefined && typeof data !== 'string') {
    try {
      JSON.stringify(data);
    } catch {
      throw createNativeHttpError('INVALID_BODY', 'body must be a string or JSON-serializable value');
    }
  }

  if (['GET', 'HEAD'].includes(method)) data = null;

  return {
    url,
    method,
    headers: normalizeHeaders(request.headers),
    params,
    data,
    timeoutMs,
    disableRedirects: Boolean(request.disableRedirects),
    responseType,
    doh: request.doh ?? null,
  };
}

function normalizeResponse(response, request) {
  const status = Number(response?.status) || 0;
  let body = response?.data ?? '';

  if (request.responseType === 'json' && typeof body !== 'string') {
    body = JSON.stringify(body);
  } else if (body !== null && body !== undefined && typeof body !== 'string') {
    body = JSON.stringify(body);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: response?.headers && typeof response.headers === 'object' ? { ...response.headers } : {},
    body: body ?? '',
    url: String(response?.url || request.url),
  };
}

function classifyNativeError(error) {
  const raw = String(error?.message ?? error ?? '').toLowerCase();
  if (raw.includes('timeout')) return { code: 'TIMEOUT', message: 'Native HTTP request timed out' };
  if (raw.includes('ssl') || raw.includes('tls') || raw.includes('certificate')) {
    return { code: 'TLS_ERROR', message: 'Native HTTP TLS validation failed' };
  }
  if (raw.includes('unknownhost') || raw.includes('dns')) {
    return { code: 'DNS_ERROR', message: 'Native HTTP DNS resolution failed' };
  }
  return { code: 'NETWORK_ERROR', message: 'Native HTTP request failed' };
}

export function isNativeHttpAvailable() {
  try {
    return (
      Capacitor.getPlatform() === 'android' &&
      Capacitor.isNativePlatform() &&
      Capacitor.isPluginAvailable('CapacitorHttp') &&
      typeof CapacitorHttp.request === 'function' && typeof TVBoxHttp?.request === 'function'
    );
  } catch {
    return false;
  }
}

export async function nativeHttpRequest(input, { signal } = {}) {
  const request = normalizeRequest(input);

  if (!isNativeHttpAvailable()) {
    throw createNativeHttpError('BRIDGE_UNAVAILABLE', 'Android Native HTTP bridge is unavailable');
  }

  if (signal?.aborted) {
    throw createNativeHttpError('ABORTED', 'Native HTTP request aborted');
  }

  let abortHandler;

  const nativePromise = request.doh?.url
    ? TVBoxHttp.request({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.data == null ? undefined : (typeof request.data === 'string' ? request.data : JSON.stringify(request.data)),
        timeoutMs: request.timeoutMs,
        dohUrl: String(request.doh.url),
        dohBootstrapIps: Array.isArray(request.doh.bootstrapIps) ? request.doh.bootstrapIps.map(String) : [],
      })
    : CapacitorHttp.request({
        url: request.url,
        method: request.method,
        headers: request.headers,
        params: request.params,
        data: request.data,
        connectTimeout: request.timeoutMs,
        readTimeout: request.timeoutMs,
        disableRedirects: request.disableRedirects,
        responseType: request.responseType,
      });

  const abortPromise = signal
    ? new Promise((_, reject) => {
        abortHandler = () => reject(createNativeHttpError('ABORTED', 'Native HTTP request aborted'));
        signal.addEventListener('abort', abortHandler, { once: true });
      })
    : null;

  try {
    const response = abortPromise
      ? await Promise.race([nativePromise, abortPromise])
      : await nativePromise;

    return normalizeResponse(response, request);
  } catch (error) {
    if (error?.code === 'ABORTED') throw error;

    const classified = classifyNativeError(error);
    throw createNativeHttpError(classified.code, classified.message, {
      method: request.method,
      url: request.url,
    });
  } finally {
    if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
    // CapacitorHttp exposes no native cancellation handle. Abort therefore
    // prevents the result from reaching JS callers, without claiming that the
    // underlying native transport was cancelled.
  }
}

export const nativeHttpBridge = Object.freeze({
  version: 1,
  isAvailable: isNativeHttpAvailable,
  request: nativeHttpRequest,
  allowedMethods: Object.freeze([...ALLOWED_METHODS]),
  allowedResponseTypes: Object.freeze([...ALLOWED_RESPONSE_TYPES]),
});
