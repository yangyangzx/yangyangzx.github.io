// ==================== 编辑模态框 ====================
function openEditModal(idx) {
  const item = logs[idx];
  if (!item) return;
  window._emSnapshotItem = item;  // 多标签页竞态检测：保存时比对引用

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'editModal';

  const ms = item.mindsetScore || 3;
  window._emMindsetScore = ms;  // 打开弹窗时重置为当前项的实际值，防止跨编辑污染
  let starsHTML = '<div class="star-rating-modal" style="display:flex;gap:4px;">';
  for (let s = 1; s <= 5; s++) {
    starsHTML += '<span class="star' + (s <= ms ? ' active' : '') + '" data-val="' + s + '" onclick="emUpdateStars(' + s + ')">★</span>';
  }
  starsHTML += '<span class="star-label" id="emMindsetLabel">' + esc(MINDSET_LABELS[ms] || '') + '</span></div>';

  const sfVal = item.strategyFramework || '';
  // 编辑弹窗始终展示全部形态（扁平 option），共用 buildPatternOptions
  const patternOptions = buildPatternOptions(item.strategyPattern || '', false);

  // 信号K checkboxes
  const signals = item.signals || [];
  const signalKeys = ['engulfing','bodyBreak','emaSupport','fibLevel','hammer','invertedHammer','h2','l2','dojiAboveMA','dojiBelowMA','rsiDivergence','macdCross','volumeConfirm'];
  let signalsHTML = '<div class="checkbox-group" id="emSignalGroup" style="padding-top:4px;flex-wrap:wrap;">';
  for (const sk of signalKeys) {
    const checked = signals.includes(sk) ? ' checked' : '';
    signalsHTML += '<label><input type="checkbox" value="' + esc(sk) + '"' + checked + ' /> ' + esc(SIGNAL_LABELS[sk] || sk) + '</label>';
  }
  signalsHTML += '</div>';

  // 分批建仓明细（只读）
  let splitDetailHTML = '';
  if (item.splitEntries && Array.isArray(item.splitEntries.entries) && item.splitEntries.entries.length >= 2) {
    const se = item.splitEntries;
    let tb = '';
    se.entries.forEach(function(e, i) {
      const p = (e.price != null ? e.price : '—');
      const a = (e.alloc != null ? e.alloc + '%' : '—');
      const sl = (e.stopLoss != null ? e.stopLoss : '—');
      tb += '<tr><td>#' + (i + 1) + '</td><td>' + p + '</td><td>' + a + '</td><td>' + sl + '</td></tr>';
    });
    const we = (se.weightedEntry != null ? se.weightedEntry : '—');
    splitDetailHTML = '<div class="fp span-2"><label>分批建仓明细（只读）</label>' +
      '<div class="result-split-area" style="margin-top:4px;">' +
        '<div class="result-split-summary" style="margin-bottom:8px;">加权入场价 <strong>' + we + '</strong></div>' +
        '<div class="result-split-table-wrap">' +
          '<table class="result-split-table" style="min-width:0;"><thead><tr><th>批次</th><th>入场价</th><th>占比</th><th>止损</th></tr></thead><tbody>' + tb + '</tbody></table>' +
        '</div>' +
      '</div></div>';
  }

  modal.innerHTML = '<div class="modal-content">' +
    '<div class="modal-header"><h3>编辑日志</h3><button class="modal-close" onclick="closeEditModal()">✕</button></div>' +
    '<div class="modal-tabs">' +
      '<button class="modal-tab active" onclick="emSwitchTab(0)">基础信息</button>' +
      '<button class="modal-tab" onclick="emSwitchTab(1)">平仓数据</button>' +
      '<button class="modal-tab" onclick="emSwitchTab(2)">执行评估</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="modal-tab-panel active" id="emTab0">' +
        '<div class="fp"><label>品种</label><input type="text" id="emSymbol" value="' + esc(item.symbol || '') + '" /></div>' +
        '<div class="fp"><label>方向</label><select id="emDirection"><option value="long"' + (item.direction === 'long' ? ' selected' : '') + '>做多</option><option value="short"' + (item.direction === 'short' ? ' selected' : '') + '>做空</option></select></div>' +
        '<div class="fp"><label>订单类型</label><select id="emOrderType"><option value="market"' + (item.orderType === 'market' ? ' selected' : '') + '>市价单</option><option value="limitBuy"' + (item.orderType === 'limitBuy' ? ' selected' : '') + '>Buy Limit</option><option value="stopBuy"' + (item.orderType === 'stopBuy' ? ' selected' : '') + '>Buy Stop</option><option value="limitSell"' + (item.orderType === 'limitSell' ? ' selected' : '') + '>Sell Limit</option><option value="stopSell"' + (item.orderType === 'stopSell' ? ' selected' : '') + '>Sell Stop</option><option value="stopLimit"' + (item.orderType === 'stopLimit' ? ' selected' : '') + '>Stop Limit</option><option value="trailingStop"' + (item.orderType === 'trailingStop' ? ' selected' : '') + '>Trailing Stop</option></select></div>' +
        '<div class="fp"><label>止损类型</label><select id="emStopType"><option value="stop-market"' + ((item.stopType || 'stop-market') === 'stop-market' ? ' selected' : '') + '>市价止损 (Stop-Market)</option><option value="stop-limit"' + (item.stopType === 'stop-limit' ? ' selected' : '') + '>限价止损 (Stop-Limit)</option></select></div>' +
        '<div class="fp"><label>入场价</label><input type="number" id="emEntryPrice" step="0.00001" value="' + (item.entryPrice ?? '') + '" /></div>' +
        '<div class="fp"><label>止损价</label><input type="number" id="emStopLoss" step="0.00001" value="' + (item.stopLoss ?? '') + '" /><span id="emStopDistPreview" style="display:none;font-size:11px;color:var(--color-text-muted);margin-top:2px;"></span></div>' +
        '<div class="fp"><label>目标价</label><input type="number" id="emTargetPrice" step="0.00001" value="' + (item.targetPrice ?? '') + '" /></div>' +
        '<div class="fp"><label>仓位(USDT)</label><input type="number" id="emPositionSize" step="0.01" value="' + (item.positionSize ?? '') + '" /></div>' +
        '<div class="fp"><label>杠杆</label><input type="number" id="emLeverage" step="0.5" min="0" value="' + (item.leverage ?? 0) + '" /><span id="emMarginPreview" style="display:none;font-size:11px;color:var(--color-text-muted);margin-top:2px;"></span></div>' +
        '<div class="fp"><label>风险额</label><input type="number" id="emRiskAmount" step="0.01" value="' + (item.riskAmount ?? '') + '" /><span id="emRiskPreview" style="display:none;font-size:11px;color:var(--color-text-muted);margin-top:2px;"></span></div>' +
        '<div class="fp"><label>心态评分</label>' + starsHTML + '</div>' +
        '<div class="fp"><label>策略框架</label><input type="text" id="emStrategyFramework" list="emStrategyList" value="' + esc(sfVal) + '" /><datalist id="emStrategyList"><option value="4H+1H支撑压力区"><option value="4H+15M FVG"><option value="1M移动平均+EMA100"><option value="Kill Zones支撑压力区"></datalist></div>' +
        '<div class="fp"><label>策略形态</label><select id="emStrategyPattern">' + patternOptions + '</select></div>' +
        '<div class="fp span-2"><label>信号K线确认</label>' + signalsHTML + '</div>' +
        splitDetailHTML +
        '<div class="fp span-2"><label>入场原因</label><input type="text" id="emReason" value="' + esc(item.reason || '') + '" /></div>' +
        '<div class="fp"><label>交易时段</label><select id="emSession"><option value="">— 不选择 —</option>' +
          SESSION_OPTIONS.slice(1).map(function(o) { return '<option value="' + o.value + '"' + ((item.session || '') === o.value ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="fp"><label>市场环境</label><select id="emMarketCondition"><option value="">— 不选择 —</option>' +
          MARKET_CONDITION_OPTIONS.slice(1).map(function(o) { return '<option value="' + o.value + '"' + ((item.marketCondition || '') === o.value ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="fp"><label>本金快照</label><input type="text" readonly value="' + (item.capital != null ? item.capital : '未记录') + '" style="color:var(--color-text-muted);font-size:12px;" /></div>' +
      '</div>' +
      '<div class="modal-tab-panel" id="emTab1">' +
        '<div class="fp"><label>平仓类型</label><select id="emCloseType"><option value="">—</option><option value="initialSL"' + (item.closeType === 'initialSL' ? ' selected' : '') + '>初始止损</option><option value="trailingSL"' + (item.closeType === 'trailingSL' ? ' selected' : '') + '>追踪止损</option><option value="initialTP"' + (item.closeType === 'initialTP' ? ' selected' : '') + '>初始止盈</option><option value="manualWin"' + (item.closeType === 'manualWin' ? ' selected' : '') + '>手平赢</option><option value="manualLoss"' + (item.closeType === 'manualLoss' ? ' selected' : '') + '>手平损</option><option value="liquidation"' + (item.closeType === 'liquidation' ? ' selected' : '') + '>强平/爆仓</option><option value="partialTP"' + (item.closeType === 'partialTP' ? ' selected' : '') + '>部分止盈</option><option value="timeStop"' + (item.closeType === 'timeStop' ? ' selected' : '') + '>时间止损</option><option value="reducePosition"' + (item.closeType === 'reducePosition' ? ' selected' : '') + '>减仓</option></select></div>' +
        '<div class="fp"><label>平仓价</label><input type="number" id="emClosePrice" step="0.00001" value="' + (item.closePrice ?? '') + '" /></div>' +
        '<div class="fp"><label>R倍数</label><input type="text" id="emRMultiple" value="' + (item.rMultiple ?? '') + '" /></div>' +
        '<div class="fp"><label>盈亏金额</label><input type="text" id="emPnlAmount" value="' + (item.pnlAmount ?? '') + '" /><span id="emPnlManualTag" style="display:none;font-size:10px;color:var(--color-warning);margin-left:4px;">手动</span></div>' +
        '<div class="fp"><label>盈亏百分比 <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（保证金回报率）</span></label><input type="text" id="emPnlPercent" value="' + (item.pnlPercent ?? '') + '" /></div>' +
        '<div class="fp"><label>手续费</label><input type="text" id="emFee" value="' + (item.fee ?? '') + '" /></div>' +
        '<div class="fp"><label>滑点成本</label><input type="text" id="emSlippageCost" value="' + (item.slippageCost ?? '') + '" /></div>' +
        '<div class="fp"><label>持仓最低价</label><input type="number" id="emLowPrice" step="0.00001" value="' + (item.lowPrice != null ? item.lowPrice : '') + '" style="color:var(--color-danger);" /></div>' +
        '<div class="fp"><label>持仓最高价</label><input type="number" id="emHighPrice" step="0.00001" value="' + (item.highPrice != null ? item.highPrice : '') + '" style="color:var(--color-success);" /></div>' +
        '<div class="fp"><label>平仓时间</label><input type="text" readonly value="' + (item.closeTime ? new Date(item.closeTime).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).replace(/\//g,'-') : '—') + '" style="color:var(--color-text-muted);font-size:12px;" /></div>' +
        '<div class="fp"><label>持仓时长</label><input type="text" readonly value="' + formatHoldDuration(item.closeTime, item.time) + '" style="color:var(--color-text-muted);font-size:12px;" /></div>' +
        '<div class="fp span-2"><label>平仓备注</label><textarea id="emCloseNote" placeholder="平仓总结...">' + esc(item.closeNote || '') + '</textarea></div>' +
        '<div class="fp span-2"><label>出场理由<span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（可选，与平仓类型区分的主观出场动机）</span></label><textarea id="emExitReason" placeholder="如：到达前高阻力位、出现看跌吞没、时间止损...">' + esc(item.exitReason || '') + '</textarea></div>' +
      '</div>' +
      '<div class="modal-tab-panel" id="emTab2">' +
        '<div class="fp span-2"><label>执行评分</label><div class="checkbox-group" style="padding-top:4px;">' +
          '<label style="color:var(--color-text);"><input type="checkbox" id="emExecPlanEntry" value="planEntry"' + ((item.executionScore || 0) >= 1 ? ' checked' : '') + ' onchange="emUpdateExecScore()" /> 按计划入场</label>' +
          '<label style="color:var(--color-text);"><input type="checkbox" id="emExecStopLoss" value="stopLossIntact"' + ((item.executionScore || 0) >= 2 ? ' checked' : '') + ' onchange="emUpdateExecScore()" /> 止损未被移动/破坏</label>' +
          '<label style="color:var(--color-text);"><input type="checkbox" id="emExecPlanExit" value="planExit"' + ((item.executionScore || 0) >= 3 ? ' checked' : '') + ' onchange="emUpdateExecScore()" /> 按计划减仓/平仓</label>' +
          '<span id="emExecScoreDisplay" style="margin-left:8px;font-weight:700;font-size:14px;color:var(--color-text-muted);">' + (item.executionScore || 0) + '/3</span>' +
        '</div></div>' +
        '<div class="fp"><label>亏损原因</label>' +
          '<div class="checkbox-group" id="emLossReason" style="flex-wrap:wrap;gap:4px 12px;">' +
            (function makeLossReasonCheckboxes(reasons, selected) {
              var h = '';
              var arr = Array.isArray(selected) ? selected : (typeof selected === 'string' && selected ? [selected] : []);
              reasons.forEach(function(r) {
                h += '<label style="font-size:13px;color:var(--color-text);white-space:nowrap;"><input type="checkbox" value="' + r + '"' + (arr.indexOf(r) !== -1 ? ' checked' : '') + ' /> ' + r + '</label>';
              });
              return h;
            }(LOSS_REASON_OPTIONS, item.lossReason)) +
          '</div></div>' +
        '<div class="fp span-2"><label>本次交易情绪<span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（可选·多选）</span></label>' +
          '<div class="checkbox-group" id="emEmotions" style="flex-wrap:wrap;gap:4px 16px;">' +
            (function makeEmotionCheckboxes(selected) {
              var arr = Array.isArray(selected) ? selected : [];
              var h = '';
              EMOTION_OPTIONS.forEach(function(o) {
                h += '<label style="font-size:13px;color:var(--color-text);white-space:nowrap;" title="' + o.desc + '"><input type="checkbox" value="' + o.value + '"' + (arr.indexOf(o.value) !== -1 ? ' checked' : '') + ' /> ' + o.value + ' <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">' + o.desc + '</span></label>';
              });
              return h;
            }(item.emotions)) +
          '</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-primary" onclick="saveEditLog(' + idx + ')"><i class="fas fa-save"></i> 保存</button>' +
      '<button class="btn btn-outline" onclick="closeEditModal()">取消</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeEditModal(); });

  // ===== 未保存修改标志 & 字段联动重算 =====
  window._editDirty = false;
  var _pnlHasValue = item.closeType && item.closeType !== '' && item.pnlAmount != null && !isNaN(parseFloat(item.pnlAmount));
  window._emPnlManual = _pnlHasValue;  // 已平仓且 PnL 已有值 → 禁止自动重算覆盖

  // Diff-based dirty detection: store initial values from DOM（必须在 emRecalc 之后捕获，因为 emRecalc 会覆写 PnL/R 字段）
  const _emInitValues = {};
  (function captureInit() {
    const ids = ['emSymbol','emDirection','emOrderType','emEntryPrice','emStopLoss','emTargetPrice',
      'emPositionSize','emLeverage','emRiskAmount','emStrategyFramework','emStrategyPattern',
      'emCloseType','emClosePrice','emRMultiple','emPnlAmount','emPnlPercent','emFee','emSlippageCost',
      'emCloseNote','emReason','emSession','emMarketCondition','emExitReason','emLowPrice','emHighPrice'];
    ids.forEach(function(id) {
      const el = document.getElementById(id);
      if (el) _emInitValues[id] = el.value;
    });
    _emInitValues['emMindsetScore'] = window._emMindsetScore;
    _emInitValues['emSignals'] = (function() {
      const cbs = document.querySelectorAll('#emSignalGroup input[type="checkbox"]');
      const arr = []; cbs.forEach(function(cb) { arr.push(cb.checked); }); return arr.join(',');
    })();
    _emInitValues['emExecScore'] = (document.getElementById('emExecPlanEntry')?.checked ? 1 : 0) +
      (document.getElementById('emExecStopLoss')?.checked ? 1 : 0) +
      (document.getElementById('emExecPlanExit')?.checked ? 1 : 0);
    _emInitValues['emLossReason'] = (function() {
      const cbs = document.querySelectorAll('#emLossReason input[type="checkbox"]');
      const arr = []; cbs.forEach(function(cb) { arr.push(cb.checked ? cb.value : ''); }); return arr.join(',');
    })();
    _emInitValues['emEmotions'] = (function() {
      const cbs = document.querySelectorAll('#emEmotions input[type="checkbox"]');
      const arr = []; cbs.forEach(function(cb) { arr.push(cb.checked ? cb.value : ''); }); return arr.join(',');
    })();
  })();

  // Check dirty before close
  window.emCheckDirty = function() {
    const ids = ['emSymbol','emDirection','emOrderType','emEntryPrice','emStopLoss','emTargetPrice',
      'emPositionSize','emLeverage','emRiskAmount','emStrategyFramework','emStrategyPattern',
      'emCloseType','emClosePrice','emRMultiple','emPnlAmount','emPnlPercent','emFee','emSlippageCost',
      'emCloseNote','emReason','emSession','emMarketCondition','emExitReason','emLowPrice','emHighPrice'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.value !== _emInitValues[ids[i]]) { window._editDirty = true; return; }
    }
    if (window._emMindsetScore !== _emInitValues['emMindsetScore']) { window._editDirty = true; return; }
    var sigs = (function() {
      var cbs = document.querySelectorAll('#emSignalGroup input[type="checkbox"]');
      var arr = []; cbs.forEach(function(cb) { arr.push(cb.checked); }); return arr.join(',');
    })();
    if (sigs !== _emInitValues['emSignals']) { window._editDirty = true; return; }
    var escore = (document.getElementById('emExecPlanEntry')?.checked ? 1 : 0) +
      (document.getElementById('emExecStopLoss')?.checked ? 1 : 0) +
      (document.getElementById('emExecPlanExit')?.checked ? 1 : 0);
    if (escore !== _emInitValues['emExecScore']) { window._editDirty = true; return; }
    var lr = (function() {
      var cbs = document.querySelectorAll('#emLossReason input[type="checkbox"]');
      var arr = []; cbs.forEach(function(cb) { arr.push(cb.checked ? cb.value : ''); }); return arr.join(',');
    })();
    if (lr !== _emInitValues['emLossReason']) { window._editDirty = true; return; }
    var ems = (function() {
      var cbs = document.querySelectorAll('#emEmotions input[type="checkbox"]');
      var arr = []; cbs.forEach(function(cb) { arr.push(cb.checked ? cb.value : ''); }); return arr.join(',');
    })();
    if (ems !== _emInitValues['emEmotions']) { window._editDirty = true; return; }
  };
  // 若用户手动改动 PnL/百分比/R倍数，则停止自动重算
  ['emPnlAmount','emPnlPercent','emRMultiple'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', function() {
      window._emPnlManual = true;
      const tag = document.getElementById('emPnlManualTag');
      if (tag) tag.style.display = 'inline';
    });
  });
  // 绑定联动重算监听
  emBindRecalc(item);
  // 初始渲染一次预览
  emRecalc(item);
  // 检测 PnL 是否被手动覆盖：比较 DOM 中的值与自动计算值
  // 如果用户之前手动填过 PnL/R，emRecalc 会覆盖 DOM，需要恢复用户的值
  var _pnlWasManual = false;
  if (item.closeType) {
    const domPnlAmt = document.getElementById('emPnlAmount')?.value;
    const domRMult = document.getElementById('emRMultiple')?.value;
    if ((domPnlAmt !== undefined && domPnlAmt !== '' && item.pnlAmount != null && String(parseFloat(domPnlAmt)) !== String(item.pnlAmount)) ||
        (domRMult !== undefined && domRMult !== '' && item.rMultiple != null && String(domRMult).replace(/R/g,'') !== String(item.rMultiple))) {
      _pnlWasManual = true;
    }
  }
  window._emPnlManual = _pnlWasManual;
  var manualTag = document.getElementById('emPnlManualTag');
  if (manualTag) manualTag.style.display = _pnlWasManual ? 'inline' : 'none';
}

function closeEditModal() {
  if (window.emCheckDirty) window.emCheckDirty();
  if (window._editDirty) {
    if (!confirm('有未保存的修改，确定关闭？')) return;
  }
  const modal = document.getElementById('editModal');
  if (modal) modal.remove();
  window._editDirty = false;
  // 清理事件监听器，防止重复绑定
  if (window._emRecalcCleanup) { window._emRecalcCleanup(); window._emRecalcCleanup = null; }
}
window.closeEditModal = closeEditModal;

// ==================== 编辑弹窗字段联动重算 ====================
var _emRecalcListeners = [];
function emBindRecalc(item) {
  const ids = ['emEntryPrice','emStopLoss','emPositionSize','emLeverage','emClosePrice','emFee','emSlippageCost'];
  _emRecalcListeners = []; // 清空旧监听
  ids.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      var handler = function() { emRecalc(item); };
      el.addEventListener('input', handler);
      _emRecalcListeners.push({ el: el, type: 'input', handler: handler });
    }
  });
  // select 元素用 change 事件
  ['emDirection','emCloseType'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      var handler = function() { emRecalc(item); };
      el.addEventListener('change', handler);
      _emRecalcListeners.push({ el: el, type: 'change', handler: handler });
    }
  });
  // 提供清理函数
  window._emRecalcCleanup = function() {
    for (var i = 0; i < _emRecalcListeners.length; i++) {
      var l = _emRecalcListeners[i];
      l.el.removeEventListener(l.type, l.handler);
    }
    _emRecalcListeners = [];
  };
}
window.emBindRecalc = emBindRecalc;

