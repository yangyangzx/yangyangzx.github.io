// ==================== 盈亏比反推 ====================
//
// 口径统一说明（2026-09-23 RR 审计）：
// 本模块所有盈亏比一律用「含费净 RR」，定义为
//     rr = ((tpDist/ep) − 往返费率×(1 + exit/ep)) / ((stopDist/ep) + 止损腿往返费)
// 与盈亏比卡片、多止盈各行、checkRR / checkTPWeighted 门完全同源。
// 费用按「腿的成交价」直接由 feeRate 计算，绝不再从 calc.fee 反推——calc.fee 在
// 无目标价时是止损腿费、有目标价时是目标腿费（calculator.js:788 / :816），据此反推
// 会让多止盈 RR 随无关的 #targetPrice 漂移。
// 滑点不在此建模（主卡把滑点折入成交价，此处只处理费用）；实测滑点影响约费用的 1/4，
// 与费用项同量级以下，属可接受的近似（实测反推 RR=2 时主卡显示 2.00:1，内部值 1.9994）。
// 门比较一律走 rrMeetsMin()（skills-integration.js）：按卡片 toFixed(2) 的显示精度取整
// 后再比阈值，否则反推解的浮点残差会让「显示 2.00:1」与「判 ✗」并存。

/**
 * 取多止盈/反推共用的单位口径（每 1U 名义本金）。
 * @returns {{ep:number, sd:number, stopLoss:number, unitStop:number,
 *            feeRateFrac:number, unitLoss:number, legFee:Function}|null}
 */
function getTPUnits() {
  var calc = getCalc();
  if (!calc || !calc.entryPrice) return null;
  var ep = calc.effectiveEntryPrice || calc.entryPrice;
  var stopLoss = calc.stopLoss;
  var sd = calc.stopDistance != null ? calc.stopDistance
    : (!isNaN(stopLoss) ? Math.abs(stopLoss - ep) : 0);
  if (!(ep > 0) || !(sd > 0)) return null;
  var feeRateFrac = (calc.feeRate != null ? parseFloat(calc.feeRate) : 0) / 100;
  if (isNaN(feeRateFrac) || feeRateFrac < 0) feeRateFrac = 0;
  var legFee = function(exitPrice) {
    return feeRateFrac * (1 + (exitPrice > 0 ? exitPrice / ep : 1));
  };
  return {
    ep: ep,
    sd: sd,
    stopLoss: stopLoss,
    unitStop: sd / ep,
    feeRateFrac: feeRateFrac,
    unitLoss: sd / ep + legFee(stopLoss),
    legFee: legFee
  };
}

/**
 * 解出使净 RR 恰为 rr 的止盈价。
 * rr = ((d/ep) − f×(1 + exit/ep)) / unitLoss；费用项虽依赖 exit，但整体是 d 的
 * 线性方程，有闭式解（long：exit=ep+d → 分母 (1−f)；short：exit=ep−d → (1+f)）：
 *     d = ep × (rr×unitLoss + 2f) / (1 ± f)
 * @returns {number|null} 止盈价；无解（费率吃掉全部空间）返回 null
 */
function solveTPForRR(u, rr, direction) {
  if (!u || !(rr > 0)) return null;
  var ep = u.ep, f = u.feeRateFrac;
  var denomFactor = direction === 'long' ? (1 - f) : (1 + f);
  if (!(denomFactor > 0)) return null;
  var d = ep * (rr * u.unitLoss + 2 * f) / denomFactor;
  if (!(d > 0)) return null;
  var tp = direction === 'long' ? (ep + d) : (ep - d);
  return (tp > 0 && isFinite(tp)) ? tp : null;
}

/**
 * 已知止盈价，解出使净 RR 恰为 rr 的止损价。
 * 分子 num = tpDist/ep − f×(1+tp/ep)（净单位毛利）必须先为正，否则目标价连手续费
 * 都覆盖不了。分母 = unitStop + 止损腿费，同为 sd 的线性方程：
 *     sd = ep × (num/rr − 2f) / (1 ± f)
 * @returns {number|null} 止损价；无解返回 null
 */
function solveSLForRR(u, rr, tp, direction) {
  if (!u || !(rr > 0) || !(tp > 0)) return null;
  var ep = u.ep, f = u.feeRateFrac;
  var tpDist = Math.abs(tp - ep);
  var num = tpDist / ep - f * (1 + tp / ep);
  if (!(num > 0)) return null;
  var denom = num / rr;
  var denomFactor = direction === 'long' ? (1 - f) : (1 + f);
  if (!(denomFactor > 0) || !(denom > 2 * f)) return null;
  var sd = ep * (denom - 2 * f) / denomFactor;
  if (!(sd > 0)) return null;
  var stopLoss = direction === 'long' ? (ep - sd) : (ep + sd);
  return (stopLoss > 0 && isFinite(stopLoss)) ? stopLoss : null;
}

/**
 * 读取当前入场价、止损价、方向，根据期望盈亏比反推目标价
 * 反推值回填后，盈亏比卡片应显示 requested RR（含费口径）。
 */
