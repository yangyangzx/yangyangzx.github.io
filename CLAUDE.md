# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

TradingDiscipline：纯前端交易风控/复盘终端（**v5.6.17**），无任何构建工具。原生 JS（IIFE + 全局函数）+ CSS（OKLCH 变量），数据全部存 localStorage，完全离线。`index.html` 直接可运行，但推荐用本地 HTTP 服务器打开（file:// 下 PWA manifest / 部分浏览器行为受限）：

```bash
python3 -m http.server 8000   # 然后开 http://localhost:8000
```

规模（2026-10-09 实测）：`index.html` 单页 + **28 个 js** + **15 个 css** + 2 个 CDN（Chart.js 4.4.0、Font Awesome）。核心文件 `js/calculator.js` 2205 行、`js/modals.js` 1480 行、`js/analytics.js` 1579 行。

## 常用命令

```bash
node --check js/<file>.js          # 改完 JS 先语法检查
npx eslint js/**/*.js              # Lint（注意：.eslintrc.json 未启用 no-undef，见下）
# 浏览器内回归：打开 test/run-tests.html 自动跑全部断言（打开即跑，611 条 T() 断言）
# 改完前端后强刷：URL 追加 ?cb=<时间戳> 避开缓存（index.html 里 script 已带 ?v=5.6.17，改 CSS 时同样需要）
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

**开仓计算管线**（`js/calculator.js`，2205 行，核心）：滑点 → 止损距离 → 风险金额（凯利可驱动）→ 名义仓位 → 保证金 → 逐层硬上限截断 → 强平校验 → 组合热量熔断。所有提示与结果卡片统一使用**截断后**数值。

**权威实现（单一事实来源）**：已平仓判定（`isClosedTrade`，部分平仓中间态不算已平仓）、胜率分母（保本计入）、强平价公式、本地日期（`toLocalDateStr`）、当日连亏（`_getTodayLossStreak`）、热量上限（`getHeatHardMax`）、品种止损上限（`getStopLimitPct`）、分批上下限（`MIN_SPLITS`/`MAX_SPLITS`）、**品种定义（`getDefinedSymbols`）**——全站只改 `js/utils.js` / `js/risk.js` / `js/skills-integration.js` / `js/calculator.js` / `js/settings.js` 里的唯一实现，不要在 dashboard/stats/review 等处复制逻辑。

**品种定义单一数据源**（`js/settings.js`，v5.6.17 收口）：系统设置 → 品种管理（`settings.customSymbols`）是品种候选的唯一来源。所有需要品种候选的入口——开仓计划录入 `#symbol`、日志筛选 `#fltSymbol`、编辑弹窗 `#emSymbol`——都必须调 `getDefinedSymbols()`，**不得各自从 `logs` 聚合或写死列表**（前者会让「设置里加了但还没交易过的品种」永远选不到，后者与设置脱节）。口径统一在 `getDefinedSymbols()` 里：代码 `trim().toUpperCase()`、按代码去重、丢弃空代码；`desc` 写进 `option[label]`，combobox 显示为右对齐次要文字并参与输入过滤。筛选器可以是「定义 ∪ 日志」并集（定义项在前），但定义项必须在列。默认选中值取 `getDefaultSymbol()`（定义首项），不要在 HTML 或各模块里写死 `'BTC'`。

**部分平仓生命周期**（`js/logs.js`）：开仓 → 部分平仓（closes 追加 + realizedPnl/closedRatio）→ 最终平仓。R 倍数以 `initialRiskAmount` 为基准，CSV 导入导出必须完整保留这些字段。

**数据存储**（`js/storage.js`）：
- `trade_logs_plus_v4`：日志数组（SCHEMA_VERSION=4）
- `trade_settings_v1`：设置对象
- `trade_backup_auto_index`：自动备份轮转（默认保留 10 份）

**检查清单闸门**（`js/planner.js`）：12 项开仓前检查，`updateChecklistSummary` 汇总结论行，`focusChecklistFailures` 在保存被 `assertSavableCalculation`（`js/calculator.js`）拒绝时定位失败项。清单结果缺失/空对象时 **fail-closed 直接拒绝保存**。

## 版本号必须四处同步

改动版本号时以下四处必须一起 bump，漏一处就是线上事故（历史教训：`git log` 中 "脚本版本号从未 bump 致浏览器缓存旧 JS"）：

| # | 位置 | 形式 |
|---|------|------|
| 1 | `js/version.js` | `var APP_VERSION = '5.6.17';` |
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
