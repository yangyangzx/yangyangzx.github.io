# TradingDiscipline 系统 Bug 分析与优化建议报告

> 分析时间：2026-08-16 | 版本：v5.0-gamma | 状态：全部已修复（commits 749fca0 + 二次修复）

---

## 已修复 Bug 清单（v5.0-beta）

| # | 级别 | 文件 | 修复内容 |
|---|------|------|---------|
| 1 | P0 | `calculator.js:419` | 强平阻断边界 `<=` → `<`，止损等于强平价时不再误阻断 |
| 2 | P0 | `calculator.js:648` | 分批止损行 `bRisk` 统一使用 `effectiveRiskAmount` 避免口径不一致 |
| 5 | P0 | `skills-integration.js:241` | 日亏损熔断边界 `<=` → `<`，恰好等于上限时允许继续交易 |
| 4 | P0 | `rendering.js:renderLogs` | 每次渲染时清除 `_closePriceEdited` 防止跨会话状态残留 |
| 16 | P1 | `settings.js:446` | `importSettings` 品种合并循环补全 `.length`（原对象直接当数字导致循环不执行） |
| 7 | P1 | `utils.js:calcEquityCurve` | 权益曲线起点优先取 settings 账户余额而非首笔日志 capital |
| 6 | P1 | `modals.js:607` | 编辑平仓结算改用 `item.fee` 而非可能已过时的 `actualCloseFee` 快照 |
| 9 | P1 | `calculator.js:resetForm` | 补充重置 `formAtrStopEnabled` checked 状态 |
| 10 | P1 | `app.js:192` | 移除 `onFilterChange` 中防抖函数嵌套递归调用 |
| 15 | P2 | `logs.js:batchSelectAll` | 合并两次重复 DOM 查询为一次 |
| 13 | P2 | `index.html` + `version.js` | 统一所有脚本 `?v=3.0` 版本键 |
| 3 | P1 | `logs.js:calculateCloseSettlement` | 双重滑点防御：检测到 ticks-v1 模型与旧式 slippageCost 共存时跳过 legacy 扣减 |
| 8 | P2 | `planner.js:284` | 多止盈位 RR 计算补充 `calc.fee` 语义注释 |
| 14 | P2 | `storage.js:estimateLocalStorageCapacity` | 优先使用 `navigator.storage.estimate()` API，fallback 探测方式 |
| 12 | P2 | `slippage.js:DEFAULT_TICKS_BY_ORDER_TYPE` | 补充 6 种扩展订单类型的滑点默认值 |
| 11 | P2 | `index.html` + `service-worker.js` | 移除 `render-utils.js` 死代码引用，递增 SW 缓存版本到 v6 |

---

## 一、P0 严重 Bug（可能导致数据丢失或计算错误）

### Bug #1 — 强平熔断逻辑边界错误（`calculator.js:419`）

**位置：** `calculator.js` L419

```js
// 当前代码（错误）：
if (isInvalid) { ... } // 当 stopLoss <= liquidationPrice 时触发
// 而 isInvalid 定义如下（L419-420）：
const isInvalid = (direction === 'long' && stopLoss <= liquidationPrice) ||
                  (direction === 'short' && stopLoss >= liquidationPrice);
```

**问题：** 止损价**等于**强平价时直接阻断，但此时止损与强平重合——用户仍有机会在强平前手动止损。正确的行为应该是：只有止损价**低于**（做多）/ **高于**（做空）强平价时才阻断。同时应改为 `<` / `>`。

**修复建议：**
```js
const isInvalid = (direction === 'long' && stopLoss < liquidationPrice) ||
                  (direction === 'short' && stopLoss > liquidationPrice);
// 等于时允许，只阻断严格越过
```

---

### Bug #2 — 分批独立止损行显示 bRisk/bpos 来源不一致（`calculator.js:642-654`）

**位置：** `calculator.js` L642-654

```js
const bRisk = riskAmount * ba / 100;      // ← 使用原始 riskAmount（未截断）
const bpos = effectivePositionSize * ba / 100; // ← 使用 effectivePositionSize（已截断）
const bloss = Math.min(bRisk, ...);         // 取两者较小值，展示结果不可预测
```

**问题：** `bRisk` 和 `bpos` 来源不一致——前者是未截断前的风险额，后者是截断后的有效仓位。当仓位被保证金/聚合上限截断时，`bRisk` 不反映截断效果，但 `bloss = Math.min(bRisk, ...)` 混合了两套口径，可能导致"止损触发损失"行显示错误的金额。

**修复建议：** 统一使用截断后的 `effectiveRiskAmount` 按批次比例拆分：
```js
const bRisk = effectiveRiskAmount * ba / 100;
```

---

