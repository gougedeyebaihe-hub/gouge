/**
 * lib/modules.js — src/ 模块拼接公共逻辑（build.js 与 test/live-check.js 共用）
 *
 * readModule(root, name) 读取单个模块，剥离顶部 /** ... *\/ 注释头与模块级 "use strict"
 * （"use strict" 由 bundle 头部统一声明，避免重复）。
 */
"use strict";

const fs = require("fs");
const path = require("path");

/* 核心模块（不含 main.js：live-check 不需要入口分发，build 需要） */
const CORE_MODULES = [
  "crypto.js",
  "signature.js",
  "config.js",
  "store.js",
  "notify.js",
  "api.js",
  "tasks.js",
];

function readModule(root, name) {
  const file = path.join(root, name);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  // 移除模块顶部的 /** ... */ 注释头（以独立一行的 " */" 为结束标志，
  // 不能用正则匹配首个 */，注释内容中的 */* 会提前截断）
  let start = 0;
  if (lines.length > 0 && lines[0].trim().startsWith("/**")) {
    let end = 1;
    while (end < lines.length && lines[end].trim() !== "*/") end += 1;
    start = Math.min(end + 1, lines.length);
  }
  if (lines[start] && lines[start].trim() === '"use strict";') start += 1;
  return lines.slice(start).join("\n") + "\n";
}

module.exports = { CORE_MODULES, readModule };
