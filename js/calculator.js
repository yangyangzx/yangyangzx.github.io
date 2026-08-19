// ==================== 核心计算 ====================
var _calculating = false;

// 计算结束清理：确保 _calculating 始终被复位
function _calcCleanup() {
  _calculating = false;
}  // 防止 calculate() 重入及计算期间的脏事件污染

// ==================== _lastCalc 私有化访问器 ====================
// 内部状态，外部通过 getCalc / setCalcDirty 访问，避免直接篡改风控 Gate
var _lastCalcStore = null;   // { symbol, entryPrice, ..., checklistResults }
var _lastCalcDirtyStore = false;
var _lastCalcBlockerStore = null;

function getCalc()           { return _lastCalcStore; }
function setCalc(v)          { _lastCalcStore = v; }
function getCalcDirty()      { return _lastCalcDirtyStore; }
function setCalcDirty(v)     { _lastCalcDirtyStore = !!v; }
function getCalcBlocker()    { return _lastCalcBlockerStore; }
function setCalcBlocker(v)   { _lastCalcBlockerStore = v; }

// 保留 window 上的向后兼容引用（供外部模块直接读取），但写入必须走 setCalcDirty
// 注意：window._lastCalcDirty 只读禁止外部赋值为 false 以绕过 Gate
Object.defineProperty(window, '_lastCalcDirty', {
  get: function() { return _lastCalcDirtyStore; },
  set: function(v) {
    // 仅允许设为 true（标记脏数据）；设为 false 是重置操作，仅内部函数可执行
    if (v === true) { _lastCalcDirtyStore = true; }
    else { console.warn('[_lastCalcDirty] 禁止外部将 dirty 标记重置为 false，请使用 setCalcDirty()'); }
  },
  enumerable: true,
  configurable: false
});

function readPlanSlippage(symbol, orderType) {
  var modeEl = document.getElementById('slippageMode');
  var entryEl = document.getElementById('entrySlippageTicks');
  var exitEl = document.getElementById('exitSlippageTicks');
  return Slippage.readPlanInput({
    mode: modeEl ? modeEl.value : 'default',
    orderType: orderType,
    entryTicks: entryEl ? entryEl.value : 0,
    exitTicks: exitEl ? exitEl.value : 0,
    tickSize: getTickSize(symbol)
  });
}

function calcDirectionalPnl(direction, entryFill, exitFill, quantity) {
  return direction === 'long'
    ? (exitFill - entryFill) * quantity
    : (entryFill - exitFill) * quantity;
}

function calcRoundTripFee(quantity, entryFill, exitFill, feeRatePct) {
  var rate = (Number(feeRatePct) || 0) / 100;
  return quantity * entryFill * rate + quantity * exitFill * rate;
}

function getProvisionalStopLoss(entryPrice, direction, symbol, settings) {
  // 仅用于未填止损时的测算预览；保存前必须由用户确认或改写。
  var configuredPct = Number(settings && settings.provisionalStopPct);
  var fallbackPct = String(symbol || '').toUpperCase() === 'ETH' ? 0.008 : 0.01;
  var stopPct = Number.isFinite(configuredPct) && configuredPct >= 0.003 && configuredPct <= 0.05
    ? configuredPct
    : fallbackPct;
  return {
    stopPrice: direction === 'long' ? entryPrice * (1 - stopPct) : entryPrice * (1 + stopPct),
    stopPct: stopPct
  };
}

