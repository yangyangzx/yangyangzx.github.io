// ==================== 统计分析 ====================

// Chart.js 实例引用，切换视图时销毁重建
var _analyticsCharts = {};

/**
 * 销毁所有图表实例
 */
function destroyAnalyticsCharts() {
  var ids = ['chartEquity', 'chartStrategy', 'chartPattern', 'chartSession', 'chartMAEMFE', 'closeTypeChart',
             'chartDailyPnl', 'chartDayOfWeek', 'chartHoldDuration', 'chartMonthlyPnl'];
  for (var i = 0; i < ids.length; i++) {
    if (_analyticsCharts[ids[i]]) {
      _analyticsCharts[ids[i]].destroy();
      _analyticsCharts[ids[i]] = null;
    }
  }
}

// ==================== 数据辅助函数 ====================

// getClosedSorted() 已由 risk.js 提供（全局函数），此处复用

/**
 * 空状态降级辅助：隐藏 canvas 并插入空状态 div（避免 canvas 脱离 DOM）
 */
function _setCanvasEmpty(canvas, iconClass, message) {
  canvas.style.display = 'none';
  var emptyId = canvas.id + '__empty';
  var empty = document.getElementById(emptyId);
  if (!empty) {
    empty = document.createElement('div');
    empty.id = emptyId;
    empty.className = 'analytics-empty analytics-empty-temp';
    empty.innerHTML = '<div class="analytics-empty-icon"><i class="fas ' + iconClass + '"></i></div><div>' + message + '</div>';
    canvas.parentElement.appendChild(empty);
  }
}

function _clearCanvasEmpty(canvas) {
  var empty = document.getElementById(canvas.id + '__empty');
  if (empty) empty.remove();
  canvas.style.display = '';
}

function fmtDate(isoStr) {
  return window.utils.fmtDate(isoStr);
}

function safeParseNum(val) {
  return window.utils.safeParseNum(val);
}

/**
 * 提取形态名：从 "bullish-continuation|上升三角" 中取完整信息
 * 返回格式："看涨延续 - 上升三角"
 */
function extractPatternName(raw) {
  if (!raw) return '未标记';
  var parts = raw.split('|');
  if (parts.length > 1) {
    var category = PATTERN_GROUP_LABELS[parts[0]] || parts[0];
    return category + ' - ' + parts[parts.length - 1].trim();
  }
  return raw.trim();
}

// ==================== 主渲染入口 ====================

function renderAnalytics() {
  destroyAnalyticsCharts();

  var closed = getClosedSorted();

  var fns = [
    ['renderEquityChart',       function() { renderEquityChart(closed); }],
    ['renderStrategyChart',     function() { renderStrategyChart(closed); }],
    ['renderPatternChart',      function() { renderPatternChart(closed); }],
    ['renderSessionChart',      function() { renderSessionChart(closed); }],
    ['renderMAEMFEScatter',     function() { renderMAEMFEScatter(closed); }],
    ['renderCloseTypeChart',    function() { renderCloseTypeChart(closed); }],
    ['renderDailyPnlChart',     function() { renderDailyPnlChart(closed); }],
    ['renderDayOfWeekChart',    function() { renderDayOfWeekChart(closed); }],
    ['renderHoldDurationChart', function() { renderHoldDurationChart(closed); }],
    ['renderMonthlyPnlChart',   function() { renderMonthlyPnlChart(closed); }],
    ['renderDimensionBreakdown',function() { renderDimensionBreakdown(closed); }]
  ];

  for (var i = 0; i < fns.length; i++) {
    try { fns[i][1](); } catch(e) {
      console.error('[analytics] ' + fns[i][0] + ' failed:', e);
    }
  }
}

// ==================== 图表 1：资金曲线 ====================

