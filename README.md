# 领克 Loon 插件说明

## 当前状态

当前版本：`v20260813a`

当前状态：

- 自动签到
- 文章分享已恢复
- 关闭每天只跑一次的限制
- 关闭每 5 分钟的存活通知，避免无关通知刷屏
- 新增自动抓取，命中领克流量后发送 `Lynk & Co Capture`

预期成功通知：

```text
Sign: ok | Share: ok
```

## 远程插件

在 Loon 中导入这个地址：

```text
https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco-share-v20260812q.remote.plugin?v=20260813a
```

当前脚本缓存版本：

```text
auto.bundle.js?v=20260812z&oncePerDay=0&pingNotify=0&signRequestNotify=0&shareEnabled=1
capture.bundle.js?v=20260813a&forceNotify=0&minNotifyIntervalMs=60000
```

## 仓库内容

- `lynkco-share-v20260812q.remote.plugin`：当前推荐使用的 Loon 远程插件入口
- `lynkco-share.remote.plugin`：兼容入口
- `auto.bundle.js`：token 捕获和任务执行脚本
- `capture.bundle.js`：只负责抓取认证状态并发送通知
- `README.md`：使用说明和排查方法

## 工作方式

1. `http-request` 和 `http-response` 捕获领克流量。
2. 保存到有效 token 后自动执行签到和文章分享。
3. 当前关闭每天只跑一次限制，方便测试。
4. 每次成功或失败会发送最终结果通知。

## 抓取数据

1. 在 Loon 中把插件更新到 `v20260813a`。
2. 打开领克 App，进入登录、签到、个人中心等页面，制造真实请求。
3. 收到 `Lynk & Co Capture` 通知后，通知内容是一段 JSON。
4. 从 JSON 中读取 `refreshToken`、`deviceId`、`token` 等字段，用于后续 Windows 端脚本。

如果收不到抓取通知，先确认插件版本是 `v20260813a`，再确认 Loon 的 MITM 已开启且证书受信任。

## Loon 参数

```text
articleId=
debugNotify=0
shareEnabled=1
autoRunOnCapture=1
oncePerDay=0
pingNotify=0
captureTraceNotify=0
signTraceNotify=0
signRequestNotify=0
signCandidateNotify=0
signUpgradeNotify=0
forceNotify=0
minNotifyIntervalMs=60000
```

| 参数 | 含义 |
| --- | --- |
| `articleId` | 固定文章 ID；留空自动使用第一篇文章 |
| `debugNotify` | 抓到认证状态时通知 |
| `shareEnabled` | 当前为 `1`，文章分享已恢复 |
| `autoRunOnCapture` | 设为 `0` 关闭捕获后自动执行 |
| `oncePerDay` | 当前为 `0`，关闭每天只跑一次限制 |
| `pingNotify` | 当前为 `0`，关闭每 5 分钟存活通知 |
| `captureTraceNotify` | 调试用，通知所有命中接口 URL |
| `signTraceNotify` | 调试用，通知签到信息接口摘要 |
| `signRequestNotify` | 调试用，通知真实签到请求头摘要 |
| `signCandidateNotify` | 调试用，通知疑似签到 POST 接口 |
| `signUpgradeNotify` | 调试用，通知 `/sign/upgrade` 请求详情 |
| `forceNotify` | 当前为 `0`，只在认证状态变化时发送抓取通知 |
| `minNotifyIntervalMs` | 抓取通知最短间隔，当前为 60000 毫秒 |

## 匹配域名

```text
h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com,app-services.lynkco.com.cn
```

请在 Loon 中对这些精确域名开启 MITM 并信任证书。

## 日常使用

1. 在 Loon 中更新远程插件到 `v20260813a`。
2. 打开领克 App。
3. 查看 `Sign: ok | Share: ok`、失败通知，或 `Lynk & Co Capture` 抓取通知。

## 已知限制

- Loon 无法在 iOS 上自动打开领克或点击按钮。
- 插件至少需要捕获过一次有效 token。
- 抓取通知只在认证状态变化时发送，避免同一状态反复弹出。

## 版本记录

- `v20260813a`：新增独立抓取脚本，自动保存并通知 `refreshToken`、`deviceId`、`token` 等认证字段。
- `v20260812x`：每 5 分钟发送脚本存活通知，用于确认 Loon 是否加载插件。
- `v20260812w`：恢复文章分享，保留现有分享验证流程。
- `v20260812v`：关闭每天只跑一次限制，进入测试模式。
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
