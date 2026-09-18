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
