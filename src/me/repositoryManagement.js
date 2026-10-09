import { toPunycodeUrl } from '../core__utils__punycode.js';
import { requestAdapter } from '../core__services__network__requestAdapter.js';
import { storage } from '../core__storage__storage.js';
import { sourceRepository } from '../core__repositories__sourceRepository.js';

// TVBox multi-repository aggregation engine
/**
 * TVBox Multi-Repo Aggregator Engine
 * Aggregates multiple TVBox single-repo configs into a unified single repository:
 * - Deduplicates and merges 'sites' by key; prefixes conflicting keys with repo name
 * - Deduplicates and merges 'lives' channels and stream URLs
 * - Merges and deduplicates 'parses' (resolvers)
 * - Merges and deduplicates 'flags', 'rules', 'ads', and 'doh'
 */

export function aggregateRepos(repos = [], options = {}) {
  const aggregatedSites = [];
  const siteKeySet = new Set();
  const siteIdentitySet = new Set(); // To detect true duplicates (api + type + ext)

  const livesMap = new Map(); // name -> live entry
  const parsesMap = new Map(); // id/url -> parse entry
  const flagSet = new Set();
  const ruleMap = new Map(); // host -> rule entry
  const adSet = new Set();
  const dohMap = new Map();

  const activeRepos = Array.isArray(repos)
    ? repos.filter(r => r && r.config && typeof r.config === 'object')
    : [];

  activeRepos.forEach((repo) => {
    const repoName = String(repo.name || '仓源').trim();
    const config = repo.config || {};

    // 1. Sites aggregation with smart key prefixing
    if (Array.isArray(config.sites)) {
      config.sites.forEach((site, sIdx) => {
        if (!site || typeof site !== 'object') return;
        const rawKey = String(site.key || `site_${sIdx + 1}`).trim();
        const rawName = String(site.name || rawKey).trim();
        const api = String(site.api || '').trim();
        const type = site.type;
        const ext = typeof site.ext === 'object' ? JSON.stringify(site.ext) : String(site.ext || '');

        const identity = `${api}|${type}|${ext}`;
        // If exact same API endpoint and ext already exists across repos, skip duplicate
        if (api && siteIdentitySet.has(identity)) {
          return;
        }

        let finalKey = rawKey;
        let finalName = rawName;

        if (siteKeySet.has(rawKey)) {
          // Key collision! Automatically prefix with source repository name
          finalKey = `${repoName}_${rawKey}`;
          finalName = `[${repoName}] ${rawName}`;
          // In case the prefixed key also collides
          if (siteKeySet.has(finalKey)) {
            finalKey = `${finalKey}_${sIdx + 1}`;
          }
        }

        siteKeySet.add(finalKey);
        if (api) siteIdentitySet.add(identity);

        aggregatedSites.push({
          ...site,
          key: finalKey,
          name: finalName,
          _originRepo: repoName,
          _originalKey: rawKey,
        });
      });
    }

    // 2. Lives aggregation
    if (Array.isArray(config.lives)) {
      config.lives.forEach((live, lIdx) => {
        if (!live || typeof live !== 'object') return;
        const liveName = String(live.name || `直播源-${lIdx + 1}`).trim();
        const liveKey = String(live.key || liveName).trim();

        // Extract all candidate stream URLs
        const urls = [];
        if (live.url) urls.push(live.url);
        if (Array.isArray(live.urls)) live.urls.forEach(u => urls.push(u));

        if (livesMap.has(liveKey)) {
          // Merge stream URLs without duplicates
          const existing = livesMap.get(liveKey);
          const mergedUrls = [...new Set([...(existing.urls || (existing.url ? [existing.url] : [])), ...urls])];
          existing.urls = mergedUrls;
        } else {
          livesMap.set(liveKey, {
            ...live,
            name: liveName,
            urls: [...new Set(urls)],
            _originRepo: repoName,
          });
        }
      });
    }

    // 3. Parses (Resolvers) aggregation
    if (Array.isArray(config.parses)) {
      config.parses.forEach((parse, pIdx) => {
        if (!parse || typeof parse !== 'object') return;
        const parseUrl = String(parse.url || '').trim();
        const parseName = String(parse.name || `解析-${pIdx + 1}`).trim();
        const parseId = parseUrl || parseName;

        if (!parsesMap.has(parseId)) {
          parsesMap.set(parseId, {
            ...parse,
            name: parseName,
            url: parseUrl,
            _originRepo: repoName,
          });
        }
      });
    }

    // 4. Flags aggregation
    if (Array.isArray(config.flags)) {
      config.flags.forEach(f => {
        const flagStr = String(f || '').trim();
        if (flagStr) flagSet.add(flagStr);
      });
    }

    // 5. Rules aggregation
    if (Array.isArray(config.rules)) {
      config.rules.forEach(rule => {
        if (!rule || typeof rule !== 'object') return;
        const host = String(rule.host || '').trim();
        if (host && !ruleMap.has(host)) {
          ruleMap.set(host, rule);
        }
      });
    }

    // 6. Ads filtering rules
    if (Array.isArray(config.ads)) {
      config.ads.forEach(ad => {
        const adStr = String(ad || '').trim();
        if (adStr) adSet.add(adStr);
      });
    }

    // 7. DoH aggregation
    if (Array.isArray(config.doh)) {
      config.doh.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const dohUrl = String(item.url || item.name || '').trim();
        if (dohUrl && !dohMap.has(dohUrl)) {
          dohMap.set(dohUrl, item);
        }
      });
    }
  });

  const aggregatedLives = Array.from(livesMap.values());
  const aggregatedParses = Array.from(parsesMap.values());
  const aggregatedFlags = Array.from(flagSet);
  const aggregatedRules = Array.from(ruleMap.values());
  const aggregatedAds = Array.from(adSet);
  const aggregatedDoh = Array.from(dohMap.values());

  return {
    sites: aggregatedSites,
    lives: aggregatedLives,
    parses: aggregatedParses,
    flags: aggregatedFlags,
    rules: aggregatedRules,
    ads: aggregatedAds,
    doh: aggregatedDoh,
    meta: {
      aggregatedAt: Date.now(),
      repoCount: activeRepos.length,
      siteCount: aggregatedSites.length,
      liveCount: aggregatedLives.length,
      parseCount: aggregatedParses.length,
      sourceRepoNames: activeRepos.map(r => r.name),
    },
  };
}

