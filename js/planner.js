// ==================== 盈亏比反推 ====================

/**
 * 读取当前入场价、止损价、方向，根据期望盈亏比反推目标价
 */
function calcReverseTP() {
  if (window._lastCalcDirty) { alert('计算器参数已变更，请先点击「计算仓位」更新结果。'); return; }
  var calc = window._lastCalc;
  var entryPrice, stopLoss, direction;

  if (calc && calc.entryPrice && calc.stopLoss) {
    entryPrice = calc.entryPrice;
    stopLoss = calc.stopLoss;
    direction = calc.direction;
  } else {
    entryPrice = parseFloat(document.getElementById('entryPrice').value);
    stopLoss = parseFloat(document.getElementById('stopLoss').value);
    direction = document.getElementById('direction').value;
  }

  var desiredRR = parseFloat(document.getElementById('desiredRR').value);
  if (isNaN(desiredRR) || desiredRR <= 0) {
    document.getElementById('reverseTP').value = '请输入有效的期望盈亏比';
    return;
  }

  if (isNaN(entryPrice) || isNaN(stopLoss) || entryPrice <= 0 || stopLoss <= 0) {
    document.getElementById('reverseTP').value = '请先填写入场价和止损价';
    return;
  }

  // 方向校验
  if (direction === 'long' && stopLoss >= entryPrice) {
    document.getElementById('reverseTP').value = '做多止损价需 < 入场价';
    return;
  }
  if (direction === 'short' && stopLoss <= entryPrice) {
    document.getElementById('reverseTP').value = '做空止损价需 > 入场价';
    return;
  }

  // 优先使用加权止损距离（分批模式下）
  var stopDistance;
  if (calc && calc.splitMode && calc.weightedStopDistance != null) {
    stopDistance = calc.weightedStopDistance;
  } else {
    stopDistance = Math.abs(entryPrice - stopLoss);
  }
  var targetPrice;

  if (direction === 'long') {
    targetPrice = entryPrice + stopDistance * desiredRR;
  } else {
    targetPrice = entryPrice - stopDistance * desiredRR;
  }

  document.getElementById('reverseTP').value = targetPrice.toFixed(2);
}

/**
 * 读取入场价、目标价、方向，根据期望盈亏比反推止损价
 */
function calcReverseSL() {
  if (window._lastCalcDirty) { alert('计算器参数已变更，请先点击「计算仓位」更新结果。'); return; }
  var calc = window._lastCalc;
  var entryPrice, direction;

  if (calc && calc.entryPrice) {
    entryPrice = calc.entryPrice;
    direction = calc.direction;
  } else {
    entryPrice = parseFloat(document.getElementById('entryPrice').value);
    direction = document.getElementById('direction').value;
  }

  var targetPrice = parseFloat(document.getElementById('reverseTP').value);
  var desiredRR = parseFloat(document.getElementById('desiredRR').value);

  if (isNaN(desiredRR) || desiredRR <= 0) {
    document.getElementById('reverseSL').value = '请输入有效的期望盈亏比';
    return;
  }

  if (isNaN(entryPrice) || entryPrice <= 0) {
    document.getElementById('reverseSL').value = '请先填写入场价';
    return;
  }

  if (isNaN(targetPrice) || targetPrice <= 0) {
    document.getElementById('reverseSL').value = '请先反推目标价或手动输入';
    return;
  }

  // 根据目标价与期望盈亏比反推止损距离
  var targetDistance = Math.abs(targetPrice - entryPrice);
  if (targetDistance <= 0) {
    document.getElementById('reverseSL').value = direction === 'long' ? '目标价需 > 入场价' : '目标价需 < 入场价';
    return;
  }
  // 优先使用加权止损距离（分批模式下）
  var stopDistance;
  if (calc && calc.splitMode && calc.weightedStopDistance != null) {
    stopDistance = calc.weightedStopDistance;
  } else {
    stopDistance = targetDistance / desiredRR;
  }

  var stopLoss;
  if (direction === 'long') {
    stopLoss = entryPrice - stopDistance;
  } else {
    stopLoss = entryPrice + stopDistance;
  }

  // 止损价方向正确性校验
  if ((direction === 'long' && stopLoss >= entryPrice) ||
      (direction === 'short' && stopLoss <= entryPrice)) {
    document.getElementById('reverseSL').value = '期望盈亏比过大，止损价越过入场价，请降低 RR';
    return;
  }

  document.getElementById('reverseSL').value = stopLoss.toFixed(2);
}

