// ==================== 平仓盈亏计算 ====================
const _closePriceEdited = {};
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
  const entryPrice = (item.effectiveEntryPrice != null && !isNaN(parseFloat(item.effectiveEntryPrice)))
    ? parseFloat(item.effectiveEntryPrice)
    : parseFloat(item.entryPrice);
  const positionSize = parseFloat(item.positionSize);
  if (isNaN(entryPrice) || entryPrice <= 0 || isNaN(positionSize) || positionSize <= 0) return;
  if (item.direction !== 'long' && item.direction !== 'short') {
    if (pnlAmtEl) pnlAmtEl.value = '';
    if (pnlPctEl) pnlPctEl.value = '';
    if (rMultipleEl) rMultipleEl.value = '';
    return;
  }
  let grossPnl;
  if (item.direction === 'long') {
    grossPnl = (closePrice - entryPrice) * positionSize / entryPrice;
  } else {
    grossPnl = (entryPrice - closePrice) * positionSize / entryPrice;
  }
  // Deduct fee and slippage —优先从 close panel 的输入框读取（用户可能临时修改）
  const feeEl = document.getElementById('cpFee_' + idx);
  const slipEl = document.getElementById('cpSlippage_' + idx);
  const fee = feeEl && feeEl.value !== '' ? parseFloat(feeEl.value) : (parseFloat(item.fee) || 0);
  const slippageCost = slipEl && slipEl.value !== '' ? parseFloat(slipEl.value) : (parseFloat(item.slippageCost) || 0);
  const netPnl = grossPnl - fee - slippageCost;
  const margin = positionSize / ((parseFloat(item.leverage) || 1));
  const netPnlPercent = margin > 0 ? (netPnl / margin * 100) : 0;
  if (pnlAmtEl) pnlAmtEl.value = netPnl.toFixed(2);
  if (pnlPctEl) pnlPctEl.value = netPnlPercent.toFixed(2) + '%';
  // Toggle loss reason visibility
  const lrRow = document.getElementById('cpLossReasonRow_' + idx);
  if (lrRow) lrRow.style.display = (netPnl < 0 || (closeType && (closeType.value === 'manualLoss' || closeType.value === 'liquidation'))) ? 'block' : 'none';
  // R-multiple based on net PnL
  const riskAmount = parseFloat(item.riskAmount);
  if (rMultipleEl && !isNaN(riskAmount) && riskAmount > 0) {
    rMultipleEl.value = (netPnl / riskAmount).toFixed(2);
  } else if (rMultipleEl) {
    rMultipleEl.value = '';
  }
}

