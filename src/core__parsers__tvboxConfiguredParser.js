import { requestAdapter } from './core__services__network__requestAdapter.js';
import { createResolvedMediaInput } from './core__models__parser.js';
import { applyTVBoxNetworkPolicy } from './core__services__network__tvboxNetworkPolicy.js';

function selectDoH(config) {
  const entries = Array.isArray(config?.doh) ? config.doh : [];
  const endpoint = entries.find(item => /^https?:\/\//i.test(String(item?.url || '').trim()));
  if (!endpoint) return null;
  const bootstrapIps = Array.isArray(endpoint.ips)
    ? endpoint.ips.map(value => String(value).trim()).filter(Boolean)
    : [];
  return {
    url: String(endpoint.url).trim(),
    bootstrapIps,
  };
}

function normalizeFlag(value) {
  return String(value ?? '').replace(/\r?\n/g, '').trim().toLowerCase();
}

function collectCandidateFlags(candidate = {}) {
  const metadata = candidate.metadata ?? {};
  return [
    metadata.tvboxPlayFlag,
    metadata.flag,
    metadata.sourceFlag,
    metadata.title,
    metadata.name,
    candidate.mediaUrl,
    candidate.url,
  ].flatMap(value => Array.isArray(value) ? value : [value])
    .map(normalizeFlag)
    .filter(Boolean);
}

function matchesFlag(parse, candidate) {
  const flags = Array.isArray(parse?.ext?.flag) ? parse.ext.flag.map(normalizeFlag).filter(Boolean) : [];
  if (!flags.length) return false;
  const values = collectCandidateFlags(candidate);
  return flags.some(flag => values.some(value => value.includes(flag) || flag.includes(value)));
}

function selectParse(config, candidate) {
  const parses = Array.isArray(config?.parses) ? config.parses : [];
  const explicit = candidate?.metadata?.tvboxParse
    || (candidate?.parserHint && typeof candidate.parserHint === 'object' ? candidate.parserHint.parse : '')
    || '';
  const explicitName = normalizeFlag(explicit);

  if (explicitName && explicitName !== 'false' && explicitName !== 'true') {
    const found = parses.find(parse => normalizeFlag(parse.name || parse.id) === explicitName);
    if (found && /^https?:\/\//i.test(String(found.url || '').trim())) return found;
  }

  return parses.find(parse => /^https?:\/\//i.test(String(parse?.url || '').trim()) && matchesFlag(parse, candidate)) ?? null;
}

function buildParseUrl(parse, mediaUrl) {
  const endpoint = String(parse?.url || '').trim();
  if (!endpoint || !mediaUrl) return '';
  if (endpoint.includes('{url}')) return endpoint.replaceAll('{url}', encodeURIComponent(mediaUrl));
  return endpoint + (endpoint.includes('=') || endpoint.endsWith('?') || endpoint.endsWith('&') ? encodeURIComponent(mediaUrl) : `?url=${encodeURIComponent(mediaUrl)}`);
}

function buildHeaders(parse, candidate) {
  return {
    ...(parse?.ext?.header ?? {}),
    ...(candidate?.headers ?? {}),
    ...(candidate?.referer ? { Referer: candidate.referer } : {}),
    ...(candidate?.userAgent ? { 'User-Agent': candidate.userAgent } : {}),
  };
}

function extractUrl(body) {
  const text = String(body ?? '').trim();
  if (!text) return '';
  try {
    const json = JSON.parse(text);
    const value = json?.url ?? json?.playUrl ?? json?.play_url ?? json?.data?.url ?? json?.data?.playUrl ?? json?.result?.url ?? json?.result?.playUrl;
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim();
    if (Array.isArray(json?.data)) {
      const first = json.data.find(item => /^https?:\/\//i.test(String(item?.url ?? '').trim()));
      if (first?.url) return String(first.url).trim();
    }
  } catch {
    // Plain-text parser endpoints are also common.
  }
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : '';
}

export function createTVBoxConfiguredParser(config = {}) {
  return {
    id: 'tvbox-configured',
    name: 'tvbox-configured',
    priority: 10,
    matches(candidate) {
      return Boolean(selectParse(config, candidate));
    },
    async resolve(candidate, context = {}) {
      const parse = selectParse(config, candidate);
      if (!parse) return null;

      // Demo/Web are TVBox special modes, not HTTP endpoints. They stay in
      // the registry but are intentionally not executed as network URLs.
      const parseUrl = buildParseUrl(parse, candidate.mediaUrl ?? candidate.url);
      if (!parseUrl || !/^https?:\/\//i.test(String(parse.url || ''))) return null;

      const response = await requestAdapter.request(parseUrl, {
        headers: buildHeaders(parse, candidate),
        signal: context.signal,
        timeoutMs: candidate.timeoutMs ?? context.timeoutMs,
        doh: selectDoH(config),
      });
      if (!response?.ok) throw new Error(`PARSER_HTTP_${response?.status ?? 0}`);

      const rawBody = await response.text();
      const policyResponse = applyTVBoxNetworkPolicy(config, parseUrl, { ...response, body: rawBody });
      if (policyResponse.policyBlocked) throw new Error('TVBOX_AD_BLOCKED');
      const resolvedUrl = extractUrl(policyResponse.body);
      if (!resolvedUrl) throw new Error('TVBOX_CONFIGURED_PARSE_EMPTY');

      return createResolvedMediaInput({
        ...candidate,
        url: resolvedUrl,
        parserHint: parse.name || parse.id,
        metadata: {
          ...(candidate.metadata ?? {}),
          tvboxResolvedBy: parse.name || parse.id,
        },
      });
    },
  };
}
