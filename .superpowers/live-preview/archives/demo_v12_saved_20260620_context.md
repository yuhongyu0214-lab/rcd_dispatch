# demo_v12 当前版本上下文

保存时间：2026-06-20

当前版本文件：
- Live preview：`C:\Users\yhy\Desktop\人车单生态\.superpowers\live-preview\demo_v12.html`
- Temp 预览：`C:\Users\yhy\AppData\Local\Temp\人车单前端demo_v12.html`
- 归档副本：`C:\Users\yhy\Desktop\人车单生态\.superpowers\live-preview\archives\demo_v12_saved_20260620_current.html`

当前关键状态：
- 地图看板中点击 `订单 / 司机 / 预警 / 车辆` 只切换地图内对象、KPI 和左侧列表，不跳转到其他 step。
- 车辆管理右侧为“车辆明细”行表，每辆车一行，字段含车牌、车型、当前所属门店、车辆状态、GPS 状态、当前订单、本月完单、本月营收、当前位置等。
- 车辆明细上方已有局部模糊搜索框，支持车牌号、车型、门店、GPS 状态，输入即筛选。
- 左侧车辆管理已删除“车辆信息自动传入”说明卡。
- 订单池不展示已完成订单，订单详情与地理编码输出冗余模块已删除。
- 司机管理右侧为司机工单进度轴，每名司机一行。

继续修改前建议：
- 以 `demo_v12.html` 为主文件修改。
- 修改后同步到 Temp 文件：
  `Copy-Item -LiteralPath 'C:\Users\yhy\Desktop\人车单生态\.superpowers\live-preview\demo_v12.html' -Destination 'C:\Users\yhy\AppData\Local\Temp\人车单前端demo_v12.html' -Force`
- 修改后运行脚本语法检查：
  `node -e "const fs=require('fs'); const html=fs.readFileSync('.superpowers/live-preview/demo_v12.html','utf8'); const m=html.match(/<script>([\s\S]*)<\/script>/); new Function(m[1]); console.log('script ok', m[1].length);"`