function calculate() {
  // P0-01：先建立所有结果区引用，任何阻断分支均不可访问未初始化变量。
  const ui = CalculationUI.getResultUI();
  const posD = ui.position;
  const marginD = ui.margin;
  const levD = ui.leverage;
  const rrD = ui.rr;
  const cardRR = ui.cardRR;
  const cardMargin = ui.cardMargin;
  const targetDistD = ui.targetDistance;
  const costL1 = ui.costLine1;
  const costL2 = ui.costLine2;
  const splitArea = ui.splitArea;
  const splitSummary = document.getElementById('splitSummary');
  const splitTable = document.getElementById('splitTable');
  const triggerRow = ui.triggerRow;
  const triggerContent = document.getElementById('triggerContent');
  const warnD = ui.warning;
  CalculationUI.resetForCalculation(ui);
  setCalc(null);
  setCalcBlocker(null);
  setCalcDirty(false);
  _calculating = true;
  const symbolEl = document.getElementById('symbol');
  const symbol = symbolEl ? symbolEl.value.trim() || 'N/A' : 'N/A';
  const entryPrice = getActiveEntryPrice();
  if (isNaN(entryPrice)) {
    setCalcDirty(true);
    CalculationUI.renderValidationError(ui, '无效入场价', '请输入有效的入场价格。');
    _calcCleanup();
    return null;
  }
  const capitalEl = document.getElementById('capital');
  const capital = capitalEl ? parseFloat(capitalEl.value) : 0;
  if (!capital || capital <= 0) { showCalcError('无效本金', '请输入有效的本金金额'); _calcCleanup(); return; }
  const leverageEl = document.getElementById('leverage');
  const leverage = leverageEl ? Math.max(0, parseFloat(leverageEl.value) || 0) : 0;
  const directionEl = document.getElementById('direction');
  const direction = directionEl ? directionEl.value : 'long';
  const orderTypeEl = document.getElementById('orderType');
  const orderType = orderTypeEl ? (orderTypeEl.value || 'market') : 'market';
  const stopTypeEl = document.getElementById('stopType');
  const stopType = stopTypeEl ? (stopTypeEl.value || 'stop-market') : 'stop-market';
  const stopLossEl = document.getElementById('stopLoss');
  let stopLoss = stopLossEl ? parseFloat(stopLossEl.value) : NaN;
  const lossStreakEl = document.getElementById('lossStreak');
  const lossStreak = lossStreakEl ? Math.max(0, parseInt(lossStreakEl.value, 10) || 0) : 0;
  const targetPriceEl = document.getElementById('targetPrice');
  const targetPrice = targetPriceEl ? parseFloat(targetPriceEl.value) : NaN;

  // ===== P0-05：统一滑点模型（双侧 ticks，禁止百分比/点数混用） =====
  const tickSize = getTickSize(symbol);
  const planSlippageInput = readPlanSlippage(symbol, orderType);
  const effectiveEntryPrice = Slippage.applyAdversePrice(
    entryPrice, direction, planSlippageInput.entryTicks, tickSize, 'entry'
  ).filledPrice;

  // ===== Skills 融合：ATR 动态止损 =====
  let atrStopMode = false;
  const atrValue = parseFloat(document.getElementById('atrValue').value);
  var settings = loadSettings();
  // 优先使用表单开关，其次设置值；倍数同理
  const formAtrEnabled = document.getElementById('formAtrStopEnabled');
  const atrEnabled = (formAtrEnabled && formAtrEnabled.checked) || settings.atrStopEnabled === true;
  const atrMultiplier = parseFloat(document.getElementById('atrMultiplier').value) || settings.atrDefaultMultiplier || 2;
  if (atrEnabled && !isNaN(atrValue) && atrValue > 0) {
    var atrStopResult = calcATRStop(effectiveEntryPrice, atrValue, atrMultiplier, direction);
    if (atrStopResult) {
      stopLoss = atrStopResult.stopPrice;
      atrStopMode = true;
      // A1 修复：同步更新 DOM 输入框，避免用户看到自己输入的值与实际计算的 ATR 止损价不一致
      var _slInput = document.getElementById('stopLoss');
      if (_slInput) {
        _slInput.value = stopLoss.toFixed(5);
        delete _slInput.dataset.provisionalStop;
      }
    }
  }

  // 未填写止损时，先生成清晰标记的临时止损，使仓位和保证金可用于预览。
  // 该临时值不能直接保存为正式交易计划，用户必须确认或修改它。
  let stopLossAutoGenerated = !!(stopLossEl && stopLossEl.dataset.provisionalStop === '1');
  let provisionalStopMessage = '';
  if (isNaN(stopLoss) || stopLoss <= 0) {
    const provisionalStop = getProvisionalStopLoss(effectiveEntryPrice, direction, symbol, settings);
    stopLoss = provisionalStop.stopPrice;
    stopLossAutoGenerated = true;
    provisionalStopMessage = '未填写止损价，已按 ' + (provisionalStop.stopPct * 100).toFixed(1) + '% 生成临时止损 ' + stopLoss.toFixed(5) + '，仅供仓位/保证金预览；确认或修改止损后方可保存。';
    if (stopLossEl) {
      stopLossEl.value = stopLoss.toFixed(5);
      stopLossEl.dataset.provisionalStop = '1';
    }
  }

  // ===== P0-01：日亏损硬止损检查 =====
  var dailyLossCheck = checkDailyLossLimit();
  if (dailyLossCheck.blocked) {
    _calcCleanup();
    return renderHardBlock(
      'daily-loss-limit',
      '日亏损熔断',
      '今日净盈亏 ' + dailyLossCheck.todayPnl.toFixed(2) + ' USDT，已达到日亏损上限 ' + dailyLossCheck.limit.toFixed(2) + ' USDT。',
      dailyLossCheck
    );
  }
  // ===== P0-01：交易频率检查 =====
  var freqCheck = checkDailyTradeFrequency();
  if (freqCheck.blocked) {
    _calcCleanup();
    return renderHardBlock(
      'daily-trade-limit',
      '交易频率熔断',
      '今日开仓计数 ' + freqCheck.todayCount + ' 笔，已达到上限 ' + freqCheck.maxCount + ' 笔。',
      freqCheck
    );
  }

  // ===== P0-01：组合热量检查 =====
  var heatCheck = calcPortfolioHeat();
  if (heatCheck.blocked) {
    _calcCleanup();
    return renderHardBlock(
      'portfolio-heat-limit',
      '组合热量超限',
      '当前组合热量 ' + heatCheck.heat.toFixed(1) + '%，' + (heatCheck.warning || '已超过风险上限。'),
      heatCheck
    );
  }

  if (ui.riskHint) ui.riskHint.textContent = '';

  function showCalcError(title, msg) {
    setCalc(null);
    setCalcDirty(true);
    CalculationUI.renderValidationError(ui, title, msg || '请修正输入后重新计算。');
  }

  function renderHardBlock(code, title, detail, raw) {
    setCalc(null);
    setCalcDirty(true);
    setCalcBlocker({ code: code, title: title, detail: detail, raw: raw || null, checkedAt: new Date().toISOString() });
    CalculationUI.renderBlocker(ui, getCalcBlocker());
    showToast(detail, 'error');
    return null;
  }

  // ===== P0-01：当日连亏熔断 =====
  const streakResult = _getTodayLossStreak();
  const currentStreak = streakResult.streak;
  if (currentStreak >= 3) {
    _calcCleanup();
    return renderHardBlock(
      'loss-streak-limit',
      '连续亏损熔断',
      '当日已连续亏损 ' + currentStreak + ' 笔；冷却期结束前不可建立新计划。',
      streakResult
    );
  }

  if (entryPrice <= 0) { showCalcError('无效入场价', '入场价必须大于 0'); _calcCleanup(); return; }
  if (isNaN(capital) || capital <= 0) { showCalcError('无效本金', '请输入本金'); _calcCleanup(); return; }
  if (isNaN(stopLoss) || stopLoss <= 0) { showCalcError('无效止损价', '请输入有效止损价格'); _calcCleanup(); return; }

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

  // ===== Skills 融合：凯利公式计算（额外显示） =====
  let kellyHTML = '';
  let kellyData = null;  // 持久化数据（存入日志和详情）
  try {
    var kellyWinRate = parseFloat(document.getElementById('kellyWinRate')?.value);
    var kellyAvgWin = parseFloat(document.getElementById('kellyAvgWin')?.value);
    var kellyAvgLoss = parseFloat(document.getElementById('kellyAvgLoss')?.value);
    if (!isNaN(kellyWinRate) && !isNaN(kellyAvgWin) && !isNaN(kellyAvgLoss) && kellyAvgLoss > 0) {
      var kellyLev = parseInt(document.getElementById('leverage').value, 10) || 1;
      var kellyResult = calcKelly(kellyWinRate, kellyAvgWin, kellyAvgLoss, capital, true, kellyLev);
      if (kellyResult && kellyResult.halfKellyPct > 0) {
        var kellyRisk = capital * kellyResult.halfKellyPct;
        kellyData = {
          halfKellyPct: kellyResult.halfKellyPct,
          halfKellyRisk: kellyRisk,
          expectancy: kellyResult.expectancy,
          kellyPct: kellyResult.kellyPct,
          kellyCapped: kellyResult.kellyCapped,
          halfKellyCapped: kellyResult.halfKellyCapped,
          recommendation: kellyResult.recommendation
        };
        var kellyCappedMsg = '';
        if (kellyResult.kellyCapped || kellyResult.halfKellyCapped) {
          kellyCappedMsg = '<span class="kelly-capped-tip"><i class="fas fa-info-circle"></i> 已截断至 5%</span>';
        }
        kellyHTML = '<span class="kelly-result-text">半凯利风险 <strong>' + (kellyResult.halfKellyPct * 100).toFixed(2) + '%</strong> = ' + kellyRisk.toFixed(2) + ' USDT</span>' + kellyCappedMsg + '<span class="kelly-expectancy">期望 ' + kellyResult.expectancy.toFixed(2) + '</span><button type="button" class="kelly-apply-btn" onclick="applyKellyRisk()"><i class="fas fa-bolt"></i> 应用</button>';
      } else if (kellyResult && kellyResult.kellyPct <= 0) {
        // 凯利值为负或零，显示警告
        kellyData = {
          halfKellyPct: 0,
          halfKellyRisk: 0,
          expectancy: kellyResult.expectancy,
          kellyPct: kellyResult.kellyPct,
          recommendation: kellyResult.recommendation,
          isNegative: true
        };
        kellyHTML = '<span class="kelly-result-text" style="color:var(--color-warning);"><i class="fas fa-exclamation-triangle"></i> 策略期望值为负，不建议开仓（期望 ' + kellyResult.expectancy.toFixed(2) + ' USDT/笔）</span>';
      }
    }
  } catch(e) { console.error('[kelly]', e); }

  // BUG#2: 分批独立止损时，用各批止损距离的加权平均替代主止损计算 stopDistance
  let stopDistance=0, positionSize=0, valid=true, err='', rw='';
  if (stopLossAutoGenerated) {
    rw = '<span class="warning-tag alert"><i class="fas fa-info-circle"></i> ' + provisionalStopMessage + '</span>';
  }
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
      if (skippedCount > 0 && totalAlloc === 0) {
        // 所有批次止损方向非法，回退使用主止损距离
        rw = '<span class="warning-tag"><i class="fas fa-exclamation-circle"></i> 分批止损所有批次方向非法，已回退为全局止损计算。</span>';
      } else if (skippedCount > 0) {
        // BUG-9 修复：跳过的批次不再占用比例，重新计算归一化权重
        rw = '<span class="warning-tag"><i class="fas fa-exclamation-circle"></i> 分批止损 ' + skippedCount + ' 批方向非法已跳过，使用剩余 ' + totalAlloc.toFixed(1) + '% 仓位加权计算。</span>';
      }
      // BUG-9 修复：使用实际有效批次的总比例归一化，避免跳过批次稀释权重
      if (totalAlloc > 0 && weightedStopPct > 0) {
        stopDistance = (weightedStopPct / totalAlloc) * effectiveEntryPrice;
        positionSize = riskAmount * effectiveEntryPrice / stopDistance;
        useWeightedStop = true;
      }
    }
  }

  // Skills 融合：ATR 模式下使用 ATR 计算的止损距离
  if (atrStopMode && !useWeightedStop) {
    var atrResult = calcATRStop(effectiveEntryPrice, atrValue, atrMultiplier, direction);
    if (atrResult) {
      stopDistance = atrResult.stopDistance;
      positionSize = riskAmount * effectiveEntryPrice / stopDistance;
    }
  } else if (atrStopMode && useWeightedStop) {
    // A 优化：ATR 与分批独立止损冲突时显示明确提示，而非静默跳过
    rw = '<span class="warning-tag alert"><i class="fas fa-exclamation-triangle"></i> ATR 动态止损与分批独立止损不可同时使用，已优先使用分批止损计算。</span>';
    atrStopMode = false;
  }

  if (!useWeightedStop && !atrStopMode) {
    if (direction==='long') {
      if (stopLoss>=effectiveEntryPrice) { err='做多止损价必须 < 入场价'; valid=false; }
      else { stopDistance=Math.abs(effectiveEntryPrice-stopLoss); positionSize=riskAmount*effectiveEntryPrice/stopDistance; }
    } else {
      // 做空：止损价必须严格大于入场价（== 时止损距离为 0，会被下方零止损距离检查拦截）
      if (stopLoss<=effectiveEntryPrice) { err='做空止损价必须 > 入场价'; valid=false; }
      else { stopDistance=Math.abs(stopLoss-effectiveEntryPrice); positionSize=riskAmount*effectiveEntryPrice/stopDistance; }
    }
  }
  if (!valid) { showCalcError(err, ''); return; }

  // 零止损距离硬阻断（止损距离 < 入场价 0.1%）：仓位会被放大到危险值，不允许继续计算
  if (stopDistance < effectiveEntryPrice * 0.001) {
    var _sdPct = (stopDistance / effectiveEntryPrice * 100).toFixed(3);
    _calcCleanup();
    return renderHardBlock(
      'stop-distance-too-tight',
      '止损距离过近',
      '止损距离仅 ' + _sdPct + '%（入场价 × 0.1%），仓位会被放大到不可控规模。请增大止损距离或降低风险比例后重新计算。',
      { stopDistance: stopDistance, entryPrice: effectiveEntryPrice, stopPct: _sdPct }
    );
  }

  // ===== 仓位硬上限：所有未平仓日志的保证金均须相加 =====
  // 拆分保存的同 groupId 条目是同一计划的分段仓位，不是重复记录，不能去重。
  var usedMargin = 0;
  var consumedCapital = 0; // 已消耗的总资金：保证金 + 滑点成本
  var openPositions = logs.filter(function(l) { return !l.closeType || l.closeType === ''; });
  for (var i = 0; i < openPositions.length; i++) {
    var pos = openPositions[i];
    var lev = Number(pos.leverage);
    if (isNaN(lev) || lev <= 0) lev = 1;
    var ps = Number(pos.positionSize);
    if (!isNaN(ps) && ps > 0) {
      usedMargin += ps / lev;
      consumedCapital += ps / lev;
    }
    // 滑点成本在开仓时已支付，从可用资金中扣除
    consumedCapital += parseFloat(pos.slippageCost) || 0;
  }
  var availableCapital = capital - consumedCapital;
  if (availableCapital < 0) availableCapital = 0;
  const maxPos = availableCapital * Math.max(leverage, 1);
  var cappedByMargin = false, capMsg = '';

  // 保证金 80% 硬上限（仅杠杆合约）：margin = positionSize / leverage ≤ capital * 0.8
  // 设计依据：单笔保证金不超过可用本金 80%，在相同风险下最大化保证金以获取高收益
  if (leverage > 0) {
    const marginLimitPos = availableCapital * leverage * 0.8;
    if (positionSize > marginLimitPos) {
      const origMargin = positionSize / leverage;
      riskAmount = marginLimitPos * stopDistance / effectiveEntryPrice;
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
    riskAmount = maxPos * stopDistance / effectiveEntryPrice;
    riskPercent = riskAmount / capital;
    positionSize = maxPos;
  }

  // ===== 多品种聚合上限：总保证金（已有 + 新开）≤ 本金 × 90% =====
  // 现货（leverage=0）时保证金 = positionSize，需同样纳入聚合上限检查
  var newMarginForAggregate = leverage > 0 ? (positionSize / leverage) : positionSize;
  var totalMarginForAggregate = usedMargin + newMarginForAggregate;
  var aggregateLimit = capital * 0.9;
  if (totalMarginForAggregate > aggregateLimit) {
    var maxNewMarginAgg = aggregateLimit - usedMargin;
    if (maxNewMarginAgg > 0) {
      var aggCappedPos = leverage > 0 ? (maxNewMarginAgg * leverage) : maxNewMarginAgg;
      riskAmount = aggCappedPos * stopDistance / effectiveEntryPrice;
      riskPercent = riskAmount / capital;
      capMsg = (capMsg ? capMsg + ' ' : '') + '<span class="warning-tag alert"><i class="fas fa-layer-group"></i> 总保证金触及 90% 聚合上限：已有 ' + usedMargin.toFixed(2) + ' + 新增 ' + newMarginForAggregate.toFixed(2) + ' = ' + totalMarginForAggregate.toFixed(2) + ' USDT（' + (totalMarginForAggregate / capital * 100).toFixed(1) + '% 本金），已截断新仓位保证金至 ' + maxNewMarginAgg.toFixed(2) + ' USDT。</span>';
      positionSize = aggCappedPos;
      cappedByMargin = true;
    } else {
      capMsg = (capMsg ? capMsg + ' ' : '') + '<span class="warning-tag alert"><i class="fas fa-layer-group"></i> 总保证金已达 90% 聚合上限：已有持仓已占用 ' + usedMargin.toFixed(2) + ' USDT（' + (usedMargin / capital * 100).toFixed(1) + '% 本金），无法再开新仓。请平仓后重试。</span>';
      positionSize = 0;
      cappedByMargin = true;
    }
  }

  // 额度已耗尽时不能继续构造零数量滑点/费用模型，必须作为硬阻断结束计算。
  if (!Number.isFinite(positionSize) || positionSize <= 0) {
    _calcCleanup();
    return renderHardBlock(
      'available-margin-limit',
      '可用保证金额度不足',
      '当前未平仓保证金已达到账户或聚合上限，无法建立新的有效仓位。请平仓或降低已有仓位后重试。',
      { usedMargin: usedMargin, capital: capital, aggregateLimit: aggregateLimit }
    );
  }

  // ===== 止损 vs 强平价校验（仅杠杆合约，现货跳过） =====
  let cappedByLiquidation = false, liquidationPrice = null, liqMsg = '';
  if (leverage > 0) {
    // MMR 从全局 settings 统一读取（百分比值需除以 100 转为小数）
    let mmr = 0.005; // 默认回退值
    var _settings = loadSettings();
    if (_settings && _settings.mmr != null) mmr = _settings.mmr / 100;

    liquidationPrice = window.utils.calcLiquidationPrice(effectiveEntryPrice, direction, leverage, mmr);
    // BUG#1 修复：止损价严格越过强平价时才阻断；等于时允许（用户仍可在强平前手动止损）
    const isInvalid = (direction === 'long' && stopLoss < liquidationPrice) ||
                      (direction === 'short' && stopLoss > liquidationPrice);
    if (isInvalid) {
      cappedByLiquidation = true;
      liqMsg = '止损 ' + stopLoss.toFixed(5) + ' 在强平价 ' + liquidationPrice.toFixed(5) + ' ' + (direction === 'long' ? '之下' : '之上') + '，价格到达止损前仓位将被强制平仓。请收紧止损距离或降低杠杆后重新计算。';
      _calcCleanup();
      return renderHardBlock('liquidation-stop-conflict', '止损越过强平价', liqMsg, {
        liquidationPrice: liquidationPrice,
        stopLoss: stopLoss,
        direction: direction,
        leverage: leverage
      });
    }
  }

  // 统一仓位管线：先应用连亏系数，再应用集中度上限；所有后续显示和保存均读取同一结果。
  let effLev = leverage > 0 ? leverage : 1;
  let lossStreakFactor = lossStreak >= 3 ? 0.8 : 1;
  let adjPos = positionSize * lossStreakFactor;
  if (lossStreakFactor < 1) {
    riskAmount = riskAmount * lossStreakFactor;
    riskPercent = riskAmount / capital;
  }
  let finalPosBeforeMindset = adjPos;

  // ===== Skills 融合：品种集中度检查 =====
  var concentrationCheck = checkSymbolConcentration(symbol, finalPosBeforeMindset, leverage, capital, openPositions);
  if (!concentrationCheck.pass) {
    var allowedFinalPos = concentrationCheck.allowedNewMargin * effLev;
    if (allowedFinalPos <= 0) {
      _calcCleanup();
      return renderHardBlock('symbol-concentration-limit', '品种集中度超限', concentrationCheck.warning || '该品种已无可用集中度额度，不能建立新计划。', concentrationCheck);
    }
    if (allowedFinalPos < finalPosBeforeMindset) {
      var concentrationRatio = allowedFinalPos / finalPosBeforeMindset;
      positionSize = positionSize * concentrationRatio;
      adjPos = adjPos * concentrationRatio;
      finalPosBeforeMindset = adjPos;
      riskAmount = riskAmount * concentrationRatio;
      riskPercent = riskAmount / capital;
      cappedByMargin = true;
      capMsg = (capMsg ? capMsg + ' ' : '') + '<span class="warning-tag alert"><i class="fas fa-exclamation-triangle"></i> ' + concentrationCheck.warning + '</span>';
    }
  }

  // ===== P0-01：心态评分影响仓位 =====
  const mindsetScore = parseInt(document.getElementById('mindsetScore').value, 10) || 3;
  var mindsetAdjust = getMindsetAdjustment(mindsetScore);
  if (mindsetAdjust.blocked) {
    _calcCleanup();
    return renderHardBlock('mindset-limit', '心态评分不足', mindsetAdjust.message || '当前心态评分不符合开仓规则。', mindsetAdjust);
  }
  if (mindsetAdjust.adjustment < 1) {
    positionSize = positionSize * mindsetAdjust.adjustment;
    adjPos = adjPos * mindsetAdjust.adjustment;
    riskAmount = riskAmount * mindsetAdjust.adjustment;
    riskPercent = riskAmount / capital;
  }

  // 统一有效仓位和风险：展示层和日志层使用同一数值
  // adjPos = 连亏打折后的仓位；当 lossStreak<3 时 adjPos === positionSize
  const effectivePositionSize = lossStreak >= 3 ? adjPos : positionSize;
  const effectiveRiskAmount = effectivePositionSize * stopDistance / effectiveEntryPrice;
  const effectiveRiskPercent = effectiveRiskAmount / capital;
  const effectiveMargin = effectivePositionSize / effLev;

  let adjMsg = '';
  if (lossStreak >= 3) {
    // 显示实际调整后的仓位（可能同时受连亏和心态双重调整）
    const adjLabel = adjPos !== positionSize
      ? '降低至 80% × ' + mindsetAdjust.adjustment * 100 + '% = ' + (adjPos / positionSize * 100).toFixed(0) + '% 基准仓位'
      : '降低至 80%';
    adjMsg = '连续亏损 ' + lossStreak + ' 笔，建议仓位' + adjLabel + ' (≈' + adjPos.toFixed(2) + ' USDT)';
  } else if (lossStreak >= 2) {
    adjMsg = '连续亏损 ' + lossStreak + ' 笔，注意风险控制';
  }
  const stopPct = stopDistance / effectiveEntryPrice * 100;

  // ===== 止损距离色标 =====
  const isEth = symbol.toUpperCase() === 'ETH';
  // 优先使用设置中的品种自定义止损比例
  var customStopLimits = settings.customStopLimit || {};
  var maxStopPct = customStopLimits[symbol] != null ? customStopLimits[symbol] : (isEth ? 2 : 3);
  var minStopPct = isEth ? 0.3 : 0.5;
  let stopTagClass = 'green', stopTagLabel = '适中';
  if (stopPct > 5) { stopTagClass = 'red'; stopTagLabel = '偏大'; rw = '<span class="warning-tag alert"><i class="fas fa-exclamation-triangle"></i> 止损距离 '+stopPct.toFixed(2)+'% 较大，请确认策略</span>'; }
  else if (stopPct > maxStopPct) { stopTagClass = 'yellow'; stopTagLabel = '偏大'; rw = '<span class="warning-tag"><i class="fas fa-bolt"></i> 止损距离 '+stopPct.toFixed(2)+'% 偏大</span>'; }
  else if (stopPct < minStopPct) { stopTagClass = 'yellow'; stopTagLabel = '偏窄'; rw = '<span class="warning-tag"><i class="fas fa-bolt"></i> 止损距离 '+stopPct.toFixed(2)+'% 较窄，注意滑点</span>'; }

  // ===== P0-05：手续费与双侧 tick 滑点（供 targetRR 使用） =====
  let feeRate = parseFloat(document.getElementById('feeRate').value) || 0;
  if (feeRate <= 0) feeRate = orderType === 'limit' ? 0.04 : 0.08;

  const quantity = effectivePositionSize / effectiveEntryPrice;
  const stopSlippageModel = Slippage.calculate({
    direction: direction,
    expectedEntryPrice: entryPrice,
    expectedExitPrice: stopLoss,
    quantity: quantity,
    tickSize: tickSize,
    entryTicks: planSlippageInput.entryTicks,
    exitTicks: planSlippageInput.exitTicks
  });
  const stopSlippage = Slippage.toLogSnapshot(stopSlippageModel, { source: planSlippageInput.source });

  let targetSlippage = null;
  let targetFee = 0;
  let stopFee = calcRoundTripFee(
    quantity,
    stopSlippage.effectiveEntryPrice,
    stopSlippage.effectiveExitPrice,
    feeRate
  );
  let totalFee = stopFee;
  let slippageCost = stopSlippage.totalCost;
  let totalCost = totalFee + slippageCost;

  // 以有效成交价计算目标 R；滑点已进入成交价，严禁再次从 PnL 扣除。
  let targetRR = null, targetPct = null;
  if (!isNaN(targetPrice) && targetPrice > 0) {
    const targetSlippageModel = Slippage.calculate({
      direction: direction,
      expectedEntryPrice: entryPrice,
      expectedExitPrice: targetPrice,
      quantity: quantity,
      tickSize: tickSize,
      entryTicks: planSlippageInput.entryTicks,
      exitTicks: planSlippageInput.exitTicks
    });
    targetSlippage = Slippage.toLogSnapshot(targetSlippageModel, { source: planSlippageInput.source });
    const grossProfit = calcDirectionalPnl(
      direction, targetSlippage.effectiveEntryPrice, targetSlippage.effectiveExitPrice, quantity
    );
    const grossStopLoss = calcDirectionalPnl(
      direction, stopSlippage.effectiveEntryPrice, stopSlippage.effectiveExitPrice, quantity
    );
    if (grossProfit > 0 && grossStopLoss < 0) {
      targetPct = grossProfit / (quantity * targetSlippage.effectiveEntryPrice) * 100;
      targetFee = calcRoundTripFee(
        quantity, targetSlippage.effectiveEntryPrice, targetSlippage.effectiveExitPrice, feeRate
      );
      totalFee = targetFee;
      slippageCost = targetSlippage.totalCost;
      totalCost = totalFee + slippageCost;
      const netProfit = grossProfit - targetFee;
      const netLoss = Math.abs(grossStopLoss - stopFee);
      if (netLoss > 0) targetRR = netProfit / netLoss;
    }
  }

  // ===== 三卡片：仓位 =====
  posD.textContent = effectivePositionSize.toFixed(2) + ' U';

  // ===== 三卡片：保证金 =====
  marginD.textContent = effectiveMargin.toFixed(2) + ' USDT';
  if (leverage > 0) {
    levD.textContent = leverage + 'x 杠杆';
  } else {
    levD.textContent = '现货 (1x)';
  }
  cardMargin.classList.toggle('margin-danger', effectiveMargin > capital);

  // ===== 三卡片：盈亏比 =====
  let rrCheckResult = null;
  if (targetRR !== null) {
    rrD.textContent = targetRR.toFixed(2) + ' : 1';
    if (targetRR >= 3) {
      cardRR.className = 'result-card rr-green';
    } else if (targetRR >= 2) {
      cardRR.className = 'result-card rr-amber';
    } else {
      cardRR.className = 'result-card rr-red';
    }
    rrCheckResult = checkRRRequirement(targetRR, settings.minRRRatio);
    if (!rrCheckResult.pass && settings.minRRRatio > 0) {
      rw = '<span class="warning-tag alert"><i class="fas fa-exclamation-triangle"></i> ' + rrCheckResult.message + '</span>' + (rw ? '<br>' + rw : '');
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

  // ===== 风险与成本行 L1：最大亏损 + 预估止损成本 =====
  let riskClass = (effectiveRiskPercent*100) <= 2 ? 'low' : ((effectiveRiskPercent*100) <= 5 ? 'mid' : 'high');
  // stopCost：用于与"最大亏损"并列，始终基于止损路径计算（不受目标价影响）
  const stopCost = stopFee + stopSlippage.totalCost;
  let costL1HTML = '<span>最大亏损 <span class="cost-loss ' + riskClass + '">' + effectiveRiskAmount.toFixed(2) + ' USDT (' + (effectiveRiskPercent*100).toFixed(2) + '%)</span></span>';
  if (stopCost > 0) {
    costL1HTML += '<span>止损预估费用 ' + stopCost.toFixed(2) + ' USDT</span>';
    costL1HTML += '<span>滑点 ' + planSlippageInput.entryTicks + '+' + planSlippageInput.exitTicks + ' ticks</span>';
  }
  if (atrStopMode) {
    costL1HTML += '<span class="atr-badge" style="margin-left:8px;padding:2px 6px;background:var(--color-primary-bg);color:var(--color-primary);border-radius:4px;font-size:11px;"><i class="fas fa-wave-square"></i> ATR 动态止损 ' + atrMultiplier.toFixed(1) + 'x</span>';
  }
  if (kellyHTML) costL1HTML += kellyHTML;
  costL1.innerHTML = costL1HTML;

  // ===== 风险与成本行 L2：止损距离 tag + 方向 + 品种 + 目标 =====
  let costL2HTML = '<span class="stop-tag ' + stopTagClass + '">止损 ' + stopPct.toFixed(2) + '%</span>';
  costL2HTML += ' <span class="sep">·</span> ' + (direction === 'long' ? '做多' : '做空');
  costL2HTML += ' <span class="sep">·</span> ' + esc(symbol);
  // 若入场价有修正，显示修正后入场价
  if (Math.abs(effectiveEntryPrice - entryPrice) > 0.0001) {
    costL2HTML += ' <span class="sep">·</span> 有效入场≈' + effectiveEntryPrice.toFixed(5);
  }
  if (targetPct !== null) {
    costL2HTML += ' <span class="sep">·</span> 目标 ' + (isNaN(targetPrice) ? '—' : targetPrice.toFixed(5)) + ' (+' + targetPct.toFixed(2) + '%)';
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
        // BUG#2 修复：统一使用 effectiveRiskAmount（已截断）按批次比例拆分，避免与 bpos 口径不一致
        const bRisk = effectiveRiskAmount * ba / 100;
        const bpos = effectivePositionSize * ba / 100;
        const bstopDist = direction === 'long' ? bp - bsl : bsl - bp;
        // 实际损失取风险额和计算值的较小者（考虑仓位被截断的情况）
        const bloss = Math.min(bRisk, bstopDist > 0 ? (bstopDist * bpos / effectiveEntryPrice) : bRisk);
        const blossPct = capital > 0 ? (bloss / capital * 100) : 0;
        triggerHTML += '<div class="trigger-line"><span class="trigger-batch">#' + (i + 1) + '</span><span class="trigger-price">' + bsl.toFixed(5) + '</span><span class="trigger-arrow">→</span><span>损失</span><span class="trigger-loss">' + bloss.toFixed(2) + ' U (' + blossPct.toFixed(2) + '%)</span></div>';
      });
    } else {
      triggerHTML = '<div class="trigger-line"><span class="trigger-price">' + (stopLoss ? parseFloat(stopLoss).toFixed(5) : '—') + '</span><span class="trigger-arrow">→</span><span>损失</span><span class="trigger-loss">' + effectiveRiskAmount.toFixed(2) + ' USDT (' + (effectiveRiskPercent * 100).toFixed(2) + '%)</span></div>';
    }
  } else {
    triggerHTML = '<div class="trigger-line"><span class="trigger-price">' + (stopLoss ? parseFloat(stopLoss).toFixed(5) : '—') + '</span><span class="trigger-arrow">→</span><span>损失</span><span class="trigger-loss">' + effectiveRiskAmount.toFixed(2) + ' USDT (' + (effectiveRiskPercent * 100).toFixed(2) + '%)</span></div>';
  }
  if (triggerHTML) {
    triggerContent.innerHTML = triggerHTML;
    triggerRow.style.display = 'block';
  }

  // ===== 分批建仓独立区 =====
  if (_splitMode && _splitBatches.length >= 2) {
    const w = computeWeightedEntry();
    if (w !== null) {
      splitSummary.innerHTML = '加权入场价 <strong>' + w.toFixed(5) + '</strong>';
      let tbody = '';
      _splitBatches.forEach(function(b, i) {
        const bp = parseFloat(b.price), ba = parseFloat(b.alloc);
        const bpos = !isNaN(bp) && !isNaN(ba) ? (effectivePositionSize * ba / 100).toFixed(2) : '—';
        const bsl = b.stopLoss && !isNaN(parseFloat(b.stopLoss)) ? parseFloat(b.stopLoss).toFixed(5) : '—';
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
  if (!cappedByMargin && effectiveMargin > capital) {
    const needLeverage = effectivePositionSize /  capital;
    wh += '<div class="warning-tag alert" style="margin-top:6px;"><i class="fas fa-exclamation-triangle"></i> 保证金不足: 需 ' + effectiveMargin.toFixed(2) + ' USDT，本金仅 ' + capital.toFixed(2) + ' USDT。建议提高杠杆至 ≥ ' + needLeverage.toFixed(1) + 'x，或降低风险额 / 收紧止损</div>';
  }
  warnD.innerHTML = wh;
  const resultBox = document.getElementById('resultBox');
  if (resultBox) {
    if (wh) { resultBox.classList.add('warn'); }
    else { resultBox.classList.remove('warn'); }
  }

  const planningSlippage = targetSlippage || stopSlippage;
  setCalc({
    symbol: symbol,
    entryPrice: entryPrice,
    effectiveEntryPrice: effectiveEntryPrice,
    capital: capital,
    riskAmount: riskAmount,
    riskPercent: riskPercent,
    leverage: leverage,
    direction: direction,
    orderType: orderType,
    stopType: stopType,
    stopLoss: stopLoss,
    stopLossAutoGenerated: stopLossAutoGenerated,
    lossStreak: lossStreak,
    targetPrice: isNaN(targetPrice) ? null : targetPrice,
    positionSize: effectivePositionSize,
    stopDistance: stopDistance,
    stopPct: stopPct,
    liquidationPrice: liquidationPrice,
    cappedByLiquidation: cappedByLiquidation,
    targetRR: targetRR,
    targetPct: targetPct,
    reason: getReason(),
    signals: getSignals(),
    actualMargin: effectiveMargin,
    fee: parseFloat(totalFee.toFixed(8)),
    feeRate: feeRate,
    // 兼容旧渲染字段；新逻辑统一优先读取 slippage 快照，绝不再次扣减该值。
    slippageCost: parseFloat(planningSlippage.totalCost.toFixed(8)),
    totalCost: parseFloat(totalCost.toFixed(8)),
    slippage: {
      planning: planningSlippage,
      atStop: stopSlippage,
      atTarget: targetSlippage
    },
    calculationVersion: 2,
    splitMode: _splitMode,
    weightedStopDistance: useWeightedStop ? stopDistance : null,
    atrStopMode: atrStopMode,
    mindsetScore: parseInt(document.getElementById('mindsetScore').value, 10) || 3,
    kellyData: kellyData,
    // 暴露分批明细供 saveSplit 使用（独立止损需逐笔保存）
    _splitBatches: _splitMode ? _splitBatches.slice() : null
  });
  CalculationUI.renderCalculated(ui);
  // P0-5: 计算结果卡片入场动效
  var _ra = document.getElementById('resultArea');
  if (_ra) {
    _ra.classList.remove('result-animate');
    void _ra.offsetWidth;
    _ra.classList.add('result-animate');
  }
  if (stopLossAutoGenerated) CalculationUI.renderProvisionalStop(ui);
  // 自动滚动到结果区
  if (resultBox) resultBox.scrollIntoView({behavior:'smooth'});
  // 更新凯利侧边栏卡片
  try { updateKellySidebar(); } catch(e) { console.error('[calculate] updateKellySidebar error:', e); }
  try { if (typeof updateChecklist === 'function') updateChecklist(); } catch(e) { console.error('[calculate] updateChecklist error:', e); }
  try { if (typeof autoCalcMultiTP === 'function') autoCalcMultiTP(); } catch(e) { console.error('[calculate] autoCalcMultiTP error:', e); }
  _calculating = false;
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

function assertSavableCalculation() {
  const calc = getCalc();
  if (!calc || !calc.positionSize || calc.positionSize <= 0) {
    return { ok: false, message: '请先点击「计算仓位」生成有效数据。' };
  }
  if (getCalcDirty()) {
    return { ok: false, message: '计划参数已变更，请重新计算后再保存。' };
  }
  if (calc.stopLossAutoGenerated) {
    return { ok: false, message: '当前止损为系统临时测算值，请确认或修改止损后重新计算再保存。' };
  }
  if (getCalcBlocker()) {
    return { ok: false, message: '当前计划存在硬风控阻断，不能保存。' };
  }
  // 软检查：最多允许 1 个 fail；可执行项 < 2 时跳过通过率检查
  var failCount = 0, totalExecutables = 0;
  if (calc.checklistResults) {
    for (var k in calc.checklistResults) {
      if (calc.checklistResults[k] === 'skipped') continue;
      totalExecutables++;
      if (calc.checklistResults[k] === 'fail') failCount++;
    }
  }
  if (totalExecutables >= 2 && failCount > 0) {
    return { ok: false, message: '风控检查有 ' + failCount + ' 项未通过，不能保存。' };
  }
  return { ok: true, calc: calc };
}

function saveLog() {
  const gate = assertSavableCalculation();
  if (!gate.ok) { showToast(gate.message, 'warn'); return false; }
  const calc = gate.calc;

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
    stopType: document.getElementById('stopType')?.value || 'stop-market',
    entryPrice: calc.entryPrice,
    effectiveEntryPrice: calc.effectiveEntryPrice,
    stopLoss: calc.stopLoss,
    targetPrice: calc.targetPrice,
    positionSize: parseFloat(calc.positionSize.toFixed(2)),
    leverage: calc.leverage,
    riskAmount: parseFloat(calc.riskAmount.toFixed(2)),
    actualMargin: calc.actualMargin != null ? parseFloat(calc.actualMargin.toFixed(2)) : null,
    capital: isNaN(calc.capital) ? null : calc.capital,              // H1: 入场时本金快照，用于事后验证仓位合理性
    fee: calc.fee != null ? calc.fee : 0,
    slippage: calc.slippage ? JSON.parse(JSON.stringify(calc.slippage)) : null,
    // 仅为旧界面与导出兼容；平仓 PnL 不再将此数字二次扣除。
    slippageCost: calc.slippage && calc.slippage.planning ? calc.slippage.planning.totalCost : 0,
    calculationVersion: calc.calculationVersion || 2,
    targetRR: calc.targetRR != null ? calc.targetRR : null,
    stopPct: calc.stopPct,                                          // ✅ 新增：持久化止损距离百分比
    kellyData: calc.kellyData != null ? JSON.parse(JSON.stringify(calc.kellyData)) : null,
    groupId: null,
    groupLabel: null,
    reason: calc.reason || getReason(),
    mindsetScore: calc.mindsetScore != null ? calc.mindsetScore : (parseInt(document.getElementById('mindsetScore').value, 10) || 3),
    strategyFramework: document.getElementById('strategyFramework').value,
    strategyPattern: document.getElementById('strategyPattern').value,
    signals: calc.signals,
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
    atrStopMode: calc.atrStopMode || false,                        // A 修复：持久化 ATR 止损使用状态
    checklistResults: checklistResults  // ✅ 新增：持久化检查结果至日志
  };
  logs.push(entry);
  if (!saveLogs()) {
    logs.pop();
    showToast('日志未保存：浏览器本地存储写入失败。', 'error');
    return false;
  }
  openClosePanelIdx = -1;
  actionPanelIdx = -1;
  setCalcDirty(false);
  showToast('日志已保存', 'success');
  return true;
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
    updateSplitButtons(); // 新增：确保按钮状态正确
    if (!document.getElementById('entryPrice').value) {
      document.getElementById('entryPrice').placeholder = '加权均价（自动计算）';
    }
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<i class="fas fa-layer-group"></i> + 分批建仓';
    area.classList.remove('open');
    _splitBatches = [];
    document.getElementById('entryPrice').placeholder = '价格';
    document.getElementById('entryPrice').value = '';
    document.getElementById('entryPrice').readOnly = false;
    // 分批模式关闭后计算上下文改变，标记脏状态以强制用户重新计算
    setCalcDirty(true);
    if (window.CalculationUI) {
      CalculationUI.renderDirty(CalculationUI.getResultUI());
    }
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
      '<input type="number" id="splitPrice_' + i + '" step="0.00001" placeholder="价格" value="' + (b.price || '') + '" oninput="onSplitChange()" /></div>' +
      '<div class="fp"><label>比例 %</label>' +
      '<input type="number" id="splitAlloc_' + i + '" step="0.5" min="0" max="100" placeholder="%" value="' + (b.alloc || '') + '" class="alloc-input" oninput="onSplitChange()" /></div>' +
      '<div class="fp"><label>止损(可选)</label>' +
      '<input type="number" id="splitSL_' + i + '" step="0.00001" placeholder="共用" value="' + (b.stopLoss || '') + '" oninput="onSplitChange()" /></div>' +
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
    epEl.value = ep.toFixed(5);
    epEl.readOnly = true;
  } else {
    epEl.value = '';
    epEl.readOnly = false;
  }
}
var _cachedWeightedEntry = null;
var _cachedWeightedEntryHash = '';
function computeWeightedEntry() {
  // P2: 排序后哈希，避免因批次顺序不同但内容相同时产生无效缓存失效
  var hash = JSON.stringify(_splitBatches.slice().sort(function(a, b) {
    return parseFloat(a.price) - parseFloat(b.price) || parseFloat(a.alloc) - parseFloat(b.alloc);
  }));
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
  // 修复Bug: 统一分批建仓限制逻辑，支持2-5批的合理分批策略
  const MIN_SPLITS = 2;  // 最少2批
  const MAX_SPLITS = 5;  // 最多5批
  
  if (_splitBatches.length >= MAX_SPLITS) {
    showToast(`分批建仓最多支持${MAX_SPLITS}批，当前已有${_splitBatches.length}批`, "warning");
    return false; // 明确返回false表示添加失败
  }
  
  // 添加新批次
  _splitBatches.push({ price: '', alloc: '', stopLoss: '' });
  renderSplitBatches();
  updateSplitButtons(); // 新增：更新按钮状态
  
  // 调试信息
  console.log(`已添加第${_splitBatches.length}批，当前共${_splitBatches.length}批，范围：${MIN_SPLITS}-${MAX_SPLITS}`);
  return true; // 返回true表示添加成功
}
function removeSplitBatch(idx) {
  // 修复Bug: 统一分批建仓限制逻辑，最少保留2批
  const MIN_SPLITS = 2;  // 最少2批
  const MAX_SPLITS = 5;  // 最多5批
  
  if (_splitBatches.length <= MIN_SPLITS) {
    showToast(`分批建仓最少需要${MIN_SPLITS}批，当前已有${_splitBatches.length}批`, "warning");
    return false; // 明确返回false表示删除失败
  }
  
  // 删除指定批次
  _splitBatches.splice(idx, 1);
  renderSplitBatches();
  updateSplitButtons(); // 更新按钮状态
  onSplitChange();
  
  // 调试信息
  console.log(`已删除第${idx + 1}批，剩余${_splitBatches.length}批，范围：${MIN_SPLITS}-${MAX_SPLITS}`);
  return true; // 返回true表示删除成功
}

/**
 * 更新分批建仓按钮的显示状态
 * 根据当前批次数动态显示/隐藏添加和删除按钮
 */
function updateSplitButtons() {
  const container = document.getElementById('splitContainer');
  if (!container) return;
  
  const addBtn = container.querySelector('.split-add-btn');
  const removeBtns = container.querySelectorAll('.split-remove-btn');
  
  if (!addBtn) return;
  
  const MIN_SPLITS = 2;
  const MAX_SPLITS = 5;
  const currentCount = _splitBatches ? _splitBatches.length : 2;
  
  // 控制添加按钮显示
  if (currentCount >= MAX_SPLITS) {
    addBtn.style.display = 'none'; // 达到最大批次，隐藏添加按钮
  } else {
    addBtn.style.display = 'inline-block'; // 允许添加，显示按钮
  }
  
  // 控制删除按钮显示
  removeBtns.forEach(btn => {
    if (currentCount <= MIN_SPLITS) {
      btn.style.display = 'none'; // 达到最小批次，隐藏删除按钮
    } else {
      btn.style.display = 'inline-block'; // 允许删除，显示按钮
    }
  });
  
  // 可选：添加视觉提示
  if (currentCount >= MAX_SPLITS) {
    addBtn.title = `已达到最大批次数(${MAX_SPLITS})`;
  } else {
    addBtn.title = `添加第${currentCount + 1}批 (最多${MAX_SPLITS}批)`;
  }
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
  return { entries: entries, weightedEntry: parseFloat(weighted.toFixed(5)) };
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
  var _settings = loadSettings();
  // 从设置读取默认品种，优先取第一个自定义品种，否则用 BTC
  var _symDefault = 'BTC';
  try {
    var _symList = _settings.customSymbols;
    if (_symList && _symList.length > 0 && _symList[0].symbol) _symDefault = _symList[0].symbol;
  } catch(e) { console.error('[resetForm]', e); }
  document.getElementById('symbol').value = _symDefault;
  document.getElementById('entryPrice').value = '';
  // 从设置读取默认本金，否则用 1000
  document.getElementById('capital').value = (_settings.accountBalance > 0) ? _settings.accountBalance : 1000;
  // 从设置读取默认风险比例，否则用 2%
  var _riskPct = _settings.riskPercent || 2;
  document.getElementById('riskInput').value = _riskPct + '%';
  document.getElementById('riskHint').textContent = '';
  // 从设置读取默认杠杆，否则用 0（现货）
  var _lev = _settings.defaultLeverage || 0;
  document.getElementById('leverage').value = String(_lev);
  document.getElementById('direction').value = 'long';
  // 同步订单类型标签为做多版本
  (function() {
    var ot = document.getElementById('orderType');
    if (ot && ot.options.length >= 3) {
      ot.options[0].text = '市价单';
      ot.options[1].text = '限价单 (Buy Limit)';
      ot.options[2].text = '止损单 (Buy Stop)';
    }
  })();
  document.getElementById('stopLoss').value = '';
  document.getElementById('targetPrice').value = '';
  document.getElementById('atrValue').value = '';
  var _atrSettings = loadSettings();
  document.getElementById('atrMultiplier').value = _atrSettings.atrDefaultMultiplier != null ? _atrSettings.atrDefaultMultiplier : 2;
  // BUG#9 修复：重置 ATR 开关状态为关闭，避免 reset 后仍启用 ATR 动态止损
  var atrEnableEl = document.getElementById('formAtrStopEnabled');
  if (atrEnableEl) atrEnableEl.checked = false;
  document.getElementById('lossStreak').value = '0';
  document.getElementById('orderType').value = 'market';
  var stEl = document.getElementById('stopType');
  if (stEl) stEl.value = 'stop-market';
  document.getElementById('feeRate').value = '0.08';
  var slippageModeEl = document.getElementById('slippageMode');
  var entrySlipEl = document.getElementById('entrySlippageTicks');
  var exitSlipEl = document.getElementById('exitSlippageTicks');
  if (slippageModeEl) slippageModeEl.value = 'default';
  if (entrySlipEl) entrySlipEl.value = '0';
  if (exitSlipEl) exitSlipEl.value = '0';
  var resetStopLossEl = document.getElementById('stopLoss');
  if (resetStopLossEl) delete resetStopLossEl.dataset.provisionalStop;
  if (typeof syncSlippageModeUI === 'function') syncSlippageModeUI();
  // 重置凯利字段
  document.getElementById('kellyWinRate').value = '';
  document.getElementById('kellyAvgWin').value = '';
  document.getElementById('kellyAvgLoss').value = '';
// 重置分批状态
if (_splitMode) toggleSplitMode();
  renderMindsetStars(3);
  document.getElementById('strategyFramework').value = '';
  document.getElementById('strategyPattern').innerHTML = '<option value="">— 不选择 —</option>';
  document.querySelectorAll('#signalCheckboxes input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  updateCheckboxStyle();
  document.getElementById('reasonSelect').value = '趋势突破';
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
  setCalc(null);
  setCalcBlocker(null);
  setCalcDirty(false);
  _calculating = false;
  // 同步重置按钮 UI 状态，防止残留脏态阻止保存按钮重新启用
  if (window.CalculationUI) {
    CalculationUI.resetForCalculation(CalculationUI.getResultUI());
  }
}

function toggleFormSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const chevron = section.querySelector('.form-section-header-chevron');
  const wasCollapsed = section.classList.contains('collapsed');
  section.classList.toggle('collapsed');
  if (chevron) {
    chevron.classList.toggle('rotated');
  }
  // P0-15: 折叠面板展开时触发表单字段交错入场动效
  if (!wasCollapsed) {
    section.classList.remove('animating');
    // 强制 reflow 后重新添加，触发 animation
    void section.offsetWidth;
    section.classList.add('animating');
  }
}

// 关键字段变更时使计算结果过期，并立刻关闭保存入口。
(function() {
  function markCalculationDirty() {
    if (_calculating) return;  // 计算进行中，忽略脏事件，避免竞态污染状态
    setCalcDirty(true);
    if (getCalc() && window.CalculationUI) {
      window.CalculationUI.renderDirty(window.CalculationUI.getResultUI());
    }
  }

  // dirtyFields 不包含 atrStopEnabled（checkbox）和 slippageMode（select），
  // 因为这些是"模式开关"而非直接数值输入。用户切换 ATR 开关后需手动点「计算仓位」。
  // 注意：capital 在 dirtyFields 中，修改本金会标记脏状态。
  var dirtyFields = [
    'symbol', 'entryPrice', 'stopLoss', 'capital', 'leverage', 'direction',
    'orderType', 'stopType', 'feeRate', 'slippageMode', 'entrySlippageTicks',
    'exitSlippageTicks', 'lossStreak', 'riskInput', 'targetPrice',
    'kellyWinRate', 'kellyAvgWin', 'kellyAvgLoss', 'atrValue', 'atrMultiplier',
    'mindsetScore'
  ];
  dirtyFields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      var markFieldDirty = function() {
        if (id === 'stopLoss') delete el.dataset.provisionalStop;
        markCalculationDirty();
      };
      el.addEventListener('input', markFieldDirty);
      el.addEventListener('change', markFieldDirty);
    }
  });
  var sld = document.getElementById('stopLossSlider');
  if (sld) sld.addEventListener('input', markCalculationDirty);
  // 信号复选框变更同样需要重算，否则 checklist 与落库内容不一致
  var sigBox = document.getElementById('signalCheckboxes');
  if (sigBox) sigBox.addEventListener('change', markCalculationDirty);
})();

