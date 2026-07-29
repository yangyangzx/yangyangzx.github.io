// ==================== 核心计算 ====================
function calculate() {
  window._lastCalcDirty = false;  // 用户主动计算，清除脏标记
  const symbol = document.getElementById('symbol').value.trim() || 'N/A';
  const entryPrice = getActiveEntryPrice();
  if (isNaN(entryPrice)) return;
  const capital = parseFloat(document.getElementById('capital').value);
  const riskInput = document.getElementById('riskInput').value.trim();
  const leverage = Math.max(0, parseFloat(document.getElementById('leverage').value) || 0);
  const direction = document.getElementById('direction').value;
  const stopLoss = parseFloat(document.getElementById('stopLoss').value);
  const lossStreak = Math.max(0, parseInt(document.getElementById('lossStreak').value) || 0);
  const targetPrice = parseFloat(document.getElementById('targetPrice').value);

  const posD = document.getElementById('positionDisplay');
  const marginD = document.getElementById('marginDisplay');
  const levD = document.getElementById('leverageDisplay');
  const rrD = document.getElementById('rrDisplay');
  const cardRR = document.getElementById('cardRR');
  const cardMargin = document.getElementById('cardMargin');
  const targetDistD = document.getElementById('targetDistDisplay');
  const costL1 = document.getElementById('costLine1');
  const costL2 = document.getElementById('costLine2');
  const splitArea = document.getElementById('resultSplitArea');
  const splitSummary = document.getElementById('splitSummary');
  const splitTable = document.getElementById('splitTable');
  const triggerRow = document.getElementById('triggerRow');
  const triggerContent = document.getElementById('triggerContent');
  const warnD = document.getElementById('warningDisplay');
  document.getElementById('riskHint').textContent = '';

  function showCalcError(title, msg) {
    posD.textContent = title;
    marginD.textContent = '—';
    levD.textContent = '';
    rrD.textContent = '— : 1';
    cardRR.className = 'result-card rr-neutral';
    cardMargin.classList.remove('margin-danger');
    targetDistD.style.display = 'none';
    costL1.textContent = msg;
    costL2.innerHTML = '';
    triggerRow.style.display = 'none';
    splitArea.style.display = 'none';
    warnD.innerHTML = '';
    const rb = document.getElementById('resultBox');
    if (rb) rb.classList.remove('warn');
  }

  // ========== 连亏熔断（当日连亏 ≥3 笔禁止计算） ==========
  const currentStreak = _getTodayLossStreak();
  const calcBtn = document.getElementById('calcBtn');
  if (currentStreak >= 3) {
    showToast('当日已连续亏损 ' + currentStreak + ' 笔，建议暂停交易冷静一下', 'warn');
    posD.textContent = '交易熔断';
    marginD.textContent = '—';
    levD.textContent = '';
    rrD.textContent = '— : 1';
    cardRR.className = 'result-card rr-neutral';
    cardMargin.classList.remove('margin-danger');
    targetDistD.style.display = 'none';
    costL1.textContent = '当日已连续亏损 ' + currentStreak + ' 笔，建议暂停交易冷静一下';
    costL2.innerHTML = '';
    triggerRow.style.display = 'none';
    splitArea.style.display = 'none';
    warnD.innerHTML = '<span class="warning-tag alert"><i class="fas fa-shield-alt"></i> 熔断保护已触发</span>';
    const rb = document.getElementById('resultBox');
    if (rb) rb.classList.add('warn');
    if (calcBtn) {
      calcBtn.classList.add('blocked');
      calcBtn.innerHTML = '<i class="fas fa-ban"></i> 交易熔断';
    }
    return;
  }
  // 恢复按钮正常状态
  if (calcBtn && calcBtn.classList.contains('blocked')) {
    calcBtn.classList.remove('blocked');
    calcBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 计算仓位';
  }
  // 移除熔断时添加的 warn 类
  const rb = document.getElementById('resultBox');
  if (rb) rb.classList.remove('warn');

  if (entryPrice <= 0) { showCalcError('无效入场价', '入场价必须大于 0'); return; }
  if (isNaN(capital) || capital <= 0) { showCalcError('无效本金', '请输入本金'); return; }
  if (isNaN(stopLoss) || stopLoss <= 0) { showCalcError('无效止损价', '请输入止损价格'); return; }

  let riskAmount=0, riskPercent=0;
  const rawRisk = document.getElementById('riskInput').value.trim();

  // FIX #6: Support both percentage format (e.g., "2%") and fixed amount (e.g., "200")
  if (rawRisk.endsWith('%')) {
    const p = parseFloat(rawRisk.replace('%','').trim());
    if (!isNaN(p) && p > 0 && p <= 10) {
      riskPercent = p / 100;
      riskAmount = capital * riskPercent;
      document.getElementById('riskHint').textContent = '= ' + riskAmount.toFixed(2) + ' USDT (' + p.toFixed(1) + '% 本金)';
    } else {
      showCalcError('风险比例无效', '请输入有效的亏损比例（0.5%-10%）');
      return;
    }
  } else {
    // Fixed amount format (e.g., "200")
    const fixed = parseFloat(rawRisk);
    if (!isNaN(fixed) && fixed > 0) {
      riskAmount = fixed;
      riskPercent = fixed / capital;
      document.getElementById('riskHint').textContent = '= ' + riskAmount.toFixed(2) + ' USDT (最大亏损)';
    } else {
      showCalcError('风险金额无效', '请输入正数作为固定风险金额');
      return;
    }
  }

  // BUG#2: 分批独立止损时，用各批止损距离的加权平均替代主止损计算 stopDistance
  let stopDistance=0, positionSize=0, valid=true, err='', rw='';
  let useWeightedStop = false;
  if (_splitMode && _splitBatches.length >= 2) {
    const hasIndepSL = _splitBatches.some(function(b) { return b.stopLoss && !isNaN(parseFloat(b.stopLoss)); });
    if (hasIndepSL) {
      let totalAlloc = 0, weightedStopPct = 0;
      var skippedCount = 0;
      for (var _i = 0; _i < _splitBatches.length; _i++) {
        var b = _splitBatches[_i];
        var bp = parseFloat(b.price), ba = parseFloat(b.alloc);
        if (isNaN(bp) || bp <= 0 || isNaN(ba) || ba <= 0) continue;
        var bsl = b.stopLoss && !isNaN(parseFloat(b.stopLoss)) ? parseFloat(b.stopLoss) : stopLoss;
        if (direction === 'long' && bsl >= bp) { skippedCount++; continue; }
        if (direction === 'short' && bsl <= bp) { skippedCount++; continue; }
        weightedStopPct += (Math.abs(bp - bsl) / bp) * ba;
        totalAlloc += ba;
      }
      if (skippedCount > 0) {
        // M5: 部分批次止损方向非法，回退使用主止损距离，并给出明确提示
        rw = '<span class="warning-tag"><i class="fas fa-exclamation-circle"></i> 分批止损部分批次方向非法（' + skippedCount + ' 批已跳过），已回退为全局止损计算。加权结果可能偏离实际仓位，建议逐批检查止损方向。</span>';
        weightedStopPct = 0; // 触发后续 fallback
      }
      if (totalAlloc > 0 && weightedStopPct > 0) {
        stopDistance = (weightedStopPct / totalAlloc) * entryPrice;
        positionSize = riskAmount * entryPrice / stopDistance;
        useWeightedStop = true;
      }
    }
  }
  if (!useWeightedStop) {
    if (direction==='long') {
      if (stopLoss>=entryPrice) { err='做多止损价必须 < 入场价'; valid=false; }
      else { stopDistance=Math.abs(entryPrice-stopLoss); positionSize=riskAmount*entryPrice/stopDistance; }
    } else {
      if (stopLoss<=entryPrice) { err='做空止损价必须 > 入场价'; valid=false; }
      else { stopDistance=Math.abs(stopLoss-entryPrice); positionSize=riskAmount*entryPrice/stopDistance; }
    }
  }
  if (!valid) { showCalcError(err, ''); return; }

  // 零止损距离警告（止损距离 < 入场价 0.1%）
  if (stopDistance < entryPrice * 0.001) {
    showCalcError(
      '止损距离极近（' + (stopDistance / entryPrice * 100).toFixed(3) + '%），仓位会被放大到极大值。建议增大止损距离或降低风险比例后再计算。',
      ''  // 不阻止计算
    );
  }

  // ===== 仓位硬上限：考虑已有持仓占用的保证金（同一 groupId 只计 1 笔） =====
  var usedMargin = 0;
  var openPositions = logs.filter(function(l) { return !l.closeType || l.closeType === ''; });
  var seenGroups = {};
  for (var i = 0; i < openPositions.length; i++) {
    var pos = openPositions[i];
    // 同一 groupId 的拆分仓位只计算一次
    if (pos.groupId && seenGroups[pos.groupId]) continue;
    if (pos.groupId) seenGroups[pos.groupId] = true;
    var lev = Number(pos.leverage);
    if (isNaN(lev) || lev <= 0) lev = 1;
    var ps = Number(pos.positionSize);
    if (isNaN(ps) || ps <= 0) { usedMargin += 0; }
    else { usedMargin += ps / lev; }
  }
  var availableCapital = capital - usedMargin;
  if (availableCapital < 0) availableCapital = 0;
  const maxPos = availableCapital * Math.max(leverage, 1);
  var cappedByMargin = false, capMsg = '';

  // 保证金 80% 硬上限（仅杠杆合约）：margin = positionSize / leverage ≤ capital * 0.8
  // 设计依据：单笔保证金不超过可用本金 80%，在相同风险下最大化保证金以获取高收益
  if (leverage > 0) {
    const marginLimitPos = availableCapital * leverage * 0.8;
    if (positionSize > marginLimitPos) {
      const origMargin = positionSize / leverage;
      riskAmount = marginLimitPos * stopDistance / entryPrice;
      riskPercent = riskAmount / capital;
      capMsg = '<span class="warning-tag alert"><i class="fas fa-shield-alt"></i> 保证金触及 80% 上限：原需 ' + origMargin.toFixed(2) + ' USDT（' + (origMargin / capital * 100).toFixed(1) + '% 本金），已截断至 ' + (marginLimitPos / leverage).toFixed(2) + ' USDT（80% 本金）。实际风险额 ' + riskAmount.toFixed(2) + ' USDT。建议放宽止损距离或降低风险比例。</span>';
      positionSize = marginLimitPos;
      cappedByMargin = true;
    }
  }

  // 交易所仓位硬上限（兜底，仅当保证金上限未触发时检查）
  if (!cappedByMargin && positionSize > maxPos) {
    cappedByMargin = true;
    capMsg = '<span class="warning-tag alert"><i class="fas fa-ban"></i> 仓位已触达交易所上限：计算仓位 ' + positionSize.toFixed(2) + ' 超过最大可开仓位 ' + maxPos.toFixed(2) + '（可用本金 ' + availableCapital.toFixed(2) + ' × ' + (leverage || 1) + 'x），已强制截断。请放宽止损距离或降低风险额。</span>';
    riskAmount = maxPos * stopDistance / entryPrice;
    riskPercent = riskAmount / capital;
    positionSize = maxPos;
  }

  // ===== 多品种聚合上限：总保证金（已有 + 新开）≤ 本金 × 90% =====
  if (leverage > 0) {
    var newMargin = positionSize / leverage;
    var totalMargin = usedMargin + newMargin;
    var aggregateLimit = capital * 0.9;
    if (totalMargin > aggregateLimit) {
      var maxNewMargin = aggregateLimit - usedMargin;
      if (maxNewMargin > 0) {
        var aggCappedPos = maxNewMargin * leverage;
        riskAmount = aggCappedPos * stopDistance / entryPrice;
        riskPercent = riskAmount / capital;
        capMsg = (capMsg ? capMsg + ' ' : '') + '<span class="warning-tag alert"><i class="fas fa-layer-group"></i> 总保证金触及 90% 聚合上限：已有 ' + usedMargin.toFixed(2) + ' + 新增 ' + newMargin.toFixed(2) + ' = ' + totalMargin.toFixed(2) + ' USDT（' + (totalMargin / capital * 100).toFixed(1) + '% 本金），已截断新仓位保证金至 ' + maxNewMargin.toFixed(2) + ' USDT。</span>';
        positionSize = aggCappedPos;
        cappedByMargin = true;
      } else {
        capMsg = (capMsg ? capMsg + ' ' : '') + '<span class="warning-tag alert"><i class="fas fa-layer-group"></i> 总保证金已达 90% 聚合上限：已有持仓已占用 ' + usedMargin.toFixed(2) + ' USDT（' + (usedMargin / capital * 100).toFixed(1) + '% 本金），无法再开新仓。请平仓后重试。</span>';
        positionSize = 0;
        cappedByMargin = true;
      }
    }
  }

  // ===== 止损 vs 强平价校验（仅杠杆合约，现货跳过） =====
  let cappedByLiquidation = false, liquidationPrice = null, liqMsg = '';
  if (leverage > 0) {
    // MMR 从全局 settings 统一读取（百分比值需除以 100 转为小数）
    let mmr = 0.005; // 默认回退值
    try {
      var _calcSettings = window.settings;
      if (!_calcSettings) {
        var raw = localStorage.getItem('trade_settings_v1');
        if (raw) _calcSettings = JSON.parse(raw);
      }
      if (_calcSettings && _calcSettings.mmr != null) mmr = _calcSettings.mmr / 100;
    } catch(e) {}

    liquidationPrice = window.utils.calcLiquidationPrice(entryPrice, direction, leverage, mmr);
    const isInvalid = (direction === 'long' && stopLoss < liquidationPrice) ||
                      (direction === 'short' && stopLoss > liquidationPrice);
    if (isInvalid) {
      cappedByLiquidation = true;
      liqMsg = '<span class="warning-tag alert"><i class="fas fa-skull"></i> 止损超越强平价：止损 ' + stopLoss.toFixed(2) + ' 在强平价 ' + liquidationPrice.toFixed(2) + ' ' + (direction === 'long' ? '之下' : '之上') + '，价格到达止损前仓位将被强制平仓。建议收紧止损距离或降低杠杆。</span>';
    }
  }

  let effLev=leverage, actualMargin=positionSize;
  if (leverage>0) { actualMargin=positionSize/leverage; } else { effLev=1; }

  let adjPos=positionSize, adjMsg='';
  let adjustedRisk = false;
  if (lossStreak>=3) {
    adjPos = positionSize * 0.8;
    // Proportionally reduce risk amount to maintain consistent R multiple
    // Risk amount = positionSize * stopDistance / entryPrice
    // When position is reduced, reduce risk by same factor
    riskAmount = riskAmount * 0.8;
    riskPercent = riskAmount / capital;
    adjustedRisk = true;
    adjMsg = '连续亏损 ' + lossStreak + ' 笔，建议降低仓位至 80% (≈' + adjPos.toFixed(2) + ' USDT';
  } else if (lossStreak>=2) { adjMsg = '连续亏损 ' + lossStreak + ' 笔，注意风险控制'; }

  const finalPos = lossStreak>=3 ? adjPos : positionSize;
  const finalMargin = lossStreak>=3 ? adjPos/(effLev||1) : actualMargin;
  const stopPct = stopDistance/entryPrice*100;

  // ===== 止损距离色标 =====
  const isEth = symbol.toUpperCase().includes('ETH');
  const maxStopPct = isEth ? 2 : 3;   // 职业交易：BTC/SOL/GOLD ≤3%, ETH ≤2%
  const minStopPct = isEth ? 0.3 : 0.5;
  let stopTagClass = 'green', stopTagLabel = '适中';
  if (stopPct > 5) { stopTagClass = 'red'; stopTagLabel = '偏大'; rw = '<span class="warning-tag alert"><i class="fas fa-exclamation-triangle"></i> 止损距离 '+stopPct.toFixed(2)+'% 较大，请确认策略</span>'; }
  else if (stopPct > maxStopPct) { stopTagClass = 'yellow'; stopTagLabel = '偏大'; rw = '<span class="warning-tag"><i class="fas fa-bolt"></i> 止损距离 '+stopPct.toFixed(2)+'% 偏大</span>'; }
  else if (stopPct < minStopPct) { stopTagClass = 'yellow'; stopTagLabel = '偏窄'; rw = '<span class="warning-tag"><i class="fas fa-bolt"></i> 止损距离 '+stopPct.toFixed(2)+'% 较窄，注意滑点</span>'; }

  // ===== 手续费与滑点（提前到盈亏比计算之前，供 targetRR 使用） =====
  const feeRate = parseFloat(document.getElementById('feeRate').value) || 0;
  const slippageTicks = parseFloat(document.getElementById('slippage').value) || 0;
  const tickSize = getTickSize(symbol);
  const fee = feeRate > 0 ? (finalPos * feeRate / 100 * 2) : 0;
  const slippageCost = slippageTicks > 0 ? (slippageTicks * tickSize * finalPos / entryPrice) : 0;
  const totalCost = fee + slippageCost;

  // ===== 盈亏比预判（扣除手续费和滑点后的净盈亏比） =====
  let targetRR = null, targetPct = null;
  if (!isNaN(targetPrice) && targetPrice > 0) {
    let targetDistance;
    if (direction === 'long') {
      targetDistance = targetPrice - entryPrice;
    } else {
      targetDistance = entryPrice - targetPrice;
    }
    if (targetDistance > 0) {
      targetPct = targetDistance / entryPrice * 100;
      // 毛 R:R
      var grossRR = targetDistance / stopDistance;
      // 净 R:R = (目标收益 - 手续费) / (止损损失 + 手续费)
      var grossProfit = targetDistance * finalPos / entryPrice;
      var grossLoss = stopDistance * finalPos / entryPrice;
      var netProfit = grossProfit - totalCost;
      var netLoss = grossLoss + totalCost;
      if (netLoss > 0) {
        targetRR = netProfit / netLoss;
      } else {
        targetRR = grossRR;
      }
    }
  }

  // ===== 三卡片：仓位 =====
  posD.textContent = finalPos.toFixed(2) + ' U';

  // ===== 三卡片：保证金 =====
  marginD.textContent = finalMargin.toFixed(2) + ' USDT';
  if (leverage > 0) {
    levD.textContent = leverage + 'x 杠杆';
  } else {
    levD.textContent = '现货 (1x)';
  }
  cardMargin.classList.toggle('margin-danger', finalMargin > capital);

  // ===== 三卡片：盈亏比 =====
  if (targetRR !== null) {
    rrD.textContent = targetRR.toFixed(2) + ' : 1';
    if (targetRR >= 3) {
      cardRR.className = 'result-card rr-green';
    } else if (targetRR >= 2) {
      cardRR.className = 'result-card rr-amber';
    } else {
      cardRR.className = 'result-card rr-red';
    }
  } else {
    rrD.textContent = '— : 1';
    cardRR.className = 'result-card rr-neutral';
  }
  // 距目标百分比
  if (targetPct !== null) {
    const distSign = direction === 'long' ? '+' : '';
    const distPct = targetPct; // long: 正数, short: 已是正绝对值
    const distClass = targetRR >= 3 ? 'green' : (targetRR < 2 ? 'red' : 'neutral');
    targetDistD.textContent = '距目标 ' + distSign + distPct.toFixed(1) + '%';
    targetDistD.className = 'result-card-sub target-dist ' + distClass;
    targetDistD.style.display = 'block';
  } else {
    targetDistD.style.display = 'none';
  }

  // ===== 风险与成本行 L1：最大亏损 + 预估成本 =====
  let riskClass = (riskPercent*100) <= 2 ? 'low' : ((riskPercent*100) <= 5 ? 'mid' : 'high');
  let costL1HTML = '<span>最大亏损 <span class="cost-loss ' + riskClass + '">' + riskAmount.toFixed(2) + ' USDT (' + (riskPercent*100).toFixed(2) + '%)</span></span>';
  if (fee > 0 || slippageCost > 0) {
    costL1HTML += '<span>费用 ' + totalCost.toFixed(2) + ' USDT</span>';
  }
  costL1.innerHTML = costL1HTML;

  // ===== 风险与成本行 L2：止损距离 tag + 方向 + 品种 + 目标 =====
  let costL2HTML = '<span class="stop-tag ' + stopTagClass + '">止损 ' + stopPct.toFixed(2) + '%</span>';
  costL2HTML += ' <span class="sep">·</span> ' + (direction === 'long' ? '做多' : '做空');
  costL2HTML += ' <span class="sep">·</span> ' + symbol;
  if (targetPct !== null) {
    costL2HTML += ' <span class="sep">·</span> 目标 ' + targetPrice + ' (+' + targetPct.toFixed(2) + '%)';
  }
  costL2.innerHTML = costL2HTML;

  // ===== 止损触发损失行 =====
  let triggerHTML = '';
  if (_splitMode && _splitBatches.length >= 2) {
    const hasIndepSL = _splitBatches.some(function(b) { return b.stopLoss && !isNaN(parseFloat(b.stopLoss)); });
    if (hasIndepSL) {
      _splitBatches.forEach(function(b, i) {
        const bp = parseFloat(b.price), ba = parseFloat(b.alloc);
        if (isNaN(bp) || isNaN(ba)) return;
        const bsl = b.stopLoss && !isNaN(parseFloat(b.stopLoss)) ? parseFloat(b.stopLoss) : (stopLoss || 0);
        if (bsl <= 0) return; // 止损未设置，跳过
        // 使用原始风险额（ba% of riskAmount）而非被截断后的仓位，避免误导用户
        const bRisk = riskAmount * ba / 100;
        const bpos = finalPos * ba / 100;
        const bstopDist = direction === 'long' ? bp - bsl : bsl - bp;
        // 实际损失取风险额和计算值的较小者（考虑仓位被截断的情况）
        const bloss = Math.min(bRisk, bstopDist > 0 ? (bstopDist * bpos / entryPrice) : bRisk);
        const blossPct = capital > 0 ? (bloss / capital * 100) : 0;
        triggerHTML += '<div class="trigger-line"><span class="trigger-batch">#' + (i + 1) + '</span><span class="trigger-price">' + bsl.toFixed(2) + '</span><span class="trigger-arrow">→</span><span>损失</span><span class="trigger-loss">' + bloss.toFixed(2) + ' U (' + blossPct.toFixed(2) + '%)</span></div>';
      });
    } else {
      triggerHTML = '<div class="trigger-line"><span class="trigger-price">' + (stopLoss ? parseFloat(stopLoss).toFixed(2) : '—') + '</span><span class="trigger-arrow">→</span><span>损失</span><span class="trigger-loss">' + riskAmount.toFixed(2) + ' USDT (' + (riskPercent * 100).toFixed(2) + '%)</span></div>';
    }
  } else {
    triggerHTML = '<div class="trigger-line"><span class="trigger-price">' + (stopLoss ? parseFloat(stopLoss).toFixed(2) : '—') + '</span><span class="trigger-arrow">→</span><span>损失</span><span class="trigger-loss">' + riskAmount.toFixed(2) + ' USDT (' + (riskPercent * 100).toFixed(2) + '%)</span></div>';
  }
  if (triggerHTML) {
    triggerContent.innerHTML = triggerHTML;
    triggerRow.style.display = 'block';
  }

  // ===== 分批建仓独立区 =====
  if (_splitMode && _splitBatches.length >= 2) {
    const w = computeWeightedEntry();
    if (w !== null) {
      splitSummary.innerHTML = '加权入场价 <strong>' + w.toFixed(2) + '</strong>';
      let tbody = '';
      _splitBatches.forEach(function(b, i) {
        const bp = parseFloat(b.price), ba = parseFloat(b.alloc);
        const bpos = !isNaN(bp) && !isNaN(ba) ? (finalPos * ba / 100).toFixed(2) : '—';
        const bsl = b.stopLoss && !isNaN(parseFloat(b.stopLoss)) ? parseFloat(b.stopLoss).toFixed(2) : '—';
        tbody += '<tr><td>#' + (i + 1) + '</td><td>' + (isNaN(bp) ? '—' : bp) + '</td><td>' + (isNaN(ba) ? '—' : ba + '%') + '</td><td>' + bpos + ' U</td><td>' + bsl + '</td></tr>';
      });
      splitTable.innerHTML = '<thead><tr><th>批次</th><th>入场价</th><th>占比</th><th>仓位</th><th>止损</th></tr></thead><tbody>' + tbody + '</tbody>';
      splitArea.style.display = 'block';
    } else {
      splitArea.style.display = 'none';
    }
  } else {
    splitArea.style.display = 'none';
  }

  // ===== 警告区 =====
  let wh = rw;
  if (cappedByLiquidation) wh = liqMsg + (wh ? '<br>' + wh : '');
  if (cappedByMargin) wh = capMsg + (wh ? '<br>' + wh : '');
  if (adjMsg) wh += '<div class="warning-tag" style="margin-top:6px;">' + adjMsg + '</div>';
  if (!cappedByMargin && finalMargin > capital) {
    const needLeverage = finalPos / capital;
    wh += '<div class="warning-tag alert" style="margin-top:6px;"><i class="fas fa-exclamation-triangle"></i> 保证金不足: 需 ' + finalMargin.toFixed(2) + ' USDT，本金仅 ' + capital.toFixed(2) + ' USDT。建议提高杠杆至 ≥ ' + needLeverage.toFixed(1) + 'x，或降低风险额 / 收紧止损</div>';
  }
  warnD.innerHTML = wh;
  const resultBox = document.getElementById('resultBox');
  if (resultBox) {
    if (wh) { resultBox.classList.add('warn'); }
    else { resultBox.classList.remove('warn'); }
  }

  window._lastCalc={ symbol,entryPrice,capital,riskAmount,riskPercent,leverage:leverage,direction,stopLoss,lossStreak,targetPrice:isNaN(targetPrice)?null:targetPrice,positionSize:finalPos,stopDistance,stopPct,liquidationPrice,cappedByLiquidation,targetRR,targetPct,reason:getReason(),signals:getSignals(),actualMargin:finalMargin,fee:parseFloat(fee.toFixed(2)),slippageCost:parseFloat(slippageCost.toFixed(2)),totalCost:parseFloat(totalCost.toFixed(2)),splitMode:_splitMode,weightedStopDistance:useWeightedStop?stopDistance:null, mindsetScore: parseInt(document.getElementById('mindsetScore').value) || 3 };
  // 自动滚动到结果区
  if (resultBox) resultBox.scrollIntoView({behavior:'smooth'});
  if (typeof updateChecklist === 'function') updateChecklist();
  if (typeof autoCalcMultiTP === 'function') autoCalcMultiTP();
}

