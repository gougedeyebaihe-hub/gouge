/**
 * store.js — $persistentStore 封装（token 状态、每日结果、捕获状态）
 */
"use strict";

const TOKEN_STATE_KEY = "lynkco.share.tokenState";
const DAILY_STATE_KEY = "lynkco.share.dailyState";
const LAST_RESULT_KEY = "lynkco.share.lastResult";
const SHARE_VALIDATION_KEY = "lynkco.share.shareValidation";

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
  if (!store || !store.write) return;
  try {
    store.write(serializeTokenState(tokenState), TOKEN_STATE_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
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
  if (!store || !store.write) return;
  try {
    store.write(JSON.stringify(state), DAILY_STATE_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

function writeLastResult(store, summary) {
  if (!store || !store.write) return;
  try {
    store.write(String(summary), LAST_RESULT_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
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
  if (!store || !store.write || !validation || !validation.certifyId) return;
  try {
    store.write(JSON.stringify({
      capturedAt: validation.capturedAt || new Date().toISOString(),
      certifyId: validation.certifyId,
      challenge: validation.challenge || "",
      riskValidateInfo: validation.riskValidateInfo || "",
      source: validation.source || "security-config",
    }), SHARE_VALIDATION_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

function clearStoredShareValidation(store) {
  if (!store || !store.write) return;
  try {
    store.write("", SHARE_VALIDATION_KEY);
  } catch (error) {
    console.log("LynkCo store write failed: " + error.message);
  }
}

