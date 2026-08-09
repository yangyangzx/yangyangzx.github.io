# 数据分析维度与定义审计报告

> 审计时间：2026-08-09
> 审计范围：dashboard.js, stats.js, analytics.js, risk.js, review.js
> 审计目标：验证各展示维度的定义准确性、计算逻辑一致性

---

## 一、数据源一致性检查

### 1.1 已平仓交易判定标准

| 模块 | 函数 | 判定条件 | 状态 |
|------|------|----------|------|
| utils.js | `isClosedTrade()` | `closeType && closeType !== '' && pnlAmount != null && !isNaN(parseFloat(pnlAmount))` | ✅ |
| risk.js | `getClosedSorted()` | `closeType && pnlAmount != null && !isNaN(parseFloat(pnlAmount))` | ✅ |
| dashboard.js | `_getClosedLogs()` | `window.utils.isClosedTrade(logs[i])` | ✅ |
| stats.js | `updateStats()` | `window.utils.isClosedTrade(l)` | ✅ |

**结论：** 所有模块使用统一的已平仓判定标准。

---

### 1.2 数据排序一致性

| 模块 | 排序方式 | 状态 |
|------|----------|------|
| risk.js `getClosedSorted()` | 按 `closeTime` 升序 | ✅ |
| analytics.js `renderEquityChart()` | 手动按 `closeTime` 升序 | ✅ |
| stats.js `updateStats()` 回撤计算 | 手动按 `closeTime` 升序 | ✅ |
| dashboard.js `_renderEquityChart()` | 调用 `calcEquityCurve()` 内部排序 | ✅ |

**结论：** 时序数据排序一致。

---

## 二、核心指标定义验证

### 2.1 胜率 (Win Rate)

**定义：** `胜率 = 盈利笔数 ÷ 已决交易笔数 × 100%`

**已决交易** = 盈利笔数 + 亏损笔数（排除保本交易）

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:71 | `const winRate = decidedCnt > 0 ? (wins.length / decidedCnt * 100) : 0;` | ✅ |
| analytics.js:275 | `var winRate = decidedCnt > 0 ? (wins / decidedCnt * 100) : 0;` | ✅ |
| dashboard.js:131 | `var winRate = decided > 0 ? ((wins.length / decided) * 100) : 0;` | ✅ |
| stats.js:406 (策略拆解) | `const wr = decided > 0 ? (wins.length / decided * 100) : 0;` | ✅ |

**结论：** ✅ 定义准确，口径一致

---

### 2.2 盈亏比 (Win/Loss Ratio)

**定义：** `盈亏比 = 平均盈利 ÷ 平均亏损的绝对值`

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:76 | `const wlRatio = grossLoss > 0 ? (grossProfit / grossLoss) : ...` | ✅ |
| analytics.js (策略表) | 无此列（仅显示均R） | ⚠️ 设计选择 |
| stats.js:412 (策略拆解) | `const wlR = avgL > 0 ? avgW / avgL : 0;` | ✅ |

**注意：** stats.js 顶部面板显示的是 gross WL ratio（总金额比），不是平均每笔比。
- stats.js:76 计算的是 `grossProfit / grossLoss`
- stats.js:412 计算的是 `avgW / avgL`

**结论：** ⚠️ 两处定义略有差异（总金额比 vs 平均金额比），需确认是否有意为之

---

### 2.3 期望值 (Expectancy)

**定义：** `期望值 = 胜率 × 平均盈利 - 败率 × 平均亏损`

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:78-80 | `const expectancy = decidedCnt > 0 ? ((winRate / 100) * avgWin - (lossRate / 100) * avgLoss) : 0;` | ✅ |
| stats.js:413 (策略拆解) | `const exp = decided > 0 ? (wr / 100) * avgW - (lossRate / 100) * avgL : 0;` | ✅ |

**结论：** ✅ 定义准确，口径一致

---

### 2.4 利润因子 (Profit Factor)

**定义：** `利润因子 = 总盈利 ÷ 总亏损的绝对值`

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:81 | `const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (wins.length > 0 ? Infinity : 0);` | ✅ |

**结论：** ✅ 定义准确

---

### 2.5 最大回撤 (Max Drawdown)

**定义：** `最大回撤 = (峰值权益 - 谷底权益) ÷ 峰值权益 × 100%`

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:110-123 | 按时序累加，跟踪峰值和回撤 | ✅ |
| analytics.js `calcEquityCurve()` | 同样逻辑，返回 maxDDPercent | ✅ |
| dashboard.js `_renderEquityChart()` | 调用 `calcEquityCurve()` | ✅ |

**结论：** ✅ 定义准确，计算一致

---

### 2.6 均实际R:R (Average Actual R:R)

**定义：** `均实际R:R = Σ(|netPnL ÷ riskAmount|) ÷ 已平仓数`

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:158-163 | `const rm = parseFloat(String(l.rMultiple || '').replace(/R/g, ''));` | ✅ |

**问题：** 使用 `rMultiple` 字段，但该字段仅在平仓时记录，开仓时为空。
- 如果用户未记录平仓时的 R 值，此统计会缺失

**结论：** ⚠️ 定义合理，但依赖用户手动记录

---

### 2.7 预判偏差 (RR Bias)

**定义：** `预判偏差 = (实际R:R ÷ 预判R:R - 1) × 100%`

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:167-191 | 计算实际 R 与预判 R 的比值偏差 | ✅ |

**结论：** ✅ 定义准确

---

### 2.8 目标达成率 (Target Rate)

**定义：** `目标达成率 = 触及目标价的笔数 ÷ 有目标价的笔数 × 100%`

| 模块 | 实现 | 状态 |
|------|------|------|
| stats.js:135-155 | 检查 `closePrice >= targetPrice` (long) 或 `closePrice <= targetPrice` (short) | ✅ |

