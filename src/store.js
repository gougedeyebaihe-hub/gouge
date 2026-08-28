/**
 * store.js — $persistentStore 封装（token 状态、每日结果、捕获状态）
 */
"use strict";

const TOKEN_STATE_KEY = "lynkco.share.tokenState";
const DAILY_STATE_KEY = "lynkco.share.dailyState";
const SHARE_VALIDATION_KEY = "lynkco.share.shareValidation";

/** 统一的容错写入（$persistentStore.write 失败不阻断流程） */
function safeWrite(store, key, value) {
  if (!store || !store.write) return;
  try {
    store.write(value, key);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

function emptyTokenState() {
  return {
    token: "",
    refreshToken: "",
    oauthAccessToken: "",
    oauthRefreshToken: "",
    authorization: "",
    deviceId: "",
    deviceType: "",
    appVersion: "",
  };
}

function parseTokenState(raw) {
  if (!raw) return emptyTokenState();
  try {
    const parsed = JSON.parse(raw);
    return Object.assign(emptyTokenState(), parsed || {});
  } catch (error) {
    return emptyTokenState();
  }
}

function serializeTokenState(tokenState) {
  return JSON.stringify(tokenState || emptyTokenState());
}

function readTokenState(store) {
  return parseTokenState(store && store.read ? store.read(TOKEN_STATE_KEY) : "");
}

function writeTokenState(store, tokenState) {
  safeWrite(store, TOKEN_STATE_KEY, serializeTokenState(tokenState));
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

/* ---------------- 每日状态（oncePerDay 用） ---------------- */

function readDailyState(store) {
  if (!store || !store.read) return { date: "", success: false, attempt: "" };
  try {
    const parsed = JSON.parse(store.read(DAILY_STATE_KEY) || "");
    return {
      date: parsed.date || "",
      success: Boolean(parsed.success),
      attempt: parsed.attempt || "",
    };
  } catch (error) {
    return { date: "", success: false, attempt: "" };
  }
}

function writeDailyState(store, state) {
  safeWrite(store, DAILY_STATE_KEY, JSON.stringify(state));
}

/** 本地日期键 YYYY-MM-DD（东八区） */
function localDayKey(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, "0"),
    String(local.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/* ---------------- 分享验证（certifyId） ---------------- */

function readStoredShareValidation(store) {
  if (!store || !store.read) return null;
  try {
    const parsed = JSON.parse(store.read(SHARE_VALIDATION_KEY) || "");
    return parsed && parsed.certifyId ? parsed : null;
  } catch (error) {
    return null;
  }
}

function writeStoredShareValidation(store, validation) {
  if (!validation || !validation.certifyId) return;
  safeWrite(store, SHARE_VALIDATION_KEY, JSON.stringify({
    capturedAt: validation.capturedAt || new Date().toISOString(),
    certifyId: validation.certifyId,
    challenge: validation.challenge || "",
    riskValidateInfo: validation.riskValidateInfo || "",
    source: validation.source || "security-config",
  }));
}
