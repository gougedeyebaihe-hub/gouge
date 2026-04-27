# Lynk & Co Share Task for Loon

## What it does

- captures `token` and `refreshToken` from Lynk & Co traffic
- runs one fixed-article share task on a daily cron
- reports result through Loon local notification

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

## One-time auth probe

If you want to inspect whether Lynk & Co returns extra OAuth-style auth fields during login or refresh, use the separate probe plugin instead of the daily task plugin:

- local: `loon/lynkco-share/lynkco-auth-probe.plugin`
- remote: `lynkco-auth-probe.remote.plugin`

This probe plugin:

- enables `debugNotify=1` by default
- only runs capture scripts
- does not include any cron task
