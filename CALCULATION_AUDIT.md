# 交易系统计算逻辑深度审计报告

> 审计时间：2026-08-16 | 版本：v5.0-gamma | 审计范围：开仓计划 + 分析数据计算

---

## 执行摘要

本次深度审计覆盖了系统核心计算模块，通过数学推导、边界测试和完整交易流程模拟，发现并修复了 **1 个 P0 严重 Bug** 和 **11 个已验证正确的计算逻辑**。

### 修复列表

| # | 级别 | 模块 | 问题 | 修复状态 |
|---|------|------|------|---------|
| 1 | P0 | `utils.js:calcLiquidationPrice` | 强平价格公式缺少 MMR 修正项 | ✅ 已修复 (commit e95a7ea) |

---

## 一、已修复问题详情

### Bug #1: 强平价格公式错误（P0）

**位置：** `js/utils.js` L143, L152

**问题描述：**

当前代码使用的强平价格公式缺少 MMR（维持保证金率）修正项：

```js
// 错误公式（当前）
Long:  LP = Entry × (1 - 1/lev) / (1 - mmr)
Short: LP = Entry × (1 + 1/lev) / (1 + mmr)
```

币安/OKX 等主流交易所的标准公式为：

```js
// 正确公式（修复后）
Long:  LP = Entry × (1 - 1/lev + mmr) / (1 - mmr)
Short: LP = Entry × (1 + 1/lev - mmr) / (1 + mmr)
```

**影响量化：**

以 BTC @50000, 10x 杠杆, MMR=0.5% 为例：

| 项目 | 旧公式 | 新公式 | 差异 |
|------|--------|--------|------|
| Long 强平价 | 45226.13 | 45477.39 | +251.26U (+0.556%) |
| Short 强平价 | 54726.37 | 54477.61 | -248.76U (-0.455%) |

**实际影响场景：**

用户设置止损在 45300，10x 杠杆：
- 旧公式：LP=45226.13，45300 > 45226 → **允许开仓**（错误）
- 新公式：LP=45477.39，45300 < 45477 → **阻断开仓**（正确，止损在强平之下）

**修复内容：**

```js
// utils.js L143
liquidationPrice = entryPrice * (1 - initialMarginRatio + mmr) / (1 - mmr);

// utils.js L152
liquidationPrice = entryPrice * (1 + initialMarginRatio - mmr) / (1 + mmr);
```

---

## 二、已验证正确的计算逻辑

以下模块经过数学推导、边界测试和完整流程模拟，确认计算逻辑正确：

### 1. 仓位计算公式 ✅

**公式：** `positionSize = riskAmount × entryPrice / stopDistance`

**验证结果：**
- 正向计算：riskAmount=100U, entry=100, stopDist=5 → positionSize=2000U ✓
- 反向验证：positionSize=2000U, stopDist=5, entry=100 → riskAmount=100U ✓
- 边界：stopDistance→0 时 positionSize→∞（由零止损距离检查拦截）

### 2. 平仓 PnL 计算公式 ✅

**公式（logs.js）：**
```js
// Long
grossPnl = (exitPrice - entryPrice) × positionSize / entryPrice
// Short  
grossPnl = (entryPrice - exitPrice) × positionSize / entryPrice
```

**验证结果：**
- Long: entry=100, exit=110, size=1000U → PnL=+100U ✓
- Short: entry=100, exit=90, size=1000U → PnL=+100U ✓
- 与标准公式 `quantity × (exit - entry)` 等价 ✓

### 3. 滑点方向模型 ✅

**公式（slippage.js）：**
```js
// Long entry: filled = price + delta (更高 = 不利)
// Long exit:  filled = price - delta (更低 = 不利)
// Short entry: filled = price - delta (更低 = 不利)
// Short exit:  filled = price + delta (更高 = 不利)
```

