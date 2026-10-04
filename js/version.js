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
var APP_VERSION = '5.6.10';
