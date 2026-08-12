// ==================== Skills 融合计算模块 ====================
// 融合 position-sizer, risk-management, trading-plan-generator 技能逻辑

/**
 * 计算组合热量（Portfolio Heat）
 * 返回当前未平仓持仓的总风险占比百分比
 * 使用实际止损距离重新计算每笔风险，而非依赖存储的 riskAmount（防止止损调整后低估风险）
 */
function calcPortfolioHeat() {
  var openPositions = getOpenPositions();
  var capital = getAccountCapital();
  if (!capital || capital <= 0) return { heat: 0, details: [], warning: null, blocked: false };

  var totalRisk = 0;
  var details = [];
  for (var i = 0; i < openPositions.length; i++) {
    var pos = openPositions[i];
    // 优先使用实际止损距离计算风险：|入场价 - 止损价| / 入场价 × 仓位
    var actualRisk = 0;
    var entry = parseFloat(pos.effectiveEntryPrice || pos.entryPrice);
    var sl = parseFloat(pos.stopLoss);
    var ps = parseFloat(pos.positionSize) || 0;
    if (!isNaN(entry) && entry > 0 && !isNaN(sl) && sl > 0 && ps > 0) {
      var stopDist = Math.abs(entry - sl);
      actualRisk = stopDist / entry * ps;
    } else {
      // 兜底：使用存储的 riskAmount
      actualRisk = parseFloat(pos.riskAmount) || 0;
    }
    totalRisk += actualRisk;
    details.push({
      symbol: pos.symbol,
      risk: actualRisk,
      pct: capital > 0 ? (actualRisk / capital * 100) : 0
    });
  }

  var heat = totalRisk / capital * 100;
  var settings = loadSettings();
  var maxHeat = settings.riskHeatMax || 6;
  var warning = null;
  var blocked = false;

  if (heat >= maxHeat) {
    blocked = true;
    warning = '组合热量已达 ' + heat.toFixed(1) + '%，超过安全上限 ' + maxHeat + '%。建议平仓后再开新仓。';
  } else if (heat >= settings.portfolioHeatMax || heat >= maxHeat * 0.8) {
    warning = '组合热量 ' + heat.toFixed(1) + '% 接近上限 (' + maxHeat + '%)，注意控制新开仓风险。';
  }

  return { heat: heat, details: details, warning: warning, blocked: blocked };
}

/**
 * 计算凯利公式仓位
 * @param {number} winRate - 胜率 (0~1)
 * @param {number} avgWin - 平均盈利金额
 * @param {number} avgLoss - 平均亏损金额 (正值)
 * @param {number} accountSize - 账户大小
 * @param {boolean} halfKelly - 是否使用半凯利 (默认 true)
 * @returns {object} {kellyPct, halfKellyPct, kellyShares, recommendation}
 */
