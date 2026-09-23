// ==================== 统计分析 ====================

// Chart.js 实例引用，切换视图时销毁重建
var _analyticsCharts = {};

/**
 * 销毁所有图表实例
 * 同时清理 ChartManager 注册，防止内存泄漏
 */
function destroyAnalyticsCharts() {
  var ids = ['chartEquity', 'chartStrategy', 'chartPattern', 'chartSession', 'chartMAEMFE', 'closeTypeChart',
             'chartDailyPnl', 'chartDayOfWeek', 'chartHoldDuration', 'chartMonthlyPnl',
             'chartMindsetPnl', 'chartMarketCondition'];
  for (var i = 0; i < ids.length; i++) {
    if (_analyticsCharts[ids[i]]) {
      // 优先通过 ChartManager 注销（若已注册）
      if (window.ChartManager) window.ChartManager.unregister(ids[i], true);
      _analyticsCharts[ids[i]].destroy();
      _analyticsCharts[ids[i]] = null;
    }
  }
  // 额外清理：通过 Chart.getChart 查找残留
  for (var j = 0; j < ids.length; j++) {
    var canvas = document.getElementById(ids[j]);
    if (canvas) {
      var existing = Chart.getChart(canvas);
      if (existing) {
        if (window.ChartManager) window.ChartManager.unregister(ids[j], true);
        existing.destroy();
      }
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
    ['renderDimensionBreakdown',function() { renderDimensionBreakdown(closed); }],
    ['renderMindsetAnalysis',   function() { renderMindsetAnalysis(closed); }],
    ['renderMarketConditionAnalysis', function() { renderMarketConditionAnalysis(closed); }]
  ];

  for (var i = 0; i < fns.length; i++) {
    try { fns[i][1](); } catch(e) {
      console.error('[analytics] ' + fns[i][0] + ' failed:', e);
    }
  }
  // 设计优化：统计指标区随 analytics 视图切换同步刷新
  // （原实现仅 renderLogs 调 updateStats，直接切到统计页会显示过期数据）
  try { updateStats(); } catch(e) {
    console.error('[analytics] updateStats failed:', e);
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

  // 取初始权益：从首笔已平仓日志的 capital 取，无则从 getAccountCapital() 兜底
  var sortedClosed = [...closed].sort(function(a, b) { return new Date(a.closeTime || a.time) - new Date(b.closeTime || b.time); });
  var capital = 0;
  if (sortedClosed.length > 0 && sortedClosed[0].capital != null && !isNaN(sortedClosed[0].capital) && sortedClosed[0].capital > 0) {
    capital = sortedClosed[0].capital;
  } else {
    var _eqCapital = getAccountCapital();
    if (_eqCapital != null && _eqCapital > 0) capital = _eqCapital;
  }

  // 检查设置中的 accountBalance 是否与推算值差异较大
  var _abSettings = null;
  try { _abSettings = loadSettings(); } catch(e) { console.error('[analytics]', e); }
  // 曲线实际起点口径：calcEquityCurve 优先用 settings.accountBalance，其次首笔 capital。
  // 提示文本必须与该优先级一致，否则用户看到"设置值 vs 日志推算值"却对不上曲线起点。
  var _curveUsesSettings = !!( _abSettings && _abSettings.accountBalance > 0 );
  var _noteSource = _curveUsesSettings
    ? (_abSettings.accountBalance).toFixed(2)
    : (capital > 0 ? capital.toFixed(2) : '0');
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
      _noteEl.textContent = '设置中账户余额: ' + _abSettings.accountBalance.toFixed(2) + ' USDT（曲线以此为准 · 日志推算: ' + (capital > 0 ? capital.toFixed(2) : '无') + ' USDT）';
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
  _analyticsCharts['chartEquity'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: _eqLabels,
      datasets: [createLineDataset('累计权益 (USDT)', _eqData, cc, {
        backgroundColor: function(context) {
          var chart = context.chart;
          var gctx = chart.ctx;
          var gradient = gctx.createLinearGradient(0, 0, 0, chart.height);
          // P3-18 FIX：原写死蓝色渐变，改读主题色并按 alpha 分档（不依赖 CSS alpha 字面值）
          gradient.addColorStop(0, withAlpha(cc.barWin, 0.2));
          gradient.addColorStop(1, withAlpha(cc.barWin, 0.02));
          return gradient;
        },
        pointBackgroundColor: cc.positivePoint,
        // P3-18 FIX：原硬编码白点描边在浅色主题下近乎隐形，改读主题变量
        pointBorderColor: readCssVar('--chart-canvas-ptcenter', 'rgba(255,255,255,0.6)'),
        pointBorderWidth: 1.5
      })]
    },
    options: createStandardOptions(cc, {
      plugins: {
        legend: { position: 'top', align: 'end' },
        tooltip: { callbacks: { label: function(ctx) { return ctx.parsed.y.toFixed(2) + ' USDT'; } } }
      },
      scales: {
        x: { grid: { color: cc.gridColor }, ticks: { maxTicksLimit: 12, font: { size: 12 }, maxRotation: 0 } },
        y: { grid: { color: cc.gridColor }, ticks: { font: { size: 12 }, callback: function(v) { return v.toFixed(0); } } }
      }
    })
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
    var sampleCount = trades.length;
    var winRate = sampleCount > 0 ? (wins / sampleCount * 100) : 0;

    rows.push({
      name: group.framework + ' - ' + group.patternName,
      framework: group.framework,
      patternName: group.patternName,
      count: trades.length,
      wins: wins,
      losses: losses,
      winRate: winRate,
      totalPnl: totalPnl,
      avgPnl: sampleCount > 0 ? totalPnl / sampleCount : 0,
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
      datasets: [createBarDataset('平均盈亏 (USDT)', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return '平均盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; } } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } } }
    })
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
  html += '<th data-col="avgMAE" data-sort="num">平均 MAE <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgMFE" data-sort="num">平均 MFE <span class="sort-arrow"></span></th>';
  html += '</tr></thead><tbody>';

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var rowClass = '';
    if (r === bestIdx && bestIdx !== worstIdx) rowClass = 'row-best';
    else if (r === worstIdx && bestIdx !== worstIdx) rowClass = 'row-worst';

    html += '<tr class="' + rowClass + '">';
    html += '<td>' + esc(row.framework) + '</td>';
    html += '<td>' + esc(row.patternName) + '</td>';
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
    var sampleCount = trades.length;
    var winRate = sampleCount > 0 ? (wins / sampleCount * 100) : 0;

    rows.push({
      name: k,
      count: trades.length,
      wins: wins,
      losses: losses,
      winRate: winRate,
      totalPnl: totalPnl,
      avgPnl: sampleCount > 0 ? totalPnl / sampleCount : 0,
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
    var otherSampleCount = othersList.length;
    var oWinRate = otherSampleCount > 0 ? (oWins / otherSampleCount * 100) : 0;
    rows.push({
      name: '其他 (单笔形态)',
      count: othersList.length,
      wins: oWins,
      winRate: oWinRate,
      totalPnl: oPnl,
      avgPnl: otherSampleCount > 0 ? oPnl / otherSampleCount : 0,
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
      datasets: [createBarDataset('平均盈亏 (USDT)', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return '平均盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; } } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } } }
    })
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
  html += '<th data-col="avgMAE" data-sort="num">平均 MAE <span class="sort-arrow"></span></th>';
  html += '<th data-col="avgMFE" data-sort="num">平均 MFE <span class="sort-arrow"></span></th>';
  html += '</tr></thead><tbody>';

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var rowClass = '';
    if (r === bestIdx && bestIdx !== worstIdx) rowClass = 'row-best';
    else if (r === worstIdx && bestIdx !== worstIdx) rowClass = 'row-worst';

    html += '<tr class="' + rowClass + '">';
    html += '<td>' + esc(row.name) + '</td>';
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
      datasets: [createBarDataset('总盈亏 (USDT)', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return '总盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; } } } },
      scales: { x: { grid: { display: false } } }
    })
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
  var scatterOpts = createStandardOptions(cc, {
    plugins: {
      legend: { position: 'top', labels: { font: { size: 13 }, padding: 16 } },
      tooltip: { callbacks: { label: function(ctx) { return 'MAE: ' + ctx.parsed.x.toFixed(2) + '% | MFE: ' + ctx.parsed.y.toFixed(2) + '%'; } } }
    },
    scales: {
      x: { title: { display: true, text: 'MAE %（绝对值）', color: cc.tickColor } },
      y: { title: { display: true, text: 'MFE %', color: cc.tickColor } }
    }
  });
  // FIX: 自定义插件挂载到 plugins 对象而非整体替换，保留上方 legend/tooltip 配置
  scatterOpts.plugins.idealZone = {
    id: 'idealZone',
    afterDraw: function(chart) {
      var ctx2 = chart.ctx;
      var xAxis = chart.scales.x;
      var yAxis = chart.scales.y;
      if (yAxis.max >= 5) {
        var xMin = xAxis.getPixelForValue(0);
        var xMax = xAxis.getPixelForValue(5);
        var yMin = yAxis.getPixelForValue(Math.min(5, yAxis.max));
        var yMax = yAxis.getPixelForValue(yAxis.max);
        ctx2.save();
        // P3-18 FIX：原用 c.up.replace('0.95', '0.06')，把透明度调整耦合到
        // --chart-canvas-up 当前的 alpha 字面值——CSS 一改 alpha 就静默失败，
        // "理想区域"会变成 0.95 不透明实心块盖住整个散点图。改为解析后重写 alpha
        ctx2.fillStyle = withAlpha(c.up, 0.06);
        ctx2.fillRect(xMin, yMin, xMax - xMin, yMax - yMin);
        ctx2.strokeStyle = withAlpha(c.up, 0.2);
        ctx2.lineWidth = 1;
        ctx2.setLineDash([6, 4]);
        ctx2.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
        ctx2.setLineDash([]);
        ctx2.fillStyle = withAlpha(c.up, 0.5);
        ctx2.font = '11px sans-serif';
        ctx2.textAlign = 'left';
        ctx2.fillText('理想区域', xMin + 6, yMin + 16);
        ctx2.restore();
      }
    }
  };
  _analyticsCharts['chartMAEMFE'] = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [createScatterDataset('盈利单', points.filter(function(p) { return p.isWin; }), cc.scatterWin),
                 createScatterDataset('亏损单', points.filter(function(p) { return !p.isWin; }), cc.scatterLoss)]
    },
    options: scatterOpts
  });
}

// ==================== 表格排序 ====================

/**
 * 绑定表格表头排序
 * @param {string} tableId 表格元素 id
 * @param {Array}  rows    行数据（不被原地排序，内部 slice 副本）
 * @param {function} [renderRow] 可选行渲染器 renderRow(row, rowClass) -> 完整 <tr> HTML。
 *                            传入时用它重排 tbody；省略则走策略/形态明细表的内置渲染器
 *                            （含 row-best/row-worst 高亮，仅这两张表有此语义）
 */
function bindTableSort(tableId, rows, renderRow) {
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

        // row-best/row-worst 高亮只有策略/形态明细表有语义（按 avgPnl 标出最佳/最差形态），
        // 其余表初始渲染时不带行高亮，排序重排时也不加
        var legacy = (tableId === 'strategyDetailTable' || tableId === 'patternDetailTable');
        var bestIdx = 0, worstIdx = 0;
        if (legacy && sorted.length > 1) {
          for (var r = 1; r < sorted.length; r++) {
            if (sorted[r].avgPnl > sorted[bestIdx].avgPnl) bestIdx = r;
            if (sorted[r].avgPnl < sorted[worstIdx].avgPnl) worstIdx = r;
          }
        }

        var isStrategyTable = (tableId === 'strategyDetailTable');
        var html = '';
        for (var j = 0; j < sorted.length; j++) {
          var row = sorted[j];
          var rowClass = '';
          if (legacy) {
            if (j === bestIdx && bestIdx !== worstIdx) rowClass = 'row-best';
            else if (j === worstIdx && bestIdx !== worstIdx) rowClass = 'row-worst';
          }

          if (typeof renderRow === 'function') {
            // 通用表：由调用方提供的行模板渲染（与初始渲染共用同一份，避免两处漂移）
            html += renderRow(row, rowClass);
          } else {
            html += '<tr class="' + rowClass + '">';
            if (isStrategyTable) {
              // strategyDetailTable: 9 列（framework + patternName 分列）
              html += '<td>' + esc(row.framework) + '</td>';
              html += '<td>' + esc(row.patternName) + '</td>';
            } else {
              // patternDetailTable: 8 列（name 合并列）
              html += '<td>' + esc(row.name) + '</td>';
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
  var sampleCount = trades.length;
  var wr = sampleCount > 0 ? (wins / sampleCount * 100) : 0;
  return { count: trades.length, wins, losses, totalPnl, avgPnl: sampleCount > 0 ? totalPnl / sampleCount : 0, winRate: wr };
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

    // 基于 closeType 硬分类 + 实际盈亏均值综合判断颜色
    // trailingSL 等类型按实际盈亏金额着色：盈利>0 则绿，否则红
    var groupPnl = 0;
    for (var gi = 0; gi < groups[k].length; gi++) {
      groupPnl += parseFloat(groups[k][gi].pnlAmount) || 0;
    }
    var avgPnl = count > 0 ? (groupPnl / count) : 0;

    if (profitTypes.indexOf(k) !== -1) {
      bgColors.push(cc.barWin);
    } else if (lossTypes.indexOf(k) !== -1) {
      // trailingSL 等如果整体平均盈利则视为盈利类型
      bgColors.push(avgPnl >= 0 ? cc.barWin : cc.barLoss);
    } else {
      bgColors.push(cc.barNeutral);
    }
  }

  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var ctx = canvas.getContext('2d');
  var barLabelOpts = createStandardOptions(cc, {
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ctx.parsed.y + ' 笔 (' + pcts[ctx.dataIndex] + '%)'; } } } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { ticks: { stepSize: 1, callback: function(v) { return Number.isInteger(v) ? v : ''; } } } }
  });
  // FIX: 自定义插件挂载到 plugins 对象而非整体替换，保留上方 tooltip（笔数+百分比）配置
  barLabelOpts.plugins.barLabels = {
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
  };
  _analyticsCharts['closeTypeChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [createBarDataset('笔数', data, cc, { backgroundColor: bgColors, borderRadius: 3 })]
    },
    options: barLabelOpts
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

  // P2-10 FIX：补 table id、data-col 与 sort-arrow——原表头只有 data-sort（无 data-col、
  // 无箭头 span）且从未经 bindTableSort 绑定，点击"笔数/胜率/总盈亏/均盈亏"无任何反应
  var html = '<table id="dimensionDetailTable" class="analytics-table"><thead><tr>' +
    '<th>维度</th><th>分组</th>' +
    '<th data-col="count" data-sort="num">笔数 <span class="sort-arrow"></span></th>' +
    '<th data-col="winRate" data-sort="num">胜率 <span class="sort-arrow"></span></th>' +
    '<th data-col="totalPnl" data-sort="num">总盈亏 <span class="sort-arrow"></span></th>' +
    '<th data-col="avgPnl" data-sort="num">均盈亏 <span class="sort-arrow"></span></th>' +
    '</tr></thead><tbody>';

  // 行渲染器：初始渲染与点击表头重排共用同一份单元格模板（避免两处漂移）
  var _dimRenderRow = function(row, rowClass) {
    var cls = row.totalPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg';
    return '<tr class="' + rowClass + '">' +
      '<td style="color:var(--color-text-secondary);font-size:12px;">' + esc(row.dimension) + '</td>' +
      '<td>' + esc(row.groupName) + '</td>' +
      '<td class="col-num">' + row.count + '</td>' +
      '<td class="col-num">' + row.winRate.toFixed(1) + '%</td>' +
      '<td class="' + cls + '">' + (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(2) + '</td>' +
      '<td class="' + cls + '">' + (row.avgPnl >= 0 ? '+' : '') + row.avgPnl.toFixed(2) + '</td>' +
      '</tr>';
  };

  for (var r = 0; r < allRows.length; r++) {
    html += _dimRenderRow(allRows[r], '');
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  bindTableSort('dimensionDetailTable', allRows, _dimRenderRow);
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
      datasets: [createBarDataset('日盈亏 (USDT)', data, cc, { backgroundColor: bgColors, borderRadius: 3 })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: function(ctx) { return keys[ctx[0].dataIndex]; }, label: function(ctx) { var k = keys[ctx.dataIndex]; return '盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT · ' + daily[k].count + ' 笔'; } } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45, maxTicksLimit: 15 } }, y: { ticks: { font: { size: 11 }, callback: function(v) { return v.toFixed(0); } } } }
    })
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

  // P2-9 FIX：空态走与同文件其他图表一致的空态——原实现在零数据时画 7 根高度 0 的柱子，
  // 且 wr=0 < 40 全部着色 barLoss，语义等于"周一至周日全是亏损日"
  var totalCount = 0;
  for (var dc = 0; dc < 7; dc++) totalCount += groups[dc].count;
  if (totalCount === 0) {
    _setCanvasEmpty(canvas, 'fa-calendar-alt', '暂无交易数据');
    return;
  }

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var di = 0; di < 7; di++) {
    labels.push(dayLabels[di]);
    data.push(parseFloat(groups[di].pnl.toFixed(2)));
    var groupCount = groups[di].count;
    var wr = groupCount > 0 ? (groups[di].wins / groupCount * 100) : 0;
    // P2-9 FIX：从未交易的某天（count=0）用中性色，不用 barLoss（那是"亏损日"语义）
    if (groupCount === 0) bgColors.push(cc.barNeutral);
    else if (wr >= 60) bgColors.push(cc.barWin);
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
      datasets: [createBarDataset('周几盈亏 (USDT)', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { var di = ctx.dataIndex; var g = groups[di]; var wr = g.count > 0 ? (g.wins / g.count * 100).toFixed(1) : '—'; return '盈亏 ' + ctx.parsed.y.toFixed(2) + ' U · ' + g.count + ' 笔 · 胜率 ' + wr + '%'; } } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: function(v) { return v.toFixed(0); } } } }
    })
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
  var pnlByBucket = buckets.map(function() { return { pnl: 0, wins: 0, losses: 0, count: 0 }; });

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
        else if (pnl < 0) pnlByBucket[b].losses++;
        break;
      }
    }
  }

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var b = 0; b < buckets.length; b++) {
    labels.push(buckets[b].label);
    data.push(counts[b]);
    var bucketCount = pnlByBucket[b].count;
    var wr = bucketCount > 0 ? (pnlByBucket[b].wins / bucketCount * 100) : 0;
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
      datasets: [createBarDataset('笔数', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { var b = ctx.dataIndex; var total = counts.reduce(function(a, c) { return a + c; }, 0); var pct = total > 0 ? (counts[b] / total * 100).toFixed(1) : '0'; var wr = pnlByBucket[b].count > 0 ? (pnlByBucket[b].wins / pnlByBucket[b].count * 100).toFixed(1) : '—'; return '笔数 ' + counts[b] + ' (' + pct + '%) · 胜率 ' + wr + '%'; } } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { stepSize: 1 } } }
    })
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
    if (!monthly[ym]) monthly[ym] = { pnl: 0, count: 0, wins: 0, losses: 0 };
    monthly[ym].pnl += pnl;
    monthly[ym].count++;
    if (pnl > 0) monthly[ym].wins++;
    else if (pnl < 0) monthly[ym].losses++;
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
    var monthCount = monthly[k].count;
    var wr = monthCount > 0 ? (monthly[k].wins / monthCount * 100) : 0;
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
      datasets: [createBarDataset('月盈亏 (USDT)', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { var k = keys[ctx.dataIndex]; return '盈亏 ' + ctx.parsed.y.toFixed(2) + ' U · ' + monthly[k].count + ' 笔'; } } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45, maxTicksLimit: 12 } }, y: { ticks: { callback: function(v) { return v.toFixed(0); } } } }
    })
  });
}

