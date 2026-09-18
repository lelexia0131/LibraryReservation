# 第三阶段：Windows 桌面应用交付记录

验证日期：2026-09-18。仅查询，不提交预约。

## 交付物与安装

- 安装包：`D:\LibraryReservation\dist\LibraryReservation-Setup-0.1.0-x64.exe`。
- 最终大小：111,590,952 字节（106.42 MiB）；SHA-256：`AC9145B24F2B3B8B6D8F42810782CEA0AA17349A39FDFA1A18075487D5171FB8`。
- Electron 44.4.2；electron-builder 26.15.3；目标 Windows x64 / NSIS。
- 安装向导 `oneClick: false`，允许选择目录，创建开始菜单入口。
- `createDesktopShortcut: true` 保留在 builder 配置；`build/installer.nsh` 禁用 builder 的无条件桌面快捷方式逻辑，增加中文“创建桌面快捷方式”复选页。默认不勾选，只有明确勾选才创建。卸载保留 builder 的对应清理逻辑。
- 安装包内含 Electron 运行时、ASAR 应用和运行依赖，应用只加载包内资源，不读取 `.env`，不要求系统 Node.js 或 npm。
- 已检查实际 ASAR 内容：包含构建后的主进程、preload、界面和图标，不包含源码目录、测试入口或 `.env`。
- 安装包尚未配置发布者签名；builder 的 signing 日志不代表已有受信任发布者证书。

用户反馈：“安装包没问题了”。本次启动过安装向导，但在进一步进行逐项安装操作前，用户按 Esc 停止 Computer Use，因此没有将目录选择、勾选／不勾选两种安装结果及安装后启动记为代理亲自实测通过。安装选项实现已完成；用户整体反馈与代理逐项实测在此区分记录。

## 文件与接口

| 文件 | 作用 |
| --- | --- |
| `electron/main.ts` → `out/main.cjs` | 应用入口、单实例窗口、单例认证对象、启动静默恢复 |
| `electron/preload.ts` → `out/preload.cjs` | 五个固定方法，无原始 IPC、凭据、文件或 shell 访问 |
| `electron/contracts.ts` | 登录状态、表单和安全查询结果类型 |
| `electron/ipc.ts` | 五个通道及精确 sender / mainFrame / 本地文件 URL 校验 |
| `electron/desktopController.ts` | 主进程表单校验、操作互斥、强制 dry-run、中文错误映射 |
| `electron/adapters/ElectronCredentialCipher.ts` | 系统 safeStorage 封装 |
| `electron/adapters/ElectronCasBrowserAdapter.ts` | 官方认证窗口、导航截获、共享浏览器会话及请求拦截 |
| `electron/adapters/ElectronBookingWebBrowserAdapter.ts` | 内嵌官网窗口供现有 bootstrap 使用 |
| `electron/adapters/navigationPolicy.ts` | 官方域名限制、旧 HTTP 跳转升级、远程提交拦截 |
| `renderer/index.html`, `style.css`, `renderer.ts` | 中文界面、表单、登录／查询／异常反馈、响应式布局 |
| `src/config/runtimePolicy.ts`, `src/api/bookingApi.ts` | 固定关闭真实确认，API 发送前检查 |
| `scripts/build-app.mjs`, `scripts/app-dev.mjs` | 简单 esbuild 构建及桌面启动 |
| `build/installer.nsh`, `build/icon.ico`, `package.json` | 安装选项、应用图标、NSIS 打包 |
| `tests/electron.test.ts`, `tests/desktop-host.ts`, `scripts/test-desktop.mjs` | 边界单测和真实 Electron 集成验收 |
| `scripts/smoke-app.mjs` | 正式入口与官方认证页冒烟测试，不输入任何凭据 |

另修改 `.gitignore`、`package-lock.json`、`tests/fixtures.ts`、`README.md`，增加 `tsconfig.electron.json`。核心认证、解析、加密及 BookingService 不重写。

