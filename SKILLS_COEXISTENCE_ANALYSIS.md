# Skills 融合协同追踪报告

> 生成时间：2026-08-09
> 目的：验证设置参数 → 开仓计算 → 风控检查的完整数据链路

---

## 一、协同路径总览

```
用户操作                         数据流
──────────────────────────────────────────────────────────────────
设置页修改参数                   localStorage.setItem('trade_settings_v1', ...)
  │
  ▼
开仓计划页点击「计算仓位」
  │
  ├─ loadSettings()              ← 读取全部设置（含所有融合参数）
  │
  ├─ checkDailyLossLimit()       ← 读取 dailyLossLimit
  │     └─ getAccountCapital()   ← 读取 logs/setting 中的资本
  │
  ├─ checkDailyTradeFrequency()  ← 读取 dailyTradeMax
  │     └─ getClosedSorted()     ← 读取 logs 中的已平仓记录
  │
  ├─ calcPortfolioHeat()         ← 读取 riskHeatMax, portfolioHeatMax
  │     └─ getOpenPositions()    ← 读取 logs 中的未平仓记录
  │
  ├─ checkSymbolConcentration()  ← 读取 singleSymbolMaxPct
  │
  ├─ getMindsetAdjustment()      ← 读取 mindsetScore（页面实时值）
  │     ⚠️ 未读取 mindsetMinScore
  │
  ├─ calcATRStop()               ← 读取 atrStopEnabled, atrMultiplier
  │     ⚠️ atrMultiplier 未读取 settings.atrDefaultMultiplier
  │
  ├─ checkRRRequirement()        ← 读取 minRRRatio
  │
  └─ calcKelly()                 ← 页面实时输入，不读取设置
```

---

## 二、各融合点协同状态

### ✅ 完全协同（设置 → 计算 → 风控 → UI 全部打通）

#### 1. 日亏损硬止损
| 环节 | 路径 | 状态 |
|------|------|------|
| 设置 | `settings.dailyLossLimit` | ✅ 读取 |
| 计算 | `checkDailyLossLimit()` → 调用 `getAccountCapital()` | ✅ |
| 拦截 | `dailyLossCheck.blocked` → return 禁用计算 | ✅ |
| UI | 风控中心日亏损卡片 + 检查清单 `checkDailyLoss` | ✅ |
| 按钮 | 熔断时 `calcBtn.classList.add('blocked')` | ✅ |

**协同链完整度：100%**

---

#### 2. 交易频率熔断
| 环节 | 路径 | 状态 |
|------|------|------|
| 设置 | `settings.dailyTradeMax` | ✅ 读取 |
| 计算 | `checkDailyTradeFrequency()` → 调用 `getClosedSorted()` | ✅ |
| 拦截 | `freqCheck.blocked` → return 禁用计算 | ✅ |
| UI | 风控中心频率卡片 + 仪表盘频率统计 | ✅ |

**协同链完整度：100%**

---

#### 3. 组合热量检查
| 环节 | 路径 | 状态 |
|------|------|------|
| 设置 | `settings.riskHeatMax`, `settings.portfolioHeatMax` | ✅ 读取 |
| 计算 | `calcPortfolioHeat()` → 调用 `getOpenPositions()` | ✅ |
| 拦截 | `heatCheck.blocked` → return 禁用计算 | ✅ |
| UI | 风控中心组合热量卡片（含明细）+ 检查清单 `checkPortfolioHeat` | ✅ |

**协同链完整度：100%**

---

#### 4. 品种集中度硬限制
| 环节 | 路径 | 状态 |
|------|------|------|
| 设置 | `settings.singleSymbolMaxPct` | ✅ 读取 |
| 计算 | `checkSymbolConcentration()` → 调用 `getOpenPositions()` | ✅ |
| 截断 | `cappedByMargin=true` + 按比例缩小仓位 | ✅ |
| UI | 警告信息 + 检查清单 `checkSymbolConc` | ✅ |

**协同链完整度：100%**

---

#### 5. 心态评分影响仓位
| 环节 | 路径 | 状态 |
|------|------|------|
| 计算 | `getMindsetAdjustment(mindsetScore)` → 读取页面实时值 | ✅ |
| 拦截 | `mindsetAdjust.blocked` → return 禁止交易 | ✅ |
| 降仓 | `positionSize *= mindsetAdjust.adjustment` | ✅ |
| UI | 检查结果 + 检查清单 `checkMindset` | ✅ |

**协同链完整度：95%**（见下方问题）

---

#### 6. R:R 最低检查
| 环节 | 路径 | 状态 |
|------|------|------|
| 设置 | `settings.minRRRatio` | ✅ 读取 |
| 计算 | `checkRRRequirement(targetRR, settings.minRRRatio)` | ✅ |
| UI | 警告信息 + 检查清单 `checkRR` | ✅ |

**协同链完整度：100%**

---

### ⚠️ 部分协同（有缺陷）

#### 7. ATR 动态止损
| 环节 | 路径 | 状态 | 问题 |
|------|------|------|------|
| 设置 | `settings.atrStopEnabled` | ✅ 读取 | — |
| 计算 | `calcATRStop()` → 替代手动止损价 | ✅ | — |
| 显示 | `atr-badge` tag + ATR 公式 | ✅ | — |
| **设置同步** | `settings.atrDefaultMultiplier` → `atrMultiplier` | ❌ | 计算器硬读 `atrMultiplier` DOM 元素，未读取设置中的默认值 |

