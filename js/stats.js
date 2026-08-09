// ==================== 统计辅助：胜/负/盈亏汇总 ====================
function computeWinLoss(closed) {
  const wins = [], losses = [];
  let grossProfit = 0, grossLoss = 0;
  for (const l of closed) {
    const v = parseFloat(l.pnlAmount);
    if (isNaN(v)) continue;
    if (v > 0) { wins.push(l); grossProfit += v; }
    else if (v < 0) { losses.push(l); grossLoss += Math.abs(v); }
  }
  return { wins, losses, grossProfit, grossLoss };
}

// ==================== 统计面板 ====================
function updateStats() {
  // --- 基础数据 ---
  var totalLogs = logs.length;
  var allClosed = logs.filter(function(l) { return window.utils.isClosedTrade(l); });
  var allClosedPnl = allClosed.reduce(function(s, l) { return s + (parseFloat(l.pnlAmount) || 0); }, 0);
  var openLogs = totalLogs - allClosed.length;

  // --- 过滤逻辑 ---
  let closed = applyFilters(allClosed);
  var hasAnyFilter = !!( _activeFilters.direction || _activeFilters.symbol || _activeFilters.strategy ||
                         _activeFilters.status || _activeFilters.pnl || _activeFilters.time );

  // --- 汇总条：有过滤器时使用过滤后数据，否则使用全部 ---
  var displayTotal = hasAnyFilter ? closed.length : totalLogs;
  var displayClosed = hasAnyFilter ? closed.length : allClosed.length;
  var displayOpen = hasAnyFilter ? (displayTotal - displayClosed) : openLogs;
  var displayPnl = hasAnyFilter
    ? closed.reduce(function(s, l) { return s + (parseFloat(l.pnlAmount) || 0); }, 0)
    : allClosedPnl;

  var summaryBar = document.getElementById('summaryBar');
  if (summaryBar) {
    summaryBar.style.display = displayTotal > 0 ? 'flex' : 'none';
    document.getElementById('summaryTotal').textContent = displayTotal;
    document.getElementById('summaryClosed').textContent = displayClosed;
    document.getElementById('summaryClosed').style.color = 'var(--color-success)';
    document.getElementById('summaryOpen').textContent = displayOpen;
    document.getElementById('summaryOpen').style.color = 'var(--color-primary)';
    var sp = document.getElementById('summaryPnl');
    sp.textContent = (displayPnl >= 0 ? '+' : '') + displayPnl.toFixed(2) + ' USDT';
    sp.style.color = displayPnl > 0 ? 'var(--color-success)' : displayPnl < 0 ? 'var(--color-danger)' : 'var(--color-text)';
  }

  const panel = document.getElementById('statsPanel');
  if (closed.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'flex';

  // 过滤指示器：有活跃过滤器时展示筛选后 vs 全部对比
  var filterBadge = document.getElementById('statsFilterBadge');
  if (!filterBadge) {
    filterBadge = document.createElement('div');
    filterBadge.id = 'statsFilterBadge';
    filterBadge.style.cssText = 'text-align:center;font-size:11px;color:var(--color-text-muted);padding:4px 0 8px;border-bottom:1px solid var(--color-border-light);margin-bottom:8px;display:none;';
    panel.insertBefore(filterBadge, panel.firstChild);
  }
  if (hasAnyFilter) {
    filterBadge.style.display = 'block';
    filterBadge.textContent = '筛选后 ' + closed.length + '/' + allClosed.length + ' 笔  |  盈亏 ' + (displayPnl >= 0 ? '+' : '') + displayPnl.toFixed(2) + ' USDT（全部 ' + (allClosedPnl >= 0 ? '+' : '') + allClosedPnl.toFixed(2) + '）';
  } else {
    filterBadge.style.display = 'none';
  }
  const { wins, losses, grossProfit, grossLoss } = computeWinLoss(closed);
  const decidedCnt = wins.length + losses.length;  // count of trades with definitive outcome (excludes break-even)
  const winRate = decidedCnt > 0 ? (wins.length / decidedCnt * 100) : 0;
  const totalPnl = grossProfit - grossLoss;
  const avgPnl = decidedCnt > 0 ? totalPnl / decidedCnt : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const wlRatio = avgL > 0 ? (avgW / avgL) : (wins.length > 0 ? Infinity : 0);
  const lossRate = decidedCnt > 0 ? (losses.length / decidedCnt * 100) : 0;
  const expectancy = decidedCnt > 0
    ? ((winRate / 100) * avgWin - (lossRate / 100) * avgLoss)
    : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (wins.length > 0 ? Infinity : 0);

  document.getElementById('statClosed').textContent = closed.length;
  const winRateEl = document.getElementById('statWinRate');
  winRateEl.textContent = winRate.toFixed(1) + '%';
  winRateEl.className = 'stat-value ' + (winRate >= 50 ? 'positive' : winRate >= 40 ? 'neutral' : 'negative');
  winRateEl.innerHTML = winRate.toFixed(1) + '% <span class="stat-bar"><span class="stat-bar-fill" style="width:' + winRate + '%;"></span></span>';
  const avgPnlEl = document.getElementById('statAvgPnl');
  avgPnlEl.textContent = (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(2);
  avgPnlEl.className = 'stat-value ' + (avgPnl > 0 ? 'positive' : avgPnl < 0 ? 'negative' : 'neutral');
  const wlRatioStr = wlRatio > 0 ? wlRatio.toFixed(2) + ':1' : (grossLoss === 0 && wins.length > 0 ? '∞:1' : '—');
  document.getElementById('statWLRatio').textContent = wlRatioStr;
  const expEl = document.getElementById('statExpectancy');
  expEl.textContent = (expectancy >= 0 ? '+' : '') + expectancy.toFixed(2);
  expEl.className = 'stat-value ' + (expectancy > 0 ? 'positive' : expectancy < 0 ? 'negative' : 'neutral');
  document.getElementById('statProfitFactor').textContent = profitFactor === Infinity ? '∞' : profitFactor.toFixed(2);
  const totalPnlEl = document.getElementById('statTotalPnl');
  totalPnlEl.textContent = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2) + ' USDT';
  totalPnlEl.style.color = totalPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  totalPnlEl.className = 'stat-value ' + (totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : 'neutral');
  // 最大回撤（按平仓时间排序确保 PnL 实现时序正确，纳入初始本金）
  var sortedClosed = [...closed].sort(function(a, b) { return new Date(a.closeTime || a.time) - new Date(b.closeTime || b.time); });
  // 初始权益：从首笔已平仓日志的 capital 取，无则从 settings.accountBalance 兜底
  var initialCapital = 0;
  if (sortedClosed.length > 0 && sortedClosed[0].capital != null && !isNaN(sortedClosed[0].capital) && sortedClosed[0].capital > 0) {
    initialCapital = sortedClosed[0].capital;
  } else {
    try { var _s = loadSettings(); if (_s.accountBalance > 0) initialCapital = _s.accountBalance; } catch(e) {}
  }
  let peak = initialCapital, maxDD = 0;
  let runningEquity = initialCapital;
  for (const l of sortedClosed) {
    // M5: 仅当 capital 变化时才视为存款/取款事件，否则累加 PnL
    var capVal = parseFloat(l.capital);
    if (!isNaN(capVal) && capVal > 0 && capVal !== runningEquity) {
      runningEquity = capVal;
    } else {
      runningEquity += (parseFloat(l.pnlAmount) || 0);
    }
    peak = Math.max(peak, runningEquity);
    const dd = peak > 0 ? (peak - runningEquity) / peak * 100 : 0;
    maxDD = Math.max(maxDD, dd);
  }
  const ddEl = document.getElementById('statMaxDD');
  if (maxDD > 0 || peak > 0) {
    ddEl.textContent = maxDD.toFixed(1) + '%';
    ddEl.classList.remove('dd-danger', 'dd-warn', 'dd-safe');
    ddEl.classList.add(maxDD >= 20 ? 'dd-danger' : maxDD >= 10 ? 'dd-warn' : 'dd-safe');
  } else {
    ddEl.textContent = '—';
    ddEl.style.color = '';
  }

  // ====== 新增统计：目标达成率 ======
  let targetTotal = 0, targetHit = 0;
  for (const l of closed) {
    if (l.targetPrice == null || l.closePrice == null) continue;
    const tp = parseFloat(l.targetPrice), cp = parseFloat(l.closePrice);
    if (isNaN(tp) || isNaN(cp)) continue;
    if (l.direction !== 'long' && l.direction !== 'short') continue;
    targetTotal++;
    if (l.direction === 'long' && cp >= tp) targetHit++;
    else if (l.direction === 'short' && cp <= tp) targetHit++;
  }
  const targetRateEl = document.getElementById('statTargetRate');
  const targetRateVal = targetTotal > 0 ? (targetHit / targetTotal * 100) : null;
  if (targetRateVal !== null) {
    targetRateEl.innerHTML = targetRateVal.toFixed(1) + '% <span class="stat-bar"><span class="stat-bar-fill" style="width:' + targetRateVal + '%;"></span></span>';
    targetRateEl.style.color = targetRateVal >= 50 ? 'var(--color-success)' : 'var(--color-danger)';
    targetRateEl.className = 'stat-value ' + (targetRateVal >= 50 ? 'positive' : 'negative');
  } else {
    targetRateEl.textContent = '—';
    targetRateEl.style.color = '';
    targetRateEl.className = 'stat-value neutral';
  }

  // ====== 新增统计：平均实际R:R ======
  let rrSum = 0, rrCount = 0;
  for (const l of closed) {
    const rm = parseFloat(String(l.rMultiple || '').replace(/R/g, ''));
    if (!isNaN(rm)) { rrSum += rm; rrCount++; }
  }
  const avgRrEl = document.getElementById('statAvgRR');
  avgRrEl.textContent = rrCount > 0 ? (rrSum / rrCount).toFixed(2) + 'R' : '—';

  // ====== 新增统计：盈亏比偏差 ======
  const avgActualRR = rrCount > 0 ? rrSum / rrCount : null;
  let biasSum = 0, biasCount = 0, biasExcluded = 0;
  for (const l of closed) {
    if (l.direction !== 'long' && l.direction !== 'short') continue;
    const rm = parseFloat(String(l.rMultiple || '').replace(/R/g, ''));
    const tRR = l.targetRR;
    if (!isNaN(rm) && tRR != null && !isNaN(tRR) && tRR > 0) {
      biasSum += rm / tRR;
      biasCount++;
    } else if (tRR == null) {
      biasExcluded++;
    }
  }
  const biasEl = document.getElementById('statRRBias');
  if (biasCount > 0) {
    const bias = biasSum / biasCount;
    biasEl.textContent = (bias >= 1 ? '+' : '') + ((bias - 1) * 100).toFixed(1) + '%';
    biasEl.style.color = bias >= 1 ? 'var(--color-success)' : (bias >= 0.8 ? 'var(--color-warning)' : 'var(--color-danger)');
    if (biasExcluded > 0) {
      biasEl.title = '其中 ' + biasExcluded + ' 笔无预判目标价，已排除';
    }
  } else {
    biasEl.textContent = '—';
    biasEl.style.color = '';
  }
  // ====== 新增统计：MAE / MFE ======
  // MAE 仅统计亏损单（与 tooltip "仅亏损单的MAE平均值" 一致）
  // MFE 统计全部已平仓交易
  let maeTotal = 0, maeCount = 0;
  let mfeTotal = 0, mfeCount = 0;
  let maemfeTotal = 0, maemfeCount = 0;
  for (const l of closed) {
    const pnl = parseFloat(l.pnlAmount);
    const mae = parseFloat(l.mae);
    const mfe = parseFloat(l.mfe);
    // MAE: 仅亏损单
    if (!isNaN(mae) && !isNaN(pnl) && pnl < 0) {
      maeTotal += Math.abs(mae); maeCount++;
    }
    // MFE: 全部已平仓（含盈亏）
    if (!isNaN(mfe)) { mfeTotal += mfe; mfeCount++; }
    // MFE/MAE: 仅亏损单（分子分母同属同一亏损单，比率有意义）
    if (!isNaN(mae) && !isNaN(mfe) && !isNaN(pnl) && pnl < 0 && mae !== 0) {
      maemfeTotal += Math.abs(mfe / mae);
      maemfeCount++;
    }
  }
  const avgMaeEl = document.getElementById('statAvgMAE');
  avgMaeEl.textContent = maeCount > 0 ? (maeTotal / maeCount).toFixed(2) + '%' : '—';
  avgMaeEl.style.color = maeCount > 0 ? 'var(--color-danger)' : '';
  const avgMfeEl = document.getElementById('statAvgMFE');
  avgMfeEl.textContent = mfeCount > 0 ? '+' + (mfeTotal / mfeCount).toFixed(2) + '%' : '—';
  avgMfeEl.style.color = mfeCount > 0 ? 'var(--color-success)' : '';
  const maemfeEl = document.getElementById('statMAEMFE');
  maemfeEl.textContent = maemfeCount > 0 ? (maemfeTotal / maemfeCount).toFixed(2) : '—';
  maemfeEl.style.color = maemfeCount > 0 ? (maemfeTotal / maemfeCount >= 1.5 ? 'var(--color-success)' : 'var(--color-danger)') : '';
  // 平均持仓时长
  const avgHoldEl = document.getElementById('statAvgHold');
  let totalHoldMin = 0, holdCount = 0;
  for (const l of closed) {
    if (l.holdDuration != null && !isNaN(Number(l.holdDuration)) && Number(l.holdDuration) > 0) {
      totalHoldMin += Number(l.holdDuration);
      holdCount++;
    }
  }
  if (holdCount > 0) {
    const avg = Math.round(totalHoldMin / holdCount);
    const hrs = Math.floor(avg / 60);
    const mins = avg % 60;
    if (avg < 60) avgHoldEl.textContent = avg + 'm';
    else if (hrs < 24) avgHoldEl.textContent = hrs + 'h' + (mins > 0 ? ' ' + mins + 'm' : '');
    else { const days = Math.floor(hrs / 24); const remHrs = hrs % 24; avgHoldEl.textContent = days + 'd' + (remHrs > 0 ? ' ' + remHrs + 'h' : ''); }
  } else {
    avgHoldEl.textContent = '—';
  }

  // 权益曲线 & 策略拆解
  try { drawEquityCurve(closed); } catch(e) { console.error('[updateStats] drawEquityCurve error:', e); }
  try { renderStrategyBreakdown(closed); } catch(e) { console.error('[updateStats] renderStrategyBreakdown error:', e); }
  try { renderOrderTypeDistribution(closed); } catch(e) { console.error('[updateStats] renderOrderTypeDistribution error:', e); }
  try { renderEmotionStats(closed); } catch(e) { console.error('[updateStats] renderEmotionStats error:', e); }
}

// ==================== 权益曲线 ====================
function drawEquityCurve(closed) {
  const card = document.getElementById('equity-card');
  if (!card) return;
  const curve = window.utils.calcEquityCurve(closed, null, { purePnl: true });
  if (!curve || curve.data.length < 2) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  // 保留排序后的原始日志用于 tooltip 展示
  var sortedClosed = [].concat(closed).sort(function(a, b) {
    return new Date(a.closeTime || a.time) - new Date(b.closeTime || b.time);
  });

  const canvas = document.getElementById('equityCanvas');
  const tooltip = document.getElementById('equity-tooltip');
  if (!canvas || !tooltip) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = rect.width;
  const H = 200;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const data = curve.data;
  const peakVal = curve.peakVal;
  const maxDD = curve.maxDDPercent;

  document.getElementById('equityPeak').textContent = (peakVal >= 0 ? '+' : '') + peakVal.toFixed(2) + ' USDT';
  const ddEl = document.getElementById('equityDrawdown');
  ddEl.textContent = (maxDD > 0 ? '-' : '') + maxDD.toFixed(1) + '%';
  ddEl.classList.remove('dd-danger', 'dd-warn', 'dd-safe');
  ddEl.classList.add(maxDD >= 20 ? 'dd-danger' : maxDD >= 10 ? 'dd-warn' : 'dd-safe');

  // 自适应 Y 轴
  const allVals = data.map(d => d.eq);
  let yMin = Math.min(0, Math.min.apply(null, allVals));
  let yMax = Math.max(0, Math.max.apply(null, allVals));
  const yPad = Math.max((yMax - yMin) * 0.1, 5);
  yMin -= yPad; yMax += yPad;

  const pad = { top: 16, right: 16, bottom: 28, left: 48 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const xScale = d => pad.left + (d / (data.length - 1)) * plotW;
  const yScale = v => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // 背景
  ctx.clearRect(0, 0, W, H);
  var c = utils.getCanvasColors();
  ctx.fillStyle = c.bg;
  ctx.fillRect(pad.left, pad.top, plotW, plotH);

  // 网格
  ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const v = yMin + (yMax - yMin) * (i / ySteps);
    const y = yScale(v);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
    ctx.fillStyle = c.text; ctx.font = '11px -apple-system, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(0), pad.left - 6, y + 4);
  }

  // 零线
  if (yMin < 0 && yMax > 0) {
    const y0 = yScale(0);
    ctx.strokeStyle = c.zero; ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, y0); ctx.lineTo(pad.left + plotW, y0); ctx.stroke();
    ctx.setLineDash([]);
  }

  // X 轴标签
  ctx.fillStyle = c.text; ctx.font = '11px -apple-system, sans-serif'; ctx.textAlign = 'center';
  const xSteps = Math.min(data.length, 8);
  const step = Math.max(Math.floor(data.length / xSteps), 1);
  for (let i = 0; i < data.length; i += step) {
    ctx.fillText(_getTradeDate(sortedClosed[i]).slice(5), xScale(i), H - 4);
  }

  // 曲线：分段着色
  for (let i = 1; i < data.length; i++) {
    const up = data[i].eq >= data[i - 1].eq;
    ctx.strokeStyle = up ? c.up : c.down;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(xScale(i - 1), yScale(data[i - 1].eq));
    ctx.lineTo(xScale(i), yScale(data[i].eq));
    ctx.stroke();
  }

  // 数据点
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const up = i > 0 ? d.eq >= data[i - 1].eq : (d.eq >= 0);
    ctx.fillStyle = up ? c.up : c.down;
    ctx.beginPath(); ctx.arc(xScale(i), yScale(d.eq), 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.ptCenter;
    ctx.beginPath(); ctx.arc(xScale(i), yScale(d.eq), 2, 0, Math.PI * 2); ctx.fill();
  }

  // 悬停
  canvas.onmousemove = function(e) {
    const mx = e.offsetX;
    let closest = null, closestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(mx - xScale(i));
      if (dist < closestDist) { closestDist = dist; closest = i; }
    }
    if (closest === null || closestDist > 30) { tooltip.style.display = 'none'; return; }
    const d = data[closest];
    var sc = sortedClosed[closest];
    tooltip.innerHTML = '<b>#' + (closest + 1) + ' ' + (sc.symbol || '') + '</b><br>' +
      _getTradeDate(sc) + '<br>' +
      '盈亏: ' + (d.pnl >= 0 ? '+' : '') + d.pnl.toFixed(2) + ' USDT<br>' +
      '累计: ' + (d.eq >= 0 ? '+' : '') + d.eq.toFixed(2) + ' USDT';
    tooltip.style.display = 'block';
    const tx = xScale(closest) + 12;
    const ty = yScale(d.eq) - 10;
    const tr = canvas.parentElement.getBoundingClientRect();
    tooltip.style.left = tx + 'px';
    tooltip.style.top = Math.max(0, ty) + 'px';
  };
  canvas.onmouseleave = function() { tooltip.style.display = 'none'; };
}