function renderEquityChart(closed) {
  var canvas = document.getElementById('chartEquity');
  if (!canvas) return;

  if (closed.length === 0) {
    _setCanvasEmpty(canvas, 'fa-chart-line', '暂无交易数据');
    var _noteEl = document.getElementById('equityBalanceNote');
    if (_noteEl) _noteEl.remove();
    return;
  }

  // 取初始权益：从首笔已平仓日志的 capital 取，无则从 settings.accountBalance 兜底
  var sortedClosed = [...closed].sort(function(a, b) { return new Date(a.closeTime || a.time) - new Date(b.closeTime || b.time); });
  var capital = 0;
  if (sortedClosed.length > 0 && sortedClosed[0].capital != null && !isNaN(sortedClosed[0].capital) && sortedClosed[0].capital > 0) {
    capital = sortedClosed[0].capital;
  } else {
    try { var _abs = loadSettings(); if (_abs.accountBalance > 0) capital = _abs.accountBalance; } catch(e) {}
  }

  // 检查设置中的 accountBalance 是否与推算值差异较大
  var _abSettings = null;
  try { _abSettings = loadSettings(); } catch(e) {}
  var _noteEl = document.getElementById('equityBalanceNote');
  if (_abSettings && _abSettings.accountBalance > 0) {
    var _diff = Math.abs(_abSettings.accountBalance - capital);
    var _diffPct = capital > 0 ? (_diff / capital * 100) : 100;
    if (_diffPct > 1) {
      if (!_noteEl) {
        _noteEl = document.createElement('div');
        _noteEl.id = 'equityBalanceNote';
        _noteEl.style.cssText = 'font-size:11px;color:var(--chart-canvas-text);margin-top:6px;text-align:right;';
        canvas.parentElement.appendChild(_noteEl);
      }
      _noteEl.textContent = capital > 0 ? '设置中账户余额: ' + _abSettings.accountBalance.toFixed(2) + ' USDT（日志推算: ' + capital.toFixed(2) + ' USDT）' : '设置中账户余额: ' + _abSettings.accountBalance.toFixed(2) + ' USDT（日志中无 capital 数据，请在「系统设置」中保持一致）';
    } else if (_noteEl) {
      _noteEl.remove();
    }
  } else if (capital <= 0) {
    if (!_noteEl) {
      _noteEl = document.createElement('div');
      _noteEl.id = 'equityBalanceNote';
      _noteEl.style.cssText = 'font-size:11px;color:var(--chart-canvas-text);margin-top:6px;text-align:right;';
      canvas.parentElement.appendChild(_noteEl);
    }
    _noteEl.textContent = '账户余额未设置，权益从 0 开始计算。请在「系统设置」中填写账户余额以获得准确资金曲线';
  } else if (_noteEl) {
    _noteEl.remove();
  }

  // 使用统一权益曲线计算（避免手动重复实现相同逻辑）
  var _curve = window.utils.calcEquityCurve(sortedClosed);
  var _eqLabels = [], _eqData = [];
  for (var _j = 0; _j < _curve.data.length; _j++) {
    _eqLabels.push(fmtDate(sortedClosed[_j].closeTime));
    _eqData.push(parseFloat(_curve.data[_j].eq.toFixed(2)));
  }

  // 清除空状态，恢复 canvas
  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  var cc = utils.getChartColors();
  var c = utils.getCanvasColors();
  _analyticsCharts['chartEquity'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: _eqLabels,
      datasets: [{
        label: '累计权益 (USDT)',
        data: _eqData,
        borderColor: cc.barBorder,
        backgroundColor: function(context) {
          var chart = context.chart;
          var gctx = chart.ctx;
          var gradient = gctx.createLinearGradient(0, 0, 0, chart.height);
          gradient.addColorStop(0, 'rgba(59, 130, 246, 0.2)');
          gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
          return gradient;
        },
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: cc.positivePoint,
        pointBorderColor: 'rgba(255,255,255,0.6)',
        pointBorderWidth: 1.5,
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: cc.tickColor,
            font: { size: 12 },
            usePointStyle: true,
            pointStyleWidth: 12,
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) { return ctx.parsed.y.toFixed(2) + ' USDT'; }
          }
        }
      },
      scales: {
        x: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, maxTicksLimit: 12, font: { size: 12 }, maxRotation: 0 }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: {
            color: cc.tickColor,
            font: { size: 12 },
            callback: function(v) { return v.toFixed(0); }
          }
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
}

// ==================== 图表 2：策略绩效（柱状图 + 表格） ====================

function groupByStrategy(closed) {
  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var framework = closed[i].strategyFramework || '未分类';
    var pattern = closed[i].strategyPattern || '未标记';
    var patternName = extractPatternName(pattern);
    var key = framework + '|' + patternName;
    if (!groups[key]) {
      groups[key] = { framework: framework, patternName: patternName, trades: [] };
    }
    groups[key].trades.push(closed[i]);
  }

  var rows = [];
  var keys = Object.keys(groups);
  for (var j = 0; j < keys.length; j++) {
    var group = groups[keys[j]];
    var trades = group.trades;
    var wins = 0, losses = 0, totalPnl = 0, totalRR = 0, totalMAE = 0, totalMFE = 0;
    var rrCount = 0, maeCount = 0, mfeCount = 0;

    for (var t = 0; t < trades.length; t++) {
      var tr = trades[t];
      var pnl = safeParseNum(tr.pnlAmount);
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      if (pnl != null) totalPnl += pnl;
      var rr = safeParseNum(tr.rMultiple);
      if (rr != null) { totalRR += rr; rrCount++; }
      // MAE: 仅统计亏损单（与 stats.js 口径一致）
      var mae = safeParseNum(tr.mae);
      if (mae != null && pnl != null && pnl < 0) { totalMAE += Math.abs(mae); maeCount++; }
      // MFE: 统计全部已平仓交易
      var mfe = safeParseNum(tr.mfe);
      if (mfe != null) { totalMFE += mfe; mfeCount++; }
    }
    var decidedCnt = wins + losses;
    var winRate = decidedCnt > 0 ? (wins / decidedCnt * 100) : 0;

    rows.push({
      name: group.framework + ' - ' + group.patternName,
      framework: group.framework,
      patternName: group.patternName,
      count: trades.length,
      wins: wins,
      losses: losses,
      winRate: winRate,
      totalPnl: totalPnl,
      avgPnl: decidedCnt > 0 ? totalPnl / decidedCnt : 0,
      avgRR: rrCount > 0 ? totalRR / rrCount : null,
      avgMAE: maeCount > 0 ? totalMAE / maeCount : null,
      avgMFE: mfeCount > 0 ? totalMFE / mfeCount : null
    });
  }

  return rows;
}

