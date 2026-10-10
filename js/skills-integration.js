// ==================== Skills 融合计算模块 ====================
// 融合 position-sizer, risk-management, trading-plan-generator 技能逻辑

/**
 * 计算组合热量（Portfolio Heat）
 * 使用实际止损距离重新计算每笔风险，而非依赖存储的 riskAmount（防止止损调整后低估风险）
 *
 * 口径变更（2026-10-03，v5.6.3）：原先只统计已持久化持仓、不含待开仓位，
 * 「已开持仓已过热就别再加仓」——但 checkSymbolConcentration 一直把本仓算进去，
 * 同一张卡片两层组合口径不对称，「已持仓 5.5% + 本仓 2% > 上限 6%」整类超配漏过。
 * 现改为可选传入本仓风险，闸门（calculator 硬阻断 + planner 软检查）统一用含本仓口径。
 * 不带参数调用（风险面板 renderPortfolioHeat）仍是纯「已持仓」口径，未变。
 */
/**
 * 组合风险（已持仓 + 可选的待开仓位）占本金百分比。
 *
 * 闸门语义必须是「开仓后」口径：只算已持仓会让「已持仓 5.5% + 本仓 2% = 7.5%，
 * 而上限 6%」这一整类超配漏过——同一张卡片里 checkSymbolConcentration 却是把本仓
 * 算进去的，两层口径不对称。软检查（planner）和硬阻断（calculator）都传本仓风险。
 *
 * @param {number} [pendingRiskAmount] 本仓（待开仓位）计划风险 USDT；不传则只算已持仓
 * @param {string} [pendingSymbol]     本仓品种，仅用于明细标记
 * @param {number} [capitalOverride]   本金口径覆盖；不传则用 getAccountCapital()
 * @returns {{heat:number, existingHeat:number, existingRisk:number, planRisk:number,
 *            planPct:number, details:Array, warning:string|null, blocked:boolean}}
 */
/**
 * 单笔持仓的「当前」风险额（唯一权威实现）。
 *
 * 按当前止损价实时重算，不读存档的 riskAmount：止损可以移动（utils.recordStopMove 只
 * 更新 stopLoss 与 stopHistory，从不改 riskAmount），所以 riskAmount 冻结在开仓时那一刻。
 * 移动止损后继续读 riskAmount，仪表盘「总风险」会与组合热量闸门/风控中心相差数倍
 * （止损从 1% 挪到 4% 时是 4 倍），而那张卡还拿热量阈值上色，等于监控面系统性低估敞口。
 * 三个消费方共用本函数，账面与闸门同口径：
 *   - calcPortfolioHeat（硬闸门 + 风控中心）
 *   - dashboard.js「在仓风险」卡
 *   - calculator.js 结果区「组合风险」行
 * 入场价/止损价缺失或非法时退回 riskAmount——那时没有更好的信息，且闸门行为不变。
 *
 * @param {Object} pos 持仓记录
 * @returns {number} 风险额 USDT
 */
function positionCurrentRisk(pos) {
  if (!pos) return 0;
  var entry = parseFloat(pos.effectiveEntryPrice || pos.entryPrice);
  var sl = parseFloat(pos.stopLoss);
  var ps = parseFloat(pos.positionSize) || 0;
  if (Number.isFinite(entry) && entry > 0 && Number.isFinite(sl) && sl > 0 && ps > 0) {
    return Math.abs(entry - sl) / entry * ps;
  }
  return parseFloat(pos.riskAmount) || 0;
}
window.positionCurrentRisk = positionCurrentRisk;