**结论：** ✅ 定义准确

---

## 三、图表维度定义验证

### 3.1 策略绩效 (Strategy Performance)

**分组键：** `strategyFramework + '|' + strategyPattern`

| 模块 | 实现 | 状态 |
|------|------|------|
| analytics.js `groupByStrategy()` | framework + patternName | ✅ |
| stats.js `renderStrategyBreakdown()` | 仅按 framework 分组 | ⚠️ 口径不一致 |

**问题：**
- analytics.js 按「框架+形态」双维度分组
- stats.js 按「框架」单维度分组
- 两者统计口径不一致

**建议：** 统一为双维度分组，或在 stats.js 中增加形态维度

---

### 3.2 形态绩效 (Pattern Performance)

**分组键：** `extractPatternName(strategyPattern)`

| 模块 | 实现 | 状态 |
|------|------|------|
| analytics.js `groupByPattern()` | 提取完整形态名，样本<2归入"其他" | ✅ |

**结论：** ✅ 定义准确，"其他"分组逻辑合理

---

### 3.3 交易时段 (Session)

**分组键：** `session` 字段

| 模块 | 实现 | 状态 |
|------|------|------|
| analytics.js `renderSessionChart()` | asia/europe/us/overlap/allday/未标记 | ✅ |

**结论：** ✅ 定义准确

---

### 3.4 周几分布 (Day of Week)

**分组键：** 周一=0, 周日=6

| 模块 | 实现 | 状态 |
|------|------|------|
| analytics.js `renderDayOfWeekChart()` | `dow === 0 ? 6 : dow - 1` | ✅ |

**结论：** ✅ 定义准确（周一从0开始）

---

### 3.5 持仓时长分布 (Hold Duration)

**分箱规则：**
| 区间 | 定义 | 状态 |
|------|------|------|
| <15m | 0 ≤ duration < 15 | ✅ |
| 15m-1h | 15 ≤ duration < 60 | ✅ |
| 1h-4h | 60 ≤ duration < 240 | ✅ |
| 4h-12h | 240 ≤ duration < 720 | ✅ |
| 12h-1d | 720 ≤ duration < 1440 | ✅ |
| >1d | duration ≥ 1440 | ✅ |

**结论：** ✅ 定义准确，分箱合理

---

### 3.6 MAE/MFE 散点图

**定义：**
- MAE = Max Adverse Excursion（最大浮亏百分比）
- MFE = Max Favorable Excursion（最大浮盈百分比）

| 模块 | 实现 | 状态 |
|------|------|------|
| analytics.js `renderMAEMFEScatter()` | x = \|MAE\|, y = MFE | ✅ |
| 理想区域 | MAE < 5% 且 MFE > 5% | ✅ |

**结论：** ✅ 定义准确

---

### 3.7 平仓类型分布 (Close Type)

**分类：**
| 类型 | 定义 | 状态 |
|------|------|------|
| 盈利 | initialTP, manualWin, partialTP | ✅ |
| 亏损 | initialSL, trailingSL, manualLoss, liquidation, timeStop | ✅ |
| 其他 | 未标记或其他 | ✅ |

**结论：** ✅ 定义准确

---

### 3.8 多维拆解 (Dimension Breakdown)

**维度：** 品种(symbol)、方向(direction)、交易时段(session)

| 模块 | 实现 | 状态 |
|------|------|------|
| analytics.js `renderDimensionBreakdown()` | 三维度独立统计 | ✅ |

**结论：** ✅ 定义准确

---

## 四、口径不一致问题汇总

### 🔴 严重问题

**无**

---

### 🟡 中等问题

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 1 | stats.js vs analytics.js | 策略分组口径不一致（单维度 vs 双维度） | 统一为双维度 |
| 2 | stats.js:76 vs :412 | 盈亏比计算口径不一致（总金额比 vs 平均金额比） | 统一为平均金额比 |

---

### 🟢 轻微问题

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 1 | stats.js:158-163 | 均实际R:R依赖用户手动记录 | 考虑自动计算 |
| 2 | analytics.js | "其他(单笔形态)"分组逻辑未说明 | 增加tooltip说明 |

---

## 五、缺失的统计维度

### 建议补充

| 维度 | 用途 | 优先级 |
|------|------|--------|
| **月度胜率趋势** | 观察胜率稳定性 | 高 |
| **盈亏比月度趋势** | 观察R:R稳定性 | 高 |
| **连赢/连亏分布** | 识别情绪周期 | 中 |
| **品种集中度变化** | 监控风险敞口 | 中 |
| **R:R预测偏差趋势** | 验证预判准确性 | 中 |
| **心态评分与绩效关联** | 验证心态影响 | 低 |

---

## 六、验证清单

```
✅ 已平仓交易判定标准统一
✅ 时序数据排序一致
✅ 胜率定义准确且口径一致
✅ 期望值定义准确且口径一致
✅ 利润因子定义准确
✅ 最大回撤定义准确且计算一致
✅ 目标达成率定义准确
✅ 预判偏差定义准确
✅ MAE/MFE定义准确
✅ 平仓类型分类准确
✅ 多维拆解维度定义准确
⚠️  策略分组口径不一致（analytics vs stats）
⚠️  盈亏比计算口径不一致（总金额比 vs 平均金额比）
```

---

## 七、结论

**整体评价：B+**

- ✅ 核心指标定义准确，口径基本一致
- ✅ 数据源统一，排序逻辑一致
- ⚠️ 策略分组口径存在不一致（小问题）
- ⚠️ 盈亏比计算口径存在差异（需确认）

**建议优先修复：**
1. 统一策略分组口径（analytics 和 stats 都使用双维度）
2. 统一盈亏比计算口径（建议使用平均金额比，更直观）

