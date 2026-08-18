/**
 * run-tests.js — 离线测试：crypto 向量、签名格式、mock 流程、插件产物格式
 *
 * 用法：node test/run-tests.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nodeCrypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const BUNDLE = fs.readFileSync(path.join(ROOT, "lynkco.bundle.js"), "utf8");
const PLUGIN = fs.readFileSync(path.join(ROOT, "LynkCo.plugin"), "utf8");

let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log("  ok  " + name);
  } else {
    failed += 1;
    console.log("FAIL  " + name + (detail ? "  -> " + detail : ""));
  }
}

/* ================= mock Loon 环境 ================= */

function createMockStore() {
  const data = {};
  return {
    read: (key) => (key in data ? data[key] : ""),
    write: (value, key) => {
      data[key] = value;
    },
    _data: data,
  };
}

function createMockNotification() {
  const posts = [];
  return {
    post: (title, subtitle, content) => {
      posts.push({ title, subtitle, content });
    },
    _posts: posts,
  };
}

/**
 * 可编程 $httpClient mock：routes 按顺序匹配，命中返回 handler。
 * handler: ({url, method, headers, body}) => { status, data }
 */
function createMockHttpClient(routes) {
  const calls = [];
  const client = {};
  ["get", "post", "put", "delete", "head", "patch"].forEach((method) => {
    client[method] = (params, callback) => {
      const url = params.url || "";
      const body = params.body || "";
      const headers = params.headers || {};
      calls.push({ method, url, headers, body });
      const route = routes.find((item) => item.match(method, url));
      if (!route) {
        callback(null, { status: 200 }, JSON.stringify({ code: "error", message: "no mock route: " + url }));
        return;
      }
      const result = route.respond({ method, url, headers, body });
      callback(null, { status: result.status || 200 }, result.data);
    };
  });
  client.calls = calls;
  return { client, calls };
}

/** 构造 Loon 沙箱基础对象（runBundleOnce / createBundleSandbox 共用） */
function makeSandbox({ store, notification, httpClient, argument, done }) {
  const sandbox = {
    $persistentStore: store,
    $notification: notification,
    $httpClient: httpClient,
    $argument: argument || "",
    $done: done || (() => {}),
    console: console,
    TextEncoder: TextEncoder,
    setTimeout: setTimeout,
    URL: URL,
  };
  return sandbox;
}

/** 在 vm 中执行 bundle，模拟一次 Loon 脚本运行；返回 sandbox（含 __doneCalled/__doneArgs） */
function runBundleOnce({ request, response, argument, store, notification, httpClient, script }) {
  const sandbox = makeSandbox({
    store,
    notification,
    httpClient,
    argument,
    done: (args) => {
      sandbox.__doneCalled = true;
      sandbox.__doneArgs = args;
    },
  });
  if (request) sandbox.$request = request;
  if (response) sandbox.$response = response;
  if (script) sandbox.$script = script;
  vm.createContext(sandbox);
  vm.runInContext(BUNDLE, sandbox);
  return sandbox;
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate() || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 10);
  });
}

/** 创建加载了完整 bundle 的 vm 沙箱（用于直接引用内部函数） */
function createBundleSandbox() {
  const sandbox = makeSandbox({
    store: createMockStore(),
    notification: createMockNotification(),
    httpClient: createMockHttpClient([]).client,
    argument: "",
  });
  vm.createContext(sandbox);
  vm.runInContext(BUNDLE, sandbox);
  return sandbox;
}

/* ================= 测试数据 ================= */

const TEST_CONFIG_ARGUMENT = "refreshToken=rt-test-1&deviceId=dev-1&debug=1";
const TEST_CONFIG_OBJECT = { refreshToken: "rt-test-1", deviceId: "dev-1", debug: true, shareEnabled: true };

const FIXED_ARTICLE_ID = "2075054309774663680";

