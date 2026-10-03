# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

TradingDiscipline：纯前端交易风控/复盘终端（v5.6），无任何构建工具。原生 JS（IIFE + 全局函数）+ CSS（OKLCH 变量），数据全部存 localStorage，完全离线。`index.html` 直接可运行，但推荐用本地 HTTP 服务器打开（file:// 下 PWA manifest / 部分浏览器行为受限）：

```bash
python3 -m http.server 8000   # 然后开 http://localhost:8000
```

## 常用命令

```bash
node --check js/<file>.js          # 改完 JS 先语法检查
npx jest                           # 测试（若 node_modules 已安装；配置在 package.json）
npx eslint js/**/*.js              # Lint
# 浏览器内回归：打开 test/run-tests.html 自动跑全部断言（打开即跑）
# 改完前端后强刷：URL 追加 ?cb=<时间戳> 避开缓存（index.html 里 script 已带 ?v=5.6，改 CSS 时同样需要）
```

## 架构要点（跨文件才能看懂的部分）

**加载顺序即依赖顺序**（index.html 里 24 个 script 标签）：
`constants → utils → toast → slippage → storage → skills-integration → calculation-ui → calculator → logs → rendering → stats → modals → navigation → dashboard → planner → settings → risk → chart-factory → analytics → review → io → dom-cache → app → version`

**全局挂载约定**：各模块通过 `window.utils` / 全局函数暴露。`js/utils.js` 末尾执行 `window.utils = util` 并补了一个全局别名。⚠️ 历史坑（v5.2 P0）：`js/risk.js` 曾用裸标识符 `util.isClosedTrade` 调用，而生产环境只有 `window.utils`——权威分支从未执行，被 `test/run-tests.html` 内的局部 `var util = window.utils` 掩盖。改动跨模块调用时务必确认用的是 `window.utils`（或文件内已确认的全局别名），不要用裸 `util`。

**开仓计算管线**（`js/calculator.js`，~1900 行，核心）：滑点 → 止损距离 → 风险金额（凯利可驱动）→ 名义仓位 → 保证金 → 逐层硬上限截断 → 强平校验 → 组合热量熔断。所有提示与结果卡片统一使用**截断后**数值。

**权威实现（单一事实来源）**：已平仓判定（`isClosedTrade`，部分平仓中间态不算已平仓）、胜率分母（保本计入）、强平价公式、本地日期（`toLocalDateStr`）、当日连亏（`_getTodayLossStreak`）——全站只改 `js/utils.js` / `js/risk.js` 里的唯一实现，不要在 dashboard/stats/review 等处复制逻辑。

**部分平仓生命周期**（`js/logs.js`）：开仓 → 部分平仓（closes 追加 + realizedPnl/closedRatio）→ 最终平仓。R 倍数以 `initialRiskAmount` 为基准，CSV 导入导出必须完整保留这些字段。

**数据存储**（`js/storage.js`）：
- `trade_logs_plus_v4`：日志数组（SCHEMA_VERSION=4）
- `trade_settings_v1`：设置对象
- `trade_backup_auto_index`：自动备份轮转（默认保留 10 份）

**检查清单闸门**（`js/planner.js`）：12 项开仓前检查，`updateChecklistSummary` 汇总结论行，`focusChecklistFailures` 在保存被 `assertSavableCalculation`（`js/calculator.js`）拒绝时定位失败项。

## 测试

- `test/run-tests.html`：浏览器内回归（打开即跑），覆盖 isClosedTrade / 凯利链 / 集中度 / 一致性门等。
- `test/verify-fixes.html`：修复验证页。
- Jest 配置在 package.json（jsdom 环境，`tests/**/*.test.js`），但 `tests/` 目录当前不存在；`test/` 目录才是活跃的浏览器测试位置。新增 JS 断言优先加进 `run-tests.html`。

## 约定

- ESLint（`.eslintrc.json`）：`eqeqeq` / 分号 / 单引号为 error；`no-var` / `prefer-const` 为 warn——**存量代码大量使用 var，新增代码跟随周边风格，不必强行 const**（历史上按 var 为主）。
- 中文注释为主，关键修复带「P0/P1 修复」审计标记（注释里保留了历次审计的决策原因，改代码前先读注释）。
- 版本号在 `js/version.js`，index.html script 的 `?v=` 同步升级。
