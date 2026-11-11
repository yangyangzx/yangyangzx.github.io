# Changelog

完整版本历史（v5.6.35 起从 js/version.js 顶部注释迁出；此后每版变更直接追加到本文件，
不再写进生产 JS——此前 960 行脚本里 953 行是注释，每次刷新白付 35 KB）。

---

// 5.6.48：侧栏模块按钮「流动柔光」改良版（2026-11-11）
//   背景：用户提供 Uiverse「12 光斑金黄 CTA」的 CSS，问能否套到左侧 7 个模块按钮。
//     评估结论：不建议原样套用 —— 固定金黄 + 白字（对比度约 1.5:1）会把
//     --nav-hue 的 7 色相锚点抹平，7 项同亮使 active/inactive 层级消失，
//     12×7=84 个 blur 光斑常驻 infinite 动画持续吃 GPU；且 .wrapper / .circle
//     的 DOM 与 :before 内阴影环会和现有凹槽立体结构（浮起层 ::before /
//     色标 ::after）正面撞车。用户拍板「改良版」：只借流动光斑，不搬它的形。
//   —— css/layout.css ——
//     新增两团从 --nav-hue 派生的 radial-gradient 柔光，圆心由 @property
//     <percentage> 变量插值（navGlowDrift 9s），仅挂在 .nav-item.active::before，
//     其余 6 项零动画；hover 只覆写 --nav-glow-duration 到 3.2s 做加速，
//     不新开动画。零新增 DOM，不动 7 色相 / 凹槽立体 / 双主题 / focus-visible。
//     不支持 @property 的浏览器定格成静态柔光，按钮仍可读。
//   —— 顺带修一个真缺陷（P1）——
//     文件顶部 `body { animation: none; }` 只作用于 body 自身，animation 不继承，
//     navSweep / navDotPulse 在系统开启「减少动态效果」时照跑；补一条显式点名
//     .nav-item 及 ::before/::after 的 !important 兜底。
//   —— 守护 ——
//     新增 test/verify_nav_glow.js（18 条静态断言 / 12 点逐条独立注入），
//     覆盖作用域、颜色派生、无障碍、结构、成本与 layout.css 缓存戳一致性。
//     红测首跑 11 绿 7 红，改完 18/0，注入 12/12。
//   升版 5.6.48：version.js + index.html 49 处 + run-tests.html 18 处（含
//     APP_VERSION 绊线）+ manifest 3 处；npm test 33 项（23 正常 + 10 注入）/ 3742 条。

// 5.6.47：数据准确度收口（深度审计批次 2 / 3，2026-11-10）
//   背景：用户授权「代办的修复全部优化」，把 AUDIT.md 剩余 2 个 P0、15 个 P1 与
//     批次 3 结构项一次性修完。红测 test/verify_batch2.js 首跑 49 条断言 42 条报红。
//   —— P0-4 有效入场价双来源 ——
//     顶层 effectiveEntryPrice 按 orderType 取入场 ticks，三份滑点快照却按
//     stopType 重取 → 同一笔仓位落库 50000.1 与 50000.2 两个互斥价。
//     口径拍板：入场腿 ticks 一律由下单方式 orderType 决定（开仓滑点只与下单方式
//     有关），只有退出腿 ticks 按各腿执行类型区分；止损腿不再覆写 stopEntryTicks。
//     四价（顶层 / planning / stop / target 快照的 effectiveEntryPrice）统一。
//   —— P0-5 权益曲线 capital 重复计入 ——
//     有日志但全部缺 capital 时，旧实现回退 accountBalance（当前净值，已含已实现
//     盈亏）作起点再累加 Σpnl。改为 fail-closed：透出 capitalKnown=false / 空曲线，
//     由 getCurrentDrawdown().readFailed=true 触发开仓硬阻断；同时区分「零日志的新
//     用户」（正常，不拦截），避免把首笔开仓误拦。stats/dashboard/risk/analytics
//     全部改读同一决议结果，缺本金时显示「—」并给出设置提示，不再静默出数。
//   —— P1 口径统一 ——
//     P1-01 本周分桶补上界（getWeekRange / isInThisWeek，未来日期不再计入）；
//     P1-02 风控中心显示与硬闸门共用全量样本（computeTodayPnl 单一函数）；
//     P1-03 CAGR 与夏普共用 resolveStartEquity 同一本金决议；
//     P1-04 分析页 / 统计卡 / 权益曲线共用 getDisplayClosed 筛选样本；
//     P1-05 多腿部分平仓新增 weightedClosePrice（资金权重加权平仓均价）+ CSV 列，
//           末腿价仍保留在 closePrice / closes[] 里，不改写历史记录；
//     P1-06 成本侵蚀分母补 legacy slippageCost；
//     P1-07 MAE/MFE 基准统一取 getEntryFillForPnL（与 PnL 同源）；
//     P1-08 金额链统一 8 位精度（utils.roundAmount / PNL_DIGITS=8），
//           logs.js / modals.js 平仓与编辑链同源，100 笔 0.0049 不再被抹成 0。
//   —— P1 导入导出可逆性 ——
//     P1-09 值域告警与「列数不符已跳过」拆成两个数组，3 条未知 closeType 全部导入
//           且不再误报跳过；P1-10 IMPORT_NUM_FIELDS 剔除枚举 / 布尔 / 版本列；
//     P1-11 signals 导出改机器键 + ';'（新增导出侧断言 D10，导入侧保留历史中文
//           标签反查以兼容旧备份）；P1-12 strategyPattern 独立成列，不再拼进
//           strategyFramework 展示文案；P1-13 新增 parseImportNumber 统一 CSV 与
//           JSON 数值解析，识别欧式小数逗号 / 千位分隔并拒绝 Infinity。
//     CSV 末尾追加「加权平仓价」「形态方向/具体形态」两列（追加而非插入，旧列序号不变）。
//   —— 批次 3 结构与边界 ——
//     P1-15 设置页脏检查取消时回滚 URL（_rollbackUrlToCurrentView，
//           replaceState 不新增历史条目）；权益递推收敛到 utils.calcEquityCurve 一处，
//           删除 risk.js / skills-integration.js 两份与净值重复计入的兜底递推；
//     P1-16 calcRoundTripFee 改 toFiniteNum 并钳制负值；P1-17 本金走 toFiniteNum
//           + Number.isFinite 二次校验、极小本金拒绝、manual ticks 输入框默认留空
//           （不再预置 0 制造零滑点假设）、L1 文案按实际两腿 ticks、负 targetRR 拦截；
//     D-06 README / CLAUDE 修正「完全离线」口径（图表库走 CDN + chart-guard 降级）；
//     D-07 清理 13/15/16/18 个跑测器、665 条断言、28 处缓存戳、5.6.37 等历史数字。
//   —— 验证 ——
//     test/verify_batch2.js：6 组 50 条断言，--inject 25 个注入点逐条独立 boot 干净
//       JSDOM 全部复红（25/25）。首批 23/24：P1-11 导出写中文标签被导入侧反查兜住，
//       往返断言 D5 仍绿；补 D10 专门守护导出侧后 24/24。关闭任务前的跨模块同类
//       审计又发现 modals.js:1330~1390 编辑平仓链整段金额仍用 toFixed(2)（C7 首版
//       只查「文件里出现过 roundAmount」，恒真抓不住）—— 修齐 9 处为 roundAmount，
//       强化 C7 为「金额链累计字段禁止 parseFloat(...toFixed(2/8)) 落库」并补第 25
//       个独立注入点，最终 25/25。positionSize / pnlPercent 等按业务 2 位口径落库，
//       不属 P1-08 范围，未改（不为改而改）。
//     npm test：31 项（22 正常 + 9 注入自检）/ 3724 条断言，无存量回归。
//   版本四处同步 5.6.47：js/version.js / index.html 49 处 ?v= / run-tests.html
//     17 处 ?v= + APP_VERSION 绊线 / manifest.json 3 处 ?v=。

// 5.6.46：门禁可信化 + 数据不丢（深度审计批次 0 / 1，2026-11-10）
//   背景：四组只读专项审计 + 14 个 jsdom 端到端探针，实证 6 个 P0。本版先修
//     「验证结论不可信」与「数据静默丢失」两类前置问题；完整台账见 AUDIT.md。
//   —— 批次 0：门禁可信化（P0-1 / P1-18）——
//     旧 test/run-all.js 只信 exit code、靠正则猜 7 种中文汇总文案（基线 18 个
//     跑测器里 7 个显示「(无摘要)」）。实证：输出「失败 5」却 exit(0) 的假跑测器
//     与零断言跑测器都被判 PASS；--inject 从不进 npm test；失败时 results 双 push；
//     _verify_bugs.js（14 条断言）从未纳入 SUITES。
//   新增 test/_gate.js 统一机器可读契约：GATE PASS=n FAIL=n TOTAL=n /
//     GATE INJECT CAUGHT=n EXPECTED=n；19 个存量跑测器收尾各加一行 emit，
//     不动原有汇总文案与 process.exit 逻辑。
//   重写 run-all.js：SUITES 改 [label, file, min]，min 为实测断言下限；
//     evaluate() 只认契约、G1~G9 逐条 fail-closed（断言结果优先于 exit code）；
//     修双 push；补跑 _verify_bugs.js；新增 INJECT_SUITES 让 --inject/REGRESSION
//     反向用例进入 npm test；全局「断言总数 >= Σmin」再兜一层防退化。
//   新增 test/verify_gate.js：把真实 run-all.js 源码复制到临时 fixture、只替换
//     两个 SUITES 字面量后 spawn，测的是真实判定逻辑，生产文件零测试钩子。
//     15 个端到端场景 + 5 条静态守护；--inject 11 条守卫逐条独立变异。
//   —— 批次 1：数据不丢（P0-2 / P0-3 / P0-6 / P1-14）——
//   P0-6 js/utils.js _localeToISO 把旧版 zh-CN 本地墙钟时间硬拼 'Z'，UTC+8 下
//     2026/11/09 20:00 记成 20:00Z（应 12:00Z），toLocalDateStr 漂到 11-10，
//     今日/本周/连亏/熔断/夏普分桶全错，且与导出侧 io._safeISOString 不对称。
//     改为本地 Date 构造 + toISOString()，并拒绝日历溢出把脏输入伪装成合法 ISO。
//   P0-3 js/settings.js loadSettings() 返回可变缓存本身，任何消费点原地改一个
//     字段就把日亏硬闸门从 500 放大到 4500，而磁盘仍是 5。改为一律交出深拷贝，
//     写盘失败分支补 _clearSettingsCache()（内存/磁盘不再分叉）。
//   P0-2 js/storage.js saveLogs 全量覆盖，另一标签写入的记录被静默抹掉。新增
//     _logsDiskBaseline + _reconcileLogsWithDisk()：磁盘被别的标签改过时以磁盘
//     为基合并、同 id 本标签优先、对账进来的数据同样走 _sanitizeLoadedLogs；
//     loadLogs / 写盘成功 / 两处 storage 同步分支都同步基线。
//   P1-14 restoreFromAutoBackup 直接 logs=obj.data，跳过迁移/补 id/脏值隔离。
//     新增 _normalizeRestoredLogs()：数值归一 → migrateLogsToCurrentSchema →
//     sanitizeLogNumbers → genLogId；失败整批拒绝，恢复后 saveLogs() 也校验返回值。
//   —— 揭出的存量假绿断言（按纪律改真链路，未回退修复）——
//     全量首跑主回归 2 条 / verify_config_fix.js 6 条报红：它们靠「原地改
//     loadSettings() 缓存」造场景，从未验证真的写盘。test/run-tests.html 补齐
//     setTpRR1/2/3 元素（否则 saveSettings 在 tpRR 循环直接 return）；
//     verify_config_fix.js 四个 setter 补 _clearSettingsCache()，C4 期望值迁移为
//     「null 由唯一净化入口回退、15 正常落库读回」并保留真链路断言。
//   新增 test/verify_data_integrity.js：TZ=Asia/Shanghai 下 jsdom 加载真实
//     index.html，A 时间 5 / B 缓存 4 / C 并发 3 / D 恢复 4 共 16 条；
//     --inject 4 个注入点各自单独 boot 干净 JSDOM，4/4 全捕获。
//   版本四处同步 5.6.46：js/version.js / index.html 49 处 ?v= / run-tests.html
//     17 处 ?v= + APP_VERSION 字面量绊线 / 本文件；manifest.json 3 个 icon src
//     的缓存戳同步；README.md / CLAUDE.md 顶部版本同步。
//   验证：npm test 29/29 全绿（21 正常 + 8 注入自检），断言总数 3674 / 下限
//     3674（基线 3624 + 补跑 14 + 门禁 20 + 数据完整性 16，无退化）；
//     verify_gate --inject 11/11、verify_data_integrity --inject 4/4；
//     前后同一假绿 fixture：修复前 exit=0 全 PASS → 修复后 exit=1（G5/G1 各判红）；
//     改动 JS 全部 node --check 通过。
//   未修（下一版）：P0-4 有效入场价双来源、P0-5 权益曲线缺 capital 回退当前净值，
//     以及 AUDIT.md 中 13 个 P1 与 7 个产品决策项。