// ==================== 多止盈位 ====================

/**
 * 自动计算多止盈位价格
 * 根据止损距离和默认盈亏比自动填充 TP1/TP2/TP3 价格
 * 如果用户已手动编辑过某个 TP 价格，则跳过该价位
 */
function autoCalcMultiTP() {
  if (window._lastCalcDirty) { alert('计算器参数已变更，请先点击「计算仓位」更新结果。'); return; }
  var calc = window._lastCalc;
  var entryPrice, stopLoss, direction, stopDistance;

  if (calc && calc.entryPrice && calc.stopLoss) {
    entryPrice = calc.entryPrice;
    stopLoss = calc.stopLoss;
    direction = calc.direction;
    // 优先使用加权止损距离（分批模式下），否则使用全局 stopDistance
    stopDistance = calc.splitMode && calc.weightedStopDistance != null ? calc.weightedStopDistance : calc.stopDistance;
  } else {
    entryPrice = parseFloat(document.getElementById('entryPrice').value);
    stopLoss = parseFloat(document.getElementById('stopLoss').value);
    direction = document.getElementById('direction').value;
    stopDistance = !isNaN(entryPrice) && !isNaN(stopLoss) && entryPrice > 0 && stopLoss > 0
      ? Math.abs(entryPrice - stopLoss) : 0;
  }

  if (isNaN(entryPrice) || entryPrice <= 0 || stopDistance <= 0) {
    return;
  }

  var tpRRs = [1.5, 2.0, 3.0];
  var tpIds = ['tp1Price', 'tp2Price', 'tp3Price'];

  for (var i = 0; i < 3; i++) {
    var rr = tpRRs[i];
    var profitDistance = stopDistance * rr;
    var tpPrice;

    if (direction === 'long') {
      tpPrice = entryPrice + profitDistance;
    } else {
      tpPrice = entryPrice - profitDistance;
    }

    var el = document.getElementById(tpIds[i]);
    if (el) {
      // 仅当用户未手动编辑过时才自动填充
      if (!el._userEdited) {
        el.value = tpPrice.toFixed(2);
      }
    }
  }

  updateMultiTP();
}

/**
 * 更新多止盈位各段的盈亏比显示
 */
