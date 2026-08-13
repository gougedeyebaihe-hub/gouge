/**
 * crypto.js — 纯 JS 加密原语（兼容 Loon 的 JavaScriptCore 环境，无 WebCrypto/Node API）
 *
 * 提供：UTF-8 编码、SHA-256、HMAC-SHA256、MD5、Base64、随机数/Nonce
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
