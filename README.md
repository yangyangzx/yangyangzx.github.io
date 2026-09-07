# TradingDiscipline · 交易风险管理终端

**纯前端期货/合约交易风控与复盘工具 · v5.0-beta**

面向加密货币/合约交易者的全流程交易管理系统：开仓前计算 → 持仓监控 → 平仓记录 → 统计分析 → 复盘优化。所有数据本地存储（`localStorage`），完全离线运行，无构建工具，双击 `index.html` 即可使用。

---

## 一、功能总览

| 模块 | 入口 | 核心职责 |
|------|------|----------|
| **仪表盘** | `#dashboard` | 今日盈亏、本周胜率、在仓风险、当日连亏、强平预警、资金曲线 |
| **开仓计划** | `#planner` | 仓位计算、分批建仓、多止盈规划、盈亏比反推、检查清单 |
| **交易日志** | `#journal` | 开/平仓全生命周期记录、批量操作、筛选、编辑 |
| **风控中心** | `#risk` | 账户概览、日亏损、回撤、强平距离、集中度、杠杆分布、频率、组合热量 |
| **统计分析** | `#analytics` | 胜率/期望/利润因子/R 倍数/成本侵蚀、权益曲线、多维图表 |
| **复盘中心** | `#review` | 亏损原因、策略排名、执行质量、情绪关联、入场原因、市场环境 |
| **系统设置** | `#settings` | 风控参数、品种管理、数据导入导出、设置备份 |

**技术栈**：原生 HTML5 + CSS3（CSS 变量/OKLCH）+ 原生 JavaScript（IIFE 模块模式）+ Chart.js 4.4.0（CDN）+ Font Awesome。

---

## 二、核心计算逻辑

### 1. 开仓计算管线（`calculator.js`）

输入：品种、方向、入场价、止损价、杠杆、本金、风险比例、订单类型。计算顺序（每一层都可能截断仓位）：

```
① 有效入场价 = 入场价 ± 滑点偏移（滑点 = ticks × tickSize，按订单类型默认）
② 止损距离   = |有效入场价 − 止损价|（ATR 模式 = ATR × 倍数）
③ 风险金额   = 本金 × 风险比例
   ├─ 凯利驱动（kellyEnableCalc 勾选）：风险金额 = 本金 × 半凯利比例（须 ≥10 笔样本）
   ├─ 凯利期望为负 → 硬阻断，不开仓
   └─ 杠杆上限：凯利比例 ≤ 5% ÷ 杠杆
④ 名义仓位 positionSize（USDT）= 风险金额 × 入场价 ÷ 止损距离
⑤ 保证金 margin = positionSize ÷ 杠杆（现货 leverage=0：保证金 = positionSize）
⑥ 逐层硬上限截断：
   ├─ 保证金 ≤ 本金 80%（单笔）
   ├─ 交易所仓位上限（兜底）
   ├─ 总保证金（已有 + 新增）≤ 本金 90%（聚合）
   └─ 单品种保证金 ≤ 本金 × singleSymbolMaxPct（默认 30%）
⑦ 止损必须在强平价之外（long: SL > LP；short: SL < LP），否则硬阻断
⑧ 组合热量（全部持仓风险之和）> riskHeatMax → 熔断禁开新仓
```

截断后按实际仓位反推实际风险额；所有提示与结果卡片用**截断后**数值（口径一致）。

### 2. 关键公式

```
名义仓位      = 风险金额 × 入场价 ÷ 止损距离          （USDT）
保证金        = 名义仓位 ÷ 杠杆                        （现货 = 仓位本身）
止损距离      = |有效入场价 − 止损价|
风险额        = 名义仓位 × 止损距离 ÷ 入场价
强平价(多)    = 入场价 × (1 − 1/杠杆 + MMR) / (1 − MMR)
强平价(空)    = 入场价 × (1 + 1/杠杆 − MMR) / (1 + MMR)
盈亏比(单档)  = (目标价 − 入场价) ÷ 止损距离，净盈亏比扣除往返手续费
R 倍数        = 净盈亏 ÷ 初始风险额（initialRiskAmount）
期望值        = 胜率 × 平均盈利 − 败率 × 平均亏损      （胜率分母含保本）
利润因子      = 总盈利 ÷ 总亏损绝对值
成本侵蚀      = Σ手续费 ÷ Σ毛盈亏                       （部分平仓链取 realizedFee 累计）
```

### 3. 凯利公式（`skills-integration.js`）

```
Kelly% = (胜率 × 平均盈利 − 败率 × 平均亏损) ÷ 平均盈利
半凯利 = Kelly% × 0.5                    （实践标准，UI 默认展示半凯利）
上限   = 5% ÷ 杠杆                        （杠杆感知：有效风险 ≤ 5%）
```

