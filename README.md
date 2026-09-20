# 浙江大学图书馆预约助手

浙江大学图书馆预约辅助客户端，提供 **Windows x64 Electron 桌面端** 与 **Android Capacitor 客户端**。

两端复用同一套 TypeScript 应用核心、业务规则和 UI，仅在窗口、认证宿主、安全存储和网络传输等平台能力上使用不同适配器。

主要功能：

* 浙江大学统一身份认证登录
* 自动加载馆舍、楼层与区域
* 查询指定日期和时间范围内的空闲座位
* 点击空闲座位进行手动预约
* 主馆、全部场馆、自定义范围三种自动选座模式
* 无空位时每 15 秒继续查询
* 429 / 网络异常退避
* 预约提交前重新读取实时座位状态和开放时段
* 单次任务最多提交一次预约
* 对超时、断网、5xx、坏回执等结果未知情况禁止自动重试

Android 第一阶段已经完成真机验证，包括应用启动、公共 UI 与私有核心通信、CAS 登录、业务桥及基础功能流程。

---

## 使用说明

启动应用后：

1. 点击“登录”，由用户本人完成浙江大学统一身份认证。
2. 选择预约日期、开始时间和结束时间。
3. 应用自动加载当前有空位的位置。
4. 展开馆舍、楼层和区域，查看空闲座位。
5. 点击座位后选择“预约该座位”。
6. 提交前应用会重新读取该区域的开放时段和座位实时状态。
7. 确认仍然可预约后，最多提交一次预约请求。

也可以使用：

* 主馆一键选择
* 全部场馆一键选择
* 自定义范围一键选择

如果当前没有空位，自动模式默认每 **15 秒**重新查询一次。

用户可以随时停止任务。

---

## 预约安全规则

真实预约不会直接使用界面中缓存的临时标识。

手动预约或自动选座发现候选后，系统会重新执行：

```text
座位编号
   ↓
重新定位实时区域
   ↓
重新读取开放时段
   ↓
重新获取实时 seat_id
   ↓
重新获取实时 segment
   ↓
重新确认座位为空闲
   ↓
ConfirmationAuthority
   ↓
提交一次 confirm
```

一次预约权限最多只能消费一次。

已经发送的 `/api/Seat/confirm` **不会自动重试**。

以下情况统一视为：

```text
CONFIRM_OUTCOME_UNKNOWN
```

包括：

* 网络断开
* 请求超时
* HTTP 5xx
* 无法解析服务器回执
* 原生桥在提交后异常

出现：

> 预约结果未知，请在图书馆官网确认。

时，应先打开官网检查实际预约记录，不能直接假定预约失败并再次提交。

---

# Windows

Windows 版本基于：

```text
Electron
TypeScript
Axios
```

当前安装包：

```text
dist/LibraryReservation-Setup-0.2.0-x64.exe
```

Electron 端主要负责：

* BrowserWindow
* preload
* 固定 IPC
* safeStorage
* CAS BrowserWindow
* Electron session
* 生命周期管理

业务逻辑不属于 Electron 层。

实际调用链：

```text
renderer
   ↓
preload
   ↓
固定 IPC
   ↓
LibraryController
   ↓
domain
   ↓
BookingApi
   ↓
HttpClient
   ↓
AxiosTransport
```

主窗口保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

IPC 同时验证主窗口和主 frame。

---

# Android

Android 版本基于：

```text
Capacitor
Android WebView
Java
OkHttp
Android Keystore
```

最低：

```text
Android API 24
```

构建环境：

```text
JDK 21
Android SDK 36
```

Debug APK：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

当前 APK 为开发测试包，不是正式发行签名包。

---

## Android 运行架构

Android 不在普通 UI JavaScript 环境中运行 `LibraryController`。

实际结构：