// 5.6.45：左上角品牌区改为「回主入口」链接（2026-11-09）
//   背景：.nav-logo 一直是纯 <div>，无 href / 无监听 / 无 cursor，点击图标或
//     「交易风险管理终端」文字完全无反应；而左上角品牌区按惯例应可点回起点。
//   决策（方案 A，已拍板）：回到开仓计划 planner。语义是「重置到默认落地页」，
//     不是「打开某个功能」。实证依据：_currentView 初值、无 hash 时 switchView
//     ('planner')、index.html 初始 active/aria-current、导航顺序注释四处一致；
//     若改成仪表盘，须连默认视图 / 初始高亮 / 深链兜底一起改，否则首屏与
//     logo 落点分裂。仪表盘是只读速览，planner 才是 README 定义的工作流行动入口。
//   实现：.nav-logo 由 div 改 <a href="#planner" data-view="planner">，
//     带 aria-label="返回开仓计划首页"（否则读屏把副标题读进链接名）、title；
//     图标 alt 保持空。navigation.js 的 navItems 选择器扩到 nav-logo，复用
//     activateNav —— 自动继承设置页脏检查、退出批量模式、销毁图表、滚动置顶、
//     关移动端抽屉、pushState。刻意不加 .nav-item，避免套上导航凹槽样式；
//     updateNavActive 仍只查 .nav-item，logo 不会被误标 active。
//     同时给 activateNav 加修饰键守卫：meta/ctrl/shift/alt 或中键直接放行，
//     交还 <a> 原生「新标签打开」语义（原来一律 preventDefault 会吃掉 Cmd+点击）。
//     layout.css 补 cursor / hover 提亮标题 / :active / :focus-visible 描边。
//   新增门禁：test/verify_nav_logo.js（第 18 个跑测器，jsdom 真链路点击 +
//     --inject 逐条独立注入自检），守护 DOM 结构、点击落点、键盘激活、修饰键放行、
//     设置页脏检查不被绕过、同视图点击不重复绑定事件。
//   版本四处同步 5.6.45：js/version.js / index.html 49 处 ?v= / run-tests.html
//     17 处 ?v= + 30.8 组 APP_VERSION 字面量绊线 / 本文件；manifest.json 3 个
//     icon src 的缓存戳同步。
//   验证：npm test 18/18 全绿且断言总数无退化（主回归 675 / 不变量 2207 /
//     核心 67 / 资产 15 / 导航 12）；verify_nav_logo.js --inject 9/9、
//     verify_assets.js --inject 7/7 全被捕获；node --check 4 文件通过；
//     引用完整性 0 missing、JSON 可解析。
//
// 5.6.44：全站品牌图标换版 —— 统一由 assets/logo.png 派生（2026-11-09）
//   背景：新增 assets/logo.png（1254×1254 RGBA 透明源图：深灰圆环 + 字母 T + 绿色
//     K 线上升曲线）。此前 favicon 直接引用这张 584KB 透明大图，而导航 / apple-touch /
//     PWA 图标仍是 2026-08 的旧版浅色品牌全图（含文字，缩到 40px 糊成噪点）——
//     同一站点并存两套品牌标识。
//   底色实证：把源图分别铺 #0f1419 / #F9F6ED / #FFFFFF 缩到 192px 对比，深底上
//     深灰圆环与 T 几乎消失（只剩绿色曲线），浅米底全部清晰；且 #F9F6ED 与
//     index.html 的浅色 theme-color 一致，深浅两种界面下都是可辨识的品牌徽章。
//   产出：icon-192 / icon-512（purpose=any，同名覆盖靠 ?v= 破缓存）、
//     icon-maskable-512（图形缩到 76%，落入 maskable 中心 80% 安全圆）、
//     apple-touch-icon 180、favicon-32 / favicon-16、favicon.ico（16/32/48 三帧）。
//     全部 PNG24 不透明，避免 iOS 把透明区渲染成黑块。
//   接线：index.html 图标组 + 导航 img + manifest.json（purpose 由「any maskable」
//     拆成 any / maskable 两条，避免 Android 裁掉圆环外沿）；layout.css 去掉
//     .nav-logo-img 的 padding / background 双重边框；README 资源清单同步。
//   版本四处同步 5.6.44：js/version.js / index.html 43 处 ?v= / run-tests.html 17 处
//     ?v= + 30.8 组 APP_VERSION 字面量绊线 / 本文件。
//   新增门禁：test/verify_assets.js（第 17 个跑测器，15 条断言 + --inject 自检），
//     守护资源引用完整性、四处缓存戳同步、PNG 尺寸/不透明性、ICO 帧数与
//     any/maskable 分离。红测阶段注入自检抓出 2 条「恒假 / 漏判」断言并修正，
//     最终改为逐条独立注入、7/7 全被捕获；npm test 17/17。
//   收尾清理（同日）：assets/logo.png（584KB 透明源图）页面 / PWA 从不加载，属零引用
//     冗余，经确认后移入系统废纸篓；原件副本仍在 ~/Downloads/LOGO.png
//     （SHA256 dbe3c122…）。assets/ 现只留 7 个在用的不透明成品，它们是唯一权威。
//     verify_assets.js 移除 source-kept、补 no-orphan-assets（总数仍 15 条，注入改逐条
//     独立 7/7）；index.html / layout.css / README / 项目记忆同步；npm test 仍 17/17。
//
// 5.6.43：跨模块计算逻辑全面修复 —— 12 条实证缺陷 + 口径变更收口（2026-11-09）
//   立项：v5.6.42 全量门禁 15/15 全绿（3300+ 断言），但四组并行审计 + 两轮 jsdom
//     真链路探针复现出 12 条「算错钱 / 闸门 fail-open / CSV 往返毁库」缺陷。
//     既有断言保护单模块计算自洽，不覆盖跨模块接线、异常路径与 UI↔落库口径。
//   红测：新增 test/verify_crossmodule.js（接入 run-all.js，第 16 个跑测器），
//     修复前 37 条红；修复后 56/0；--inject 退回旧实现复现 22 条红。
//
//   【批次 A · 纯 bug，零口径变更】
//   1. P0 半凯利钳制顺序：完整凯利与半凯利各自 Math.min(raw, limit)，raw>2×limit 时
//      两者都变 5%，「半凯利」= 完整凯利，实测本金 10000 风险额 500 应为 250。
//      改为「先钳完整凯利，再取其一半」，比值恒 0.5（skills-integration.js:343）。
//   2. P0 阈值读侧 fail-open：五道闸门各写 Number(settings.X)||default，手改
//      localStorage 把 dailyLossLimit=999 得到 99900 U 上限（应 500）、集中度 999%。
//      新增 settings._sanitizeLoadedSettings() 在 loadSettings() 唯一入口按
//      SETTINGS_VALIDATORS 区间净化，数字字符串先归一（保住 loadMmr('0.8') 行为）。
//   3. P0 CSV 往返毁库：导出把 closeType 写成中文标签、导入只映表头不映值，
//      partialTP → 「部分止盈」→ isClosedTrade 由中间态误判已全平，且不可逆。
//      导出改机器键；导入新增 _normalizeCsvCloseType 中文反查 + _isKnownCloseType
//      值域告警；未知值保留原值，避免绕过 _prepareImportedRecords 的 fail-closed 校验。
//   4. P1 非法 closeTime 毁整批导出：new Date('not-a-date').toISOString() 抛
//      RangeError 被外层 catch 吞成「导出失败」，2 条日志导出 0 行。
//      新增 io._safeISOString()，非法值置空 + 计数告警，其余照常导出。
//   5. P0 当日连亏字典序排序：'T18:00+08' 与 'T11:00Z' 字典序颠倒了真实时刻，
//      末尾盈利被误判 streak=1（应 0），驱动降仓与熔断的结论反转。
//      stats._closedTimeMs() 按时间戳排序，非法时间置最前（不冒充最后一笔）。
//   6. P1 部分平仓 legacy 滑点重复扣：fee/仓位/风险额都按剩余比例缩减，唯独
//      slippageCost 漏了；三腿累计 80 U vs 整笔 90 U。抽出纯函数
//      logs.applyPartialShrink()，五段散写收口并补滑点；closedRatio 封顶 100。
//   7. P1 heatWarnMax 死键：SETTINGS_DEFAULTS.heatWarnMax 恒为 8 且优先于
//      portfolioHeatMax 被读，用户设 15 完全无效；默认 8 > 硬上限 6 使 warn 档
//      永不可达。删别名、改以 portfolioHeatMax 为唯一来源、默认 8→5。
//   8. P1 分批展示 140%：70/70 两批落库已归一 50/50，结果区表格仍按原始
//      ba/100 各显示 21000 U。抽 computeNormalizedSplitAlloc()，展示/触发行/落库同源。
//   9. P1 RR 双入场价：目标腿用 orderType 的 entryTicks、止损腿用 stopType 的，
//      同一笔仓位出现 50000.1 / 50000.2 两个入场成交价。目标腿复用 stopEntryTicks。
//  10. P1 限价单费率不联动：切 orderType 后 #feeRate 仍 0.08，设置页
//      feeRateLimit 形同虚设。app.js 加 change 监听 + data-fee-auto 区分手填值。
//  11. P1 Infinity 漏网：utils.safeParseNum 与 stats.computeWinLoss / MAE-MFE
//      仍用 parseFloat + 全局 isNaN。统一 toFiniteNum；CSV 数值列加有限性检查。
//  12. P2 分批常量字面量：渲染层 `<3` 与 MAX_SPLITS=5 冲突，加到 3 批后
//      「增加一批」按钮消失，4/5 批不可达（CLAUDE.md 老隐患）。全部改读常量。
//
//   【批次 B · 口径变更（本轮获授权）】
//   - 年化收益改 CAGR：期初/期末权益 + Math.pow(..., 365/span)，以 % 显示；
//     本金缺失或权益被打穿时 fail-closed 显示「—」。原为金额线性外推（+36500 U/年）。
//   - 组合热量预检降级为软标记：表单风险只是估算值，硬阻断会拒掉「表单 10%
//     但半凯利 1%」的合法计划；唯一硬阻断保留在截断后复核点（用 effectiveRiskAmount）。
//     readFailed 仍 fail-closed 硬阻断。
//   - 凯利小样本收缩：calcKelly 新增第 8 参 sampleCount，n<30 时按 n/(n+20) 收缩，
//     结果透出 shrinkFactor / samples；calculator 传 dataset.kellySamples。
//   - 夏普筛选态本金：筛选样本每条都有合法 capital 时用其均值作期初权益，
//     缺字段时 fail-closed 显示「—」，不再拿全局本金摊薄筛选样本收益。
//   - RR 色阶读 settings.minRRRatio（原写死 3/2，与结果卡片口径脱节）；
//     权益曲线非法日期显式兜底（NaN 不再参与排序）。
//
//   【刻意未改 · 已复核为正确或会放宽风控】
//   - 利润因子：pnlAmount 本身就是扣费扣滑点后的净额，当前 grossProfit/grossLoss
//     已是净额口径（变量名误导，非数值错误），不为了改而改。
//   - 集中度方向净额：同品种双向逐仓都实际占用保证金，累加（绝对值口径）才是
//     保守正确；改净额会掩盖对冲仓位风险、放宽闸门。
//   - 导入设置：v5.6.14 已有 _validateImportedField 逐字段校验，读侧净化是第二道防线。
//
//   【断言迁移】run-tests.html 半凯利三处期望值 0.05→0.025 并补比值断言（674→675）；
//     verify_param_fix.js 回撤场景改用合法区间值（亏 3000 / 阈值 50）与默认警告线 5；
//     verify_sideeffects.js / verify_core_algo.js 越界 riskHeatMax:50 改为合法 15。
//   验证：npm test 16/16 全绿（主回归 675、不变量 2207、核心 67、跨模块 56）；
//     node --check 全过；no-undef 真泄漏 0；版本四处同步 5.6.43。

---

// 5.6.42：核心算法数学口径升级 + 存量脏值全链路收口（2026-11-09）
//
//   立项：5.6.41 收口了正确性/稳健性/结构，但刻意留下三项「改了会放宽风控或破坏历史
//   可比性」的数学口径，以及一条「存量脏日志读端放行」的残余风险。本轮按杨老板「全部修复」
//   授权，连同迁移方案一起做完，四项全部以「先红测 → 再修 → 注入自检」闭环验证。
//
//   红测实证（升级前，test/verify_core_algo.js 追加 H/I/J/K 四组，共 27 条红）：
//     · 强平价旧公式不满足逐仓恒等式 IM−亏损=MM：10x/0.5% 多头给 90954.77，正确 90452.26
//     · 分批 100/200 各 50% 资金 → 旧算术均价 150，正确调和均价 133.3333（高估 12.5%）
//     · 加权止损距离缺 E/bp_i 因子：bp=100/200、dist=10/40 → 旧 25，正确 20
//     · 夏普 mean=1.6667 是「日盈亏金额」不是收益率；sd 用总体 ÷n；无风险利率缺席
//     · 7 个文件仍有 parseFloat(pnlAmount)||0，parseFloat('Infinity') 一路放行
//
//   【数学 1】强平价改单一计价口径（utils.js）
//     LP_long = E(1−IMR)/(1−MMR)、LP_short = E(1+IMR)/(1+MMR)，IMR=1/L。
//     旧式 E(1−IMR+MMR)/(1−MMR) 把「维持保证金按开仓名义」的分子与「按强平价名义」
//     的分母拼接，两种互斥口径混合。修后满足严格恒等式，多空对称。
//     MMR 显式上界 [0,1)；1x（IMR=1）时 LP=0 是合法解（价格归零才亏完本金）——
//     首次实现误把 <=0 判 NaN，导致 216 组参数被 liquidation-unsolvable 误拦、
//     不变量跑测器断言从 2207 掉到 1910；已修正并补 H8/H9/H10 三条护栏，
//     复跑精确恢复 2207。
//   【风控不变】新公式零缓冲点在 1/MMR=200x，但 calculator.js 的杠杆硬阻断
//     【刻意仍锁 1/(2×MMR)=100x】，注释写明这是留一倍价格缓冲的保守风控边界、
//     不是公式推导结果。修 bug 不等于放宽风控，禁止顺手改成 1/mmr（H7 源码级断言守护）。
//
//   【数学 2】分批加权入场价改调和平均（calculator.js / modals.js / risk.js）
//     E = Σalloc / Σ(alloc_i/price_i)：alloc 分配的是资金，数量 q_i ∝ alloc_i/price_i，
//     等效均价必须是「总资金 / 总数量」。同口径收口三处：computeWeightedEntry、
//     doSaveSplit 内联的第三份算术平均、risk.js 聚合持仓加权均价（同一个数学错误）。
//     加权止损距离抽成纯函数 computeWeightedStopDistance，补 E/bp_i 量纲因子：
//     dist = E × Σ(w_i·dist_i/bp_i)；calculate() 只消费结果，不再内联第二份实现。
//     历史兼容：新记录 getSplitEntries/doSaveSplit 打 weightedEntryModel='harmonic'，
//     旧记录无该字段，读端（modals.js:259）只读落库值、绝不按 entries 重算。
//
//   【数学 3】夏普改日收益率口径（utils.js / stats.js）
//     逐日递推权益 E_d = E_{d-1} + pnl_d，r_d = pnl_d / E_{d-1}；startEquity 为必需
//     入参（stats.js 从 getAccountCapital() 取），缺失时返回 null 并显示「—」+ 原因，
//     绝不拿金额冒充收益率。标准差改样本 ÷(n−1)，新增 riskFreeRate（年化小数）。
//     日期字典序排序后才做权益递推（Object.keys 插入顺序依赖日志输入，不排序会错位）。
//     返回 basis='return' / startEquity / endEquity / riskFreeDaily 供 UI 与复盘核对。
//
//   【数据】存量脏值全链路收口
//     · 新增全局 toFiniteNum(v, fallback)：语义等价于 parseFloat(x)||0，额外挡 ±Infinity/NaN。
//       机械替换 js/ 下 79 处 parseFloat(X)||0（含嵌套表达式与 || 链），语法全过。
//     · 新增 utils.sanitizeLogNumbers(rows)：在唯一数据入口 loadLogs() 的 JSON.parse
//       之后无条件原地规范化历史日志（递归含 closes[] / splitEntries.entries[]），
//       只改「本该是数字却非有限」的字段，普通文本/合法数值/null 一律不动
//       （null 改成 0 会凭空造一笔 0 盈亏已平仓交易，反而污染胜率分母）。
//       只改内存、不改写磁盘原始证据；一次 toast + console.warn 告知字段数。
//       多标签同步的两处 logs=remoteLogs 与 migrateLogsToCurrentSchema（导入路径）同样调用。
//
//   【迁移的断言】run-tests.html 20 组（夏普，全部期望值改收益率口径）、21 组（强平价，
//     新公式期望值 + 恒等式 + 100x 缓冲 + 200x 零缓冲 + MMR≥1 + 1x 合法解）、
//     30.11 组（加权均价 50700 → 50688.07339 + 模型标记）；verify-fixes.html 同步调和口径。
//
//   验证：核心跑测器 28 → 67 条断言 / 0 失败（其中 H10 1x 真计算、J9~J11 统计面板
//     UI 真链路、K10 loadLogs 真链路，都不是纯源码正则）；--inject 注入旧实现 33 条红；
//     全量 npm test 15/15 全绿（主回归 665 → 674，不变量精确恢复 2207）；
//     node --check 全过；no-undef 专项 1212 条跨文件全局误报、真泄漏 0 条。
//   版本四处同步：js/version.js → index.html 43 处 ?v= → run-tests.html 17 处 ?v=
//     （含 30.8 组 APP_VERSION 字面量绊线）→ 本条目。
//
---

