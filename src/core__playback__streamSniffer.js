/**
 * 直播流类型识别。
 * 直播源清单可能包含标准扩展名、动态 PHP/CTv/XYZ 地址、短链接和平台路由地址。
 * URL 只能提供线索；无法确认时必须返回 UNKNOWN/AUTO，而不是误判为 MP4。
 */
export const STREAM_TYPE = Object.freeze({
  HLS: 'hls', FLV: 'flv', TS: 'ts', MP4: 'mp4', DASH: 'dash', RTMP: 'rtmp', RTSP: 'rtsp', UNKNOWN: 'unknown',
});

const HLS_PATH_HINTS = /(?:\.m3u8[a-z0-9_-]*(?:$|[?#])|\.m3u(?:$|[?#])|\/hls(?:\/|$)|\/playlist(?:\.m3u8)?(?:$|[?#])|\/pltv\/|\/tvod\/)/i;
const FLV_PATH_HINTS = /\.flv(?:$|[?#])/i;
const TS_PATH_HINTS = /\.ts(?:$|[?#])/i;
const MP4_PATH_HINTS = /\.mp4(?:$|[?#])/i;
const DASH_PATH_HINTS = /\.mpd(?:$|[?#])/i;

/** confident=true 仅用于可由 URL 明确判断的格式。 */
export function detectStreamTypeFromUrl(url) {
  const raw = String(url || '').trim();
  const lower = raw.toLowerCase();
  if (/^rtmps?:\/\//i.test(lower)) return { type: STREAM_TYPE.RTMP, confident: true };
  if (/^rtsps?:\/\//i.test(lower)) return { type: STREAM_TYPE.RTSP, confident: true };
  if (HLS_PATH_HINTS.test(lower)) return { type: STREAM_TYPE.HLS, confident: !/\.ctv(?:$|[?#])|\.php(?:$|[?#])|\.xyz(?:$|[?#])/i.test(lower) };
  if (FLV_PATH_HINTS.test(lower)) return { type: STREAM_TYPE.FLV, confident: true };
  if (TS_PATH_HINTS.test(lower)) return { type: STREAM_TYPE.TS, confident: true };
  if (MP4_PATH_HINTS.test(lower)) return { type: STREAM_TYPE.MP4, confident: true };
  if (DASH_PATH_HINTS.test(lower)) return { type: STREAM_TYPE.DASH, confident: true };

  // 平台路由和动态扩展名经常返回 HLS/FLV/TS；只作为线索，仍保留自动识别状态。
  if (/\.(?:ctv|php|xyz)(?:$|[?#])/i.test(lower) || /\/(?:huya|douyu|bilibili|migu|fm)\//i.test(lower)) {
    return { type: STREAM_TYPE.UNKNOWN, confident: false, dynamic: true };
  }
  return { type: STREAM_TYPE.UNKNOWN, confident: false };
}

/** 按内容字节识别媒体类型。 */
export function sniffStreamBytes(bytes, contentType = '') {
  const b = bytes || new Uint8Array(0);
  let i = 0;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i += 1;
  if (b.length - i >= 7 && String.fromCharCode(...b.slice(i, i + 7)) === '#EXTM3U') return STREAM_TYPE.HLS;
  if (b.length >= 3 && b[0] === 0x46 && b[1] === 0x4c && b[2] === 0x56) return STREAM_TYPE.FLV;
  if (b.length >= 1 && b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) return STREAM_TYPE.TS;
  if (b.length >= 8 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return STREAM_TYPE.MP4;
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (/mpegurl|vnd\.apple\.mpegurl/.test(ct)) return STREAM_TYPE.HLS;
  if (/x-flv|flv/.test(ct)) return STREAM_TYPE.FLV;
  if (/mp2t|mpeg-ts/.test(ct)) return STREAM_TYPE.TS;
  if (/video\/mp4|application\/mp4/.test(ct)) return STREAM_TYPE.MP4;
  if (/dash\+xml/.test(ct)) return STREAM_TYPE.DASH;
  return STREAM_TYPE.UNKNOWN;
}

/**
 * 尝试读取真实响应内容。跨域/混合内容/鉴权导致读取失败时返回 null，
 * 调用方仍可按直接播放策略尝试，不会依赖外部代理。
 */
export async function probeStreamType(target, { timeoutMs = 5000, parentSignal } = {}) {
  if (typeof fetch !== 'function' || typeof AbortController === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener?.('abort', onParentAbort);
  try {
    const response = await fetch(target, { signal: controller.signal, cache: 'no-store', redirect: 'follow' });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    const fromHeader = sniffStreamBytes(null, contentType);
    if (fromHeader !== STREAM_TYPE.UNKNOWN) {
      try { await response.body?.cancel?.(); } catch {}
      return { type: fromHeader, finalUrl: response.url || target, contentType };
    }
    if (!response.body?.getReader) return { type: STREAM_TYPE.UNKNOWN, finalUrl: response.url || target, contentType };
    const reader = response.body.getReader();
    const chunks = []; let total = 0;
    while (total < 512) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value); total += result.value.length;
    }
    try { await reader.cancel(); } catch {}
    const head = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { head.set(chunk, offset); offset += chunk.length; }
    return { type: sniffStreamBytes(head, contentType), finalUrl: response.url || target, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener?.('abort', onParentAbort);
    controller.abort();
  }
}

/** 将识别结果转换为清单中可用的协议提示；不明确时返回 auto。 */
export function inferLiveProtocolFromUrl(url) {
  const detected = detectStreamTypeFromUrl(url);
  return detected.type === STREAM_TYPE.UNKNOWN ? 'auto' : detected.type;
}