### Bug #3 — 平仓结算双重滑点扣减风险（`logs.js:42`, `logs.js:29`）

**位置：** `logs.js` `getLegacySlippageCost()` 与 `calculateCloseSettlement()`

```js
// 新模型下 slippageCost 已被纳入 effectiveEntryPrice，不应再次扣除
var legacySlippageCost = getLegacySlippageCost(item, legacySlippageOverride);
var netPnl = grossPnl - fee - legacySlippageCost;
```

**问题：** 当 `isTickSlippageRecord(item)` 返回 `true` 时，`legacySlippageCost = 0`，逻辑正确。但若某条旧日志存在 `slippageCost > 0` **且** 同时有 `effectiveEntryPrice`（schema 迁移不完整），则会产生**双重扣减**。此外，平仓面板的滑点输入框（`cpSlippage_`）始终为 `readonly`，但其展示值是 `item.slippageCost`，对 tick-v1 记录该值永远为 `0`，用户可能产生困惑。

**修复建议：** 在 `calculateCloseSettlement` 中增加双标记校验：
```js
if (isTickSlippageRecord(item) && legacySlippageCost > 0) {
  // 数据不一致，仅使用 ticks 模型结果
  return null; // 或记录警告
}
```

---

### Bug #4 — `_closePriceEdited` 跨索引全局污染（`logs.js:2`）

**位置：** `logs.js` L2，`_closePriceEdited` 对象在全局作用域声明

```js
const _closePriceEdited = {};
```

**问题：** 该对象作为全局变量，key 为索引号。若用户打开两个持仓的平仓面板（先后展开两个 index），第一个面板的 `_closePriceEdited[idx1]` 状态不会在关闭面板时清除。同时 `confirmClose` 在取消时也通过 `delete _closePriceEdited[resolvedIdx]` 清除，但如果页面刷新或未点取消直接切换视图，残留数据会导致下次自动填价逻辑失效。

**修复建议：** 在 `restoreAfterRender` 或面板关闭时统一清理：
```js
// renderLogs 顶部或 close-panel 关闭时
Object.keys(_closePriceEdited).forEach(k => delete _closePriceEdited[k]);
```

---

### Bug #5 — 日亏损熔断边界条件 `<=` 应为 `<`（`skills-integration.js:241`）

**位置：** `skills-integration.js` L241

```js
var overLimit = todayPnl <= -dailyLossLimit;  // 今日恰好等于上限时也阻断
```

**问题：** 当今日净盈亏**恰好等于**日亏损上限时触发阻断，但用户期望是"超过上限才阻断"。例如上限为 5% × 1000 = 50 USDT，今日亏损恰好 50 USDT 时也被阻断，过于严苛。

**修复建议：**
```js
var overLimit = todayPnl < -dailyLossLimit;  // 严格小于（更亏）才阻断
```

---

## 二、P1 重要 Bug（功能缺陷）

### Bug #6 — 编辑弹窗 `saveEditLog` 平仓结算使用 `actualCloseFee` 而非原滑点（`modals.js:607`）

**位置：** `modals.js` L607

```js
var editedSettlement = calculateCloseSettlement(item, item.closePrice, 
  item.actualCloseFee, item.actualExitLegacySlippageCost);
```

**问题：** `actualCloseFee` 和 `actualExitLegacySlippageCost` 是平仓时的快照，但在 `rebuildTickSlippageSnapshot` 调用之后这些字段可能被覆盖。如果编辑了入场价但不动平仓价，结算可能使用过时的费用值，导致保存后 PnL 与重新计算不一致。

**修复建议：** 在 `rebuildTickSlippageSnapshot` 之后重新计算 `actualCloseFee`，或使用 `calculateCloseSettlement(item, item.closePrice)` 不传 override 参数让函数从 item 自动读取。

---

### Bug #7 — 权益曲线初始资本取自首笔日志而非设置（`utils.js:227`）

**位置：** `utils.js` L227

```js
if (sorted.length > 0 && sorted[0].capital != null && sorted[0].capital > 0) {
  _initCap = sorted[0].capital;  // 用首笔日志的 capital 作为起点
}
```

**问题：** 若首笔交易的 capital 快照与当前设置中的账户余额不一致（如用户修改过账户余额），权益曲线起点会偏移。正确的行为应是优先使用设置中的账户余额，日志中的 capital 作为"存取款事件"处理（代码已有 `balanceAdjustment` 机制但未启用）。

**修复建议：** 调整优先级：settings.accountBalance > sorted[0].capital > 0
```js
var bal = (settingsOverride && settingsOverride.accountBalance > 0) 
  ? settingsOverride.accountBalance 
  : (sorted[0].capital || 0);
_initCap = bal;
```

---