function emRecalc(item) {
  function num(id) { const el = document.getElementById(id); if (!el) return NaN; return parseFloat(el.value); }
  var emFee = parseFloat((document.getElementById('emFee') || {}).value) || 0;
  var emSlippage = parseFloat((document.getElementById('emSlippageCost') || {}).value) || 0;
  const entry = num('emEntryPrice');
  const stop = num('emStopLoss');
  const pos = num('emPositionSize');
  const lev = num('emLeverage');
  const direction = (document.getElementById('emDirection') || {}).value || item.direction;
  const closeType = (document.getElementById('emCloseType') || {}).value;

  if (!closeType) {
    // ===== 持仓交易：止损距离 / 风险额 / 保证金 预览 =====
    // 止损距离
    const sdEl = document.getElementById('emStopDistPreview');
    if (sdEl) {
      if (!isNaN(entry) && !isNaN(stop) && entry !== 0) {
        const sd = Math.abs(entry - stop) / entry * 100;
        sdEl.textContent = '预览 止损距离 ' + sd.toFixed(2) + '%';
        sdEl.style.display = 'block';
      } else { sdEl.style.display = 'none'; }
    }
    // 风险额
    const raEl = document.getElementById('emRiskPreview');
    if (raEl) {
      if (!isNaN(entry) && !isNaN(stop) && !isNaN(pos) && entry !== 0) {
        const risk = pos * Math.abs(entry - stop) / entry;
        raEl.textContent = '预览 ' + risk.toFixed(2) + ' USDT';
        raEl.style.display = 'block';
      } else { raEl.style.display = 'none'; }
    }
    // 保证金
    const mgEl = document.getElementById('emMarginPreview');
    if (mgEl) {
      if (!isNaN(pos)) {
        const margin = (!isNaN(lev) && lev > 0) ? pos / lev : pos;
        mgEl.textContent = '预览 保证金 ' + margin.toFixed(2) + ' USDT';
        mgEl.style.display = 'block';
      } else { mgEl.style.display = 'none'; }
    }
  } else {
    // ===== 已平仓交易：PnL / PnL% / R倍数 自动重算 =====
    if (window._emPnlManual) return;  // 已手动覆盖，停止自动重算
    const closePrice = num('emClosePrice');
    // 市价单使用 effectiveEntryPrice（含滑点修正），其他使用 entryPrice
    const entryForPnl = (item.effectiveEntryPrice != null && !isNaN(item.effectiveEntryPrice))
      ? item.effectiveEntryPrice : entry;
    if (isNaN(entryForPnl) || isNaN(closePrice) || isNaN(pos) || entryForPnl === 0 || closePrice <= 0) return;
    let grossPnl;
    if (direction === 'short') {
      grossPnl = (entryForPnl - closePrice) / entryForPnl * pos;
    } else {
      grossPnl = (closePrice - entryForPnl) / entryForPnl * pos;
    }
    const netPnl = grossPnl - emFee - emSlippage;
    const lev2 = (!isNaN(lev) && lev > 0) ? lev : 1;
    const margin = pos / lev2;
    const netPnlPercent = margin > 0 ? (netPnl / margin * 100) : 0;
    const pnlAmtEl = document.getElementById('emPnlAmount');
    const pnlPctEl = document.getElementById('emPnlPercent');
    const rEl = document.getElementById('emRMultiple');
    if (pnlAmtEl) pnlAmtEl.value = netPnl.toFixed(2);
    if (pnlPctEl) pnlPctEl.value = netPnlPercent.toFixed(2) + '%';
    const riskAmount = parseFloat((document.getElementById('emRiskAmount') || {}).value);
    if (rEl && !isNaN(riskAmount) && riskAmount !== 0) {
      rEl.value = (netPnl / riskAmount).toFixed(2);
    }
  }
}
window.emRecalc = emRecalc;

