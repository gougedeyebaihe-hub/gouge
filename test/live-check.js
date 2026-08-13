/**
 * live-check.js — 真实服务器验证（只读）
 *
 * 用 Node https 实现 Loon 风格 $httpClient，复用 src/ 的签名与接口模块，
 * 直接调用领克真实服务器验证：token 有效性、签名密钥有效性。
 *
 * 用法：node test/live-check.js <refreshToken> [--sign]
 *   --sign  额外执行签到（默认只读：refresh + day/info + myEnergy）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const MODULES = [
  "crypto.js",
  "signature.js",
  "config.js",
  "store.js",
  "notify.js",
  "api.js",
  "tasks.js",
];

/* ---------- Node 版 Loon 风格 httpClient ---------- */

function createNodeHttpClient() {
  const client = {};
  ["get", "post", "put", "delete", "head", "patch"].forEach((method) => {
    client[method] = (params, callback) => {
      const parsed = new URL(params.url);
      const mod = parsed.protocol === "https:" ? https : http;
      const request = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: parsed.pathname + parsed.search,
          method: method.toUpperCase(),
          headers: params.headers || {},
          timeout: 15000,
        },
        (response) => {
          let data = "";
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () => {
            callback(null, { status: response.statusCode, headers: response.headers }, data);
          });
        },
      );
      request.on("error", (error) => callback(error.message));
      request.on("timeout", () => request.destroy(new Error("timeout")));
      if (params.body != null) request.write(params.body);
      request.end();
    };
  });
  client.calls = [];
  return client;
}

/* ---------- 加载 src 模块 ---------- */

// 剥离模块顶部的块注释头（与 build.js 一致）
function readModule(name) {
  const lines = fs.readFileSync(path.join(ROOT, "src", name), "utf8").split("\n");
  let start = 0;
  if (lines.length > 0 && lines[0].trim().startsWith("/**")) {
    let end = 1;
    while (end < lines.length && lines[end].trim() !== "*/") end += 1;
    start = Math.min(end + 1, lines.length);
  }
  return lines.slice(start).join("\n") + "\n";
}

function loadModules() {
  const source = MODULES.map(readModule).join("\n");
  const sandbox = { console, TextEncoder, URL, setTimeout, btoa: undefined };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

/* ---------- 主流程 ---------- */

async function main() {
  const args = process.argv.slice(2);
  const refreshTokenValue = args[0];
  const doSign = args.includes("--sign");
  if (!refreshTokenValue) {
    console.error("用法: node test/live-check.js <refreshToken> [--sign]");
    process.exit(1);
  }

  const lib = loadModules();
  const httpClient = createNodeHttpClient();
  const config = lib.buildConfig("debug=1");
  const tokenState = { refreshToken: refreshTokenValue, token: "", authorization: "" };

  const context = { config, tokenState, httpClient, store: null, notification: null, now: new Date() };
  const masked = (v) => (v ? String(v).slice(0, 14) + "..." : "none");

  console.log("== 1) refreshToken 续期 ==");
  let token = "";
  try {
    const refreshed = await lib.refreshToken(context, refreshTokenValue);
    token = refreshed.token || "";
    console.log("   OK  token=" + masked(token));
    console.log("   OK  refreshToken=" + masked(refreshed.refreshToken));
    console.log("   OK  expireAt=" + refreshed.expireAt);
    context.tokenState = Object.assign({}, context.tokenState, refreshed);
  } catch (error) {
    console.log("   FAIL " + error.message);
    console.log("   （若此处失败：token 可能已失效，或密钥/认证方式不匹配）");
  }

  if (!token) {
    console.log("\nrefresh 未获得 token，无法继续，终止。");
    process.exit(0);
  }

  console.log("\n== 2) 今日签到状态 day/info（H5 签名） ==");
  try {
    const result = await lib.getSignDayInfo(context);
    const state = lib.getTodaySignState(result.payload, new Date());
    console.log("   HTTP " + result.response.status + "  signState=" + (state || "unknown"));
    console.log("   resp=" + JSON.stringify(result.payload).slice(0, 300));
  } catch (error) {
    console.log("   FAIL " + error.message);
  }

  console.log("\n== 3) 积分 myEnergy（H5 签名） ==");
  try {
    const result = await lib.getMyEnergy(context);
    console.log("   HTTP " + result.response.status + "  resp=" + JSON.stringify(result.payload).slice(0, 300));
  } catch (error) {
    console.log("   FAIL " + error.message);
  }

  if (doSign) {
    console.log("\n== 4) 执行签到 sign/upgrade（原生签名） ==");
    try {
      const result = await lib.postSignUpgrade(context);
      console.log("   HTTP " + result.response.status + "  resp=" + JSON.stringify(result.payload).slice(0, 300));
    } catch (error) {
      console.log("   FAIL " + error.message);
    }
  } else {
    console.log("\n（只读验证完成，未执行签到。加 --sign 可执行签到）");
  }
}

main().catch((error) => {
  console.error("live-check error:", error);
  process.exit(1);
});