- 统计输入自动从**同策略框架**已平仓日志计算（`calcKellyStatsFromLogs`），保本计入胜率分母；
- 样本门槛：<10 笔不驱动仓位（仅参考）、<30 笔显示"样本有限"徽标；
- 手动修改凯利三字段会清除样本背书（避免被历史数据误拦截）；
- 期望为负（Kelly% ≤ 0）→ 硬阻断不开仓。

### 4. ATR 动态止损（`skills-integration.js`）

```
止损距离 = ATR × multiplier（默认 2.0）
止损价   = 入场价 − 止损距离（多） / 入场价 + 止损距离（空）
```

- ATR 计算结果写入 `calc.stopDistance`，下游反推止盈位/盈亏比/仓位全部复用；
- 手动止损与 ATR 参考距离对比：比值 >2 提示"过宽"、<0.5 提示"过紧"（校验提示，不阻断）；
- ATR 模式参与保存（`formAtrStopEnabled` 进入一致性校验快照）。

### 5. 多止盈规划（`planner.js`）

- TP1/TP2/TP3 价格 = 入场价 ± 止损距离 × tpRRs[i]（默认 [1.5, 2.0, 3.0]，可在设置修改）；
- 每档实际盈亏比按**反推原始仓位**计算（BUG-10：不被截断后仓位污染）并扣除该档往返手续费；
- 组合加权期望 R：Σ(档比例 × 档净盈) − 剩余仓位按止损路径计；比例 >100% 提示超限；
- 加权期望 ≥ minRRRatio 才通过检查清单第 12 项。

### 6. 部分平仓生命周期（`logs.js` / `modals.js`）

```
开仓(initialPositionSize/initialRiskAmount/initialMargin)
  └→ 部分平仓(partialTP/reducePosition)   → 生成 closes 条目 + realizedPnl + closedRatio
      └→ 再次部分平仓 → closes 追加
          └→ 最终平仓(positionSize=0)      → 整笔 pnlAmount 含全部已实现盈亏，realizedFee 累计
```

- `isClosedTrade` 判定：closeType 非空且 pnlAmount 可解析——**部分平仓中间态不算已平仓**（继续计入在仓风险/保证金）；
- 编辑中间态记录时**不自动重算结算**（`_partialChain` 跳过），编辑最终态跳过自动结算（positionSize≤0），避免口径覆盖；
- R 倍数以**初始风险额**为基准（`initialRiskAmount`），全链一致；
- CSV 导出/导入完整保留 closes/realizedPnl/realizedFee/closedRatio/initialRiskAmount/initialPositionSize/isPartial（2026-09 修复）。

### 7. 统计口径（全站统一）

- **胜率分母** = 全部已平仓（**保本计入分母**），仪表盘/统计/复盘/凯利/期望值一致；
- **日口径**：统一 `toLocalDateStr`（本地时区）；日亏损、连亏、今日盈亏、频率监控全部按本地日期；
- **当日连亏**：`_getTodayLossStreak` 唯一实现（当日、无重复计数），仪表盘与风控共用；
- **成本侵蚀**：Σ手续费优先取 `realizedFee`（部分平仓链累计），无则回退 `item.fee` 兼容旧数据；
- **权益曲线**：`calcEquityCurve` 按平仓时间连续累加 pnlAmount，回撤不吃资金快照。

### 8. 风控四道防线

| 防线 | 机制 | 触发 |
|------|------|------|
| ① 计划阻断 | 计算器硬阻断 | 止损穿越强平 / 期望为负 / 保证金不足 |
| ② 检查清单 | 12 项开仓前检查 | 风险/止损/强平/连亏/盈亏比/保证金/理由/日亏/心态/热量/集中度/多止盈 |
| ③ 持仓熔断 | 组合热量 + 日亏损 + 连亏 | 热量 > riskHeatMax / 日亏超限 / 连亏 ≥3 |
| ④ 事后监控 | 风控中心 + 仪表盘 | 强平预警 / 集中度告警 / 回撤告警 |

---

## 三、系统设置（`settings.js`，localStorage key `trade_settings_v1`）