function emUpdateStars(score) {
  window._emMindsetScore = score;
  const stars = document.querySelectorAll('#editModal .star-rating-modal .star');
  stars.forEach(s => s.classList.toggle('active', parseInt(s.dataset.val) <= score));
  const lbl = document.getElementById('emMindsetLabel');
  if (lbl) lbl.textContent = MINDSET_LABELS[score] || '';
}
window.emUpdateStars = emUpdateStars;

// ==================== 执行评分更新（编辑弹窗） ====================
function emUpdateExecScore() {
  const score = (document.getElementById('emExecPlanEntry')?.checked ? 1 : 0) +
                (document.getElementById('emExecStopLoss')?.checked ? 1 : 0) +
                (document.getElementById('emExecPlanExit')?.checked ? 1 : 0);
  const display = document.getElementById('emExecScoreDisplay');
  if (display) display.textContent = score + '/3';
}
window.emUpdateExecScore = emUpdateExecScore;

// ==================== 执行评分更新（平仓面板） ====================
function cpUpdateExecScore(idx) {
  const container = document.getElementById('cpExecChecks_' + idx);
  if (!container) return;
  const score = container.querySelectorAll('input[type="checkbox"]:checked').length;
  const display = document.getElementById('cpExecScore_' + idx);
  if (display) {
    display.textContent = score;
    display.style.color = score === 0 ? 'var(--color-danger)' : score === 1 ? 'var(--color-warning)' : 'var(--color-success)';
  }
}
window.cpUpdateExecScore = cpUpdateExecScore;

