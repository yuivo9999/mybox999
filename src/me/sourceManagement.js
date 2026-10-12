import { storage } from '../core__storage__storage.js';
import { sourceRepository } from '../core__repositories__sourceRepository.js';
import { createSourceAdapters } from '../core__adapters__sourceAdapterFactory.js';
import { userDataService } from './userDataService.js';
import { syncAllSources, testSource } from '../core__services__source-management__sourceRuntimeService.js';
import { tv1LiveService, liveService } from '../live/liveServices.js';
import { sourceRegistryService } from '../core__services__source-management__sourceRegistryService.js';
import { cacheService } from '../core__services__cacheService.js';

// Source definitions, validation, import/export and presets
function validateImportedSources(value) {
  if (!Array.isArray(value)) throw new Error('SOURCE_IMPORT_ARRAY_REQUIRED');
  return value.map((source, index) => {
    if (!source || typeof source !== 'object') throw new Error(`SOURCE_IMPORT_ITEM_INVALID:${index}`);
    const sourceRef = String(source.sourceRef || source.url || '').trim();
    const isDeferredTVBoxProvider = source.adapterType === 'tvbox-live-extension'
      || source.sourceCapability === 'tvbox-live-provider';
    if (!sourceRef && !isDeferredTVBoxProvider) throw new Error(`SOURCE_IMPORT_URL_REQUIRED:${index}`);
    return source;
  });
}

function stripJSONComments(str) {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    const nextChar = str[i + 1];
    if (inString) {
      if (char === '\\') {
        out += char + (nextChar || '');
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      out += char;
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i++;
    } else if (char === '/' && nextChar === '/') {
      i += 2;
      while (i < str.length && str[i] !== '\n' && str[i] !== '\r') i++;
    } else if (char === '/' && nextChar === '*') {
      i += 2;
      while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

function sanitizeJSONControlChars(str) {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    const nextChar = str[i + 1];
    if (inString) {
      if (char === '\\') {
        out += char + (nextChar || '');
        i += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
        out += char;
      } else if (char === '\n') {
        out += '\\n';
      } else if (char === '\r') {
        out += '\\r';
      } else if (char === '\t') {
        out += '\\t';
      } else if (char.charCodeAt(0) < 0x20) {
        out += ' ';
      } else {
        out += char;
      }
      i++;
      continue;
    }
    if (char === '"') inString = true;
    out += char;
    i++;
  }
  return out;
}

function cleanMismatchedBraces(str) {
  let balance = 0;
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    const nextChar = str[i + 1];
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      i++;
    } else if (char === '{' || char === '[') {
      balance++;
      i++;
    } else if (char === '}' || char === ']') {
      balance--;
      if (balance === 0) return str.slice(0, i + 1);
      i++;
    } else {
      i++;
    }
  }
  return str;
}

function stripTrailingCommas(str) {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    const nextChar = str[i + 1];
    if (inString) {
      if (char === '\\') {
        out += char + (nextChar || '');
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      out += char;
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i++;
      continue;
    }
    if (char === ',') {
      let j = i + 1;
      while (j < str.length && /\s/.test(str[j])) j++;
      if (str[j] === '}' || str[j] === ']') {
        i++;
        continue;
      }
    }
    out += char;
    i++;
  }
  return out;
}

function parseRelaxedJSON(text) {
  const cleaned = stripTrailingCommas(cleanMismatchedBraces(sanitizeJSONControlChars(stripJSONComments(String(text).trim()))));
  return JSON.parse(cleaned);
}

function stableHash(value) {
  let hash = 2166136261;
  const input = String(value || '');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createBundleId(name) {
  return `bundle_local_${stableHash(String(name || '').trim().toLowerCase())}`;
}

function createLocalSource({ name, sourceType, text, format, liveMode, bundleId }) {
  const resolvedBundleId = bundleId || createBundleId(name, text);
  const sourceId = `source_${stableHash(`${resolvedBundleId}|${sourceType}|${name}`)}`;
  return {
    sourceId,
    bundleId: resolvedBundleId,
    sourceKey: `local|${sourceType}|${stableHash(name)}`,
    name,
    sourceType,
    sourceRef: `local://${encodeURIComponent(name)}`,
    url: `local://${encodeURIComponent(name)}`,
    localContent: text,
    localFormat: format,
    ...(sourceType === 'live' && liveMode ? { liveMode } : {}),
    enabled: true,
    status: '未测试',
    createdAt: Date.now(),
  };
}

function resolveLiveSourceRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^proxy:\/\//i.test(raw)) {
    const match = raw.match(/(?:[?&]|^)ext=(.+)$/i);
    if (!match) return '';
    try {
      const decoded = decodeURIComponent(match[1]);
      return /^https?:\/\//i.test(decoded) ? decoded : '';
    } catch {
      return '';
    }
  }
  return '';
}

