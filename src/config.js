/**
 * config.js — 配置解析与默认值
 *
 * 参数来自 Loon 插件 #!arguments 或 $argument（& 分隔的 key=value）。
 */
"use strict";

const SCRIPT_VERSION = "v20260813-refactor";

/* 领克网关密钥表（X-Ca-Key → AppSecret）。
 * 2026-07 轮换后新 key 为 203760416；旧 key 204644386 已 403，保留作回退。
 * 注意：AppSecret 无法通过抓包获得，若 403 且 key 再次轮换需重新提取（见 docs/protocol.md）。 */
const LYNK_CO_APP_SECRETS = {
  "203760416": "e1msl9aqd101gfcjpo873hrs5jg752og",
  "204644386": "QCl7udM3PB9cOIOwquwPglikFQnzJRsX",
};

const DEFAULT_CONFIG = {
  xCaKey: "203760416",
  appSecret: "", // 留空时按 xCaKey 自动匹配
  appCode: "3fa3314998bd4195a9fe2df3e85e6a12",
  tenantId: "569001643002",
  cepAppId: "59701c08ed454a43a9b",
  appVersion: "4.2.3",
  deviceType: "IOS",
  deviceId: "",
  articleId: "",
  fallbackArticleId: "1881101031748870144",
  shareContentType: 1,
  shareEnabled: true,
  autoRunOnCapture: false,
  oncePerDay: true,
  debug: true,
  captureNotify: false, // 捕获到 token 时是否发送 "LynkCo Token Captured" 通知（需要重抓 token 时临时打开）
  /* 原生签名接口可选的设备头（研究结论：非必需，但保留以兼容风控） */
  device: {
    glDevName: "lynk&co",
    glDevModel: "PCAM10",
    glDevBrand: "huawei",
    glDevPlatform: "Android",
    glOsVersion: "10",
    glAppVersion: "4.2.3",
    glAppBuild: "402030320",
    glDevId: "",
  },
  /* 登录类接口额外参与签名的小写 x-ca-* 头 */
  nativeExtraCaHeaders: {},
};

function parseArgumentString(argument) {
  if (!argument) return {};
  return String(argument)
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

function resolveAppSecret(xCaKey) {
  const key = String(xCaKey || "").trim();
  return Object.prototype.hasOwnProperty.call(LYNK_CO_APP_SECRETS, key)
    ? LYNK_CO_APP_SECRETS[key]
    : LYNK_CO_APP_SECRETS[DEFAULT_CONFIG.xCaKey];
}

/** 合并参数生成最终配置 */
function buildConfig(argument) {
  const source = parseArgumentString(argument);
  const config = Object.assign({}, DEFAULT_CONFIG);
  const xCaKey = source.xCaKey || DEFAULT_CONFIG.xCaKey;
  config.xCaKey = String(xCaKey).trim();
  config.appSecret = source.appSecret || resolveAppSecret(config.xCaKey);
  config.appCode = source.appCode || DEFAULT_CONFIG.appCode;
  config.tenantId = source.tenantId || DEFAULT_CONFIG.tenantId;
  config.cepAppId = source.cepAppId || DEFAULT_CONFIG.cepAppId;
  config.appVersion = source.appVersion || DEFAULT_CONFIG.appVersion;
  config.deviceType = source.deviceType || DEFAULT_CONFIG.deviceType;
  config.deviceId = source.deviceId || DEFAULT_CONFIG.deviceId;
  config.refreshToken = source.refreshToken || "";
  config.articleId = source.articleId || "";
  config.fallbackArticleId = source.fallbackArticleId || DEFAULT_CONFIG.fallbackArticleId;
  config.shareContentType = source.shareContentType != null
    ? Number(source.shareContentType)
    : DEFAULT_CONFIG.shareContentType;
  config.shareEnabled = truthyFlag(source.shareEnabled, DEFAULT_CONFIG.shareEnabled);
  config.autoRunOnCapture = truthyFlag(source.autoRunOnCapture, DEFAULT_CONFIG.autoRunOnCapture);
  config.oncePerDay = truthyFlag(source.oncePerDay, DEFAULT_CONFIG.oncePerDay);
  config.debug = truthyFlag(source.debug, DEFAULT_CONFIG.debug);
  config.captureNotify = truthyFlag(source.captureNotify, DEFAULT_CONFIG.captureNotify);
  if (source.glDevId) config.device.glDevId = source.glDevId;
  return config;
}

/** 构造分享 URL（与 App H5 分享一致） */
function buildShareUrl(articleId) {
  const route = "lynkco://wx/?routeUrl=/pages/exploration/article/index.js?id=" + articleId;
  return (
    "https://h5.lynkco.com/app-h5/dist/web/pages/exploration/article/index.html?id=" +
    articleId +
    "&isShare=" +
    encodeURIComponent(route)
  );
}
