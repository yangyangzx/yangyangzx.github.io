# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

TradingDiscipline：纯前端交易风控/复盘终端（**v5.6.23**），无任何构建工具。原生 JS（IIFE + 全局函数）+ CSS（OKLCH 变量），数据全部存 localStorage，完全离线。`index.html` 直接可运行，但推荐用本地 HTTP 服务器打开（file:// 下 PWA manifest / 部分浏览器行为受限）：

```bash
python3 -m http.server 8000   # 然后开 http://localhost:8000
```

规模（2026-10-09 实测）：`index.html` 单页 + **28 个 js** + **15 个 css** + 2 个 CDN（Chart.js 4.4.0、Font Awesome）。核心文件 `js/calculator.js` 2205 行、`js/modals.js` 1480 行、`js/analytics.js` 1579 行。

## 常用命令

```bash
node --check js/<file>.js          # 改完 JS 先语法检查
npx eslint js/**/*.js              # Lint（注意：.eslintrc.json 未启用 no-undef，见下）
# 浏览器内回归：打开 test/run-tests.html 自动跑全部断言（打开即跑，611 条 T() 断言）
# 改完前端后强刷：URL 追加 ?cb=<时间戳> 避开缓存（index.html 里 script 已带 ?v=5.6.23，改 CSS 时同样需要）
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

⚠️ **不要跑 `npm test` / `npx jest`**：package.json 里的 jest 配置是空转的——`testMatch` 指向 `**/tests/**/*.test.js`、`setupFiles` 指向 `./tests/setup.js`，而 `tests/` 目录**从未创建**（活跃测试是 `test/run-tests.html`）。跑必然失败。新增断言优先加进 `run-tests.html`。

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

⚠️ **仓位/风险额必须满足守恒恒等式**：`riskAmount === positionSize × stopDistance / entryPrice`。每改一个截断层都要让这个等式继续成立。多层降仓（连亏系数、集中度、心态）**不要再引入 `adjPos` 之类的第二份仓位变量**——两个变量必然分叉，下游取哪个都会出 P0。回归用 `node verify_invariants.js`（648 组参数组合 × 2207 条守恒断言 + 脏值防护 + 熔断/降仓线解耦），改完计算逻辑必跑。

⚠️ **闸门必须 fail-closed**：取数异常（`getClosedSorted` / `loadSettings` / `_getTodayLossStreak` 抛错）时静默放行，等于在最需要拦截的时刻失效。禁止 `catch(e){}` 空实现后继续计算，应显式阻断并给出可读原因。已修：`single-risk-exceeds-limit`（原 catch 放行）、连亏熔断（新增 `loss-streak-unavailable`）、回撤熔断（新增 `drawdown-unavailable`，由 `getCurrentDrawdown().readFailed` 驱动）。

⚠️ **每条早退路径都要 `_calcCleanup()`**：它复位 `_calculating`，漏调会让「计算仓位」按钮永久失效（`app.js` 按钮守卫 + `markCalculationDirty` 双双短路，只能刷新页面）。v5.6.19 漏了两处（风险比例/金额非法分支），已修。

⚠️ **改完必须跑三套校验，且校验本身要有反向用例**（2026-10-10 血泪教训）：

```bash
node verify_invariants.js    # 648 组参数组合 × 2207 条守恒断言（计算结果自洽）
node verify_param_fix.js     # 31 项参数真实生效
node verify_sideeffects.js   # 47 项防「过度修复」
```

v5.6.19 引入两个 P0 时前两套都是全绿的 —— 它们只证明**计算自洽**，证明不了**新加的闸门不会误拦正常用户**、**新增的钳制不会误伤合法设置**。第三套专门补这个洞。

⚠️ **写断言必须包含「该失败时确实失败」的反向用例**（今天已栽三次）：
- 只写「不该发生什么」的断言，对「闸门被架空/被旁路」这类退化**完全免疫**——
  曾把单笔风险上限放大 5 倍注入，45 项断言仍全绿，因为用例恰好填 10% 风险、放宽后也不拦，断言天然避开了注入点。
- **注入点必须选正常路径必经之处**：改 `getHeatWarnMax` 的兜底默认值全绿，
  因为 `loadSettings` 会合并 `SETTINGS_DEFAULTS` 使该分支平时走不到。

验证脚本有效性的唯一办法是**注入一个确定的错误看它是否报警**，改完脚本务必做这一步。

**品种定义单一数据源**（`js/settings.js`，v5.6.17 收口）：系统设置 → 品种管理（`settings.customSymbols`）是品种候选的唯一来源。所有需要品种候选的入口——开仓计划录入 `#symbol`、日志筛选 `#fltSymbol`、编辑弹窗 `#emSymbol`——都必须调 `getDefinedSymbols()`，**不得各自从 `logs` 聚合或写死列表**（前者会让「设置里加了但还没交易过的品种」永远选不到，后者与设置脱节）。口径统一在 `getDefinedSymbols()` 里：代码 `trim().toUpperCase()`、按代码去重、丢弃空代码；`desc` 写进 `option[label]`，combobox 显示为右对齐次要文字并参与输入过滤。筛选器可以是「定义 ∪ 日志」并集（定义项在前），但定义项必须在列。默认选中值取 `getDefaultSymbol()`（定义首项），不要在 HTML 或各模块里写死 `'BTC'`。

