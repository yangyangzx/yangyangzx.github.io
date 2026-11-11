# 系统缺陷台账 · AUDIT

> **建立**：2026-11-10　|　**基线**：v5.6.45（HEAD `600ebed`）
> **来源**：四组并行只读专项审计（核心算法 / 日志统计复盘 / 风控配置 IO / 结构测试基建）+ 14 个 jsdom 端到端探针（`/tmp/audit_*.js`）
> **范围**：全系统 bug 与不足，重点是**数据准确度**

## 状态口径

| 状态 | 含义 |
| --- | --- |
| `待办` | 已实证，尚未动代码 |
| `整改中` | 红测已写，正在修 |
| `已修复` | 必须同时具备：红测复现 → 修复 → `--inject` 逐条复红 → 全量回归 + 断言总数核对 |
| `复核正确` | 审计中被怀疑、但实证为正确；**禁止为改而改** |
| `产品决策` | 属口径/设计取舍，需用户拍板，不得由开发擅自改 |

**验收纪律**：每批改动后必须复跑 `npm test`，并核对断言总数不低于基线（`全绿 ≠ 无退化`）。

---

## 0. 结论摘要

| 级别 | 数量 | 性质 |
| --- | --- | --- |
| **P0** | 6 | 会导致「验证结论不可信」或「数据静默丢失 / 静默算错」 |
| **P1** | 18 | 口径分叉、显示与闸门矛盾、精度、导入可逆性、路由状态漂移 |
| **P2 / 产品决策** | 7 | 需拍板的建模与设计取舍 |

**基线门禁现状（实证）**：`npm test` → 18/18 全绿、exit 0，但汇总表里有 **7 个跑测器显示 `(无摘要)`**，即近四成跑测器的断言数根本没被门禁看见；`_verify_bugs.js`（14 条断言）从未纳入 SUITES。已实测断言基线 **3624 条 / 18 个跑测器**（加 `_verify_bugs.js` 为 3638 条 / 19 个）。

**当前整改进度（v5.6.47 · 全部收口）**：**6 个 P0 全部已修复**，**18 个 P1 全部已修复**（P1-14 / P1-18 在批次 0~1，其余 16 项在批次 2~3），P2 中的 D-06 / D-07 已按「修正文档口径」与「收口历史数字」落地；剩余 5 项为需用户拍板的**产品决策**（D-01~D-05），未擅改。门禁升级到 **31 项（22 正常 + 9 注入自检）/ 3724 条断言**，版本与缓存戳同步到 5.6.47。

---

## 1. P0 清单（6 条）

| # | 问题 | 位置 | 危害 | 批次 | 状态 |
| --- | --- | --- | --- | --- | --- |
| P0-1 | 门禁假绿：只信 exit code，零断言 / 无摘要也放行；`--inject` 从不进 `npm test` | `test/run-all.js:68` | 后续所有「全绿」都不可信 | 0 | **`已修复`** |
| P0-2 | 多标签并发静默丢记录：`saveLogs` 全量覆盖 + `storage` 异步确认无版本/时序栅栏 | `js/storage.js` | 用户已保存的交易记录被另一个标签抹掉 | 1 | **`已修复`** |
| P0-3 | 设置缓存污染风控闸门：`loadSettings()` 返回可变缓存本身，写盘失败不清缓存 | `js/settings.js` | 内存/磁盘分叉，硬闸门按脏值放大 | 1 | **`已修复`** |
| P0-4 | 有效入场价两个来源：顶层 `effectiveEntryPrice` 与三份滑点快照取自不同默认值 | `js/calculator.js:321` vs `:1218` | 同一笔仓位落库两个互斥价，编辑重算静默改写 | 2 | **`已修复`** |
| P0-5 | 权益曲线缺 `capital` 时回退当前净值 `accountBalance`，重复计入已实现盈亏 | `js/utils.js:879` | 净值、最大回撤、夏普、CAGR 全部错 | 2 | **`已修复`** |
| P0-6 | 历史导入 `_localeToISO` 把本地墙钟时间当 UTC 硬拼 `Z`，+8h 漂移 | `js/utils.js:479-485` | 今日/本周/连亏/熔断/日盈亏/夏普分桶全部错 | 1 | **`已修复`** |

