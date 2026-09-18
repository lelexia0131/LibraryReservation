# 第二阶段持久认证实现与交付报告

实现日期：2026-09-18。当前工作区是 TypeScript/Node CLI，不是 Electron，也没有 renderer/preload 或操作系统凭据库。按需求的非 Electron 分支实现认证核心及 adapter 契约，没有安装 Electron、Playwright 或 keytar。以下模拟验证不代表真实浙江大学 CAS 已联调通过。

## 1. 当前认证架构

```text
BookingService → TokenProvider.getToken()
  AUTH_MODE=env            → EnvironmentTokenProvider
  AUTH_MODE=persistent-cas → AuthManager
                            ├─ SecureTokenStore
                            ├─ TokenValidator
                            └─ CasTokenProvider
                                ├─ PersistentCasSession → CasBrowserAdapter
                                └─ HttpClient（无 authorization）→ /api/cas/user
打开官网 → BookingWebSessionBootstrap → BookingWebBrowserAdapter
```

`AuthManager` 本身实现 `TokenProvider`，没有多余的 PersistentTokenProvider 转发层。旧的 `src/config/config.ts` 导出路径兼容保留。BookingService 仅在默认 HTTP 实例上增加 401 失效回调；BookingApi、AES、area/segment/seat resolver 未修改。认证成功不触发预约。

同一个 AuthManager 内，缓存读取、CAS 流程、交换和安全写入都共享一个 Promise。桌面宿主应只创建一个 AuthManager，并保持单 App 实例。初始化只做隐藏 SSO；需要人工操作则返回 LOGIN_REQUIRED 并关闭隐藏窗口，之后用户点击登录才启动交互流程。初始化尚未结束时的显式 getToken 可将当前流程升级为允许交互，不增加窗口。

## 2. 新增和修改文件

| 类别 | 文件 |
| --- | --- |
| 新增认证核心 | `src/auth/AuthManager.ts`, `TokenProvider.ts`, `EnvironmentTokenProvider.ts`, `TokenValidator.ts`, `authErrors.ts`, `createAuth.ts` |
| 新增 CAS | `src/auth/CasBrowserAdapter.ts`, `PersistentCasSession.ts`, `CasTokenProvider.ts`, `casUrlParser.ts` |
| 新增存储与网页 | `src/auth/SecureTokenStore.ts`, `BookingWebSessionBootstrap.ts` |
| 新增命令 | `src/auth/authCommands.ts`, `src/cli/auth.ts` |
| 修改接入边界 | `src/config/config.ts`, `src/api/httpClient.ts`, `src/domain/BookingService.ts`, `src/cli/booking.ts`, `src/errors.ts` |
| 新增测试 | `tests/authFixtures.ts`, `AuthManager.test.ts`, `TokenValidator.test.ts`, `casUrlParser.test.ts`, `SecureTokenStore.test.ts`, `BookingWebSessionBootstrap.test.ts` |
| 修改测试 | `tests/cli.test.ts`, `httpClient.test.ts`, `config.test.ts` |
| 文档与配置 | `README.md`, `docs/auth.md`, `package.json`, `.env.example`, `.gitignore` |

依赖及 lockfile、tsconfig 无改动。构建输出位于已忽略的 `dist/`。

## 3. 首次登录流程

无缓存 → 隐藏窗口访问真实 booking `/api/cas/cas` → 等待最多 8 秒 → 若停留在官方 `/cas/login`，且调用允许交互，则显示原窗口“浙江大学统一身份认证” → 用户本人登录 → 捕获主 frame cas → 换 token → 安全保存 → 标题“认证成功” → 关闭窗口。交互等待上限为 5 分钟；用户关闭会得到 AuthCancelledError。不会读取输入框、表单、页面 HTML 或 ticket。

## 4. 第二次启动流程

读取 SecureTokenStore → 解析 JWT exp → 距离过期严格大于 60 秒则直接返回 token。单元测试使用新 AuthManager 实例读取同一存储验证该分支；不会创建浏览器或发送 CAS 请求。

