#!/usr/bin/env node
/**
 * build.js — 打包 src/ 模块为单文件 lynkco.bundle.js，并生成 LynkCo.plugin
 *
 * 用法：node build.js
 * 产物：
 *   lynkco.bundle.js — Loon 脚本（cron 定时 + 流量捕获 + generic 手动触发）
 *   LynkCo.plugin    — Loon 插件（可双击导入）
 *
 * 参数单一来源：PARAMS 数组同时生成 [Argument] 段与脚本行 argument=[{...}] 占位符，
 * 避免两处硬编码漂移；cron 时刻亦参数化（cron {cronTime} / {retryCron}，官方文档支持
 * 参数作 cron 表达式，无效则该行不执行）；build 后执行 7 条生成自检（见 verifyPlugin）。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { CORE_MODULES, readModule } = require("./lib/modules");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const OUT_DIR = ROOT;

const BUNDLE_VERSION = "v20260830-refactor16";
const PLUGIN_DATE = "2026-08-30";

/* 模块拼接顺序（依赖在前；main.js 为入口分发，仅 bundle 需要） */
const MODULES = CORE_MODULES.concat(["main.js"]);

/* 每日两行 cron 的时刻选项（select 值即 cron 表达式，首项为默认=现状行为）。
 * 签到/重试两行地位对称（先成功者赢，oncePerDay 抑制其余），选项配对建议相差约 3 小时。 */
const CRON_TIME_OPTIONS = ["1 0 * * *", "30 0 * * *", "30 1 * * *", "30 7 * * *", "30 12 * * *"];
const RETRY_CRON_OPTIONS = ["1 3 * * *", "30 3 * * *", "30 4 * * *", "30 10 * * *", "30 15 * * *"];

/* 插件参数（[Argument] 控件 + 脚本 argument 占位符的单一来源）。
 * type: input / select / switch；default：input 为默认字符串，select 为可选项（首项为默认），switch 为布尔。
 * 注意：desc 内不能出现 ASCII 逗号（Loon 按逗号切分参数）。 */
const PARAMS = [
  { name: "refreshToken", type: "input", default: "", tag: "手动 refreshToken", desc: "留空时由流量捕获自动保存" },
  { name: "deviceId", type: "input", default: "", tag: "deviceId", desc: "留空时自动捕获" },
  { name: "deviceType", type: "select", default: ["IOS", "Android"], tag: "设备类型" },
  { name: "appVersion", type: "input", default: "4.2.3", tag: "App 版本", desc: "领克 App 版本号" },
  { name: "articleId", type: "input", default: "", tag: "固定分享文章 ID", desc: "留空自动取广场最新文章" },
  { name: "xCaKey", type: "input", default: "203760416", tag: "X-Ca-Key", desc: "网关密钥，轮换后需更新" },
  { name: "appSecret", type: "input", default: "", tag: "AppSecret", desc: "留空按 xCaKey 自动匹配" },
  { name: "appCode", type: "input", default: "3fa3314998bd4195a9fe2df3e85e6a12", tag: "AppCode", desc: "静态认证用" },
  { name: "shareEnabled", type: "switch", default: true, tag: "启用文章分享" },
  { name: "autoRunOnCapture", type: "switch", default: false, tag: "捕获后立即运行" },
  { name: "oncePerDay", type: "switch", default: true, tag: "每日仅一次", desc: "当日成功后静默跳过" },
  { name: "debug", type: "switch", default: true, tag: "诊断信息", desc: "通知附带签名/响应摘要" },
  { name: "captureNotify", type: "switch", default: false, tag: "捕获通知", desc: "捕获 token 时发通知；重抓时临时开" },
  { name: "cronTime", type: "select", default: CRON_TIME_OPTIONS, tag: "每日签到时刻", desc: "依次为 00:01/00:30/01:30/07:30/12:30；无效表达式该行不执行" },
  { name: "retryCron", type: "select", default: RETRY_CRON_OPTIONS, tag: "失败重试时刻", desc: "依次为 03:01/03:30/04:30/10:30/15:30；建议比签到时刻晚约3小时" },
];

/* 捕获脚本匹配的真实主机（与 src/api.js 的 AUTH_HOSTS/BUSINESS_HOST/H5_API_HOST/SHARE_HOST 一致） */
const CAPTURE_HOSTS = [
  "h5-api.lynkco.com",
  "h5.lynkco.com",
  "app-api-gw-toc.lynkco.com",
  "app-services.lynkco.com.cn",
  "gric-api.geely.com",
];