### P0-1 · 门禁假绿
复现：造一个假跑测器，输出「通过 1 / 失败 5」但 `process.exit(0)`；再造一个零断言跑测器（无任何汇总输出）`exit(0)`。旧 `run-all.js` 两者都判 PASS，整体 exit 0。
附带缺陷：`results.push` 在失败分支与循环末尾各执行一次（**双 push**）；`_verify_bugs.js` 未纳入 SUITES；退出码判定与断言结果完全脱钩。

### P0-2 · 多标签静默丢记录
复现：A、B 两标签各自持有不同 `logs` 数组，A 写入 `from-A` 后 B 基于旧快照 `saveLogs` 全量覆盖，磁盘上 `from-A` 消失，而 A 内存里仍在；`storage` 事件触发的 `confirmDialog` 异步无版本栅栏，旧事件晚到确认可反向覆盖新数据。

### P0-3 · 设置缓存污染风控
复现：取 `loadSettings()` 返回对象原地改 `dailyLossLimit = 45`（磁盘仍为 5），`checkDailyLossLimit(10000).limit` 从 500 变成 **4500**（放大 9 倍）；`_clearSettingsCache()` 后恢复。写盘失败时缓存未失效，同样分叉。

### P0-4 · 有效入场价两个来源
顶层：`readPlanSlippage(symbol, orderType, entryPrice)` → `Slippage.applyAdversePrice(...)` 得 `effectiveEntryPrice`。
滑点快照：当 `mode !== 'manual'` 时改用 `Slippage.getDefaultTicks(stopType)` 的 `entryTicks/exitTicks`，得到**另一个** `effectiveEntryPrice`。
活证据：`node test/_verify_bugs.js` 输出中，同一份 calc 顶层 `effectiveEntryPrice: 50000.1`，而 `slippage.planning.effectiveEntryPrice: 50000.2`。

### P0-5 · 权益曲线重复计入
复现：3 笔已平仓 Σpnl = +250、无 `capital` 字段、`accountBalance = 10250`（即当前净值已含这 250），`calcEquityCurve` 以 10250 为起点再累加 250 → `finalEq = 10500`，**多计 250**。应由 `capital` 开仓快照起算；缺失时 fail-closed，不得回退当前净值。

### P0-6 · 导入时间 +8h 漂移
复现：历史 CSV 格式 `'2026/11/09 20:00:00'` → `2026-11-09T20:00:00Z`，正确值应为 `2026-11-09T12:00:00Z`。`toLocalDateStr` 把 11-09 晚间单分到 **11-10**，导入流水线 `repErrors=[]` 无任何拦截，「今日 PnL」显示 `+500.00 / 共 1 笔`。导出侧 `io._safeISOString` 是正确的 → **导入/导出不对称**。

---

## 2. P1 清单