function calcPortfolioHeat(pendingRiskAmount, pendingSymbol, capitalOverride) {
  var openPositions = getOpenPositions();
  // 表单本金可用时优先用它：本仓风险就是按表单本金算出来的，两者必须同一分母，
  // 否则求和口径自相矛盾。账户余额未设置时 getAccountCapital() 为 null，heat 恒为 0，
  // 等于热量检查永久失效。
  var capital = (capitalOverride != null && capitalOverride > 0) ? capitalOverride : getAccountCapital();
  if (!capital || capital <= 0) {
    return { heat: 0, existingHeat: 0, existingRisk: 0, planRisk: 0, planPct: 0, details: [], warning: null, blocked: false };
  }

  var totalRisk = 0;
  var details = [];
  for (var i = 0; i < openPositions.length; i++) {
    var pos = openPositions[i];
    // 按当前止损距离实时重算，不读存档 riskAmount —— 见 positionCurrentRisk。
    var actualRisk = positionCurrentRisk(pos);
    totalRisk += actualRisk;
    details.push({
      symbol: pos.symbol,
      risk: actualRisk,
      pct: capital > 0 ? (actualRisk / capital * 100) : 0
    });
  }

  // 本仓风险并入总热量（只算已持仓会漏掉整类「加上本仓才超限」的情况）
  var planRisk = pendingRiskAmount > 0 ? pendingRiskAmount : 0;
  var planPct = planRisk / capital * 100;
  if (planRisk > 0) {
    details.push({ symbol: pendingSymbol || 'NEW', risk: planRisk, pct: planPct, pending: true });
  }

  var existingHeat = totalRisk / capital * 100;
  var heat = existingHeat + planPct;
  var maxHeat = getHeatHardMax();
  var warning = null;
  var blocked = false;

  if (heat >= maxHeat) {
    blocked = true;
    warning = '组合总风险已达 ' + heat.toFixed(1) + '%（已持仓 ' + existingHeat.toFixed(1)
      + '% + 本仓 ' + planPct.toFixed(1) + '%），超过上限 ' + maxHeat + '%。建议减仓后再开新仓。';
  } else if (heat >= maxHeat * 0.8) {
    warning = '组合总风险 ' + heat.toFixed(1) + '% 接近上限 (' + maxHeat + '%)，注意控制新开仓风险。';
  }

  return {
    heat: heat,
    existingHeat: existingHeat,
    existingRisk: totalRisk,
    planRisk: planRisk,
    planPct: planPct,
    details: details,
    warning: warning,
    blocked: blocked
  };
}

/**
 * 当前账户回撤（唯一权威实现）—— 2026-10-10 新增。
 *
 * 此前 settings.maxDrawdownAlert 的全仓唯一消费点是 risk.js 的卡片着色，
 * 开仓链路（calculator.js / planner.js）一次都没读过它：用户把回撤告警从 20% 调到 5%，
 * 开仓结果与阻断结论纹丝不动，系统事实上不存在回撤熔断。本函数补上这个闸门的数据源。
 *
 * 口径必须与 risk.js 的回撤卡片一致，否则会出现「风控中心显示安全、开仓却提示超限」
 * 这类自相矛盾。故权益曲线一律走 window.utils.calcEquityCurve（统计/分析/仪表盘同源），
 * 兜底路径也与 risk.js 逐行对齐（balanceAdjustment 存取款 + 已实现盈亏累加）。
 *
 * @returns {{drawdownPct:number, drawdownAmount:number, peak:number, equity:number,
 *            capitalKnown:boolean, thresholdPct:number, blocked:boolean}}
 */
