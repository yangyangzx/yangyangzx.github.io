// ==================== 盈亏比反推 ====================

/**
 * 读取当前入场价、止损价、方向，根据期望盈亏比反推目标价
 */
function calcReverseTP() {
  if (window._lastCalcDirty) { alert('计算器参数已变更，请先点击「计算仓位」更新结果。'); return; }
  var calc = window._lastCalc;
  var entryPrice, stopLoss, direction;

  if (calc && calc.entryPrice && calc.stopLoss) {
    entryPrice = calc.effectiveEntryPrice || calc.entryPrice;
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

  document.getElementById('reverseTP').value = targetPrice.toFixed(5);
}

/**
 * 读取入场价、目标价、方向，根据期望盈亏比反推止损价
 */
function calcReverseSL() {
  if (window._lastCalcDirty) { alert('计算器参数已变更，请先点击「计算仓位」更新结果。'); return; }
  var calc = window._lastCalc;
  var entryPrice, direction;

  if (calc && calc.entryPrice) {
    entryPrice = calc.effectiveEntryPrice || calc.entryPrice;
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

  document.getElementById('reverseSL').value = stopLoss.toFixed(5);
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
    // 使用 effectiveEntryPrice（含滑点修正），与计算器保持一致
    entryPrice = calc.effectiveEntryPrice || calc.entryPrice;
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

  // 使用设置中的默认盈亏比
  var settings = typeof loadSettings === 'function' ? loadSettings() : {};
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
        el.value = tpPrice.toFixed(5);
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
    // 使用 effectiveEntryPrice（含滑点修正），与计算器保持一致
    entryPrice = calc.effectiveEntryPrice || calc.entryPrice;
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
      // 计算净盈亏比（扣除手续费），与计算器保持一致
      var grossProfit = profitDistance * (calc.positionSize || 0) / (calc.effectiveEntryPrice || entryPrice);
      var grossLoss = stopDistance * (calc.positionSize || 0) / (calc.effectiveEntryPrice || entryPrice);
      var fee = calc.fee || 0;
      var netProfit = grossProfit - fee;
      var netLoss = grossLoss + fee;
      var rr = netLoss > 0 ? netProfit / netLoss : grossProfit / grossLoss;
      rrEl.textContent = rr.toFixed(2) + 'R';
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
 * 读取设置中的当日亏损状态（用于新增的检查项）
 */
function getTodayLossStatus() {
  try {
    var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
    var totalTodayLoss = 0;
    // 统计今日所有已平仓的亏损
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].closeType && logs[i].pnlAmount != null) {
        var closeDate = window.utils.toLocalDateStr(logs[i].closeTime || logs[i].time);
        if (closeDate === todayStr && logs[i].pnlAmount < 0) {
          totalTodayLoss += logs[i].pnlAmount;
        }
      }
    }
    return { todayLoss: totalTodayLoss, todayCount: 0 };
  } catch(e) {
    return { todayLoss: 0, todayCount: 0 };
  }
}

/**
 * 更新开仓前检查清单（读取 _lastCalc）
 * 增强版：新增日亏损上限检查、心态评分检查，支持可配止损阈值，检查结果持久化至日志
 */