## 5. booking token 保存位置

`EncryptedFileTokenStore` 的文件路径为宿主提供的 `userDataDirectory/auth/token.bin`。最终 Electron 宿主必须传入 `app.getPath('userData')`，不能传仓库目录。token、savedAt、expiresAt 一起加密，仅写 Buffer；临时文件和目标文件在同目录，写好后 rename 替换。时间戳统一为 Unix 毫秒。

当前没有生产 OS cipher adapter，因此本轮没有创建真实 token 文件。测试在系统临时目录使用随机内存测试密钥，结束后清理；测试 cipher 不属于生产实现。

## 6. CAS Cookie 保存位置

契约指定 `persist:zju-booking-auth`，由未来 Electron session 自行管理该 partition 的 Cookie/站点数据，不导出 Cookie。当前 Node CLI 没有浏览器 profile，也没有真实 CAS Cookie。本轮未声称完成 CAS Cookie 跨重启持久化验证。上游 Cookie 自身的期限和 CAS 策略仍可能要求重新登录。

## 7. 为什么不保存账号密码

持久凭据只需要 booking token 和正常浏览器 SSO 状态。统一认证、验证码及 MFA 都由用户在官方页面完成。实现没有密码字段读取、保存、自动填写或提交功能，也不伪造 ticket/cas。

## 8. token 有效时是否完全不打开 CAS

是。该核心分支有测试保证：无窗口、无 CAS HTTP 请求，只有本地缓存检查。JWT exp 仅作缓存期限提示，不据此相信身份或签名；服务器返回 401 仍会使缓存失效。

## 9. token 失效、CAS 有效时是否静默刷新

是，adapter 驱动的核心流程已经验证：隐藏窗口捕获回调、交换并保存新 token，show 调用次数为 0。真实 Electron SSO 持久化尚待接入验证。

无法解析 exp 的旧 token 会刷新；新换取的 token 若没有可用 exp，会明确报 TOKEN_EXPIRY_INVALID，既不永久信任，也不无限刷新。

## 10. CAS 失效后如何重新登录

隐藏尝试到期且 URL 明确为官方 HTTPS `/cas/login` 才判为需要用户登录。交互调用显示同一窗口；initialize 不弹窗。网络失败、其他页面或未知重定向会报失败/超时，不能冒充“用户需要登录”。

## 11. /api/cas/user 调用方式

POST `https://booking.lib.zju.edu.cn/api/cas/user`，body 仅 `{cas}`。HttpClient 支持 `authRequired:false`，移除默认 authorization/Cookie header，不注入 body authorization，不跟随重定向，不自动重试交换。严格要求数值 `code === 1` 及非空原始 `member.token`；其余响应/传输错误统一为 CasTokenExchangeError，无原始错误、member 或服务端消息附带。

## 12. cas 解析方式

使用 URL 解析器，要求准确 HTTPS booking origin，拒绝伪子域名、非标准端口和 userinfo。兼容普通 query、hash router query，不固定 pathname。parser 支持需求中的短示例 abc；真正交换前执行 8–512 字符且无空白/控制字符校验。cas 只在认证回调及交换调用内存中使用，不写文件、配置、状态或日志。

## 13. partition 名称

CAS 和官网窗口统一使用 `persist:zju-booking-auth`，不与默认浏览器或其他用途混用。仅完全登出清理它；窗口正常关闭只清理监听器，不清 session。

## 14. SecureTokenStore 的实现

接口为 get/set/clear，实现为 `EncryptedFileTokenStore` + 必须注入的 `CredentialCipher`。只保存 token/savedAt/expiresAt；忽略额外 member 字段。损坏/解密失败清除密文并按空缓存处理；存储不可用明确失败，不回退明文。OS cipher 的 Electron safeStorage 绑定尚未实现。

## 15. renderer 是否能看到 token