function getCurrentDrawdown() {
  var out = { drawdownPct: 0, drawdownAmount: 0, peak: 0, equity: 0,
              capitalKnown: false, thresholdPct: 20, blocked: false };
  var settings = {};
  try { settings = (typeof loadSettings === 'function') ? loadSettings() : {}; } catch (e) { settings = {}; }

  var threshold = Number(settings && settings.maxDrawdownAlert);
  out.thresholdPct = (isFinite(threshold) && threshold > 0) ? threshold : 20;

  var closed = [];
  // 必须用 getClosedSorted()（risk.js 的权威已平仓取数），它已完成
  // isClosedTrade 过滤 + pnlAmount 有效性过滤 + 按平仓时间排序。
  // 不要用 getAllLogs()：全站不存在该函数，用了会让日志永远取不到、
  // 回撤恒为 0，熔断闸门变成永不触发的死代码。
  // 取数失败时 out.readFailed = true，由调用方决定 fail-closed（见 :181 注释）。
  var _readFailed = false;
  try {
    if (typeof getClosedSorted === 'function') closed = getClosedSorted() || [];
    else _readFailed = true;
  } catch (e) { closed = []; _readFailed = true; }
  if (!closed.length) {
    // 兜底：test/run-tests.html 可能只加载部分模块，直接从未过滤的 logs 数组取
    try {
      if (typeof logs !== 'undefined' && logs && logs.length && window.utils
          && typeof window.utils.isClosedTrade === 'function') {
        closed = logs.filter(window.utils.isClosedTrade);
        _readFailed = false;   // 兜底路径取到了数据
      }
    } catch (e2) { closed = []; }
  }

  var capital = 0, equity = 0, peak = 0;
  var curve = null;
  try {
    if (window.utils && typeof window.utils.calcEquityCurve === 'function') {
      curve = window.utils.calcEquityCurve(closed, settings, {});
    }
  } catch (e) { curve = null; }

  if (curve && curve.data && curve.data.length > 0) {
    capital = curve.initCap;
    equity = curve.finalEq;
    peak = curve.peakVal;
  } else {
    try { if (settings && Number(settings.accountBalance) > 0) capital = Number(settings.accountBalance); } catch (e) {}
    if (capital <= 0 && closed.length > 0 && Number(closed[0].capital) > 0) {
      capital = Number(closed[0].capital);
    }
    equity = capital;
    peak = capital;
    for (var i = 0; i < closed.length; i++) {
      var adj = Number(closed[i].balanceAdjustment);
      if (isFinite(adj) && adj !== 0) equity += adj;
      equity += parseFloat(closed[i].pnlAmount) || 0;
      if (equity > peak) peak = equity;
    }
  }

  out.peak = peak;
  out.equity = equity;
  out.capitalKnown = (capital > 0);
  // P0 修复（2026-10-10 深度审计）：回撤闸门此前是 fail-open——
  // getClosedSorted / calcEquityCurve 抛错都被吞成空数据，于是 peak = equity = capital、
  // drawdownPct = 0 → 「从未熔断」。而这只在数据真正损坏时才发生，恰恰是最该拦住的时候。
  // 现把失败状态透出，由 calculator 的闸门按 fail-closed 处理（用户会看到明确提示）。
  out.readFailed = _readFailed;
  out.drawdownAmount = peak - equity;
  out.drawdownPct = peak > 0 ? (out.drawdownAmount / peak) * 100 : 0;
  // 无本金基准（从未设置账户余额且无日志）时不阻断：此时回撤比例无意义，
  // 与 risk.js「capitalKnown 才判超限」的口径一致，避免新用户一开仓就被无依据拦死。
  //
  // P0 修复（2026-10-10 深度审计）：原为单条件 drawdownPct > threshold，
  // 而 risk.js 的回撤卡片用的是双条件（比例 OR 绝对额）。两者不一致时会出现
  // 「风控中心红色告警『超过最大回撤警戒线』、点计算却放行」的自相矛盾
  // （accountBalance 小于历史峰值时绝对额条件更早触发）。此处取双条件与 risk.js 对齐，
  // 且方向是 fail-closed——宁可拦得严，不可两个面板结论相反。
  out.warnThreshold = out.capitalKnown ? capital * (out.thresholdPct / 100) : Infinity;
  out.blocked = out.capitalKnown
    && (out.drawdownPct > out.thresholdPct || out.drawdownAmount > out.warnThreshold);
  return out;
}

/**
 * 组合热量硬上限（%）——唯一权威实现。
 *
 * 2026-10-10 修正：原实现返回 Math.min(riskHeatMax, portfolioHeatMax)，
 * 默认 riskHeatMax=6 < portfolioHeatMax=8，于是用户把「组合热量警告上限」调到 6 以上
 * （合法区间 5~20）的任何值都不产生任何效果——设置项在多数取值下形同虚设，
 * 且代码里根本没有 portfolioHeatMax 的独立警告判定分支，UI 描述「超过此值时发出警告」与实现不符。
 *
 * 现拆成两个语义清晰的权威入口：
 *   getHeatHardMax()   —— 硬熔断阈值，唯一来源 riskHeatMax；
 *   getHeatWarnMax()  —— 警告阈值，唯一来源 heatWarnMax（缺省沿用旧的 portfolioHeatMax）。
 *
 * 2026-10-10 二次修正：硬熔断最初写成 Math.min(riskHeatMax, heatWarnMax)，
 * 于是默认 riskHeatMax=6 / heatWarnMax=8 时硬熔断恒为 6——用户把 riskHeatMax
 * 调到 15 也上不去，因为警告上限（默认 8，默认比riskHeatMax 大）
 * 把它又拉了回来。两项既然语义分离（一个熔断一个警告），
 * 硬熔断就不该再受警告值牵制，只读 riskHeatMax。
 */
function getHeatHardMax() {
  var settings = loadSettings();
  var a = parseFloat(settings.riskHeatMax);
  if (isFinite(a) && a > 0) return a;
  // riskHeatMax 缺失/非法时才退回旧的「取较严者」口径，保住历史行为
  var b = parseFloat(settings.heatWarnMax != null ? settings.heatWarnMax : settings.portfolioHeatMax);
  return (b > 0) ? b : 6;
}

function getHeatWarnMax() {
  var settings = loadSettings();
  var w = parseFloat(settings.heatWarnMax != null ? settings.heatWarnMax : settings.portfolioHeatMax);
  return (w > 0) ? w : 8;
}

/**
 * 品种止损距离上限（%）——唯一权威实现。
 * 自定义设置优先，未配置时回退 ETH 2% / 其余 3%。
 * calculator.js 的色标与硬阻断、planner.js 的检查清单都必须读这里；
 * 边界在两个文件各写一份正是这次失配的来源。
 */
