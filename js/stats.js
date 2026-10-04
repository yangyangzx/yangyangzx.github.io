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
  // 先在全部日志上筛选，再派生已平仓样本；否则“未平仓/状态”筛选会被提前丢弃。
  var filteredLogs = applyFilters(logs);
  let closed = filteredLogs.filter(function(l) { return window.utils.isClosedTrade(l); });
  var hasAnyFilter = !!( _activeFilters.direction || _activeFilters.symbol || _activeFilters.strategy ||
                         _activeFilters.status || _activeFilters.pnl || _activeFilters.time );

  // --- 汇总条：有过滤器时使用完整筛选样本，否则使用全部 ---
  var displayTotal = hasAnyFilter ? filteredLogs.length : totalLogs;
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
  // 所有已平仓交易（包含保本）均是策略执行样本；这样胜率、平均盈亏和期望值可相互核对。
  const sampleCount = closed.length;
  const winRate = sampleCount > 0 ? (wins.length / sampleCount * 100) : 0;
  const totalPnl = grossProfit - grossLoss;
  const avgPnl = sampleCount > 0 ? totalPnl / sampleCount : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const wlRatio = avgLoss > 0 ? (avgWin / avgLoss) : (wins.length > 0 ? Infinity : 0);
  const lossRate = sampleCount > 0 ? (losses.length / sampleCount * 100) : 0;
  const expectancy = sampleCount > 0
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
  // 最大回撤使用与仪表盘/分析页相同的统一权益曲线，避免 capital 开仓快照重置累计收益。
  var ddCurve = window.utils.calcEquityCurve(closed);
  var peak = ddCurve.peakVal;
  var maxDD = ddCurve.maxDDPercent;
  const ddEl = document.getElementById('statMaxDD');
  if (maxDD > 0 || peak > 0) {
    ddEl.textContent = maxDD.toFixed(1) + '%';
    ddEl.classList.remove('dd-danger', 'dd-warn', 'dd-safe');
    ddEl.classList.add(maxDD >= 20 ? 'dd-danger' : maxDD >= 10 ? 'dd-warn' : 'dd-safe');
  } else {
    ddEl.textContent = '—';
    ddEl.style.color = '';
  }

  // ====== 设计优化：风险调整后收益指标 ======
  // 年化收益：总盈亏按首末平仓时间跨度年化（跨度 <1 天按 1 天）
  try {
    var annEl = document.getElementById('statAnnReturn');
    if (annEl) {
      var _t0 = null, _t1 = null;
      for (var _i = 0; _i < closed.length; _i++) {
        var _ct = closed[_i].closeTime ? new Date(closed[_i].closeTime).getTime() : NaN;
        if (isNaN(_ct)) continue;
        if (_t0 === null || _ct < _t0) _t0 = _ct;
        if (_t1 === null || _ct > _t1) _t1 = _ct;
      }
      if (_t0 !== null && _t1 > _t0 && totalPnl !== 0) {
        var _spanDays = Math.max((_t1 - _t0) / 86400000, 1);
        var _ann = totalPnl * (365 / _spanDays);
        annEl.textContent = (_ann >= 0 ? '+' : '') + _ann.toFixed(0) + ' U/年';
        annEl.style.color = _ann >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
        annEl.title = '跨度 ' + _spanDays.toFixed(1) + ' 天';
      } else {
        annEl.textContent = '—';
        annEl.style.color = '';
      }
    }
    // 夏普（日频）：权威实现在 utils.dailySharpe（铺满空闲日 + 365 天年化）。
    // 原先这里内联一份，只取「有平仓的交易日」——持有中无平仓的空闲日整段被丢弃，
    // 持有 20 天只在其中 3 天平仓的账户会按 3 天算，波动率被低估、夏普被系统性抬高；
    // 且年化系数用 252（A股/美股口径），对 7×24 永续合约低估约 31%。现统一委托。
    var shEl = document.getElementById('statSharpe');
    if (shEl) {
      var _sh = window.utils.dailySharpe(closed);
      if (_sh) {
        shEl.textContent = _sh.sharpe.toFixed(2);
        shEl.style.color = _sh.sharpe >= 1 ? 'var(--color-success)' : (_sh.sharpe >= 0 ? 'var(--color-warning)' : 'var(--color-danger)');
        shEl.title = '基于 ' + _sh.days + ' 个持仓日（含 ' + _sh.zeroDays + ' 个无平仓日）· 365 天年化';
      } else {
        shEl.textContent = '—';
        shEl.style.color = '';
        shEl.title = '有效交易日不足 2 天或日盈亏标准差为 0，无法计算';
      }
    }
    // 成本侵蚀：Σ手续费 ÷ Σ(盈利+亏损绝对值)
    // P0 修复：部分平仓链的 item.fee 只是"剩余仓位"round-trip 费（中间态按比例缩减过），
    // 整笔累计费用在 realizedFee（部分平仓链已实现费用累加），直接用 fee 会低估成本侵蚀。
    var cdEl = document.getElementById('statCostDrag');
    if (cdEl) {
      var _feeSum = 0, _grossSum = 0;
      for (var _k = 0; _k < closed.length; _k++) {
        var _fRaw = closed[_k].realizedFee != null && !isNaN(parseFloat(closed[_k].realizedFee))
          ? parseFloat(closed[_k].realizedFee)
          : parseFloat(closed[_k].fee);
        if (!isNaN(_fRaw)) _feeSum += _fRaw;
        var _gp = Math.abs(parseFloat(closed[_k].pnlAmount));
        if (!isNaN(_gp)) _grossSum += _gp;
      }
      if (_grossSum > 0 && _feeSum > 0) {
        var _drag = _feeSum / _grossSum * 100;
        cdEl.textContent = _drag.toFixed(1) + '%';
        cdEl.style.color = _drag > 15 ? 'var(--color-danger)' : (_drag > 8 ? 'var(--color-warning)' : 'var(--color-success)');
        cdEl.title = '总手续费 ' + _feeSum.toFixed(2) + ' U / 毛盈亏 ' + _grossSum.toFixed(2) + ' U';
      } else { cdEl.textContent = '—'; cdEl.style.color = ''; }
    }
  } catch(e) { console.error('[stats] risk-adjusted metrics error:', e); }

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
    // 0R 是有效的保本交易结果，不能因逻辑或运算被转换为空字符串而漏计。
    const rawRm = l.rMultiple;
    const rm = rawRm === null || rawRm === undefined || String(rawRm).trim() === ''
      ? NaN : parseFloat(String(rawRm).replace(/R/g, ''));
    if (!isNaN(rm)) { rrSum += rm; rrCount++; }
  }
  const avgRrEl = document.getElementById('statAvgRR');
  avgRrEl.textContent = rrCount > 0 ? (rrSum / rrCount).toFixed(2) + 'R' : '—';

  // ====== 新增统计：盈亏比偏差 ======
  const avgActualRR = rrCount > 0 ? rrSum / rrCount : null;
  let biasSum = 0, biasCount = 0, biasExcluded = 0;
  for (const l of closed) {
    if (l.direction !== 'long' && l.direction !== 'short') continue;
    const rawRm = l.rMultiple;
    const rm = rawRm === null || rawRm === undefined || String(rawRm).trim() === ''
      ? NaN : parseFloat(String(rawRm).replace(/R/g, ''));
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

  // 权益曲线 & 订单类型明细
  // renderStrategyBreakdown / renderEmotionStats 已删除：二者的守卫是 if(!card||!wrap)return，
  // 而卡片容器 #strategy-breakdown / #emotion-breakdown 在 v5.6 IA 去重时被移除，函数体永久
  // 短路——属于"被调用但从不执行"的死代码。
  // ⚠ 表体容器 #strategyTableWrap / #emotionTableWrap 仍然活着，分别由
  //    analytics.js renderStrategyTable 与 review.js renderEmotionAnalysis 写入，
  //    这两个 id 不要跟着删。
  // orderTypeTableWrap 由下方 renderOrderTypeDistribution 管理，容器在 journalStatsBlock 内常驻。
  try { drawEquityCurve(closed); } catch(e) { console.error('[updateStats] drawEquityCurve error:', e); }
  try { renderOrderTypeDistribution(closed); } catch(e) { console.error('[updateStats] renderOrderTypeDistribution error:', e); }
}

