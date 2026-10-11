const SENSITIVE_KEYS = new Set(['token','authorization','cookie','cookies','set-cookie','password','secret','signature']);

function sanitizeContext(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? undefined : value;
  }
  return result;
}

export function createPlaybackSessionManager() {
  const sessions = new Map();

  const create = (input = {}) => {
    const id = input.sessionId || `playback-session:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
    const session = {
      sessionId: id,
      headers: { ...(input.headers ?? {}) },
      cookies: String(input.cookies ?? ''),
      referer: String(input.referer ?? ''),
      userAgent: String(input.userAgent ?? ''),
      token: input.token,
      expiresAt: input.expiresAt,
      metadata: sanitizeContext(input.metadata ?? {}),
    };
    sessions.set(id, session);
    return id;
  };

  const getRaw = (sessionId) => sessions.get(sessionId) ?? null;
  const get = () => null;
  const isExpired = (sessionId) => {
    const session = getRaw(sessionId);
    if (!session?.expiresAt) return false;
    const at = typeof session.expiresAt === 'number' ? session.expiresAt : Date.parse(session.expiresAt);
    return Number.isFinite(at) && at <= Date.now();
  };
  const requestContext = (sessionId) => {
    const session = getRaw(sessionId);
    if (!session) return null;
    if (isExpired(sessionId)) return null;
    const headers = { ...session.headers };
    if (session.referer) headers.Referer = session.referer;
    if (session.userAgent) headers['User-Agent'] = session.userAgent;
    if (session.token && !headers.Authorization) headers.Authorization = String(session.token).startsWith('Bearer ') ? session.token : `Bearer ${session.token}`;
    return { headers, cookies: session.cookies, referer: session.referer, userAgent: session.userAgent };
  };
  const clear = (sessionId) => sessions.delete(sessionId);
  const clearAll = () => sessions.clear();

  return { create, get, has: sessionId => sessions.has(sessionId), isExpired, requestContext, clear, clearAll };
}
export const playbackSessionManager = createPlaybackSessionManager();
