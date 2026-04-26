const TOKEN_STATE_KEY = "lynkco.share.tokenState";
const DEFAULT_ARTICLE_ID = "1881101031748870144";

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

function buildShareUrl(articleId) {
  return "https://h5.lynkco.com/app-h5/dist/web/pages/exploration/article/index.html?id=" + articleId;
}

function buildShareConfig(input) {
  const source = input || {};
  const articleId = source.articleId || DEFAULT_ARTICLE_ID;
  return {
    articleId,
    shareContentURL: source.shareContentURL || buildShareUrl(articleId),
    shareContentType: source.shareContentType == null ? 1 : source.shareContentType,
    shareEnabled: ["1", "true", "yes", "on"].includes(String(source.shareEnabled == null ? "0" : source.shareEnabled).toLowerCase()),
    xCaKey: source.xCaKey || "204644386",
    appSecret: source.appSecret || "QCl7udM3PB9cOIOwquwPglikFQnzJRsX",
  };
}

function parseTokenState(raw) {
  if (!raw) return { token: "", refreshToken: "" };
  const parsed = JSON.parse(raw);
  return {
    token: parsed.token || "",
    refreshToken: parsed.refreshToken || "",
  };
}

function serializeTokenState(tokenState) {
  return JSON.stringify({
    token: tokenState.token || "",
    refreshToken: tokenState.refreshToken || "",
  });
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
      const wordOffset = offset + (index * 4);
      words[index] =
        (padded[wordOffset] << 24) |
        (padded[wordOffset + 1] << 16) |
        (padded[wordOffset + 2] << 8) |
        padded[wordOffset + 3];
    }

    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rightRotate(words[index - 15], 7) ^
        rightRotate(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rightRotate(words[index - 2], 17) ^
        rightRotate(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (
        words[index - 16] +
        s0 +
        words[index - 7] +
        s1
      ) >>> 0;
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
      const s1 =
        rightRotate(e, 6) ^
        rightRotate(e, 11) ^
        rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[index] + words[index]) >>> 0;
      const s0 =
        rightRotate(a, 2) ^
        rightRotate(a, 13) ^
        rightRotate(a, 22);
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

  if (normalizedKey.length > blockSize) {
    normalizedKey = sha256Bytes(normalizedKey);
  }

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
  const keyData = encoder.encode(appSecret);
  const messageData = encoder.encode(signString);
  const signatureBytes = hmacSha256Bytes(keyData, messageData);
  return bytesToBase64(signatureBytes);
}

function getRandomBytes(length) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const output = new Uint8Array(length);
    crypto.getRandomValues(output);
    return output;
  }

  return Uint8Array.from(
    Array.from({ length: length }, function() {
      return Math.floor(Math.random() * 256);
    }),
  );
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
    url: "https://h5-api.lynkco.com/up/api/v1/user/sign",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 x-cordova-platform/ios cordova-6",
      "Content-Type": "application/json",
      "X-Ca-Key": input.config.xCaKey,
      token: input.tokenState.token,
    },
    body: "{}",
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
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessNo: input.config.articleId,
      eventData: {
        firstClassification: "文章",
        secondClassification: "",
      },
    }),
  };
}

function buildSignedShareCodeContext(input) {
  const uri = "/app/v1/task/getShareCode";
  return {
    uri: uri,
    signString: buildSignString({
      method: "GET",
      uri: uri,
      xCaKey: input.config.xCaKey,
      xCaNonce: input.nonce,
      xCaTimestamp: input.timestamp,
    }),
  };
}

function requestAsync(httpClient, method, params) {
  return new Promise(function(resolve, reject) {
    httpClient[method](params, function(error, response, data) {
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve({ response: response, data: data });
    });
  });
}

function parseJson(data) {
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function getApiMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return payload.message || payload.msg || payload.errorMsg || "";
}

function summarizeBody(data) {
  if (typeof data !== "string") {
    return "";
  }
  const trimmed = data.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length > 160 ? trimmed.slice(0, 157) + "..." : trimmed;
}

function getHttpStatus(response) {
  return (response && (response.status || response.statusCode)) || 0;
}

function assertSuccessfulHttp(response, label, payload, data) {
  const status = getHttpStatus(response);
  if (status && (status < 200 || status >= 300)) {
    const apiMessage = getApiMessage(payload);
    const bodySummary = summarizeBody(data || "");
    throw new Error(label + " request failed with HTTP " + status + (apiMessage ? ": " + apiMessage : bodySummary ? ": " + bodySummary : "."));
  }
}

function getShareCode(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Share code response is not valid JSON.");
  }
  if (!payload.data) {
    throw new Error(payload.message || "Share code response does not include data.");
  }
  return payload.data;
}

