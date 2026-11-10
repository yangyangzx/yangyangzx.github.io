// ==================== 统计辅助：胜/负/盈亏汇总 ====================
function computeWinLoss(closed) {
  const wins = [], losses = [];
  let grossProfit = 0, grossLoss = 0;
  for (const l of closed) {
    // v5.6.43：parseFloat('Infinity') === Infinity 且 isNaN(Infinity) === false，
    // 旧写法把 Infinity 累加进 grossProfit，利润因子/期望值/成本侵蚀全被污染。
    // toFiniteNum 的 fallback=null 让非有限值直接跳过，0（保本）仍是合法值。
    const v = toFiniteNum(l.pnlAmount, null);
    if (v === null) continue;
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
  var allClosedPnl = allClosed.reduce(function(s, l) { return s + (toFiniteNum(l.pnlAmount)); }, 0);
  var openLogs = totalLogs - allClosed.length;

  // --- 过滤逻辑 ---
  // 先在全部日志上筛选，再派生已平仓样本；否则“未平仓/状态”筛选会被提前丢弃。
  var filteredLogs = applyFilters(logs);
  // P1-04：统计卡 / 分析页图表 / 风控中心共用 utils.getDisplayClosed() 单一入口，
  // 顺序保持「先 applyFilters(logs) 再筛 isClosedTrade」，不丢 status 筛选维度。
  let closed = window.utils.getDisplayClosed();
  var hasAnyFilter = !!( _activeFilters.direction || _activeFilters.symbol || _activeFilters.strategy ||
                         _activeFilters.status || _activeFilters.pnl || _activeFilters.time );

  // --- 汇总条：有过滤器时使用完整筛选样本，否则使用全部 ---
  var displayTotal = hasAnyFilter ? filteredLogs.length : totalLogs;
  var displayClosed = hasAnyFilter ? closed.length : allClosed.length;
  var displayOpen = hasAnyFilter ? (displayTotal - displayClosed) : openLogs;
  var displayPnl = hasAnyFilter
    ? closed.reduce(function(s, l) { return s + (toFiniteNum(l.pnlAmount)); }, 0)
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
  // Infinity > 0 为 true，Infinity.toFixed(2) 得到字符串 "Infinity" —— 无亏损单时
  // 卡片会显示「Infinity:1」，而下方 profitFactor 同页显示「∞」，同一面板两种无穷写法。
  // 原先那个 '∞:1' 分支（wlRatio === 0 且 wins.length > 0）永远不可达。
  const wlRatioStr = wlRatio === Infinity ? '∞:1' : (wlRatio > 0 ? wlRatio.toFixed(2) + ':1' : '—');
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
  // P0-5：缺 capital 时曲线 fail-closed 返回空数据，必须显式告知用户，
  // 不能用「—」冒充「没有回撤」，否则会误导成风险已达标。
  if (!ddCurve.capitalKnown && closed.length > 0) {
    ddEl.textContent = '—';
    ddEl.style.color = '';
    ddEl.title = '缺少开仓本金快照（capital），无法计算权益与最大回撤';
  } else if (maxDD > 0 || peak > 0) {
    ddEl.textContent = maxDD.toFixed(1) + '%';
    ddEl.classList.remove('dd-danger', 'dd-warn', 'dd-safe');
    // 阈值走 utils.drawdownAlertClass（单一权威，读 settings.maxDrawdownAlert）。
    // 此前此处写死 20/10，用户改设置后本面板与风控中心会给出相反结论。
    ddEl.classList.add(window.utils.drawdownAlertClass(maxDD));
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
      // v5.6.43 P0：原实现按「金额线性外推」totalPnl × 365/span 当作年化收益，
      // 既不含本金（本金 10000 与 1000000 给出同一个 U/年），也不是复利/百分比，
      // 实测当日 +100 U 显示「+36500 U/年」。改 CAGR：
      //   CAGR = (期末权益 / 期初权益)^(365/跨度天数) − 1
      // 期初权益取不到（新用户 accountBalance=0）或权益被打穿时 fail-closed 显示「—」。
      // P1-03：CAGR 与夏普共用 resolveStartEquity —— 筛选态用样本 capital 均值
      // （缺字段即 null，绝不退回全局账户余额冒充），非筛选态用全局本金。
      // 旧实现分子用筛选样本 totalPnl、分母却恒用全局本金，口径自相矛盾。
      var _startEqRaw = window.utils.resolveStartEquity(closed, hasAnyFilter,
        (typeof getAccountCapital === 'function') ? getAccountCapital() : null);
      var _startEq = Number(_startEqRaw);
      if (_t0 !== null && _t1 > _t0 && totalPnl !== 0 &&
          Number.isFinite(_startEq) && _startEq > 0) {
        var _spanDays = Math.max((_t1 - _t0) / 86400000, 1);
        var _endEq = _startEq + totalPnl;
        if (_endEq > 0) {
          var _cagr = Math.pow(_endEq / _startEq, 365 / _spanDays) - 1;
          annEl.textContent = (_cagr >= 0 ? '+' : '') + (_cagr * 100).toFixed(2) + '% / 年';
          annEl.style.color = _cagr >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
          annEl.title = 'CAGR（复利年化）：期初权益 ' + _startEq.toFixed(2) +
            ' USDT → 期末权益 ' + _endEq.toFixed(2) + ' USDT，跨度 ' + _spanDays.toFixed(1) +
            ' 天；短期样本外推波动极大，仅供参考';
        } else {
          annEl.textContent = '—';
          annEl.style.color = '';
          annEl.title = '权益已≤0，CAGR 无实数解';
        }
      } else {
        annEl.textContent = '—';
        annEl.style.color = '';
        annEl.title = (hasAnyFilter && _startEqRaw === null)
          ? '当前筛选样本缺少期初权益（capital）字段，无法计算 CAGR'
          : (!Number.isFinite(_startEq) || _startEq <= 0)
            ? '未读取到期初权益（账户余额），无法计算 CAGR。请在系统设置中填写账户余额。'
            : '有效平仓时间跨度不足或区间盈亏为 0，无法计算 CAGR';
      }
    }
    // 夏普（日频）：权威实现在 utils.dailySharpe（铺满空闲日 + 365 天年化）。
    // 原先这里内联一份，只取「有平仓的交易日」——持有中无平仓的空闲日整段被丢弃，
    // 持有 20 天只在其中 3 天平仓的账户会按 3 天算，波动率被低估、夏普被系统性抬高；
    // 且年化系数用 252（A股/美股口径），对 7×24 永续合约低估约 31%。现统一委托。
    // v5.6.42：夏普已改为【日收益率】口径，必须传入期初权益；账户余额取不到时
    // dailySharpe 返回 null，这里显示「—」并说明原因，绝不退回旧的金额口径。
    var shEl = document.getElementById('statSharpe');
    if (shEl) {
      // v5.6.43：筛选态下 closed 只是子集，却拿全局账户余额当日收益率的分母，
      // 会把「只看 BTC」的收益摊到全账户本金上，夏普被系统性压低。
      // 筛选样本每条都带合法 capital 时改用该样本的期初权益均值；缺字段时
      // fail-closed 返回 null（显示「—」），不用全局本金冒充。
      // P1-03：与上方 CAGR 走同一个 resolveStartEquity，杜绝两处本金口径分叉。
      var _sharpeEquity = window.utils.resolveStartEquity(closed, hasAnyFilter,
        (typeof getAccountCapital === 'function') ? getAccountCapital() : null);
      var _sh = window.utils.dailySharpe(closed, { startEquity: _sharpeEquity });
      if (_sh) {
        shEl.textContent = _sh.sharpe.toFixed(2);
        shEl.style.color = _sh.sharpe >= 1 ? 'var(--color-success)' : (_sh.sharpe >= 0 ? 'var(--color-warning)' : 'var(--color-danger)');
        shEl.title = '日收益率口径 · 期初权益 ' + _sh.startEquity.toFixed(2) + ' USDT' +
          (hasAnyFilter ? '（当前筛选样本口径）' : '') + ' · ' +
          '基于 ' + _sh.days + ' 个持仓日（含 ' + _sh.zeroDays + ' 个无平仓日）· ' +
          '样本标准差 · 365 天年化';
      } else {
        shEl.textContent = '—';
        shEl.style.color = '';
        shEl.title = (hasAnyFilter && _sharpeEquity === null)
          ? '当前筛选样本缺少期初权益（capital）字段，无法按日收益率口径计算夏普'
          : (!Number.isFinite(Number(_sharpeEquity)) || Number(_sharpeEquity) <= 0)
            ? '未读取到期初权益（账户余额），无法按日收益率口径计算夏普。请在系统设置中填写账户余额。'
            : '有效交易日不足 2 天、日收益率标准差为 0，或权益被打穿，无法计算';
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
        // 分母必须是毛利：pnlAmount 是含费净额，拿净盈亏当分母会系统性高估
        // fee/|gross|（288 毛利、11.75 费 → 净 276.25，4.25% vs 正确 4.08%）。
        // P4-5 修复：优先用整笔累计毛利 = realizedPnl + realizedFee（部分平仓链下新旧数据都
        // 正确，且与分子 realizedFee 同口径）；缺失才退回 grossPnlAmount，再退回 |pnlAmount|。
        // （修复前部分平仓链的 grossPnlAmount 是"末段全量毛利"，拿它当分母会失真）
        // P1-06：pnlAmount = grossPnl − fee − legacySlippageCost，故 realizedPnl +
        // realizedFee 只还原到「扣滑点之前」还差一个 slippageCost，分母偏小会把
        // 成本侵蚀系统性抬高（实测 1.8% 报成 2.0%）。ticks-v1 模型的滑点已计入
        // effectiveEntryPrice，落库的 planning.totalCost 不得二次加回。
        var _gpRp = parseFloat(closed[_k].realizedPnl);
        var _gpRf = parseFloat(closed[_k].realizedFee);
        var _scObj = closed[_k].slippage;
        var _ticksModel = !!(_scObj && (_scObj.schema === 'ticks-v1' ||
          (_scObj.planning && _scObj.planning.schema === 'ticks-v1')));
        var _slip = _ticksModel ? 0 : Math.max(0, toFiniteNum(closed[_k].slippageCost, 0));
        var _gpSum = (!isNaN(_gpRp) && !isNaN(_gpRf)) ? Math.abs(_gpRp + _gpRf + _slip) : NaN;
        var _gpRaw = parseFloat(closed[_k].grossPnlAmount);
        var _gp = (!isNaN(_gpSum) && _gpSum > 0) ? _gpSum
          : ((!isNaN(_gpRaw) && Math.abs(_gpRaw) > 0) ? Math.abs(_gpRaw)
             : Math.abs(parseFloat(closed[_k].pnlAmount)));
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
    // P1-05：多腿部分平仓的 closePrice 是末腿价，不能代表整笔成交水平。
    // 新记录带 weightedClosePrice（按各腿占原始仓位比例加权），历史记录自动回退。
    const tp = parseFloat(l.targetPrice);
    const cp = parseFloat(l.weightedClosePrice != null ? l.weightedClosePrice : l.closePrice);
    if (isNaN(tp) || isNaN(cp)) continue;
    if (l.direction !== 'long' && l.direction !== 'short') continue;
    targetTotal++;
    // P2-1 修复：用持仓极值判定"是否触及过目标"（部分止盈触及目标后回落、最终平仓价低于
    // 目标时，仍应记为达成）；极值缺失时退回按平仓价判定。
    let _tHit = false;
    if (l.direction === 'long') {
      const _hi = parseFloat(l.highPrice);
      _tHit = (!isNaN(_hi) && _hi >= tp) || (isNaN(_hi) && cp >= tp);
    } else {
      const _lo = parseFloat(l.lowPrice);
      _tHit = (!isNaN(_lo) && _lo <= tp) || (isNaN(_lo) && cp <= tp);
    }
    if (_tHit) targetHit++;
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
  // 分子分母必须同口径。realizedPnl/pnlAmount 是含费净额，targetRR 的分母是含费净止损，
  // 而 rMultiple 的分母是 initialRiskAmount（纯毛利开仓风险）。原先拿 rMultiple /
  // targetRR 比，比值恒等于 netStopLoss / initialRiskAmount——ep 50000 / sp 49000 /
  // 费率 0.08% 时恒为 1.0792，**完美执行也永远显示 +7.9% 并染绿**。那测的是口径差，
  // 不是执行偏差。改用 plannedNetProfit（含费净目标盈利，与 targetRR 同源落库）：
  //   偏差 = 已实现净额 / 计划净额，完美执行恰好是 1.000，费率>0 时不再先天偏离。
  const avgActualRR = rrCount > 0 ? rrSum / rrCount : null;
  let biasSum = 0, biasCount = 0, biasExcluded = 0, biasNoPlan = 0;
  for (const l of closed) {
    if (l.direction !== 'long' && l.direction !== 'short') continue;
    const rp = toFiniteNum(l.pnlAmount, NaN);
    const planNet = toFiniteNum(l.plannedNetProfit, NaN);
    if (Number.isFinite(rp) && Number.isFinite(planNet) && planNet > 0) {
      biasSum += rp / planNet;
      biasCount++;
    } else if (l.plannedNetProfit == null || String(l.plannedNetProfit).trim() === '') {
      // 无计划净额可比（旧记录、未填目标价、或目标价被手续费吃光）——排除而不是
      // 退回 rMultiple 口径，否则旧数据会把「+7.9% 口径差」继续当成绩效。
      biasExcluded++;
      biasNoPlan++;
    } else {
      biasExcluded++;
    }
  }
  const biasEl = document.getElementById('statRRBias');
  if (biasCount > 0) {
    const bias = biasSum / biasCount;
    biasEl.textContent = (bias >= 1 ? '+' : '') + ((bias - 1) * 100).toFixed(1) + '%';
    biasEl.style.color = bias >= 1 ? 'var(--color-success)' : (bias >= 0.8 ? 'var(--color-warning)' : 'var(--color-danger)');
    if (biasExcluded > 0) {
      // 口径必须写进 tooltip：这是「已实现净额 / 计划净额」，不是 R 倍数与 targetRR
      // 相除。后者分母一个含费、一个纯毛利，完美执行也会先天偏 +7.9%。
      biasEl.title = '已实现净盈亏 ÷ 计划净盈亏（含费口径，不含滑点以外成本）。'
        + '其中 ' + biasExcluded + ' 笔无计划净盈亏（旧记录或未设目标价），已排除'
        + (biasNoPlan ? '；无计划值 ' + biasNoPlan + ' 笔' : '');
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
    // v5.6.43：parseFloat('Infinity') 被 !isNaN 放行，会把 Infinity 累加进
    // MAE/MFE 均值。统一走 toFiniteNum，非有限值按「无数据」跳过。
    const pnl = toFiniteNum(l.pnlAmount, NaN);
    const mae = toFiniteNum(l.mae, NaN);
    const mfe = toFiniteNum(l.mfe, NaN);
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
  // 与上方 statMaxDD 同一权威入口（utils.drawdownAlertClass），两处不再各写一份阈值。
  ddEl.classList.add(window.utils.drawdownAlertClass(maxDD));
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

// v5.6.43 P0：连亏排序必须按真实时刻，不能按时间字符串字典序。
// 同一天的 '2026-11-09T18:00:00+08:00'（=UTC 10:00）与 '2026-11-09T11:00:00.000Z'
// 字典序会把 18:00 那笔排在 11:00 之后，真实时刻却更早。实测「末尾一笔是盈利」
// 被误判为 streak=1，直接驱动降仓与当日熔断，风控结论反转。
// closeTime 缺失/非法时回退 time；两者都非法返回 NaN，排序时置于最前，
// 绝不让它冒充「最后一笔」。
function _closedTimeMs(l) {
  var t = l && l.closeTime ? new Date(l.closeTime).getTime() : NaN;
  if (!Number.isFinite(t) && l && l.time) t = new Date(l.time).getTime();
  return Number.isFinite(t) ? t : NaN;
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
    var isClosed = window.utils.isClosed(l);
    return isClosed && _getTradeDate(l) === todayStr;
  });
  todayClosed.sort(function(a, b) {
    var ta = _closedTimeMs(a), tb = _closedTimeMs(b);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return -1;
    if (Number.isNaN(tb)) return 1;
    return ta - tb;
  });
  // 连续亏损：从末尾倒序统计连续亏损笔数
  let streak = 0;
  for (let i = todayClosed.length - 1; i >= 0; i--) {
    const v = toFiniteNum(todayClosed[i].pnlAmount, null);
    if (v !== null && v < 0) { streak++; }
    else { break; }
  }
  // 同时计算当日总亏损笔数（供 UI 参考）
  var totalLossCount = 0;
  for (let j = 0; j < todayClosed.length; j++) {
    const v2 = toFiniteNum(todayClosed[j].pnlAmount, null);
    if (v2 !== null && v2 < 0) totalLossCount++;
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
