# Lynk & Co Share Task for Loon

## Summary

- captures Lynk & Co auth state from traffic that Loon can see
- runs daily sign-in and fixed-article share tasks from one cron script
- reports result through Loon local notification
- includes a separate one-time auth probe plugin for login-flow inspection

## Current status

- daily sign-in: working
- fixed-article share task: working
- combined cron flow: working
- GitHub-hosted remote plugin: working
- one-time auth probe plugin: available

## Known limitations

- article sharing is fixed to one article id; there is no home page discovery or random article selection
- Loon cannot perform iOS UI automation, so it cannot open Lynk & Co, tap share, or return to the app by itself
- sign-in appears to depend on a shorter-lived OAuth-style login state than the normal share flow
- if sign-in reports `uaa.oauthAccessToken.not.exist`, the practical workaround is to open Lynk & Co once and run again
- attempts to broaden capture from `h5-api.lynkco.com` to all `*.lynkco.com` made the app unstable during login, so the stable plugin stays on the narrower host match
- the one-time auth probe plugin did not reliably expose a reusable long-lived OAuth token through Loon alone

## Recommended daily use

1. Import the stable remote plugin into Loon
2. Enable the plugin and trust MITM for the required hosts
3. Open Lynk & Co once before the scheduled run when possible
4. Let the cron script run sign-in and share
5. If sign-in fails with an OAuth token error, open Lynk & Co once and rerun

## How to use it

1. Local mode: import `lynkco-share.plugin` into Loon
2. Enable the plugin and trust MITM for required hosts
3. Open the Lynk & Co app once so the capture script can store auth state
4. Run the cron script manually once before relying on the daily schedule

## Remote hosting

If you want Loon to load the scripts from a public URL, upload the whole `loon/lynkco-share` directory to any static host so these paths are reachable:

- `<baseUrl>/dist/capture.bundle.js`
- `<baseUrl>/dist/cron.bundle.js`

Then generate a remote plugin file:

```bash
npm run build:loon-share:remote -- --base-url https://your-host.example.com/loon/lynkco-share
```

The command writes:

- `loon/lynkco-share/dist/capture.bundle.js`
- `loon/lynkco-share/dist/cron.bundle.js`
- `loon/lynkco-share/lynkco-share.remote.plugin`

Import that generated remote plugin into Loon instead of the local one.

## Current scope

- fixed article id only
- no home page article discovery
- no iOS UI automation
- no confirmed long-lived OAuth token refresh path inside Loon only

## One-time auth probe

If you want to inspect whether Lynk & Co returns extra OAuth-style auth fields during login or refresh, use the separate probe plugin instead of the daily task plugin:

- local: `loon/lynkco-share/lynkco-auth-probe.plugin`
- remote: `loon/lynkco-share/lynkco-auth-probe.remote.plugin`

This probe plugin:

- enables `debugNotify=1` by default
- only runs capture scripts
- does not include any cron task
- is meant for temporary inspection, not daily use