function calcReverseTP() {
  if (getCalcDirty()) { showToast('计算器参数已变更，请先点击「计算仓位」更新结果', 'warn'); return; }
  var calc = getCalc();
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

  // 含费净 RR 口径（优先）：反推值回填后盈亏比卡片即显示 requested RR。
  // 原实现按 stopDistance × desiredRR 直接乘，是纯毛利距离，回填后实际 RR 恒低于
  // 请求值——实测请求 2R 得 1.7770R（达成率 88.9%），ATR 1% 止损时仅 79.2%；
  // 于是「按 2 倍止损距离放的目标价」会被 2R 门判为不达标，自相矛盾。
  var u = getTPUnits();
  var targetPrice = u ? solveTPForRR(u, desiredRR, direction) : null;

  if (!targetPrice) {
    // 无 _lastCalc 时退化为纯毛利反推（无费率口径可用）
    var stopDistance = Math.abs(entryPrice - stopLoss);
    targetPrice = direction === 'long'
      ? entryPrice + stopDistance * desiredRR
      : entryPrice - stopDistance * desiredRR;
  }

  document.getElementById('reverseTP').value = targetPrice.toFixed(5);
}

/**
 * 读取入场价、目标价、方向，根据期望盈亏比反推止损价
 */
function calcReverseSL() {
  if (getCalcDirty()) { showToast('计算器参数已变更，请先点击「计算仓位」更新结果', 'warn'); return; }
  var calc = getCalc();
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

  // 方向校验：目标价必须与方向一致（做多需高于入场价，做空需低于入场价）
  if (direction === 'long' && targetPrice <= entryPrice) {
    document.getElementById('reverseSL').value = '做多目标价需 > 入场价';
    return;
  }
  if (direction === 'short' && targetPrice >= entryPrice) {
    document.getElementById('reverseSL').value = '做空目标价需 < 入场价';
    return;
  }

  // 根据目标价与期望盈亏比反推止损距离
  // calcReverseSL 的目的是"给定目标价和期望RR，反推止损价"
  // 不应受 calc.stopDistance（ATR 或分批结果）影响，否则失去反推意义
  // 含费净 RR 口径，与 calcReverseTP / 盈亏比卡片同源
  var u = getTPUnits();
  var stopLoss = u ? solveSLForRR(u, desiredRR, targetPrice, direction) : null;

  if (stopLoss == null) {
    if (u && !isNaN(targetPrice)) {
      var num = Math.abs(targetPrice - entryPrice) / u.ep
        - u.feeRateFrac * (1 + targetPrice / u.ep);
      if (num <= 0) {
        document.getElementById('reverseSL').value = '目标价太近，覆盖手续费后无正收益，无法反推';
        return;
      }
    }
    // 无 _lastCalc 时退化为纯毛利反推
    var targetDistance = Math.abs(targetPrice - entryPrice);
    var stopDistance = targetDistance / desiredRR;
    stopLoss = direction === 'long' ? entryPrice - stopDistance : entryPrice + stopDistance;
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
 * 按 settings.tpRRs 的「含费净 RR」解出每档 TP 价格（不是 stopDistance × rr 的纯毛利
 * 距离），使 updateMultiTP 显示的 RR 与设定的 tpRR 一致。
 * 如果用户已手动编辑过某个 TP 价格，则跳过该价位
 */
function autoCalcMultiTP() {
  if (getCalcDirty()) { showToast('计算器参数已变更，请先点击「计算仓位」更新结果', 'warn'); return; }
  var calc = getCalc();
  var entryPrice, stopLoss, direction, stopDistance;

  if (calc && calc.entryPrice && calc.stopLoss) {
    // 使用 effectiveEntryPrice（含滑点修正），与计算器保持一致
    entryPrice = calc.effectiveEntryPrice || calc.entryPrice;
    stopLoss = calc.stopLoss;
    direction = calc.direction;
    // 优先使用 calc.stopDistance（含 ATR 模式和分批加权模式）
    stopDistance = calc.stopDistance != null ? calc.stopDistance : 0;
  } else {
    entryPrice = parseFloat(document.getElementById('entryPrice').value);
    stopLoss = parseFloat(document.getElementById('stopLoss').value);
    direction = document.getElementById('direction').value;
    stopDistance = !isNaN(entryPrice) && !isNaN(stopLoss) && entryPrice > 0 && stopLoss > 0
      ? Math.abs(entryPrice - stopLoss) : 0;
  }

  if (isNaN(entryPrice) || entryPrice <= 0 || stopDistance <= 0) {
    showToast('无法计算止盈位：请先点击「计算仓位」确保有有效的止损距离', 'warn');
    return;
  }

  // P2-7 FIX：真正读取设置中的多止盈盈亏比（settings.tpRRs），不再硬编码
  var settings = typeof loadSettings === 'function' ? loadSettings() : {};
  var tpRRs = (settings && Array.isArray(settings.tpRRs) && settings.tpRRs.length >= 3)
    ? settings.tpRRs.map(function(v) { return parseFloat(v) > 0 ? parseFloat(v) : 1.5; })
    : [1.5, 2.0, 3.0];
  var tpIds = ['tp1Price', 'tp2Price', 'tp3Price'];

  // 含费净 RR 口径：每档 TP 按「净 RR 恰等于该档 tpRR」求解，使下面 updateMultiTP
  // 显示的 RR 与 settings.tpRRs 一致。原实现按 stopDistance × rr 直接乘，是纯毛利
  // 距离，显示出来的净 RR 恒低于设定的 tpRR（实测 tpRR=1.5 => 显示 1.32R）。
  var u = getTPUnits();

  for (var i = 0; i < 3; i++) {
    var rr = tpRRs[i];
    var tpPrice = u ? solveTPForRR(u, rr, direction) : null;

    if (tpPrice == null) {
      // 无 _lastCalc 时退化为纯毛利反推
      var profitDistance = stopDistance * rr;
      tpPrice = direction === 'long'
        ? entryPrice + profitDistance
        : entryPrice - profitDistance;
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
 * 计算多止盈组合的加权期望盈亏比（含费净 RR，每 1U 名义本金口径）
 * - 每档：单位净盈 = (TP距/入场) − 该档成交价的往返费；逆势档为负毛利，自然拉低期望
 * - 剩余仓位（100−Σ比例）按止损路径计（保守口径，鼓励规划满 100%）
 * - 往返费按腿的成交价由 feeRate 直接算（各腿各付各的），不依赖 calc.fee，
 *   因此本函数返回值不受无关的 #targetPrice 影响
 * - 返回 { rr, remain, sumRatio, unitLoss, overLimit }；未规划返回 null
 */
function computeWeightedTPRR() {
  var calc = getCalc();
  if (!calc || !calc.entryPrice) return null;
  var entryPrice = calc.effectiveEntryPrice || calc.entryPrice;
  var stopLoss = calc.stopLoss;
  var direction = calc.direction;
  var stopDistance = calc.stopDistance != null ? calc.stopDistance
    : (!isNaN(entryPrice) && !isNaN(stopLoss) ? Math.abs(entryPrice - stopLoss) : 0);
  if (!(entryPrice > 0) || !(stopDistance > 0)) return null;
  var ep = entryPrice;

  // 单位往返费用（每 1U 仓位）：按腿的成交价直接由费率算出。
  // 修复（2026-09-23 RR 审计）：原实现从 calc.fee / calc.positionSize 反推，
  // 而 calc.fee 在无目标价时是止损腿费、有目标价时是目标腿费，导致本函数返回值
  // 随无关的 #targetPrice 漂移（实测未改任何止盈输入，加权 RR 与各行 RR 均位移）。
  var feeRateFrac = (calc.feeRate != null ? parseFloat(calc.feeRate) : 0) / 100;
  if (isNaN(feeRateFrac) || feeRateFrac < 0) feeRateFrac = 0;
  var legFee = function(exitPrice) {
    return feeRateFrac * (1 + (exitPrice > 0 ? exitPrice / ep : 1));
  };
  var unitLoss = stopDistance / ep + legFee(stopLoss);   // 止损路径付止损腿费
  if (!(unitLoss > 0)) return null;

  var ids = ['tp1', 'tp2', 'tp3'];
  var prices = [], ratios = [];
  var anyFilled = false;
  for (var i = 0; i < 3; i++) {
    var pEl = document.getElementById(ids[i] + 'Price');
    var rEl = document.getElementById(ids[i] + 'Ratio');
    var p = pEl ? parseFloat(pEl.value) : NaN;
    var r = rEl ? (parseFloat(rEl.value) || 0) : 0;
    prices.push((!isNaN(p) && p > 0) ? p : null);
    ratios.push(r);
    if (prices[i] !== null) anyFilled = true;
  }
  if (!anyFilled) return null; // 三档均未规划

  var sumRatio = ratios[0] + ratios[1] + ratios[2];
  var remain = Math.max(0, 100 - sumRatio);
  var eNet = 0;
  for (var j = 0; j < 3; j++) {
    if (prices[j] === null) continue;
    var dist = direction === 'long' ? (prices[j] - ep) : (ep - prices[j]);
    var unitGross = dist / ep;
    eNet += (ratios[j] / 100) * (unitGross - legFee(prices[j]));
  }
  // 剩余仓位按止损路径计
  eNet -= (remain / 100) * unitLoss;

  return { rr: eNet / unitLoss, remain: remain, sumRatio: sumRatio, unitLoss: unitLoss, overLimit: sumRatio > 100 };
}

/**
 * 更新多止盈位各段的盈亏比显示
 */
function updateMultiTP() {
  var calc = getCalc();
  var entryPrice, stopLoss, direction, stopDistance;

  if (calc && calc.entryPrice && calc.stopLoss) {
    // 使用 effectiveEntryPrice（含滑点修正），与计算器保持一致
    entryPrice = calc.effectiveEntryPrice || calc.entryPrice;
    stopLoss = calc.stopLoss;
    direction = calc.direction;
    // 优先使用 calc.stopDistance（含 ATR 模式和分批加权模式）
    stopDistance = calc.stopDistance != null ? calc.stopDistance : 0;
  } else {
    entryPrice = parseFloat(document.getElementById('entryPrice').value);
    stopLoss = parseFloat(document.getElementById('stopLoss').value);
    direction = document.getElementById('direction').value;
    // 方向校验：止损价必须与方向相反，否则 stopDistance = 0
    if (direction === 'long' && (!isNaN(stopLoss) && stopLoss >= entryPrice)) {
      stopDistance = 0;
    } else if (direction === 'short' && (!isNaN(stopLoss) && stopLoss <= entryPrice)) {
      stopDistance = 0;
    } else {
      stopDistance = !isNaN(entryPrice) && !isNaN(stopLoss) && entryPrice > 0 && stopLoss > 0
        ? Math.abs(entryPrice - stopLoss) : 0;
    }
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
      // BUG-10 修复：使用 stopDistance 反推原始仓位（而非可能被截断的 positionSize）
      // grossLoss = stopDistance * positionSize / effectiveEntryPrice = riskAmount
      // 所以 positionSize = riskAmount * effectiveEntryPrice / stopDistance
      // 守卫（2026-09-23）：无 _lastCalc 但表单止损距离有效时 calc 为 null，原实现
      // 直接读 calc.effectiveEntryPrice 会抛 TypeError。
      var ep = (calc && calc.effectiveEntryPrice) || entryPrice;
      var riskAmt = (calc && calc.riskAmount) || 0;
      var origPosSize = (stopDistance > 0 && ep > 0)
        ? (riskAmt * ep / stopDistance)
        : ((calc && calc.positionSize) || 0);
      // 费用口径 FIX（2026-09-23 RR 审计）：
      // 1) 按腿的成交价由费率直接算，不再从 calc.fee 反推——calc.fee 在无目标价时是
      //    止损腿费、有目标价时是目标腿费，导致未改任何止盈输入、仅改 #targetPrice
      //    就让本行 RR 位移（实测 1.32R → 1.31R）。
      // 2) 各腿各付各的往返费：毛利侧扣止盈腿费，亏损侧付止损腿费，
      //    与 computeWeightedTPRR 的 unitLoss 定义一致。
      var f = (calc && calc.feeRate != null) ? parseFloat(calc.feeRate) / 100 : 0;
      if (isNaN(f) || f < 0) f = 0;
      var feeTP = f * (1 + (tp > 0 ? tp / ep : 1));
      var feeStop = f * (1 + (stopLoss > 0 ? stopLoss / ep : 1));
      var netProfit = (profitDistance / ep - feeTP) * origPosSize;
      var netLoss = (stopDistance / ep + feeStop) * origPosSize;
      var rr = netLoss > 0 ? netProfit / netLoss : 0;
      rrEl.textContent = rr.toFixed(2) + 'R';
      rrEl.className = 'tp-rr' + (rr < 1.5 ? ' negative' : '');
    }
  }

  // 多止盈组合加权期望 R（含费；剩余仓位按止损计）
  var w = computeWeightedTPRR();
  var wEl = document.getElementById('tpWeightedRR');
  if (wEl) {
    if (!w) {
      wEl.textContent = '—';
      wEl.className = 'tp-rr';
    } else if (w.overLimit) {
      wEl.textContent = '比例超限 ' + w.sumRatio + '%';
      wEl.className = 'tp-rr negative';
    } else {
      wEl.textContent = '加权期望 ' + w.rr.toFixed(2) + 'R';
      wEl.className = 'tp-rr' + (w.rr < 1.5 ? ' negative' : '');
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

// 12 项并不是 12 个平权的闸门。上游 renderHardBlock 会 setCalc(null)，此后所有检查项都返回
// null（skipped）——所以任何「由硬阻断覆盖」的条件在清单里永远不可能显示 ✗，它们只是状态行。
// STATUS_CHECK_ITEMS 是唯一的归类来源：结论行分母、保存闸门、结果采集都用它做排除，
// 三者必须共用同一张名单，否则会出现结论行说「2 项未通过」、toast 说「1 项未通过」的计数差 1。
// HTML 里对应 data-status 属性，新增检查项时必须两边同步。
// 注意：STATUS 项里的 checkTPWeighted 是提示性指标（默认 50/30/20+1.5/2/3R 配置下加权期望
// 天然低于单档 2R 门槛，每笔新计划都会红一条），因此它永不阻断保存。
var STATUS_CHECK_ITEMS = ['checkLossStreak', 'checkDailyLoss', 'checkSymbolConc', 'checkTPWeighted'];

/**
 * 是否参与结论行计数与保存闸门。STATUS 项要么被上游硬阻断覆盖（永不 fail），
 * 要么是提示性指标，任何情况下都不该进闸门。
 */
function isStatusCheckItem(itemId) {
  for (var i = 0; i < STATUS_CHECK_ITEMS.length; i++) {
    if (STATUS_CHECK_ITEMS[i] === itemId) return true;
  }
  return false;
}

/**
 * 硬阻断时刷清单：所有项置 skipped，结论行显示阻断原因。
 * 上一轮的 PASS/FAIL 必须清掉——否则卡片上残留着另一笔合法计划的「10 项 PASS」，
 * 而真正的阻断原因（如止损越过强平价）在清单里完全没痕迹。
 */
function renderChecklistBlocked(blocker) {
  var card = document.getElementById('checklistCard');
  var items = card ? card.querySelectorAll('.check-item') : [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var icon = item.querySelector('.check-icon');
    var note = item.querySelector('.check-note');
    if (icon) { icon.textContent = '—'; icon.className = 'check-icon skipped'; }
    item.classList.remove('fail-row');
    item.classList.remove('warn-row');
    item.classList.remove('pass-row');
    item.classList.add('skipped-row');
    if (note) note.textContent = '';
    item.removeAttribute('title');
  }
  var summary = document.getElementById('checklistSummary');
  if (summary) {
    summary.dataset.state = 'fail';
    var ci = document.getElementById('csIcon');
    var tx = document.getElementById('csText');
    var ct = document.getElementById('csCount');
    if (ci) ci.textContent = '⛔';
    if (tx) tx.textContent = '已阻断：' + (blocker.title || '风控未通过');
    if (ct) ct.textContent = '';
    summary.title = blocker.detail || '';
  }
  var toggle = document.getElementById('checklistToggle');
  if (toggle) {
    toggle.textContent = isChecklistExpanded() ? '收起明细' : ('展开明细（' + items.length + ' 项）');
    toggle.setAttribute('aria-expanded', String(isChecklistExpanded()));
  }
}

/**
 * 更新开仓前检查清单（读取 _lastCalc）
 * 增强版：新增日亏损上限检查、心态评分检查，支持可配止损阈值，检查结果持久化至日志
 */
function updateChecklist() {
  // P0-10: 检查清单逐条入场动效
  var cc = document.getElementById('checklistCard');
  if (cc) {
    cc.classList.remove('checklist-anim');
    void cc.offsetWidth;
    cc.classList.add('checklist-anim');
  }

  // 硬阻断态：renderHardBlock 早退使尾部的本函数不执行，除非在这里渲染阻断态，
  // 卡片上就会完整保留上一轮合法计划的「10 项 PASS」——用户看到的清单描述的是另一笔
  // 计划，真正的阻断原因在清单里毫无痕迹。
  var blocker = getCalcBlocker();
  if (blocker) {
    renderChecklistBlocked(blocker);
    return;
  }

  // 结论行先同步再判 dirty：参数已变更但用户没重算时，上一轮结果仍是卡片上
  // 实际显示的事实，早退不该让结论行停在更旧的状态
  var calc = getCalc();
  updateChecklistSummary(calc);
  if (getCalcDirty()) { showToast('计算器参数已变更，请先点击「计算仓位」更新结果', 'warn'); return; }
  // P0-10: 检查清单逐条入场动效
  var cc = document.getElementById('checklistCard');
  if (cc) {
    cc.classList.remove('checklist-anim');
    void cc.offsetWidth;
    cc.classList.add('checklist-anim');
  }
  // 结论行先同步再判 dirty：参数已变更但用户没重算时，上一轮结果仍是卡片上
  // 实际显示的事实，早退不该让结论行停在更旧的状态
  var calc = getCalc();
  updateChecklistSummary(calc);
  if (getCalcDirty()) { showToast('计算器参数已变更，请先点击「计算仓位」更新结果', 'warn'); return; }

  // 获取设置（包含可配的止损比例和日亏损上限等）
  var settings = typeof loadSettings === 'function' ? loadSettings() : {};

  // ========== 辅助函数：带结果的更新 ==========
  // 返回对象：{ result: boolean|undefined, message?: string, level?: 'fail'|'warn' }
  // 四态：
  //   fail-row   → 阻断保存，内联显示原因
  //   warn-row   → 不阻断但必须可见（仓位被截断、心态降仓、加权 RR 偏低）
  //   pass-row   → 折叠时隐藏，原因留在 title
  //   skipped-row→ 折叠时隐藏
  function updateCheckItemWithResult(itemId, checkFn) {
    var item = document.getElementById(itemId);
    if (!item) return null;
    var icon = item.querySelector('.check-icon');
    var note = item.querySelector('.check-note');
    var resultObj = checkFn();

    item.classList.remove('fail-row');
    item.classList.remove('warn-row');
    item.classList.remove('pass-row');
    item.classList.remove('skipped-row');

    if (resultObj === null || resultObj.result === undefined) {
      icon.textContent = '—';
      icon.className = 'check-icon skipped';
      item.classList.add('skipped-row');
      if (note) note.textContent = '';
      item.removeAttribute('title');
      return null;
    } else if (resultObj.result) {
      icon.textContent = '✓';
      icon.className = 'check-icon pass';
      item.classList.add('pass-row');
      // 通过项的原因留在 title 悬浮里即可——内联铺开 12 行会让闸门又变回长清单
      if (note) note.textContent = '';
      if (resultObj.message) item.title = resultObj.message; else item.removeAttribute('title');
    } else if (resultObj.level === 'warn') {
      // 不阻断但必须看见。原先这些情况只能靠红色 FAIL 表达，导致默认配置下每笔计划都
      // 挂着「2 项未通过」，而 gate 又把它们排除在外——结论行和 toast 各说一个数。
      icon.textContent = '⚠';
      icon.className = 'check-icon warn';
      item.classList.add('warn-row');
      if (note) note.textContent = resultObj.message || '';
      if (resultObj.message) item.title = resultObj.message; else item.removeAttribute('title');
    } else {
      icon.textContent = '✗';
      icon.className = 'check-icon fail';
      item.classList.add('fail-row');
      // 失败原因必须内联：原先只写 item.title，触屏完全看不到，桌面端也没人逐行 hover
      if (note) note.textContent = resultObj.message || '';
      if (resultObj.message) item.title = resultObj.message; else item.removeAttribute('title');
    }
    return resultObj.result;
  }

  // 1. 实际风险是否等于计划风险
  // 原先比的是「计算后比例 ≤ 表单值」——plRisk 取自截断后的 calc.riskPercent，allowed 取自
  // 同一个 riskInput，两边同源且前者已被后者约束，恒为真（杠杆 1x 实测计划 2% 实际 0.5% 仍 PASS）。
  // 真正该报的是仓位截断：计划 2% 实际只落到 0.5%。
  updateCheckItemWithResult('checkRiskPct', function() {
    if (!calc || calc.riskPercent == null) return null;
    var plPct = calc.plannedRiskPercent != null ? calc.plannedRiskPercent * 100 : calc.riskPercent * 100;
    var actPct = calc.riskPercent * 100;
    var gap = plPct - actPct;
    if (gap > 1e-9) {
      return {
        result: false,
        level: 'warn',
        message: '计划风险 ' + plPct.toFixed(2) + '% → 实际 ' + actPct.toFixed(2)
          + '%（仓位被保证金/聚合/集中度/心态调整截断 '
          + Math.round(plPct > 0 ? gap / plPct * 100 : 0) + '%）'
      };
    }
    return { result: true, message: '实际风险 ' + actPct.toFixed(2) + '% = 计划 ' + plPct.toFixed(2) + '%' };
  });

  // 2. 止损距离合理（边界统一走 getStopLimitPct()，原先此处把 ETH 2%/其余 3% 又抄了一份）
  updateCheckItemWithResult('checkStopDist', function() {
    if (!calc || calc.stopPct == null) return null;
    var maxPct = getStopLimitPct(calc.symbol);
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
    var passed = rrMeetsMin(calc.targetRR, minRR);   // 容差对齐卡片 toFixed(2) 显示
    return { result: passed, message: '盈亏比 ' + calc.targetRR.toFixed(2) + ':1 ' + (passed ? '达标' : '偏低') };
  });

  // 6. 保证金占本金 ≤ 80%
  // 80% 是 calculator.js 的**截断**边界而非阻断，截断后 actualMargin 恰好等于 80% 本金，
  // 所以 `ratio <= 0.8` 恒为真。改为报告「是否被截断过」，标志需从 calc 读取
  // （原先 cappedByMargin 没有暴露到 calc 对象，清单想报也拿不到）。
  updateCheckItemWithResult('checkMargin', function() {
    if (!calc || calc.actualMargin == null || calc.capital == null || calc.capital <= 0) return null;
    var ratio = calc.actualMargin / calc.capital;
    if (calc.cappedByMargin) {
      return {
        result: false,
        level: 'warn',
        message: '保证金占比 ' + (ratio * 100).toFixed(1) + '%，仓位已被保证金 80%/聚合 90%/交易所上限/集中度上限截断'
      };
    }
    return { result: true, message: '保证金占比 ' + (ratio * 100).toFixed(1) + '% ≤ 80%' };
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
    if (!settings.dailyLossLimit || !calc) {
      return null; // 不适用
    }
    // 优先使用 getAccountCapital()，兜底到 calc.capital
    var capital = (typeof getAccountCapital === 'function') ? getAccountCapital() : null;
    if (!capital || capital <= 0) capital = (calc.capital != null && calc.capital > 0) ? calc.capital : null;
    if (!capital) return null;
    // 统一使用硬阻断同一函数 checkDailyLossLimit()；函数不存在时跳过（返回 null），不再使用旧口径兜底
    var dailyCheck = (typeof checkDailyLossLimit === 'function') ? checkDailyLossLimit() : null;
    if (!dailyCheck) return null;
    return { result: !dailyCheck.blocked, message: '今日净盈亏 ' + dailyCheck.todayPnl.toFixed(2) + ' / 上限 ' + dailyCheck.limit.toFixed(2) + ' (' + dailyCheck.pctOfLimit.toFixed(0) + '%)' };
  });

  // 【增强9】心态评分检查
  // 判定统一走 getMindsetAdjustment()，与仓位管线共用同一套语义：1 分禁止开仓、
  // 2 分降仓 50%、其余低于最低分降仓 80%。原先用 `score >= minScore` 判，把计算层已经
  // 接受并降仓的 2 分又拦了一遍——卡片显示「建议降仓至 50%」，点保存却被拒。
  updateCheckItemWithResult('checkMindset', function() {
    if (!calc) return null;
    var adj = getMindsetAdjustment(calc.mindsetScore);
    var minScore = settings.mindsetMinScore != null ? settings.mindsetMinScore : 3;
    if (adj.blocked) {
      return { result: false, message: '心态评分 ' + calc.mindsetScore + '/5 — 禁止开仓（最低要求 ' + minScore + '）' };
    }
    if (adj.adjustment < 1) {
      return {
        result: false,
        level: 'warn',
        message: '心态评分 ' + calc.mindsetScore + '/5 — 已自动降仓至 ' + Math.round(adj.adjustment * 100) + '% 仓位'
      };
    }
    return { result: true, message: '心态评分 ' + calc.mindsetScore + '/5（平静/良好）' };
  });

  // Skills 融合：组合热量检查
  // 必须含本仓，且与 calculator.js 的硬阻断同口径（同一 calcPortfolioHeat 调用方式）。
  // 阈值比较用 < 而不是 <=：硬阻断是 `heat >= maxHeat`，清单用 <= 会在恰好等于上限时
  // 一边放行一边阻断。
  updateCheckItemWithResult('checkPortfolioHeat', function() {
    if (!calc || !calc.capital || calc.capital <= 0) return null;
    var heatCheck = calcPortfolioHeat(calc.riskAmount, calc.symbol, calc.capital);
    if (!heatCheck || heatCheck.heat === undefined) return null;
    var maxHeat = settings.riskHeatMax || 6;
    var passed = heatCheck.heat < maxHeat;
    return {
      result: passed,
      message: '组合总风险 ' + heatCheck.heat.toFixed(1)
        + '%（已持仓 ' + (heatCheck.existingHeat != null ? heatCheck.existingHeat.toFixed(1) : '0.0')
        + '% + 本仓 ' + (heatCheck.planPct != null ? heatCheck.planPct.toFixed(1) : '0.0')
        + '%）/ 上限 ' + maxHeat + '%'
    };
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

  // 【增强12】多止盈加权期望（提示性指标，永不阻断保存）
  // 默认 50/30/20 + 1.5/2/3R 配置下加权期望天然低于单档 2R 门槛，所以它显示为「注意」
  // 而不是红色 FAIL——原先两边都用 FAIL 表达，但 gate 又把它排除在外，
  // 结论行「2 项未通过」和 toast「1 项未通过」各说一个数。
  updateCheckItemWithResult('checkTPWeighted', function() {
    if (!calc) return null;
    if (typeof computeWeightedTPRR !== 'function') return null;
    var w = computeWeightedTPRR();
    if (!w || w.rr == null) return null; // 未规划多止盈 → 跳过
    var minRR = (settings.minRRRatio != null && settings.minRRRatio > 0) ? settings.minRRRatio : 2;
    if (w.overLimit) {
      return { result: false, level: 'warn', message: 'TP 减仓比例合计 ' + w.sumRatio + '% 超过 100%，请调整' };
    }
    var passed = rrMeetsMin(w.rr, minRR);   // 容差对齐卡片 toFixed(2) 显示
    if (passed) {
      return { result: true, message: '多止盈加权期望 ' + w.rr.toFixed(2) + 'R ≥ ' + minRR + '（剩余仓位 ' + w.remain + '% 按止损计）' };
    }
    return {
      result: false,
      level: 'warn',
      message: '多止盈加权期望 ' + w.rr.toFixed(2) + 'R < ' + minRR + '（剩余仓位 ' + w.remain + '% 按止损计）'
    };
  });

  // ========== 结论行 + 折叠态 ==========
  // 原先 _lastCalc 为 null 时是往卡片末尾 append 一段提示文字（checklistHint），
  // 现在提示并入卡片顶部的结论行，状态切换不再增删 DOM 节点。
  updateChecklistSummary(calc);

  // ========== 将检查结果持久化到 _lastCalc，供日志保存时使用 ==========
  if (calc) {
    // 收集所有检查的结果（用于写入日志复盘）。状态项也一并记录供复盘对照，
    // 但保存闸门只认非 status 项（见 isStatusCheckItem）。
    var checklistResults = {};
    var checkItems = ['checkRiskPct','checkStopDist','checkLiqSafe','checkLossStreak','checkRR','checkMargin','checkReason','checkDailyLoss','checkMindset','checkPortfolioHeat','checkSymbolConc','checkTPWeighted'];
    for (var i = 0; i < checkItems.length; i++) {
      var id = checkItems[i];
      var el = document.getElementById(id);
      if (el) {
        var icon = el.querySelector('.check-icon');
        if (icon) {
          var className = icon.className;
          if (className && className.indexOf('pass') !== -1) checklistResults[id] = 'pass';
          else if (className && className.indexOf('fail') !== -1) checklistResults[id] = 'fail';
          else if (className && className.indexOf('warn') !== -1) checklistResults[id] = 'warn';
          else checklistResults[id] = 'skipped';
        }
      }
    }
    // 完整覆写 checklistResults，清除历史残留的旧 ID
    calc.checklistResults = checklistResults;
  }
}

/**
 * 汇总检查清单成一行结论，并同步折叠开关文案。
 * 闸门要回答的是「能不能保存」，不是 12 行等权状态：STATUS 项（被上游硬阻断覆盖，
 * 永不 fail）不进分母，结论行与保存闸门因此给出同一个数。
 * @param {Object|null} calc  传入 null 表示尚未计算过（显示引导文案）
 */
function updateChecklistSummary(calc) {
  var card = document.getElementById('checklistCard');
  var summary = document.getElementById('checklistSummary');
  if (!summary) return;
  var icon = document.getElementById('csIcon');
  var text = document.getElementById('csText');
  var count = document.getElementById('csCount');
  var items = card ? card.querySelectorAll('.check-item') : [];
  var fails = 0, warns = 0, passes = 0, skipped = 0;
  var total = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (isStatusCheckItem(it.id)) continue;
    var ic = it.querySelector('.check-icon');
    if (!ic) continue;
    total++;
    var c = ic.className || '';
    if (c.indexOf('fail') !== -1) fails++;
    else if (c.indexOf('warn') !== -1) warns++;
    else if (c.indexOf('pass') !== -1) passes++;
    else skipped++;
  }
  // 注意项不阻断，故按「未失败」计入通过比
  var ok = passes + warns;
  if (!calc) {
    summary.dataset.state = 'idle';
    icon.textContent = '—';
    text.textContent = '点击「计算仓位」后生成检查结果';
    count.textContent = '';
  } else if (fails > 0) {
    summary.dataset.state = 'fail';
    icon.textContent = '✗';
    text.textContent = fails + ' 项未通过，不能保存';
    count.textContent = ok + '/' + total + ' 通过'
      + (warns ? ' · ' + warns + ' 注意' : '')
      + (skipped ? ' · ' + skipped + ' 待补充' : '');
  } else if (warns > 0) {
    summary.dataset.state = 'warn';
    icon.textContent = '⚠';
    text.textContent = '可以保存，' + warns + ' 项需注意';
    count.textContent = ok + '/' + total + ' 通过' + (skipped ? ' · ' + skipped + ' 待补充' : '');
  } else if (skipped > 0) {
    summary.dataset.state = 'warn';
    icon.textContent = '◐';
    text.textContent = '无阻断项，' + skipped + ' 项待补充';
    count.textContent = ok + '/' + total + ' 通过';
  } else {
    summary.dataset.state = 'pass';
    icon.textContent = '✓';
    text.textContent = '全部通过，可以保存';
    count.textContent = ok + '/' + total + ' 通过';
  }
  // 折叠时只藏通过/注意/待补充项，失败项始终可见——开关文案只数被藏起来的部分
  var toggle = document.getElementById('checklistToggle');
  if (toggle) {
    var hidden = total - fails;
    toggle.textContent = isChecklistExpanded() ? '收起明细' : ('展开明细（' + hidden + ' 项）');
    toggle.setAttribute('aria-expanded', String(isChecklistExpanded()));
  }
}

function isChecklistExpanded() {
  var card = document.getElementById('checklistCard');
  return !!card && !card.classList.contains('gates-collapsed');
}

/**
 * 折叠/展开明细。失败项两种状态都可见（闸门必须能看见挡路的那几项）。
 */
function toggleChecklistDetail() {
  var card = document.getElementById('checklistCard');
  if (!card) return;
  card.classList.toggle('gates-collapsed');
  // 参数已变更时仍是上一次的结果，比显示「尚未计算」更接近事实
  updateChecklistSummary(getCalc());
}

/**
 * 保存被风控拒绝时调用：展开明细、滚到第一个失败项、闪一下把 toast 指路过来。
 * 原先只弹 toast，用户得自己翻 4000px 去找是哪一项没过。
 */
function focusChecklistFailures() {
  var card = document.getElementById('checklistCard');
  if (!card) return;
  // 闸门可能被复盘视图的「拆分保存」触发；开仓计划视图不可见时不要抢滚动
  if (card.offsetParent === null) {
    card.classList.remove('gates-collapsed');
    updateChecklistSummary(getCalc());
    return;
  }
  card.classList.remove('gates-collapsed');
  var fails = card.querySelectorAll('.check-item.fail-row');
  if (!fails.length) fails = [document.getElementById('checklistSummary')].filter(Boolean);
  if (!fails.length) return;
  fails[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  for (var i = 0; i < fails.length; i++) {
    fails[i].classList.remove('gate-flash');
    void fails[i].offsetWidth; // 强制 reflow，重启动画（连续点两次保存也要闪）
    fails[i].classList.add('gate-flash');
  }
  (function() {
    setTimeout(function() {
      for (var j = 0; j < fails.length; j++) fails[j].classList.remove('gate-flash');
    }, 1000);
  })();
  updateChecklistSummary(getCalc());
}

/**
 * 动态刷新检查清单标签文字，使其与当前设置一致
 * 通过 data-default 属性保留静态 fallback 文本
 */
function refreshChecklistLabels() {
  var settings = loadSettings();
  // checkRiskPct 不再是「≤ 账户风险比例」的重复表述（那是 :353 硬阻断的事），
  // 现在比较的是计划风险 vs 实际风险，与设置项无关，故不在此处动态改写标签。
  var rules = [
    { id: 'checkRR',           key: 'minRRRatio',         format: function(v) { return '盈亏比 ≥ ' + v + ':1'; } },
    { id: 'checkMindset',      key: 'mindsetMinScore',    format: function(v) { return '心态评分达标（≥ ' + v + '，2 分减半仓）'; } },
    { id: 'checkPortfolioHeat', key: 'riskHeatMax',       format: function(v) { return '组合总风险含本仓（≤ ' + v + '%）'; } }
  ];
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    var el = document.getElementById(r.id);
    if (!el) continue;
    // 必须按类选择：行末是 .check-note（失败原因槽），用 span:last-child 会把
    // 动态标签写进原因槽，标签消失、原因槽显示规则文字——静默错行。
    var span = el.querySelector('.check-label');
    if (!span) continue;
    var rawVal = settings[r.key];
    if (rawVal != null && rawVal !== '') {
      span.textContent = r.format(rawVal);
    } else {
      // 恢复 data-default 原始文本
      var def = span.getAttribute('data-default');
      if (def) span.textContent = def;
    }
  }
  // 同步 ATR 开关状态到检查清单底部说明
  var atrNote = document.getElementById('checklistAtrNote');
  if (!atrNote) return; // checklistCard 已被移除时跳过，避免静默失败
  try {
    var formAtrEnabled = document.getElementById('formAtrStopEnabled');
    var atrOn = (formAtrEnabled && formAtrEnabled.checked) || settings.atrStopEnabled === true;
    var atrMult = parseFloat(document.getElementById('atrMultiplier').value) || settings.atrDefaultMultiplier || 2;
    atrNote.textContent = '当前生效规则：' +
      (atrOn ? 'ATR 动态止损 ×' + atrMult.toFixed(1) + ' · ' : '') +
      '盈亏比 ≥ ' + (settings.minRRRatio || 2) + ':1 · ' +
      '心态评分 ≥ ' + (settings.mindsetMinScore || 3) + '（2 分自动降仓 50%）' +
      ' · 组合总风险含本仓 ≤ ' + (settings.riskHeatMax || 6) + '%';
    atrNote.style.display = 'block';
  } catch(e) { console.error('[planner] refreshChecklistLabels atrNote error:', e); }
}

// 杠杆输入框默认值：从设置中读取 defaultLeverage
(function _initDefaultLeverage() {
  try {
    var _levSettings = typeof loadSettings === 'function' ? loadSettings() : null;
    var _levEl = document.getElementById('leverage');
    if (_levEl && _levSettings && _levSettings.defaultLeverage != null) {
      _levEl.value = _levSettings.defaultLeverage;
    }
  } catch(e) { console.error('[planner]', e); }
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
  } catch(e) { console.error('[planner]', e); }
})();