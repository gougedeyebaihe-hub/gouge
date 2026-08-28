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

/* 凭证类字段：以服务器下发（响应体）为准——客户端发送值（URL query/请求体）可能是旧值，
 * 如 refresh 请求 URL 带即将过期的 refreshToken，先到先得会导致响应体中的新值被旧值占位
 * （表现为"重新登录后仍报凭证失效"）。 */
const CREDENTIAL_FIELDS = ["refreshToken", "token", "oauthAccessToken", "oauthRefreshToken", "authorization"];

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

function setCapturedField(result, key, value, preferCredentials) {
  const canonical = CAPTURE_FIELD_ALIASES[normalizeFieldKey(key)];
  if (!canonical || value == null || !String(value)) return;
  if (!result[canonical] || (preferCredentials && CREDENTIAL_FIELDS.includes(canonical))) {
    result[canonical] = String(value);
  }
}

function collectFromObject(value, result, preferCredentials) {
  if (!value || typeof value !== "object") return;
  Object.keys(value).forEach((key) => {
    setCapturedField(result, key, value[key], preferCredentials);
    const nested = value[key];
    if (nested && typeof nested === "object") collectFromObject(nested, result, preferCredentials);
  });
}

function collectFromBody(body, result, preferCredentials) {
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
      collectFromObject(parsed, result, preferCredentials);
    } else {
      const query = parseQueryString(body);
      Object.keys(query).forEach((key) => setCapturedField(result, key, query[key], preferCredentials));
    }
    return;
  }
  collectFromObject(body, result, preferCredentials);
}

function collectFromUrl(url, result) {
  if (!url) return;
  const questionIndex = String(url).indexOf("?");
  if (questionIndex < 0) return;
  const query = parseQueryString(String(url).slice(questionIndex + 1));
  Object.keys(query).forEach((key) => setCapturedField(result, key, query[key]));
}

/** 从请求/响应中提取认证字段。URL/请求体先收集（占位），响应体凭证字段强制覆盖（服务器下发为准） */
function extractCaptureFields(request, response) {
  const requestObject = request || {};
  const responseObject = response || {};
  const result = {};

  collectFromUrl(requestObject.url || responseObject.url || "", result);
  collectFromBody(requestObject.body, result);
  collectFromBody(responseObject.body, result, true);

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
  const url = String((request && request.url) || (response && response.url) || "");
  if (config.debug) {
    // 捕获埋点：每次捕获触发都会输出，用于定位"登录流量是否被监听到 / 提取了什么"
    console.log(
      "[领克-捕获] " + (response ? "响应" : "请求") + " " + url +
      (hasCaptured ? " 提取: " + Object.keys(captured).join(",") : " 无可捕获字段"),
    );
  }
  if (!hasCaptured) {
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
      postNotification(notification, "领克签到", "未保存令牌，请打开领克 App 完成登录以自动捕获。", "");
    }
    return Promise.resolve({
      summary: "未保存令牌，请打开领克 App 完成登录以自动捕获。",
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
