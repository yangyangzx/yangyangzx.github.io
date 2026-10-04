// ==================== 编辑模态框 ====================

// 模态框退出：先加 .closing 播放 springOut（内容）+ overlayOut（遮罩），
// 动画结束后再移除。时长与 --dur-normal（200ms）对齐。
// 摘掉 id 防止退出动画期间重复打开同名弹窗时 getElementById 命中退场中的旧节点。
window.closeModalOverlay = function(overlay) {
  if (!overlay || overlay._closing) return;
  overlay._closing = true;
  overlay.id = '';
  overlay.classList.add('closing');
  setTimeout(function() { overlay.remove(); }, 200);
  // 焦点归还：关闭后交回触发弹窗的元素，键盘用户不会掉回 <body> 重新 Tab 一遍。
  // 用栈而非单变量——确认框会叠在编辑弹窗之上，单变量会让下层弹窗丢失来源焦点。
  // 与退出动画同时长，避免焦点落在正在淡出的节点上。
  if (!window._modalFocusStack) window._modalFocusStack = [];
  var back = window._modalFocusStack.pop();
  if (back && document.contains(back) && typeof back.focus === 'function') {
    setTimeout(function() { back.focus({ preventScroll: true }); }, 200);
  }
};

// ==================== 模态框可访问性层 ====================
// 原先弹窗无 Esc 关闭、无焦点环锁、关闭不归还焦点，键盘用户 Tab 会跑到弹窗背后的页面上。
// 这里用「单一 document 级 keydown + closeModalOverlay 收口」实现，不为每个弹窗各绑一套，
// 后续新增弹窗只要调用 modalA11yOnOpen 即可自动获得全部行为。

var _MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 取当前最上层、且未在退场动画中的弹窗
function _activeModalOverlay() {
  var list = document.querySelectorAll('.modal-overlay:not(.closing)');
  return list.length ? list[list.length - 1] : null;
}

// 可见性过滤：排除 display:none / hidden 的控件，否则 Tab 会锁进不可见元素
function _modalFocusables(root) {
  return Array.prototype.filter.call(root.querySelectorAll(_MODAL_FOCUSABLE), function(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  });
}

/**
 * 弹窗打开时调用（appendChild 之后）。
 * @param {HTMLElement} overlay 弹窗遮罩根节点
 * @param {HTMLElement} [preferred] 首选落焦元素；缺省聚焦容器本身
 */
window.modalA11yOnOpen = function(overlay, preferred) {
  if (!overlay) return;
  if (!window._modalFocusStack) window._modalFocusStack = [];
  window._modalFocusStack.push(document.activeElement);
  // 补 dialog 语义：读屏据此播报「对话框」并把后续内容隔离在弹窗内
  if (!overlay.hasAttribute('role')) overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  if (!overlay.hasAttribute('aria-label') && !overlay.hasAttribute('aria-labelledby')) {
    var titleEl = overlay.querySelector('.modal-header h3');
    if (titleEl && titleEl.textContent.trim()) {
      overlay.setAttribute('aria-label', titleEl.textContent.trim());
    }
  }
  // 容器可聚焦，作为无子控件时的兜底落点与初始焦点
  overlay.setAttribute('tabindex', '-1');
  var target = (preferred && overlay.contains(preferred)) ? preferred : overlay;
  target.focus({ preventScroll: true });
};

// Esc 关闭 + Tab 焦点环锁
document.addEventListener('keydown', function(e) {
  var overlay = _activeModalOverlay();
  if (!overlay) return;

  if (e.key === 'Escape' || e.key === 'Esc') {
    e.preventDefault();
    e.stopPropagation();
    // 触发 ✕ 而不是直接调 closeModalOverlay：
    // 这样「未保存修改」确认弹窗等各弹窗自有语义被完整保留，
    // 用户在确认框里选「取消」时弹窗正确地不关闭。
    var closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) closeBtn.click();
    else window.closeModalOverlay(overlay);
    return;
  }

  if (e.key !== 'Tab') return;

  var f = _modalFocusables(overlay);
  if (!f.length) { e.preventDefault(); overlay.focus({ preventScroll: true }); return; }

  var first = f[0], last = f[f.length - 1];
  var active = document.activeElement;

  if (e.shiftKey) {
    // 反向：在首元素（或焦点已跑到弹窗外）时绕回末尾
    if (active === first || !overlay.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last || !overlay.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
}, true);

// ==================== 自研确认对话框 ====================
// 替代原生 confirm()/alert()：原生弹窗不跟随主题与语言、样式与应用割裂，
// 部分嵌入式环境还会被直接屏蔽。复用 .modal-overlay/.modal-content 现有样式，
// 因此自动获得上面的 Esc / 焦点环锁 / 焦点归还。
//
// ⚠ 返回 Promise<boolean>，是异步的。原生 confirm 同步返回布尔值，
//    调用点必须改写控制流（把确认后的逻辑放进 then），不能直接替换。
//
// @param {Object} opts
// @param {string} [opts.title]        标题
// @param {string} [opts.message]      正文纯文本，\n 换行（内部做转义，不解析 HTML）
// @param {string} [opts.confirmText]  确认按钮文案
// @param {string} [opts.cancelText]   取消按钮文案
// @param {boolean} [opts.danger]      破坏性操作：确认按钮红色 + 默认焦点落在「取消」
// @param {boolean} [opts.alertOnly]   仅告知（等同于 alert），无取消按钮
// @returns {Promise<boolean>}
window.confirmDialog = function(opts) {
  opts = opts || {};
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    var confirmText = opts.confirmText || '确定';
    var cancelText = opts.cancelText || '取消';
    var confirmCls = opts.danger ? 'btn btn-danger' : 'btn btn-primary';

    // 按行转义后拼 <div>：不解析 HTML，避免 message 里的数据被当作标记执行
    var msgHtml = String(opts.message == null ? '' : opts.message)
      .split('\n')
      .map(function(line) { return '<div>' + esc(line) + '</div>'; })
      .join('');

    overlay.innerHTML =
      '<div class="modal-content" style="max-width:440px;">' +
        '<div class="modal-header"><h3>' + esc(opts.title || '请确认') + '</h3>' +
          '<button type="button" class="modal-close" aria-label="关闭">✕</button></div>' +
        '<div class="modal-body"><div class="confirm-dialog-msg">' + msgHtml + '</div></div>' +
        '<div class="modal-footer">' +
          (opts.alertOnly ? '' : '<button type="button" class="btn btn-outline" data-act="cancel">' + esc(cancelText) + '</button>') +
          '<button type="button" class="' + confirmCls + '" data-act="confirm">' + esc(confirmText) + '</button>' +
        '</div>' +
      '</div>';

    var settled = false;
    function finish(result) {
      if (settled) return;   // 防重复：Esc + 点击可能在同一帧内各触发一次
      settled = true;
      window.closeModalOverlay(overlay);
      resolve(result);
    }

    var cancelBtn = overlay.querySelector('[data-act="cancel"]');
    // alertOnly 无「取消」语义，✕ 与点击遮罩都等同于「知道了」
    var dismissResult = !!opts.alertOnly;
    overlay.querySelector('.modal-close').addEventListener('click', function() { finish(dismissResult); });
    if (cancelBtn) cancelBtn.addEventListener('click', function() { finish(false); });
    overlay.querySelector('[data-act="confirm"]').addEventListener('click', function() { finish(true); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) finish(dismissResult); });

    document.body.appendChild(overlay);
    window.modalA11yOnOpen(overlay, overlay.querySelector('[data-act="confirm"]'));
    // 破坏性操作默认聚焦「取消」，避免习惯性连按回车直接确认删除
    if (opts.danger && cancelBtn) cancelBtn.focus({ preventScroll: true });
  });
};

