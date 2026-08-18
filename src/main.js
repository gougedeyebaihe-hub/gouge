/**
 * main.js — Loon 入口分发
 *
 * 触发方式（由插件 [Script] 段配置）：
 *   - cron：每日定时执行任务（签到+分享）
 *   - http-request / http-response：捕获领克流量中的认证字段（token/refreshToken）
 *   - generic：App 内手动触发（脚本名带 manual 标记），弹页显示结果
 *
 * 工作流：
 *   1. 首次使用：打开领克 App 制造一次流量 → 脚本捕获并保存 token/refreshToken
 *   2. 之后每天 cron 自动：续期 refreshToken → 签到 → 分享 → 通知结果
 */
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

function handleCron(input, mode) {
  const { config, store, notification, httpClient } = input;
  const now = input.now || new Date();
  const today = localDayKey(now);
  // generic 手动触发：用户主动点按 = 强制执行，绕过 oncePerDay 静默跳过
  const isManual = mode === "manual";

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
    return Promise.resolve({
      summary: "No token saved. Open Lynk & Co once to capture token.",
      diagnostic: "",
    });
  }

  if (config.oncePerDay && !isManual) {
    const daily = readDailyState(store);
    if (daily.date === today && daily.success) {
      // 今日已完成，静默跳过（避免 03:01 兜底任务重复弹窗）
      return Promise.resolve({ summary: "already done today", diagnostic: "" });
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
      return { summary, diagnostic };
    })
    .catch((error) => {
      writeDailyState(store, { date: today, success: false, attempt: "exception" });
      postNotification(notification, "LynkCo Daily", "Daily run failed: " + error.message, "");
      return { summary: "Daily run failed: " + error.message, diagnostic: "" };
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
        // generic 弹页展示结果（官方 generic_example.js 形态）
        const summary = (value && value.summary) || "";
        const diagnostic = (value && value.diagnostic) || "";
        done({
          title: "LynkCo Daily",
          htmlMessage: summary + (diagnostic ? "\n\n" + diagnostic : ""),
        });
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
}

runMain();