function getStopLimitPct(symbol) {
  var settings = loadSettings();
  var custom = settings.customStopLimit || {};
  var s = String(symbol || '').toUpperCase();
  // 读侧兜底（P1）：customStopLimit 只在校存表单时校验，localStorage 里被手改或
  // 由 importSettings 导入的旧数据会绕过；而且原实现直接 custom[s] != null，
  // {"constructor":1} 会命中 Object.prototype.constructor 返回一个函数。
  // 这里只认「有限数字且在合法区间」，其余一律走内置默认（ETH 2% / 其余 3%）。
  var _v = custom[s];
  if (typeof _v === 'number' && isFinite(_v) && _v > 0) {
    var _r = (typeof CUSTOM_STOP_LIMIT_RANGE !== 'undefined') ? CUSTOM_STOP_LIMIT_RANGE : null;
    if (!_r || (_v >= _r.min && _v <= _r.max)) return _v;
  }
  return (s === 'ETH') ? 2 : 3;
}

/**
 * 计算凯利公式，返回最优仓位比例
 * 
 * 凯利公式：Kelly% = (胜率 × 平均盈利 - 败率 × 平均亏损) / 平均盈利
 * 半凯利 = Kelly% × 0.5（实践标准，降低波动）
 * 
 * @param {number} winRate - 胜率，范围 0-1（如 0.55 表示 55%）
 * @param {number} avgWin - 平均盈利金额（USDT）
 * @param {number} avgLoss - 平均亏损金额（USDT），必须 > 0
 * @param {number} accountSize - 账户本金（USDT）
 * @param {boolean} [halfKelly=true] - 是否使用半凯利
 * @param {number} [leverage=1] - 杠杆倍数（默认 1x 现货）
 * @returns {KellyResult|null} 凯利计算结果，策略期望为负时返回 null
 * 
 * @typedef {Object} KellyResult
 * @property {number} kellyPct - 完整凯利比例（已截断到 5%/杠杆上限）
 * @property {number} halfKellyPct - 半凯利比例（已截断到 5%/杠杆上限）
 * @property {number} kellyRiskAmount - 完整凯利建议风险金额 = accountSize × kellyPct（USDT）
 * @property {number} halfKellyRiskAmount - 半凯利建议风险金额 = accountSize × halfKellyPct（USDT）
 * @property {number} expectancy - 每笔交易的期望收益（USDT）
 * @property {string} recommendation - 建议文本
 * @property {boolean} kellyCapped - 完整凯利是否被截断
 * @property {boolean} halfKellyCapped - 半凯利是否被截断
 */
