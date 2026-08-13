# 领克 App 自动签到 + 文章分享（Loon 重构版）

纯定时式重构版：**捕获一次 token 后，每天自动签到和分享文章，无需再打开领克 App**。

> 旧版（`auto.bundle.js` / `capture.bundle.js`，捕获式）已失效：2026-07 领克 App 更新后签名密钥轮换、签到接口迁移为 `/up/api/v1/user/sign/upgrade`、新接口改用原生 SDK 签名体系。本版本补齐两套签名（H5 + 原生 SDK），签到/分享全部由脚本自构造签名请求，不再依赖 App 流量。

## 快速开始

### 1. 导入插件

在 Loon 中导入 `LynkCo.plugin`（双击文件，或复制到 Loon 配置目录后 `[Plugin]` 引用）。

插件已包含：

| 配置项 | 说明 |
| --- | --- |
| `[Script]` 定时任务 | 每天 00:01 执行，03:01 为失败兜底（今日已成功则跳过） |
| 流量捕获 | 命中领克域名时提取 token 并保存（`http-request` / `http-response`） |
| `[MITM]` | 5 个域名：`h5-api.lynkco.com`、`h5.lynkco.com`、`app-api-gw-toc.lynkco.com`、`app-services.lynkco.com.cn`、`gric-api.geely.com` |

### 2. 抓取一次 token（只需一次）

1. 确认 Loon 已开启 MITM 且证书受信任（设置 → MITM → 安装并信任证书）。
2. 打开领克 App，随便操作（登录、签到页、个人中心、资讯页均可）。
3. 等待通知 **`LynkCo Token Captured`**，内容包含捕获到的 `refreshToken` 等信息，并已自动保存。
4. 如果收到的通知显示 `No token saved. Open Lynk & Co once to capture token.`，说明 App 还没有产生带 token 的流量，多翻几个页面即可。

> 也可以手动把 `refreshToken` 填进插件参数（见下表），与捕获二选一。

### 3. 验证

- 捕获成功后，每天 00:01（或手动点插件的"执行"）会收到 **`LynkCo Daily`** 通知。
- 预期成功：`Sign: ok | Share: ok (待浏览) | link=...`
- **分享机制说明**：脚本完成"分享动作"（生成分享码并上报）；`+5 积分`需要**他人当日点击浏览分享链接**（通知里的 `link=`）后才会到账。有浏览时显示 `Share: ok (+5 浏览加分)`，暂无浏览显示 `Share: ok (待浏览)` 属正常，把 `link=` 链接发给好友/小号点击即可加分。

## 插件参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `refreshToken` | 空 | 登录令牌（约 30 天有效，脚本每天自动续期）。可从捕获通知中获取后填入 |
| `deviceId` | 空 | 设备 ID（捕获时自动保存） |
| `deviceType` | `IOS` | 设备类型 |
| `appVersion` | `4.2.3` | App 版本（随 App 更新调整） |
| `articleId` | 空 | 固定分享文章 ID；留空自动取资讯首页第一篇 |
| `xCaKey` | `203760416` | 网关密钥 Key（2026-07 轮换后的新值） |
| `appSecret` | 自动匹配 | 网关密钥 Secret；留空按 `xCaKey` 自动匹配。**无法抓包获得**，轮换时需重新提取（见 docs/protocol.md） |
| `appCode` | `3fa3314998bd4195a9fe2df3e85e6a12` | 静态认证码（refresh 接口用） |
| `shareEnabled` | `1` | 是否执行文章分享 |
| `autoRunOnCapture` | `0` | 捕获到 token 时是否立即执行一次任务 |
| `oncePerDay` | `1` | 每天只成功执行一次 |
| `debug` | `1` | 通知附带诊断信息（失败时建议保持开启，方便排查） |

## 通知解读

