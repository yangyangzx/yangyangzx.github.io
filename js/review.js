// ==================== 复盘中心 ====================
// 基于全局 logs 数据，对亏损订单进行多维度分析与可视化展示

var _reviewCharts = {};

/**
 * 销毁复盘页面的所有图表实例
 */
function destroyReviewCharts() {
  var ids = ['chartLossReason', 'chartStrategyRank', 'chartOrderType', 'chartEmotion', 'chartExecutionQuality'];
  for (var i = 0; i < ids.length; i++) {
    if (_reviewCharts[ids[i]]) {
      _reviewCharts[ids[i]].destroy();
      _reviewCharts[ids[i]] = null;
    }
  }
  // 额外清理：通过 Chart.getChart 查找残留
  for (var j = 0; j < ids.length; j++) {
    var canvas = document.getElementById(ids[j]);
    if (canvas) {
      var existing = Chart.getChart(canvas);
      if (existing) existing.destroy();
    }
  }
}

// ==================== 数据辅助 ====================

function getClosedTrades() {
  return getClosedSorted();
}

/**
 * 空状态降级：隐藏 canvas 并插入空状态提示
 */
function _setReviewEmpty(canvas, message) {
  canvas.style.display = 'none';
  var emptyId = canvas.id + '__empty';
  var empty = document.getElementById(emptyId);
  if (!empty) {
    empty = document.createElement('div');
    empty.id = emptyId;
    empty.className = 'review-empty';
    empty.innerHTML = '<div class="review-empty-icon"><i class="fas fa-clipboard-check"></i></div><div>' + message + '</div>';
    canvas.parentElement.appendChild(empty);
  }
}

function _clearReviewEmpty(canvas) {
  var empty = document.getElementById(canvas.id + '__empty');
  if (empty) empty.remove();
  canvas.style.display = '';
}

// ==================== 主入口 ====================

function renderReview() {
  destroyReviewCharts();

  var closed = getClosedTrades();
  renderLossReasonPie(closed);
  renderStrategyRank(closed);
  renderOrderTypeChart(closed);
  renderEmotionAnalysis(closed);
  renderExecutionQuality(closed);
}

// ==================== 卡片 1：亏损原因分布（环形图） ====================

function renderLossReasonPie(closed) {
  var canvas = document.getElementById('chartLossReason');
  if (!canvas) return;

  var losses = [];
  for (var i = 0; i < closed.length; i++) {
    if (closed[i].pnlAmount != null && parseFloat(closed[i].pnlAmount) < 0) losses.push(closed[i]);
  }

  if (losses.length === 0) {
    _setReviewEmpty(canvas, '暂无亏损交易');
    return;
  }

  // 按 lossReason 展开统计（一笔交易可能有多个原因）
  var reasonCount = {};
  var reasonPnl = {};
  for (var j = 0; j < losses.length; j++) {
    var reasons = losses[j].lossReason;
    if (Array.isArray(reasons) && reasons.length > 0) {
      for (var k = 0; k < reasons.length; k++) {
        var r = reasons[k];
        reasonCount[r] = (reasonCount[r] || 0) + 1;
        reasonPnl[r] = (reasonPnl[r] || 0) + parseFloat(losses[j].pnlAmount);
      }
    } else {
      reasonCount['未标记'] = (reasonCount['未标记'] || 0) + 1;
      reasonPnl['未标记'] = (reasonPnl['未标记'] || 0) + parseFloat(losses[j].pnlAmount);
    }
  }

  var keys = Object.keys(reasonCount);
  if (keys.length === 0) {
    _setReviewEmpty(canvas, '亏损原因数据为空');
    return;
  }

  _clearReviewEmpty(canvas);

  var cc = utils.getChartColors();
  var redPalette = [
    'rgba(239,68,68,0.9)', 'rgba(239,68,68,0.75)', 'rgba(239,68,68,0.6)',
    'rgba(220,38,38,0.9)', 'rgba(185,28,28,0.85)', 'rgba(153,27,27,0.8)',
    'rgba(127,29,29,0.75)', 'rgba(249,115,22,0.7)', 'rgba(234,88,12,0.65)',
    'rgba(194,65,12,0.6)'
  ];

  var labels = [], data = [], bgColors = [];
  for (var m = 0; m < keys.length; m++) {
    labels.push(keys[m]);
    data.push(reasonCount[keys[m]]);
    bgColors.push(redPalette[m % redPalette.length]);
  }

  var ctx = canvas.getContext('2d');
  _reviewCharts['chartLossReason'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ data: data, backgroundColor: bgColors, borderColor: cc.barBorder, borderWidth: 3 }]
    },
    options: createStandardOptions(cc, {
      plugins: {
        legend: { position: 'right', labels: { font: { size: 12 }, padding: 12, usePointStyle: true, pointStyleWidth: 10 } },
        tooltip: { callbacks: { label: function(ctx) { var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0); var pct = ((ctx.parsed / total) * 100).toFixed(1); var pnl = reasonPnl[ctx.label] || 0; return ctx.label + ': ' + ctx.parsed + ' 次 (' + pct + '%)  累计 ' + pnl.toFixed(0) + ' USDT'; } } }
      },
      cutout: '55%'
    })
  });
}

