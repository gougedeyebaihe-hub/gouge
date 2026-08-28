/**
 * api.js — 领克网关接口封装
 *
 * 所有请求函数接收统一 context：
 *   { config, tokenState, httpClient }
 *
 * 签名约定：
 *   - H5 签名接口（大写 X-Ca-* 头）：day/info、myEnergy、reward、文章、shareReporting
 *   - 原生 SDK 签名接口（小写 x-ca-* 头 + Content-MD5 + Date）：sign/upgrade、getShareCode
 *   - refresh：优先 APPCODE 静态认证，回退原生签名认证
 */
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
