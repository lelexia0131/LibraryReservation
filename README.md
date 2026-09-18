# 浙江大学图书馆预约助手

Windows x64 桌面应用：在官方浙江大学认证窗口登录，安全保存登录状态，填写日期、馆舍、楼层、区域、座位号与时间，查询座位是否空闲。

**当前 Desktop App 是仅支持 dry-run 查询的测试版本，不会发送真实预约。** 主界面只显示用户需要的状态和结果；内嵌官网同样拦截预约提交。不会保存账号密码、自动填密码或处理验证码。

## 安装与使用

双击 `dist/LibraryReservation-Setup-0.1.0-x64.exe`。中文安装向导允许选择安装目录；“创建桌面快捷方式”是独立复选项，默认不勾选；安装器始终创建开始菜单入口。安装后直接启动，不需要 Node.js、npm、源码或 `.env`。

1. 打开应用，等待登录检查。没有可恢复的登录状态时点击“登录”。
2. 在官方浙江大学页面亲自完成认证，成功后窗口关闭，主界面显示“已登录”。
3. 填写日期、完整座位号和时间。馆舍、楼层、区域使用官网的完整名称；出现多个匹配区域时补全筛选条件。
4. 点击“测试查询”，查看空闲／不可用结果。结果下始终显示“仅测试查询，未提交预约”。
5. 再次启动会尝试恢复登录；“退出”清除本地加密登录状态及专用浏览器会话。

界面、认证架构、安装器实现、验证范围及完整调用链见 [第三阶段交付报告](docs/desktop.md)。官网字段依据见 [协议核验记录](docs/protocol.md)。第二阶段的历史记录见 [持久认证说明](docs/auth.md)。

## 从源码运行与打包

开发环境需要 Node.js 24 或以上，Windows x64：

```powershell
npm ci
npm run app:dev
```

`npm ci` 的项目安装脚本会准备 Electron 运行时。应用不需要 `.env`。

```powershell
npm test
npm run typecheck
npm run build
npm run test:desktop
npm run dist
```

`app:build` 将主进程、隔离 preload、原生 HTML/CSS/TypeScript 界面构建到 `out/`。`dist` 使用 electron-builder + NSIS 生成独立安装包和 `dist/win-unpacked/`。`test:desktop` 使用真实 Electron、系统加密和合成官网响应，截图位于被 Git 忽略的 `.artifacts/`；不会触及用户的实际登录数据。

## Developer / CLI

### 配置

需要 Node.js 24 或以上：

```powershell
npm ci
Copy-Item .env.example .env
```

在本地 `.env` 中填写非敏感预约配置，或使用同名环境变量（环境变量优先）：

```dotenv
AUTH_MODE=env
TARGET_DATE=YYYY-MM-DD
TARGET_SEAT=Z2Fxxx
DRY_RUN=true
```

日期和座位编号是占位符。开发 CLI 的 `AUTH_MODE=env` 仍从进程环境读取 `BOOKING_TOKEN`，使用原始 token、不加 `bearer` 前缀；不要把真实 token 写进配置、命令历史或提交到 Git。App 的持久认证模式只使用安全存储。`.env` 和 `.env.*` 已被 `.gitignore` 排除，仅无凭据的 `.env.example` 可提交。

可选配置：

| 配置 | 含义 / 默认值 |
| --- | --- |
| `TARGET_BUILDING` | 官网馆舍名称，精确匹配 `premises.name` 和区域的 `premisesName` |
| `TARGET_AREA` | 官网区域名称，精确匹配区域的 `name` |
| `TARGET_FLOOR` | 官网楼层名称，精确匹配区域的 `storeyName` |
| `TARGET_START_TIME` | 查询起始时间，默认 `00:01` |
| `TARGET_END_TIME` | 查询结束时间，默认 `23:59` |
| `DRY_RUN` | 默认 `true`，只接受 `true` / `false` |

