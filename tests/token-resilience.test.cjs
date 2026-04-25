const assert = require("assert");
const nodeCrypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");

function runCaptureBundle(input) {
  const writes = input.writes || [];
  const notifications = [];
  const script = fs.readFileSync(path.join(rootDir, "capture.bundle.js"), "utf8");
  const context = {
    URL,
    $notification: {
      post(title, subtitle, message) {
        notifications.push({ title, subtitle, message });
      },
    },
    $done() {},
  };

  if (!input.withoutStore) {
    context.$persistentStore = {
      read(key) {
        assert.strictEqual(key, "lynkco.share.tokenState");
        return input.storedValue || "";
      },
      write(value, key) {
        assert.strictEqual(key, "lynkco.share.tokenState");
        writes.push({ value, key });
        return true;
      },
    };
  }

  if ("request" in input) {
    context.$request = input.request;
  }
  if ("response" in input) {
    context.$response = input.response;
  }

  vm.runInNewContext(script, context, { filename: "capture.bundle.js" });
  return { writes, notifications };
}

function createHttpClient(input) {
  const getResponses = (input.getResponses || []).slice();
  const postResponses = (input.postResponses || []).slice();
  return {
    get(params, callback) {
      const result = getResponses.shift();
      if (!result) {
        callback("Unexpected GET request: " + params.url);
        return;
      }
      callback(result.error || null, result.response || {}, result.data || "");
    },
    post(params, callback) {
      const result = postResponses.shift();
      if (!result) {
        callback("Unexpected POST request: " + params.url);
        return;
      }
      callback(result.error || null, result.response || {}, result.data || "");
    },
  };
}

function runCronBundle(input) {
  return new Promise((resolve, reject) => {
    const notifications = [];
    const writes = [];
    const script = fs.readFileSync(path.join(rootDir, "cron.bundle.js"), "utf8");
    const context = {
      URL,
      Uint8Array,
      Date,
      JSON,
      Math,
      Promise,
      Error,
      Array,
      parseInt,
      String,
      $argument: input.argument || "",
      $persistentStore: {
        read(key) {
          assert.strictEqual(key, "lynkco.share.tokenState");
          return input.storedValue || "";
        },
        write(value, key) {
          assert.strictEqual(key, "lynkco.share.tokenState");
          writes.push({ value, key });
          return true;
        },
      },
      $httpClient: createHttpClient(input),
      $notification: {
        post(title, subtitle, message) {
          notifications.push({ title, subtitle, message });
        },
      },
      $done() {
        resolve({ notifications, writes });
      },
    };

    if (!input.withoutBrowserCrypto) {
      context.btoa = btoa;
      context.crypto = crypto;
      context.TextEncoder = TextEncoder;
    }

    try {
      vm.runInNewContext(script, context, { filename: "cron.bundle.js" });
    } catch (error) {
      reject(error);
    }
  });
}