// P0-1 修复：三结果凯利。原实现 lossRate = 1 - winRate 把「保本单」当完整亏损，
// 而本站胜率口径是「保本计入分母」（统计页期望值 = (GP-GL)/N 对保本中性）。
// 同一批数据会出现「统计页 +15（正期望）/ 凯利 -5（判策略无价值）」的相反结论，
// 且凯利直接驱动仓位大小。现由调用方传入 breakEvenRate，亏损率按实际笔数比例取。
// 默认 0 保持旧调用行为不变（winRate + lossRate + breakEvenRate = 1）。
function calcKelly(winRate, avgWin, avgLoss, accountSize, halfKelly, leverage, breakEvenRate) {
  if (halfKelly === undefined) halfKelly = true;
  if (leverage === undefined) leverage = 1;
  // P2 边界：avgWin/avgLoss 为 NaN 或 undefined 时无效。
  // P2 FIX（2026-09-23 开仓逻辑审计）：原注释称「avgWin=0 合法，公式仍成立（凯利→0）」不成立——
  // winRate=1,avgWin=0 得 0/0=NaN；winRate=0.5,avgWin=0 得 -Infinity。而下方 `kellyPct < 0`、
  // `halfKellyPct < 0`、以及后续所有比较对 NaN 全为 false，NaN 会穿过全部钳制并污染下游
  //（roundedKelly 变 "NaN%"，与 5%/4.5% 下拉脱节）。与 avgLoss<=0 同权按无效数据处理。
  if (winRate == null || winRate === undefined || isNaN(avgWin) || isNaN(avgLoss) || avgLoss <= 0 || avgWin <= 0) return null;
  if (winRate < 0 || winRate > 1) return null;

  // Kelly 公式：Kelly% = (WR × AvgWin - LR × AvgLoss) / AvgWin
  // P0-1：亏损率 = 亏损笔数占比，不再用 1-WR 把保本单算作亏损。
  var _beRate = (breakEvenRate != null && Number.isFinite(breakEvenRate) && breakEvenRate > 0) ? breakEvenRate : 0;
  var lossRate = Math.max(0, 1 - winRate - _beRate);
  var kellyPct = (winRate * avgWin - lossRate * avgLoss) / avgWin;

  // 半凯利（实践标准）
  var halfKellyPct = kellyPct * 0.5;

  // 确保不出现负值
  if (kellyPct < 0) kellyPct = 0;
  if (halfKellyPct < 0) halfKellyPct = 0;

  // 杠杆感知上限（P1-5 修复）：Kelly% 本身就是「单笔风险占本金比例」，
  // 原实现再 ÷杠杆 会把「风险比例」和「名义敞口」混为一谈——同一策略
  // （wr=0.6/aw=100/al=30，原始半凯利 24%）在 lev=1 建议 5%、lev=10 建议 0.5%、
  // lev=20 建议 0.25%，边际未变而建议风险缩 20 倍；且 lev≥20 时被下拉的
  // Math.max(0.5,...) 抬到 0.5% 而实际执行 0.25%，卡片显示是实际的 2 倍。
  // 现改为：风险比例上限固定 5%；杠杆敞口由下游的保证金/组合热量/单品种占比
  // 三道硬上限独立约束，不再在这里被折叠进风险比例。
  // 风险比例上限取自 settings.kellyRiskLimitPct（原硬编码 5%，2026-10-10 参数化）。
  // 注意与 settings.riskPercent（单笔上限，闸门用）是两个独立参数：前者约束凯利建议值本身，
  // 后者在 calculator.js:397/493 把最终风险比例拦在系统上限内，两者叠加生效。
  var riskLimit = (typeof _getKellyRiskLimitPct === 'function' ? _getKellyRiskLimitPct() : 5) / 100;
  if (!(riskLimit > 0 && riskLimit <= 1)) riskLimit = 0.05;

  var kellyCapped = kellyPct > riskLimit;
  var halfKellyCapped = halfKellyPct > riskLimit;
  kellyPct = Math.min(kellyPct, riskLimit);
  halfKellyPct = Math.min(halfKellyPct, riskLimit);

  // P2-9 FIX：删除无金融含义的 kellyShares（账户×比例÷平均亏损没有推导依据），
  // 改为有明确语义的"凯利建议风险金额"（账户×比例），与 UI 使用的 halfKellyPct×capital 同源
  var kellyRiskAmount = accountSize * kellyPct;
  var halfKellyRiskAmount = accountSize * halfKellyPct;

  var recommendation = '';
  if (kellyPct <= 0) {
    recommendation = '策略期望值为负，不建议使用此策略';
  } else if (halfKellyPct < 0.005) {
    // K1 修复：阈值改为 0.5%（与 riskInput <select> 最小步进一致），避免正常仓位被误标为"极低"
    recommendation = '凯利仓位极低，建议寻找更好的入场机会';
  } else {
    recommendation = '推荐半凯利仓位（更安全）';
  }

  return {
    kellyPct: kellyPct,
    halfKellyPct: halfKellyPct,
    kellyRiskAmount: kellyRiskAmount,
    halfKellyRiskAmount: halfKellyRiskAmount,
    expectancy: winRate * avgWin - lossRate * avgLoss,
    recommendation: recommendation,
    kellyCapped: kellyCapped,
    halfKellyCapped: halfKellyCapped
  };
}

/**
 * 计算 ATR 动态止损距离
 * @param {number} entryPrice - 入场价
 * @param {number} atrValue - ATR 值
 * @param {number} multiplier - ATR 倍数 (默认 2.0)
 * @param {string} direction - 方向 'long' 或 'short'
 * @returns {object} {stopDistance, stopPrice, atrPct}
 */
function calcATRStop(entryPrice, atrValue, multiplier, direction) {
  if (!entryPrice || entryPrice <= 0 || !atrValue || atrValue <= 0) return null;
  var stopDistance = atrValue * multiplier;
  var stopPrice = direction === 'long' ? (entryPrice - stopDistance) : (entryPrice + stopDistance);
  var atrPct = (stopDistance / entryPrice) * 100;
  return { stopDistance: stopDistance, stopPrice: stopPrice, atrPct: atrPct };
}

/**
 * RR 阈值比较（按显示精度对齐）。
 * 盈亏比卡片 / 各行 RR 均用 toFixed(2) 展示，而门原本与未取整的浮点值比较，
 * 于是出现「卡片显示 2.00 : 1、门判 ✗」的同一数值两种结论：
 *  - 反推求解的解自带约 4e-9 浮点残差（实测 1.9999999962 对阈值 2）；
 *  - 任何恰好落在阈值上的手输目标价。
 * 故按显示精度取整后再比较，保证门的结论与用户看到的数字一致。
 * 真实不足不受影响：1.994 仍显示 1.99 并判 ✗，1.95 对 2 仍判 ✗。
 * 三处 RR 门（checkRRRequirement / checkRR 清单项 / checkTPWeighted）共用，避免各自漂移。
 */
