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
// 5.6.7：审计驱动的正确性收口（含 3 处行为变更，见审计报告）
//        - 凯利三结果：lossRate = 1 - 胜率 - 保本率，不再把保本单算作完整亏损。
//          此前「统计页 +15（正期望）/ 凯利 -5（判策略无价值）」对同一批数据给相反结论，
//          而凯利直接驱动仓位大小。保本率由 autoFillKellyFromLogs 与样本量同生命周期挂在
//          kellyWinRate.dataset.kellyBreakEven，用户手改凯利三字段时一并清除。
//        - 凯利杠杆口径：风险比例上限固定 5%，不再 ÷杠杆。原实现把「风险比例」和
//          「名义敞口」混为一谈——同一策略在 lev=1 建议 5%、lev=10 建议 0.5%、lev=20 建议
//          0.25%，边际未变而建议风险缩 20 倍；lev≥20 时下拉抬到 0.5% 而实际执行 0.25%，
//          卡片显示是实际的 2 倍。杠杆敞口改由保证金/组合热量/单品种占比三道硬上限约束。
//        - 部分平仓基数统一：closedRatio 与 closes[].ratio 统一为「占开仓原始仓位」，
//          用户输入的「占当前剩余仓位」比例经 utils.closedRatioDelta 换算。原实现直接把
//          剩余基数的比例加进原始基数累加器，第二次部分平仓就把 closedRatio 顶到 100，
//          被判为已全额平仓，而 positionSize 仍有余额——那部分敞口既不进持仓统计也
//          不产生已实现盈亏。首次部分平仓 frac=1，行为不变。
//        - CSV 导入改完整状态机（parseCSVRecords）：本站导出只转义 " 不转义换行，
//          用户文本字段里一个换行就把该行后续所有列整体右移、其后每一行全部错位，
//          一次导出→导入静默损毁全表且无任何报错。另补 BOM 剥离（首列 header 曾被
//          BOM 字符挡住字段映射，时间/品种两列整体丢失）与列数不一致告警。
//        - 热量上限收敛到 getHeatHardMax()：portfolioHeatMax 此前只在一条被
//          riskHeatMax*0.8 恒覆盖的子句里被读到，设置页改它不影响任何判定（死配置项）。
//          现取两值较严者，闸门/清单/风险面板/仪表盘四处统一读取；默认 6 与 8 → 6%，不变。
//        - customStopLimit 加三重校验（白名单键 + 有限数字 + 0.5~50 区间），
//          getStopLimitPct 读侧同样兜底——原实现只 JSON.parse + typeof==='object'，
//          非数字值/数组/原型键全部静默入库。
//        - 保存闸门 fail-closed：清单结果缺失/空对象时直接拒绝保存（原来 failCount=0
//          静默放行），并删掉 totalExecutables>=2 这个无业务依据的下限守卫——它会
//          在「只剩 1 个可执行项且 fail」时放行。注释原先写「最多允许 1 个 fail」
//          与实现相反，现已对齐。
//        - 删除 CalculationUI.evaluateOpeningBlockers：零调用的「阻断规则中央配置」
//          入口，真实阻断链是 _calculateImpl 内按 IIFE 顺序早返回的序列。留着它会让
//          维护者误以为阻断逻辑已集中，改文案时只改规则表而实际不生效。
//        - 当日连亏熔断改为委托 stats.js 的 _getTodayLossStreak()：原实现在
//          calculator.js 内复制了一份，且口径更严（要求 closeTime 非空，权威版在缺失时
//          回退到 time）。同一批数据下「硬熔断计数」与「清单/仪表盘显示的连亏笔数」
//          可能不一致，出现「页面显示 2 笔未触发、点计算却被熔断」。
//        - 夏普收敛为 utils.dailySharpe（单一实现）：① 原先只取「有平仓的交易日」，
//          持有中无平仓的空闲日整段被丢弃，持有 20 天只在其中 3 天平仓的账户按 3 天算，
//          波动率被低估、夏普被系统性抬高；现从首笔铺到末笔逐日铺满、无平仓日记 0。
//          ② 年化系数 252 → 365：本站交易 7×24 永续合约，按 252 会把年化低估约 31%。
//        - 新增杠杆维护保证金极限硬阻断：强平价公式 LP=E×(1−IMR+MMR)/(1−MMR) 令
//          LP=E 解得 IMR=2×MMR，即零缓冲边界在「杠杆 = 1/(2×MMR)」，不是 1/MMR。
//          MMR 0.5% 时 100x 强平价恰为入场价、101x 已被推到入场价之上——开仓即强平，
//          而原实现只比较「止损 vs 强平价」，此时 isInvalid 恒为假，零缓冲仓位照样过闸。
//          另补：强平价算出 NaN 时也硬阻断（原先比较全为假，静默放行）。
//        - preCheckStorageCapacity 拒绝负数/NaN 字节数：放行后 `> estRemaining*0.5`
//          恒为假，预检查被静默跳过。
//        - 测试：237 → 265 断言（新增闸门 fail-closed、dailySharpe 铺满与年化、
//          强平价与杠杆阈值三组）；测试页脚本加 ?v= 避免缓存旧代码，localStorage mock
//          补全 key/length/clear 以自洽（原先 length 读到宿主真实存储，结果随环境漂移），
//          并支持 __FAIL_KEYS 按键名注入配额错误以验证 saveLogs 的写入顺序。
// 5.6.8：离线健壮性与记录身份（2 项，见审计报告「遗留项」收口）
//        - 新增 js/chart-guard.js：Chart.js 走 CDN 加载，断网时该脚本静默失败、
//          typeof Chart === 'undefined'，此后 analytics/dashboard/review 里约 20 处
//          new Chart(...) 全部抛 ReferenceError——图表区整片空白且没有任何解释，
//          而风控计算/日志/复盘其实完全可用（数据全在 localStorage）。
//          现安装最小占位桩：new Chart() 返回带 destroy/update/resize 的惰性实例，
//          Chart.getChart() 恒返回 null（调用方都写成 if(existing) 形式），并在 canvas
//          上画一行离线说明。刻意不补 Chart.defaults/register/helpers——项目没用到，
//          补了会掩盖未来引入真实 Chart.js 特性时的依赖缺口。守卫必须紧跟 CDN
//          <script> 之后、在任何调用 Chart 的模块之前加载。
//        - 日志记录新增稳定 id（utils.genLogId，形如 lg_YYYYMMDDTHHMMSS_随机6位）。
//          日志一直靠数组索引寻址，记录本身没有唯一标识，两个后果：
//          ① storage.js 的 _logFingerprint 里 item.id 分量恒为空，v3→v4 去重与
//            JSON 导入去重都退化到 time+symbol+entryPrice+positionSize 拼接；
//          ② 同一笔交易经 CSV 与 JSON 各导入一次会被当成两条不同的日志。
//          新记录在 saveLog / 分批保存 / CSV 导入 / JSON 导入处生成 id；
//          存量记录由 loadLogs 一次性回填（trade_ids_backfilled_v1 标记）。
//          CSV 导出新增 ID 列（第 1 列），导入侧映射回 id 并保留原值——
//          所以导出→编辑→再导入不会静默变成两份。
//          id 只做身份用途：不参与计算、排序、风控校验，也不能当作寻址手段
//          （删除记录后索引仍会变），因此对既有逻辑零影响。
//        - 测试：265 → 299 断言（新增第 22 组 Chart 离线守卫 14 条、第 23 组 id 与
//          CSV ID 列往返 18 条）；测试页不再预置 Chart，改由守卫安装，与 index.html
//          一致；harness 补可用的 2d 上下文让画字路径真正执行并验证 __noteDrawn。
var APP_VERSION = '5.6.8';
