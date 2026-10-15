// ==================== 平仓盈亏计算 ====================
const _closePriceEdited = {};

function getPlanningSlippage(item) {
  return item && item.slippage && item.slippage.planning ? item.slippage.planning : null;
}

function isTickSlippageRecord(item) {
  var s = getPlanningSlippage(item);
  return !!(s && s.schema === 'ticks-v1');
}

function getLegacySlippageCost(item, overrideValue) {
  // 新模型的滑点已经通过 effectiveEntryPrice/实际平仓价计入 PnL，不能二次扣减。
  if (isTickSlippageRecord(item)) return 0;
  if (overrideValue !== undefined && overrideValue !== null && overrideValue !== '') {
    return parseFloat(overrideValue) || 0;
  }
  return parseFloat(item && item.slippageCost) || 0;
}

function getEntryFillForPnL(item) {
  var s = getPlanningSlippage(item);
  if (s && Number.isFinite(Number(s.effectiveEntryPrice))) return Number(s.effectiveEntryPrice);
  return Number(item.effectiveEntryPrice != null ? item.effectiveEntryPrice : item.entryPrice);
}

// 平仓预览与确认保存共享唯一结算口径，避免界面显示和落库数据分叉。
function calculateCloseSettlement(item, closePrice, feeOverride, legacySlippageOverride) {
  var entryPrice = getEntryFillForPnL(item);
  var positionSize = Number(item && item.positionSize);
  var exitPrice = Number(closePrice);
  if (!item || !Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(positionSize) || positionSize <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) return null;
  if (item.direction !== 'long' && item.direction !== 'short') return null;
  var grossPnl = item.direction === 'long'
    ? (exitPrice - entryPrice) * positionSize / entryPrice
    : (entryPrice - exitPrice) * positionSize / entryPrice;
  var fee = feeOverride !== undefined && feeOverride !== null && feeOverride !== ''
    ? Number(feeOverride)
    : Number(item.fee) || 0;
  if (!Number.isFinite(fee) || fee < 0) return null;
  var legacySlippageCost = getLegacySlippageCost(item, legacySlippageOverride);
  // BUG#3 修复：检测数据不一致（同时存在 ticks-v1 滑点模型和旧式 slippageCost）
  // 若两者共存说明 schema 迁移不完整，跳过 legacy 滑点扣减避免双重计费
  var tickModel = isTickSlippageRecord(item);
  if (tickModel && legacySlippageCost > 0) {
    console.warn('[calculateCloseSettlement] 检测到 ticks-v1 滑点模型与旧式 slippageCost 共存，忽略旧式滑点:', item.slippageCost);
    legacySlippageCost = 0;
  }
  var netPnl = grossPnl - fee - legacySlippageCost;
  var leverage = Number(item.leverage);
  if (!Number.isFinite(leverage) || leverage <= 0) leverage = 1;
  var margin = positionSize / leverage;
  var riskAmount = Number(item.riskAmount);
  return {
    entryPrice: entryPrice,
    closePrice: exitPrice,
    grossPnl: grossPnl,
    fee: fee,
    legacySlippageCost: legacySlippageCost,
    netPnl: netPnl,
    pnlPercent: margin > 0 ? (netPnl / margin * 100) : 0,
    rMultiple: Number.isFinite(riskAmount) && riskAmount > 0 ? netPnl / riskAmount : null
  };
}