// ==================== 保存日志 ====================
// ==================== 盘中动作记录 ====================
function renderActionsHtml(actions) {
  if (!actions || !actions.length) return '';
  const typeMap = { sl_move:'移动止损', partial:'部分止盈', add:'加仓', reduce:'减仓', other:'其他' };
  const clsMap = { sl_move:'sl-move', partial:'partial', add:'add', reduce:'reduce', other:'other' };
  let html = '<ul class="action-timeline">';
  for (const a of actions) {
    const label = typeMap[a.type] || a.type;
    const cls = clsMap[a.type] || 'other';
    const time = a.time ? new Date(a.time).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).replace(/\//g,'-') : '';
    html += '<li><span class="act-type ' + cls + '">' + label + '</span>' +
      (a.price ? ' @' + a.price : '') +
      (time ? ' ' + time : '') +
      (a.note ? ' — ' + a.note.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '') +
      '</li>';
  }
  html += '</ul>';
  return html;
}
window.renderActionsHtml = renderActionsHtml;

function saveTradeAction(idx) {
  const item = logs[idx];
  if (!item) return;
  if (!item.actions) item.actions = [];
  const type = document.getElementById('actType_' + idx);
  const price = document.getElementById('actPrice_' + idx);
  const time = document.getElementById('actTime_' + idx);
  const note = document.getElementById('actNote_' + idx);
  if (!type || !type.value) { showToast('请选择动作类型', 'warn'); return; }

  const action = {
    type: type.value,
    price: price && price.value ? parseFloat(price.value) : null,
    time: (function() {
      if (time && time.value) {
        // B6: datetime-local 返回 "YYYY-MM-DDTHH:mm" 不带时区，显式按本地时间解析
        var p = time.value.split(/[-T:]/);
        var localDate = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), parseInt(p[3]) || 0, parseInt(p[4]) || 0);
        return localDate.toISOString();
      }
      return new Date().toISOString();
    })(),
    note: note ? note.value.trim() : ''
  };
  item.actions.push(action);
  actionPanelIdx = -1;
  saveLogs();
}
window.saveTradeAction = saveTradeAction;