| 参数 | 默认 | 说明 |
|------|------|------|
| 账户余额 | 0 | 日亏损上限/热量/集中度的本金基准 |
| 单笔风险比例 | 2% | 计算器默认风险 |
| 日亏损上限 | 5% | 当日亏损严格超过（不含等于）才熔断 |
| 最大回撤告警 | 20% | 回撤监控告警线 |
| 最低盈亏比 | 2 | 检查清单第 5/12 项基准 |
| 单品种最大占比 | **30%** | 集中度上限（风控中心阈值读此值） |
| 组合热量安全上限 | 6% | 超过禁开新仓（熔断） |
| 组合热量上限 | 8% | 接近告警线 |
| 维持保证金率 MMR | 0.5% | 强平价公式参数 |
| 默认杠杆 | 10 | 开仓计划杠杆默认值 |
| ATR 动态止损 / 倍数 | 关 / 2.0 | ATR 止损开关与默认倍数 |
| 心态评分最低通过 | 3 | 心态检查项 |
| 日最大交易笔数 | 8 | 频率监控 |
| 品种自定义止损比例 | `{}` | 如 `{"ETH":2,"BTC":3}`，留空用默认（ETH 2% / 其他 3%） |
| 多止盈默认盈亏比 | [1.5, 2.0, 3.0] | TP1/2/3 自动填充 |
| 品种管理 | BTC/ETH/SOL/GOLD | 自定义下拉列表 |

---

## 四、数据存储

| Key | 内容 |
|-----|------|
| `trade_logs_plus_v4` | 交易日志数组（SCHEMA_VERSION=4：入场原因标准化、执行评分 0→null、滑点快照） |
| `trade_settings_v1` | 设置对象 |
| `trade_backup_auto_index` | 自动备份轮转索引 |

- 自动备份：保存时轮转（`storage.js`，默认保留 10 份）；
- 导入：JSON（全量字段）/ CSV（中文表头，含部分平仓链字段）；导入前数值归一化 + Schema 迁移；
- 导出：JSON / CSV 双向，滑点以 ticks 快照保存（`slippage.js`），绝不从旧成本反推 ticks。

---

## 五、项目结构

```
notes/
├── index.html              入口（加载 24 个 JS + Chart.js CDN）
├── css/                    12 个样式文件（变量/布局/各模块）
├── js/
│   ├── constants.js        全局状态与常量（STORAGE_KEY、选项表）
│   ├── utils.js            日期/判定/强平价/权益曲线（权威实现）
│   ├── slippage.js         滑点领域模型（ticks → 成交价 → 成本）
│   ├── storage.js          加载/保存/迁移/自动备份/容量监控
│   ├── skills-integration.js  凯利/ATR/集中度/热量/日亏熔断/频率
│   ├── calculation-ui.js   计算器 UI 状态渲染
│   ├── calculator.js       开仓计算管线（~1750 行，核心）
│   ├── planner.js          开仓计划：多止盈/反推/12 项检查清单
│   ├── logs.js             平仓生命周期（结算单一入口）
│   ├── rendering.js        日志列表渲染
│   ├── modals.js           编辑/平仓/拆分面板
│   ├── stats.js            统计聚合（胜率/期望/成本侵蚀/连亏）
│   ├── analytics.js        统计分析图表（日/周/月/心态/市场环境）
│   ├── risk.js             风控中心七张卡片
│   ├── dashboard.js        仪表盘六卡片
│   ├── review.js           复盘中心六图表
│   ├── settings.js         系统设置 + CSV/JSON 导入
│   ├── io.js               CSV 导出 + JSON 导入校验
│   ├── navigation.js       视图切换
│   ├── chart-factory.js    图表配置模板
│   ├── dom-cache.js        DOM 缓存
│   ├── app.js              事件绑定/主题/初始化
│   ├── toast.js            轻提示
│   └── version.js          版本号
├── test/run-tests.html     浏览器内回归测试（31 断言，打开即跑）
└── assets/ img/            图标与资源
```

加载顺序即依赖顺序：`constants → utils → toast → slippage → storage → skills-integration → calculation-ui → calculator → logs → rendering → stats → modals → navigation → dashboard → planner → settings → risk → chart-factory → analytics → review → io → dom-cache → app → version`。

---

## 六、测试与验证

- **浏览器内回归**：打开 `test/run-tests.html` 自动运行 31 条断言（平仓三态、凯利链、集中度、一致性门等）；
- 修改 JS 后建议：`node --check js/<file>.js` 语法检查 → 浏览器强刷（URL 追加 `?cb=<时间戳>` 避开缓存）→ 关键链路 E2E。

---

## 七、设计原则

1. **风险控制优先**：所有计算以"先定风险、再定仓位"为纲，逐层截断只减仓不加仓；
2. **单一事实来源**：已平仓判定/胜率分母/强平价/本地日期等关键口径全站唯一实现；
3. **数据可复算**：滑点、止损、风险额均保存完整快照，历史日志可回溯复算；
4. **本地隐私**：数据不出浏览器，无任何网络上传。

---

## 八、免责声明

> 本系统仅为辅助工具，不构成任何投资建议。期货/合约交易存在重大风险，可能导致全部本金损失。请交易者根据自身情况谨慎决策，自负盈亏。

MIT License · 2026 TradingDiscipline
