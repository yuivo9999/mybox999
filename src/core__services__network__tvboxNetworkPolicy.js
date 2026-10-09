function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function matchesHostPattern(host, pattern) {
  const value = normalize(pattern);
  if (!value) return false;
  if (value.startsWith('*.')) return host === value.slice(2) || host.endsWith(value.slice(1));
  if (value.startsWith('.*') && value.endsWith('.*')) return host.includes(value.slice(2, -2));
  if (value.startsWith('.*')) return host.includes(value.slice(2));
  return host === value || host.endsWith('.' + value) || host.includes(value);
}

export function evaluateTVBoxNetworkPolicy(config = {}, url = '') {
  let parsed;
  try { parsed = new URL(String(url)); } catch { parsed = null; }
  const host = normalize(parsed?.hostname || url);
  const fullUrl = String(url || '').toLowerCase();

  const ads = Array.isArray(config?.ads) ? config.ads : [];
  const blockedAd = ads.find(item => {
    const value = normalize(item);
    return value && (host.includes(value) || fullUrl.includes(value));
  });

  const rules = Array.isArray(config?.rules) ? config.rules : [];
  const matchedRules = rules.filter(rule => {
    const ruleHost = normalize(rule?.host);
    if (ruleHost && !fullUrl.includes(ruleHost) && !matchesHostPattern(host, ruleHost)) return false;
    const patterns = Array.isArray(rule?.rule) ? rule.rule : [];
    return !patterns.length || patterns.every(pattern => fullUrl.includes(normalize(pattern)));
  });

  return {
    blocked: Boolean(blockedAd),
    reason: blockedAd ? 'tvbox-ad-domain' : null,
    blockedValue: blockedAd || null,
    matchedRules,
  };
}

export function filterTVBoxResponseBody(config = {}, url = '', body = '') {
  const text = String(body ?? '');
  if (!text) return text;
  const parsed = evaluateTVBoxNetworkPolicy(config, url);
  if (parsed.blocked) return '';

  let parsedUrl;
  try { parsedUrl = new URL(String(url)); } catch { parsedUrl = null; }
  const host = normalize(parsedUrl?.hostname || url);
  const dohRules = Array.isArray(config?.doh) ? config.doh : [];
  let output = text;

  for (const rule of dohRules) {
    const hosts = Array.isArray(rule?.hosts) ? rule.hosts : [];
    if (!hosts.length || !hosts.some(pattern => matchesHostPattern(host, pattern))) continue;
    const expressions = Array.isArray(rule?.regex) ? rule.regex : [];
    for (const expression of expressions) {
      try {
        output = output.replace(new RegExp(String(expression), 'ig'), '');
      } catch {
        // Invalid imported regex is ignored; it must never break playback.
      }
    }
  }
  return output;
}

export function applyTVBoxNetworkPolicy(config = {}, url = '', response = {}) {
  const decision = evaluateTVBoxNetworkPolicy(config, url);
  if (decision.blocked) {
    return { ...response, ok: false, status: 204, body: '', policyBlocked: true, policyReason: decision.reason };
  }
  return {
    ...response,
    body: filterTVBoxResponseBody(config, url, response?.body),
    policyBlocked: false,
    policyMatchedRules: decision.matchedRules,
  };
}
