const TOKEN_STATE_KEY = "lynkco.share.tokenState";
const AUTO_TRIGGER_KEY = "lynkco.share.autoTrigger";
const AUTO_RUN_STATE_KEY = "lynkco.share.autoRunState";
const AUTO_RUN_LOCK_KEY = "lynkco.share.autoRunLock";
const DEFAULT_FALLBACK_ARTICLE_ID = "1881101031748870144";
const AUTO_LOCK_TTL_MS = 600000;
const SIGN_ENDPOINTS = [
  { host: "app-api-gw-toc.lynkco.com", uri: "/up/api/v1/user/sign/sign/info", mode: "info" },
];

function parseArgumentString(argument) {
  if (!argument) return {};
  return argument
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

function buildShareUrl(articleId) {
  return "https://h5.lynkco.com/app-h5/dist/web/pages/exploration/article/index.html?id=" + articleId;
}

function buildShareConfig(input) {
  const source = input || {};
  const articleId = source.articleId || "";
  const fallbackArticleId = source.fallbackArticleId || DEFAULT_FALLBACK_ARTICLE_ID;
  return {
    articleId,
    fallbackArticleId,
    shareContentURL: source.shareContentURL || (articleId ? buildShareUrl(articleId) : ""),
    shareContentType: source.shareContentType == null ? 1 : source.shareContentType,
    shareEnabled: truthyFlag(source.shareEnabled, true),
    autoRunOnCapture: truthyFlag(source.autoRunOnCapture, true),
    pingNotify: truthyFlag(source.pingNotify, false),
    debugNotify: truthyFlag(source.debugNotify, false),
    captureTraceNotify: truthyFlag(source.captureTraceNotify, false),
    signTraceNotify: truthyFlag(source.signTraceNotify, true),
    xCaKey: source.xCaKey || "204644386",
    appSecret: source.appSecret || "QCl7udM3PB9cOIOwquwPglikFQnzJRsX",
  };
}

function emptyTokenState() {
  return {
    token: "",
    refreshToken: "",
    oauthAccessToken: "",
    oauthRefreshToken: "",
    authorization: "",
  };
}

function serializeTokenState(tokenState) {
  return JSON.stringify({
    token: tokenState.token || "",
    refreshToken: tokenState.refreshToken || "",
    oauthAccessToken: tokenState.oauthAccessToken || "",
    oauthRefreshToken: tokenState.oauthRefreshToken || "",
    authorization: tokenState.authorization || "",
  });
}

function parseTokenState(raw) {
  if (!raw) return emptyTokenState();
  try {
    const parsed = JSON.parse(raw);
    return {
      token: parsed.token || "",
      refreshToken: parsed.refreshToken || "",
      oauthAccessToken: parsed.oauthAccessToken || "",
      oauthRefreshToken: parsed.oauthRefreshToken || "",
      authorization: parsed.authorization || "",
    };
  } catch (error) {
    return emptyTokenState();
  }
}

function parseJson(data) {
  if (!data || typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function findTokenState(value, path = "") {
  if (!value || typeof value !== "object") return emptyTokenState();

  const currentPath = path.toLowerCase();
  const isOAuthContext = currentPath.includes("oauth");
  const isCenterContext = currentPath.includes("center");
  const directState = {
    token: "",
    refreshToken: "",
    oauthAccessToken: value.oauthAccessToken || value.accessToken || value.access_token || "",
    oauthRefreshToken:
      value.oauthRefreshToken || (isOAuthContext ? (value.refreshToken || value.refresh_token || "") : ""),
    authorization: value.authorization || value.Authorization || "",
  };

  if (isCenterContext || !isOAuthContext) {
    directState.token = value.token || "";
    directState.refreshToken = value.refreshToken || value.refresh_token || "";
  }

  Object.keys(value).forEach((key) => {
    const nestedPath = currentPath ? currentPath + "." + key : key;
    const nestedState = findTokenState(value[key], nestedPath);
    directState.token = directState.token || nestedState.token;
    directState.refreshToken = directState.refreshToken || nestedState.refreshToken;
    directState.oauthAccessToken = directState.oauthAccessToken || nestedState.oauthAccessToken;
    directState.oauthRefreshToken = directState.oauthRefreshToken || nestedState.oauthRefreshToken;
    directState.authorization = directState.authorization || nestedState.authorization;
  });

  return directState;
}

function extractBodyTokenState(body) {
  return findTokenState(parseJson(body));
}

function normalizeHeaderName(name) {
  return String(name || "").toLowerCase().replace(/[-_]/g, "");
}

function getHeader(headers, names) {
  if (!headers) return "";
  const normalizedNames = names.map(normalizeHeaderName);
  const keys = Object.keys(headers);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (normalizedNames.includes(normalizeHeaderName(key))) return headers[key] || "";
  }
  return "";
}

function maskValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return text.slice(0, 2) + "***";
  return text.slice(0, 4) + "..." + text.slice(-4);
}

function summarizeSignRequestHeaders(request) {
  const headers = (request && request.headers) || {};
  const parts = [
    "xCaKey=" + (getHeader(headers, ["X-Ca-Key"]) || "missing"),
    "sig=" + maskValue(getHeader(headers, ["X-Ca-Signature"])),
    "sigHeaders=" + (getHeader(headers, ["X-Ca-Signature-Headers"]) || "missing"),
    "timestamp=" + maskValue(getHeader(headers, ["X-Ca-Timestamp"])),
    "nonce=" + maskValue(getHeader(headers, ["X-Ca-Nonce"])),
    "token=" + (getHeader(headers, ["token"]) ? "yes" : "no"),
    "oauth=" + (getHeader(headers, ["oauthAccessToken", "oauth-access-token", "accessToken", "access-token"]) ? "yes" : "no"),
    "auth=" + (getHeader(headers, ["authorization"]) ? "yes" : "no"),
  ];
  return parts.join(", ");
}

function isSignInfoUrl(url) {
  return String(url || "").toLowerCase().includes("/up/api/v1/user/sign/sign/info");
}

function extractRequestTokenState(request) {
  if (!request || !request.url) return emptyTokenState();
  const headers = request.headers || {};
  let refreshToken = "";
  try {
    refreshToken = new URL(request.url).searchParams.get("refreshToken") || "";
  } catch (error) {
    refreshToken = "";
  }

  return {
    token: getHeader(headers, ["token"]),
    refreshToken,
    oauthAccessToken: getHeader(headers, ["oauthAccessToken", "oauth-access-token", "accessToken", "access-token"]),
    oauthRefreshToken: getHeader(headers, ["oauthRefreshToken", "oauth-refresh-token", "refreshToken", "refresh-token"]),
    authorization: getHeader(headers, ["authorization"]),
  };
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

function mergeTokenState(previousState, nextState) {
  return {
    token: nextState.token || previousState.token || "",
    refreshToken: nextState.refreshToken || previousState.refreshToken || "",
    oauthAccessToken: nextState.oauthAccessToken || previousState.oauthAccessToken || "",
    oauthRefreshToken: nextState.oauthRefreshToken || previousState.oauthRefreshToken || "",
    authorization: nextState.authorization || previousState.authorization || "",
  };
}

function summarizeCapturedFields(tokenState) {
  return [
    tokenState.token ? "token" : "",
    tokenState.refreshToken ? "refreshToken" : "",
    tokenState.oauthAccessToken ? "oauthAccessToken" : "",
    tokenState.oauthRefreshToken ? "oauthRefreshToken" : "",
    tokenState.authorization ? "authorization" : "",
  ].filter(Boolean);
}

function shouldTraceRequest(url) {
  return Boolean(url);
}

function classifyTraceUrl(method, url) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const normalizedUrl = String(url || "").toLowerCase();
  const usefulMarkers = [
    "/up/api/v1/user/sign/sign/info",
    "/up/api/v1/userreward/gettasklist",
    "/up/api/v1/userreward/getcontinuedaysandsigncard",
    "/up/api/v1/usersigntip/gettipconfig",
    "/app/v1/task/",
    "/app/energy/",
    "/reporting?type=",
  ];
  const maybeMarkers = [
    "/auth/user/info",
    "/auth/login/refresh",
    "/partnermanager/",
    "/privilege",
    "/reward",
    "/sign",
    "/task",
    "/energy",
    "/point",
  ];

  if (usefulMarkers.some((marker) => normalizedUrl.includes(marker))) {
    return normalizedMethod === "OPTIONS" ? "maybe" : "useful";
  }
  if (maybeMarkers.some((marker) => normalizedUrl.includes(marker))) {
    return "maybe";
  }
  return "noise";
}

function buildTraceSummary(method, url) {
  if (!url) return "";
  const compactUrl = String(url).replace(/^https?:\/\/[^/]+/i, "");
  return String(method || "GET").toUpperCase() + " " + compactUrl;
}

function localDayKey(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, "0"),
    String(local.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseAutoRunState(raw) {
  if (!raw) return { lastRunDate: "", lastResult: "" };
  try {
    const parsed = JSON.parse(raw);
    return {
      lastRunDate: parsed.lastRunDate || "",
      lastResult: parsed.lastResult || "",
    };
  } catch (error) {
    return { lastRunDate: "", lastResult: "" };
  }
}

function parseAutoTrigger(raw) {
  if (!raw) return { date: "", capturedAt: "" };
  try {
    const parsed = JSON.parse(raw);
    return {
      date: parsed.date || "",
      capturedAt: parsed.capturedAt || "",
    };
  } catch (error) {
    return { date: "", capturedAt: "" };
  }
}

function parseAutoRunLock(raw) {
  if (!raw) return { date: "", startedAt: 0 };
  try {
    const parsed = JSON.parse(raw);
    return {
      date: parsed.date || "",
      startedAt: Number(parsed.startedAt || 0),
    };
  } catch (error) {
    return { date: "", startedAt: 0 };
  }
}

function shouldStartAutoRun(input) {
  if (!input.config.autoRunOnCapture) return { ok: false, reason: "disabled" };
  if (!input.detectedTokenNow && !input.triggeredByUsefulRequest) {
    return { ok: false, reason: "no token detected in this script run" };
  }
  if (!input.tokenState.token) return { ok: false, reason: "missing token" };

  const today = localDayKey(input.now);
  const lock = parseAutoRunLock(input.store.read(AUTO_RUN_LOCK_KEY));
  if (lock.date === today && input.now.getTime() - lock.startedAt < AUTO_LOCK_TTL_MS) {
    return { ok: false, reason: "run in progress" };
  }

  return { ok: true, today };
}

function markAutoTrigger(store, date) {
  store.write(JSON.stringify({
    date,
    capturedAt: new Date().toISOString(),
  }), AUTO_TRIGGER_KEY);
}

function markAutoRunStarted(store, date, now) {
  store.write(JSON.stringify({ date, startedAt: now.getTime() }), AUTO_RUN_LOCK_KEY);
}

function markAutoRunFinished(store, date, result) {
  store.write(JSON.stringify({
    lastRunDate: date,
    lastResult: result,
    finishedAt: new Date().toISOString(),
  }), AUTO_RUN_STATE_KEY);
}

function clearAutoRunLock(store) {
  store.write("", AUTO_RUN_LOCK_KEY);
}

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

function buildSignString(input) {
  return [
    input.method.toUpperCase(),
    "*/*",
    "",
    "application/json",
    "",
    "X-Ca-Key:" + input.xCaKey,
    "X-Ca-Nonce:" + input.xCaNonce,
    "X-Ca-Signature-Method:HmacSHA256",
    "X-Ca-Timestamp:" + input.xCaTimestamp,
    input.uri,
  ].join("\n");
}

function bytesToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (typeof btoa === "undefined") {
    let output = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index];
      const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
      const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
      const chunk = (first << 16) | (second << 8) | third;
      output += alphabet[(chunk >> 18) & 63];
      output += alphabet[(chunk >> 12) & 63];
      output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : "=";
      output += index + 2 < bytes.length ? alphabet[chunk & 63] : "=";
    }
    return output;
  }

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

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
  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = remainingBits & 0xff;
    remainingBits = Math.floor(remainingBits / 256);
  }

  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        (padded[wordOffset] << 24) |
        (padded[wordOffset + 1] << 16) |
        (padded[wordOffset + 2] << 8) |
        padded[wordOffset + 3];
    }

    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[index] + words[index]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
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
  for (let index = 0; index < hash.length; index += 1) {
    const word = hash[index];
    const outputOffset = index * 4;
    output[outputOffset] = (word >>> 24) & 0xff;
    output[outputOffset + 1] = (word >>> 16) & 0xff;
    output[outputOffset + 2] = (word >>> 8) & 0xff;
    output[outputOffset + 3] = word & 0xff;
  }
  return output;
}

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
  for (let index = 0; index < blockSize; index += 1) {
    outerKeyPad[index] = normalizedKey[index] ^ 0x5c;
    innerKeyPad[index] = normalizedKey[index] ^ 0x36;
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

async function signBase64HmacSha256(appSecret, signString) {
  const encoder = new TextEncoder();
  return bytesToBase64(hmacSha256Bytes(encoder.encode(appSecret), encoder.encode(signString)));
}

function getRandomBytes(length) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const output = new Uint8Array(length);
    crypto.getRandomValues(output);
    return output;
  }

  return Uint8Array.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
}

