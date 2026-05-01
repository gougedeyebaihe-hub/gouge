# Lynk & Co Loon Plugin

# 领克 Loon 插件说明

## Current Status / 当前状态

This repository hosts a Loon plugin for Lynk & Co daily points tasks.

当前仓库托管的是领克 App 每日积分任务的 Loon 插件。

Confirmed working:

- capture Lynk & Co token traffic in Loon
- run sign-in immediately after a valid token is detected
- run the fixed-article share task immediately after a valid token is detected
- report the final result with one Loon notification
- prevent repeated runs after the task has already completed on the same China-local day

已经确认可用：

- 在 Loon 中捕获领克 token 流量
- 检测到有效 token 后立即执行签到
- 检测到有效 token 后立即执行固定文章分享
- 通过一条 Loon 通知返回最终结果
- 当天成功执行后不再重复执行

Expected success notification:

预期成功通知：

```text
Sign: ok | Share: ok
```

## Remote Plugin / 远程插件

Import this URL in Loon:

在 Loon 中导入这个地址：

```text
https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco-share.remote.plugin
```

Current script cache version:

当前脚本缓存版本：

```text
auto.bundle.js?v=20260501h
```

## How It Works / 工作方式

The plugin no longer uses a fixed 8:00 cron schedule. It runs when Lynk & Co app traffic is seen by Loon.

插件不再使用固定早上 8 点的定时任务，而是在 Loon 检测到领克 App 流量时触发。

Flow:

流程：

1. `http-request` and `http-response` listen to Lynk & Co H5 API traffic.
2. If a token or authorization header is detected, the script stores the latest auth state.
3. The script immediately checks whether today's task has already completed.
4. If not completed today, it runs sign-in and share.
5. If already completed today, it silently skips.

1. `http-request` 和 `http-response` 监听领克 H5 API 流量。
2. 如果检测到 token 或 authorization，脚本会保存最新认证状态。
3. 脚本立即检查当天任务是否已经完成。
4. 如果当天还未完成，就执行签到和分享。
5. 如果当天已经完成，就静默跳过。

## Loon Arguments / Loon 参数

Current arguments:

当前参数：

```text
articleId=1881101031748870144
debugNotify=0
shareEnabled=1
autoRunOnCapture=1
pingNotify=0
```

Meaning:

参数含义：

- `articleId`: fixed article id used for the share task
- `debugNotify`: set to `1` to notify when auth state is captured
- `shareEnabled`: set to `0` to run sign-in only
- `autoRunOnCapture`: set to `0` to disable automatic execution after token capture
- `pingNotify`: set to `1` to notify every script hit for debugging

- `articleId`：分享任务使用的固定文章 ID
- `debugNotify`：设为 `1` 后，抓到认证状态时会通知
- `shareEnabled`：设为 `0` 后只执行签到，不执行分享
- `autoRunOnCapture`：设为 `0` 后关闭检测 token 自动执行
- `pingNotify`：设为 `1` 后，每次脚本命中都会通知，用于调试

## Matched Hosts / 匹配域名

The active plugin listens to:

当前插件监听：

```text
h5-api.lynkco.com
h5.lynkco.com
```

MITM must be enabled and trusted for these hosts in Loon.

Loon 中必须对这些域名开启并信任 MITM。

## Daily Use / 日常使用

1. Update the remote plugin in Loon.
2. Confirm the script URL contains `v=20260501h`.
3. Confirm MITM is enabled.
4. Open Lynk & Co once during the day.
5. Wait for `Sign: ok | Share: ok`.

1. 在 Loon 中更新远程插件。
2. 确认脚本 URL 包含 `v=20260501h`。
3. 确认 MITM 已启用。
4. 当天打开一次领克 App。
5. 等待 `Sign: ok | Share: ok`。

## Known Limitations / 已知限制

- Loon cannot automatically open Lynk & Co on iOS.
- The plugin depends on Lynk & Co producing traffic that Loon can see.
- If the app does not refresh token state, no task will run.
- The share task uses a fixed article id. Random article discovery is not implemented.
- Expanding MITM to all `*.lynkco.com` previously made login and page loading unstable, so the plugin keeps a narrow host list.

- Loon 不能在 iOS 上自动打开领克 App。
- 插件依赖领克 App 产生 Loon 能看到的流量。
- 如果 App 没有刷新 token 状态，任务不会执行。
- 分享任务使用固定文章 ID，没有实现首页随机找文章。
- 之前尝试扩大到 `*.lynkco.com` 会影响登录和页面加载，所以插件保持窄域名匹配。

## Troubleshooting / 排查

If nothing happens:

如果没有任何反应：

1. Make sure the plugin is updated to `v=20260501h`.
2. Make sure MITM is enabled for `h5-api.lynkco.com` and `h5.lynkco.com`.
3. Temporarily set `pingNotify=1` to confirm whether the script is being hit.
4. Temporarily set `debugNotify=1` to confirm whether token state is captured.

1. 确认插件已更新到 `v=20260501h`。
2. 确认 `h5-api.lynkco.com` 和 `h5.lynkco.com` 已开启 MITM。
3. 临时把 `pingNotify=1`，确认脚本是否命中。
4. 临时把 `debugNotify=1`，确认是否抓到 token 状态。

If it reports success but the app does not show points immediately, wait a short time and refresh the Lynk & Co points page.

如果通知成功但 App 里积分没有马上变化，等一会儿后刷新领克积分页面。

## Archived Notes / 归档说明

Earlier versions used a fixed cron schedule or a delayed five-minute cron runner. Those modes were removed because the confirmed working behavior is immediate execution after token capture.

早期版本尝试过固定时间 cron 和五分钟延迟 cron。最终确认可用的是检测到 token 后立即执行，因此这些旧模式已不再作为当前方案使用。