/* 捕获正则由主机子域/域生成，保证与 [MITM] hostname 不脱节（verifyPlugin 自检 5） */
const CAPTURE_SUBDOMAINS = ["h5-api", "h5", "app-api-gw-toc", "app-services", "gric-api"];
const CAPTURE_DOMAINS = ["lynkco.com", "lynkco.com.cn", "geely.com"];

function buildCapturePattern() {
  return (
    "^https?:\\/\\/(" +
    CAPTURE_SUBDOMAINS.join("|") +
    ")\\." +
    "(" +
    CAPTURE_DOMAINS.map((domain) => domain.replace(/\./g, "\\.")).join("|") +
    ")\\/.*"
  );
}

function buildBundle() {
  const header = `/**
 * Lynk & Co Auto Sign & Share — Loon bundle
 * ${BUNDLE_VERSION}
 * 纯定时式：捕获一次 token 后，每天 cron 自动签到 + 文章分享；generic 可手动触发。
 * 包含两套网关签名（H5 大写 X-Ca-* / 原生 SDK 小写 x-ca-* + Content-MD5）。
 * 由 src/ 模块构建生成，请勿直接编辑本文件。
 */
"use strict";

`;
  const body = MODULES.map((name) => readModule(SRC, name)).join("\n");
  return header + body;
}

/* ---------------- 插件生成 ---------------- */

function quoted(value) {
  return '"' + value + '"';
}

function buildArgumentSection() {
  return PARAMS.map((param) => {
    let line = param.name + " = " + param.type + ",";
    if (param.type === "select") {
      line += param.default.map(quoted).join(",");
    } else if (param.type === "switch") {
      line += param.default ? "true" : "false";
    } else {
      line += quoted(param.default);
    }
    if (param.tag) line += ",tag=" + param.tag;
    if (param.desc) line += ",desc=" + param.desc;
    return line;
  }).join("\n");
}

function argumentPlaceholders() {
  return "[" + PARAMS.map((param) => "{" + param.name + "}").join(",") + "]";
}

function buildPlugin() {
  const bundleUrl =
    "https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco.bundle.js?v=" +
    BUNDLE_VERSION;
  const placeholders = argumentPlaceholders();
  const capturePattern = buildCapturePattern();

  const scriptLines = [
    "cron {cronTime} script-path=" + bundleUrl + ",tag=lynkco-daily-0001,timeout=120,argument=" + placeholders + ",enable=true",
    "cron {retryCron} script-path=" + bundleUrl + ",tag=lynkco-daily-0301,timeout=120,argument=" + placeholders + ",enable=true",
    "http-request " + capturePattern + " script-path=" + bundleUrl + ",requires-body=true,tag=lynkco-capture-request,timeout=30,argument=" + placeholders + ",enable=true",
    "http-response " + capturePattern + " script-path=" + bundleUrl + ",requires-body=true,tag=lynkco-capture-response,timeout=30,argument=" + placeholders + ",enable=true",
    "generic script-path=" + bundleUrl + ",tag=lynkco-manual,timeout=120,argument=" + placeholders + ",enable=true",
  ].join("\n");

  return (
    "#!name = Lynk & Co Auto Sign\n" +
    "#!desc = 每日自动签到 + 文章分享（纯定时式，捕获一次 token 后无需再打开 App）| " + BUNDLE_VERSION + "\n" +
    "#!author = LynkCo Refactor\n" +
    "#!homepage = https://github.com/gougedeyebaihe-hub/gouge\n" +
    "#!date = " + PLUGIN_DATE + "\n" +
    "#!system = iOS,iPadOS,tvOS,macOS\n" +
    "#!loon_version = 3.2.1(733)\n" +
    "#!tag = 签到,领克\n" +
    "#!type = normal\n" +
    "\n" +
    "[Argument]\n" +
    buildArgumentSection() +
    "\n\n" +
    "[Script]\n" +
    scriptLines +
    "\n\n" +
    "[MITM]\n" +
    "hostname = " + CAPTURE_HOSTS.join(",") + "\n"
  );
}

/* ---------------- 生成自检 ---------------- */

function sectionOf(plugin, sectionName) {
  const start = plugin.indexOf("[" + sectionName + "]");
  if (start < 0) return "";
  const rest = plugin.slice(start + sectionName.length + 2);
  const end = rest.indexOf("\n[");
  return end < 0 ? rest : rest.slice(0, end);
}

