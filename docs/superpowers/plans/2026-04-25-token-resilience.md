# Token Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make captured Lynk & Co auth state harder to lose and make token refresh failures clear and recoverable.

**Architecture:** Keep the current bundle-only structure. Add small helpers to `capture.bundle.js` and `cron.bundle.js` for safe state parsing, state merging, refresh validation, and action-oriented notifications.

**Tech Stack:** Loon JavaScript runtime globals, Node syntax checks, local Node-based smoke tests.

---

### Task 1: Capture State Merge

**Files:**
- Modify: `capture.bundle.js`
- Test: `tests/token-resilience.test.js`

- [ ] **Step 1: Add a failing capture test**

Create `tests/token-resilience.test.js` with a VM harness that runs `capture.bundle.js` with mocked Loon globals. Include this test case:

```javascript
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node tests/token-resilience.test.js`

Expected: FAIL because the current capture script writes an empty `refreshToken`.

- [ ] **Step 3: Implement capture merging**

In `capture.bundle.js`, add safe parsing and merge helpers:

```javascript
function parseTokenState(raw) {
  if (!raw) return { token: "", refreshToken: "" };
  try {
    const parsed = JSON.parse(raw);
    return {
      token: parsed.token || "",
      refreshToken: parsed.refreshToken || "",
    };
  } catch (error) {
    return { token: "", refreshToken: "" };
  }
}

function mergeTokenState(previousState, nextState) {
  return {
    token: nextState.token || previousState.token || "",
    refreshToken: nextState.refreshToken || previousState.refreshToken || "",
  };
}
```

Update `runCapture` so it reads the old state, merges only when at least one new auth value exists, and writes the merged state.

- [ ] **Step 4: Run the capture test again**

Run: `node tests/token-resilience.test.js`

Expected: PASS for the capture merge case.

### Task 2: Cron Refresh Validation

**Files:**
- Modify: `cron.bundle.js`
- Test: `tests/token-resilience.test.js`

- [ ] **Step 1: Add failing cron tests**

Extend `tests/token-resilience.test.js` with mocked `$persistentStore`, `$httpClient`, `$notification`, and `$done` cases:

```javascript
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

  assert.strictEqual(result.notifications[0].message, "Share task result: ok. Refresh failed; open Lynk & Co soon to recapture auth.");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node tests/token-resilience.test.js`

Expected: FAIL because refresh errors currently flow to the outer catch.

- [ ] **Step 3: Implement refresh validation and fallback**

In `cron.bundle.js`, add helpers:

```javascript
function getHttpStatus(response) {
  return response && (response.status || response.statusCode) || 0;
}

function assertSuccessfulHttp(response, label) {
  const status = getHttpStatus(response);
  if (status && (status < 200 || status >= 300)) {
    throw new Error(label + " request failed with HTTP " + status + ".");
  }
}

function getApiMessage(payload) {
  return payload && (payload.message || payload.msg || payload.errorMsg) || "";
}
```

Use these helpers for refresh and share-code responses. Wrap refresh in its own `try/catch`, keep a `refreshWarning` string when it fails, and continue to share with the existing token.

- [ ] **Step 4: Run the cron fallback test again**

Run: `node tests/token-resilience.test.js`

Expected: PASS for refresh fallback.

### Task 3: Missing State Messages and Verification

**Files:**
- Modify: `cron.bundle.js`
- Test: `tests/token-resilience.test.js`

- [ ] **Step 1: Add missing-state tests**

Add tests for empty store, invalid JSON store, and token without refresh token:

```javascript
test("cron asks user to capture when token state is empty", async function() {
  const result = await runCronBundle({ storedValue: "" });
  assert.strictEqual(result.notifications[0].message, "No token captured. Open Lynk & Co once, then run again.");
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
  assert.strictEqual(result.notifications[0].message, "Share task result: ok. Refresh token not captured; open Lynk & Co soon to improve reliability.");
});
```

- [ ] **Step 2: Implement missing-state messages**

Make `parseTokenState` return `{ tokenState, error }`, stop early for missing or invalid token, and set a warning string when `refreshToken` is absent.

- [ ] **Step 3: Verify syntax and behavior**

Run:

```bash
node --check capture.bundle.js
node --check cron.bundle.js
node tests/token-resilience.test.js
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add capture.bundle.js cron.bundle.js tests/token-resilience.test.js docs/superpowers/plans/2026-04-25-token-resilience.md
git commit -m "Improve token refresh resilience"
```
