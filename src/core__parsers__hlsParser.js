import { ParserErrorCode, MediaProtocol, createResolvedMediaInput } from './core__models__parser.js';

export const hlsParser = {
  id: 'hls',
  priority: 20,
  matches(candidate) {
    const protocol = String(candidate?.protocol ?? '').toLowerCase();
    const url = String(candidate?.mediaUrl ?? candidate?.url ?? '').toLowerCase();
    return protocol === MediaProtocol.HLS || /\.m3u8(?:$|[?#])/.test(url);
  },
  async resolve(candidate, context = {}) {
    const base = createResolvedMediaInput({ ...candidate, url: candidate.mediaUrl ?? candidate.url, protocol: MediaProtocol.HLS });
    const manifestText = candidate?.metadata?.manifestText;
    if (manifestText) return { ...base, manifest: parseHlsManifest(manifestText, base.url) };

    if (context.fetchManifest !== true) return base;
    try {
      const response = await (context.fetch ?? fetch)(base.url, {
        headers: buildRequestHeaders(base),
        credentials: 'omit',
      });
      if (!response.ok) throw new Error(ParserErrorCode.MANIFEST_ERROR);
      const text = await response.text();
      return { ...base, redirectChain: response.url && response.url !== base.url ? [base.url, response.url] : [base.url], manifest: parseHlsManifest(text, response.url || base.url) };
    } catch (error) {
      if (error?.message === ParserErrorCode.SESSION_EXPIRED) throw error;
      throw new Error(error?.message === ParserErrorCode.MANIFEST_ERROR ? error.message : ParserErrorCode.NETWORK_ERROR);
    }
  },
};

export function parseHlsManifest(text, baseUrl) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => line === '#EXTM3U')) throw new Error(ParserErrorCode.MANIFEST_ERROR);
  const variants = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
      variants.push({ url: new URL(lines[i + 1], baseUrl).toString(), attributes: parseAttributes(lines[i].slice(18)) });
    }
  }
  return { type: variants.length ? 'master' : 'media', variants };
}

function parseAttributes(value) {
  return Object.fromEntries(String(value).split(/,(?=[A-Z0-9-]+=)/).map((entry) => {
    const index = entry.indexOf('=');
    return index < 0 ? [entry, ''] : [entry.slice(0, index), entry.slice(index + 1).replace(/^"|"$/g, '')];
  }));
}

function buildRequestHeaders(input) {
  const headers = { ...(input.headers ?? {}) };
  if (input.referer) headers.Referer = input.referer;
  if (input.userAgent) headers['User-Agent'] = input.userAgent;
  if (input.token && !headers.Authorization) headers.Authorization = String(input.token).startsWith('Bearer ') ? input.token : `Bearer ${input.token}`;
  return headers;
}