function saveLog() {
  const calc = window._lastCalc;
  if (!calc || !calc.positionSize || calc.positionSize<=0) { showToast('请先点击「计算仓位」生成有效数据','warn'); return; }

  // 获取检查清单结果（如已计算）
  var checklistResults = {};
  if (calc.checklistResults) {
    checklistResults = calc.checklistResults;
  }

  const now = new Date();
  const entry = {
    time: now.toISOString(),
    symbol: calc.symbol,
    direction: calc.direction,
    orderType: document.getElementById('orderType').value || 'market',
    entryPrice: calc.entryPrice,
    stopLoss: calc.stopLoss,
    targetPrice: calc.targetPrice,
    positionSize: parseFloat(calc.positionSize.toFixed(2)),
    leverage: calc.leverage,
    riskAmount: parseFloat(calc.riskAmount.toFixed(2)),
    capital: isNaN(calc.capital) ? null : calc.capital,              // H1: 入场时本金快照，用于事后验证仓位合理性
    fee: calc.fee != null ? calc.fee : 0,
    slippageCost: calc.slippageCost != null ? calc.slippageCost : 0,
    targetRR: calc.targetRR != null ? calc.targetRR : null,
    stopPct: calc.stopPct,                                          // ✅ 新增：持久化止损距离百分比
    groupId: null,
    groupLabel: null,
    reason: calc.reason || getReason(),
    mindsetScore: parseInt(document.getElementById('mindsetScore').value) || 3,
    strategyFramework: document.getElementById('strategyFramework').value,
    strategyPattern: document.getElementById('strategyPattern').value,
    signals: getSignals(),
    session: document.getElementById('tradeSession') ? document.getElementById('tradeSession').value : '',           // L3: 交易时段
    marketCondition: document.getElementById('marketCondition') ? document.getElementById('marketCondition').value : '', // L3: 市场环境
    closeType: '',
    closePrice: null,
    rMultiple: null,
    pnlAmount: null,
    pnlPercent: null,
    closeNote: '',
    exitReason: '',            // M3: 出场理由（平仓时填写）
    executionScore: null,
    mae: null,
    mfe: null,
    lossReason: null,
    emotions: null,
    actions: [],
    splitEntries: getSplitEntries(),
    checklistResults: checklistResults  // ✅ 新增：持久化检查结果至日志
  };
  logs.push(entry);
  openClosePanelIdx = -1;
  actionPanelIdx = -1;
  saveLogs();
  showToast('日志已保存', 'success');
}

