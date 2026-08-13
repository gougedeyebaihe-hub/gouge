/**
 * notify.js — 通知与诊断信息
 *
 * debug=1 时通知附带签名/响应摘要，便于把通知内容发回给开发者定位问题。
 */
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