### Bug #8 — 多止盈位 RR 计算使用 fee 符号方向错误（`planner.js:284-287`）

**位置：** `planner.js` L284-287

```js
var grossProfit = profitDistance * origPosSize / ep;
var grossLoss = stopDistance * origPosSize / ep;
var fee = calc.fee || 0;
var netProfit = grossProfit - fee;
var netLoss = grossLoss + fee;  // ← 止损路径也应扣除费用（同方向）
var rr = netLoss > 0 ? netProfit / netLoss : grossProfit / grossLoss;
```

**问题：** `grossLoss` 是负向金额（实际亏损为正数），手续费对止损路径同样存在（开仓 + 平仓各一次），因此 `netLoss = grossLoss + fee` 正确。但 `netProfit = grossProfit - fee` 中 fee 只扣了一次，而实际交易中盈利的 path 也有双向手续费。若以单程手续费为 `calc.fee`（总手续费），则此处应减去全部分摊。当前 `calc.fee` 是 round-trip 总费用，止盈路径也应减去全部费用（不是 half），所以代码逻辑本身正确，但命名易混淆。

**注意：** 此 bug 实际是**注释层面**的问题，代码逻辑正确，但建议添加注释说明 `calc.fee` 含义，避免后续维护误解。

---

### Bug #9 — `resetForm` 未重置 `formAtrStopEnabled` 的 checked 状态（`calculator.js:1165`）

**位置：** `calculator.js` L1196-1198

```js
// resetForm 中有 ATR 相关重置：
document.getElementById('atrValue').value = '';
var _atrSettings = loadSettings();
document.getElementById('atrMultiplier').value = _atrSettings.atrDefaultMultiplier || 2;
// 但缺少：
// document.getElementById('formAtrStopEnabled').checked = false;
```

**问题：** 点击重置按钮后，ATR 开关保持原状态，导致下次计算可能继续使用 ATR 模式，而用户意图是恢复默认（关闭 ATR）。

**修复建议：** 在 `resetForm` 中添加：
```js
var atrEnableEl = document.getElementById('formAtrStopEnabled');
if (atrEnableEl) atrEnableEl.checked = false;
```

---

### Bug #10 — 筛选器防抖函数被重复绑定（`app.js:180`）

**位置：** `app.js` L180

```js
var _debouncedFilterChange = _debounce(onFilterChange, 150);
```

**问题：** `_debouncedFilterChange` 在 DOMContentLoaded 时创建，但每次调用 `onFilterChange` 时又自行调用 `_debouncedFilterChange()`（L192），形成嵌套防抖——外层 150ms 防抖内再调用防抖函数，可能导致延迟翻倍或行为异常。

**修复建议：** 移除 `onFilterChange` 内部的递归调用：
```js
function onFilterChange() {
  _activeFilters.direction = ...;
  // ... 其他字段更新
  // 删除以下这行：
  // _debouncedFilterChange();
}
```

---

## 三、P2 代码质量与优化建议

### Issue #11 — `renderLogRow` 在 `render-utils.js` 与 `rendering.js` 中重复实现

**位置：** `render-utils.js` L70-92 vs `rendering.js` L11-337

`render-utils.js` 中的 `renderLogRow` 使用简化的数据模型（`log.openTime` / `log.id`），而实际渲染使用的是 `rendering.js` 中的 `buildRowsHTML`。两套实现逻辑不一致，`render-utils.js` 的函数从未被调用（dead code）。

**建议：** 删除 `render-utils.js` 中未使用的函数，或将其与 `rendering.js` 对齐。

---

### Issue #12 — `DEFAULT_TICKS_BY_ORDER_TYPE` 中 stop 类型缺少方向区分

**位置：** `slippage.js` L18-22

```js
var DEFAULT_TICKS_BY_ORDER_TYPE = Object.freeze({
  market: { entry: 1, exit: 1 },
  stop:   { entry: 2, exit: 2 },  // 止损单
  limit:  { entry: 0, exit: 1 }
});
```

**问题：** HTML 中 `orderType` 有三个选项（market/limit/stop），但 `modals.js` 中编辑弹窗支持 7 种订单类型（limitBuy/stopBuy/limitSell/stopSell/stopLimit/trailingStop）。`slippage.js` 的默认 ticks 映射缺少这些扩展类型，会用 market 默认值兜底。

**建议：** 补充完整映射或增加统一 fallback 注释说明。

---

### Issue #13 — 版本缓存键与 APP_VERSION 脱节

**位置：** `index.html` L1142-1166

```html
<script src="js/constants.js?v=2.2"></script>
<script src="js/calculator.js?v=3.0"></script>
```

同时 `version.js` 定义：
```js
var APP_VERSION = '2.1';
```

