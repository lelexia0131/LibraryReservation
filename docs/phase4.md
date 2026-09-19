# 第四阶段交付记录

日期：2026-09-19。版本：0.2.0。代码、自动测试与安装包构建已完成；没有 commit，没有向官网发送真实 confirm。真实登录后的查询响应尚未现场验证。桌面集成测试出现窗口初始化超时及用户截图中的 Electron `0x80000003` 原生崩溃，随后按用户要求停止继续打开 App 测试；崩溃根因未定位，不能把桌面运行验收写为通过。

## 24 项报告

| 项目 | 结果 |
| --- | --- |
| 1. 旧通用错误根因 | safeError 只有 messages 已登记的 code 才保留；API_BUSINESS_ERROR、SEAT_CATEGORY_NOT_FOUND、INVALID_TOKEN 等被错误覆盖为 UNEXPECTED_ERROR。现在所有符合安全格式的 BookingError.code 均保留，未登记错误使用安全中文回退；普通 Error 转为 UNEXPECTED_ERROR。原始服务器/异常文本不传 renderer。实际曾触发的接口业务码没有现场响应证据，不能认定当时一定是登录失效。 |
| 2. 修改文件 | 见下方文件清单。旧认证/AES/远程安全 adapter 未改写，安装器脚本未改变。 |
| 3. 空位真实字段 | 已重新读取官网 RoomItem：data.list[].free_num 与 total_num。有效计数直接用于位置发现；缺字段才顺序 Seat/date → Seat/seat 统计。详见 protocol.md 的公开来源。 |
| 4. 自动位置调用链 | renderer.loadLocations → preload.listAvailability → availability:list → DesktopController.listAvailability → services → AvailabilityService.list → areas → BookingApi.fetchReserveIndex → fetchReserveList 串行分页 → 有需要才逐区域 freeSeats → 只返回 freeCount > 0 的 locations，并返回完整业务 scopes。 |
| 5. 座位列表调用链 | renderer.loadSeats → listSeats → availability:seats → DesktopController.listSeats → discovery.resolve → discovery.freeSeats → seats → fetchSeatDate → resolveTargetDateAndSegment → fetchSeatList → 双条件空闲过滤 → 仅座位号与显示时段。 |
| 6. 手动预约调用链 | 点击按钮 → reserveManual → reservation:manual → DesktopController.reserveManual → 重新 resolve 区域 → ReservationService.reserve/submit → discovery.seats 重查日期、时段、座位 → findTargetSeat(no) → validateSeatAvailable → confirmSeat → resultView → renderer.showResult。 |
| 7. confirm authority | main 的 services(signal,true) 才构建 ConfirmationAuthority；只从 reserveManual 和 monitor 的创建路径调用。consume 检查停止状态且只能执行一次；renderer 无开关、凭据或裸提交 IPC。默认 BookingApi/CLI 仍硬锁关闭。 |
| 8. 主馆算法 | 每轮读取 index，精确找到 premises.name === 主馆，给 list 传真实 premisesIds，并再次按返回的 premisesName 精确过滤。按官网区域和座位数组顺序选择首个空闲候选，重新验证后一次提交。 |
| 9. 所有场馆算法 | 每轮按官网分页返回顺序读取全部普通座位区域；逐区域检查计数、读取合法时段及座位，首个确定性候选重新验证后提交。没有并行区域扫描。 |
| 10. 自定义算法 | 共用馆舍→楼层→区域树，勾选项仅保存 premises/floor/area 业务名称。每轮根据 scopes 的并集过滤区域，保持官网顺序，无临时 ID 持久化。包含暂时满座区域，便于等待。 |
| 11. 默认轮询 | 一轮完成后等待 15 秒，主进程最低 10 秒，IPC 不接受 interval 参数。 |
| 12. 429/网络退避 | 429 优先 Retry-After（秒/HTTP 日期），至少 10 秒；否则 30→60→120 秒并封顶。临时网络故障同样退避；桌面 HttpClient 不做旧的亚秒级查询重试。 |
| 13. stop | AbortController 立即撤销候选授权和查询 signal，清除等待 timer/listener，等待当前 flight 收束。停止、logout、切换模式、before-quit 均调用停止。已经发出的 confirm 不强行中断回执，以便保留成功/未知结果，且绝不重发。 |
| 14. 最多一次 confirm | Controller 单个 monitor、foreground 互斥；切换模式先 await stop。ReservationService 有 pending/submitted 守卫；ConfirmationAuthority 一次性 consume；HttpClient confirm 无重试。每个手动动作或整次自动任务最多一次。 |
| 15. confirm unknown | 超时、断网、5xx、畸形/缺失回执均结束任务，显示“预约结果未知，请在图书馆官网确认”，结果区保留打开图书馆按钮。不选下一张座位。未知业务失败同样停止；尚未启用任何未经核实的业务码重试。 |
| 16. 到场时间 | 公开代码证实当前预约的 lastSigninTime 是签到截止提示来源，读取接口为 POST /api/index/subscribe；缺实际响应以可靠关联本次预约，暂不调用并猜测匹配。UI 显示“暂未获取”；不解释 new_time，不做 +15/+30 分钟推算。 |
| 17. UI | 手动选择（日期/时间、位置树、空闲座位网格、选中卡与按钮）；三张从上到下的一键选择卡（主馆/所有场馆/自定义）；预约结果卡。删除旧文本位置/座位输入和测试查询入口。桌面点击及视觉验收本次未完成。 |
| 18. IPC | 固定 10 个 channel，见下方列表。业务参数严格按 allowlist 重建，禁用旧 booking:dry-run renderer 入口；保留内部旧 query 方法供既有回归测试使用。 |
| 19. Electron 边界 | nodeIntegration:false、contextIsolation:true、sandbox:true、safeStorage、trustedSender、main-frame 校验、远程无 preload、官方域名导航限制、远程 confirm 拦截均保留。无通用 request(url)/getToken/confirmRaw IPC。 |
| 20. 自动验证 | npm test：164/164；原 120 项回归保留（IPC 契约更新；旧任意业务错误 fixture 改为非已核实登录失效码），新增 44 项第四阶段测试。npm run typecheck、npm run build、git diff --check 均通过。所有 confirm 使用 synthetic HTTP adapter。 |
| 21. app:dev/桌面测试 | npm run app:dev 未再执行：用户明确表示“不需要进行繁琐的打开app测试”。此前 npm run test:desktop 未完成：等待 preload 超时，并出现原生崩溃截图；停止后确认无残留 electron.exe。测试脚本已更新为第四阶段场景，但不声称 UI 验收通过。 |
| 22. dist | npm run dist 成功，包含 app:build 类型检查和 esbuild。ASAR 内容只含 out、package.json 及生产依赖，不含测试入口、.env、研究 bundle。未启动安装器做额外 GUI 测试。 |
| 23. 安装包 | D:\LibraryReservation\dist\LibraryReservation-Setup-0.2.0-x64.exe，111,596,375 字节，106.43 MiB；SHA-256：E6F282CDC2598616709206F4CD6D6F995619BFC3B4179DC892CED1F82A488F86。 |
| 24. working tree | 起始干净；最终有 22 个修改文件、6 个新文件，均未提交。out/dist/.artifacts 是已忽略生成物。未修改 .git、CAS、safeStorage、AES 或 NSIS 安装脚本。 |

