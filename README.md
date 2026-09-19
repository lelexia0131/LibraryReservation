# 浙江大学图书馆预约助手

Windows x64 桌面应用。选择日期和时间后自动发现有空位的位置，展开馆舍、楼层和区域，点击空闲座位手动预约；也支持主馆、所有场馆、自定义范围三种一键选择。无空位时每 15 秒继续查询，可随时停止。

第四阶段允许用户在 App 中主动预约。所有自动化测试的预约请求只发送到内存 synthetic adapter，从未向官网提交真实预约。桌面启动测试曾出现 Electron 原生崩溃，按用户要求停止继续打开 App 测试；不能将安装包构建成功视为桌面运行验收通过。详见 [第四阶段交付记录](docs/phase4.md)。

## 安装与使用

安装包：`dist/LibraryReservation-Setup-0.2.0-x64.exe`。中文安装向导保留选择安装目录、可选桌面快捷方式及开始菜单入口；安装后无需 Node/npm。

1. 打开应用，等待登录检查；需要时点击“登录”，亲自完成官方认证。
2. 选择日期及时间，位置列表自动加载；“刷新位置”强制刷新。默认只列出有空位的位置。
3. 展开馆舍和楼层，点击区域查看空闲座位，点击座位后出现“预约该座位”。显示的是官网可用时段；最终提交使用完整时段，不是任意自定义起止时间。
4. 点击预约后重新读取时段及座位状态，最多提交一次。结果卡显示成功或失败、座位、位置及预约时间。
5. 一键选择按官网顺序寻找候选，使用前述同一验证和提交流程。自定义范围可勾选馆舍、楼层或区域，包括当前没有空位的位置。
6. 没有空位时持续等待；停止、退出登录、关闭应用或切换模式会停止当前任务。提交已发出时会等待其结果，不会为停止而重发或改约。
7. 出现“预约结果未知”时打开图书馆核实，不能假定预约失败。到场时间目前显示“暂未获取”，不从预约开始时间推算。

## 从源码运行与打包

开发环境：Node.js 24+、Windows x64。

```powershell
npm ci
npm run app:dev
```

```powershell
npm test
npm run typecheck
npm run build
npm run app:build
npm run dist
```

`npm run test:desktop` 是可选的真实 Electron 集成测试，使用独立测试用户目录、系统加密和合成接口；不使用用户的真实登录数据，也不调用真实官网预约接口。本次运行在窗口初始化时未完成，已停止，不再重复启动测试。

`out/` 是桌面构建，`dist/` 是 NSIS 安装包和 `win-unpacked/`。安装包不含测试入口、源码、`.env` 或研究用官网 bundle。

## 结构与安全边界

- `src/domain/AvailabilityService.ts`：普通座位分类、串行分页、空位统计及实时座位读取；不向 BookingService 塞发现逻辑。
- `src/domain/ReservationService.ts`：根据座位编号实时重查、检查空闲状态、一次提交，结果不明时停止。
- `src/domain/AutoSelectMonitor.ts`：串行状态机、15 秒等待、429/网络退避、停止清理。
- `electron/ConfirmationAuthority.ts`：主进程创建的一次性提交权限，仅手动预约和启动一键选择入口创建。
- `electron/desktopController.ts`：输入 allowlist、显示数据投影、10 秒位置缓存和安全中文错误。
- `src/api/`：保留现有 HttpClient、解析器、AES 提交；增加安全 stage、HTTP 状态和 Retry-After 元数据。
- `src/auth/`、`src/crypto/`、远程窗口和 safeStorage 架构保持不变。

固定 IPC：`auth:get-status`、`auth:login`、`auth:logout`、`booking:open-web`、`availability:list`、`availability:seats`、`reservation:manual`、`autoselect:start`、`autoselect:stop`、`autoselect:status`。renderer 得到业务名称、座位号、状态和安全提示，不接收 token、cookie、CAS、authorization、seat_id、segment 或密文。

本地窗口继续使用 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、主窗口和主 frame 校验、严格 CSP。远程窗口无 preload、限制官方域名导航，继续拦截远程页面的 `/api/Seat/confirm`。App 的真实提交只能经过主进程 Node HttpClient。

## 协议与请求控制

- 官网 `RoomItem` 直接显示区域列表中的 `free_num` / `total_num`。列表请求包含所选日期及开始、结束时间，空位数有效时不扫描所有区域的座位。
- 缺少成对有效计数时，逐区域串行 `Seat/date → Seat/seat`，统计 `status === "1" && status_name === "空闲"`；开放时段不可用的区域计为零。
- 展开区域和提交前都读取最新时段。座位查询使用官网组件相同的完整 segment 时间；不在界面保存或展示临时标识。
- 自动任务每轮完成后默认等 15 秒；主进程硬性最低 10 秒，renderer 无间隔控制参数。
- 429 优先遵守 Retry-After（秒或 HTTP 日期，最低 10 秒）；否则依次 30、60、120 秒退避，上限 120 秒。临时网络故障同样退避；自动任务禁用 HttpClient 原来的 500/1000ms 立即重试。
- 一次任务最多一次 confirm。当前没有核实可安全自动重试的 confirm 业务码，因此所有非成功业务返回均停止；提交前发现座位被占可以等待下一轮。
- confirm 超时、断网、5xx 或无法解析回执均为结果未知，停止且不重发。成功立即停止。
- 官网登录失效业务码 `10001` 与 HTTP 401 都清除失效凭据，不重放请求。
- 主进程错误日志仅为 `[Desktop] operation failed code=... stage=...`。不记录请求或响应 body、异常对象及凭据。

字段依据、公开资源链接与尚待核实项见 [协议核验记录](docs/protocol.md)。历史 [认证说明](docs/auth.md) 和 [第三阶段记录](docs/desktop.md) 保留。

## Developer / CLI

CLI 保持原架构和默认禁止真实预约的硬锁，不接受桌面提交权限。开发配置：

```powershell
Copy-Item .env.example .env
npm run booking:dry
```

`.env` 配置 `TARGET_DATE`、`TARGET_SEAT`、可选 `TARGET_BUILDING/TARGET_FLOOR/TARGET_AREA` 和 `TARGET_START_TIME/TARGET_END_TIME`。CLI 的按名称唯一匹配功能保留；桌面不再要求手填这些字段。

`AUTH_MODE=env` 从进程环境读取 `BOOKING_TOKEN` 原始 token；不要把它写入文件或命令历史。`DRY_RUN=true` 为默认值，`--dry-run` 优先；即便 `DRY_RUN=false` 或 `--execute`，默认 API 策略仍以 `REAL_CONFIRM_DISABLED` 阻止真实提交。测试专用 HTTP adapter 不进入安装包。

认证通过 HttpClient 统一注入 `authorization: "bearer" + rawToken` 到 header/body。8 秒超时，不跟随重定向。CLI 普通查询仍保留原有有限重试；confirm 始终不重试。

AES 仍使用 Node crypto 的 AES-128-CBC/PKCS7，key 为当前本地日期 `YYYYMMDD + reverse(YYYYMMDD)`，IV 为 16 字节 `ZZWBKJ_ZHIHUAWEI`。业务明文仅 seat_id、segment。预约日期与加密当日日期分离，密文在提交时生成。

本次不执行 commit。
