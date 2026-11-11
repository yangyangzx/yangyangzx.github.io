# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

TradingDiscipline：纯前端交易风控/复盘终端（**v5.6.48**），无任何构建工具。原生 JS（IIFE + 全局函数）+ CSS（OKLCH 变量），数据全部存 localStorage、不上传任何服务端；图表库走 CDN，断网时由 `js/chart-guard.js` 降级为占位桩，核心计算与数据不依赖网络。`index.html` 直接可运行，但推荐用本地 HTTP 服务器打开（file:// 下 PWA manifest / 部分浏览器行为受限）：

```bash
python3 -m http.server 8000   # 然后开 http://localhost:8000
```

规模：`index.html` 单页 + 28 个 js + 15 个 css + 2 个 CDN（Chart.js 4.4.0、Font Awesome）。核心文件 `js/calculator.js` / `js/modals.js` / `js/analytics.js` 行数随版本变化，以 `wc -l` 为准。

## 常用命令

```bash
node --check js/<file>.js          # 改完 JS 先语法检查
npx eslint js/                     # Lint（注意：.eslintrc.json 未启用 no-undef，见下）
npm test                           # 无头全量回归：23 个正常跑测器 + 10 组注入自检（33 项），有失败则 exit 1
npm run test:main                  # 只跑主回归（test/_rt_headless.js，浏览器内 run-tests.html）
npm run test:browser               # 浏览器内回归：打开 test/run-tests.html 自动跑全部断言
# 改完前端后强刷：URL 追加 ?cb=<时间戳> 避开缓存（index.html 里资源已带 ?v=<当前版本>，改 JS/CSS/图标时须同步升版）
```

**块作用域泄漏必查**（`.eslintrc.json` 没开 `no-undef`，所以常规 lint 查不出这类崩溃）：
存量代码里多次出现「`const` 声明在 `if` 块内、却在块外被引用」——`node --check` 不报错，
只有跑到那条分支才抛 `ReferenceError`，还被 `calculate()` 的 catch 吞成一句无关的提示
（v5.6.16 修的 `minRR is not defined` 就是这么来的）。改完 js 跑一次：

```bash
npx eslint --no-eslintrc --env browser,es2021 \
  --parser-options=ecmaVersion:12,sourceType:script \
  --rule '{"no-undef":"error"}' -f json js/*.js
```
报错里会混入大量跨文件全局（`showToast`、`Slippage`…）属正常误报；**只需看那些"本文件内有同名 `const/let/var/function` 声明"的**——那就是真泄漏。

✅ **`npm test` 可用**（v5.6.34 起）：它跑 `node test/run-all.js`，聚合正常跑测器与注入自检组，任一失败即 `exit 1`。当前为 33 项（23 正常 + 10 注入自检）/ 3742 条断言。

> 历史（勿照旧结论理解）：此前 `npm test` 指向 jest 配置，`testMatch` 写 `**/tests/**/*.test.js`、`setupFiles` 写 `./tests/setup.js`，而 `tests/` 目录早在 2026-08-14（`4ba7130`）就已删除 —— 跑必然 Validation Error。同时 14 个跑测器里 6 个无条件 `process.exit(0)`，而唯一退出码正确的 `_rt_headless.js` 又被一条 jsdom `maxHeight "0"` vs 浏览器 `"0px"` 的断言卡成永久红灯，等于全仓 3,300+ 条断言**没有任何一道有效门禁**。这三处已在 v5.6.34 全部修掉。

新增断言优先加进 `run-tests.html`；只有需要完整 `index.html` DOM（`resetForm`、`openEditModal` 这类）时才写进 `test/verify_*.js`——`run-tests.html` 的 DOM 是精简的，调用依赖完整表单的函数会直接把整个 `runAll` 炸掉（summary 停在 `—`，比一条失败更隐蔽）。

## 架构要点（跨文件才能看懂的部分）

**加载顺序即依赖顺序**（index.html 里 28 个 script，顺序不可调换）：

```
chart-guard → constants → utils → select-ui → toast → slippage → storage →
skills-integration → calc-visuals → calculation-ui → calculator → logs → rendering →
stats → modals → navigation → dashboard → planner → discipline-led → settings →
risk → chart-factory → analytics → review → io → dom-cache → app → version
```

三个易被忽略的前置/后置模块：
- `chart-guard.js` **必须最先加载**：Chart.js CDN 不可达时它注入占位桩，否则下游所有图表静默白屏（v5.6.7，见文件头注释）。
- `select-ui.js` / `calc-visuals.js` 是 v5.5+ 新增，分别负责自定义下拉/组合框与计算结果可视化，被 calculator 与 settings 依赖。
- `version.js` **必须最后加载**：无依赖，但测试页第 30.8 组要读 `APP_VERSION` 校验版本号一致性。