function calcClosePnL(idx) {
  const item = logs[idx];
  if (!item) return;
  // 本函数有多条早退路径（无类型/价格非法/计算失败），先把调整提示关掉，
  // 只在下方真正判出矛盾时才显示，避免残留上一轮的提示。
  var _mRow = document.getElementById('cpTypeMismatch_' + idx);
  if (_mRow) _mRow.style.display = 'none';
  const closeType = document.getElementById('cpCloseType_' + idx);
  const closePriceEl = document.getElementById('cpClosePrice_' + idx);
  const pnlAmtEl = document.getElementById('cpPnlAmount_' + idx);
  const pnlPctEl = document.getElementById('cpPnlPercent_' + idx);
  const rMultipleEl = document.getElementById('cpRMultiple_' + idx);
  // Auto-fill stopLoss when closeType is initialSL, targetPrice when initialTP
  if (closeType && !_closePriceEdited[idx]) {
    if (closeType.value === 'initialSL' && item.stopLoss != null && item.stopLoss !== '') {
      closePriceEl.value = item.stopLoss;
      closePriceEl.select();
    } else if (closeType.value === 'initialTP' && item.targetPrice != null && item.targetPrice !== '') {
      closePriceEl.value = item.targetPrice;
    }
  }

  // P1: 同步类型/价格到模块级缓存（供重渲染后 restoreAfterRender 恢复）
  if (typeof _closePanelType !== 'undefined') {
    _closePanelType = closeType ? (closeType.value || '') : '';
    _closePanelPrice = closePriceEl ? (closePriceEl.value || '') : '';
  }

  if (!closeType || !closeType.value || !closePriceEl) {
    if (pnlAmtEl) pnlAmtEl.value = '';
    if (pnlPctEl) pnlPctEl.value = '';
    if (rMultipleEl) rMultipleEl.value = '';
    return;
  }
  const closePrice = parseFloat(closePriceEl.value);
  if (isNaN(closePrice) || closePrice <= 0) {
    if (pnlAmtEl) pnlAmtEl.value = '';
    if (pnlPctEl) pnlPctEl.value = '';
    if (rMultipleEl) rMultipleEl.value = '';
    return;
  }
  const entryPrice = getEntryFillForPnL(item);
  const positionSize = parseFloat(item.positionSize);
  if (isNaN(entryPrice) || entryPrice <= 0 || isNaN(positionSize) || positionSize <= 0) return;
  if (item.direction !== 'long' && item.direction !== 'short') {
    if (pnlAmtEl) pnlAmtEl.value = '';
    if (pnlPctEl) pnlPctEl.value = '';
    if (rMultipleEl) rMultipleEl.value = '';
    return;
  }
  const feeEl = document.getElementById('cpFee_' + idx);
  const slipEl = document.getElementById('cpSlippage_' + idx);
  const settlement = calculateCloseSettlement(item, closePrice, feeEl ? feeEl.value : undefined, slipEl ? slipEl.value : undefined);
  if (!settlement) {
    if (pnlAmtEl) pnlAmtEl.value = '';
    if (pnlPctEl) pnlPctEl.value = '';
    if (rMultipleEl) rMultipleEl.value = '';
    return;
  }
  // P1-3/P0-1 FIX：部分平仓预览按本次比例折算已实现净盈亏（与 confirmClose 落库口径一致：
  // 未平仓部分的浮动盈亏不计入，费用按比例分摊）
  var isPartialPreview = closeType && (closeType.value === 'partialTP' || closeType.value === 'reducePosition');
  var ratioPreviewEl = document.getElementById('cpPartialRatio_' + idx);
  var ratioPreview = ratioPreviewEl ? parseFloat(ratioPreviewEl.value) : NaN;
  var netPnlPreview = settlement.netPnl;
  if (isPartialPreview && !isNaN(ratioPreview) && ratioPreview > 0 && ratioPreview < 100) {
    netPnlPreview = (settlement.grossPnl - settlement.legacySlippageCost) * (ratioPreview / 100) - settlement.fee * (ratioPreview / 100);
  }
  // 计划类平仓类型与实算盈亏方向矛盾时立即归一（唯一权威实现 utils.resolveCloseType，
  // 编辑弹窗 emRecalc 走同一函数）。不处理就让错误类型落库：渲染层徽章只按 closeType
  // 取色，列表会「绿止盈」旁边是红负数；而 closeType 是分桶键，亏损会被 analytics 归进
  // 止盈桶。这里在预览阶段就改掉，用户看到的是与金额同向的类型。
  // 只在 netPnlPreview 已算出的路径执行——上方早退路径已把提示条关掉，此处不再判。
  var _adj = window.utils.resolveCloseType(closeType.value, netPnlPreview);
  if (_adj.adjusted) {
    closeType.value = _adj.type;
    // 面板重绘靠 _closePanelType 缓存恢复选中项，必须在改动后同步，否则重绘回退到旧类型
    if (typeof _closePanelType !== 'undefined') _closePanelType = _adj.type;
    var _ratioRow2 = document.getElementById('cpPartialRatioRow_' + idx);
    if (_ratioRow2) {
      var _isPartialType = (_adj.type === 'partialTP' || _adj.type === 'reducePosition');
      _ratioRow2.style.display = _isPartialType ? 'block' : 'none';
    }
    if (_mRow) {
      _mRow.style.display = 'block';
      var _mText = document.getElementById('cpTypeMismatchText_' + idx);
      if (_mText) {
        var _CL = (typeof CLOSE_TYPE_LABELS !== 'undefined') ? CLOSE_TYPE_LABELS : {};
        _mText.textContent = 'ℹ 已按实际盈亏调整平仓类型：「' + (_CL[_adj.from] || _adj.from) + '」→「' + (_CL[_adj.type] || _adj.type) + '」（' + (netPnlPreview < 0 ? '实算为亏损' : '实算为盈利') + '；计划止盈/止损价已单独记录，不受影响）';
      }
    }
  }
  if (pnlAmtEl) pnlAmtEl.value = netPnlPreview.toFixed(2);
  if (pnlPctEl) pnlPctEl.value = settlement.pnlPercent.toFixed(2) + '%';
  const lrRow = document.getElementById('cpLossReasonRow_' + idx);
  if (lrRow) lrRow.style.display = (netPnlPreview < 0 || (closeType && (closeType.value === 'manualLoss' || closeType.value === 'liquidation'))) ? 'block' : 'none';
  if (rMultipleEl) rMultipleEl.value = settlement.rMultiple == null ? '' : settlement.rMultiple.toFixed(2);
}

// ==================== MAE/MFE 统一计算 ====================
function storeMAEMFE(item) {
  // 使用 effectiveEntryPrice（含入场滑点）作为基准，与平仓盈亏计算口径一致
  const ep = (item.effectiveEntryPrice != null && !isNaN(parseFloat(item.effectiveEntryPrice)))
    ? parseFloat(item.effectiveEntryPrice)
    : parseFloat(item.entryPrice);
  if (isNaN(ep) || ep <= 0 || !item.direction) {
    item.mae = null;
    item.mfe = null;
    return;
  }
  const lowVal = item.lowPrice;
  const highVal = item.highPrice;
  if (item.direction === 'long') {
    // P4-1 修复（符号钳制）：MAE=最大不利偏移（无跌破=0，钳≤0），MFE=最大有利偏移（无上破=0，钳≥0）
    // 消除"盈利多单 low>ep 时 mae 为正小数 → MFE/MAE 比率虚高"的符号反转（L1）。
    // 同时消除"追高亏损多单 high<ep 时 mfe 为负 → 利润捕捉负负得正误判"（L2）。
    item.mae = lowVal != null ? Math.min(0, (lowVal - ep) / ep * 100) : null;
    item.mfe = highVal != null ? Math.max(0, (highVal - ep) / ep * 100) : null;
  } else {
    // 空单对称：MAE=价格上行不利（钳≤0），MFE=价格下行有利（钳≥0），修复 S1/S2。
    item.mae = highVal != null ? Math.min(0, (ep - highVal) / ep * 100) : null;
    item.mfe = lowVal != null ? Math.max(0, (ep - lowVal) / ep * 100) : null;
  }
}