// 5.6.41：核心算法升级 —— 闸门真实早退 / 非有限数终检 / 单次计算取数上下文（2026-11-09）
//
//   立项：基线 14 个跑测器、3300+ 断言全绿，但保护的是「计算自洽」，不覆盖异常路径与
//   数值稳健性。新增 test/verify_core_algo.js（28 条断言 + --inject 注入自检）：
//   先写红测证明缺陷真实存在（21 红），修复后转绿，再注入旧实现证明断言有捕获力（9 红）。
//
//   ① P0 · 连亏熔断的早退被 IIFE 吞掉（calculator.js）
//      renderHardBlock() 在匿名 IIFE 内 return，只退出 IIFE；主流程继续跑到 setCalc()，
//      把刚渲染的阻断 UI 覆盖成「计算成功」。实测当日连亏 3 笔达阈值仍算出
//      99512.44 USDT 仓位。现改为 IIFE 只写 _streakBlock 描述、主流程统一早退；
//      取数异常路径同样 fail-closed。该闸门此前零断言覆盖。
//
//   ② P0 · 结算与凯利的非有限数终检（logs.js / skills-integration.js）
//      parseFloat('Infinity') → Infinity → (-Infinity).toFixed(2) → "Infinity" →
//      JSON.stringify → null，整笔交易被 isClosed 判成未平仓，从胜率/曲线/凯利样本消失；
//      负 slippageCost 还会反向放大盈亏（fee 侧原本有 `fee < 0 return null`，两者不对称）。
//      calcKelly 原用全局 isNaN，Infinity 与 winRate=NaN 都能穿过全部钳制输出 NaN 仓位建议。
//      现：getLegacySlippageCost 用 Number + Number.isFinite 守卫（脏值/负值归零），
//      calculateCloseSettlement 与 calcKelly 各加出参终检（任一非有限字段整体返回 null）。
//
//   ③ P1 · ATR 止损与仓位有限性前移
//      calcATRStop 原只判 `!atrValue`：Infinity 合法、极小值×极小倍数下溢成 0，
//      使 positionSize = Infinity 并先写进 capMsg 文案（"Infinity"）。现入参/出参全程
//      Number.isFinite；计算管线在仓位求解结束处统一拦截，沿用 available-margin-limit
//      阻断码，不新增对外口径。
//
//   ④ P1 · 闸门 readFailed 语义对称
//      组合热量早已透出 readFailed，但预检与复核两处消费点只判 blocked；日亏损在
//      capital<=0 时用 Infinity 让闸门恒不触发、集中度直接 pass:true。现三道闸门统一
//      透出 readFailed / capitalKnown，四处消费点全部 fail-closed（主路径 capital>0 不受影响）。
//
//   ⑤ P1 · 单次计算取数上下文（calculator.js）
//      _numSetting 原先每调一次都 loadSettings() 一次；实测单次 calculate() 共 30 次调用。
//      现 calculate() 入口建立快照、finally 释放，_numSetting 在计算期间只读同一份数据，
//      实测降到 22 次（余量为其它模块直读）。顺带把 20+ 处手写 _calcCleanup() 收进
//      finally 单点兜底，消除「漏调 → _calculating 永真 → 计算按钮永久失效」这一类事故。
//
//   ⑥ 版本同步：项目原本 version.js / run-tests.html 停在 5.6.39、index.html 已是
//      5.6.40（正是 CLAUDE.md 警告的漏改一处的缓存事故隐患），本次四处统一为 5.6.41。
//
//   ⚠️ 已审计但【未改动】的三项数学口径（属产品决策，改动会放宽风控 / 破坏历史可比性）：
//      · 强平价 utils.js:479/487 把两种维持保证金计价口径拼接；但 run-tests.html 21 组
//        按此推导出「零缓冲边界 = 1/(2×MMR) = 100x」，calculator.js:940 的杠杆上限
//        硬阻断正依赖该边界。换成教科书公式会把上限放宽到 200x，必须连同闸门与
//        20+ 条断言一起改，不可单独动公式。
//      · 分批加权入场价 calculator.js:2080 用资金权重算术平均（严格应为调和平均），
//        加权止损距离缺 E/bp_i 因子；但 weightedEntry 已落库历史日志，
//        run-tests.html 30.11 组把 50700 写死，改口径会让新旧记录不可比。
//      · 夏普 utils.js:525-569 用日盈亏金额而非日收益率、÷n 总体标准差、无无风险利率；
//        run-tests.html 20 组按旧口径写死，且改收益率口径需要权益序列入参。
//      这三项需单独立项并给出迁移方案，不随本次稳健性升级夹带。
//
// 5.6.40 / 5.6.39 / 5.6.38：版本历史未在本文件留条目（本次审计发现），仅 index.html
//    的 ?v= 与 git log 可追溯。
//
// 5.6.37：编辑弹窗已全平→分批改判 P0 修复 + 裸调用守卫 + 编辑场景 S13-S15 补盲（2026-10-20）
//
//   ① P0 · 已全平记录切回分批加腿的账面重述链（modals.js saveEditLog 分批分支）
//      满载收尾（closedRatio=100、closeType=manualWin）的记录在编辑弹窗里切回 partialTP
//      「再平一笔」时，三个环节连锁静默失效，任何比率校验都发现不了：
//      a) _prePosSize = 裸 item.positionSize(=0) × 因子 → 结算基数 0，calculateCloseSettlement
//         返 null，本腿结算整段静默跳过——新腿只剩 syncCloseBookkeeping 的裸骨架
//         （无 price/pnl/fee/gross/time）；
//      b) 锁死的已全平回退预览值（pos=0 → 按 initialPositionSize 全仓重算，实测 139.69）
//         经 DOM 回读污染 item.pnlAmount/pnlPercent（实测两字段同为 139.69，P&L 结构破坏）；
//      c) syncCloseBookkeeping 按设计滤掉收尾事件，但其已实现的钱还躺在 realized
//         三源里——sum(closes[].ratio)===closedRatio、pos×frac===positionSize 等校验全自洽，
//         唯独 Σcloses.pnl ≠ realizedPnl（实测 45.32 vs 49.38）。
//      修复三件套：
//      · _prePosSize 在 pos<=0 时按 initialPositionSize 锚点 × fracBeforeEvt 还原事件前
//        剩余基数（全仓基数不能乘「剩余→剩余」因子——首个版本误乘因子，legGross 被算成
//        42 vs 正确 1.3125，靠探针实证纠出）。missing 初始锚点的旧数据不编造，行为同旧。
//      · 改判扣回（新代码块）：sync 后若被丢弃的收尾腿金额可从累计字段重建（守卫与
//        #1 FIX 的 _rpAccrue/_rfOk/_rgOk 同构），先全额扣回再由本腿结算累加新账——
//        改判语义 = 账面重述。扣回必须在 P1-3 费用锚点之前完成，否则剩余费用
//        会多含已扣回的一份（实测 baseFee 10.3125→10，锚点因此精确）。
//      · syncCloseBookkeeping 调用点随之移入该块（原调用点先于扣回引用拿不到
//        pre-sync 收尾事件；位置错误曾导致双重追加同腿、closedRatio 算到 100——S3 首轮回归抓出）。
//      数值验证（S14b）：49.38 − 4.06(收尾腿 pnl) + 1.21875(新腿) = 46.54 ≡ Σcloses.pnl；
//      realizedFee 10 − 0.3125 + 0.09375 = 9.78125 ≡ Σcloses.fee；gross 56.31；
//      剩余仓位 21.875、剩余费 0.21875 —— 五组恒等式全过。
//
//   ② renderLogs 跨模块裸调用加守卫（rendering.js:697/700）
//      updateStats / autoCountLossStreak 定义在 stats.js，与 rendering.js 是两份独立脚本：
//      全量 index.html 下同步加载恒可用，但半量测试环境（verify_close_type_consistency /
//      verify_logs_fixed 等只内联部分文件）稳定抛 ReferenceError，console.error 刷屏淹没
//      真错误。防线与 dashboard.js:282 / calculator.js:462 的跨模块守卫同模式
//      （typeof fn === 'function'），生产路径零行为变化。
//      注：已全平记录改滑点会经 item.slippageCost 进入收尾腿重建（这是 #2 FIX 以外的
//      结算权威路径），实测重建转负时亏损原因闸门会拦下并回滚（S13b 钉住）。
//
//   ③ 编辑弹窗交互链测试补盲（_edit_scenarios_body.js）
//      S13 已全平记录手动锁防线：emFee/emSlippageCost 刻意不进解锁名单（modals.js 550）
//      首次有断言——改费用/滑点预览恒冻结、手动标签常亮、保存后逐腿账本不动；
//      S13b 闸门：滑点经重建使 pnlAmount 转负 → 保存被拒 + 记录回滚 + slippageCost 未污染；
//      S13c 锁活性：改平仓价解锁重算（防线不是死锁）；
//      S14 5 腿满载链（MAX_SPLITS 只管建仓、closes[] 无上限）：50% 相对 5 腿 + 收尾，
//      Σ净 49.375 / Σ费 10 / 毛 59.375 与手工推导一致；满载后原始口径越界仍被拦、
//      剩余口径 30% 合法放行（口径分叉可见）；
//      S14b 改判场景 = ① 的数值验证；
//      S15 分批中间态手动锁：fee/滑点不复算本腿预览，比例改动仍解锁，费用锚点不被
//      emFee 之上的覆盖值污染。
//
// 5.6.36：applyKellyRisk 止损与凯利统计解耦 + planner 四处一致性缺口（2026-10-20 量纲审计）
//
//   ① P0 · applyKellyRisk 无 ATR 止损分支量纲不通（calculator.js）
//      原实现 slPct = kellyAvgLoss(USDT 金额) ÷ entryPrice(价格)，当作「止损距离比例」用。
//      avgLoss 是亏损金额（≈ 风险比例 × 本金），不是价格单位，量纲不成立；更根本的是该
//      映射在概念上无意义——任何止损宽度下触发止损的损失恒等于计划风险额
//      （仓位 × 止损距离比 ≡ riskAmount，由半凯利决定），「让止损损失 ≈ 历史平均亏损」
//      对任何宽度都不同时成立。实测 avgLoss=30U：ep=100 → slPct=30%、ep=50000 → 0.06%，
//      几乎总被打到 clamp 边界，生成的止损价与凯利统计完全无关；旧测试
//      verify_param_fix[8] 只断言 clamp 上限，绿灯掩护了 bug。
//      现走 provisional 统一口径（getProvisionalStopLoss：设置 provisionalStopPct /
//      ETH 0.8% / 其它 1%），并按 getStopLimitPct()（customStopLimit 唯一权威）收紧，
//      保证重算不被 custom-stop-limit-exceeded 闸门拦下。
//      verify_param_fix 新增 [8b] 组：avgLoss 30U/100U 止损一致、恒为 1%、同一宽度不随
//      entryPrice 漂移——旧代码三条全红。
//
//   ② P2 · 反推函数写入端守卫缺失（planner.js）
//      反推卡片 v5.6.23 从生产 DOM 移除后，#7 FIX 只给 #desiredRR / #reverseTP /
//      #reverseSL 的读取端加了 null 守卫，写入端仍是裸 `.value =`。生产不炸只因
//      #desiredRR 在首个守卫分支提前 return 掩护了路径；「desiredRR 存在而输出框不存在」
//      的部分 DOM（未来重接 UI 只接一半、测试桩不完整）会抛 TypeError，与注释宣称的
//      安全行为自相矛盾。新增 _reverseWrite() 统一写入（元素缺失静默跳过），
//      calcReverseTP / calcReverseSL 共 11 处写入全部改经它。
//      verify_param_fix 新增 [8c]：无 #reverseTP 时调用不抛错，旧代码抛 TypeError。
//
//   ③ P2 · computeWeightedTPRR 表单口径回退（planner.js）
//      calc 缺失时原先整体 return null，与行级 RR 分裂——updateMultiTP 行级经
//      getTPUnits() 有表单回退，本函数没有：表单已填三档止盈、「计算仓位」还没点时，
//      三行有含费 RR、组合行显示 '—'，同一卡片两套口径；saveLog 的 tpPlan.weightedRR
//      也恒 null（同源调用本函数）。现补 getTPUnits(false) 同源回退，并加方向一致性
//      校验（止损价与方向同侧属非法输入，此时返回 null，交由行级显示「逆势」）。
//
//   ④ P3 · 入场价变化不重置多止盈手工标记（planner.js: initMultiTPListeners）
//      多止盈价是「入场价 + RR 距离」的相对解，用户改入场价后旧手工 TP 已整份失效，
//      却因 _userEdited 残留被 autoCalcMultiTP 静默跳过重填，过期价格随后随 tpPlan
//      原样落库。#entryPrice 补 change 监听（程序化赋值不触发 change，分批模式的
//      updateEntryPriceFromSplit 回填不受影响）。
//
//   ⑤ P2 · 现货保证金占比截断归因缺「集中度」（planner.js: updateChecklist）
//      calculator.js 集中度分支对现货同样可能置 cappedByMargin = true，原现货文案只报
//      「聚合/交易所上限」，刻丢集中度归因——用户看到的截断原因与真实风控不一致。
//      补齐，与非现货分支对称。
//
// 应用版本 - 每次更新后递增，用于缓存清除
// 5.6.35：R 倍数 / 收益率的分母锚点收敛为单一权威（utils.resolveRMultiple / resolvePnlPercent）
//
//   问题：「有锚点用锚点、否则回退 settlement」这段三元此前在仓库里有 7 份副本——
//   logs.js 的部分平仓 / 部分后收尾 / 全新平仓三处，modals.js 的预览与两处落库。
//   它们语义相同但**写法不一致**：有的判 `!= null`，有的判 `!isNaN`，锚点是
//   "abc" 这类脏值时行为会分叉（`!= null` 通过、`> 0` 为 false，落到回退；
//   换成只判 `> 0` 的副本则会静默用 NaN 做分母，把 NaN 写进 rMultiple，
//   污染统计页的 R 倍数均值与排序）。
//   CLAUDE.md 早就写明「R 倍数分母唯一 = initialRiskAmount，全链一致」，
//   但这条不变量此前只存在于注释里，没有任何机制保证。
//
//   现收敛为 utils.resolveRMultiple / resolvePnlPercent，两个函数都做了
//   isFinite 守卫，业务层只负责取输入。新增落库路径若绕过它们，
//   verify_logs_fixed.js 的 R8 组（源码级计数 + 无内联三元）会红。
//
//   注意：本次**没有**合并 logs.js:confirmClose 与 modals.js:saveEditLog 的
//   簿记主流程——二者是「增量累加」与「替换重建」两种不同运算，强行合并会引入 P0。
//   本次收敛的只是两端共用的分母锚点选择这一层。
//
// 5.6.34：两处「设置项写了却没人读」的静默失效 + 测试门禁从假绿变成真绿
//
//   ① resetForm 写死手续费率 0.08（calculator.js）
//      _calculateImpl 优先读表单值、仅在为空/非正数时才回退 _getDefaultFeeRate，
//      所以 resetForm 里那行硬编码等于让用户在设置页调好的 feeRateMarket/feeRateLimit
//      被「重置」按钮静默改回去。现改走 _getDefaultFeeRate('market')。
//
//   ② 回撤告警阈值口径分叉（stats.js vs risk.js）
//      stats.js 的 statMaxDD 与 equityDrawdown 两处写死 `>=20 ? dd-danger : >=10 ? dd-warn`，
//      完全不读 settings.maxDrawdownAlert；而 risk.js 的风控中心读设置。用户把告警线从 20
//      调到 30，同一份回撤数据会在风控中心显示「安全」、在统计概览显示「危险」。
//      新增 utils.getDrawdownAlertPct / drawdownAlertClass 作为单一权威（含脏值守卫：
//      null 会让 `pct > null` 恒真、"abc" 会让比较恒 false），三处统一走它。
//
//   ③ 测试门禁此前是「假绿」：
//      - _rt_headless.js 是全仓唯一退出码正确的跑测器，却因一条断言把 jsdom 返回的
//        maxHeight "0" 与浏览器 "0px" 严格比较而永久 exit 1；
//      - 14 个跑测器里 6 个无条件 process.exit(0)，失败完全不可见
//        （verify_logs_fixed 长期红着 2 条，退出码却是 0）；
//      - package.json 的 `npm test` 指向 2026-08-14 已删除的 tests/ 目录，直接 Validation
//        Error；~3,300 条断言没有一条挂进任何脚本。
//      现：新增 test/run-all.js 聚合跑测器，`npm test` 改为跑它（13 个跑测器），
//      6 个 exit(0) 改为 exit(fail?1:0)，jsdom 提升为显式 devDependency。
//
//   ④ verify_logs_fixed 的 F5 两条断言断言的是 2f6a3cb「修复编辑已平仓交易时改平仓价/
//      类型盈亏不重算」之前的行为——改平仓价却不重算盈亏才是 bug。现改为断言重算后的
//      预览值与落库值一致（两者都必须是 299.12 / R 5.98）。原 fixture 也一并修正：
//      它写 positionSize:10 @ entry 100 却配 fee:0.4、pnl:66.6，数学上不可能，
//      重算出的 2.60 是数据不自洽的产物，曾被误读成产品 bug。
//
//   ⑤ 升版同步：index.html 43 处 ?v=、run-tests.html 17 处 ?v= 及其 30.8 的硬编码断言。
//
// 5.6.33：平仓类型与实算盈亏方向的一致性收口（内联平仓面板原先完全没有这道校验）
//   触发场景：做多选「初始止盈」但平仓价填到入场价之下——面板算出亏损，却原样落库
//   initialTP，而渲染层徽章只按 closeType 取色（rendering.js），日志列表于是绿的「止盈」
//   旁边是红负数。更远的危害是分桶：closeType 是 analytics 平仓类型分布 / review 归因 /
//   CSV 导出的分桶键，亏损被计进止盈桶，win 侧统计与导出同时失真。isClosedTrade 只看
//   pnlAmount 存在故仍判已平仓，只是归错桶。
//   根因是两条权威路径结论不一致：编辑弹窗 emRecalc 早就有这道校验（initialTP→manualLoss、
//   initialSL/trailingSL→manualWin + emCloseTypeMismatchWarn 提示条），而 calcClosePnL /
//   confirmClose 一处都没有，closeType.value 在 logs.js 原样写入。
//     ① 新增 utils.resolveCloseType(closeType, legNetPnl) 作唯一权威实现（纯函数，不改入参、
//        不碰 DOM），四处共用：calcClosePnL（预览即改下拉 + 显示 cpTypeMismatch_ 提示条）、
//        confirmClose（落库前兜底，防绕过面板的调用路径）、emRecalc（原内联逻辑迁入）、
//        normalizeExistingCloseTypes（存量归一）。
//     ② 归一范围只限「计划类」类型：initialTP→manualLoss、partialTP→reducePosition、
//        initialSL/trailingSL→manualWin。partialTP 改 reducePosition 而非手平损——保留
//        「部分」语义只去掉与盈亏矛盾的「止盈」断言，且两者同属 PARTIAL_TYPES，簿记分类不受
//        影响。人工判断型（手平赢/手平损、强平、时间止损）方向由用户主观认定，不改写；
//        emRecalc 对它们的 warn-only 提示保留。
//     ③ 判定基准是「closeType 所描述的那一腿」的净盈亏，不是整笔累计：传累计会误伤「前半段
//        赚了、最后一腿止损」这类记录。面板用 netPnlPreview / netPnlThis（本次动作口径），
//        存量归一取 closes 末条非分批事件的 pnl，无 closes 的旧数据退回 pnlAmount。
//     ④ 存量静默归一（storage.js loadLogs 一次性标记 trade_types_normalized_v1）：修正历史
//        已平仓记录，同步改 closes 里那条收尾事件的 type，否则 item.closeType 与 closes[].type
//        打架，下次 syncCloseBookkeeping 会按错分类重建簿记。只动标签——realizedPnl /
//        pnlAmount / grossPnlAmount / ratio / fee 一律不改，账目不动；幂等，只覆盖
//        isClosedTrade 记录（分批中间态的本腿盈亏口径未定，不在范围）。
//     ⑤ 未覆盖的已知边界（刻意不替用户决定）：JSON/CSV 导入不改写标签——导入是用户显式
//        「带上自己的记录」动作，静默改标签比保留更意外；新写入侧已归一，导入后如出现矛盾
//        可用编辑弹窗修正，emRecalc 会提示。
//   方法论补充：① 两条权威路径对同一状态给出不同结论时，症状常只显示在一侧（这里徽章按错
//        类型渲染），要按「同一状态在哪些权威下各算一遍」枚举才找得到第二处缺校验的路径。
//     ② 归一只能动标签、绝不能动账目——类型是分桶键、盈亏是钱，两类字段的修复权限必须分开。
//     ③ 计划信息（targetPrice/stopLoss）已单独承载时，用 closeType 记录「本该止盈」是语义
//        过载：类型必须描述实际结果，否则任何「计划 vs 实际」的复盘都无法归因。
//     ④ 程序式 select.value 赋值不触发 change 事件，故自动改型不会自激循环；但必须同步
//        _closePanelType 模块缓存，否则面板重绘会从缓存恢复旧类型。
// 5.6.32：编辑日志细分场景 8 项修复（jsdom 数值探针 _edit_scenarios.js 109/109，HEAD 基线 80/29）
//   把上一轮「多次部分平仓覆盖」修完后仍残留的编辑路径问题一次收口。两处金额错账是本轮核心——
//   四个现存不变量（riskAmount 恒等式、Σratio===closedRatio、Σpnl===realizedPnl、positionSize
//   按 fracNow 缩减）全部成立，任何守恒校验都抓不到：
//     ① P0「_hadPartialEvt 快照时机」：读在 syncCloseBookkeeping 之后，而该调用对非分批类型必把
//        closes.length 变成 >0 ⇒「曾分批」对任何已平仓记录恒真，1379（累加）与「全新平仓重算」
//        两分支对已全平记录双双不可达。改平仓价 52000→49000 后 pnlAmount=−30 而 realizedPnl
//        仍冻结在 +30、grossPnlAmount 仍 +40 —— 一笔亏损单带着盈利毛利进胜率/期望/凯利样本。
//        commit 3d7efac 加的正是那个死分支，对它自己的目标场景是死代码。修复：快照取簿记同步
//        之前，判据从「closes 非空」改为「closes 里有 PARTIAL 类型事件」（全新平仓写入的收尾
//        事件本身不是分批事件，计入「曾分批」是判据本身的错误）；已全平记录按「编辑收尾腿」
//        语义重算，腿占比 = 100 − 分批之和。
//     ② P0「修改最后一笔」本腿盈亏恰为正确值一半：_prePosSize/_preFee 取的是**该腿发生【后】**
//        的剩余仓位与费用，而 _legFraction 用的是 fracBeforeEvt（该腿发生【前】的口径），两个
//        基数混用。实测 50%→60%：closedRatio/positionSize/fee 全对，gross 24→12、realizedFee
//        6→3、realizedPnl 18→9。因子 fracBeforeEvt/fracOld 在「新增一笔」模式为 1（行为不变），
//        在「修改最后一笔」模式差一个末腿，把当前剩余还原到该腿发生前。
//     ③ P1 非分批编辑销毁收尾事件审计字段（utils.syncCloseBookkeeping）：filter 掉已有收尾事件
//        再 push 一条裸 {type,ratio}，closes 退化成 [{"type":"initialTP","ratio":100}] 而
//        realizedPnl=30、Σcloses.pnl=0 —— 逐腿价格/盈亏永久丢失，sum(ratio)===closedRatio 仍成立
//        故任何校验都抓不到，CSV 往返后也无法恢复。改为就地更新已有收尾事件（与上方 PARTIAL
//        分支处理 partials[last].ratio 同构）。
//     ④ P1 撤销平仓标记是半完成操作：closeType 选「—」后保存成功但 closedRatio=100 / closes /
//        closePrice / closeTime / pnlAmount=30 全留、positionSize=0 ⇒ isClosedTrade 判「未平仓」，
//        这笔交易从已平仓统计里整笔消失，而敞口无法回滚，CSV 会导出一条「已平 100% 却没平」的
//        矛盾记录。改为显式清理全部平仓字段并按初始锚点恢复敞口（initialPositionSize → 保证金×
//        杠杆，仍无则提示而非静默保留 0 敞口）。位置必须在全部表单回读之后——回读会把预填的
//        emPnlAmount/emPnlPercent 写回 item，放前面等于白清。
//     ⑤ P2 清空平仓价是静默 no-op：gn('') 返 null，守卫 `!== null` 跳过写入，「平仓价格不能为空」
//        闸门永不触发，旧价被静默沿用。同函数相邻 5 处都有 `else if(…=== '')→null` 分支，只有
//        emClosePrice 漏了。
//     ⑥ P2 `const closeType` 重赋值抛 TypeError：DOM 类型已在自动调整处改成 manualLoss 故落库
//        正确，但整段逻辑静默中断，emCloseTypeMismatchWarn 永远不显示——用户看不出「计划止盈」
//        被改成了「手平损」，而复盘的 closeType 分桶统计已被污染。改 let。
//     ⑦ P2 改分批比例后盈亏预览不刷新。两层原因：emPartialRatio 不在 emBindRecalc 监听名单；
//        更要命的是 413 行的 _emPnlManual 锁定条件只看「有 closeType + 有 pnlAmount」，而分批
//        中间态记录两者皆有，于是 emRecalc 在 669 行直接 return——任何已带 PnL 的记录改比例
//        预览都纹丝不动（实测改 50→80 恒显 15），落库却是新值，保存前无从察觉。修复：把
//        emPartialRatio 加入解锁名单，并让 emRecalc 读输入框当前值（按「剩余/原始仓位」口径
//        换算）而非已落库的 ratioOfRemaining，费用/滑点按仓位线性缩放到本腿占比。
//        emFee/emSlippageCost 刻意【不】加入解锁名单：已全平记录改费用若解锁，emRecalc 会按
//        初始仓位重算整笔毛利覆盖累计值（分批链 realizedPnl=40 会被写成 30），比预览不刷新更糟。
//     ⑧ 收尾腿费用基准：已全平记录改价时，item.fee 是 confirmClose 遗留的「最终平仓前剩余费用」，
//        并不等于收尾腿承担的费用。改为优先取收尾事件自身记录的 fee，否则「打开即保存」会把
//        累计盈亏从 61 改成 59（收尾腿被多扣一笔本不属于它的费用）——这是本轮改动打穿的一个
//        相邻边界，A1 用例原本全绿。
//   附带：verify_audit_1013.js H 组 oracle 被污染已校正——H2 原断言 realizedPnl≈9.2，注释写「400
//          单位」却按 200 单位算（基数错位 bug 的产物），正确值 18.4；H3 又断言 Σcloses.pnl===
//          realizedPnl 而两值同源于一个变量、永远自洽，整组 61/61 全绿却毫无保护力。现改为断言
//          18.4 并补「旧值 9.2 不复现」反例 + 原始费用守恒不变量。
//   校验：verify_audit_1013.js 63/63（HEAD 基线 58/5，5 项 H 组 FAIL 正是被校正的 oracle）；
//         _edit_scenarios.js 109/109（HEAD 基线 80/29）；_rt_headless.js 631 PASS / 1 FAIL
//         （唯一 FAIL 是 jsdom 无 CSS 计算能力导致的 .collapsed max-height 断言，基线上同样失败）；
//         verify_invariants 2207 / verify_param_fix 31 / verify_sideeffects 47 全绿；
//         no-undef 块作用域泄漏扫描 0 条本文件内同名声明。
// 5.6.31：多次部分平仓「静默覆盖上一腿」P0 收口 + 分批比例闸门改 fail-closed
//   复核 5.6.30 的审计时补了多腿用例（verify_audit_1013.js 新增 G/H 组），才暴露 #1 只修了
//   「首腿盈亏被抹掉」这一半：同一处比例输入框在【已有部分平仓事件】时有两种互斥意图——
//   改末条那一笔、还是再平一笔；二者换算基准不同（末条发生前的剩余仓位 vs 本次保存前的累计
//   状态），代码原先按「覆盖末条」写死，用户以为「再平一笔」实际把上一腿的 ratio 覆盖掉：
//   closedRatio=40 / positionSize=600 却写着 realizedPnl=42.2（两腿之和），Σcloses.pnl 与
//   pnlAmount 互相矛盾，真实敞口比账面记录多 200 单位——账面少算风险，风控数据从源头失真。
//   修复：
//     ① 编辑弹窗新增 emPartialLegMode 单选（修改最后一笔/新增一笔），仅在已有部分平仓事件时
//        显示——没有既有事件时两种意图等价（都是建第一条），不必让用户选；
//     ② utils.syncCloseBookkeeping 加 opts.append 显式追加新事件，默认仍是替换末条——旧数据与
//        CSV 导入的簿记只有 {type,ratio}，静默改成追加会让同一笔被记两遍，故追加必须显式传入；
//     ③ 编辑路径累计改「先扣回被替换那一腿再加新值」：替换语义下末条是被换掉的，直接累加会把
//        旧腿盈亏/费用重复计入（H 组断言：错误值 32.2 vs 正确 9.2）；旧数据事件缺 pnl/fee 时
//        按 0 扣回（那笔腿本就从未进过累计，扣 0 才自洽），gross 缺失时退回 pnl+fee（不含滑点
//        的近似）——扣回口径必须与当初累加口径一致，否则新旧数据都会漂；
//     ④ 累计字段先判「账本可信度」再动账。这是本轮自引入的回归，靠 HEAD 基线差分才现形：
//        判定依据是账本里带 pnl/fee/gross 的腿各有几笔——confirmClose 从第一次部分平仓起就
//        维护 realizedPnl/realizedFee（logs.js:291-292），存量与旧 CSV 数据却常见「closes[]
//        有逐腿 pnl、realizedPnl 从没落过」。三种情形必须分开：
//         - 账本有带 pnl 的腿但 realizedPnl 缺失 → 用权威 pnlAmount 播种（它已含全部腿）再
//           扣回旧腿；直接「从 0 里扣回旧腿」会凭空造出负累计（实测 pnlAmount=600 的盈利单
//           被算成 -300），盈利单随即被亏损原因闸门拦死、编辑无法保存——run-tests 19 项因此红；
//         - 账本没有带 fee/gross 的腿但字段缺失 → 等价 confirmClose 的初始化，置 0 起算；
//         - 账本已有带 fee/gross 的腿但字段缺失 → 原始值无从还原，【绝不新写】：baseFee =
//           剩余 fee + 已实现 fee 依赖它，写个部分值会让下一次编辑把原始费用越算越小
//           （实测 5 → 3.75 → 2.76…），把「剩余+已实现=原始费用」这条链永久打脏；
//        grossPnlAmount 的播种须与 realizedPnl 解耦：第一次部分平仓时 realizedPnl 与 pnlAmount
//        都还没有，若此时不播种，confirmClose 最终平仓从 undefined(→0) 起算，第一腿毛利被永久
//        抹掉（实测 65 → 40，B 组）。
//     ⑤ closes[] 末腿 ratioOfRemaining 不再被审计字段回填覆盖：换算后的「占剩余仓位」值被
//        原始 partialRatio 覆盖回去，同一事件在「已平比例」与「剩余比例」两个字段上给出互相
//        矛盾的数字（实测 19 → 23），下次打开弹窗「剩余仓位」单选会预填成未换算的错误值。
//     ⑥ closes[] 事件补 gross 审计字段：日志页/复盘按事件追查单腿毛利时不再缺项（原只有
//        type/ratio/fee/pnl，毛利要自己反推且反推还依赖滑点口径）。
//   附带：
//     ⑦ #5 从「告警后继续」升级为 fail-closed 阻断：原实现 showToast 后照样落库，用户「只平
//        一部分」的意图仍被改写成全部退出。能确定用户不想全平，却替用户做出全平决定，是用最
//        危险的方式猜意图；想全部退出的正确入口是初始止盈/手平赢等非分批类型（isPartialAction
//        为 false，不受此拦，D5 对照）。
//     ⑧ verify_audit_1013.js 加固：无守卫的 .closes.reduce 在保存被拦时（closes 未初始化）抛
//        TypeError，让整份脚本中途崩掉、后续断言全不执行——退出码是 1 看起来「有缺陷」，实际
//        什么都没跑完。断言脚本崩掉比断言失败更危险，已统一走 legSum/legRatios/leg 三个助手，
//        并对 emClosePrice 补 fire('input') 让 harness 走真实 emRecalc 回填路径。
//   校验：verify_audit_1013.js 61/61；同一脚本对 HEAD 基线为 18/61（40+ 项 FAIL），断言有区分度。
//         run-tests.html 无头跑（test/_rt_headless.js）631 PASS / 1 FAIL，与 HEAD 基线逐条一致
//         （唯一 FAIL 是 jsdom 无 CSS 计算能力导致的 .collapsed max-height 断言，基线上同样失败，
//         非本次改动引入）；25 组「占比口径」用例对回归 A/B/C 有效，是抓出这三个自引入回归的手段。
//         verify_invariants 2207 / verify_param_fix 31 / verify_sideeffects 47 全绿；
//         no-undef 泄漏扫描 0 条本文件内同名声明。
// 5.6.30：开仓计划/交易日志模块 7 项真实 bug 修复（审计实证 verify_audit_1013.js，34 断言全绿）
//   真实 bug（#1~#7 均经 jsdom 行为级实证，对照现有 2400+ 回归 0 回归）：
//     #1 P0 编辑弹窗部分平仓只做簿记不折算本腿 P&L、不初始化 realizedPnl → 首腿盈亏被最终平仓静默抹掉（少记 38%）。
//     #2 P0 已平仓记录二次编辑被「亏损原因」误拦（实时重算用剩余 0 仓位算 grossPnl=-fee<0）。
//     #3 P1 io.js 导入放行负仓位（与 calculateCloseSettlement 拒绝 ≤0 口径矛盾）。
//     #4 P1 io.js 导入方向 "LONG" 原样入库不归一化（统计/平仓口径分叉）。
//     #5 P2 confirmClose 分批平仓未填比例静默全平 → 新增告警提示。
//     #6 P2 confirmClose 全新平仓未归零 positionSize（CSV 仓位列误导）。
//     #7 P2 planner calcReverseTP/SL 缺失 #desiredRR 守卫（卡片移除后生产 DOM 抛 TypeError）。
//   复核撤回（假阳性）：原审计 #8 stats 直调 isClosedTrade、#9 dashboard getHeatWarnMax 在 try 外，
//       前者依赖人为 delete utils 才触发、后者 loadSettings 兜底不可达，均非运行期缺陷。
// 5.6.29：平仓结算/统计链路第二轮矛盾整改（对上一轮指出的 P1/P2 逐项二次确认后修复）
//   背景：继 5.6.28 修完平仓极值填写与 MAE/MFE 计算后，用户要求对"逻辑不通畅/矛盾"继续
//   审查并二次确认。本轮对 5 处候选逐项核实，确认 4 处真实存在并全部整改，1 处判定为设计。
//
//   P4-5 logs.js confirmClose / modals.js 编辑路径 grossPnlAmount 语义（P1-1/P1-3）：
//       原部分平仓/最终平仓把 grossPnlAmount 覆盖为"剩余仓位全量毛利"（最终平仓=末段），
//       与整笔累计的 realizedFee/realizedPnl 口径脱节 → stats 成本侵蚀（fee/毛利）失真
//       （分两次平仓、末段毛利小/大时被放大或缩小到荒谬值）。
//       改为维护"整笔累计价格毛利"：部分平仓按本次比例累加（grossPnl×ratio/100）、
//       最终平仓累加末腿毛利；编辑路径分批收尾同步累加。
//       stats.js costDrag 分母优先 realizedPnl+realizedFee（新旧数据都正确，与分子同口径），
//       缺失才退回 grossPnlAmount，再退回 |pnlAmount|。
//   P4-6 modals.js calcMAEMFE 利润捕捉量纲（P1-2）：原 captureRatio = 含杠杆收益率 ÷ MFE%
//       量纲不一致，杠杆>1 时系统性高估捕捉率（杠杆 10x、价格只走 MFE 的 30% 也被判
//       "利润捕捉充分"）。改为价格收益% = (realizedPnl+realizedFee) ÷ initialPositionSize
//       对比 MFE%，与 mfe 同量纲（不含杠杆）；天然兼容 positionSize=0（不再依赖 margin）。
//   P4-7 stats.js 目标达成率（P2-1）：原仅按最终平仓价判定，部分止盈触及目标后回落、
//       最终平仓价低于目标时被记为未达成。改为用持仓极值 highPrice/lowPrice 判定"是否触及
//       目标"，极值缺失才退回平仓价判定。
//   P2-2（部分平仓中间态 pnlPercent/R 为"本次"口径、最终平仓为"整笔累计"口径）经复评判定为
//       有意的口径设计：中间态（isClosedTrade 判未平仓）不进统计，不影响胜率/期望/曲线正确性；
//       "本次"口径正是中间态要表达的已实现信息，本轮不改（如后续希望中间态也显示累计口径再做）。
//
//   校验：node --check 通过；test/verify_mae_mfe.js 扩至 21 项断言全绿——新增 P1-2 量纲
//       （杠杆 10x、价格走 2%/MFE 10% 判"利润回吐过多"而非"捕捉充分"）、P1-1/P1-3 部分平仓
//       两腿毛利累加=整笔 -25（非末段 -50）及 costDrag 分母 25/288 两例实证。
//   行为变更需用户过目：① 部分平仓链的成本侵蚀率较此前更接近真实（不再因末段毛利错配失真）；
//       ② 利润捕捉解读不再随杠杆放大而虚高；③ 触及过目标但最终未守住目标的单子计入目标达成率。
//
// 5.6.28：平仓极值填写与 MAE/MFE 计算逻辑修复（做多/做空场景逐方向审计）
//   背景：按用户要求对「平仓时最高/最低价填写 + 对应 MAE/MFE 计算」做做多/做空
//   全场景审计，确认以下明显/潜在 bug 并全部修复。
//
//   P4-1 logs.js storeMAEMFE / modals.js calcMAEMFE 符号钳制（L1/L2/S1/S2）：
//       原公式方向正确，但 MAE/MFE 未按语义钳位，两个方向各有两个 bug——
//       · 盈利单（多单全程未破入场、空单全程未涨破入场）mae 算成正小数，
//         代入 |mfe/mae| 使 MFE/MAE 比率虚高、误判「持仓管理优秀」；
//       · 从未有有利偏移的亏损单（多单追高、空单被反弹）mfe 算成负值，
//         利润捕捉 captureRatio=负/负=正 → 误判「利润捕捉充分」。
//       现按「MAE=最大不利偏移（钳≤0，无不利=0）、MFE=最大有利偏移（钳≥0，无有利=0）」
//       统一钳位，两个方向的符号反转与负负得正误判一并消除；ratio 加 mfe!==0 守卫。
//   P4-2 logs.js confirmClose 极值合并（C1）：原每次平仓（含部分平仓）无条件用输入框
//       值整体覆盖 lowPrice/highPrice，最终平仓会把整段持仓极值覆盖/清空，MAE/MFE 失真。
//       改为 min/max 合并（只扩大、不覆盖、空输入不清空已存极值）；modals.js 编辑路径
//       保持用户主动覆盖但同样触发校验。
//   P4-3 modals.js calcMAEMFE 保证金基准（C2）：已平仓记录 positionSize=0，原
//       margin=positionSize/leverage=0 → 「利润捕捉」解读永不触发。改为优先取
//       initialMargin / actualMargin，再回退 positionSize/leverage。
//   P4-4 新增 logs.js validateExtremes（L3/S3/L4/S4）：极值须满足纯几何约束
//       low ≤ min(entry,close) 且 high ≥ max(entry,close) 且 low ≤ high（与多空无关），
//       违反即填反/填错，toast 警告、不阻断保存。平仓（confirmClose）与编辑（modals）
//       两路径均调用。
//
//   校验：node --check 通过；新增 test/verify_mae_mfe.js（node 独立运行，jsdom 加载真实
//       logs.js/modals.js）16 项断言全绿，覆盖 L1/L2/S1/S2 钳位、C1 合并、validateExtremes
//       填反/合法/漏入场三例、C2 已平仓 positionSize=0 解读仍触发。
//   行为变更需用户过目：① 盈利单 MFE/MAE 比率不再显示（原虚高）；② 追高/被反弹的
//       亏损单不再被误判「利润捕捉充分」；③ 已平仓记录编辑后利润捕捉解读能正常给出。
//
// 5.6.27：分批建仓明细三处口径收口（同一状态在不同权威下结论必须一致）
//   背景：审计「开仓计划细分逻辑 / 分批建仓末节」发现 3 处 P1 + 2 处 P2，
//   核心模式仍是仓库反复出现的「记录的占比」与「实际切出的仓位」两个权威互相矛盾。
//
//   P1-1 modals.js doSaveSplit：原先任何情况都按 calc.positionSize/count 等分 N 笔，
//      但 splitEntries.alloc 却写 UI 分批面板里的各批 alloc（如 60/40）——读端
//      （编辑弹窗 e.alloc + 风险中心按 positionSize 加权）各算各话。现改为按
//      splitBatches 实际占比切总仓位（∃alloc 且批数=拆分数时走比例，否则退化等分
//      与旧行为一致），末笔补余数保证 Σpos===总仓位守恒。
//   P1-2 modals.js doSaveSplit 独立止损方向校验：原先方向非法批次（如做多却填高于
//      入场价的止损）照算 batchRisk 落库；主计算路径 calculator.js skippedCount 是
//      「跳过该批、不计入加权止损距离」。现保存路径对称：方向非法批次回退全局
//      calc.stopLoss、风险回退均分，记 _stopBadCount 供保存后 toast。
//   P1-3 calculator.js getSplitEntries：原先任一批 price/alloc 非法即整体 return null，
//      5 批里 4 批合法、1 批 alloc 空 → 合法 4 批明细（含独立止损价）在日志里彻底消失。
//      现逐批容错：只落合法批次；alloc 总和 ≠100 时落库前归一（70/70→50/50），
//      与主计算器加权止损距离 Σ(dist·alloc)/Σ(alloc) 同口径（分母自动消 ≠100）。
//   P2-1 calculator.js autoCompleteAlloc：原先 2 批模式 <3 直接 return，「比例总和须
//      为 100%」提示在 2 批填 70/70（=140）时永不出现。现提示逻辑提到长度分支之前，
//      对所有批次数生效；自动补全仍仅 3+ 批（保持旧「BUG#1」行为，2 批不替用户猜比例，
//      因加权入场价与主计算均按 ∃alloc 归一，权重比例不变，改写反引入新矛盾）。
//   P2-2 modals.js saveSplit 弹窗：批次数面板已打开时默认拆分数 = 面板批次数
//      （此时才按各批 alloc 比例切仓）；用户仍手填其它数字时退化等分。
//
//   校验：test/run-tests.html 新增第 30.11 组，含 4 条反向用例（全部批次无效仍 null、
//      单批 null、方向非法批次确实回退全局止损、alloc 缺失确实退化等分）——注入点选在
//      正常保存路径必经的 doSaveSplit，覆盖「比例路径 vs 等分路径 vs 方向回退」三分支。
//   行为变更需用户过目：① 拆分保存在「填了 alloc 且批数=拆分数」时仓位不再恒定 1/N，
//      而是按 alloc 比例（60/40 → 600/400 而非 500/500）；② getSplitEntries 落库的
//      alloc 是归一化后的占整笔百分比（70/70 显示为 50/50）而非 UI 面板原值。
//
// 5.6.26：开仓管线 4 处 fail-open 闸门收口（系统性缺陷：静默放行而非静默失败）
//   背景：对全系统做潜在逻辑 bug 分析后，确认 4 处「闸门取数异常时静默放行」
//   与 CLAUDE.md「闸门必须 fail-closed」原则直接矛盾，集中收口。
//
//   F1 calculator.js 凯利驱动单笔风险上限闸门：原 `catch(e){/*忽略*/}` 空实现——
//      _numSetting 抛错时整道闸门静默放行，凯利驱动可绕过系统单笔风险上限。
//      改为 fail-closed：异常时按默认 2% 判定阻断，提示「系统设置读取失败」。
//   F2 calculator.js 凯利覆写 #riskInput（select 仅 0.5% 步进）：round 后的 UI 显示值
//      与实际参与计算的 riskPercent（未 round 精确值）分叉，快照存精确值、UI 显 round 值，
//      用户看到「1%」实际跑 0.7%。riskHint 文案改为明示「按此精确值计算」。
//   F3 calculator.js assertSavableCalculation 一致性比对 catch：原空实现吞掉整个比对块
//      的任意异常（如旧快照缺字段导致 numDiff 收 undefined），保存闸门按旧快照放行。
//      改为 fail-closed：异常时 console.error + 返回 ok:false「参数一致性校验异常」。
//   F4 skills-integration.js calcPortfolioHeat：账户余额未设（capital 未知）时原返回
//      heat=0/blocked=false，组合热量监控永久失效。加 readFailed 双向标记
//      （正常分支 readFailed:false，未知分支 readFailed:true），消费方据此区分
//      「热量为 0」与「无法计算」。开仓链路传表单 capital>0 恒走正常分支，不受影响；
//      risk.js 卡片已按 !capital 走空态文案，亦不受影响。
//
//   校验：node --check 通过；test/verify_invariants.js 2207/0、verify_param_fix.js 31/0、
//   verify_sideeffects.js 47/0 全绿；F3 反向用例（注入缺字段快照）确认异常路径
//   由 fail-closed 拦下而非静默吞掉。
//
// 5.6.25 补充：开仓计划模块计算逻辑一致性核查（用户第二轮审查请求）
//   核查范围：_calculateImpl 全链路 + planner.js 清单项 + 凯利/心态/连亏截断
//   + RR 三处同档 + 脏值防护 + 守恒恒等式。共 28 项实证断言全绿。
//   发现并修复 1 处文案 bug：凯利截断提示「已截断至 5%」与「超出 5% 上限」
//   两处写死 5%，但 kellyRiskLimitPct 已参数化——用户把它调到 3% 后
//   提示仍写 5%。calculator.js:546（结果卡 kellyCappedMsg）与 :2455
//   （凯利侧边栏 kellyWarning）两处改为读 _getKellyRiskLimitPct() 实际值。
//   skills-integration.js JSDoc 中「已截断到 5%」两处同步更新。
//
// 5.6.25：全站同类反模式整改（审计日志模块时发现的系统性问题，4 类共 10 处）
//   背景：v5.6.24 修完日志模块 4 个 P0 后复盘发现，它们不是孤立 bug，
//   而是四种可复制反模式的重演。本轮把同类问题在全站收口。
//
//   1) 索引型状态未随 logs 变更重置（危害最大：会写错交易记录）
//      新增两个权威入口（js/utils.js）：
//        resetAllIndexState()          —— 全清，适用于整体替换/批量删除/清空/撤销
//        remapIndexStateAfterSplice()  —— 下标平移，适用于单条删除
//      （删一条不该清掉用户对其余行的勾选，故单条删除用平移而非清空。）
//      接入 7 条改写 logs 的路径，其中 3 条此前完整度为 0/7：
//        覆盖导入 settings.js _commitImportedLogs —— 后果：勾选 L0/L1 → 覆盖导入 →
//          点批量删除 → 删掉用户从未勾选的记录；
//        备份恢复 settings.js restoreFromAutoBackup；
//        多标签页同步 storage.js（两处，经 _safeRenderAfterStorageChange）。
//      另修：批量删除漏 _expandedRows（该清的没清、撤销回调里反而清了它）；
//      单条删除补齐 openClosePanelIdx / actionPanelIdx / _closePriceEdited ——
//      此前面板会无声漂移到相邻记录，用户点「确认平仓」会平掉他没打开的那笔。
//      ⚠️ 踩坑：_safeRenderAfterStorageChange 同时是每次 saveLogs() 的收尾，
//      在那里无条件重置会把刚 remap 好的状态立刻清空（verify_logs_fixed F1 组全红
//      才发现）。已改为由调用方显式传 { externalReplace: true }，并加防回归断言。
//
//   2) 死配置：组合热量警告上限设置项形同虚设
//      getHeatWarnMax() 定义完整、设置页有输入框（可调 5~20%），但**零消费方**——
//      真正生效的是 5 处硬编码 maxHeat * 0.8。用户在设置页改这个值对任何 UI 数字
//      与阻断行为零影响。根因：v5.6.19 把硬熔断从 getHeatWarnMax 拆到 getHeatHardMax 时，
//      警告侧被顺手换成了硬编码系数，旧 bug 以新形式复现。
//      已把 skills-integration / risk ×2 / dashboard ×2 五处全部改读 getHeatWarnMax，
//      并把提示文案改为显示实际警告线（原文案只显示硬上限，用户无从判断）。
//      注意：skills-integration.js:469 的 `maxPct * 0.8` 是**品种集中度**的「接近上限」
//      提示档，刻意保留——设置里只有 singleSymbolMaxPct 一个值，没有对应警告线，
//      且 getHeatWarnMax 是组合热量专用。两者不要混为一谈（已加注释说明）。
//
//   3) 权威函数的多份副本（每处都是「修了权威、漏了副本」的重演）
//      手续费率：planner.js:66 / modals.js:1284 写死 0.04/0.08，绕过 feeRate 设置 →
//        用户改费率后，反推目标价算出的 RR 与计算器不一致、分批快照落库费用污染成本侵蚀。
//        两处改走 _getDefaultFeeRate。
//      单品种集中度：risk.js 卡片只判 != null、planner.js 文案仍是 `|| 30` 原型，
//        与权威的 Number+isFinite 守卫三处结论可互相矛盾。新增
//        getSymbolConcentrationMaxPct() 为唯一读取入口，三处统一。
//      回撤阈值：risk.js renderDrawdown 直接用 ddSettings.maxDrawdownAlert 无守卫——
//        null 时 `> null` 恒真（有一点回撤就红色告警），"abc"/NaN 时恒 false（永不告警），
//        而开仓闸门消费的 getCurrentDrawdown 有守卫会回退 20 → 同一份数据下
//        「风控中心显示安全」与「点计算却放行」互相矛盾。已补同样的守卫。
//
//   4) 结构性预防（写进 CLAUDE.md，两条强制检查项）
//      ① 新增/修改权威函数后必须 grep 全部旧调用点并确认零遗漏
//         （统计调用数必须剔除注释行——注释里带 () 会被误判为调用）；
//      ② logs 任何变更后必须走统一状态重置入口，禁止手写逐项清理。
//      CLAUDE.md 已附「四个已发生案例」对照表，说明这不是谨慎而是已被四次实证的流程缺口。
//
//   验证：新增 verify_reset_fix.js（29 断言，含 saveLogs 不得清状态的防回归组）、
//        verify_config_fix.js（17 断言，验证设置项真实生效：同一 heat 下警告线 5 触发、
//        警告线 20 不触发）。既有 verify_logs_fixed 24 / smoke 15 全绿，
//        三套老校验 invariants 2207 / param_fix 31 / sideeffects 47 全通过。
// 5.6.24：交易日志模块全量审计修复（4 个 P0 + 4 个中危，全部 jsdom 实证）
//   P0 编辑已平仓记录的 PnL 被系统静默改写（数据可信度问题，危害最大）：
//        modals.js 打开弹窗时先按设计置 _emPnlManual=true（已平仓且有 PnL 值即保护），
//        随后又用「DOM 值 vs 存储值比对」把同一标志覆写成 false，把设计意图完整抵消。
//        后果：用户改平仓价触发 emRecalc 重算，PnL 被覆盖（实测 120→130 时 66.60 变 2.60），
//        而「手动」标签永不显示，用户无从察觉。已删除覆写逻辑并让标签随保护状态点亮。
//   P0 orderType 选项与主数据模型不一致，限价单被静默改成市价单：
//        主模型（#orderType / ORDER_TYPES_LONG/SHORT）是 market/limit/stop 三值，
//        calculator.js 直接把该值落库、_getDefaultFeeRate 还按 'limit' 取费率；
//        而编辑弹窗只列旧扩展值（limitBuy/stopBuy/…）。于是 orderType='limit' 的日志
//        打开弹窗后 select 匹配不到任何 option，浏览器回落到首项 'market'——
//        不改任何字段直接保存即完成静默改单。已改为三值 + 旧值原样回显。
//   P0 单条删除后批量选中索引错位，会删掉用户没勾的行：
//        toast.js 单条删除分支 logs.splice(idx,1) 后未重映射 _selectedIndices/_expandedRows
//        （批量删除与清空两条路径都清空了，唯独单条这条漏了），splice 使其后索引整体前移一位，
//        选中集仍按旧索引记账 → 随后的 batchDelete 命中用户根本没勾的行。
//        已按「快照后重建」重映射（Set.forEach 会遍历迭代期间新增的条目，
//        边删边 add 会连锁前移，必须先快照）；_expandedRows 以 let 声明不挂 window，用裸标识符引用。
//   P0 分批改非分批后 positionSize 未清零，已平仓记录仍带剩余敞口：
//        syncCloseBookkeeping 只把 closedRatio 置 100，不碰 positionSize（logs.js:303 收尾会置 0），
//        CSV 仓位列与实际不符。补零必须放在 saveEditLog 中分批链收尾结算【之后】——
//        :1080 以 positionSize>0 作为累加最后一腿的守卫，提前清零会让整段已实现盈亏被跳过。
//   中危 isClosedTrade 的错误兜底从 3 处扩到 7 处（!!closeType 恰好把分批中间态判成已平仓，
//        正是该函数当初要修的 bug）。新增 utils.isClosed 作为唯一 fail-closed 入口：
//        utils 缺失时判「未平仓」并告警一次（少算可退回持仓监控，多算会虚高胜率并漏触发连亏降仓）。
//   中危 脏检查名单漏 emStopType / emPartialRatio：二者都是可保存字段，
//        只改止损类型后 _editDirty 仍为 false → 关闭时不提示、静默丢改动。
//        修复时把 emCheckDirty 与 captureInit 两份 ids 列表一并补齐并加注释约束二者必须逐字一致。
//   中危 lossReason 用 if(item.lossReason) 判真，空数组 [] 为 truthy 会渲染空容器
//        （同行 emotions 已带 .length 判定）。已补 .length。
//   中危 4 处统计 tooltip 与实现口径不符，且 openStatTip 会把静态 data-tip 与运行时 title
//        拼接展示 → 同一屏出现两个互相矛盾的公式：
//        夏普写 √252 而 utils.dailySharpe 实际 365（低估 16.9%）；目标达成率分母写「已平仓数」
//        实为「有计划目标值的子集」；目标 R 偏差实为「Σ已实现净盈亏÷Σ计划净盈亏」而非 R 相除；
//        MFE/MAE 实为逐笔比值均值而非「平均MFE÷平均MAE」。已全部按代码口径改写。
//   文案 index.html 统计概览折叠标题写「16 项指标」，实测 18 项，已同步。
//   验证：新增 verify_logs_fixed.js（24 项断言，含反向用例证明断言能咬住目标路径）。
//        既有三套校验全绿：verify_invariants 2207 / verify_param_fix 31 / verify_sideeffects 47。
// 5.6.23：开仓计划保存链路实测补漏（前几轮只测了计算链路，保存/读取是盲区）
//   P0 开仓保存时不落initialRiskAmount，导致 R 倍数为 NaN：
//        全站 R 倍数都以 initialRiskAmount 为分母（rendering / modals / logs / stats 一致），
//        但该字段此前只有 logs.js:240 在**平仓时**才用 riskAmount 回填——
//        刚开仓、尚未平仓的记录为 null → 复盘/统计/详情里的 R 显示 NaN。
//        开仓这一刻 riskAmount 就是 1R 的值（此后被部分平仓按比例缩减，故须此刻锁定）。
//        saveLog 与 doSaveSplit 均已补（2026-10-10 实测：修复后 R=1.00 而非 NaN）。
//   P1 含费净 RR 三段金额从未落库：rrGrossProfit / rrNetProfit / rrNetLoss
//        只作为参数传给 renderCalcVisuals，从未进入 setCalc 快照。原只落了分子
//        targetNetProfit，分母 netLoss 缺失 → 事后既无法还原 RR 是含费口径还是价格距离口径，
//        也无法复算「目标 RR 要求的最小盈利」。已补落库 + CSV 导入导出三列
//        （实测：日志值重算 RR=2.645 与 targetRR 完全一致）。
//   核实无误（实测非推断）：清单 fail-closed 正常（checkRR fail 时拒绝保存且日志不被污染）、
//        脏标记正常（真实 input 事件下 dirty=true、保存按钮禁用、拒绝保存过期计算）、
//        「pos×止损% 与 riskAmount 差 0.5%」**不是缺陷**——日志存未含滑点的价格快照，
//        riskAmount 按含滑点的 effectiveEntryPrice(1000.1) 算，用后者重算完全吻合(2000.00)。
// 5.6.22：自动备份补齐读取入口 + 交易参数核实后的补漏
//   P0 自动备份此前**只写不读**（2026-10-10 实测确认）：storage.js 每次 saveLogs 都往
//        trade_backup_auto_0..N 写快照，但全站没有任何从这些快照恢复的入口，
//        「备份份数」设置只是个看不见摸不着的计数器——误删日志后只能靠自己曾导出过的文件，
//        而数据明明就在浏览器里。现补：
//          settings.listAutoBackups()      —— 列出本地备份（按时间倒序，遵守 backupCount）
//          settings.restoreFromAutoBackup() —— 恢复，覆盖前自动另存「恢复前备份」
//          settings.openRestoreBackupDialog() —— 入口（设置 → 数据管理 → 从自动备份恢复）
//        实测：3 条日志误删后成功找回，内容完整、恢复前的空日志已另存。
//   P1 logs.js updateBackupTime 硬编码 `for (i < 10)` 扫槽位，与 settings.backupCount 脱节：
//        份数调小会把已被轮转掉的旧槽当最新备份显示；调大则永远扫不到后段槽位。
//        改为读设置（与 5.6.19 修的 calc-visuals 刻度常量同类漏改）。
//   P2 calc 快照补 mmrUsed：此前只落 liquidationPrice 而无当时的 mmr，
//        而 mmr 是设置页随时可改的字段，事后改它会让全部历史强平距离指标漂移、无从追溯。
//   核实结论（实测，非推断）——交易参数三项均真实生效：
//        mmr → 强平价 0.5%=909.64 / 1%=919.28 / 2%=938.87（随参数单调变化）；
//        defaultLeverage → 首屏 #leverage 表单值（经 syncSettingsToForm 回同步）；
//        autoBackup=false → 连续保存 5 次产生 0 个备份槽（确认真停止）；
//        backupCount=3/5/10 → 实际轮转槽位恰为 3/5/10 份（超出的覆盖而非新增）。
// 5.6.21：权益曲线口径修正（回撤/净值全线）+ planner 品种兜底
//   P0 utils.calcEquityCurve 把 settings.accountBalance 当曲线「起点」又叠加全部历史
//        pnlAmount，同一笔盈亏被算两次。该字段语义是「当前账户余额」，用户会在净值变化后
//        更新它。实测：本金 10000 亏 6000、余额仍填 10000 → 回撤算成 10.8%（真实 60%）；
//        余额按净值更新为 13000（只赚过 3000）→ 净值算成 16000。
//        数值启发式（「与初始本金+累计盈亏的差值」反推）**不可用**——从数值无法区分
//        「初始本金」与「当前净值」，两种解释都成立，实测两种启发式各错一半。
//        改用无歧义权威来源：日志每笔的 capital 是开仓时的账户快照，
//        **最早一条的 capital 即初始本金**；settings.accountBalance 仅在无日志时兜底。
//        现两种余额填法结果完全一致，不再受用户是否更新余额影响。
//   P1 planner.js 的规则说明不再硬编码 'BTC'（违反 CLAUDE.md），
//        改用 getDefaultSymbol()（品种定义首项）兜底。
//   ⚠️ 行为变更：真实回撤比此前算出的值大（此前重复计入被抵消、失真偏低）。
//        若发现回撤熔断突然变严，属修复生效而非新bug——历史上真实 60% 的回撤
//        只被算成 10.8%，等于熔断长期形同虚设。
// 5.6.20：开仓计划计算逻辑深度审计全量修复（含行为变更；两处 P0 系 5.6.19 引入的回归）
//   P0-A 降仓阈值参数化不一致导致落库自相矛盾（**5.6.19 的回归**）：
//        :828 按 _getLossStreakDeriskThreshold() 判定降仓并下调 riskAmount，
//        而 :884 用硬编码 3 决定取 adjPos 还是 positionSize。阈值设为 2、streak=2 时：
//        riskAmount 已打 0.8 折而 positionSize 未打折，实测「计划风险 200 /
//        落库风险 160 / 落库仓位 9951」互相打架，真实敞口 199 与记录风险额 160 差 25%，
//        风控被静默绕过。修法：降仓直接改写 positionSize，删除 adjPos（分叉是根源）。
//   P0-B 集中度截断量纲错位（与 P0-A 同源，修好 P0-A 后连带消除）：
//        原按 adjPos 的比例缩放 positionSize，而 adjPos = positionSize × F(F<1)，
//        positionSize 被放大到上限的 1/F 倍——集中度 5% 实测算出 6.25%，突破 25%。
//        修法：直接 positionSize = allowedFinalPos，不算比例。
//   P0-C _calcCleanup() 两处漏调（风险比例/金额非法分支）：
//        _calculating 永真 → app.js 按钮守卫与 markCalculationDirty 双双永久短路，
//        「计算仓位」按钮此后完全无响应。触发值：设置里 riskPercent 填 3.5/4.5/5.5/6.5/
//        7.5/8.5/9.5（#riskInput 的 option 只有 0.5% 整数步进，赋值 3.5% 时 select.value 变空串）。
//   P0-D 闸门 fail-open 改 fail-closed：single-risk-exceeds-limit 去掉 catch 空实现
//        （存储不可用时整道失效放行）；连亏熔断取数失败显式阻断（loss-streak-unavailable）；
//        回撤取数失败阻断（drawdown-unavailable），getCurrentDrawdown 透出 readFailed。
//   P0-E _numSetting 兑现「越界回退默认」的注释承诺：补 SETTINGS_VALIDATORS 区间钳制。
//        原只有 isFinite，marginUsageLimitPct=150 会使 marginLimitPos > maxPos，
//        而第②层被 if (!cappedByMargin) 跳过 → 交易所上限被突破 50%。
//   P0-F 现货清单虚假承诺：checkMargin 在 leverage=0 时仍宣称「≤ 80%」并判 PASS，
//        实测出现「保证金占比 90.0% ≤ 80%」且通过。现按现货/合约分别表述。
//   P1 回撤口径统一：getCurrentDrawdown 原为单条件（比例），risk.js 卡片是双条件
//        （比例 OR 绝对额）→ 出现「风控中心红色告警、开仓却放行」。现两边都取双条件。
//   P1 连亏熔断线与降仓线拆分（新增 settings.lossStreakBlock 默认 3，降仓线默认 2）：
//        原共用一个阈值，自动模式下 streak >= 阈值先被熔断拦下，降仓分支永远不可达，
//        UI 文案承诺的「>=3 笔自动降仓」是假的。
//   P1 脏值守卫：singleSymbolMaxPct / dailyLossLimit / dailyTradeMax 三处
//        `|| 默认值` 改为 Number + isFinite（非空字符串是 truthy，会原样穿过 ||）。
//   新增 verify_invariants.js：648 组参数组合 × 2207 条守恒断言，核心不变量
//        riskAmount === positionSize × stopDistance / entryPrice。
//        已用「注入 1.25 倍超限」反向验证脚本敏感度（立刻抓出 204 条）。
// 5.6.19：设置参数 → 开仓计算链路审计全量修复（含行为变更）
//        [同日追加] calc-visuals 保证金刻度参数化收尾：
//          该文件原把 0.5/0.8/0.9 写成 var 字面量，注释还标注「改这三处时必须同步
//          calculator.js」；calculator.js 侧同日参数化后它没跟上——用户把上限调成 60%
//          时截断按 60% 执行、刻度线仍画在 80%。现改为 marginSoftCap()/marginAggCap()
//          经 loadSettings 读取，导出对象用 getter 保持 MARGIN_SOFT_CAP/MARGIN_AGG_CAP
//          契约不变（测试第 27 组读它们）。index.html 的首屏静态文本一并改为占位符。
//        [同日追加] 修复上面改动遗留的 MARGIN_SOFT_CAP 残余引用：抛错发生在工厂执行期，
//          root.CalcVisuals 从未被赋值，整个结果可视化模块（盈亏比图 + 保证金图）消失，
//          而 renderCalcVisuals 的 try/catch 把它吞成一行 console.error，
//          页面上只表现为「两张图不见了」。verify_param_fix.js 第 11 组钉住此点。
//        P0 补齐回撤熔断：settings.maxDrawdownAlert 此前只在 risk.js 卡片着色里被读，
//          开仓链路零消费，系统事实上没有回撤熔断（调 20%→5% 开仓结果纹丝不动）。
//          新增 skills-integration.getCurrentDrawdown()（唯一权威，权益曲线口径与
//          risk.js 回撤卡片同源）+ calculator 闸门 drawdown-limit。
//        P1 硬编码阈值参数化（新增 8 个设置项，默认值与原字面量一致，行为不变）：
//          marginUsageLimitPct 80（calculator:656 原 *0.8）、
//          aggregateMarginLimitPct 90（:683 原 *0.9）、
//          lossStreakDerisk 3 + lossStreakDeriskFactor 0.8（:337/:766）、kellyRiskLimitPct 5
//          （skills-integration:213 原 0.05）、feeRateLimit 0.04 / feeRateMarket 0.08（:882）、
//          minStopDistancePct 0.1（:600 原 0.001）。此前最靠近资金的两道闸门反而不可配。
//        P1 保存设置后回同步开仓表单：saveSettings 末尾补调 syncSettingsToForm() +
//          refreshChecklistLabels()。此前二者唯一调用点在 DOMContentLoaded，
//          accountBalance/riskPercent/defaultLeverage/atrStopEnabled 保存后不刷新页面不生效，
//          calculator:209 的 settings.atrStopEnabled 分支也因此是死分支。
//        P1 fallback 统一：riskPercent 四份不同兜底（0.10 / 2 / 2 / 10）统一为 2；
//          defaultLeverage 的 || 0（0=现货，危险方向）统一为 10；
//          risk.js dailyLossLimit 补兜底（NaN 会让日亏损超限提示永久静默）。
//        P1 applyKellyRisk 止损区间改走 getStopLimitPct()：原写死 ETH 0.3~2%/其余 0.5~3%，
//          完全绕过 customStopLimit，用户改设置后此路径生成的止损反被 :870 拦下。
//        P1 组合热量硬上限与警告上限解耦：getHeatHardMax 只读 riskHeatMax，
//          新增 getHeatWarnMax 读 heatWarnMax。原 Math.min(riskHeatMax, portfolioHeatMax)
//          使 portfolioHeatMax 在多数取值下无效果，且硬上限被警告值牵制。
//        P1 storage.js 备份轮转改走 loadSettings()：原为全仓唯一裸读 localStorage 的点，
//          硬编码 key 字符串且绕过 SETTINGS_DEFAULTS 合并。
//        P1 tpRRs 补UI 输入框：planner.js 早已读取该设置，但设置页无任何输入框，只能导入 JSON。
//        P2 开仓计划落库 settingsSnapshot（14 项阈值快照）+ atrSuppressedByWeighted/
//          atrInputValue/atrInputMultiplier：此前只存结果不存阈值，事后改 mmr 会让全部历史
//          强平距离指标漂移；ATR 被分批止损顶替时用户填的值会凭空消失。
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
// 5.6.13：入场理由不再默认被勾上（checkReason 由影子项变回真闸门）
//         - 下拉第一项原先直接是「趋势突破」：浏览器把 reasonSelect.value 静默设成第一个
//           option 的值，getReason() 永远非空，checkReason 因此恒为 PASS——一个永远不会
//           失败的闸门项，等于从「开仓前检查」里被静默抽掉；而字段标签还写着「选填」，
//           一个是永不失败的闸门、一个是声明可选，两者互相矛盾且都不可见。更糟的是
//           数据侧：每笔用户根本没选理由的交易，在复盘的「入场原因胜率分析」里被统计成
//           「趋势突破」，CSV 的入场原因列也全是假数据。planner.js 的判定和 review.js
//           的「未标记」分桶其实早就为「空值」写好了（判定里带着
//           calc.reason !== '— 不选择 —'、review.js 有空值走「未标记」），缺的只是那个
//           空选项。现加 <option value="">— 不选择 —</option> 作第一项。
//         - resetForm 同步改回空选项：原先写死 reasonSelect.value = '趋势突破'，重置一次
//           就把上面这个空选项绕过，等于白加。
//         - 判定抽成 isEntryReasonChosen() 纯函数并补齐失败话术：清单的 fail 分支会把
//           message 内联显示，原代码 pass/fail 共用一句「入场理由已明确」——不加空选项时
//           这段代码从不执行，一旦生效就是红字写着「入场理由已明确」。同时覆盖编辑弹窗
//           的多选数组形态。
//         - 标签「（选填）」改「（保存前必填）」：这一项没有 level:'warn'，是硬闸门，
//           用户不选理由就存不了。加完空选项后每笔新计划都会先挂一个真实 FAIL，
//           再叫「选填」就是自相矛盾。编辑弹窗保留「可选·多选」不动——那是补录历史
//           记录，不该因为当时没选就拦住编辑。
//         - 测试：588 → 600 断言（新增 30.10 入场理由判定 12 态：空串/占位文案/纯空白/
//           null/undefined 视为未选择，单值与多选数组的有效项判定，两端空白与混合数组）。
// 5.6.14：移动端适配全量修复 + 策略与信号折叠面板展开失效修复
//        - P0：.form-section-content 折叠面板（订单类型/市场环境/策略与信号/入场原因）
//          点击展开后内容高度恒为 0——base 态 max-height:0 与展开态规则竞争压过，
//          且 transition 起点冻结；改为 .collapsed 规则单一来源驱动收起动画，展开态
//          无过渡立即生效（实测 V22/V23 验证 clientH 0→354）
//        - P0：移动端 #toastContainer 与弹窗内容区几何重叠被遮罩糊住，改为居中横条
//        - P0：移动端输入框 15px < iOS 16px 聚焦自动缩放阈值，48rem 下提到 16px
//        - P1：表格卡片化后展开按钮列残留空 ::before 行 + 无 data-label 的 td 不渲染占位
//        - P1：#tableWrap min-height:120px 兜底超矮视口 + 卡片化 sticky 标签条
//        - P2：超小屏汉堡按钮 40px + 预留收窄；touch-action 限定选择器豁免 canvas
//        - P1：交易日志批量操作交互收口——勾选行 checkbox / 表头全选框时自动进入
//          批量模式（原先要手动点「批量操作」按钮再勾选，交互割裂）；全部清空时
//          自动退出。_syncBatchModeUI 收敛状态与 UI 的同步点，toggleBatchMode /
//          handleBatchCheck / batchSelectAll 共用
//        版本号 5.6.13 → 5.6.14，index.html 40 处 ?v= 同步
// 5.6.15：侧边栏导航视觉收口（layout.css / variables.css / index.html / version.js）
//        - 选中态三套色归一：原「文字 --color-primary-strong(248 蓝) + 边框写死 hue 150(绿)
//          + 扫光/辉光走 --nav-hue」三处各说各话，静态观感是蓝字配绿边。现文字/图标/
//          边框/色标全部由 --nav-hue × --nav-accent-l 派生，一个模块一套色。
//        - 新增 --nav-accent-l（暗底 72% / 浅底 46%）：色相亮度此前在 layout.css 里写死
//          58%，无法同时满足两套主题对比度。现七个色相实测浅底 5.70~7.28:1、
//          暗底 7.10~8.30:1（OKLCH→sRGB 换算），全部达标。
//        - 右侧 8px 辉光圆点 → 3×18 色标细条：圆点被读作未读/故障指示灯，且孤悬右缘；
//          细条与图标同色后才构成「图标—文字—色标」的完整色锚。
//        - 图标由中性灰改着本模块色相（原色锚只落在一个点上，等于没有）。
//        - 头部：logo 换 assets/icon-192.png（原 img/logo.png 803KB 缩到 48px 糊成噪点）、
//          48→40px；标题 15→14px、字距归零，副标题 11→10px、字距 0.5→0.2px。
//          原尺寸下 8 个汉字在 200px 栏里被 overflow 裁掉右缘。
//        - 侧栏版本号改为 version.js 注入：HTML 里硬编码 v5.6.2 已落后 12 个小版本。
//        版本号 5.6.14 → 5.6.15，index.html 45 处 ?v= + run-tests.html 21 处 ?v= 同步
// 5.6.16：修复「minRR is not defined」运行时崩溃（calculator.js / utils.js）
//        - P0：minRR 以 const 声明在 if (targetRR !== null) 块内，却在块外的「距目标」
//          子块被引用。targetPct 与 targetRR 是两个独立条件——止损腿净额 netLoss ≤ 0
//          时 targetRR 保持 null 而 targetPct 已有值，一进这条路径就抛
//          ReferenceError，被 calculate() 的 catch 吞成「请检查品种/价格输入后重试」，
//          真实原因完全不可见。minRR 提到块外声明。
//        - 顺带修口径：距目标子块在 targetRR 为 null 时直接代进 rrMeetsMin，null 被
//          当 0 算，恒定判红——「还没算出盈亏比」被显示成「盈亏比不合格」。现走中性灰。
//        - utils.js：ChartManager 定义在 IIFE 内，cleanupPage 却在 IIFE 外用裸标识符
//          挂载（靠 window.ChartManager 的全局对象属性隐式兜底才没崩）。改显式
//          window.ChartManager，不靠兜底——本项目 risk.js 的裸 util 曾因此出过 P0。
//        - 沉淀检查方法：eslint 临时启用 no-undef 全量扫，可一次性找出这类
//          「块内 const 被块外引用」问题（见 CLAUDE.md 常用命令）。
//        版本号 5.6.15 → 5.6.16