// ==================== P0 心态-绩效关联分析 ====================

function renderMindsetAnalysis(closed) {
  var canvas = document.getElementById('chartMindsetPnl');
  var tableEl = document.getElementById('mindsetTableWrap');
  if (!canvas || !tableEl) return;

  // 按心态评分分组
  var mindsetStats = {};
  for (var i = 0; i < closed.length; i++) {
    var ms = closed[i].mindsetScore;
    if (ms == null || ms < 1 || ms > 5) continue;
    var pnl = safeParseNum(closed[i].pnlAmount);
    if (pnl == null) continue;

    if (!mindsetStats[ms]) {
      mindsetStats[ms] = { count: 0, wins: 0, losses: 0, totalPnl: 0 };
    }
    mindsetStats[ms].count++;
    mindsetStats[ms].totalPnl += pnl;
    if (pnl > 0) mindsetStats[ms].wins++;
    else if (pnl < 0) mindsetStats[ms].losses++;
  }

  var keys = Object.keys(mindsetStats).map(Number).sort(function(a, b) { return a - b; });
  var totalClosed = closed.length;
  var withMindset = closed.filter(function(l) { return l.mindsetScore != null; }).length;
  if (keys.length === 0) {
    var msg = '暂无心态评分数据';
    if (totalClosed > 0) {
      msg += '（共 ' + totalClosed + ' 笔已平仓，其中 ' + withMindset + ' 笔有心态评分）';
    } else {
      msg += '，请先完成至少一笔交易并记录心态评分';
    }
    _setCanvasEmpty(canvas, 'fa-brain', msg);
    if (tableEl) tableEl.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:16px;">' + msg + '</div>';
    return;
  }

  // 计算整体基准
  var overallWins = 0, overallLosses = 0, overallPnl = 0;
  for (var k = 0; k < keys.length; k++) {
    var s = mindsetStats[keys[k]];
    overallWins += s.wins;
    overallLosses += s.losses;
    overallPnl += s.totalPnl;
  }
  // 口径修复（2026-09-07）：整体基准的胜率/均盈亏分母改为含保本总笔数，
  // 与各分组（wins/count）一致——原实现用 wins+losses 分母导致
  // "vs整体"偏差的基准与组内胜率口径错位（复盘中心执行质量分析已修，此为同类遗漏）。
  var overallDecided = keys.reduce(function(s, k) { return s + mindsetStats[k].count; }, 0);
  var overallWinRate = overallDecided > 0 ? (overallWins / overallDecided * 100) : 0;
  var overallAvgPnl = overallDecided > 0 ? (overallPnl / overallDecided) : 0;

  // 计算相关性
  var totalTrades = keys.reduce(function(s, k) { return s + mindsetStats[k].count; }, 0);
  var meanX = keys.reduce(function(sum, k) { return sum + k * mindsetStats[k].count; }, 0) / totalTrades;
  // 修复口径：相关性基准的 meanY 与 meanX 同用含保本总笔数分母
  // （原实现用 overallAvgPnl（wins+losses 分母）导致两组分的平均盈亏基准不一致）
  var meanY = totalTrades > 0 ? (overallPnl / totalTrades) : 0;
  var num = 0, denX = 0, denY = 0;
  for (var k = 0; k < keys.length; k++) {
    var score = keys[k];  // 修复：使用 keys[k] 作为键值
    var s = mindsetStats[score];
    var x = score - meanX;
    var y = (s.totalPnl / s.count) - meanY;
    num += x * y * s.count;
    denX += x * x * s.count;
    denY += y * y * s.count;
  }
  var correlation = denX > 0 && denY > 0 ? (num / Math.sqrt(denX * denY)) : 0;

  var corrDesc = '';
  var corrColor = '';
  if (totalTrades < 5) {
    corrDesc = '样本不足';
    corrColor = 'var(--color-text-muted)';
  } else if (correlation > 0.3) {
    corrDesc = '强正相关 (' + correlation.toFixed(2) + ')';
    corrColor = 'var(--color-success)';
  } else if (correlation > 0.1) {
    corrDesc = '弱正相关 (' + correlation.toFixed(2) + ')';
    corrColor = 'var(--color-warning)';
  } else if (correlation < -0.3) {
    corrDesc = '强负相关 (' + correlation.toFixed(2) + ')';
    corrColor = 'var(--color-danger)';
  } else if (correlation < -0.1) {
    corrDesc = '弱负相关 (' + correlation.toFixed(2) + ')';
    corrColor = 'var(--color-warning)';
  } else {
    corrDesc = '无明显相关 (' + correlation.toFixed(2) + ')';
    corrColor = 'var(--color-text-muted)';
  }

  // 绘制图表
  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var cc = utils.getChartColors();
  var labels = [], avgPnlData = [], winRateData = [], countData = [];
  for (var k = 0; k < keys.length; k++) {
    var score = keys[k];
    var s = mindsetStats[score];
    labels.push(score + '分');
    var avgPnl = s.count > 0 ? (s.totalPnl / s.count) : 0;
    // P1-2 FIX：胜率分母为该评分全部已平仓（含保本）
    var wr = s.count > 0 ? (s.wins / s.count * 100) : 0;
    avgPnlData.push(parseFloat(avgPnl.toFixed(2)));
    winRateData.push(parseFloat(wr.toFixed(1)));
    countData.push(s.count);
  }

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartMindsetPnl'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        createBarDataset('平均盈亏 (USDT)', avgPnlData, cc, { backgroundColor: avgPnlData.map(function(v) { return v >= 0 ? cc.barWin : cc.barLoss; }), yAxisID: 'y' }),
        createLineDataset('胜率 (%)', winRateData, cc, { type: 'line', yAxisID: 'y1' })
      ]
    },
    options: createStandardOptions(cc, {
      plugins: { tooltip: { callbacks: { afterLabel: function(ctx) { return '笔数: ' + countData[ctx.dataIndex]; } } } },
      scales: {
        y: { position: 'left', ticks: { callback: function(v) { return v.toFixed(0); } }, title: { display: true, text: '平均盈亏 (USDT)', color: cc.tickColor } },
        y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: function(v) { return v + '%'; } }, title: { display: true, text: '胜率', color: cc.tickColor }, min: 0, max: 100 }
      }
    })
  });

  // 绘制表格
  var tHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
  tHtml += '<div style="flex:1;min-width:200px;background:var(--color-surface);border-radius:8px;padding:12px;">';
  tHtml += '<div style="font-size:11px;color:var(--color-text-muted);">整体基准</div>';
  tHtml += '<div style="font-size:18px;font-weight:600;color:' + (overallAvgPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)') + ';">';
  tHtml += (overallAvgPnl >= 0 ? '+' : '') + overallAvgPnl.toFixed(2) + ' USDT</div>';
  tHtml += '<div style="font-size:12px;color:var(--color-text-muted);">胜率 ' + overallWinRate.toFixed(1) + '% · ' + overallDecided + ' 笔</div>';
  tHtml += '</div>';
  tHtml += '<div style="flex:1;min-width:200px;background:var(--color-surface);border-radius:8px;padding:12px;">';
  tHtml += '<div style="font-size:11px;color:var(--color-text-muted);">相关性</div>';
  tHtml += '<div style="font-size:18px;font-weight:600;color:' + corrColor + ';">' + corrDesc + '</div>';
  tHtml += '<div style="font-size:12px;color:var(--color-text-muted);">心态评分 vs 平均盈亏</div>';
  tHtml += '</div>';
  tHtml += '</div>';

  tHtml += '<div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px;">各评分详细统计：</div>';
  tHtml += '<table id="mindsetDetailTable" class="analytics-table"><thead><tr>' +
    '<th>心态评分</th><th data-col="count" data-sort="num">笔数 <span class="sort-arrow"></span></th>' +
    '<th data-col="wins" data-sort="num">盈利/亏损 <span class="sort-arrow"></span></th>' +
    '<th data-col="winRate" data-sort="num">胜率 <span class="sort-arrow"></span></th>' +
    '<th data-col="avgPnl" data-sort="num">平均盈亏 <span class="sort-arrow"></span></th>' +
    '<th data-col="wrDev" data-sort="num">vs整体 <span class="sort-arrow"></span></th></tr></thead><tbody>';

  // 行渲染器：初始渲染与点击表头重排共用同一份单元格模板（避免两处漂移）
  var _mindsetRenderRow = function(row, rowClass) {
    var wrClass = row.wrDev > 0 ? 'col-pnl-pos' : (row.wrDev < 0 ? 'col-pnl-neg' : '');
    var devHtml = row.count < 2 ? '<span style="color:var(--color-text-muted);">样本不足</span>' :
      '<span class="' + wrClass + '">' + (row.wrDev >= 0 ? '+' : '') + row.wrDev.toFixed(1) + '%</span>';
    var pnlClass = row.avgPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg';
    return '<tr class="' + rowClass + '">' +
      '<td style="text-align:center;font-weight:600;">' + esc(row.score) + ' <span style="font-size:11px;color:var(--color-text-muted);">/5</span></td>' +
      '<td class="col-num">' + row.count + '</td>' +
      '<td class="col-num">' + row.wins + '/' + row.losses + '</td>' +
      '<td class="col-num">' + row.winRate.toFixed(1) + '%</td>' +
      '<td class="' + pnlClass + '">' + (row.avgPnl >= 0 ? '+' : '') + row.avgPnl.toFixed(2) + '</td>' +
      '<td style="text-align:right;">' + devHtml + '</td>' +
      '</tr>';
  };

  var _mindsetRows = [];
  for (var k = 0; k < keys.length; k++) {
    var score = keys[k];
    var s = mindsetStats[score];
    var avgPnl = s.count > 0 ? (s.totalPnl / s.count) : 0;
    // P1-2 FIX：胜率分母为该评分全部已平仓（含保本）
    var wr = s.count > 0 ? (s.wins / s.count * 100) : 0;
    var wrDev = wr - overallWinRate;
    _mindsetRows.push({ score: score, count: s.count, wins: s.wins, losses: s.losses, winRate: wr, avgPnl: avgPnl, wrDev: wrDev });
  }
  for (var mi = 0; mi < _mindsetRows.length; mi++) {
    tHtml += _mindsetRenderRow(_mindsetRows[mi], '');
  }
  tHtml += '</tbody></table>';
  tHtml += '<p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">注：vs整体表示该评分的胜率与整体胜率的偏差。</p>';
  tableEl.innerHTML = tHtml;
  // P2-10 FIX：表头早已带 data-col/data-sort 与箭头 span，却从未经 bindTableSort 绑定
  //（表格无 id 无法按 id 绑定），点击排序无反应
  bindTableSort('mindsetDetailTable', _mindsetRows, _mindsetRenderRow);
}