// ==================== 极值校验（L3/S3/L4/S4，warn 提示、不阻断） ====================
// 持仓期间的价格路径必然触及入场价与平仓价两个点位，故极值须满足纯几何约束（与多空无关）：
//   low ≤ min(entry, close) 且 high ≥ max(entry, close)，且 low ≤ high。
// 违反即代表把极值填反/填错（如把最高价误填进最低价框、把平仓价当整段极值）。
// 校验不阻断保存，仅 toast 提示，避免覆盖用户已填数据。
function validateExtremes(item, closePrice) {
  if (!item || !item.direction || (item.lowPrice == null && item.highPrice == null)) return;
  var ep = (item.effectiveEntryPrice != null && !isNaN(parseFloat(item.effectiveEntryPrice)))
    ? parseFloat(item.effectiveEntryPrice) : parseFloat(item.entryPrice);
  if (isNaN(ep) || ep <= 0) return;
  var lo = item.lowPrice != null ? parseFloat(item.lowPrice) : null;
  var hi = item.highPrice != null ? parseFloat(item.highPrice) : null;
  var warn = function(m) { if (typeof showToast === 'function') showToast(m, 'warn'); };
  if (lo != null && hi != null && lo > hi) {
    warn('警告：最低价高于最高价，极值可能填反，MAE/MFE 将失真');
    return;
  }
  var cp = (closePrice != null && !isNaN(closePrice) && parseFloat(closePrice) > 0) ? parseFloat(closePrice) : null;
  var pts = [ep];
  if (cp != null) pts.push(cp);
  var loOk = true, hiOk = true;
  for (var i = 0; i < pts.length; i++) {
    if (lo != null && lo > pts[i]) loOk = false;
    if (hi != null && hi < pts[i]) hiOk = false;
  }
  if (!loOk && !hiOk) warn('警告：极值未覆盖入场/平仓价，请核对最低/最高价');
  else if (!loOk) warn('警告：最低价高于入场/平仓价，请核对最低价');
  else if (!hiOk) warn('警告：最高价低于入场/平仓价，请核对最高价');
}
window.validateExtremes = validateExtremes;