**全局挂载约定**：各模块通过 `window.utils` / 全局函数暴露。`js/utils.js` 末尾执行 `window.utils = util` 并补了一个全局别名。⚠️ 历史坑（v5.2 P0）：`js/risk.js` 曾用裸标识符 `util.isClosedTrade` 调用，而生产环境只有 `window.utils`——权威分支从未执行，被 `test/run-tests.html` 内的局部 `var util = window.utils` 掩盖。改动跨模块调用时务必确认用的是 `window.utils`（或文件内已确认的全局别名），不要用裸 `util`。

**开仓计算管线**（`js/calculator.js`，2200+ 行，核心）。真实顺序是**闸门前置 + 逐层截断**，不是一条直线：

```
读表单 → 滑点 → ATR/临时止损 → 【闸门】日亏损 → 交易频率 → 组合热量(预估) → 连亏
→ 风险金额(凯利可驱动) → 【闸门】单笔风险上限 → 凯利覆写 →【闸门】凯利上限
→ 名义仓位 →【闸门】最小止损距离 → 累计已有保证金 → 截断①保证金80% ②交易所上限
→ 截断③聚合90% →【闸门】额度耗尽 →【闸门】强平校验 → 截断④连亏系数
→ 截断⑤品种集中度 → 截断⑥心态评分 → 组合热量复核 →【闸门】品种止损上限
→ 手续费+双侧滑点 → 渲染卡片 → 落快照 → 检查清单
```

要点：熔断闸门**前后夹击**而非末端单点（日亏损/频率/热量/连亏在风险金额算出之前执行，组合热量在截断后再复核一次）；强平校验之后还有三道截断（连亏/集中度/心态）。2026-10-10 起新增第8 道闸门 `drawdown-limit`（回撤熔断）。所有提示与结果卡片统一使用**截断后**数值。

**权威实现（单一事实来源）**：已平仓判定（`isClosedTrade`，部分平仓中间态不算已平仓）、胜率分母（保本计入）、强平价公式、本地日期（`toLocalDateStr`）、当日连亏（`_getTodayLossStreak`）、热量上限（`getHeatHardMax` 熔断 / `getHeatWarnMax` 警告，**两个语义已分离，不要再合并**）、品种止损上限（`getStopLimitPct`）、分批上下限（`MIN_SPLITS`/`MAX_SPLITS`）、**品种定义（`getDefinedSymbols`）**、**参数化风控阈值（`calculator.js` 的 `_numSetting` + `_getMarginUsageLimitPct`/`_getAggregateMarginLimitPct`/`_getLossStreakDeriskThreshold`/`_getLossStreakDeriskFactor`/`_getKellyRiskLimitPct`/`_getMinStopDistancePct`/`_getDefaultFeeRate`）**——全站只改`js/utils.js` / `js/risk.js` / `js/skills-integration.js` / `js/calculator.js` / `js/settings.js` 里的唯一实现，不要在 dashboard/stats/review 等处复制逻辑。

⚠️ **风控阈值不得写死**（2026-10-10 审计教训）：审计发现 80%/90% 保证金上限、连亏 3 笔/0.8 系数、凯利 5% 上限、手续费 0.04/0.08、最小止损距离 0.1% 全部是字面量，用户无法配置——其中最靠近资金的两道闸门反而比集中度 30% 更不可配。现已全部参数化并落入 `SETTINGS_DEFAULTS`。新增风控阈值时必须：① 加进 `SETTINGS_DEFAULTS` + `SETTINGS_VALIDATORS`；② 加进 `saveSettings` 的 `fields` 数组（复用区间/整数校验）与 `renderSettings`；③ 加进 `_SETTINGS_FIELD_IDS`（否则改了不提示"未保存修改"）；④ 在 `index.html` 加输入框。读取一律经 `_numSetting` 兜底——localStorage 被手改或导入的脏值（NaN/字符串/越界）不得穿过闸门，原硬编码写法天然免疫这类污染，改读设置后必须补上（`_numSetting` 已按 `SETTINGS_VALIDATORS` 做区间钳制，越界回退默认而非静默钳到边界）。