function formatRiskOpenTime(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
}

function buildAuthHeaders(tokenState) {
  const headers = {};
  if (!tokenState) return headers;

  if (tokenState.token) headers.token = tokenState.token;
  if (tokenState.oauthAccessToken) headers.oauthAccessToken = tokenState.oauthAccessToken;
  if (tokenState.oauthRefreshToken) headers.oauthRefreshToken = tokenState.oauthRefreshToken;
  if (tokenState.authorization) {
    headers.authorization = tokenState.authorization;
  } else if (tokenState.oauthAccessToken) {
    headers.authorization = "Bearer " + tokenState.oauthAccessToken;
  }

  return headers;
}

function buildSignedHeaders(input) {
  return Object.assign({
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 x-cordova-platform/ios cordova-6",
    "Content-Type": "application/json",
    "X-Ca-Key": input.config.xCaKey,
    "X-Ca-Nonce": input.nonce,
    "X-Ca-Timestamp": input.timestamp,
    "X-Ca-Signature": input.signature,
    "X-Ca-Signature-Method": "HmacSHA256",
    "X-Ca-Signature-Headers": "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method",
    token: input.tokenState.token,
  }, buildAuthHeaders(input.tokenState));
}

function buildRefreshTokenRequest(input) {
  return {
    method: "GET",
    url: "https://h5-api.lynkco.com/auth/login/refresh?deviceId=&deviceType=Web&refreshToken=" + encodeURIComponent(input.tokenState.refreshToken),
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 x-cordova-platform/ios cordova-6",
      "Content-Type": "application/json",
      "X-Ca-Key": input.config.xCaKey,
      token: input.tokenState.token,
    },
  };
}