function calcKelly(winRate, avgWin, avgLoss, accountSize, halfKelly) {
  if (halfKelly === undefined) halfKelly = true;
  if (winRate == null || winRate === undefined || !avgWin || !avgLoss || avgLoss <= 0) return null;
  if (winRate < 0 || winRate > 1) return null;

  // Kelly 公式：Kelly% = (WR × AvgWin - LR × AvgLoss) / AvgWin
  var lossRate = 1 - winRate;
  var kellyPct = (winRate * avgWin - lossRate * avgLoss) / avgWin;

  // 半凯利（实践标准）
  var halfKellyPct = kellyPct * 0.5;

  // 确保不出现负值
  if (kellyPct < 0) kellyPct = 0;
  if (halfKellyPct < 0) halfKellyPct = 0;

  // 约束到合理范围（不超过 5%）
  var kellyCapped = kellyPct > 0.05;
  var halfKellyCapped = halfKellyPct > 0.05;
  kellyPct = Math.min(kellyPct, 0.05);
  halfKellyPct = Math.min(halfKellyPct, 0.05);

  var kellyShares = accountSize * kellyPct / avgLoss;
  var halfKellyShares = accountSize * halfKellyPct / avgLoss;

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
    kellyShares: kellyShares,
    halfKellyShares: halfKellyShares,
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
 * 检查 R:R 是否满足最低要求
 * @param {number} targetRR - 盈亏比
 * @param {number} minRR - 最低要求 (默认 2)
 * @returns {object} {pass, currentRR, minRR, message}
 */
function checkRRRequirement(targetRR, minRR) {
  if (targetRR == null || isNaN(targetRR)) return { pass: false, currentRR: null, minRR: minRR || 2, message: '未设置目标价，无法计算盈亏比' };
  minRR = minRR || 2;
  var pass = targetRR >= minRR;
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
function checkSymbolConcentration(symbol, positionSize, leverage, capital, openPositions, lookbackDays) {
  if (lookbackDays === undefined) lookbackDays = 7;
  if (!capital || capital <= 0) return { pass: true, currentPct: 0, maxPct: 10, warning: null };
  var maxPct = 10; // 默认值
  try {
    var settings = loadSettings();
    maxPct = settings.singleSymbolMaxPct || 10;
  } catch(e) {}

  // 计算该品种的总保证金占比（未平仓）
  var usedMargin = 0;
  for (var i = 0; i < openPositions.length; i++) {
    var pos = openPositions[i];
    if (pos.symbol === symbol) {
      var posLev = parseFloat(pos.leverage) || 1;
      if (posLev <= 0) posLev = 1;
      usedMargin += (parseFloat(pos.positionSize) || 0) / posLev;
    }
  }

  // BUG-5 修复：计入近 N 天内该品种的已平仓交易保证金（防止频繁开平仓绕过集中度检查）
  try {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    var closed = getClosedSorted();
    for (var ci = 0; ci < closed.length; ci++) {
      var cl = closed[ci];
      if (cl.symbol !== symbol) continue;
      var ct = cl.closeTime || cl.time;
      if (!ct) continue;
      if (new Date(ct) < cutoff) continue;
      var clLev = parseFloat(cl.leverage) || 1;
      if (clLev <= 0) clLev = 1;
      usedMargin += (parseFloat(cl.positionSize) || 0) / clLev;
    }
  } catch(e) {}

  // 新增仓位
  var newLev = leverage || 1;
  if (newLev <= 0) newLev = 1;
  var newMargin = positionSize / newLev;
  var totalMargin = usedMargin + newMargin;
  var pct = (totalMargin / capital) * 100;

  var warning = null;
  if (pct >= maxPct) {
    warning = symbol + ' 保证金占比 ' + pct.toFixed(1) + '% 已达上限 ' + maxPct + '%，无法开新仓';
  } else if (pct >= maxPct * 0.8) {
    warning = symbol + ' 保证金占比 ' + pct.toFixed(1) + '% 接近上限 ' + maxPct + '%';
  }

  return { pass: pct < maxPct, currentPct: pct, maxPct: maxPct, warning: warning };
}

/**
 * 检查日亏损硬止损
 * @returns {object} {overLimit, todayPnl, limit, blocked}
 */
function checkDailyLossLimit() {
  var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
  var todayPnl = 0;
  var closed = getClosedSorted();
  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var closeDateStr = window.utils.toLocalDateStr(ct);
    if (closeDateStr === todayStr) {
      todayPnl += parseFloat(closed[i].pnlAmount) || 0;
    }
  }

  var settings = loadSettings();
  var capital = getAccountCapital() || settings.accountBalance;
  var dailyLossPct = settings.dailyLossLimit || 5;
  var dailyLossLimit = capital > 0 ? capital * (dailyLossPct / 100) : Infinity;

  var overLimit = todayPnl <= -dailyLossLimit;
  return {
    overLimit: overLimit,
    todayPnl: todayPnl,
    limit: dailyLossLimit,
    pctOfLimit: dailyLossLimit > 0 ? (Math.abs(Math.min(todayPnl, 0)) / dailyLossLimit * 100) : 0,
    blocked: overLimit
  };
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
  var closed = getClosedSorted();
  var todayCount = 0;
  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    if (window.utils.toLocalDateStr(ct) === todayStr) {
      todayCount++;
    }
  }

  var settings = loadSettings();
  var maxCount = settings.dailyTradeMax || 8;
  var blocked = todayCount >= maxCount;
  var suggestion = blocked
    ? '今日已交易 ' + todayCount + ' 笔，达到上限 ' + maxCount + ' 笔，建议停止交易'
    : '今日已交易 ' + todayCount + ' 笔，建议最多 ' + maxCount + ' 笔';

  return { todayCount: todayCount, maxCount: maxCount, blocked: blocked, suggestion: suggestion };
}