// ==================== MAE/MFE 统一计算 ====================
function storeMAEMFE(item) {
  const ep = parseFloat(item.entryPrice);
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
  // 先校验 PnL（避免 closeTime/holdDuration 写入后因 PnL 校验失败而跳过 saveLogs）
  const fee = parseFloat(logs[idx].fee) || 0;
  const slippageCost = parseFloat(logs[idx].slippageCost) || 0;
  const netPnlVal = parseFloat(pnlAmtEl ? pnlAmtEl.value : 0);
  if (isNaN(netPnlVal)) { showToast('盈亏计算失败，请检查入场价等数据是否有效','error'); return; }
  // 亏损单必须选择亏损原因
  const isLoss = netPnlVal < 0 || (closeType && (closeType.value === 'manualLoss' || closeType.value === 'liquidation'));
  if (isLoss) {
    var lrContainer = document.getElementById('cpLossReason_' + idx);
    var checked = lrContainer ? lrContainer.querySelectorAll('input[type="checkbox"]:checked') : [];
    if (checked.length === 0) {
      showToast('亏损单请至少选择一个亏损原因', 'warn');
      if (lrContainer) { lrContainer.classList.add('loss-reason-flash'); setTimeout(function() { lrContainer.classList.remove('loss-reason-flash'); }, 1000); }
      return;
    }
  }
  // 写入时间信息（仅新平仓时设置 closeTime，修改已平仓保留原始时间）
  const isNewClose = !logs[idx].closeType;
  logs[idx].closeType = closeType.value;
  logs[idx].closePrice = closePrice;
  if (isNewClose) {
    logs[idx].closeTime = new Date().toISOString();
    logs[idx].holdDuration = Math.round((new Date(logs[idx].closeTime) - new Date(logs[idx].time)) / 60000);
  }
  // 反推 grossPnl = netPnl + fee + slippageCost
  const grossPnlVal = netPnlVal + fee + slippageCost;
  logs[idx].grossPnlAmount = parseFloat(grossPnlVal.toFixed(2));
  logs[idx].pnlAmount = parseFloat(netPnlVal.toFixed(2));
  logs[idx].pnlPercent = pnlPctEl ? parseFloat(pnlPctEl.value) : null;
  logs[idx].rMultiple = rMultipleEl ? parseFloat(rMultipleEl.value) : null;
  logs[idx].closeNote = closeNoteEl ? closeNoteEl.value.trim() : '';
  // Execution score
  const execChecks = document.getElementById('cpExecChecks_' + idx);
  logs[idx].executionScore = execChecks ? execChecks.querySelectorAll('input[type="checkbox"]:checked').length : 0;
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
  openClosePanelIdx = -1;
  saveLogs();
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
  if (checked) {
    const tbody = document.getElementById('logBody');
    if (tbody) {
      tbody.querySelectorAll('.batch-checkbox[data-batch-idx]').forEach(function(cb) {
        _selectedIndices.add(parseInt(cb.dataset.batchIdx, 10));
      });
    }
  }
  const tbody2 = document.getElementById('logBody');
  if (tbody2) {
    tbody2.querySelectorAll('.batch-checkbox[data-batch-idx]').forEach(function(cb) {
      cb.checked = checked;
    });
  }
  updateBatchCount();
}

function batchDelete() {
  if (_pendingDelete) {
    clearTimeout(_pendingDelete.timeoutId);
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
    const raw = localStorage.getItem('trade_auto_backup_' + i);
    if (raw) {
      try {
        const t = JSON.parse(raw).time;
        if (!latestTime || t > latestTime) { latest = i; latestTime = t; }
      } catch(e) {}
    }
  }
  // 兼容旧版单槽备份
  if (!latestTime) {
    const old = localStorage.getItem('trade_auto_backup');
    if (old) { try { latestTime = JSON.parse(old).time; } catch(e) {} }
  }
  const el = document.getElementById('lastBackupTime');
  if (el) el.textContent = latestTime ? ('上次备份: ' + latestTime) : '尚未备份';
}

function clearLogs() {
  if (confirm('确认清空所有日志？')) { logs = []; openClosePanelIdx = -1; saveLogs(); }
}

// ==================== 日志列表过滤 ====================
function _filterMatch(l) {
  var f = _activeFilters;
  if (f.direction && l.direction !== f.direction) return false;
  if (f.symbol && l.symbol !== f.symbol) return false;
  if (f.strategy && (l.strategyFramework || '') !== f.strategy) return false;
  if (f.status === 'open') { if (l.closeType && l.closeType !== '') return false; }
  else if (f.status === 'closed') { if (!l.closeType || l.closeType === '') return false; }
  if (f.pnl === 'profit') { var v = parseFloat(l.pnlAmount); if (isNaN(v) || v <= 0) return false; }
  else if (f.pnl === 'loss') { var v = parseFloat(l.pnlAmount); if (isNaN(v) || v >= 0) return false; }
  if (f.time) {
    var now = new Date(), since = null;
    if (f.time === 'today') { since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0); }
    else if (f.time === 'thisWeek') { var d = new Date(now); var dayOffset = d.getDay() === 0 ? 6 : d.getDay() - 1; d.setDate(d.getDate() - dayOffset); d.setHours(0, 0, 0, 0); since = d; }
    else if (f.time === 'thisMonth') { since = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0); }
    else if (f.time === 'last30') { since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); }
    if (since) { var t = new Date(l.time); if (t < since) return false; }
  }
  return true;
}

function applyFilters(logArr) {
  return logArr.filter(function(l) { return _filterMatch(l); });
}

function filterEntries(entries) {
  return entries.filter(function(e) { return _filterMatch(e.item); });
}