// ==================== MAE/MFE 极值价格计算 + 智能解读 ====================
function calcMAEMFE(idx) {
  const item = logs[idx];
  if (!item || !item.entryPrice || !item.direction) return;
  // 使用 effectiveEntryPrice（含入场滑点）作为基准，与 storeMAEMFE 口径一致
  const entry = (item.effectiveEntryPrice != null && !isNaN(parseFloat(item.effectiveEntryPrice)))
    ? parseFloat(item.effectiveEntryPrice)
    : parseFloat(item.entryPrice);
  if (isNaN(entry) || entry <= 0) return;

  const lowEl = document.getElementById('cpLowPrice_' + idx);
  const highEl = document.getElementById('cpHighPrice_' + idx);
  const displayEl = document.getElementById('cpMAEMFEDisplay_' + idx);
  const interpEl = document.getElementById('cpMAEMFEInterpret_' + idx);

  const lowVal = lowEl && lowEl.value !== '' ? parseFloat(lowEl.value) : null;
  const highVal = highEl && highEl.value !== '' ? parseFloat(highEl.value) : null;

  if (lowVal == null && highVal == null) {
    if (displayEl) displayEl.style.display = 'none';
    if (interpEl) interpEl.style.display = 'none';
    return;
  }

  let mae, mfe;
  if (item.direction === 'long') {
    mae = lowVal != null ? ((lowVal - entry) / entry * 100) : null;
    mfe = highVal != null ? ((highVal - entry) / entry * 100) : null;
  } else {
    mae = highVal != null ? ((entry - highVal) / entry * 100) : null;
    mfe = lowVal != null ? ((entry - lowVal) / entry * 100) : null;
  }

  const ratio = (mae != null && mfe != null && mae !== 0) ? Math.abs(mfe / mae) : null;

  // Display
  let displayHTML = '';
  if (mae != null) {
    displayHTML += '<span style="color:var(--color-danger);font-weight:600;">MAE ' + mae.toFixed(2) + '%</span>';
  }
  if (mfe != null) {
    if (displayHTML) displayHTML += '&nbsp;&nbsp;';
    displayHTML += '<span style="color:var(--color-success);font-weight:600;">MFE ' + mfe.toFixed(2) + '%</span>';
  }
  if (ratio != null) {
    displayHTML += '&nbsp;&nbsp;<span style="color:var(--color-text-muted);">MFE/MAE ' + ratio.toFixed(2) + '</span>';
  }
  if (displayEl) {
    displayEl.innerHTML = displayHTML;
    displayEl.style.display = 'block';
  }

  // Interpretation
  let lines = [];
  // --- 入场时机 ---
  if (mae != null) {
    if (item.direction === 'long') {
      if (mae > -1) lines.push('入场精准，回撤极小');
      else if (mae >= -3) lines.push('入场时机尚可');
      else lines.push('入场过早，回撤较大');
    } else {
      if (mae > -1) lines.push('入场精准，回撤极小');
      else if (mae >= -3) lines.push('入场时机尚可');
      else lines.push('入场过早，回撤较大');
    }
  }
  // --- 持仓管理 ---
  if (ratio != null) {
    if (ratio > 2) lines.push('持仓管理优秀，浮盈远大于浮亏');
    else if (ratio >= 1) lines.push('持仓管理一般');
    else lines.push('浮亏大于浮盈，需优化出场时机');
  }
  // --- 利润捕捉 ---（需要实际盈亏）
  if (mfe != null && mfe !== 0 && item.pnlAmount != null) {
    const pnlPct = parseFloat(item.pnlAmount);
    const margin = item.positionSize ? (parseFloat(item.positionSize) / (parseFloat(item.leverage) || 1)) : null;
    let actualPnlPct = null;
    if (margin && margin > 0) actualPnlPct = pnlPct / margin * 100;
    if (actualPnlPct != null) {
      const captureRatio = actualPnlPct / mfe;
      if (captureRatio > 0.7) lines.push('利润捕捉充分');
      else if (captureRatio < 0.3) lines.push('利润回吐过多，考虑分批止盈');
    }
  }
  if (interpEl) {
    interpEl.innerHTML = lines.length ? lines.join(' &middot; ') : '';
    interpEl.style.display = lines.length ? 'block' : 'none';
  }
}
window.calcMAEMFE = calcMAEMFE;