function buildDailySignRequest(input) {
  return {
    method: "POST",
    url: "https://" + input.endpoint.host + input.endpoint.uri,
    headers: buildSignedHeaders(input),
  };
}

function buildGetShareCodeRequest(input) {
  const riskRequestInfo = JSON.stringify({
    openTimeStamp: input.openTimeStamp,
    shareContentType: input.config.shareContentType,
    shareContentURL: input.config.shareContentURL,
  });

  return {
    method: "GET",
    url: "https://h5-api.lynkco.com/app/v1/task/getShareCode",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 x-cordova-platform/ios cordova-6",
      "Content-Type": "application/json",
      "X-Ca-Key": input.config.xCaKey,
      "X-Ca-Nonce": input.nonce,
      "X-Ca-Timestamp": input.timestamp,
      "X-Ca-Signature": input.signature,
      "X-Ca-Signature-Method": "HmacSHA256",
      "X-Ca-Signature-Headers": "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method",
      risk_request_info: riskRequestInfo,
      token: input.tokenState.token,
    },
  };
}

function buildShareReportingRequest(input) {
  return {
    method: "POST",
    url: "https://h5.lynkco.com/app/v1/task/shareReporting?shareCode=" + encodeURIComponent(input.shareCode),
    headers: Object.assign({
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      "Content-Type": "application/json",
    }, buildAuthHeaders(input.tokenState)),
    body: JSON.stringify({
      businessNo: input.config.articleId,
      eventData: {
        firstClassification: "\u6587\u7ae0",
        secondClassification: "",
      },
    }),
  };
}

