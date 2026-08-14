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