```text
public Capacitor WebView
        │
        │ LibraryApplication.invoke
        ▼
LibraryApplicationPlugin
        │
        ▼
CoreRuntime
        │
        ▼
private offline WebView
        │
        ├─ LibraryController
        ├─ AuthManager
        ├─ AvailabilityService
        ├─ ReservationService
        ├─ AutoSelectMonitor
        ├─ BookingApi
        └─ HttpClient
        │
        ▼
NativeCore
        │
        ├─ OkHttp
        ├─ Android Keystore
        └─ CAS WebView
```

公共 UI 和私有核心完全分离。

---

## Android 私有 CoreRuntime

共享应用核心打包为：

```text
android/app/src/main/assets/private-core.js
```

它不会进入：

```text
out/android/
```

也不会进入：

```text
assets/public/
```

公共 UI 无法直接请求该文件。

原生 `CoreRuntime` 从 APK assets 读取 bundle，并在独立的离线 WebView 中执行。

私有 WebView 使用固定 origin：

```text
https://private-core.invalid
```

NativeCore 仅通过精确匹配该 HTTPS origin 且来自主 frame 的：

```text
WebMessageListener
```

注入。

没有：

```text
addJavascriptInterface
legacy fallback
跨 frame 通用 bridge
```

如果设备不支持受限的 `WEB_MESSAGE_LISTENER`，CoreRuntime 会直接安全失败，不降低安全边界。

---

## Android CoreRuntime 真机修复

真机测试期间曾发现私有核心无法启动。

根因是：

```text
CoreRuntime.shouldInterceptRequest()
```

最初会阻断所有请求。

部分 Android WebView 实现中：

```text
loadDataWithBaseURL()
```

的内联主文档会通过内部 `data:` transport 进入该拦截器，因此私有 HTML 被 403 替换，最终导致：

```text
TrustedCore 未创建
→ 没有 ready
→ 10 秒 startup timeout
```

当前实现只允许：

```text
一次
初始
main-frame
data:
```

内部文档传输通过。

随后门立即关闭。

以下内容仍全部阻断：

```text
后续 data:
sub-frame
http:
https:
file:
content:
远程网络请求
```

真机修复后启动链：

```text
create
↓
WEB_MESSAGE_LISTENER supported=true
↓
nativeBridgeRegistered
↓
loadingPrivateDocument
↓
privatePageStarted
↓
NativeCore ready
↓
CoreRuntime ready
↓
公共应用调用正常处理
```

真机 CoreRuntime 启动约 200 ms。

---

## Android 公共 UI 安全边界

Capacitor UI 仅允许固定资源：

```text
/
index.html
style.css
renderer.js
android-bridge.js
```

其他请求全部阻断。

同时禁用：

```text
file:
content:
远程 URL
下载
popup
权限申请
Capacitor HTTP JavaScript interface
Capacitor Cookie JavaScript interface
通用 androidBridge
```

公共 WebView 唯一业务入口是：

```text
LibraryApplication.invoke
```

并且只接受固定的应用命令。

---

## Android 原生命令

当前公共层只允许：

```text
auth:get-status
auth:login
auth:logout
booking:open-web
availability:list
availability:seats
reservation:manual
autoselect:start
autoselect:stop
autoselect:status
```

共享 `LibraryController` 会再次验证具体输入字段。

---

# 认证

认证链：

```text
booking.lib.zju.edu.cn/api/cas/cas
        ↓
zjuam.zju.edu.cn/cas/login
        ↓
用户完成统一身份认证
        ↓
callback 携带 cas
        ↓
客户端拦截 callback
        ↓
/api/cas/user
        ↓
booking token
```

CAS credential：

* 不保存
* 不写日志
* 不发送给 renderer
* 只在认证交换过程中短暂存在

---

## Windows Token 存储

Windows 使用：

```text
Electron safeStorage
+
EncryptedFileTokenStore
```

原有文件位置和格式保持兼容。

---

## Android Token 存储

Android 使用：

```text
AndroidKeyStore
AES-256-GCM
随机 IV
AtomicFile
noBackupFilesDir
```

只保存：

```text
token
savedAt
expiresAt
```

不保存：

```text
profile
member response
CAS credential
cookie
完整请求
完整响应
```

