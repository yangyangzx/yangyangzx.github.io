// ==================== 复盘中心 ====================

var _reviewCharts = {};

function destroyReviewCharts() {
  var ids = ['chartLossReason', 'chartStrategyRank', 'chartEmotion'];
  for (var i = 0; i < ids.length; i++) {
    if (_reviewCharts[ids[i]]) {
      _reviewCharts[ids[i]].destroy();
      _reviewCharts[ids[i]] = null;
    }
  }
  if (window._reviewOrderTypeChart) {
    window._reviewOrderTypeChart.destroy();
    window._reviewOrderTypeChart = null;
  }
}

// ==================== 数据辅助 ====================

function getClosedTrades() {
  return getClosedSorted();
}

/**
 * 空状态降级辅助：隐藏 canvas 并插入空状态 div（避免 canvas 脱离 DOM）
 */
function _setReviewEmpty(canvas, message) {
  canvas.style.display = 'none';
  var emptyId = canvas.id + '__empty';
  var empty = document.getElementById(emptyId);
  if (!empty) {
    empty = document.createElement('div');
    empty.id = emptyId;
    empty.className = 'review-empty review-empty-temp';
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

// ==================== 卡片 1：亏损原因分布（饼图） ====================

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

  // 按 lossReason 展开统计
  var reasonCount = {};
  for (var j = 0; j < losses.length; j++) {
    var reasons = losses[j].lossReason;
    if (Array.isArray(reasons) && reasons.length > 0) {
      for (var k = 0; k < reasons.length; k++) {
        var r = reasons[k];
        reasonCount[r] = (reasonCount[r] || 0) + 1;
      }
    } else {
      reasonCount['未标记'] = (reasonCount['未标记'] || 0) + 1;
    }
  }

  var keys = Object.keys(reasonCount);
  if (keys.length === 0) {
    _setReviewEmpty(canvas, '亏损原因数据为空');
    return;
  }

  var cc = utils.getChartColors();

  // 红色系配色（硬编码，Chart.js 不支持 CSS 变量）
  var redPalette = ['rgba(239,68,68,0.9)', 'rgba(239,68,68,0.8)', 'rgba(239,68,68,0.65)', 'rgba(239,68,68,0.5)', 'rgba(239,68,68,0.35)',
                    'rgba(220,38,38,0.9)', 'rgba(185,28,28,0.9)', 'rgba(153,27,27,0.9)', 'rgba(127,29,29,0.9)', 'rgba(249,115,22,0.7)'];
  var labels = [], data = [], bgColors = [];
  for (var m = 0; m < keys.length; m++) {
    labels.push(keys[m]);
    data.push(reasonCount[keys[m]]);
    bgColors.push(redPalette[m % redPalette.length]);
  }

  _clearReviewEmpty(canvas);
  ensureReviewChartWrap(canvas);

  var ctx = canvas.getContext('2d');
  _reviewCharts['chartLossReason'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ data: data, backgroundColor: bgColors, borderColor: cc.barBorder, borderWidth: 3 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: cc.tickColor, font: { size: 12 }, padding: 12, usePointStyle: true, pointStyleWidth: 10 }
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
              return ctx.label + ': ' + ctx.parsed + ' 次 (' + pct + '%，含重复计数)';
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

  if (closed.length === 0) {
    _setReviewEmpty(canvas, '暂无已平仓交易');
    document.getElementById('strategyRankList').innerHTML = '';
    return;
  }

  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var key = closed[i].strategyFramework || '未分类';
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
      if (pnl > 0) {
        wins++;
        winSum += pnl;
      } else if (pnl < 0) {
        losses++;
        lossSum += Math.abs(pnl);
      }
    }
    var decidedCnt = wins + losses;
    var winRate = decidedCnt > 0 ? (wins / decidedCnt * 100) : 0;
    var avgWin = wins > 0 ? winSum / wins : 0;
    var avgLoss = losses > 0 ? lossSum / losses : 0;
    var wlRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

    rows.push({
      name: keys[j],
      count: trades.length,
      wins: wins,
      winRate: winRate,
      totalPnl: totalPnl,
      wlRatio: wlRatio
    });
  }

  // 按总盈亏降序
  rows.sort(function(a, b) { return b.totalPnl - a.totalPnl; });

  _clearReviewEmpty(canvas);
  ensureReviewChartWrap(canvas);

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
          callbacks: { label: function(ctx) { return '总盈亏 ' + ctx.parsed.y.toFixed(2) + ' USDT'; } }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cc.tickColor, font: { size: 12 }, maxRotation: 45 } },
        y: { grid: { color: cc.gridColor }, ticks: { color: cc.tickColor, font: { size: 12 } } }
      }
    }
  });

  // 渲染排名榜
  var listHtml = '<div class="strategy-rank-list">';
  for (var rd = 0; rd < rows.length; rd++) {
    var row = rows[rd];
    var rankClass = (rd === 0) ? ' rank-1' : '';
    listHtml += '<div class="strategy-rank-item' + rankClass + '">';
    listHtml += '<span class="strategy-rank-badge">' + (rd + 1) + '</span>';
    listHtml += '<span class="strategy-rank-name" title="' + row.name + '">' + row.name + (row.count < 3 ? ' <span style="font-size:10px;color:var(--color-text-muted);">(样本不足)</span>' : '') + '</span>';
    listHtml += '<span class="strategy-rank-pnl ' + (row.totalPnl >= 0 ? 'risk-safe' : 'risk-danger') + '">' + (row.totalPnl >= 0 ? '+' : '') + row.totalPnl.toFixed(0) + ' USDT</span>';
    listHtml += '<span class="strategy-rank-meta">胜率 ' + row.winRate.toFixed(0) + '% · ' + row.count + '笔</span>';
    listHtml += '</div>';
  }
  listHtml += '</div>';
  document.getElementById('strategyRankList').innerHTML = listHtml;
}