// Robust repository configuration fetcher and parsers
/**
 * Concise User-Agent string to avoid anti-scraping challenges
 * Many TVBox CMS/JSON endpoints check User-Agent and block full browser signatures.
 */
export const CONCISE_USER_AGENT = 'okhttp/3.15';

/**
 * Strips single-line (//) and multi-line block (/* ... * /) comments from raw JSON strings
 */
export function stripJSONComments(str) {
  if (!str) return '';
  let out = '';
  let inString = false;
  let i = 0;
  const len = str.length;
  while (i < len) {
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
      i += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
    } else if (char === '/' && nextChar === '/') {
      i += 2;
      while (i < len && str[i] !== '\n' && str[i] !== '\r') i += 1;
    } else if (char === '/' && nextChar === '*') {
      i += 2;
      while (i < len && !(str[i] === '*' && str[i + 1] === '/')) i += 1;
      i += 2;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/**
 * Sanitizes unescaped control characters inside string literals (newlines, tabs, null bytes)
 */
export function sanitizeJSONControlChars(str) {
  if (!str) return '';
  let out = '';
  let inString = false;
  let i = 0;
  const len = str.length;
  while (i < len) {
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
      i += 1;
      continue;
    }
    if (char === '"') inString = true;
    out += char;
    i += 1;
  }
  return out;
}

/**
 * Strips trailing commas from object and array literals in JSON strings
 */
export function stripTrailingCommas(str) {
  if (!str) return '';
  let out = '';
  let inString = false;
  let i = 0;
  const len = str.length;
  while (i < len) {
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
      i += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
      continue;
    }
    if (char === ',') {
      let j = i + 1;
      while (j < len && /\s/.test(str[j])) j += 1;
      if (str[j] === '}' || str[j] === ']') {
        i += 1;
        continue;
      }
    }
    out += char;
    i += 1;
  }
  return out;
}