/**
 * 生成综合风控检查报告
 */
function generateRiskCheckReport() {
  var settings = loadSettings();
  var mindsetScore = parseInt(document.getElementById('mindsetScore').value) || 3;
  var minScore = settings.mindsetMinScore != null ? settings.mindsetMinScore : 3;

  return {
    portfolioHeat: calcPortfolioHeat(),
    dailyLoss: checkDailyLossLimit(),
    mindset: getMindsetAdjustment(mindsetScore),
    dailyFrequency: checkDailyTradeFrequency(),
    settings: settings
  };
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

  var totalTrades = wins + losses;
  if (totalTrades < minSamples) return null;

  var winRate = wins / totalTrades;
  var avgWin = totalWin / (wins || 1);
  var avgLoss = totalLoss / (losses || 1);

  return { winRate: winRate, avgWin: avgWin, avgLoss: avgLoss, samples: totalTrades, breakEvenRate: breakEvens / (totalTrades + breakEvens) };
}

/**
 * 自动填充凯利输入字段（从日志计算）
 */
function autoFillKellyFromLogs() {
  try {
    console.log('[Kelly AutoFill] Starting auto-fill from logs');
    // K3 修复：读取当前策略框架，只从同策略历史交易中计算凯利数据
    var curFramework = document.getElementById('strategyFramework') ? document.getElementById('strategyFramework').value : '';
    console.log('[Kelly AutoFill] curFramework:', curFramework);
    var stats = calcKellyStatsFromLogs(5, curFramework || undefined);
    console.log('[Kelly AutoFill] calcKellyStatsFromLogs result:', stats);
    var winRateEl = document.getElementById('kellyWinRate');
    var avgWinEl = document.getElementById('kellyAvgWin');
    var avgLossEl = document.getElementById('kellyAvgLoss');
    var tipEl = document.querySelector('.kelly-tip');
    console.log('[Kelly AutoFill] Elements found:', !!winRateEl, !!avgWinEl, !!avgLossEl);
    if (!stats || !winRateEl) {
      console.log('[Kelly AutoFill] Early return - stats:', !!stats, 'winRateEl:', !!winRateEl);
      return;
    }

    // 仅在字段为空时自动填充
    if (!winRateEl.value || winRateEl.value === '') winRateEl.value = stats.winRate.toFixed(2);
    if (!avgWinEl.value || avgWinEl.value === '') avgWinEl.value = stats.avgWin.toFixed(2);
    if (!avgLossEl.value || avgLossEl.value === '') avgLossEl.value = stats.avgLoss.toFixed(2);

    // K3 修复：增加平盘率和样本质量提示
    var tipText = '已从 ' + stats.samples + ' 笔' + (curFramework ? '「' + curFramework + '」策略' : '历史') + '交易自动计算';
    if (stats.breakEvenRate > 0) {
      tipText += '（平盘 ' + (stats.breakEvenRate * 100).toFixed(0) + '%）';
    }
    tipText += '；修改后手动覆盖';
    if (tipEl) tipEl.textContent = tipText;
  } catch(e) {}
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
  } catch(e) {}
})();
