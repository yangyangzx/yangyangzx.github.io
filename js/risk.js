// ==================== 风控中心 ====================

/**
 * 获取账户总余额：从日志中取最新的 capital，兜底第一个有 capital 的日志
 */
function getAccountCapital() {
  // 从最新的日志开始倒序查找第一个有 capital 的记录
  for (var i = logs.length - 1; i >= 0; i--) {
    if (logs[i].capital != null && !isNaN(parseFloat(logs[i].capital))) {
      return parseFloat(logs[i].capital);
    }
  }
  return null;
}

/**
 * 获取所有未平仓日志
 */
function getOpenPositions() {
  var open = [];
  for (var i = 0; i < logs.length; i++) {
    if (!logs[i].closeType) {
      open.push(logs[i]);
    }
  }
  return open;
}

/**
 * 获取按平仓时间排序的已平仓日志（有 pnlAmount 的）
 * 委托给 utils.js
 */
function getClosedSorted() {
  var closed = [];
  for (var i = 0; i < logs.length; i++) {
    if (logs[i].closeType && logs[i].pnlAmount != null && !isNaN(parseFloat(logs[i].pnlAmount))) {
      var item = Object.assign({}, logs[i]);
      item.pnlAmount = parseFloat(item.pnlAmount);
      closed.push(item);
    }
  }
  closed.sort(function(a, b) {
    var ta = a.closeTime ? new Date(a.closeTime).getTime() : 0;
    var tb = b.closeTime ? new Date(b.closeTime).getTime() : 0;
    return ta - tb;
  });
  return closed;
}

/**
 * 获取当前过滤后的已平仓日志（与 stats.js 口径一致）
 * 无过滤器时返回全量
 */
function getFilteredClosed() {
  var allClosed = getClosedSorted();
  if (typeof applyFilters === 'function' && _activeFilters) {
    var hasAnyFilter = !!( _activeFilters.direction || _activeFilters.symbol ||
                           _activeFilters.strategy || _activeFilters.status ||
                           _activeFilters.pnl || _activeFilters.time );
    if (hasAnyFilter) {
      return applyFilters(allClosed);
    }
  }
  return allClosed;
}

// ==================== 卡片渲染 ====================

/**
 * 获取按 groupId 聚合的未平仓持仓（用于强平预警）
 * 同一 groupId 的多条日志代表分批建仓，合并计算总仓位和加权入场价
 */
function getAggregatedOpenPositions() {
  var openLogs = getOpenPositions();
  var groups = {};
  for (var i = 0; i < openLogs.length; i++) {
    var pos = openLogs[i];
    var gid = pos.groupId || ('single_' + i);
    if (!groups[gid]) {
      groups[gid] = { symbol: pos.symbol, direction: pos.direction, leverage: pos.leverage, stopLoss: pos.stopLoss, positionSize: 0, weightedEntrySum: 0, entries: [] };
    }
    groups[gid].positionSize += parseFloat(pos.positionSize) || 0;
    groups[gid].entries.push(pos);
    if (pos.entryPrice != null && !isNaN(parseFloat(pos.entryPrice)) && parseFloat(pos.entryPrice) > 0) {
      groups[gid].weightedEntrySum += parseFloat(pos.entryPrice) * (parseFloat(pos.positionSize) || 0);
    }
  }
  var result = [];
  for (var gid in groups) {
    var g = groups[gid];
    g.weightedEntry = g.positionSize > 0 ? g.weightedEntrySum / g.positionSize : 0;
    result.push(g);
  }
  return result;
}

function renderRiskCenter() {
  // 统一数据源：有过滤器时使用过滤后数据，否则全量（与 stats.js 口径一致）
  var closed = getFilteredClosed();
  renderAccountOverview();
  renderDailyLoss(closed);
  renderDrawdown(closed);
  renderLiqTable();
  renderConcentration(closed);
  renderFrequency(closed);
  renderPortfolioHeat(closed);
}

