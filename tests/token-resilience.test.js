const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");

function runCaptureBundle(input) {
  const writes = input.writes || [];
  const script = fs.readFileSync(path.join(rootDir, "capture.bundle.js"), "utf8");
  const context = {
    URL,
    $request: input.request,
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
    $done() {},
  };

  vm.runInNewContext(script, context, { filename: "capture.bundle.js" });
  return { writes };
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
      btoa,
      crypto,
      TextEncoder,
      Uint8Array,
      Date,
      JSON,
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

    try {
      vm.runInNewContext(script, context, { filename: "cron.bundle.js" });
    } catch (error) {
      reject(error);
    }
  });
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

(async function run() {
  for (const entry of tests) {
    await entry.fn();
    console.log("PASS " + entry.name);
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