/**
 * Robust relaxed JSON parser for TVBox configuration files
 */
export function parseRobustTVBoxConfig(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('CONFIG_EMPTY_PAYLOAD');
  }
  let raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('CONFIG_EMPTY_PAYLOAD');

  // Handle Base64-encoded TVBox configuration payload
  if (/^([A-Za-z0-9+/=_-]{40,})$/.test(raw) || raw.startsWith('**')) {
    const candidate = raw.startsWith('**') ? raw.slice(2) : raw;
    try {
      const decoded = typeof atob === 'function' ? atob(candidate) : Buffer.from(candidate, 'base64').toString('utf-8');
      if (decoded && (decoded.includes('{') || decoded.includes('['))) {
        raw = decoded.trim();
      }
    } catch {}
  }

  const cleaned = stripTrailingCommas(sanitizeJSONControlChars(stripJSONComments(raw)));
  return JSON.parse(cleaned);
}

/**
 * Determines whether an error is transient (eligible for retry) or deterministic (skip retry)
 */
function isTransientError(error, status) {
  // If HTTP status code is 4xx or 5xx, this is a deterministic server response -> DO NOT RETRY
  if (status && status >= 400) {
    return false;
  }

  const msg = String(error?.message || error || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  // Known transient errors
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('empty_response') ||
    name === 'aborterror' ||
    name === 'timeouterror' ||
    code === 'timeout'
  ) {
    return true;
  }

  return false;
}

/**
 * Sleep helper for backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch a single URL with Punycode conversion, concise UA, and Smart Retry
 */
export async function fetchWithSmartRetry(rawUrl, options = {}) {
  const punycodeUrl = toPunycodeUrl(rawUrl);
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 2;
  const timeoutMs = options.timeoutMs || 6000;
  let lastError = null;
  let lastStatus = 0;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    attempts += 1;
    const startTime = Date.now();
    try {
      const res = await requestAdapter.request(punycodeUrl, {
        headers: {
          'User-Agent': CONCISE_USER_AGENT,
          'Accept': 'application/json, text/plain, */*',
          ...(options.headers || {}),
        },
        timeoutMs,
        signal: options.signal,
      });

      const durationMs = Date.now() - startTime;
      lastStatus = res?.status || 200;

      if (!res.ok) {
        // Deterministic HTTP error (4xx / 5xx)
        const error = new Error(`HTTP_${lastStatus}`);
        error.status = lastStatus;
        error.durationMs = durationMs;
        // Do not retry 4xx/5xx - immediately throw to return / fallback
        throw error;
      }

      const bodyText = await res.text();
      if (!bodyText || !bodyText.trim()) {
        const emptyError = new Error('EMPTY_RESPONSE');
        emptyError.status = 200;
        emptyError.durationMs = durationMs;
        throw emptyError;
      }

      return {
        ok: true,
        text: bodyText,
        status: lastStatus,
        durationMs,
        punycodeUrl,
        attempts,
      };
    } catch (err) {
      lastError = err;
      const status = err?.status || lastStatus;
      const transient = isTransientError(err, status);

      // If NOT transient (e.g. 4xx/5xx deterministic failure), do not retry! Directly break and fail
      if (!transient || attempt >= maxRetries) {
        break;
      }

      // Backoff delay: 300ms, 600ms
      const backoff = (attempt + 1) * 300;
      await sleep(backoff);
    }
  }

  return {
    ok: false,
    text: null,
    status: lastStatus,
    error: lastError?.message || 'FETCH_FAILED',
    punycodeUrl,
    attempts,
  };
}

/**
 * Fetches a multi-repo config item with multi-address fallback
 * Tries primaryUrl first, then backupUrls in order
 */
