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

async function signBase64HmacSha256(appSecret, signString) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(appSecret);
  const messageData = encoder.encode(signString);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return bytesToBase64(new Uint8Array(signature));
}

function getRandomBytes(length) {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
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
        firstClassification: "\u6587\u7ae0",
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

async function runCron() {
  try {
    let tokenState = parseTokenState($persistentStore.read(TOKEN_STATE_KEY));
    if (!tokenState.token) {
      $notification.post("Lynk & Co Share", "", "No token captured yet.");
      $done();
      return;
    }

    const config = buildShareConfig(parseArgumentString(typeof $argument === "undefined" ? "" : $argument));

    if (tokenState.refreshToken) {
      const refreshRequest = buildRefreshTokenRequest({ config: config, tokenState: tokenState });
      const refreshResult = await requestAsync($httpClient, "get", refreshRequest);
      const refreshPayload = parseJson(refreshResult.data);
      const refreshedTokenState = refreshTokenStateFromPayload(refreshPayload, tokenState);
      if (refreshedTokenState.token !== tokenState.token || refreshedTokenState.refreshToken !== tokenState.refreshToken) {
        $persistentStore.write(serializeTokenState(refreshedTokenState), TOKEN_STATE_KEY);
        tokenState = refreshedTokenState;
      }
    }

    const now = new Date();
    const nonce = createNonceFromBytes(Array.from(getRandomBytes(16)));
    const timestamp = String(now.getTime());
    const openTimeStamp = formatRiskOpenTime(now);
    const signedContext = buildSignedShareCodeContext({
      config: config,
      nonce: nonce,
      timestamp: timestamp,
    });
    const signature = await signBase64HmacSha256(config.appSecret, signedContext.signString);

    const shareCodeRequest = buildGetShareCodeRequest({
      config: config,
      tokenState: tokenState,
      nonce: nonce,
      timestamp: timestamp,
      signature: signature,
      openTimeStamp: openTimeStamp,
    });
    const shareCodeResult = await requestAsync($httpClient, "get", shareCodeRequest);
    const shareCodePayload = parseJson(shareCodeResult.data);
    const shareCode = getShareCode(shareCodePayload);

    const shareReportingRequest = buildShareReportingRequest({
      config: config,
      shareCode: shareCode,
    });
    const shareReportingResult = await requestAsync($httpClient, "post", shareReportingRequest);
    const shareReportingPayload = parseJson(shareReportingResult.data);
    const resultText = (shareReportingPayload && (shareReportingPayload.data || shareReportingPayload.message)) || "unknown";

    $notification.post("Lynk & Co Share", "", "Share task result: " + resultText);
    $done();
  } catch (error) {
    $notification.post("Lynk & Co Share", "", "Share task failed: " + error.message);
    $done();
  }
}

runCron();