// ——— 卡片 1：账户概览 ———
function renderAccountOverview() {
  var container = document.getElementById('riskAccountRows');
  if (!container) return;

  var settings = loadSettings();
  var capital = settings.accountBalance > 0 ? settings.accountBalance : getAccountCapital();
  if (capital == null) {
    container.innerHTML = '<div class="risk-empty">暂无日志数据，无法计算账户概览</div>';
    return;
  }

  var openPositions = getOpenPositions();
  var usedMargin = 0;
  for (var i = 0; i < openPositions.length; i++) {
    var lev = openPositions[i].leverage || 0;
    // BUG-7 修复：现货(leverage=0)时保证金等于仓位本身，杠杆合约用 positionSize/leverage
    if (lev > 0) {
      usedMargin += (openPositions[i].positionSize || 0) / lev;
    } else {
      usedMargin += openPositions[i].positionSize || 0;
    }
  }

  var available = capital - usedMargin;
  var exposurePct = capital > 0 ? (usedMargin / capital) * 100 : 0;

  var exposureClass = 'risk-safe';
  var exposureBadge = 'risk-badge-safe';
  if (exposurePct > 80) {
    exposureClass = 'risk-danger';
    exposureBadge = 'risk-badge-danger';
  } else if (exposurePct > 50) {
    exposureClass = 'risk-warn';
    exposureBadge = 'risk-badge-warn';
  }

  var html = '';
  html += '<div class="risk-stat-row"><span class="risk-stat-label">总余额</span><span class="risk-stat-value">' + capital.toFixed(2) + ' USDT</span></div>';
  html += '<div class="risk-stat-row"><span class="risk-stat-label">已占用保证金</span><span class="risk-stat-value">' + usedMargin.toFixed(2) + ' USDT</span></div>';
  html += '<div class="risk-stat-row"><span class="risk-stat-label">可用余额</span><span class="risk-stat-value">' + available.toFixed(2) + ' USDT</span></div>';
  html += '<div class="risk-stat-row"><span class="risk-stat-label">风险敞口</span><span class="risk-stat-value ' + exposureClass + '">' + exposurePct.toFixed(1) + '% <span class="' + exposureBadge + '">' + (exposurePct > 80 ? '危险' : (exposurePct > 50 ? '警惕' : '安全')) + '</span></span></div>';

  container.innerHTML = html;
}

// ——— 卡片 2：日亏损监控 ———
function renderDailyLoss(closedOverride) {
  var container = document.getElementById('riskDailyContent');
  if (!container) return;

  var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
  var todayPnl = 0;
  // 优先使用传入的过滤数据，否则使用全量数据
  var closed = closedOverride || getClosedSorted();

  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var closeDateStr = window.utils.toLocalDateStr(ct);
    if (!closeDateStr) continue;
    if (closeDateStr === todayStr) {
      todayPnl += parseFloat(closed[i].pnlAmount) || 0;
    }
  }

  var dailyLossSettings = loadSettings();
  var dailyLossPct = dailyLossSettings.dailyLossLimit;
  var capital = getAccountCapital() || dailyLossSettings.accountBalance;
  var capitalKnown = (capital != null && capital > 0);
  var dailyLossLimit = capitalKnown ? capital * (dailyLossPct / 100) : 0;

  if (todayPnl >= 0) {
    container.innerHTML = '<div class="risk-alert-row"><span class="risk-safe" style="font-size:16px;font-weight:600;">今日盈利 +' + todayPnl.toFixed(2) + ' USDT</span></div>' +
      '<div class="risk-alert-row"><span class="risk-sub">' + (capitalKnown ? '日亏损上限 ' + dailyLossLimit.toFixed(2) + ' USDT（本金 ' + dailyLossPct + '%），当前无需预警' : '请在「系统设置」中填写账户余额以启用比例监控') + '</span></div>';
    return;
  }

  var todayLoss = Math.abs(todayPnl);

  if (!capitalKnown) {
    container.innerHTML = '<div class="risk-alert-row"><span class="risk-warn" style="font-size:16px;font-weight:600;">亏损 -' + todayLoss.toFixed(2) + ' USDT</span></div>' +
      '<div class="risk-alert-row"><span class="risk-sub">请在「系统设置」中填写账户余额以启用日亏损比例监控</span></div>';
    return;
  }

  var progressPct = (todayLoss / dailyLossLimit) * 100;
  var isOverLimit = todayLoss >= dailyLossLimit;

  var fillClass = isOverLimit ? 'danger' : (progressPct > 70 ? 'warn' : 'safe');
  var statusText = isOverLimit ? ('日亏损已达上限！建议停止交易（已超 ' + progressPct.toFixed(0) + '%）') : ('亏损 ' + todayLoss.toFixed(2) + ' USDT / 上限 ' + dailyLossLimit.toFixed(2) + ' USDT（' + Math.min(progressPct, 100).toFixed(0) + '%）');

  var html = '<div class="risk-alert-row"><span class="' + (isOverLimit ? 'risk-danger' : 'risk-warn') + '" style="font-size:16px;font-weight:600;">' + (isOverLimit ? '日亏损' : '亏损') + ' -' + todayLoss.toFixed(2) + ' USDT</span></div>';
  html += '<div class="risk-alert-row"><span class="risk-sub">日亏损上限 ' + dailyLossLimit.toFixed(2) + ' USDT（本金 ' + dailyLossPct + '%）</span></div>';
  html += '<div class="risk-progress-wrap"><span style="font-size:12px;color:var(--color-text-muted);">' + statusText + '</span>';
  html += '<div class="risk-progress-bar"><div class="risk-progress-fill ' + fillClass + '" style="width:' + Math.min(progressPct, 100) + '%;"></div></div></div>';

  container.innerHTML = html;
}