| 通知 | 含义 | 处理 |
| --- | --- | --- |
| `LynkCo Token Captured` | 捕获到认证信息并已保存 | 无需处理 |
| `No token saved. Open Lynk & Co once...` | 还没有 token | 打开领克 App 制造一次流量 |
| `Sign: ok` | 签到成功（或今日已签） | 无需处理 |
| `Sign: failed (HTTP 403...)` | 签到被网关拒绝 | 见下方故障排查 |
| `Share: ok (+5 浏览加分)` | 分享动作完成且已有人当日浏览，+5 积分到账 | 无需处理 |
| `Share: ok (待浏览)` | 分享动作完成，等待他人点击浏览加分（正常） | 把通知里的 `link=` 链接发给好友/小号点击 |
| `token=...` 诊断提示 | token 失效 | 重新打开领克 App 捕获新 token |

## 故障排查

**签到 403（诊断含 `type=signature-or-key(403)`）**
- 大概率是签名密钥（appSecret）已失效或 key 再次轮换。AppSecret 无法抓包获得，需要按 `docs/protocol.md` 中的逆向方法重新提取，或等待公开仓库更新。
- 也可能是 App 版本与签名体系不匹配，尝试更新 `appVersion` 参数。

**`Share: failed (need.validate.check)`**
- 分享接口要求极验人机验证。脚本会尝试自动获取 certifyId；若失败，打开领克 App 手动分享一次文章（脚本会从流量中捕获 certifyId 并复用）。

**没有收到任何通知**
- 确认插件已启用、MITM 已开启、证书已信任；在 Loon 脚本页确认脚本被执行（有命中记录）。

## 项目结构

```
├── src/                  # 源码模块（构建源）
│   ├── crypto.js         # SHA256 / HMAC / MD5 / Base64 / UTF-8（纯 JS，兼容 JavaScriptCore）
│   ├── signature.js      # H5 签名 + 原生 SDK 签名
│   ├── config.js         # 参数解析与默认值（密钥表）
│   ├── api.js            # 接口封装（refresh / 签到 / 分享 / 文章 / 积分）
│   ├── tasks.js          # 任务编排（续期 → 签到 → 分享 → 浏览加分报告）
│   ├── store.js          # 持久化（token / 每日状态 / 捕获 / certifyId）
│   ├── notify.js         # 通知与诊断信息
│   └── main.js           # Loon 入口（cron / 捕获分发）
├── lynkco.bundle.js      # 构建产物（Loon 实际运行文件）
├── LynkCo.plugin         # Loon 插件（构建产物，双击导入）
├── build.js              # 构建脚本（node build.js）
├── test/                 # 离线测试 + 真实验证（run-tests.js / live-check.js）
└── docs/protocol.md      # 协议与签名细节记录（密钥轮换应对指南）
```

## 版本历史与旧文件

- 旧捕获式方案（`auto.bundle.js`、`capture.bundle.js` 及 6 个 `lynkco-share-*.remote.plugin`
  旧插件）已于 2026-08-13 移除，被本重构版（`LynkCo.plugin` + `lynkco.bundle.js`）完全取代。
- 旧版本可通过 git 历史找回：`git log --oneline` → `git show <commit>:auto.bundle.js`。
- 若 Loon 中仍装有旧插件（`lynkco-share-*`），请删除——其脚本 URL 已失效。

## 开发

```bash
node build.js            # 重新生成 lynkco.bundle.js + LynkCo.plugin
node test/run-tests.js   # 运行 34 个离线测试（crypto 向量 / 签名格式 / 完整流程 mock）
```

## 已知限制

- 领克 App 有 SSL pinning，token 必须通过 Loon MITM 或越狱/root 设备抓取；正常使用中每 30 天需刷新一次（脚本自动续期，无需手动）。
- 分享每日 1 次动作上限；`+5 积分`需要他人当日浏览分享链接（`link=`）才到账，接口返回 success 不代表加分。
- 密钥（appSecret）随 App 大版本更新可能再次轮换，届时需重新提取。
- 账号存在单会话限制（多个设备同时登录可能互相踢出）。
