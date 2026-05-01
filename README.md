# Lynk & Co Loon Plugin

# 领克 Loon 插件说明

## Current Behavior / 当前行为

The active remote plugin no longer uses a fixed 8:00 cron schedule. It marks a local trigger when Loon detects Lynk & Co auth traffic from `h5-api.lynkco.com`, then a short cron runner checks that local trigger and runs once per day.

当前远程插件不再使用固定早上 8 点的定时任务。它会在 Loon 检测到领克 App 的 `h5-api.lynkco.com` 认证流量后写入本地触发标记，然后由短周期 cron 读取这个本地标记并每天只执行一次。

Flow:

流程：

1. `http-request` saves the latest token state only.
2. `http-response` saves token state again and writes today's local trigger marker.
3. `cron */5` checks the local marker; if today's task has not run, it executes sign-in and fixed-article share once.
4. If today's task already ran, later token detections only update token state and do not repeat the task.

1. `http-request` 只负责保存最新 token 状态。
2. `http-response` 再次保存 token 状态，并写入当天本地触发标记。
3. `cron */5` 检查本地标记；如果当天还没执行，就自动执行签到和固定文章分享。
4. 如果当天已经执行过，后续再次检测到 token 只更新 token，不重复执行任务。

## Active Files / 当前有效文件

- `lynkco-share.remote.plugin`: remote plugin entry for Loon
- `auto.bundle.js`: active capture plus once-per-day auto runner
- `cron.bundle.js`: legacy/manual fallback script, no longer scheduled by the active remote plugin
- `capture.bundle.js`: legacy capture-only script
- `lynkco-auth-probe.remote.plugin`: temporary auth probe, not for daily use

- `lynkco-share.remote.plugin`：Loon 远程插件入口
- `auto.bundle.js`：当前有效的抓取加每日一次自动执行脚本
- `cron.bundle.js`：旧版/手动兜底脚本，当前远程插件不再定时调用
- `capture.bundle.js`：旧版只抓取脚本
- `lynkco-auth-probe.remote.plugin`：临时认证探针，不适合日常常驻

## Import URL / 导入地址

Use this remote plugin in Loon:

在 Loon 里导入这个远程插件：

```text
https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco-share.remote.plugin
```

## Recommended Use / 推荐用法

1. Import or update the remote plugin in Loon.
2. Enable the plugin.
3. Confirm MITM is enabled and trusted for `h5-api.lynkco.com` and `h5.lynkco.com`.
4. Open Lynk & Co once during the day.
5. Wait for the notification: `Sign: ok | Share: ok`.
6. Opening Lynk & Co again on the same day should not run the task again.

1. 在 Loon 中导入或更新远程插件。
2. 启用插件。
3. 确认 `h5-api.lynkco.com` 和 `h5.lynkco.com` 的 MITM 已开启并信任证书。
4. 当天打开一次领克 App。
5. 等待通知：`Sign: ok | Share: ok`。
6. 同一天再次打开领克 App，理论上不会重复执行任务。

## Arguments / 参数

Current plugin arguments:

当前插件参数：

```text
articleId=1881101031748870144
debugNotify=0
shareEnabled=1
autoRunOnCapture=1
```

Meaning:

含义：

- `articleId`: fixed article id used for the share task
- `debugNotify`: set to `1` to notify whenever auth state is captured
- `shareEnabled`: set to `0` to run sign-in only
- `autoRunOnCapture`: set to `0` to disable token-triggered auto run

- `articleId`：分享任务使用的固定文章 ID
- `debugNotify`：设为 `1` 后，每次抓到认证状态都会通知
- `shareEnabled`：设为 `0` 后只执行签到，不执行分享
- `autoRunOnCapture`：设为 `0` 后关闭检测 token 自动执行

## Known Limitations / 已知限制

- Loon cannot open Lynk & Co automatically on iOS.
- The task depends on Lynk & Co producing visible `h5-api.lynkco.com` traffic after the app is opened.
- Sign-in may still fail if Lynk & Co has not refreshed its short-lived OAuth-style login state.
- The plugin intentionally runs only once per China-local day after detection, to avoid repeated requests.
- Fixed-article sharing works; random home-page article discovery is not implemented.
- Broadening MITM capture to all `*.lynkco.com` previously made login and page loading unstable, so the stable plugin keeps the narrow host list.

- Loon 不能在 iOS 上自动打开领克 App。
- 插件依赖打开领克 App 后产生 Loon 能看到的 `h5-api.lynkco.com` 流量。
- 如果领克没有刷新短时效 OAuth 风格登录态，签到仍可能失败。
- 插件故意设计为检测后每天只执行一次，避免频繁请求。
- 固定文章分享已可用；首页随机找文章没有实现。
- 之前尝试扩大到 `*.lynkco.com` 会影响登录和页面加载，所以稳定版仍保持窄域名匹配。

## iOS Background Note / iOS 后台说明

Keeping Lynk & Co in the app switcher and allowing Background App Refresh may help keep login state fresher, but iOS does not guarantee that the app keeps running or refreshes token state in the background.

保留领克 App 在后台、开启后台 App 刷新，可能有助于登录态更新，但 iOS 不保证 App 会持续后台运行，也不保证后台刷新 token。

Practical recommendation:

实际建议：

- do not force-close Lynk & Co
- keep Background App Refresh enabled if possible
- open Lynk & Co once when you want the daily task to run
- rely on the notification result, not on background behavior alone

- 不要手动清掉领克 App 后台
- 条件允许时保持后台 App 刷新开启
- 想让当天任务执行时，打开一次领克 App
- 以 Loon 通知结果为准，不要只依赖 iOS 后台行为