当前没有 App renderer 或 IPC。`getStatus()` 仅返回 state、hasCachedToken、tokenExpiresAt、casSessionAvailable，不返回任何凭据。未来 App renderer 只能通过最小 IPC 请求状态/登录/退出/打开网页/显式预约，main 内部持有 AuthManager。不能把 getToken 或 AuthManager 实例桥接到 renderer。

官方 booking 远程页面是必要例外：官网本身按协议从自己的 sessionStorage 读取 token。该恢复写入只面向准确 booking origin；它不意味着向 App UI renderer 暴露 token。

## 16. logout 如何工作

`clearBookingToken()` 清 secure store 和内存，保留 SSO；`logout()` 另要求 adapter 关闭该 partition 的全部窗口并清除全部 Cookie/站点数据，覆盖 booking 和 zjuam。未实现服务器 logout 网络调用，本地全 partition 清理是此接口的保证，不能声称注销了其他浏览器的账号会话。

清理期间阻止新认证并等待正在进行的交换/写入结束，再删除缓存，避免登出后 token 重现。两个清理动作即使其中一个失败也都会尝试，失败明确报告。关闭认证窗口导致取消时也清理本次写入。正常退出 App 不调用 logout。

HTTP 401 通知 provider.invalidateToken，带原请求 token 避免迟到的旧 401 删除新 token；随后报错给上层，原请求不重发。confirm 的 timeout/401/未知结果均不会自动二次提交，必须先在官网查询预约记录。

## 17. openBookingWebsite 如何恢复网页登录态

`BookingWebSessionBootstrap.openBookingWebsite()` 先取有效 token，创建隐藏安全窗口，加载 `/h5/index.html`。dom-ready 时先检查当前 origin，再通过 host 的 isolated-world 执行再次检查 origin，写入 sessionStorage 的 token/isCas 和 `__appAuthBootstrapped=1`。仅允许一次 reload；第二次确认 guard 和 token 后显示窗口。循环、跨来源跳转、关闭和超时都会结束并清理监听器。

没有修改官网文件，也没有伪造或持久保存 UserInfo。实际官网是否还依赖 UserInfo、是否在首次 dom-ready 前跳转，以及 callback 页面与 App 是否争抢一次性 cas，须在真实 host 联调确认；如有依赖，应接入已核验的官方认证接口或更早的安全 bootstrap，不能猜用户资料。

## 18–20. 三个真实人工验证命令的执行结果

```text
npm run auth:test
npm run auth:clear-token
npm run auth:logout
```

三条均已实际执行，退出码均为 1，输出统一为：

```text
[Auth] AUTH_ADAPTER_UNAVAILABLE: This Node CLI has no desktop adapters. Supply CasBrowserAdapter and SecureTokenStore from a desktop host; see docs/auth.md.
```

这三项真实 CAS 人工验收未通过，也未进行真实登录/登出或 Cookie 清理。原因是当前项目非 Electron 且没有宿主 adapter，按需求不强改框架。命令处理器 `runAuthCommand` 已以注入的真实认证核心及模拟 browser/store 测试：test 获得 token，clear-token 只清 booking 缓存，logout 同时清 session。CLI 没有把 mock 当成生产实现或默默退回环境 token。

## 21. 单元测试和构建

本轮 `npm test`：107/107 通过，包含原有 55 项回归和新增 52 项。`npm run typecheck`、`npm run build` 通过。覆盖 URL、JWT exp 边界、single-flight、initialize、静默/交互切换、取消/错误、401、迟到的 401、并发登出、写入竞态、加密文件重建/损坏恢复/写入失败、网页来源检查/reload guard、脱敏及 CLI 缺少 adapter 的行为。

HTTP、CAS 和网页测试均使用合成凭据/模拟 adapter，没有真实预约请求。安全存储测试只验证加密文件逻辑，不能替代 Windows DPAPI 等 OS 凭据服务的实测。

## 22. working tree 状态