⚠️ **改阈值必须连「所有比较点」一起改**（2026-10-10 P0 回归的教训）：v5.6.19 把连亏降仓阈值参数化时只改了判定处 `lossStreak >= _getLossStreakDeriskThreshold()`，漏了取值处 `lossStreak >= 3 ? adjPos : positionSize` —— 结果 riskAmount 按新阈值打了折、positionSize 却按旧判定没折，落库两个字段互相矛盾，真实敞口比记录的风险额高 25%，**风控被静默绕过且日志存下打架的数字**。同类漏改还有 `calc-visuals.js` 的刻度常量、`planner.js` 的清单文案、`index.html` 的表单提示。改任何阈值时检索确认全部出现点：用 Grep 工具搜字段名，**不要用 `grep` 命令 + 管道，实践中多次返回空结果误报「无残留」**。

⚠️ **新增/修改权威函数后，必须 grep 全部旧调用点并确认零遗漏**（2026-10-11 审计教训）。这不是谨慎，是**已被四次实证的流程缺口**——每次「建好权威实现」都靠人工逐文件 review 收口，于是同一个错误反复重演：

| 权威函数 | 建好后发生了什么 |
|---|---|
| `isClosedTrade` | 3 处消费方各写 `? ... : !!closeType` 兜底，兜底语义与权威**相反**（部分平仓中间态被判已平仓）→ v5.6.24 收口为 `utils.isClosed` fail-closed 唯一入口 |
| `getHeatHardMax`（拆硬熔断） | 硬熔断解耦了，警告侧却被换成 5 处硬编码 `maxHeat * 0.8`，`getHeatWarnMax()` 成了**零消费方的死函数**——设置页「组合热量警告上限」可调 5~20% 却毫无作用 → v5.6.24 接上 |
| `checkSymbolConcentration`（修 `\|\| 30`） | 只修了这一个函数，`risk.js` 卡片与 `planner.js` 文案各留一份，`planner.js:1080` 甚至仍是 `settings.singleSymbolMaxPct \|\| 30` 原型 → v5.6.24 收口为 `getSymbolConcentrationMaxPct()` |
| `MIN_SPLITS/MAX_SPLITS`（提为模块级常量） | 同文件渲染层 `:1896/:1899/:1919` 仍是字面量 `2/3` → 仍是隐患 |

**检查清单**：① 新函数名 grep 全仓，确认**每个**出现点都是调用而非注释；② 确认没有第二处手写近似逻辑；③ 若函数读设置，确认兜底分支与权威**同向**（宁可判更严格）。统计调用数时**必须剔除注释行**——`getHeatWarnMax` 的注释里带 `()` 会被正则误判为调用。

⚠️ **`logs` 数组任何变更后，必须重置索引型状态**（2026-10-11 审计教训）。有一批模块级状态是用**数组下标**记住「当前操作哪一行」的：`openClosePanelIdx` / `actionPanelIdx` / _selectedIndices / `_expandedRows` / `_pendingDeleteIndices` / `_closePriceEdited`，外加 `_batchMode`。只要 `logs` 发生 splice 或被整体替换，这些下标全部失真。

- **统一入口**：`utils.resetAllIndexState()`（全清，适用于整体替换/批量删除/清空/撤销）与 `utils.remapIndexStateAfterSplice(idx)`（下标平移，适用于单条删除——删一条不该清掉用户对其余行的勾选）。**禁止再手写逐项清理**。
- **已接入的 7 条路径**：单条删除（toast.js）、批量删除 / 清空 / 批量撤销（logs.js）、覆盖导入 / 追加导入 / 备份恢复（settings.js）、多标签页同步（storage.js，仅这两处传 `externalReplace`）。
- ⚠️ **`_safeRenderAfterStorageChange` 是每次 `saveLogs()` 的收尾**，在那里无条件重置会把刚 remap 好的状态立刻清空（v5.6.24 实际发生过，`test/verify_logs_fixed.js` F1 组全红才暴露）。重置必须由调用方显式传 `{externalReplace:true}`。
- **危害不是「显示错位」而是「写错记录」**：用户展开 A 的平仓面板 → 删除上方一行 → 面板无声漂移到 B → 点「确认平仓」会平掉 B。

⚠️ **仓位/风险额必须满足守恒恒等式**：`riskAmount === positionSize × stopDistance / entryPrice`。每改一个截断层都要让这个等式继续成立。多层降仓（连亏系数、集中度、心态）**不要再引入 `adjPos` 之类的第二份仓位变量**——两个变量必然分叉，下游取哪个都会出 P0。回归用 `node test/verify_invariants.js`（648 组参数组合 × 2207 条守恒断言 + 脏值防护 + 熔断/降仓线解耦），改完计算逻辑必跑。