function renderStrategyChart(closed) {
  var canvas = document.getElementById('chartStrategy');
  if (!canvas) return;

  if (closed.length === 0) {
    _setCanvasEmpty(canvas, 'fa-chart-bar', '暂无交易数据');
    renderStrategyTable([]);
    return;
  }

  var rows = groupByStrategy(closed);
  // 按总盈亏排序
  rows.sort(function(a, b) { return b.totalPnl - a.totalPnl; });

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var i = 0; i < rows.length; i++) {
    var displayName = rows[i].patternName !== '未标记' 
      ? rows[i].patternName 
      : rows[i].framework;
    labels.push(displayName.length > 12 ? displayName.substring(0, 11) + '…' : displayName);
    data.push(parseFloat(rows[i].avgPnl.toFixed(2)));
    var wr = rows[i].winRate;
    if (wr >= 60) bgColors.push(cc.barWin);
    else if (wr >= 40) bgColors.push(cc.barWarn);
    else bgColors.push(cc.barLoss);
  }

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartStrategy'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '平均盈亏 (USDT)',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) { return '均盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 12 }, maxRotation: 45 }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 12 } }
        }
      }
    }
  });

  renderStrategyTable(rows);
}

function renderStrategyTable(rows) {
  var wrap = document.getElementById('strategyTableWrap');
  if (!wrap) return;

  if (rows.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:16px;">暂无策略数据</div>';
    return;
  }

  // 找最优和最差行
  var bestIdx = 0, worstIdx = 0;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i].avgPnl > rows[bestIdx].avgPnl) bestIdx = i;
    if (rows[i].avgPnl < rows[worstIdx].avgPnl) worstIdx = i;
  }

  var html = '<div class="analytics-table-wrap"><table class="analytics-table" id="strategyDetailTable"><thead><tr>';
  html += '<th data-col="framework" data-sort="str">策略框架 <span class="sort-arrow"></span></th>';
  html += '<th data-col="patternName" data-sort="str">形态 <span class="sort-arrow"></span></th>';
  html += '<th data-col="count" data-sort="num">笔数 <span class="sort-arrow"></span></th>';
  html += '<th data-col="winRate" data-sort="num">胜率 <span class="sort-arrow"></span></th>';
  html += '<th data-col="totalPnl" data-sort="num">总盈亏 <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgPnl" data-sort="num">平均盈亏 <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgRR" data-sort="num">均 R <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgMAE" data-sort="num">均 MAE <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgMFE" data-sort="num">均 MFE <span class="sort-arrow"></span></th>';
  html += '</tr></thead><tbody>';

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var rowClass = '';
    if (r === bestIdx && bestIdx !== worstIdx) rowClass = 'row-best';
    else if (r === worstIdx && bestIdx !== worstIdx) rowClass = 'row-worst';

    html += '<tr class="' + rowClass + '">';
    html += '<td>' + row.framework + '</td>';
    html += '<td>' + row.patternName + '</td>';
    html += '<td class="col-num">' + row.count + '</td>';
    html += '<td class="col-num">' + row.winRate.toFixed(1) + '%</td>';
    html += '<td class="' + (row.totalPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(2) + '</td>';
    html += '<td class="' + (row.avgPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (row.avgPnl >= 0 ? '+' : '') + row.avgPnl.toFixed(2) + '</td>';
    html += '<td class="col-num">' + (row.avgRR != null ? row.avgRR.toFixed(2) : '—') + '</td>';
    html += '<td class="col-num">' + (row.avgMAE != null ? row.avgMAE.toFixed(2) + '%' : '—') + '</td>';
    html += '<td class="col-num">' + (row.avgMFE != null ? row.avgMFE.toFixed(2) + '%' : '—') + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  wrap.innerHTML = html;

  // 绑定排序
  bindTableSort('strategyDetailTable', rows);
}

// ==================== 图表 3：策略形态深度拆解 ====================

function groupByPattern(closed) {
  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var raw = closed[i].strategyPattern;
    var key = extractPatternName(raw);
    if (!groups[key]) groups[key] = [];
    groups[key].push(closed[i]);
  }

  var rows = [];
  var keys = Object.keys(groups);
  var othersList = [];

  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    var trades = groups[k];
    if (trades.length < 2) {
      othersList = othersList.concat(trades);
      continue;
    }

    var wins = 0, losses = 0, totalPnl = 0, totalRR = 0, totalMAE = 0, totalMFE = 0;
    var rrCount = 0, maeCount = 0, mfeCount = 0;

    for (var t = 0; t < trades.length; t++) {
      var tr = trades[t];
      var pnl = safeParseNum(tr.pnlAmount);
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      if (pnl != null) totalPnl += pnl;
      var rr = safeParseNum(tr.rMultiple);
      if (rr != null) { totalRR += rr; rrCount++; }
      // MAE: 仅统计亏损单（与 stats.js 口径一致）
      var mae = safeParseNum(tr.mae);
      if (mae != null && pnl != null && pnl < 0) { totalMAE += Math.abs(mae); maeCount++; }
      // MFE: 统计全部已平仓交易
      var mfe = safeParseNum(tr.mfe);
      if (mfe != null) { totalMFE += mfe; mfeCount++; }
    }
    var decidedCnt = wins + losses;
    var winRate = decidedCnt > 0 ? (wins / decidedCnt * 100) : 0;

    rows.push({
      name: k,
      count: trades.length,
      wins: wins,
      losses: losses,
      winRate: winRate,
      totalPnl: totalPnl,
      avgPnl: decidedCnt > 0 ? totalPnl / decidedCnt : 0,
      avgRR: rrCount > 0 ? totalRR / rrCount : null,
      avgMAE: maeCount > 0 ? totalMAE / maeCount : null,
      avgMFE: mfeCount > 0 ? totalMFE / mfeCount : null
    });
  }

  // 合并 <2 笔的为"其他"
  if (othersList.length > 0) {
    var oWins = 0, oLosses = 0, oPnl = 0, oRR = 0, oMAE = 0, oMFE = 0;
    var oRRc = 0, oMAEc = 0, oMFEc = 0;
    for (var o = 0; o < othersList.length; o++) {
      var or = othersList[o];
      var opnl = safeParseNum(or.pnlAmount);
      if (opnl > 0) oWins++;
      else if (opnl < 0) oLosses++;
      if (opnl != null) oPnl += opnl;
      var orv = safeParseNum(or.rMultiple);
      if (orv != null) { oRR += orv; oRRc++; }
      // MAE: 仅统计亏损单
      var omv = safeParseNum(or.mae);
      if (omv != null && opnl != null && opnl < 0) { oMAE += Math.abs(omv); oMAEc++; }
      // MFE: 统计全部
      var ofv = safeParseNum(or.mfe);
      if (ofv != null) { oMFE += ofv; oMFEc++; }
    }
    var oDecidedCnt = oWins + oLosses;
    var oWinRate = oDecidedCnt > 0 ? (oWins / oDecidedCnt * 100) : 0;
    rows.push({
      name: '其他 (单笔形态)',
      count: othersList.length,
      wins: oWins,
      winRate: oWinRate,
      totalPnl: oPnl,
      avgPnl: oDecidedCnt > 0 ? oPnl / oDecidedCnt : 0,
      avgRR: oRRc > 0 ? oRR / oRRc : null,
      avgMAE: oMAEc > 0 ? oMAE / oMAEc : null,
      avgMFE: oMFEc > 0 ? oMFE / oMFEc : null
    });
  }

  return rows;
}