| # | 问题 | 位置 | 实证 / 影响 | 批次 | 状态 |
| --- | --- | --- | --- | --- | --- |
| P1-01 | 本周胜率只有下界无上界 | `js/dashboard.js:169` | 2099 年的记录被计入「本周」 | 2 | **`已修复`** |
| P1-02 | 筛选态风控中心显示与硬闸门分叉 | `js/risk.js:140` vs `js/skills-integration.js:537` | 页面显示「今日盈利 +100」，闸门内部 `todayPnl=-900 / blocked=true` | 2 | **`已修复`** |
| P1-03 | 筛选态 CAGR 与夏普本金口径矛盾 | 统计链 | CAGR 用全局本金 10000、夏普用筛选样本 2000（+80.33% vs 应 +1128.51%） | 2 | **`已修复`** |
| P1-04 | 分析页图表用全量、统计卡用筛选态 | `js/analytics.js` / `js/stats.js` | 同一面板最大回撤 8% vs 58% | 2 | **`已修复`** |
| P1-05 | 多腿部分平仓 `closePrice` 落末腿价 | `js/logs.js` | 末腿 130 vs 加权均价 117.5，反推毛利 300≠175，目标达成率被误导 | 2 | **`已修复`** |
| P1-06 | 成本侵蚀分母漏 `slippageCost` | `js/stats.js` | 1.8% vs 应 1.6% | 2 | **`已修复`** |
| P1-07 | MAE/MFE 基准用 `entryPrice`，PnL 用 `effectiveEntryPrice` | `js/logs.js` `storeMAEMFE` | 100 vs 101，极值基准错位 | 2 | **`已修复`** |
| P1-08 | 落库 `pnlAmount.toFixed(2)` 与 `fee.toFixed(8)` 精度不一致 | `js/logs.js` | 100 笔 0.0049 → 真实 0.49，落库 0 | 2 | **`已修复`** |
| P1-09 | `importWarnings` 前缀统一误报 | `js/settings.js:808` | 3 条记录全部导入成功，却报「3 行列数与表头不一致，已跳过」；实际是 `closeType` 未知值告警被冠错前缀 | 2 | **`已修复`** |
| P1-10 | `IMPORT_NUM_FIELDS` 把 `stopType` / `atrStopMode` 当数值列 | `js/settings.js` | 枚举值被数值化 | 2 | **`已修复`** |
| P1-11 | `signals` CSV 导出中文标签、导入按 `;` 切且无反查 | `js/io.js` / `js/settings.js` | 往返不可逆 | 2 | **`已修复`** |
| P1-12 | `strategyPattern` 拼入展示文案污染结构化字段 | `js/settings.js` | 往返不可逆 | 2 | **`已修复`** |
| P1-13 | 欧式小数逗号静默漂移 | `js/settings.js` | 数值被截断 | 2 | **`已修复`** |
| P1-14 | `restoreFromAutoBackup` 跳过迁移 / 补 id / 脏值隔离 | `js/settings.js:932` | 备份恢复链与 `loadLogs` 口径不一致 | 1 | **`已修复`** |
| P1-15 | popstate/hashchange 脏检查取消后 URL 与 `_currentView` 永久漂移 | `js/navigation.js` | 界面与地址栏不一致 | 3 | **`已修复`** |
| P1-16 | `calcRoundTripFee` 残留 `Number(feeRatePct) \|\| 0` | `js/calculator.js` | 违反全局 `toFiniteNum` 纪律 | 2 | **`已修复`** |
| P1-17 | 单一 `feeRate`、manual ticks 预置 0、L1 ticks 文案错、负 `targetRR`、本金校验与极小本金显示 | `js/calculator.js` / 表单 | 边界输入可产生异常计划 | 2 | **`已修复`** |
| P1-18 | `run-all.js` 失败双 push、7 个跑测器摘要解析不到、`_verify_bugs.js` 漏跑 | `test/run-all.js` | 统计数字失真 | 0 | **`已修复`** |

> 已实证**非 bug**（对照项，勿误改）：CSV 往返除上述字段外 15 个字段全保真；干净样本三页面总盈亏一致；脏字符串两处一致；连亏计数不受未来日期污染。

---

## 3. P2 / 产品决策（需拍板，勿擅改）

