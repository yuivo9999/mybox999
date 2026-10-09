export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
export function safeJsonStringify(value, fallback = '') {
  try { return JSON.stringify(value); } catch { return fallback; }
}
