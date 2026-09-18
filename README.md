# 浙江大学图书馆座位预约 API Client（第一阶段）

单用户 CLI：手动提供 booking token，查询区域、日期和目标座位，生成官网兼容的 aesjson，显式执行一次预约。默认 dry-run。没有 CAS 登录、账号密码保存、UI、并发抢座或自动候补。

实现已通过本地模拟 HTTP 测试；**尚未使用真实 token 联调，也未发送真实预约**。官网字段依据和范围见 [协议核验记录](docs/protocol.md)。响应不符合已核实结构时停止并输出仅含字段名、类型、数组长度的摘要，不猜字段。

## 安装与配置

需要 Node.js 24 或以上：

```powershell
npm ci
Copy-Item .env.example .env
```

在本地 `.env` 中填写，或使用同名环境变量（环境变量优先）：

```dotenv
BOOKING_TOKEN=<token>
TARGET_DATE=YYYY-MM-DD
TARGET_SEAT=Z2Fxxx
DRY_RUN=true
```

上面是占位符，必须替换为自己的原始 token、合法日期和实际座位编号。不要添加 `bearer` 前缀。`.env` 和 `.env.*` 已被 `.gitignore` 排除，仅 `.env.example` 可提交。不要把配置、抓包或终端敏感输出提交到 Git。

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

## 运行

查询与生成计划，**始终不提交**，即便 `.env` 中写了 `DRY_RUN=false`：

```powershell
npm run booking:dry
```

普通运行遵守 `DRY_RUN`，未配置时仍为 dry-run：

```powershell
npm run booking
```

真正预约有两种显式方式：

```powershell
npm run booking -- --execute
```

或者将 `.env` 的 `DRY_RUN=false` 后运行 `npm run booking`。`--dry-run` 的优先级最高。参数拼错会报错。

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

execute 在同样的查询和校验之后，由 `BookingApi.confirmSeat({seatId,segment})` 在发送前生成 AES，再发送一次 `POST /api/Seat/confirm`。只有数值 `code === 1` 才返回成功；HTTP 200 本身不代表预约成功。返回 `BookingResult` 包括 `success/code/message/seat/no/area/time/newTime`。

**时间语义：** `TARGET_DATE` 是预约日期，AES 日期是发送时的客户端本地日期，两者分离。宿主时区应与使用官网时的浏览器时区保持一致；没有自动纠正服务器时差。多个可用 segment 必须由查询时间唯一确定；跨 segment、关闭的 segment、重叠歧义都会报错。最终 confirm 只有 seat_id 和 segment，没有起止时间，因此实际预约时段以服务端返回的 `time/newTime` 为准，不能把查询时间解释为任意自定义预约时段。开放状态以接口的 `times[].status` 为准，其他未解释字段予以保留，最终规则仍由服务端执行。

## 模块和安全行为

| 文件 | 作用 |
| --- | --- |
| `src/config/config.ts` | 配置校验、`TokenProvider` 接口、`EnvironmentTokenProvider` |
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

HTTP Client 每次统一追加 `authorization: "bearer" + rawToken` 到 JSON body 和 header，业务代码不拼 token。confirm body 只有 `aesjson` 和一次 `authorization`。不跟随 HTTP 重定向，避免认证字段被带往其他地址。

仅查询的临时网络错误、502/503/504 最多重试 2 次，等待 500ms、1000ms。400/401/403/429、其他 HTTP 错误、业务失败、格式错误和 confirm 都不重试。区域分页串行，有重复/计数变化即停止；超过 100 页提示缩小场馆范围。

AES 使用 Node 原生 crypto，无生产 CryptoJS 依赖。key 为当前本地日期 `YYYYMMDD + reverse(YYYYMMDD)`，IV 为原样 UTF-8 字符串 `ZZWBKJ_ZHIHUAWEI`（**16 字节，无补零**）。JSON 按 `seat_id`、`segment` 顺序构造，不包含 token、日期、区域或查询时间。

正常日志不输出 token、完整 key、aesjson、原始响应、UserInfo 或 AxiosError。服务器任意消息不直接写入 CLI 日志；调用 API 获取的 `BookingResult.message` 保留服务端说明，调用方若另写日志须自行处理隐私。已知个人数据模式、token 和终端控制字符会被脱敏。测试只使用合成 token/数据，没有真实凭据。

生产逻辑没有固定抓包中的 area、segment、seat_id、座位编号或日期。`id="1"` 和普通座位分类 `"1"` 是已核实的官网业务类型标识，分类还必须存在于 index 返回的元数据中；它们不是某次预约的区域或座位 ID。

CAS 尚未实现，唯一需要人工完成的是在官网正常登录并取得当前 booking token。之后全部业务不依赖 CAS；未来实现 `CasTokenProvider.getToken()` 即可替换认证来源。没有密码、验证码或登录绕过逻辑。

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

测试使用实际 BookingService、解析器和 Node AES，仅替换 axios 的 HTTP adapter；不 mock 整个 Service。CryptoJS 仅为开发测试依赖，验证密文逐字节兼容、UTF-8、解密还原、当前日期及跨午夜换 key。测试同时覆盖分页、歧义、状态冲突、目标不存在、dry-run 零 confirm、execute 一次 confirm、拒绝重复运行、业务失败和错误脱敏。CLI 子进程测试不使用真实凭据，也不联网。

本目录初始为空且没有 Git 仓库；实现没有初始化 Git 或创建 commit。