Android Manifest 同时关闭应用数据备份。

不存在明文 fallback。

---

# API 架构

共享 API：

```text
BookingApi
   ↓
HttpClient
   ↓
HttpTransport
```

Windows：

```text
AxiosTransport
```

Android：

```text
AndroidHttpTransport
↓
OkHttp
```

业务层不知道实际运行平台。

---

## Android HTTP

Android 原生请求固定发送到：

```text
https://booking.lib.zju.edu.cn
```

仅允许当前业务需要的固定 API path。

OkHttp 配置：

```text
retryOnConnectionFailure(false)
followRedirects(false)
followSslRedirects(false)
CookieJar.NO_COOKIES
8 秒 timeout
```

所有 POST body 均为：

```text
isOneShot() = true
```

用于阻止 OkHttp 在 HTTP follow-up 情况下自动重放请求。

原生测试覆盖：

```text
503
408
307
401
429
连接中断
响应丢失
timeout
```

确认请求均不会自动再次发送。

---

# AES

预约参数加密使用：

```text
AES-128-CBC
PKCS7
```

Key：

```text
YYYYMMDD + reverse(YYYYMMDD)
```

IV：

```text
ZZWBKJ_ZHIHUAWEI
```

业务明文仅包含：

```text
seat_id
segment
```

当前实现使用跨平台 `CryptoJS`。

测试通过固定 Base64 输出和原 Node AES oracle 验证 Windows / Android 字节级兼容。

---

# 共享代码结构

主要目录：

```text
LibraryReservation/
│
├─ android/                  # Android Studio / Capacitor 工程
│
├─ electron/                 # Electron 平台适配
│
├─ platforms/
│  └─ android/
│     ├─ bridge.ts           # 公共 UI bridge
│     └─ core/               # 私有 Android TS 核心入口
│
├─ renderer/                 # Windows / Android 共用 UI
│
├─ src/
│  ├─ application/
│  │  ├─ contracts.ts
│  │  ├─ ConfirmationAuthority.ts
│  │  └─ LibraryController.ts
│  │
│  ├─ api/
│  ├─ auth/
│  ├─ config/
│  ├─ crypto/
│  ├─ domain/
│  └─ platform/
│     └─ node/
│
├─ scripts/
├─ tests/
├─ docs/
├─ out/
└─ dist/
```

---

# Shared Application

```text
src/application/
```

负责：

* 跨平台应用协议
* 输入 allowlist
* 安全结果投影
* 安全错误投影
* 10 秒位置缓存
* 单操作互斥
* AbortSignal
* 生命周期暂停
* ConfirmationAuthority
* 手动预约入口
* 自动选座入口

Windows 与 Android 共用唯一的：

```text
LibraryController
```

---

# Shared Domain

```text
src/domain/
```

仍然只有一套业务规则。

主要包括：

### AvailabilityService

负责：

* 馆舍发现
* 楼层/区域发现
* 串行分页
* 空位统计
* 实时座位读取

### ReservationService

负责：

* 重新解析区域
* 重新获取实时 seat_id
* 重新获取 segment
* 检查座位状态
* 单次提交

### AutoSelectMonitor

负责：

```text
SCANNING
WAITING
FOUND
RESERVING
SUCCESS
FAILED
STOPPED
```

默认查询间隔：

```text
15 秒
```

硬性最低：

```text
10 秒
```

429 优先使用：

```text
Retry-After
```

否则使用：

```text
30 秒
60 秒
120 秒
```

退避。

---

# Android 生命周期

Android 第一阶段只支持前台自动查询。

应用进入后台：

```text
MainActivity.onStop
↓
suspend
↓
取消未提交操作
↓
停止 AutoSelectMonitor
```

重新进入前台：

```text
onResume
↓
解除 suspend
```

不会自动重新启动之前的自动任务。

已经实际发送的 confirm：

```text
不会主动撤销
不会重放
等待服务器回执
```

当前没有实现：

```text
Foreground Service
后台持续轮询
开机启动
系统通知
AlarmManager 自动任务
```