⚠️ **闸门必须 fail-closed**：取数异常（`getClosedSorted` / `loadSettings` / `_getTodayLossStreak` 抛错）时静默放行，等于在最需要拦截的时刻失效。禁止 `catch(e){}` 空实现后继续计算，应显式阻断并给出可读原因。已修：`single-risk-exceeds-limit`（原 catch 放行）、连亏熔断（新增 `loss-streak-unavailable`）、回撤熔断（新增 `drawdown-unavailable`，由 `getCurrentDrawdown().readFailed` 驱动）。

⚠️ **每条早退路径都要 `_calcCleanup()`**：它复位 `_calculating`，漏调会让「计算仓位」按钮永久失效（`app.js` 按钮守卫 + `markCalculationDirty` 双双短路，只能刷新页面）。v5.6.19 漏了两处（风险比例/金额非法分支），已修。

⚠️ **改完必须跑三套校验，且校验本身要有反向用例**（2026-10-10 血泪教训）：

```bash
node test/verify_invariants.js    # 648 组参数组合 × 2207 条守恒断言（计算结果自洽）
node test/verify_param_fix.js     # 31 项参数真实生效
node test/verify_sideeffects.js   # 47 项防「过度修复」
```

v5.6.19 引入两个 P0 时前两套都是全绿的 —— 它们只证明**计算自洽**，证明不了**新加的闸门不会误拦正常用户**、**新增的钳制不会误伤合法设置**。第三套专门补这个洞。

⚠️ **写断言必须包含「该失败时确实失败」的反向用例**（今天已栽三次）：
- 只写「不该发生什么」的断言，对「闸门被架空/被旁路」这类退化**完全免疫**——
  曾把单笔风险上限放大 5 倍注入，45 项断言仍全绿，因为用例恰好填 10% 风险、放宽后也不拦，断言天然避开了注入点。
- **注入点必须选正常路径必经之处**：改 `getHeatWarnMax` 的兜底默认值全绿，
  因为 `loadSettings` 会合并 `SETTINGS_DEFAULTS` 使该分支平时走不到。

验证脚本有效性的唯一办法是**注入一个确定的错误看它是否报警**，改完脚本务必做这一步。

**品种定义单一数据源**（`js/settings.js`，v5.6.17 收口）：系统设置 → 品种管理（`settings.customSymbols`）是品种候选的唯一来源。所有需要品种候选的入口——开仓计划录入 `#symbol`、日志筛选 `#fltSymbol`、编辑弹窗 `#emSymbol`——都必须调 `getDefinedSymbols()`，**不得各自从 `logs` 聚合或写死列表**（前者会让「设置里加了但还没交易过的品种」永远选不到，后者与设置脱节）。口径统一在 `getDefinedSymbols()` 里：代码 `trim().toUpperCase()`、按代码去重、丢弃空代码；`desc` 写进 `option[label]`，combobox 显示为右对齐次要文字并参与输入过滤。筛选器可以是「定义 ∪ 日志」并集（定义项在前），但定义项必须在列。默认选中值取 `getDefaultSymbol()`（定义首项），不要在 HTML 或各模块里写死 `'BTC'`。

**R 倍数 / 收益率的分母锚点**（`js/utils.js` 的 `resolveRMultiple` / `resolvePnlPercent`，v5.6.35 收口）：分母**只认 `initialRiskAmount` / `initialMargin`**，锚点非正数或脏值（`null`/`"abc"`）时回退 `calculateCloseSettlement` 自带的 `rMultiple` / `pnlPercent`。任何写 `rMultiple` / `pnlPercent` 的地方——落库或预览——都必须调这两个函数，**不得就地写「锚点 > 0 ? 自己算 : 回退」的三元**。这段三元此前有 7 份副本且写法不一（有的判 `!= null`、有的判 `!isNaN`），脏锚点下会分叉；只要有人新写一份，`verify_logs_fixed.js` 的 R8 组（源码级计数 + 无内联三元）就会红。

> 注意别过度合并：`logs.js:confirmClose` 是**增量累加**（新平仓事件 `realizedPnl += netPnl`），`modals.js:saveEditLog` 是**替换重建**（编辑已有腿 `Σ(分批腿) + 新收尾腿`）。二者是不同运算，不要试图合并簿记主流程——那会引入 P0。收敛的只是两端共用的分母锚点这一层。两者已共用的还有 `calculateCloseSettlement` 与 `utils.closedRatioDelta`。