// ==================== 权益概览（峰值 / 最大回撤） ====================
// 只负责把 calcEquityCurve 的结果写成日志页的两个数字。
// 曲线绘制已移除：日志页曾与统计分析页各画一张同源同名的权益曲线，
// 现统一由统计分析页的 renderEquityChart（analytics.js）绘制。
// 两处数值口径仍是同一个 utils.calcEquityCurve，不会分叉。
function drawEquityCurve(closed) {
  const card = document.getElementById('equity-card');
  if (!card) return;
  // 与核心最大回撤指标同用连续账户权益，避免“累计盈亏”曲线把净利润回撤误标为账户回撤。
  const curve = window.utils.calcEquityCurve(closed);
  if (!curve || curve.data.length < 2) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  const peakVal = curve.peakVal;
  const maxDD = curve.maxDDPercent;

  const peakEl = document.getElementById('equityPeak');
  const ddEl = document.getElementById('equityDrawdown');
  if (!peakEl || !ddEl) return;

  peakEl.textContent = peakVal.toFixed(2) + ' USDT';
  ddEl.textContent = (maxDD > 0 ? '-' : '') + maxDD.toFixed(1) + '%';
  ddEl.classList.remove('dd-danger', 'dd-warn', 'dd-safe');
  ddEl.classList.add(maxDD >= 20 ? 'dd-danger' : maxDD >= 10 ? 'dd-warn' : 'dd-safe');
}

