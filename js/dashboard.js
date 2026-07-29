// ==================== 仪表盘渲染 ====================

/**
 * 筛选已平仓日志（统一使用 utils.isClosedTrade 判定）
 */
function _getClosedLogs() {
  var result = [];
  for (var i = 0; i < logs.length; i++) {
    if (window.utils.isClosedTrade(logs[i])) {
      result.push(logs[i]);
    }
  }
  return result;
}

/**
 * 筛选未平仓日志
 */
function _getOpenLogs() {
  var result = [];
  for (var i = 0; i < logs.length; i++) {
    if (!logs[i].closeType) {
      result.push(logs[i]);
    }
  }
  return result;
}

/**
 * 格式化金额为 USDT 显示
 */
function _fmtUSDT(val) {
  if (val == null || isNaN(val)) return '—';
  var abs = Math.abs(val);
  var sign = val >= 0 ? '+' : '-';
  if (abs >= 1000) return sign + ' ' + abs.toFixed(0) + ' USDT';
  if (abs >= 1) return sign + ' ' + abs.toFixed(2) + ' USDT';
  return sign + ' ' + abs.toFixed(4) + ' USDT';
}

/**
 * 格式化百分比
 */
function _fmtPct(val) {
  if (val == null || isNaN(val)) return '—';
  return val.toFixed(1) + '%';
}

// ==================== 卡片 1：今日 PnL ====================
function _renderTodayPnl() {
  var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
  var closed = _getClosedLogs();
  var totalPnl = 0;
  var count = 0;

  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var closeDateStr = window.utils.toLocalDateStr(ct);
    if (!closeDateStr) continue;
    if (closeDateStr === todayStr) {
      totalPnl += parseFloat(closed[i].pnlAmount) || 0;
      count++;
    }
  }

  var valueEl = document.getElementById('dashPnlValue');
  var subEl = document.getElementById('dashPnlSub');

  if (count === 0) {
    valueEl.textContent = '—';
    valueEl.className = 'dash-card-value pnl-neutral';
    subEl.textContent = '今日无交易';
    return;
  }

  var cls = totalPnl > 0 ? 'pnl-positive' : (totalPnl < 0 ? 'pnl-negative' : 'pnl-neutral');
  valueEl.className = 'dash-card-value ' + cls;

  var arrow = totalPnl > 0 ? '<span class="pnl-arrow-up">&#9650;</span>' : (totalPnl < 0 ? '<span class="pnl-arrow-down">&#9660;</span>' : '');
  valueEl.innerHTML = arrow + ' ' + _fmtUSDT(totalPnl);
  subEl.textContent = '共 ' + count + ' 笔已平仓';

  var card = document.getElementById('dashTodayPnl');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add(totalPnl > 0 ? 'status-positive' : (totalPnl < 0 ? 'status-negative' : ''));
}

// ==================== 卡片 2：本周胜率 ====================
function _renderWinRate() {
  // 计算本周一的本地日期字符串
  var now = new Date();
  var day = now.getDay();
  var diff = day === 0 ? 6 : day - 1;
  var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  var mondayStr = window.utils.toLocalDateStr(monday.toISOString());
  var closed = _getClosedLogs();
  var wins = [];
  var losses = [];
  var totalPnl = 0;
  var count = 0;

  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var closeDateStr = window.utils.toLocalDateStr(ct);
    if (!closeDateStr) continue;
    if (closeDateStr >= mondayStr) {
      var pnl = parseFloat(closed[i].pnlAmount) || 0;
      totalPnl += pnl;
      count++;
      if (pnl > 0) wins.push(pnl);
      else if (pnl < 0) losses.push(Math.abs(pnl));
      else {
        // break-even: 不算赢也不算输
      }
    }
  }

  var valueEl = document.getElementById('dashWinRateValue');
  var subEl = document.getElementById('dashWinRateSub');

  if (count === 0) {
    valueEl.textContent = '—';
    valueEl.className = 'dash-card-value pnl-neutral';
    subEl.textContent = '本周无交易';
    return;
  }

  var decided = wins.length + losses.length;
  var winRate = decided > 0 ? ((wins.length / decided) * 100) : 0;

  valueEl.textContent = _fmtPct(winRate);
  valueEl.className = 'dash-card-value ' + (winRate >= 50 ? 'pnl-positive' : 'pnl-negative');

  var avgWin = wins.length > 0 ? wins.reduce(function(a,b){return a+b;}, 0) / wins.length : 0;
  var avgLoss = losses.length > 0 ? losses.reduce(function(a,b){return a+b;}, 0) / losses.length : 0;
  var wlRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '—';

  subEl.textContent = '盈亏比 ' + wlRatio + '  \u00B7  ' + decided + ' 笔（共 ' + count + '）';

  var card = document.getElementById('dashWinRate');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add(winRate >= 50 ? 'status-positive' : 'status-negative');
}