function openEditModal(idx) {
  const item = logs[idx];
  if (!item) return;
  window._emSnapshotItem = item;  // 多标签页竞态检测：保存时比对引用

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'editModal';

  const ms = item.mindsetScore || 3;
  const isTickSlippage = !!(item.slippage && item.slippage.planning && item.slippage.planning.schema === 'ticks-v1');
  const slippageLabel = isTickSlippage ? '滑点冲击（已计入有效入场价）' : '历史滑点成本';
  const slippageReadonly = isTickSlippage ? ' readonly' : '';
  window._emMindsetScore = ms;  // 打开弹窗时重置为当前项的实际值，防止跨编辑污染

  // P1 修复（2026-10-04）：编辑弹窗的平仓比例原先没有标注基数，保存侧却一直按
  // 「占开仓原始仓位」解读（positionSize = initialPositionSize × (1−比例)），
  // 而记录侧 logs.js 的输入是「占当前剩余仓位」。2 次及以上部分平仓时两套基数不同，
  // 用户不改任何值直接保存就会把剩余仓位算错。现改为弹窗内显式选基数，默认与记录侧
  // 一致（剩余仓位）；预填值按所选基数取 closes[] 最后一条分批事件的对应字段，
  // 两种口径都能还原用户当初输入的那个数字。
  var _PARTIAL_TYPES_EDIT = ['partialTP', 'reducePosition'];
  var _lastPartialEvt = null;
  if (Array.isArray(item.closes)) {
    for (var _pe = item.closes.length - 1; _pe >= 0; _pe--) {
      if (_PARTIAL_TYPES_EDIT.indexOf(item.closes[_pe].type) >= 0) { _lastPartialEvt = item.closes[_pe]; break; }
    }
  }
  // 旧数据（v5.6.7 之前）没有 ratioOfRemaining，回退 item.partialRatio
  var _prefillRemaining = (_lastPartialEvt && _lastPartialEvt.ratioOfRemaining != null)
    ? _lastPartialEvt.ratioOfRemaining
    : (item.partialRatio != null ? item.partialRatio : '');
  var _prefillInitial = (_lastPartialEvt && _lastPartialEvt.ratio != null)
    ? _lastPartialEvt.ratio
    : (item.partialRatio != null ? item.partialRatio : '');
  // 切基数时同步换成该基数下的数值，避免用户切完口径还对着旧数字
  window._emPartialPrefills = { remaining: _prefillRemaining, initial: _prefillInitial };

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
        '<div class="fp span-2"><label>入场原因<span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（可选·多选）</span></label>' +
          '<div class="checkbox-group" id="emEntryReason" style="flex-wrap:wrap;gap:4px 12px;">' +
            (function makeEntryReasonCheckboxes(selected) {
              var arr = Array.isArray(selected) ? selected : (typeof selected === 'string' && selected ? [selected] : []);
              var h = '';
              ENTRY_REASON_OPTIONS.forEach(function(r) {
                h += '<label style="font-size:13px;color:var(--color-text);white-space:nowrap;"><input type="checkbox" value="' + r + '"' + (arr.indexOf(r) !== -1 ? ' checked' : '') + ' /> ' + r + '</label>';
              });
              return h;
            }(item.reason)) +
          '</div></div>' +
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
        '<div class="fp" id="emPartialRatioRow" style="display:' + ((item.closeType === 'partialTP' || item.closeType === 'reducePosition') ? 'block' : 'none') + ';">' +
          '<label>平仓比例 (%)<span style="font-size:11px;color:var(--color-text-muted);margin-left:4px;">口径：<label style="display:inline;font-weight:400;font-size:11px;cursor:pointer;"><input type="radio" name="emPartialRatioBase" value="remaining" checked onchange="emSwitchRatioBase()" /> 剩余仓位</label> <label style="display:inline;font-weight:400;font-size:11px;cursor:pointer;"><input type="radio" name="emPartialRatioBase" value="initial" onchange="emSwitchRatioBase()" /> 原始仓位</label></span></label>' +
          '<input type="number" id="emPartialRatio" step="5" min="1" max="100" value="' + _prefillRemaining + '" placeholder="如 50 表示平仓 50%" />' +
        '</div>' +
        '<div class="fp"><label>平仓价</label><input type="number" id="emClosePrice" step="0.00001" value="' + (item.closePrice ?? '') + '" /></div>' +
        '<div class="fp"><label>R倍数</label><input type="text" id="emRMultiple" value="' + (item.rMultiple ?? '') + '" /></div>' +
        '<div class="fp"><label>盈亏金额</label><input type="text" id="emPnlAmount" value="' + (item.pnlAmount ?? '') + '" /><span id="emPnlManualTag" style="display:none;font-size:10px;color:var(--color-warning);margin-left:4px;">手动</span></div>' +
        '<div class="fp"><label>盈亏百分比 <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（保证金回报率）</span></label><input type="text" id="emPnlPercent" value="' + (item.pnlPercent ?? '') + '" /></div>' +
        '<div class="fp"><label>手续费</label><input type="text" id="emFee" value="' + (item.fee ?? '') + '" /></div>' +
        '<div class="fp"><label>' + slippageLabel + '</label><input type="text" id="emSlippageCost" value="' + (item.slippageCost ?? '') + '"' + slippageReadonly + ' /></div>' +
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
          '<span id="emExecScoreDisplay" style="margin-left:8px;font-weight:700;font-size:14px;color:var(--color-text-muted);">' + (item.executionScore != null ? item.executionScore + '/3' : '未评分') + '</span>' +
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
  window.modalA11yOnOpen(modal);   // 记录来源焦点 + dialog 语义 + 焦点环锁

  // ===== 未保存修改标志 & 字段联动重算 =====
  window._editDirty = false;
  var _pnlHasValue = item.closeType && item.closeType !== '' && item.pnlAmount != null && !isNaN(parseFloat(item.pnlAmount));
  window._emPnlManual = _pnlHasValue;  // 已平仓且 PnL 已有值 → 禁止自动重算覆盖

  // Diff-based dirty detection: store initial values from DOM
  // 捕获动作见下方 emRecalc(item) 之后——必须在 emRecalc 之后捕获，因为 emRecalc 会覆写 PnL/R 字段

  // Check dirty before close
  window.emCheckDirty = function() {
    const ids = ['emSymbol','emDirection','emOrderType','emEntryPrice','emStopLoss','emTargetPrice',
      'emPositionSize','emLeverage','emRiskAmount','emStrategyFramework','emStrategyPattern',
      'emCloseType','emClosePrice','emRMultiple','emPnlAmount','emPnlPercent','emFee','emSlippageCost',
      'emCloseNote','emSession','emMarketCondition','emExitReason','emLowPrice','emHighPrice'];
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
    var ecr = (function() {
      var cbs = document.querySelectorAll('#emEntryReason input[type="checkbox"]');
      var arr = []; cbs.forEach(function(cb) { arr.push(cb.checked ? cb.value : ''); }); return arr.join(',');
    })();
    if (ecr !== _emInitValues['emEntryReason']) { window._editDirty = true; return; }
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

  // Diff-based dirty detection: 捕获初始值（必须在 emRecalc 之后，否则 _emInitValues 记录的是
  // emRecalc 覆写前的空值，emCheckDirty 会把自动填充误判为"用户修改"，取消时误报未保存）
  const _emInitValues = {};
  (function captureInit() {
    const ids = ['emSymbol','emDirection','emOrderType','emEntryPrice','emStopLoss','emTargetPrice',
      'emPositionSize','emLeverage','emRiskAmount','emStrategyFramework','emStrategyPattern',
      'emCloseType','emClosePrice','emRMultiple','emPnlAmount','emPnlPercent','emFee','emSlippageCost',
      'emCloseNote','emSession','emMarketCondition','emExitReason','emLowPrice','emHighPrice'];
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
    _emInitValues['emEntryReason'] = (function() {
      const cbs = document.querySelectorAll('#emEntryReason input[type="checkbox"]');
      const arr = []; cbs.forEach(function(cb) { arr.push(cb.checked ? cb.value : ''); }); return arr.join(',');
    })();
  })();
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
  // 初始化所有 checkbox-group 的视觉状态
  updateCheckboxStyle();
}

function _doCloseEditModal() {
  const modal = document.getElementById('editModal');
  if (modal) window.closeModalOverlay(modal);
  window._editDirty = false;
  // 清理事件监听器，防止重复绑定
  if (window._emRecalcCleanup) { window._emRecalcCleanup(); window._emRecalcCleanup = null; }
}

function closeEditModal(force) {
  // force=true 仅在「保存成功」路径使用，跳过脏检查直接关闭（保持同步，行为不变）；
  // 其余调用点（✕ / 取消 / 点击遮罩 / Esc）不传参，保留未保存确认语义。
  if (!force && window.emCheckDirty) window.emCheckDirty();
  if (!force && window._editDirty) {
    // 自研对话框为异步：确认后才继续关闭。放弃修改属破坏性操作，用红色确认钮。
    window.confirmDialog({
      title: '放弃未保存的修改？',
      message: '本笔日志有未保存的改动，关闭后这些改动会丢失。',
      confirmText: '放弃并关闭',
      danger: true
    }).then(function(ok) { if (ok) _doCloseEditModal(); });
    return;
  }
  _doCloseEditModal();
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
  // 分批比例行随平仓类型显隐。该行可见性此前只在弹窗构建时按记录的初始 closeType
  // 定一次：用户在弹窗内把类型改成 部分止盈/减仓 时字段仍是隐藏的，而 saveEditLog
  // 会校验该比例——看不见的必填项会把人卡在"无法保存"上。
  var _ctEl = document.getElementById('emCloseType');
  if (_ctEl) {
    var _ctHandler = function() {
      var _row = document.getElementById('emPartialRatioRow');
      var _v = _ctEl.value;
      if (_row) _row.style.display = (_v === 'partialTP' || _v === 'reducePosition') ? 'block' : 'none';
    };
    _ctEl.addEventListener('change', _ctHandler);
    _emRecalcListeners.push({ el: _ctEl, type: 'change', handler: _ctHandler });
  }
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
  var emSlippage = (item.slippage && item.slippage.planning && item.slippage.planning.schema === 'ticks-v1')
    ? 0
    : (parseFloat((document.getElementById('emSlippageCost') || {}).value) || 0);
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
    // P0 修复：已全部平仓（positionSize<=0）时无剩余仓位可重算，保留整笔累计显示，避免预览出"-费用"
    if (isNaN(entryForPnl) || isNaN(closePrice) || isNaN(pos) || pos <= 0 || entryForPnl === 0 || closePrice <= 0) return;
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
    // 设计优化：R 倍数基准统一用"初始风险"（部分平仓后 riskAmount 被缩减，直接用它会导致 R 漂移）
    var riskBase = (item.initialRiskAmount != null && !isNaN(parseFloat(item.initialRiskAmount)) && parseFloat(item.initialRiskAmount) > 0)
      ? parseFloat(item.initialRiskAmount)
      : parseFloat((document.getElementById('emRiskAmount') || {}).value);
    if (rEl && !isNaN(riskBase) && riskBase !== 0) {
      rEl.value = (netPnl / riskBase).toFixed(2);
    }
  }
}
window.emRecalc = emRecalc;