**部分平仓生命周期**（`js/logs.js`）：开仓 → 部分平仓（closes 追加 + realizedPnl/closedRatio）→ 最终平仓。R 倍数以 `initialRiskAmount` 为基准，CSV 导入导出必须完整保留这些字段。

**数据存储**（`js/storage.js`）：
- `trade_logs_plus_v4`：日志数组（SCHEMA_VERSION=4）
- `trade_settings_v1`：设置对象
- `trade_backup_auto_index`：自动备份轮转（默认保留 10 份）

**检查清单闸门**（`js/planner.js`）：**5 项**开仓前检查（`checkRiskPct`/`checkRR`/`checkMargin`/`checkReason`/`checkMindset`），`updateChecklistSummary` 汇总结论行，`focusChecklistFailures` 在保存被 `assertSavableCalculation`（`js/calculator.js`）拒绝时定位失败项。清单结果缺失/空对象时 **fail-closed 直接拒绝保存**。清单只收「计算能独立完成判定」的项——上游硬阻断覆盖的条件触发时不产生计算结果，清单行会每笔恒绿，属纯噪音（v5.6.9 已删 7 项，UI 文案与 `planner.js:634/881` 均按实际条目数动态生成）。清单规则说明文字内嵌阈值，一律经 `_numSetting` / `getHeatHardMax` / `getStopLimitPct` 读取，**不得写死数字**（否则用户改设置后文案与实际风控不一致）。

## 版本号必须四处同步

改动版本号时以下四处必须一起 bump，漏一处就是线上事故（历史教训：`git log` 中 "脚本版本号从未 bump 致浏览器缓存旧 JS"）：

| # | 位置 | 形式 |
|---|------|------|
| 1 | `js/version.js` | `var APP_VERSION = '5.6.23';` |
| 2 | `index.html` | 28 处 `?v=` + 15 处 CSS `?v=` |
| 3 | `test/run-tests.html` | 17 处 `../js/*.js?v=`（漏改 → 测试跑的是旧代码，绿得毫无意义） |
| 4 | `js/version.js` 顶部 changelog | 追加本次变更说明 |

侧栏底部版本号（`#navVersion`）**不需要手工改**：v5.6.15 起由 `version.js` 末尾注入，HTML 里留空即可（此前硬编码 `v5.6.2`，在 5.6.14 上显示错误版本，是同步清单里唯一"改了没人发现"的一处）。

`package.json` 的 `version` 字段当前是 5.0.0，**与 APP_VERSION 脱节且无程序读取**；要么同步，要么在清理时直接删掉该字段的误导性。

## 测试

- `test/run-tests.html`（2500 行，611 条 `T()` 断言，打开即跑）：活跃回归套件，覆盖 isClosedTrade / 凯利链 / 集中度 / 一致性门 / 分批 / 移动端适配 / 纪律 LED 等 32 组。
- `test/verify-fixes.html`：**已过时的一次性验证页**（2026-09-23）。它引用的 js 不带 `?v=`（缓存风险），且第 6–9 节是**内联复现的算法**、不是对真实代码的回归（其自身注释已声明"改动 modals.js 后这些节不会自动失效"）。不要把它当作回归依据。
- Jest：见上方「常用命令」，配置悬空，不可用。

**已知覆盖缺口**：`run-tests.html` 只加载 17 个 js，**以下 11 个模块零断言覆盖**——
`analytics.js`、`app.js`、`chart-factory.js`、`dashboard.js`、`dom-cache.js`、`navigation.js`、`rendering.js`、`review.js`、`select-ui.js`、`stats.js`、`toast.js`。
即：仪表盘、统计分析、复盘中心、日志渲染、导航、Toast、图表工厂、DOM 缓存全部没有回归保护。改这些模块时只能靠手工 E2E。

## 工程卫生：已知死代码与冗余资产（2026-10-09 审计）

以下均为**已确认**、可安全处理项。清理前先确认列表状态是否已被后续提交改动。

### 死代码 / 静默失效（确认无副作用，因有 `if` 保护而未报错）