**部分平仓生命周期**（`js/logs.js`）：开仓 → 部分平仓（closes 追加 + realizedPnl/closedRatio）→ 最终平仓。R 倍数以 `initialRiskAmount` 为基准（选择规则见上），CSV 导入导出必须完整保留这些字段。

**数据存储**（`js/storage.js`）：
- `trade_logs_plus_v4`：日志数组（SCHEMA_VERSION=4）
- `trade_settings_v1`：设置对象
- `trade_backup_auto_index`：自动备份轮转（默认保留 10 份）

**检查清单闸门**（`js/planner.js`）：**5 项**开仓前检查（`checkRiskPct`/`checkRR`/`checkMargin`/`checkReason`/`checkMindset`），`updateChecklistSummary` 汇总结论行，`focusChecklistFailures` 在保存被 `assertSavableCalculation`（`js/calculator.js`）拒绝时定位失败项。清单结果缺失/空对象时 **fail-closed 直接拒绝保存**。清单只收「计算能独立完成判定」的项——上游硬阻断覆盖的条件触发时不产生计算结果，清单行会每笔恒绿，属纯噪音（v5.6.9 已删 7 项，UI 文案与 `planner.js:634/881` 均按实际条目数动态生成）。清单规则说明文字内嵌阈值，一律经 `_numSetting` / `getHeatHardMax` / `getStopLimitPct` 读取，**不得写死数字**（否则用户改设置后文案与实际风控不一致）。

## 版本号必须四处同步

改动版本号时以下四处必须一起 bump，漏一处就是线上事故（历史教训：`git log` 中 "脚本版本号从未 bump 致浏览器缓存旧 JS"）：

| # | 位置 | 形式 |
|---|------|------|
| 1 | `js/version.js` | `var APP_VERSION = '<本次发布版本>';`（唯一权威） |
| 2 | `index.html` | 49 处 `?v=`（43 个 JS/CSS + 6 个图标/manifest 引用） |
| 3 | `test/run-tests.html` | 17 处 `../js/*.js?v=`（漏改 → 测试跑的是旧代码，绿得毫无意义） |
| 4 | `js/version.js` 顶部 changelog | 追加本次变更说明 |

侧栏底部版本号（`#navVersion`）**不需要手工改**：v5.6.15 起由 `version.js` 末尾注入，HTML 里留空即可（此前硬编码 `v5.6.2`，在 5.6.14 上显示错误版本，是同步清单里唯一"改了没人发现"的一处）。

`package.json` 的 `version` 字段当前是 5.0.0，**与 APP_VERSION 脱节且无程序读取**；要么同步，要么在清理时直接删掉该字段的误导性。

## 测试

- `npm test` → `test/run-all.js`：聚合 33 项（23 个正常跑测器 + 10 组注入自检），任一失败 `exit 1`。这是唯一该挂在 CI / 预提交钩子上的门禁。
- `test/run-tests.html`（活跃回归套件，打开即跑，**675 条** `T()` 断言，32 组）：主回归。`npm run test:main` 可无头跑它（`test/_rt_headless.js`）。
- `test/verify_*.js` / `test/_edit_scenarios.js`：专项跑测器，按场景拆分，各自 Node CLI 可直接跑。
- `test/verify-fixes.html`：**已过时的一次性验证页**（2026-09-23）。它引用的 js 不带 `?v=`（缓存风险），且第 6–9 节是**内联复现的算法**、不是对真实代码的回归（其自身注释已声明"改动 modals.js 后这些节不会自动失效"）。不要把它当作回归依据。
- Jest：配置已删除（v5.6.34）。`tests/` 目录早在 `4ba7130`（2026-08-14）就已移除，不要再按 jest 的方式加测试。

**新增断言放哪**：`run-tests.html` 是主套件，优先加这里。但它的 DOM 是精简的——`resetForm()` / `openEditModal()` 这类依赖完整表单的函数在它里面会抛错，且抛错会让整个 `runAll` 停摆（summary 停在 `—`，全部断言都不产出，比单条失败更隐蔽）。这类断言放 `test/verify_*.js`（那几个跑测器加载真实 `index.html`）。判据：**断言纯函数 → run-tests.html；断言需要真实 DOM 的端到端流程 → verify_*.js**。

**已知覆盖缺口**：`run-tests.html` 只加载 17 个 js，**以下 11 个模块零断言覆盖**——
`analytics.js`、`app.js`、`chart-factory.js`、`dashboard.js`、`dom-cache.js`、`navigation.js`、`rendering.js`、`review.js`、`select-ui.js`、`stats.js`、`toast.js`。
即：仪表盘、统计分析、复盘中心、日志渲染、导航、Toast、图表工厂、DOM 缓存全部没有回归保护。改这些模块时只能靠手工 E2E。