// ==================== 卡片 2：策略框架排名（柱状图 + 排名榜） ====================

function renderStrategyRank(closed) {
  var canvas = document.getElementById('chartStrategyRank');
  if (!canvas) return;
  var listEl = document.getElementById('strategyRankList');

  if (closed.length === 0) {
    _setReviewEmpty(canvas, '暂无已平仓交易');
    if (listEl) listEl.innerHTML = '';
    return;
  }

  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var key = closed[i].strategyFramework && closed[i].strategyFramework.trim() !== '' ?
      closed[i].strategyFramework : '未分类';
    if (!groups[key]) groups[key] = [];
    groups[key].push(closed[i]);
  }

  var rows = [];
  var keys = Object.keys(groups);
  for (var j = 0; j < keys.length; j++) {
    var trades = groups[keys[j]];
    var wins = 0, losses = 0, totalPnl = 0, winSum = 0, lossSum = 0;
    for (var t = 0; t < trades.length; t++) {
      var pnl = safeParseNum(trades[t].pnlAmount);
      totalPnl += pnl;
      if (pnl > 0) { wins++; winSum += pnl; }
      else if (pnl < 0) { losses++; lossSum += Math.abs(pnl); }
    }
    var decidedCnt = wins + losses;
    rows.push({
      name: keys[j],
      count: trades.length,
      wins: wins,
      losses: losses,
      winRate: decidedCnt > 0 ? (wins / decidedCnt * 100) : 0,
      totalPnl: totalPnl,
      avgWin: wins > 0 ? winSum / wins : 0,
      avgLoss: losses > 0 ? lossSum / losses : 0
    });
  }

  rows.sort(function(a, b) { return b.totalPnl - a.totalPnl; });

  _clearReviewEmpty(canvas);

  var cc = utils.getChartColors();
  var labels = [], data = [], bgColors = [];
  for (var r = 0; r < rows.length; r++) {
    labels.push(rows[r].name.length > 12 ? rows[r].name.substring(0, 11) + '…' : rows[r].name);
    data.push(parseFloat(rows[r].totalPnl.toFixed(2)));
    bgColors.push(rows[r].totalPnl >= 0 ? cc.barWin : cc.barLoss);
  }

  var ctx = canvas.getContext('2d');
  _reviewCharts['chartStrategyRank'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [createBarDataset('总盈亏 (USDT)', data, cc, { backgroundColor: bgColors })]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return '总盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; } } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } } }
    })
  });

  // 渲染排名榜
  if (!listEl) return;
  var listHtml = '<div class="strategy-rank-list">';
  for (var rd = 0; rd < rows.length; rd++) {
    var row = rows[rd];
    var rankClass = (rd === 0) ? ' rank-1' : '';
    listHtml += '<div class="strategy-rank-item' + rankClass + '">';
    listHtml += '<span class="strategy-rank-badge">' + (rd + 1) + '</span>';
    listHtml += '<span class="strategy-rank-name" title="' + esc(row.name) + '">' + esc(row.name);
    if (row.count < 3) listHtml += ' <span style="font-size:10px;color:var(--color-text-muted);">(样本不足)</span>';
    listHtml += '</span>';
    listHtml += '<span class="strategy-rank-pnl ' + (row.totalPnl >= 0 ? 'risk-safe' : 'risk-danger') + '">' +
      (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(0) + ' USDT</span>';
    listHtml += '<span class="strategy-rank-meta">胜率 ' + row.winRate.toFixed(0) + '% · ' + row.count + '笔</span>';
    listHtml += '</div>';
  }
  listHtml += '</div>';
  listEl.innerHTML = listHtml;
}