function buildSignedGetRequest(input) {
  return {
    method: "GET",
    url: input.url,
    headers: Object.assign({
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 x-cordova-platform/ios cordova-6",
      "Content-Type": "application/json",
      "X-Ca-Key": input.config.xCaKey,
      "X-Ca-Nonce": input.nonce,
      "X-Ca-Timestamp": input.timestamp,
      "X-Ca-Signature": input.signature,
      "X-Ca-Signature-Method": "HmacSHA256",
      "X-Ca-Signature-Headers": "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method",
    }, buildAuthHeaders(input.tokenState), input.extraHeaders || {}),
  };
}

function buildSignedDailySignContext(input) {
  const uri = input.endpoint.uri;
  return {
    signString: buildSignString({
      method: "POST",
      uri,
      xCaKey: input.config.xCaKey,
      xCaNonce: input.nonce,
      xCaTimestamp: input.timestamp,
    }),
  };
}

function buildSignedShareCodeContext(input) {
  const uri = "/app/v1/task/getShareCode";
  return {
    signString: buildSignString({
      method: "GET",
      uri,
      xCaKey: input.config.xCaKey,
      xCaNonce: input.nonce,
      xCaTimestamp: input.timestamp,
    }),
  };
}

function buildSignedInformationConfigContext(input) {
  const uri = "/app/explore/home-page/config/pccid/get?pageCode=LYNKCO_APP_1028";
  return {
    signString: buildSignString({
      method: "GET",
      uri,
      xCaKey: input.config.xCaKey,
      xCaNonce: input.nonce,
      xCaTimestamp: input.timestamp,
    }),
  };
}

function buildSignedInformationArticleContext(input) {
  const uri = "/app/explore/home-page/article?articlePccId=" + encodeURIComponent(input.pccId);
  return {
    signString: buildSignString({
      method: "GET",
      uri,
      xCaKey: input.config.xCaKey,
      xCaNonce: input.nonce,
      xCaTimestamp: input.timestamp,
    }),
  };
}

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

function getApiMessage(payload) {
  return (payload && (payload.message || payload.msg || payload.errorMsg)) || "";
}

function primitiveToText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function getTodaySignEntry(payload, dateKey) {
  const data = payload && payload.data;
  if (!data || typeof data !== "object") return null;
  return data[dateKey] || data[dateKey.replace(/-/g, "/")] || data[dateKey.replace(/-/g, "")] || null;
}