Preload 仅暴露 `getAuthStatus()`、`login()`、`logout()`、`openBookingWebsite()`、`runDryBooking(input)`。五个对应通道为 `auth:get-status`、`auth:login`、`auth:logout`、`booking:open-web`、`booking:dry-run`。登录状态只返回 `state`。查询只返回 `available/seat/area/day/startTime/endTime`，不返回内部编号、密文或认证信息。

## 认证与安全边界

主窗口只加载本地 HTML；所有窗口使用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。远程窗口不装载 preload，不可访问应用接口。主界面 CSP 禁止远程脚本与联网，且阻止弹窗、页面跳出和 webview。拒绝窗口权限和远程下载。

应用生命周期只有一个 AuthManager。`app.whenReady()` 后执行 `initialize()`：读取加密缓存并检查有效期，必要时打开隐藏认证窗口尝试静默恢复。约 8 秒后仍在登录页时显示未登录状态，不强制弹窗。点击登录调用 `getToken()`，用户亲自完成官方认证。

加密存储位置为 `app.getPath('userData')/auth/token.bin`，通常是 `%APPDATA%\LibraryReservation\auth\token.bin`。`ElectronCredentialCipher` 直接调用 Electron safeStorage，Windows 下由系统 DPAPI 保护；加密不可用时拒绝明文降级。专用浏览器分区为 `persist:zju-booking-auth`。

认证窗口监听 `will-redirect`、`will-navigate`、`did-navigate`、`did-navigate-in-page`，仅上报主框架。复用 `extractCasFromUrl()`；可取消的导航阶段先 `preventDefault()` 再通知 PersistentCasSession。后者自身保证只消费一次。补充会话级请求拦截，取消 Chromium 的 `/api/cas/user` 请求，防止同页 hash 导航或后备事件发生得较晚时官方页面抢先交换。唯一交换方是主进程 CasTokenProvider，经 Node HttpClient 调用接口。

实际官网首次跳转到 `http://zjuam.zju.edu.cn:80/cas/login`。宿主仅将已知官方域名的标准 HTTP 地址升级为 HTTPS，不允许 HTTP 页面加载，也不放开任意域名或跳过证书校验。

打开官网通过 BookingWebSessionBootstrap 获取登录状态，新建相同专用分区的安全窗口。在确认官网 origin 后通过隔离世界写入官网自己的 sessionStorage，再至多刷新一次。凭据只进入官方页面必需的会话存储，不进入本地主界面。退出调用 `AuthManager.logout()`，清除加密文件、关闭专用分区窗口、清除 Cookie／站点数据／缓存及连接。

## 为什么无法发送真实预约

1. 界面没有真实预约按钮，表单和 IPC 类型没有 dryRun 字段。
2. 主进程拒绝多余输入字段，自行组装 `dryRun: true`。
3. 查询期间前端禁用操作，主进程另有互斥锁；失败后释放，允许重试。
4. `REAL_CONFIRM_ENABLED = false` 固定在生产源码；BookingApi 默认在真正发送前抛出 `REAL_CONFIRM_DISABLED`。CLI `--execute` 同样受保护。测试替代策略只在合成 HTTP 夹具使用，不进入安装包。
5. 内嵌官网的 `/api/Seat/confirm` 请求在 Chromium 会话层取消，包括大小写、编码和尾部斜杠变体。

程序不保存密码、不自动填写密码、不绕过验证码。错误经固定中文映射输出，不转发 AxiosError、请求头、原始响应或堆栈。未发现应用主界面的凭据泄漏；没有采集真实账号凭据。

## 验证记录与范围

