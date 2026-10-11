/**
 * 直播 URL 的标准化与网络地址提示。
 * 只解析地址，不探测/猜测设备当前使用 IPv4 还是 IPv6，也不改写源站地址。
 */
export function parseLiveUrl(input, { allowNonHttp = true } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, code: 'empty_url', url: null, networkFamily: 'unknown' };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid_url', url: null, networkFamily: 'unknown' };
  }

  const protocol = parsed.protocol.toLowerCase();
  const isHttp = protocol === 'http:' || protocol === 'https:';
  if (!allowNonHttp && !isHttp) {
    return { ok: false, code: 'unsupported_scheme', url: parsed, networkFamily: 'unknown' };
  }
  if (isHttp && !parsed.hostname) {
    return { ok: false, code: 'missing_host', url: parsed, networkFamily: 'unknown' };
  }

  // WHATWG URL parser canonicalizes IPv6 literals; hostname may include brackets.
  const hostname = parsed.hostname || '';
  const isIpv6Literal = hostname.startsWith('[') && hostname.endsWith(']');
  const isIpv4Literal = !isIpv6Literal && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  return {
    ok: true,
    code: null,
    url: parsed,
    href: parsed.href,
    protocol,
    hostname,
    port: parsed.port,
    networkFamily: isIpv6Literal ? 'ipv6' : isIpv4Literal ? 'ipv4' : 'hostname',
    isHttp,
    isSecure: protocol === 'https:',
  };
}

/** Resolve HLS child URLs against the final playlist URL, preserving IPv6/ports/query syntax. */
export function resolveLiveChildUrl(childUrl, baseUrl) {
  try {
    const base = parseLiveUrl(baseUrl);
    if (!base.ok || !base.isHttp) return null;
    const resolved = new URL(String(childUrl ?? '').trim(), base.href);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/** Classifies browser-visible failure without falsely attributing it to IPv4/IPv6. */
export function classifyLiveNetworkFailure(error) {
  const text = `${error?.name ?? ''} ${error?.code ?? ''} ${error?.message ?? error ?? ''}`.toLowerCase();
  if (/cors|cross-origin|access-control/.test(text)) return 'cors';
  if (/mixed content|mixed-content/.test(text)) return 'mixed_content';
  if (/timeout|timed out|aborterror/.test(text)) return 'timeout';
  if (/not supported|decode|media_err_decode/.test(text)) return 'media';
  if (/network|fetch|dns|resolve|connection|failed to load|manifestload|fragload/.test(text)) return 'network';
  return 'unknown';
}