function classifyTVBoxSite(site = {}) {
  const name = String(site.name || '').trim();
  const key = String(site.key || '').trim();
  const api = String(site.api || '').trim();
  const ext = String(site.ext || '').trim();
  const text = `${name} ${key} ${api} ${ext}`;
  // TVBox 的 `sites` 通常是影视站点，但部分配置会把 Drpy/直播脚本
  // 混在 sites 中。只有出现明确的直播标记时才拆到 Live，避免误伤普通影视源。
  const explicitLive = /(直播|体育赛事|赛事直播|网红直播|310直播)/i.test(text)
    || /(?:直播|sports|justlive)\\.(?:js|py|json)(?:$|[?#])/i.test(text);
  return explicitLive ? 'live' : 'movie';
}

function classifyTVBoxCapability(site = {}) {
  const api = String(site.api || '').trim();
  const type = Number(site.type);
  const hasJar = site.jar != null && String(site.jar).trim() !== '';
  const hasExt = site.ext != null;
  const isDrpy = /^drpy(?:_js)?_/i.test(String(site.key || ''))
    || /(?:^|\/)drpy2(?:\.min)?\.js(?:$|[?#])/i.test(api);
  const isCsp = /^csp_/i.test(api);
  const isDirectVod = type === 1
    && /^https?:\/\//i.test(api)
    && /(?:api\.php\/)?provide\/vod(?:\/|\?|$)/i.test(api);

  if (isDirectVod) {
    return {
      sourceCapability: 'direct-http-vod',
      adapterType: 'http-vod',
      requiresJar: hasJar,
      kind: hasJar ? 'http-vod-with-jar' : 'http-vod',
    };
  }
  if (isDrpy) {
    return {
      sourceCapability: 'tvbox-drpy-js',
      adapterType: 'tvbox-extension',
      requiresJar: hasJar,
      kind: 'drpy-js',
    };
  }
  if (isCsp) {
    return {
      sourceCapability: 'tvbox-csp',
      adapterType: 'tvbox-extension',
      requiresJar: hasJar,
      kind: 'csp',
    };
  }
  if (hasJar) {
    return {
      sourceCapability: 'tvbox-jar',
      adapterType: 'tvbox-extension',
      requiresJar: true,
      kind: 'jar',
    };
  }
  if (hasExt) {
    return {
      sourceCapability: 'tvbox-ext',
      adapterType: 'tvbox-extension',
      requiresJar: false,
      kind: 'ext',
    };
  }
  return {
    sourceCapability: 'tvbox-extension',
    adapterType: 'tvbox-extension',
    requiresJar: false,
    kind: 'unknown',
  };
}

function classifyTVBoxExtFormat(site = {}) {
  const ext = site?.ext;
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    const serialized = JSON.stringify(ext);
    if (serialized.length <= 5 * 1024 * 1024
      && (Array.isArray(ext.movies) || Array.isArray(ext.vod) || Array.isArray(ext.list)
        || Array.isArray(ext.data) || Array.isArray(ext.result)
        || Array.isArray(ext.data?.list) || Array.isArray(ext.result?.list))) return 'json-vod';
    return 'config-object';
  }
  if (typeof ext !== 'string') return 'unknown';
  const value = ext.trim();
  if (/^https?:\/\//i.test(value)) {
    if (/\.json(?:[?#].*)?$/i.test(value)) return 'remote-json';
    if (/\.(?:js|mjs)(?:[?#].*)?$/i.test(value)) return 'javascript';
    if (/\.py(?:[?#].*)?$/i.test(value)) return 'python';
    return 'remote-resource';
  }
  if (value.startsWith('{') || value.startsWith('[')) return 'inline-json';
  if (/^(?:[A-Za-z0-9+/=_-]{24,})$/.test(value)) return 'opaque-string';
  return 'inline-script';
}

function isSafeTVBoxExtJson(site = {}) {
  const ext = site?.ext;
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    const serialized = JSON.stringify(ext);
    return serialized.length <= 5 * 1024 * 1024
      && (Array.isArray(ext.movies) || Array.isArray(ext.vod) || Array.isArray(ext.list)
        || Array.isArray(ext.data) || Array.isArray(ext.result)
        || Array.isArray(ext.data?.list) || Array.isArray(ext.result?.list));
  }
  if (typeof ext !== 'string') return false;
  const value = ext.trim();
  if (/^https?:\/\//i.test(value)) return /\.json(?:[?#].*)?$/i.test(value);
  return (value.startsWith('{') || value.startsWith('[')) && value.length <= 5 * 1024 * 1024;
}

function isDirectMovieEndpoint(api, site = {}) {
  return classifyTVBoxCapability({ ...site, api }).sourceCapability === 'direct-http-vod';
}

function normalizeTVBoxParseConfig(parsed = {}) {
  const parses = Array.isArray(parsed?.parses) ? parsed.parses
    .filter(item => item && typeof item === 'object')
    .map((item, index) => ({
      id: String(item.name || `parse-${index + 1}`).trim(),
      name: String(item.name || `解析-${index + 1}`).trim(),
      type: Number.isFinite(Number(item.type)) ? Number(item.type) : 0,
      url: String(item.url || '').trim(),
      ext: item.ext && typeof item.ext === 'object' ? {
        flag: Array.isArray(item.ext.flag) ? item.ext.flag.map(value => String(value).trim()).filter(Boolean) : [],
        header: item.ext.header && typeof item.ext.header === 'object' ? { ...item.ext.header } : {},
      } : {},
    }))
    .filter(item => item.url || item.id)
    : [];

  const flags = Array.isArray(parsed?.flags)
    ? [...new Set(parsed.flags.map(value => String(value).replace(/\\r?\\n/g, '').trim()).filter(Boolean))]
    : [];

  const rules = Array.isArray(parsed?.rules) ? parsed.rules
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      host: String(item.host || '').trim(),
      rule: Array.isArray(item.rule) ? item.rule.map(value => String(value).trim()).filter(Boolean) : [],
      filter: Array.isArray(item.filter) ? item.filter.map(value => String(value).trim()).filter(Boolean) : [],
    }))
    .filter(item => item.host || item.rule.length)
    : [];

  const ads = Array.isArray(parsed?.ads)
    ? parsed.ads.map(value => String(value).trim()).filter(Boolean)
    : [];

  const doh = Array.isArray(parsed?.doh) ? parsed.doh
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      name: String(item.name || '').trim(),
      url: String(item.url || '').trim(),
      hosts: Array.isArray(item.hosts) ? item.hosts.map(value => String(value).trim()).filter(Boolean) : [],
      ips: Array.isArray(item.ips) ? item.ips.map(value => String(value).trim()).filter(Boolean) : [],
      regex: Array.isArray(item.regex) ? item.regex.map(value => String(value).trim()).filter(Boolean) : [],
    }))
    .filter(item => item.name || item.url || item.hosts.length)
    : [];

  return { parses, flags, rules, ads, doh };
}

function normalizeTVBoxIJKProfiles(value) {
  if (!Array.isArray(value)) return {};
  const profiles = {};
  value.forEach((profile) => {
    const group = String(profile?.group || '').trim();
    if (!group) return;
    const options = Array.isArray(profile?.options) ? profile.options.map((option) => ({
      category: Number(option?.category),
      name: String(option?.name || '').trim(),
      value: option?.value == null ? '' : String(option.value),
    })).filter(option =>
      Number.isInteger(option.category)
      && option.category >= 1
      && option.category <= 4
      && option.name
      && option.value !== ''
    ) : [];
    if (options.length) profiles[group] = options;
  });
  return profiles;
}

function parseTVBoxSources(parsed, { bundleId = null } = {}) {
  const imported = [];
  const tvboxParseConfig = normalizeTVBoxParseConfig(parsed);
  const resolvedBundleId = bundleId || `bundle_tvbox_${stableHash(JSON.stringify(parsed))}`;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return imported;

  if (Array.isArray(parsed.sites)) {
    parsed.sites.forEach((site, index) => {
      if (!site || typeof site !== 'object') return;

      const api = String(site.api || '').trim();
      const sourceType = classifyTVBoxSite(site);
      const capability = classifyTVBoxCapability(site);
      const directMovie = capability.sourceCapability === 'direct-http-vod';
      const extFormat = capability.kind === 'ext' ? classifyTVBoxExtFormat(site) : null;
      const safeExtJson = sourceType === 'movie' && capability.kind === 'ext' && isSafeTVBoxExtJson(site);
      const isSupportedDirect = sourceType === 'movie' && directMovie;
      const isSupportedJar = sourceType === 'movie' && capability.requiresJar === true;
      const isTVBoxLiveProvider = sourceType === 'live' && capability.adapterType === 'tvbox-extension';
      const adapterType = isTVBoxLiveProvider ? 'tvbox-live-extension' : capability.adapterType;

      const sourceId = `tvbox_${sourceType}_${stableHash(`${resolvedBundleId}|${sourceType}|${site.key || api || index}`)}`;
      const name = String(site.name || site.key || `TVBox${sourceType === 'live' ? '直播' : '影视'}-${index + 1}`).trim();

      imported.push({
        sourceId,
        bundleId: resolvedBundleId,
        sourceKey: `${sourceType}|${site.key || api || index}`,
        name,
        sourceType,
        sourceRef: isTVBoxLiveProvider ? '' : api,
        url: isTVBoxLiveProvider ? '' : api,
        // “导入”与“当前运行时是否支持”必须分离：
        // 导入后所有合法 site 都保留并默认启用；真正请求时由 movieSourceService
        // 再依据 sourceCapability/adapterType 判断是否存在可执行适配器。
        enabled: true,
        status: isSupportedDirect || safeExtJson || isSupportedJar ? '未测试' : '待适配',
        runtimeSupported: isSupportedDirect || safeExtJson || isSupportedJar,
        sourceCapability: isTVBoxLiveProvider ? 'tvbox-live-provider' : capability.sourceCapability,
        adapterType,
        tvboxAdapterKind: capability.kind,
        ...(extFormat ? { tvboxExtFormat: extFormat } : {}),
        tvboxRequiresJar: capability.requiresJar === true,
        tvboxType: Number.isFinite(Number(site.type)) ? Number(site.type) : null,
        tvboxKey: String(site.key || '').trim(),
        // TVBox 直连源经常自带 categories；保留它作为零额外网络请求的分类索引。
        ...(Array.isArray(site.categories) ? { categories: site.categories } : (typeof site.categories === 'string' && site.categories.trim() ? { categories: site.categories.split(/[,，#|]/).map(value => value.trim()).filter(Boolean) } : {})),
        tvboxApi: api,
        tvboxDefinition: { ...site },
        ...(Object.keys(normalizeTVBoxIJKProfiles(parsed.ijk)).length
          ? { tvboxIJKProfiles: normalizeTVBoxIJKProfiles(parsed.ijk) }
          : {}),
        ...(tvboxParseConfig.parses.length || tvboxParseConfig.flags.length || tvboxParseConfig.rules.length || tvboxParseConfig.ads.length || tvboxParseConfig.doh.length
          ? { tvboxParseConfig }
          : {}),
        ...(isTVBoxLiveProvider ? { tvboxLiveProvider: true } : {}),
        tvboxUnsupportedReason: isSupportedDirect || safeExtJson || isSupportedJar ? null : (
          isTVBoxLiveProvider ? 'TVBox Live Provider 当前未适配执行器' :
          !api ? '缺少 api' :
            capability.requiresJar ? '该源依赖 JAR 扩展，已进入 CatVod Spider 执行阶段；首次请求时自动准备并校验 JAR' :
            capability.kind === 'drpy-js' ? 'Drpy JS 源当前未适配执行器'
            : capability.kind === 'csp' ? 'CSP 源当前未适配执行器'
            : capability.kind === 'jar' || capability.kind === 'http-vod-with-jar' ? '该源依赖 JAR 扩展，已进入 CatVod Spider 执行阶段；首次请求时自动准备并校验 JAR'
             : capability.kind === 'ext' ? `该源依赖 ext（${extFormat || 'unknown'}）扩展配置，当前未适配`
            : '当前源不是标准可直接请求的 VOD HTTP 接口'
        ),
        ...(site.jar != null ? { tvboxJar: site.jar } : {}),
        ...(site.ext != null ? { tvboxExt: site.ext } : {}),
        createdAt: Date.now(),
      });
    });
  }

  if (Array.isArray(parsed.lives)) {
    parsed.lives.forEach((live, index) => {
      const liveName = String(live?.name || `TVBox直播-${index + 1}`).trim();
      const candidates = [];
      const addLiveRef = (value) => {
        const sourceRef = resolveLiveSourceRef(value);
        if (sourceRef) candidates.push(sourceRef);
      };
      addLiveRef(live?.url);
      if (Array.isArray(live?.urls)) live.urls.forEach(addLiveRef);
      if (Array.isArray(live?.channels)) {
        live.channels.forEach(channel => {
          if (Array.isArray(channel?.urls)) channel.urls.forEach(addLiveRef);
          addLiveRef(channel?.url);
        });
      }
      [...new Set(candidates)].forEach((sourceRef, refIndex) => {
        imported.push({
          sourceId: `tvbox_live_${stableHash(`${resolvedBundleId}|live|${live.key || live.name || index}|${sourceRef}`)}`,
          bundleId: resolvedBundleId,
          sourceKey: `live|${live.key || live.name || index}|${sourceRef}`,
          name: candidates.length > 1 ? `${liveName} · 线路 ${refIndex + 1}` : liveName,
          sourceType: 'live',
          sourceRef,
          url: sourceRef,
          liveMode: /\.txt(?:[?#]|$)/i.test(sourceRef) ? 'tv1' : 'generic',
          enabled: true,
          status: '未测试',
          sourceCapability: 'direct-live',
          adapterType: 'live-reference',
          tvboxIJKProfiles: normalizeTVBoxIJKProfiles(parsed.ijk),
          tvboxParseConfig,
          createdAt: Date.now(),
        });
      });
    });
  }
  return imported;
}

export const DEFAULT_PRESET_SOURCES = Object.freeze([
  {
    sourceId: 'source_hhzy_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|豪华资源|4k',
    name: '🎥┃豪华┃资源',
    sourceType: 'movie',
    sourceRef: 'https://hhzyapi.com/api.php/provide/vod/?ac=list',
    url: 'https://hhzyapi.com/api.php/provide/vod/?ac=list',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    categories: ['内地剧','香港剧','欧美剧','韩剧','日剧','马泰剧','台湾剧','动画片','中国动漫','日本动漫','欧美动漫','剧情片','战争片','动作片','科幻片','记录片','爱情片','喜剧片','灾难片','悬疑片','犯罪片','大陆综艺','日韩综艺','港台综艺','欧美综艺'],
    createdAt: 1710000000000,
  },
  {
    sourceId: 'source_lzzy_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|量子资源|4k',
    name: '🎥┃量子┃资源',
    sourceType: 'movie',
    sourceRef: 'https://cj.lziapi.com/api.php/provide/vod/',
    url: 'https://cj.lziapi.com/api.php/provide/vod/',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    categories: ['国产动漫','日韩动漫','大陆剧','欧美剧','韩剧','日剧','动作片','喜剧片','爱情片','科幻片','恐怖片','剧情片','战争片'],
    createdAt: 1710000000001,
  },
  {
    sourceId: 'source_gszy_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|光速资源|4k',
    name: '🎥┃光速┃资源',
    sourceType: 'movie',
    sourceRef: 'https://api.guangsuapi.com/api.php/provide/vod/',
    url: 'https://api.guangsuapi.com/api.php/provide/vod/',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    categories: ['欧美剧','韩剧','日剧','动作片','喜剧片','爱情片','科幻片','恐怖片','剧情片','战争片'],
    createdAt: 1710000000002,
  },
  {
    sourceId: 'source_snzy_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|索尼资源|4k',
    name: '🎥┃索尼┃资源',
    sourceType: 'movie',
    sourceRef: 'https://suoniapi.com/api.php/provide/vod/',
    url: 'https://suoniapi.com/api.php/provide/vod/',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    categories: ['欧美剧','韩剧','日剧','动作片','喜剧片','爱情片','科幻片','恐怖片','剧情片','战争片','现代都市','古装仙侠'],
    createdAt: 1710000000003,
  },
  {
    sourceId: 'source_ikun_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|爱坤资源|4k',
    name: '🐓┃爱坤┃资源',
    sourceType: 'movie',
    sourceRef: 'https://ikunzyapi.com/api.php/provide/vod',
    url: 'https://ikunzyapi.com/api.php/provide/vod',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    categories: ['欧美剧','韩剧','日剧','动作片','喜剧片','爱情片','科幻片','恐怖片','剧情片','战争片'],
    createdAt: 1710000000004,
  },
  {
    sourceId: 'source_xiongzhang_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|熊掌高清|4k',
    name: '🐻┃熊掌┃高清',
    sourceType: 'movie',
    sourceRef: 'https://xzcjz.com/api.php/provide/vod',
    url: 'https://xzcjz.com/api.php/provide/vod',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    createdAt: 1710000000005,
  },
  {
    sourceId: 'source_hongniu_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|红牛资源|4k',
    name: '🎥┃红牛┃资源',
    sourceType: 'movie',
    sourceRef: 'https://www.hongniuzy2.com/api.php/provide/vod/',
    url: 'https://www.hongniuzy2.com/api.php/provide/vod/',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    categories: ['欧美剧','韩剧','日剧','动作片','喜剧片','爱情片','科幻片','恐怖片','剧情片','战争片'],
    createdAt: 1710000000006,
  },
  {
    sourceId: 'source_chulian_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'movie|初恋资源|4k',
    name: '🧡┃初恋┃官源',
    sourceType: 'movie',
    sourceRef: 'https://video.adminqt.cn/api.php/provide/vod/',
    url: 'https://video.adminqt.cn/api.php/provide/vod/',
    sourceCapability: 'direct-http-vod',
    adapterType: 'http-vod',
    tvboxAdapterKind: 'http-vod',
    enabled: true,
    status: '未测试',
    createdAt: 1710000000007,
  },
  {
    sourceId: 'source_live_zh_4k',
    bundleId: 'bundle_preset_4k',
    sourceKey: 'live|综合直播|4k',
    name: '📺┃央视卫视┃综合直播',
    sourceType: 'live',
    sourceRef: 'http://xhztv.top/njyy.txt',
    url: 'http://xhztv.top/njyy.txt',
    enabled: true,
    status: '未测试',
    liveMode: 'tv1',
    createdAt: 1710000000008,
  }
]);

export const sourceConfigService = {
  read() {
    if (storage.has('sources')) {
      return sourceRepository.getAll();
    }
    sourceRepository.saveAll(DEFAULT_PRESET_SOURCES);
    return sourceRepository.getAll();
  },

  createAdapters(options = {}) {
    return createSourceAdapters(this.read(), options);
  },

  normalize(sources) {
    return sourceRepository.saveAll(validateImportedSources(sources)) || sourceRepository.getAll();
  },

  async parseText(text, { fileName = 'source' } = {}) {
    const rawText = String(text ?? '');
    const trimmed = rawText.replace(/^\uFEFF/, '').trim();
    if (!trimmed) throw new Error('SOURCE_IMPORT_EMPTY');

    const safeFileName = String(fileName || 'source').trim() || 'source';
    const lowerName = safeFileName.toLowerCase();
    const bundleId = createBundleId(safeFileName, rawText);

    if (lowerName.endsWith('.txt') || lowerName.endsWith('.m3u') || /#genre#/i.test(trimmed) || /^#EXTM3U/i.test(trimmed)) {
      return [createLocalSource({
        name: safeFileName.replace(/\.[^.]+$/, '') || '本地直播源',
        sourceType: 'live',
        text: rawText,
        format: lowerName.endsWith('.m3u') || /^#EXTM3U/i.test(trimmed) ? 'm3u' : 'txt',
        liveMode: /#genre#/i.test(trimmed) ? 'tv1' : 'generic',
        bundleId,
      })];
    }

    let parsed;
    try {
      parsed = parseRelaxedJSON(rawText);
    } catch (error) {
      throw new Error(`SOURCE_IMPORT_JSON_INVALID:${error?.message || 'parse failed'}`);
    }

    const tvboxSources = parseTVBoxSources(parsed, { bundleId });
    if (tvboxSources.length) return tvboxSources;

    if (Array.isArray(parsed)) {
      return [createLocalSource({
        name: safeFileName.replace(/\.[^.]+$/, '') || '本地影视源',
        sourceType: 'movie',
        text: rawText,
        format: 'json',
        bundleId,
      })];
    }

    throw new Error('SOURCE_IMPORT_TVBOX_EMPTY');
  },

  async parseLocalFile(file) {
    if (!file || typeof file.text !== 'function') throw new Error('SOURCE_IMPORT_FILE_REQUIRED');
    const text = await file.text();
    return this.parseText(text, { fileName: file.name || 'source' });
  },

  async importFile(file) {
    const parsedSources = await this.parseLocalFile(file);
    const currentSources = this.read();
    const importedBundleIds = new Set(parsedSources.map(source => source.bundleId).filter(Boolean));
    const replacedSources = currentSources.filter(source => importedBundleIds.has(source.bundleId));
    const previousById = new Map(replacedSources.map(source => [source.sourceId, source]));
    const normalizedImportedSources = parsedSources.map(source => {
      const previous = previousById.get(source.sourceId);
      if (!previous) return source;
      return {
        ...source,
        // 重新导入同一个 bundle 时，只更新源定义，不覆盖运行时状态。
        // 特别是 TXT 源可能已经在首次探测后被提升为 tv1；再次导入不能把它降回 generic。
        enabled: previous.enabled !== false,
        isActive: previous.isActive === true,
        ...(previous.liveMode ? { liveMode: previous.liveMode } : {}),
        ...(previous.status ? { status: previous.status } : {}),
        ...(previous.lastCheckedAt ? { lastCheckedAt: previous.lastCheckedAt } : {}),
        ...(previous.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}),
        ...(Array.isArray(previous.capabilities) ? { capabilities: previous.capabilities } : {}),
        createdAt: previous.createdAt || source.createdAt,
      };
    });
    const importedIdentities = new Set(
      normalizedImportedSources.map(source => `${source.sourceType}|${source.sourceRef || source.url || ''}`),
    );
    const retainedSources = currentSources.filter(source => {
      if (importedBundleIds.has(source.bundleId)) return false;
      const identity = `${source.sourceType}|${source.sourceRef || source.url || ''}`;
      return !importedIdentities.has(identity);
    });
    const nextSources = [...retainedSources, ...normalizedImportedSources];
    sourceRepository.saveAll(nextSources);
    return nextSources;
  },

  async readFileAsDataURL(file) {
    if (!file || typeof file.text !== 'function') throw new Error('SOURCE_IMPORT_FILE_REQUIRED');
    const text = await file.text();
    return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  },

  exportText(sources) {
    if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
      return JSON.stringify(sources, null, 2);
    }
    return JSON.stringify(Array.isArray(sources) ? sources : sourceRepository.getAll(), null, 2);
  },

  getDefaultSources() {
    return DEFAULT_PRESET_SOURCES;
  },

  download(sources, filename = 'tvbox-sources.json') {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') throw new Error('SOURCE_EXPORT_BROWSER_REQUIRED');
    const blob = new Blob([this.exportText(sources)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};

// Source runtime orchestration and selected-source management
export const sourceManagementService = {
  async clearAll() {
    try { sourceRepository.saveAll([]); } catch (e) { console.error('Clear sources repository error:', e); }
    try { userDataService.saveSelectedSources({ movie: null, live: null }); } catch (e) {}
    try {
      const settings = userDataService.getSnapshot().settings || {};
      if (settings.defaultMovieSource || settings.defaultLiveSource) {
        userDataService.updateSettings({ defaultMovieSource: null, defaultLiveSource: null });
      }
    } catch (e) {}
    try { tv1LiveService.clear(); } catch (e) {}
    try { sourceRegistryService.clear(); } catch (e) {}
    try { liveService.clearRuntimeCache(); } catch (e) {}
    try { cacheService.clearAll(); } catch (e) {}
    return this.reload();
  },
  async reload(options = {}) {
    const snapshot = userDataService.getSnapshot();
    const selected = snapshot.selectedSources ?? {};
    const settings = snapshot.settings ?? {};
    return syncAllSources({
      ...options,
      movieSourceId: options.movieSourceId ?? selected.movie ?? settings.defaultMovieSource ?? null,
    });
  },
  async reloadMovieSource(sourceId = null) {
    const snapshot = userDataService.getSnapshot();
    const selected = sourceId ?? snapshot.selectedSources?.movie ?? snapshot.settings?.defaultMovieSource ?? null;
    return syncAllSources({ movieSourceId: selected, includeMovie: true, includeLive: false });
  },
  async save(sources) {
    sourceRepository.saveAll(sources);
    const saved = sourceRepository.getAll();
    const snapshot = userDataService.getSnapshot();
    const selected = snapshot.selectedSources ?? {};
    const settings = snapshot.settings ?? {};
    for (const type of ['movie', 'live']) {
      const selectedId = selected[type] ?? null;
      const defaultKey = type === 'movie' ? 'defaultMovieSource' : 'defaultLiveSource';
      const defaultId = settings[defaultKey] ?? null;
      if (selectedId && !saved.some(item => item.sourceType === type && item.sourceId === selectedId && item.enabled !== false)) {
        userDataService.clearSelectedSource(type, selectedId);
      }
      if (defaultId && !saved.some(item => item.sourceType === type && item.sourceId === defaultId && item.enabled !== false)) {
        userDataService.updateSettings({ [defaultKey]: null });
      }
    }
    return this.reload();
  },
  async setEnabled(sourceId, enabled) {
    const sources = sourceRepository.getAll();
    const source = sources.find(item => item.sourceId === sourceId);
    if (!source) return this.reload();
    if (!enabled) {
      userDataService.clearSelectedSource(source.sourceType, sourceId);
      const defaultKey = source.sourceType === 'live' ? 'defaultLiveSource' : 'defaultMovieSource';
      if (userDataService.getSettings()?.[defaultKey] === sourceId) {
        userDataService.updateSettings({ [defaultKey]: null });
      }
      if (source.sourceType === 'live' && source.liveMode === 'tv1') tv1LiveService.clear(sourceId);
    }
    sourceRepository.saveAll(sources.map(item => item.sourceId === sourceId ? { ...item, enabled: Boolean(enabled), isActive: enabled ? item.isActive : false } : item));
    return this.reload();
  },
  async setActive(sourceId) {
    const sources = sourceRepository.getAll();
    const source = sources.find(item => item.sourceId === sourceId);
    if (!source) return this.reload();
    const sourceType = source.sourceType || 'movie';
    userDataService.setSelectedSource(sourceType, sourceId);
    userDataService.updateSettings({
      [sourceType === 'live' ? 'defaultLiveSource' : 'defaultMovieSource']: sourceId,
    });
    const now = Date.now();
    sourceRepository.saveAll(sources.map(item => ({
      ...item,
      isActive: item.sourceType === sourceType ? item.sourceId === sourceId : item.isActive,
      enabled: item.sourceId === sourceId ? true : item.enabled,
      lastUsedAt: item.sourceId === sourceId ? now : item.lastUsedAt ?? null,
    })));
    return sourceRepository.getAll();
  },
  async remove(sourceId) {
    const sources = sourceRepository.getAll();
    const source = sources.find(item => item.sourceId === sourceId);
    if (source) {
      if (source.sourceType === 'live' && source.liveMode === 'tv1') tv1LiveService.clear(sourceId);
      const selected = userDataService.getSnapshot().selectedSources;
      if (selected[source.sourceType] === sourceId) userDataService.clearSelectedSource(source.sourceType, sourceId);
      const defaultKey = source.sourceType === 'live' ? 'defaultLiveSource' : 'defaultMovieSource';
      if (userDataService.getSettings()?.[defaultKey] === sourceId) {
        userDataService.updateSettings({ [defaultKey]: null });
      }
    }
    sourceRepository.saveAll(sources.filter(item => item.sourceId !== sourceId));
    return this.reload();
  },
  updateStatus(sourceId, status) {
    const sources = sourceRepository.getAll();
    sourceRepository.saveAll(sources.map(item => item.sourceId === sourceId ? { ...item, status } : item));
  },
  touchUsage(sourceId) {
    if (!sourceId) return;
    const sources = sourceRepository.getAll();
    const now = Date.now();
    sourceRepository.saveAll(sources.map(item => item.sourceId === sourceId ? { ...item, lastUsedAt: now } : item));
  },
  test: testSource,
};