// ==================== 分批建仓 ====================
function toggleSplitMode() {
  _splitMode = !_splitMode;
  const btn = document.getElementById('splitToggleBtn');
  const area = document.getElementById('splitArea');
  if (_splitMode) {
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-layer-group"></i> 关闭分批';
    area.classList.add('open');
    if (!_splitBatches.length) { initSplitBatches(2); }
    renderSplitBatches();
    if (!document.getElementById('entryPrice').value) {
      document.getElementById('entryPrice').placeholder = '加权均价（自动计算）';
    }
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<i class="fas fa-layer-group"></i> + 分批建仓';
    area.classList.remove('open');
    _splitBatches = [];
    document.getElementById('entryPrice').placeholder = '价格';
    document.getElementById('positionDisplay').textContent = '—';
    document.getElementById('marginDisplay').textContent = '—';
    document.getElementById('leverageDisplay').textContent = '';
    document.getElementById('rrDisplay').textContent = '— : 1';
    var _crr = document.getElementById('cardRR');
    if (_crr) _crr.className = 'result-card rr-neutral';
    var _cm = document.getElementById('cardMargin');
    if (_cm) _cm.classList.remove('margin-danger');
    var _td = document.getElementById('targetDistDisplay');
    if (_td) _td.style.display = 'none';
    document.getElementById('costLine1').textContent = '';
    document.getElementById('costLine2').innerHTML = '';
    document.getElementById('warningDisplay').innerHTML = '';
    document.getElementById('triggerRow').style.display = 'none';
    document.getElementById('resultSplitArea').style.display = 'none';
    var _rb = document.getElementById('resultBox');
    if (_rb) _rb.classList.remove('warn');
  }
}
function initSplitBatches(count) {
  _splitBatches = [];
  for (let i = 0; i < count; i++) {
    _splitBatches.push({ price: '', alloc: '', stopLoss: '' });
  }
}
function renderSplitBatches() {
  const inner = document.getElementById('splitAreaInner');
  let html = '';
  _splitBatches.forEach(function(b, i) {
    html += '<div class="split-row" id="splitRow_' + i + '">' +
      '<div class="fp"><label>第' + (i + 1) + '批入场价</label>' +
      '<input type="number" id="splitPrice_' + i + '" step="0.01" placeholder="价格" value="' + (b.price || '') + '" oninput="onSplitChange()" /></div>' +
      '<div class="fp"><label>比例 %</label>' +
      '<input type="number" id="splitAlloc_' + i + '" step="0.5" min="0" max="100" placeholder="%" value="' + (b.alloc || '') + '" class="alloc-input" oninput="onSplitChange()" /></div>' +
      '<div class="fp"><label>止损(可选)</label>' +
      '<input type="number" id="splitSL_' + i + '" step="0.01" placeholder="共用" value="' + (b.stopLoss || '') + '" oninput="onSplitChange()" /></div>' +
      (_splitBatches.length > 2 ? '<button class="btn-remove" onclick="removeSplitBatch(' + i + ')" title="移除此批">&times;</button>' : '<span></span>') +
      '</div>';
  });
  if (_splitBatches.length < 3) {
    html += '<button class="split-add-btn" onclick="addSplitBatch()"><i class="fas fa-plus"></i> 增加一批</button>';
  }
  html += '<span class="split-alloc-hint" id="splitAllocHint">比例总和须为 100%</span>';
  inner.innerHTML = html;
}
function onSplitChange() {
  // Sync values
  for (let i = 0; i < _splitBatches.length; i++) {
    _splitBatches[i].price = document.getElementById('splitPrice_' + i)?.value || '';
    _splitBatches[i].alloc = document.getElementById('splitAlloc_' + i)?.value || '';
    _splitBatches[i].stopLoss = document.getElementById('splitSL_' + i)?.value || '';
  }
  // Auto-complete last batch
  autoCompleteAlloc();
  updateEntryPriceFromSplit();
  _cachedWeightedEntry = null; _cachedWeightedEntryHash = ''; // 清空缓存
  calculate();
}
function autoCompleteAlloc() {
  if (_splitBatches.length < 3) return; // BUG#1: 仅 3 批模式自动补足，2 批模式让用户自行填写
  const filledCount = _splitBatches.filter(function(b) { return b.alloc !== '' && !isNaN(parseFloat(b.alloc)); }).length;
  const totalFilled = _splitBatches.reduce(function(s, b) {
    return s + (b.alloc !== '' && !isNaN(parseFloat(b.alloc)) ? parseFloat(b.alloc) : 0);
  }, 0);
  const hint = document.getElementById('splitAllocHint');
  if (filledCount >= _splitBatches.length - 1 && totalFilled <= 100) {
    // Auto-fill last empty
    for (let i = 0; i < _splitBatches.length; i++) {
      if (_splitBatches[i].alloc === '' || isNaN(parseFloat(_splitBatches[i].alloc))) {
        const autoVal = Math.max(0, 100 - totalFilled);
        _splitBatches[i].alloc = String(autoVal);
        const el = document.getElementById('splitAlloc_' + i);
        if (el) el.value = autoVal;
        break;
      }
    }
  }
  // Show hint
  if (hint) {
    const total = _splitBatches.reduce(function(s, b) {
      return s + (b.alloc !== '' && !isNaN(parseFloat(b.alloc)) ? parseFloat(b.alloc) : 0);
    }, 0);
    if (total !== 100 && filledCount === _splitBatches.length) {
      hint.classList.add('show');
    } else {
      hint.classList.remove('show');
    }
  }
}
function updateEntryPriceFromSplit() {
  const ep = computeWeightedEntry();
  const epEl = document.getElementById('entryPrice');
  if (ep !== null) {
    epEl.value = ep.toFixed(2);
    epEl.readOnly = true;
  } else {
    epEl.value = '';
    epEl.readOnly = false;
  }
}
var _cachedWeightedEntry = null;
var _cachedWeightedEntryHash = '';
function computeWeightedEntry() {
  var hash = JSON.stringify(_splitBatches);
  if (hash === _cachedWeightedEntryHash) return _cachedWeightedEntry;
  let totalAlloc = 0, weightedSum = 0;
  for (const b of _splitBatches) {
    const price = parseFloat(b.price), alloc = parseFloat(b.alloc);
    if (!isNaN(price) && price > 0 && !isNaN(alloc) && alloc > 0) {
      weightedSum += price * alloc;
      totalAlloc += alloc;
    }
  }
  var result = totalAlloc > 0 ? weightedSum / totalAlloc : null;
  _cachedWeightedEntry = result;
  _cachedWeightedEntryHash = hash;
  return result;
}
function addSplitBatch() {
  if (_splitBatches.length >= 3) return;
  _splitBatches.push({ price: '', alloc: '', stopLoss: '' });
  renderSplitBatches();
}
function removeSplitBatch(idx) {
  if (_splitBatches.length <= 2) return;
  _splitBatches.splice(idx, 1);
  renderSplitBatches();
  onSplitChange();
}
function getSplitEntries() {
  if (!_splitMode || _splitBatches.length < 2) return null;
  const entries = [];
  for (const b of _splitBatches) {
    const price = parseFloat(b.price), alloc = parseFloat(b.alloc);
    if (isNaN(price) || isNaN(alloc) || price <= 0 || alloc <= 0) return null;
    entries.push({ price: price, alloc: alloc, stopLoss: b.stopLoss ? parseFloat(b.stopLoss) : null });
  }
  const weighted = computeWeightedEntry();
  if (entries.length < 2 || weighted === null) return null;
  return { entries: entries, weightedEntry: parseFloat(weighted.toFixed(2)) };
}
function getActiveEntryPrice() {
  if (_splitMode && _splitBatches.length >= 2) {
    const w = computeWeightedEntry();
    if (w !== null) return w;
  }
  return parseFloat(document.getElementById('entryPrice').value);
}

