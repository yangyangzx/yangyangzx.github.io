// ==================== 复盘中心 ====================
// 基于全局 logs 数据，对亏损订单进行多维度分析与可视化展示

var _reviewCharts = {};

/**
 * 销毁复盘页面的所有图表实例
 */
function destroyReviewCharts() {
  var ids = ['chartLossReason', 'chartStrategyRank', 'chartOrderType', 'chartEmotion'];
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
}

// ==================== 卡片 1：亏损原因分布（环形图） ====================

function renderLossReasonPie(closed) {
  var canvas = document.getElementById('chartLossReason');
  if (!canvas) return;

  var losses = [];
  for (var i = 0; i < closed.length; i++) {
    if (closed[i].pnlAmount < 0) losses.push(closed[i]);
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
        reasonPnl[r] = (reasonPnl[r] || 0) + losses[j].pnlAmount;
      }
    } else {
      reasonCount['未标记'] = (reasonCount['未标记'] || 0) + 1;
      reasonPnl['未标记'] = (reasonPnl['未标记'] || 0) + losses[j].pnlAmount;
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
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderColor: cc.barBorder,
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: cc.tickColor,
            font: { size: 12 },
            padding: 12,
            usePointStyle: true,
            pointStyleWidth: 10
          }
        },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tickColor,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var pct = ((ctx.parsed / total) * 100).toFixed(1);
              var pnl = reasonPnl[ctx.label] || 0;
              return ctx.label + ': ' + ctx.parsed + ' 次 (' + pct + '%)  累计 ' + pnl.toFixed(0) + ' USDT';
            }
          }
        }
      },
      cutout: '55%'
    }
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
      var pnl = trades[t].pnlAmount;
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
      datasets: [{
        label: '总盈亏 (USDT)',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: cc.barBorder
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
          bodyColor: cc.tickColor,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              return '总盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT';
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cc.tickColor, font: { size: 12 }, maxRotation: 45 } },
        y: { grid: { color: cc.gridColor }, ticks: { color: cc.tickColor, font: { size: 12 } } }
      }
    }
  });

  // 渲染排名榜
  if (!listEl) return;
  var listHtml = '<div class="strategy-rank-list">';
  for (var rd = 0; rd < rows.length; rd++) {
    var row = rows[rd];
    var rankClass = (rd === 0) ? ' rank-1' : '';
    listHtml += '<div class="strategy-rank-item' + rankClass + '">';
    listHtml += '<span class="strategy-rank-badge">' + (rd + 1) + '</span>';
    listHtml += '<span class="strategy-rank-name" title="' + row.name + '">' + row.name;
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
    labels.push(keys[j] + ' (' + g.total + ')');
    wrData.push(g.total > 0 ? parseFloat((g.wins / g.total * 100).toFixed(1)) : 0);
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
        borderWidth: 1,
        yAxisID: 'y'
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
          bodyColor: cc.tickColor,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              var idx = ctx.dataIndex;
              return '胜率: ' + wrData[idx].toFixed(1) + '% | 盈亏: ' +
                (pnlData[idx] >= 0 ? '+' : '') + pnlData[idx].toFixed(2) + ' USDT';
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cc.tickColor, font: { size: 12 } } },
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: cc.gridColor },
          ticks: { color: cc.tickColor, font: { size: 12 }, callback: function(v) { return v + '%'; } }
        }
      }
    }
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
    if (pnl == null || !isFinite(pnl)) continue;

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
        { label: '盈利笔数', data: winData, backgroundColor: cc.barWin, borderRadius: 6, borderWidth: 1, borderColor: cc.barBorder },
        { label: '亏损笔数', data: lossData, backgroundColor: cc.barLoss, borderRadius: 6, borderWidth: 1, borderColor: cc.barBorder }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: cc.tickColor, font: { size: 12 }, usePointStyle: true, padding: 12 }
        },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tickColor,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cc.tickColor, font: { size: 12 }, maxRotation: 45 } },
        y: { grid: { color: cc.gridColor }, ticks: { color: cc.tickColor, font: { size: 12 }, stepSize: 1 } }
      }
    }
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
    tHtml += '<td>' + em + '</td>';
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