本轮开始时 `git status` 返回 not a git repository；结束时再次检查，工作区已存在 Git 仓库，当前基线为 `c3c051e 初始化`。本次实现没有执行 Git 初始化或 commit，也未改动该基线。认证变更均保留在未暂存/未跟踪的工作区中；修改范围见第 2 节。

## 23. 是否有真实凭据进入工作区

本轮未获取、读取或写入真实 token、cas、Cookie、账号密码或 UserInfo；测试只用 synthetic 数据。本次扫描未发现新增明文凭据存储或日志输出路径。`.gitignore` 已覆盖 `.env`、`.env.*`、`auth-state/`、`*.har`、`token*`、`playwright/.auth/`，保留 `.env.example` 例外；为 Windows 下被 token* 匹配的 TokenProvider.ts、TokenValidator.ts 及对应测试添加了精确源码例外，没有删除用户配置。

HTTP 错误采用只允许固定路径/状态码/固定说明的输出，不序列化 AxiosError、request、response、headers、body 或 cause。通用文本脱敏另覆盖 authorization/cookie/set-cookie/token/cas 等键值。认证日志只有固定消息；无原始导航 URL、密文 Buffer 或个人 member 字段。

## Electron 宿主仍需补的 adapter

1. **CasBrowserAdapter**：在 app ready 后创建 BrowserWindow，使用上述 partition 和安全参数。桥接主 frame 导航/重定向/同页 hash、关闭和加载失败事件，正确返回 unsubscribe；忽略预期导航中止及子 frame 失败，捕获 cas 后阻止官网同时兑换该凭据。拒绝不可信导航、任意弹窗和未授权权限请求，不绕过 TLS。不读取 Cookie 值，只让 session 正常保存。实现清 session 时先关闭所有关联窗口，然后清全部站点数据并确认 Cookie 清除。
2. **CredentialCipher**：绑定 Electron safeStorage；应用 ready 后检查可用性，Linux 必须拒绝 `basic_text`，禁止明文降级。将 `app.getPath('userData')` 传给 EncryptedFileTokenStore。同步绑定可使用本接口；如果宿主选异步 safeStorage，需相应扩展 cipher 的异步接口。Electron 当前文档优先推荐异步 API；Windows 使用 DPAPI，不能将其当作对同一登录用户下其他进程的隔离。[safeStorage 官方说明](https://www.electronjs.org/docs/latest/api/safe-storage)
3. **BookingWebBrowserAdapter**：桥接 dom-ready、isolated-world 执行和 reload，同样注册到 partition 窗口生命周期管理；真实联调验证首次脚本加载前后的登录跳转、sessionStorage guard 及 UserInfo 依赖。
4. **桌面入口与 IPC**：创建单一 AuthManager，App 初始化调用 initialize；用户点击调用 login/open web/booking。仅可信 App 页面可调用 allowlist IPC，校验 sender 主 frame 和来源；远程页面没有 Node、shell、filesystem 或通用 IPC 暴露。renderer 的 login handler await getToken 后只返回 getStatus。正式 App 默认 persistent-cas；当前开发 CLI 默认 env。

持久 partition 和清理操作参考 [Electron session 文档](https://www.electronjs.org/docs/latest/api/session)，远程窗口和 IPC 约束参考 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。这部分为后续接入要求，不是已完成的 Electron 实现。

## 三条验证链

**A. 首次登录**：Fresh install → 隐藏 CAS 尝试 → interactive CAS → cas → POST /api/cas/user → token → secure store → 关闭窗口。模拟测试通过；真实 CAS 待 host adapter。

**B. 第二次打开**：App start → secure token → JWT exp 有效 → direct access；零 CAS 窗口、零认证网络请求。新 AuthManager 读取存储测试通过；真实 App 重启待 host adapter。

**C. token 过期、CAS 仍有效**：App start → token expired → hidden CAS SSO → cas → refreshed token → secure store → direct access；show 为 0。模拟测试通过；真实 Cookie 跨重启 SSO 待 host adapter。