function syncSlippageModeUI() {
  var modeEl = document.getElementById('slippageMode');
  var entryGroup = document.getElementById('entrySlippageGroup');
  var exitGroup = document.getElementById('exitSlippageGroup');
  var hidden = !modeEl || modeEl.value !== 'manual';
  if (entryGroup) entryGroup.hidden = hidden;
  if (exitGroup) exitGroup.hidden = hidden;
}

(function initSlippageModeUI() {
  var modeEl = document.getElementById('slippageMode');
  if (modeEl) modeEl.addEventListener('change', syncSlippageModeUI);
  syncSlippageModeUI();
})();

/**
 * 将已保存的设置值同步到开仓计算器表单
 * （DOMContentLoaded 时调用，确保下次打开页面使用上次设置）
 */
function syncSettingsToForm() {
  var settings = loadSettings();
  var capitalEl = document.getElementById('capital');
  if (capitalEl) capitalEl.value = (settings.accountBalance > 0) ? settings.accountBalance : 1000;
  var riskEl = document.getElementById('riskInput');
  if (riskEl) riskEl.value = (settings.riskPercent || 2) + '%';
  var levEl = document.getElementById('leverage');
  if (levEl) levEl.value = String(settings.defaultLeverage || 0);
  // ATR 默认倍数同步
  var atrMultEl = document.getElementById('atrMultiplier');
  if (atrMultEl) atrMultEl.value = settings.atrDefaultMultiplier != null ? settings.atrDefaultMultiplier : 2;
  // ATR 启用状态同步（HTML 中 id="formAtrStopEnabled"）
  var atrEnableEl = document.getElementById('formAtrStopEnabled');
  if (atrEnableEl) atrEnableEl.checked = settings.atrStopEnabled === true;
}

