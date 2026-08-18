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

// ==================== P0-8: 数值计数器动画工具 ====================
window._animateDashValue = function(el, targetText, duration) {
  duration = duration || 400;
  var startText = el.dataset.animCurrent || el.getAttribute('data-anim-target') || targetText;
  // 尝试解析数字（从纯数字文本或 data-anim-target）
  var parseNum = function(s) {
    if (!s) return NaN;
    var m = s.match(/[-+]?\d+\.?\d*/);
    return m ? parseFloat(m[0]) : NaN;
  };
  var numStart = parseNum(startText);
  var numTarget = parseNum(targetText);
  if (isNaN(numStart) || isNaN(numTarget)) { delete el.dataset.animCurrent; return; }
  var suffix = targetText.replace(/[-+]?\d+\.?\d*/g, '').trim();
  var isPct = targetText.indexOf('%') >= 0;
  // 保留 HTML 内容（箭头 span）的前缀
  var prefix = '';
  if (el.innerHTML) {
    var m2 = el.innerHTML.match(/^(<[^>]+>)*\s*/);
    if (m2) prefix = m2[0];
  }
  var startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    var current = numStart + (numTarget - numStart) * ease;
    var formatted;
    if (isPct) {
      formatted = current.toFixed(1) + '%';
    } else {
      formatted = current.toFixed(2) + suffix;
    }
    el.innerHTML = prefix + formatted;
    el.dataset.animCurrent = current;
    el.dataset.animTarget = targetText;
    if (progress < 1) requestAnimationFrame(step);
    else {
      el.innerHTML = prefix + targetText;
      delete el.dataset.animCurrent;
      delete el.dataset.animTarget;
    }
  }
  requestAnimationFrame(step);
};

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
    valueEl.textContent = '0.00';
    valueEl.className = 'dash-card-value pnl-neutral';
    subEl.textContent = '今日无交易';
    return;
  }

  var cls = totalPnl > 0 ? 'pnl-positive' : (totalPnl < 0 ? 'pnl-negative' : 'pnl-neutral');
  valueEl.className = 'dash-card-value ' + cls;

  var arrow = totalPnl > 0 ? '<span class="pnl-arrow-up">&#9650;</span>' : (totalPnl < 0 ? '<span class="pnl-arrow-down">&#9660;</span> ' : '');
  var displayTxt = _fmtUSDT(totalPnl);
  // P0-8: 数值计数器动画
  window._animateDashValue(valueEl, displayTxt, 350);
  valueEl.innerHTML = arrow + ' ' + displayTxt;
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
    subEl.textContent = '本周暂无交易';
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
    // BUG-7 修复：现货(leverage=0)时保证金等于仓位本身
    if (lev > 0) {
      totalMargin += (parseFloat(log.positionSize) || 0) / lev;
    } else {
      totalMargin += parseFloat(log.positionSize) || 0;
    }
  }

  // 若 riskAmount 为 0（无止损或未设置），显示 — 而非 0%
  var riskPctDisplay = totalRisk > 0 ? ((totalRisk / totalPosition) * 100).toFixed(1) : '—';
  var riskNum = totalRisk > 0 ? parseFloat(riskPctDisplay) : 0;
  var riskCls = riskNum > 5 ? 'danger' : (riskNum > 2 ? 'warn' : '');

  rowsEl.innerHTML =
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">总持仓</span>' +
      '<span class="dash-risk-value">' + _fmtUSDT(totalPosition) + '</span>' +
    '</div>' +
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">总风险</span>' +
      '<span class="dash-risk-value ' + riskCls + '">' + _fmtUSDT(totalRisk) + ' (' + (riskPctDisplay === '—' ? '—' : riskPctDisplay + '%') + ')</span>' +
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

  // 连续亏损（从末尾倒序）+ 当日总亏损笔数
  var streak = 0;
  var totalLossCount = 0;
  for (var i = 0; i < sorted.length; i++) {
    var pnl = sorted[i].pnlAmount || 0;
    if (pnl < 0) {
      streak++;
      totalLossCount++;
    } else {
      break;
    }
  }
  // 统计全天总亏损笔数（不限连续）
  for (var j = 0; j < sorted.length; j++) {
    var pnl2 = sorted[j].pnlAmount || 0;
    if (pnl2 < 0) totalLossCount++;
  }

  valueEl.textContent = streak;
  valueEl.className = 'dash-card-value';
  // P0-8: 连亏数值动画
  window._animateDashValue(valueEl, String(streak), 300);

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

  // BUG-6 修复：明确显示"连续亏损"而非"连亏"，并补充总亏损笔数
  subEl.innerHTML = tag + '  连续亏损 ' + streak + ' 笔（当日共 ' + totalLossCount + ' 笔亏损）' + tip;

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
    if (sl == null || isNaN(sl) || sl <= 0) continue; // 无止损或止损≤0的仓位跳过，防止除零
    var dir = log.direction;

    // 强平价：统一使用 utils.calcLiquidationPrice
    var mmr = DEFAULT_MMR;
    try {
      var raw = localStorage.getItem('trade_settings_v1');
      if (raw) { var s = JSON.parse(raw); if (s.mmr != null) mmr = s.mmr / 100; }
    } catch(e) { console.error('[dashboard]', e); }
    var liqPrice = window.utils.calcLiquidationPrice(entry, dir, lev, mmr);
    if (isNaN(liqPrice) || liqPrice <= 0) continue; // 强平价无效跳过

    // 前置校验：止损价方向必须正确（long: sl < entry, short: sl > entry）
    var slDirectionValid;
    if (dir === 'long') {
      slDirectionValid = sl < entry;
    } else {
      slDirectionValid = sl > entry;
    }
    if (!slDirectionValid) {
      // 止损方向错误，直接报警
      warnings.push({
        symbol: log.symbol,
        stopLoss: sl,
        liqPrice: liqPrice,
        distance: 0,
        direction: dir,
        note: '止损方向错误'
      });
      continue;
    }

    // 检查止损是否在强平价之外（安全方向）
    var isSafe;
    var distance;
    if (dir === 'long') {
      // 做多：止损价 > 强平价 才安全
      isSafe = sl > liqPrice;
      distance = liqPrice > 0 ? ((sl - liqPrice) / entry * 100) : 0;
    } else {
      // 做空：止损价 < 强平价 才安全
      isSafe = sl < liqPrice;
      distance = liqPrice > 0 ? ((liqPrice - sl) / entry * 100) : 0;
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
    // 额外防御：NaN 值不直接显示
    if (isNaN(w.stopLoss) || isNaN(w.liqPrice)) continue;
    var distText = isNaN(w.distance) ? '' : ' (' + Number(w.distance).toFixed(1) + '%)';
    var noteText = w.note ? ' <span style="color:var(--color-danger);">[' + esc(w.note) + ']</span>' : '';
    html += '<div class="liq-item">' +
      '<span class="liq-item-symbol">' + esc(w.symbol) + ' (' + (w.direction === 'long' ? '多' : '空') + ')</span>' +
      '<span class="liq-item-distance">止损 ' + Number(w.stopLoss).toFixed(5) + ' / 强平 ' + Number(w.liqPrice).toFixed(5) + distText + '</span>' +
      noteText +
    '</div>';
  }
  listEl.innerHTML = html;
  var card = document.getElementById('dashLiqWarn');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add('status-negative');
}

