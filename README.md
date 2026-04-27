# Lynk & Co Share Task for Loon

# 领克 Loon 插件说明

## Summary / 简介

- captures Lynk & Co auth state from traffic that Loon can see
- runs daily sign-in and fixed-article share tasks from one cron script
- reports result through Loon local notification
- includes a separate one-time auth probe plugin for login-flow inspection

- 从 Loon 可见的领克流量中捕获认证状态
- 通过一个 `cron` 脚本完成每日签到和固定文章分享
- 通过 Loon 本地通知返回执行结果
- 额外提供一个一次性认证探针插件，用于排查登录链路

## Current status / 当前状态

- daily sign-in: working
- fixed-article share task: working
- combined cron flow: working
- GitHub-hosted remote plugin: working
- one-time auth probe plugin: available

- 每日签到：可用
- 固定文章分享：可用
- 签到 + 分享合并定时任务：可用
- GitHub 远程插件：可用
- 一次性认证探针插件：可用

## Known limitations / 已知限制

- article sharing is fixed to one article id; there is no home page discovery or random article selection
- Loon cannot perform iOS UI automation, so it cannot open Lynk & Co, tap share, or return to the app by itself
- sign-in appears to depend on a shorter-lived OAuth-style login state than the normal share flow
- if sign-in reports `uaa.oauthAccessToken.not.exist`, the practical workaround is to open Lynk & Co once and run again
- attempts to broaden capture from `h5-api.lynkco.com` to all `*.lynkco.com` made the app unstable during login, so the stable plugin stays on the narrower host match
- the one-time auth probe plugin did not reliably expose a reusable long-lived OAuth token through Loon alone

- 分享任务目前固定为单篇文章，不支持首页文章发现或随机选文
- Loon 不能做 iOS UI 自动化，所以不能自己打开领克 App、点分享、再回到 App
- 签到看起来依赖一层比分享更短时效的 OAuth 风格登录态
- 如果签到报 `uaa.oauthAccessToken.not.exist`，目前最实际的处理方式是先打开一次领克 App，再重跑
- 我们尝试把抓取范围从 `h5-api.lynkco.com` 放宽到 `*.lynkco.com` 时，会影响领克登录和页面加载，因此稳定版维持窄匹配
- 一次性认证探针插件没有在 Loon 内稳定抓到可复用的长时效 OAuth token

## Recommended daily use / 推荐日常用法

1. Import the stable remote plugin into Loon
2. Enable the plugin and trust MITM for the required hosts
3. Open Lynk & Co once before the scheduled run when possible
4. Let the cron script run sign-in and share
5. If sign-in fails with an OAuth token error, open Lynk & Co once and rerun

1. 把稳定版远程插件导入 Loon
2. 开启插件，并信任对应 MITM 域名
3. 如果方便，定时任务运行前先打开一次领克 App
4. 让 `cron` 脚本自动执行签到和分享
5. 如果签到报 OAuth token 错误，就先打开一次领克 App 再重跑

## How to use it / 使用方法

1. Local mode: import `lynkco-share.plugin` into Loon
2. Enable the plugin and trust MITM for required hosts
3. Open the Lynk & Co app once so the capture script can store auth state
4. Run the cron script manually once before relying on the daily schedule

1. 本地模式：把 `lynkco-share.plugin` 导入 Loon
2. 启用插件，并信任对应 MITM 域名
3. 打开一次领克 App，让抓取脚本先存下认证状态
4. 在依赖定时任务之前，先手动运行一次 `cron` 脚本做确认

## Remote hosting / 远程托管

If you want Loon to load the scripts from a public URL, upload the whole `loon/lynkco-share` directory to any static host so these paths are reachable:

如果你想让 Loon 从公网地址加载脚本，就把整个 `loon/lynkco-share` 目录上传到任意静态托管，并确保下面这些路径可以访问：

- `<baseUrl>/dist/capture.bundle.js`
- `<baseUrl>/dist/cron.bundle.js`

Then generate a remote plugin file:

然后生成远程插件文件：

```bash
npm run build:loon-share:remote -- --base-url https://your-host.example.com/loon/lynkco-share
```

The command writes:

命令会生成：

- `loon/lynkco-share/dist/capture.bundle.js`
- `loon/lynkco-share/dist/cron.bundle.js`
- `loon/lynkco-share/lynkco-share.remote.plugin`

Import that generated remote plugin into Loon instead of the local one.

之后把生成出来的远程插件导入 Loon，而不是导入本地插件。

## Current scope / 当前范围

- fixed article id only
- no home page article discovery
- no iOS UI automation
- no confirmed long-lived OAuth token refresh path inside Loon only

- 仅支持固定文章 ID
- 不支持首页文章发现
- 不支持 iOS UI 自动化
- 在只使用 Loon 的前提下，没有确认可行的长时效 OAuth token 刷新路径

## One-time auth probe / 一次性认证探针

If you want to inspect whether Lynk & Co returns extra OAuth-style auth fields during login or refresh, use the separate probe plugin instead of the daily task plugin:

如果你想检查领克在登录或刷新时，是否会返回额外的 OAuth 风格认证字段，请使用单独的探针插件，而不是日常任务插件：

- local: `loon/lynkco-share/lynkco-auth-probe.plugin`
- remote: `loon/lynkco-share/lynkco-auth-probe.remote.plugin`

This probe plugin:

这个探针插件：

- enables `debugNotify=1` by default
- only runs capture scripts
- does not include any cron task
- is meant for temporary inspection, not daily use

- 默认开启 `debugNotify=1`
- 只运行抓取脚本
- 不包含任何 `cron` 定时任务
- 只适合临时排查，不适合日常常驻使用