/** 通用认证路由：refresh 成功 + 今日已签（shareValidation / manual 等用例复用） */
function createAuthRoutes() {
  return [
    {
      match: (method, url) => method === "get" && url.includes("/auth/login/refresh"),
      respond: () => ({
        data: JSON.stringify({
          code: "success",
          data: { centerTokenDto: { token: "t2", refreshToken: "rt2", expireAt: 9999999999 } },
        }),
      }),
    },
    {
      match: (method, url) => method === "get" && url.includes("/up/api/v1/user/sign/day/info"),
      respond: () => ({ data: JSON.stringify({ code: "success", data: { signStatus: 1 } }) }),
    },
  ];
}

/** 完整签到+分享流程的 mock routes（respond 内需要 client.calls 时经 setClient 注入） */
function createFullFlowRoutes() {
  let client = null;
  const routes = [
    // refresh：返回新 token
    {
      match: (method, url) => method === "get" && url.includes("/auth/login/refresh"),
      respond: () => ({
        data: JSON.stringify({
          code: "success",
          data: {
            centerTokenDto: {
              token: "bearer-refreshed-token",
              refreshToken: "rt-new-1",
              expireAt: 9999999999,
            },
          },
        }),
      }),
    },
    // 签到状态查询：upgrade 前未签，upgrade 后已签
    {
      match: (method, url) => method === "get" && url.includes("/up/api/v1/user/sign/day/info"),
      respond: ({ url }) => {
        const upgraded = client.calls.some((c) => c.url.includes("/up/api/v1/user/sign/upgrade"));
        return { data: JSON.stringify({ code: "success", data: { signStatus: upgraded ? 1 : 0 } }) };
      },
    },
    // 执行签到：成功
    {
      match: (method, url) => method === "post" && url.includes("/up/api/v1/user/sign/upgrade"),
      respond: () => ({
        data: JSON.stringify({ code: "success", data: { signStatus: 1 } }),
      }),
    },
    // 广场文章列表（square/index2）
    {
      match: (method, url) => method === "post" && url.includes("/app/explore/home-page/square/index2"),
      respond: () => ({
        data: JSON.stringify({
          code: "success",
          data: {
            userByteDynamicsResponseDTOS: [{ dynamicId: FIXED_ARTICLE_ID, contentType: "1" }],
          },
        }),
      }),
    },
    // getShareCode：直接返回 shareCode
    {
      match: (method, url) => method === "get" && url.includes("/app/v1/task/getShareCode"),
      respond: () => ({
        data: JSON.stringify({ code: "success", data: "share-code-123" }),
      }),
    },
    // shareReporting：成功
    {
      match: (method, url) => method === "post" && url.includes("/app/v1/task/shareReporting"),
      respond: () => ({
        data: JSON.stringify({ code: "success" }),
      }),
    },
    // myEnergy：前 100 → 后 105
    {
      match: (method, url) => method === "get" && url.includes("/app/energy/myEnergy"),
      respond: ({ url }) => {
        const energyCalls = client.calls.filter(
          (c) => c.url.includes("/app/energy/myEnergy"),
        ).length;
        const point = energyCalls <= 1 ? 100 : 105;
        return { data: JSON.stringify({ code: "success", data: { point } }) };
      },
    },
  ];
  return {
    routes,
    setClient: (value) => {
      client = value;
    },
  };
}

/* ================= 用例 ================= */

