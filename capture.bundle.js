const SCRIPT_VERSION = "v20260813b";
const CAPTURE_STATE_KEY = "lynkco.capture.state";
const CAPTURE_LOG_KEY = "lynkco.capture.lastLog";
const CAPTURE_HIT_LOG_KEY = "lynkco.capture.hitLog";

const FIELD_ALIASES = {
  "refreshtoken": "refreshToken",
  "refresh_token": "refreshToken",
  "refresh-token": "refreshToken",
  "deviceid": "deviceId",
  "device_id": "deviceId",
  "device-id": "deviceId",
  "userdeviceid": "deviceId",
  "clientid": "deviceId",
  "device": "deviceId",
  "token": "token",
  "oauthaccesstoken": "oauthAccessToken",
  "accesstoken": "oauthAccessToken",
  "access_token": "oauthAccessToken",
  "oauthrefreshtoken": "oauthRefreshToken",
  "authorization": "authorization",
  "xcakey": "xCaKey",
  "x-ca-key": "xCaKey",
  "xcaappcode": "appCode",
  "x-ca-appcode": "appCode",
  "appcode": "appCode",
  "appversion": "appVersion",
  "app-version": "appVersion",
};

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

function parseJson(data) {
  if (!data || typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
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

function normalizeFieldKey(key) {
  return String(key || "").toLowerCase().replace(/[-_]/g, "");
}

function setCanonicalField(result, key, value) {
  const normalized = normalizeFieldKey(key);
  const canonical = FIELD_ALIASES[normalized];
  if (canonical && value != null && !result[canonical]) {
    result[canonical] = String(value);
  }
}

function collectFromValue(value, result, path = "") {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFromValue(item, result, path + "." + index));
    return;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach((key) => {
      const nextPath = path ? path + "." + key : key;
      setCanonicalField(result, key, value[key]);
      collectFromValue(value[key], result, nextPath);
    });
    return;
  }
  setCanonicalField(result, path.split(".").pop() || path, value);
}

function collectFromText(text, result) {
  if (!text) return;
  const lower = String(text).toLowerCase();
  const likelyCaptureText = [
    "refreshtoken",
    "deviceid",
    "oauthaccesstoken",
    "accesstoken",
    "oauthrefreshtoken",
    "authorization",
    "\"token\"",
  ].some((marker) => lower.includes(marker));
  if (!likelyCaptureText) return;
  const parsed = parseJson(text);
  if (parsed) {
    collectFromValue(parsed, result);
    return;
  }
  const query = parseQueryString(text);
  Object.keys(query).forEach((key) => setCanonicalField(result, key, query[key]));
}

function collectFromBody(body, result) {
  if (body == null) return;
  if (typeof body === "string") {
    collectFromText(body, result);
    return;
  }
  collectFromValue(body, result);
}

function collectFromUrl(url, result) {
  if (!url) return;
  const queryStart = String(url).indexOf("?");
  if (queryStart < 0) return;
  const query = parseQueryString(String(url).slice(queryStart + 1));
  Object.keys(query).forEach((key) => setCanonicalField(result, key, query[key]));
}

function buildCaptureState(request, response) {
  const source = response ? "response" : "request";
  const requestObject = request || {};
  const responseObject = response || {};
  const url = requestObject.url || responseObject.url || "";
  const headers = requestObject.headers || responseObject.headers || {};
  const requestBody = requestObject.body || "";
  const responseBody = responseObject.body || "";
  const state = {
    version: SCRIPT_VERSION,
    capturedAt: new Date().toISOString(),
    source,
    method:
      requestObject.method ||
      (responseObject.statusCode ? "RESPONSE" : ""),
    url,
  };

  collectFromUrl(url, state);
  collectFromBody(requestBody, state);
  collectFromBody(responseBody, state);
  [
    ["refreshToken", ["refreshToken", "refresh-token", "refresh_token"]],
    ["deviceId", ["deviceId", "device-id", "device_id"]],
    ["token", ["token"]],
    ["oauthAccessToken", ["oauthAccessToken", "oauth-access-token", "accessToken", "access-token"]],
    ["oauthRefreshToken", ["oauthRefreshToken", "oauth-refresh-token", "oauth-refresh_token"]],
    ["authorization", ["authorization"]],
    ["xCaKey", ["x-ca-key", "xCaKey", "X-Ca-Key"]],
    ["appCode", ["x-ca-appcode", "xCaAppCode", "appCode"]],
    ["appVersion", ["appversion", "app-version", "appVersion"]],
  ].forEach(([field, names]) => {
    const headerValue = getHeader(headers, names);
    if (headerValue && !state[field]) state[field] = headerValue;
  });

  return state;
}