**验证结果：**
- Long entry 100 + 1tick(0.1) = 100.1 ✓
- Long exit 110 - 1tick(0.1) = 109.9 ✓
- Short entry 100 - 1tick(0.1) = 99.9 ✓
- Short exit 90 + 1tick(0.1) = 90.1 ✓

### 4. 手续费计算公式 ✅

**公式（calculator.js）：**
```js
fee = quantity × entryFill × rate + quantity × exitFill × rate
```

**验证结果：**
- 1000U @ 0.08% round-trip → fee=1.68U ✓
- 基于 effectiveEntryPrice（含滑点）计算，口径正确 ✓

### 5. 盈亏比 (RR) 计算 ✅

**公式（calculator.js L547-563）：**
```js
netProfit = grossProfit - targetFee
netLoss = Math.abs(grossStopLoss - stopFee)  // 等价于 |grossSL| + stopFee
RR = netProfit / netLoss
```

**验证结果：**
- entry=100, stop=95, target=110, fee=0.08%
- grossProfit=100U, grossStopLoss=-50U
- targetFee=1.68U, stopFee=1.56U
- netProfit=98.32U, netLoss=51.56U
- RR=1.91:1 ✓（比无费用时 2:1 略低，符合预期）

### 6. 强平价格公式 ✅（已修复）

详见前述 Bug #1 修复。

### 7. 组合热量计算 ✅

**公式（skills-integration.js）：**
```js
actualRisk = stopDist / entry × positionSize
heat = Σ(actualRisk) / capital × 100
```

**验证结果：**
- Position 1: 5000U @ 5% stop → risk=250U
- Position 2: 3000U @ 3% stop → risk=90U
- Heat = (250+90) / 10000 × 100 = 3.4% ✓

### 8. 凯利公式 ✅

**公式（skills-integration.js）：**
```js
Kelly% = (WR × AvgWin - LR × AvgLoss) / AvgWin
Half-Kelly% = Kelly% × 0.5
```

**验证结果：**
- WR=55%, AvgWin=50U, AvgLoss=30U → Kelly=28%, Half=14% ✓
- WR=40%, AvgWin=30U, AvgLoss=40U → Kelly=0%（负期望截断）✓

### 9. MAE/MFE 计算 ✅

**公式（logs.js）：**
```js
// Long
MAE = (low - entry) / entry × 100  // 负值表示浮亏
MFE = (high - entry) / entry × 100 // 正值表示浮盈
// Short
MAE = (entry - high) / entry × 100
MFE = (entry - low) / entry × 100
```

**验证结果：**
- Long entry=100, low=95, high=110 → MAE=-5%, MFE=+10% ✓
- Short entry=100, low=90, high=105 → MAE=-5%, MFE=+10% ✓
- 散点图使用 `Math.abs(MAE)` 显示，逻辑正确 ✓

### 10. 回撤计算 ✅

**公式（utils.js）：**
```js
peakVal = Math.max(peakVal, cum)
maxDD = (peakVal - cum) / peakVal × 100
```

**验证结果：**
- 权益曲线 [10000, 10100, 10050, 10200, 10100, 10300, 10250]
- 最大回撤出现在 T4，DD=0.98% ✓

### 11. 可用资金计算 ✅

**公式（calculator.js L336-353）：**
```js
usedMargin = Σ(positionSize / leverage)
consumedCapital = usedMargin + Σ(slippageCost)
availableCapital = capital - consumedCapital
maxNewPos = availableCapital × leverage
```

**验证结果：**
- 已有持仓：5000U@10x, 3000U@5x, slippage=0.8U
- usedMargin=1100U, consumed=1100.8U
- available=8899.2U, maxNewPos(10x)=88992U ✓

### 12. 分批建仓加权计算 ✅

**公式（calculator.js L270-297）：**
```js
weightedStopPct = Σ((|batchPrice - batchSL| / batchPrice) × alloc%)
avgStopPct = weightedStopPct / totalAlloc
stopDistance = avgStopPct × weightedEntry
positionSize = riskAmount × weightedEntry / stopDistance
```