// ── 卡片 3a：订单类型胜率分析（柱状图）──
function renderOrderTypeChart(closed) {
  var canvas = document.getElementById('chartOrderType');
  if (!canvas) return;

  var cc = utils.getChartColors();

  if (!closed || closed.length === 0) {
    _setReviewEmpty(canvas, '暂无交易数据');
    return;
  }

  // 按 orderType 分组
  var groups = {};
  for (var i = 0; i < closed.length; i++) {
    var key = closed[i].orderType || 'market';
    if (!groups[key]) groups[key] = { total: 0, wins: 0, pnlTotal: 0 };
    groups[key].total++;
    if (parseFloat(closed[i].pnlAmount) > 0) groups[key].wins++;
    groups[key].pnlTotal += parseFloat(closed[i].pnlAmount) || 0;
  }

  var keys = Object.keys(groups);
  if (keys.length === 0) {
    _setReviewEmpty(canvas, '无订单类型数据');
    return;
  }

  _clearReviewEmpty(canvas);

  var labels = [], wrData = [], pnlData = [];
  for (var j = 0; j < keys.length; j++) {
    var g = groups[keys[j]];
    var label = ORDER_TYPE_LABELS[keys[j]] || keys[j];
    labels.push(label + ' (' + g.total + ')');
    var wr = g.total > 0 ? parseFloat((g.wins / g.total * 100).toFixed(1)) : 0;
    wrData.push(wr);
    pnlData.push(parseFloat(g.pnlTotal.toFixed(2)));
  }

  // 销毁旧实例
  if (window._reviewOrderTypeChart) {
    window._reviewOrderTypeChart.destroy();
    window._reviewOrderTypeChart = null;
  }

  // 胜率颜色：绿>50 红<50
  var wrColors = wrData.map(function(v) { return v >= 50 ? cc.barWin : cc.barLoss; });

  window._reviewOrderTypeChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '胜率 %',
        data: wrData,
        backgroundColor: wrColors,
        borderColor: wrColors.map(function(c) { return c.replace('0.7', '1'); }),
        borderWidth: 1,
        yAxisID: 'y'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: function(v) { return v + '%'; } },
          title: { display: true, text: '胜率' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              var idx = ctx.dataIndex;
              return '胜率: ' + wrData[idx].toFixed(1) + '% | 盈亏: ' + (pnlData[idx] >= 0 ? '+' : '') + pnlData[idx].toFixed(2) + ' USDT';
            }
          }
        }
      }
    }
  });
}