// ==================== 卡片 6：资金曲线缩略图 ====================

function _renderEquityChart() {
  const closed = _getClosedLogs();
  const canvas = document.getElementById('dashEquityChart');
  
  if (!canvas) {
    console.warn('资金曲线图表Canvas元素未找到');
    return;
  }
  
  const ctx = canvas.getContext('2d');
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

  // ===== 使用ChartManager进行专业生命周期管理 =====
  const CHART_KEY = 'dashboard_equity_chart';

  // 安全清理：直接销毁绑定在此 Canvas 上的任何旧 Chart 实例
  // 使用同步销毁而非 ChartManager 的 1000ms 延迟，避免 Canvas 被占用时报错
  if (canvas._chart && typeof canvas._chart.destroy === 'function') {
    canvas._chart.destroy();
  }
  // 同时清理 ChartManager 注册（立即销毁，不走延迟队列）
  if (window.ChartManager) {
    window.ChartManager.unregister(CHART_KEY, true);
  }

  const curve = window.utils.calcEquityCurve(closed);
  const sorted = closed.slice().sort(function(a, b) {
    const ta = a.closeTime ? new Date(a.closeTime).getTime() : 0;
    const tb = b.closeTime ? new Date(b.closeTime).getTime() : 0;
    return ta - tb;
  });

  if (sorted.length === 0) {
    // 绘制占位文字（使用 CSS 像素坐标，因为 ctx 已缩放）
    ctx.clearRect(0, 0, rectWidth, rectHeight);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillText('暂无交易数据', rectWidth / 2, rectHeight / 2);
    return;
  }

  // 使用统一权益曲线计算结果
  const labels = [];
  const data = [];
  for (let i = 0; i < curve.data.length; i++) {
    const d = new Date(sorted[i].closeTime || sorted[i].time);
    labels.push(
      d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2)
    );
    data.push(curve.data[i].eq);
  }

  // 正/负分段颜色
  const cc = utils.getChartColors();
  const pointColors = [];
  for (let j = 0; j < sorted.length; j++) {
    pointColors.push((sorted[j].pnlAmount || 0) >= 0 ? cc.positivePoint : cc.negativePoint);
  }

  try {
    // 创建新的Chart实例
    const chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '权益 (USDT)',
        data: data,
        borderColor: cc.barBorder,
        backgroundColor: function(context) {
          var chart = context.chart;
          var ctx2 = chart.ctx;
          var gradient = ctx2.createLinearGradient(0, 0, 0, chart.height);
          gradient.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
          gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
          return gradient;
        },
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: pointColors,
        pointBorderColor: 'rgba(255,255,255,0.6)',
        pointBorderWidth: 1.5,
        fill: true,
        tension: 0.25
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
            color: cc.tickColor,
            maxTicksLimit: 8,
            maxRotation: 0
          }
        },
        y: {
          display: true,
          grid: {
            color: cc.gridColor
          },
          ticks: {
            font: { size: 11 },
            color: cc.tickColor,
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
  
  // 使用ChartManager注册实例，确保正确的生命周期管理
  if (window.ChartManager) {
    const registerSuccess = window.ChartManager.register(
      'dashboard_equity_chart', 
      chartInstance, 
      canvas,
      {
        type: 'equity_curve',
        page: 'dashboard',
        dataPoints: sorted.length,
        createdBy: '_renderEquityChart'
      }
    );
    
    if (!registerSuccess) {
      console.error('资金曲线图表注册失败，执行紧急销毁');
      chartInstance.destroy();
    }
  } else {
    console.warn('ChartManager不可用，使用传统方式管理图表实例');
    // 降级方案：传统的全局变量管理
    window._dashEquityChart = chartInstance;
  }
  
  } catch (error) {
    console.error('创建资金曲线图表失败:', error);
    
    // 错误情况下确保清理
    if (window.ChartManager) {
      window.ChartManager.unregister('dashboard_equity_chart', true);
    }
    
    // 绘制错误提示
    ctx.fillStyle = '#ff4444'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '14px sans-serif';
    ctx.fillText('图表创建失败', rectWidth/2, rectHeight/2);
  }
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