function renderPatternChart(closed) {
  var canvas = document.getElementById('chartPattern');
  if (!canvas) return;

  var rows = groupByPattern(closed);

  if (rows.length === 0) {
    _setCanvasEmpty(canvas, 'fa-shapes', '暂无已平仓交易数据');
    renderPatternTable([]);
    return;
  }

  rows.sort(function(a, b) { return b.totalPnl - a.totalPnl; });

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var labels = [], data = [], bgColors = [];
  var cc = utils.getChartColors();
  for (var i = 0; i < rows.length; i++) {
    var name = rows[i].name;
    if (name === '其他 (单笔形态)') {
      labels.push('其他');
    } else {
      labels.push(name.length > 14 ? name.substring(0, 13) + '…' : name);
    }
    data.push(parseFloat(rows[i].avgPnl.toFixed(2)));
    var wr = rows[i].winRate;
    if (wr >= 60) bgColors.push(cc.barWin);
    else if (wr >= 40) bgColors.push(cc.barWarn);
    else bgColors.push(cc.barLoss);
  }

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartPattern'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '平均盈亏 (USDT)',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) { return '均盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 12 }, maxRotation: 45 }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 12 } }
        }
      }
    }
  });

  renderPatternTable(rows);
}

function renderPatternTable(rows) {
  var wrap = document.getElementById('patternTableWrap');
  if (!wrap) return;

  if (rows.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:16px;">暂无形态数据</div>';
    return;
  }

  var bestIdx = 0, worstIdx = 0;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i].avgPnl > rows[bestIdx].avgPnl) bestIdx = i;
    if (rows[i].avgPnl < rows[worstIdx].avgPnl) worstIdx = i;
  }

  var html = '<div class="analytics-table-wrap"><table class="analytics-table" id="patternDetailTable"><thead><tr>';
  html += '<th data-col="name" data-sort="str">策略形态 <span class="sort-arrow"></span></th>';
  html += '<th data-col="count" data-sort="num">笔数 <span class="sort-arrow"></span></th>';
  html += '<th data-col="winRate" data-sort="num">胜率 <span class="sort-arrow"></span></th>';
  html += '<th data-col="totalPnl" data-sort="num">总盈亏 <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgPnl" data-sort="num">平均盈亏 <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgRR" data-sort="num">均 R <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgMAE" data-sort="num">均 MAE <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgMFE" data-sort="num">均 MFE <span class="sort-arrow"></span></th>';
  html += '</tr></thead><tbody>';

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var rowClass = '';
    if (r === bestIdx && bestIdx !== worstIdx) rowClass = 'row-best';
    else if (r === worstIdx && bestIdx !== worstIdx) rowClass = 'row-worst';

    html += '<tr class="' + rowClass + '">';
    html += '<td>' + row.name + '</td>';
    html += '<td class="col-num">' + row.count + '</td>';
    html += '<td class="col-num">' + row.winRate.toFixed(1) + '%</td>';
    html += '<td class="' + (row.totalPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(2) + '</td>';
    html += '<td class="' + (row.avgPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (row.avgPnl >= 0 ? '+' : '') + row.avgPnl.toFixed(2) + '</td>';
    html += '<td class="col-num">' + (row.avgRR != null ? row.avgRR.toFixed(2) : '—') + '</td>';
    html += '<td class="col-num">' + (row.avgMAE != null ? row.avgMAE.toFixed(2) + '%' : '—') + '</td>';
    html += '<td class="col-num">' + (row.avgMFE != null ? row.avgMFE.toFixed(2) + '%' : '—') + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  wrap.innerHTML = html;

  bindTableSort('patternDetailTable', rows);
}

// ==================== 图表 4：交易时段热力柱状图 ====================

function renderSessionChart(closed) {
  var canvas = document.getElementById('chartSession');
  if (!canvas) return;

  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var key = closed[i].session || '未标记';
    if (!groups[key]) groups[key] = [];
    groups[key].push(closed[i]);
  }

  var keys = Object.keys(groups);
  if (keys.length === 0) {
    _setCanvasEmpty(canvas, 'fa-clock', '暂无交易数据');
    return;
  }

  var sessionLabelMap = {
    'asia': '亚盘', 'europe': '欧盘', 'us': '美盘',
    'overlap': '重叠时段', 'allday': '全天', '未标记': '未标记'
  };

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var j = 0; j < keys.length; j++) {
    var trades = groups[keys[j]];
    var totalPnl = 0, wins = 0;
    for (var t = 0; t < trades.length; t++) {
      var pnl = safeParseNum(trades[t].pnlAmount);
      if (pnl != null) totalPnl += pnl;
      if (pnl != null && pnl > 0) wins++;
    }
    labels.push(sessionLabelMap[keys[j]] || keys[j]);
    data.push(parseFloat(totalPnl.toFixed(2)));
    bgColors.push(totalPnl >= 0 ? cc.barWin : cc.barLoss);
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartSession'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '总盈亏 (USDT)',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) { return '总盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 12 } }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 12 } }
        }
      }
    }
  });
}