// v5.6.17 — 品种定义单一数据源：系统设置 → 品种管理 → 所有品种入口
//        - 新增 getDefinedSymbols() / getDefaultSymbol()（settings.js）：品种定义的唯一
//          权威来源，做大写归一 + 按代码去重 + 过滤空代码。此前各入口各写一份：
//          #fltSymbol 只从 logs 聚合、#emSymbol 干脆没有候选，于是「设置里加了但还没
//          交易过的品种」在这两处永远选不到，品种管理实际只对开仓计划生效。
//        - 筛选下拉改为「定义 ∪ 日志」，定义按设置页顺序在前，日志独有项按字母追加
//          在后（只取定义会漏掉历史日志里手打过的临时品种）。
//        - 编辑弹窗品种加候选（内联 datalist，与开仓计划同源），保存时 trim + 大写归一。
//        - desc（说明）此前只在设置页表格里可见、录入侧完全没消费：现写入
//          option[label]，combobox 展开时显示为右对齐次要文字，且参与输入过滤
//          （记不清代码时打「比特币」也能筛出 BTC）。
//        - calculator.js：#symbol 的 value 只 trim 未大写化，而输入框的
//          text-transform:uppercase 只是视觉大写——手打 "btc" 存进日志会与定义里的
//          "BTC" 在集中度/筛选/统计里裂成两个品种。现与定义口径一致（toUpperCase）。
//        - 首屏品种默认值改由设置定义派生（syncSettingsToForm），此前 index.html 里
//          写死 "BTC"，本金/风险/杠杆都有同步却漏了品种。
//        - 新增测试第 32 组（14 条断言）：归一/去重/datalist/筛选并集，共 611 条。
//        版本号 5.6.16 → 5.6.17
// v5.6.23 — 现货窄止损不再硬阻断 + 移除「盈亏比反推」面板
//        - P1 现货（杠杆 0x）被「止损距离过近」硬阻断拦下：该阻断的判据
//          stopDistance < 入场价 × 0.1% 不看杠杆，对合约成立（保证金按 1/止损距离 放大，
//          且强平价距入场价仅 1/杠杆，窄止损叠高杠杆几乎必然先被强平），对现货不成立——
//          现货仓位上限就是可用本金，超限由交易所上限与 90% 聚合上限截断，风险额按截断
//          后仓位回算，实际风险只会【小于】计划风险（0.064% 止损 + 1% 计划风险 →
//          实际 0.058%）。结果是把一笔合法的小风险现货交易挡在门外，且提示里
//          「仓位会被放大到不可控规模」在现货下是错的。现改为：杠杆 > 0 才硬阻断，
//          现货只给提示（理论仓位会被压到多少、实际风险变成多少）。
//        - 附带：交易所上限的截断文案在现货下写「可用本金 × 1x」，现货没有倍数，
//          会让用户以为自己开了合约；改「（现货，无杠杆）」。
//        - 移除「盈亏比反推」卡片：#reverseTP / #reverseSL 是只读展示框，算完既不写回
//          #targetPrice / #stopLoss，也不喂给多止盈位规划（三档由 autoCalcMultiTP 按
//          settings.tpRRs 在每次计算后自动求解并直接显示各档含费净 RR），想用得手动
//          抄数字——是与多止盈位规划重复的死胡同。求解内核 solveTPForRR 仍在用；
//          calcReverseTP / calcReverseSL 保留为测试入口（第 27 组）。
//        版本号 5.6.17 → 5.6.23