**问题：** HTML 中各脚本的 `?v=` 版本号不一致（2.1~3.0），且与 `APP_VERSION` 不同步。用户更新页面时缓存清理策略混乱，可能导致旧版 JS 与新版 HTML 不兼容。

**建议：** 统一使用 `APP_VERSION` 值或一个独立的全局缓存键。

---

### Issue #14 — `estimateLocalStorageCapacity` 可能触发无限循环

**位置：** `storage.js` L403-437

**问题：** 该函数逐次测试 1KB、10KB、100KB、1MB 写入来估算容量。若 localStorage 接近满额，写入测试数据本身就会失败，导致函数反复抛出异常。虽然外层有 try-catch，但在某些浏览器实现中，quota 错误可能在写入时静默失败，导致 `capacity` 计算不准确。

**建议：** 使用 `navigator.storage.estimate()` API（Chrome/Edge 支持）作为首选，fallback 到当前探测方式。

---

### Issue #15 — `batchSelectAll` 中重复获取 tbody 引用

**位置：** `logs.js` L247-263

```js
function batchSelectAll(checked) {
  _selectedIndices.clear();
  if (checked) {
    const tbody = document.getElementById('logBody');  // 第一次
    if (tbody) { tbody.querySelectorAll(...).forEach(...) }
  }
  const tbody2 = document.getElementById('logBody');  // 重复获取
  if (tbody2) { tbody2.querySelectorAll(...).forEach(...) }
  ...
}
```

**建议：** 合并为一个 DOM 查询，减少冗余。

---

### Issue #16 — `importSettings` 循环变量类型错误（`settings.js:446`）

**位置：** `settings.js` L446

```js
for (var j = 0; j < current.customSymbols; j++) {  // ← 应为 .length
  existingSyms[current.customSymbols[j].symbol] = true;
}
```

**问题：** `current.customSymbols` 是一个数组对象，直接用作数字条件时会被转换为 `NaN`（因为对象不是数字），导致循环不执行。这是一个**静默 bug**——导入设置时品种列表永远不会被合并，每次导入都会完整覆盖品种列表。

**修复建议：**
```js
for (var j = 0; j < current.customSymbols.length; j++) {
```

---

## 四、架构优化建议

### 建议 #1 — 统一 `getAccountCapital` 数据源

当前系统中有三个函数分别计算账户资本：
- `risk.js:getAccountCapital()` — 从日志倒序查找
- `calculator.js` 内部 `loadSettings().accountBalance`
- `utils.js:calcEquityCurve` 中的 settingsOverride

建议：建立单一 `getAccountCapital(settings?)` 函数，统一优先级：`settings.accountBalance` > `logs 中最晚的 capital` > 默认值。

---

### 建议 #2 — 引入 `SafeNumeric` 工具封装

多处代码使用 `parseFloat(x) || 0` 模式，当 `x` 为 `"0"` 或空字符串时会丢失精度。建议封装：
```js
function safeNum(val, fallback = 0) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}
```

---

### 建议 #3 — 图表生命周期管理过度复杂

`ChartManager`（`utils.js:454-722`）引入了 Map、超时清理、实例计数等重量级机制，但对于本应用（最多同时 10 个图表）而言过度设计。建议简化为：
```js
const activeCharts = new Map();
function destroyChart(key) { 
  activeCharts.get(key)?.destroy(); 
  activeCharts.delete(key); 
}
```

---

### 建议 #4 — 将 `_filterMatch` / `applyFilters` 提升为独立模块

`logs.js` 和 `stats.js` 都依赖过滤逻辑，但 `applyFilters` 定义在 `logs.js`，`stats.js` 直接引用全局变量。建议提取为 `filters.js` 模块，显式导出。

---

### 建议 #5 — 添加单元测试

当前 `package.json` 中有 jest 配置但 `tests/` 目录为空。建议为核心计算函数添加测试：
- `calculator.js` 中的仓位计算
- `slippage.js` 中的滑点模型
- `skills-integration.js` 中的风控检查
- `logs.js` 中的 `calculateCloseSettlement`

---

## 五、总结

| 级别 | 数量 | 核心影响 |
|------|------|---------|
| P0 严重 | 5 | 强平阻断误判、止损行显示不一致、双重滑点风险、状态污染、熔断边界错误 |
| P1 重要 | 5 | 编辑结算不一致、权益曲线起点偏移、reset 遗漏、防抖嵌套 |
| P2 质量 | 6 | dead code、版本混乱、bug-prone 代码模式 |

**最高优先级修复项：** Bug #1（强平边界）、Bug #5（日亏损边界）、Bug #16（importSettings 循环 bug）。这三项修复成本低但影响大，建议立即处理。