## 工程卫生：已知死代码与冗余资产（2026-10-09 审计）

以下均为**已确认**、可安全处理项。清理前先确认列表状态是否已被后续提交改动。

### 死代码 / 静默失效（2026-10-19 已清理，留作审计记录）

| 位置 | 问题 | 状态 |
|------|------|------|
| `js/calculator.js` `updateSplitButtons()` + 3 处调用 | 查 `#splitContainer`（真实容器 `#splitAreaInner`）→ 恒 `null`，函数每次立即 return | ✅ 已删（含 navigation.js:186 调用点） |
| `js/app.js:379` `window.debugAnalysisData` | P0 期一次性诊断工具，零调用点 | ✅ 已删 |
| `js/calculator.js` `detailDisplay` / `riskTag` | `getElementById` 恒 `null`，`&&` 短路后永不执行 | ✅ 已删 |
| `js/calculator.js` `stopLossSlider` | HTML 中无此元素，监听永不绑定 | ✅ 已删 |
| `js/storage.js` `STORAGE_CONFIG.compressionEnabled` | 定义后从未被读取 | ✅ 已删 |
| `js/utils.js:814` | 生产 `console.log` | 未动（降级项） |
| 41 个未使用 CSS 类 | 确认无引用：`risk-grid` `result-row` `result-sub` `warning-bar` `clickable` `empty-hint` `mt-1` `mt-2` `nav-icon` `section-title(-text)` `section-icon` `stats-divider` `stats-filter-bar` `split-breakdown` `calculator-result` `btn-ripple` `btn-modify-action` `setting-input-wrap` `form-section-content-inner` 等 | 删除（⚠️ `vv-badge-*` / `vv-g-fill-*` / `exec-0~3` / `stat-group-bg-*` 是**动态拼接**产生的假阳性，勿删） |

### 冗余文件

| 文件 | 问题 | 建议 |
|------|------|------|
| `img/logo.png` | **v5.6.15 起已零引用** | ✅ 已删（2026-10-19） |
| `风控交易逻辑审计报告-v5.6.9.html`、`-v5.6.10.html`、`风控统计复盘系统审计报告.html` | 历史审计产物，无代码引用 | 待归档/删除 |
| `trading_backup_2026-09-07_15-40-56.json` | 用户数据导出残留，已被 `.gitignore` 排除 | 待删除 |
| `package.json` version 字段 | 与 APP_VERSION 脱节且无程序读取 | ✅ 已删（2026-10-19） |
| `node_modules/` + `package-lock.json` | 已收敛（v5.6.34）：`package.json` 只剩 `eslint` + `jsdom`（全部无头跑测器都 require 它） | 若不再跑无头回归可连 `jsdom` 清掉 |

### 投机性注释（premature comments）

注释应当解释**当前代码为什么这样写**，而不是**未来如果怎样**。已确认的投机性注释：

- `js/chart-guard.js:15` —"供将来若有代码想区分「真图表」与「占位」使用"（`__stub` 标记无人读取）
- `js/chart-guard.js:19` —"补了会掩盖未来引入真实 Chart.js 特性时的依赖缺口"
- `js/calculator.js:69` —"避免将来 readPlanInput 一旦读取它…"
- `js/calculator.js:1208` —"传参集中在此便于日后调整"
- `js/planner.js:545` —"将来若有人改成非幂等操作就会放大成真实错误"
- `js/storage.js:10` —"暂不启用压缩，避免复杂性"
- `test/verify-fixes.html:14-25` —12 行"本页不是回归测试"的免责说明（代码不会自证，只能靠人读）

另：`js/version.js` 的 changelog 已于 2026-10-19 迁至 `CHANGELOG.md`（960 行→10 行），测试第 30.8 组仍通过（只读 `APP_VERSION` 字面量，不读注释）。此后每版变更说明直接追加到 `CHANGELOG.md`，不再写进生产 JS。

## 约定

- ESLint（`.eslintrc.json`）：`eqeqeq` / 分号 / 单引号为 error；`no-var` / `prefer-const` 为 warn——**存量代码大量使用 var，新增代码跟随周边风格，不必强行 const**（历史上按 var 为主）。
- 中文注释为主，关键修复带「P0/P1 修复」审计标记（注释里保留了历次审计的决策原因，改代码前先读注释）。
- **注释只写"为什么"**：不写未来假设、不写"暂不启用"、不为未实现的字段留占位注释。需要记录的未来计划写进 issue/CHANGELOG，不写进代码。
- **不留注释掉的代码块**：版本控制在 Git 里，删除即可。
- **不提交调试残留**：`console.log` 诊断函数、一次性验证页应随修复一并删除（`debugAnalysisData` 就是前车之鉴）。
- 版本号在 `js/version.js`，index.html / run-tests.html 的 `?v=` 同步升级（见「版本号必须四处同步」）。