function rrMeetsMin(rr, min) {
  return Math.round(rr * 100) / 100 >= min;
}

/**
 * 检查 R:R 是否满足最低要求
 * @param {number} targetRR - 盈亏比
 * @param {number} minRR - 最低要求 (默认 2)
 * @returns {object} {pass, currentRR, minRR, message}
 */
function checkRRRequirement(targetRR, minRR) {
  if (targetRR == null || isNaN(targetRR)) return { pass: false, currentRR: null, minRR: minRR || 2, message: '未设置目标价，无法计算盈亏比' };
  minRR = minRR || 2;
  var pass = rrMeetsMin(targetRR, minRR);
  var message = pass
    ? '盈亏比 ' + targetRR.toFixed(2) + ':1 满足最低要求 (' + minRR + ':1)'
    : '盈亏比 ' + targetRR.toFixed(2) + ':1 不足 ' + minRR + ':1，建议跳过此交易';
  return { pass: pass, currentRR: targetRR, minRR: minRR, message: message };
}

/**
 * 检查品种集中度
 * @param {string} symbol - 品种
 * @param {number} positionSize - 新仓位大小
 * @param {number} leverage - 杠杆
 * @param {number} capital - 账户大小
 * @param {Array} openPositions - 未平仓持仓
 * @param {number} [lookbackDays] - 已平仓历史回看天数（默认 7 天）
 * @returns {object} {pass, currentPct, maxPct, warning}
 */
function checkSymbolConcentration(symbol, positionSize, leverage, capital, openPositions) {
  if (!capital || capital <= 0) {
    return { pass: true, currentPct: 0, maxPct: 30, usedMargin: 0, allowedMargin: 0, allowedNewMargin: 0, warning: null };
  }
  var maxPct = 30;
  try {
    var settings = loadSettings();
    // P0 修复（2026-10-10 深度审计）：原为 `settings.singleSymbolMaxPct || 30`——
    // 非空字符串（如 "abc"）是truthy，会原样穿过||，使下方 totalMargin > NaN 恒false
    // 判pass，集中度闸门静默失效。改走与 risk.js 一致的 Number + isFinite 守卫。
    var _m = Number(settings && settings.singleSymbolMaxPct);
    maxPct = (isFinite(_m) && _m > 0) ? _m : 30;
  } catch(e) { console.error('[concentration]', e); }

  // 集中度衡量的是“当前未平仓风险敞口”；已平仓交易不应持续占用保证金额度。
  var usedMargin = 0;
  for (var i = 0; i < openPositions.length; i++) {
    var pos = openPositions[i];
    if (pos.symbol !== symbol) continue;
    var posLev = parseFloat(pos.leverage) || 1;
    if (posLev <= 0) posLev = 1;
    var posSize = parseFloat(pos.positionSize) || 0;
    if (posSize > 0) usedMargin += posSize / posLev;
  }

  var newLev = Number(leverage) || 1;
  if (newLev <= 0) newLev = 1;
  var newMargin = Math.max(0, Number(positionSize) || 0) / newLev;
  var allowedMargin = capital * (maxPct / 100);
  var allowedNewMargin = Math.max(0, allowedMargin - usedMargin);
  var totalMargin = usedMargin + newMargin;
  var pct = (totalMargin / capital) * 100;
  var warning = null;
  if (totalMargin > allowedMargin) {
    warning = symbol + ' 保证金占比 ' + pct.toFixed(1) + '% 超过上限 ' + maxPct + '%，新增仓位最多还可使用 ' + allowedNewMargin.toFixed(2) + ' USDT 保证金';
  } else if (pct >= maxPct * 0.8) {
    warning = symbol + ' 保证金占比 ' + pct.toFixed(1) + '% 接近上限 ' + maxPct + '%';
  }
  return {
    pass: totalMargin <= allowedMargin,
    currentPct: pct,
    maxPct: maxPct,
    usedMargin: usedMargin,
    newMargin: newMargin,
    allowedMargin: allowedMargin,
    allowedNewMargin: allowedNewMargin,
    warning: warning
  };
}

/**
 * 检查日亏损硬止损
 * @returns {object} {overLimit, todayPnl, limit, blocked}
 */