// ==================== 卡片 3：交易情绪关联（分组柱状图 + 表格） ====================

function renderEmotionAnalysis(closed) {
  var canvas = document.getElementById('chartEmotion');
  if (!canvas) return;

  // 按情绪展开统计（区分盈利和亏损）
  var emotionData = {};
  for (var i = 0; i < closed.length; i++) {
    var emotions = closed[i].emotions;
    var pnl = safeParseNum(closed[i].pnlAmount);
    var isWin = pnl > 0;
    var isLoss = pnl < 0;
    if (Array.isArray(emotions) && emotions.length > 0) {
      for (var j = 0; j < emotions.length; j++) {
        var em = emotions[j];
        if (!emotionData[em]) {
          emotionData[em] = { count: 0, winCount: 0, lossCount: 0, totalPnl: 0 };
        }
        emotionData[em].count++;
        emotionData[em].totalPnl += pnl || 0;
        if (isWin) emotionData[em].winCount++;
        else if (isLoss) emotionData[em].lossCount++;
      }
    } else {
      if (!emotionData['未标记']) {
        emotionData['未标记'] = { count: 0, winCount: 0, lossCount: 0, totalPnl: 0 };
      }
      emotionData['未标记'].count++;
      emotionData['未标记'].totalPnl += pnl || 0;
      if (isWin) emotionData['未标记'].winCount++;
      else if (isLoss) emotionData['未标记'].lossCount++;
    }
  }

  var keys = Object.keys(emotionData);
  if (keys.length === 0 || (keys.length === 1 && keys[0] === '未标记')) {
    _setReviewEmpty(canvas, '暂无情绪标签数据');
    document.getElementById('emotionTableWrap').innerHTML = '';
    return;
  }

  _clearReviewEmpty(canvas);
  ensureReviewChartWrap(canvas);

  var labels = [], winData = [], lossData = [];
  for (var k = 0; k < keys.length; k++) {
    labels.push(keys[k]);
    winData.push(emotionData[keys[k]].winCount);
    lossData.push(emotionData[keys[k]].lossCount);
  }

  var ctx = canvas.getContext('2d');
  var cc = utils.getChartColors();
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

  // 渲染表格
  var tHtml = '<div class="emotion-table-wrap"><table class="emotion-table"><thead><tr>';
  tHtml += '<th>情绪</th><th>出现次数</th><th>盈利笔数</th><th>亏损笔数</th><th>总盈亏</th><th>均盈亏</th>';
  tHtml += '</tr></thead><tbody>';
  for (var e = 0; e < keys.length; e++) {
    var ed = emotionData[keys[e]];
    var avgPnl = ed.count > 0 ? ed.totalPnl / ed.count : 0;
    tHtml += '<tr>';
    tHtml += '<td>' + keys[e] + '</td>';
    tHtml += '<td class="col-num">' + ed.count + '</td>';
    tHtml += '<td class="col-num risk-safe">' + ed.winCount + '</td>';
    tHtml += '<td class="col-num risk-danger">' + ed.lossCount + '</td>';
    tHtml += '<td class="' + (ed.totalPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (ed.totalPnl >= 0 ? '+' : '') + ed.totalPnl.toFixed(2) + '</td>';
    tHtml += '<td class="' + (avgPnl >= 0 ? 'col-pnl-pos' : 'col-pnl-neg') + '">' + (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(2) + '</td>';
    tHtml += '</tr>';
  }
  tHtml += '</tbody></table></div>';
  document.getElementById('emotionTableWrap').innerHTML = tHtml;
}

// ==================== 辅助 ====================

function ensureReviewChartWrap(canvas) {
  if (!canvas.parentElement || !canvas.parentElement.classList.contains('review-chart-container')) {
    var wrap = document.createElement('div');
    wrap.className = 'review-chart-container';
    canvas.parentNode.insertBefore(wrap, canvas);
    wrap.appendChild(canvas);
  }
}