## 核心算法升级（v5.6.41）与口径边界

**新增有效门禁**：`test/verify_core_algo.js`（v5.6.41）与 `test/verify_crossmodule.js`（v5.6.43）已接入 `run-all.js`（现 29 项 / 3674 条断言）。它们专攻「常规断言全绿也保护不到」的异常路径、数值稳健性与跨模块接线，都带 `--inject` 自检模式：

```bash
node test/verify_core_algo.js           # 全绿才算修复完成
node test/verify_core_algo.js --inject  # 注入旧实现，必须出现 FAIL，证明断言不是恒真的
```

新增守卫后务必做第二步——只写「不该发生什么」的断言对「闸门被架空」天然免疫。

**本次收口的不变量**（改代码前先读）：
- `calculate()` 的 `finally` 是 `_calcCleanup()` 的唯一兜底；新增早退分支不必再手写清理。
- 连亏熔断的 IIFE **只负责判定并写 `_streakBlock`**，早退必须由主流程执行。再出现「IIFE 内 `return renderHardBlock()` 以为能退出主函数」即为 P0。
- `getLegacySlippageCost` / `calculateCloseSettlement` / `calcKelly` / `calcATRStop` 一律用 `Number.isFinite`，禁止退回 `parseFloat(...) || 0` 或全局 `isNaN`（`isNaN(Infinity) === false`）。
- `calcPortfolioHeat` / `checkDailyLossLimit` / `checkSymbolConcentration` 统一透出 `readFailed` / `capitalKnown`；calculator 的四处消费点必须判 `readFailed`，禁止只判 `blocked`。
- 单次计算上下文 `_calcInProgress` / `_calcSettingsSnapshot` 只在 `calculate()` 内置真、finally 复位；非计算路径（检查清单文案渲染）必须继续直读 `loadSettings()`，否则会拿到上次计算的过期设置。

**v5.6.42 已修的三项数学口径（新边界，改动前先读）**：

| 口径 | 当前权威实现 | 不可回退的边界 |
|---|---|---|
| 强平价公式 | `utils.js` `LP_long=E(1−IMR)/(1−MMR)`、`LP_short=E(1+IMR)/(1+MMR)`，满足 `IM−亏损=MM` | ① 杠杆硬阻断**仍锁 `floor(1/(2×MMR))=100x`**，是留一倍缓冲的保守风控边界，不是公式零缓冲点 `1/MMR=200x`，禁止「顺手」改成 `1/mmr`；② `MMR∈[0,1)`；③ `IMR=1`（1x）时 `LP=0` 是合法解，终检只能用 `<0`，用 `<=0` 会误拦 216 组参数 |
| 分批加权入场价 | `calculator.js` `computeWeightedEntry()` = `Σalloc/Σ(alloc/price)`（资金权重**调和平均**）；`computeWeightedStopDistance()` = `E×Σ(w·dist/bp)` | ① 三处同口径：`computeWeightedEntry` / `doSaveSplit` / `risk.js` 聚合均价，禁止再内联算术平均；② 新记录带 `weightedEntryModel='harmonic'`，**旧记录读端只读落库值、绝不按 entries 重算**（`modals.js:259`）；③ 20/21/30.11 组断言按新口径写死 |
| 夏普比率 | `utils.js` `dailySharpe(closed, {startEquity, annualDays, riskFreeRate})`，日收益率 + 样本标准差 `÷(n−1)` + 365 年化 | ① `startEquity` **必需**，缺失返回 `null`，禁止退回「日盈亏金额」旧口径；② 日期必须字典序排序后才做权益递推；③ `stats.js` 从 `getAccountCapital()` 取期初权益，取不到时显示「—」并说明原因 |

另：三结果凯利精确解、风险加权 R 仍属「改变仓位建议 / 历史指标定义」的产品决策，需单独立项 + 迁移方案。凯利小样本收缩与 CAGR 年化已于 v5.6.43 落地，见下节。

## 跨模块口径边界（v5.6.43）

**新增门禁**：`test/verify_crossmodule.js`（56 断言，带 `--inject`），专测跨模块接线与 UI↔落库口径；`npm test` 现为 **33 项（23 正常 + 10 注入自检）**。