// ==================== 确认平仓 ====================
function confirmClose(idx) {
  const closeType = document.getElementById('cpCloseType_' + idx);
  const closePriceEl = document.getElementById('cpClosePrice_' + idx);
  const pnlAmtEl = document.getElementById('cpPnlAmount_' + idx);
  const pnlPctEl = document.getElementById('cpPnlPercent_' + idx);
  const rMultipleEl = document.getElementById('cpRMultiple_' + idx);
  const closeNoteEl = document.getElementById('cpCloseNote_' + idx);
  if (!closeType || !closeType.value) { showToast('请选择平仓类型','warn'); return; }
  const closePrice = parseFloat(closePriceEl ? closePriceEl.value : '');
  if (isNaN(closePrice) || closePrice <= 0) { showToast('请输入有效的平仓价格','warn'); return; }
  const feeEl = document.getElementById('cpFee_' + idx);
  const slipEl = document.getElementById('cpSlippage_' + idx);
  const settlement = calculateCloseSettlement(logs[idx], closePrice, feeEl ? feeEl.value : undefined, slipEl ? slipEl.value : undefined);
  if (!settlement) { showToast('盈亏计算失败，请检查入场价、仓位、费用和滑点输入是否有效','error'); return; }
  const netPnlVal = settlement.netPnl;
  // P0-1 FIX：部分平仓判定（提前到盈亏判定之前）
  const isPartialAction = (closeType.value === 'partialTP' || closeType.value === 'reducePosition');
  const hadPartialBefore = (Array.isArray(logs[idx].closes) && parseFloat(logs[idx].closedRatio) > 0) ||
    (logs[idx].closeType === 'partialTP' || logs[idx].closeType === 'reducePosition');
  // 本次实际净盈亏：部分平仓时按本次平仓比例分摊 round-trip 费用（P1-3 FIX）
  var partialRatio2 = NaN;
  if (isPartialAction) {
    var ratioEl2 = document.getElementById('cpPartialRatio_' + idx);
    partialRatio2 = ratioEl2 ? parseFloat(ratioEl2.value) : NaN;
  }
  var partialValid = (isPartialAction && !isNaN(partialRatio2) && partialRatio2 > 0 && partialRatio2 < 100);
  // #5 FIX：选了「分批平仓/减仓」却没填合法比例（1-99）时，下方会走全平分支落库——
  // 用户「只平一部分」的意图被改写为全部退出，账面与真实操作从此对不上。
  // 这里必须拦截而不是告警后继续：能确定「用户不想全平」，却替用户做出全平决定，
  // 属于用最危险的方式猜意图。比例框默认为空且无必填标记（rendering.js 的 cpPartialRatioRow），
  // 用户完全可以不填就点确认，所以这条路径不是小概率边界。
  // 想全部退出的正确入口是初始止盈/手平赢等非分批类型（isPartialAction 为 false，不受此拦）。
  if (isPartialAction && !partialValid) {
    showToast('已选分批平仓但未填写 1-99 之间的比例，已停止保存；若确实要全部退出请改选对应平仓类型', 'warn');
    return;
  }
  // P0-1 FIX：部分平仓的"本次已实现净盈亏" = (剩余仓位毛利 − 剩余滑点) × 比例 − 剩余费用 × 比例。
  // settlement 以当前剩余仓位全量计价，未平仓部分（1−比例）的浮动盈亏不得计入已实现。
  var netPnlThis = partialValid
    ? (settlement.grossPnl - settlement.legacySlippageCost) * (partialRatio2 / 100) - settlement.fee * (partialRatio2 / 100)
    : netPnlVal;

  // 亏损单必须选择亏损原因（按"本次实际净盈亏"判定，部分平仓不再被全额费用误判为亏损）
  const isLoss = netPnlThis < 0 || (closeType && (closeType.value === 'manualLoss' || closeType.value === 'liquidation'));
  if (isLoss) {
    var lrContainer = document.getElementById('cpLossReason_' + idx);
    var checked = lrContainer ? lrContainer.querySelectorAll('input[type="checkbox"]:checked') : [];
    if (checked.length === 0) {
      showToast('亏损单请至少选择一个亏损原因', 'warn');
      if (lrContainer) { lrContainer.classList.add('loss-reason-flash'); setTimeout(function() { lrContainer.classList.remove('loss-reason-flash'); }, 1000); }
      return;
    }
  }
  // 设计优化：极值价格（MAE/MFE 原料）填写提醒——不阻断平仓，仅提示
  try {
    var _loEl = document.getElementById('cpLowPrice_' + idx);
    var _hiEl = document.getElementById('cpHighPrice_' + idx);
    if ((!logs[idx].lowPrice && (!_loEl || _loEl.value === '')) &&
        (!logs[idx].highPrice && (!_hiEl || _hiEl.value === ''))) {
      showToast('提示：未填写持仓最低/最高价，MAE/MFE 无法分析（可后续编辑补充）', 'info');
    }
  } catch(e) { /* 提醒失败不阻断 */ }
  // 主存储写入失败时必须回滚本次内存变更，避免界面状态和持久化状态分叉。
  const beforeClose = JSON.parse(JSON.stringify(logs[idx]));
  // 写入时间信息（仅新平仓时设置 closeTime，修改已平仓保留原始时间）
  const isNewClose = !logs[idx].closeType;
  // 落库兜底：calcClosePnL 在预览阶段已归一，这里再判一次以防绕过面板的调用路径
  // （程序直调 confirmClose、或预览后下拉被外部改回矛盾类型）。基准用 netPnlThis——
  // 即「本次平仓这一腿」的净盈亏，与 closeType 描述的对象一致，不用整笔累计。
  var _cfAdj = window.utils.resolveCloseType(closeType.value, netPnlThis);
  if (_cfAdj.adjusted) closeType.value = _cfAdj.type;
  logs[idx].closeType = closeType.value;
  logs[idx].closePrice = closePrice;
  if (isNewClose) {
    logs[idx].closeTime = new Date().toISOString();
  } else if (hadPartialBefore && !isPartialAction) {
    // P0-1 FIX：部分平仓中间态最终平仓时，closeTime 更新为最终平仓时间（持仓时长/按日归属正确）
    logs[idx].closeTime = new Date().toISOString();
  }
  // holdDuration 始终基于 time + closeTime 重算（含修改已有平仓记录的场景）
  if (logs[idx].time && logs[idx].closeTime) {
    var tTime = new Date(logs[idx].time).getTime();
    var tClose = new Date(logs[idx].closeTime).getTime();
    if (!isNaN(tTime) && !isNaN(tClose)) {
      var durMin2 = Math.round((tClose - tTime) / 60000);
      logs[idx].holdDuration = durMin2 >= 0 ? durMin2 : null;
    }
  }

  // ===== P0-1 FIX：整笔交易生命周期字段（closes 事件数组 + 累计已实现盈亏） =====
  if (!Array.isArray(logs[idx].closes)) logs[idx].closes = [];
  if (logs[idx].initialPositionSize == null || isNaN(parseFloat(logs[idx].initialPositionSize)) || parseFloat(logs[idx].initialPositionSize) <= 0) {
    logs[idx].initialPositionSize = parseFloat(logs[idx].positionSize) || 0;
  }
  if (logs[idx].initialRiskAmount == null || isNaN(parseFloat(logs[idx].initialRiskAmount))) {
    logs[idx].initialRiskAmount = (logs[idx].riskAmount != null) ? parseFloat(logs[idx].riskAmount) : null;
  }
  if (logs[idx].initialMargin == null || isNaN(parseFloat(logs[idx].initialMargin))) {
    logs[idx].initialMargin = (logs[idx].actualMargin != null) ? parseFloat(logs[idx].actualMargin) : null;
  }
  if (logs[idx].realizedPnl == null || isNaN(parseFloat(logs[idx].realizedPnl))) logs[idx].realizedPnl = 0;
  if (logs[idx].realizedFee == null || isNaN(parseFloat(logs[idx].realizedFee))) logs[idx].realizedFee = 0;
  if (logs[idx].closedRatio == null || isNaN(parseFloat(logs[idx].closedRatio))) logs[idx].closedRatio = 0;
  var _nowISO = new Date().toISOString();

  if (partialValid) {
    // —— 部分平仓 / 减仓：按比例缩减剩余仓位、剩余风险、剩余保证金、剩余费用 ——
    var posBefore = parseFloat(logs[idx].positionSize) || 0;
    // P0 修复（基数错位）：partialRatio2 是「占当前剩余仓位」的比例（输入框与 settlement
    // 都是按剩余仓位计价），而 closedRatio / closes[].ratio 的口径是「占开仓原始仓位」
    // ——modals.js 正是用 sum(closes[].ratio) 反推剩余仓位（fracNow = 1 - cumClosed/100）。
    // 两者混用导致第二次部分平仓时把「剩余的 50%」当成「原始的 50%」累加：
    // 原始 1000 → 第一次平 50%（closedRatio=50，剩 500）→ 第二次输入 50%（实际只平 250），
    // closedRatio 却被加成 100，被判为「已全额平仓」，而 positionSize 还剩 250。
    // 于是这 250 单位的敞口既不出现在持仓统计里，也不产生任何已实现盈亏。
    // 换算走 utils.closedRatioDelta（唯一权威实现），首次部分平仓时返回输入值，行为不变。
    var _closedDelta = window.utils.closedRatioDelta(partialRatio2, posBefore,
      parseFloat(logs[idx].initialPositionSize) || posBefore || 0);
    var feeThis = settlement.fee * (partialRatio2 / 100);
    logs[idx].partialRatio = partialRatio2;
    logs[idx].positionSize = parseFloat((posBefore * (1 - partialRatio2 / 100)).toFixed(2));
    if (logs[idx].riskAmount != null && !isNaN(parseFloat(logs[idx].riskAmount))) {
      logs[idx].riskAmount = parseFloat((parseFloat(logs[idx].riskAmount) * (1 - partialRatio2 / 100)).toFixed(2));
    }
    if (logs[idx].actualMargin != null && !isNaN(parseFloat(logs[idx].actualMargin))) {
      logs[idx].actualMargin = parseFloat((parseFloat(logs[idx].actualMargin) * (1 - partialRatio2 / 100)).toFixed(2));
    }
    if (logs[idx].fee != null && !isNaN(parseFloat(logs[idx].fee))) {
      // P1-3 FIX：剩余仓位费用按比例缩减，最终平仓时不再重复扣全额 round-trip 费
      logs[idx].fee = parseFloat((parseFloat(logs[idx].fee) * (1 - partialRatio2 / 100)).toFixed(8));
    }
    logs[idx].realizedPnl = parseFloat((parseFloat(logs[idx].realizedPnl) + netPnlThis).toFixed(2));
    logs[idx].realizedFee = parseFloat((parseFloat(logs[idx].realizedFee) + feeThis).toFixed(8));
    logs[idx].closedRatio = parseFloat((parseFloat(logs[idx].closedRatio) + _closedDelta).toFixed(4));
    // ratio 与 closedRatio 同口径（占原始仓位），保证 sum(closes[].ratio) === closedRatio
    logs[idx].closes.push({ type: closeType.value, price: closePrice, ratio: _closedDelta, fee: parseFloat(feeThis.toFixed(8)), gross: parseFloat((settlement.grossPnl * (partialRatio2 / 100)).toFixed(2)), pnl: parseFloat(netPnlThis.toFixed(2)), time: _nowISO, ratioOfRemaining: partialRatio2 });
    // P4-5 修复：grossPnlAmount 维护为"整笔累计价格毛利"（纯价格毛利，不含费/滑点）。
    // 部分平仓按"本次平掉比例"累加，而非原先覆盖为"剩余仓位全量毛利"——后者与
    // realizedFee(整笔累计) 口径脱节，导致 stats 成本侵蚀失真。
    logs[idx].grossPnlAmount = parseFloat(((parseFloat(logs[idx].grossPnlAmount) || 0) + settlement.grossPnl * (partialRatio2 / 100)).toFixed(2));
    logs[idx].pnlAmount = parseFloat(netPnlThis.toFixed(2));
    // P0-1 FIX：中间态记录的收益率/R 用"本次已实现"口径（本次平仓保证金、初始风险为基准）
    var _levNow = Number(logs[idx].leverage) > 0 ? Number(logs[idx].leverage) : 1;
    var marginThis = posBefore > 0 ? (posBefore / _levNow) * (partialRatio2 / 100) : 0;
    logs[idx].pnlPercent = marginThis > 0
      ? parseFloat((netPnlThis / marginThis * 100).toFixed(2))
      : parseFloat(settlement.pnlPercent.toFixed(2));
    logs[idx].rMultiple = (logs[idx].initialRiskAmount != null && parseFloat(logs[idx].initialRiskAmount) > 0)
      ? parseFloat((netPnlThis / parseFloat(logs[idx].initialRiskAmount)).toFixed(2))
      : (settlement.rMultiple == null ? null : parseFloat(settlement.rMultiple.toFixed(2)));
    logs[idx].actualCloseFee = parseFloat(feeThis.toFixed(8));
    logs[idx].actualExitLegacySlippageCost = parseFloat(settlement.legacySlippageCost.toFixed(8));
  } else if (hadPartialBefore) {
    // —— 部分平仓后的最终平仓：pnlAmount 为整笔累计已实现盈亏 ——
    var feeFinal = settlement.fee;
    var ratioFinal = 100 - (parseFloat(logs[idx].closedRatio) || 0);
    logs[idx].realizedPnl = parseFloat((parseFloat(logs[idx].realizedPnl) + netPnlVal).toFixed(2));
    logs[idx].realizedFee = parseFloat((parseFloat(logs[idx].realizedFee) + feeFinal).toFixed(8));
    logs[idx].closedRatio = 100;
    logs[idx].closes.push({ type: closeType.value, price: closePrice, ratio: parseFloat(Math.max(0, ratioFinal).toFixed(4)), fee: parseFloat(feeFinal.toFixed(8)), pnl: parseFloat(netPnlVal.toFixed(2)), time: _nowISO });
    logs[idx].positionSize = 0; // 全部退出
    delete logs[idx].partialRatio;
    // P4-5 修复：最终平仓累加最后一腿毛利，grossPnlAmount 成为整笔累计毛利。
    logs[idx].grossPnlAmount = parseFloat(((parseFloat(logs[idx].grossPnlAmount) || 0) + settlement.grossPnl).toFixed(2));
    logs[idx].pnlAmount = parseFloat(logs[idx].realizedPnl.toFixed(2)); // 整笔累计
    logs[idx].actualCloseFee = parseFloat(logs[idx].realizedFee.toFixed(8));
    logs[idx].actualExitLegacySlippageCost = parseFloat(settlement.legacySlippageCost.toFixed(8));
    // 整笔 R 与收益率以初始风险/初始保证金为基准（部分止盈的已实现盈亏计入分子）
    if (logs[idx].initialRiskAmount != null && parseFloat(logs[idx].initialRiskAmount) > 0) {
      logs[idx].rMultiple = parseFloat((parseFloat(logs[idx].realizedPnl) / parseFloat(logs[idx].initialRiskAmount)).toFixed(2));
    } else {
      logs[idx].rMultiple = settlement.rMultiple == null ? null : parseFloat(settlement.rMultiple.toFixed(2));
    }
    if (logs[idx].initialMargin != null && parseFloat(logs[idx].initialMargin) > 0) {
      logs[idx].pnlPercent = parseFloat((parseFloat(logs[idx].realizedPnl) / parseFloat(logs[idx].initialMargin) * 100).toFixed(2));
    } else {
      logs[idx].pnlPercent = parseFloat(settlement.pnlPercent.toFixed(2));
    }
  } else {
    // —— 全新平仓：原有逻辑 + 初始化整笔累计字段 ——
    logs[idx].grossPnlAmount = parseFloat(settlement.grossPnl.toFixed(2));
    logs[idx].pnlAmount = parseFloat(settlement.netPnl.toFixed(2));
    logs[idx].pnlPercent = parseFloat(settlement.pnlPercent.toFixed(2));
    logs[idx].rMultiple = settlement.rMultiple == null ? null : parseFloat(settlement.rMultiple.toFixed(2));
    logs[idx].actualCloseFee = parseFloat(settlement.fee.toFixed(8));
    logs[idx].actualExitLegacySlippageCost = parseFloat(settlement.legacySlippageCost.toFixed(8));
    logs[idx].realizedPnl = parseFloat(settlement.netPnl.toFixed(2));
    logs[idx].realizedFee = parseFloat(settlement.fee.toFixed(8));
    logs[idx].closedRatio = 100;
    // #6 FIX：全新平仓必须把剩余仓位归零，与部分/最终平仓路径（:341）口径对齐。
    // 此前遗漏 → CSV 仓位列误导为开仓量，且 edit-modal 首编辑即拿到 positionSize=0，
    // 放大「亏损理由误拦」的触发面（#2）。
    logs[idx].positionSize = 0;
    logs[idx].closes.push({ type: closeType.value, price: closePrice, ratio: 100, fee: parseFloat(settlement.fee.toFixed(8)), pnl: parseFloat(settlement.netPnl.toFixed(2)), time: _nowISO });
  }
  logs[idx].closeNote = closeNoteEl ? closeNoteEl.value.trim() : '';
  // Execution score
  const execChecks = document.getElementById('cpExecChecks_' + idx);
  logs[idx].executionScore = execChecks ? execChecks.querySelectorAll('input[type="checkbox"]:checked').length || null : null;
  // MAE / MFE — 从极值价格计算百分比
  // C1 修复：极值是"整笔持仓期间"的最值，多次（部分）平仓时只扩大范围、不覆盖/清空，
  // 避免最终平仓把整段真正的极值覆盖掉导致 MAE/MFE 失真；空输入不清空已存极值。
  const lowEl = document.getElementById('cpLowPrice_' + idx);
  const highEl = document.getElementById('cpHighPrice_' + idx);
  const _newLow = (lowEl && lowEl.value !== '') ? parseFloat(lowEl.value) : null;
  const _newHigh = (highEl && highEl.value !== '') ? parseFloat(highEl.value) : null;
  if (_newLow != null) {
    logs[idx].lowPrice = (logs[idx].lowPrice != null && !isNaN(parseFloat(logs[idx].lowPrice)))
      ? Math.min(parseFloat(logs[idx].lowPrice), _newLow) : _newLow;
  }
  if (_newHigh != null) {
    logs[idx].highPrice = (logs[idx].highPrice != null && !isNaN(parseFloat(logs[idx].highPrice)))
      ? Math.max(parseFloat(logs[idx].highPrice), _newHigh) : _newHigh;
  }
  storeMAEMFE(logs[idx]);
  // 极值合法性校验（填反/未包住入场/平仓价 → warn 提示，不阻断保存）
  if (typeof validateExtremes === 'function') validateExtremes(logs[idx], closePrice);
  // Loss reason (only for losing trades)
  if (isLoss) {
    var lrEl = document.getElementById('cpLossReason_' + idx);
    var cbs = lrEl ? lrEl.querySelectorAll('input[type="checkbox"]:checked') : [];
    logs[idx].lossReason = Array.from(cbs).map(function(cb) { return cb.value; });
    if (logs[idx].lossReason.length === 0) logs[idx].lossReason = null;
  } else {
    logs[idx].lossReason = null;
  }
  // Emotions (optional)
  var emEl = document.getElementById('cpEmotions_' + idx);
  var emCbs = emEl ? emEl.querySelectorAll('input[type="checkbox"]:checked') : [];
  logs[idx].emotions = Array.from(emCbs).map(function(cb) { return cb.value; });
  if (logs[idx].emotions.length === 0) logs[idx].emotions = null;
  // M3: exitReason（出场理由，文本输入可选）
  var exitReasonEl = document.getElementById('cpExitReason_' + idx);
  logs[idx].exitReason = exitReasonEl ? exitReasonEl.value.trim() : (logs[idx].exitReason || '');
  if (!saveLogs()) {
    logs[idx] = beforeClose;
    if (typeof renderLogs === 'function') renderLogs();
    showToast('平仓记录未保存，已恢复到保存前状态。', 'error');
    return false;
  }
  openClosePanelIdx = -1;
  // P1: 平仓完成后重置类型/价格缓存
  _closePanelType = '';
  _closePanelPrice = '';
  // 平仓后刷新表格与统计数据
  if (typeof renderLogs === 'function') renderLogs();
  // P0-5/6: 平仓后刷新仪表盘，确保 Heat / PnL / 强平预警实时更新
  if (typeof renderDashboard === 'function') renderDashboard();
  return true;
}

