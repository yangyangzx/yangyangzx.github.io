// 应用版本 - 每次更新后递增，用于缓存清除
// 5.6：UI/UX 审计全量修复（toast 层级、弹窗 a11y、原生对话框替换、指标说明可达性、
//      信息架构去重与命名统一、内联样式 token 化）
// 5.6.1：编辑簿记一致性收口（新增 utils.syncCloseBookkeeping，保证
//        sum(closes[].ratio)===closedRatio；分批比例越界拦截；弹窗内切换平仓类型联动
//        比例行显隐）+ isClosedTrade 历史重复定义删除 + 主题手动标记移除与
//        theme-color 同步 + nav active 边框插值修正 + stats 死代码删除
// 5.6.2：临时止损宽度可配置（设置页新增 provisionalStopPct，留空=内置默认 ETH 0.8%/其余 1%）
// 5.6.3：开仓闸门一致性收口（含行为变更）
//        - 组合热量闸门改按「含本仓」口径：calcPortfolioHeat(pendingRisk, symbol, capital)，
//          原先只算已持仓，「已持仓 5.5% + 本仓 2% > 上限 6%」整类超配漏过
//        - 心态评分清单判定改走 getMindsetAdjustment()：2 分与计算层一致按「降仓 50%」放行
//          （原先被清单项拦成 fail，卡片显示降仓建议、点保存却被拒）
//        - 硬阻断时清单刷成阻断态（renderChecklistBlocked），不再残留上一轮的 PASS
//        - 清单新增 warn 态（不阻断但可见）：仓位截断、心态降仓、多止盈加权 RR 偏低
//        - 状态项分类（STATUS_CHECK_ITEMS）单一来源，结论行与保存闸门共用，计数不再差 1
//        - 品种止损上限收敛到 getStopLimitPct()，planner 不再重复抄 ETH 2%/其余 3%
//        - calc 暴露 cappedByMargin；checkRiskPct 改比 planned vs actual（原为恒真比较）
//        - 新增 getMindsetScore() 收敛四处 `parseInt(...) || 3`
// 5.6.4→5.6.6：导航 active 态液态波浪改三波扫光（三轮迭代）
//        - 5.6.4 单道 conic（中心 50% 130%，峰值 0.36，blur 1.5px）→ 观感「线条太硬」
//        - 5.6.5 改双波干涉：慢波峰头偏斜 + 快波反向
//        - 5.6.6 再加第三道慢涨弧（11s，最宽最淡最慢，中心 50% 185%）
//        - 根因：刚体旋转的 conic 永远不会起伏，只会匀速平移——波动感来自多波
//          明暗干涉，不是旋转本身
//        - 三层：① 底层薄雾（常驻）② 慢波 4.5s 峰头偏斜 ③ 快波 7.2s 反向 ④ 慢涨 11s
//          周期互不整除：4.5 与 7.2 的 LCM 36s，叠 11 后 396s 才回初相，观感不同步
//        - 扇形中心越靠外（142%→160%→185%）同一道弧铺得越宽越平、边缘越不硬
//        - 角度动画靠 @property 注册 --sweep/--sweep2/--sweep3 为 <angle> 才有法插值，
//          不注册时浏览器只在首尾两帧之间跳变；反向弧用 calc(32deg - var(--sweep2))
//        - 加层累积亮度，②③峰值从 0.19/0.12 压到 0.16/0.10 补偿（三峰合计 0.36）
//        - blur 只到 2.5px：再大就把 ::before 上立体投影一起糊掉，按钮失去厚度
//        - 颜色全从 --nav-hue 派生保住模块辨识度；仅 active 播放；无 blend/mask/SVG filter
var APP_VERSION = '5.6.6';
