# Android CoreRuntime 真机启动排障（2026-09-20）

本轮针对当前本地 working tree，未提交代码。真机序列号 `3DK0225529030662`，型号 `PLR_AL00`；用户提供的 WebView 为 Huawei 114.0.5.302 / Chromium 114.0.5735.196。

## 真实调用与资产链路

```text
public Capacitor WebView (https://localhost)
  → platforms/android/bridge.ts: window.libraryApp
  → Capacitor LibraryApplication.invoke
  → LibraryApplicationPlugin.invoke
  → CoreRuntime.invoke / pending queue
  → private WebView: TrustedCore.dispatch
  → platforms/android/core/index.ts + nativePort.ts
  → NativeCore.postMessage
  → CoreRuntime WebMessageListener / Port
  → 原生 HTTP、Keystore、CAS browser 等既有服务
```

Android 源码实际位于 `platforms/android/`，不存在 `src/platform/android/`。

`scripts/build-android.mjs` 将 `platforms/android/core/index.ts` 独立打包到 `android/app/src/main/assets/private-core.js`，APK 内为 `assets/private-core.js`，由原生 `AssetManager.open()` 读取。公共文件从 `out/android/` 同步到 `assets/public/`。APK 检查确认私有 bundle 不在公共根目录；MainActivity 的公共资源白名单也不允许请求此文件。

## Root Cause

`CoreRuntime` 构造函数安装的私有 `WebViewClient.shouldInterceptRequest()` 原先对所有请求返回 `LockedWebView.blocked()`（403）。真机的 `loadDataWithBaseURL()` 会将内部内联主文档传输交给这个拦截器，诊断分类确认该请求是 main-frame `DATA`。

因此在 `loadingPrivateDocument → privatePageFinished → ready` 阶段，原生自己提供的 HTML 被 403 替换；私有 JS 未执行，`TrustedCore` 未定义，10 秒后 runtime 被销毁。原始代码还有两个会掩盖诊断的缺陷：使用旧 `addJavascriptInterface`，以及无阶段信息的超时销毁。

基线真机安全诊断：`NativeCore` 存在、`TrustedCore` 不存在、10 秒 `startupTimeout`。更细诊断显示 `privateMainFrameRequestBlocked kind=DATA`，随后 `ORIGIN_MISMATCH`。这些临时探针已移除，保留固定状态码的启动诊断。

原始 base URL 就是合法的 `https://private-core.invalid/`，不是 hostless URL。`AddChannelKeyForSearchEngine url has no host` 不能证明该 base URL 无效：已确认内部传输使用无 hostname 的 data URL，原 history URL 也为 null；没有证据精确区分 Huawei 警告来自内部传输还是 history。真正阻断启动的是无条件拦截主文档，不是 feature 不支持。

## 修复与安全边界

- base URL 固定为 `https://private-core.invalid/`，allowed origin 为 `https://private-core.invalid`，来自同一常量；history URL 同样固定。按 Android API 定义，HTTPS base URL 决定文档 origin，内部 data 传输不作为受信 origin。
- 只放行原生初次加载的一个内联 main-frame data 传输；原子门在消费、页面开始或 runtime 销毁时关闭。子 frame、后续 data、HTTP(S)、file/content 等请求仍被阻断。网络加载仍禁用，所有导航仍拒绝。
- 注册精确 origin 的 `WebMessageListener` 后才加载文档，并再次检查消息的 main-frame 标志及 origin。删除私有 `addJavascriptInterface`，无 legacy fallback。
- 真机 feature gate 返回 true；false 时不会创建私有 WebView，记录固定错误码并关闭 runtime。
- 私有 JS 定义全部 `TrustedCore` handler 后，通过 `NativeCore.postMessage` 主动发送 ready。原生收到后解除等待队列并取消启动计时器；重复或迟到 ready 不会重放调用。
- 缺失或空资产记录 `PRIVATE_CORE_ASSET_MISSING` 并关闭，绝不加载空 HTML。启动探针只返回固定状态枚举；脚本错误不包含异常正文。
- 10 秒无 ready 安全失败，记录最后阶段，释放所有等待调用；普通应用调用返回 `NATIVE_UNAVAILABLE`，手动预约保留 `CONFIRM_OUTCOME_UNKNOWN`。
- Android 三个 bundle 构建目标改为 Chrome 114；这属于兼容性修正，没有将其认定为本次根因。Windows 构建目标未改。
- 新日志仅包含固定阶段、固定 origin、布尔值、受限应用命令和固定错误码。不打印任意 URL、异常正文、请求/响应正文或秘密。Debug 公共调用日志跳过每秒状态轮询。
- 未改 CAS、确认规则、共享 domain、重试、AES、Token schema、Electron IPC 或 Windows secureStorage；未增加远程页面桥，未向公共 renderer 暴露秘密。