// ==================== 重置表单 ====================
function resetForm() {
  document.getElementById('symbol').value = 'BTC';
  document.getElementById('entryPrice').value = '';
  document.getElementById('capital').value = '1000';
  document.getElementById('riskInput').value = '2%';
  document.getElementById('riskHint').textContent = '';
  document.getElementById('leverage').value = '0';
  document.getElementById('direction').value = 'long';
  filterOrderTypes('long');
  document.getElementById('stopLoss').value = '';
  document.getElementById('targetPrice').value = '';
  document.getElementById('atrValue').value = '';
  document.getElementById('atrMultiplier').value = '1.5';
  document.getElementById('lossStreak').value = '0';
  document.getElementById('orderType').value = 'market';
  document.getElementById('feeRate').value = '0.08';
  document.getElementById('slippage').value = '0';
// 重置分批状态
if (_splitMode) toggleSplitMode();
  renderMindsetStars(3);
  document.getElementById('strategyFramework').value = '';
  document.getElementById('strategyPattern').innerHTML = '<option value="">— 不选择 —</option>';
  document.querySelectorAll('#signalCheckboxes input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  updateCheckboxStyle();
  document.getElementById('reasonSelect').value = '突破';
  document.getElementById('reasonCustom').value = '';
  document.getElementById('positionDisplay').textContent = '—';
  document.getElementById('detailDisplay') && (document.getElementById('detailDisplay').textContent = '输入参数后点击「计算仓位」');
  document.getElementById('warningDisplay').innerHTML = '';
  document.getElementById('riskTag') && (document.getElementById('riskTag').textContent = '风险: 待计算');
  const resultBox = document.getElementById('resultBox');
  if (resultBox) resultBox.classList.remove('warn');
  const cardMargin = document.getElementById('cardMargin');
  if (cardMargin) cardMargin.classList.remove('margin-danger');
  const targetDistD = document.getElementById('targetDistDisplay');
  if (targetDistD) targetDistD.style.display = 'none';
  const triggerRow = document.getElementById('triggerRow');
  if (triggerRow) triggerRow.style.display = 'none';
  window._lastCalc = null;
}

function toggleFormSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const chevron = section.querySelector('.form-section-header-chevron');
  section.classList.toggle('collapsed');
  if (chevron) {
    chevron.classList.toggle('rotated');
  }
}

// 关键字段变更时标记 _lastCalc 为脏
(function() {
  var dirtyFields = ['entryPrice', 'stopLoss', 'capital', 'leverage', 'direction'];
  dirtyFields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', function() { window._lastCalcDirty = true; });
      el.addEventListener('change', function() { window._lastCalcDirty = true; });
    }
  });
  // 止损距离滑块（stopLossDist）变更也标记
  var sld = document.getElementById('stopLossSlider');
  if (sld) sld.addEventListener('input', function() { window._lastCalcDirty = true; });
})();