// 5.6.38：四组操作反馈动画 + 视图交叉淡入淡出（2026-11-02）
//
//   新增四组有意义的操作反馈动画，均为 transform/opacity 级别，不影响布局：
//
//   ① 交易日志新增行插入动画（table.css + rendering.js）
//      新交易落库时，对应行从左侧滑入（240ms）+ 左侧强调条短暂亮起后淡出。
//      此前新行直接出现，无任何过渡——这是核心"我做了某事"的反馈时刻。
//      由 rendering.js 的 _prevRenderedIds 追踪上次渲染的日志 ID 集合，
//      检测到新 ID 时给对应行加 .row-new 类触发动画。
//
//   ② 风险档位跨越脉冲（dashboard.css + dashboard.js）
//      组合热量从 warn 跨越到 danger（或反向）时，风险数值做一次短暂
//      透明度脉冲（600ms），提示用户状态已变。此前颜色静默切换，
//      无人注意。由 _dashPrevRiskTier 追踪上次档位，跨越时加 .tier-pulse。
//
//   ③ 视图切换交叉淡入淡出（layout.css + navigation.js）
//      旧视图淡出（180ms）的同时新视图淡入（150ms），此前旧视图瞬时消失。
//      由 _doSwitchView 在切换前加 .view-leaving 类触发，180ms 后清理。
//
//   ④ 设置保存按钮闪烁（settings.css + settings.js）
//      保存成功后按钮短暂变绿再恢复，提供即时视觉确认（toast 之外更快的感知）。
//      由 saveSettings 成功路径加 .save-flash 类触发，600ms 后自动移除。
//
//   所有动画均含 @media (prefers-reduced-motion: reduce) 降级路径。