// ==================== 卡片 3：在仓风险 ====================
function _renderRiskExposure() {
  var openLogs = _getOpenLogs();
  var rowsEl = document.getElementById('dashRiskRows');

  if (openLogs.length === 0) {
    rowsEl.innerHTML = '<span style="color:var(--color-text-muted);font-size:var(--font-sm);">无持仓</span>';
    return;
  }

  var totalPosition = 0;
  var totalRisk = 0;
  var totalMargin = 0;

  for (var i = 0; i < openLogs.length; i++) {
    var log = openLogs[i];
    totalPosition += parseFloat(log.positionSize) || 0;
    totalRisk += parseFloat(log.riskAmount) || 0;
    var lev = parseFloat(log.leverage) || 0;
    if (lev > 0) {
      totalMargin += (parseFloat(log.positionSize) || 0) / lev;
    } else {
      totalMargin += parseFloat(log.positionSize) || 0;
    }
  }

  var riskPct = totalPosition > 0 ? ((totalRisk / totalPosition) * 100).toFixed(1) : '0.0';
  var riskCls = parseFloat(riskPct) > 5 ? 'danger' : (parseFloat(riskPct) > 2 ? 'warn' : '');

  rowsEl.innerHTML =
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">总持仓</span>' +
      '<span class="dash-risk-value">' + _fmtUSDT(totalPosition) + '</span>' +
    '</div>' +
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">总风险</span>' +
      '<span class="dash-risk-value ' + riskCls + '">' + _fmtUSDT(totalRisk) + ' (' + riskPct + '%)</span>' +
    '</div>' +
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">占用保证金</span>' +
      '<span class="dash-risk-value">' + _fmtUSDT(totalMargin) + '</span>' +
    '</div>' +
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">持仓数</span>' +
      '<span class="dash-risk-value">' + openLogs.length + ' 笔</span>' +
    '</div>';

  var card = document.getElementById('dashRiskExposure');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  var riskNum = parseFloat(riskPct);
  card.classList.add(riskNum > 5 ? 'status-negative' : (riskNum > 2 ? 'status-warning' : 'status-positive'));
}

