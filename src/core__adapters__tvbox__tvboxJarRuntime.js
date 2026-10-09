import { toAppError } from './core__models__errors.js';

export const TVBOX_JAR_RUNTIME_ERROR = 'TVBOX_JAR_RUNTIME_UNAVAILABLE';

export function createTVBoxJarRuntime() {
  const bridge = typeof window !== 'undefined' ? window.TVBoxJarBridge : null;

  const capabilities = () => {
    if (!bridge || typeof bridge.getCapabilities !== 'function') {
      return { available: false, reason: TVBOX_JAR_RUNTIME_ERROR };
    }
    try {
      return JSON.parse(bridge.getCapabilities() || '{}');
    } catch {
      return { available: false, reason: 'TVBOX_JAR_CAPABILITY_INVALID' };
    }
  };

  return {
    isAvailable: () => capabilities().available === true,
    getCapabilities: capabilities,
    async execute({ operation, payload = {} } = {}) {
      if (!bridge || typeof bridge.execute !== 'function') {
        throw toAppError(new Error(TVBOX_JAR_RUNTIME_ERROR), {
          context: { operation },
        });
      }
      let result;
      try {
        result = JSON.parse(bridge.execute(JSON.stringify({
          operation,
          payload,
        })) || '{}');
      } catch (error) {
        throw toAppError(error, { context: { operation } });
      }
      if (result?.ok === false) {
        throw toAppError(new Error(result.code || 'TVBOX_JAR_ERROR'), {
          context: { operation, result },
        });
      }
      return result;
    },
  };
}
