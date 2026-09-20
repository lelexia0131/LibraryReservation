# Android port / cross-platform architecture

## 实际运行边界

```text
Windows renderer → preload → 固定 IPC（主窗口和主 frame 校验）
                            → LibraryController → domain → BookingApi → HttpClient → AxiosTransport

Android renderer → android/bridge.ts → Capacitor LibraryApplicationPlugin
                                      → CoreRuntime 私有离线 WebView
                                      → 同一个 LibraryController → 同一个 domain / BookingApi / HttpClient
                                      → 私有 NativeCore 通道 → 原生 HTTP / Keystore / CAS WebView
```

共享 application 拥有协议、输入验证、安全错误/结果投影、缓存、互斥、任务取消与确认权限。
共享 domain 仍只有一套 AvailabilityService、ReservationService、AutoSelectMonitor。共享 API 拥有请求协议、解析、凭据注入、401/10001 失效处理与重试分类；平台 transport 只负责发送请求和返回安全错误元数据。

私有核心必须与 UI 分离。在 Capacitor UI 的普通 JS 上下文中实例化 Controller 会暴露 token，因此本工程不采用该方式。原生 host 从 APK assets 读取私有 bundle，使用独立 WebView 和独立 origin；没有 opener、iframe、共享 JS 对象、文件访问、网络加载或浏览器持久化存储。只有这个 WebView 安装 NativeCore。

Capacitor UI 仅允许固定本地 HTML/CSS/JS 路径；阻断远程 URL、内置文件/content handler、HTTP proxy、下载、popup 和权限请求。默认 HTTP/cookie JavaScript interface 已移除；androidBridge 替换为限定 `https://localhost` 主 frame 且仅允许 `LibraryApplication.invoke` 的 WebMessageListener。其他插件、Cordova 和 JS 错误转发入口均不分发。没有受限消息能力时关闭应用，不降级成跨 frame 的通用桥。Capacitor 升级需重新审查这些入口。

renderer 从两端仅收到 PublicAuthStatus、位置名称、座位编号、安全提示及预约视图，不能访问 token、CAS、cookie、authorization、seat_id、segment、aesjson 或 authority。JSON 参数经序列化进入核心，不能成为可执行脚本。私有 bundle 不放进 `out/android` 或 assets/public，Windows 打包也排除 Android 构建和 Capacitor 依赖。

## Owner 迁移

| 原 owner | 新 owner |
| --- | --- |
| electron/contracts.ts | src/application/contracts.ts |
| electron/ConfirmationAuthority.ts | src/application/ConfirmationAuthority.ts |
| electron/desktopController.ts | src/application/LibraryController.ts |
| HttpClient 内置 Axios | src/platform/node/AxiosTransport.ts，核心注入 HttpTransport |
| SecureTokenStore 接口与文件实现混合 | 接口原路径；文件实现 src/auth/stores/EncryptedFileTokenStore.ts |
| config.ts 内部 process.env provider | src/platform/node/EnvironmentTokenProvider.ts；原 auth 入口保留 re-export |
| Node crypto AES | CryptoJS；协议、字节编码与密文保持兼容 |
| TokenValidator 的 Buffer 解码 | atob + UTF-8 TextDecoder；仍只读取 expiry hint |

Windows 保留 safeStorage 加密、原文件位置/格式、CAS partition/拦截逻辑、IPC 通道和主窗口安全设置。

## Android 原生适配

- `LibraryApplicationPlugin`：只接受固定 10 个应用命令及输入对象。共享 Controller 再做字段 allowlist 验证。
- `CoreRuntime`：私有离线 WebView 生命周期、消息调度与私有平台服务。关闭时取消任务并等待已发送 confirm 的回执；异常销毁时返回安全的未知结果提示。
- `AndroidCasBrowser` / `CasActivity`：先隐藏进行 SSO 检查，再按共享认证状态机显示登录窗口。仅官方两个 HTTPS origin；HTTP 只升级官方默认端口。导航与请求层拦截 callback；hash 变化另有监听。remote confirm、CAS user exchange、非官方主导航、popup、下载、权限与 TLS 绕过均禁用。窗口无 native bridge。CAS URL 只交私有核心，交换并保存完成后关闭窗口。退出会清除浏览器登录数据，不导出 cookie。
- `AndroidSecureTokenStore`：AndroidKeyStore 生成不可导出的 AES-256-GCM 密钥，随机 IV，AtomicFile 保存二进制密文到 noBackupFilesDir。只序列化 token/savedAt/expiresAt，不保存 profile、member、CAS 或请求响应。禁用备份与设备迁移，没有明文降级。
- `AndroidHttpTransport`：原生 OkHttp，固定 booking HTTPS origin 和 API path allowlist，8 秒总超时、默认 TLS 校验、无 CookieJar、无重定向、无连接重试，所有 POST body 都为 one-shot，阻止 HTTP follow-up 隐式重放。无 body/凭据日志。
- Android“打开图书馆”由系统浏览器处理固定 URL，应用不向其传 token，不实现 Electron 的远程 sessionStorage bootstrap。