// ==================== 卡片 3：订单类型胜率分析（柱状图） ====================

function renderOrderTypeChart(closed) {
  var canvas = document.getElementById('chartOrderType');
  if (!canvas) return;

  if (!closed || closed.length === 0) {
    _setReviewEmpty(canvas, '暂无交易数据');
    return;
  }

  // 按 direction + orderType 分组
  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var dir = (closed[i].direction || 'unknown').toUpperCase();
    var ot = closed[i].orderType || 'market';
    var key = dir + ' ' + ot;
    if (!groups[key]) groups[key] = { total: 0, wins: 0, losses: 0, pnlTotal: 0 };
    groups[key].total++;
    var pnl = parseFloat(closed[i].pnlAmount) || 0;
    if (pnl > 0) groups[key].wins++;
    else if (pnl < 0) groups[key].losses++;
    groups[key].pnlTotal += pnl;
  }

  var keys = Object.keys(groups);
  if (keys.length === 0) {
    _setReviewEmpty(canvas, '无订单类型数据');
    return;
  }

  _clearReviewEmpty(canvas);

  var cc = utils.getChartColors();
  var labels = [], wrData = [], pnlData = [];
  for (var j = 0; j < keys.length; j++) {
    var g = groups[keys[j]];
    var decided = g.wins + g.losses; // 排除 break-even，与全局口径一致
    labels.push(keys[j] + ' (' + g.total + ')');
    wrData.push(decided > 0 ? parseFloat((g.wins / decided * 100).toFixed(1)) : 0);
    pnlData.push(parseFloat(g.pnlTotal.toFixed(2)));
  }

  var wrColors = wrData.map(function(v) { return v >= 50 ? cc.barWin : cc.barLoss; });

  var ctx = canvas.getContext('2d');
  _reviewCharts['chartOrderType'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '胜率 %',
        data: wrData,
        backgroundColor: wrColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder
      }]
    },
    options: createStandardOptions(cc, {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { var idx = ctx.dataIndex; return '胜率: ' + wrData[idx].toFixed(1) + '% | 盈亏: ' + (pnlData[idx] >= 0 ? '+' : '') + pnlData[idx].toFixed(2) + ' USDT'; } } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { beginAtZero: true, max: 100, ticks: { callback: function(v) { return v + '%'; } } } }
    })
  });
}

// ==================== 卡片 4：交易情绪关联（分组柱状图 + 表格） ====================

