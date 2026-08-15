# 领克 App 自动签到 + 文章分享（Loon 插件）

每天 00:01 自动签到 + 分享文章（+5 积分）。捕获一次 token 后无需再打开领克 App。

## 安装

1. 导入 `LynkCo.plugin`（Loon 需开启 MITM 并信任证书）
2. 打开领克 App 随便翻几个页面 → 自动捕获并保存 token（无需手动操作）
3. 每天 00:01 自动执行，03:01 失败兜底（今日已完成则跳过）

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `articleId` | 空 | 固定分享文章 ID；留空自动取最新文章 |
| `appVersion` | `4.2.3` | 领克 App 版本 |
| `captureNotify` | `0` | 捕获 token 时发通知；需要重抓 token 时临时设 `1` |

其余参数（签名密钥、appCode 等）已默认配好，一般无需修改。token 由捕获自动保存，`refreshToken` 参数仅在手动方式下使用。

## 通知

- `Sign: ok | Share: ok`：签到 + 分享成功（+5 积分异步到账，可在 App 积分页查看）
- 失败通知会附带诊断信息（`signErr=` / `shareErr=` 等），可据此排查或反馈

## 常见问题

- **签到 403**：签名密钥已轮换（App 大版本更新时），需重新提取密钥，见 `docs/protocol.md`
- **没收到通知**：确认插件已更新到最新版本（URL 带 `v=...`）、00:01 时手机在线且 Loon 在运行
- **分享提示 `need.validate.check`**：需要人机验证，打开 App 手动分享一次即可（脚本会自动复用）

## 文件说明

- `lynkco.bundle.js` — 主脚本（Loon 加载的文件）
- `LynkCo.plugin` — 插件入口
- `src/` — 源码；`build.js` 构建产物；`test/` 离线测试
- `docs/protocol.md` — 协议与密钥轮换应对记录