function refreshTokenStateFromPayload(payload, currentState) {
  const centerTokenDto = payload && payload.data && payload.data.centerTokenDto;
  if (!centerTokenDto || !centerTokenDto.token) {
    return currentState;
  }
  return {
    token: centerTokenDto.token,
    refreshToken: centerTokenDto.refreshToken || currentState.refreshToken,
  };
}

function appendAuthHint(message, authHint) {
  return authHint ? message + authHint : message;
}

function summarizeTask(name, result) {
  if (result.ok) {
    return name + ": ok";
  }
  return name + ": failed (" + result.message + ")";
}

function summarizeResults(signResult, shareResult, shareEnabled) {
  if (!shareEnabled) {
    return summarizeTask("Sign", signResult);
  }
  return summarizeTask("Sign", signResult) + " | " + summarizeTask("Share", shareResult);
}

async function runDailySignTask(input) {
  try {
    const signRequest = buildDailySignRequest({
      config: input.config,
      tokenState: input.tokenState,
    });
    const signResult = await requestAsync(input.httpClient, "post", signRequest);
    const signPayload = parseJson(signResult.data);
    assertSuccessfulHttp(signResult.response, "Sign", signPayload, signResult.data);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: appendAuthHint(error.message, input.authHint),
    };
  }
}

async function runShareTask(input) {
  try {
    const now = input.now();
    const nonce = createNonceFromBytes(Array.from(input.randomBytes()));
    const timestamp = String(now.getTime());
    const openTimeStamp = formatRiskOpenTime(now);
    const signedContext = buildSignedShareCodeContext({
      config: input.config,
      nonce: nonce,
      timestamp: timestamp,
    });
    const signature = await signBase64HmacSha256(input.config.appSecret, signedContext.signString);

    const shareCodeRequest = buildGetShareCodeRequest({
      config: input.config,
      tokenState: input.tokenState,
      nonce: nonce,
      timestamp: timestamp,
      signature: signature,
      openTimeStamp: openTimeStamp,
    });
    const shareCodeResult = await requestAsync(input.httpClient, "get", shareCodeRequest);
    const shareCodePayload = parseJson(shareCodeResult.data);
    assertSuccessfulHttp(shareCodeResult.response, "Share code", shareCodePayload, shareCodeResult.data);
    const shareCode = getShareCode(shareCodePayload);

    const shareReportingRequest = buildShareReportingRequest({
      config: input.config,
      shareCode: shareCode,
    });
    const shareReportingResult = await requestAsync(input.httpClient, "post", shareReportingRequest);
    const shareReportingPayload = parseJson(shareReportingResult.data);
    assertSuccessfulHttp(shareReportingResult.response, "Share reporting", shareReportingPayload, shareReportingResult.data);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: appendAuthHint(error.message, input.authHint),
    };
  }
}

async function runCron() {
  let authHint = "";
  try {
    let tokenState = parseTokenState($persistentStore.read(TOKEN_STATE_KEY));
    if (!tokenState.token) {
      $notification.post("Lynk & Co Share", "", "No token captured. Open Lynk & Co once, then run again.");
      $done();
      return;
    }

    const config = buildShareConfig(parseArgumentString(typeof $argument === "undefined" ? "" : $argument));

    if (tokenState.refreshToken) {
      try {
        const refreshRequest = buildRefreshTokenRequest({ config: config, tokenState: tokenState });
        const refreshResult = await requestAsync($httpClient, "get", refreshRequest);
        const refreshPayload = parseJson(refreshResult.data);
        assertSuccessfulHttp(refreshResult.response, "Refresh token", refreshPayload, refreshResult.data);
        const refreshedTokenState = refreshTokenStateFromPayload(refreshPayload, tokenState);
        if (refreshedTokenState.token !== tokenState.token || refreshedTokenState.refreshToken !== tokenState.refreshToken) {
          $persistentStore.write(serializeTokenState(refreshedTokenState), TOKEN_STATE_KEY);
          tokenState = refreshedTokenState;
        }
      } catch (error) {
        authHint = " Auth refresh also failed; open Lynk & Co once, then run again.";
      }
    }

    const signResult = await runDailySignTask({
      config: input.config,
      tokenState: input.tokenState,
    });
    const signResult = await runDailySignTask({
      config: config,
      tokenState: tokenState,
      httpClient: $httpClient,
      authHint: authHint,
    });

    let shareResult = null;
    if (config.shareEnabled) {
      shareResult = await runShareTask({
        config: config,
        tokenState: tokenState,
        httpClient: $httpClient,
        now: function() { return new Date(); },
        randomBytes: function() { return getRandomBytes(16); },
        authHint: authHint,
      });
    }

    $notification.post("Lynk & Co Share", "", summarizeResults(signResult, shareResult, config.shareEnabled));
    $done();
  } catch (error) {
    $notification.post("Lynk & Co Share", "", "Share task failed: " + error.message + authHint);
    $done();
  }
}

runCron();
