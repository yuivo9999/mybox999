/**
 * RFC 3492 Punycode Encoder and URL Normalizer
 * Converts internationalized domain names (IDN) with Chinese / non-ASCII characters
 * into ASCII-compatible Punycode (e.g. 饭太硬.com -> xn--sss604efuw.com)
 * to prevent DNS resolution failures across all environments.
 */

const PUNYCODE_BASE = 36;
const PUNYCODE_TMIN = 1;
const PUNYCODE_TMAX = 26;
const PUNYCODE_SKEW = 38;
const PUNYCODE_DAMP = 700;
const PUNYCODE_INITIAL_BIAS = 72;
const PUNYCODE_INITIAL_N = 128;
const PUNYCODE_DELIMITER = '-';

function adaptBias(delta, numPoints, firstTime) {
  let k = 0;
  let d = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  for (; d > ((PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX) >> 1; k += PUNYCODE_BASE) {
    d = Math.floor(d / (PUNYCODE_BASE - PUNYCODE_TMIN));
  }
  return k + Math.floor(((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * d) / (d + PUNYCODE_SKEW));
}

/**
 * Encodes a Unicode string to Punycode (without 'xn--' prefix).
 * @param {string} input 
 * @returns {string}
 */
export function encodePunycode(input) {
  if (!input) return '';
  const codePoints = Array.from(input).map(c => c.codePointAt(0));
  const basic = codePoints.filter(cp => cp < 0x80);
  let output = basic.map(cp => String.fromCharCode(cp)).join('');
  let b = basic.length;
  let h = b;

  if (b > 0) output += PUNYCODE_DELIMITER;

  let n = PUNYCODE_INITIAL_N;
  let delta = 0;
  let bias = PUNYCODE_INITIAL_BIAS;

  while (h < codePoints.length) {
    let m = 0x7fffffff;
    for (const cp of codePoints) {
      if (cp >= n && cp < m) m = cp;
    }

    delta += (m - n) * (h + 1);
    n = m;

    for (const cp of codePoints) {
      if (cp < n) {
        delta += 1;
      }
      if (cp === n) {
        let q = delta;
        for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
          const t = k <= bias ? PUNYCODE_TMIN : (k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias);
          if (q < t) break;
          const digit = t + ((q - t) % (PUNYCODE_BASE - t));
          output += String.fromCharCode(digit < 26 ? digit + 97 : digit - 26 + 48);
          q = Math.floor((q - t) / (PUNYCODE_BASE - t));
        }
        output += String.fromCharCode(q < 26 ? q + 97 : q - 26 + 48);
        bias = adaptBias(delta, h + 1, h === b);
        delta = 0;
        h += 1;
      }
    }
    delta += 1;
    n += 1;
  }

  return output;
}

/**
 * Converts a domain name label or full hostname to ASCII (Punycode).
 * e.g. "饭太硬.com" -> "xn--sss604efuw.com"
 * @param {string} domain
 * @returns {string}
 */
export function domainToASCII(domain) {
  if (!domain || typeof domain !== 'string') return '';
  const cleaned = domain.trim();
  // If already pure ASCII, return as is
  if (/^[\x00-\x7F]+$/.test(cleaned)) {
    return cleaned;
  }

  return cleaned.split('.').map(part => {
    if (!part) return '';
    // Check if label contains non-ASCII characters
    if (/[^\x00-\x7F]/.test(part)) {
      return `xn--${encodePunycode(part)}`;
    }
    return part;
  }).join('.');
}

/**
 * Converts any URL with Chinese or non-ASCII domain to Punycode-safe URL.
 * e.g. "http://饭太硬.com/tv" -> "http://xn--sss604efuw.com/tv"
 * e.g. "饭太硬.com/tv" -> "http://xn--sss604efuw.com/tv"
 * @param {string} rawUrl
 * @returns {string}
 */
export function toPunycodeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let input = rawUrl.trim();
  if (!input) return '';

  // Preserve data: or local: or proxy: protocols as is
  if (/^(?:data|blob|local|proxy):/i.test(input)) {
    return input;
  }

  // Prepend default http protocol if missing
  let hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input);
  let workingUrl = hasProtocol ? input : `http://${input}`;

  try {
    // Attempt standard URL parser first
    const parsed = new URL(workingUrl);
    const convertedHostname = domainToASCII(parsed.hostname);
    if (convertedHostname !== parsed.hostname) {
      parsed.hostname = convertedHostname;
      return parsed.href;
    }
    return parsed.href;
  } catch {
    // Fallback regex-based replacement for unorthodox or edge cases
    return workingUrl.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?([^/:]+)(.*)$/, (match, proto, host, rest) => {
      const safeProto = proto || 'http://';
      const safeHost = domainToASCII(host);
      return `${safeProto}${safeHost}${rest || ''}`;
    });
  }
}
