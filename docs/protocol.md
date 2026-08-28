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
| `203760416` | `e1msl9aqd101gfcjpo873hrs5jg752og` | 当前脚本生效值（与 rulaizhi/LynkCoHelper 2021 config.json 同值） |
| `204644386` | `QCl7udM3PB9cOIOwquwPglikFQnzJRsX` | H5 前端 vendor JS 明文密钥对（2026-08 抓取线上 JS 确认仍在使用；可能多密钥并存/按客户端路由） |

**密钥可从 H5 前端 JS 明文提取（2026-08 实证）**：`https://h5.lynkco.com/app-h5/dist/web/vendor.<hash>.js`（页面资源含完整 X-Ca 签名实现），密钥对直接作为 crypto-js HmacSHA256 的密钥字符串使用（现场：`a()(w,"QCl7udM3...")`）。用 Loon MitM 抓取该 JS 即可提取，**无需逆向原生 App**。请求头只有 X-Ca-Key，无法从 X-Ca-Signature 反推密钥（HMAC 单向）。

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

### 分享
| 接口 | 方法 | 签名 | 说明 |
| --- | --- | --- | --- |
| `/app/explore/home-page/square/index2` | POST | H5（body 不参与签名） | **取文章/动态**（当前有效）：body `{"dynamicSort":"new","uniqueId":"","refreshType":"MORE","pageNo":1}`，列表在 `data.userByteDynamicsResponseDTOS`（每项含 `dynamicId`）。旧接口 `config/pccid/get` + `article?articlePccId=` 已下线 |
| `/app/v1/task/getShareCode` | GET | 原生 SDK | 风控头：`use_security:true`、`risk_type:1`、`appVersion`、`risk_request_info`（或验证后 `certifyId/challenge/risk_validate_info`） |
| `/app/v1/task/shareReporting?shareCode=..` | POST | H5 | body `{businessNo: 文章id, eventData:{firstClassification:"文章"}}`，`Origin: https://h5.lynkco.com` |
| `/app/energy/myEnergy` | GET | H5 | 积分 `data.point`（字符串）；**分享加分机制**：分享动作完成 + 他人（或自己）当日浏览分享链接 → +5 积分。动作成功与加分是两回事 |

### 分享验证（certifyId）流程
1. `getShareCode` 返回 `share.need.validate.check` 时需要人机验证。
2. 脚本尝试顺序：已捕获的 certifyId → `/auth/v1/security/config` 获取 certifyId → 携带 `certifyId` 重试。
3. 全部失败：需要打开领克 App 手动分享一次（脚本从流量中捕获 certifyId 复用）。

## 4. 变更时间线（旧脚本失效原因）

- **2026-07 中旬**：脚本切换至 `203760416` 密钥对；`204644386` 对曾出现 403，但 2026-08 实测 H5 前端仍在用该对（可能多密钥并存/按客户端路由）——"轮换"的准确时间线未完全还原，勿再断言"旧 key 全部失效"。
- **2026-07 中旬**：签到接口 `/up/api/v1/user/sign` → `/up/api/v1/user/sign/upgrade`（旧路径 400）；新接口走原生 SDK 签名体系。
- **2026-07 下旬**：分享改为两步法（`getShareCode` → `shareReporting`），每日 1 次上限；单请求上报（`reporting?type=99/3`）废弃。
- **2026-08**：App 4.2.4 登录/换票域从 `app-services.lynkco.com.cn` 迁往 `gric-api.geely.com`。

## 5. 密钥轮换应对（App 大版本更新时）

1. 更新后脚本报 403（诊断 `signErr=`/`shareErr=` 含 HTTP 403）。
2. 确认发生轮换：抓包 App 的签到请求，看 `X-Ca-Key`（或小写 `x-ca-key`）字段是否变化；**注意多密钥并存可能——key 变了不代表旧对全失效，先用现有值直接复测**。
3. 提取新密钥对（按优先级）：
   - **首选（已实证，无需 root）**：Loon MitM 抓取 H5 前端 vendor JS（`h5.lynkco.com` 页面资源 `vendor.<hash>.js`），搜索 X-Ca 签名实现中作为 HMAC 密钥字符串明文使用的密钥对（`204644386` 对即以此法提取，2026-08 现场确认）。
   - 兜底：参考 shovelshit/LynkCoHelper 的 `AppSecret_逆向分析记录.md`（userdebug/root 设备 + `am start -D` + jdb 在 `com.safe.cons.LynkCoConstants$g.<clinit>` 断点提取）。
   - 备选：等待公开仓库（GitHub 搜 `lynkco`）更新。
4. 把新值写入 `src/config.js` 的 `LYNK_CO_APP_SECRETS` 表，`node build.js` 重新构建；也可用插件 UI 的 `xCaKey`/`appSecret` 参数临时覆盖（无需重装插件）。

## 6. 参考仓库

- `shovelshit/LynkCoHelper` — 最完整协议实现（双签名、登录、分享、逆向文档）
- `xbgo/lynkco-daily` — 日常编排（青龙版），issues 记录 API 变化时间线
- `JackyCZJ/lynkco-checkin`、`mrlj147/lynkco-auto-checkin`、`yujiejobs/lynk_sign_docker` — 其他实现
- `rulaizhi/LynkCoHelper` — config.json（base64 存储）含长期公开密钥对，与当前脚本 `203760416` 对同值（2021 年提交，非"2026-07 新密钥"）