| # | 议题 | 说明 | 状态 |
| --- | --- | --- | --- |
| D-01 | 资金费率 / 过夜利息是否建模 | 当前盈亏口径不含持仓成本，属产品范围决策 | `产品决策` |
| D-02 | 三结果凯利精确解 | 现为两结果近似 | `产品决策` |
| D-03 | 风险加权 R | 现为等权 R 倍数 | `产品决策` |
| D-04 | 无目标价时的最大亏损口径 | 现取止损金额，是否含滑点/费用需定义 | `产品决策` |
| D-05 | 涨红跌绿配色 | 当前为国际惯例配色，改为中国习惯属设计取舍 | `产品决策` |
| D-06 | CDN 本地化 or 修正「完全离线」文档口径 | Chart.js 走 CDN，文档宣称完全离线 | **`已处理`**：选「修正文档口径」分支，README/CLAUDE 写明 CDN + `chart-guard.js` 降级；CDN 本地化未做（仍属产品决策，如需完全零外部依赖再单独立项） |
| D-07 | 文档历史口径残留 | README/CLAUDE 中 13/15/16/18 个跑测器、665 条断言、28 处缓存戳、5.6.37 过期 | **`已完成`** |

---

## 4. 复核正确项（禁止为改而改）

强平价 IM/MM 恒等式与 `floor(1/(2×MMR))=100x` 硬阻断；分批资金权重调和平均；夏普日收益率 + 样本标准差 `÷(n−1)` + 365 年化；利润因子 `grossProfit/grossLoss` 净额口径（仅变量名误导）；集中度按保证金累加（保守正确）；半凯利 = 钳制后完整凯利 / 2；CSV `closeType` 导机器键 + 导入反查中文；`sanitizeLogNumbers` 无条件调用且不动 `null`；`isClosedTrade` fail-closed；`io._safeISOString` 导出时间正确；单次结算扣 fee + legacy slippage 正确；三腿累计金额链自洽；删除日志后 `statTotalPnl` 重算无缓存失效；`importSettings` 已有逐字段校验。

---

## 5. 整改批次与验收标准

| 批次 | 主题 | 内容 | 前置 | 状态 |
| --- | --- | --- | --- | --- |
| **0** | 门禁可信化 | 统一机器可读 `GATE` 契约；`run-all.js` 解析断言而非只信 exit code；断言总数下限守护；`--inject` 纳入 `npm test`；修双 push；补跑 `_verify_bugs.js` | 无（**所有验证的前置**） | **`已完成`** |
| **1** | 数据不丢 | P0-2 / P0-3 / P0-6 / P1-14：`saveLogs` 版本栅栏与合并；`loadSettings` 只读副本 + 写盘失败清缓存；`_localeToISO` 用真实 `Date` 转换；备份恢复走迁移 | 批次 0 | **`已完成`** |
| **2** | 口径统一 | P0-4 / P0-5 及 P1-01~13、16~17：有效入场价单一来源、曲线 `capital` fail-closed、本周上界、筛选态口径、落库精度、导入字段与告警、末腿均价、成本侵蚀、MAE 基准 | 批次 0 | **`已完成`** |
| **3** | 结构收敛与收尾 | P1-15 / D-06 / D-07：今日盈亏与权益递推收敛到单一函数、hash 路由脏检查、文档口径；升版、CHANGELOG、README/CLAUDE、工作日志 | 批次 0~2 | **`已完成`** |

**每批必须**：红测复现 → 修复 → `--inject` 逐条独立复红 → `npm test` 全量 → 核对断言总数 ≥ 基线 → 更新本表状态 → 追加工作日志。

---

## 6. 状态追踪