---

# Android“打开图书馆”

Windows 会通过受控 Electron 窗口打开官网。

Android 则直接使用系统浏览器打开：

```text
https://booking.lib.zju.edu.cn/h5/index.html
```

应用不会向系统浏览器传递 booking token。

因此系统浏览器可能需要单独登录。

---

# 开发环境

## Node

```text
Node.js 24+
```

安装：

```powershell
npm ci
```

---

## Windows 开发

```powershell
npm run app:dev
```

构建：

```powershell
npm run app:build
```

生成安装包：

```powershell
npm run dist
```

---

## Android 开发

要求：

```text
JDK 21
Android SDK 36
Android Studio
```

构建 Web + private core：

```powershell
npm run android:build
```

同步 Capacitor：

```powershell
npm run android:sync
```

打开 Android Studio：

```powershell
npm run android:open
```

直接运行：

```powershell
npm run android:run
```

原生构建：

```powershell
android\gradlew.bat -p android assembleDebug
```

APK：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

---

# 真机安装

查看设备：

```powershell
adb devices
```

指定设备安装：

```powershell
adb -s <DEVICE_SERIAL> install -r android\app\build\outputs\apk\debug\app-debug.apk
```

---

# 测试

完整 TypeScript / Node 测试：

```powershell
npm test
```

类型检查：

```powershell
npm run typecheck
```

共享编译：

```powershell
npm run build
```

Electron：

```powershell
npm run app:build
npm run dist
```

Android：

```powershell
npm run android:sync
android\gradlew.bat -p android assembleDebug testDebugUnitTest lintDebug
```

移动 UI：

```powershell
npm run test:mobile-ui
```

代码格式检查：

```powershell
git diff --check
```

---

# 当前验证状态

截至 2026-09-20：

```text
Windows build                     ✅
Windows NSIS                      ✅

Android build                     ✅
Android Gradle assembleDebug      ✅
Android JVM unit tests            ✅
Android lint                      ✅
Android mobile UI tests           ✅

Android 真机启动                  ✅
公共 Capacitor WebView            ✅
LibraryApplication bridge        ✅
Private CoreRuntime              ✅
NativeCore ready handshake       ✅
CAS 登录流程                      ✅
Android 基础业务流程              ✅
```

Android 真机测试设备：

```text
Huawei PLR_AL00
Huawei WebView 114.0.5.302
Chromium 114.0.5735.196
```

CoreRuntime 真机问题已经修复并重新验证。

---

# 当前尚未实现

Android 第一阶段不包含：

```text
Foreground Service
后台持续轮询
开机启动
通知
AlarmManager
正式 release 签名
release AAB / APK
Google Play 发布流程
```

当前：

```text
app-debug.apk
```

仅用于开发和真机测试。

---

# 安全边界

renderer 无论 Windows 还是 Android，都不能访问：

```text
token
CAS credential
cookie
authorization
seat_id
segment
aesjson
ConfirmationAuthority
```

它只能获得：

```text
PublicAuthStatus
馆舍/楼层/区域名称
座位编号
安全提示
预约结果视图
自动任务状态
```

真实敏感数据始终停留在：

```text
Electron trusted process
或
Android private CoreRuntime / native layer
```

中。

---

# 相关文档

详细设计见：

```text
docs/android-port.md
docs/auth.md
docs/desktop.md
docs/phase4.md
docs/protocol.md
```

其中：

* `android-port.md`：Android 跨平台架构、CoreRuntime 和原生适配
* `auth.md`：认证设计
* `desktop.md`：Electron 桌面端设计
* `phase4.md`：真实预约阶段说明
* `protocol.md`：官网协议和字段核验记录

---

## 说明

本项目只提供预约辅助能力。

登录由用户本人通过浙江大学官方统一身份认证完成。

真实预约必须由用户主动选择或明确启动自动选座流程。

应用不会绕过官方认证、验证码或访问控制，也不会对结果未知的预约请求进行自动重复提交。
