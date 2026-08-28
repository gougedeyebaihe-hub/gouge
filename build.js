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
 * 避免两处硬编码漂移；build 后执行 5 条生成自检（见 verifyPlugin）。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { CORE_MODULES, readModule } = require("./lib/modules");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const OUT_DIR = ROOT;

const BUNDLE_VERSION = "v20260828-refactor24";
const PLUGIN_DATE = "2026-08-28";

/* 模块拼接顺序（依赖在前；main.js 为入口分发，仅 bundle 需要） */
const MODULES = CORE_MODULES.concat(["main.js"]);

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
  { name: "captureNotify", type: "switch", default: false, tag: "捕获通知", desc: "捕获 token 时发通知，重抓时临时开" },
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
    'cron "1 0 * * *" script-path=' + bundleUrl + ",tag=lynkco-daily-0001,timeout=120,argument=" + placeholders + ",enable=true",
    'cron "1 3 * * *" script-path=' + bundleUrl + ",tag=lynkco-daily-0301,timeout=120,argument=" + placeholders + ",enable=true",
    // 捕获脚本 timeout 与 cron 一致（120s）：autoRunOnCapture=true 时捕获触发会跑完整任务链，
    // 30s 超时会中途杀掉执行且无提示
    "http-request " + capturePattern + " script-path=" + bundleUrl + ",requires-body=true,tag=lynkco-capture-request,timeout=120,argument=" + placeholders + ",enable=true",
    "http-response " + capturePattern + " script-path=" + bundleUrl + ",requires-body=true,tag=lynkco-capture-response,timeout=120,argument=" + placeholders + ",enable=true",
    "generic script-path=" + bundleUrl + ",tag=lynkco-manual,timeout=120,argument=" + placeholders + ",enable=true",
  ].join("\n");

  return (
    "#!name = Lynk & Co Auto Sign\n" +
    "#!desc = 每日自动签到 + 文章分享（纯定时式，捕获一次 token 后无需再打开 App）| " + BUNDLE_VERSION + "（" + PLUGIN_DATE + " 更新）\n" +
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