export async function fetchRepoWithFallback(repo, options = {}) {
  const primary = String(repo.primaryUrl || repo.url || '').trim();
  const backups = Array.isArray(repo.backupUrls)
    ? repo.backupUrls.map(u => String(u || '').trim()).filter(Boolean)
    : [];

  const addressQueue = [...new Set([primary, ...backups].filter(Boolean))];
  if (!addressQueue.length) {
    return {
      ok: false,
      repoId: repo.id,
      name: repo.name,
      config: null,
      usedUrl: null,
      attempts: [],
      error: 'NO_VALID_URL',
    };
  }

  const attemptLogs = [];
  let successfulResult = null;

  for (let idx = 0; idx < addressQueue.length; idx += 1) {
    const candidateUrl = addressQueue[idx];
    const isPrimary = idx === 0;

    const result = await fetchWithSmartRetry(candidateUrl, options);
    attemptLogs.push({
      url: candidateUrl,
      punycodeUrl: result.punycodeUrl,
      isPrimary,
      ok: result.ok,
      status: result.status,
      durationMs: result.durationMs || 0,
      retryCount: Math.max(0, result.attempts - 1),
      error: result.error || null,
    });

    if (result.ok && result.text) {
      try {
        const parsed = parseRobustTVBoxConfig(result.text);
        successfulResult = {
          usedUrl: candidateUrl,
          punycodeUrl: result.punycodeUrl,
          durationMs: result.durationMs,
          config: parsed,
        };
        break; // Successfully fetched! No need to try remaining backup URLs
      } catch (parseError) {
        // JSON parsing failure on this URL
        attemptLogs[attemptLogs.length - 1].parseError = parseError.message;
        attemptLogs[attemptLogs.length - 1].ok = false;
      }
    }
  }

  if (successfulResult) {
    return {
      ok: true,
      repoId: repo.id,
      name: repo.name,
      usedUrl: successfulResult.usedUrl,
      punycodeUrl: successfulResult.punycodeUrl,
      durationMs: successfulResult.durationMs,
      config: successfulResult.config,
      attempts: attemptLogs,
    };
  }

  return {
    ok: false,
    repoId: repo.id,
    name: repo.name,
    usedUrl: null,
    config: null,
    attempts: attemptLogs,
    error: attemptLogs[attemptLogs.length - 1]?.error || 'ALL_ADDRESSES_FAILED',
  };
}

// Repository management service and import/export workflow
const STORAGE_KEY_MULTI_REPOS = 'multi_repos';
const STORAGE_KEY_LAST_AGGREGATED = 'last_aggregated_repo_config';

export const DEFAULT_PRESET_REPOS = Object.freeze([
  {
    id: 'repo_fty',
    name: '饭太硬',
    primaryUrl: 'http://饭太硬.com/tv',
    backupUrls: [
      'http://xn--sss604efuw.com/tv',
      'https://www.ftytv.com/tv',
      'https://ghfast.top/https://raw.githubusercontent.com/fantaiying/ext/master/tvbox.json',
    ],
    enabled: true,
    status: 'idle',
    siteCount: 0,
    liveCount: 0,
  },
  {
    id: 'repo_feimao',
    name: '肥猫',
    primaryUrl: 'http://肥猫.com/tv',
    backupUrls: [
      'http://xn--z7x900a.com/tv',
      'http://feedcat.top/tv',
    ],
    enabled: true,
    status: 'idle',
    siteCount: 0,
    liveCount: 0,
  },
  {
    id: 'repo_qiaoji',
    name: '巧技',
    primaryUrl: 'http://cdn.qiaoji8.com/tvbox.json',
    backupUrls: [
      'https://ghfast.top/https://raw.githubusercontent.com/qiaoji8/tvbox/master/tvbox.json',
    ],
    enabled: true,
    status: 'idle',
    siteCount: 0,
    liveCount: 0,
  },
  {
    id: 'repo_moyu',
    name: '摸鱼儿',
    primaryUrl: 'http://我不是.摸鱼儿.top',
    backupUrls: [
      'http://xn--654a.xn--2qux23c9zi.top',
      'https://ghfast.top/https://raw.githubusercontent.com/moyu/tvbox/master/tv.json',
    ],
    enabled: true,
    status: 'idle',
    siteCount: 0,
    liveCount: 0,
  },
  {
    id: 'repo_xiaopingguo',
    name: '小苹果',
    primaryUrl: 'https://agit.ai/pingguo/rec/raw/branch/master/tvbox.json',
    backupUrls: [
      'https://ghproxy.net/https://raw.githubusercontent.com/xiaopingguo/tvbox/master/apple.json',
    ],
    enabled: true,
    status: 'idle',
    siteCount: 0,
    liveCount: 0,
  },
]);