// ==================== P0 市场环境交叉分析 ====================

function renderMarketConditionAnalysis(closed) {
  var canvas = document.getElementById('chartMarketCondition');
  var tableEl = document.getElementById('marketConditionTableWrap');
  if (!canvas || !tableEl) return;

  // 按市场环境分组
  var sessionLabelMap = {
    'asia': '亚盘', 'europe': '欧盘', 'us': '美盘',
    'overlap': '重叠时段', 'allday': '全天', '未标记': '未标记'
  };
  var marketStats = {};
  for (var i = 0; i < closed.length; i++) {
    var mc = getMarketConditionLabel(closed[i].marketCondition);
    var session = sessionLabelMap[closed[i].session] || closed[i].session || '未标记';
    var dir = closed[i].direction || '未标记';
    var pnl = safeParseNum(closed[i].pnlAmount);
    if (pnl == null) continue;

    var key = mc + ' | ' + session + ' | ' + (dir === 'long' ? '多' : '空');
    if (!marketStats[key]) {
      marketStats[key] = { marketCondition: mc, session: session, direction: dir, count: 0, wins: 0, losses: 0, totalPnl: 0 };
    }
    marketStats[key].count++;
    marketStats[key].totalPnl += pnl;
    if (pnl > 0) marketStats[key].wins++;
    else if (pnl < 0) marketStats[key].losses++;
  }

  var keys = Object.keys(marketStats);
  if (keys.length === 0) {
    var totalClosed = closed.length;
    var withMarket = closed.filter(function(l) { return l.marketCondition && getMarketConditionLabel(l.marketCondition) !== '—'; }).length;
    var msg = '暂无市场环境数据';
    if (totalClosed > 0) {
      msg += '（共 ' + totalClosed + ' 笔已平仓，其中 ' + withMarket + ' 笔有市场环境记录，但均缺少盈亏数据）';
    } else {
      msg += '，请先完成至少一笔交易并记录市场环境';
    }
    _setCanvasEmpty(canvas, 'fa-cloud-sun', msg);
    if (tableEl) tableEl.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:16px;">' + msg + '</div>';
    return;
  }

  // 转换数据
  var rows = [];
  for (var k = 0; k < keys.length; k++) {
    var s = marketStats[keys[k]];
    // P1-2 FIX：胜率分母为该组合全部已平仓（含保本）
    var wr = s.count > 0 ? (s.wins / s.count * 100) : 0;
    var avgPnl = s.count > 0 ? (s.totalPnl / s.count) : 0;
    rows.push({
      key: keys[k],
      marketCondition: s.marketCondition,
      session: s.session,
      direction: s.direction,
      count: s.count,
      wins: s.wins,
      losses: s.losses,
      winRate: wr,
      totalPnl: s.totalPnl,
      avgPnl: avgPnl
    });
  }

  // 按总盈亏排序
  rows.sort(function(a, b) { return b.totalPnl - a.totalPnl; });

  // 显示所有组合（包括单笔），但用小样本标记提醒
  var validRows = rows; // 不过滤，全部显示
  if (validRows.length === 0) {
    _setCanvasEmpty(canvas, 'fa-cloud-sun', '暂无市场环境数据');
    if (tableEl) tableEl.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:16px;">暂无市场环境数据</div>';
    return;
  }

  // 绘制图表（显示前10）
  _clearCanvasEmpty(canvas);
  ensureChartContainer(canvas);

  var cc = utils.getChartColors();
  var topRows = validRows.slice(0, 10);
  var labels = [], data = [], bgColors = [];
  for (var i = 0; i < topRows.length; i++) {
    var r = topRows[i];
    // P3-15 FIX：方向改用中文映射，与 :1399 的分组 key 及全站口径一致
    // （原直接拼 r.direction 原始值 long/short，x 轴出现"强趋势 亚盘 long"中英混排）
    var shortKey = (r.marketCondition.length > 4 ? r.marketCondition.substring(0, 4) + '…' : r.marketCondition) + ' ' + (r.session.length > 2 ? r.session.substring(0, 2) + '…' : r.session) + ' ' + (r.direction === 'long' ? '多' : '空');
    labels.push(shortKey);
    data.push(parseFloat(r.avgPnl.toFixed(2)));
    bgColors.push(r.avgPnl >= 0 ? cc.barWin : cc.barLoss);
  }

  var ctx = canvas.getContext('2d');
  _analyticsCharts['chartMarketCondition'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [createBarDataset('平均盈亏 (USDT)', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: function(ctx) { return topRows[ctx[0].dataIndex].key; }, label: function(ctx) { var r = topRows[ctx.dataIndex]; return '平均盈亏 ' + ctx.parsed.x.toFixed(2) + ' U · 胜率 ' + r.winRate.toFixed(1) + '% · ' + r.count + ' 笔'; } } } },
      scales: { x: { ticks: { callback: function(v) { return v.toFixed(0); } } }, y: { grid: { display: false } } }
    })
  });

  // 绘制表格
  // P3-15 FIX：去掉"（样本≥2）"——上方 validRows 就是全部组合（不过滤），文案与实际不符
  var tHtml = '<div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px;">环境×时段×方向 交叉分析：</div>';
  tHtml += '<table id="marketConditionDetailTable" class="analytics-table"><thead><tr>' +
    '<th>市场环境</th><th>时段</th><th>方向</th><th data-col="count" data-sort="num">笔数 <span class="sort-arrow"></span></th>' +
    '<th data-col="winRate" data-sort="num">胜率 <span class="sort-arrow"></span></th>' +
    '<th data-col="totalPnl" data-sort="num">总盈亏 <span class="sort-arrow"></span></th>' +
    '<th data-col="avgPnl" data-sort="num">平均盈亏 <span class="sort-arrow"></span></th></tr></thead><tbody>';

  // 行渲染器：初始渲染与点击表头重排共用同一份单元格模板（避免两处漂移）
  var _marketRenderRow = function(row, rowClass) {
    var pnlClass = row.totalPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg';
    var wrClass = row.winRate >= 50 ? 'col-pnl-pos' : 'col-pnl-neg';
    var sampleNote = row.count < 2 ? ' <span style="font-size:10px;color:var(--color-text-muted);">(n=' + row.count + ')</span>' : '';
    return '<tr class="' + rowClass + '">' +
      '<td>' + esc(row.marketCondition) + sampleNote + '</td>' +
      '<td>' + esc(row.session) + '</td>' +
      '<td>' + esc(row.direction === 'long' ? '多' : '空') + '</td>' +
      '<td class="col-num">' + row.count + '</td>' +
      '<td class="col-num ' + wrClass + '">' + row.winRate.toFixed(1) + '%</td>' +
      '<td class="' + pnlClass + '">' + (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(2) + '</td>' +
      '<td class="' + pnlClass + '">' + (row.avgPnl >= 0 ? '+' : '') + row.avgPnl.toFixed(2) + '</td>' +
      '</tr>';
  };

  for (var i = 0; i < validRows.length; i++) {
    tHtml += _marketRenderRow(validRows[i], '');
  }
  tHtml += '</tbody></table>';
  tHtml += '<p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">注：显示所有组合，单笔交易结果仅供参考，样本≥2的结果更可靠。</p>';
  tableEl.innerHTML = tHtml;
  // P2-10 FIX：表头早已带 data-col/data-sort 与箭头 span，却从未经 bindTableSort 绑定
  bindTableSort('marketConditionDetailTable', validRows, _marketRenderRow);
}
