/**
 * Lynk & Co Auto Sign & Share — Loon bundle
 * v20260813-refactor6
 * 纯定时式：捕获一次 token 后，每天 cron 自动签到 + 文章分享。
 * 包含两套网关签名（H5 大写 X-Ca-* / 原生 SDK 小写 x-ca-* + Content-MD5）。
 * 由 src/ 模块构建生成，请勿直接编辑本文件。
 */
"use strict";

"use strict";

/* ---------- 字节/字符串工具 ---------- */

function utf8Bytes(text) {
  // Loon 的 JavaScriptCore 提供 TextEncoder；这里做降级兼容
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(String(text));
  }
  const value = String(text);
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      // 代理对（UTF-16 双码元）
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        const combined = ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        bytes.push(
          0xf0 | (combined >> 18),
          0x80 | ((combined >> 12) & 0x3f),
          0x80 | ((combined >> 6) & 0x3f),
          0x80 | (combined & 0x3f),
        );
        i += 1;
      } else {
        bytes.push(0xef, 0xbf, 0xbd); // 替换字符
      }
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

function bytesToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  // 优先使用内置 btoa（性能好）；Loon 环境无 btoa 时用手写实现
  if (typeof btoa !== "undefined") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const third = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const chunk = (first << 16) | (second << 8) | third;
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : "=";
    output += i + 2 < bytes.length ? alphabet[chunk & 63] : "=";
  }
  return output;
}

/* ---------- SHA-256 ---------- */