| 位置 | 问题 | 建议 |
|------|------|------|
| `js/calculator.js:1767` `updateSplitButtons()` | 查 `#splitContainer`（真实容器是 `#splitAreaInner`）、查 `.split-remove-btn`（真实 class 是 `.btn-remove`）→ `container` 恒为 `null`，**函数每次调用都立即 return**。4 处调用（navigation.js:186、calculator.js:1579/1743/1757）全部空转 | 整体删除（add/removeSplitBatch 已内置 MIN/MAX 拦截，删掉行为不变） |
| `js/app.js:379` `window.debugAnalysisData` | P0 期一次性数据诊断工具，全仓零调用点，仅 `console.log` | 删除 |
| `js/calculator.js:1898/1900` `detailDisplay` / `riskTag` | `getElementById` 恒 `null`，`&&` 短路后分支永不执行 | 删除两行 |
| `js/calculator.js:1979` `stopLossSlider` | HTML 中无此元素，`if (sld)` 后监听永不绑定 | 删除 |
| `js/storage.js:10` `STORAGE_CONFIG.compressionEnabled` | 定义后**从未被任何代码读取**（"暂不启用"） | 删除该字段 |
| `js/utils.js:814` | `console.log('清理长时间未使用的Chart实例')` 生产日志 | 降级或删除 |
| 41 个未使用 CSS 类 | 确认无引用：`risk-grid` `result-row` `result-sub` `warning-bar` `clickable` `empty-hint` `mt-1` `mt-2` `nav-icon` `section-title(-text)` `section-icon` `stats-divider` `stats-filter-bar` `split-breakdown` `calculator-result` `btn-ripple` `btn-modify-action` `setting-input-wrap` `form-section-content-inner` 等 | 删除（⚠️ `vv-badge-*` / `vv-g-fill-*` / `exec-0~3` / `stat-group-bg-*` 是**动态拼接**产生的假阳性，勿删） |

### 冗余文件

| 文件 | 问题 | 建议 |
|------|------|------|
| `img/logo.png` | **v5.6.15 起已零引用**：导航 logo 改用 `assets/icon-192.png`（40px 清晰，原图 803 KB 缩到 48px 糊成噪点），favicon 仍是 `assets/logo.png`。文件保留但可直接删除 |
| `风控交易逻辑审计报告-v5.6.9.html`、`-v5.6.10.html`、`风控统计复盘系统审计报告.html` | 历史审计产物，无任何代码引用 | 移入 `docs/audit/` 归档，或直接删除 |
| `trading_backup_2026-09-07_15-40-56.json` | 用户数据导出残留，已被 `.gitignore` 排除 | 删除或移出仓库 |
| `node_modules/` + `package-lock.json`（308 包） | 只为 jest/eslint，而两者实际都跑不起来（见上） | 若要保留 lint 就留 eslint；否则整包清理 |

### 投机性注释（premature comments）

注释应当解释**当前代码为什么这样写**，而不是**未来如果怎样**。已确认的投机性注释：

- `js/chart-guard.js:15` —"供将来若有代码想区分「真图表」与「占位」使用"（`__stub` 标记无人读取）
- `js/chart-guard.js:19` —"补了会掩盖未来引入真实 Chart.js 特性时的依赖缺口"
- `js/calculator.js:69` —"避免将来 readPlanInput 一旦读取它…"
- `js/calculator.js:1208` —"传参集中在此便于日后调整"
- `js/planner.js:545` —"将来若有人改成非幂等操作就会放大成真实错误"
- `js/storage.js:10` —"暂不启用压缩，避免复杂性"
- `test/verify-fixes.html:14-25` —12 行"本页不是回归测试"的免责说明（代码不会自证，只能靠人读）

另：`js/version.js` 348 行中 **346 行是注释（99.4%）**，只有 1 行有效代码。完整 changelog 常驻生产脚本，每次刷新都要下载 35 KB 只为拿到 `var APP_VERSION`。**建议把 changelog 迁到 `CHANGELOG.md`，version.js 只保留版本号 + 一行说明**（迁移时记得保留该文件，测试第 30.8 组依赖它）。

## 约定

- ESLint（`.eslintrc.json`）：`eqeqeq` / 分号 / 单引号为 error；`no-var` / `prefer-const` 为 warn——**存量代码大量使用 var，新增代码跟随周边风格，不必强行 const**（历史上按 var 为主）。
- 中文注释为主，关键修复带「P0/P1 修复」审计标记（注释里保留了历次审计的决策原因，改代码前先读注释）。
- **注释只写"为什么"**：不写未来假设、不写"暂不启用"、不为未实现的字段留占位注释。需要记录的未来计划写进 issue/CHANGELOG，不写进代码。
- **不留注释掉的代码块**：版本控制在 Git 里，删除即可。
- **不提交调试残留**：`console.log` 诊断函数、一次性验证页应随修复一并删除（`debugAnalysisData` 就是前车之鉴）。
- 版本号在 `js/version.js`，index.html / run-tests.html 的 `?v=` 同步升级（见「版本号必须四处同步」）。