## 修改文件

新增：

- `electron/ConfirmationAuthority.ts`
- `src/domain/AvailabilityService.ts`
- `src/domain/ReservationService.ts`
- `src/domain/AutoSelectMonitor.ts`
- `tests/phase4.test.ts`
- `docs/phase4.md`

修改：

- `src/errors.ts`：安全阶段、可选 HTTP 状态/退避元数据。
- `src/api/bookingApi.ts`：查询阶段及取消 signal，confirm 仍沿用原 AES 和 HttpClient。
- `src/api/httpClient.ts`：已核实的业务登录失效处理，Retry-After，桌面可关闭查询立即重试；原默认行为保留。
- `src/api/types.ts`、`src/api/parsers.ts`：确切 free_num/total_num 字段和列表时间参数。
- `electron/desktopController.ts`、`electron/contracts.ts`、`electron/ipc.ts`、`electron/preload.ts`：授权入口、显示模型、安全错误、输入校验及固定 IPC。
- `electron/main.ts`：退出停止任务、适配新版布局的默认窗口尺寸。
- `renderer/index.html`、`renderer/renderer.ts`、`renderer/style.css`：三个核心区域、共用树、座位网格、状态与结果。
- `tests/electron.test.ts`、`tests/httpClient.test.ts`：保留既有回归并适配新契约/已核实错误语义。
- `tests/desktop-host.ts`、`scripts/test-desktop.mjs`：合成桌面集成场景；本次未完成窗口启动验证。
- `README.md`、`docs/protocol.md`、`docs/desktop.md`：最新使用说明、证据和历史说明。
- `package.json`、`package-lock.json`：版本 0.2.0；依赖版本和安装选项未改变。

## 固定 IPC 与显示数据

```text
auth:get-status / auth:login / auth:logout
booking:open-web
availability:list
availability:seats
reservation:manual
autoselect:start
autoselect:stop
autoselect:status
```

renderer 只显示安全中文消息，不显示错误码；错误 reply 可带安全 code/stage 以供诊断，但不能携带 body、AxiosError、token、Cookie、CAS 或 authorization。位置和座位 reply 不含真实 area ID、seat ID、segment 或密文。主进程只记录固定格式的安全 code/stage。

## A–F 六条实际函数调用链

以下是当前源码中的真实函数调用链；成功/超时等结果由合成测试验证，不表示代理向官网执行了真实预约。

### A. 打开 App → 自动位置 → 展开 → 选座