无需配置所有筛选字段，但最终必须唯一匹配一个区域。已确认的区域列表不包含座位编号映射，因此不能从 `Z2Fxxx` 猜出区域；如果返回多个区域，程序会在 Seat/date 之前报 `TARGET_AREA_AMBIGUOUS`，此时补充以上筛选字段。不会遍历全馆座位或默认选第一个区域。

### 运行

查询与生成计划，**始终不提交**，即便 `.env` 中写了 `DRY_RUN=false`：

```powershell
npm run booking:dry
```

普通运行遵守 `DRY_RUN`，未配置时仍为 dry-run：

```powershell
npm run booking
```

历史执行参数仍可解析，但当前构建的核心硬锁会在发送前抛出 `REAL_CONFIRM_DISABLED`：

```powershell
npm run booking -- --execute
```

将 `.env` 的 `DRY_RUN=false` 后运行同样不能绕过硬锁。`--dry-run` 的优先级最高。参数拼错会报错。该锁不接受环境变量、界面或 IPC 参数开启。

成功和 dry-run 退出码为 `0`，配置、认证、查询、解析、业务失败或网络失败为 `1`。confirm 遇到网络中断或 HTTP 5xx 会报 `CONFIRM_OUTCOME_UNKNOWN`，不会自动再发；应先在官网查看预约记录。

## 实际调用链

在 `BOOKING_TOKEN=<token>`、`TARGET_DATE=YYYY-MM-DD`、`TARGET_SEAT=Z2Fxxx`、`DRY_RUN=true` 已替换为有效值后：

```text
loadConfig → validateConfig
→ EnvironmentTokenProvider.getToken → ensureToken
→ POST /reserve/index/index {id:"1"}
→ 检查 premises/category/storey 元数据
→ POST /reserve/index/list {id,date,categoryIds,members,size,page,...}
→ 串行分页，按场馆/区域/楼层唯一解析 area.id（否则明确报错）
→ POST /api/Seat/date {build_id: area.id}
→ 匹配 day === TARGET_DATE
→ 在 times 中唯一匹配 status=1 且包含查询时间的 segment
→ POST /api/Seat/seat {area,segment,day,startTime,endTime}
→ 精确查找 seat.no === TARGET_SEAT → seat.id
→ 检查区域一致、status="1" 且 status_name="空闲"
→ 构造 {seat_id: seat.id, segment: segment.id}
→ 使用 Clock.now() 的客户端本地日期生成 AES key 与 aesjson
→ 输出脱敏计划，结束；绝不调用 confirm
```

execute 在同样的查询和校验之后，会在 `BookingApi.confirmSeat()` 的默认策略检查处停止。只有测试夹具中的内存 HTTP adapter 注入测试策略，保留原有确认协议回归测试；该夹具不进入安装包。

**时间语义：** `TARGET_DATE` 是预约日期，AES 日期是发送时的客户端本地日期，两者分离。宿主时区应与使用官网时的浏览器时区保持一致；没有自动纠正服务器时差。多个可用 segment 必须由查询时间唯一确定；跨 segment、关闭的 segment、重叠歧义都会报错。最终 confirm 只有 seat_id 和 segment，没有起止时间，因此实际预约时段以服务端返回的 `time/newTime` 为准，不能把查询时间解释为任意自定义预约时段。开放状态以接口的 `times[].status` 为准，其他未解释字段予以保留，最终规则仍由服务端执行。

## 模块和安全行为