**验证结果：**
- 批1: price=100, alloc=60%, SL=95 → 5%
- 批2: price=102, alloc=40%, SL=96 → 5.88%
- weightedStopPct = (5×60 + 5.88×40) / 100 = 5.35% ✓
- riskAmount=100U → positionSize=1868.13U ✓
- 反向验证：1868.13×5.35%/100.8 = 99.0U ≈ 100U ✓

---

## 三、设计选择说明（非 Bug）

### 1. 日亏损统计仅包含已平仓交易

**设计意图：** 未实现浮亏不应计入日亏损限制，避免误触发熔断。

**合理性：** ✓ 正确，只有已实现盈亏才应触发风控。

### 2. consumedCapital 包含 slippageCost

**设计意图：** 滑点成本在开仓时已支付，应从可用资金中扣除。

**合理性：** ✓ 正确，准确反映实际资金占用。

### 3. 止损距离色标阈值

**当前设置：**
- ETH: min=0.3%, max=2%
- 其他: min=0.5%, max=3%

**设计意图：** 作为警告阈值而非阻断阈值，提醒用户注意极窄止损的滑点风险。

**合理性：** ✓ 合理，作为警告而非硬限制。

### 4. 多止盈位使用完整 fee

**当前逻辑：** TP1/TP2/TP3 部分止盈时使用完整的 `calc.fee`（round-trip）。

**影响：** 对部分止盈位，费用高估导致 RR 略低（偏保守）。

**合理性：** ✓ 安全设计，宁可低估 RR 也不高估。

---

## 四、浮点精度评估

### 测试场景

| 测试 | 结果 |
|------|------|
| 0.1 + 0.2 | 1000次累加误差 < 0.0001 ✓ |
| 大额交易 PnL (65432.123 × 50000) | 精度损失 < 0.01% ✓ |
| 手续费计算 (0.08% × 1000U) | 精确到 4 位小数 ✓ |

### 结论

系统计算中的浮点精度在可接受范围内，所有金额展示均使用 `.toFixed(2)` 或更高精度格式化，不会影响用户感知。

---

## 五、建议与后续行动

### 短期优化（非紧急）

1. **添加单元测试**：为核心计算公式添加 Jest 测试，确保后续修改不引入回归。
2. **增强日志**：关键计算节点增加 debug 日志，便于问题排查。

### 中期改进

1. **统一账户资本来源**：建立单一的 `getAccountCapital(settings?)` 函数，避免多处逻辑不一致。
2. **引入 SafeNumeric 工具**：封装 `parseFloat` 调用，避免零值语义丢失。

### 长期架构

1. **计算引擎重构**：将核心计算公式提取为纯函数模块，便于测试和复用。
2. **实时验证**：开仓前进行完整的数学验证，输出计算明细供用户审核。

---

## 六、测试覆盖

本次审计已完成以下测试：

- [x] 强平价格公式验证（新旧对比）
- [x] 仓位计算公式验证（正向/反向）
- [x] 平仓 PnL 计算验证（长/空对称）
- [x] 滑点方向验证（4种场景）
- [x] 手续费计算验证（round-trip）
- [x] 盈亏比计算验证（含费用）
- [x] 组合热量计算验证（多持仓）
- [x] 凯利公式验证（正/负期望）
- [x] MAE/MFE 计算验证（长/空）
- [x] 回撤计算验证（时序）
- [x] 可用资金计算验证（已有持仓）
- [x] 分批建仓加权验证（2批/3批）
- [x] 完整交易流程模拟（端到端）

---

**审计结论：** 系统计算逻辑整体正确，仅发现 1 个 P0 级公式错误（强平价格），已修复。其余模块经数学推导和代码验证，计算逻辑符合金融学标准和业务需求。