function hasCapturableFields(state) {
  return [
    "refreshToken",
    "deviceId",
    "token",
    "oauthAccessToken",
    "oauthRefreshToken",
    "authorization",
  ].some((field) => Boolean(state[field]));
}

function fingerprint(state) {
  return [
    state.refreshToken || "",
    state.deviceId || "",
    state.token || "",
    state.oauthAccessToken || "",
    state.oauthRefreshToken || "",
    state.authorization || "",
  ].join("|");
}

function simpleHash(text) {
  let hash = 0;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return String(hash);
}

function readJson(store, key) {
  if (!store || !store.read) return null;
  return parseJson(store.read(key));
}

function writeJson(store, key, value) {
  if (store && store.write) {
    try {
      store.write(JSON.stringify(value), key);
    } catch (error) {
      console.log("LynkCoCapture store write failed: " + error.message);
    }
  }
}

function runCapture(options = {}) {
  const request = options.request || (typeof $request === "undefined" ? null : $request);
  const response = options.response || (typeof $response === "undefined" ? null : $response);
  const store = options.store || $persistentStore;
  const notification = options.notification || $notification;
  const argument = options.argument || (typeof $argument === "undefined" ? "" : $argument);
  const done = options.done || $done;
  const config = parseArgumentString(argument);
  const state = buildCaptureState(request, response);

  if (truthyFlag(config.captureHitNotify, false) && (request || response)) {
    const hitNow = Date.now();
    const hitLog = readJson(store, CAPTURE_HIT_LOG_KEY) || {};
    const lastHitAt = Number(hitLog.lastAt || 0);
    const minIntervalMs = Number(config.minNotifyIntervalMs || 60000);
    if (hitNow - lastHitAt >= minIntervalMs) {
      const hitUrl = (request && request.url) || (response && response.url) || "";
      notification.post(
        "Lynk & Co Capture Hit",
        "",
        (response ? "response" : "request") + " " + hitUrl,
      );
      writeJson(store, CAPTURE_HIT_LOG_KEY, {
        lastAt: hitNow,
        lastUrl: hitUrl,
      });
    }
  }

  if (!hasCapturableFields(state)) {
    done({});
    return;
  }

  state.fingerprint = simpleHash(fingerprint(state));
  writeJson(store, CAPTURE_STATE_KEY, state);

  const previousLog = readJson(store, CAPTURE_LOG_KEY) || {};
  const now = Date.now();
  const lastAt = Number(previousLog.lastAt || 0);
  const minIntervalMs = Number(config.minNotifyIntervalMs || 60000);
  const forceNotify = truthyFlag(config.forceNotify, false);
  const sameFingerprint = previousLog.fingerprint === state.fingerprint;
  const shouldNotify =
    !sameFingerprint || (forceNotify && now - lastAt >= minIntervalMs);

  writeJson(store, CAPTURE_LOG_KEY, {
    fingerprint: state.fingerprint,
    lastAt: now,
    lastUrl: state.url || "",
  });

  if (shouldNotify) {
    const body = JSON.stringify(state);
    notification.post("Lynk & Co Capture", "", body);
  }
  console.log("LynkCoCapture " + JSON.stringify(state));
  done({});
}

runCapture();