function emUpdateStars(score) {
  window._emMindsetScore = score;
  const stars = document.querySelectorAll('#editModal .star-rating-modal .star');
  stars.forEach(s => s.classList.toggle('active', parseInt(s.dataset.val, 10) <= score));
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

// ==================== 平仓比例基数切换（编辑弹窗） ====================
// 切换「剩余仓位 / 原始仓位」口径时，把输入框换成该口径下对应的历史值。
// 两个口径的数值都来自 closes[] 最后一条分批事件（ratioOfRemaining / ratio），
// 不换算——换算是保存时的事（见 saveEditLog 的 closedRatioDelta）。
function emSwitchRatioBase() {
  var el = document.getElementById('emPartialRatio');
  if (!el) return;
  var sel = document.querySelector('input[name="emPartialRatioBase"]:checked');
  var key = sel ? sel.value : 'remaining';
  var pf = window._emPartialPrefills || {};
  var v = pf[key];
  el.value = (v === undefined || v === null || v === '') ? '' : v;
}
window.emSwitchRatioBase = emSwitchRatioBase;

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

function rebuildTickSlippageSnapshot(item) {
  var oldPlanning = item && item.slippage && item.slippage.planning;
  if (!oldPlanning || oldPlanning.schema !== 'ticks-v1') return false;
  var entryPrice = Number(item.entryPrice);
  var positionSize = Number(item.positionSize);
  var tickSize = Number(oldPlanning.tickSize);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(positionSize) || positionSize <= 0 || !Number.isFinite(tickSize) || tickSize <= 0) return false;
  if (item.direction !== 'long' && item.direction !== 'short') return false;
  var effectiveEntry = Slippage.applyAdversePrice(entryPrice, item.direction, Number(oldPlanning.entryTicks) || 0, tickSize, 'entry').filledPrice;
  var quantity = positionSize / effectiveEntry;
  function snapshot(exitPrice) {
    if (!Number.isFinite(Number(exitPrice)) || Number(exitPrice) <= 0) return null;
    return Slippage.toLogSnapshot(Slippage.calculate({
      direction: item.direction,
      expectedEntryPrice: entryPrice,
      expectedExitPrice: Number(exitPrice),
      quantity: quantity,
      tickSize: tickSize,
      entryTicks: Number(oldPlanning.entryTicks) || 0,
      exitTicks: Number(oldPlanning.exitTicks) || 0
    }), { source: oldPlanning.source || 'edit-repriced' });
  }
  var atStop = snapshot(item.stopLoss);
  var atTarget = snapshot(item.targetPrice);
  var planning = atTarget || atStop;
  if (!planning) return false;
  var feeRate = Number(item.feeRate);
  if (!Number.isFinite(feeRate) || feeRate < 0) {
    var oldQty = Number(oldPlanning.quantity) || (positionSize / Number(oldPlanning.effectiveEntryPrice || effectiveEntry));
    var oldNotional = oldQty * (Number(oldPlanning.effectiveEntryPrice) + Number(oldPlanning.effectiveExitPrice));
    feeRate = oldNotional > 0 ? (Number(item.fee) || 0) / oldNotional * 100 : 0;
  }
  item.effectiveEntryPrice = planning.effectiveEntryPrice;
  item.slippage = { planning: planning, atStop: atStop, atTarget: atTarget };
  item.slippageCost = planning.totalCost;
  item.feeRate = feeRate;
  item.fee = calcRoundTripFee(quantity, planning.effectiveEntryPrice, planning.effectiveExitPrice, feeRate);
  item.executionSnapshotUpdatedAt = new Date().toISOString();
  return true;
}

