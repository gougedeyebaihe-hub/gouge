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
- prevent burst duplicate runs with a short in-flight lock

已经确认可用：

- 在 Loon 中捕获领克 token 流量
- 检测到有效 token 后立即执行签到
- 检测到有效 token 后立即执行固定文章分享
- 通过一条 Loon 通知返回最终结果
- 通过短时间运行锁避免连续重复触发

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
auto.bundle.js?v=20260722k
```

## Repository Contents / 仓库内容

The active repository is intentionally small:

当前仓库有意保持精简：

- `lynkco-share.remote.plugin`: Loon remote plugin entry
- `auto.bundle.js`: active token capture and task runner
- `README.md`: usage, parameters, and troubleshooting notes

- `lynkco-share.remote.plugin`：Loon 远程插件入口
- `auto.bundle.js`：当前有效的 token 捕获和任务执行脚本
- `README.md`：使用方法、参数和排查说明

Removed legacy files:

已删除旧文件：

- old fixed-time cron runner
- old capture-only script
- old local plugin file
- old auth probe plugin
- temporary Codex permission test files
- outdated planning docs and tests for earlier designs

- 旧版固定时间 cron 脚本
- 旧版只抓取脚本
- 旧版本地插件文件
- 旧版认证探针插件
- 临时 Codex 权限测试文件
- 早期方案的过期计划文档和测试

## How It Works / 工作方式

The plugin no longer uses a fixed 8:00 cron schedule. It runs when Lynk & Co app traffic is seen by Loon.

插件不再使用固定早上 8 点的定时任务，而是在 Loon 检测到领克 App 流量时触发。

Flow:

流程：

1. `http-request` and `http-response` listen to Lynk & Co traffic on matched Lynk domains.
2. If a token or authorization header is detected, the script stores the latest auth state.
3. The script immediately checks whether a short in-flight lock is active.
4. If no recent run is in progress, it runs sign-in and share.
5. It posts one final notification with the sign/share result.

1. `http-request` 和 `http-response` 监听匹配到的领克域名流量。
2. 如果检测到 token 或 authorization，脚本会保存最新认证状态。
3. 脚本立即检查短时间运行锁是否还在生效。
4. 如果最近没有正在执行的任务，就执行签到和分享。
5. 最后通过一条通知返回签到/分享结果。

## Loon Arguments / Loon 参数

Current arguments:

当前参数：

```text
articleId=
debugNotify=0
shareEnabled=1
autoRunOnCapture=1
pingNotify=0
captureTraceNotify=0
signTraceNotify=1
signRequestNotify=0
signCandidateNotify=0
```

Meaning:

参数含义：

- `articleId`: optional fixed article id override; leave empty to use the first article from the Information page
- `debugNotify`: set to `1` to notify when auth state is captured
- `shareEnabled`: set to `0` to run sign-in only
- `autoRunOnCapture`: set to `0` to disable automatic execution after token capture
- `pingNotify`: set to `1` to notify every script hit for debugging
- `captureTraceNotify`: set to `1` to notify all matched Lynk & Co request URLs for tracing
- `signTraceNotify`: set to `1` to notify only the real sign-info request and response summaries
- `signRequestNotify`: set to `1` to also notify masked sign request headers
- `signCandidateNotify`: set to `1` to notify likely sign-action POST endpoints

- `articleId`：可选的固定文章 ID；留空时自动使用资讯页第 1 篇文章
- `debugNotify`：设为 `1` 后，抓到认证状态时会通知
- `shareEnabled`：设为 `0` 后只执行签到，不执行分享
- `autoRunOnCapture`：设为 `0` 后关闭检测 token 自动执行
- `pingNotify`：设为 `1` 后，每次脚本命中都会通知，用于调试
- `captureTraceNotify`：设为 `1` 后，所有命中的领克接口都会通知 URL，便于定位真实签到接口
- `signTraceNotify`：设为 `1` 后，只通知真实签到信息接口的请求头摘要和响应状态
- `signRequestNotify`：设为 `1` 后，额外通知打码后的签到请求头
- `signCandidateNotify`：设为 `1` 后，通知疑似真正签到动作的 POST 接口

## Matched Hosts / 匹配域名

The active plugin listens to:

当前插件监听：

```text
h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com
```

MITM must be enabled and trusted for these exact hosts in Loon. The plugin no longer uses broad `*.lynkco.com` capture after the sign endpoint was identified.

Loon 中必须对这些精确域名开启并信任 MITM。确认签到接口后，插件已不再使用 `*.lynkco.com` 全域抓取。

## Daily Use / 日常使用

1. Update the remote plugin in Loon.
2. Confirm the script URL contains `v=20260722k`.
3. Confirm MITM is enabled.
4. Open Lynk & Co once during the day.
5. Wait for `Sign: ok | Share: ok`.

1. 在 Loon 中更新远程插件。
2. 确认脚本 URL 包含 `v=20260722k`。
3. 确认 MITM 已启用。
4. 当天打开一次领克 App。
5. 等待 `Sign: ok | Share: ok`。

## Known Limitations / 已知限制

- Loon cannot automatically open Lynk & Co on iOS.
- The plugin depends on Lynk & Co producing traffic that Loon can see.
- If neither current traffic nor stored state includes a usable token, no task will run.
- The share task uses the first article from the Information page by default. If article discovery fails, it falls back to the built-in article id.
- The plugin only MITMs the confirmed auth, article, and sign hosts to avoid disrupting unrelated Lynk & Co app traffic.

- Loon 不能在 iOS 上自动打开领克 App。
- 插件依赖领克 App 产生 Loon 能看到的流量。
- 如果当前流量和本地缓存里都没有可用 token，任务不会执行。
- 分享任务默认使用资讯页第 1 篇文章；如果自动发现失败，会回退到内置文章 ID。
- 插件只 MITM 已确认的认证、文章、签到域名，避免影响领克 App 其它流量。

## Troubleshooting / 排查

If nothing happens:

如果没有任何反应：

1. Make sure the plugin is updated to `v=20260722k`.
2. Make sure MITM is enabled for `h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com`.
3. Temporarily set `pingNotify=1` to confirm whether the script is being hit.
4. Temporarily set `debugNotify=1` to confirm whether token state is captured.

1. 确认插件已更新到 `v=20260722k`。
2. 确认 `h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com` 已开启 MITM。
3. 临时把 `pingNotify=1`，确认脚本是否命中。
4. 临时把 `debugNotify=1`，确认是否抓到 token 状态。

If it reports success but the app does not show points immediately, wait a short time and refresh the Lynk & Co points page.

如果通知成功但 App 里积分没有马上变化，等一会儿后刷新领克积分页面。

## Archived Notes / 归档说明

Earlier versions used a fixed cron schedule or a delayed five-minute cron runner. Those modes were removed because the confirmed working behavior is immediate execution after token capture.

早期版本尝试过固定时间 cron 和五分钟延迟 cron。最终确认可用的是检测到 token 后立即执行，因此这些旧模式已不再作为当前方案使用。