function updateMultiTP() {
  var calc = window._lastCalc;
  var entryPrice, stopLoss, direction, stopDistance;

  if (calc && calc.entryPrice && calc.stopLoss) {
    entryPrice = calc.entryPrice;
    stopLoss = calc.stopLoss;
    direction = calc.direction;
    // 优先使用加权止损距离（分批模式下），否则使用全局 stopDistance
    stopDistance = calc.splitMode && calc.weightedStopDistance != null ? calc.weightedStopDistance : calc.stopDistance;
  } else {
    entryPrice = parseFloat(document.getElementById('entryPrice').value);
    stopLoss = parseFloat(document.getElementById('stopLoss').value);
    direction = document.getElementById('direction').value;
    stopDistance = !isNaN(entryPrice) && !isNaN(stopLoss) && entryPrice > 0 && stopLoss > 0
      ? Math.abs(entryPrice - stopLoss) : 0;
  }

  // 更新三档剩余仓位百分比
  var tp1RatioEl = document.getElementById('tp1Ratio');
  var tp2RatioEl = document.getElementById('tp2Ratio');
  var tp3RatioEl = document.getElementById('tp3Ratio');
  var tp1Ratio = tp1RatioEl ? parseFloat(tp1RatioEl.value) || 0 : 0;
  var tp2Ratio = tp2RatioEl ? parseFloat(tp2RatioEl.value) || 0 : 0;
  var tp3Ratio = tp3RatioEl ? parseFloat(tp3RatioEl.value) || 0 : 0;
  var totalRatio = tp1Ratio + tp2Ratio + tp3Ratio;
  var remain = Math.max(0, 100 - totalRatio);
  var remainEl = document.getElementById('tpRemain');
  if (remainEl) {
    remainEl.textContent = remain;
    remainEl.style.color = totalRatio > 100 ? 'var(--color-danger)' : (totalRatio === 100 ? 'var(--color-success)' : 'var(--color-text-muted)');
  }

  if (stopDistance <= 0) {
    document.getElementById('tp1RR').textContent = '—';
    document.getElementById('tp2RR').textContent = '—';
    document.getElementById('tp3RR').textContent = '—';
    return;
  }

  // 逐个计算盈亏比
  var tp1PriceEl = document.getElementById('tp1Price');
  var tp2PriceEl = document.getElementById('tp2Price');
  var tp3PriceEl = document.getElementById('tp3Price');
  var tpPrices = [
    tp1PriceEl ? parseFloat(tp1PriceEl.value) : NaN,
    tp2PriceEl ? parseFloat(tp2PriceEl.value) : NaN,
    tp3PriceEl ? parseFloat(tp3PriceEl.value) : NaN
  ];
  var tpRRs = ['tp1RR', 'tp2RR', 'tp3RR'];

  for (var i = 0; i < 3; i++) {
    var tp = tpPrices[i];
    var rrEl = document.getElementById(tpRRs[i]);
    if (isNaN(tp) || tp <= 0) {
      rrEl.textContent = '—';
      rrEl.className = 'tp-rr';
      continue;
    }

    var profitDistance;
    if (direction === 'long') {
      profitDistance = tp - entryPrice;
    } else {
      profitDistance = entryPrice - tp;
    }

    if (profitDistance <= 0) {
      rrEl.textContent = '逆势';
      rrEl.className = 'tp-rr negative';
    } else {
      var rr = profitDistance / stopDistance;
      rrEl.textContent = rr.toFixed(1) + 'R';
      rrEl.className = 'tp-rr' + (rr < 1.5 ? ' negative' : '');
    }
  }
}

/**
 * 初始化多止盈位事件监听
 */
function initMultiTPListeners() {
  var tpInputs = ['tp1Price', 'tp2Price', 'tp3Price', 'tp1Ratio', 'tp2Ratio', 'tp3Ratio'];
  for (var i = 0; i < tpInputs.length; i++) {
    var el = document.getElementById(tpInputs[i]);
    if (el && !el._tpListenerAttached) {
      el.addEventListener('input', updateMultiTP);
      // 用户手动输入 TP 价格后标记为已编辑，阻止 autoCalcMultiTP 覆盖
      if (tpInputs[i].indexOf('Price') !== -1) {
        el.addEventListener('input', function() { this._userEdited = true; }, true);
        // 当方向或止损价变化时重置所有 TP 标记，允许重新自动计算
        (function resetOnBaseChange() {
          var directionEl = document.getElementById('direction');
          var stopLossEl = document.getElementById('stopLoss');
          function resetAllTPFlags() {
            ['tp1Price','tp2Price','tp3Price'].forEach(function(id) {
              var e = document.getElementById(id);
              if (e) e._userEdited = false;
            });
          }
          if (!resetOnBaseChange._bound) {
            directionEl.addEventListener('change', resetAllTPFlags);
            stopLossEl.addEventListener('change', resetAllTPFlags);
            resetOnBaseChange._bound = true;
          }
        })();
      }
      el._tpListenerAttached = true;
    }
  }
}

// ==================== 检查清单 ====================

/**
 * 更新开仓前检查清单（读取 _lastCalc）
 */