// _raceConfirmed：仅由下面的竞态确认对话框回调用 true 重入，
// 用于绕过自身守卫。这样无需把整个函数体包进 Promise.then，函数体保持同步。
function saveEditLog(idx, _raceConfirmed) {
  const item = logs[idx];
  if (!item) return;
  const beforeEdit = JSON.parse(JSON.stringify(item));

  function gv(id) { const el = document.getElementById(id); return el ? el.value : undefined; }
  function gn(id) { const el = document.getElementById(id); if (!el) return undefined; const v = parseFloat(el.value); return isNaN(v) ? null : v; }

  window._emMindsetScore = window._emMindsetScore ?? item.mindsetScore ?? 3;

  // 多标签页竞态检测：若日志引用在打开后已被替换，弹窗确认。
  // 用重入而非 async 包裹：确认后以 _raceConfirmed=true 再调一次本函数，
  // 守卫被绕过，其余同步逻辑原样执行。
  if (!_raceConfirmed && window._emSnapshotItem && logs[idx] !== window._emSnapshotItem) {
    window.confirmDialog({
      title: '该日志已被外部修改',
      message: '这条日志在编辑期间被其他标签页改动过。\n继续保存会用当前弹窗里的内容覆盖外部改动。',
      confirmText: '覆盖保存',
      danger: true
    }).then(function(ok) { if (ok) saveEditLog(idx, true); });
    return;
  }

  let v;
  // 半途失败统一回滚：函数前半段已把表单字段逐个写进 item，直接 return 会留下
  // 「一半新值一半旧值」的半污染状态（例如比例越界被拒时 closeType 已变成「分批」）。
  function abortSave(msg, level) {
    Object.assign(item, beforeEdit);
    showToast(msg, level || 'warn');
    return false;
  }
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
  // v5.6.9：emFee 必须在这一步读，不能放在部分平仓重算之后。原先 fee 在
  // 「原始费用×剩余占比」重算完之后又被 emFee 的旧值覆盖回去，缩减结果等于白算。
  v = gn('emFee'); if (v !== undefined && v !== null) item.fee = v;
  item.mindsetScore = window._emMindsetScore;
  v = gv('emStrategyFramework'); if (v !== undefined) item.strategyFramework = v;
  v = gv('emStrategyPattern'); if (v !== undefined) item.strategyPattern = v;

  // 信号K checkboxes（仅限信号K线确认容器，避免误收集执行评分/亏损原因复选框）
  const checkboxes = document.querySelectorAll('#emSignalGroup input[type="checkbox"]');
  const signals = [];
  checkboxes.forEach(cb => { if (cb.checked) signals.push(cb.value); });
  item.signals = signals;

  v = gv('emCloseType'); if (v !== undefined) item.closeType = v;
  // P0-3 FIX: partialTP/reducePosition 时记录平仓比例并更新剩余仓位
  var _isPartialClose = item.closeType === 'partialTP' || item.closeType === 'reducePosition';
  var ratioEl = document.getElementById('emPartialRatio');
  var partialRatio = ratioEl ? parseFloat(ratioEl.value) : NaN;
  // P1 修复（2026-10-03）：比例越界直接拒绝保存。input 的 min="1" max="100" 只在表单提交
  // 时生效，程序读取不会被拦；此前会静默保存成 closeType=分批但无有效比例，isClosedTrade
  // 转而看 closedRatio，于是这笔交易落在"既没平完也没平"的悬空状态。
  if (_isPartialClose && !(partialRatio > 0 && partialRatio < 100)) {
    return abortSave('分批平仓比例需在 1-99 之间');
  }
  if (_isPartialClose) {
    // v5.6.9 P1 修复（基数语义）：编辑路径此前把同一个输入值同时当「相对剩余仓位的削减
    // 比例」和「原始仓位的簿记增量」用，两者只在第一次部分平仓时相等。复现：原始 1000 →
    // 第一次平 50%（closedRatio=50，剩 500）→ 第二次平剩余的 50%（closes 里 ratio=25，
    // closedRatio=75，剩 250）。此时编辑这条记录，输入框按剩余口径预填 50，按原逻辑算出
    // positionSize = 1000 × (1−25/100) = 750 —— 把已经平掉的 500 单位敞口凭空算回账面，
    // 正确值应是 250。
    // 现按口径显式换算：编辑对象是「最后一次部分平仓事件」，其输入换算基准是该事件
    // 发生前的剩余仓位，而闭合后的仓位按累计 closedRatio 还原。换算权威实现在
    // utils.closedRatioDelta（此处用等价的 fracBeforeEvt 标量形式）。
    var _PARTIAL_TYPES_EDIT2 = ['partialTP', 'reducePosition'];
    var _partialsNow = Array.isArray(item.closes)
      ? item.closes.filter(function(c) { return _PARTIAL_TYPES_EDIT2.indexOf(c.type) >= 0; })
      : [];
    // 编辑前累计已平（含最后一条事件自身）——用于从当前仓位反推原始仓位
    var cumClosedOld = 0;
    for (var _ci0 = 0; _ci0 < _partialsNow.length; _ci0++) {
      cumClosedOld += (parseFloat(_partialsNow[_ci0].ratio) || 0);
    }
    // 编辑前累计已平（排除最后一条事件）——最后一次事件发生时的剩余基数
    var cumClosedBeforeEvt = 0;
    for (var _ci1 = 0; _ci1 < _partialsNow.length - 1; _ci1++) {
      cumClosedBeforeEvt += (parseFloat(_partialsNow[_ci1].ratio) || 0);
    }
    if (_partialsNow.length === 0) {   // 无事件簿记（旧数据 / CSV 导入）：退回 closedRatio
      cumClosedOld = cumClosedBeforeEvt = parseFloat(item.closedRatio) || 0;
    }
    if (!isFinite(cumClosedOld) || cumClosedOld < 0) cumClosedOld = 0;
    if (cumClosedOld > 100) cumClosedOld = 100;
    if (!isFinite(cumClosedBeforeEvt) || cumClosedBeforeEvt < 0) cumClosedBeforeEvt = 0;
    if (cumClosedBeforeEvt > 100) cumClosedBeforeEvt = 100;
    var fracOld = 1 - cumClosedOld / 100;
    var fracBeforeEvt = 1 - cumClosedBeforeEvt / 100;
    var _baseModeEl = document.querySelector('input[name="emPartialRatioBase"]:checked');
    var _baseMode = (_baseModeEl && _baseModeEl.value === 'initial') ? 'initial' : 'remaining';
    var deltaOriginal = (_baseMode === 'initial')
      ? partialRatio                      // 已按原始仓位计，直接入簿记
      : partialRatio * fracBeforeEvt;      // 「占剩余仓位」→ 换算成原始仓位增量
    deltaOriginal = parseFloat(Math.max(0, Math.min(100, deltaOriginal)).toFixed(4));
    if (!(deltaOriginal > 0 && deltaOriginal < 100)) {
      return abortSave('按所选口径换算后，平仓比例需在 1-99 之间（占原始仓位计）');
    }
    var _orphanClosed = (_partialsNow.length === 0 && cumClosedBeforeEvt > 0) ? cumClosedBeforeEvt : 0;
    // P1 修复（2026-10-03）：簿记同步。confirmClose 在 logs.js 实际读的是 closedRatio/closes，
    // 不是 partialRatio —— 不写回去，下一次部分平仓会在新旧比例之间错误叠加。
    window.utils.syncCloseBookkeeping(item, item.closeType, deltaOriginal);
    // 旧数据兼容：closes[] 为空但 closedRatio>0（v5.6.1 之前的本地数据，或没有「平仓明细」
    // 列的旧版 CSV 导入）。syncCloseBookkeeping 会把本次事件当作唯一事件重建 closes，那部分
    // 历史已平比例会被丢掉，此处补回成一条历史事件，保住 sum(closes[].ratio) === closedRatio。
    if (_orphanClosed > 0) {
      item.closes.unshift({ type: item.closeType, ratio: _orphanClosed, note: '历史记录（编辑前已平仓部分）' });
      item.closedRatio = parseFloat(Math.max(0, Math.min(100,
        (parseFloat(item.closedRatio) || 0) + _orphanClosed)).toFixed(4));
    }
    // partialRatio 存用户输入（占剩余仓位口径），与 logs.js confirmClose 的存储口径一致，
    // 保证 rendering.js 行内平仓弹窗的预填值仍是人能读懂的那个数。
    item.partialRatio = partialRatio;
    // ratioOfRemaining 也要跟着换算更新：上次事件簿记是按「该事件发生前的剩余仓位」存的，
    // 用原始口径改过之后若不同步，下次打开弹窗「剩余仓位」单选项会预填成旧数字。
    var _lastEvt2 = (Array.isArray(item.closes) && item.closes.length) ? item.closes[item.closes.length - 1] : null;
    if (_lastEvt2) {
      _lastEvt2.ratioOfRemaining = (_baseMode === 'initial')
        ? (fracBeforeEvt > 0 ? parseFloat((deltaOriginal / fracBeforeEvt).toFixed(4)) : deltaOriginal)
        : partialRatio;
    }
    var cumClosed = parseFloat(item.closedRatio) || 0;
    if (!isFinite(cumClosed) || cumClosed < 0) cumClosed = 0;
    if (cumClosed > 100) cumClosed = 100;
    var fracNow = 1 - cumClosed / 100;   // 本次编辑后的剩余仓位占原始仓位的比例
    var anchor = function(current, initial, field) {
      var base = parseFloat(initial);
      if (!isFinite(base) || base <= 0) {
        base = (fracOld > 0) ? (parseFloat(current) / fracOld) : (parseFloat(current) || 0);
        if (isFinite(base) && base > 0) item[field] = base;  // 一次性补写，保证后续幂等
      }
      return base;
    };
    var basePos = anchor(item.positionSize, item.initialPositionSize, 'initialPositionSize');
    item.positionSize = parseFloat((basePos * fracNow).toFixed(2));
    // 按比例缩减风险额与保证金（同用编辑后的剩余占比，不再用单次输入值）
    var baseRisk = anchor(item.riskAmount, item.initialRiskAmount, 'initialRiskAmount');
    if (item.riskAmount != null && !isNaN(item.riskAmount)) {
      item.riskAmount = parseFloat((baseRisk * fracNow).toFixed(2));
    }
    var baseMargin = anchor(item.actualMargin, item.initialMargin, 'initialMargin');
    if (item.actualMargin != null && !isNaN(item.actualMargin)) {
      item.actualMargin = parseFloat((baseMargin * fracNow).toFixed(2));
    }
    // P1-3 FIX：编辑部分平仓时同步缩减剩余 round-trip 费用，避免最终平仓重复扣费。
    // 原始费用 = 剩余 fee + 已平仓部分 realizedFee（logs.js 累加维护），无重复计算。
    var baseFee = (parseFloat(item.fee) || 0) + (parseFloat(item.realizedFee) || 0);
    if (item.fee != null && !isNaN(item.fee)) {
      item.fee = parseFloat((baseFee * fracNow).toFixed(8));
    }
  } else {
    // P1 修复（2026-10-03）：closeType 改成非分批类型 = 断言整笔已退出，同步
    // closedRatio/closes，避免留下 closedRatio=50 + closes 非空的孤立簿记。
    // 权威实现在 utils.js（closedRatio 置 100 而非 0）。
    // closeType 为空（emCloseType 的「—」选项，即用户主动取消平仓标记）时 syncCloseBookkeeping
    // 直接不动簿记——见 utils.js 里该函数开头的护栏。
    window.utils.syncCloseBookkeeping(item, item.closeType, null);
  }
  v = gn('emClosePrice'); if (v !== undefined && v !== null) item.closePrice = v;
  // 编辑平仓数据时，若尚未有 closeTime 则自动写入
  if (item.closeType) {
    if (!item.closeTime) item.closeTime = new Date().toISOString();
    // holdDuration 始终基于 time + closeTime 重算（包含修改已有平仓记录的场景）
    if (item.time && item.closeTime) {
      var tTime = new Date(item.time).getTime();
      var tClose = new Date(item.closeTime).getTime();
      if (!isNaN(tTime) && !isNaN(tClose)) {
        var durMin = Math.round((tClose - tTime) / 60000);
        item.holdDuration = durMin >= 0 ? durMin : null;
      }
    }
  }
  v = gv('emRMultiple'); if (v !== undefined && v !== '') { var rm = parseFloat(v); item.rMultiple = isNaN(rm) ? null : rm; } else if (document.getElementById('emRMultiple')?.value === '') item.rMultiple = null;
  v = gv('emPnlAmount'); if (v !== undefined && v !== '') { var pnlVal = parseFloat(v); item.pnlAmount = isNaN(pnlVal) ? null : pnlVal; } else if (document.getElementById('emPnlAmount')?.value === '') item.pnlAmount = null;
  v = gv('emPnlPercent'); if (v !== undefined && v !== '') { var pnlPct = parseFloat(v); item.pnlPercent = isNaN(pnlPct) ? null : pnlPct; } else if (document.getElementById('emPnlPercent')?.value === '') item.pnlPercent = null;
  // emFee 已在上面（部分平仓重算之前）读过，这里不能重复读——否则会把「原始费用×剩余占比」
  // 的结果覆盖回未削减的旧值。
  v = gn('emSlippageCost'); if (v !== undefined && v !== null) item.slippageCost = v;
  v = gv('emCloseNote'); if (v !== undefined) item.closeNote = v;
  // Entry reason — multi-select checkboxes
  var erEl = document.getElementById('emEntryReason');
  if (erEl) {
    var ecbs = erEl.querySelectorAll('input[type="checkbox"]:checked');
    var erasons = Array.from(ecbs).map(function(cb) { return cb.value; });
    item.reason = erasons.length > 0 ? erasons : null;
  } else {
    v = gv('emReason'); if (v !== undefined) item.reason = v;
  }
  // Execution score — null if unreviewed, 1-3 if explicitly rated
  const emChecked = (document.getElementById('emExecPlanEntry')?.checked ? 1 : 0) +
                    (document.getElementById('emExecStopLoss')?.checked ? 1 : 0) +
                    (document.getElementById('emExecPlanExit')?.checked ? 1 : 0);
  item.executionScore = emChecked > 0 ? emChecked : null;
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

  // ticks-v1 记录的执行字段改变后必须同步重建有效入场价、各路径滑点和计划费用。
  rebuildTickSlippageSnapshot(item);
  // P0 修复（2026-09-07 实测）：部分平仓链（中间态/最终平仓）的结算字段保存整笔累计口径
  // （realizedPnl/pnlAmount），编辑时不得用"剩余仓位全量"重算覆盖——否则 pnlAmount/rMultiple/
  // grossPnlAmount 被污染且与 realizedPnl 脱节，后续统计失真；最终平仓（positionSize=0）还会
  // 被结算无效拦截导致完全无法编辑。全新平仓记录（从未部分平仓）保留自动重算（改价同步 PnL）。
  var _partialChain = (Array.isArray(item.closes) && item.closes.length > 1) ||
    (item.closeType === 'partialTP' || item.closeType === 'reducePosition') ||
    (parseFloat(item.positionSize) <= 0);
  if (item.closeType && item.closePrice != null && !_partialChain && typeof calculateCloseSettlement === 'function') {
    // BUG#6 修复：rebuildTickSlippageSnapshot 已更新 item.slippage，直接使用 item.fee 而非实际快照字段
    // 避免保存后实际CloseFee已过时导致结算结果与当前数据不一致
    var editedSettlement = calculateCloseSettlement(item, item.closePrice);
    if (!editedSettlement) {
      Object.assign(item, beforeEdit);
      showToast('编辑后的平仓结算无效，请检查价格、仓位和费用。', 'warn');
      return;
    }
    item.grossPnlAmount = parseFloat(editedSettlement.grossPnl.toFixed(2));
    item.pnlAmount = parseFloat(editedSettlement.netPnl.toFixed(2));
    item.pnlPercent = parseFloat(editedSettlement.pnlPercent.toFixed(2));
    item.rMultiple = editedSettlement.rMultiple == null ? null : parseFloat(editedSettlement.rMultiple.toFixed(2));
  }

  // 平仓价格空值校验（基于 item.closePrice 原值，不依赖 DOM 空字符串误判）
  if (item.closeType && (item.closePrice == null || isNaN(item.closePrice) || item.closePrice <= 0)) {
    return abortSave('平仓价格不能为空');
  }
  // 平仓时间空值校验
  if (item.closeType && !item.closeTime) {
    return abortSave('平仓时间不能为空');
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
  const slippageCost = (item.slippage && item.slippage.planning && item.slippage.planning.schema === 'ticks-v1')
    ? 0
    : (gn('emSlippageCost') || 0);

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
      // 先标红表单再回滚：标红是 DOM 上的提示，要留着；item 的半污染值必须撤回
      if (lrEl2) { lrEl2.style.border = '1px solid var(--color-danger)'; lrEl2.style.borderRadius = '4px'; lrEl2.style.padding = '4px'; }
      return abortSave('亏损单请至少选择一个亏损原因');
    }
  }
  // 设计优化：执行评分"止损未被移动/破坏"与极值数据矛盾校验（不阻断，仅警示）
  try {
    var _execScore = (document.getElementById('emExecPlanEntry')?.checked ? 1 : 0) +
      (document.getElementById('emExecStopLoss')?.checked ? 1 : 0) +
      (document.getElementById('emExecPlanExit')?.checked ? 1 : 0);
    var _slRaw = gn('emStopLoss');
    var _loRaw = gn('emLowPrice');
    var _hiRaw = gn('emHighPrice');
    if (_execScore >= 2 && _slRaw != null && _slRaw > 0) {
      var _dir2 = document.getElementById('emDirection')?.value || item.direction;
      if ((_dir2 === 'long' && _loRaw != null && _loRaw < _slRaw) ||
          (_dir2 === 'short' && _hiRaw != null && _hiRaw > _slRaw)) {
        showToast('⚠ 极值价格已穿透原始止损位，但执行评分勾选了"止损未被移动"，请核对止损价或评分', 'warn');
      }
    }
  } catch(e) { /* 校验异常不阻断保存 */ }

  if (!saveLogs()) {
    Object.assign(item, beforeEdit);
    if (typeof renderLogs === 'function') renderLogs();
    showToast('日志编辑未保存，已恢复到保存前状态。', 'error');
    return false;
  }
  // 设计优化：编辑保存后提供 5 秒撤销（恢复保存前深拷贝，与删除撤销同一 toast 基建）
  window._lastEditBackup = { idx: idx, item: beforeEdit };
  if (typeof showUndoToast === 'function') {
    showUndoToast('已保存，可撤销', function() {
      var bk = window._lastEditBackup;
      if (bk && bk.idx === idx && logs[idx] !== bk.item) {
        logs[idx] = bk.item;
        if (typeof saveLogs === 'function') saveLogs(true);
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof renderLogs === 'function') renderLogs();
        showToast('已撤销编辑', 'info');
      }
      window._lastEditBackup = null;
    }, function() { window._lastEditBackup = null; }, 5000);
  }
  // P0-5/6: 持仓变化后刷新仪表盘，确保 Heat / PnL / 强平预警实时正确
  if (typeof renderDashboard === 'function') renderDashboard();
  // 刷新表格与统计数据（表格更新后再关闭弹窗，避免闪烁）
  if (typeof renderLogs === 'function') renderLogs();
  // 保存成功路径：跳过脏检查，避免刚保存的值被判为"未保存修改"而二次弹窗
  closeEditModal(true);
  return true;
}
window.saveEditLog = saveEditLog;