function collectInterestingFields(value, path, output, options = {}) {
  if (!value || output.length >= 16) return;
  const todayOnly = options.todayOnly;
  const todayKey = options.todayKey || "";

  if (typeof value !== "object") {
    const normalizedPath = String(path || "").toLowerCase();
    if (
      normalizedPath.includes("sign") ||
      normalizedPath.includes("task") ||
      normalizedPath.includes("reward") ||
      normalizedPath.includes("point") ||
      normalizedPath.includes("day") ||
      normalizedPath.includes("status") ||
      normalizedPath.includes("code") ||
      normalizedPath.includes("message") ||
      normalizedPath.includes("msg") ||
      normalizedPath.includes("success")
    ) {
      const text = primitiveToText(value);
      if (text) output.push(path + "=" + text);
    }
    return;
  }

  Object.keys(value).forEach((key) => {
    if (output.length >= 16) return;
    if (todayOnly && /^\d{4}-\d{2}-\d{2}$/.test(key) && key !== todayKey) return;
    collectInterestingFields(value[key], path ? path + "." + key : key, output, options);
  });
}

function summarizeSignPayload(payload, data, dateKey) {
  const parts = [];
  if (payload && payload.code != null) parts.push("code=" + payload.code);
  const apiMessage = getApiMessage(payload);
  if (apiMessage) parts.push("message=" + apiMessage);

  const dataObject = payload && payload.data;
  const dateKeys = dataObject && typeof dataObject === "object"
    ? Object.keys(dataObject).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort()
    : [];
  if (dateKeys.length && dateKey) {
    const todayEntry = getTodaySignEntry(payload, dateKey);
    const todayFields = [];
    if (todayEntry && typeof todayEntry === "object") {
      collectInterestingFields(todayEntry, "", todayFields);
    }
    parts.push("today=" + dateKey + ":" + (todayFields.join(", ") || "missing"));

    const latestKey = dateKeys[dateKeys.length - 1];
    if (latestKey !== dateKey) {
      const latestFields = [];
      collectInterestingFields(dataObject[latestKey], "", latestFields);
      parts.push("latest=" + latestKey + ":" + (latestFields.join(", ") || "unknown"));
    }
    return parts.join(", ");
  }

  const fields = [];
  collectInterestingFields(payload, "", fields, { todayOnly: Boolean(dateKey), todayKey: dateKey });
  const summary = parts.concat(fields).join(", ") || summarizeBody(data);
  return summary.length > 220 ? summary.slice(0, 217) + "..." : summary;
}

function isAlreadySignedMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("already signed") ||
    normalized.includes("signed today") ||
    normalized.includes("\u5df2\u7b7e\u5230") ||
    normalized.includes("\u5df2\u7b7e")
  );
}

function isSignStatusPath(path) {
  const normalized = normalizeHeaderName(path);
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
    normalized.includes("\u672a\u7b7e\u5230") ||
    normalized.includes("\u5f85\u7b7e\u5230") ||
    normalized.includes("\u53bb\u7b7e\u5230") ||
    normalized.includes("\u672a\u5b8c\u6210")
  ) {
    return "unsigned";
  }
  if (
    normalized.includes("\u5df2\u7b7e\u5230") ||
    normalized.includes("\u5df2\u5b8c\u6210") ||
    normalized.includes("\u5df2\u9886\u53d6")
  ) {
    return "signed";
  }
  return "";
}

function findSignCompletionState(value, path = "") {
  if (!value || typeof value !== "object") return "";

  const directState = isSignStatusPath(path) ? signStatusValueToState(value) : "";
  if (directState) return directState;

  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const nestedPath = path ? path + "." + key : key;
    const candidate = value[key];
    const state = candidate && typeof candidate === "object"
      ? findSignCompletionState(candidate, nestedPath)
      : isSignStatusPath(nestedPath) ? signStatusValueToState(candidate) : "";
    if (state) return state;
  }
  return "";
}

function getTodaySignState(payload, now) {
  const todayKey = localDayKey(now || new Date());
  const data = payload && payload.data;
  if (data && typeof data === "object") {
    const dateKeys = Object.keys(data).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key));
    if (dateKeys.length) {
      const todayEntry = getTodaySignEntry(payload, todayKey);
      return todayEntry ? findSignCompletionState(todayEntry, todayKey) || "unsigned" : "unsigned";
    }
  }
  return findSignCompletionState(payload);
}

function summarizeBody(data) {
  if (typeof data !== "string") return "";
  const trimmed = data.trim();
  if (!trimmed) return "";
  return trimmed.length > 160 ? trimmed.slice(0, 157) + "..." : trimmed;
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
      label + " request failed with HTTP " + status + (
        apiMessage ? ": " + apiMessage : bodySummary ? ": " + bodySummary : "."
      ),
    );
  }

  const businessFailureMessage = getBusinessFailureMessage(payload);
  if (businessFailureMessage) throw new Error(label + " request failed: " + businessFailureMessage);
}