function saveEditLog(idx) {
  const item = logs[idx];
  if (!item) return;

  function gv(id) { const el = document.getElementById(id); return el ? el.value : undefined; }
  function gn(id) { const el = document.getElementById(id); if (!el) return undefined; const v = parseFloat(el.value); return isNaN(v) ? null : v; }

  window._emMindsetScore = window._emMindsetScore ?? item.mindsetScore ?? 3;

  // 多标签页竞态检测：若日志引用在打开后已被替换，弹窗确认
  if (window._emSnapshotItem && logs[idx] !== window._emSnapshotItem) {
    if (!confirm('该日志已被外部修改，确定用当前编辑内容覆盖？')) return;
  }

  let v;
  v = gv('emSymbol'); if (v !== undefined) item.symbol = v;
  v = gv('emDirection'); if (v !== undefined) item.direction = v;
  v = gv('emOrderType'); if (v !== undefined) item.orderType = v;
  v = gv('emStopType'); if (v !== undefined) item.stopType = v;
  v = gn('emEntryPrice'); if (v !== undefined && v !== null) item.entryPrice = v;
  v = gn('emStopLoss'); if (v !== undefined && v !== null) item.stopLoss = v;
  v = gn('emTargetPrice'); if (v !== undefined && v !== null) item.targetPrice = v;
  v = gn('emPositionSize'); if (v !== undefined && v !== null) item.positionSize = v;
  v = gn('emLeverage'); if (v !== undefined && v !== null) item.leverage = v;
  v = gn('emRiskAmount'); if (v !== undefined && v !== null) item.riskAmount = v;
  item.mindsetScore = window._emMindsetScore;
  v = gv('emStrategyFramework'); if (v !== undefined) item.strategyFramework = v;
  v = gv('emStrategyPattern'); if (v !== undefined) item.strategyPattern = v;

  // 信号K checkboxes（仅限信号K线确认容器，避免误收集执行评分/亏损原因复选框）
  const checkboxes = document.querySelectorAll('#emSignalGroup input[type="checkbox"]');
  const signals = [];
  checkboxes.forEach(cb => { if (cb.checked) signals.push(cb.value); });
  item.signals = signals;

  v = gv('emCloseType'); if (v !== undefined) item.closeType = v;
  v = gn('emClosePrice'); if (v !== undefined && v !== null) item.closePrice = v;
  // 编辑平仓数据时，若尚未有 closeTime 则自动写入
  if (item.closeType && !item.closeTime) {
    item.closeTime = new Date().toISOString();
    // holdDuration 计算防御：time 无效时不写入
    if (item.time && !isNaN(new Date(item.time).getTime()) && !isNaN(new Date(item.closeTime).getTime())) {
      var durMin = Math.round((new Date(item.closeTime) - new Date(item.time)) / 60000);
      item.holdDuration = durMin >= 0 ? durMin : null;
    }
  }
  v = gv('emRMultiple'); if (v !== undefined && v !== '') { var rm = parseFloat(v); item.rMultiple = isNaN(rm) ? null : rm; } else if (document.getElementById('emRMultiple')?.value === '') item.rMultiple = null;
  v = gv('emPnlAmount'); if (v !== undefined && v !== '') { var pnlVal = parseFloat(v); item.pnlAmount = isNaN(pnlVal) ? null : pnlVal; } else if (document.getElementById('emPnlAmount')?.value === '') item.pnlAmount = null;
  v = gv('emPnlPercent'); if (v !== undefined && v !== '') { var pnlPct = parseFloat(v); item.pnlPercent = isNaN(pnlPct) ? null : pnlPct; } else if (document.getElementById('emPnlPercent')?.value === '') item.pnlPercent = null;
  v = gn('emFee'); if (v !== undefined && v !== null) item.fee = v;
  v = gn('emSlippageCost'); if (v !== undefined && v !== null) item.slippageCost = v;
  v = gv('emCloseNote'); if (v !== undefined) item.closeNote = v;
  v = gv('emReason'); if (v !== undefined) item.reason = v;
  // Execution score
  item.executionScore = (document.getElementById('emExecPlanEntry')?.checked ? 1 : 0) +
                        (document.getElementById('emExecStopLoss')?.checked ? 1 : 0) +
                        (document.getElementById('emExecPlanExit')?.checked ? 1 : 0);
  // MAE / MFE — 从极值价格计算百分比
  v = gn('emLowPrice'); if (v !== undefined) item.lowPrice = v; else if (document.getElementById('emLowPrice')?.value === '') item.lowPrice = null;
  v = gn('emHighPrice'); if (v !== undefined) item.highPrice = v; else if (document.getElementById('emHighPrice')?.value === '') item.highPrice = null;
  storeMAEMFE(item);
  // Loss reason
  var lrEl = document.getElementById('emLossReason');
  if (lrEl) {
    var cbs = lrEl.querySelectorAll('input[type="checkbox"]:checked');
    var reasons = Array.from(cbs).map(function(cb) { return cb.value; });
    item.lossReason = reasons;
  }

  // Emotions
  var emEl = document.getElementById('emEmotions');
  if (emEl) {
    var emCbs = emEl.querySelectorAll('input[type="checkbox"]:checked');
    var ems = Array.from(emCbs).map(function(cb) { return cb.value; });
    item.emotions = ems.length > 0 ? ems : null;
  }
  // L3: session & marketCondition; M3: exitReason
  v = gv('emSession'); if (v !== undefined) item.session = v;
  v = gv('emMarketCondition'); if (v !== undefined) item.marketCondition = v;
  v = gv('emExitReason'); if (v !== undefined) item.exitReason = v;

  // 平仓价格空值校验（基于 item.closePrice 原值，不依赖 DOM 空字符串误判）
  if (item.closeType && (item.closePrice == null || isNaN(item.closePrice) || item.closePrice <= 0)) {
    showToast('平仓价格不能为空','warn');
    return;
  }
  // 平仓时间空值校验
  if (item.closeType && !item.closeTime) {
    showToast('平仓时间不能为空','warn');
    return;
  }
  // 亏损单必须选择亏损原因（扩展：pnlAmount<0 || manualLoss || 实时 netPnl<0）
  // 市价单使用 effectiveEntryPrice（含滑点修正），与 emRecalc 实时预览口径一致
  const rawEntryPrice = gn('emEntryPrice');
  const entryForPnl = (item.effectiveEntryPrice != null && !isNaN(parseFloat(item.effectiveEntryPrice)))
    ? parseFloat(item.effectiveEntryPrice)
    : rawEntryPrice;
  const closePrice = gn('emClosePrice');
  const positionSize = parseFloat(document.getElementById('emPositionSize')?.value) || 0;
  const direction = document.getElementById('emDirection')?.value || item.direction;
  const fee = gn('emFee') || 0;
  const slippageCost = gn('emSlippageCost') || 0;

  let realTimeNetPnl = null;
  if (closePrice != null && entryForPnl != null && entryForPnl > 0) {
    let grossPnl;
    if (direction === 'short') grossPnl = (entryForPnl - closePrice) / entryForPnl * positionSize;
    else grossPnl = (closePrice - entryForPnl) / entryForPnl * positionSize;
    realTimeNetPnl = grossPnl - fee - slippageCost;
  }
  const isLoss = item.closeType && (
    (item.pnlAmount != null && parseFloat(item.pnlAmount) < 0) ||
    item.closeType === 'manualLoss' ||
    item.closeType === 'liquidation' ||
    (realTimeNetPnl != null && realTimeNetPnl < 0)
  );
  if (isLoss) {
    var lrEl2 = document.getElementById('emLossReason');
    var cbs = lrEl2 ? lrEl2.querySelectorAll('input[type="checkbox"]:checked') : [];
    if (cbs.length === 0) {
      showToast('亏损单请至少选择一个亏损原因', 'warn');
      if (lrEl2) { lrEl2.style.border = '1px solid var(--color-danger)'; lrEl2.style.borderRadius = '4px'; lrEl2.style.padding = '4px'; }
      return;
    }
  }
  closeEditModal();
  saveLogs();
}
window.saveEditLog = saveEditLog;

