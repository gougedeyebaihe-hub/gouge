/**
 * time.js — 东八区时间工具（领克中国区服务端的本地时间口径）
 *
 * 统一换算规则：UTC + 8h（与设备本地时区无关，避免设备时区差异导致
 * "今日判定 / 风控时间戳"漂移）。localDayKey（store.js）与
 * formatRiskOpenTime（signature.js）必须共用本工具，禁止各自实现。
 */
"use strict";

/** 东八区时间分量（UTC+8，不依赖设备时区） */
function east8Parts(date) {
  const local = new Date((date || new Date()).getTime() + 8 * 60 * 60 * 1000);
  return {
    year: local.getUTCFullYear(),
    month: String(local.getUTCMonth() + 1).padStart(2, "0"),
    day: String(local.getUTCDate()).padStart(2, "0"),
    hours: String(local.getUTCHours()).padStart(2, "0"),
    minutes: String(local.getUTCMinutes()).padStart(2, "0"),
    seconds: String(local.getUTCSeconds()).padStart(2, "0"),
  };
}

/** 东八区日期键 YYYY-MM-DD */
function east8DayKey(date) {
  const parts = east8Parts(date);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

/** 东八区完整时间 "YYYY-MM-DD HH:mm:ss" */
function east8DateTime(date) {
  const parts = east8Parts(date);
  return (
    parts.year + "-" + parts.month + "-" + parts.day + " " +
    parts.hours + ":" + parts.minutes + ":" + parts.seconds
  );
}