| 日期 | 动作 | 结果 |
| --- | --- | --- |
| 2026-11-10 | 四组审计完成，用户明确「暂时不整改」 | 生产代码零改动，仅写工作日志 |
| 2026-11-10 | 用户要求「把问题记录下来，开始优化整改」 | 建立本台账，进入批次 0 |
| 2026-11-10 | **批次 0 完成（P0-1 / P1-18）** | 见下方「批次 0 验收证据」 |
| 2026-11-10 | **批次 1 完成（P0-2 / P0-3 / P0-6 / P1-14）** | 见下方「批次 1 验收证据」 |
| 2026-11-10 | **升版 5.6.46 并同步缓存戳** | 固化批次 0+1 成果，消除浏览器加载旧脚本风险；`npm test` 29/29 |
| 2026-11-10 | 用户授权「代办的修复全部优化」 | 一次性完成剩余 2 个 P0 + 15 个 P1 + 批次 3 结构项，滑点口径由开发按建议拍板 |
| 2026-11-10 | **批次 2 / 3 完成（P0-4 / P0-5 / P1-01~13、15~17 / D-06 / D-07）** | 见下方「批次 2/3 验收证据」 |
| 2026-11-10 | **升版 5.6.47 并同步缓存戳** | 固化全部整改成果；`npm test` 31/31、3724 条断言 |

### 批次 0 验收证据

| 环节 | 实证 |
| --- | --- |
| 红测 | 复制真实 `run-all.js` 换 SUITES 指向假跑测器：假绿（输出「失败 5」但 `exit 0`）与零断言跑测器**都被判 PASS**，整体 `exit 0` |
| 修复 | 新增 `test/_gate.js` 统一契约 `GATE PASS/FAIL/TOTAL` 与 `GATE INJECT CAUGHT/EXPECTED`；19 个存量跑测器收尾各加一行 `emit`；重写 `run-all.js`（只认契约、fail-closed、逐组 `min` 下限 + 全局总数守护、修双 push、补跑 `_verify_bugs.js`）；7 组 `--inject` / `REGRESSION` 纳入 `npm test` |
| 反向用例 | 新增 `test/verify_gate.js`：15 个端到端场景 + 5 条静态守护；`--inject` 把 11 条守卫**逐条独立架空**，11/11 全部被捕获 |
| 自纠 | 注入自检首轮 10/11：G9 逐组下限被全局总数守护兜底，单独架空仍报红。改为「成对架空」后 11/11，属双保险生效而非缺陷 |
| 前后对比 | 同一 fixture：修复前 `exit=0 全 PASS` → 修复后 `exit=1`（G5 假绿 / G1 缺契约各判红） |
| 全量 | `npm test` **27/27**（20 正常 + 7 注入自检），`断言总数 3658 / 下限 3658 ✅`（基线 3624 + 补跑 14 + 新增 20，无退化） |
| 语法 | 20 个改动 JS + 2 个新增 JS 全部 `node --check` 通过 |
| 版本 | 仍 5.6.45；`js/` 生产代码零改动，缓存戳无需变更，升版留批次 3 统一收口 |

### 批次 1 验收证据

| 环节 | 实证 |
| --- | --- |
| 红测 | `TZ=Asia/Shanghai` 下 jsdom 加载真实 `index.html`，四项全部复现：`2026/11/09 20:00` → `20:00Z`（+8h，`toLocalDateStr` 漂到 11-10）；闸门 `500 → 4500`；另一标签的 `from-B` 被抹掉；备份恢复后无 id / 旧格式时间 / `Infinity`、`NaN` 原样入库。常驻脚本 `test/verify_data_integrity.js` 首跑 **3 通过 / 13 失败** |
| 修复 | `js/utils.js` `_localeToISO` 改本地 `Date` 构造 + `toISOString()`，并拒绝日历溢出；`js/settings.js` `loadSettings()` 一律交出深拷贝 + 写盘失败 `_clearSettingsCache()`，新增 `_normalizeRestoredLogs()`（数值归一 → Schema/时间迁移 → 脏值隔离 → 补 id）；`js/storage.js` 新增 `_logsDiskBaseline` + `_reconcileLogsWithDisk()`（以磁盘为基合并、同 id 本标签优先），`loadLogs` / 写盘成功 / storage 同步三处同步基线 |
| 反向用例 | 4 个注入点各自单独 boot 干净 JSDOM（旧时间实现 / 返回可变缓存引用 / 撤掉对账 / 跳过恢复归一），**4/4 全部复红**。首轮 3/4：`settings-ref` 桩直接读 `w.SETTINGS_CACHE`，清缓存后变 null 而崩溃；改为闭包捕获可变对象后 4/4 |
| 揭出的存量假绿 | 全量首跑 2 个存量跑测器报红（主回归 2 条 / `verify_config_fix.js` 6 条）。根因：这些断言靠「原地改 `loadSettings()` 缓存」造场景，**从未验证真的写盘**。按纪律改为真链路：主回归补 `setTpRR1/2/3` 表单元素让 `saveSettings()` 走完；`verify_config_fix.js` 四个 setter 补 `_clearSettingsCache()`，C4 期望值改为「null 由唯一净化入口回退、15 正常落库读回」。修正后主回归 675/0、config 17/0 |
| 全量 | `npm test` **29/29**（21 正常 + 8 注入自检），`断言总数 3674 / 下限 3674 ✅`（+16 条，无退化）；8 个改动 JS `node --check` 通过 |
| 版本收口 | 已升版 **5.6.46** 并同步 `index.html` 49 处 / `run-tests.html` 17 处 / `manifest.json` 3 处缓存戳与 `APP_VERSION` 绊线，中间态「浏览器加载旧脚本」风险消除 |