```text
main.app.whenReady → AuthManager.initialize → mainWindow.loadFile
→ renderer.poll → libraryApp.getAuthStatus → DesktopController.status
→ renderer.showAuth → needsLoad → renderer.loadLocations
→ preload.listAvailability → availability:list → trustedSender
→ DesktopController.listAvailability → services → AvailabilityService.list
→ AvailabilityService.areas → BookingApi.fetchReserveIndex
→ BookingApi.fetchReserveList（串行分页，date/startTime/endTime）
→ free_num/total_num；缺失时 freeSeats → seats → fetchSeatDate → fetchSeatList
→ renderer.renderTree（只展示有空位 locations，完整 scopes 另供自定义）
→ 点击区域：renderer.loadSeats → preload.listSeats → availability:seats
→ DesktopController.listSeats → discovery.resolve → discovery.freeSeats
→ discovery.seats → fetchSeatDate → resolveTargetDateAndSegment → fetchSeatList
→ 空闲双条件过滤 → 座位号网格 → 点击事件保存业务 location/no，高亮选中
```

### B. 选座 → 手动预约 → 重新验证 → 单次提交 → 结果

```text
reserve-button.click → libraryApp.reserveManual
→ reservation:manual → trustedSender → DesktopController.reserveManual
→ objectInput/validatePeriod/validateScope/textInput → foreground/exclusive
→ services(signal,true) → ConfirmationAuthority → BookingApi
→ discovery.resolve（重新解析真实 area）
→ ReservationService.reserve → submit → discovery.seats
→ fetchSeatDate → resolveTargetDateAndSegment → fetchSeatList
→ findTargetSeat（按 no 匹配最新 seat）→ validateSeatAvailable
→ checkStopped → submitted=true → BookingApi.confirmSeat
→ ConfirmationAuthority.consume → prepareConfirm → HttpClient.post('/api/Seat/confirm')（一次）
→ parseBookingResult → resultView → renderer.showResult
```

### C. 主馆一键选择 → 候选 → 预约成功

```text
.start[data-mode=main].click → startAutoSelect → autoselect:start
→ DesktopController.startAutoSelect → exclusive → monitor.stop（收束旧任务）
→ AutoSelectMonitor.start → run → services(signal,true)
→ discovery.areas(period,'主馆') → index.premises.name 精确匹配
→ fetchReserveList(premisesIds) 串行分页 → 按官网顺序逐区域 freeSeats
→ 第一个合法空闲候选 → FOUND → RESERVING
→ ReservationService.reserve → submit → 实时 date/seat 重验 → consume → confirmSeat
→ parseBookingResult.success（严格数值 code===1）→ SUCCESS → run 返回
→ renderer.poll → getAutoSelectStatus → autoStatus → showAuto → showResult
```

### D. 全馆无空位 → 等待 → 下轮空位 → 成功

```text
.start[data-mode=all].click → DesktopController.startAutoSelect → monitor.start → run
→ discovery.areas(period) → 按官网顺序串行 freeSeats → 无候选
→ WAITING → waitForPoll(15000,signal)
→ 下一轮 SCANNING → 重新 index/list/date/seat → 首个空闲候选
→ FOUND → RESERVING → ReservationService.reserve（再次实时重验）
→ ConfirmationAuthority.consume → confirmSeat（一次）→ SUCCESS → 永久结束本次 run
→ autoStatus → renderer.showAuto → showResult
```

### E. 自定义勾选 → 范围等待 → 空位 → 成功

```text
renderer.renderTree(scopes,true) → checkbox.change → scopeChoices（业务名称）
→ .start[data-mode=custom].click → startAutoSelect({period,mode,scopes})
→ validateScope → AutoSelectMonitor.start → run
→ discovery.areas → matchesScope 的并集过滤（馆舍/楼层/区域）
→ 按原官网顺序 freeSeats → 无空位 WAITING → waitForPoll(15000)
→ 下一轮范围内候选 → ReservationService.reserve/submit → 最新 date/seat
→ consume → 单次 confirmSeat → SUCCESS → autoStatus → showAuto → showResult
```

### F. confirm timeout → 停止 → 官网核实

```text
ReservationService.submit → BookingApi.confirmSeat → HttpClient.post('/api/Seat/confirm')
→ transport timeout/断网/5xx → BookingError(CONFIRM_OUTCOME_UNKNOWN,stage=confirm)
→ 不进入 HttpClient 查询重试 → 不进入 monitor 429/网络查询退避
→ AutoSelectMonitor.run 捕获 → FAILED → run 返回，无下一候选、无第二次提交
→ DesktopController.autoStatus → safeError（安全中文）
→ renderer.showAuto → showFailure（“预约结果未知，请在图书馆官网确认。”）
→ result-website.click → openBookingWebsite → booking:open-web
→ DesktopController.openWebsite → BookingWebSessionBootstrap.openBookingWebsite
```

手动超时经过同一 ReservationService/HttpClient 分支，IPC safeError 返回后 renderer.run(..., reservation=true) 调用 showFailure。远程官网窗口仍不能提交 confirm；打开官网用于查看已有预约记录。