平台 JS 适配器实现同一 SecureTokenStore、CasBrowserAdapter、HttpTransport 接口，仅把私有服务映射到原生，不实现第二套预约逻辑。

## 确认与生命周期

只有手动预约和明确启动自动选座入口创建 ConfirmationAuthority。一次 authority 最多 consume 一次；已 abort 的 signal 不可 confirm。只按座位显示编号重新查找实时 ID 和时段，然后提交一次。

HTTP timeout、断网、5xx、坏回执和原生桥错误均保守处理为 CONFIRM_OUTCOME_UNKNOWN；不自动再次提交。原生 HTTP 的 one-shot body 很关键：OkHttp 4.12 的 503 Retry-After:0 路径独立于连接重试开关，测试使用本机 MockWebServer 验证不会重放。

共享 monitor 的 15 秒间隔、10 秒下限、429 Retry-After 与 30/60/120 秒退避保持不变。Android MainActivity.onStop 会 suspend 应用任务，取消尚未发出的查询/预约并停止 monitor；onResume 只解除暂停，不重新启动自动任务。已发出的 confirm 不撤销或重放，等待回执。onDestroy 会 shutdown Controller 并取消登录；没有后台服务或自动重启。

## 构建与验证

Node 24+；Android 构建需要 JDK 21 与 SDK 36。`npm run typecheck` 同时检查 Electron 和无 Node 类型的共享/Android TS 图。

```powershell
npm test
npm run typecheck
npm run build
npm run app:build
npm run dist
npm run android:sync
android\gradlew.bat -p android assembleDebug testDebugUnitTest lintDebug
npm run test:mobile-ui
```

测试全部使用 synthetic 响应或本机 MockWebServer，没有向真实官网发送预约。跨平台测试执行实际 browser bundle，环境不提供 Buffer/process/require；覆盖 CAS 交换、最小化保存、缓存、输入拒绝、手动及自动成功/未知结果、原生桥丢失、前台暂停不重启，并检查公开 bundle 不包含私有核心。原有 Electron IPC、CAS、安全存储及 15 秒状态机测试保留。Crypto 测试包含固定 Base64 和原 Node AES oracle；JWT 覆盖无效 Base64URL、缺少 exp、过期与 skew。

移动 UI 测试使用 Edge headless 的 320/360/390/520px 触屏视口，验证无横向溢出、44px 触控目标、日期/时间字段、座位选择和未知结果。它不是 Android 系统 WebView 或软键盘的实机测试。

本轮实际验证（2026-09-20）：

| 检查 | 结果 |
| --- | --- |
| npm test | 185/185 通过；改动前基线 164/164 |
| npm run typecheck | Electron 与无 Node 类型共享图均通过 |
| npm run build / app:build / dist | 均通过，Windows NSIS 重新生成 |
| npm run android:build / android:sync | 通过 |
| Gradle assembleDebug / testDebugUnitTest / lintDebug | 通过；5 个有效原生测试，无 lint error，保留模板资源/版本及启用 JS 的提示 |
| npm run test:mobile-ui | 4 个触屏视口通过 |
| git diff --check | 通过 |
| npm audit --omit=dev | 0 项已知生产依赖漏洞 |

全量 npm audit 仍报告 Capacitor CLI → xcode → uuid 的 3 个 moderate 开发依赖条目（同一 uuid 通告及其上游链，当前无兼容自动修复）。它们不打进应用；没有强制跨主版本覆盖依赖。Windows ASAR 已检查：只有桌面应用输出，无 Android assets、私有核心或 Capacitor 包。

产物：`dist/LibraryReservation-Setup-0.2.0-x64.exe`、`android/app/build/outputs/apk/debug/app-debug.apk`。本轮没有运行真实 Electron 窗口测试（沿用仓库先前停止启动测试的记录），没有启动 Android 设备、输入真实账号或提交真实预约；没有 commit。

## 状态与剩余验收

已实现：共享重构、双桥、Android 原生工程、隔离运行核心、CAS/Keystore/HTTP 适配、查询/手动预约链路、前台唯一 monitor、移动 CSS 和测试。Debug APK 是开发测试包；没有发行签名。

待真机验证：安装启动、实际 Capacitor 原生桥与私有 WebView 的联通、官方 CAS 的 redirect/hash/captcha/SSO 行为、系统 Keystore 写入/恢复/损坏恢复、真实位置与座位查询、真实手动预约成功/拒绝/断网未知回执、15 秒前台计时、Home/返回/进程重建/锁屏停止、刘海/状态栏/系统日期时间选择器/软键盘。当前未连接设备，也没有配置 Android AVD。不得把 JVM 测试或 APK 编译成功表述为真机功能通过。

尚未实现且不属于第一阶段：Foreground Service、后台持续轮询、开机启动、通知、AlarmManager、发行签名及 release AAB/APK。后续首先完成上述真机验收；真实预约需要使用者主动选择与提交。

参考：[Android 原生桥安全边界](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)、[Android Keystore](https://developer.android.com/privacy-and-security/keystore)、[OkHttp 4.12 retry/follow-up 实现](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt)。
