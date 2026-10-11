import { resilientFetch } from './core__utils__resilientFetch.js';
import { webViewRuntime } from './core__runtime__webViewRuntime.js';
import { errorService } from './core__services__errorService.js';

function createFetchLikeResponse(response) {
  const body = response?.body == null ? '' : String(response.body);
  const headers = new Headers(response?.headers ?? {});
  return Object.freeze({
    ok: Boolean(response?.ok),
    status: Number(response?.status) || 0,
    headers,
    url: String(response?.url ?? ''),
    text: async () => body,
    json: async () => JSON.parse(body),
  });
}

function normalizeRequestError(error, context) {
  if (error?.code === 'ABORTED' || error?.name === 'AbortError') return error;
  return errorService.classifyNetwork(error, {
    scope: 'request-adapter',
    ...context,
  });
}

export async function browserRequest(url, options = {}) {
  const { transport, ...requestOptions } = options;
  const browserTransport = typeof transport === 'function' ? transport : fetch;
  try {
    return await resilientFetch(url, requestOptions, browserTransport);
  } catch (error) {
    throw normalizeRequestError(error, {
      transport: 'browser',
      url,
    });
  }
}

export async function nativeRequest(url, options = {}) {
  const {
    signal,
    headers,
    body,
    method = 'GET',
    params,
    timeoutMs,
    disableRedirects,
    responseType = 'text',
    doh,
  } = options;

  try {
    const response = await webViewRuntime.nativeHttpRequest(
      {
        url,
        method,
        headers,
        body,
        params,
        timeoutMs,
        disableRedirects,
        responseType,
        doh,
      },
      { signal },
    );
    return createFetchLikeResponse(response);
  } catch (error) {
    throw normalizeRequestError(error, {
      transport: 'native',
      url,
    });
  }
}

export const requestAdapter = Object.freeze({
  async request(url, options = {}) {
    const { transport } = options;

    // Explicit transports are test/integration overrides. Production calls use
    // the runtime capability so pages and services never inspect Android state.
    if (typeof transport === 'function') {
      return browserRequest(url, options);
    }

    if (webViewRuntime.capabilities.nativeHttp) {
      return nativeRequest(url, options);
    }

    return browserRequest(url, options);
  },
  browserRequest,
  nativeRequest,
});