// ==================== 图表 5：MAE/MFE 散点图 ====================

function renderMAEMFEScatter(closed) {
  var canvas = document.getElementById('chartMAEMFE');
  if (!canvas) return;

  // 过滤有 MAE 和 MFE 数据的
  var points = [];
  for (var i = 0; i < closed.length; i++) {
    var mae = safeParseNum(closed[i].mae);
    var mfe = safeParseNum(closed[i].mfe);
    if (mae != null && mfe != null) {
      points.push({ x: Math.abs(mae), y: mfe, isWin: safeParseNum(closed[i].pnlAmount) > 0 });
    }
  }

  if (points.length === 0) {
    _setCanvasEmpty(canvas, 'fa-crosshairs', '缺少 MAE/MFE 数据（平仓时需填写最低价和最高价）');
    return;
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  var cc = utils.getChartColors();
  var c = utils.getCanvasColors();
  _analyticsCharts['chartMAEMFE'] = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: '盈利单',
        data: points.filter(function(p) { return p.isWin; }),
        backgroundColor: cc.scatterWin,
        pointRadius: 5,
        pointHoverRadius: 10,
        pointBorderColor: cc.legendText,
        pointBorderWidth: 2
      }, {
        label: '亏损单',
        data: points.filter(function(p) { return !p.isWin; }),
        backgroundColor: cc.scatterLoss,
        pointRadius: 5,
        pointHoverRadius: 10,
        pointBorderColor: cc.legendText,
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: cc.legendText, font: { size: 13 }, usePointStyle: true, padding: 16 }
        },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) { return 'MAE: ' + ctx.parsed.x.toFixed(2) + '% | MFE: ' + ctx.parsed.y.toFixed(2) + '%'; }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'MAE %（绝对值）', color: cc.tickColor },
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 12 } }
        },
        y: {
          title: { display: true, text: 'MFE %', color: cc.tickColor },
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 12 } }
        }
      }
    },
    plugins: [{
      id: 'idealZone',
      afterDraw: function(chart) {
        var ctx2 = chart.ctx;
        var xAxis = chart.scales.x;
        var yAxis = chart.scales.y;

        // 理想区域：MAE < 5% 且 MFE > 5%（左上角，仅当 y 轴范围覆盖 ≥5 时绘制）
        if (yAxis.max >= 5) {
          var xMin = xAxis.getPixelForValue(0);
          var xMax = xAxis.getPixelForValue(5);
          var yMin = yAxis.getPixelForValue(Math.min(5, yAxis.max));
          var yMax = yAxis.getPixelForValue(yAxis.max);

          ctx2.save();
          ctx2.fillStyle = c.up.replace('0.95', '0.06');
          ctx2.fillRect(xMin, yMin, xMax - xMin, yMax - yMin);
          ctx2.strokeStyle = c.up.replace('0.95', '0.2');
          ctx2.lineWidth = 1;
          ctx2.setLineDash([6, 4]);
          ctx2.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
          ctx2.setLineDash([]);

          // 标签
          ctx2.fillStyle = c.up.replace('0.95', '0.5');
          ctx2.font = '11px sans-serif';
          ctx2.textAlign = 'left';
          ctx2.fillText('理想区域', xMin + 6, yMin + 16);

          ctx2.restore();
        }
      }
    }]
  });
}

// ==================== 表格排序 ====================