function initRepos() {
  if (typeof window === 'undefined') {
    return DEFAULT_PRESET_REPOS;
  }
  if (storage.has(STORAGE_KEY_MULTI_REPOS)) {
    const existing = storage.read(STORAGE_KEY_MULTI_REPOS, null);
    if (Array.isArray(existing) && existing.length > 0) {
      return existing;
    }
  }
  storage.write(STORAGE_KEY_MULTI_REPOS, DEFAULT_PRESET_REPOS);
  return DEFAULT_PRESET_REPOS;
}

export const multiRepoService = {
  getAll() {
    return initRepos();
  },

  getRepo(id) {
    const repos = this.getAll();
    return repos.find(r => r.id === id) || null;
  },

  saveAll(repos) {
    storage.write(STORAGE_KEY_MULTI_REPOS, repos);
    return repos;
  },

  addRepo({ name, primaryUrl, backupUrls = [] }) {
    const repos = this.getAll();
    const newRepo = {
      id: `repo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(name || '自定义多仓').trim(),
      primaryUrl: String(primaryUrl || '').trim(),
      backupUrls: Array.isArray(backupUrls) ? backupUrls.map(u => String(u).trim()).filter(Boolean) : [],
      enabled: true,
      status: 'idle',
      siteCount: 0,
      liveCount: 0,
      createdAt: Date.now(),
    };
    const next = [newRepo, ...repos];
    this.saveAll(next);
    return newRepo;
  },

  updateRepo(id, patch) {
    const repos = this.getAll();
    const next = repos.map(r => r.id === id ? { ...r, ...patch } : r);
    this.saveAll(next);
    return next.find(r => r.id === id);
  },

  removeRepo(id) {
    const repos = this.getAll();
    const next = repos.filter(r => r.id !== id);
    this.saveAll(next);
    return next;
  },

  toggleRepo(id, enabled) {
    return this.updateRepo(id, { enabled });
  },

  restoreDefaults() {
    this.saveAll(DEFAULT_PRESET_REPOS);
    return DEFAULT_PRESET_REPOS;
  },

  async syncRepo(id, options = {}) {
    const repo = this.getRepo(id);
    if (!repo) throw new Error('REPO_NOT_FOUND');

    this.updateRepo(id, { status: 'syncing', errorMessage: null });

    try {
      const result = await fetchRepoWithFallback(repo, options);
      if (result.ok && result.config) {
        const sites = Array.isArray(result.config.sites) ? result.config.sites : [];
        const lives = Array.isArray(result.config.lives) ? result.config.lives : [];
        const parses = Array.isArray(result.config.parses) ? result.config.parses : [];

        const updated = this.updateRepo(id, {
          status: 'success',
          lastSyncAt: Date.now(),
          durationMs: result.durationMs,
          usedUrl: result.usedUrl,
          punycodeUrl: result.punycodeUrl,
          siteCount: sites.length,
          liveCount: lives.length,
          parseCount: parses.length,
          config: result.config,
          attempts: result.attempts,
          errorMessage: null,
        });
        return { ok: true, repo: updated };
      }

      const updated = this.updateRepo(id, {
        status: 'error',
        lastSyncAt: Date.now(),
        attempts: result.attempts,
        errorMessage: result.error || '所有主/备用地址请求均失败',
      });
      return { ok: false, repo: updated, error: result.error };
    } catch (err) {
      const updated = this.updateRepo(id, {
        status: 'error',
        lastSyncAt: Date.now(),
        errorMessage: err?.message || '同步异常',
      });
      return { ok: false, repo: updated, error: err?.message };
    }
  },

  async syncAll(options = {}) {
    const repos = this.getAll().filter(r => r.enabled !== false);
    const results = [];
    for (const repo of repos) {
      // Synchronize each repository sequentially or with slight delay to avoid bursting
      const res = await this.syncRepo(repo.id, options);
      results.push(res);
    }
    return results;
  },

  aggregateSelected(selectedIds = null) {
    const allRepos = this.getAll();
    const targetRepos = Array.isArray(selectedIds) && selectedIds.length > 0
      ? allRepos.filter(r => selectedIds.includes(r.id) && r.config)
      : allRepos.filter(r => r.enabled !== false && r.config);

    const aggregated = aggregateRepos(targetRepos);
    storage.write(STORAGE_KEY_LAST_AGGREGATED, aggregated);
    return aggregated;
  },

  getLastAggregated() {
    return storage.read(STORAGE_KEY_LAST_AGGREGATED, null);
  },

  /**
   * Parses multi-repo URLs imported by user (supports TVBox standard `urls` JSON format or raw text lines)
   */
  parseMultiRepoText(text) {
    if (!text || typeof text !== 'string') return [];
    const trimmed = text.trim();
    if (!trimmed) return [];

    // Try JSON format {"urls": [{"url": "...", "name": "..."}, ...]}
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const obj = JSON.parse(trimmed);
        const list = Array.isArray(obj) ? obj : Array.isArray(obj.urls) ? obj.urls : [];
        if (list.length > 0) {
          return list.map((item, idx) => ({
            id: `repo_imported_${Date.now()}_${idx}`,
            name: String(item.name || `导入仓源-${idx + 1}`).trim(),
            primaryUrl: String(item.url || '').trim(),
            backupUrls: Array.isArray(item.backupUrls) ? item.backupUrls : [],
            enabled: true,
            status: 'idle',
            siteCount: 0,
            liveCount: 0,
          })).filter(r => r.primaryUrl);
        }
      } catch {}
    }

    // Line-separated text
    const lines = trimmed.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    const result = [];
    let current = null;

    lines.forEach((line, idx) => {
      // Format: name,url or name#url or http...
      if (line.includes(',') || line.includes('#')) {
        const [namePart, ...urlParts] = line.split(/[,#]/);
        const urlPart = urlParts.join('');
        if (/^https?:\/\//i.test(urlPart.trim())) {
          current = {
            id: `repo_line_${Date.now()}_${idx}`,
            name: namePart.trim() || `仓源-${idx + 1}`,
            primaryUrl: urlPart.trim(),
            backupUrls: [],
            enabled: true,
            status: 'idle',
            siteCount: 0,
            liveCount: 0,
          };
          result.push(current);
          return;
        }
      }

      if (/^https?:\/\//i.test(line)) {
        if (!current) {
          current = {
            id: `repo_line_${Date.now()}_${idx}`,
            name: `仓源-${result.length + 1}`,
            primaryUrl: line,
            backupUrls: [],
            enabled: true,
            status: 'idle',
            siteCount: 0,
            liveCount: 0,
          };
          result.push(current);
        } else {
          // If previous exists and next line is another URL, treat as backup URL
          current.backupUrls.push(line);
        }
      }
    });

    return result;
  },

  /**
   * Applies aggregated TVBox single-repo config to active application source repository
   */
  async applyAggregatedConfigToActiveSources(aggregatedConfig, { sourceConfigService }) {
    if (!aggregatedConfig || !Array.isArray(aggregatedConfig.sites)) {
      throw new Error('NO_VALID_AGGREGATED_CONFIG');
    }

    // Convert TVBox config into normalized system source models
    const parsedSources = sourceConfigService.parseText(
      JSON.stringify(aggregatedConfig),
      { fileName: '聚合单仓.json' }
    );

    const currentSources = sourceRepository.getAll();
    const aggregatedBundleId = 'bundle_tvbox_aggregated_single';

    // Remove any previous aggregated bundle sources
    const retainedSources = currentSources.filter(s => s.bundleId !== aggregatedBundleId);

    // Mark all newly imported aggregated sources with the bundle ID
    const sourcesToInsert = (await parsedSources).map(s => ({
      ...s,
      bundleId: aggregatedBundleId,
      isAggregatedSingleRepo: true,
    }));

    const finalSources = [...retainedSources, ...sourcesToInsert];
    sourceRepository.saveAll(finalSources);
    return {
      sources: finalSources,
      addedCount: sourcesToInsert.length,
      siteCount: aggregatedConfig.sites.length,
      liveCount: (aggregatedConfig.lives || []).length,
    };
  },
};
