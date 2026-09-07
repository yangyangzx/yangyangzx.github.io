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
    item.mae = lowVal != null ? ((lowVal - ep) / ep * 100) : null;
    item.mfe = highVal != null ? ((highVal - ep) / ep * 100) : null;
  } else {
    item.mae = highVal != null ? ((ep - highVal) / ep * 100) : null;
    item.mfe = lowVal != null ? ((ep - lowVal) / ep * 100) : null;
  }
}

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
    var feeThis = settlement.fee * (partialRatio2 / 100);
    var posBefore = parseFloat(logs[idx].positionSize) || 0;
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
    logs[idx].closedRatio = parseFloat((parseFloat(logs[idx].closedRatio) + partialRatio2).toFixed(4));
    logs[idx].closes.push({ type: closeType.value, price: closePrice, ratio: partialRatio2, fee: parseFloat(feeThis.toFixed(8)), pnl: parseFloat(netPnlThis.toFixed(2)), time: _nowISO });
    logs[idx].grossPnlAmount = parseFloat(settlement.grossPnl.toFixed(2));
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
    logs[idx].grossPnlAmount = parseFloat(settlement.grossPnl.toFixed(2));
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
    logs[idx].closes.push({ type: closeType.value, price: closePrice, ratio: 100, fee: parseFloat(settlement.fee.toFixed(8)), pnl: parseFloat(settlement.netPnl.toFixed(2)), time: _nowISO });
  }
  logs[idx].closeNote = closeNoteEl ? closeNoteEl.value.trim() : '';
  // Execution score
  const execChecks = document.getElementById('cpExecChecks_' + idx);
  logs[idx].executionScore = execChecks ? execChecks.querySelectorAll('input[type="checkbox"]:checked').length || null : null;
  // MAE / MFE — 从极值价格计算百分比
  const lowEl = document.getElementById('cpLowPrice_' + idx);
  const highEl = document.getElementById('cpHighPrice_' + idx);
  logs[idx].lowPrice = lowEl && lowEl.value !== '' ? parseFloat(lowEl.value) : null;
  logs[idx].highPrice = highEl && highEl.value !== '' ? parseFloat(highEl.value) : null;
  storeMAEMFE(logs[idx]);
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
  const btn = document.getElementById('batchBtn');
  if (_batchMode) {
    btn.innerHTML = '<i class="fas fa-times"></i> 退出批量';
    btn.classList.add('active');
  } else {
    btn.innerHTML = '<i class="fas fa-tasks"></i> 批量操作';
    btn.classList.remove('active');
  }
  updateBatchCount();
  renderLogs();
}

function updateBatchCount() {
  const el = document.getElementById('batchCount');
  const bar = document.getElementById('batchBar');
  if (el) el.textContent = '已选 ' + _selectedIndices.size + ' 条';
  if (bar) bar.style.display = _batchMode ? 'flex' : 'none';
}

function handleBatchCheck(idx, checked) {
  if (checked) _selectedIndices.add(idx);
  else _selectedIndices.delete(idx);
  updateBatchCount();
}

function batchSelectAll(checked) {
  _selectedIndices.clear();
  const tbody = document.getElementById('logBody');
  if (!tbody) { updateBatchCount(); return; }
  const cbs = tbody.querySelectorAll('.batch-checkbox[data-batch-idx]');
  cbs.forEach(function(cb) {
    cb.checked = checked;
    if (checked) _selectedIndices.add(parseInt(cb.dataset.batchIdx, 10));
  });
  updateBatchCount();
}

function batchDelete() {
  if (_pendingDelete) {
    if (window._undoToastTimer) { clearTimeout(window._undoToastTimer); window._undoToastTimer = null; }
    _commitPendingDelete();
  }
  if (_selectedIndices.size === 0) { showToast('请先勾选要删除的日志','warn'); return; }
  const count = _selectedIndices.size;
  if (!confirm('确认删除已选的 ' + count + ' 条日志？')) return;
  if (!confirm('⚠️ 再次确认：删除后将无法恢复，确定继续？')) return;
  
  const sorted = Array.from(_selectedIndices).sort(function(a, b) { return b - a; });
  const deletedLogs = [];
  for (var i = 0; i < sorted.length; i++) {
    deletedLogs.push(JSON.parse(JSON.stringify(logs[sorted[i]]))); // 深拷贝，防止撤销时数据已被修改
    logs.splice(sorted[i], 1);
  }
  
  _selectedIndices.clear();
  _batchMode = false;
  openClosePanelIdx = -1;
  actionPanelIdx = -1;
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
    if (window._pendingDeleteIndices) window._pendingDeleteIndices.clear();
    _pendingDelete = null;
    // 恢复后重置展开状态和面板索引，避免索引错位
    _expandedRows.clear();
    openClosePanelIdx = -1;
    actionPanelIdx = -1;
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
  let latest = null, latestTime = '';
  for (let i = 0; i < 10; i++) {  // M1: 支持 10 份轮转备份
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
  if (confirm('确认清空所有日志？')) { logs = []; openClosePanelIdx = -1; saveLogs(); if (typeof renderDashboard === 'function') renderDashboard(); }
}

// ==================== 日志列表过滤 ====================
function _filterMatch(l) {
  var f = _activeFilters;
  if (f.direction && l.direction !== f.direction) return false;
  if (f.symbol && l.symbol !== f.symbol) return false;
  if (f.strategy && (l.strategyFramework || '') !== f.strategy) return false;
  // P0-1 FIX：状态筛选与全局 isClosedTrade 语义一致（部分平仓中间态归入"持仓中"）
  if (f.status === 'open') {
    if (typeof window.utils !== 'undefined' && typeof window.utils.isClosedTrade === 'function') {
      if (window.utils.isClosedTrade(l)) return false;
    } else if (l.closeType && l.closeType !== '') { return false; }
  } else if (f.status === 'closed') {
    if (typeof window.utils !== 'undefined' && typeof window.utils.isClosedTrade === 'function') {
      if (!window.utils.isClosedTrade(l)) return false;
    } else if (!l.closeType || l.closeType === '') { return false; }
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
      var isClosedT = (typeof window.utils !== 'undefined' && typeof window.utils.isClosedTrade === 'function')
        ? window.utils.isClosedTrade(l) : false;
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