### 批次 2 / 3 验收证据

| 环节 | 实证 |
| --- | --- |
| 红测 | 新增 `test/verify_batch2.js`，用「内存副本 ResourceLoader」加载真实 `index.html` + 13 个可变异 JS，6 组 49 条断言首跑 **7 通过 / 42 失败**：P0-4（顶层 50000.1 vs 快照 50000.2）、P0-5（`finalEq=10500`）、P1-06（2.0% vs 应 1.6%）、P1-15（hash 漂移）等全部复现 |
| 口径拍板 | P0-4 采用「**入场腿 ticks 一律按 `orderType`**（开仓滑点只与下单方式有关），只有退出腿 ticks 按各腿执行类型区分」；止损腿不再覆写 `stopEntryTicks`，四份 `effectiveEntryPrice` 统一为 50000.1。未放宽任何风控边界 |
| 修复 | 14 个生产 JS + `index.html`：`utils.js` 新增 `resolveStartEquity` / `getDisplayClosed` / `computeTodayPnl` / `getWeekRange` / `isInThisWeek` / `computeWeightedClosePrice` / `roundAmount` / `PNL_DIGITS=8` 共 8 个共享 helper，权益曲线缺 `capital` 改 fail-closed；`calculator.js` 统一入场 ticks、脏费率、本金与边界；`logs.js` / `modals.js` 金额链统一 8 位精度 + MAE 基准同源 + 加权平仓均价；`stats.js` / `dashboard.js` / `analytics.js` / `risk.js` / `skills-integration.js` 收敛到同一本金决议 / 筛选样本 / 今日盈亏 / 权益递推；`io.js` / `settings.js` 修 CSV 往返可逆性；`navigation.js` 脏检查取消回滚 URL |
| 反向用例 | `--inject` **25 个注入点**，每个单独 boot 干净 JSDOM，把修复后源码在内存里改回旧实现，**25/25 全部对应组复红**。首轮 23/24：`P1-11` 注入「导出改回中文标签」被导入侧历史中文反查兜住，D5 往返断言仍绿 → 补 **D10 导出侧真链路断言**（检查「信号K」列必须是 `engulfing;macdCross` 机器键）后 24/24。关闭任务前的跨模块同类审计又揭出 `modals.js:1330~1390` 编辑平仓链整段仍用 `toFixed(2)`（C7 首版断言过宽没抓住）→ 强化 C7 并补第 25 个独立注入点，最终 **25/25**。属兼容层生效与断言过宽，非修复失败，但注入点必须能暴露修复 |
| 自纠（真实回归） | `getCurrentDrawdown()` 首版 fail-closed 过严：零日志的新用户也被 `readFailed=true` 拦住开仓（A0 报红）。修正为区分「无交易（正常，`readFailed=false`）」与「有交易但缺 `capital`（异常，硬阻断）」 |
| 揭出的存量假绿 | 全量首跑前一批已修 2 个跑测器 8 条假绿（靠原地改 `loadSettings()` 缓存造场景、从未验证写盘），按纪律改真链路而非回退修复；本轮又发现 `verify_batch2.js` D 组 D5 单独守不住导出侧，已补 D10 |
| 全量 | `npm test` **31/31**（22 正常 + 9 注入自检），`断言总数 3724 / 下限 3724 ✅`（基线 3674 + 新增 50，无退化）；全部改动 JS `node --check` 通过；`verify_assets.js` 15/0 |
| 版本收口 | 升版 **5.6.47**：`js/version.js` + `index.html` 49 处 / `run-tests.html` 17 处 + `APP_VERSION` 绊线 / `manifest.json` 3 处；`CHANGELOG.md` 新增条目；README / CLAUDE 顶部版本与门禁数字（31 项 / 3724 条）同步 |
| 剩余 | D-01~D-05 五项产品决策（资金费率建模、三结果凯利精确解、风险加权 R、无目标价最大亏损口径、涨红跌绿配色）需用户拍板，未擅改；D-06 仅做「修正文档口径」，CDN 本地化未做 |