function renderEmotionAnalysis(closed) {
  var canvas = document.getElementById('chartEmotion');
  if (!canvas) return;
  var tableEl = document.getElementById('emotionTableWrap');

  // 收集每个情绪标签对应的盈亏数据
  var emotionStats = {};
  for (var i = 0; i < closed.length; i++) {
    var emotions = closed[i].emotions;
    var pnl = safeParseNum(closed[i].pnlAmount);
    if (pnl == null || isFinite(pnl) === false) continue;

    if (Array.isArray(emotions) && emotions.length > 0) {
      for (var j = 0; j < emotions.length; j++) {
        var em = emotions[j];
        if (!emotionStats[em]) emotionStats[em] = { count: 0, wins: 0, losses: 0, totalPnl: 0 };
        emotionStats[em].count++;
        emotionStats[em].totalPnl += pnl;
        if (pnl > 0) emotionStats[em].wins++;
        else if (pnl < 0) emotionStats[em].losses++;
      }
    } else {
      if (!emotionStats['未标记']) emotionStats['未标记'] = { count: 0, wins: 0, losses: 0, totalPnl: 0 };
      emotionStats['未标记'].count++;
      emotionStats['未标记'].totalPnl += pnl;
      if (pnl > 0) emotionStats['未标记'].wins++;
      else if (pnl < 0) emotionStats['未标记'].losses++;
    }
  }

  var keys = Object.keys(emotionStats);
  if (keys.length === 0 || (keys.length === 1 && keys[0] === '未标记')) {
    _setReviewEmpty(canvas, '暂无情绪标签数据');
    if (tableEl) tableEl.innerHTML = '';
    return;
  }

  // 计算整体胜率作为基准
  var overallWins = 0, overallTotal = 0;
  for (var k = 0; k < closed.length; k++) {
    var p = safeParseNum(closed[k].pnlAmount);
    if (p != null && isFinite(p)) {
      overallTotal++;
      if (p > 0) overallWins++;
    }
  }
  var overallWinRate = overallTotal > 0 ? (overallWins / overallTotal * 100) : 0;

  // 按亏损次数降序排序（亏损关联最强的在前）
  keys.sort(function(a, b) {
    return emotionStats[b].losses - emotionStats[a].losses;
  });

  _clearReviewEmpty(canvas);

  var cc = utils.getChartColors();
  var labels = [], winData = [], lossData = [];
  for (var m = 0; m < keys.length; m++) {
    var s = emotionStats[keys[m]];
    labels.push(keys[m]);
    winData.push(s.wins);
    lossData.push(s.losses);
  }

  var ctx = canvas.getContext('2d');
  _reviewCharts['chartEmotion'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        createBarDataset('盈利笔数', winData, cc, { backgroundColor: cc.barWin }),
        createBarDataset('亏损笔数', lossData, cc, { backgroundColor: cc.barLoss })
      ]
    },
    options: createStandardOptions(cc, {
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 }, padding: 12 } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { ticks: { stepSize: 1 } } }
    })
  });

  // 渲染情绪关联表格
  if (!tableEl) return;
  var tHtml = '<div class="emotion-table-wrap"><table class="emotion-table"><thead><tr>';
  tHtml += '<th>情绪标签</th><th>出现次数</th><th>盈利/亏损</th><th>胜率(%)</th><th>平均盈亏</th><th>vs整体胜率</th>';
  tHtml += '</tr></thead><tbody>';
  for (var e = 0; e < keys.length; e++) {
    var em = keys[e];
    var stats = emotionStats[em];
    var decided = stats.wins + stats.losses;
    var winRate = decided > 0 ? (stats.wins / decided * 100) : 0;
    var avgPnl = stats.count > 0 ? (stats.totalPnl / stats.count) : 0;
    var deviation = winRate - overallWinRate;

    var corrDesc = '';
    if (stats.count < 2) {
      corrDesc = '<span style="color:var(--color-text-muted);">样本不足</span>';
    } else if (Math.abs(deviation) < 5) {
      corrDesc = '<span style="color:var(--color-text-muted);">无明显关联</span>';
    } else if (deviation > 0) {
      corrDesc = '<span style="color:var(--color-pnl-positive);">正向 (+' + deviation.toFixed(1) + '%)</span>';
    } else {
      corrDesc = '<span style="color:var(--color-pnl-negative);">负向 (' + deviation.toFixed(1) + '%)</span>';
    }

    tHtml += '<tr>';
    tHtml += '<td>' + esc(em) + '</td>';
    tHtml += '<td class="col-num">' + stats.count + '</td>';
    tHtml += '<td class="col-num">' + stats.wins + '/' + stats.losses + '</td>';
    tHtml += '<td>' + (decided > 0 ? winRate.toFixed(1) : '-') + '</td>';
    tHtml += '<td class="' + (avgPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' +
      (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(2) + '</td>';
    tHtml += '<td>' + corrDesc + '</td>';
    tHtml += '</tr>';
  }
  tHtml += '</tbody></table></div>';
  tHtml += '<p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">注：负向关联表示该情绪出现时胜率低于整体水平，值得关注。</p>';
  tableEl.innerHTML = tHtml;
}

// ==================== P0 执行质量分析 ====================

function renderExecutionQuality(closed) {
  var canvas = document.getElementById('chartExecutionQuality');
  var tableEl = document.getElementById('executionTableWrap');
  if (!canvas || !tableEl) { console.warn('[review] executionQuality: canvas or table missing'); return; }

  // Diagnostic: trace why chart may be empty
  var withExec = closed.filter(function(l) { return l.executionScore != null; });
  var hasScore13 = closed.filter(function(l) { return l.executionScore >= 1 && l.executionScore <= 3; });
  console.log('[review] executionQuality: closed=' + closed.length +
    ' withScore=' + withExec.length +
    ' scores13=' + hasScore13.length +
    ' rawScores=' + JSON.stringify(closed.map(function(l){ return l.executionScore; })));

  // 按执行分分组（0=未评分，1-3=已评分）
  var execStats = {};
  for (var i = 0; i < closed.length; i++) {
    var es = closed[i].executionScore;
    if (es == null || es === 0 || es > 3) continue;  // 0 = 未评分，跳过
    var pnl = safeParseNum(closed[i].pnlAmount);
    if (pnl == null) continue;
    var rm = safeParseNum(closed[i].rMultiple);

    if (!execStats[es]) {
      execStats[es] = { count: 0, wins: 0, losses: 0, totalPnl: 0, rrSum: 0, rrCount: 0 };
    }
    execStats[es].count++;
    execStats[es].totalPnl += pnl;
    if (pnl > 0) execStats[es].wins++;
    else if (pnl < 0) execStats[es].losses++;
    if (rm != null) { execStats[es].rrSum += rm; execStats[es].rrCount++; }
  }

  var keys = Object.keys(execStats).map(Number).sort(function(a, b) { return a - b; });
  if (keys.length === 0) {
    var totalClosed = closed.length;
    var withExec = closed.filter(function(l) { return l.executionScore != null; }).length;
    var msg = '暂无执行评分数据';
    if (totalClosed > 0) {
      msg += '（共 ' + totalClosed + ' 笔已平仓，其中 ' + withExec.length + ' 笔有执行评分[1-3]）';
      // Show migration hint if needed
      if (withExec.length === 0) {
        msg += ' · 提示：如历史评分显示为0分，请在系统设置中点击「立即备份」后手动清除浏览器数据并重新加载';
      }
    } else {
      msg += '，请先完成至少一笔交易并在平仓时记录执行分';
    }
    _setReviewEmpty(canvas, msg);
    if (tableEl) tableEl.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:16px;">' + msg + '</div>';
    return;
  }

  // 整体基准
  var overallWins = 0, overallLosses = 0, overallPnl = 0, overallRr = 0, overallRrCount = 0;
  for (var ki = 0; ki < keys.length; ki++) {
    var s = execStats[keys[ki]];
    overallWins += s.wins;
    overallLosses += s.losses;
    overallPnl += s.totalPnl;
    overallRr += s.rrSum;
    overallRrCount += s.rrCount;
  }
  // Safety: verify all execStats entries exist before proceeding
  for (var gi = 0; gi < keys.length; gi++) {
    if (!execStats[keys[gi]]) {
      console.error('[review] executionQuality: missing execStats[' + keys[gi] + ']');
      _setReviewEmpty(canvas, '数据异常：执行评分统计丢失');
      return;
    }
  }
  var overallDecided = overallWins + overallLosses;
  var overallWinRate = overallDecided > 0 ? (overallWins / overallDecided * 100) : 0;
  var overallAvgPnl = overallDecided > 0 ? (overallPnl / overallDecided) : 0;
  var overallAvgRr = overallRrCount > 0 ? (overallRr / overallRrCount) : 0;

  // 绘制图表
  _clearReviewEmpty(canvas);

  var cc = utils.getChartColors();
  var labels = [], winRateData = [], avgPnlData = [], avgRrData = [];
  for (var ki = 0; ki < keys.length; ki++) {
    var s = execStats[keys[ki]];
    labels.push('执行' + keys[ki] + '分');
    var wr = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses) * 100) : 0;
    var avgPnl = s.count > 0 ? (s.totalPnl / s.count) : 0;
    var avgRr = s.rrCount > 0 ? (s.rrSum / s.rrCount) : 0;
    winRateData.push(parseFloat(wr.toFixed(1)));
    avgPnlData.push(parseFloat(avgPnl.toFixed(2)));
    avgRrData.push(parseFloat(avgRr.toFixed(2)));
  }

  var ctx = canvas.getContext('2d');
    _reviewCharts['chartExecutionQuality'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        createBarDataset('平均盈亏 (USDT)', avgPnlData, cc, { backgroundColor: avgPnlData.map(function(v) { return v >= 0 ? cc.barWin : cc.barLoss; }), yAxisID: 'y' }),
        createLineDataset('平均R倍数', avgRrData, cc, { type: 'line', yAxisID: 'y1', borderColor: cc.accentWarning, backgroundColor: cc.accentWarning, pointRadius: 6, pointHoverRadius: 10, borderWidth: 3 })
      ]
    },
    options: createStandardOptions(cc, {
      plugins: { tooltip: { callbacks: { afterLabel: function(ctx) { var idx = ctx.dataIndex; var s = execStats[keys[idx]]; return '笔数: ' + s.count + ' | 胜率: ' + winRateData[idx] + '%'; } } } },
      scales: {
        y: { position: 'left', ticks: { callback: function(v) { return v.toFixed(0); } }, title: { display: true, text: '平均盈亏 (USDT)', color: cc.tickColor } },
        y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: cc.accentWarning, font: { size: 11 }, callback: function(v) { return v.toFixed(1) + 'R'; } }, title: { display: true, text: '平均R倍数', color: cc.accentWarning }, min: 0 }
      }
    })
  });

  // 绘制表格
  var tHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
  tHtml += '<div style="flex:1;min-width:150px;background:var(--color-surface);border-radius:8px;padding:12px;">';
  tHtml += '<div style="font-size:11px;color:var(--color-text-muted);">整体基准</div>';
  tHtml += '<div style="font-size:18px;font-weight:600;color:' + (overallAvgPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)') + ';">';
  tHtml += (overallAvgPnl >= 0 ? '+' : '') + overallAvgPnl.toFixed(2) + ' USDT</div>';
  tHtml += '<div style="font-size:12px;color:var(--color-text-muted);">平均R ' + overallAvgRr.toFixed(2) + 'R · 胜率 ' + overallWinRate.toFixed(1) + '%</div>';
  tHtml += '</div>';
  tHtml += '</div>';

  tHtml += '<table class="analytics-table"><thead><tr>' +
    '<th>执行分</th><th>笔数</th><th>盈利/亏损</th><th>胜率</th><th>平均盈亏</th><th>平均R</th><th>vs整体</th></tr></thead><tbody>';

  for (var ki = 0; ki < keys.length; ki++) {
    var s = execStats[keys[ki]];
    var avgPnl = s.count > 0 ? (s.totalPnl / s.count) : 0;
    var wr = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses) * 100) : 0;
    var avgRr = s.rrCount > 0 ? (s.rrSum / s.rrCount) : 0;
    var wrDev = wr - overallWinRate;

    var wrClass = wrDev > 0 ? 'col-pnl-pos' : (wrDev < 0 ? 'col-pnl-neg' : '');
    var pnlClass = avgPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg';
    var scoreLabel = keys[ki];

    tHtml += '<tr>' +
      '<td style="text-align:center;font-weight:600;">' + scoreLabel + ' <span style="font-size:11px;color:var(--color-text-muted);">/3</span></td>' +
      '<td class="col-num">' + s.count + '</td>' +
      '<td class="col-num">' + s.wins + '/' + s.losses + '</td>' +
      '<td class="col-num ' + wrClass + '">' + wr.toFixed(1) + '%</td>' +
      '<td class="' + pnlClass + '">' + (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(2) + '</td>' +
      '<td class="col-num">' + avgRr.toFixed(2) + 'R</td>' +
      '<td class="' + wrClass + '">' + (wrDev >= 0 ? '+' : '') + wrDev.toFixed(1) + '%</td>' +
      '</tr>';
  }
  tHtml += '</tbody></table>';
  tHtml += '<p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">注：执行分越高表示执行越到位。vs整体表示该评分与整体基准的偏差。</p>';
  tableEl.innerHTML = tHtml;
}
