# Token Resilience Design

## Context

The repository contains a Loon plugin for a Lynk & Co daily share task. It has two runtime scripts:

- `capture.bundle.js` captures auth values from intercepted Lynk & Co traffic.
- `cron.bundle.js` refreshes the token when possible, requests a share code, and reports the share task.

The current token handling works for the happy path, but it overwrites captured state too aggressively and reports most token problems as a generic task failure.

## Goals

- Preserve a previously captured `refreshToken` when a later intercepted request only contains `token`.
- Make refresh success and failure explicit in the control flow.
- Continue with the existing token once when refresh fails, then give a clear notification if the share task cannot complete.
- Tell the user what action to take when auth state is missing or stale.
- Keep the current bundle-only repository structure for this change.

## Non-Goals

- Discover new share articles from the Lynk & Co home page.
- Add iOS UI automation.
- Convert the repository into a source-plus-build pipeline.
- Store or expose additional personal data beyond the existing token and refresh token values.

## Capture Behavior

`capture.bundle.js` will merge newly observed auth values with the existing stored token state:

- If the request includes a new `token`, update `token`.
- If the request includes a new `refreshToken`, update `refreshToken`.
- If the request includes neither value, do not write to persistent storage.
- If only one value is present, keep the existing value for the other field.

This prevents a partial capture from clearing a still-useful refresh token.

## Cron Behavior

At startup, `cron.bundle.js` will parse the stored token state safely:

- If the store is empty, notify that no token has been captured and ask the user to open the Lynk & Co app.
- If the store cannot be parsed as JSON, notify that the stored token state is invalid and ask the user to recapture.
- If `token` is missing, stop before making task requests.
- If `refreshToken` is missing, continue with the existing token but include a warning that automatic refresh is unavailable.

When `refreshToken` exists, the cron script will attempt refresh before sharing:

- Treat network errors, non-2xx HTTP responses, invalid JSON, missing `data.centerTokenDto.token`, or API error messages as refresh failure.
- On refresh success, write the refreshed token state and continue sharing.
- On refresh failure, continue once with the existing token instead of exiting immediately.

## Notifications

Notifications should be short and action-oriented:

- Missing token: `No token captured. Open Lynk & Co once, then run again.`
- Missing refresh token: `Refresh token not captured. Trying current token.`
- Refresh success: no separate notification unless the share task later fails.
- Refresh failure and share success: include that the share succeeded but refresh failed, so the user should recapture soon.
- Refresh failure and share failure: include that auth may be stale and ask the user to reopen Lynk & Co.
- Share failure without refresh failure: show the share failure message.

## Error Handling

The implementation will introduce small helpers instead of broad rewrites:

- Safe token parsing with a structured result.
- HTTP status validation for refresh and share-code requests.
- Refresh payload validation before writing new state.
- Error messages that preserve useful API messages while avoiding raw token exposure.

No notification or log should include token or refresh token values.

## Testing

Because this repository has bundle files only and no test harness, verification will use focused static and runtime checks:

- Review the edited scripts for syntax and accidental token exposure.
- Run Node syntax checks where supported by the local runtime.
- Use small mocked function checks if the bundle can be loaded safely without executing Loon globals.
- Confirm git diff only touches the intended script files and this spec.

## Rollout

The change can ship in place by updating:

- `capture.bundle.js`
- `cron.bundle.js`

The existing remote plugin already points at the repository's `main` branch bundle files, so pushing the updated files is enough for remote users to receive the behavior after Loon reloads the scripts.
