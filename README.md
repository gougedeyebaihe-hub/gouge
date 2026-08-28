# 领克 App 自动签到 + 文章分享（Loon 插件）

每天 00:01 自动签到 + 分享文章（+5 积分）。捕获一次 token 后无需再打开领克 App。

## 安装

1. 导入 `LynkCo.plugin`（Loon 需开启 MITM 并信任证书）
2. 打开领克 App 随便翻几个页面 → 自动捕获并保存 token（无需手动操作）
3. 每天 00:01 自动执行，03:01 失败兜底（今日已完成则跳过）

## 参数

插件导入后可在 Loon 的插件设置页修改（`[Argument]` 控件，下次脚本触发时生效；控件解析待真机确认）：

| 参数（控件） | 默认 | 说明 |
| --- | --- | --- |
| `refreshToken`（文本） | 空 | 手动方式使用；正常流程由流量捕获自动保存 |
| `deviceId`（文本） | 空 | 同上，留空自动捕获 |
| `deviceType`（选择） | `IOS` | 设备类型 |
| `appVersion`（文本） | `4.2.3` | 领克 App 版本 |
| `articleId`（文本） | 空 | 固定分享文章 ID；留空自动取最新文章 |
| `xCaKey`（文本） | `203760416` | 网关密钥；轮换后需更新（见 `docs/protocol.md`） |
| `appSecret`（文本） | 空 | 留空按 `xCaKey` 自动匹配 |
| `appCode`（文本） | `3fa3...` | 静态认证 AppCode |
| `shareEnabled`（开关） | 开 | 是否执行文章分享 |
| `autoRunOnCapture`（开关） | 关 | 捕获到 token 后立即执行一次 |
| `oncePerDay`（开关） | 开 | 每日仅执行一次（当日成功后静默跳过） |
| `debug`（开关） | 开 | 通知附带诊断信息（签名/响应摘要） |
| `captureNotify`（开关） | 关 | 捕获 token 时发通知；需要重抓 token 时临时打开 |

## 手动触发

插件详情页 → 脚本列表 → 点击「lynkco-manual」立即执行一次签到 + 分享，结果以弹窗显示（弹页形态真机待验证；不受「每日仅一次」限制，5 分钟内的重复触发会被冷却拦截，避免与定时任务并发执行）。

## 通知

- `Sign: ok | Share: ok`：签到 + 分享成功（+5 积分异步到账，可在 App 积分页查看）
- 失败通知会附带诊断信息（`signErr=` / `shareErr=` 等），可据此排查或反馈

## 常见问题

- **签到/分享报 403**：按原因排查——① token 失效（最常见）：打开领克 App 翻几个页面重新捕获一次；② 签名密钥失效：领克轮换密钥，提取方法已简化（抓 H5 前端 JS 读明文，无需 root），见 `docs/protocol.md`；③ 风控：稍后再试
- **提示 `No token saved`**：本地没有捕获过 token（首次使用、更换设备、清理 Loon 数据后）——打开领克 App 翻几个页面即可自动捕获，无需填写任何参数
- **没收到通知**：确认插件已更新到最新版本（详情页版本号以 `v2026...` 开头）、00:01 时手机在线且 Loon 在运行
- **分享提示 `need.validate.check`**：需要人机验证，打开 App 手动分享一次即可（脚本会自动复用）

## 文件说明

- `lynkco.bundle.js` — 主脚本（Loon 加载的文件，由 `build.js` 生成）
- `LynkCo.plugin` — 插件入口（由 `build.js` 生成）
- `src/` — 源码；修改后运行 `node build.js` 重建产物（含生成自检）
- `test/` — 离线测试（`node test/run-tests.js`）+ 真实服务器验证（`node test/live-check.js <refreshToken>`）
- `docs/protocol.md` — 协议与密钥轮换应对记录