// ==================== 批量操作 ====================
function toggleBatchMode() {
  _batchMode = !_batchMode;
  _selectedIndices.clear();
  _syncBatchModeUI();
  renderLogs();
}

// P1 交互修复（v5.6.14）：batchMode 状态与 UI（按钮文案/操作栏/表头全选框可见性）
// 的唯一同步点。toggleBatchMode / 勾选联动（_enterBatchModeIfIdle / 清空自动退出）
// 都走这里，避免四处各改一半。
function _syncBatchModeUI() {
  const btn = document.getElementById('batchBtn');
  if (btn) {
    btn.innerHTML = _batchMode
      ? '<i class="fas fa-times"></i> 退出批量'
      : '<i class="fas fa-tasks"></i> 批量操作';
    btn.classList.toggle('active', _batchMode);
  }
  updateBatchCount();
}

function updateBatchCount() {
  const el = document.getElementById('batchCount');
  const bar = document.getElementById('batchBar');
  if (el) el.textContent = '已选 ' + _selectedIndices.size + ' 条';
  if (bar) bar.style.display = _batchMode ? 'flex' : 'none';
  // P3: 同步表头全选框状态——部分选中显示 indeterminate，全空时复位 checked
  const allCb = document.getElementById('batchSelectAll');
  if (allCb) {
    const tbody = document.getElementById('logBody');
    const total = tbody ? tbody.querySelectorAll('.batch-checkbox[data-batch-idx]').length : 0;
    const selected = _selectedIndices.size;
    allCb.indeterminate = selected > 0 && selected < total;
    if (selected === 0) { allCb.checked = false; allCb.indeterminate = false; }
  }
}

