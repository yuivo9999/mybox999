/**
 * Resilient Fetch Utility
 * - Prevents indefinite hanging with automatic timeout (default 8s)
 * - Safely decodes data: URLs in-memory (supports both Base64 and URL-encoded UTF-8)
 * - Detects and bypasses browser CORS & Mixed-Content blocks
 * - Fallbacks to reliable CORS proxies (corsproxy.io -> allorigins)
 */

const DEFAULT_TIMEOUT_MS = 8000;

function isMixedContent(url) {
  if (typeof window === 'undefined' || !window.location) return false;
  return window.location.protocol === 'https:' && url.startsWith('http://');
}

export function decodeDataUrl(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return '';
  const meta = dataUrl.slice(0, commaIndex);
  const rawData = dataUrl.slice(commaIndex + 1);

  if (meta.includes(';base64')) {
    try {
      const binary = atob(rawData);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return atob(rawData);
    }
  }

  try {
    return decodeURIComponent(rawData);
  } catch {
    return unescape(rawData);
  }
}

function isPrivateOrSensitive(url, options = {}) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return true;
    }
  } catch {}

  const headers = options.headers || {};
  const headerKeys = Object.keys(headers).map(k => k.toLowerCase());
  const hasSensitiveHeaders = headerKeys.some(k =>
    k === 'authorization' || k === 'cookie' || k === 'token' || k.includes('key') || k.includes('secret')
  );
  if (hasSensitiveHeaders) return true;

  if (options.allowProxy === false) return true;
  return false;
}

export async function resilientFetch(url, options = {}, transport = fetch) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL_REQUIRED');
  }

  const trimmedUrl = url.trim();

  // 1. Direct in-memory decoding for Data URLs (Base64 or URL-encoded)
  if (trimmedUrl.startsWith('data:')) {
    try {
      const decodedText = decodeDataUrl(trimmedUrl);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
        text: async () => decodedText,
        json: async () => JSON.parse(decodedText),
      };
    } catch (err) {
      // Fallback if custom parser fails
    }
  }

  // 2. Blob URLs
  if (trimmedUrl.startsWith('blob:')) {
    return transport(trimmedUrl, options);
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const userSignal = options.signal;

  const createTimedSignal = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);

    if (userSignal) {
      userSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.abort(userSignal.reason);
      });
    }

    return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
  };

  const isBrowser = typeof window !== 'undefined' && Boolean(window.location);
  const proxies = [
    ...(isBrowser ? [(target) => `/api/vod-proxy?url=${encodeURIComponent(target)}`] : []),
    (target) => `https://corsproxy.io/?${encodeURIComponent(target)}`,
    (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  ];

  // If running on HTTPS and target is HTTP, direct fetch will be blocked by Mixed Content
  const mustProxy = isMixedContent(trimmedUrl);

  if (!mustProxy) {
    const { signal, cleanup } = createTimedSignal();
    try {
      const response = await transport(trimmedUrl, {
        ...options,
        signal,
      });
      cleanup();
      if (response && response.ok) {
        return response;
      }
    } catch {
      cleanup();
      // Proceed to proxy fallback
    }
  }

  // If the URL is on an internal network or contains sensitive headers (tokens/keys/cookies),
  // NEVER send it to public third-party proxies.
  if (isPrivateOrSensitive(trimmedUrl, options)) {
    throw new Error('FETCH_BLOCKED_SENSITIVE_OR_PRIVATE');
  }

  // Attempt proxy fallbacks
  let lastError = null;
  for (const getProxyUrl of proxies) {
    const proxyUrl = getProxyUrl(trimmedUrl);
    const { signal, cleanup } = createTimedSignal();
    try {
      const response = await transport(proxyUrl, {
        headers: {},
        signal,
      });
      cleanup();
      if (response && (response.ok || response.status === 200 || response.status === 206)) {
        return response;
      }
    } catch (err) {
      cleanup();
      lastError = err;
    }
  }

  throw lastError || new Error('FETCH_FAILED');
}