function verifyPlugin(plugin) {
  const failures = [];
  const paramNames = PARAMS.map((param) => param.name);

  // 1) [Argument] 参数名集合 == 占位符集合（无遗漏、无多余）
  const placeholders = Array.from(plugin.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (match) => match[1]);
  const paramSet = new Set(paramNames);
  const placeholderSet = new Set(placeholders);
  paramSet.forEach((name) => {
    if (!placeholderSet.has(name)) failures.push("自检1: 占位符缺少参数 " + name);
  });
  placeholderSet.forEach((name) => {
    if (!paramSet.has(name)) failures.push("自检1: 占位符不在 [Argument] 中 " + name);
  });

  // 2) 每条 [Script] 行均含 argument=[{...}]
  const scriptSection = sectionOf(plugin, "Script");
  scriptSection.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    if (!line.includes("argument=[{")) failures.push("自检2: 脚本行缺 argument 占位符: " + line.slice(0, 80));
  });

  // 3) 产物不含 #!arguments（非文档化字段）
  if (plugin.includes("#!arguments")) failures.push("自检3: 产物仍含 #!arguments");

  // 4) [Argument] 所有 desc 不含 ASCII 逗号
  const argumentSection = sectionOf(plugin, "Argument");
  argumentSection.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const descMatch = line.match(/desc=(.+)$/);
    if (descMatch && descMatch[1].includes(",")) failures.push("自检4: desc 含 ASCII 逗号: " + line);
  });

  // 5) [MITM] 主机与捕获正则一致：每个主机子域/域均在正则集合内，且正则组合覆盖全部主机
  const captureRegex = new RegExp(buildCapturePattern());
  CAPTURE_HOSTS.forEach((host) => {
    const sub = host.split(".")[0];
    const domain = host.split(".").slice(1).join(".");
    if (!CAPTURE_SUBDOMAINS.includes(sub)) failures.push("自检5: MITM 主机子域不在捕获正则中: " + host);
    if (!CAPTURE_DOMAINS.includes(domain)) failures.push("自检5: MITM 主机域不在捕获正则中: " + host);
    if (!captureRegex.test("https://" + host + "/")) failures.push("自检5: MITM 主机无法被捕获正则匹配: " + host);
  });

  // 6) cron 时刻参数：选项均为合法 5 段 cron，且默认项保持原行为（00:01 / 03:01）
  const cronOptionRegex = /^\d{1,2} \d{1,2} \* \* \*$/;
  const cronDefaults = { cronTime: "1 0 * * *", retryCron: "1 3 * * *" };
  Object.keys(cronDefaults).forEach((name) => {
    const param = PARAMS.find((item) => item.name === name);
    if (!param || param.type !== "select") {
      failures.push("自检6: 缺少 " + name + " select 参数");
      return;
    }
    if (param.default[0] !== cronDefaults[name]) {
      failures.push("自检6: " + name + " 默认项应为 " + cronDefaults[name] + "，实为 " + param.default[0]);
    }
    param.default.forEach((option) => {
      if (!cronOptionRegex.test(option)) failures.push("自检6: " + name + " 选项不是合法 5 段 cron: " + option);
    });
  });

  // 7) [Script] 的两行 cron 使用参数模板（cron {cronTime} / {retryCron}），无硬编码时刻
  const cronLines = scriptSection.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("cron "));
  if (cronLines.length !== 2) failures.push("自检7: cron 行数量应为 2，实为 " + cronLines.length);
  if (!cronLines.some((line) => line.startsWith("cron {cronTime} ") && line.includes("tag=lynkco-daily-0001"))) {
    failures.push("自检7: 签到行未使用 cron {cronTime} 模板");
  }
  if (!cronLines.some((line) => line.startsWith("cron {retryCron} ") && line.includes("tag=lynkco-daily-0301"))) {
    failures.push("自检7: 重试行未使用 cron {retryCron} 模板");
  }
  cronLines.forEach((line) => {
    if (/cron "\d/.test(line)) failures.push("自检7: cron 行残留硬编码时刻: " + line.slice(0, 60));
  });

  return failures;
}

/* ---------------- 主流程 ---------------- */

fs.writeFileSync(path.join(OUT_DIR, "lynkco.bundle.js"), buildBundle(), "utf8");
const plugin = buildPlugin();
fs.writeFileSync(path.join(OUT_DIR, "LynkCo.plugin"), plugin, "utf8");

const failures = verifyPlugin(plugin);
if (failures.length > 0) {
  console.error("plugin 生成自检未通过:");
  failures.forEach((failure) => console.error("  - " + failure));
  process.exit(1);
}

console.log("built: lynkco.bundle.js (" + fs.statSync(path.join(OUT_DIR, "lynkco.bundle.js")).size + " bytes)");
console.log("built: LynkCo.plugin (自检通过: " + PARAMS.length + " 参数 / " + CAPTURE_HOSTS.length + " 主机)");
