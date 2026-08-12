# 领克 Loon 插件说明

## 当前状态

当前版本：`v20260812x`

当前为诊断模式：

- 自动签到
- 文章分享已恢复
- 关闭每天只跑一次的限制
- 每 5 分钟发送一次 `Lynk & Co Ping`，用于确认 Loon 插件是否加载

预期成功通知：

```text
Sign: ok | Share: ok
```

## 远程插件

在 Loon 中导入这个地址：

```text
https://raw.githubusercontent.com/gougedeyebaihe-hub/gouge/main/lynkco-share-v20260812q.remote.plugin?v=20260812x
```

当前脚本缓存版本：

```text
auto.bundle.js?v=20260812x&oncePerDay=0&pingNotify=1&signRequestNotify=0&shareEnabled=1
```

## 仓库内容

- `lynkco-share-v20260812q.remote.plugin`：当前推荐使用的 Loon 远程插件入口
- `lynkco-share.remote.plugin`：兼容入口
- `auto.bundle.js`：token 捕获和任务执行脚本
- `README.md`：使用说明和排查方法

## 工作方式

1. 每 5 分钟 cron 发送 `Lynk & Co Ping`，证明插件已加载。
2. `http-request` 和 `http-response` 捕获领克流量。
3. 保存到有效 token 后自动执行签到和文章分享。
4. 当前关闭每天只跑一次限制，方便测试。
5. 每次成功或失败会发送最终结果通知。

## Loon 参数

```text
articleId=
debugNotify=0
shareEnabled=1
autoRunOnCapture=1
oncePerDay=0
pingNotify=1
captureTraceNotify=0
signTraceNotify=0
signRequestNotify=0
signCandidateNotify=0
signUpgradeNotify=0
```

| 参数 | 含义 |
| --- | --- |
| `articleId` | 固定文章 ID；留空自动使用第一篇文章 |
| `debugNotify` | 抓到认证状态时通知 |
| `shareEnabled` | 当前为 `1`，文章分享已恢复 |
| `autoRunOnCapture` | 设为 `0` 关闭捕获后自动执行 |
| `oncePerDay` | 当前为 `0`，关闭每天只跑一次限制 |
| `pingNotify` | 当前为 `1`，每 5 分钟发送存活通知 |
| `captureTraceNotify` | 调试用，通知所有命中接口 URL |
| `signTraceNotify` | 调试用，通知签到信息接口摘要 |
| `signRequestNotify` | 调试用，通知真实签到请求头摘要 |
| `signCandidateNotify` | 调试用，通知疑似签到 POST 接口 |
| `signUpgradeNotify` | 调试用，通知 `/sign/upgrade` 请求详情 |

## 匹配域名

```text
h5-api.lynkco.com,h5.lynkco.com,app-api-gw-toc.lynkco.com,app-services.lynkco.com.cn
```

请在 Loon 中对这些精确域名开启 MITM 并信任证书。

## 日常使用

1. 在 Loon 中更新远程插件到 `v20260812x`。
2. 等待 5 分钟内出现 `Lynk & Co Ping`。
3. 打开领克 App。
4. 查看 `Sign: ok | Share: ok` 或失败通知。

## 已知限制

- Loon 无法在 iOS 上自动打开领克或点击按钮。
- 插件至少需要捕获过一次有效 token。
- 诊断模式每 5 分钟通知一次，确认插件正常后应关闭。

## 版本记录

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
