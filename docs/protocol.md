# 领克 App 协议与签名记录

本文件记录领克 App 签到/分享相关协议细节，用于脚本维护与密钥轮换应对。

## 1. 网关与域名

| 用途 | 域名 | 说明 |
| --- | --- | --- |
| 业务网关 | `app-api-gw-toc.lynkco.com` | 签到、分享、积分等业务接口 |
| H5 网关 | `h5-api.lynkco.com` | H5 业务接口（文章、配置） |
| 认证服务 | `app-services.lynkco.com.cn` | 登录/换票（2026-08 起逐步迁移） |
| 认证服务（新） | `gric-api.geely.com` | App 4.2.4 起的换票域 |
| 分享 H5 | `h5.lynkco.com` | shareReporting 上报域名（Origin 必须为此域） |
| 极验 | `captcha4.geely.com` | 人机验证（分享风控） |

## 2. 签名体系

网关为阿里云 API 网关风格，两套签名：

### 2.1 H5 签名（大写 `X-Ca-*` 头）

待签字符串（`\n` 连接）：

```
METHOD
*/*                          ← Accept
                             ← Content-MD5（空）
application/json             ← Content-Type
                             ← Date（空）
X-Ca-Key:<key>
X-Ca-Nonce:<uuid>
X-Ca-Signature-Method:HmacSHA256
X-Ca-Timestamp:<ms>
<path>[?排序后的query]
```

签名 = `Base64(HMAC-SHA256(待签串, appSecret))`，请求头：
`X-Ca-Signature-Headers: X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method`。

### 2.2 原生 SDK 签名（小写 `x-ca-*` 头，签到 upgrade / getShareCode 用）

待签字符串（`\n` 连接）：

```
METHOD
*/*
<Content-MD5>
application/json
<Date: RFC1123 GMT>
<x-ca-* 头按字典序逐行 "name:value">
<path>[?排序后的query]
```

- `Content-MD5 = Base64(MD5(body))`，body 为 `"{}"` 也必须计算；GET 无 body 时计算空串。
- 参与签名的头（按名字 ASCII 升序）：`x-ca-key`、`x-ca-nonce`、`x-ca-timestamp`（+ 额外 `x-ca-appcode` 等，若存在）。
- `X-Ca-Signature-Headers: x-ca-nonce,x-ca-key,x-ca-timestamp`。
- UA 固定 `ALIYUN-ANDROID-UA`。
- query 参数按名字 ASCII 升序排序后拼入 path。

### 2.3 密钥（X-Ca-Key / AppSecret）

| X-Ca-Key | AppSecret | 状态 |
| --- | --- | --- |
| `203760416` | `e1msl9aqd101gfcjpo873hrs5jg752og` | 2026-07 轮换后的新值（当前默认） |
| `204644386` | `QCl7udM3PB9cOIOwquwPglikFQnzJRsX` | 旧值，已全部 403 |

**AppSecret 无法通过抓包获得**（请求头只有 X-Ca-Key，无法从 X-Ca-Signature 反推）。

## 3. 关键接口

### 认证
| 接口 | 方法 | 签名 | 说明 |
| --- | --- | --- | --- |
| `/auth/login/refresh` | GET | APPCODE 静态认证优先，回退原生签名 | 参数：`refreshToken, deviceId, deviceType, appVersion`；返回 `data.centerTokenDto.{token, refreshToken, expireAt}` |
| `/auth/v1/security/config?type=GEE_TEST_V4` | GET | H5 | 返回极验 `data.certifyId`（分享验证用） |

### 签到
| 接口 | 方法 | 签名 | 说明 |
| --- | --- | --- | --- |
| `/up/api/v1/user/sign/day/info` | GET | H5 | 今日签到状态（`signStatus`） |
| `/up/api/v1/user/sign/upgrade` | POST | 原生 SDK | 执行签到，body `"{}"`，`use_security:true`；旧路径 `/up/api/v1/user/sign` 已下线（400） |
| `/up/api/v1/userReward/getContinueDaysAndSignCard` | GET | H5 | 连续天数/补签卡 |

### 分享
| 接口 | 方法 | 签名 | 说明 |
| --- | --- | --- | --- |
| `/app/explore/home-page/config/pccid/get?pageCode=LYNKCO_APP_1028` | GET | H5 | 取资讯页 `pccId`（`cptCode=1009`） |
| `/app/explore/home-page/article?articlePccId=..` | GET | H5 | 文章列表，取第一篇 `id` |
| `/app/v1/task/getShareCode` | GET | 原生 SDK | 风控头：`use_security:true`、`risk_type:1`、`appVersion`、`risk_request_info`（或验证后 `certifyId/challenge/risk_validate_info`） |
| `/app/v1/task/shareReporting?shareCode=..` | POST | H5 | body `{businessNo: 文章id, eventData:{firstClassification:"文章"}}`，`Origin: https://h5.lynkco.com` |
| `/app/energy/myEnergy` | GET | H5 | 积分 `data.point`；**分享是否真加分以此对比为准**（接口返回 success 不可信） |

### 分享验证（certifyId）流程
1. `getShareCode` 返回 `share.need.validate.check` 时需要人机验证。
2. 脚本尝试顺序：已捕获的 certifyId → `/auth/v1/security/config` 获取 certifyId → 携带 `certifyId` 重试。
3. 全部失败：需要打开领克 App 手动分享一次（脚本从流量中捕获 certifyId 复用）。

## 4. 2026-07/08 变更时间线（旧脚本失效原因）

- **2026-07 中旬**：签名密钥轮换，旧 key `204644386` 全部 403；新 key `203760416`。
- **2026-07 中旬**：签到接口 `/up/api/v1/user/sign` → `/up/api/v1/user/sign/upgrade`（旧路径 400）；新接口走原生 SDK 签名体系。
- **2026-07 下旬**：分享改为两步法（`getShareCode` → `shareReporting`），每日 1 次上限；单请求上报（`reporting?type=99/3`）废弃。
- **2026-08**：App 4.2.4 登录/换票域从 `app-services.lynkco.com.cn` 迁往 `gric-api.geely.com`。

## 5. 密钥轮换应对（App 大版本更新时）

1. 更新后脚本报 403（诊断 `type=signature-or-key(403)`）。
2. 确认新 key：抓包 App 的签到请求，看 `X-Ca-Key`（或小写 `x-ca-key`）字段。
3. 新 AppSecret 提取方法（参考 shovelshit/LynkCoHelper 的 `AppSecret_逆向分析记录.md`）：
   - 需要 userdebug/root 设备；`am start -D` + jdb 在 `com.safe.cons.LynkCoConstants$g.<clinit>` 断点提取。
   - 门槛较高；备选：等待公开仓库（GitHub 搜 `lynkco`）更新。
4. 把新值写入 `src/config.js` 的 `LYNK_CO_APP_SECRETS` 表，`node build.js` 重新构建。

## 6. 参考仓库

- `shovelshit/LynkCoHelper` — 最完整协议实现（双签名、登录、分享、逆向文档）
- `xbgo/lynkco-daily` — 日常编排（青龙版），issues 记录 API 变化时间线
- `JackyCZJ/lynkco-checkin`、`mrlj147/lynkco-auto-checkin`、`yujiejobs/lynk_sign_docker` — 其他实现
- `rulaizhi/LynkCoHelper` — 含 2026-07 新密钥的 config.json