function updateChecklist() {
  if (window._lastCalcDirty) { alert('计算器参数已变更，请先点击「计算仓位」更新结果。'); return; }
  var calc = window._lastCalc;

  // 获取设置（包含可配的止损比例和日亏损上限等）
  var settings = typeof loadSettings === 'function' ? loadSettings() : {};

  // ========== 辅助函数：带结果的更新 ==========
  // 返回对象：{ result: boolean|undefined, message?: string }
  function updateCheckItemWithResult(itemId, checkFn) {
    var item = document.getElementById(itemId);
    if (!item) return null;
    var icon = item.querySelector('.check-icon');
    var resultObj = checkFn();

    if (resultObj === null || resultObj.result === undefined) {
      icon.textContent = '○';
      icon.className = 'check-icon pending';
      item.classList.remove('fail-row');
      return null;
    } else if (resultObj.result) {
      icon.textContent = '✓';
      icon.className = 'check-icon pass';
      item.classList.remove('fail-row');
      if (resultObj.message) item.title = resultObj.message;
    } else {
      icon.textContent = '✗';
      icon.className = 'check-icon fail';
      item.classList.add('fail-row');
      if (resultObj.message) item.title = resultObj.message;
    }
    return resultObj.result;
  }

  // 1. 单笔风险 ≤ 账户风险比例（设置值）
  updateCheckItemWithResult('checkRiskPct', function() {
    if (!calc || calc.riskPercent == null) return null;
    var plRisk = (calc.riskPercent * 100).toFixed(1);
    var settingVal = settings.riskPercent || 2;
    return { result: plRisk <= settingVal, message: '风险 ' + plRisk + '% ≤ 设置 ' + settingVal + '%' };
  });

  // 2. 止损距离合理（可配阈值，原 ETH ≤2%/其他 ≤3% 改为从设置读取）
  updateCheckItemWithResult('checkStopDist', function() {
    if (!calc || calc.stopPct == null) return null;
    // 从设置读取品种特异性止损比例，若未设置则回退到原规则
    var customLimits = settings.customStopLimit || {}; // { "BTC": 3, "ETH": 2, ... }
    var symbol = (calc.symbol || '').toUpperCase();
    var maxPct;
    if (customLimits && customLimits[symbol] != null) {
      maxPct = customLimits[symbol];
    } else if (symbol === 'ETH') {
      maxPct = 2;
    } else {
      maxPct = 3;
    }
    var passed = calc.stopPct <= maxPct;
    return { result: passed, message: '止损 ' + calc.stopPct.toFixed(2) + '% ≤ 上限 ' + maxPct + '%' };
  });

  // 3. 止损在强平价格之上（安全）
  updateCheckItemWithResult('checkLiqSafe', function() {
    if (!calc) return null;
    if (calc.leverage <= 0) return { result: true, message: '现货模式无需强平检查' };
    if (calc.cappedByLiquidation == null) return null;
    return { result: !calc.cappedByLiquidation, message: calc.cappedByLiquidation ? '止损穿越强平价！' : '止损在强平之上，安全' };
  });

  // 4. 连亏未触发熔断（＜3 笔）
  updateCheckItemWithResult('checkLossStreak', function() {
    if (!calc || calc.lossStreak == null) return null;
    var passed = calc.lossStreak < 3;
    return { result: passed, message: '连亏 ' + calc.lossStreak + ' 笔 (<3) ' + (passed ? '正常' : '已熔断') };
  });

  // 5. 盈亏比达标（使用设置中的最低盈亏比，优先读取，否则默认 2）
  updateCheckItemWithResult('checkRR', function() {
    if (!calc || calc.targetRR == null) return null;
    var minRR = (settings.minRRRatio != null && settings.minRRRatio > 0) ? settings.minRRRatio : 2;
    var passed = calc.targetRR >= minRR;
    return { result: passed, message: '盈亏比 ' + calc.targetRR.toFixed(2) + ':1 ' + (passed ? '达标' : '偏低') };
  });

  // 6. 保证金占本金 ≤ 50%（避免单笔过度暴露）
  updateCheckItemWithResult('checkMargin', function() {
    if (!calc || calc.actualMargin == null || calc.capital == null || calc.capital <= 0) return null;
    var ratio = calc.actualMargin / calc.capital;
    var passed = ratio <= 0.5;
    return { result: passed, message: '保证金占比 ' + (ratio*100).toFixed(1) + '% ≤ 50%' };
  });

  // 7. 入场理由已明确选择
  updateCheckItemWithResult('checkReason', function() {
    if (!calc) return null;
    if (calc.reason == null) return null;
    var passed = calc.reason !== '' && calc.reason !== '— 不选择 —';
    return { result: passed, message: '入场理由已明确' };
  });

  // 【增强8】当日未超日亏损上限（新增检查项，基于设置中的 dailyLossLimit）
  updateCheckItemWithResult('checkDailyLoss', function() {
    // 没有设置或本金无法确定时跳过检查
    if (!settings.dailyLossLimit || !calc || calc.capital == null || calc.capital <= 0) {
      return null; // 不适用
    }
    var dailyLossPct = settings.dailyLossLimit;
    var dailyLossLimit = calc.capital * (dailyLossPct / 100);
    var todayStatus = getTodayLossStatus();
    var todayLoss = Math.abs(todayStatus.todayLoss); // 今日总亏损额（绝对值）
    var passed = todayLoss < dailyLossLimit;
    return { result: passed, message: '今日亏损 ' + todayLoss.toFixed(2) + ' / 上限 ' + dailyLossLimit.toFixed(2) + ' (' + (todayLoss/dailyLossLimit*100).toFixed(0) + '%)' };
  });

  // 【增强9】心态评分检查（新增检查项，评分<3时警告）
  updateCheckItemWithResult('checkMindset', function() {
    if (!calc) return null;
    var mindsetScore = calc.mindsetScore || 3;
    var minScore = settings.mindsetMinScore != null ? settings.mindsetMinScore : 3;
    var passed = mindsetScore >= minScore;
    return { result: passed, message: '心态评分 ' + mindsetScore + '/5 ' + (passed ? '(平静/良好)' : '(低于最低要求 ' + minScore + ')') };
  });

  // Skills 融合：组合热量检查
  updateCheckItemWithResult('checkPortfolioHeat', function() {
    if (!calc || !calc.capital || calc.capital <= 0) return null;
    var heatCheck = calcPortfolioHeat();
    if (!heatCheck || heatCheck.heat === undefined) return null;
    var maxHeat = settings.riskHeatMax || 6;
    var passed = heatCheck.heat <= maxHeat;
    return { result: passed, message: '组合热量 ' + heatCheck.heat.toFixed(1) + '% ≤ 上限 ' + maxHeat + '%' };
  });

  // Skills 融合：品种集中度检查
  updateCheckItemWithResult('checkSymbolConc', function() {
    if (!calc || !calc.capital || calc.capital <= 0 || !calc.positionSize) return null;
    var openPositions = getOpenPositions();
    var concCheck = checkSymbolConcentration(calc.symbol, calc.positionSize, calc.leverage, calc.capital, openPositions);
    if (!concCheck || concCheck.maxPct === undefined) return null;
    var passed = concCheck.pass;
    return { result: passed, message: concCheck.warning || (passed ? '品种集中度正常' : '集中度超限') };
  });

  // ========== P1 修复：当 _lastCalc 为 null 时所有检查项均为 null，显示提示 ==========
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

  // ========== 将检查结果持久化到 _lastCalc，供日志保存时使用 ==========
  if (calc) {
    // 收集所有检查的结果（用于写入日志）
    var checklistResults = {};
    var checkItems = ['checkRiskPct','checkStopDist','checkLiqSafe','checkLossStreak','checkRR','checkMargin','checkReason','checkDailyLoss','checkMindset','checkPortfolioHeat','checkSymbolConc'];
    for (var i = 0; i < checkItems.length; i++) {
      var id = checkItems[i];
      var el = document.getElementById(id);
      if (el) {
        var icon = el.querySelector('.check-icon');
        if (icon) {
          var className = icon.className;
          if (className && className.indexOf('pass') !== -1) checklistResults[id] = 'pass';
          else if (className && className.indexOf('fail') !== -1) checklistResults[id] = 'fail';
          else checklistResults[id] = 'pending';
        }
      }
    }
    // 将检查结果合并到 _lastCalc 中（持久化字段）
    if (typeof calc.checklistResults === 'undefined') {
      calc.checklistResults = {};
    }
    for (var k in checklistResults) calc.checklistResults[k] = checklistResults[k];
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

// ===== 方向切换 → 订单类型 label 联动 =====
function updateOrderTypeLabels() {
  var dir = document.getElementById('direction');
  var ot = document.getElementById('orderType');
  if (!dir || !ot) return;

  var isLong = dir.value === 'long';
  // 保留当前选中值
  var curVal = ot.value;
  var options = ot.options;

  if (isLong) {
    // 做多：市价单 / Buy Limit / Buy Stop
    options[0].text = '市价单';
    options[1].text = '限价单 (Buy Limit)';
    options[2].text = '止损单 (Buy Stop)';
  } else {
    // 做空：市价单 / Sell Limit / Sell Stop
    options[0].text = '市价单';
    options[1].text = '限价单 (Sell Limit)';
    options[2].text = '止损单 (Sell Stop)';
  }
}

(function _initOrderTypeLabels() {
  try {
    var _dirEl = document.getElementById('direction');
    if (_dirEl) {
      _dirEl.addEventListener('change', updateOrderTypeLabels);
      // 初始同步
      updateOrderTypeLabels();
    }
  } catch(e) {}
})();