// ==================== 卡片 4：连亏计数 ====================
function _renderLossStreak() {
  var closed = _getClosedLogs();
  var valueEl = document.getElementById('dashStreakValue');
  var subEl = document.getElementById('dashStreakSub');

  if (closed.length === 0) {
    valueEl.textContent = '—';
    valueEl.className = 'dash-card-value pnl-neutral';
    subEl.textContent = '暂无数据';
    return;
  }

  // 按平仓时间倒序
  var sorted = closed.slice().sort(function(a, b) {
    var ta = a.closeTime ? new Date(a.closeTime).getTime() : 0;
    var tb = b.closeTime ? new Date(b.closeTime).getTime() : 0;
    return tb - ta;
  });

  var streak = 0;
  for (var i = 0; i < sorted.length; i++) {
    var pnl = sorted[i].pnlAmount || 0;
    if (pnl < 0) {
      streak++;
    } else {
      break;
    }
  }

  valueEl.textContent = streak;
  valueEl.className = 'dash-card-value';

  var tag = '';
  var tip = '';
  if (streak <= 1) {
    valueEl.className += ' pnl-positive';
    tag = '<span class="streak-safe">安全</span>';
  } else if (streak === 2) {
    valueEl.className += ' pnl-negative';
    tag = '<span class="streak-warn">注意</span>';
  } else {
    valueEl.className += ' pnl-negative';
    tag = '<span class="streak-danger">危险</span>';
    tip = '<div class="streak-tip"><i class="fas fa-exclamation-triangle"></i> 建议降仓至 60%</div>';
  }

  subEl.innerHTML = tag + '  连续亏损笔数' + tip;

  var card = document.getElementById('dashLossStreak');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add(streak <= 1 ? 'status-positive' : (streak === 2 ? 'status-warning' : 'status-negative'));
}

// ==================== 卡片 5：强平预警 ====================
function _renderLiqWarn() {
  var openLogs = _getOpenLogs();
  var listEl = document.getElementById('dashLiqList');

  if (openLogs.length === 0) {
    listEl.innerHTML = '<span style="color:var(--color-text-muted);font-size:var(--font-sm);">无持仓</span>';
    return;
  }

  var warnings = [];

  for (var i = 0; i < openLogs.length; i++) {
    var log = openLogs[i];
    var lev = log.leverage || 0;
    if (lev <= 0) continue; // 现货无强平

    var entry = log.entryPrice;
    var sl = log.stopLoss;
    if (sl == null || isNaN(sl)) continue; // 无止损的仓位跳过
    var dir = log.direction;

    // 强平价：统一使用 utils.calcLiquidationPrice
    var mmr = 0.005;
    try {
      var raw = localStorage.getItem('trade_settings_v1');
      if (raw) { var s = JSON.parse(raw); if (s.mmr != null) mmr = s.mmr / 100; }
    } catch(e) {}
    var liqPrice = window.utils.calcLiquidationPrice(entry, dir, lev, mmr);

    // 检查止损是否在强平价之外（安全方向）
    var isSafe;
    var distance;
    if (dir === 'long') {
      // 做多：止损价 > 强平价 才安全
      isSafe = sl > liqPrice;
      distance = liqPrice > 0 ? ((sl - liqPrice) / sl * 100) : 0;
    } else {
      // 做空：止损价 < 强平价 才安全
      isSafe = sl < liqPrice;
      distance = liqPrice > 0 ? ((liqPrice - sl) / sl * 100) : 0;
    }

    if (!isSafe) {
      warnings.push({
        symbol: log.symbol,
        stopLoss: sl,
        liqPrice: liqPrice,
        distance: distance,
        direction: dir
      });
    }
  }

  if (warnings.length === 0) {
    listEl.innerHTML = '<span class="liq-safe"><i class="fas fa-check-circle"></i> 所有仓位安全</span>';
    var card = document.getElementById('dashLiqWarn');
    card.className = card.className.replace(/\bstatus-\w+/g, '');
    card.classList.add('status-positive');
    return;
  }

  var html = '';
  for (var j = 0; j < warnings.length; j++) {
    var w = warnings[j];
    html += '<div class="liq-item">' +
      '<span class="liq-item-symbol">' + w.symbol + ' (' + (w.direction === 'long' ? '多' : '空') + ')</span>' +
      '<span class="liq-item-distance">止损 ' + w.stopLoss.toFixed(2) + ' / 强平 ' + w.liqPrice.toFixed(2) + ' (' + w.distance.toFixed(1) + '%)</span>' +
    '</div>';
  }
  listEl.innerHTML = html;
  var card = document.getElementById('dashLiqWarn');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add('status-negative');
}