function getShareCode(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Share code response is not valid JSON.");
  if (!payload.data) throw new Error(payload.message || "Share code response does not include data.");
  return payload.data;
}

function refreshTokenStateFromPayload(payload, currentState) {
  const centerTokenDto = payload && payload.data && payload.data.centerTokenDto;
  if (!centerTokenDto || !centerTokenDto.token) return currentState;
  return {
    token: centerTokenDto.token,
    refreshToken: centerTokenDto.refreshToken || currentState.refreshToken,
    oauthAccessToken: currentState.oauthAccessToken || "",
    oauthRefreshToken: currentState.oauthRefreshToken || "",
    authorization: currentState.authorization || "",
  };
}

function getInformationPagePccId(payload) {
  const items = payload && payload.data;
  if (!Array.isArray(items)) throw new Error("Information config response is not valid.");
  const contentPosition = items.find((item) => item && String(item.cptCode || "") === "1009" && item.pccId);
  if (!contentPosition) throw new Error("Information content position was not found.");
  return String(contentPosition.pccId);
}

function getFirstArticleFromList(payload) {
  const items = payload && payload.data;
  if (!Array.isArray(items) || items.length === 0) throw new Error("Information article list is empty.");

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const candidates = [item.data && item.data.data, item.data, item];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const articleId = candidate.id || candidate.articleId || candidate.contentId;
      if (!articleId) continue;
      return {
        articleId: String(articleId),
        shareContentURL: buildShareUrl(String(articleId)),
      };
    }
  }

  throw new Error("Information article list does not include a usable article id.");
}

async function resolveShareArticle(input) {
  if (input.config.articleId) {
    return {
      articleId: input.config.articleId,
      shareContentURL: input.config.shareContentURL || buildShareUrl(input.config.articleId),
    };
  }

  const nonce = createNonceFromBytes(Array.from(getRandomBytes(16)));
  const timestamp = String(Date.now());
  const configContext = buildSignedInformationConfigContext({ config: input.config, nonce, timestamp });
  const configSignature = await signBase64HmacSha256(input.config.appSecret, configContext.signString);
  const informationConfigRequest = buildSignedGetRequest({
    config: input.config,
    tokenState: input.tokenState,
    nonce,
    timestamp,
    signature: configSignature,
    url: "https://h5-api.lynkco.com/app/explore/home-page/config/pccid/get?pageCode=LYNKCO_APP_1028",
  });
  const informationConfigResult = await requestAsync(input.httpClient, "get", informationConfigRequest);
  const informationConfigPayload = parseJson(informationConfigResult.data);
  assertSuccessfulHttp(
    informationConfigResult.response,
    "Information config",
    informationConfigPayload,
    informationConfigResult.data,
  );

  const pccId = getInformationPagePccId(informationConfigPayload);
  const articleNonce = createNonceFromBytes(Array.from(getRandomBytes(16)));
  const articleTimestamp = String(Date.now());
  const articleContext = buildSignedInformationArticleContext({
    config: input.config,
    nonce: articleNonce,
    timestamp: articleTimestamp,
    pccId,
  });
  const articleSignature = await signBase64HmacSha256(input.config.appSecret, articleContext.signString);
  const informationArticleRequest = buildSignedGetRequest({
    config: input.config,
    tokenState: input.tokenState,
    nonce: articleNonce,
    timestamp: articleTimestamp,
    signature: articleSignature,
    url: "https://h5-api.lynkco.com/app/explore/home-page/article?articlePccId=" + encodeURIComponent(pccId),
  });
  const informationArticleResult = await requestAsync(input.httpClient, "get", informationArticleRequest);
  const informationArticlePayload = parseJson(informationArticleResult.data);
  assertSuccessfulHttp(
    informationArticleResult.response,
    "Information article list",
    informationArticlePayload,
    informationArticleResult.data,
  );

  return getFirstArticleFromList(informationArticlePayload);
}

function needsOpenAppHint(message) {
  if (!message) return false;
  const normalized = String(message).toLowerCase();
  return [
    "uaa.oauthaccesstoken.not.exist",
    "oauthaccesstoken",
    "token expired",
    "unauthorized",
    "access token",
  ].some((marker) => normalized.includes(marker));
}

function appendOpenAppHint(message) {
  const hint = " Open Lynk & Co once, then try again tomorrow or clear the auto-run state.";
  if (!needsOpenAppHint(message) || String(message).toLowerCase().includes("open lynk & co once")) return message;
  return message + hint;
}

function summarizeTask(name, result) {
  return result.ok ? name + ": ok" : name + ": failed (" + result.message + ")";
}

