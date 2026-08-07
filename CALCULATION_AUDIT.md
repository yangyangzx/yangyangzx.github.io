# 计算逻辑审计与优化报告

## 一、核心单位定义

### 1. positionSize（仓位大小）
- **单位**：USDT（名义价值，notional value）
- **定义**：合约的总价值 = 保证金 × 杠杆
- **示例**：保证金 100 USDT，杠杆 10x → positionSize = 1000 USDT

### 2. riskAmount（风险金额）
- **单位**：USDT
- **定义**：止损触发时最大亏损金额
- **公式**：`riskAmount = positionSize × stopDistance / effectiveEntryPrice`
- **推导仓位**：`positionSize = riskAmount × effectiveEntryPrice / stopDistance`

### 3. stopDistance（止损距离）
- **单位**：价格单位（与 entryPrice 相同）
- **公式**：`stopDistance = |effectiveEntryPrice - stopLoss|`

### 4. effectiveEntryPrice（有效入场价）
- **单位**：价格单位
- **公式**：`effectiveEntryPrice = entryPrice × (1 + directionSign × slippageRate)`
- **说明**：slippageRate 是千分比（如 market=0.001），仅影响入场滑点

### 5. fee（手续费）
- **单位**：USDT
- **公式**：`fee = positionSize × feeRate / 100 × 2`（开仓+平仓）
- **feeRate**：百分比（如 0.08 表示 0.08%）

### 6. slippageCost（滑点成本）
- **单位**：USDT
- **正确公式**：`slippageCost = positionSize × slippagePct / 100`
- **slippagePct**：用户设置的滑点百分比（如输入 0.1 表示 0.1%）
- **问题**：当前实现使用复杂的非线性模型，量纲混乱

### 7. totalCost（总成本）
- **单位**：USDT
- **公式**：`totalCost = fee + slippageCost`

### 8. grossProfit / grossLoss（毛盈亏）
- **单位**：USDT
- **多单**：`grossProfit = (targetPrice - effectiveEntryPrice) × positionSize / effectiveEntryPrice`
- **多单止损损失**：`grossLoss = stopDistance × positionSize / effectiveEntryPrice = riskAmount`
- **注意**：grossLoss 数学上等于 riskAmount（因为 positionSize = riskAmount × entry / stopDist）

### 9. netProfit / netLoss（净盈亏）
- **单位**：USDT
- **净盈利**：`netProfit = grossProfit - totalCost`
- **净亏损**：`netLoss = grossLoss + totalCost = riskAmount + totalCost`

### 10. targetRR（净盈亏比）
- **单位**：无量纲
- **公式**：`targetRR = netProfit / netLoss = (grossProfit - totalCost) / (riskAmount + totalCost)`

---

## 二、发现的问题

### Bug #1：滑点成本重复扣除（严重）

**位置**：`calculator.js:372-395`

**问题描述**：
- `effectiveEntryPrice` 已经包含了入场滑点（line 23）
- 在盈亏比计算中，`grossProfit` 使用 `effectiveEntryPrice` 作为分母（line 386）
- 但随后又用 `totalCost = fee + slippageCost` 去减（line 388）
- 这导致入场滑点被计算了两次：一次在 `effectiveEntryPrice` 中，一次在 `slippageCost` 中

**影响**：净盈亏比被低估，用户可能放弃原本可行的交易。

**修复方案**：
- `effectiveEntryPrice` 已经包含入场滑点，所以出场时的滑点成本只应是"从入场到出场"的额外滑点
- 简化：将 `slippageCost` 仅用于展示和日志记录，不在盈亏比计算中重复扣除
- 或者：从 `totalCost` 中移除 `slippageCost`，只保留 `fee`

### Bug #2：滑点成本公式量纲错误（严重）

**位置**：`calculator.js:364`

**问题描述**：
```javascript
slippageCost = cappedAdjustedTicks * tickSize * finalPos / effectiveEntryPrice;
```
- `cappedAdjustedTicks`：tick 数量（无量纲整数）
- `tickSize`：价格单位（如 BTC=0.1）
- `finalPos`：仓位大小（USDT 名义价值）
- `effectiveEntryPrice`：价格单位

**量纲分析**：
```
ticks × price × notional_USDT / price = ticks × notional_USDT
```
- 结果单位是 "ticks × USDT"，不是 USDT
- 正确的滑点成本应该是：`positionSize × slippagePct / 100`

**修复方案**：
- 移除复杂的非线性模型
- 使用简单线性模型：`slippageCost = finalPos × slippagePct / 100`
- 其中 `slippagePct` 是用户输入的滑点百分比

### Bug #3：分批建仓加权止损跳过逻辑不完整（中等）

**位置**：`calculator.js:137-151`