// 勾选任意行 / 表头全选时自动进入批量模式（用户勾选本身就是批量意图，
// 原先还要先点「批量操作」按钮再勾选，交互割裂）。
// 勾选路径幂等：已开则直接返回。
function _enterBatchModeIfIdle() {
  if (_batchMode) return false;
  _batchMode = true;
  _syncBatchModeUI();
  renderLogs();
  return true;
}

function handleBatchCheck(idx, checked) {
  if (checked) {
    _selectedIndices.add(idx);
    // 首次勾选自动进入批量模式
    if (_enterBatchModeIfIdle()) return;
  } else {
    _selectedIndices.delete(idx);
    // 全部清空（0 条）时自动退出批量模式，隐藏操作栏——用户已无批量意图
    if (_selectedIndices.size === 0 && _batchMode) {
      _batchMode = false;
      _syncBatchModeUI();
    }
  }
  updateBatchCount();
}

function batchSelectAll(checked) {
  if (checked) {
    // 表头全选勾选也自动进入批量模式（与行勾选行为一致）
    if (_enterBatchModeIfIdle()) return;
  } else if (_batchMode) {
    // 表头反选（取消全选）= 全部清空 → 自动退出批量模式
    _batchMode = false;
  }
  _selectedIndices.clear();
  const tbody = document.getElementById('logBody');
  if (!tbody) { _syncBatchModeUI(); return; }
  const cbs = tbody.querySelectorAll('.batch-checkbox[data-batch-idx]');
  cbs.forEach(function(cb) {
    cb.checked = checked;
    if (checked) _selectedIndices.add(parseInt(cb.dataset.batchIdx, 10));
  });
  _syncBatchModeUI();
}