// 5.6.39：图表渲染错误兜底 + 三个零覆盖模块补盲断言（2026-11-02）
//
//   ① 图表渲染错误兜底（analytics.js + review.js）
//      此前所有 new Chart() 调用无 try/catch：Chart.js CDN 不可达或单个图表
//      数据异常时抛异常，导致后续图表静默不渲染且无任何提示。
//      新增 safeChart() 包装函数：18 处 new Chart() 全部替换，
//      单图失败时显示占位文案 + console.error，不阻断后续渲染。
//      错误处理器自身也做了防御（canvas.style 缺失时不二次抛异常）。
//
//   ② 三个零覆盖模块最小断言集（test/verify_coverage_gaps.js）
//      analytics.js / review.js / stats.js 此前零测试覆盖
//      （run-tests.html 只加载 17 个 JS，不含这三个）。
//      新增 36 条断言：extractPatternName / safeParseNum / groupByStrategy /
//      groupByDimension / computeGroupStats / computeWinLoss 的边界值 +
//      safeChart 的异常路径（Chart 抛异常 / Chart 未定义 / 正常创建）。

// 5.6.40：五项审计修复——保存闸门大小写/凯利还原前置热量预检/曲线基准口径/
//         凯利全胜提示/ChartManager 延迟销毁竞态（2026-11-02）
//
//   ① P2 · 保存闸门品种比对改大小写不敏感（calculator.js assertSavableCalculation）
//      calc.symbol 已 toUpperCase 归一，而输入框的 text-transform:uppercase 只是视觉大写，
//      闸门原用全等比较 fv('symbol') !== String(calc.symbol)：手输 "btc" 时快照是 "BTC"，
//      保存被永久误拦（「参数已变更（品种）」且重算无法解除——重算只是再生成同样的快照）。
//      现两端各自 trim+toUpperCase 后比较（_verify_bugs.js A2 实证放行）。
//
//   ② P2 · 凯利驱动取消后的还原前移到组合热量预检之前（calculator.js _calculateImpl）
//      预检直接读 #riskInput 估算本仓计划风险；勾选凯利后 riskInput 残留驱动值（如 5%），
//      原还原代码在预检之后，且会被硬阻断的提前 return 短路——取消凯利后重算被
//      「组合热量超限」误熔断，表单停留在过期驱动值。还原只改显示值、不参与数值计算，
//      提前执行无副作用（_verify_bugs.js B3/B3b 实证：还原为 2%、重算放行）。
//
//   ③ P2 · 资金曲线基准提示与实际实现对齐（analytics.js renderEquityChart）
//      utils.js calcEquityCurve 以「最早一条已平仓日志的 capital 快照」为曲线起点
//      （首笔缺失才回退 accountBalance），原提示却写「设置中账户余额（曲线以此为准）」
//      ——余额与首笔快照偏差 >1% 时，提示标注的起点与曲线实际起点对不上。
//      现改为以实际起点（最早日志本金快照）为准，设置余额仅作对照参考。
//
//   ④ P3 · 全胜/无亏损策略凯利静默失效补提示（skills-integration.js + calculator.js）
//      losses=0 时 avgLoss=0，calcKelly 判无效返回 null，凯利卡片/驱动静默消失。
//      新增：calcKellyStatsFromLogs 返回 noLosses 标记；autoFillKellyFromLogs 不再写入
//      "0.00" 占位、给出「样本无亏损，无法计算平均亏损（凯利不适用）」明确提示；
//      凯利参考区对 avgLoss≤0 显示可见警告（不写 kellyData，避免向日志持久化无效标记）。
//      calcKelly 本体判 null 不变（全胜时凯利数学上无定义，显式告知而非静默失效）。
//
//   ⑤ P3 · ChartManager 同 key 重注册立即销毁旧实例（utils.js）
//      register 遇 key 冲突原走默认延迟 1000ms 销毁：同 canvas 重渲染（常态）时新 Chart
//      会因旧图未销毁抛 "Canvas is already in use"，延迟回调还会抹掉新实例的 __chartKey
//      标记，形成跨实例竞态。改为 unregister(key, true) 同步销毁（现有调用点均传
//      immediate=true，行为不变；_verify_bugs.js E1/E2 实证）。
