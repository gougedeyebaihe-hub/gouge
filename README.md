# 领克 Loon 插件说明

## 当前状态

当前版本：`v20260812t`

本仓库托管领克 App 每日积分任务的 Loon 插件。

当前重点：

- 自动签到
- 暂时暂停文章分享
- 恢复此前签到成功的请求组装逻辑

预期成功通知：

```text
Sign: ok
```

## 远程插件

在 Loon 中导入这个地址：

```text
https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco-share-v20260812q.remote.plugin?v=20260812t
```

当前脚本缓存版本：

```text
auto.bundle.js?v=20260812t&pingNotify=1&signRequestNotify=1&shareEnabled=0
```

## 仓库内容

- `lynkco-share-v20260812q.remote.plugin`：当前推荐使用的 Loon 远程插件入口
- `lynkco-share.remote.plugin`：兼容入口
- `auto.bundle.js`：token 捕获和任务执行脚本
- `README.md`：使用说明和排查方法

## 工作方式

1. 每 30 分钟执行一次 cron，读取已保存的认证状态。
2. `http-request` 和 `http-response` 捕获领克流量。
3. 保存到有效 token 后自动执行签到。
4. 文章分享已暂停，避免触发验证码。
5. 最后只发送一条签到结果通知。

## Loon 参数

```text
articleId=
debugNotify=0
shareEnabled=0
autoRunOnCapture=1
pingNotify=1
captureTraceNotify=0
signTraceNotify=0
signRequestNotify=1
signCandidateNotify=0
signUpgradeNotify=0
```

| 参数 | 含义 |
| --- | --- |
| `articleId` | 固定文章 ID；当前分享已暂停 |
| `debugNotify` | 抓到认证状态时通知 |
| `shareEnabled` | 当前为 `0`，文章分享暂停 |
| `autoRunOnCapture` | 设为 `0` 关闭捕获后自动执行 |
| `pingNotify` | 调试用，每次脚本命中都通知 |
| `captureTraceNotify` | 调试用，通知所有命中接口 URL |
| `signTraceNotify` | 调试用，通知签到信息接口摘要 |
| `signRequestNotify` | 当前为 `1`，通知真实签到请求头摘要 |
| `signCandidateNotify` | 调试用，通知疑似签到 POST 接口 |
| `signUpgradeNotify` | 调试用，通知 `/sign/upgrade` 请求详情 |

## 匹配域名

```text
h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com,app-services.lynkco.com.cn
```

请在 Loon 中对这些精确域名开启 MITM 并信任证书。

## 日常使用

1. 在 Loon 中更新远程插件到 `v20260812t`。
2. 确认 MITM 已启用，并包含 `app-services.lynkco.com.cn`。
3. 当天打开一次领克 App。
4. 等待 `Sign: ok`。

## 已知限制

- Loon 无法在 iOS 上自动打开领克或点击按钮。
- 插件至少需要捕获过一次有效 token。
- 当前文章分享暂停，避免触发验证码。

## 排查

如果没有通知：

1. 确认插件已更新到 `v20260812t`。
2. 确认匹配域名已开启 MITM，特别是 `app-services.lynkco.com.cn`。
3. 打开领克 App，观察是否有 `Script hit` 或 `Lynk & Co Sign Request` 通知。

## 版本记录

- `v20260812t`：恢复此前签到成功版本的请求组装逻辑，移除额外 APPCODE 和 `X-Ca-AppCode` 改动。
- `v20260812s`：把调试参数直接写入脚本 URL，避免 Loon 未应用插件参数。
- `v20260812r`：新增 `app-services.lynkco.com.cn` MITM 和签到重试，捕获当前 App 真实签到流量。
- `v20260812q`：暂停文章分享，开启真实签到请求头通知。
- `v20260812p`：签到请求补充 `X-Ca-AppCode: SWGeelyCode`，尝试修复新网关 `Unauthorized Consumer`。
- `v20260812o`：临时开启 `pingNotify=1`，用于确认 Loon 是否命中脚本。
- `v20260812n`：签到请求恢复 APPCODE，修复 `Unauthorized Consumer`。
- `v20260812m`：分享请求不再优先使用旧验证，收到 403 时会清除无效 `certifyId` 并重新走验证流程。
- `v20260812l`：修复分享请求 403，移除导致网关拒绝的多余 App 默认请求头。
- `v20260812k`：新增分享验证的 `certifyId` 自动处理和捕获复用；减少无关调试通知。