// ——— 卡片 3：回撤监控 ———
function renderDrawdown(closedOverride) {
  var container = document.getElementById('riskDrawdownContent');
  if (!container) return;

  var closed = closedOverride || getClosedSorted();
  if (closed.length === 0) {
    container.innerHTML = '<div class="risk-empty">暂无已平仓记录</div>';
    return;
  }

  // 计算累计权益曲线：从首笔已平仓日志的 capital 取，无则从 settings.accountBalance 兜底
  var capital = 0;
  if (closed.length > 0 && closed[0].capital != null && !isNaN(closed[0].capital) && closed[0].capital > 0) {
    capital = closed[0].capital;
  } else {
    try { var _ddSettings = loadSettings(); if (_ddSettings.accountBalance > 0) capital = _ddSettings.accountBalance; } catch(e) {}
  }
  var equity = capital;
  var peak = capital;
  for (var i = 0; i < closed.length; i++) {
    // M5: 仅当 capital 变化时才视为存款/取款事件，否则累加 PnL
    var capVal = parseFloat(closed[i].capital);
    if (!isNaN(capVal) && capVal > 0 && capVal !== equity) {
      equity = capVal;
    } else {
      equity += parseFloat(closed[i].pnlAmount) || 0;
    }
    if (equity > peak) peak = equity;
  }

  var drawdownAmount = peak - equity;
  var drawdownPct = peak > 0 ? (drawdownAmount / peak) * 100 : 0;

  var ddSettings = loadSettings();
  var maxDrawdownAlert = ddSettings.maxDrawdownAlert;
  var capitalKnown = (capital > 0);
  var warnThreshold = capitalKnown ? capital * (maxDrawdownAlert / 100) : Infinity;
  var ddClass = 'risk-safe';
  var ddLabel = '安全';

  if (capitalKnown && (drawdownPct > maxDrawdownAlert || drawdownAmount > warnThreshold)) {
    ddClass = 'risk-danger';
    ddLabel = '超过最大回撤警戒线！建议暂停交易';
  } else if (drawdownPct > 10) {
    ddClass = 'risk-warn';
    ddLabel = '警惕';
  }

  var html = '';
  if (!capitalKnown) {
    html += '<div class="risk-alert-row"><span class="risk-sub" style="color:var(--color-text-muted);">⚠️ 账户余额未设置，回撤比例基准为 0。请在「系统设置」中填写账户余额以获得准确预警。</span></div>';
  }
  html += '<div class="risk-alert-row"><span class="risk-stat-label">历史最高净值</span><span class="risk-stat-value">' + peak.toFixed(2) + ' USDT</span></div>';
  html += '<div class="risk-alert-row"><span class="risk-stat-label">当前净值</span><span class="risk-stat-value">' + equity.toFixed(2) + ' USDT</span></div>';

  if (drawdownAmount <= 0.01) {
    html += '<div class="risk-alert-row"><span class="risk-safe" style="font-size:14px;font-weight:600;">当前为历史最高净值</span></div>';
  } else {
    html += '<div class="risk-alert-row"><span class="risk-stat-label">回撤金额</span><span class="risk-stat-value ' + ddClass + '">-' + drawdownAmount.toFixed(2) + ' USDT</span></div>';
    html += '<div class="risk-alert-row"><span class="risk-stat-label">回撤比例</span><span class="risk-stat-value ' + ddClass + '">-' + drawdownPct.toFixed(2) + '%</span></div>';
    html += '<div style="margin-top:8px;font-size:12px;color:' + (ddClass === 'risk-danger' ? 'var(--color-danger)' : (ddClass === 'risk-warn' ? 'var(--color-warning)' : 'var(--color-text-muted)')) + ';">' + (ddClass === 'risk-danger' ? ddLabel : (ddClass === 'risk-warn' ? '回撤 ' + drawdownPct.toFixed(1) + '% — ' + ddLabel : '正常范围内')) + '</div>';
  }

  container.innerHTML = html;
}

