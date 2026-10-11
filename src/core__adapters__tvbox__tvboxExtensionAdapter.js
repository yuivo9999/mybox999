import { ErrorCode, toAppError } from './core__models__errors.js';
import { createTVBoxNativeRuntime } from './core__adapters__tvbox__tvboxNativeRuntime.js';

/**
 * TVBox 扩展执行器的统一边界。
 *
 * 重要：CSP / Drpy / JAR / ext 都可能包含任意站点逻辑，不能在 React/WebView
 * 环境中直接 eval。真正执行应由 Android 原生扩展运行时实现，再通过受控 bridge
 * 返回标准化结果。
 */
export const TVBOX_EXTENSION_KIND = Object.freeze({
  CSP: 'csp',
  DRPY_JS: 'drpy-js',
  JAR: 'jar',
  EXT: 'ext',
  UNKNOWN: 'unknown',
});

export const TVBOX_EXTENSION_ERROR = 'TVBOX_EXTENSION_RUNTIME_UNAVAILABLE';

export function createTVBoxExtensionAdapter(config = {}, runtime = null) {
  const effectiveRuntime = runtime ?? createTVBoxNativeRuntime();
  const sourceId = String(config.sourceId || '').trim();
  const kind = String(config.tvboxAdapterKind || 'unknown').trim() || 'unknown';

  if (!sourceId) throw new Error('TVBOX_EXTENSION_SOURCE_ID_REQUIRED');

  const definition = Object.freeze({
    sourceId,
    name: String(config.name || sourceId),
    sourceType: String(config.sourceType || 'movie'),
    sourceCapability: String(config.sourceCapability || 'tvbox-extension'),
    adapterType: String(config.adapterType || 'tvbox-extension'),
    kind,
    tvboxApi: config.tvboxApi ?? '',
    tvboxExt: config.tvboxExt ?? null,
    tvboxJar: config.tvboxJar ?? null,
    tvboxDefinition: config.tvboxDefinition ?? null,
    tvboxParseConfig: config.tvboxParseConfig ?? null,
  });

  const unavailable = (operation) => toAppError(
    new Error(TVBOX_EXTENSION_ERROR),
    {
      code: ErrorCode.SOURCE,
      scope: 'tvbox-extension-runtime',
      context: {
        sourceId,
        kind,
        operation,
      },
    },
  );

  const request = async (payload = {}, options = {}) => execute('request', payload, options);

  const resolveScript = async (payload = {}, options = {}) => {
    if (String(payload.script || '').trim()) return String(payload.script);
    const ext = definition.tvboxExt;
    if (typeof ext === 'string' && /^https?:\/\//i.test(ext.trim())) {
      const response = await request({ url: ext.trim(), method: 'GET' }, options);
      if (!response?.body) throw new Error('DRPY_EXTENSION_SCRIPT_EMPTY');
      return String(response.body);
    }
    if (typeof ext === 'string' && ext.trim()) return ext;
    throw new Error('DRPY_EXTENSION_SCRIPT_REQUIRED');
  };

  const execute = async (operation, payload = {}, options = {}) => {
    if (!effectiveRuntime || typeof effectiveRuntime.execute !== 'function' || (typeof effectiveRuntime.isAvailable === 'function' && !effectiveRuntime.isAvailable())) {
      throw unavailable(operation);
    }

    const controller = options.signal ? null : new AbortController();
    const signal = options.signal || controller.signal;
    return effectiveRuntime.execute({
      definition,
      operation,
      payload,
      signal,
    });
  };

  const load = async (payload = {}, options = {}) => (
    execute('load', { ...payload, script: await resolveScript(payload, options) }, options)
  );

  const getCapabilities = () => effectiveRuntime?.getCapabilities?.() || { available: false, supportedKinds: [] };
  const isKindSupported = () => {
    const capabilities = getCapabilities();
    return Boolean(capabilities?.available) && (
      !Array.isArray(capabilities.supportedKinds) || capabilities.supportedKinds.includes(kind)
    );
  };
  const getDefinition = () => ({ ...definition, status: isRuntimeAvailable() ? 'runtime' : 'unsupported' });
  const getStatus = () => ({ status: isRuntimeAvailable() ? 'runtime' : 'unsupported', error: isRuntimeAvailable() ? null : unavailable('status') });

  const healthCheck = async (options = {}) => {
    try {
      await execute('healthCheck', {}, options);
      return {
        ok: true,
        sourceId,
        status: 'healthy',
        checkedAt: Date.now(),
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        sourceId,
        status: effectiveRuntime && (typeof effectiveRuntime.isAvailable !== 'function' || effectiveRuntime.isAvailable()) ? 'error' : 'unsupported',
        checkedAt: Date.now(),
        error: toAppError(error, { context: { sourceId, kind } }),
      };
    }
  };

  return {
    sourceId,
    definition,
    getCapabilities,
    getDefinition,
    getStatus,
    isRuntimeAvailable: () => Boolean(
      effectiveRuntime &&
      typeof effectiveRuntime.execute === 'function' &&
      (typeof effectiveRuntime.isAvailable !== 'function' || effectiveRuntime.isAvailable()) &&
      isKindSupported()
    ),
    healthCheck,
    execute,
    load,
    request,
    search: async (payload = {}, options = {}) => execute(
      'search',
      { ...payload, script: await resolveScript(payload, options) },
      options,
    ),
    detail: async (payload = {}, options = {}) => execute(
      'detail',
      { ...payload, script: await resolveScript(payload, options) },
      options,
    ),
    episodes: async (payload = {}, options = {}) => execute(
      'episodes',
      { ...payload, script: await resolveScript(payload, options) },
      options,
    ),
    playUrl: async (payload = {}, options = {}) => execute(
      'playUrl',
      { ...payload, script: await resolveScript(payload, options) },
      options,
    ),
  };
}