参考：[Android loadDataWithBaseURL 的 origin 定义](https://developer.android.com/reference/android/webkit/WebView#loadDataWithBaseURL(java.lang.String,%20java.lang.String,%20java.lang.String,%20java.lang.String,%20java.lang.String))、[AndroidX WebMessageListener](https://developer.android.com/reference/androidx/webkit/WebViewCompat#addWebMessageListener(android.webkit.WebView,java.lang.String,java.util.Set%3Cjava.lang.String%3E,androidx.webkit.WebViewCompat.WebMessageListener))。

## 真机结果与验证范围

修复 APK 已安装运行，捕获到以下阶段（同一 PID 9026）：

```text
16:54:36.339 create
16:54:36.339 WEB_MESSAGE_LISTENER supported=true
16:54:36.344 nativeBridgeRegistered
16:54:36.347 loadingPrivateDocument
16:54:36.484 privatePageStarted origin=https://private-core.invalid
16:54:36.533 nativeCoreMessageReceived type=ready
16:54:36.533 ready
16:54:36.535 privatePageFinished
16:54:36.594 LibraryApplication resolved command=auth:get-status ok=true
16:54:36.595 LibraryApplication resolved command=autoselect:status ok=true
```

约 194 ms 启动成功，超过原 10 秒超时点仍持续处理公共调用。ready 只能来自精确匹配的 HTTPS 主 frame，因此也验证了实际 origin 和 listener 注入。实际 WebView 可先发 ready 再回调 pageFinished，这是正常顺序。

验证包括 `npm test`（187 项）、`npm run typecheck`、`npm run android:build`、`npm run android:sync`、`assembleDebug testDebugUnitTest lintDebug`、`npm run test:mobile-ui`、`git diff --check`。新增 9 项 CoreRuntime 原生测试，涵盖 origin、初始文档传输、注册顺序、ready 队列、超时、不支持 feature、缺失/空资产、origin/frame 隔离、安全错误码；JS 测试覆盖真实 bundle 的握手与公共 bundle 秘密隔离。APK ZIP 内容已核查。

真机验证范围是核心启动与公共 bridge 往返；未代用户完成账号认证或提交真实预约。最终抑制轮询日志、让 lint 可识别现有 feature gate 的调整在本地重新构建验证，避免打断手机上的登录操作。

## 重建与复测

在仓库根目录运行；本机 Gradle 需要 Java 21 / Android SDK：

```powershell
$env:JAVA_HOME = 'D:\AndroidStudio\jbr'
$env:ANDROID_HOME = 'D:\AndroidSDK'
npm run android:build
npm run android:sync
android\gradlew.bat -p android assembleDebug
adb -s 3DK0225529030662 install -r android\app\build\outputs\apk\debug\app-debug.apk

# 手动启动应用后，过滤本应用进程和两个固定日志标签
$appPid = (adb -s 3DK0225529030662 shell pidof cn.libraryreservation.android).Trim()
adb -s 3DK0225529030662 logcat --pid=$appPid 'CoreRuntime:I' 'LibraryApplication:I' '*:S'
```

重新启动进程后应重新取得 PID。点击登录/打开图书馆，确认进入相应流程且无 `startupFailed`/`startupTimeout`；这与账号认证成功是两个不同验证层次。
