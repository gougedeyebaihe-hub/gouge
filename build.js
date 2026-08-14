#!/usr/bin/env node
/**
 * build.js — 打包 src/ 模块为单文件 lynkco.bundle.js，并生成 LynkCo.plugin
 *
 * 用法：node build.js
 * 产物：
 *   lynkco.bundle.js — Loon 脚本（cron 定时 + 流量捕获）
 *   LynkCo.plugin    — Loon 插件（可双击导入）
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const OUT_DIR = ROOT;

const BUNDLE_VERSION = "v20260813-refactor10";

/* 模块拼接顺序（依赖在前） */
const MODULES = [
  "crypto.js",
  "signature.js",
  "config.js",
  "store.js",
  "notify.js",
  "api.js",
  "tasks.js",
  "main.js",
];

function readModule(name) {
  const file = path.join(SRC, name);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  // 移除模块顶部的 /** ... */ 注释头（以独立一行的 " */" 为结束标志，
  // 不能用正则匹配首个 */，注释内容中的 */* 会提前截断）
  let start = 0;
  if (lines.length > 0 && lines[0].trim().startsWith("/**")) {
    let end = 1;
    while (end < lines.length && lines[end].trim() !== "*/") end += 1;
    start = Math.min(end + 1, lines.length);
  }
  return lines.slice(start).join("\n") + "\n";
}

function buildBundle() {
  const header = `/**
 * Lynk & Co Auto Sign & Share — Loon bundle
 * ${BUNDLE_VERSION}
 * 纯定时式：捕获一次 token 后，每天 cron 自动签到 + 文章分享。
 * 包含两套网关签名（H5 大写 X-Ca-* / 原生 SDK 小写 x-ca-* + Content-MD5）。
 * 由 src/ 模块构建生成，请勿直接编辑本文件。
 */
"use strict";

`;
  const body = MODULES.map(readModule).join("\n");
  return header + body;
}

function buildPlugin() {
  const bundleUrl =
    "https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco.bundle.js?v=" +
    BUNDLE_VERSION;

  const args = [
    "refreshToken=",
    "deviceId=",
    "deviceType=IOS",
    "appVersion=4.2.3",
    "articleId=",
    "xCaKey=203760416",
    "appSecret=",
    "appCode=3fa3314998bd4195a9fe2df3e85e6a12",
    "shareEnabled=1",
    "autoRunOnCapture=0",
    "oncePerDay=1",
    "forceRun=0",
    "debug=1",
    "captureNotify=0",
  ].join(",");

  return `#!name=Lynk & Co Auto Sign
#!desc=每日自动签到 + 文章分享（纯定时式，捕获一次 token 后无需再打开 App）| ${BUNDLE_VERSION}
#!arguments=${args}
#!author=LynkCo Refactor
#!homepage=https://github.com/gougedeyebaihe-hub/gouge

[Argument]
${args.replace(/,/g, "\n")}

[Script]
cron "1 0 * * *" script-path=${bundleUrl},tag=lynkco-daily-0001,timeout=120,enable=true
cron "1 3 * * *" script-path=${bundleUrl},tag=lynkco-daily-0301,timeout=120,enable=true
http-request ^https?:\\/\\/(h5-api|h5|app-api-gw-toc|app-services|gric-api)\\.(lynkco\\.com|lynkco\\.com\\.cn|geely\\.com)\\/.* script-path=${bundleUrl},requires-body=true,tag=lynkco-capture-request,timeout=30,enable=true
http-response ^https?:\\/\\/(h5-api|h5|app-api-gw-toc|app-services|gric-api)\\.(lynkco\\.com|lynkco\\.com\\.cn|geely\\.com)\\/.* script-path=${bundleUrl},requires-body=true,tag=lynkco-capture-response,timeout=30,enable=true

[MITM]
hostname = h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com,app-services.lynkco.com.cn,gric-api.geely.com
`;
}

fs.writeFileSync(path.join(OUT_DIR, "lynkco.bundle.js"), buildBundle(), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "LynkCo.plugin"), buildPlugin(), "utf8");

console.log("built: lynkco.bundle.js (" + fs.statSync(path.join(OUT_DIR, "lynkco.bundle.js")).size + " bytes)");
console.log("built: LynkCo.plugin");