function rightRotate(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Bytes(inputBytes) {
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const bitLength = inputBytes.length * 8;
  const withOne = inputBytes.length + 1;
  const paddedLength = withOne + ((64 - ((withOne + 8) % 64)) % 64) + 8;
  const padded = new Uint8Array(paddedLength);
  padded.set(inputBytes);
  padded[inputBytes.length] = 0x80;

  let remainingBits = bitLength;
  for (let i = 0; i < 8; i += 1) {
    padded[padded.length - 1 - i] = remainingBits & 0xff;
    remainingBits = Math.floor(remainingBits / 256);
  }

  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const wordOffset = offset + i * 4;
      words[i] =
        (padded[wordOffset] << 24) |
        (padded[wordOffset + 1] << 16) |
        (padded[wordOffset + 2] << 8) |
        padded[wordOffset + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rightRotate(words[i - 15], 7) ^ rightRotate(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rightRotate(words[i - 2], 17) ^ rightRotate(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
    for (let i = 0; i < 64; i += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i] + words[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  for (let i = 0; i < hash.length; i += 1) {
    const word = hash[i];
    const offset = i * 4;
    output[offset] = (word >>> 24) & 0xff;
    output[offset + 1] = (word >>> 16) & 0xff;
    output[offset + 2] = (word >>> 8) & 0xff;
    output[offset + 3] = word & 0xff;
  }
  return output;
}

/* ---------- HMAC-SHA256 ---------- */

function hmacSha256Bytes(keyBytes, messageBytes) {
  const blockSize = 64;
  let normalizedKey = keyBytes;
  if (normalizedKey.length > blockSize) normalizedKey = sha256Bytes(normalizedKey);
  if (normalizedKey.length < blockSize) {
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(normalizedKey);
    normalizedKey = paddedKey;
  }

  const outerKeyPad = new Uint8Array(blockSize);
  const innerKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i += 1) {
    outerKeyPad[i] = normalizedKey[i] ^ 0x5c;
    innerKeyPad[i] = normalizedKey[i] ^ 0x36;
  }

  const inner = new Uint8Array(blockSize + messageBytes.length);
  inner.set(innerKeyPad);
  inner.set(messageBytes, blockSize);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(outerKeyPad);
  outer.set(innerHash, blockSize);
  return sha256Bytes(outer);
}

function signBase64HmacSha256(secret, message) {
  return bytesToBase64(hmacSha256Bytes(utf8Bytes(secret), utf8Bytes(message)));
}

/* ---------- MD5（RFC 1321，字节输出） ---------- */

function md5Bytes(inputBytes) {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const k = new Int32Array(64);
  for (let i = 0; i < 64; i += 1) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  }

  const bitLength = inputBytes.length * 8;
  const paddedLength = (((inputBytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(inputBytes);
  padded[inputBytes.length] = 0x80;
  // 小端序写入 64 位 bit 长度（低 32 位；JS 位运算处理 64 位需分两次）
  let lowBits = bitLength >>> 0;
  let highBits = Math.floor(bitLength / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i += 1) {
    padded[paddedLength - 8 + i] = lowBits & 0xff;
    lowBits = Math.floor(lowBits / 256);
  }
  for (let i = 0; i < 4; i += 1) {
    padded[paddedLength - 4 + i] = highBits & 0xff;
    highBits = Math.floor(highBits / 256);
  }

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  const m = new Int32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const o = offset + i * 4;
      m[i] =
        (padded[o] |
          (padded[o + 1] << 8) |
          (padded[o + 2] << 16) |
          (padded[o + 3] << 24)) | 0;
    }

    let A = a0, B = b0, C = c0, D = d0;

    function round(f, gIndex, i) {
      const fResult = f(B, C, D);
      const temp = (A + fResult + k[i] + m[gIndex]) | 0;
      A = D; D = C; C = B;
      B = (B + ((temp << s[i]) | (temp >>> (32 - s[i])))) | 0;
    }

    for (let i = 0; i < 16; i += 1) {
      round((b, c, d) => (b & c) | (~b & d), i, i);
    }
    for (let i = 16; i < 32; i += 1) {
      round((b, c, d) => (d & b) | (~d & c), (5 * i + 1) % 16, i);
    }
    for (let i = 32; i < 48; i += 1) {
      round((b, c, d) => b ^ c ^ d, (3 * i + 5) % 16, i);
    }
    for (let i = 48; i < 64; i += 1) {
      round((b, c, d) => c ^ (b | ~d), (7 * i) % 16, i);
    }

    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  const output = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i += 1) {
    let word = words[i] >>> 0;
    for (let j = 0; j < 4; j += 1) {
      output[i * 4 + j] = word & 0xff;
      word = Math.floor(word / 256);
    }
  }
  return output;
}

function md5Base64(text) {
  return bytesToBase64(md5Bytes(utf8Bytes(String(text))));
}

/* ---------- 随机数与 Nonce ---------- */

function getRandomBytes(length) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const output = new Uint8Array(length);
    crypto.getRandomValues(output);
    return output;
  }
  return Uint8Array.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
}

/** UUID v4 格式 nonce（与 App 一致） */
function createNonceFromBytes(bytes) {
  const hex = bytes.map((value) => value.toString(16).padStart(2, "0"));
  hex[6] = "4" + hex[6].slice(1);
  const variant = parseInt(hex[8][0], 16);
  hex[8] = (((variant & 0x3) | 0x8).toString(16)) + hex[8].slice(1);
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function createNonce() {
  return createNonceFromBytes(Array.from(getRandomBytes(16)));
}


"use strict";

const H5_SIGNATURE_HEADERS = "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method";
const NATIVE_SIGNATURE_HEADERS = "x-ca-nonce,x-ca-key,x-ca-timestamp";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 1123 GMT 日期，如 "Thu, 13 Aug 2026 03:00:00 GMT" */
function httpDate(now) {
  const date = now || new Date();
  return (
    WEEKDAYS[date.getUTCDay()] + ", " +
    String(date.getUTCDate()).padStart(2, "0") + " " +
    MONTHS[date.getUTCMonth()] + " " +
    date.getUTCFullYear() + " " +
    String(date.getUTCHours()).padStart(2, "0") + ":" +
    String(date.getUTCMinutes()).padStart(2, "0") + ":" +
    String(date.getUTCSeconds()).padStart(2, "0") + " GMT"
  );
}

/** 本地时区 "YYYY-MM-DD HH:mm:ss"（分享风控时间戳用） */
function formatRiskOpenTime(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
}

/**
 * query 参数按名字 ASCII 升序重排。
 * 输入可为 "?a=1&b=2" 或 "a=1&b=2"；输出不带前导 "?" 的排序串。
 * 值不做重编码（与请求 URL 保持一致）。
 */
function sortQuery(queryString) {
  const query = String(queryString || "").replace(/^\?/, "");
  if (!query) return "";
  const entries = query.split("&").filter(Boolean).map((entry) => {
    const eqIndex = entry.indexOf("=");
    if (eqIndex < 0) return { name: entry, value: "" };
    return { name: entry.slice(0, eqIndex), value: entry.slice(eqIndex + 1) };
  });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return entries.map((entry) => entry.name + (entry.value ? "=" + entry.value : "")).join("&");
}

/** 拆分 path 与 query，返回 { path, query(sorted) } */
function splitPathAndQuery(uri) {
  const questionIndex = String(uri).indexOf("?");
  if (questionIndex < 0) return { path: uri, query: "" };
  return {
    path: uri.slice(0, questionIndex),
    query: sortQuery(uri.slice(questionIndex + 1)),
  };
}

function buildPathPart(uri) {
  const { path, query } = splitPathAndQuery(uri);
  return query ? path + "?" + query : path;
}

/**
 * H5 签名待签字符串。
 * @param {object} input { method, uri, xCaKey, nonce, timestamp }
 */
function buildH5SignString(input) {
  return [
    String(input.method).toUpperCase(),
    "*/*",
    "",
    "application/json",
    "",
    "X-Ca-Key:" + input.xCaKey,
    "X-Ca-Nonce:" + input.nonce,
    "X-Ca-Signature-Method:HmacSHA256",
    "X-Ca-Timestamp:" + input.timestamp,
    buildPathPart(input.uri),
  ].join("\n");
}

/**
 * 原生 SDK 签名待签字符串。
 * @param {object} input {
 *   method, uri, body,
 *   xCaKey, nonce, timestamp, date,
 *   extraCaHeaders: { name: value } 额外的参与签名的小写 x-ca-* 头
 * }
 * @returns {object} { signString, contentMd5, caHeaders(参与签名的头, 有序) }
 */
function buildNativeSignString(input) {
  const bodyText = input.body == null ? "" : String(input.body);
  const contentMd5 = md5Base64(bodyText);

  const caHeaders = {};
  caHeaders["x-ca-key"] = input.xCaKey;
  caHeaders["x-ca-nonce"] = input.nonce;
  caHeaders["x-ca-timestamp"] = String(input.timestamp);
  const extra = input.extraCaHeaders || {};
  Object.keys(extra).forEach((name) => {
    const normalized = String(name).toLowerCase();
    if (extra[name] != null && !(normalized in caHeaders)) {
      caHeaders[normalized] = String(extra[name]);
    }
  });

  const names = Object.keys(caHeaders).sort();
  const lines = [
    String(input.method).toUpperCase(),
    "*/*",
    contentMd5,
    "application/json",
    input.date || httpDate(),
  ];
  names.forEach((name) => lines.push(name + ":" + caHeaders[name]));
  lines.push(buildPathPart(input.uri));

  return {
    signString: lines.join("\n"),
    contentMd5,
    caHeaders,
  };
}

/** 完整 H5 签名请求头（含 X-Ca-Signature 与 Signature-Headers 声明） */
function buildH5SignedHeaders(input) {
  return {
    "X-Ca-Key": input.xCaKey,
    "X-Ca-Nonce": input.nonce,
    "X-Ca-Timestamp": String(input.timestamp),
    "X-Ca-Signature": input.signature,
    "X-Ca-Signature-Method": "HmacSHA256",
    "X-Ca-Signature-Headers": H5_SIGNATURE_HEADERS,
  };
}

/** 完整原生签名请求头（含 Content-MD5、Date 与签名头声明） */
function buildNativeSignedHeaders(input) {
  return {
    "x-ca-key": input.xCaKey,
    "x-ca-nonce": input.nonce,
    "x-ca-timestamp": String(input.timestamp),
    "x-ca-signature": input.signature,
    "Content-MD5": input.contentMd5,
    Date: input.date || httpDate(),
    "X-Ca-Signature-Headers": NATIVE_SIGNATURE_HEADERS,
  };
}


"use strict";

const SCRIPT_VERSION = "v20260813-refactor";

/* 领克网关密钥表（X-Ca-Key → AppSecret）。
 * 2026-07 轮换后新 key 为 203760416；旧 key 204644386 已 403，保留作回退。
 * 注意：AppSecret 无法通过抓包获得，若 403 且 key 再次轮换需重新提取（见 docs/protocol.md）。 */
const LYNK_CO_APP_SECRETS = {
  "203760416": "e1msl9aqd101gfcjpo873hrs5jg752og",
  "204644386": "QCl7udM3PB9cOIOwquwPglikFQnzJRsX",
};

const DEFAULT_CONFIG = {
  xCaKey: "203760416",
  appSecret: "", // 留空时按 xCaKey 自动匹配
  appCode: "3fa3314998bd4195a9fe2df3e85e6a12",
  tenantId: "569001643002",
  cepAppId: "59701c08ed454a43a9b",
  appVersion: "4.2.3",
  deviceType: "IOS",
  deviceId: "",
  articleId: "",
  fallbackArticleId: "1881101031748870144",
  shareContentType: 1,
  shareEnabled: true,
  autoRunOnCapture: false,
  oncePerDay: true,
  debug: true,
  captureNotify: false, // 捕获到 token 时是否发送 "LynkCo Token Captured" 通知（需要重抓 token 时临时打开）
  /* 原生签名接口可选的设备头（研究结论：非必需，但保留以兼容风控） */
  device: {
    glDevName: "lynk&co",
    glDevModel: "PCAM10",
    glDevBrand: "huawei",
    glDevPlatform: "Android",
    glOsVersion: "10",
    glAppVersion: "4.2.3",
    glAppBuild: "402030320",
    glDevId: "",
  },
  /* 登录类接口额外参与签名的小写 x-ca-* 头 */
  nativeExtraCaHeaders: {},
};

function parseArgumentString(argument) {
  if (!argument) return {};
  return String(argument)
    .split("&")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const parts = entry.split("=");
      const key = (parts.shift() || "").trim();
      if (!key) return accumulator;
      accumulator[key] = parts.join("=").trim();
      return accumulator;
    }, {});
}

function truthyFlag(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function resolveAppSecret(xCaKey) {
  const key = String(xCaKey || "").trim();
  return Object.prototype.hasOwnProperty.call(LYNK_CO_APP_SECRETS, key)
    ? LYNK_CO_APP_SECRETS[key]
    : LYNK_CO_APP_SECRETS[DEFAULT_CONFIG.xCaKey];
}

/** 合并参数生成最终配置 */
function buildConfig(argument) {
  const source = parseArgumentString(argument);
  const config = Object.assign({}, DEFAULT_CONFIG);
  const xCaKey = source.xCaKey || DEFAULT_CONFIG.xCaKey;
  config.xCaKey = String(xCaKey).trim();
  config.appSecret = source.appSecret || resolveAppSecret(config.xCaKey);
  config.appCode = source.appCode || DEFAULT_CONFIG.appCode;
  config.tenantId = source.tenantId || DEFAULT_CONFIG.tenantId;
  config.cepAppId = source.cepAppId || DEFAULT_CONFIG.cepAppId;
  config.appVersion = source.appVersion || DEFAULT_CONFIG.appVersion;
  config.deviceType = source.deviceType || DEFAULT_CONFIG.deviceType;
  config.deviceId = source.deviceId || DEFAULT_CONFIG.deviceId;
  config.refreshToken = source.refreshToken || "";
  config.articleId = source.articleId || "";
  config.fallbackArticleId = source.fallbackArticleId || DEFAULT_CONFIG.fallbackArticleId;
  config.shareContentType = source.shareContentType != null
    ? Number(source.shareContentType)
    : DEFAULT_CONFIG.shareContentType;
  config.shareEnabled = truthyFlag(source.shareEnabled, DEFAULT_CONFIG.shareEnabled);
  config.autoRunOnCapture = truthyFlag(source.autoRunOnCapture, DEFAULT_CONFIG.autoRunOnCapture);
  config.oncePerDay = truthyFlag(source.oncePerDay, DEFAULT_CONFIG.oncePerDay);
  config.debug = truthyFlag(source.debug, DEFAULT_CONFIG.debug);
  config.captureNotify = truthyFlag(source.captureNotify, DEFAULT_CONFIG.captureNotify);
  if (source.glDevId) config.device.glDevId = source.glDevId;
  return config;
}

/** 构造分享 URL（与 App H5 分享一致） */
function buildShareUrl(articleId) {
  const route = "lynkco://wx/?routeUrl=/pages/exploration/article/index.js?id=" + articleId;
  return (
    "https://h5.lynkco.com/app-h5/dist/web/pages/exploration/article/index.html?id=" +
    articleId +
    "&isShare=" +
    encodeURIComponent(route)
  );
}


"use strict";

const TOKEN_STATE_KEY = "lynkco.share.tokenState";
const DAILY_STATE_KEY = "lynkco.share.dailyState";
const LAST_RESULT_KEY = "lynkco.share.lastResult";
const CAPTURE_STATE_KEY = "lynkco.capture.state";
const SHARE_VALIDATION_KEY = "lynkco.share.shareValidation";

function emptyTokenState() {
  return {
    token: "",
    refreshToken: "",
    oauthAccessToken: "",
    oauthRefreshToken: "",
    authorization: "",
    deviceId: "",
    deviceType: "",
    appVersion: "",
  };
}

function parseTokenState(raw) {
  if (!raw) return emptyTokenState();
  try {
    const parsed = JSON.parse(raw);
    return Object.assign(emptyTokenState(), parsed || {});
  } catch (error) {
    return emptyTokenState();
  }
}

function serializeTokenState(tokenState) {
  return JSON.stringify(tokenState || emptyTokenState());
}

function readTokenState(store) {
  return parseTokenState(store && store.read ? store.read(TOKEN_STATE_KEY) : "");
}

function writeTokenState(store, tokenState) {
  if (!store || !store.write) return;
  try {
    store.write(serializeTokenState(tokenState), TOKEN_STATE_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

function hasTokenState(tokenState) {
  return Boolean(
    tokenState.token ||
      tokenState.refreshToken ||
      tokenState.oauthAccessToken ||
      tokenState.oauthRefreshToken ||
      tokenState.authorization,
  );
}

/* ---------------- 每日状态（oncePerDay 用） ---------------- */

function readDailyState(store) {
  if (!store || !store.read) return { date: "", success: false, attempt: "" };
  try {
    const parsed = JSON.parse(store.read(DAILY_STATE_KEY) || "");
    return {
      date: parsed.date || "",
      success: Boolean(parsed.success),
      attempt: parsed.attempt || "",
    };
  } catch (error) {
    return { date: "", success: false, attempt: "" };
  }
}

function writeDailyState(store, state) {
  if (!store || !store.write) return;
  try {
    store.write(JSON.stringify(state), DAILY_STATE_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

function writeLastResult(store, summary) {
  if (!store || !store.write) return;
  try {
    store.write(String(summary), LAST_RESULT_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

/** 本地日期键 YYYY-MM-DD（东八区） */
function localDayKey(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, "0"),
    String(local.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/* ---------------- 分享验证（certifyId） ---------------- */

function readStoredShareValidation(store) {
  if (!store || !store.read) return null;
  try {
    const parsed = JSON.parse(store.read(SHARE_VALIDATION_KEY) || "");
    return parsed && parsed.certifyId ? parsed : null;
  } catch (error) {
    return null;
  }
}

function writeStoredShareValidation(store, validation) {
  if (!store || !store.write || !validation || !validation.certifyId) return;
  try {
    store.write(JSON.stringify({
      capturedAt: validation.capturedAt || new Date().toISOString(),
      certifyId: validation.certifyId,
      challenge: validation.challenge || "",
      riskValidateInfo: validation.riskValidateInfo || "",
      source: validation.source || "security-config",
    }), SHARE_VALIDATION_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

function clearStoredShareValidation(store) {
  if (!store || !store.write) return;
  try {
    store.write("", SHARE_VALIDATION_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

/* ---------------- 捕获状态 ---------------- */

function readCaptureState(store) {
  if (!store || !store.read) return null;
  try {
    const parsed = JSON.parse(store.read(CAPTURE_STATE_KEY) || "");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function writeCaptureState(store, state) {
  if (!store || !store.write) return;
  try {
    store.write(JSON.stringify(state), CAPTURE_STATE_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}


"use strict";

function postNotification(notification, title, content, debugInfo) {
  try {
    notification.post(title, "", content + (debugInfo ? "\n" + debugInfo : ""));
  } catch (error) {
    console.log("LynkCo notify failed: " + error.message);
  }
}

function maskValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return text.slice(0, 2) + "***";
  return text.slice(0, 4) + "..." + text.slice(-4);
}

/** 摘要 token 状态（用于诊断，不含完整值） */
function summarizeTokenState(tokenState) {
  const parts = [];
  if (tokenState.token) parts.push("token=" + maskValue(tokenState.token));
  if (tokenState.refreshToken) parts.push("refresh=" + maskValue(tokenState.refreshToken));
  if (tokenState.oauthAccessToken) parts.push("oauth=" + maskValue(tokenState.oauthAccessToken));
  if (tokenState.authorization) parts.push("auth=" + maskValue(tokenState.authorization).slice(0, 12));
  return parts.length ? parts.join(" ") : "none";
}

/** 构建错误诊断摘要：错误类型分类 + 响应体摘要 */
function buildDiagnostic(config, error, extra) {
  if (!config.debug) return "";
  const parts = [];
  if (extra && extra.url) parts.push("url=" + extra.url);
  if (extra && extra.responseBody) parts.push("resp=" + extra.responseBody);
  const message = String((error && error.message) || error || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("http 403") || normalized.includes("403")) {
    parts.push("type=signature-or-key(403)");
    parts.push("key=" + config.xCaKey);
  } else if (isTokenError(message)) {
    parts.push("type=token");
  } else if (normalized.includes("share.need.validate.check") || normalized.includes("need.validate.check")) {
    parts.push("type=share-validation");
  } else if (normalized.includes("already signed") || normalized.includes("已签到")) {
    parts.push("type=already-signed");
  }
  return parts.join(" ");
}

function isTokenError(message) {
  const normalized = String(message).toLowerCase();
  return [
    "unauthorized",
    "token expired",
    "oauthaccesstoken",
    "invalid token",
    "登录已过期",
    "token 失效",
    "user-crowded-out",
  ].some((marker) => normalized.includes(marker));
}


"use strict";

const AUTH_HOSTS = [
  "h5-api.lynkco.com",
  "app-services.lynkco.com.cn",
  "gric-api.geely.com",
];
const BUSINESS_HOST = "app-api-gw-toc.lynkco.com";
const H5_API_HOST = "h5-api.lynkco.com";
const SHARE_HOST = "h5.lynkco.com";

const H5_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 " +
  "x-cordova-platform/ios cordova-6";
const NATIVE_UA = "ALIYUN-ANDROID-UA";
const SHARE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

function requestAsync(httpClient, method, params) {
  return new Promise((resolve, reject) => {
    httpClient[method](params, (error, response, data) => {
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve({ response, data });
    });
  });
}

function parseJson(data) {
  if (!data || typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function getApiMessage(payload) {
  return (payload && (payload.message || payload.msg || payload.errorMsg)) || "";
}

function getHttpStatus(response) {
  return (response && (response.status || response.statusCode)) || 0;
}

function isSuccessMarker(value) {
  if (value == null || value === "") return true;
  if (typeof value === "number") return value === 0 || value === 200;
  return ["0", "200", "success", "ok", "true"].includes(String(value).trim().toLowerCase());
}

function getBusinessFailureMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.success === false) return getApiMessage(payload) || "business check failed";
  if (!isSuccessMarker(payload.code)) return getApiMessage(payload) || "code " + payload.code;
  if (!isSuccessMarker(payload.status)) return getApiMessage(payload) || "status " + payload.status;
  return "";
}

function assertSuccessfulHttp(response, label, payload, data) {
  const status = getHttpStatus(response);
  if (status && (status < 200 || status >= 300)) {
    const apiMessage = getApiMessage(payload);
    const bodySummary = summarizeBody(data);
    throw new Error(
      label + " failed HTTP " + status +
      (apiMessage ? ": " + apiMessage : bodySummary ? ": " + bodySummary : "."),
    );
  }
  const businessFailureMessage = getBusinessFailureMessage(payload);
  if (businessFailureMessage) throw new Error(label + " failed: " + businessFailureMessage);
}

function summarizeBody(data) {
  if (typeof data !== "string") return "";
  const trimmed = data.trim();
  if (!trimmed) return "";
  return trimmed.length > 200 ? trimmed.slice(0, 197) + "..." : trimmed;
}

/** 已签到提示（无论以什么路径返回都算完成） */
function isAlreadySignedMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("already signed") ||
    normalized.includes("signed today") ||
    normalized.includes("已签到") ||
    normalized.includes("已签")
  );
}

/** 分享需要人机验证的提示 */
function isNeedShareValidationError(error) {
  const text = String((error && error.message) || error || "").toLowerCase();
  return text.includes("share.need.validate.check") || text.includes("need.validate.check");
}

function isHttp403Error(error) {
  const text = String((error && error.message) || error || "").toLowerCase();
  return text.includes("http 403") || text.includes("403");
}

/** token 失效类错误（需要重新打开 App 捕获） */
function isTokenInvalidError(error) {
  const text = String((error && error.message) || error || "").toLowerCase();
  return [
    "unauthorized",
    "token expired",
    "oauthaccesstoken",
    "invalid token",
    "登录已过期",
    "token 失效",
    "user-crowded-out",
  ].some((marker) => text.includes(marker));
}

/* ---------------- 认证头 ---------------- */

function buildAuthHeaders(tokenState, config) {
  const headers = {};
  if (!tokenState) return headers;
  if (tokenState.token) headers.token = tokenState.token;
  if (tokenState.oauthAccessToken) headers.oauthAccessToken = tokenState.oauthAccessToken;
  if (tokenState.oauthRefreshToken) headers.oauthRefreshToken = tokenState.oauthRefreshToken;
  if (tokenState.authorization) {
    headers.authorization = tokenState.authorization;
  } else if (config && config.appCode) {
    headers.authorization = "APPCODE " + config.appCode;
  } else if (tokenState.oauthAccessToken) {
    headers.authorization = "Bearer " + tokenState.oauthAccessToken;
  }
  return headers;
}

/** 原生签名接口的设备头（研究结论：非必需，但保留可配置） */
function buildDeviceHeaders(config) {
  const device = config.device || {};
  const headers = {};
  if (device.glDevName) headers["gl_dev_name"] = device.glDevName;
  if (device.glDevModel) headers["gl_dev_model"] = device.glDevModel;
  if (device.glDevBrand) headers["gl_dev_brand"] = device.glDevBrand;
  if (device.glDevPlatform) headers["gl_dev_platform"] = device.glDevPlatform;
  if (device.glOsVersion) headers["gl_os_version"] = device.glOsVersion;
  if (device.glAppVersion) headers["gl_app_version"] = device.glAppVersion;
  if (device.glAppBuild) headers["gl_app_build"] = device.glAppBuild;
  if (device.glDevId) headers["gl_dev_id"] = device.glDevId;
  return headers;
}

/* ---------------- H5 签名请求 ---------------- */

/** 每个请求独立 nonce/timestamp */
function freshRequestContext(context) {
  return Object.assign({}, context, {
    nonce: createNonce(),
    timestamp: String(Date.now()),
  });
}

function buildH5Request(context, { method, host, uri, body, extraHeaders }) {
  const input = {
    method,
    uri,
    xCaKey: context.config.xCaKey,
    nonce: context.nonce,
    timestamp: context.timestamp,
  };
  const signString = buildH5SignString(input);
  const signature = signBase64HmacSha256(context.config.appSecret, signString);
  return {
    method,
    url: "https://" + host + uri,
    headers: Object.assign(
      {
        "User-Agent": H5_UA,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      buildH5SignedHeaders({
        xCaKey: context.config.xCaKey,
        nonce: context.nonce,
        timestamp: context.timestamp,
        signature,
      }),
      buildAuthHeaders(context.tokenState, context.config),
      extraHeaders || {},
    ),
    body,
  };
}

async function h5Request(context, options) {
  const requestContext = freshRequestContext(context);
  const result = await requestAsync(context.httpClient, String(options.method).toLowerCase(),
    buildH5Request(requestContext, options));
  const payload = parseJson(result.data);
  assertSuccessfulHttp(result.response, options.label || options.uri, payload, result.data);
  return { payload, data: result.data, response: result.response };
}

/* ---------------- 原生签名请求 ---------------- */

function buildNativeRequest(context, { method, host, uri, body, extraHeaders }) {
  const signed = buildNativeSignString({
    method,
    uri,
    body: body || "",
    xCaKey: context.config.xCaKey,
    nonce: context.nonce,
    timestamp: context.timestamp,
    extraCaHeaders: context.config.nativeExtraCaHeaders,
  });
  const signature = signBase64HmacSha256(context.config.appSecret, signed.signString);
  return {
    method,
    url: "https://" + host + uri,
    headers: Object.assign(
      {
        "User-Agent": NATIVE_UA,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      buildNativeSignedHeaders({
        xCaKey: context.config.xCaKey,
        nonce: context.nonce,
        timestamp: context.timestamp,
        signature,
        contentMd5: signed.contentMd5,
      }),
      buildAuthHeaders(context.tokenState, context.config),
      buildDeviceHeaders(context.config),
      extraHeaders || {},
    ),
    body,
  };
}

async function nativeRequest(context, options) {
  const requestContext = freshRequestContext(context);
  const result = await requestAsync(context.httpClient, String(options.method).toLowerCase(),
    buildNativeRequest(requestContext, options));
  const payload = parseJson(result.data);
  assertSuccessfulHttp(result.response, options.label || options.uri, payload, result.data);
  return { payload, data: result.data, response: result.response };
}

/* ---------------- 刷新 token ---------------- */

/**
 * 用 refreshToken 换新 token。多域尝试；每域先 APPCODE 静态认证，失败回退原生签名。
 * @returns {object|null} { token, refreshToken, expireAt, oauthAccessToken, oauthRefreshToken, authorization } 或 null
 */
async function refreshToken(context, refreshTokenValue) {
  const tokenState = context.tokenState || {};
  const config = context.config;
  const query = [
    "refreshToken=" + encodeURIComponent(refreshTokenValue),
    "deviceId=" + encodeURIComponent(tokenState.deviceId || config.deviceId || ""),
    "deviceType=" + encodeURIComponent(tokenState.deviceType || config.deviceType || "IOS"),
    "appVersion=" + encodeURIComponent(config.appVersion || "4.2.3"),
  ].join("&");

  const lastErrors = [];
  for (let i = 0; i < AUTH_HOSTS.length; i += 1) {
    const host = AUTH_HOSTS[i];
    const uri = "/auth/login/refresh?" + query;
    const url = "https://" + host + uri;

    // 1) APPCODE 静态认证
    try {
      const result = await requestAsync(context.httpClient, "get", {
        method: "GET",
        url,
        headers: Object.assign(
          {
            "User-Agent": H5_UA,
            "Content-Type": "application/json",
            Accept: "*/*",
            "X-Ca-Key": config.xCaKey,
          },
          { authorization: "APPCODE " + config.appCode },
        ),
      });
      const payload = parseJson(result.data);
      const centerTokenDto = payload && payload.data && payload.data.centerTokenDto;
      if (centerTokenDto && centerTokenDto.token) {
        return {
          token: centerTokenDto.token,
          refreshToken: centerTokenDto.refreshToken || refreshTokenValue,
          expireAt: centerTokenDto.expireAt || 0,
          oauthAccessToken: tokenState.oauthAccessToken || "",
          oauthRefreshToken: tokenState.oauthRefreshToken || "",
          authorization: tokenState.authorization || "",
          deviceId: tokenState.deviceId || config.deviceId || "",
          deviceType: tokenState.deviceType || config.deviceType || "IOS",
        };
      }
      lastErrors.push(host + " appcode: " + summarizeBody(result.data));
    } catch (error) {
      lastErrors.push(host + " appcode: " + error.message);
    }

    // 2) 原生签名认证
    try {
      const attemptContext = freshRequestContext(context);
      const signed = buildNativeSignString({
        method: "GET",
        uri,
        body: "",
        xCaKey: config.xCaKey,
        nonce: attemptContext.nonce,
        timestamp: attemptContext.timestamp,
        extraCaHeaders: config.nativeExtraCaHeaders,
      });
      const signature = signBase64HmacSha256(config.appSecret, signed.signString);
      const result = await requestAsync(context.httpClient, "get", {
        method: "GET",
        url,
        headers: Object.assign(
          {
            "User-Agent": NATIVE_UA,
            "Content-Type": "application/json",
            Accept: "*/*",
          },
          buildNativeSignedHeaders({
            xCaKey: config.xCaKey,
            nonce: attemptContext.nonce,
            timestamp: attemptContext.timestamp,
            signature,
            contentMd5: signed.contentMd5,
          }),
        ),
      });
      const payload = parseJson(result.data);
      const centerTokenDto = payload && payload.data && payload.data.centerTokenDto;
      if (centerTokenDto && centerTokenDto.token) {
        return {
          token: centerTokenDto.token,
          refreshToken: centerTokenDto.refreshToken || refreshTokenValue,
          expireAt: centerTokenDto.expireAt || 0,
          oauthAccessToken: tokenState.oauthAccessToken || "",
          oauthRefreshToken: tokenState.oauthRefreshToken || "",
          authorization: tokenState.authorization || "",
          deviceId: tokenState.deviceId || config.deviceId || "",
          deviceType: tokenState.deviceType || config.deviceType || "IOS",
        };
      }
      lastErrors.push(host + " native: " + summarizeBody(result.data));
    } catch (error) {
      lastErrors.push(host + " native: " + error.message);
    }
  }

  const error = new Error("Refresh token failed: " + lastErrors.slice(0, 3).join(" || "));
  error.refreshFailed = true;
  throw error;
}

/* ---------------- 签到 ---------------- */

/** 查询今日签到状态（H5 签名） */
async function getSignDayInfo(context) {
  return h5Request(context, {
    method: "GET",
    host: BUSINESS_HOST,
    uri: "/up/api/v1/user/sign/day/info",
    label: "Sign day info",
  });
}

/** 执行签到（原生 SDK 签名，body 固定 "{}"） */
async function postSignUpgrade(context) {
  return nativeRequest(context, {
    method: "POST",
    host: BUSINESS_HOST,
    uri: "/up/api/v1/user/sign/upgrade",
    body: "{}",
    label: "Sign upgrade",
    extraHeaders: { use_security: "true" },
  });
}

/** 连续签到天数/补签卡（H5 签名） */
async function getContinueDaysAndSignCard(context) {
  return h5Request(context, {
    method: "GET",
    host: BUSINESS_HOST,
    uri: "/up/api/v1/userReward/getContinueDaysAndSignCard",
    label: "Continue days",
  });
}

/** 我的能量/积分（H5 签名），用于分享前后对比 */
async function getMyEnergy(context) {
  return h5Request(context, {
    method: "GET",
    host: BUSINESS_HOST,
    uri: "/app/energy/myEnergy",
    label: "My energy",
  });
}

/* ---------------- 分享 ---------------- */

/** 获取极验 certifyId（security/config，多域；H5 签名 + 认证头） */
async function fetchSecurityCertifyId(context) {
  const lastErrors = [];
  for (let i = 0; i < AUTH_HOSTS.length; i += 1) {
    const host = AUTH_HOSTS[i];
    try {
      const result = await h5Request(context, {
        method: "GET",
        host,
        uri: "/auth/v1/security/config?type=GEE_TEST_V4",
        label: "Security config",
        extraHeaders: {
          tenantId: context.config.tenantId,
          Authentication: "AppId=" + context.config.cepAppId,
          "acl-app": "BUYER",
        },
      });
      const data = result.payload && result.payload.data;
      const certifyId = data && (data.certifyId || data.certify_id);
      if (certifyId) return { certifyId: String(certifyId), source: "security-config" };
      lastErrors.push(host + ": no certifyId");
    } catch (error) {
      lastErrors.push(host + ": " + error.message);
    }
  }
  const error = new Error("Security config failed: " + lastErrors.slice(0, 3).join(" || "));
  error.securityFailed = true;
  throw error;
}

/**
 * 获取分享码（原生签名 + 风控头）。
 * @param {object} options { validation: {certifyId, challenge, riskValidateInfo} | null }
 */
async function getShareCode(context, options) {
  const validation = (options && options.validation) || null;
  const riskRequestInfo = JSON.stringify({
    openTimeStamp: options && options.openTimeStamp,
    shareContentType: context.config.shareContentType,
    shareContentURL: context.config.shareContentURL,
  });
  const extraHeaders = {
    use_security: "true",
    risk_type: "1",
    appVersion: context.config.appVersion || "4.2.3",
  };
  if (validation && validation.certifyId) {
    extraHeaders.risk_validate_info = riskRequestInfo;
    extraHeaders.certifyId = validation.certifyId;
    if (validation.challenge) extraHeaders.challenge = validation.challenge;
  } else {
    extraHeaders.risk_request_info = riskRequestInfo;
  }

  const result = await nativeRequest(context, {
    method: "GET",
    host: BUSINESS_HOST,
    uri: "/app/v1/task/getShareCode",
    label: "Share code",
    extraHeaders,
  });
  const payload = result.payload;
  if (!payload || typeof payload !== "object") throw new Error("Share code response is not valid JSON.");
  if (!payload.data) throw new Error(payload.message || "Share code response does not include data.");
  return payload.data;
}

/** 上报分享（H5 签名 + Origin h5.lynkco.com） */
async function postShareReporting(context, shareCode) {
  const result = await h5Request(context, {
    method: "POST",
    host: SHARE_HOST,
    uri: "/app/v1/task/shareReporting?shareCode=" + encodeURIComponent(shareCode),
    label: "Share reporting",
    body: JSON.stringify({
      businessNo: context.config.articleId,
      eventData: {
        firstClassification: "文章",
        secondClassification: "",
      },
    }),
    extraHeaders: {
      Origin: "https://h5.lynkco.com",
      Referer: "https://h5.lynkco.com/",
    },
  });
  return result;
}

/* ---------------- 文章 ---------------- */

/**
 * 获取广场第一篇文章/动态的 id。
 * 旧接口（config/pccid/get + article?articlePccId=）已下线（App 更新后返回
 * "网络开小差"），当前有效的是 POST /app/explore/home-page/square/index2，
 * 文章/动态列表在 data.userByteDynamicsResponseDTOS（每项含 dynamicId）。
 */
async function getFirstArticle(context) {
  const result = await h5Request(context, {
    method: "POST",
    host: H5_API_HOST,
    uri: "/app/explore/home-page/square/index2",
    body: JSON.stringify({
      dynamicSort: "new",
      uniqueId: "",
      refreshType: "MORE",
      pageNo: 1,
    }),
    label: "Square articles",
  });
  const data = result.payload && result.payload.data;
  if (!data || typeof data !== "object") throw new Error("Square response is not valid.");
  const dynamics = data.userByteDynamicsResponseDTOS;
  if (!Array.isArray(dynamics) || dynamics.length === 0) {
    throw new Error("Square article list is empty.");
  }
  for (let i = 0; i < dynamics.length; i += 1) {
    const item = dynamics[i];
    if (!item || typeof item !== "object") continue;
    const articleId = item.dynamicId || item.id || item.articleId || item.contentId;
    if (!articleId) continue;
    return String(articleId);
  }
  throw new Error("Square article list does not include a usable article id.");
}


"use strict";

/* ---------------- 签到状态解析（day/info 响应） ---------------- */

function normalizeDateKey(value) {
  const match = String(value || "").match(/^(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/);
  if (!match) return "";
  return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
}

function isDateLikeKey(key) {
  return Boolean(normalizeDateKey(key));
}

function isSignStatusPath(path) {
  const normalized = String(path || "").toLowerCase().replace(/[^a-z]/g, "");
  return (
    normalized.includes("issign") ||
    normalized.includes("signed") ||
    normalized.includes("hassigned") ||
    normalized.includes("todaysign") ||
    normalized.includes("signflag") ||
    normalized.includes("signstatus") ||
    (
      (normalized.includes("sign") || normalized.includes("task") || normalized.includes("reward")) &&
      (
        normalized.includes("status") ||
        normalized.includes("state") ||
        normalized.includes("complete") ||
        normalized.includes("finish")
      )
    )
  );
}

function signStatusValueToState(value) {
  if (value === true) return "signed";
  if (value === false) return "unsigned";
  if (typeof value === "number") {
    if (value === 1 || value === 200) return "signed";
    if (value === 0) return "unsigned";
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (
    ["1", "true", "yes", "signed", "complete", "completed", "finish", "finished", "success", "ok"]
      .includes(normalized)
  ) {
    return "signed";
  }
  if (
    ["0", "false", "no", "unsigned", "incomplete", "unfinished"].includes(normalized) ||
    normalized.includes("not signed") ||
    normalized.includes("未签到") ||
    normalized.includes("待签到") ||
    normalized.includes("去签到") ||
    normalized.includes("未完成")
  ) {
    return "unsigned";
  }
  if (
    normalized.includes("已签到") ||
    normalized.includes("已完成") ||
    normalized.includes("已领取")
  ) {
    return "signed";
  }
  return "";
}

function findSignCompletionState(value, path) {
  if (!value || typeof value !== "object") return "";
  const currentPath = path || "";
  const directState = isSignStatusPath(currentPath) ? signStatusValueToState(value) : "";
  if (directState) return directState;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const nestedPath = currentPath ? currentPath + "." + key : key;
    const candidate = value[key];
    const state = candidate && typeof candidate === "object"
      ? findSignCompletionState(candidate, nestedPath)
      : isSignStatusPath(nestedPath) ? signStatusValueToState(candidate) : "";
    if (state) return state;
  }
  return "";
}

/** 判断今日是否已签到：优先按日期 map 取今天的 entry，否则全响应递归 */
function getTodaySignState(payload, now) {
  const todayKey = localDayKey(now || new Date());
  const data = payload && payload.data;
  if (data && typeof data === "object") {
    const dateKeys = Object.keys(data).filter(isDateLikeKey);
    if (dateKeys.length) {
      const todayEntry = getEntryByDateKey(data, todayKey);
      if (!todayEntry) return "";
      return findSignCompletionState(todayEntry, todayKey) || "unsigned";
    }
  }
  return findSignCompletionState(payload);
}

function getEntryByDateKey(data, dateKey) {
  const target = normalizeDateKey(dateKey);
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (normalizeDateKey(key) === target) return data[key];
  }
  return null;
}

/* ---------------- 签到 ---------------- */

async function runSignTask(context, report) {
  const { config, httpClient, store, now } = context;
  const label = "Sign";

  // 1) 查今日状态
  let dayInfo = null;
  try {
    dayInfo = await getSignDayInfo(context);
    const state = getTodaySignState(dayInfo.payload, now);
    if (state === "signed") {
      report.sign = { ok: true, already: true };
      return { ok: true, already: true };
    }
  } catch (error) {
    report.signError = error;
    // 查询失败不阻断：继续尝试签到
  }

  // 2) 执行签到
  try {
    const upgradeResult = await postSignUpgrade(context);
    const payload = upgradeResult.payload;
    const message = payload && (payload.message || payload.msg || "");
    if (isAlreadySignedMessage(message) || isAlreadySignedMessage(upgradeResult.data)) {
      report.sign = { ok: true, already: true };
      return { ok: true, already: true };
    }
    // 成功后复查状态，确认生效
    let confirmed = true;
    if (dayInfo) {
      try {
        const afterInfo = await getSignDayInfo(context);
        if (getTodaySignState(afterInfo.payload, now) === "unsigned") confirmed = false;
      } catch (error) {
        // 复查失败以升级接口响应为准
      }
    }
    report.sign = { ok: confirmed };
    if (confirmed) {
      report.signMessage = (payload && (payload.message || payload.msg)) || "";
    } else {
      report.signError = new Error("Sign upgrade returned success but day info still reports unsigned.");
      return { ok: false, message: "sign not confirmed" };
    }
    return { ok: true };
  } catch (error) {
    report.signError = error;
    return { ok: false, message: error.message };
  }
}

/* ---------------- 分享 ---------------- */

function extractShareCode(data) {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") return data.shareCode || data.code || data.share_code || "";
  return "";
}

async function requestShareCodeWithValidation(context, validation) {
  const result = await getShareCode(context, {
    validation,
    openTimeStamp: formatRiskOpenTime(context.now || new Date()),
  });
  return extractShareCode(result);
}

/** 获取分享码；需要验证时走 certifyId 流程（存储 → security/config） */
async function obtainShareCode(context) {
  try {
    return await requestShareCodeWithValidation(context, null);
  } catch (initialError) {
    if (!isNeedShareValidationError(initialError)) throw initialError;

    const storedValidation = readStoredShareValidation(context.store);
    if (storedValidation) {
      try {
        return await requestShareCodeWithValidation(context, storedValidation);
      } catch (storedError) {
        if (!isNeedShareValidationError(storedError) && !isHttp403Error(storedError)) throw storedError;
      }
    }

    const validation = await fetchSecurityCertifyId(context);
    if (!validation) {
      throw new Error(
        "Share code failed: share.need.validate.check. Open Lynk & Co and share once manually, then retry.",
      );
    }
    writeStoredShareValidation(context.store, validation);
    try {
      return await requestShareCodeWithValidation(context, validation);
    } catch (validationError) {
      if (!isNeedShareValidationError(validationError) && !isHttp403Error(validationError)) {
        throw validationError;
      }
      throw new Error(
        "Share code failed: share.need.validate.check. Open Lynk & Co and share once manually, then retry.",
      );
    }
  }
}

function extractPoint(payload) {
  const data = payload && payload.data;
  if (!data) return null;
  if (typeof data === "object") {
    if (data.point != null) return Number(data.point);
    if (data.energy != null) return Number(data.energy);
    if (data.totalPoint != null) return Number(data.totalPoint);
  }
  return null;
}

/**
 * 分享任务。注意：分享 +5 积分的完整机制是
 *   "分享动作（getShareCode + shareReporting）→ 他人当日浏览分享链接 → +5 积分"。
 * 因此成功标准 = 分享动作完成；积分前后对比仅作附加报告：
 *   points > 0 → 已有人浏览加分；points = 0 → 正常，等待浏览。
 */
async function runShareTask(context, report) {
  const { config } = context;

  let articleId = config.articleId;
  try {
    if (!articleId) {
      articleId = await getFirstArticle(context);
      context.config = Object.assign({}, config, { articleId });
    } else {
      context.config = Object.assign({}, config, {
        shareContentURL: buildShareUrl(articleId),
      });
    }

    // 分享前积分
    let energyBefore = null;
    try {
      const before = await getMyEnergy(context);
      energyBefore = extractPoint(before.payload);
    } catch (error) {
      // 积分查询失败不阻断分享
    }

    const shareCode = await obtainShareCode(context);
    await postShareReporting(context, shareCode);

    // 分享后积分对比（仅作浏览加分报告，不作为成功判据）
    let energyAfter = null;
    try {
      const after = await getMyEnergy(context);
      energyAfter = extractPoint(after.payload);
    } catch (error) {
      // 忽略
    }

    report.energyBefore = energyBefore;
    report.energyAfter = energyAfter;
    report.shareCode = shareCode;
    report.shareUrl = buildShareUrl(articleId);

    const delta = energyBefore != null && energyAfter != null ? energyAfter - energyBefore : null;
    report.share = { ok: true, points: delta, shareUrl: report.shareUrl };
    return { ok: true, points: delta, shareUrl: report.shareUrl };
  } catch (error) {
    // 兜底文章重试
    if (config.fallbackArticleId && config.articleId !== config.fallbackArticleId) {
      try {
        context.config = Object.assign({}, context.config, {
          articleId: config.fallbackArticleId,
          shareContentURL: buildShareUrl(config.fallbackArticleId),
        });
        const shareCode = await obtainShareCode(context);
        await postShareReporting(context, shareCode);
        report.shareCode = shareCode;
        report.shareUrl = buildShareUrl(config.fallbackArticleId);
        report.share = { ok: true, fallback: true, shareUrl: report.shareUrl };
        return { ok: true, fallback: true, shareUrl: report.shareUrl };
      } catch (fallbackError) {
        report.shareError = fallbackError;
        return { ok: false, message: fallbackError.message };
      }
    }
    report.shareError = error;
    return { ok: false, message: error.message };
  }
}

/* ---------------- 汇总 ---------------- */

function summarizeTask(name, result) {
  if (!result) return name + ": skipped";
  if (result.ok) {
    if (result.already) return name + ": ok (already)";
    if (result.points != null) {
      // 分享：points>0 = 已有人当日浏览加分；points=0 = 动作完成待浏览（正常）
      return name + ": ok" + (result.points > 0 ? " (+" + result.points + " 浏览加分)" : " (待浏览)");
    }
    return name + ": ok";
  }
  return name + ": failed (" + shorten(result.message) + ")";
}

function shorten(text) {
  const value = String(text || "");
  return value.length > 160 ? value.slice(0, 157) + "..." : value;
}

function buildSummary(report, config) {
  const parts = [summarizeTask("Sign", report.sign)];
  if (config.shareEnabled) {
    parts.push(summarizeTask("Share", report.share));
    if (report.shareUrl && report.share && report.share.ok) {
      parts.push("link=" + report.shareUrl);
    }
  }
  return parts.join(" | ");
}

/**
 * 每日主流程：续期 → 签到 → 分享 → 汇总
 * @returns {string} 摘要（用于通知）
 */
async function runDailyTasks(context) {
  const report = { sign: null, share: null };
  const config = context.config;

  // 1) 续期（失败不阻断，旧 token 可能仍可用）
  if (context.tokenState.refreshToken) {
    try {
      const refreshed = await refreshToken(context, context.tokenState.refreshToken);
      if (refreshed && refreshed.token) {
        context.tokenState = Object.assign({}, context.tokenState, refreshed);
        writeTokenState(context.store, context.tokenState);
      }
    } catch (error) {
      report.refreshError = error;
    }
  }

  // 2) 签到
  const signResult = await runSignTask(context, report);

  // 3) 分享
  let shareResult = null;
  if (config.shareEnabled) {
    shareResult = await runShareTask(context, report);
  }

  const summary = buildSummary(report, config);

  // 4) 诊断信息
  let diagnostic = "";
  if (config.debug) {
    const details = [];
    if (report.refreshError) {
      details.push("refresh=" + shorten(report.refreshError.message));
    }
    if (report.signError) {
      details.push("signErr=" + shorten(report.signError.message));
    }
    if (report.shareError) {
      details.push("shareErr=" + shorten(report.shareError.message));
    }
    if (report.energyBefore != null || report.energyAfter != null) {
      details.push("energy=" + report.energyBefore + "->" + report.energyAfter);
    }
    if (report.shareCode) {
      details.push("shareCode=" + report.shareCode);
    }
    details.push("token=" + summarizeTokenState(context.tokenState));
    diagnostic = details.join(" | ");
  }
  report.summary = summary;

  return { summary, diagnostic, report };
}


"use strict";

const CAPTURE_FIELD_ALIASES = {
  refreshtoken: "refreshToken",
  refresh_token: "refreshToken",
  "refresh-token": "refreshToken",
  deviceid: "deviceId",
  device_id: "deviceId",
  "device-type": "deviceType",
  devicetype: "deviceType",
  appversion: "appVersion",
  "app-version": "appVersion",
  token: "token",
  oauthaccesstoken: "oauthAccessToken",
  accesstoken: "oauthAccessToken",
  access_token: "oauthAccessToken",
  oauthrefreshtoken: "oauthRefreshToken",
  authorization: "authorization",
};

function normalizeFieldKey(key) {
  return String(key || "").toLowerCase();
}

function normalizeHeaderName(name) {
  return String(name || "").toLowerCase().replace(/[-_]/g, "");
}

function getHeader(headers, names) {
  if (!headers) return "";
  const normalizedNames = names.map(normalizeHeaderName);
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (normalizedNames.includes(normalizeHeaderName(key))) return headers[key] || "";
  }
  return "";
}

function parseQueryString(text) {
  const result = {};
  const query = String(text || "").replace(/^\?/, "");
  if (!query) return result;
  query.split("&").forEach((entry) => {
    if (!entry) return;
    const parts = entry.split("=");
    const key = (parts.shift() || "").trim();
    if (!key) return;
    try {
      result[decodeURIComponent(key)] = decodeURIComponent(parts.join("="));
    } catch (error) {
      result[key] = parts.join("=");
    }
  });
  return result;
}

function setCapturedField(result, key, value) {
  const canonical = CAPTURE_FIELD_ALIASES[normalizeFieldKey(key)];
  if (canonical && value != null && String(value) && !result[canonical]) {
    result[canonical] = String(value);
  }
}

function collectFromObject(value, result) {
  if (!value || typeof value !== "object") return;
  Object.keys(value).forEach((key) => {
    setCapturedField(result, key, value[key]);
    const nested = value[key];
    if (nested && typeof nested === "object") collectFromObject(nested, result);
  });
}

function collectFromBody(body, result) {
  if (body == null) return;
  if (typeof body === "string") {
    if (!body) return;
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      parsed = null;
    }
    if (parsed && typeof parsed === "object") {
      collectFromObject(parsed, result);
    } else {
      const query = parseQueryString(body);
      Object.keys(query).forEach((key) => setCapturedField(result, key, query[key]));
    }
    return;
  }
  collectFromObject(body, result);
}

function collectFromUrl(url, result) {
  if (!url) return;
  const questionIndex = String(url).indexOf("?");
  if (questionIndex < 0) return;
  const query = parseQueryString(String(url).slice(questionIndex + 1));
  Object.keys(query).forEach((key) => setCapturedField(result, key, query[key]));
}

/** 从请求/响应中提取认证字段 */
function extractCaptureFields(request, response) {
  const requestObject = request || {};
  const responseObject = response || {};
  const result = {};

  collectFromUrl(requestObject.url || responseObject.url || "", result);
  collectFromBody(requestObject.body, result);
  collectFromBody(responseObject.body, result);

  const headers = requestObject.headers || responseObject.headers || {};
  const headerPairs = [
    ["refreshToken", ["refreshToken", "refresh-token", "refresh_token", "x-auth-token"]],
    ["deviceId", ["deviceId", "device-id", "device_id", "deviceIdToken"]],
    ["token", ["token"]],
    ["oauthAccessToken", ["oauthAccessToken", "oauth-access-token", "accessToken", "access-token"]],
    ["oauthRefreshToken", ["oauthRefreshToken", "oauth-refresh-token", "oauth-refresh_token"]],
    ["authorization", ["authorization"]],
  ];
  headerPairs.forEach(([field, names]) => {
    const headerValue = getHeader(headers, names);
    if (headerValue && !result[field]) result[field] = headerValue;
  });

  return result;
}

function capturedFingerprint(fields) {
  return [
    fields.refreshToken || "",
    fields.token || "",
    fields.oauthAccessToken || "",
    fields.authorization || "",
  ].join("|");
}

/* ---------------- 捕获处理 ---------------- */

function handleCapture(input) {
  const { config, request, response, store, notification } = input;
  const captured = extractCaptureFields(request, response);
  const hasCaptured = Boolean(
    captured.refreshToken || captured.token ||
    captured.oauthAccessToken || captured.oauthRefreshToken || captured.authorization,
  );
  if (!hasCaptured) {
    if (config.debug) {
      console.log("LynkCo no capturable fields in traffic");
    }
    return { captured: false };
  }

  const previous = readTokenState(store);
  const merged = Object.assign({}, previous, captured);
  const fingerprintChanged = capturedFingerprint(merged) !== capturedFingerprint(previous);
  writeTokenState(store, merged);

  // 捕获通知默认关闭（captureNotify=1 时开启；需要重抓 token 时临时打开）
  if (config.captureNotify) {
    const body = JSON.stringify({
      capturedAt: new Date().toISOString(),
      source: response ? "response" : "request",
      refreshToken: merged.refreshToken || "",
      deviceId: merged.deviceId || "",
      deviceType: merged.deviceType || "",
      appVersion: merged.appVersion || "",
      token: merged.token ? merged.token.slice(0, 12) + "..." : "",
      authorization: merged.authorization ? merged.authorization.slice(0, 16) + "..." : "",
    });
    postNotification(notification, "LynkCo Token Captured", body, "");
  }
  return { captured: true, tokenState: merged };
}

/* ---------------- 定时任务处理 ---------------- */

function handleCron(input) {
  const { config, store, notification, httpClient } = input;
  const now = input.now || new Date();
  const today = localDayKey(now);

  const storedToken = readTokenState(store);
  const configToken = config.refreshToken || "";
  const tokenState = Object.assign({}, storedToken);
  if (configToken && !tokenState.refreshToken) tokenState.refreshToken = configToken;
  if (config.deviceId && !tokenState.deviceId) tokenState.deviceId = config.deviceId;
  if (config.deviceType && !tokenState.deviceType) tokenState.deviceType = config.deviceType;
  if (config.appVersion && !tokenState.appVersion) tokenState.appVersion = config.appVersion;

  if (!hasTokenState(tokenState)) {
    const daily = readDailyState(store);
    if (daily.date !== today) {
      writeDailyState(store, { date: today, success: false, attempt: "no-token" });
      postNotification(notification, "LynkCo Daily", "No token saved.", "Open Lynk & Co once to capture token.");
    }
    return Promise.resolve();
  }

  if (config.oncePerDay) {
    const daily = readDailyState(store);
    if (daily.date === today && daily.success) {
      // 今日已完成：不再静默跳过，发一条简短确认（手动执行时能立即看到反馈）
      postNotification(notification, "LynkCo Daily", "Already done today, skip.", "");
      return Promise.resolve();
    }
  }

  const context = {
    config,
    tokenState,
    httpClient,
    store,
    notification,
    now,
  };

  return runDailyTasks(context)
    .then(({ summary, diagnostic }) => {
      writeDailyState(store, {
        date: today,
        success: summary.includes("Sign: ok") && (!config.shareEnabled || summary.includes("Share: ok")),
        attempt: summary,
      });
      writeLastResult(store, summary);
      postNotification(notification, "LynkCo Daily", summary, diagnostic);
    })
    .catch((error) => {
      writeDailyState(store, { date: today, success: false, attempt: "exception" });
      postNotification(notification, "LynkCo Daily", "Daily run failed: " + error.message, "");
    });
}

/* ---------------- 入口 ---------------- */

function runMain() {
  const request = typeof $request !== "undefined" ? $request : null;
  const response = typeof $response !== "undefined" ? $response : null;
  const store = $persistentStore;
  const notification = $notification;
  const httpClient = $httpClient;
  const argument = typeof $argument !== "undefined" ? $argument : "";
  const done = typeof $done !== "undefined" ? $done : function noop() {};
  const config = buildConfig(argument);

  const isCaptureTrigger = Boolean(request || response);

  // 完成所有异步任务后才调用 $done()。
  // 重要：Loon 调用 $done() 后会销毁脚本环境，若在异步请求完成前结束脚本，
  // 网络请求与通知会被中断（表现为"手动执行没反应"）。
  const finish = () => done({});

  const runCron = (input) => {
    const result = handleCron(input);
    if (result && typeof result.then === "function") {
      result.then(finish, finish);
    } else {
      finish();
    }
  };

  if (isCaptureTrigger) {
    const captured = handleCapture({ config, request, response, store, notification });
    if (captured.captured && config.autoRunOnCapture) {
      runCron({ config, store, notification, httpClient, now: new Date(), forceRun: true });
    } else {
      finish();
    }
    return;
  }

  runCron({ config, store, notification, httpClient, now: new Date() });
}

runMain();