async function signWithCronBundle(key, message) {
  const script = fs.readFileSync(path.join(rootDir, "cron.bundle.js"), "utf8");
  const context = {
    URL,
    Uint8Array,
    Date,
    JSON,
    Math,
    Promise,
    Error,
    Array,
    parseInt,
    String,
    $argument: "",
    $persistentStore: {
      read() {
        return "";
      },
      write() {
        return true;
      },
    },
    $httpClient: createHttpClient({}),
    $notification: {
      post() {},
    },
    $done() {},
  };

  vm.runInNewContext(script, context, { filename: "cron.bundle.js" });
  return context.signBase64HmacSha256(key, message);
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("capture keeps an existing refreshToken when a request only has token", function() {
  const writes = [];
  runCaptureBundle({
    storedValue: JSON.stringify({ token: "old-token", refreshToken: "old-refresh" }),
    request: {
      url: "https://h5-api.lynkco.com/app/v1/user",
      headers: { token: "new-token" },
    },
    writes,
  });

  assert.deepStrictEqual(JSON.parse(writes[0].value), {
    token: "new-token",
    refreshToken: "old-refresh",
  });
});

test("capture stores refreshToken from nested response body", function() {
  const writes = [];
  runCaptureBundle({
    storedValue: JSON.stringify({ token: "old-token", refreshToken: "" }),
    request: {
      url: "https://h5-api.lynkco.com/auth/login",
      headers: {},
    },
    response: {
      body: JSON.stringify({
        data: {
          centerTokenDto: {
            token: "response-token",
            refreshToken: "response-refresh",
          },
        },
      }),
    },
    writes,
  });

  assert.deepStrictEqual(JSON.parse(writes[0].value), {
    token: "response-token",
    refreshToken: "response-refresh",
  });
});

test("capture does not throw when run manually without request or response", function() {
  const result = runCaptureBundle({
    storedValue: "",
    writes: [],
  });

  assert.deepStrictEqual(result.writes, []);
  assert.strictEqual(
    result.notifications[0].message,
    "Capture waits for Lynk & Co traffic. Open the app once, then run share.",
  );
});

test("capture stores refreshToken from nested request body", function() {
  const writes = [];
  runCaptureBundle({
    storedValue: JSON.stringify({ token: "old-token", refreshToken: "" }),
    request: {
      url: "https://h5-api.lynkco.com/auth/login",
      headers: {},
      body: JSON.stringify({
        data: {
          centerTokenDto: {
            refreshToken: "request-refresh",
          },
        },
      }),
    },
    writes,
  });

  assert.deepStrictEqual(JSON.parse(writes[0].value), {
    token: "old-token",
    refreshToken: "request-refresh",
  });
});

test("capture does not throw when persistent store is missing", function() {
  const result = runCaptureBundle({
    withoutStore: true,
    request: {
      url: "https://h5-api.lynkco.com/auth/login?refreshToken=from-url",
      headers: { token: "token" },
    },
  });

  assert.deepStrictEqual(result.writes, []);
  assert.strictEqual(result.notifications[0].message, "Capture store is unavailable.");
});

test("cron continues with the existing token when refresh fails and share succeeds", async function() {
  const result = await runCronBundle({
    storedValue: JSON.stringify({ token: "old-token", refreshToken: "refresh-token" }),
    getResponses: [
      { response: { status: 401 }, data: JSON.stringify({ message: "refresh expired" }) },
      { response: { status: 200 }, data: JSON.stringify({ data: "share-code" }) },
    ],
    postResponses: [
      { response: { status: 200 }, data: JSON.stringify({ data: "ok" }) },
    ],
  });

  assert.strictEqual(
    result.notifications[0].message,
    "Share task result: ok. Refresh failed; open Lynk & Co soon to recapture auth.",
  );
});

test("cron asks user to capture when token state is empty", async function() {
  const result = await runCronBundle({ storedValue: "" });
  assert.strictEqual(
    result.notifications[0].message,
    "No token captured. Open Lynk & Co once, then run again.",
  );
});

test("cron warns when refreshToken is missing but still tries current token", async function() {
  const result = await runCronBundle({
    storedValue: JSON.stringify({ token: "token-only", refreshToken: "" }),
    getResponses: [
      { response: { status: 200 }, data: JSON.stringify({ data: "share-code" }) },
    ],
    postResponses: [
      { response: { status: 200 }, data: JSON.stringify({ data: "ok" }) },
    ],
  });

  assert.strictEqual(
    result.notifications[0].message,
    "Share task result: ok. Refresh token not captured; open Lynk & Co soon to improve reliability.",
  );
});

test("cron asks user to recapture when stored token state is invalid", async function() {
  const result = await runCronBundle({ storedValue: "not-json" });
  assert.strictEqual(
    result.notifications[0].message,
    "Stored token state is invalid. Open Lynk & Co once, then run again.",
  );
});

test("cron can sign share requests without WebCrypto globals", async function() {
  const result = await runCronBundle({
    withoutBrowserCrypto: true,
    storedValue: JSON.stringify({ token: "token-only", refreshToken: "" }),
    getResponses: [
      { response: { status: 200 }, data: JSON.stringify({ data: "share-code" }) },
    ],
    postResponses: [
      { response: { status: 200 }, data: JSON.stringify({ data: "ok" }) },
    ],
  });

  assert.strictEqual(
    result.notifications[0].message,
    "Share task result: ok. Refresh token not captured; open Lynk & Co soon to improve reliability.",
  );
});

test("cron HMAC-SHA256 signature matches Node crypto", async function() {
  const message = "The quick brown fox jumps over the lazy dog";
  const actual = await signWithCronBundle("key", message);
  const expected = nodeCrypto.createHmac("sha256", "key").update(message).digest("base64");
  assert.strictEqual(actual, expected);
});

(async function run() {
  for (const entry of tests) {
    await entry.fn();
    console.log("PASS " + entry.name);
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