// ==================== 卡片 6：资金曲线缩略图 ====================
var _dashEquityChart = null;

function _renderEquityChart() {
  var closed = _getClosedLogs();

  // 按平仓时间升序
  var sorted = closed.slice().sort(function(a, b) {
    var ta = a.closeTime ? new Date(a.closeTime).getTime() : 0;
    var tb = b.closeTime ? new Date(b.closeTime).getTime() : 0;
    return ta - tb;
  });

  var canvas = document.getElementById('dashEquityChart');
  var ctx = canvas.getContext('2d');
  // 处理 DPR 保证 Retina 屏幕清晰度
  const dpr = window.devicePixelRatio || 1;

  // FIX #10: Use reasonable dimensions even when hidden/initially zero width
  let rectWidth = 600, rectHeight = 200;
  if (canvas.parentElement) {
    const parentRect = canvas.parentElement.getBoundingClientRect();
    rectWidth = parentRect.width || 600;
    rectHeight = Math.max(parentRect.height || 200, 200);
  }
  canvas.style.width = rectWidth + 'px';
  canvas.style.height = rectHeight + 'px';
  canvas.width = rectWidth * dpr;
  canvas.height = rectHeight * dpr;
  ctx.scale(dpr, dpr);

  // 销毁旧实例
  if (_dashEquityChart) {
    _dashEquityChart.destroy();
    _dashEquityChart = null;
  }

  if (sorted.length === 0) {
    // 绘制灰色占位文字（使用 CSS 像素坐标，因为 ctx 已缩放）
    ctx.clearRect(0, 0, rectWidth, rectHeight);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无交易数据', rectWidth / 2, rectHeight / 2);
    return;
  }

  // 初始权益：取第一笔已平仓日志的 capital，无则从 settings.accountBalance 兜底
  var equity = 0;
  if (sorted.length > 0 && sorted[0].capital != null && !isNaN(sorted[0].capital) && sorted[0].capital > 0) {
    equity = parseFloat(sorted[0].capital);
  } else {
    try { var _ds2 = loadSettings(); if (_ds2.accountBalance > 0) equity = parseFloat(_ds2.accountBalance); } catch(e) {}
  }
  var labels = [];
  var data = [];

  for (var i = 0; i < sorted.length; i++) {
    // M5-b: 仅当 capital 变化时才视为存款/取款事件，否则累加 PnL
    if (sorted[i].capital != null && !isNaN(sorted[i].capital) && sorted[i].capital !== equity) {
      equity = parseFloat(sorted[i].capital);
    } else {
      equity += parseFloat(sorted[i].pnlAmount) || 0;
    }
    var d = new Date(sorted[i].closeTime || sorted[i].time);
    labels.push(
      d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2)
    );
    data.push(equity);
  }

  // 正/负分段颜色
  var pointColors = [];
  for (var j = 0; j < sorted.length; j++) {
    pointColors.push((sorted[j].pnlAmount || 0) >= 0 ? '#10b981' : '#ef4444');
  }

  _dashEquityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 8,
        pointBackgroundColor: pointColors,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f1f5f9',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(148,163,184,0.12)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              return '权益: ' + (ctx.raw != null ? ctx.raw.toFixed(2) + ' USDT' : '—');
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: {
            font: { size: 11 },
            color: '#cbd5e1',
            maxTicksLimit: 8
          }
        },
        y: {
          display: true,
          grid: {
            color: 'rgba(148,163,184,0.15)'
          },
          ticks: {
            font: { size: 11 },
            color: '#cbd5e1',
            callback: function(v) { return v.toFixed(0); }
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      }
    }
  });
}

// ==================== 主导出函数 ====================
function renderDashboard() {
  _renderTodayPnl();
  _renderWinRate();
  _renderRiskExposure();
  _renderLossStreak();
  _renderLiqWarn();
  _renderEquityChart();
}