// ==================== 拆分保存 ====================
function saveSplit() {
  const calc = window._lastCalc;
  if (!calc || !calc.positionSize || calc.positionSize <= 0) { showToast('请先点击「计算仓位」生成有效数据','warn'); return; }

  // 创建内嵌 prompt 替代原生 prompt
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-content" style="max-width:400px;">' +
    '<div class="modal-header"><h3>拆分保存</h3><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="fp"><label>拆分为几笔？</label>' +
      '<input type="number" id="splitCountInput" min="2" max="10" value="2" />' +
      '</div></div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-primary" id="splitConfirmBtn">确定</button>' +
      '<button class="btn btn-outline" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
    '</div></div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  setTimeout(() => { const inp = document.getElementById('splitCountInput'); if (inp) inp.focus(); }, 50);

  document.getElementById('splitConfirmBtn').addEventListener('click', function() {
    const n = document.getElementById('splitCountInput').value;
    const count = parseInt(n);
    if (isNaN(count) || count < 2 || count > 10) { showToast('请输入 2~10 之间的数字','warn'); return; }
    overlay.remove();
    doSaveSplit(calc, count);
  });
}

function doSaveSplit(calc, count) {
  // P1-3: 入场价必须有效
  if (!calc || !calc.entryPrice || calc.entryPrice <= 0) { showToast('入场价格无效，无法拆分保存', 'warn'); return; }
  const groupId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  // 前 count-1 笔用除法取整，最后一笔用差值补足以防浮点精度丢失
  const splitPos = parseFloat((calc.positionSize / count).toFixed(2));
  const remainderPos = parseFloat((calc.positionSize - splitPos * (count - 1)).toFixed(2));
  const fee = parseFloat(document.getElementById('feeRate').value) || 0;
  // 滑点成本统一使用与 calculator.js 相同的公式: positionSize × slippagePoints / entryPrice
  // 注意: 用户输入的 slippage 是价格点数（如 BTC 输入 1 表示 1 美元），不是 tick 数量
  const slippagePoints = parseFloat(document.getElementById('slippage').value) || 0;
  const perSlippage = slippagePoints > 0 ? (splitPos * slippagePoints / calc.entryPrice) : 0;
  const perFee = fee > 0 ? (splitPos * fee / 100 * 2) : 0;
  const remainderSlippage = slippagePoints > 0 ? (remainderPos * slippagePoints / calc.entryPrice) : 0;
  const remainderFee = fee > 0 ? (remainderPos * fee / 100 * 2) : 0;

  const now = new Date();
  const makeEntry = (pos, feeVal, slipVal, risk, groupLabel) => ({
    time: now.toISOString(),
    symbol: calc.symbol,
    direction: calc.direction,
    orderType: document.getElementById('orderType').value || 'market',
    stopType: calc.stopType || (document.getElementById('stopType')?.value || 'stop-market'),
    entryPrice: calc.entryPrice,
    effectiveEntryPrice: calc.effectiveEntryPrice,
    stopLoss: calc.stopLoss,
    targetPrice: calc.targetPrice,
    positionSize: parseFloat(pos.toFixed(2)),
    leverage: calc.leverage,
    riskAmount: parseFloat(risk.toFixed(2)),
    reason: calc.reason || getReason(),
    mindsetScore: parseInt(document.getElementById('mindsetScore').value) || 3,
    strategyFramework: document.getElementById('strategyFramework').value,
    strategyPattern: document.getElementById('strategyPattern').value,
    signals: calc.signals || getSignals(),
    closeType: '', closePrice: null, rMultiple: null, pnlAmount: null, pnlPercent: null,
    closeNote: '', fee: parseFloat(feeVal.toFixed(2)), slippageCost: parseFloat(slipVal.toFixed(2)),
    targetRR: calc.targetRR, groupId: groupId,
    groupLabel: groupLabel,
    splitEntries: [],  // F4: 记录分批明细
  });

  const splitEntries = [];
  for (let i = 0; i < count; i++) {
    const isLast = (i === count - 1);
    const pos = isLast ? remainderPos : splitPos;
    const f = isLast ? remainderFee : perFee;
    const sl = isLast ? remainderSlippage : perSlippage;
    const perRisk = calc.riskAmount / count;
    const remainderRisk = calc.riskAmount - perRisk * (count - 1);
    const risk = isLast ? remainderRisk : perRisk;
    const label = i === 0 ? '主' : ('第' + (i + 1) + '笔');
    const entry = makeEntry(pos, f, sl, risk, label);
    // F4: 记录每笔的分批信息
    splitEntries.push({
      index: i + 1,
      positionSize: parseFloat(pos.toFixed(2)),
      fee: parseFloat(f.toFixed(2)),
      slippageCost: parseFloat(sl.toFixed(2)),
      riskAmount: parseFloat(risk.toFixed(2)),
      label: label,
    });
    logs.push(entry);
  }
  // F4: 将分批明细写入刚生成的条目（最后 count 条）
  for (var li = logs.length - count; li < logs.length; li++) {
    if (logs[li]) logs[li].splitEntries = splitEntries;
  }
  openClosePanelIdx = -1;
  actionPanelIdx = -1;
  window._lastCalcDirty = false;
  saveLogs();
  showToast('拆分保存成功，共 ' + count + ' 笔', 'success');
}

