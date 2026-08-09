# P0 分析指标数据诊断报告

## 一、数据流追踪

### 1. mindsetScore（心态评分）

**保存位置：**
- `calculator.js:741` — 开仓时保存
- 默认值：`parseInt(document.getElementById('mindsetScore').value) || 3`

**读取位置：**
- `analytics.js:1521` — `closed[i].mindsetScore`

**数据流：** ✅ 完整
```
用户选择心态星级 → mindsetScore 输入框(value 1-5)
    ↓
calculate() → _lastCalc.mindsetScore
    ↓
saveLog() → log.mindsetScore
    ↓
renderMindsetAnalysis() → closed[i].mindsetScore
```

---

### 2. executionScore（执行评分）

**保存位置：**
- `calculator.js:754` — 开仓时初始化为 `null`
- `logs.js:139` — 平仓时保存：`logs[idx].executionScore = execChecks.querySelectorAll('input[type="checkbox"]:checked').length`

**读取位置：**
- `review.js:532` — `closed[i].executionScore`

**数据流：** ⚠️ 需要平仓后才会有数据
```
开仓 → executionScore: null
    ↓
平仓 → cpExecChecks checkboxes → executionScore (0-3)
    ↓
renderExecutionQuality() → closed[i].executionScore
```

**问题：** 如果用户没有填写执行分（复选框），executionScore = 0，会被过滤掉（`es < 1`）

---

### 3. marketCondition（市场环境）

**保存位置：**
- `calculator.js:746` — 开仓时保存
- 默认值：`document.getElementById('marketCondition').value || ''`（空字符串）

**读取位置：**
- `analytics.js:1733` — `closed[i].marketCondition`

**数据流：** ✅ 完整
```
用户选择市场环境 → tradeSession/marketCondition 下拉框
    ↓
calculate() → _lastCalc.marketCondition
    ↓
saveLog() → log.marketCondition（可能为空字符串）
    ↓
renderMarketConditionAnalysis() → closed[i].marketCondition || '未标记'
```

---

## 二、可能导致数据缺失的原因

### 原因 1：日志为空
**检查：** 用户是否有已平仓的交易记录？

**验证方法：**
```javascript
// 在浏览器控制台执行
var closed = getClosedSorted();
console.log('已平仓交易数:', closed.length);
console.log('有 mindsetScore:', closed.filter(l => l.mindsetScore != null).length);
console.log('有 executionScore:', closed.filter(l => l.executionScore != null && l.executionScore > 0).length);
console.log('有 marketCondition:', closed.filter(l => l.marketCondition && l.marketCondition !== '未标记').length);
```

---

### 原因 2：executionScore 过滤逻辑过严
**当前代码：**
```javascript
var es = closed[i].executionScore;
if (es == null || es < 1 || es > 3) continue;  // 跳过 executionScore = 0 的
```

**问题：** executionScore = 0 表示"未评分"，但执行质量分析应该也能显示这些交易。

**建议：** 修改过滤条件，允许 0 分显示：
```javascript
if (es == null || es < 0 || es > 3) continue;
```

---

### 原因 3：getClosedSorted 过滤条件过严
**当前代码：**
```javascript
if (logs[i].closeType && logs[i].pnlAmount != null && !isNaN(parseFloat(logs[i].pnlAmount)))
```

**问题：** 如果 pnlAmount 为 0（保本交易），会被正确包含。但如果 closeType 为空字符串，会被排除。

**验证：** 检查日志中的 closeType 字段是否正确保存。

---

## 三、修复建议

### 修复 1：放宽 executionScore 过滤条件

**文件：** `review.js:533`

**当前代码：**
```javascript
if (es == null || es < 1 || es > 3) continue;
```

**修复后：**
```javascript
if (es == null || es < 0 || es > 3) continue;
```

**影响：** 显示 executionScore = 0 的交易（未评分）

---

### 修复 2：添加数据诊断工具

在浏览器控制台添加诊断命令，帮助用户检查数据：

```javascript
// 在 app.js 或 navigation.js 中添加
window.debugAnalysisData = function() {
  var closed = getClosedSorted();
  console.log('=== P0 分析数据诊断 ===');
  console.log('已平仓交易总数:', closed.length);
  console.log('有 mindsetScore:', closed.filter(l => l.mindsetScore != null).length);
  console.log('有 executionScore (>0):', closed.filter(l => l.executionScore != null && l.executionScore > 0).length);
  console.log('有 marketCondition:', closed.filter(l => l.marketCondition && l.marketCondition !== '未标记').length);
  console.log('有 session:', closed.filter(l => l.session && l.session !== '未标记').length);
  
  // 显示 sample
  if (closed.length > 0) {
    console.log('Sample log:', JSON.stringify(closed[0], null, 2));
  }
};
```

---

### 修复 3：改进空状态提示

当前空状态提示过于简单，建议提供更详细的诊断信息：

```javascript
// 修改 renderMindsetAnalysis 的空状态提示
if (keys.length === 0) {
  var totalClosed = closed.length;
  var withMindset = closed.filter(l => l.mindsetScore != null).length;
  var msg = '暂无心态评分数据';
  if (totalClosed > 0) {
    msg += '（共 ' + totalClosed + ' 笔已平仓，其中 ' + withMindset + ' 笔有心态评分）';
  } else {
    msg += '请先完成至少一笔交易并记录心态评分';
  }
  _setCanvasEmpty(canvas, 'fa-brain', msg);
  // ...
}
```

