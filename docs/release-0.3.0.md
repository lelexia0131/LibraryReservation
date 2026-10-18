# LibraryReservation 0.3.0 交付记录

## 认证与界面

- 内部账号密码登录，默认不勾选保存；共享 HTTP CAS 状态机、并发登录合并、JWT 检查、401 / 10001 查询恢复且仅重放一次。
- Windows 凭据由主进程 safeStorage 加密；Android 在 private CoreRuntime / 原生层使用 Keystore 与 AES-GCM。退出清除 Token、保存凭据和会话。
- CAS execution、公钥、验证码状态和回调使用同一私有 Cookie 会话；图书馆 cas 兑换沿用该会话 Cookie。
- Windows 终端 Token 兑换使用主进程 Node 网络请求，远程 Chromium 对兑换和 confirm 的阻断规则保留。
- 验证码、MFA、非单字节密码或协议变化要求用户主动打开官方验证；官方窗口密码不被读取或保存。
- confirm 发送后永不自动重发；结果未知时停止并提示官网核实。15 秒轮询、限流退避、选座与 AES 规则未改动。
- 首页删除绿色“阅”、中英文宣传文案与冗余 CSS，主体上移；图标由 Android 432px 前景原图生成 7 档 ICO，Android 图标资源未改。

## 验证

- TypeScript 两套类型检查与 CLI 构建通过。
- 143 项认证、HTTP、存储、跨平台与单次预约保护测试通过（分组执行）。
- Android 原生单元测试 16 项通过；assembleDebug 通过。
- 一次隔离 Electron 集成验收通过：内部表单、safeStorage 密文、重建认证实例恢复、注销和合成预约保护。
- 手机 320 / 360 / 390 / 520px 布局、触控及合成交互通过；桌面最小尺寸和截图检查通过。
- Windows NSIS 0.3.0 x64 安装包构建通过；Android APK 为 0.3.0 / versionCode 2，现有 Debug 签名验证通过。
- 对打包资源核对版本、认证核心、清理后的页面和图标；ICO 包含 16 / 24 / 32 / 48 / 64 / 128 / 256px。
- git diff --check 通过。未新增依赖。

未验证：真实账号登录后的 CAS 回调、学校 MFA、真实会话有效期、Android 真机 Keystore/重启恢复及安装后的系统快捷方式显示。
没有使用真实账号，没有执行真实预约。Android 修复包已通过 adb -r 覆盖安装，未清除应用数据。

## Windows 登录检查修复（2026-10-18）

真实 Electron 复现了正常 302 被 session.fetch 手动跳转模式取消的问题；原先被统一误报为网络故障。
CAS 请求改用 net.request 的 redirect 事件，把状态和下一跳交给共享核心校验，保留原会话和安全拦截。
补充跳转取消、UTF-8 响应和中止回归测试。真实公开 GET 检查覆盖图书馆至 CAS、会话 Cookie、验证码状态和 RSA 公钥。
重新生成 Windows 0.3.0 安装包；Android 包与预约逻辑未改动。

## Android 登录检查修复（2026-10-18）

在 Huawei Android 12 真机上，以独立 WebView Cookie 目录执行公开 GET 对比；未读取用户 Cookie、凭据或 Keystore。
观测到图书馆 TLS 建连超时，旧认证客户端使用预约客户端的 8 秒总超时和禁止连接恢复策略。
认证专用客户端现允许未发送连接的恢复，总超时 25 秒、连接超时 8 秒、读取超时 12 秒；CAS 密码 POST 保持 one-shot。
预约客户端保持原配置，confirm 无自动重发。超时、DNS、TLS 与原生桥故障改用不同固定错误码和提示，异常正文不进入 UI。
修复后的生产 CAS 适配器在真机通过图书馆 302、CAS 登录页 execution、验证码状态及 RSA 公钥读取。
本轮 122 项相关 JS 回归、16 项原生单元测试、类型检查、APK 构建与签名校验通过。
已覆盖安装修复 APK；临时测试组件和命令行探针已移除，用户登录数据保留。

## 修改文件

- `tests/AndroidCasHttpAdapter.test.ts`

- `android/app/src/test/java/cn/libraryreservation/android/AndroidCasHttpTransportTest.java`

- `android/app/src/androidTest/java/cn/libraryreservation/android/CasNetworkSmokeTest.java`

- `README.md`
- `android/app/build.gradle`
- `android/app/src/main/java/cn/libraryreservation/android/AndroidCasHttpTransport.java`
- `android/app/src/main/java/cn/libraryreservation/android/AndroidSecureTokenStore.java`
- `android/app/src/main/java/cn/libraryreservation/android/CoreRuntime.java`
- `android/app/src/main/java/cn/libraryreservation/android/LibraryApplicationPlugin.java`
- `build/icon.ico`
- `docs/auth.md`
- `docs/release-0.3.0.md`
- `electron/adapters/ElectronCasHttpAdapter.ts`
- `electron/ipc.ts`
- `electron/main.ts`
- `electron/preload.ts`
- `package-lock.json`
- `package.json`
- `platforms/android/bridge.ts`
- `platforms/android/core/AndroidCasHttpAdapter.ts`
- `platforms/android/core/AndroidSecureTokenStore.ts`
- `platforms/android/core/index.ts`
- `renderer/index.html`
- `renderer/renderer.ts`
- `renderer/style.css`
- `scripts/build-icon.py`
- `scripts/test-cas-network.mjs`
- `scripts/test-desktop.mjs`
- `src/api/httpClient.ts`
- `src/application/LibraryController.ts`
- `src/application/contracts.ts`
- `src/application/dispatch.ts`
- `src/auth/AuthManager.ts`
- `src/auth/CasTokenProvider.ts`
- `src/auth/Credentials.ts`
- `src/auth/HttpCasSession.ts`
- `src/auth/PersistentCasSession.ts`
- `src/auth/authErrors.ts`
- `src/auth/stores/EncryptedFileCredentialStore.ts`
- `tests/ElectronCasHttpAdapter.test.ts`
- `tests/HttpCasSession.test.ts`
- `tests/SecureTokenStore.test.ts`
- `tests/crossPlatform.test.ts`
- `tests/desktop-host.ts`
- `tests/electron.test.ts`
- `tests/httpClient.test.ts`

## 安装包

- `dist/LibraryReservation-Setup-0.3.0-x64.exe`（111852912 bytes）
  SHA-256: `619a68e633ae85b1809f175d4794fd3376c945f8a6ab5d4d17802fdebe650b5e`
- `dist/LibraryReservation-0.3.0-android-debug.apk`（5711431 bytes）
  SHA-256: `6b55fd7ada6f1105e033a87346af402197db549c1296862cea436ff5db3cf420`