function bindTableSort(tableId, rows) {
  var table = document.getElementById(tableId);
  if (!table) return;

  var headers = table.querySelectorAll('th[data-sort]');
  for (var i = 0; i < headers.length; i++) {
    headers[i].addEventListener('click', (function(col, sortType) {
      return function() {
        var isAsc = this.getAttribute('data-sort-dir') !== 'asc';
        // 重置所有箭头
        var allTh = table.querySelectorAll('th[data-sort]');
        for (var k = 0; k < allTh.length; k++) {
          allTh[k].querySelector('.sort-arrow').textContent = '';
          allTh[k].removeAttribute('data-sort-dir');
        }
        this.setAttribute('data-sort-dir', isAsc ? 'asc' : 'desc');
        this.querySelector('.sort-arrow').textContent = isAsc ? '▲' : '▼';

        var sorted = rows.slice().sort(function(a, b) {
          var va, vb;
          if (sortType === 'str') {
            va = (a[col] || '').toString();
            vb = (b[col] || '').toString();
          } else {
            va = a[col] != null ? parseFloat(a[col]) : (sortType === 'num' ? -Infinity : '');
            vb = b[col] != null ? parseFloat(b[col]) : (sortType === 'num' ? -Infinity : '');
          }
          if (va < vb) return isAsc ? -1 : 1;
          if (va > vb) return isAsc ? 1 : -1;
          return 0;
        });

        // 重新渲染 tbody
        var tbody = table.querySelector('tbody');
        if (!tbody) return;
        var bestIdx = 0, worstIdx = 0;
        for (var r = 1; r < sorted.length; r++) {
          if (sorted[r].avgPnl > sorted[bestIdx].avgPnl) bestIdx = r;
          if (sorted[r].avgPnl < sorted[worstIdx].avgPnl) worstIdx = r;
        }

        var isStrategyTable = (tableId === 'strategyDetailTable');
        var html = '';
        for (var j = 0; j < sorted.length; j++) {
          var row = sorted[j];
          var rowClass = '';
          if (j === bestIdx && bestIdx !== worstIdx) rowClass = 'row-best';
          else if (j === worstIdx && bestIdx !== worstIdx) rowClass = 'row-worst';

          html += '<tr class="' + rowClass + '">';
          if (isStrategyTable) {
            // strategyDetailTable: 9 列（framework + patternName 分列）
            html += '<td>' + row.framework + '</td>';
            html += '<td>' + row.patternName + '</td>';
          } else {
            // patternDetailTable: 8 列（name 合并列）
            html += '<td>' + row.name + '</td>';
          }
          html += '<td class="col-num">' + row.count + '</td>';
          html += '<td class="col-num">' + row.winRate.toFixed(1) + '%</td>';
          html += '<td class="' + (row.totalPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(2) + '</td>';
          html += '<td class="' + (row.avgPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (row.avgPnl >= 0 ? '+' : '') + row.avgPnl.toFixed(2) + '</td>';
          html += '<td class="col-num">' + (row.avgRR != null ? row.avgRR.toFixed(2) : '—') + '</td>';
          html += '<td class="col-num">' + (row.avgMAE != null ? row.avgMAE.toFixed(2) + '%' : '—') + '</td>';
          html += '<td class="col-num">' + (row.avgMFE != null ? row.avgMFE.toFixed(2) + '%' : '—') + '</td>';
          html += '</tr>';
        }
        tbody.innerHTML = html;
      };
    })(headers[i].getAttribute('data-col'), headers[i].getAttribute('data-sort')));
  }
}

// ==================== 多维绩效拆解（品种 / 方向 / 时段独立统计）====================

function groupByDimension(closed, field) {
  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var key = closed[i][field] || '未标记';
    if (!groups[key]) groups[key] = [];
    groups[key].push(closed[i]);
  }
  return groups;
}

function computeGroupStats(trades) {
  var wins = 0, losses = 0, totalPnl = 0;
  for (var t = 0; t < trades.length; t++) {
    var pnl = safeParseNum(trades[t].pnlAmount);
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
    if (pnl != null) totalPnl += pnl;
  }
  var decided = wins + losses;
  var wr = decided > 0 ? (wins / decided * 100) : 0;
  return { count: trades.length, wins, losses, totalPnl, avgPnl: decided > 0 ? totalPnl / decided : 0, wr };
}

function renderCloseTypeChart(closed) {
  var canvas = document.getElementById('closeTypeChart');
  if (!canvas) return;

  if (closed.length === 0) {
    _setCanvasEmpty(canvas, 'fa-chart-bar', '暂无平仓数据');
    return;
  }

  // 按 closeType 分组
  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeType || '未标记';
    if (!groups[ct]) groups[ct] = [];
    groups[ct].push(closed[i]);
  }

  var totalClosed = closed.length;
  var profitTypes = ['initialTP', 'manualWin', 'partialTP'];
  var lossTypes = ['initialSL', 'trailingSL', 'manualLoss', 'liquidation', 'timeStop'];

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [], pcts = [];
  var keys = Object.keys(groups);

  // 按笔数降序
  keys.sort(function(a, b) { return groups[b].length - groups[a].length; });

  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    var count = groups[k].length;
    labels.push(CLOSE_TYPE_LABELS[k] || k);
    data.push(count);
    pcts.push((count / totalClosed * 100).toFixed(1));

    if (profitTypes.indexOf(k) !== -1) {
      bgColors.push(cc.barWin);
    } else if (lossTypes.indexOf(k) !== -1) {
      bgColors.push(cc.barLoss);
    } else {
      bgColors.push(cc.barNeutral);
    }
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  _analyticsCharts['closeTypeChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '笔数',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) { return ctx.parsed.y + ' 笔 (' + pcts[ctx.dataIndex] + '%)'; }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 12 }, maxRotation: 45 }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: {
            color: cc.tickColor,
            font: { size: 12 },
            stepSize: 1,
            callback: function(v) { return Number.isInteger(v) ? v : ''; }
          }
        }
      }
    },
    plugins: [{
      id: 'barLabels',
      afterDatasetsDraw: function(chart) {
        var ctx2 = chart.ctx;
        var meta = chart.getDatasetMeta(0);
        ctx2.save();
        ctx2.font = '10px sans-serif';
        ctx2.textAlign = 'center';
        ctx2.fillStyle = cc.canvasText;
        for (var i = 0; i < meta.data.length; i++) {
          var bar = meta.data[i];
          ctx2.fillText(data[i] + '笔', bar.x, bar.y - 14);
          ctx2.fillText(pcts[i] + '%', bar.x, bar.y - 2);
        }
        ctx2.restore();
      }
    }]
  });
}