// ── 订单类型分布 ──
// 唯一给日志页 #orderTypeCard / #orderTypeTableWrap 写入内容的函数；
// 卡片容器在 index.html（journalStatsBlock 内）里常驻，style="display:none"
// 由本函数在有数据时打开。
function renderOrderTypeDistribution(closed) {
  const card = document.getElementById('orderTypeCard');
  const wrap = document.getElementById('orderTypeTableWrap');
  if (!card || !wrap) return;
  if (!closed || closed.length === 0) {
    card.style.display = 'none';
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
    const sampleCount = trades.length;
    const wr = sampleCount > 0 ? (wins.length / sampleCount * 100) : 0;
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
    card.style.display = 'none';
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

// ── 提取交易日期字符串（YYYY-MM-DD，基于本地时区） ──
// 使用平仓时间（closeTime）判断日期，因为 PnL 在平仓时才实现。
// 无平仓时间时回退到开仓时间（兼容旧数据）。
function _getTradeDate(l) {
  if (!l) return '';
  return window.utils.toLocalDateStr(l.closeTime || l.time);
}

// ==================== 当日连亏计数（纯计算，不更新 UI） ====================
// BUG-6 修复：函数名和注释明确为"连续亏损"（末尾倒序），并导出总亏损笔数供参考
function _getTodayLossStreak() {
  var now = new Date();
  var todayStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  // 先筛选当日已平仓，再按 closeTime 升序排序确保时间顺序正确
  // P0-1 FIX：统一使用 utils.isClosedTrade（部分平仓中间态不计入"已平仓"当日统计）
  var todayClosed = logs.filter(function(l) {
    var isClosed = (typeof window.utils !== 'undefined' && typeof window.utils.isClosedTrade === 'function')
      ? window.utils.isClosedTrade(l)
      : (l.closeType && l.closeType !== '');
    return isClosed && _getTradeDate(l) === todayStr;
  });
  todayClosed.sort(function(a, b) {
    return (a.closeTime || '').localeCompare(b.closeTime || '');
  });
  // 连续亏损：从末尾倒序统计连续亏损笔数
  let streak = 0;
  for (let i = todayClosed.length - 1; i >= 0; i--) {
    const v = parseFloat(todayClosed[i].pnlAmount);
    if (!isNaN(v) && v < 0) { streak++; }
    else { break; }
  }
  // 同时计算当日总亏损笔数（供 UI 参考）
  var totalLossCount = 0;
  for (let j = 0; j < todayClosed.length; j++) {
    const v2 = parseFloat(todayClosed[j].pnlAmount);
    if (!isNaN(v2) && v2 < 0) totalLossCount++;
  }
  return { streak: streak, totalLossCount: totalLossCount };
}

// ==================== 连亏自动计数（限定当日 + UI 更新） ====================
function autoCountLossStreak() {
  const autoCheck = document.getElementById('autoStreakCheck');
  const el = document.getElementById('lossStreak');
  const streakResult = _getTodayLossStreak();
  const streak = streakResult.streak;
  if (autoCheck && autoCheck.checked) {
    // Auto mode: update value and style, then refresh calc
    if (el) {
      el.value = streak;
      el.readOnly = true;
      el.style.borderColor = streak > 0 ? 'var(--color-warning)' : '';
      el.style.boxShadow = streak > 0 ? '0 0 0 3px var(--color-warning-bg)' : '';
    }
    // P3: calculate() 抛错不得向上冒泡（调用点 rendering.js 无 try/catch 保护）
    try { calculate(); } catch(e) { console.error('[autoCountLossStreak] calculate error:', e); }
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
