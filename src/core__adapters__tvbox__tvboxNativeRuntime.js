import { ErrorCode, toAppError } from './core__models__errors.js';

export const TVBOX_NATIVE_RUNTIME_CONTRACT_VERSION = '1';

function bridgeUnavailableError() {
  return toAppError(
    new Error('TVBOX_EXTENSION_RUNTIME_UNAVAILABLE'),
    {
      code: ErrorCode.SOURCE,
      scope: 'tvbox-extension-runtime',
      context: { reason: 'native-bridge-unavailable' },
    },
  );
}

function parseBridgeResult(raw) {
  if (raw == null) throw bridgeUnavailableError();
  if (typeof raw !== 'string') return raw;

  try {
    return JSON.parse(raw);
  } catch {
    throw toAppError(
      new Error('TVBOX_EXTENSION_BRIDGE_INVALID_RESPONSE'),
      {
        code: ErrorCode.SOURCE,
        scope: 'tvbox-extension-runtime',
      },
    );
  }
}

/**
 * Thin JS wrapper around the Android TVBox extension bridge.
 *
 * The bridge is intentionally capability-driven. It does not execute
 * extension code in React/WebView; native runtime support is added behind
 * this contract one extension kind at a time.
 */
export function createTVBoxNativeRuntime(globalObject = globalThis) {
  const bridge = globalObject?.TVBoxExtensionBridge;

  return {
    isAvailable: () => {
      if (!bridge || typeof bridge.execute !== 'function') return false;
      if (typeof bridge.getCapabilities !== 'function') return true;
      try { return Boolean(parseBridgeResult(bridge.getCapabilities()).available); } catch { return false; }
    },
    getCapabilities: () => {
      if (!bridge || typeof bridge.getCapabilities !== 'function') {
        return {
          contractVersion: TVBOX_NATIVE_RUNTIME_CONTRACT_VERSION,
          available: false,
          supportedKinds: [],
          supportedOperations: [],
          reason: 'TVBOX_EXTENSION_NATIVE_BRIDGE_UNAVAILABLE',
        };
      }

      return parseBridgeResult(bridge.getCapabilities());
    },
    execute: async ({ definition, operation, payload = {} } = {}) => {
      if (!bridge || typeof bridge.execute !== 'function') {
        throw bridgeUnavailableError();
      }

      const result = parseBridgeResult(bridge.execute(JSON.stringify({
        contractVersion: TVBOX_NATIVE_RUNTIME_CONTRACT_VERSION,
        definition,
        operation,
        payload,
      })));

      if (result?.ok === false) {
        throw toAppError(
          new Error(result.code || 'TVBOX_EXTENSION_RUNTIME_ERROR'),
          {
            code: ErrorCode.SOURCE,
            scope: 'tvbox-extension-runtime',
            context: {
              sourceId: definition?.sourceId,
              kind: definition?.kind,
              operation,
              bridgeResult: result,
            },
          },
        );
      }

      return result;
    },
  };
}
