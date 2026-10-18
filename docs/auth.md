# 持久登录（Windows / Android）

## 共享认证流程

两端共用 AuthManager、HttpCasSession、CasTokenProvider 和 LibraryController。
启动或每次业务请求前先检查安全缓存中的 JWT exp（保留原有 60 秒余量）。
缓存不可用时，使用平台私有 Cookie 会话访问图书馆 `/api/cas/cas`，优先静默 SSO。
SSO 不可用时，只读取用户明确同意保存的凭据；否则提示应用内账号密码登录。

应用内表单提交账号、密码、remember 后立即清空。核心获取 CAS execution，
在同一 Cookie 会话中查询 getKaptchaStatus 和 getPubKey，按官网 RSA 算法加密密码，
携带原 service 提交 CAS 登录表单。跟随受限 HTTPS 回调，提取 cas，再通过
POST `/api/cas/user` 换取 Booking Token。不会把 CAS ticket 当成 Booking Token。
兑换与回调沿用同一个私有图书馆 Cookie 会话；预约请求仍使用原有无 Cookie 的 Token 传输。

不默认打开 CAS 窗口。验证码、MFA、陌生重定向或无法识别的认证结果均停止自动认证，
用户主动点击“官方验证”才打开原有安全 CAS 窗口。核心不会自动填写或绕过验证。
只有 HTTP 认证成功且勾选同意保存，才保存该密码；官方验证窗口中输入的密码不被读取。

## 存储与安全边界

- Windows：主进程使用 safeStorage，加密写入 userData/auth/token.bin 和 credentials.bin。
  原子替换文件，不回退明文；renderer 只能提交登录表单并读取安全状态。
- Android：private CoreRuntime 运行同一 TypeScript 核心。原生层使用既有 Keystore AES-GCM
  能力，分别保存 booking-token.bin 和 booking-credentials.bin，位于 noBackupFilesDir。
  私有 CAS HTTP 适配器与官方验证 WebView 共享 CookieManager；公共 WebView 没有存储读取或 HTTP 能力。
- Cookie 由各平台的私有会话按学校有效期管理，不改写学校 Cookie 的过期时间。
- 未勾选保存时不持久化密码；退出会取消并等待认证/写入，然后同时清除 Token、凭据及 CAS 会话。
- 原有 origin、IPC、原生命令、URL allowlist、TLS、WebView 隔离保持有效。
  Cookie、Token、密码、完整服务端错误与导航 URL 不进入公共回复或日志。

## 自动恢复与预约保护

AuthManager 的单一 Promise 合并并发认证；过期前主动换取 Token。
HTTP 401 及已核实业务码 10001 会清除被拒绝的旧 Token，查询最多恢复并重放一次。
迟到的旧 Token 拒绝不会清除不同的新 Token。密码失效停止重试并删除失效凭据；
人工验证和协议异常等待用户操作；网络认证失败冷却 30 秒，第二次失败后停止自动尝试。
自动轮询仍为 15 秒，既有限流和网络退避不变。
Android 认证专用客户端允许未发送连接的恢复，采用 25 秒总超时、8 秒连接超时、12 秒读取超时；
CAS 密码 POST 仍为 one-shot，预约客户端保持原有 8 秒总超时及禁止重试配置。
Android 的超时、DNS、TLS 与桥接故障分别使用固定错误码，不返回异常正文。

confirm 发送后不因任何认证、网络或超时异常重发；认证异常视为结果未知，
停止并要求在官网核实。ConfirmationAuthority、座位重验、AES 业务加密均保留。

## 协议核实记录（2026-10-18，仅公开 GET）

Windows 使用 Electron `net.request` 的 redirect 事件读取 302，再由共享核心校验下一跳。
当前 Electron 的 `session.fetch({redirect:'manual'})` 会在正常跳转时抛出
`Redirect was cancelled`，不能用它模拟返回 302 的 Node fetch。
`node scripts/test-cas-network.mjs` 在隔离用户目录、无窗口的真实 Electron 中复核公开认证链路，
仅执行 GET，不读取用户账号或现有登录状态。

- [图书馆认证入口](https://booking.lib.zju.edu.cn/api/cas/cas) 返回 PHPSESSID，并重定向
  CAS login，service 指向图书馆同一入口。服务端仍返回旧 HTTP CAS 地址，客户端仅将
  精确官方主机的 login 升级至 HTTPS，拒绝其他明文或非允许地址。
- [CAS 登录页](https://zjuam.zju.edu.cn/cas/login) 含 execution，设置 JSESSIONID/_csrf；
  [官方 login.js](https://zjuam.zju.edu.cn/cas/js/login/login.js) 查询验证码状态和 RSA 公钥，
  [官方 security.js](https://zjuam.zju.edu.cn/cas/js/login/security.js) 使用反转 UTF-16 字符及 RSA 分块。
  单字节密码实现已与官网算法核对；非单字节密码转为官方验证，避免旧 JS 大整数算法的差异。
- [公钥端点](https://zjuam.zju.edu.cn/cas/v2/getPubKey) 当前返回 modulus/exponent。
- [图书馆前端](https://booking.lib.zju.edu.cn/h5/index.html) 当前引用 index.1782805514175.js，
  其 CasLogin 用 `{cas}` 兑换 member.token；响应拦截器将业务码 10001 视为会话失效。
- 参考 [Celechron zjuam.dart](https://github.com/Celechron/Celechron/blob/main/lib/http/zjuServices/zjuam.dart)、
  database_helper.dart、ugrs_spider.dart、grs_spider.dart、login_page.dart 的凭据存储、并发登录和错误分类设计，
  未复制 Dart 代码。Celechron 当前也不保证跨启动复用 iPlanetDirectoryPro。

未使用真实账号或提交真实预约，未验证成功登录后的学校实机回调/MFA及真实 Cookie 有效期。
合成测试覆盖协议、重启恢复、同意保存、并发、错误分类、注销竞态与单次 confirm；
模拟通过不能替代学校真实账号联调，也不承诺永久免登录。