---

## v5.6.48 补记（2026-11-11 · 侧栏样式改良，不属数据准确度范围）

| 项 | 内容 |
|---|---|
| 触发 | 用户提供 Uiverse「12 光斑金黄 CTA」CSS，问能否套到左侧 7 个模块按钮。评估出 **P0×2 / P1×3** 冲突：固定金黄抹平 `--nav-hue` 七色相锚点、7 项同亮使 active 层级消失、白字黄底约 1.5:1、12×7=84 个 blur 光斑常驻 `infinite`、`.wrapper/.circle` 与 `:before` 内阴影环撞上现有浮起层/色标。结论「不建议原样套用」，用户拍板**改良版** |
| 新发现（P1，已修复） | `css/layout.css:21` 的 `prefers-reduced-motion` 兜底只写 `body { animation: none; }`，animation 不继承，`navSweep` / `navDotPulse` 在系统开启「减少动态效果」时照跑 → 补一条显式点名 `.nav-item` 及 `::before/::after` 的 `!important` 兜底 |
| 落地 | `css/layout.css` 新增两团从 `--nav-hue` 派生的 `radial-gradient` 柔光，圆心由 `@property <percentage>` 插值（`navGlowDrift` 9s），**仅 active::before 播**；hover 覆写 `--nav-glow-duration` 到 3.2s 加速，不新开动画。零新增 DOM，7 色相 / 凹槽立体 / 双主题 / focus-visible 全部不动 |
| 守护 | 新增 `test/verify_nav_glow.js`：18 条静态断言（作用域 / 颜色派生 / 无障碍 / 结构 / 成本 / layout.css 缓存戳）+ `--inject` 12 点逐条独立内存副本注入。红测首跑 **11 绿 7 红**，改完 **18/0**，注入 **12/12** |
| 实证 | Chrome headless 真渲染：7 项各色相清晰、选中项淡蓝高亮、文字可读、无金黄胶囊；正常模式侧栏两帧像素差异 245，开启 reduced-motion 后两帧差异 **0**（兜底真生效） |
| 全量 | `npm test` **33/33**（23 正常 + 10 注入自检），`断言总数 3742 / 下限 3742 ✅`（基线 3724 + 新增 18，无退化）；升版 5.6.48，缓存戳 49 / 18 / 3 处同步 |
| 边界 | 本轮仅为 UI 样式改动，未新增数据准确度问题；D-01~D-05 五项产品决策仍未擅改 |