function batchDelete() {
  if (_pendingDelete) {
    if (window._undoToastTimer) { clearTimeout(window._undoToastTimer); window._undoToastTimer = null; }
    _commitPendingDelete();
  }
  if (_selectedIndices.size === 0) { showToast('请先勾选要删除的日志','warn'); return; }
  const count = _selectedIndices.size;
  // 不做二次确认：下方 showUndoToast 提供 5 秒撤销，撤销即为本操作的确认机制。
  // 此前注释如此声明、代码却仍调 confirm()，形成「原生确认框 + 撤销」双重摩擦，
  // 且原生 confirm 不跟随主题。现按注释所述语义执行，只保留撤销。

  const sorted = Array.from(_selectedIndices).sort(function(a, b) { return b - a; });
  const deletedLogs = [];
  for (var i = 0; i < sorted.length; i++) {
    deletedLogs.push(JSON.parse(JSON.stringify(logs[sorted[i]]))); // 深拷贝，防止撤销时数据已被修改
    logs.splice(sorted[i], 1);
  }
  
  // 批量删除是一次性移除多行，所有按下标记账的状态一律作废（无法逐条重映射）。
  // 此前这条路径漏了 _expandedRows：展开的详情行索引仍指向删除后的其他记录，
  // 而撤销回调里反而清了它——「该清的没清、不该清的清了」的错配。
  if (typeof window.resetAllIndexState === 'function') window.resetAllIndexState();
  const btn = document.getElementById('batchBtn');
  if (btn) {
    btn.innerHTML = '<i class="fas fa-tasks"></i> 批量操作';
    btn.classList.remove('active');
  }
  
  // F5: 批量删除 — _pendingDelete 结构为 { idx: -1, logs: deletedLogs[] }
  // 与单条删除（{ idx: number, timeoutId: null }）不同，批量删除直接操作 logs 数组
  _pendingDelete = { idx: -1, logs: deletedLogs };
  showUndoToast('已删除 ' + count + ' 条日志，点击撤销（5秒）', function() {
    // Restore deleted logs and maintain descending time order
    var newLogs = [...logs, ..._pendingDelete.logs];
    newLogs.sort(function(a, b) { return new Date(b.time) - new Date(a.time); });
    logs = newLogs;
    // 恢复后 logs 被重新排序，下标全部改变 → 统一重置（权威入口）
    if (typeof window.resetAllIndexState === 'function') window.resetAllIndexState();
    _pendingDelete = null;
    renderLogs();
  }, function() {
    _commitPendingDelete();
  }, 5000);
}

function batchExport() {
  if (_selectedIndices.size === 0) { showToast('请先勾选要导出的日志','warn'); return; }
  exportJSON(Array.from(_selectedIndices));
}