async function testCryptoVectors() {
  console.log("\n== crypto 向量 ==");
  const sandbox = createBundleSandbox();
  vm.runInContext(`
    function hex(bytes){ return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join(''); }
    this.sha256hex = (t) => hex(sha256Bytes(utf8Bytes(t)));
    this.hmacHex = (k, m) => hex(hmacSha256Bytes(utf8Bytes(k), utf8Bytes(m)));
    this.md5hex = (t) => hex(md5Bytes(utf8Bytes(t)));
    this.md5b64 = (t) => md5Base64(t);
    this.b64 = (t) => bytesToBase64(utf8Bytes(t));
  `, sandbox);

  assert("sha256('abc')", sandbox.sha256hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert("sha256('')", sandbox.sha256hex("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert(
    "hmac-sha256(key, fox)",
    sandbox.hmacHex("key", "The quick brown fox jumps over the lazy dog") ===
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  );
  assert("md5('')", sandbox.md5hex("") === "d41d8cd98f00b204e9800998ecf8427e");
  assert("md5('abc')", sandbox.md5hex("abc") === "900150983cd24fb0d6963f7d28e17f72");
  assert("md5('{}')", sandbox.md5hex("{}") === nodeCrypto.createHash("md5").update("{}").digest("hex"));
  assert(
    "md5 base64('{}')",
    sandbox.md5b64("{}") === nodeCrypto.createHash("md5").update("{}").digest("base64"),
  );
  assert("base64('Man')", sandbox.b64("Man") === "TWFu");
  assert(
    "base64(utf8 中文)",
    sandbox.b64("中文") === Buffer.from("中文", "utf8").toString("base64"),
  );
}

function testSignatureFormat() {
  console.log("\n== 签名格式 ==");
  const sandbox = createBundleSandbox();
  vm.runInContext(`
    this.h5 = (input) => buildH5SignString(input);
    this.native = (input) => buildNativeSignString(input);
    this.sorted = (q) => sortQuery(q);
    this.date = () => httpDate(new Date(Date.UTC(2026, 7, 13, 3, 0, 0)));
  `, sandbox);

  const h5 = sandbox.h5({
    method: "POST",
    uri: "/up/api/v1/user/sign/upgrade",
    xCaKey: "203760416",
    nonce: "11111111-2222-4333-8444-555555555555",
    timestamp: "1720000000000",
  });
  assert(
    "H5 签名串格式",
    h5 ===
      "POST\n*/*\n\napplication/json\n\n" +
      "X-Ca-Key:203760416\nX-Ca-Nonce:11111111-2222-4333-8444-555555555555\n" +
      "X-Ca-Signature-Method:HmacSHA256\nX-Ca-Timestamp:1720000000000\n" +
      "/up/api/v1/user/sign/upgrade",
    h5.replace(/\n/g, "\\n"),
  );

  const native = sandbox.native({
    method: "POST",
    uri: "/up/api/v1/user/sign/upgrade",
    body: "{}",
    xCaKey: "203760416",
    nonce: "11111111-2222-4333-8444-555555555555",
    timestamp: "1720000000000",
    date: "Thu, 13 Aug 2026 03:00:00 GMT",
  });
  const emptyMd5B64 = nodeCrypto.createHash("md5").update("{}").digest("base64");
  assert(
    "原生签名串格式",
    native.signString ===
      "POST\n*/*\n" + emptyMd5B64 + "\napplication/json\nThu, 13 Aug 2026 03:00:00 GMT\n" +
      "x-ca-key:203760416\nx-ca-nonce:11111111-2222-4333-8444-555555555555\n" +
      "x-ca-timestamp:1720000000000\n/up/api/v1/user/sign/upgrade",
    native.signString.replace(/\n/g, "\\n"),
  );
  assert("原生签名 Content-MD5", native.contentMd5 === emptyMd5B64);

  assert(
    "query 排序",
    sandbox.sorted("b=2&a=1&c=3") === "a=1&b=2&c=3",
    sandbox.sorted("b=2&a=1&c=3"),
  );
  assert(
    "path+query 排序参与签名",
    sandbox.native({
      method: "GET",
      uri: "/auth/login/refresh?z=1&a=2",
      body: "",
      xCaKey: "k",
      nonce: "n",
      timestamp: "t",
      date: "Thu, 13 Aug 2026 03:00:00 GMT",
    }).signString.split("\n").pop() === "/auth/login/refresh?a=2&z=1",
  );
}

async function testNoTokenFlow() {
  console.log("\n== 流程：无 token ==");
  const store = createMockStore();
  const notification = createMockNotification();
  const { client } = createMockHttpClient([]);

  runBundleOnce({ argument: "debug=1", store, notification, httpClient: client });
  await waitFor(() => notification._posts.length > 0, 2000);

  assert("无 token 时发送提示通知", notification._posts.length >= 1);
  const post = notification._posts[0];
  assert("通知提示打开 App", post && post.content.includes("Open Lynk & Co once"), post && post.content);
}

async function testFullFlow(argument, label) {
  console.log("\n== 流程：" + label + " ==");
  const store = createMockStore();
  const notification = createMockNotification();

  const flow = createFullFlowRoutes();
  const { client } = createMockHttpClient(flow.routes);
  flow.setClient(client);

  const sandbox = runBundleOnce({ argument, store, notification, httpClient: client });
  await waitFor(() => notification._posts.length > 0 && sandbox.__doneCalled, 3000);

  const post = notification._posts[0];
  assert("收到结果通知", Boolean(post), JSON.stringify(notification._posts));
  assert("任务完成前不调用 $done（异步不被中断）", sandbox.__doneCalled === true);
  assert(
    "签到+分享成功",
    post && post.content.includes("Sign: ok") && post.content.includes("Share: ok"),
    post && post.content,
  );
  assert("分享加分 +5", post && post.content.includes("+5 已到账"), post && post.content);
  assert("通知不含分享链接（link= 已移除）", post && !post.content.includes("link="), post && post.content);
  assert(
    "shareReporting 带 H5 签名",
    client.calls.some((c) => c.url.includes("shareReporting") && c.headers["X-Ca-Signature"]),
  );
  assert(
    "shareReporting 带 Origin",
    client.calls.some((c) => c.url.includes("shareReporting") && c.headers.Origin === "https://h5.lynkco.com"),
  );
  assert(
    "sign upgrade 带原生签名头",
    client.calls.some(
      (c) => c.url.includes("/sign/upgrade") && c.headers["x-ca-signature"] && c.headers["Content-MD5"],
    ),
  );
}

async function testShareValidationFlow() {
  console.log("\n== 流程：分享需要 certifyId（security/config 兜底） ==");
  const store = createMockStore();
  const notification = createMockNotification();

  const routes = [
    ...createAuthRoutes(),
    {
      match: (method, url) => method === "get" && url.includes("/app/v1/task/getShareCode"),
      respond: ({ headers }) => {
        if (headers.certifyId === "cert-42") {
          return { data: JSON.stringify({ code: "success", data: "share-code-with-cert" }) };
        }
        return {
          status: 200,
          data: JSON.stringify({ code: "error", message: "share.need.validate.check" }),
        };
      },
    },
    {
      match: (method, url) => method === "get" && url.includes("/auth/v1/security/config"),
      respond: () => ({
        data: JSON.stringify({ code: "success", data: { certifyId: "cert-42" } }),
      }),
    },
    {
      match: (method, url) => method === "post" && url.includes("/app/v1/task/shareReporting"),
      respond: () => ({ data: JSON.stringify({ code: "success" }) }),
    },
    {
      match: (method, url) => method === "get" && url.includes("/app/energy/myEnergy"),
      respond: () => ({ data: JSON.stringify({ code: "success", data: { point: 200 } }) }),
    },
  ];
  const { client } = createMockHttpClient(routes);

  runBundleOnce({
    argument: "refreshToken=rt2&articleId=" + FIXED_ARTICLE_ID + "&debug=1",
    store,
    notification,
    httpClient: client,
  });
  await waitFor(() => notification._posts.length > 0, 3000);

  const post = notification._posts[0];
  assert("收到结果通知", Boolean(post), JSON.stringify(notification._posts));
  assert("验证码兜底成功", post && post.content.includes("Share: ok"), post && post.content);
  assert(
    "certifyId 用于 getShareCode",
    client.calls.some((c) => c.url.includes("getShareCode") && c.headers.certifyId === "cert-42"),
  );
}

async function testCaptureFlow() {
  console.log("\n== 流程：流量捕获 token ==");
  const store = createMockStore();
  const notification = createMockNotification();
  const { client } = createMockHttpClient([]);

  const request = {
    url: "https://app-services.lynkco.com.cn/auth/login/refresh?refreshToken=rt-captured-1&deviceId=dev-9&deviceType=IOS&appVersion=4.2.3",
    headers: { token: "bearer-cap-token" },
    body: "",
  };
  runBundleOnce({ request, store, notification, httpClient: client });

  assert("捕获后存储 token", store._data["lynkco.share.tokenState"] || "");
  const stored = JSON.parse(store._data["lynkco.share.tokenState"]);
  assert("refreshToken 捕获正确", stored.refreshToken === "rt-captured-1", JSON.stringify(stored));
  assert("token 捕获正确", stored.token === "bearer-cap-token");
  assert("deviceId 捕获正确", stored.deviceId === "dev-9");
  assert("默认不发送捕获通知（captureNotify=0）", notification._posts.length === 0);

  // captureNotify=1 时发送通知
  const store2 = createMockStore();
  const notification2 = createMockNotification();
  runBundleOnce({ request, store: store2, notification: notification2, httpClient: client, argument: "captureNotify=1" });
  assert("captureNotify=1 时发送捕获通知", notification2._posts.length >= 1);
}

async function testOncePerDay() {
  console.log("\n== 流程：oncePerDay 跳过 ==");
  const store = createMockStore();
  const notification = createMockNotification();
  const { client } = createMockHttpClient([]);
  // 预置今日已完成
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  store.write(JSON.stringify({ date: today, success: true }), "lynkco.share.dailyState");
  store.write(JSON.stringify({ refreshToken: "rt-old" }), "lynkco.share.tokenState");

  const sandbox = runBundleOnce({ argument: "oncePerDay=1&debug=1", store, notification, httpClient: client });
  await waitFor(() => sandbox.__doneCalled, 1000);

  assert("今日已成功则无请求", client.calls.length === 0, "calls=" + client.calls.length);
  assert("跳过时静默（无通知）", notification._posts.length === 0, JSON.stringify(notification._posts));
}

async function testManualTrigger() {
  console.log("\n== 流程：generic 手动触发（绕过 oncePerDay，弹页） ==");
  const store = createMockStore();
  const notification = createMockNotification();
  // 预置 token + 今日已完成（验证手动触发绕过 oncePerDay 静默跳过）
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  store.write(JSON.stringify({ date: today, success: true }), "lynkco.share.dailyState");
  store.write(JSON.stringify({ refreshToken: "rt-manual", token: "t-manual" }), "lynkco.share.tokenState");

  // 完整流程路由（含分享），验证弹页剥离 link 且通知保留 link
  const flow = createFullFlowRoutes();
  const { client } = createMockHttpClient(flow.routes);
  flow.setClient(client);

  const sandbox = runBundleOnce({
    argument: { oncePerDay: true, debug: true },
    store,
    notification,
    httpClient: client,
    script: { name: "lynkco-manual" },
  });
  await waitFor(() => sandbox.__doneCalled, 3000);

  assert("手动触发绕过 oncePerDay 仍执行", client.calls.length > 0, "calls=" + client.calls.length);
  assert("$done 收到弹页对象", sandbox.__doneArgs && typeof sandbox.__doneArgs === "object" && sandbox.__doneArgs.title === "LynkCo Daily", JSON.stringify(sandbox.__doneArgs));
  assert("弹页包含执行结果", sandbox.__doneArgs && sandbox.__doneArgs.htmlMessage && sandbox.__doneArgs.htmlMessage.includes("Sign: ok"), sandbox.__doneArgs && sandbox.__doneArgs.htmlMessage);
  assert("弹页不含分享链接", sandbox.__doneArgs.htmlMessage && !sandbox.__doneArgs.htmlMessage.includes("link="), sandbox.__doneArgs.htmlMessage);
  assert("手动触发也发送通知", notification._posts.length >= 1);
  assert("通知不含分享链接", notification._posts[0] && !notification._posts[0].content.includes("link="), notification._posts[0] && notification._posts[0].content);
  // cron 路径今日已成功应静默跳过：已由 testOncePerDay 覆盖（预置今日成功 → 无请求 + 无通知）
}

function testPluginFormat() {
  console.log("\n== 插件产物格式（LynkCo.plugin） ==");

  // 1) 非文档化字段 #!arguments 已移除
  assert("无 #!arguments 字段", !PLUGIN.includes("#!arguments"));

  // 2) 元信息字段齐全
  assert("含 #!loon_version = 3.2.1(733)", PLUGIN.includes("#!loon_version = 3.2.1(733)"));
  assert("含 #!system", PLUGIN.includes("#!system = "));
  assert("含 #!type = normal", PLUGIN.includes("#!type = normal"));
  assert("含 #!date", PLUGIN.includes("#!date = "));
  assert("desc 含版本号", PLUGIN.includes("#!desc = 每日自动签到 + 文章分享（纯定时式，捕获一次 token 后无需再打开 App）| v20"));

  // 3) [Argument] 参数齐全
  const argumentSection = PLUGIN.split("[Argument]")[1].split("\n[")[0];
  const expectedParams = [
    "refreshToken", "deviceId", "deviceType", "appVersion", "articleId",
    "xCaKey", "appSecret", "appCode", "shareEnabled", "autoRunOnCapture",
    "oncePerDay", "debug", "captureNotify",
  ];
  const argumentLines = argumentSection.split("\n").map((line) => line.trim()).filter(Boolean);
  assert("[Argument] 共 13 个参数", argumentLines.length === 13, "got " + argumentLines.length);
  expectedParams.forEach((name) => {
    assert("[Argument] 含 " + name, argumentLines.some((line) => line.startsWith(name + " = ")));
  });
  // 控件语法：input/select/switch + 引号默认值
  assert(
    "input 空默认值写 \"\"",
    argumentLines.some((line) => line.startsWith('refreshToken = input,""')),
  );
  assert(
    "select 首项为默认",
    argumentLines.some((line) => line.startsWith('deviceType = select,"IOS","Android"')),
  );
  assert(
    "switch 布尔默认",
    argumentLines.some((line) => line.startsWith("shareEnabled = switch,true")) &&
      argumentLines.some((line) => line.startsWith("autoRunOnCapture = switch,false")),
  );
  // 4) desc 无 ASCII 逗号
  const asciiCommaDesc = argumentLines.filter((line) => /desc=.*,/.test(line));
  assert("[Argument] desc 无 ASCII 逗号", asciiCommaDesc.length === 0, asciiCommaDesc.join(" | "));

  // 5) 脚本行：5 条（2 cron + 2 捕获 + 1 generic）均带 argument 占位符
  const scriptSection = PLUGIN.split("[Script]")[1].split("\n[")[0];
  const scriptLines = scriptSection.split("\n").map((line) => line.trim()).filter(Boolean);
  assert("[Script] 共 5 行", scriptLines.length === 5, "got " + scriptLines.length);
  scriptLines.forEach((line) => {
    assert("脚本行带 argument=[{...}]", line.includes("argument=[{"), line.slice(0, 90));
  });
  const manualLine = scriptLines.find((line) => line.startsWith("generic"));
  assert("generic 手动触发脚本存在（tag=lynkco-manual）", Boolean(manualLine) && manualLine.includes("tag=lynkco-manual"), manualLine || "");
  const placeholders = Array.from(PLUGIN.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (match) => match[1]);
  assert("占位符覆盖全部 13 参数", new Set(placeholders).size === 13 && placeholders.length >= 13);

  // 6) [MITM] 主机齐全
  const mitmLine = PLUGIN.split("[MITM]")[1].split("\n").map((line) => line.trim()).filter(Boolean)[0];
  const hosts = ["h5-api.lynkco.com", "h5.lynkco.com", "app-api-gw-toc.lynkco.com", "app-services.lynkco.com.cn", "gric-api.geely.com"];
  hosts.forEach((host) => {
    assert("MITM 含 " + host, mitmLine.includes(host), mitmLine);
  });
}

/* ================= 主入口 ================= */

async function main() {
  testCryptoVectors();
  testSignatureFormat();
  await testNoTokenFlow();
  await testFullFlow(TEST_CONFIG_ARGUMENT, "完整签到+分享（字符串参数）");
  await testFullFlow(TEST_CONFIG_OBJECT, "完整签到+分享（对象参数 / argument=[{...}] 形态）");
  await testShareValidationFlow();
  await testCaptureFlow();
  await testOncePerDay();
  await testManualTrigger();
  testPluginFormat();

  console.log("\n================================");
  console.log("passed: " + passed + ", failed: " + failed);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("test runner error:", error);
  process.exit(1);
});