function checkDailyLossLimit(capitalOverride) {
  var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
  var todayPnl = 0;
  // 统一使用 isClosedTrade 判定已平仓，与 renderLogs/stats.js 口径一致
  var closed = [];
  for (var i = 0; i < logs.length; i++) {
    if (window.utils.isClosedTrade(logs[i])) {
      closed.push(logs[i]);
    }
  }
  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var closeDateStr = window.utils.toLocalDateStr(ct);
    if (closeDateStr === todayStr) {
      todayPnl += parseFloat(closed[i].pnlAmount) || 0;
    }
  }

  var settings = loadSettings();
  // 口径统一：优先用调用方传入的表单本金（与本次计算的风险预算分母一致），
  // 未传入（风控中心/定时巡检等场景）时回退到 settings.accountBalance。
  var capital = (capitalOverride != null && capitalOverride > 0) ? capitalOverride : getAccountCapital();
  var dailyLossPct = Number(settings.dailyLossLimit);
  if (!isFinite(dailyLossPct) || dailyLossPct <= 0) dailyLossPct = 5;
  var dailyLossLimit = capital > 0 ? capital * (dailyLossPct / 100) : Infinity;

  // BUG#5 修复：严格小于才阻断；恰好等于上限时允许继续交易
  var overLimit = todayPnl < -dailyLossLimit;
  return {
    overLimit: overLimit,
    todayPnl: todayPnl,
    limit: dailyLossLimit,
    pctOfLimit: dailyLossLimit > 0 ? (Math.abs(Math.min(todayPnl, 0)) / dailyLossLimit * 100) : 0,
    blocked: overLimit
  };
}

/**
 * 读取当前心态评分（1-5）——唯一权威实现。
 * NaN / 缺失 / <1 视为未评分，回退到最低要求分。
 *
 * 原先四处分读 `parseInt(...) || 3`：默认分 3 是硬编码，与 settings.mindsetMinScore 脱节，
 * 把最低要求调到 4 后「未评分」仍按 3 通过；「未填」和显式 0 也被静默合并成同一个值。
 * 这里统一回退到 minScore，语义是「未评分按临界通过分处理」，与星级控件的默认 3 一致。
 */
function getMindsetScore() {
  var el = document.getElementById('mindsetScore');
  var raw = el ? parseInt(el.value, 10) : NaN;
  var settings = loadSettings();
  var minScore = settings.mindsetMinScore != null ? settings.mindsetMinScore : 3;
  return (Number.isFinite(raw) && raw >= 1) ? raw : minScore;
}

/**
 * 根据心态评分获取仓位调整系数
 * @param {number} mindsetScore - 心态评分 1-5
 * @returns {object} {adjustment, message, blocked}
 */
function getMindsetAdjustment(mindsetScore) {
  var settings = loadSettings();
  var minScore = settings.mindsetMinScore != null ? settings.mindsetMinScore : 3;
  if (!mindsetScore) mindsetScore = minScore;
  if (mindsetScore < minScore) {
    // 低于最低通过值，逐步降仓
    if (mindsetScore === 1) {
      return { adjustment: 0, message: '心态极差，禁止交易', blocked: true };
    } else if (mindsetScore === 2) {
      return { adjustment: 0.5, message: '心态不佳，建议降仓至 50%', blocked: false };
    } else {
      return { adjustment: 0.8, message: '心态不佳，建议降仓至 80%', blocked: false };
    }
  }
  return { adjustment: 1, message: '心态良好，正常仓位', blocked: false };
}

/**
 * 检查今日交易频率
 * @returns {object} {todayCount, maxCount, blocked, suggestion}
 */
function checkDailyTradeFrequency() {
  var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
  var todayCount = 0;
  var seenPlans = {};
  // 以开仓时间统计，未平仓和已平仓计划都必须计入；同一拆分 groupId 只算一次计划。
  for (var i = 0; i < logs.length; i++) {
    var item = logs[i];
    if (!item || !item.time || window.utils.toLocalDateStr(item.time) !== todayStr) continue;
    var key = item.groupId || item.id || ('row_' + i);
    if (seenPlans[key]) continue;
    seenPlans[key] = true;
    todayCount++;
  }

  var settings = loadSettings();
  var maxCount = Number(settings.dailyTradeMax);
  if (!isFinite(maxCount) || maxCount <= 0) maxCount = 8;
  var blocked = todayCount >= maxCount;
  var suggestion = blocked
    ? '今日已开仓 ' + todayCount + ' 笔，达到上限 ' + maxCount + ' 笔，建议停止交易'
    : '今日已开仓 ' + todayCount + ' 笔，建议最多 ' + maxCount + ' 笔';
  return { todayCount: todayCount, maxCount: maxCount, blocked: blocked, suggestion: suggestion };
}

/**
 * 从已平仓日志自动计算凯利所需统计数据
 * 计算：胜率、平均盈利、平均亏损
 * @param {number} minSamples - 最少样本数才启用（默认 5）
 * @returns {object|null} {winRate, avgWin, avgLoss} 或 null（样本不足）
 */