// ==================== 策略绩效拆解 ====================
function renderStrategyBreakdown(closed) {
  const card = document.getElementById('strategy-breakdown');
  const wrap = document.getElementById('strategyTableWrap');
  if (!card || !wrap) return;
  if (!closed || closed.length === 0) {
    card.style.display = 'block';
    wrap.innerHTML = '<div class="empty-hint">暂无平仓数据</div>';
    return;
  }

  // 分组：使用框架+形态双维度（与 analytics.js 口径一致）
  const groups = {};
  for (const l of closed) {
    const framework = l.strategyFramework || '(未分类)';
    const rawPattern = l.strategyPattern || '';
    const patternName = rawPattern ? (rawPattern.includes('|') ? rawPattern.split('|').pop().trim() : rawPattern.trim()) : '未标记';
    const key = framework + '|' + patternName;
    if (!groups[key]) groups[key] = { framework, patternName, trades: [] };
    groups[key].trades.push(l);
  }

  const rows = [];
  for (const [key, group] of Object.entries(groups)) {
    const trades = group.trades;
    const cnt = trades.length;
    const { wins, losses, grossProfit, grossLoss } = computeWinLoss(trades);
    const decided = wins.length + losses.length;
    const wr = decided > 0 ? (wins.length / decided * 100) : 0;
    const lossRate = decided > 0 ? (losses.length / decided * 100) : 0;
    const tPnl = grossProfit - grossLoss;
    const avgW = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgL = losses.length > 0 ? grossLoss / losses.length : 0;
    // 统一使用平均金额比（与策略拆解口径一致）
    const wlR = avgL > 0 ? avgW / avgL : 0;
    const exp = decided > 0 ? (wr / 100) * avgW - (lossRate / 100) * avgL : 0;
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (wins.length > 0 ? Infinity : 0);
    let maeSum = 0, maeCnt = 0;
    for (const l of trades) {
      const m = parseFloat(l.mae);
      const pnl = parseFloat(l.pnlAmount);
      // 与全局口径一致：MAE 仅统计亏损单（pnl < 0）
      if (!isNaN(m) && !isNaN(pnl) && pnl < 0) { maeSum += Math.abs(m); maeCnt++; }
    }
    const avgMAE = maeCnt > 0 ? maeSum / maeCnt : null;
    rows.push({ name: group.framework + ' - ' + group.patternName, framework: group.framework, patternName: group.patternName, cnt, wr, tPnl, exp, wlR, pf, avgMAE, lowSample: cnt < 2 });
  }

  if (rows.length === 0) {
    card.style.display = 'block';
    wrap.innerHTML = '<div class="empty-hint">暂无策略数据</div>';
    return;
  }

  rows.sort((a, b) => b.tPnl - a.tPnl);
  card.style.display = 'block';

  let html = '<table><thead><tr>' +
    '<th>策略框架</th><th>形态</th><th>笔数</th><th>胜率</th><th>总盈亏</th>' +
    '<th>期望值</th><th>盈亏比</th><th>利润因子</th><th>均MAE</th>' +
    '</tr></thead><tbody>';
  for (const r of rows) {
    const cls = r.lowSample ? ' class="low-sample"' : '';
    const pnlCls = r.tPnl > 0 ? 'positive' : r.tPnl < 0 ? 'negative' : '';
    html += '<tr' + cls + '>' +
      '<td>' + r.framework + '</td>' +
      '<td>' + r.patternName + (r.lowSample ? ' <span style="font-size:10px;">(n<' + r.cnt + ')</span>' : '') + '</td>' +
      '<td>' + r.cnt + '</td>' +
      '<td>' + r.wr.toFixed(1) + '%</td>' +
      '<td class="' + pnlCls + '">' + (r.tPnl >= 0 ? '+' : '') + r.tPnl.toFixed(2) + '</td>' +
      '<td>' + (r.exp >= 0 ? '+' : '') + r.exp.toFixed(2) + '</td>' +
      '<td>' + (r.wlR > 0 ? r.wlR.toFixed(2) + ':1' : '—') + '</td>' +
      '<td>' + (r.pf === Infinity ? '∞' : r.pf.toFixed(2)) + '</td>' +
      '<td>' + (r.avgMAE !== null ? r.avgMAE.toFixed(2) + '%' : '—') + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ── 订单类型分布 ──
function renderOrderTypeDistribution(closed) {
  const card = document.getElementById('orderTypeCard');
  const wrap = document.getElementById('orderTypeTableWrap');
  if (!card || !wrap) return;
  if (!closed || closed.length === 0) {
    card.style.display = 'block';
    wrap.innerHTML = '<div class="empty-hint">暂无平仓数据</div>';
    return;
  }

  // 分组
  const groups = {};
  for (const l of closed) {
    const key = l.orderType || 'market';
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  }

  const rows = [];
  for (const [name, trades] of Object.entries(groups)) {
    const cnt = trades.length;
    const { wins, losses, grossProfit, grossLoss } = computeWinLoss(trades);
    const decided = wins.length + losses.length;
    const wr = decided > 0 ? (wins.length / decided * 100) : 0;
    const tPnl = grossProfit - grossLoss;
    const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (wins.length > 0 ? '∞' : '0');
    const avgW = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgL = losses.length > 0 ? grossLoss / losses.length : 0;
    const wlR = avgL > 0 ? (avgW / avgL).toFixed(2) + ':1' : '—';
    const label = ORDER_TYPE_LABELS[name] || name;
    const groupName = ORDER_TYPE_GROUP[name] || '';
    rows.push({ name, label, groupName, cnt, wr, tPnl, pf, wlR, lowSample: cnt < 2 });
  }

  if (rows.length === 0) {
    card.style.display = 'block';
    wrap.innerHTML = '<div class="empty-hint">暂无订单类型数据</div>';
    return;
  }

  rows.sort((a, b) => b.tPnl - a.tPnl);
  card.style.display = 'block';

  var html = '<table><thead><tr>' +
    '<th>订单类型</th><th>分组</th><th>笔数</th><th>胜率</th><th>总盈亏</th>' +
    '<th>盈亏比</th><th>利润因子</th>' +
    '</tr></thead><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cls = r.lowSample ? ' class="low-sample"' : '';
    var pnlCls = r.tPnl > 0 ? 'positive' : r.tPnl < 0 ? 'negative' : '';
    html += '<tr' + cls + '>' +
      '<td>' + r.label + '</td>' +
      '<td>' + r.groupName + '</td>' +
      '<td>' + r.cnt + '</td>' +
      '<td>' + r.wr.toFixed(1) + '%</td>' +
      '<td class="' + pnlCls + '">' + (r.tPnl >= 0 ? '+' : '') + r.tPnl.toFixed(2) + '</td>' +
      '<td>' + r.wlR + '</td>' +
      '<td>' + r.pf + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ── 心态胜率统计 ──
function renderEmotionStats(closed) {
  const card = document.getElementById('emotion-breakdown');
  const wrap = document.getElementById('emotionTableWrap');
  if (!card || !wrap) return;
  if (!closed || closed.length === 0) {
    card.style.display = 'block';
    wrap.innerHTML = '<div class="empty-hint">暂无平仓数据</div>';
    return;
  }

  // 统计：每个情绪独立统计 + 无情绪行
  const stats = {}; // key: emotion value -> { wins, losses, grossProfit, grossLoss }
  let noEmotionWins = 0, noEmotionLosses = 0, noEmotionPnl = 0;
  const EM_VALUES = EMOTION_OPTIONS.map(function(o) { return o.value; });
  EM_VALUES.forEach(function(v) { stats[v] = { wins:0, losses:0, grossProfit:0, grossLoss:0 }; });

  for (var i = 0; i < closed.length; i++) {
    var l = closed[i];
    var pnl = parseFloat(l.pnlAmount) || 0;
    if (l.emotions && l.emotions.length > 0) {
      for (var j = 0; j < l.emotions.length; j++) {
        var e = l.emotions[j];
        if (!stats[e]) continue;
        if (pnl > 0) { stats[e].wins++; stats[e].grossProfit += pnl; }
        else if (pnl < 0) { stats[e].losses++; stats[e].grossLoss += Math.abs(pnl); }
      }
    } else {
      if (pnl > 0) { noEmotionWins++; noEmotionPnl += pnl; }
      else if (pnl < 0) { noEmotionLosses++; noEmotionPnl += pnl; }
    }
  }

  // 构建行
  var rows = [];
  EM_VALUES.forEach(function(v) {
    var s = stats[v];
    var total = s.wins + s.losses;
    if (total === 0) return;
    var wr = total > 0 ? (s.wins / total * 100) : 0;
    var tPnl = s.grossProfit - s.grossLoss;
    rows.push({ name:v, cnt:total, wr:wr, tPnl:tPnl });
  });
  if (noEmotionWins + noEmotionLosses > 0) {
    var noTotal = noEmotionWins + noEmotionLosses;
    var noWr = noTotal > 0 ? (noEmotionWins / noTotal * 100) : 0;
    rows.push({ name:'无情绪', cnt:noTotal, wr:noWr, tPnl:noEmotionPnl });
  }

  if (rows.length === 0) {
    card.style.display = 'block';
    wrap.innerHTML = '<div class="empty-hint">暂无情绪数据</div>';
    return;
  }

  rows.sort(function(a, b) { return b.tPnl - a.tPnl; });
  card.style.display = 'block';

  var html = '<table><thead><tr><th>情绪</th><th>笔数</th><th>胜率</th><th>盈亏合计 <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（含重复计数）</span></th></tr></thead><tbody>';
  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    var cls = r.tPnl > 0 ? 'positive' : r.tPnl < 0 ? 'negative' : '';
    html += '<tr><td>' + r.name + '</td><td>' + r.cnt + '</td><td>' + r.wr.toFixed(1) + '%</td>' +
      '<td class="' + cls + '">' + (r.tPnl >= 0 ? '+' : '') + r.tPnl.toFixed(2) + ' U</td></tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ── 提取交易日期字符串（YYYY-MM-DD，基于本地时区） ──
// 使用平仓时间（closeTime）判断日期，因为 PnL 在平仓时才实现。
// 无平仓时间时回退到开仓时间（兼容旧数据）。
function _getTradeDate(l) {
  if (!l) return '';
  return window.utils.toLocalDateStr(l.closeTime || l.time);
}

// ==================== 当日连亏计数（纯计算，不更新 UI） ====================
function _getTodayLossStreak() {
  var now = new Date();
  var todayStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  // 先筛选当日已平仓，再按 closeTime 升序排序确保时间顺序正确
  var todayClosed = logs.filter(function(l) {
    return l.closeType && l.closeType !== '' && _getTradeDate(l) === todayStr;
  });
  todayClosed.sort(function(a, b) {
    return (a.closeTime || '').localeCompare(b.closeTime || '');
  });
  let streak = 0;
  for (let i = todayClosed.length - 1; i >= 0; i--) {
    const v = parseFloat(todayClosed[i].pnlAmount);
    if (!isNaN(v) && v < 0) { streak++; }
    else { break; }
  }
  return streak;
}

// ==================== 连亏自动计数（限定当日 + UI 更新） ====================
function autoCountLossStreak() {
  const autoCheck = document.getElementById('autoStreakCheck');
  const el = document.getElementById('lossStreak');
  const streak = _getTodayLossStreak();
  if (autoCheck && autoCheck.checked) {
    // Auto mode: update value and style, then refresh calc
    if (el) {
      el.value = streak;
      el.readOnly = true;
      el.style.borderColor = streak > 0 ? 'var(--color-warning)' : '';
      el.style.boxShadow = streak > 0 ? '0 0 0 3px var(--color-warning-bg)' : '';
    }
    calculate();
  } else {
    // Manual mode: only update style based on current value
    if (el) {
      el.readOnly = false;
      const curVal = parseInt(el.value) || 0;
      el.style.borderColor = curVal > 0 ? 'var(--color-warning)' : '';
      el.style.boxShadow = curVal > 0 ? '0 0 0 3px var(--color-warning-bg)' : '';
    }
  }
}

// ==================== 自动检测切换 ====================
function toggleAutoStreak() {
  const autoCheck = document.getElementById('autoStreakCheck');
  const el = document.getElementById('lossStreak');
  if (autoCheck && el) {
    if (autoCheck.checked) {
      el.readOnly = true;
      autoCountLossStreak();
    } else {
      el.readOnly = false;
    }
  }
}