// ==================== 拆分保存 ====================
function saveSplit() {
  const gate = typeof assertSavableCalculation === 'function'
    ? assertSavableCalculation()
    : { ok: !!(getCalc() && getCalc().positionSize), calc: getCalc() };
  if (!gate.ok) { showToast(gate.message || '请先点击「计算仓位」生成有效数据', 'warn'); return false; }
  const calc = gate.calc;

  // 创建内嵌 prompt 替代原生 prompt
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-content" style="max-width:400px;">' +
    '<div class="modal-header"><h3>拆分保存</h3><button class="modal-close" onclick="closeModalOverlay(this.closest(\'.modal-overlay\'))">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="fp"><label>拆分为几笔？</label>' +
      '<input type="number" id="splitCountInput" min="2" max="10" value="2" />' +
      '</div></div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-primary" id="splitConfirmBtn">确定</button>' +
      '<button class="btn btn-outline" onclick="closeModalOverlay(this.closest(\'.modal-overlay\'))">取消</button>' +
    '</div></div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) window.closeModalOverlay(overlay); });
  // 落焦到数量输入框（本弹窗唯一输入项），而不是默认的容器
  window.modalA11yOnOpen(overlay, document.getElementById('splitCountInput'));
  setTimeout(() => { const inp = document.getElementById('splitCountInput'); if (inp) inp.focus(); }, 50);

  document.getElementById('splitConfirmBtn').addEventListener('click', function() {
    const n = document.getElementById('splitCountInput').value;
    const count = parseInt(n, 10);
    if (isNaN(count) || count < 2 || count > 10) { showToast('请输入 2~10 之间的数字','warn'); return; }
    window.closeModalOverlay(overlay);
    doSaveSplit(calc, count);
  });
}

