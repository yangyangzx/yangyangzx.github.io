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
// 5.6.9：反推路径含费口径收口 + 部分平仓编辑基数语义 + STATUS 清单减噪
//        + 导入流水线合并 + sl_move 落 stopLoss + closeType 空值护栏
//        + 0 条候选导入护栏（审计遗留项全部收口；复核时另收口 1 个存量数据完整性 bug
//        与 1 个本轮合并引入的清空回归；详见审计报告）
//        - P0 反推口径：getTPUnits() 原本只在 _lastCalc 可用时返回口径，
//          calcReverseTP / calcReverseSL / autoCalcMultiTP 三条路径各自静默 fallback
//          到「stopDistance × rr」纯毛利解——请求 2R 实际只达成 1.78R（88.9%），
//          于是「按 2 倍止损距离放的目标价」会被 2R 门判为不达标，同一份参数两个结论。
//          现 getTPUnits() 在计算结果不可用时退回表单输入（入场价/止损价/方向/费率），
//          费率与 calculator.js 同源（未填按订单类型回落 0.08%/0.04%）；三条反推路径
//          不再有纯毛利兜底，口径拿不到时明说「无法按含费口径反推」而不写错值。
//          注意含费反推会让止损更【紧】而非更宽（ep 50000 / tp 52000 / 费率 0.08%：
//          含费 sd 879.9 vs 纯毛利 1000）——这是费用同时压缩分子（净毛利）、膨胀分母
//          （净止损）的必然结果，不是回归。
//          updateMultiTP 在 calc 为 null 时 f 恒为 0，各行显示的是纯毛利 RR，而
//          autoCalcMultiTP 回填的是含费解；现改从 getTPUnits() 取费率。RR 是比值、
//          与仓位规模无关，故改用单位净值相除（原实现乘 origPosSize，calc 为 null 时
//          origPosSize=0，0/0 会显示成 0.00R）。
//        - P1 部分平仓编辑路径基数语义：编辑一条已有 ≥2 次部分平仓的记录时，原先把
//          同一个输入值同时当「相对剩余仓位的削减比例」和「原始仓位的簿记增量」用，
//          两者只在第一次部分平仓时相等。复现：原始 1000 → 第一次平 50%（剩 500）→
//          第二次平剩余的 50%（剩 250），此时编辑该记录按原逻辑算出 positionSize=750，
//          把已经平掉的 500 单位敞口凭空算回账面。现弹窗新增「口径：剩余仓位/原始仓位」
//          单选并记住上次事件用过的口径（ratioOfRemaining），换算走 utils.closedRatioDelta
//          的等价标量形式，positionSize/riskAmount/actualMargin/fee 一律按累计 closedRatio
//          还原。closes[] 为空但 closedRatio>0 的旧数据补回一条历史事件，保住
//          sum(closes[].ratio) === closedRatio 不变量。saveEditLog 中途失败统一走
//          abortSave() 回滚（原先直接 return 会留下半污染状态：closeType 已变「分批」
//          但比例越界被拒）。emFee 的读取提前到部分平仓重算之前——原先重算之后又被
//          emFee 旧值覆盖回去，「原始费用×剩余占比」的缩减等于白算。
//        - P1 closeType 空值护栏（复核本轮改动时发现的存量 bug，非本轮引入）：
//          emCloseType 下拉有 <option value="">—</option>，用户选它是在主动取消平仓标记，
//          但空值不是分批类型，于是 syncCloseBookkeeping 走「非分批收尾」分支，把
//          closedRatio 强设 100、closes[] 整链清空、partialRatio 删掉；而 isClosedTrade
//          首行 !item.closeType 又判「未平仓」。三处合起来留下「closedRatio=100 + 未平仓 +
//          剩余敞口仍在」的悬空记录——本想撤销标记，却把分批簿记毁掉了，CSV 还会显示
//          100% 已平。护栏放在权威实现 utils.syncCloseBookkeeping 开头（!closeType 或
//          非字符串直接返回，不做簿记），这样编辑弹窗、分批保存、confirmClose 任何调用方
//          都安全，且能直接单测。该分支是 v5.6.1 引入的（当时修的是 closedRatio 该置 100
//          而非 0），空值路径一直没护栏。
//        - P2 导入流水线合并：CSV / JSON 两条导入路径原本各写一套校验与确认流程，
//          设置页文件选择器的 JSON 分支只做形状判断就全量覆盖（跳过结构/字段/XSS
//          三层校验和去重），而 io.js 拖拽导入的去重键用的是刚生成的 id——同一文件内
//          两条重复记录会各拿一个新 id 而双双通过。现收敛为一条
//          _prepareImportedRecords → _confirmImportThenCommit(mode) 流水线，追加与覆盖
//          两个模式共用校验、去重与文案；去重改双键（带 id / 去 id 指纹），无 ID 列的
//          旧版导出重复导入不再产生重复记录。
//        - P1 0 条候选不再能覆盖提交（上项合并引入的回归）：去重把整批丢弃后
//          report.candidates.length = 0，覆盖分支没有 0 候选的分支，照样弹「将用文件中的
//          0 条记录覆盖现有 N 条日志」，用户一点就 _commitImportedLogs([]) 把全部历史
//          清空，还回一条「已导入 0 条日志」的 success 提示——数据已丢，提示还说是成功
//          的。两个真实触发面：① 用户重新导入自己导出的那份 CSV，双键去重判全部重复；
//          ② 表头列数与数据行不一致，行被整行跳过。HEAD~1 的 parseCSVImport 不做去重，
//          重复导入会产生 N 条候选，不会走到 0——修好「重复导入产生重复记录」时把这个
//          边界打穿了。现在 _confirmImportThenCommit 入口加 0 候选护栏，直接改弹纯告知框
//          「没有可导入的记录」并返回，不进任何提交路径；追加模式提交空数组虽无害，但会
//          给「成功导入 0 条」的误导提示，故一并拦下。解析阶段告警照旧跟着提示框显示。
//        - 测试：299 → 409 断言（新增第 24 组止损移动轨迹 21 条、第 25 组部分平仓
//          编辑基数语义 33 条、第 26 组导入流水线合并 13 条、第 27 组反推路径 4 种
//          参数残缺形态 + 口径不可用路径 23 条，合计 90 条；第 13 组
//          syncCloseBookkeeping 追加 7 条 closeType 空值护栏断言；第 26 组追加 14 条
//          0 候选护栏断言；第 15 组因 STATUS 影子项移除净 −1，原 4 条 isStatusCheckItem/
//          STATUS_CHECK_ITEMS 分类断言改写为 2 条「符号已删除」断言，「状态项 fail 不进
//          闸门」的前提本身被移除故删除，未单开新组。90 + 7 + 14 − 1 = +110）。
// 5.6.10：对抗式复核（5 项已确认缺陷）全量修复 + 计算状态徽章状态化
//         - P0 CSV 导入静默丢交易：同一份文件内的重复记录互相判重后被整条丢弃，
//           saveSplit 生成的多批次共用 groupId 与同一时间戳、且 _logFingerprint 只有
//           7 个字段（不含批次标签与平仓字段），等分时逐字相同——实测 3 笔分批导入后
//           只剩 1 条，errors=0、无任何提示。内容完全相同的两条记录在数学上与
//           「同一份文件被重复导入两次」无法区分（无 ID 列时两者都是无 ID 全同内容），
//           判重必然二选一。现改为【只与现有日志比对，同一次导入内部不判重】：
//           真实分批全部保留，重复导入文件的判据由与现有日志的比对承担、不受影响。
//         - P1 分批平仓超 100%：「原始仓位」口径下增量即占原始仓位比例，与已平部分
//           相加可超 100%——实测已平 50 时输入 80，保存成功却得到 closes=[50,80]
//           （sum=130）、closedRatio 被 clamp 到 100、positionSize 归 0 而 closeType
//           仍是 partialTP：挂单中间态被判全额平仓，剩余敞口从账面消失，并打破
//           sum(closes[].ratio) === closedRatio 不变量。现按「累计已平 + 本笔 > 100」
//           拦截；「剩余仓位」口径代数上不越界，但两种口径统一校验更稳。
//         - P2 recordStopMove 幂等判据分叉：原先与 stopHistory 末条比较，而末条只反映
//           本函数自己写过的点——用户用编辑弹窗直改 item.stopLoss（emStopLoss 不写
//           stopHistory）后两者分叉，此时再移动止损是【真实变化】却被判「无需记录」，
//           留下 stopLoss 与时间线长期不一致，而仪表盘持仓监控读的是 stopLoss。
//           现改与 item.stopLoss 比较，缺失或无效时才退回末条。
//         - P2 反推止损口径不可用时静默出错：calcReverseSL 的未知量就是止损，原先却
//           仍要求止损已填（getTPUnits 要求 sd>0 才返回口径）——用户按「已知入场价 +
//           目标价 + 期望 RR 反推止损」这条主流程走不通，且报错固定指「请先填写入场价」，
//           而入场价已填时指错了字段。现 getTPUnits(requireStop) 加参数，requireStop=
//           false 时 sd 缺失只把 unitStop/unitLoss 置 null（不冒充「仅费用」的伪止损），
//           报错按真实缺失字段提示。
//         - P2 abortSave 浅回滚残留：Object.assign 只覆盖已存在的键、删不掉本次编辑
//           【新增】的键。新建日志（saveLog 不写 closes / closedRatio / closeTime /
//           initial*）在编辑弹窗里选「分批」填了比例，syncCloseBookkeeping 写入那一整套
//           键；此后校验失败时这些键全部残留——closeType 已回滚成空、isClosedTrade
//           判「未平仓」，却带着 closes / closedRatio / closeTime。而 syncCloseBookkeeping
//           的空值护栏（closeType 为空即不动簿记）会让残留永远得不到清理。现先删掉快照
//           里不存在的键再覆盖。
//         - 计算状态徽章状态化（原写死「实时 · 动态风控」）：表单 input/change 只标脏
//           （markCalculationDirty），真正重算入口是「计算仓位」按钮，用户改完入场价
//           卡片上还是旧结果、徽章却说实时。现由 updateCalcStatusBadge() 按
//           getCalcDirty() 切换：绿「已计算 · 动态风控」/ 琥珀「待重算 · 动态风控」，
//           图标 fa-check-circle / fa-exclamation-triangle。setCalcDirty() 是唯一的脏
//           写入路径，故只需在它一处挂钩，不必在每处调用点重复。
//         - 纪律 LED 屏标题尾部加荧光绿色相呼吸点（--led-green，1.4s ease-in-out 只动
//           opacity），与青色 LED 靠色相区分；prefers-reduced-motion 退化为常亮。
//         - 测试：409 → 449 断言（第 24 组 +7、第 25 组 +19、第 27 组 +10、
//           新增第 28 组计算状态徽章 10 条，第 26 组 2 条断言按 P0 修复改写口径）。
// 5.6.11：计算结果可视化（盈亏比对照图 + 保证金占用刻度）
//         新增 js/calc-visuals.js：在「计算结果」卡片顶部按 _calculateImpl 已算好的
//         数值渲染两张图，纯展示、不参与任何仓位或风控计算。
//         - 盈亏比对照：入场价居中，止损距离向左、目标距离向右，条长按【价格距离】
//           真实比例分配（grid fr），所以肉眼看到的长短比就是盈亏比，不必再心算两个
//           百分比的比值。目标价方向无效（与持仓反向或等于入场价）时不画绿色条，
//           改成中性灰 + 文字说明——不能把亏损侧的第二段画成「盈利」。
//         - 保证金占用：已有持仓保证金（斜纹）+ 本仓保证金（实色）堆叠条，
//           刻度线标在 80%（单笔上限）与 90%（聚合上限）两道真实截断边界上，
//           并给出剩余可用额。刻度位置由模块常量驱动，HTML/CSS 里不写死数字。
//         - 口径单一来源：gross/net 四个金额收敛进同一份 rrAmounts，图与结果卡片、
//           检查清单读同一次算出的同一份数值；RR 档位颜色继续走 rrMeetsMin()，
//           不新写第二套阈值。
//         - 清空路径全部收口：CalculationUI.renderBlocker / resetForCalculation 与
//           toggleSplitMode 关闭分支都会 CalcVisuals.hide()，阻断或清空时不残留
//           上一轮的 R:R 与保证金比例。参数变更未重算时 result-box.is-dirty 把整块
//           降到 50% 透明，明确「图已过期」。
//         - 口径说明：layoutRR 不认 direction（多空同一价格几何的比例一致），只认价格
//           距离与 grossProfit 的符号——所以「目标价填反方向」靠 grossProfit<=0 判定，
//           而不是靠方向字段。
//         - 实现坑：工厂内直接引用外层 IIFE 的参数 root 是 ReferenceError，rrMeets()
//           首次真实计算就抛错，被 _calculateImpl 的 try/catch 静默吞掉，面板只剩结果
//           卡片而两张图永不出——工厂开头必须显式捕获 root。
//         - 测试：449 → 513 断言（新增第 29 组盈亏比对照图与保证金占用刻度 64 条：
//           比例几何与单调性、无目标价/反向目标价的中性态、rrMeets 容差与卡片同口径、
//           80/90 边界与超出本金截断、renderBlocker/resetForCalculation 清空路径）。
// 5.6.12：全量计算口径复核收口（同一状态在不同权威下结论必须一致）
//         - 盈亏比偏差改口径：分子 rMultiple（分母 initialRiskAmount，纯毛利）与分母
//           targetRR（分母含费净止损）相除恒等于 netLoss / initialRiskAmount——只要
//           费用 > 0 就恒大于 1，完美执行也永远显示 +7.92% 并染绿，那测的是口径差。
//           改用「已实现净额 ÷ 计划净盈利」，完美执行恰好 1.000。plannedNetProfit 由
//           _calculateImpl 落库（= rrAmounts.netProfit，与 targetRR 同源），saveLog 与
//           saveSplit 两条写入路径都带；无该字段的旧记录直接排除、不退回 rMultiple 口径。
//         - 组合热量改按当前止损距离实时重算：止损移动只写 stopLoss 与 stopHistory、
//           不更新 riskAmount，读存档值会让仪表盘、检查清单、风控中心三面板继续用开仓
//           时的旧风险额——止损 1%→4% 时显示 10 而真实 400，同时仍按真实热量上色。
//           新增 positionCurrentRisk(pos) 作单一实现（effectiveEntryPrice 优先、止损或
//           仓位缺失才回退 riskAmount），三处共用。
//         - 组合热量闸门改为截断后复检：原先唯一的闸门调用用的是 #riskInput 表单原值，
//           而 Kelly 与四道截断（保证金 80% / 聚合 90% / 单品种占比 / 心态）都在它之后
//           执行。表单 1% + 半凯利建议 5% 会放过闸门、真实 5% 却超过 6% 上限。复检只
//           可能更严（用截断后的 effectiveRiskAmount）。
//         - 保证金单笔 80% 上限口径：它是「可用本金 × 80%」不是「本金 × 80%」，可用本金
//           = 本金 −（已有保证金 + 滑点 + 手续费）。刻度标签改「单笔 80%」，并随已有
//           持仓左移；calculator 的截断提示同步改口径并给出占本金的真实百分比。
//         - RR 分档统一走 rrMeetsMin（含 toFixed(2) 显示精度容差）：原先 distClass 用
//           裸 >= 3 / < 2，1.9999999962 会同时出现「黄卡 + 红色距目标子块 + 不足 2:1」
//           三种互相矛盾的提示。
//         - 维护保证金率单一来源 loadMmr()：强平价对 MMR 极度敏感——mmr = 0 退化成
//           「零缓冲」强平价、calculator 会把 maxViableLev 算成 0，mmr = NaN 让整列变
//           NaN。原先三处读取点各写一份、只有 calculator 判了 > 0，同一份设置在三个
//           面板给出不同强平价。0 / 负 / 非数字 / 字符串数字全部归一到默认 0.5%。
//         - 复盘 R 倍数回退分母改 initialRiskAmount：部分平仓后 riskAmount 被按比例缩减，
//           拿它当 1R 会让 R 随分批次数虚高（已平 50% 高估 2 倍、80% 高估 5 倍）。顺带
//           修掉 rMultiple || '' 把合法的 0R（保本）判成缺失而丢掉。
//         - 收尾事件链：syncCloseBookkeeping 收尾时把收尾事件【追加】成 closes 最后一条，
//           而不是清空整链。原写法同时坏在三处：打破 sum(ratio)===closedRatio 不变量、
//           分批历史从 CSV 往返里彻底消失、modals.js 靠 closes 判定「这条记录曾分批」
//           失效。
//         - 分批链收尾结算：saveEditLog 原先在 syncCloseBookkeeping 跑完【之后】才判断
//           是否分批，closes 被清空后判定失效、收尾编辑走「剩余仓位单腿重算」，把已实现
//           的 95 覆盖成 15（少记 79%，且下游胜率/权益曲线/回撤/夏普/凯利只读 pnlAmount）。
//           改为进函数前用快照判断，收尾累加最后一腿、不重算单腿。
//         - 已平仓记录必须带盈亏金额：modals.js saveEditLog 与 io.js validateFields 双守。
//           isClosedTrade 因 pnlAmount 为空判「未平仓」，这类记录既进不了胜率/期望值/
//           资金曲线/凯利样本，又反向进入持仓统计虚增保证金、抬高组合热量，而 CSV 里仍
//           标着已平仓。注意 Number('') === 0：CSV 空单元格必须先按空处理，否则正好漏掉
//           要拦的那一半。
//         - CSV：新增「目标盈亏比」「计划净盈利」两列并进字段映射与数值字段表（缺列会让
//           偏差指标样本量静默缩小）；时间列改 ISO 8601（带秒与时区）——fmtTime 是本地
//           时区的 yyyy-MM-dd HH:mm，丢秒又丢时区，换机导入整体偏移 8 小时，下游按日分桶
//           的熔断/连亏/夏普/权益曲线全跟着错，秒丢失还会让同一分钟两笔被判重复静默丢单
//           （导入侧用 new Date()，ISO 与旧格式都兼容）；数值列剥千位分隔符与空白——Excel
//           把单元格设成千分位导出 "1,234.56"，parseFloat 只取逗号前一位（→ 1），26 个数值
//           列全部静默截断且无告警；0 条候选与去重结果在覆盖/追加提示里明确披露。
//         - 盈亏比对照图：stopPrice 缺失时 stopDist 走兜底——原写法 Math.abs(entry − 0)
//           = entry 使 stopDist 恒 > 0、兜底 if 永不可达，条被画成满宽、注脚显示 100%。
//           保证金图可用本金口径写清：非负可用本金优先（它允许低于「本金 − 已有保证金」，
//           滑点与手续费也是真实占用，夹回去会把占用算少），负值或缺失才退回纯保证金口径，
//           大于本金夹到本金；刻度 CSS 位置去尾随零，默认态正好是 '80%'。
//         - 统计小修：win/loss 比的 Infinity 分支原是死代码（Infinity > 0 为真、
//           Infinity.toFixed(2) 输出字符串 'Infinity'，同面板的 profitFactor 却正确显示
//           ∞）；成本侵蚀分母改毛盈亏（原用含费净额却提示「毛盈亏」，4.25% vs 正确 4.08%）。
//         - 删除「止损触发损失行」的重复渲染：只有「分批建仓 + 至少一批填了独立止损」时
//           它才携带 L1「最大亏损」拿不到的信息（每批止损价与本批损失）。非分批、或
//           分批共用一个止损时它原本逐字重复 effectiveRiskAmount 与百分比，而止损距离
//           L2 又已用「止损 X%」给过——同一个数字在面板上出现两遍。显示边界抽成
//           shouldShowStopTriggerRows() 纯函数便于单测；不渲染时显式清空并隐藏，
//           否则从「分批独立止损」切回共用止损时上一轮批次行会残留。
//         - 测试：513 → 588 断言（新增第 30 组口径统一与显示边界 75 条：positionCurrentRisk
//           九态、loadMmr 七态、热量按当前止损重算与闸门 blocked、exportCSV→parseCSVImport
//           全往返、千分位、fail-closed 校验、盈亏比偏差口径恒等式、APP_VERSION 与本页
//           所有 script 的 ?v= 一致性、止损触发行显示边界 12 态；第 13 组收尾分支按新不变量
//           改写，第 29 组两条刻度断言按「单笔 80%」标签改写）。测试页原先从没加载过
//           version.js，第 30.8 组一引用 APP_VERSION 就让整套断言在 runAll 里 ReferenceError
//           归零（total=0，比一条失败更隐蔽），现已补入。
var APP_VERSION = '5.6.12';