function emSwitchTab(tabIndex) {
  var tabs = document.querySelectorAll('.modal-tab');
  var panels = document.querySelectorAll('.modal-tab-panel');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', i === tabIndex);
  }
  for (var i = 0; i < panels.length; i++) {
    panels[i].classList.toggle('active', i === tabIndex);
  }
}

// ==================== 过滤下拉填充 ====================
function populateFilterOptions() {
  // 品种
  var selSym = document.getElementById('fltSymbol');
  if (selSym) {
    var curVal = selSym.value;
    var symbols = [];
    for (var i = 0; i < logs.length; i++) { if (logs[i].symbol) symbols.push(logs[i].symbol); }
    symbols = Array.from(new Set(symbols)).sort();
    selSym.innerHTML = '<option value="">全部品种</option>';
    symbols.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s === curVal) opt.selected = true;
      selSym.appendChild(opt);
    });
  }
  // 策略
  var selStg = document.getElementById('fltStrategy');
  if (selStg) {
    var curVal2 = selStg.value;
    var strategies = [];
    for (var i2 = 0; i2 < logs.length; i2++) { if (logs[i2].strategyFramework) strategies.push(logs[i2].strategyFramework); }
    strategies = Array.from(new Set(strategies)).sort();
    selStg.innerHTML = '<option value="">全部策略</option>';
    strategies.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s === curVal2) opt.selected = true;
      selStg.appendChild(opt);
    });
  }
}

// ==================== 复选框样式 ====================
function updateCheckboxStyle() {
  document.querySelectorAll('#signalCheckboxes label').forEach(lbl => {
    lbl.classList.toggle('checked', lbl.querySelector('input[type="checkbox"]').checked);
  });
}