| 文件 | 作用 |
| --- | --- |
| `src/config/config.ts` | 配置校验、`EnvironmentTokenProvider` 和兼容导出 |
| `src/auth/` | `TokenProvider`、持久认证状态机、安全存储、CAS/网页 adapter 契约 |
| `src/api/httpClient.ts` | axios 统一封装、认证注入、8 秒超时、有限查询重试 |
| `src/api/types.ts`、`src/api/parsers.ts` | 类型、运行时响应校验、结果解析 |
| `src/api/bookingApi.ts` | 查询、详情、`confirmSeat`/`submitSeatConfirm` 和 AES 组装 |
| `src/crypto/bookingCrypto.ts` | Clock、每日 key、AES-128-CBC/PKCS7/UTF-8/Base64 |
| `src/domain/areaResolver.ts` | 分页与区域唯一匹配 |
| `src/domain/segmentResolver.ts` | 按日期、可用状态、时间范围匹配 segment |
| `src/domain/seatSelector.ts` | 精确 seat.no → seat.id 与空闲校验 |
| `src/domain/BookingService.ts` | 完整流程、脱敏日志、单实例单次执行 |
| `src/cli/booking.ts` | CLI、执行模式与退出码 |
| `src/errors.ts` | 错误代码、结构摘要、日志脱敏 |
| `tests/*.test.ts`、`tests/fixtures.ts` | 加密、解析、主流程、HTTP、配置和 CLI 测试 |
| `.env.example`、`.gitignore` | 无凭据配置模板与忽略规则 |
| `package.json`、`package-lock.json`、`tsconfig*.json` | 依赖、命令和构建配置 |

HTTP Client 的认证请求统一追加 `authorization: "bearer" + rawToken` 到 JSON body 和 header，业务代码不拼 token。CAS 换 token 明确使用 `authRequired: false`，不追加认证，并禁止重试。confirm body 只有 `aesjson` 和一次 `authorization`。不跟随 HTTP 重定向，避免认证字段被带往其他地址。401 通知 token provider 清除失效凭据，原请求不会自动重发；confirm 仍需人工核对预约记录。

仅查询的临时网络错误、502/503/504 最多重试 2 次，等待 500ms、1000ms。400/401/403/429、其他 HTTP 错误、业务失败、格式错误和 confirm 都不重试。区域分页串行，有重复/计数变化即停止；超过 100 页提示缩小场馆范围。

AES 使用 Node 原生 crypto，无生产 CryptoJS 依赖。key 为当前本地日期 `YYYYMMDD + reverse(YYYYMMDD)`，IV 为原样 UTF-8 字符串 `ZZWBKJ_ZHIHUAWEI`（**16 字节，无补零**）。JSON 按 `seat_id`、`segment` 顺序构造，不包含 token、日期、区域或查询时间。

正常日志不输出 token、完整 key、aesjson、原始响应、UserInfo 或 AxiosError。服务器任意消息不直接写入 CLI 日志；调用 API 获取的 `BookingResult.message` 保留服务端说明，调用方若另写日志须自行处理隐私。已知个人数据模式、token 和终端控制字符会被脱敏。测试只使用合成 token/数据，没有真实凭据。

生产逻辑没有固定抓包中的 area、segment、seat_id、座位编号或日期。`id="1"` 和普通座位分类 `"1"` 是已核实的官网业务类型标识，分类还必须存在于 index 返回的元数据中；它们不是某次预约的区域或座位 ID。

现有 CLI 默认保持 `env` 开发模式。`createTokenProvider` 给桌面宿主默认选择 `persistent-cas`，由 `AuthManager.getToken()` 提供同一接口；缺少 adapter 时明确失败，不退回环境 token。`BookingService` 只增加了 401 失效通知，区域、segment、seat、AES、confirm 的职责保持不变。没有密码、验证码或登录绕过逻辑。

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

测试使用实际 BookingService、解析器和 Node AES，仅替换 axios 的 HTTP adapter；不 mock 整个 Service。CryptoJS 仅为开发测试依赖，验证密文逐字节兼容、UTF-8、解密还原、当前日期及跨午夜换 key。测试同时覆盖分页、歧义、状态冲突、目标不存在、dry-run 零 confirm、execute 一次 confirm、拒绝重复运行、业务失败和错误脱敏。CLI 子进程测试不使用真实凭据，也不联网。

第三阶段没有执行 commit，所有变更保留在工作区。