**问题描述**：
```javascript
if (direction === 'long' && bsl >= bp) { skippedCount++; continue; }
if (direction === 'short' && bsl <= bp) { skippedCount++; continue; }
```
- 当有批次方向非法时，`skippedCount++` 然后 `continue` 跳过
- 但随后：
```javascript
if (skippedCount > 0) {
    weightedStopPct = 0; // 触发 fallback
}
```
- 这导致即使有合法的批次，也会因为存在非法批次而全部作废

**修复方案**：
- 移除 `weightedStopPct = 0` 的清零逻辑
- 让合法批次继续参与加权计算
- 只在 `totalAlloc === 0`（没有合法批次）时才 fallback

### Bug #4：滑点模型参数硬编码（低）

**位置**：`utils.js:308-437`

**问题描述**：
- `calculateOrderSizeImpact`、`calculateVolatilityImpact`、`calculateLiquidityImpact` 使用硬编码的市场参数
- 这些参数与实际市场严重不符
- 周末因子使用 UTC 时间，但交易时段也使用 UTC，逻辑重复

**修复方案**：
- 简化为基于用户输入的直接计算
- 移除硬编码的市场微观结构参数
- 保留函数接口但简化实现

---

## 三、数据联动性问题

### Issue #1：日亏损监控使用全量数据（中等）

**位置**：`risk.js:104-154` vs `stats.js:15-248`

**问题**：
- `renderDailyLoss()` 使用 `getClosedSorted()` 获取全部已平仓日志
- `updateStats()` 使用 `applyFilters(allClosed)` 获取过滤后数据
- 当用户应用过滤器后，两个视图显示不一致

**修复方案**：
- 让 `renderDailyLoss()` 接受可选的 `closed` 参数
- 在 `renderRiskCenter()` 中传入当前过滤后的数据

### Issue #2：强平预警未合并分批仓位（低）

**位置**：`dashboard.js:266-307` vs `risk.js:224-299`

**问题**：
- 两处都按单条日志计算强平价
- 同一 `groupId` 的多条日志代表同一笔交易的批次，应合并计算

**修复方案**：
- 添加辅助函数 `getAggregatedOpenPositions()` 按 groupId 合并
- 在强平预警中使用合并后的数据

### Issue #3：MAE/MFE 统计口径不一致（低）

**位置**：`stats.js:192-222` vs `analytics.js:258-290`

**问题**：
- `stats.js`：MAE 仅统计亏损单，MFE 统计全部
- `analytics.js`：MAE 和 MFE 都统计全部交易

**修复方案**：
- 统一口径：MAE 仅亏损单，MFE 全部
- 在 `analytics.js` 中修改为与 `stats.js` 一致

---

## 四、修复计划

### 优先级 P0（必须修复）

1. **修复滑点成本重复扣除**
   - 文件：`calculator.js`
   - 修改：从 `totalCost` 中移除 `slippageCost` 对盈亏比的影响
   - 保留：`slippageCost` 用于日志展示

2. **修复滑点成本公式量纲错误**
   - 文件：`calculator.js`, `utils.js`
   - 修改：简化为线性模型 `slippageCost = finalPos × slippagePct / 100`
   - 移除：复杂的非线性市场冲击模型

3. **修复分批建仓跳过逻辑**
   - 文件：`calculator.js`
   - 修改：移除 `weightedStopPct = 0` 的清零逻辑
   - 保留：合法批次的加权计算

### 优先级 P1（建议修复）

4. **统一日亏损监控数据源**
   - 文件：`risk.js`, `index.html`
   - 修改：让 `renderDailyLoss()` 接受过滤参数

5. **合并分批建仓强平预警**
   - 文件：`dashboard.js`, `risk.js`
   - 修改：按 groupId 聚合持仓

6. **统一 MAE/MFE 统计口径**
   - 文件：`analytics.js`
   - 修改：与 `stats.js` 保持一致

### 优先级 P2（可选优化）

7. **简化滑点模型参数**
   - 文件：`utils.js`
   - 修改：移除硬编码的市场参数

---

## 五、测试方案

创建 `calculator-test.html` 测试页面，包含：

1. **仓位计算测试**
   - 多单：entry=50000, sl=49000, capital=10000, risk=2% → positionSize = ?
   - 空单：entry=50000, sl=51000, capital=10000, risk=2% → positionSize = ?
   - 验证：riskAmount = positionSize × stopDistance / entryPrice

2. **盈亏比测试**
   - 多单：entry=50000, sl=49000, tp=52000, fee=0.08% → RR = ?
   - 验证：netProfit = grossProfit - fee, netLoss = riskAmount + fee

3. **分批建仓测试**
   - 2批：batch1 (price=50000, alloc=60%, sl=49000), batch2 (price=50100, alloc=40%, sl=49100)
   - 验证：weightedStopDistance = ?

4. **强平价测试**
   - 多单：entry=50000, lev=10, mmr=0.5% → liqPrice = ?
   - 空单：entry=50000, lev=10, mmr=0.5% → liqPrice = ?

5. **滑点成本测试**
   - positionSize=10000, slippagePct=0.1% → slippageCost = ?
   - 验证单位正确（USDT）