/**
 * 应用半凯利风险比例到开仓计划
 * 
 * 功能：
 * 1. 读取已计算的凯利数据（getCalc().kellyData）
 * 2. 将半凯利比例四舍五入到最近的 0.5% 步进
 * 3. 自动计算并填入止损价（优先 ATR，其次凯利平均亏损）
 * 4. 触发重新计算仓位
 * 
 * @returns {void}
 * 
 * @example
 * // 用户点击"应用半凯利风险"按钮时调用
 * applyKellyRisk();
 */
function applyKellyRisk() {
  if (!getCalc() || !getCalc().kellyData) {
    showToast('请先填写凯利数据并点击计算', 'warn');
    return;
  }
  var kellyPct = getCalc().kellyData.halfKellyPct;
  if (!kellyPct || kellyPct <= 0) {
    showToast('凯利计算结果为 0，无法应用', 'warn');
    return;
  }
  var wasCapped = kellyPct > 0.10; // 实际上限为 10%，kellyPct > 0.10 表示被 Math.min(10, ...) 截断
  
  // 杠杆感知：调整凯利风险比例
  var leverage = parseInt(document.getElementById('leverage').value, 10) || 1;
  var effectiveRisk = kellyPct * leverage;
  if (effectiveRisk > 0.10) {
    // 有效风险超过 10%，降低凯利建议
    var adjustedKelly = kellyPct / leverage * 0.10;
    kellyPct = adjustedKelly;
    wasCapped = true;
  }
  
  var riskEl = document.getElementById('riskInput');
  if (!riskEl) return;
  // riskInput 是 <select>，只有 0.5% 步长的固定选项。
  // 将半凯利值四舍五入到最近的可用选项，确保 .value 能匹配到一个真实存在的 option。
  var pctVal = parseFloat((kellyPct * 100).toFixed(2));
  pctVal = Math.max(0.5, Math.min(10, pctVal)); // 限制在 0.5%~10%
  var roundedPct = Math.round(pctVal * 2) / 2; // 四舍五入到 0.5% 步进
  riskEl.value = roundedPct + '%';

  // ===== 自动计算并填入止损价 =====
  var entryPrice = parseFloat(document.getElementById('entryPrice').value);
  var direction = document.getElementById('direction').value;
  var stopLossEl = document.getElementById('stopLoss');
  if (!isNaN(entryPrice) && entryPrice > 0 && stopLossEl && direction) {
    var calc = getCalc();
    var stopLoss = null;

    // 优先使用 ATR 止损（仅当 ATR 自动模式已启用）
    var atrValue = parseFloat(document.getElementById('atrValue').value);
    var settings = loadSettings();
    const atrMultiplier = parseFloat(document.getElementById('atrMultiplier').value) || settings.atrDefaultMultiplier || 2;
    if (settings.atrStopEnabled && !isNaN(atrValue) && atrValue > 0 && typeof calcATRStop === 'function') {
      var atrResult = calcATRStop(entryPrice, atrValue, atrMultiplier, direction);
      if (atrResult && atrResult.stopPrice > 0) {
        stopLoss = atrResult.stopPrice;
      }
    }

    // 如果没有 ATR，使用凯利平均亏损反推合理止损距离
    if (stopLoss === null) {
      var kellyAvgLoss = parseFloat(document.getElementById('kellyAvgLoss')?.value);
      if (!isNaN(kellyAvgLoss) && kellyAvgLoss > 0) {
        // 用平均亏损占入场价的比例作为止损距离基准
        var slPct = kellyAvgLoss / entryPrice;
        // 确保止损距离合理（不小于 minStopPct，不超过 maxStopPct）
        var isEth = (calc && calc.symbol && calc.symbol.toUpperCase() === 'ETH');
        var minStopPct = isEth ? 0.003 : 0.005;
        var maxStopPct = isEth ? 0.02 : 0.03;
        slPct = Math.max(minStopPct, Math.min(maxStopPct, slPct));
        stopLoss = direction === 'long'
          ? entryPrice * (1 - slPct)
          : entryPrice * (1 + slPct);
      }
    }

    // 兜底：使用 1% 止损距离
    if (stopLoss === null) {
      stopLoss = direction === 'long' ? entryPrice * 0.99 : entryPrice * 1.01;
    }

    // 方向校验
    if ((direction === 'long' && stopLoss >= entryPrice) ||
        (direction === 'short' && stopLoss <= entryPrice)) {
      stopLoss = direction === 'long' ? entryPrice * 0.99 : entryPrice * 1.01;
    }

    stopLossEl.value = stopLoss.toFixed(5);
  }
  // =================================

  // 标记表单已变更，清除缓存
  setCalc(null);
  setCalcBlocker(null);
  setCalcDirty(true);
  _calculating = false;
  // 自动重新计算
  if (typeof calculate === 'function') {
    calculate();
  }
  var msg = '已应用半凯利风险 ' + roundedPct.toFixed(1) + '%';
  if (wasCapped) {
    msg += '（半凯利超出上限，已截断至 10%）';
  } else if (roundedPct !== pctVal) {
    msg += '（取整至最近 0.5% 步长）';
  }
  // K2 修复：验证 select 选项是否匹配，防止静默失败
  var _matched = false;
  for (var _oi = 0; _oi < riskEl.options.length; _oi++) {
    if (riskEl.options[_oi].value === roundedPct + '%') { _matched = true; break; }
  }
  if (!_matched) {
    showToast('凯利建议值 ' + roundedPct.toFixed(1) + '% 在可选范围外，请手动调整风险比例', 'warn');
    return;
  }
  showToast(msg, 'info');
}
window.applyKellyRisk = applyKellyRisk;

