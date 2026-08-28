/**
 * Lynk & Co Auto Sign & Share — Loon bundle
 * v20260828-refactor22
 * 纯定时式：捕获一次 token 后，每天 cron 自动签到 + 文章分享；generic 可手动触发。
 * 包含两套网关签名（H5 大写 X-Ca-* / 原生 SDK 小写 x-ca-* + Content-MD5）。
 * 由 src/ 模块构建生成，请勿直接编辑本文件。
 */
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



/** 东八区时间分量（UTC+8，不依赖设备时区） */
function east8Parts(date) {
  const local = new Date((date || new Date()).getTime() + 8 * 60 * 60 * 1000);
  return {
    year: local.getUTCFullYear(),
    month: String(local.getUTCMonth() + 1).padStart(2, "0"),
    day: String(local.getUTCDate()).padStart(2, "0"),
    hours: String(local.getUTCHours()).padStart(2, "0"),
    minutes: String(local.getUTCMinutes()).padStart(2, "0"),
    seconds: String(local.getUTCSeconds()).padStart(2, "0"),
  };
}

/** 东八区日期键 YYYY-MM-DD */
function east8DayKey(date) {
  const parts = east8Parts(date);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

/** 东八区完整时间 "YYYY-MM-DD HH:mm:ss" */
function east8DateTime(date) {
  const parts = east8Parts(date);
  return (
    parts.year + "-" + parts.month + "-" + parts.day + " " +
    parts.hours + ":" + parts.minutes + ":" + parts.seconds
  );
}


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

/** 东八区 "YYYY-MM-DD HH:mm:ss"（分享风控 openTimeStamp 用，与领克中国区服务端口径一致） */
function formatRiskOpenTime(date) {
  return east8DateTime(date);
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
 * @returns {object} { signString, contentMd5 }
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



/* 领克网关密钥表（X-Ca-Key → AppSecret）。
 * 来源（2026-08 现场核实）：
 *   - 204644386/QCl7udM3... 为 H5 前端 vendor JS 明文密钥对（crypto-js HmacSHA256 直接使用，
 *     2026-08 抓取 h5.lynkco.com 的 vendor.c0eb609d.js 确认仍在线使用，可能多密钥并存），
 *     最初经 Loon MitM 抓取 H5 JS 提取；
 *   - 203760416/e1msl9aqd... 为当前脚本生效密钥对（与 rulaizhi/LynkCoHelper 2021 config.json 同值，
 *     来源为当时抓取的 JS 版本或公开仓库，无法完全还原）。
 * 提取方法：轮换时用 Loon MitM 抓 H5 vendor JS，从签名实现中读明文密钥对（无需 root 逆向），
 * 详见 docs/protocol.md。 */
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

/** 解析 "?a=1&b=2" 形式文本为对象（URL query / 表单体 / 参数串）。
 * options.decode=false 时不做转义解码（参数串形态，保持原 parseArgument 行为）。 */
function parseQueryString(text, options) {
  const result = {};
  const query = String(text || "").replace(/^\?/, "");
  if (!query) return result;
  const decodeValues = !options || options.decode !== false;
  query.split("&").forEach((entry) => {
    if (!entry) return;
    const parts = entry.split("=");
    const key = (parts.shift() || "").trim();
    if (!key) return;
    const value = parts.join("=");
    if (!decodeValues) {
      result[key] = value.trim();
      return;
    }
    try {
      result[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch (error) {
      result[key] = value;
    }
  });
  return result;
}

function parseArgument(argument) {
  if (!argument) return {};
  if (typeof argument === "object") return argument; // [Argument] 控件对象形态
  return parseQueryString(argument, { decode: false }); // "key=value&key2=value2" 字符串形态
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
  const source = parseArgument(argument);
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



const TOKEN_STATE_KEY = "lynkco.share.tokenState";
const DAILY_STATE_KEY = "lynkco.share.dailyState";
const SHARE_VALIDATION_KEY = "lynkco.share.shareValidation";

/** 统一的容错写入（$persistentStore.write 失败不阻断流程） */
function safeWrite(store, key, value) {
  if (!store || !store.write) return;
  try {
    store.write(value, key);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

function emptyTokenState() {
  return {
    token: "",
    refreshToken: "",
    backupRefreshToken: "", // 捕获覆盖前的旧 refreshToken（refresh 失败时回退用）
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
  // store.read 本身也可能抛错（与 readDailyState 的防护对称，保证 $done 必达路径不遗漏）
  let raw = "";
  if (store && store.read) {
    try {
      raw = store.read(TOKEN_STATE_KEY) || "";
    } catch (error) {
      raw = "";
    }
  }
  return parseTokenState(raw);
}

function writeTokenState(store, tokenState) {
  safeWrite(store, TOKEN_STATE_KEY, serializeTokenState(tokenState));
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

/* ---------------- 每日状态（oncePerDay + 执行冷却用） ---------------- */

function readDailyState(store) {
  if (!store || !store.read) return { date: "", success: false, attempt: "", lastStartedAt: 0 };
  try {
    const parsed = JSON.parse(store.read(DAILY_STATE_KEY) || "");
    return {
      date: parsed.date || "",
      success: Boolean(parsed.success),
      attempt: parsed.attempt || "",
      lastStartedAt: Number(parsed.lastStartedAt) || 0,
    };
  } catch (error) {
    return { date: "", success: false, attempt: "", lastStartedAt: 0 };
  }
}

function writeDailyState(store, state) {
  safeWrite(store, DAILY_STATE_KEY, JSON.stringify(state));
}

/** 本地日期键 YYYY-MM-DD（东八区，与分享风控时间戳同口径） */
function localDayKey(date) {
  return east8DayKey(date);
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
  if (!validation || !validation.certifyId) return;
  safeWrite(store, SHARE_VALIDATION_KEY, JSON.stringify({
    capturedAt: validation.capturedAt || new Date().toISOString(),
    certifyId: validation.certifyId,
    challenge: validation.challenge || "",
    riskValidateInfo: validation.riskValidateInfo || "",
    source: validation.source || "security-config",
  }));
}



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

/** $httpClient 回调 error 可能是字符串或对象，统一转可读文本（避免 "[object Object]"） */
function requestErrorText(error) {
  if (error == null) return "unknown error";
  if (typeof error === "string") return error;
  if (error && error.message) return error.message;
  return String(error);
}

function requestAsync(httpClient, method, params) {
  return new Promise((resolve, reject) => {
    httpClient[method](params, (error, response, data) => {
      if (error) {
        reject(new Error(requestErrorText(error)));
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

/** 失效类业务码（refreshToken/token 无效或过期）——任务链应短路并提示重新捕获 */
const INVALID_CREDENTIAL_CODES = [
  "user_refresh_invalid_expired",
  "user_refresh_invalid",
  "user_token_invalid",
  "user_token_expired",
  "token_invalid",
  "token_expired",
  "expired_refresh_token",
];

function isInvalidCredentialPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const code = payload.code || payload.status || "";
  const text = String(code).toLowerCase();
  if (!text) return false;
  return INVALID_CREDENTIAL_CODES.some((item) => text.includes(item)) || text.includes("invalid");
}

function isSuccessMarker(value) {
  if (value == null || value === "") return true;
  if (typeof value === "number") return value === 0 || value === 200;
  return ["0", "200", "success", "ok", "true"].includes(String(value).trim().toLowerCase());
}

function getBusinessFailureMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.success === false) return getApiMessage(payload) || "业务校验失败";
  if (!isSuccessMarker(payload.code)) return getApiMessage(payload) || "业务码 " + payload.code;
  if (!isSuccessMarker(payload.status)) return getApiMessage(payload) || "状态 " + payload.status;
  return "";
}

function assertSuccessfulHttp(response, label, payload, data) {
  const status = getHttpStatus(response);
  if (status && (status < 200 || status >= 300)) {
    const apiMessage = getApiMessage(payload);
    const bodySummary = summarizeBody(data);
    throw new Error(
      label + " 失败 HTTP " + status +
      (apiMessage ? ": " + apiMessage : bodySummary ? ": " + bodySummary : "."),
    );
  }
  const businessFailureMessage = getBusinessFailureMessage(payload);
  if (businessFailureMessage) throw new Error(label + " 失败：" + businessFailureMessage);
}

/** 截断长文本（用于错误信息/诊断摘要） */
function truncate(text, maxLength) {
  const value = String(text || "");
  const max = maxLength || 200;
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

function summarizeBody(data) {
  if (typeof data !== "string") return "";
  const trimmed = data.trim();
  if (!trimmed) return "";
  return truncate(trimmed, 200);
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

/** 每个请求独立 nonce/timestamp/date（date 为 RFC1123 GMT，签名串与请求头共用同一值） */
function freshRequestContext(context) {
  return Object.assign({}, context, {
    nonce: createNonce(),
    timestamp: String(Date.now()),
    date: httpDate(),
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
    date: context.date,
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
        date: context.date,
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

/** 从响应中提取 centerTokenDto；无效时返回 null。fallbacks 提供旧值兜底（refreshToken 等） */
function extractCenterTokenDto(payload, fallbacks) {
  const dto = payload && payload.data && payload.data.centerTokenDto;
  if (!dto || !dto.token) return null;
  return {
    token: dto.token,
    refreshToken: dto.refreshToken || fallbacks.refreshToken,
    expireAt: dto.expireAt || 0,
    oauthAccessToken: fallbacks.oauthAccessToken || "",
    oauthRefreshToken: fallbacks.oauthRefreshToken || "",
    authorization: fallbacks.authorization || "",
    deviceId: fallbacks.deviceId || "",
    deviceType: fallbacks.deviceType || "IOS",
  };
}

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
  const fallbacks = {
    refreshToken: refreshTokenValue,
    oauthAccessToken: tokenState.oauthAccessToken || "",
    oauthRefreshToken: tokenState.oauthRefreshToken || "",
    authorization: tokenState.authorization || "",
    deviceId: tokenState.deviceId || config.deviceId || "",
    deviceType: tokenState.deviceType || config.deviceType || "IOS",
  };

  const lastErrors = [];
  let invalidCredentialSeen = false;
  for (let i = 0; i < AUTH_HOSTS.length; i += 1) {
    const host = AUTH_HOSTS[i];
    const uri = "/auth/login/refresh?" + query;
    const url = "https://" + host + uri;

    // 每域两种认证尝试：APPCODE 静态认证 → 原生签名（两种返回解析共用 extractCenterTokenDto）
    const attempts = [
      {
        label: host + " appcode",
        build: () => ({
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
        }),
      },
      {
        label: host + " native",
        build: () => {
          const attemptContext = freshRequestContext(context);
          const signed = buildNativeSignString({
            method: "GET",
            uri,
            body: "",
            xCaKey: config.xCaKey,
            nonce: attemptContext.nonce,
            timestamp: attemptContext.timestamp,
            date: attemptContext.date,
            extraCaHeaders: config.nativeExtraCaHeaders,
          });
          return {
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
                date: attemptContext.date,
                signature: signBase64HmacSha256(config.appSecret, signed.signString),
                contentMd5: signed.contentMd5,
              }),
            ),
          };
        },
      },
    ];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      try {
        const result = await requestAsync(context.httpClient, "get", attempt.build());
        const payload = parseJson(result.data);
        if (isInvalidCredentialPayload(payload)) invalidCredentialSeen = true;
        const refreshed = extractCenterTokenDto(payload, fallbacks);
        if (refreshed) return refreshed;
        lastErrors.push(attempt.label + ": " + summarizeBody(result.data));
      } catch (error) {
        lastErrors.push(attempt.label + ": " + error.message);
      }
    }
  }

  const error = new Error("刷新令牌失败：" + lastErrors.slice(0, 3).join(" || "));
  error.refreshFailed = true;
  error.invalidCredential = invalidCredentialSeen ? true : false;
  throw error;
}

/* ---------------- 签到 ---------------- */

/** 查询今日签到状态（H5 签名） */
async function getSignDayInfo(context) {
  return h5Request(context, {
    method: "GET",
    host: BUSINESS_HOST,
    uri: "/up/api/v1/user/sign/day/info",
    label: "查询签到状态",
  });
}

/** 执行签到（原生 SDK 签名，body 固定 "{}"） */
async function postSignUpgrade(context) {
  return nativeRequest(context, {
    method: "POST",
    host: BUSINESS_HOST,
    uri: "/up/api/v1/user/sign/upgrade",
    body: "{}",
    label: "执行签到",
    extraHeaders: { use_security: "true" },
  });
}

/** 我的能量/积分（H5 签名），用于分享前后对比 */
async function getMyEnergy(context) {
  return h5Request(context, {
    method: "GET",
    host: BUSINESS_HOST,
    uri: "/app/energy/myEnergy",
    label: "查询积分",
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
        label: "安全配置",
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
  const error = new Error("安全配置获取失败：" + lastErrors.slice(0, 3).join(" || "));
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
    label: "获取分享码",
    extraHeaders,
  });
  const payload = result.payload;
  if (!payload || typeof payload !== "object") throw new Error("获取分享码响应不是有效 JSON。");
  if (!payload.data) throw new Error(payload.message || "获取分享码响应缺少数据。");
  return payload.data;
}

/** 上报分享（H5 签名 + Origin h5.lynkco.com） */
async function postShareReporting(context, shareCode) {
  const result = await h5Request(context, {
    method: "POST",
    host: SHARE_HOST,
    uri: "/app/v1/task/shareReporting?shareCode=" + encodeURIComponent(shareCode),
    label: "分享上报",
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
    label: "文章列表",
  });
  const data = result.payload && result.payload.data;
  if (!data || typeof data !== "object") throw new Error("文章列表响应无效。");
  const dynamics = data.userByteDynamicsResponseDTOS;
  if (!Array.isArray(dynamics) || dynamics.length === 0) {
    throw new Error("文章列表为空。");
  }
  for (let i = 0; i < dynamics.length; i += 1) {
    const item = dynamics[i];
    if (!item || typeof item !== "object") continue;
    const articleId = item.dynamicId || item.id || item.articleId || item.contentId;
    if (!articleId) continue;
    return String(articleId);
  }
  throw new Error("文章列表中没有可用文章 ID。");
}



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
    const message = getApiMessage(payload);
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
      report.signError = new Error("签到接口返回成功，但复查仍显示未签到。");
      report.sign = { ok: false, message: "签到未确认" };
      return { ok: false, message: "签到未确认" };
    }
    return { ok: true };
  } catch (error) {
    // 失败必须显式写入 report.sign（否则汇总显示 "skipped"，误导为"跳过"）
    report.signError = error;
    report.sign = { ok: false, message: error.message };
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
        "获取分享码失败：需要人机验证。请打开领克 App 手动分享一次后重试。",
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
        "获取分享码失败：需要人机验证。请打开领克 App 手动分享一次后重试。",
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
 *   "分享动作（getShareCode + shareReporting）→ 他人/自己当日浏览分享链接 → +5 积分"。
 * 两步法（getShareCode + shareReporting）即触发加分，加分为异步落账；
 * 因此成功标准 = 分享动作完成；即时积分对比仅作附加报告（+N 表示已确认到账）。
 */
async function runShareTask(context, report) {
  const { config } = context;

  // 构造本次分享的配置快照（避免原地改写共享 context 的隐式副作用）
  let articleId = config.articleId;
  const taskConfig = Object.assign({}, config);
  try {
    if (articleId) {
      taskConfig.shareContentURL = buildShareUrl(articleId);
    } else {
      articleId = await getFirstArticle(context);
      taskConfig.articleId = articleId;
    }
    const shareContext = Object.assign({}, context, { config: taskConfig });

    // 分享前积分
    let energyBefore = null;
    try {
      const before = await getMyEnergy(shareContext);
      energyBefore = extractPoint(before.payload);
    } catch (error) {
      // 积分查询失败不阻断分享
    }

    const shareCode = await obtainShareCode(shareContext);
    await postShareReporting(shareContext, shareCode);

    // 分享后积分对比（即时查询，仅作附加报告）
    let energyAfter = null;
    try {
      const after = await getMyEnergy(shareContext);
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
        const fallbackConfig = Object.assign({}, taskConfig, {
          articleId: config.fallbackArticleId,
          shareContentURL: buildShareUrl(config.fallbackArticleId),
        });
        const fallbackContext = Object.assign({}, context, { config: fallbackConfig });
        const shareCode = await obtainShareCode(fallbackContext);
        await postShareReporting(fallbackContext, shareCode);
        report.shareCode = shareCode;
        report.shareUrl = buildShareUrl(config.fallbackArticleId);
        report.share = { ok: true, fallback: true, shareUrl: report.shareUrl };
        return { ok: true, fallback: true, shareUrl: report.shareUrl };
      } catch (fallbackError) {
        report.shareError = fallbackError;
        report.share = { ok: false, message: fallbackError.message };
        return { ok: false, message: fallbackError.message };
      }
    }
    // 失败必须显式写入 report.share（否则汇总显示 "skipped"，误导为"跳过"）
    report.shareError = error;
    report.share = { ok: false, message: error.message };
    return { ok: false, message: error.message };
  }
}

/* ---------------- 汇总 ---------------- */

function summarizeTask(name, result) {
  if (!result) return name + "：跳过";
  if (result.ok) {
    if (result.already) return name + "：成功（今日已完成）";
    if (result.points != null) {
      // 分享：两步法（getShareCode + shareReporting）即触发加分，加分为异步落账；
      // points>0 表示复查时已确认到账，否则保持中性提示（跨日确认在次日通知中报告）
      return name + "：成功" + (result.points > 0 ? "（+" + result.points + " 已到账）" : "");
    }
    return name + "：成功";
  }
  return name + "：失败（" + truncate(result.message, 160) + "）";
}

function buildSummary(report, config) {
  const parts = [summarizeTask("签到", report.sign)];
  if (config.shareEnabled) {
    parts.push(summarizeTask("分享", report.share));
  }
  return parts.join(" | ");
}

/** 诊断信息进入通知前剥离已知敏感值（服务端错误响应可能回显凭证） */
function redactSensitive(text, tokenState) {
  let output = String(text || "");
  [
    tokenState.refreshToken,
    tokenState.backupRefreshToken,
    tokenState.token,
    tokenState.authorization,
    tokenState.oauthAccessToken,
    tokenState.oauthRefreshToken,
  ].forEach((value) => {
    if (value && value.length >= 6) output = output.split(value).join("***");
  });
  return output;
}

/**
 * 每日主流程：续期 → 签到 → 分享 → 汇总
 * @returns {string} 摘要（用于通知）
 */
async function runDailyTasks(context) {
  const report = { sign: null, share: null };
  const config = context.config;

  // 1) 续期（主失败回退 backup；失败原因属"凭证失效"时短路后续任务）
  //    凭证是签到/分享的前置条件：refreshToken 无效时旧 token 不可信，继续执行只会
  //    产生误导性结果（如 Sign: skipped / Share: ok 但实际未生效），应直接提示重新捕获。
  let refreshInvalid = false;
  if (context.tokenState.refreshToken) {
    try {
      const refreshed = await refreshToken(context, context.tokenState.refreshToken);
      if (refreshed && refreshed.token) {
        context.tokenState = Object.assign({}, context.tokenState, refreshed);
        writeTokenState(context.store, context.tokenState);
      }
    } catch (error) {
      refreshInvalid = error.invalidCredential === true;
      if (context.tokenState.backupRefreshToken) {
        try {
          const refreshed = await refreshToken(context, context.tokenState.backupRefreshToken);
          if (refreshed && refreshed.token) {
            context.tokenState = Object.assign({}, context.tokenState, refreshed, { backupRefreshToken: "" });
            writeTokenState(context.store, context.tokenState);
            refreshInvalid = false;
          }
        } catch (backupError) {
          refreshInvalid = refreshInvalid || backupError.invalidCredential === true;
          report.refreshError = error;
        }
      } else {
        report.refreshError = error;
      }
    }
  }

  if (refreshInvalid) {
    const refreshMessage = report.refreshError ? report.refreshError.message : "刷新令牌无效。";
    return {
      summary: "登录凭证已失效，请打开领克 App 操作一次以自动重新捕获。",
      diagnostic: redactSensitive("refresh=" + truncate(refreshMessage, 160), context.tokenState),
      report,
    };
  }

  // 2) 签到
  const signResult = await runSignTask(context, report);

  // 3) 分享
  let shareResult = null;
  if (config.shareEnabled) {
    shareResult = await runShareTask(context, report);
  }

  const summary = buildSummary(report, config);

  // 4) 诊断信息（敏感值脱敏后进通知）
  let diagnostic = "";
  if (config.debug) {
    const details = [];
    if (report.refreshError) {
      details.push("refresh=" + truncate(report.refreshError.message, 160));
    }
    if (report.signError) {
      details.push("signErr=" + truncate(report.signError.message, 160));
    }
    if (report.shareError) {
      details.push("shareErr=" + truncate(report.shareError.message, 160));
    }
    if (report.energyBefore != null || report.energyAfter != null) {
      details.push("energy=" + report.energyBefore + "->" + report.energyAfter);
    }
    if (report.shareCode) {
      details.push("shareCode=" + report.shareCode);
    }
    details.push("token=" + summarizeTokenState(context.tokenState));
    diagnostic = redactSensitive(details.join(" | "), context.tokenState);
  }
  report.summary = summary;

  return { summary, diagnostic, report };
}



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
    if (normalizedNames.includes(normalizeHeaderName(key))) {
      const value = headers[key];
      return value == null ? "" : String(value);
    }
  }
  return "";
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
  const hasCaptured = hasTokenState(captured);
  if (!hasCaptured) {
    if (config.debug) {
      console.log("LynkCo no capturable fields in traffic");
    }
    return { captured: false };
  }

  const previous = readTokenState(store);
  // 捕获值可能来自排队/重试的旧流量：覆盖现有 refreshToken 前把旧值挪到 backup，
  // refresh 失败时可回退（避免陈旧值覆盖刚换的新 token 后无法自愈）
  const merged = Object.assign({}, previous, captured);
  if (
    captured.refreshToken &&
    previous.refreshToken &&
    captured.refreshToken !== previous.refreshToken
  ) {
    merged.backupRefreshToken = previous.refreshToken;
  }
  const fingerprintChanged = capturedFingerprint(merged) !== capturedFingerprint(previous);
  writeTokenState(store, merged);

  // 捕获通知默认关闭（captureNotify=1 时开启；需要重抓 token 时临时打开）。
  // 通知是诊断界面：所有凭证字段一律脱敏（maskValue），不在锁屏暴露完整值。
  if (config.captureNotify) {
    const body = JSON.stringify({
      capturedAt: new Date().toISOString(),
      source: response ? "response" : "request",
      refreshToken: merged.refreshToken ? maskValue(merged.refreshToken) : "",
      deviceId: merged.deviceId ? maskValue(merged.deviceId) : "",
      deviceType: merged.deviceType || "",
      appVersion: merged.appVersion || "",
      token: merged.token ? maskValue(merged.token) : "",
      authorization: merged.authorization ? maskValue(merged.authorization) : "",
      changed: fingerprintChanged,
    });
    postNotification(notification, "领克令牌已捕获", body, "");
  }
  return { captured: true, tokenState: merged };
}

/* ---------------- 定时任务处理 ---------------- */

function handleCron(input, mode) {
  const { config, store, notification, httpClient } = input;
  const now = input.now || new Date();
  const today = localDayKey(now);
  // generic 手动触发：用户主动点按 = 强制执行，绕过 oncePerDay 静默跳过
  const isManual = mode === "manual";

  // 执行中互斥：只在任务链真正执行（attempt="running"）时拦截并发触发。
  // 任务被 Loon 超时杀掉时 attempt 停在 "running"——150s 窗口（>cron timeout 120s）后
  // 视为僵尸锁自动过期，允许重新执行；任务正常结束后（attempt=结果摘要）不拦截，
  // 用户可立即再次手动触发。
  const daily = readDailyState(store);
  const runningLockMs = 150 * 1000;
  const isExecuting = daily.attempt === "running" &&
    daily.lastStartedAt && now.getTime() - daily.lastStartedAt < runningLockMs;
  if (isExecuting) {
    if (isManual) {
      postNotification(notification, "领克签到", "任务正在执行中，请稍候片刻再试。", "");
      return Promise.resolve({
        summary: "任务正在执行中，请稍候片刻再试。",
        diagnostic: "",
      });
    }
    return Promise.resolve({ summary: "任务执行中，已跳过本次触发", diagnostic: "" });
  }

  if (config.oncePerDay && !isManual) {
    if (daily.date === today && daily.success) {
      // 今日已完成，静默跳过（避免 03:01 兜底任务重复弹窗）
      return Promise.resolve({ summary: "今日已完成", diagnostic: "" });
    }
  }

  const storedToken = readTokenState(store);
  const configToken = config.refreshToken || "";
  const tokenState = Object.assign({}, storedToken);
  if (configToken && !tokenState.refreshToken) tokenState.refreshToken = configToken;
  if (config.deviceId && !tokenState.deviceId) tokenState.deviceId = config.deviceId;
  if (config.deviceType && !tokenState.deviceType) tokenState.deviceType = config.deviceType;
  if (config.appVersion && !tokenState.appVersion) tokenState.appVersion = config.appVersion;

  if (!hasTokenState(tokenState)) {
    if (daily.date !== today) {
      writeDailyState(store, { date: today, success: false, attempt: "no-token" });
      postNotification(notification, "领克签到", "未保存令牌，请打开领克 App 操作一次以自动捕获。", "");
    }
    return Promise.resolve({
      summary: "未保存令牌，请打开领克 App 操作一次以自动捕获。",
      diagnostic: "",
    });
  }

  const startedAt = now.getTime();
  writeDailyState(store, { date: today, success: false, attempt: "running", lastStartedAt: startedAt });
  console.log("[领克] 任务启动 " + today + " " + (isManual ? "（手动）" : "（定时）") + "，开始时间戳 " + startedAt);

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
        success: summary.includes("签到：成功") && (!config.shareEnabled || summary.includes("分享：成功")),
        attempt: summary,
        lastStartedAt: startedAt,
      });
      postNotification(notification, "领克签到", summary, diagnostic);
      return { summary, diagnostic };
    })
    .catch((error) => {
      writeDailyState(store, { date: today, success: false, attempt: "exception", lastStartedAt: startedAt });
      postNotification(notification, "领克签到", "每日任务失败：" + error.message, "");
      return { summary: "每日任务失败：" + error.message, diagnostic: "" };
    });
}

/* ---------------- 入口 ---------------- */

/** generic 手动触发标记（与 build.js 中 generic 脚本 tag 对应，tag 含 manual） */
const MANUAL_SCRIPT_MARKER = "manual";

/** 当前脚本名称（$script.name = 脚本 tag）；不可用时返回空串 */
function getScriptName() {
  const script = typeof $script !== "undefined" ? $script : null;
  return script && script.name ? String(script.name) : "";
}

function runMain() {
  try {
    const request = typeof $request !== "undefined" ? $request : null;
    const response = typeof $response !== "undefined" ? $response : null;
    const store = $persistentStore;
    const notification = $notification;
    const httpClient = $httpClient;
    const argument = typeof $argument !== "undefined" ? $argument : "";
    const done = typeof $done !== "undefined" ? $done : function noop() {};
    const config = buildConfig(argument);

    const isCaptureTrigger = Boolean(request || response);
    // generic 手动触发：脚本名带 manual 标记。识别失败（$script 不可用）时按 cron 路径处理，
    // 最坏情况是手动点按弹通知而非弹页，不影响定时/捕获。
    const isManualTrigger = !isCaptureTrigger && getScriptName().toLowerCase().includes(MANUAL_SCRIPT_MARKER);

    // 完成所有异步任务后才调用 $done()。
    // 重要：Loon 调用 $done() 后会销毁脚本环境，若在异步请求完成前结束脚本，
    // 网络请求与通知会被中断（表现为"手动执行没反应"）。
    const runCron = (input, mode) => {
      const result = handleCron(input, mode);
      const finish = (value) => {
        if (mode === "manual") {
          // 手动触发结果直接输出到 Loon 日志（弹窗/通知长文本显示不全）；
          // generic 仍需调用 $done 结束脚本
          const summary = (value && value.summary) || "";
          const diagnostic = (value && value.diagnostic) || "";
          console.log("[领克-手动] " + summary + (diagnostic ? "\n" + diagnostic : ""));
          done({});
        } else {
          done({});
        }
      };
      if (result && typeof result.then === "function") {
        result.then(finish, finish);
      } else {
        finish(result);
      }
    };

    if (isCaptureTrigger) {
      const captured = handleCapture({ config, request, response, store, notification });
      if (captured.captured && config.autoRunOnCapture) {
        runCron({ config, store, notification, httpClient, now: new Date() });
      } else {
        done({});
      }
      return;
    }

    if (isManualTrigger) {
      runCron({ config, store, notification, httpClient, now: new Date() }, "manual");
      return;
    }

    runCron({ config, store, notification, httpClient, now: new Date() });
  } catch (error) {
    // 兜底：任何同步异常（含未来改动引入的）都必须调用 $done，否则脚本资源泄漏
    try {
      console.log("LynkCo fatal: " + (error && error.message ? error.message : String(error)));
    } catch (ignored) {
      /* console 也不可用时静默 */
    }
    if (typeof $done !== "undefined") {
      try {
        $done({});
      } catch (ignored) {
        /* $done 抛错时无再兜底手段 */
      }
    }
  }
}

runMain();

