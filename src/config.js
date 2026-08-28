/**
 * config.js — 配置解析与默认值
 *
 * 参数来源（$argument）：
 *   - 插件 [Argument] 控件 + 脚本行 argument=[{...}] → Loon 传入对象 {参数名: 值}
 *   - 手动调用（live-check 等）→ "key=value&key2=value2" 字符串
 */
"use strict";

/* 领克网关密钥表（X-Ca-Key → AppSecret）。
 * 来源（2026-08 现场核实）：
 *   - 204644386/QCl7udM3... 为 H5 前端 vendor JS 明文密钥对（crypto-js HmacSHA256 直接使用，
 *     2026-08 抓取 h5.lynkco.com 的 vendor.c0eb609d.js 确认仍在线使用，可能多密钥并存），
 *     最初经 Loon MitM 抓取 H5 JS 提取；
 *   - 203760416/e1msl9aqd... 为当前脚本生效密钥对（与 rulaizhi/LynkCoHelper 2021 config.json 同值，
 *     来源为当时抓取的 JS 版本或公开仓库，无法完全还原）。
 * 提取方法：轮换时用 Loon MitM 抓 H5 vendor JS，从签名实现中读明文密钥对（无需 root 逆向），
 * 详见 docs/protocol.md。 */
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

/** 解析 "?a=1&b=2" 形式文本为对象（URL query / 表单体 / 参数串）。
 * options.decode=false 时不做转义解码（参数串形态，保持原 parseArgument 行为）。 */
function parseQueryString(text, options) {
  const result = {};
  const query = String(text || "").replace(/^\?/, "");
  if (!query) return result;
  const decodeValues = !options || options.decode !== false;
  query.split("&").forEach((entry) => {
    if (!entry) return;
    const parts = entry.split("=");
    const key = (parts.shift() || "").trim();
    if (!key) return;
    const value = parts.join("=");
    if (!decodeValues) {
      result[key] = value.trim();
      return;
    }
    try {
      result[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch (error) {
      result[key] = value;
    }
  });
  return result;
}

function parseArgument(argument) {
  if (!argument) return {};
  if (typeof argument === "object") return argument; // [Argument] 控件对象形态
  return parseQueryString(argument, { decode: false }); // "key=value&key2=value2" 字符串形态
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
  const source = parseArgument(argument);
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