function renderDimensionBreakdown(closed) {
  var wrap = document.getElementById('dimensionTableWrap');
  if (!wrap) return;
  if (closed.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:16px;">暂无平仓数据</div>';
    return;
  }

  // 三个维度：品种、方向、交易时段
  var dimensions = [
    { key: 'symbol', label: '品种' },
    { key: 'direction', label: '方向' },
    { key: 'session', label: '交易时段' }
  ];

  var allRows = [];
  for (var d = 0; d < dimensions.length; d++) {
    var dim = dimensions[d];
    var groups = groupByDimension(closed, dim.key);
    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
      var stats = computeGroupStats(groups[keys[k]]);
      stats.dimension = dim.label;
      stats.groupName = keys[k] || '—';
      allRows.push(stats);
    }
  }

  // 按总盈亏排序
  allRows.sort(function(a, b) { return b.totalPnl - a.totalPnl; });

  var html = '<table class="analytics-table"><thead><tr>' +
    '<th>维度</th><th>分组</th><th data-sort="num">笔数</th><th data-sort="num">胜率</th><th data-sort="num">总盈亏</th><th data-sort="num">均盈亏</th>' +
    '</tr></thead><tbody>';
  for (var r = 0; r < allRows.length; r++) {
    var row = allRows[r];
    var cls = row.totalPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg';
    html += '<tr>' +
      '<td style="color:var(--color-text-secondary);font-size:12px;">' + row.dimension + '</td>' +
      '<td>' + row.groupName + '</td>' +
      '<td class="col-num">' + row.count + '</td>' +
      '<td class="col-num">' + row.wr.toFixed(1) + '%</td>' +
      '<td class="' + cls + '">' + (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(2) + '</td>' +
      '<td class="' + cls + '">' + (row.avgPnl >= 0 ? '+' : '') + row.avgPnl.toFixed(2) + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ==================== 辅助 ====================

function ensureChartContainer(canvas) {
  // 确保 canvas 在 .chart-wrap 中
  if (!canvas.parentElement || !canvas.parentElement.classList.contains('chart-wrap')) {
    var wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    canvas.parentNode.insertBefore(wrap, canvas);
    wrap.appendChild(canvas);
  }
}

// ==================== 图表 7：日盈亏时序分布 ====================

function renderDailyPnlChart(closed) {
  var canvas = document.getElementById('chartDailyPnl');
  if (!canvas) return;

  // 按日期聚合
  var daily = {};
  for (var i = 0; i < closed.length; i++) {
    var d = fmtDate(closed[i].closeTime);
    if (!d || d === '—') continue;
    var pnl = safeParseNum(closed[i].pnlAmount) || 0;
    if (!daily[d]) daily[d] = { pnl: 0, count: 0, wins: 0 };
    daily[d].pnl += pnl;
    daily[d].count++;
    if (pnl > 0) daily[d].wins++;
  }

  var keys = Object.keys(daily).sort();
  if (keys.length === 0) {
    _setCanvasEmpty(canvas, 'fa-calendar-day', '暂无日级数据');
    return;
  }

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    labels.push(k.substring(5)); // MM-DD
    data.push(parseFloat(daily[k].pnl.toFixed(2)));
    bgColors.push(daily[k].pnl >= 0 ? cc.barWin : cc.barLoss);
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartDailyPnl'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '日盈亏 (USDT)',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            title: function(ctx) { return keys[ctx[0].dataIndex]; },
            label: function(ctx) {
              var k = keys[ctx.dataIndex];
              return '盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT · ' + daily[k].count + ' 笔';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 10 }, maxRotation: 45, maxTicksLimit: 15 }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 11 }, callback: function(v) { return v.toFixed(0); } }
        }
      }
    }
  });
}

// ==================== 图表 8：周几绩效分布 ====================

function renderDayOfWeekChart(closed) {
  var canvas = document.getElementById('chartDayOfWeek');
  if (!canvas) return;

  var dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var groups = {};
  for (var di = 0; di < 7; di++) {
    groups[di] = { pnl: 0, count: 0, wins: 0, losses: 0 };
  }

  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var d = new Date(ct);
    var dow = d.getDay(); // 0=Sun, 1=Mon...
    // 转换为周一=0...周日=6
    var adjustedDow = dow === 0 ? 6 : dow - 1;
    var pnl = safeParseNum(closed[i].pnlAmount) || 0;
    groups[adjustedDow].pnl += pnl;
    groups[adjustedDow].count++;
    if (pnl > 0) groups[adjustedDow].wins++;
    else if (pnl < 0) groups[adjustedDow].losses++;
  }

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var di = 0; di < 7; di++) {
    labels.push(dayLabels[di]);
    data.push(parseFloat(groups[di].pnl.toFixed(2)));
    var wr = groups[di].count > 0 ? (groups[di].wins / groups[di].count * 100) : 0;
    if (wr >= 60) bgColors.push(cc.barWin);
    else if (wr >= 40) bgColors.push(cc.barWarn);
    else bgColors.push(cc.barLoss);
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartDayOfWeek'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '周几盈亏 (USDT)',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              var di = ctx.dataIndex;
              var g = groups[di];
              var wr = g.count > 0 ? (g.wins / g.count * 100).toFixed(1) : '—';
              return '盈亏 ' + ctx.parsed.y.toFixed(2) + ' U · ' + g.count + ' 笔 · 胜率 ' + wr + '%';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 12 } }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 11 }, callback: function(v) { return v.toFixed(0); } }
        }
      }
    }
  });
}