function updateChecklist() {
  if (window._lastCalcDirty) { alert('计算器参数已变更，请先点击「计算仓位」更新结果。'); return; }
  var calc = window._lastCalc;

  // 1. 单笔风险 ≤ 账户风险比例（设置值）
  updateCheckItem('checkRiskPct', function() {
    if (!calc || calc.riskPercent == null) return null;
    var plSettings;
    try { plSettings = typeof loadSettings === 'function' ? loadSettings() : { riskPercent: 2 }; } catch(e) { plSettings = { riskPercent: 2 }; }
    return calc.riskPercent * 100 <= (plSettings.riskPercent || 2);
  });

  // 2. 止损距离合理（ETH ≤2%，其他 ≤3%）
  updateCheckItem('checkStopDist', function() {
    if (!calc || calc.stopPct == null) return null;
    var symbol = (calc.symbol || '').toUpperCase();
    var maxPct = symbol.includes('ETH') ? 2 : 3;
    return calc.stopPct <= maxPct;
  });

  // 3. 止损在强平价格之上（安全）
  updateCheckItem('checkLiqSafe', function() {
    if (!calc) return null;
    if (calc.leverage <= 0) return true; // 现货无需检查
    if (calc.cappedByLiquidation == null) return null;
    return !calc.cappedByLiquidation;
  });

  // 4. 连亏未触发熔断（＜3 笔）
  updateCheckItem('checkLossStreak', function() {
    if (!calc || calc.lossStreak == null) return null;
    return calc.lossStreak < 3;
  });

  // 5. 盈亏比 ≥ 2:1（职业交易最低标准）
  updateCheckItem('checkRR', function() {
    if (!calc || calc.targetRR == null) return null;
    return calc.targetRR >= 2.0;
  });

  // 6. 保证金占本金 ≤ 50%（避免单笔过度暴露）
  updateCheckItem('checkMargin', function() {
    if (!calc || calc.actualMargin == null || calc.capital == null || calc.capital <= 0) return null;
    return calc.actualMargin / calc.capital <= 0.5;
  });

  // 7. 入场理由已明确选择
  updateCheckItem('checkReason', function() {
    if (!calc) return null;
    if (calc.reason == null) return null;
    return calc.reason !== '' && calc.reason !== '— 不选择 —';
  });

  // P1 修复：当 _lastCalc 为 null 时所有检查项均为 null，显示提示
  var hintEl = document.getElementById('checklistHint');
  if (!calc) {
    if (!hintEl) {
      var container = document.getElementById('checklistCard');
      if (container) {
        hintEl = document.createElement('div');
        hintEl.id = 'checklistHint';
        hintEl.textContent = '请先在计算器页面点击「计算仓位」后再查看检查清单';
        hintEl.style.cssText = 'color: var(--color-text-muted); font-size: var(--font-sm); padding: 8px 12px;';
        container.appendChild(hintEl);
      }
    } else {
      hintEl.style.display = '';
    }
  } else if (hintEl) {
    hintEl.style.display = 'none';
  }
}

function updateCheckItem(itemId, checkFn) {
  var item = document.getElementById(itemId);
  if (!item) return;
  var icon = item.querySelector('.check-icon');
  var result = checkFn();

  if (result === null) {
    icon.textContent = '○';
    icon.className = 'check-icon pending';
    item.classList.remove('fail-row');
  } else if (result) {
    icon.textContent = '✓';
    icon.className = 'check-icon pass';
    item.classList.remove('fail-row');
  } else {
    icon.textContent = '✗';
    icon.className = 'check-icon fail';
    item.classList.add('fail-row');
  }
}

// 杠杆输入框默认值：从设置中读取 defaultLeverage
(function _initDefaultLeverage() {
  try {
    var _levSettings = typeof loadSettings === 'function' ? loadSettings() : null;
    var _levEl = document.getElementById('leverage');
    if (_levEl && _levSettings && _levSettings.defaultLeverage != null) {
      _levEl.value = _levSettings.defaultLeverage;
    }
  } catch(e) {}
})();