function summarizeResults(signResult, shareResult, shareEnabled) {
  if (!shareEnabled) return summarizeTask("Sign", signResult);
  return summarizeTask("Sign", signResult) + " | " + summarizeTask("Share", shareResult);
}

function summarizeFailures(failures) {
  const summary = failures.join(" | ") || "no sign endpoint succeeded";
  return summary.length > 260 ? summary.slice(0, 257) + "..." : summary;
}

async function runDailySignTask(input) {
  const failures = [];

  for (const endpoint of SIGN_ENDPOINTS) {
    try {
      const nonce = createNonceFromBytes(Array.from(getRandomBytes(16)));
      const timestamp = String(Date.now());
      const signedContext = buildSignedDailySignContext({
        config: input.config,
        endpoint,
        nonce,
        timestamp,
      });
      const signature = await signBase64HmacSha256(input.config.appSecret, signedContext.signString);
      const signRequest = buildDailySignRequest({
        config: input.config,
        endpoint,
        tokenState: input.tokenState,
        nonce,
        timestamp,
        signature,
      });
      const signResult = await requestAsync(input.httpClient, "post", signRequest);
      const signPayload = parseJson(signResult.data);
      const apiMessage = getApiMessage(signPayload);

      if (isAlreadySignedMessage(apiMessage) || isAlreadySignedMessage(signResult.data)) {
        return { ok: true };
      }

      assertSuccessfulHttp(signResult.response, "Sign", signPayload, signResult.data);

      if (endpoint.mode === "action") {
        return { ok: true };
      }

      const signNow = new Date();
      const signDateKey = localDayKey(signNow);
      const signState = getTodaySignState(signPayload, signNow);
      const responseSummary = summarizeSignPayload(signPayload, signResult.data, signDateKey);
      if (signState === "signed") {
        return { ok: true };
      }
      if (signState === "unsigned") {
        throw new Error("sign info reports not signed" + (responseSummary ? ": " + responseSummary : "."));
      }
      throw new Error("sign info did not confirm completion" + (responseSummary ? ": " + responseSummary : "."));
    } catch (error) {
      failures.push(endpoint.host + endpoint.uri + ": " + error.message);
    }
  }

  return {
    ok: false,
    message: appendOpenAppHint(summarizeFailures(failures)),
  };
}

async function runShareTask(input) {
  try {
    const resolvedArticle = await resolveShareArticle(input);
    const shareConfig = Object.assign({}, input.config, {
      articleId: resolvedArticle.articleId,
      shareContentURL: resolvedArticle.shareContentURL,
    });
    const now = new Date();
    const nonce = createNonceFromBytes(Array.from(getRandomBytes(16)));
    const timestamp = String(now.getTime());
    const openTimeStamp = formatRiskOpenTime(now);
    const signedContext = buildSignedShareCodeContext({ config: shareConfig, nonce, timestamp });
    const signature = await signBase64HmacSha256(shareConfig.appSecret, signedContext.signString);

    const shareCodeRequest = buildGetShareCodeRequest({
      config: shareConfig,
      tokenState: input.tokenState,
      nonce,
      timestamp,
      signature,
      openTimeStamp,
    });
    const shareCodeResult = await requestAsync(input.httpClient, "get", shareCodeRequest);
    const shareCodePayload = parseJson(shareCodeResult.data);
    assertSuccessfulHttp(shareCodeResult.response, "Share code", shareCodePayload, shareCodeResult.data);
    const shareCode = getShareCode(shareCodePayload);

    const shareReportingRequest = buildShareReportingRequest({
      config: shareConfig,
      shareCode,
      tokenState: input.tokenState,
    });
    const shareReportingResult = await requestAsync(input.httpClient, "post", shareReportingRequest);
    const shareReportingPayload = parseJson(shareReportingResult.data);
    assertSuccessfulHttp(shareReportingResult.response, "Share reporting", shareReportingPayload, shareReportingResult.data);
    return { ok: true };
  } catch (error) {
    if (input.config.fallbackArticleId) {
      try {
        return await runShareTask(Object.assign({}, input, {
          config: Object.assign({}, input.config, {
            articleId: input.config.fallbackArticleId,
            fallbackArticleId: "",
            shareContentURL: buildShareUrl(input.config.fallbackArticleId),
          }),
        }));
      } catch (fallbackError) {
        return { ok: false, message: appendOpenAppHint(fallbackError.message) };
      }
    }
    return { ok: false, message: appendOpenAppHint(error.message) };
  }
}

