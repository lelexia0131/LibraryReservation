# 官网协议核验记录

核验日期：2026-09-18。来源是用户提供的已成功预约请求说明，以及当天读取的官网公开前端资源。没有读取用户浏览器会话、CAS 凭据或个人信息，也没有调用真实 confirm。

| 一手来源 | 核实内容 |
| --- | --- |
| [官网首页](https://booking.lib.zju.edu.cn/h5/) | 当前主 bundle 地址 |
| [主 bundle](https://booking.lib.zju.edu.cn/h5/assets/index.1782805514175.js) | POST 路径，header/body 的 bearer 拼接，先加密业务参数再加 authorization，当前本地日期 key，固定 IV，CryptoJS CBC/PKCS7，详情 `{id,areaId,date?}` |
| [预约首页](https://booking.lib.zju.edu.cn/h5/assets/index.17828055141755.js) | index 请求 `{id:reserveType}`，成功码 0，元数据来自 response.data |
| [筛选组件](https://booking.lib.zju.edu.cn/h5/assets/filter.1782805514175.js) | premises/category/storey 使用 id/name，普通座位 categoryIds 为 `["1"]` |
| [区域列表](https://booking.lib.zju.edu.cn/h5/assets/SeatList.1782805514175.js) | list 参数含 date/categoryIds/premisesIds/members/size/page；成功码 0；response.data.list/count；区域路由传 item.id |
| [区域显示](https://booking.lib.zju.edu.cn/h5/assets/RoomItem.1782805514175.js) | 区域 name、premisesName、storeyName |
| [选座组件](https://booking.lib.zju.edu.cn/h5/assets/seatSelectCom.1782805514175.js) | date 请求 build_id，response.data[].day/times[]，segment 取 times[].id，start/end/status，seat 请求字段，返回 data 数组，confirm 明文 seat_id/segment |

这些 URL 带构建版本，未来可能失效。这里只保存核实结论，不把整份官网 bundle 或私人抓包提交为项目代码。测试 fixture 是按已确认结构构造的合成数据，不宣称它是已认证接口的现场响应。

协议差异必须保留：reserve index/list/detail 的成功码为 0，Seat/date、Seat/seat 为 1。查询响应兼容官网现有数字/数字字符串比较；最终 confirm 按用户要求严格以数值 `code === 1` 判断成功。

普通座位业务类型与分类标识为 1；实际场馆、区域、时间段、座位 ID 均来自响应。无法从已知区域字段建立座位编号映射，因此无唯一筛选结果时明确停止。

`times[].status == 1` 表示可用，start/end 非空且 start < end 才能选择。实现按请求查询区间唯一匹配，避免复制官网直接选择首个可用段的行为。尚未核实的开放规则字段不进行推测性解释。

`fetchReserveDetail({id,areaId,date?})` 已封装，当前主链路不需要它；label/map 不参与本阶段的按座位编号预约链路，没有为了凑接口数量猜它们的请求参数。

AES 直接以 UTF-8 的 16 字节 key 和 **16 字节 IV** 调用 Node crypto 的 aes-128-cbc，默认 PKCS7，输出裸密文 Base64（不带 OpenSSL salt 头）。测试使用实际 CryptoJS 同样的 WordArray key/IV 调用进行独立比对。

真实环境尚待验证：有效 booking token 下的服务器响应是否保持上述结构、目标区域的具体开放状态，以及最终预约结果。实现遇到不匹配会输出无值结构摘要并停止，不把测试成功视为官网预约已成功。

## 第四阶段复核（2026-09-19）

重新读取官网 HTML，主 bundle 仍为 `index.1782805514175.js`。只下载公开静态代码，未调用真实 confirm，也未将私有响应或凭据保存到仓库。下载的研究文件仅位于 Git 忽略的 `.artifacts/protocol/`。

| 来源 | 本次新增核实结论 |
| --- | --- |
| [RoomItem](https://booking.lib.zju.edu.cn/h5/assets/RoomItem.1782805514175.js) | 普通座位卡把 `item.total_num` 显示为“座位”，把 `item.free_num` 显示为“空闲”；不是 `free`、`total` 或猜测字段。 |
| [SeatList](https://booking.lib.zju.edu.cn/h5/assets/SeatList.1782805514175.js) | 列表参数包含 `date/startTime/endTime/categoryIds/premisesIds/size/page`，数据为 `data.list/count`。 |
| [seatSelectCom](https://booking.lib.zju.edu.cn/h5/assets/seatSelectCom.1782805514175.js) | 选定日期和合法时段后，Seat/seat 使用该时段完整 start/end；confirm 仅提交 seat_id 和 segment。 |
| [主 bundle](https://booking.lib.zju.edu.cn/h5/assets/index.1782805514175.js) | response interceptor 遇到 `code == "10001"` 清空会话并跳到认证页；据此识别登录失效。确认 `/api/index/subscribe` 和 `/api/Member/seat` 是当前预约及座位记录读取接口。 |
| [Appointment](https://booking.lib.zju.edu.cn/h5/assets/Appointment.1782805514175.js) | 挂载时调用 `subscribe()`（无业务参数），成功码 1，遍历 `data` 形成当前预约列表。 |
| [AppointmentItem](https://booking.lib.zju.edu.cn/h5/assets/AppointmentItem.1782805514175.js) | 普通座位 type 1 属于签到提示范围。在 `flag_in == 1 && flag_leave == 0` 条件下显示 `lastSigninTime`，配合 `Sign_in_before` 文案；离席返回使用 `needBackTime`，二者不能混用。展示预约时间使用 `showTime`。 |
| [seat](https://booking.lib.zju.edu.cn/h5/assets/seat.1782805514175.js)、[seatDetail](https://booking.lib.zju.edu.cn/h5/assets/seatDetail.1782805514175.js) | 座位记录从 `/api/Member/seat` 获取。详情显示 createTime（记录“预约时间”即创建时间）、beginTime、endTime、renegeTime、timelist[].operateTime，不把创建或违约时间当作到场时间。 |
| [旧 seat-select](https://booking.lib.zju.edu.cn/h5/assets/seat-select.1782805514175.js) | 与当前组件一样，成功弹层使用已选日期、时段和位置以及 confirm.msg，没有直接解释 confirm.time 或 new_time。 |

### 数据可靠性与未核实边界

公开 UI 足以证明 `free_num/total_num` 的显示语义；尚未使用有效登录会话读取本次现场列表响应。实现要求两字段均为非负安全整数且 free 不超过 total，缺字段回退串行查询，矛盾或异常值报 schema 错误。列表计数仅供发现位置，提交前始终重新读取完整时段和座位状态。

原有 confirm 解析器继续保留 `seat/no/area/time/newTime`。用户早期成功请求说明是这些字段存在的依据；本次当前/旧公开组件均未赋予它们进一步语义：

- `seat/no/area`：保留原结果兼容；展示座位编号使用 no（缺失则使用已验证候选），位置使用实时解析的馆舍/楼层/区域，避免将完整原始响应直接传给 renderer。
- `time`：仅接受时间/日期字符组成的返回文本用于结果时间；缺失或非时间文本显示“请在图书馆官网查看”。不能把前端查询起止时间冒充服务器实际预约时间。
- `new_time`：只在内部沿用 newTime 保存；不解释为到场时间、签到截止或预约时段，也不传到 UI。
- 到场/签到截止：已找到候选只读来源 `/api/index/subscribe` 的 `lastSigninTime`，但缺少真实响应，尚未确认如何可靠地用日期、位置、座位号关联本次新预约，且 flag 条件也需现场确认。因此 UI 暂为“暂未获取”，没有推算。

后续只需用户已有预约下的只读 HAR/脱敏响应：`POST /api/index/subscribe`（无业务参数）、必要时 `POST /api/Member/seat` 的当前普通座位记录，以及对应官网当前预约卡的签到提示。需保留结构、type、flag_in、flag_leave、座位/位置/日期关联字段、showTime、lastSigninTime；移除 authorization、Cookie、token、CAS 和个人身份信息。无需制造新预约。

尚未找到官网对“座位被抢占”等 confirm 非成功码的可重试含义表。实现不猜测：confirm 非成功业务码结束任务；提交前实时查询证明座位不再空闲时，因还未发送 confirm，允许下一轮继续查询。