- 初始原有 107 项测试全部通过；原测试保留，模拟 confirm 的夹具改为显式注入测试策略。
- 最终 `npm test`：120/120 通过；`npm run typecheck`、`npm run build`、`git diff --check` 均通过。
- 实际运行 `npm run app:dev`，真实主窗口成功出现，并人工查看布局。
- 实际运行 `npm run dist`，成功生成 NSIS x64 安装包。
- `npm run test:desktop` 通过：真实 Electron sandbox、隔离 preload、固定 IPC、系统加密落盘、新 AuthManager 恢复、表单校验、加载状态及禁用、空闲／不可用结果、760×600 布局、退出清理、零确认请求。认证与查询的外部响应是合成数据，测试入口不在发布包内。
- `node scripts/smoke-app.mjs` 通过：正式 main 入口、可见主窗口、启动静默检查最终显示“未登录”、点击登录后显示官方 HTTPS 认证页。没有填写账号密码。
- 完整真实账号登录、重启后真实登录恢复、带真实身份打开官网及实际目标座位查询仍待用户手动验收，不能用模拟测试冒充完成。
- 用户已确认安装包没有问题；后续桌面操作由用户按 Esc 停止，未继续控制窗口。
- 所有修改留在 working tree，没有 commit。

## 从双击应用到完成查询的实际函数调用链

```text
LibraryReservation.exe
→ Electron 加载 app.asar / out/main.cjs
→ app.whenReady()
→ RemoteWindowHost / ElectronCredentialCipher / EncryptedFileTokenStore
→ PersistentCasSession(ElectronCasBrowserAdapter)
→ CasTokenProvider → 单例 AuthManager
→ BrowserWindow.loadFile(out/renderer/index.html)
→ preload.contextBridge.exposeInMainWorld('libraryApp', 五个固定方法)
→ AuthManager.initialize()
  → EncryptedFileTokenStore.get() → safeStorage.decryptString()
  → TokenValidator.isUsable() → AUTHENTICATED
  或 → PersistentCasSession.authenticate() → 隐藏官网认证窗口
       → 静默成功 / LOGIN_REQUIRED

用户点击“登录”
→ libraryApp.login() → auth:login
→ trustedSender() → DesktopController.login()
→ AuthManager.getToken() → PersistentCasSession.authenticate()
→ ElectronCasBrowserAdapter / 官方认证页面
→ 用户亲自完成认证
→ 导航截获并停止回调页面 → extractCasFromUrl()
→ CasTokenProvider → exchangeCasForBookingToken()
→ HttpClient.post('/api/cas/user')（仅此一方交换）
→ EncryptedFileTokenStore.set() → safeStorage.encryptString()
→ AUTHENTICATED → 关闭认证窗口 → 只向主界面返回状态

用户填写条件、点击“测试查询”
→ renderer 表单校验 → libraryApp.runDryBooking(input)
→ booking:dry-run → trustedSender() → validateForm()
→ DesktopController.query() → 主进程互斥锁
→ 新 BookingService(同一个 AuthManager).runBooking({ ...校验后的条件, dryRun: true })
→ AuthManager.getToken() → ensureToken()
→ BookingApi.fetchReserveIndex() → /reserve/index/index
→ resolveTargetArea() → fetchReserveList() → /reserve/index/list（串行分页）
→ fetchSeatDate() → /api/Seat/date
→ resolveTargetDateAndSegment()
→ fetchSeatList() → /api/Seat/seat
→ findTargetSeat() → validateSeatAvailable()
→ 空闲：prepareConfirm() 仅在内存生成加密参数 → 返回计划
  不可用：捕获 TARGET_SEAT_UNAVAILABLE → 返回不可用状态
→ DesktopController 只保留展示字段
→ IPC Reply → renderer.showResult()
→ 显示座位、区域、日期时间、空闲／不可用
→ “仅测试查询，未提交预约”
→ 不调用 confirmSeat，不发送 /api/Seat/confirm
```

实现参考：[Electron WebRequest](https://www.electronjs.org/docs/latest/api/web-request/)、[electron-builder NSIS](https://www.electron.build/v26/docs/nsis/)。安装脚本同时对照本项目已安装版本的 NSIS 模板实现。