**改代码前必读的新不变量**：
- **设置读侧**：`loadSettings()` 是唯一净化入口（`_sanitizeLoadedSettings`），所有阈值消费点都不许再自行 `Number(x)||default`。数字字符串会先归一（保住 `loadMmr('0.8')`）；越界/非有限/非整数一律回退 `SETTINGS_DEFAULTS`。**测试不得再用越界设置值构造场景**——`(v5.6.43)` 已把 `riskHeatMax:50`、`maxDrawdownAlert:90` 这类值迁到合法区间，否则场景会被净化吞掉。
- **`portfolioHeatMax` 是警告线唯一来源**（默认 5，必须 < 默认硬上限 6，否则 warn 档不可达）；`heatWarnMax` 别名已从默认值移除，禁止再加回来。
- **半凯利恒 = 完整凯利 / 2**：先钳完整凯利到 `kellyRiskLimitPct` 再取一半，不允许两条各自 `Math.min`（会让 raw>2×limit 时两者相等、风险预算翻倍）。
- **CSV 数据文件存机器键**：`closeType` 导出写 `partialTP` 这类英文键，不写 `CLOSE_TYPE_LABELS` 中文标签；导入靠 `_normalizeCsvCloseType` 兼容历史中文值，未知值**保留原值**并告警，绝不抹空（抹空会把「已平仓但缺字段」的坏记录伪装成未平仓，绕过 fail-closed 校验）。
- **时间转换走 `io._safeISOString`**：非法时间置空 + 计数告警，禁止 `new Date(x).toISOString()` 裸调用（一条脏日志会毁掉整批导出）。
- **连亏排序按时间戳**（`stats._closedTimeMs`），禁止对 `closeTime` 字符串 `localeCompare`（时区偏移会颠倒同日先后，让末尾盈利被算成连亏）。
- **分批占比只有一份**：`computeNormalizedSplitAlloc()` 供结果表 / 触发行 / `getSplitEntries` 共用，禁止再按原始 `ba/100` 渲染。批次数一律读 `MIN_SPLITS`/`MAX_SPLITS`。
- **部分平仓缩减只有一份**：`logs.applyPartialShrink()` 同时缩仓位/风险额/保证金/fee/**slippageCost**；少缩滑点会让每腿重复扣一次性成本。`closedRatio` 封顶 100。
- **组合热量只有一处硬阻断**：截断后 `:1144` 复核点（用 `effectiveRiskAmount`）；预检侧 `_heatPrecheckSoft` 仅软标记。`readFailed` 两侧都 fail-closed。
- **年化收益 = CAGR**（`Math.pow(期末/期初, 365/span)-1`，百分比显示），不是金额线性外推；本金缺失 fail-closed。**夏普筛选态**按筛选样本 `capital` 均值取期初权益，缺字段显示「—」。
- **RR 两腿入场成交价必须唯一**：目标腿复用 `stopEntryTicks`，退出 ticks 才按各腿执行类型区分。色阶读 `settings.minRRRatio`，不写死 3/2。
- **刻意未改（复核结论）**：利润因子的 `grossProfit/grossLoss` 来自 `pnlAmount`（已扣费扣滑点），本就是净额口径，仅变量名误导；同品种双向持仓的集中度按保证金累加是保守正确，改「方向净额」会掩盖对冲风险、放宽闸门。二者不要为了改而改。

**数值守卫与存量脏数据（v5.6.42 已收口，禁止回退）**：
- 全站统一 `toFiniteNum(v, fallback)`（`js/utils.js` 顶层全局函数，语义等价 `parseFloat(x)||0` 但额外挡 `±Infinity`/`NaN`）。`js/` 下已无 `parseFloat(X)||0`；新代码禁止再写这种形式，也不要用全局 `isNaN`/`isFinite` 判数值。
- `utils.sanitizeLogNumbers(rows)` 在 `loadLogs()` 的 `JSON.parse` 之后无条件调用，并覆盖 `migrateLogsToCurrentSchema`（导入）与两处多标签 `logs=remoteLogs`。只把「本该是数字却非有限」的字段改 0，**故意不动 `null`**（改成 0 会凭空造一笔 0 盈亏已平仓交易，污染胜率分母）。只改内存，不改写磁盘原始证据。
- 写入侧仍有 `calculateCloseSettlement` 出参终检与 `getLegacySlippageCost` 守卫（v5.6.41），两侧共同构成闭环。
- `risk.js:633` 虽只判 `blocked`，但其 `:627` 已有 `!capital` 空态提前返回，不是同类缺口。