// ==================== 图表 9：持仓时长分布直方图 ====================

function renderHoldDurationChart(closed) {
  var canvas = document.getElementById('chartHoldDuration');
  if (!canvas) return;

  // 只取有持仓时长的交易
  var hasDuration = false;
  for (var i = 0; i < closed.length; i++) {
    var hd = parseFloat(closed[i].holdDuration);
    if (!isNaN(hd) && hd > 0) { hasDuration = true; break; }
  }
  if (!hasDuration) {
    _setCanvasEmpty(canvas, 'fa-clock', '暂无持仓时长数据');
    return;
  }

  // 分箱：0-15m, 15m-1h, 1h-4h, 4h-12h, 12h-1d, 1d+
  var buckets = [
    { label: '<15m', min: 0, max: 15 },
    { label: '15m-1h', min: 15, max: 60 },
    { label: '1h-4h', min: 60, max: 240 },
    { label: '4h-12h', min: 240, max: 720 },
    { label: '12h-1d', min: 720, max: 1440 },
    { label: '>1d', min: 1440, max: Infinity }
  ];

  var counts = buckets.map(function() { return 0; });
  var pnlByBucket = buckets.map(function() { return { pnl: 0, wins: 0, count: 0 }; });

  // 直接遍历 closed 数组，避免 O(n²) 搜索和重复匹配
  for (var i = 0; i < closed.length; i++) {
    var hd = parseFloat(closed[i].holdDuration);
    if (isNaN(hd) || hd <= 0) continue;
    var pnl = safeParseNum(closed[i].pnlAmount) || 0;

    for (var b = 0; b < buckets.length; b++) {
      if (hd >= buckets[b].min && hd < buckets[b].max) {
        counts[b]++;
        pnlByBucket[b].pnl += pnl;
        pnlByBucket[b].count++;
        if (pnl > 0) pnlByBucket[b].wins++;
        break;
      }
    }
  }

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var b = 0; b < buckets.length; b++) {
    labels.push(buckets[b].label);
    data.push(counts[b]);
    var wr = pnlByBucket[b].count > 0 ? (pnlByBucket[b].wins / pnlByBucket[b].count * 100) : 0;
    if (wr >= 60) bgColors.push(cc.barWin);
    else if (wr >= 40) bgColors.push(cc.barWarn);
    else bgColors.push(cc.barLoss);
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartHoldDuration'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '笔数',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              var b = ctx.dataIndex;
              var total = counts.reduce(function(a, c) { return a + c; }, 0);
              var pct = total > 0 ? (counts[b] / total * 100).toFixed(1) : '0';
              var wr = pnlByBucket[b].count > 0 ? (pnlByBucket[b].wins / pnlByBucket[b].count * 100).toFixed(1) : '—';
              return '笔数 ' + counts[b] + ' (' + pct + '%) · 胜率 ' + wr + '%';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 11 } }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 11 }, stepSize: 1 }
        }
      }
    }
  });
}

// ==================== 图表 10：月度盈亏汇总 ====================

function renderMonthlyPnlChart(closed) {
  var canvas = document.getElementById('chartMonthlyPnl');
  if (!canvas) return;

  // 按年月聚合
  var monthly = {};
  for (var i = 0; i < closed.length; i++) {
    var d = fmtDate(closed[i].closeTime);
    if (!d || d === '—') continue;
    var ym = d.substring(0, 7); // YYYY-MM
    var pnl = safeParseNum(closed[i].pnlAmount) || 0;
    if (!monthly[ym]) monthly[ym] = { pnl: 0, count: 0, wins: 0 };
    monthly[ym].pnl += pnl;
    monthly[ym].count++;
    if (pnl > 0) monthly[ym].wins++;
  }

  var keys = Object.keys(monthly).sort();
  if (keys.length === 0) {
    _setCanvasEmpty(canvas, 'fa-calendar-alt', '暂无月度数据');
    return;
  }

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    labels.push(k);
    data.push(parseFloat(monthly[k].pnl.toFixed(2)));
    var wr = monthly[k].count > 0 ? (monthly[k].wins / monthly[k].count * 100) : 0;
    if (wr >= 60) bgColors.push(cc.barWin);
    else if (wr >= 40) bgColors.push(cc.barWarn);
    else bgColors.push(cc.barLoss);
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartMonthlyPnl'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '月盈亏 (USDT)',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              var k = keys[ctx.dataIndex];
              return '盈亏 ' + ctx.parsed.y.toFixed(2) + ' U · ' + monthly[k].count + ' 笔';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tickColor, font: { size: 10 }, maxRotation: 45, maxTicksLimit: 12 }
        },
        y: {
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 11 }, callback: function(v) { return v.toFixed(0); } }
        }
      }
    }
  });
}