function calcKellyStatsFromLogs(minSamples, strategyFramework, lookbackDays) {
  if (minSamples === undefined) minSamples = 5;
  var closed = getClosedSorted();

  // K5 修复：支持时间窗口过滤
  if (lookbackDays && lookbackDays > 0) {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    closed = closed.filter(function(l) {
      return l.closeTime && new Date(l.closeTime) >= cutoff;
    });
  }

  if (closed.length < minSamples) return null;

  var wins = 0, losses = 0, breakEvens = 0, totalWin = 0, totalLoss = 0;
  for (var i = 0; i < closed.length; i++) {
    var pnl = parseFloat(closed[i].pnlAmount);
    if (isNaN(pnl)) continue;
    // K3 修复：按策略框架隔离统计，避免不同策略混用导致统计数据失真
    if (strategyFramework && closed[i].strategyFramework !== strategyFramework) continue;
    if (pnl > 0) { wins++; totalWin += pnl; }
    else if (pnl < 0) { losses++; totalLoss += Math.abs(pnl); }
    else { breakEvens++; }
  }

  // P1-2 FIX：胜率分母统一为全部已平仓（含保本），与统计页口径一致（凯利输入更保守）
  var totalTrades = wins + losses + breakEvens;
  if (totalTrades < minSamples) return null;

  var winRate = wins / totalTrades;
  var avgWin = totalWin / (wins || 1);
  var avgLoss = totalLoss / (losses || 1);

  return { winRate: winRate, avgWin: avgWin, avgLoss: avgLoss, samples: totalTrades, breakEvenRate: totalTrades > 0 ? (breakEvens / totalTrades) : 0 };
}

/**
 * 自动填充凯利输入字段（从日志计算）
 */
function autoFillKellyFromLogs() {
  try {
    // K3 修复：读取当前策略框架，只从同策略历史交易中计算凯利数据
    var curFramework = document.getElementById('strategyFramework') ? document.getElementById('strategyFramework').value : '';
    var stats = calcKellyStatsFromLogs(5, curFramework || undefined);
    var winRateEl = document.getElementById('kellyWinRate');
    var avgWinEl = document.getElementById('kellyAvgWin');
    var avgLossEl = document.getElementById('kellyAvgLoss');
    var tipEl = document.querySelector('.kelly-tip');
    if (!stats || !winRateEl) {
      return;
    }

    // 仅在字段为空时自动填充
    if (!winRateEl.value || winRateEl.value === '') winRateEl.value = stats.winRate.toFixed(2);
    if (!avgWinEl.value || avgWinEl.value === '') avgWinEl.value = stats.avgWin.toFixed(2);
    if (!avgLossEl.value || avgLossEl.value === '') avgLossEl.value = stats.avgLoss.toFixed(2);

    // 设计优化：样本量元信息挂到 winRate 元素，供 calculate() 组装 kellyData 时读取
    // （小样本凯利是噪音放大器，applyKellyRisk 依据它决定是否驱动仓位）
    winRateEl.dataset.kellySamples = stats.samples;
    // P0-1：同步挂保本率，供 calculate() 传入 calcKelly 的三结果公式；
    // 与 kellySamples 同生命周期（用户手改凯利三字段时一并清除，见 calculator.js dirtyFields 处理）
    winRateEl.dataset.kellyBreakEven = String(stats.breakEvenRate || 0);

    // K3 修复：增加平盘率和样本质量提示
    var tipText = '已从 ' + stats.samples + ' 笔' + (curFramework ? '「' + curFramework + '」策略' : '历史') + '交易自动计算';
    if (stats.breakEvenRate > 0) {
      tipText += '（平盘 ' + (stats.breakEvenRate * 100).toFixed(0) + '%）';
    }
    if (stats.samples < 30) {
      tipText += '；⚠ 样本不足 30 笔，统计参考性有限';
    }
    tipText += '；修改后手动覆盖';
    if (tipEl) tipEl.textContent = tipText;
  } catch(e) { console.error('[skills]', e); }
}

// ==================== 凯利自动填充 ====================
(function _initKellyAutoFill() {
  try {
    // 切换到开仓计划视图时自动填充凯利数据
    var origSwitchView = window.switchView;
    if (origSwitchView) {
      window.switchView = function(viewName) {
        origSwitchView(viewName);
        if (viewName === 'planner') {
          autoFillKellyFromLogs();
        }
      };
    }
    // 注意：首次加载时的自动填充由 navigation.js 中的 loadLogs 后调用
  } catch(e) { console.error('[skills-init]', e); }
})();