function downloadBackup() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0,10);
  const timeStr = date.toLocaleTimeString('zh-CN',{hour12:false}).replace(/:/g,'-');
  const b = new Blob([JSON.stringify(logs,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'trading_backup_' + dateStr + '_' + timeStr + '.json';
  a.click();

  // 记录备份时间
  localStorage.setItem('trade_backup_time', date.toLocaleString('zh-CN',{hour12:false}));
  updateBackupTime();
}

function updateBackupTime() {
  // 槽位上限必须读 settings.backupCount，不能写死 10：
  //   - 写死 10 时，用户把份数调成 3，第 4~10 槽若存着调小之前的旧数据，
  //     会被当成最新备份显示出来（显示一个早已被轮转掉的时间）；
  //   - 调大到 20 时，第 11~20 槽永远扫不到，「上次备份」永远停在旧时间。
  // 这正是「参数化了却在别处写死同一常量」的典型漏改（与 5.6.19 修的
  // calc-visuals 刻度常量同类）。
  var _maxSlots = (typeof loadSettings === 'function')
    ? (parseInt(loadSettings().backupCount, 10) || 10)
    : 10;
  let latest = null, latestTime = '';
  for (let i = 0; i < _maxSlots; i++) {
    const raw = localStorage.getItem('trade_backup_auto_' + i);
    if (raw) {
      try {
        const t = JSON.parse(raw).time;
        if (!latestTime || t > latestTime) { latest = i; latestTime = t; }
      } catch(e) { console.error('[logs]', e); }
    }
  }
  // 兼容旧版单槽备份
  if (!latestTime) {
    const old = localStorage.getItem('trade_backup_auto');
    if (old) { try { latestTime = JSON.parse(old).time; } catch(e) { console.error('[logs-backup]', e); } }
  }
  const el = document.getElementById('lastBackupTime');
  if (el) el.textContent = latestTime ? ('上次备份: ' + latestTime) : '尚未备份';
}

function clearLogs() {
  if (!logs.length) { showToast('当前没有日志可清空', 'info'); return; }
  var clearedCount = logs.length;
  // 这是全站破坏性最强的操作，原先只有原生 confirm、清空后无法找回。
  // 现改为自研对话框（说明影响范围 + 红色确认钮）+ 5 秒撤销，
  // 与单条/批量删除共用 showUndoToast 基建（js/toast.js）。
  window.confirmDialog({
    title: '清空所有日志',
    message: '将删除全部 ' + clearedCount + ' 条交易日志。\n统计、风控、复盘的所有指标都会随之归零。\n\n清空后 5 秒内可撤销。',
    confirmText: '清空',
    danger: true
  }).then(function(ok) {
    if (!ok) return;
    var backup = JSON.parse(JSON.stringify(logs));   // 深拷贝，供撤销还原
    logs = [];
    // 索引依赖型全局状态统一重置（展开行/勾选/批量模式/平仓面板与手动改价标记）
    if (typeof window.resetAllIndexState === 'function') window.resetAllIndexState();
    if (typeof saveLogs === 'function') saveLogs();
    if (typeof renderLogs === 'function') renderLogs();
    if (typeof renderDashboard === 'function') renderDashboard();

    showUndoToast('已清空 ' + clearedCount + ' 条日志，点击撤销（5秒）', function() {
      logs = backup;
      // 恢复后统一重置：清空时虽已重置过一次，但用户在 5 秒窗口内可能又
      // 勾选/展开了新状态，撤销把它们套到恢复后的数组上同样是错位的。
      if (typeof window.resetAllIndexState === 'function') window.resetAllIndexState();
      if (typeof saveLogs === 'function') saveLogs(true);
      if (typeof renderLogs === 'function') renderLogs();
      if (typeof renderDashboard === 'function') renderDashboard();
    });
  });
}

// ==================== 日志列表过滤 ====================
function _filterMatch(l) {
  var f = _activeFilters;
  if (f.direction && l.direction !== f.direction) return false;
  if (f.symbol && l.symbol !== f.symbol) return false;
  if (f.strategy && (l.strategyFramework || '') !== f.strategy) return false;
  // P0-1 FIX：状态筛选与全局 isClosedTrade 语义一致（部分平仓中间态归入"持仓中"）
  // 经 utils.isClosed 走 fail-closed 唯一入口，不再就地写 !!closeType 兜底
  if (f.status === 'open') {
    if (window.utils.isClosed(l)) return false;
  } else if (f.status === 'closed') {
    if (!window.utils.isClosed(l)) return false;
  }
  if (f.pnl === 'profit') { var v = parseFloat(l.pnlAmount); if (isNaN(v) || v <= 0) return false; }
  else if (f.pnl === 'loss') { var v = parseFloat(l.pnlAmount); if (isNaN(v) || v >= 0) return false; }
  if (f.time) {
    var now = new Date(), since = null;
    if (f.time === 'today') { since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0); }
    else if (f.time === 'thisWeek') { var d = new Date(now); var dayOffset = d.getDay() === 0 ? 6 : d.getDay() - 1; d.setDate(d.getDate() - dayOffset); d.setHours(0, 0, 0, 0); since = d; }
    else if (f.time === 'thisMonth') { since = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0); }
    else if (f.time === 'last30') { since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); }
    if (since) {
      // P2-1 FIX：时间筛选与统计口径统一——已平仓记录按平仓时间，未平仓记录按开仓时间
      var isClosedT = window.utils.isClosed(l);
      var useTime = isClosedT ? (l.closeTime || l.time) : l.time;
      var t = new Date(useTime);
      if (t < since) return false;
    }
  }
  return true;
}

function applyFilters(logArr) {
  return logArr.filter(function(l) { return _filterMatch(l); });
}

function filterEntries(entries) {
  return entries.filter(function(e) { return _filterMatch(e.item); });
}