// ==================== 凯利面板折叠 ====================
function toggleKellyPanel() {
  var body = document.getElementById('kellyBody');
  var icon = document.getElementById('kellyToggleIcon');
  var group = document.getElementById('kellyInputGroup');
  if (!body || !group) return;
  var isOpen = !group.classList.contains('kelly-collapsed');
  if (isOpen) {
    if (icon) icon.classList.add('collapsed');
    group.classList.add('kelly-collapsed');
  } else {
    if (icon) icon.classList.remove('collapsed');
    group.classList.remove('kelly-collapsed');
  }
}
window.toggleKellyPanel = toggleKellyPanel;

/**
 * ATR 开关切换：更新表单中 ATR 区域的视觉状态
 */
function toggleAutoATR() {
  var enabled = document.getElementById('formAtrStopEnabled');
  if (!enabled) return;
  // 不自动触发计算，仅同步开关状态；用户输入 ATR 值后点「计算仓位」生效
}

/**
 * 更新凯利公式侧边栏卡片显示
 */
function updateKellySidebar() {
  var card = document.getElementById('kellyCard');
  if (!card) return;
  var data = getCalc() && getCalc().kellyData;
  if (!data) {
    card.style.display = 'none';
    return;
  }
  // 即使凯利为负也显示卡片（带警告）
  if (data.halfKellyPct <= 0 && !data.isNegative) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  var fullPctEl = document.getElementById('kellyFullPct');
  var halfPctEl = document.getElementById('kellyHalfPct');
  var expectEl = document.getElementById('kellyExpectancy');
  var riskEl = document.getElementById('kellyRiskAmount');
  var warnEl = document.getElementById('kellyWarning');
  var btnEl = document.getElementById('kellyApplyBtn');
  if (fullPctEl) fullPctEl.textContent = (data.kellyPct * 100).toFixed(2) + '%';
  if (halfPctEl) halfPctEl.textContent = (data.halfKellyPct * 100).toFixed(2) + '%';
  if (expectEl) expectEl.textContent = (data.expectancy > 0 ? '+' : '') + data.expectancy.toFixed(2) + ' U';
  if (riskEl) riskEl.textContent = data.halfKellyRisk.toFixed(2) + ' U';
  if (warnEl) {
    if (data.kellyCapped || data.halfKellyCapped) {
      warnEl.style.display = '';
      warnEl.innerHTML = '<span class="kelly-card-warning-text"><i class="fas fa-exclamation-triangle"></i> 原始凯利超出 5% 上限，已截断</span>';
    } else {
      warnEl.style.display = 'none';
    }
  }
  if (btnEl) btnEl.style.display = '';
}