async function runDailyTasks(input) {
  let tokenState = input.tokenState;
  const config = input.config;

  if (tokenState.refreshToken) {
    try {
      const refreshRequest = buildRefreshTokenRequest({ config, tokenState });
      const refreshResult = await requestAsync(input.httpClient, "get", refreshRequest);
      const refreshPayload = parseJson(refreshResult.data);
      assertSuccessfulHttp(refreshResult.response, "Refresh token", refreshPayload, refreshResult.data);
      const refreshedTokenState = refreshTokenStateFromPayload(refreshPayload, tokenState);
      if (
        refreshedTokenState.token !== tokenState.token ||
        refreshedTokenState.refreshToken !== tokenState.refreshToken
      ) {
        input.store.write(serializeTokenState(refreshedTokenState), TOKEN_STATE_KEY);
        tokenState = refreshedTokenState;
      }
    } catch (error) {
      // Keep the captured token. Some accounts still complete share/sign without refresh.
    }
  }

  const signResult = await runDailySignTask({
    config,
    tokenState,
    httpClient: input.httpClient,
  });

  let shareResult = null;
  if (config.shareEnabled) {
    shareResult = await runShareTask({
      config,
      tokenState,
      httpClient: input.httpClient,
    });
  }

  return summarizeResults(signResult, shareResult, config.shareEnabled);
}

async function runAutoCapture(options = {}) {
  const request = options.request || (typeof $request === "undefined" ? null : $request);
  const response = options.response || (typeof $response === "undefined" ? null : $response);
  const store = options.store || $persistentStore;
  const notification = options.notification || $notification;
  const httpClient = options.httpClient || $httpClient;
  const argument = options.argument || (typeof $argument === "undefined" ? "" : $argument);
  const done = options.done || $done;
  const config = buildShareConfig(parseArgumentString(argument));

  try {
    if (!request && !response) {
      done();
      return;
    }

    const tracedUrl = (request && request.url) || (response && response.url) || "";
    const traceMethod =
      (request && request.method) ||
      ((response && response.statusCode) || response ? "RESPONSE" : "GET");

    if (config.captureTraceNotify) {
      if (shouldTraceRequest(tracedUrl)) {
        notification.post(
          "Lynk & Co Trace [" + classifyTraceUrl(traceMethod, tracedUrl) + "]",
          "",
          buildTraceSummary(traceMethod, tracedUrl),
        );
      }
    }

    if (config.signTraceNotify) {
      if (request && isSignInfoUrl(tracedUrl)) {
        notification.post(
          "Lynk & Co Sign Request",
          "",
          summarizeSignRequestHeaders(request),
        );
      }
      if (response && response.body && isSignInfoUrl(tracedUrl)) {
        const signTracePayload = parseJson(response.body);
        notification.post(
          "Lynk & Co Sign Trace",
          "",
          summarizeSignPayload(signTracePayload, response.body, localDayKey(new Date())) || "empty response",
        );
      }
    }

    if (config.pingNotify) {
      notification.post(
        "Lynk & Co Share",
        "",
        "Script hit: " + (response ? "response" : "request") + " " + ((request && request.url) || ""),
      );
    }

    const previousTokenState = parseTokenState(store.read(TOKEN_STATE_KEY));
    const currentUrl = (request && request.url) || (response && response.url) || "";
    const currentMethod =
      (request && request.method) ||
      ((response && response.statusCode) || response ? "RESPONSE" : "GET");
    const triggeredByUsefulRequest = isSignInfoUrl(currentUrl);
    const capturedTokenState = mergeTokenState(
      mergeTokenState(extractRequestTokenState(request), extractBodyTokenState(request && request.body)),
      extractBodyTokenState(response && response.body),
    );

    let tokenState = previousTokenState;
    const detectedTokenNow = hasTokenState(capturedTokenState);
    if (detectedTokenNow) {
      tokenState = mergeTokenState(previousTokenState, capturedTokenState);
      store.write(serializeTokenState(tokenState), TOKEN_STATE_KEY);
      markAutoTrigger(store, localDayKey(new Date()));
      if (config.debugNotify) {
        notification.post(
          "Lynk & Co Share",
          "",
          "Captured Lynk & Co auth state: " + summarizeCapturedFields(tokenState).join(", ") + ".",
        );
      }
    }

    const now = new Date();
    const gate = shouldStartAutoRun({
      config,
      detectedTokenNow,
      now,
      store,
      tokenState,
      triggeredByUsefulRequest,
    });

    if (!gate.ok) {
      if ((detectedTokenNow || triggeredByUsefulRequest) && config.debugNotify) {
        notification.post("Lynk & Co Share", "", "Auto run skipped: " + gate.reason + ".");
      }
      done({});
      return;
    }

    markAutoRunStarted(store, gate.today, now);
    const summary = await runDailyTasks({ config, tokenState, store, httpClient });
    markAutoRunFinished(store, gate.today, summary);
    notification.post("Lynk & Co Share", "", summary);
    done({});
  } catch (error) {
    clearAutoRunLock(store);
    notification.post("Lynk & Co Share", "", "Auto run failed: " + error.message);
    done({});
  }
}

runAutoCapture();