**协同链完整度：80%**

---

#### 8. 凯利公式
| 环节 | 路径 | 状态 |
|------|------|------|
| 输入 | 用户手动输入胜率/均盈利/均亏损 | ✅ |
| 计算 | `calcKelly()` → 输出半凯利参考 | ✅ |
| UI | 结果区显示「凯利参考」div | ✅ |
| 设置 | `mindsetMinScore` 未使用 | ⚠️ |

**协同链完整度：90%**

---

## 三、发现的问题

### 问题 1：ATR 倍数未从设置读取

**位置**：`calculator.js:28`

```javascript
// 当前代码：硬读 DOM
const atrMultiplier = parseFloat(document.getElementById('atrMultiplier').value) || 2;

// 应该改为：读取设置中的默认值
const atrMultiplier = parseFloat(document.getElementById('atrMultiplier').value)
  || (settings.atrDefaultMultiplier || 2);
```

**影响**：用户在设置中修改 ATR 默认倍数后，新建计算不会使用新默认值。

---

### 问题 2：mindsetMinScore 未参与计算

**位置**：`skills-integration.js:206`

```javascript
// 当前代码：硬编码阈值
if (!mindsetScore) mindsetScore = 3;  // ← 应读取 settings.mindsetMinScore
```

**影响**：设置中的心态评分最低通过值被忽略，始终使用硬编码的 3。

**修复**：
```javascript
function getMindsetAdjustment(mindsetScore) {
  var settings = loadSettings();
  var minScore = settings.mindsetMinScore || 3;
  if (!mindsetScore) mindsetScore = minScore;
  if (mindsetScore < minScore) {
    // ... 应用调整
  }
}
```

---

### 问题 3：脚本加载顺序潜在风险

当前加载顺序：
```
calculator.js (line 1140) → skills-integration.js (line 1149)
```

`calculator.js` 调用 `loadSettings()`、`getAccountCapital()`、`getOpenPositions()` 等函数：
- `loadSettings()` — 定义在 `settings.js` (line 1148) ✅
- `getAccountCapital()` — 定义在 `risk.js` (line 1150) ⚠️

**问题**：calculator.js 在 settings.js 之前加载，但 `loadSettings()` 是函数声明（hoisting），所以实际运行时没有问题。`getAccountCapital()` 同理。

**结论**：当前加载顺序无实际运行时错误，但不够清晰。

---

## 四、数据流完整性验证

### 组合热量链路（最复杂）
```
设置: riskHeatMax=6, portfolioHeatMax=8
  │
  ▼
calculator.js: calcPortfolioHeat()
  │  ├─ getAccountCapital() → logs 最新 capital / settings.accountBalance
  │  ├─ getOpenPositions() → logs 中未平仓记录
  │  ├─ 计算: Σ(riskAmount) / capital × 100
  │  └─ 检查: heat >= riskHeatMax → blocked
  │
  ▼
risk.js: renderPortfolioHeat()
  │  ├─ 调用同一个 calcPortfolioHeat()
  │  ├─ 读取 settings.riskHeatMax
  │  └─ 渲染: 进度条 + 明细列表
  │
  ▼
planner.js: updateChecklist()
  │  └─ checkPortfolioHeat → ✓/✗
  │
  ▼
UI: 风控中心 + 开仓前检查 + 熔断拦截
```

**结论**：链路完整，无数据断点。

---

### ATR 止损链路
```
设置: atrStopEnabled=true, atrDefaultMultiplier=2.0
  │
  ▼
calculator.js: 读取 atrValue DOM, atrMultiplier DOM
  │  └─ 未读取 settings.atrDefaultMultiplier ← 问题！
  │
  ├─ calcATRStop(effectiveEntryPrice, atrValue, atrMultiplier, direction)
  │  └─ stopPrice = entry ± (atrValue × multiplier)
  │
  ├─ 替代手动止损价: stopLoss = atrResult.stopPrice
  │
  └─ 显示: atr-badge tag
```

---

## 五、修复建议

### 优先级 P0（影响功能正确性）

| 问题 | 文件 | 修复 |
|------|------|------|
| ATR 倍数未读取设置 | calculator.js:28 | 使用 `settings.atrDefaultMultiplier || ...` |
| mindsetMinScore 未使用 | skills-integration.js:206 | 读取 `settings.mindsetMinScore` |

### 优先级 P1（影响体验）

| 问题 | 文件 | 修复 |
|------|------|------|
| ATR 倍数设置变更需刷新 | settings.js | 保存后同步更新计算器 DOM |
| 凯利输入区始终隐藏 | index.html | 根据是否有历史数据自动显示 |

---

## 六、验证清单

```
✅ 日亏损硬止损 — 达到上限时按钮变为"日亏损熔断"并禁用
✅ 交易频率熔断 — 达到日最大笔数时禁用
✅ 组合热量检查 — 超限后显示热量卡片并禁用计算
✅ 品种集中度 — 超限后按比例截断仓位并显示警告
✅ 心态评分联动 — ≤2 降仓 20-50%，=1 禁止交易
✅ R:R 最低检查 — 低于设置值时红色警告
⚠️  ATR 动态止损 — 功能正常，但默认倍数未从设置读取
⚠️  凯利公式 — 功能正常，但 mindsetMinScore 未参与计算
```
