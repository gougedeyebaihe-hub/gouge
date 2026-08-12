# Lynk & Co Loon Plugin

# 领克 Loon 插件说明

## Current Status / 当前状态

Current version: `v20260812k`

当前版本：`v20260812k`

This repository hosts a Loon plugin for Lynk & Co daily points tasks.

本仓库托管领克 App 每日积分任务的 Loon 插件。

Confirmed working:

- capture Lynk & Co token traffic in Loon
- run sign-in automatically after a valid token is detected
- run the first-article share task automatically
- report one final result notification per run
- prevent repeated runs with a short in-flight lock
- retry share validation with a captured or security-API `certifyId`

已确认可用：

- 在 Loon 中捕获领克 token 流量
- 检测到有效 token 后自动签到
- 自动分享资讯页第一篇文章
- 每次运行只发送一条最终结果通知
- 使用短时运行锁避免重复触发
- 分享遇到验证时自动复用 `certifyId`

Expected success notification:

预期成功通知：

```text
Sign: ok | Share: ok
```

## Remote Plugin / 远程插件

Import this URL in Loon:

在 Loon 中导入这个地址：

```text
https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco-share.remote.plugin?v=20260812k
```

Current script cache version:

当前脚本缓存版本：

```text
auto.bundle.js?v=20260812k
```

## Repository Contents / 仓库内容

- `lynkco-share.remote.plugin`: Loon remote plugin entry
- `auto.bundle.js`: token capture and task runner
- `README.md`: usage and troubleshooting

- `lynkco-share.remote.plugin`：Loon 远程插件入口
- `auto.bundle.js`：token 捕获和任务执行脚本
- `README.md`：使用说明和排查方法

## How It Works / 工作方式

1. A 30-minute cron runner reads stored auth state.
2. `http-request` and `http-response` capture Lynk & Co token traffic.
3. When a valid token is stored, the script runs sign-in and share.
4. If share returns `share.need.validate.check`, it first asks the security config API for `certifyId`.
5. If the server still requires on-screen verification, the script captures the next validated request and reuses it.
6. One final notification reports `Sign` and `Share` status.

1. 每 30 分钟执行一次 cron，读取已保存的认证状态。
2. `http-request` 和 `http-response` 捕获领克流量。
3. 保存到有效 token 后自动执行签到和分享。
4. 分享返回 `share.need.validate.check` 时，先通过安全配置接口换取 `certifyId`。
5. 如果服务器仍要求屏幕验证，插件会捕获下一次通过验证的请求并自动复用。
6. 最后只发送一条包含签到和分享状态的通知。

## Loon Arguments / Loon 参数

```text
articleId=
debugNotify=0
shareEnabled=1
autoRunOnCapture=1
pingNotify=0
captureTraceNotify=0
signTraceNotify=0
signRequestNotify=0
signCandidateNotify=0
signUpgradeNotify=0
```

| Argument / 参数 | Meaning / 含义 |
| --- | --- |
| `articleId` | Fixed article id override; leave empty for the first article |
| `debugNotify` | Notify when auth state is captured |
| `shareEnabled` | Set `0` to run sign-in only |
| `autoRunOnCapture` | Set `0` to disable automatic execution after capture |
| `pingNotify` | Debug: notify every script hit |
| `captureTraceNotify` | Debug: notify matched request URLs |
| `signTraceNotify` | Debug: notify sign-info response summary |
| `signRequestNotify` | Debug: notify masked sign request headers |
| `signCandidateNotify` | Debug: notify likely sign-action POST endpoints |
| `signUpgradeNotify` | Debug: notify `/sign/upgrade` request details |

| 参数 | 含义 |
| --- | --- |
| `articleId` | 固定文章 ID；留空自动使用第一篇文章 |
| `debugNotify` | 抓到认证状态时通知 |
| `shareEnabled` | 设为 `0` 只签到不分享 |
| `autoRunOnCapture` | 设为 `0` 关闭捕获后自动执行 |
| `pingNotify` | 调试用，每次脚本命中都通知 |
| `captureTraceNotify` | 调试用，通知所有命中接口 URL |
| `signTraceNotify` | 调试用，通知签到信息接口摘要 |
| `signRequestNotify` | 调试用，通知脱敏后的签到请求头 |
| `signCandidateNotify` | 调试用，通知疑似签到 POST 接口 |
| `signUpgradeNotify` | 调试用，通知 `/sign/upgrade` 请求详情 |

## Matched Hosts / 匹配域名

```text
h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com
```

Enable MITM for these exact hosts in Loon and trust the certificate.

请在 Loon 中对这些精确域名开启 MITM 并信任证书。

## Daily Use / 日常使用

1. Update the remote plugin in Loon.
2. Confirm the script URL contains `v=20260812k`.
3. Confirm MITM is enabled.
4. Open Lynk & Co once during the day.
5. Wait for `Sign: ok | Share: ok`.

1. 在 Loon 中更新远程插件。
2. 确认脚本 URL 包含 `v=20260812k`。
3. 确认 MITM 已启用。
4. 当天打开一次领克 App。
5. 等待 `Sign: ok | Share: ok`。

## Known Limitations / 已知限制

- Loon cannot open Lynk & Co or tap buttons on iOS.
- The plugin needs at least one captured token.
- If the security API cannot return `certifyId`, open Lynk & Co and manually share once.
- Article discovery uses the first article from the Information page; it falls back to a built-in article id if discovery fails.

- Loon 无法在 iOS 上自动打开领克或点击按钮。
- 插件至少需要捕获过一次有效 token。
- 如果安全配置接口无法返回 `certifyId`，需要打开领克 App 手动分享一次。
- 默认分享资讯页第一篇文章；发现文章失败时回退到内置文章 ID。

## Troubleshooting / 排查

If nothing happens:

如果没有通知：

1. Confirm the plugin is `v20260812k`.
2. Confirm MITM is enabled for the matched hosts.
3. Temporarily set `pingNotify=1`.
4. Temporarily set `debugNotify=1`.

1. 确认插件已更新到 `v20260812k`。
2. 确认匹配域名已开启 MITM。
3. 临时设置 `pingNotify=1`。
4. 临时设置 `debugNotify=1`。

If share reports `share.need.validate.check`:

如果分享提示 `share.need.validate.check`：

1. Update the plugin and retry.
2. Open Lynk & Co and manually share once.
3. The next validated request is captured and reused automatically.

1. 更新插件后重试。
2. 打开领克 App 手动分享一次。
3. 插件会捕获这次通过验证的请求并自动复用。

## Version History / 版本记录

- `v20260812k`: add automatic `certifyId` handling for share validation; capture and reuse validated requests; reduce debug notifications.

- `v20260812k`：新增分享验证的 `certifyId` 自动处理和捕获复用；减少无关调试通知。