function doSaveSplit(calc, count) {
  // calc 是 saveSplit 中已通过 assertSavableCalculation 验证的快照，
  // 不再重新检查，避免用户在弹窗等待期间误触字段导致不必要的拦截
  if (!calc || !calc.entryPrice || calc.entryPrice <= 0 || !calc.slippage || !calc.slippage.atStop) {
    showToast('计算快照缺少统一滑点数据，请重新计算后再拆分保存', 'warn');
    return false;
  }
  const groupId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  const splitPos = parseFloat((calc.positionSize / count).toFixed(2));
  const remainderPos = parseFloat((calc.positionSize - splitPos * (count - 1)).toFixed(2));
  const feeRate = Number(calc.feeRate) || (calc.orderType === 'limit' ? 0.04 : 0.08);
  const slippageBase = calc.slippage.planning || calc.slippage.atStop;

  function createSnapshot(pos, expectedExitPrice) {
    if (!Number.isFinite(Number(expectedExitPrice)) || Number(expectedExitPrice) <= 0) return null;
    const quantity = pos / calc.effectiveEntryPrice;
    const model = Slippage.calculate({
      direction: calc.direction,
      expectedEntryPrice: calc.entryPrice,
      expectedExitPrice: expectedExitPrice,
      quantity: quantity,
      tickSize: slippageBase.tickSize,
      entryTicks: slippageBase.entryTicks,
      exitTicks: slippageBase.exitTicks
    });
    return Slippage.toLogSnapshot(model, { source: slippageBase.source });
  }

  function createBatchCosts(pos, batchStopLoss) {
    // 优先使用分批独立止损价；未设置则回退到全局 calc.stopLoss
    var actualStopLoss = batchStopLoss != null ? parseFloat(batchStopLoss) : calc.stopLoss;
    const atStop = createSnapshot(pos, actualStopLoss);
    const atTarget = createSnapshot(pos, calc.targetPrice);
    // 计划快照沿用主计算器约定：有目标时以目标路径衡量计划成本，否则使用止损路径。
    const planning = atTarget || atStop;
    const quantity = pos / calc.effectiveEntryPrice;
    const fee = calcRoundTripFee(quantity, planning.effectiveEntryPrice, planning.effectiveExitPrice, feeRate);
    return { fee: fee, slippage: { planning: planning, atStop: atStop, atTarget: atTarget }, stopLoss: actualStopLoss };
  }

  const now = new Date();
  // 读取分批独立止损信息（由 calculate() 写入 calc._splitBatches）
  const splitBatches = calc._splitBatches || [];
  const hasIndepSL = splitBatches.length >= 2 && splitBatches.some(function(b) {
    return b.stopLoss && !isNaN(parseFloat(b.stopLoss));
  });

  const makeEntry = (pos, costs, risk, groupLabel, batchIdx) => ({
    id: window.utils.genLogId(logs),  // 稳定唯一标识；循环内调用，logs 已含本批前几笔，故批次内也不重复
    time: now.toISOString(),
    symbol: calc.symbol,
    direction: calc.direction,
    orderType: document.getElementById('orderType').value || 'market',
    stopType: calc.stopType || (document.getElementById('stopType')?.value || 'stop-market'),
    entryPrice: calc.entryPrice,
    effectiveEntryPrice: calc.effectiveEntryPrice,
    stopLoss: costs.stopLoss,  // 使用批次独立止损或全局止损
    targetPrice: calc.targetPrice,
    positionSize: parseFloat(pos.toFixed(2)),
    leverage: calc.leverage,
    riskAmount: parseFloat(risk.toFixed(2)),
    // 拆分保存字段完整性 FIX：与 saveLog 保持同一字段集，避免分析模块缺失
    plannedRiskAmount: calc.plannedRiskAmount != null ? parseFloat(calc.plannedRiskAmount.toFixed(2)) : null,
    plannedRiskPercent: calc.plannedRiskPercent != null ? parseFloat((calc.plannedRiskPercent * 100).toFixed(2)) : null,
    actualMargin: calc.actualMargin != null ? parseFloat((calc.actualMargin * (pos / (calc.positionSize || 1))).toFixed(2)) : null,
    capital: calc.capital != null && !isNaN(calc.capital) ? calc.capital : null,
    stopPct: calc.stopPct != null ? calc.stopPct : null,
    kellyData: calc.kellyData != null ? JSON.parse(JSON.stringify(calc.kellyData)) : null,
    splitMode: true,
    atrStopMode: calc.atrStopMode || false,
    atrValue: calc.atrStopMode ? calc.atrValue || null : null,
    atrMultiplier: calc.atrStopMode ? calc.atrMultiplier || null : null,
    session: document.getElementById('tradeSession') ? document.getElementById('tradeSession').value : '',
    marketCondition: document.getElementById('marketCondition') ? document.getElementById('marketCondition').value : '',
    tpPlan: (function() {
      if (typeof computeWeightedTPRR !== 'function') return null;
      var w = computeWeightedTPRR();
      if (!w) return null;
      var p = [], r = [];
      ['tp1', 'tp2', 'tp3'].forEach(function(id) {
        var pEl = document.getElementById(id + 'Price');
        var rEl = document.getElementById(id + 'Ratio');
        var pv = pEl ? parseFloat(pEl.value) : NaN;
        p.push((!isNaN(pv) && pv > 0) ? pv : null);
        r.push(rEl ? (parseFloat(rEl.value) || 0) : 0);
      });
      return { prices: p, ratios: r, weightedRR: (w && w.rr != null && !w.overLimit) ? w.rr : null, remain: w.remain };
    })(),
    reason: calc.reason || getReason(),
    mindsetScore: calc.mindsetScore != null ? calc.mindsetScore : getMindsetScore(),
    strategyFramework: document.getElementById('strategyFramework').value,
    strategyPattern: document.getElementById('strategyPattern').value,
    signals: calc.signals,
    closeType: '', closePrice: null, rMultiple: null, pnlAmount: null, pnlPercent: null,
    closeNote: '',
    fee: parseFloat(costs.fee.toFixed(8)),
    slippage: costs.slippage,
    slippageCost: parseFloat(costs.slippage.planning.totalCost.toFixed(8)),
    calculationVersion: calc.calculationVersion || 2,
    targetRR: calc.targetRR, groupId: groupId,
    groupLabel: groupLabel,
    splitEntries: [],  // F4: 记录分批明细
    checklistResults: calc.checklistResults ? JSON.parse(JSON.stringify(calc.checklistResults)) : {},
  });

  const splitEntries = [];
  let _stopBadCount = 0;  // P2 FIX：止损方向与仓位方向相反的批次计数
  for (let i = 0; i < count; i++) {
    const isLast = (i === count - 1);
    const pos = isLast ? remainderPos : splitPos;
    // 分批模式下优先使用独立止损价，未设置则回退全局
    var batchStopLoss = null;
    if (hasIndepSL && splitBatches[i] && splitBatches[i].stopLoss && !isNaN(parseFloat(splitBatches[i].stopLoss))) {
      batchStopLoss = parseFloat(splitBatches[i].stopLoss);
    }
    const costs = createBatchCosts(pos, batchStopLoss);
    // 等风险公式 FIX：每笔风险按该笔实际止损距离重算（含批次独立止损），
    // 与主计算器 positionSize × |entry − stopLoss| / entry 口径一致；
    // 无独立止损时自动退化为 calc.riskAmount / count 均分。
    const effEntry = calc.effectiveEntryPrice || calc.entryPrice;
    // P2 FIX（2026-09-23 开仓逻辑审计）：原 Math.abs 吞掉方向，止损设在错误侧也照样算出
    // "有效"风险额并落库（例如做多却填了高于入场价的止损价）。主计算器的分批路径已按方向
    // 跳过非法批次（calculator.js skippedCount），此处对称校验：非法批次回退等分风险。
    var _stopDirOk = false;
    if (costs.stopLoss != null && effEntry > 0) {
      _stopDirOk = (calc.direction === 'short') ? (costs.stopLoss > effEntry) : (costs.stopLoss < effEntry);
      if (!_stopDirOk) _stopBadCount++;
    }
    const batchRisk = (_stopDirOk && effEntry > 0)
      ? pos * Math.abs(effEntry - costs.stopLoss) / effEntry
      : NaN;
    const risk = !isNaN(batchRisk) && batchRisk >= 0 ? batchRisk : (calc.riskAmount / count);
    const label = i === 0 ? '主' : ('第' + (i + 1) + '笔');
    const entry = makeEntry(pos, costs, risk, label, i);
    // P1 FIX（2026-09-23 开仓逻辑审计）：补 price / alloc——读取端（编辑弹窗明细表）
    // 按 e.price、e.alloc、e.stopLoss、se.weightedEntry 读取，原写入形状缺前两者。
    var _b = splitBatches[i];
    var _bPrice = (_b && !isNaN(parseFloat(_b.price))) ? parseFloat(_b.price) : (calc.entryPrice || null);
    var _bAlloc = (_b && !isNaN(parseFloat(_b.alloc))) ? parseFloat(_b.alloc) : (100 / count);
    splitEntries.push({
      index: i + 1,
      price: _bPrice,
      alloc: _bAlloc,
      positionSize: parseFloat(pos.toFixed(2)),
      fee: parseFloat(costs.fee.toFixed(8)),
      slippageCost: parseFloat(costs.slippage.planning.totalCost.toFixed(8)),
      slippage: costs.slippage,
      riskAmount: parseFloat(risk.toFixed(2)),
      label: label,
      stopLoss: costs.stopLoss,  // 记录每笔实际使用的止损价
    });
    logs.push(entry);
  }
  // F4: 将分批明细写入刚生成的条目（最后 count 条）
  // P1 FIX：原直接写纯数组，而读取端（编辑弹窗 :38）要求 { entries:[...], weightedEntry }
  // 对象 → 形状永不相等，saveSplit 生成的每笔记录分批明细在编辑弹窗中永不显示（死分支）。
  var _weSum = 0, _waSum = 0;
  for (var _wi = 0; _wi < splitEntries.length; _wi++) {
    var _wp = parseFloat(splitEntries[_wi].price), _wa = parseFloat(splitEntries[_wi].alloc);
    if (isFinite(_wp) && _wp > 0 && isFinite(_wa) && _wa > 0) { _weSum += _wp * _wa; _waSum += _wa; }
  }
  var splitDetail = {
    entries: splitEntries,
    weightedEntry: _waSum > 0
      ? parseFloat((_weSum / _waSum).toFixed(5))
      : (calc.weightedEntryPrice || calc.effectiveEntryPrice || null)
  };
  for (var li = logs.length - count; li < logs.length; li++) {
    if (logs[li]) logs[li].splitEntries = splitDetail;
  }
  if (!saveLogs()) {
    logs.splice(logs.length - count, count);
    showToast('拆分日志未保存：浏览器本地存储写入失败。', 'error');
    return false;
  }
  if (_stopBadCount > 0) {
    showToast('分批建仓有 ' + _stopBadCount + ' 批止损价与'
      + (calc.direction === 'short' ? '做空' : '做多')
      + '方向相反，该批已按等分风险保存，请检查止损价设置。', 'warn');
  }
  openClosePanelIdx = -1;
  actionPanelIdx = -1;
  setCalcDirty(false);
  // P0-1/5/6: 分批保存后刷新仪表盘
  if (typeof renderDashboard === 'function') renderDashboard();
  showToast('拆分保存成功，共 ' + count + ' 笔', 'success');
  return true;
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
  // 更新所有 checkbox-group 容器的视觉状态（不仅限于 #signalCheckboxes）
  document.querySelectorAll('.checkbox-group').forEach(function(group) {
    group.querySelectorAll('label').forEach(function(lbl) {
      var cb = lbl.querySelector('input[type="checkbox"]');
      if (cb) lbl.classList.toggle('checked', cb.checked);
    });
  });
}