// ——— 卡片 4：强平距离一览 ———
function renderLiqTable() {
  var container = document.getElementById('riskLiqContent');
  if (!container) return;

  // 使用聚合后的持仓（合并同一 groupId 的分批建仓）
  var aggregatedPositions = getAggregatedOpenPositions();

  if (aggregatedPositions.length === 0) {
    container.innerHTML = '<div class="risk-empty">无持仓</div>';
    return;
  }

  // 从设置读取 MMR，默认 0.5%（0.005）
  var mmr = 0.005;
  try {
    var raw = localStorage.getItem('trade_settings_v1');
    if (raw) { var s = JSON.parse(raw); if (s.mmr != null) mmr = s.mmr / 100; }
  } catch(e) {}

  // 计算每笔强平价和安全距离（按聚合持仓）
  var rows = [];
  for (var i = 0; i < aggregatedPositions.length; i++) {
    var pos = aggregatedPositions[i];
    if (pos.leverage <= 0) continue; // 现货跳过
    if (pos.stopLoss == null || pos.stopLoss === '' || isNaN(parseFloat(pos.stopLoss))) continue; // 无止损价，无法计算安全距离

    var entryPrice = pos.weightedEntry || pos.entries[0].entryPrice;
    var stopLoss = pos.stopLoss;
    var leverage = pos.leverage;
    var direction = pos.direction;

    var liquidationPrice;
    liquidationPrice = window.utils.calcLiquidationPrice(entryPrice, direction, leverage, mmr);

    // BUG-1 修复：前置校验止损方向正确性
    var slDirValid = (direction === 'long' && stopLoss < entryPrice) ||
                     (direction === 'short' && stopLoss > entryPrice);
    if (!slDirValid) {
      // 止损方向错误，显示为危险
      rows.push({
        symbol: pos.symbol,
        direction: direction,
        stopLoss: stopLoss,
        liquidationPrice: liquidationPrice,
        safeDistance: 0,
        positionSize: pos.positionSize,
        entryPrice: entryPrice,
        note: '止损方向错误'
      });
      continue;
    }

    var safeDistance = Math.abs(stopLoss - liquidationPrice) / entryPrice * 100;

    rows.push({
      symbol: pos.symbol,
      direction: direction,
      stopLoss: stopLoss,
      liquidationPrice: liquidationPrice,
      safeDistance: safeDistance,
      positionSize: pos.positionSize,
      entryPrice: entryPrice
    });
  }

  // 按安全距离从小到大排序（最危险的排最前）
  rows.sort(function(a, b) { return a.safeDistance - b.safeDistance; });

  if (rows.length === 0) {
    container.innerHTML = '<div class="risk-empty">无杠杆持仓（全部为现货）</div>';
    return;
  }

  var html = '<table class="risk-liq-table"><thead><tr><th>品种</th><th>方向</th><th>止损价</th><th>强平价</th><th>安全距离</th><th>仓位</th><th>备注</th></tr></thead><tbody>';

  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    var distClass = 'liq-dist-safe';
    if (r.note) {
      distClass = 'liq-dist-danger';
    } else if (r.safeDistance < 1) {
      distClass = 'liq-dist-danger';
    } else if (r.safeDistance < 2) {
      distClass = 'liq-dist-warn';
    }
    var dirClass = r.direction === 'long' ? 'dir-long' : 'dir-short';
    var dirLabel = r.direction === 'long' ? '多' : '空';

    html += '<tr>';
    html += '<td>' + esc(r.symbol) + '</td>';
    html += '<td class="' + dirClass + '">' + dirLabel + '</td>';
    html += '<td>' + (r.stopLoss != null ? Number(r.stopLoss).toFixed(5) : '—') + '</td>';
    html += '<td>' + r.liquidationPrice.toFixed(5) + '</td>';
    html += '<td class="' + distClass + '">' + (r.note ? '方向错误' : r.safeDistance.toFixed(2) + '%') + '</td>';
    html += '<td>' + (r.positionSize != null ? r.positionSize.toFixed(0) + ' U' : '—') + '</td>';
    html += '<td>' + (r.note ? '<span style="color:var(--color-danger);">' + esc(r.note) + '</span>' : '—') + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ——— 卡片 5：风险集中度 ———
function renderConcentration(closedOverride) {
  var container = document.getElementById('riskConcentrationContent');
  if (!container) return;

  var openPositions = getOpenPositions();
  var closed = closedOverride || getClosedSorted();
  var capital = getAccountCapital() || loadSettings().accountBalance;
  if (capital == null || capital <= 0) {
    container.innerHTML = '<div class="risk-empty">请先在「系统设置」中填写账户余额</div>';
    return;
  }

  // 品种集中度（基于保证金占用）
  var symbolMargin = {};
  var symbolCount = {};
  for (var i = 0; i < openPositions.length; i++) {
    var pos = openPositions[i];
    var lev = pos.leverage || 0;
    // BUG-7 修复：现货(leverage=0)时保证金等于仓位本身
    if (lev > 0) {
      var margin = (pos.positionSize || 0) / lev;
    } else {
      var margin = pos.positionSize || 0;
    }
    var sym = pos.symbol || '未知';
    symbolMargin[sym] = (symbolMargin[sym] || 0) + margin;
    symbolCount[sym] = (symbolCount[sym] || 0) + 1;
  }
  // 也统计已平仓的品种分布
  for (var j = 0; j < closed.length; j++) {
    var csym = closed[j].symbol || '未知';
    symbolCount[csym] = (symbolCount[csym] || 0) + 1;
  }

  var symbolRows = [];
  // 合并所有出现过的品种（包括仅有已平仓记录的品种）
  var allSymbols = {};
  for (var sym in symbolMargin) { allSymbols[sym] = true; }
  for (var sym in symbolCount) { allSymbols[sym] = true; }
  for (var sym2 in allSymbols) {
    var margin = symbolMargin[sym2] || 0;
    var pct = capital > 0 ? (margin / capital * 100) : 0;
    symbolRows.push({ symbol: sym2, margin: margin, pct: pct, count: symbolCount[sym2] || 0 });
  }
  symbolRows.sort(function(a, b) { return b.pct - a.pct || b.count - a.count; });

  // 杠杆集中度
  var leverageBuckets = { '1x(现货)': 0, '5-20x': 0, '50x': 0, '100x': 0 };
  for (var k = 0; k < openPositions.length; k++) {
    var lv = openPositions[k].leverage || 0;
    if (lv === 0) leverageBuckets['1x(现货)']++;
    else if (lv <= 20) leverageBuckets['5-20x']++;
    else if (lv === 50) leverageBuckets['50x']++;
    else if (lv >= 100) leverageBuckets['100x']++;
  }

  var html = '';

  // 品种集中度表格
  html += '<div class="risk-concentration-wrap"><table class="risk-liq-table risk-conc-table" style="margin-bottom:16px;"><thead><tr><th>品种</th><th>保证金(USDT)</th><th>占本金%</th><th>持仓笔数</th></tr></thead><tbody>';
  if (symbolRows.length === 0) {
    html += '<tr><td colspan="4" style="text-align:center;color:var(--color-text-placeholder);padding:8px;">无持仓</td></tr>';
  } else {
    for (var sr = 0; sr < symbolRows.length; sr++) {
      var r = symbolRows[sr];
      var cls = r.pct > 50 ? 'liq-dist-danger' : (r.pct > 30 ? 'liq-dist-warn' : '');
      var marginDisplay = r.margin > 0 ? r.margin.toFixed(2) + ' USDT' : '<span style="color:var(--color-text-muted);">—</span>';
      html += '<tr><td>' + esc(r.symbol) + '</td><td>' + marginDisplay + '</td><td class="' + cls + '">' + r.pct.toFixed(1) + '%</td><td>' + r.count + '</td></tr>';
    }
  }
  html += '</tbody></table></div>';

  // 杠杆分布
  html += '<div style="font-size:12px;color:var(--color-text-muted);margin-bottom:4px;">杠杆分布（当前持仓）</div>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">';
  for (var lb in leverageBuckets) {
    var cnt = leverageBuckets[lb];
    html += '<span style="background:var(--color-surface);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--color-text);">' + lb + ': <b>' + cnt + '</b></span>';
  }
  html += '</div>';

  // 集中度警告
  if (symbolRows.length > 0 && symbolRows[0].pct > 50) {
    html += '<div style="font-size:12px;color:var(--color-warning);"><i class="fas fa-exclamation-triangle"></i> ⚠️ ' + esc(symbolRows[0].symbol) + ' 占用 ' + symbolRows[0].pct.toFixed(1) + '% 本金，风险高度集中</div>';
  }

  container.innerHTML = html;
}

// ——— 卡片 6：交易频率与连赢/连亏趋势 ———
function renderFrequency(closedOverride) {
  var container = document.getElementById('riskFrequencyContent');
  if (!container) return;

  var closed = closedOverride || getClosedSorted();
  if (closed.length === 0) {
    container.innerHTML = '<div class="risk-empty">暂无已平仓记录</div>';
    return;
  }

  // 按天统计交易笔数和盈亏
  var dailyStats = {};
  for (var i = 0; i < closed.length; i++) {
    var d = _getTradeDateRisk(closed[i]);
    if (!dailyStats[d]) dailyStats[d] = { count: 0, pnl: 0 };
    dailyStats[d].count++;
    dailyStats[d].pnl += parseFloat(closed[i].pnlAmount) || 0;
  }

  // 按日期排序
  var dates = Object.keys(dailyStats).sort();
  var maxDaily = 0;
  for (var di = 0; di < dates.length; di++) {
    if (dailyStats[dates[di]].count > maxDaily) maxDaily = dailyStats[dates[di]].count;
  }

  // 连赢/连亏最长 streak
  var maxWinStreak = 0, curWinStreak = 0;
  var maxLossStreak = 0, curLossStreak = 0;
  var sortedByClose = [...closed].sort(function(a, b) { return new Date(a.closeTime || a.time) - new Date(b.closeTime || b.time); });
  for (var wi = 0; wi < sortedByClose.length; wi++) {
    var pnl = parseFloat(sortedByClose[wi].pnlAmount) || 0;
    if (pnl > 0) { curWinStreak++; curLossStreak = 0; }
    else if (pnl < 0) { curLossStreak++; curWinStreak = 0; }
    else { curWinStreak = 0; curLossStreak = 0; }
    if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak;
    if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak;
  }

  // 平均每日交易次数
  var daysRange = dates.length > 0 ? Math.max(1, Math.ceil((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000)) : 1;
  var avgDaily = (closed.length / daysRange).toFixed(1);

  // 今日交易次数
  var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
  var todayCount = dailyStats[todayStr] ? dailyStats[todayStr].count : 0;
  var todayPnl = dailyStats[todayStr] ? dailyStats[todayStr].pnl : 0;

  var html = '';
  html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
  html += '<div style="flex:1;min-width:120px;background:var(--color-surface);border-radius:8px;padding:10px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);">总交易天数</div>';
  html += '<div style="font-size:18px;font-weight:600;">' + dates.length + '</div></div>';
  html += '<div style="flex:1;min-width:120px;background:var(--color-surface);border-radius:8px;padding:10px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);">日均交易</div>';
  html += '<div style="font-size:18px;font-weight:600;">' + avgDaily + ' 笔</div></div>';
  html += '<div style="flex:1;min-width:120px;background:var(--color-surface);border-radius:8px;padding:10px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);">今日交易</div>';
  html += '<div style="font-size:18px;font-weight:600;">' + todayCount + ' 笔</div>';
  html += '<div style="font-size:11px;color:' + (todayPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)') + '">' + (todayPnl >= 0 ? '+' : '') + todayPnl.toFixed(2) + ' U</div></div>';
  html += '</div>';

  html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
  html += '<div style="flex:1;min-width:120px;background:var(--color-surface);border-radius:8px;padding:10px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);">最长连赢</div>';
  html += '<div style="font-size:18px;font-weight:600;color:var(--color-success);">' + maxWinStreak + ' 笔</div></div>';
  html += '<div style="flex:1;min-width:120px;background:var(--color-surface);border-radius:8px;padding:10px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);">最长连亏</div>';
  html += '<div style="font-size:18px;font-weight:600;color:var(--color-danger);">' + maxLossStreak + ' 笔</div></div>';
  html += '<div style="flex:1;min-width:120px;background:var(--color-surface);border-radius:8px;padding:10px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);">单日最多</div>';
  html += '<div style="font-size:18px;font-weight:600;">' + maxDaily + ' 笔</div></div>';
  html += '</div>';

  // 每日交易柱状图（最近 30 天）
  if (dates.length > 0) {
    var recentDates = dates.slice(-30);
    html += '<div style=\"font-size:12px;color:var(--color-text-muted);margin-bottom:4px;\">近 30 个交易日分布</div>';
    html += '<div style="display:flex;gap:2px;align-items:flex-end;height:60px;">';
    for (var ri = 0; ri < recentDates.length; ri++) {
      var h = Math.max(4, (dailyStats[recentDates[ri]].count / maxDaily) * 56);
      var color = dailyStats[recentDates[ri]].pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
      html += '<div style="flex:1;background:' + color + ';height:' + h + 'px;border-radius:2px 2px 0 0;" title="' + recentDates[ri] + ': ' + dailyStats[recentDates[ri]].count + ' 笔 (' + dailyStats[recentDates[ri]].pnl.toFixed(0) + ' U)"></div>';
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

// 辅助函数：提取交易日期字符串（使用 utils 统一实现）
function _getTradeDateRisk(l) {
  return window.utils.toLocalDateStr(l ? (l.closeTime || l.time) : '');
}

// ==================== 卡片 7：组合热量 ====================
function renderPortfolioHeat(closedOverride) {
  var container = document.getElementById('riskHeatContent');
  if (!container) return;

  var heatCheck = calcPortfolioHeat();
  var capital = getAccountCapital();
  var settings = loadSettings();
  var maxHeat = settings.riskHeatMax || 6;

  if (!capital || capital <= 0) {
    container.innerHTML = '<div class="risk-empty">请先在「系统设置」中填写账户余额以启用组合热量监控</div>';
    return;
  }

  var heat = heatCheck.heat || 0;
  var isBlocked = heatCheck.blocked;
  var fillClass = isBlocked ? 'danger' : (heat >= maxHeat * 0.8 ? 'warn' : 'safe');
  var heatPct = Math.min(heat / (maxHeat * 1.5) * 100, 100);

  var html = '<div class="risk-alert-row"><span class="risk-stat-label">当前组合热量</span><span class="risk-stat-value ' + (isBlocked ? 'risk-danger' : (heat > maxHeat * 0.8 ? 'risk-warn' : 'risk-safe')) + '">' + heat.toFixed(1) + '%</span></div>';
  html += '<div class="risk-alert-row"><span class="risk-sub">安全上限 ' + maxHeat + '%（总开口风险占本金）</span></div>';
  html += '<div class="risk-progress-wrap"><span style="font-size:12px;color:var(--color-text-muted);">' + (isBlocked ? '热量超限，禁止开新仓' : '热量 ' + heat.toFixed(1) + '% / 上限 ' + maxHeat + '%（' + heatPct.toFixed(0) + '%）') + '</span>';
  html += '<div class="risk-progress-bar"><div class="risk-progress-fill ' + fillClass + '" style="width:' + heatPct + '%;"></div></div></div>';

  // 明细
  if (heatCheck.details && heatCheck.details.length > 0) {
    html += '<div style="margin-top:12px;font-size:12px;">';
    html += '<div style="color:var(--color-text-muted);margin-bottom:6px;">持仓风险明细：</div>';
    for (var i = 0; i < heatCheck.details.length; i++) {
      var d = heatCheck.details[i];
      html += '<div class="risk-alert-row" style="padding:4px 0;"><span class="risk-sub">' + esc(d.symbol) + '</span><span class="risk-sub">' + d.risk.toFixed(2) + ' USDT (' + d.pct.toFixed(2) + '%)</span></div>';
    }
    html += '</div>';
  }

  if (heatCheck.warning) {
    html += '<div style="margin-top:8px;font-size:12px;color:' + (isBlocked ? 'var(--color-danger)' : 'var(--color-warning)') + ';">' + heatCheck.warning + '</div>';
  }

  container.innerHTML = html;
}
