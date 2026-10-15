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
  // 最后一个弹窗关闭时解除背景隔离（UI 交互评估 P3 修复）
  if (window._modalFocusStack.length === 0) _setBackgroundInert(false);
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

// UI 交互评估 P3 修复：弹窗打开时把背景（主内容区 + 侧栏）设为 inert，
// 彻底隔离读屏与指针，比单纯 aria-modal + 焦点环锁更稳健（aria-modal 在部分 AT 下仍会暴露背景）。
// 所有弹窗均挂在 document.body（见 confirmDialog/编辑弹窗的 appendChild），隔离 #mainContent/#mainNav 不影响弹窗本身。
function _setBackgroundInert(on) {
  ['mainContent', 'mainNav'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && 'inert' in el) el.inert = !!on;
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
  // 首个弹窗打开时隔离背景（UI 交互评估 P3 修复）
  if (window._modalFocusStack.length === 0) _setBackgroundInert(true);
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
  // 已有部分平仓事件时，同一处输入框有两种互斥意图：改末条那一笔、还是再平一笔。
  // 二者换算基准不同（末条发生前的剩余仓位 vs 本次保存前的累计状态），猜错就是账面错账，
  // 所以显式单选而不是靠输入值推断。没有既有事件时两种意图等价（都是建第一条），不显示。
  var _hasPartialEvt = !!_lastPartialEvt;

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

  // 编辑弹窗品种候选：与开仓计划同源（系统设置 → 品种管理）。
  // 此前这里是裸文本框，改品种只能手打——手打 "btc" 与记录里的 "BTC" 会在
  // 统计/筛选里裂成两个品种。带候选后仍可自由输入，只是给了正确拼写。
  // 每次打开弹窗即时生成，不依赖 #symbolDatalist 的同步时机。
  let emSymbolOptions = '';
  if (typeof getDefinedSymbols === 'function') {
    getDefinedSymbols().forEach(function(s) {
      emSymbolOptions += '<option value="' + esc(s.symbol) + '"' +
        (s.desc ? ' label="' + esc(s.desc) + '"' : '') + '></option>';
    });
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
        '<div class="fp"><label>品种</label><input type="text" id="emSymbol" list="emSymbolList" value="' + esc(item.symbol || '') + '" /><datalist id="emSymbolList">' + emSymbolOptions + '</datalist></div>' +
        '<div class="fp"><label>方向</label><select id="emDirection"><option value="long"' + (item.direction === 'long' ? ' selected' : '') + '>做多</option><option value="short"' + (item.direction === 'short' ? ' selected' : '') + '>做空</option></select></div>' +
        '<div class="fp"><label>订单类型</label><select id="emOrderType">' + (function(){
          // 选项必须与主数据模型一致：#orderType（index.html）与 ORDER_TYPES_LONG/SHORT 都用
          // market/limit/stop 三值，calculator.js:232 直接把该值落库、_getDefaultFeeRate 还按
          // 'limit' 分支取手续费率。此前这里只列旧扩展值（limitBuy/stopBuy/…），于是
          // orderType='limit' 的日志打开弹窗后 select 匹配不到任何 option，浏览器回落到首项
          // 'market'，用户不改任何字段直接保存就把限价单静默改成了市价单。
          var THREE = ORDER_TYPES_LONG || ['market','limit','stop'];
          var LEGACY = ['limitBuy','stopBuy','limitSell','stopSell','stopLimit','trailingStop'];
          var isShort = item.direction === 'short';
          var lbl = { market:'市价单', limit: isShort ? 'Sell Limit 限价单' : 'Buy Limit 限价单',
                      stop:  isShort ? 'Sell Stop 止损单'  : 'Buy Stop 止损单' };
          var opts = THREE.map(function(v){
            return '<option value="' + v + '"' + (item.orderType === v ? ' selected' : '') + '>' + (lbl[v] || v) + '</option>';
          }).join('');
          // 历史数据可能仍是旧扩展值：补一个同名 option 原样回显，
          // 否则保存即被改写（这正是本修复要消灭的静默改单）
          if (item.orderType && THREE.indexOf(item.orderType) < 0 && LEGACY.indexOf(item.orderType) >= 0) {
            opts += '<option value="' + item.orderType + '" selected>' +
                    (ORDER_TYPE_LABELS[item.orderType] || item.orderType) + '（旧值）</option>';
          }
          return opts;
        })() + '</select></div>' +
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
          '<label>平仓比例 (%)<span style="font-size:11px;color:var(--color-text-muted);margin-left:4px;">口径：<label style="display:inline;font-weight:400;font-size:11px;cursor:pointer;"><input type="radio" name="emPartialRatioBase" value="remaining" checked onchange="emSwitchRatioBase()" /> 剩余仓位</label> <label style="display:inline;font-weight:400;font-size:11px;cursor:pointer;"><input type="radio" name="emPartialRatioBase" value="initial" onchange="emSwitchRatioBase()" /> 原始仓位</label>' +
          (_hasPartialEvt ? ' <span style="display:inline-block;margin-left:6px;color:var(--color-text-muted);font-size:11px;">对象：<label style="display:inline;font-weight:400;cursor:pointer;"><input type="radio" name="emPartialLegMode" value="edit" checked onchange="emSwitchRatioBase()" /> 修改最后一笔</label> <label style="display:inline;font-weight:400;cursor:pointer;"><input type="radio" name="emPartialLegMode" value="add" onchange="emSwitchRatioBase()" /> 新增一笔</label></span>' : '') +
          '</span></label>' +
          '<input type="number" id="emPartialRatio" step="5" min="1" max="100" value="' + _prefillRemaining + '" placeholder="如 50 表示平仓 50%" />' +
        '</div>' +
        '<div class="fp"><label>平仓价</label><input type="number" id="emClosePrice" step="0.00001" value="' + (item.closePrice ?? '') + '" /></div>' +
        '<div class="fp"><label>R倍数</label><input type="text" id="emRMultiple" value="' + (item.rMultiple ?? '') + '" /></div>' +
        '<div class="fp"><label>盈亏金额</label><input type="text" id="emPnlAmount" value="' + (item.pnlAmount ?? '') + '" /><span id="emPnlManualTag" style="display:none;font-size:10px;color:var(--color-warning);margin-left:4px;">手动</span></div>' +
        '<div class="fp"><label>盈亏百分比 <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（保证金回报率）</span></label><input type="text" id="emPnlPercent" value="' + (item.pnlPercent ?? '') + '" /></div>' +
        '<div class="fp span-2" id="emCloseTypeMismatchWarn" style="display:none;font-size:12px;color:var(--color-warning);background:rgba(255,193,7,0.1);padding:8px 12px;border-radius:6px;margin-top:4px;"></div>' +
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
  // 已平仓且 PnL 有值 → 视为权威值，emRecalc 不再自动覆写。
  // 「手动」标签同步点亮：用户能看见这个数字不会再被系统改写。
  window._emPnlManual = _pnlHasValue;
  var _pnlManualTag = document.getElementById('emPnlManualTag');
  if (_pnlManualTag) _pnlManualTag.style.display = _pnlHasValue ? 'inline' : 'none';

  // Diff-based dirty detection: store initial values from DOM
  // 捕获动作见下方 emRecalc(item) 之后——必须在 emRecalc 之后捕获，因为 emRecalc 会覆写 PnL/R 字段

  // Check dirty before close
  window.emCheckDirty = function() {
    // emStopType 必须在内：它是可保存字段（:851 附近写回 item.stopType），
    // 此前只漏在这里 → 用户改了止损类型，关闭弹窗时不提示「放弃未保存修改」，
    // 改动被静默丢弃。（emPartialRatio 同理：分批比例可保存却不在名单里。）
    const ids = ['emSymbol','emDirection','emOrderType','emStopType','emEntryPrice','emStopLoss','emTargetPrice',
      'emPositionSize','emLeverage','emRiskAmount','emStrategyFramework','emStrategyPattern',
      'emCloseType','emClosePrice','emPartialRatio','emRMultiple','emPnlAmount','emPnlPercent','emFee','emSlippageCost',
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
    // 必须与 emCheckDirty 的 ids 列表逐字一致，否则某个字段「改了检测不到」或
    // 「没改却误报未保存」。emStopType / emPartialRatio 曾只出现在保存侧。
    const ids = ['emSymbol','emDirection','emOrderType','emStopType','emEntryPrice','emStopLoss','emTargetPrice',
      'emPositionSize','emLeverage','emRiskAmount','emStrategyFramework','emStrategyPattern',
      'emCloseType','emClosePrice','emPartialRatio','emRMultiple','emPnlAmount','emPnlPercent','emFee','emSlippageCost',
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
  // emPartialRatio 必须监听：本腿盈亏 = 全仓毛利 × 本腿比例，改比例不改预览会让用户
  // 看到「15」而落库是新比例对应的值，保存前无从发现（实测改 50→80 预览恒 15）。
  const ids = ['emEntryPrice','emStopLoss','emPositionSize','emLeverage','emClosePrice','emFee','emSlippageCost','emPartialRatio'];
  // 这些字段改动意味着用户要重算盈亏 → 解除"手动覆盖"锁定
  var _unlockFields = ['emClosePrice', 'emEntryPrice', 'emPositionSize', 'emPartialRatio'];
  // emPartialRatio 必须能解锁：413 行的锁定条件只看「有 closeType + 有 pnlAmount」，而分批
  // 中间态记录两者皆有，于是改比例时 emRecalc 在 669 行直接 return —— 预览恒停在旧值
  // （实测改 50→80 恒显 15），落库却是新比例对应的值，保存前无从发现。该字段只在分批类型
  // 下可见、且分批类型必有剩余仓位，emRecalc 的 _isPartialMid 分支覆盖它，解锁是安全的。
  // 注意 emFee / emSlippageCost 刻意【不】加入：已全平记录改费用若解锁，emRecalc 会按初始
  // 仓位重算整笔毛利覆盖累计值（分批链上 realizedPnl=40 会被写成 30），比预览不刷新更糟。
  _emRecalcListeners = []; // 清空旧监听
  ids.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      var handler = function() {
        // 用户主动改了平仓价/入场价/仓位 → 解除"手动覆盖"锁定，允许重算盈亏
        if (_unlockFields.indexOf(id) > -1) {
          window._emPnlManual = false;
          var tag = document.getElementById('emPnlManualTag');
          if (tag) tag.style.display = 'none';
        }
        emRecalc(item);
      };
      el.addEventListener('input', handler);
      _emRecalcListeners.push({ el: el, type: 'input', handler: handler });
    }
  });
  // select 元素用 change 事件
  ['emDirection','emCloseType'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      var handler = function() {
        // 用户主动改了平仓类型/方向 → 解除"手动覆盖"锁定，允许按新参数重算盈亏
        window._emPnlManual = false;
        var tag = document.getElementById('emPnlManualTag');
        if (tag) tag.style.display = 'none';
        // 改 closeType 时自动填充对应价格（与平仓面板行为一致）
        // 仅当用户还没手动改过 closePrice 时才自动填，避免覆盖用户输入
        if (id === 'emCloseType') {
          var cpEl = document.getElementById('emClosePrice');
          var ctVal = el.value;
          // 检查用户是否手动改过 closePrice（通过是否与 closeType 默认值不同来判断）
          var cpVal = cpEl ? cpEl.value : '';
          var _autoFilled = (ctVal === 'initialTP' && item.targetPrice != null && parseFloat(cpVal) === parseFloat(item.targetPrice))
            || (ctVal === 'initialSL' && item.stopLoss != null && parseFloat(cpVal) === parseFloat(item.stopLoss));
          // 如果是从一个自动填充的价格改过来的（用户没手动改过），切类型时跟着换
          // 或者 closePrice 为空，也自动填
          if (cpEl && (cpVal === '' || _autoFilled)) {
            if (ctVal === 'initialTP' && item.targetPrice != null && item.targetPrice !== '') {
              cpEl.value = item.targetPrice;
            } else if (ctVal === 'initialSL' && item.stopLoss != null && item.stopLoss !== '') {
              cpEl.value = item.stopLoss;
            }
          }
        }
        emRecalc(item);
      };
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
  // 用 let 而非 const：下方「一致性检查 + 自动调整」会在平仓类型与实际盈亏方向相反时
  // 改写本地 closeType（_ctEl2.value 已同步），const 会抛 TypeError 让整段自动调整逻辑
  // 静默中断 —— emCloseTypeMismatchWarn 从此永远不显示，用户看不出「计划止盈」被改成了
  // 「手平损」（落库取的是 DOM 值所以记录本身没错，但复盘的 closeType 分桶统计被污染）。
  let closeType = (document.getElementById('emCloseType') || {}).value;

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
    // BUG FIX（2026-10-14）：编辑已平仓交易时，若用户改了 closePrice/closeType，
    // 原逻辑因 pos<=0 直接 return，导致 closePrice 和 pnlAmount 不一致——
    // 例如先按目标价止盈算盈利，再改成实际平仓价（止损附近），盈亏还停留在旧值。
    // 修复：已全额平仓时回退用 initialPositionSize（开仓原始仓位）重算整笔盈亏。
    let pnlPos = pos;
    if (isNaN(pnlPos) || pnlPos <= 0) {
      // 优先用 initialPositionSize（平仓时保存的开仓原始仓位）
      if (item.initialPositionSize != null && !isNaN(parseFloat(item.initialPositionSize)) && parseFloat(item.initialPositionSize) > 0) {
        pnlPos = parseFloat(item.initialPositionSize);
      }
      // 兜底：旧数据没有 initialPositionSize 时，用 initialMargin * leverage 反推
      else if (item.initialMargin != null && !isNaN(parseFloat(item.initialMargin)) && parseFloat(item.initialMargin) > 0 && lev > 0) {
        pnlPos = parseFloat(item.initialMargin) * lev;
      }
      // 再兜底：用 actualMargin * leverage（可能被部分平仓缩减过，精度稍差但好过没有）
      else if (item.actualMargin != null && !isNaN(parseFloat(item.actualMargin)) && parseFloat(item.actualMargin) > 0 && lev > 0) {
        pnlPos = parseFloat(item.actualMargin) * lev;
      }
    }
    // P0 修复：部分平仓中间态（positionSize>0 且 closeType 是 partialTP/reducePosition）
    // emRecalc 用的是「平仓后剩余仓位」，但 pnlAmount 应该是「本次平掉仓位」的盈亏。
    // 两者口径不一致会导致预览和实际保存结果对不上。
    // 修正：从 closes[] 最后一条记录取 ratioOfRemaining，反推本次平掉的仓位。
    var _isPartialMid = (closeType === 'partialTP' || closeType === 'reducePosition')
      && !isNaN(pos) && pos > 0
      && Array.isArray(item.closes) && item.closes.length > 0;
    // F7 修复（2026-10-14）：预览必须读**输入框当前值**，不是已落库的 ratioOfRemaining。
    // 把 emPartialRatio 挂进 emBindRecalc 的监听名单只是必要条件——emRecalc 内部若仍取旧值，
    // 改比例后预览纹丝不动（实测改 50→80 恒显 15），落库却是新值，保存前无从察觉。
    // 口径与 saveEditLog 1203-1213 严格同构：本腿盈亏 = 事件前仓位毛利 × 本腿占比，
    // 本腿费用/滑点 = 事件前费用/滑点 × 本腿占比（费用随仓位线性缩放）。
    var _pnlFee = emFee;
    var _pnlSlip = emSlippage;
    if (_isPartialMid) {
      var _lastClose = item.closes[item.closes.length - 1];
      var _storedRoR = parseFloat(_lastClose.ratioOfRemaining);
      // 事件前剩余仓位（由已落库数据还原，与本次输入无关）
      var _prePosSize = pos;
      if (isFinite(_storedRoR) && _storedRoR > 0 && _storedRoR < 100) {
        // 剩余仓位 = 事件前仓位 × (1 - ratioOfRemaining/100) → 反推事件前仓位
        var _fracRemaining = 1 - _storedRoR / 100;
        if (_fracRemaining > 0) _prePosSize = pos / _fracRemaining;
      }
      // 本腿占「事件前剩余仓位」的比例：优先取输入框当前值，按所选口径换算。
      var _newRoR = (isFinite(_storedRoR) && _storedRoR > 0 && _storedRoR < 100) ? _storedRoR : 0;
      var _rEl = document.getElementById('emPartialRatio');
      var _rv = _rEl ? parseFloat(_rEl.value) : NaN;
      if (isFinite(_rv) && _rv > 0 && _rv < 100) {
        var _bs = document.querySelector('input[name="emPartialRatioBase"]:checked');
        if (!_bs || _bs.value !== 'initial') {
          _newRoR = _rv;
        } else {
          // 「原始仓位」口径 → 「剩余仓位」口径：分母是该腿发生前的剩余占比（同 saveEditLog
          // 1108-1112 的 _baseMode 判定与 deltaOriginal 换算）。
          var _cumBefore = 0;
          for (var _pni = 0; _pni < item.closes.length - 1; _pni++) {
            var _pne = item.closes[_pni];
            if (_pne.type === 'partialTP' || _pne.type === 'reducePosition') {
              _cumBefore += (parseFloat(_pne.ratio) || 0);
            }
          }
          var _fracBE = 1 - _cumBefore / 100;
          _newRoR = (_fracBE > 0) ? (_rv / _fracBE) : _rv;
        }
      }
      if (_newRoR > 0 && _newRoR < 100 && _prePosSize > 0) {
        pnlPos = _prePosSize * _newRoR / 100;
        // 事件前费用/滑点 = 当前剩余值按仓位比例还原（emFee 预填的是 item.fee，已缩放到
        // 剩余仓位，见 1194-1196），再按本腿占比取份额。
        var _feeFactor = (pos > 0) ? (_prePosSize / pos) : 1;
        var _newFrac = _newRoR / 100;
        _pnlFee = emFee * _feeFactor * _newFrac;
        _pnlSlip = emSlippage * _feeFactor * _newFrac;
      }
    }
    if (isNaN(entryForPnl) || isNaN(closePrice) || isNaN(pnlPos) || pnlPos <= 0 || entryForPnl === 0 || closePrice <= 0) return;
    let grossPnl;
    if (direction === 'short') {
      grossPnl = (entryForPnl - closePrice) / entryForPnl * pnlPos;
    } else {
      grossPnl = (closePrice - entryForPnl) / entryForPnl * pnlPos;
    }
    const netPnl = grossPnl - _pnlFee - _pnlSlip;
    const lev2 = (!isNaN(lev) && lev > 0) ? lev : 1;
    const margin = pnlPos / lev2;
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
    // 一致性检查 + 自动调整：走 utils.resolveCloseType（内联平仓面板 calcClosePnL /
    // confirmClose 与存量归一同源，两处权威结论一致）。closeType 描述「实际怎么退出」，
    // 计划已由 targetPrice / stopLoss 承载，故类型与实算盈亏矛盾时改类型、不改盈亏。
    var _mismatchEl = document.getElementById('emCloseTypeMismatchWarn');
    var _ctEl2 = document.getElementById('emCloseType');
    var _adj2 = window.utils.resolveCloseType(closeType, netPnl);
    if (_ctEl2 && _adj2.adjusted) {
      _ctEl2.value = _adj2.type;
      closeType = _adj2.type; // 更新局部变量
      var _row = document.getElementById('emPartialRatioRow');
      if (_row) _row.style.display = (closeType === 'partialTP' || closeType === 'reducePosition') ? 'block' : 'none';
    }
    if (_mismatchEl) {
      if (_adj2.adjusted) {
        _mismatchEl.textContent = 'ℹ 已按实际盈亏调整平仓类型：「' + (CLOSE_TYPE_LABELS[_adj2.from] || _adj2.from) + '」→「' + (CLOSE_TYPE_LABELS[closeType] || closeType) + '」（' + (netPnl < 0 ? '实算为亏损' : '实算为盈利') + '；计划止盈/止损价已单独记录，不受影响）';
        _mismatchEl.style.display = 'block';
      } else {
        // 人工判断型（手平赢/手平损、爆仓、时间止损）方向由用户主观认定，不自动改，仅提示矛盾。
        // initialTP / partialTP / initialSL / trailingSL 已在上方归一，不会走到这里。
        var _isWinType = (closeType === 'manualWin');
        var _isLossType = (closeType === 'manualLoss' || closeType === 'liquidation' || closeType === 'timeStop');
        var _mismatch = (_isWinType && netPnl < 0) || (_isLossType && netPnl >= 0);
        if (_mismatch) {
          var _lbl = CLOSE_TYPE_LABELS[closeType] || closeType;
          var _expected = _isWinType ? '亏损' : '盈利';
          _mismatchEl.textContent = '⚠ 注意：平仓类型是「' + _lbl + '」，但当前平仓价计算为' + _expected + '。请确认平仓类型是否正确。';
          _mismatchEl.style.display = 'block';
        } else {
          _mismatchEl.style.display = 'none';
        }
      }
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
  // 「新增一笔」不预填：预填的是末条那一笔的数字，直接复用会建出一条与上一笔相同的腿
  var modeSel = document.querySelector('input[name="emPartialLegMode"]:checked');
  if (modeSel && modeSel.value === 'add') { el.value = ''; return; }
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
  // 与 storeMAEMFE 口径一致（P4-1 符号钳制）：MAE≤0（无不利=0）、MFE≥0（无有利=0）
  if (item.direction === 'long') {
    mae = lowVal != null ? Math.min(0, (lowVal - entry) / entry * 100) : null;
    mfe = highVal != null ? Math.max(0, (highVal - entry) / entry * 100) : null;
  } else {
    mae = highVal != null ? Math.min(0, (entry - highVal) / entry * 100) : null;
    mfe = lowVal != null ? Math.max(0, (entry - lowVal) / entry * 100) : null;
  }

  // 比率仅在 MAE、MFE 均有实际意义（均非 0）时计算，避免盈利单 mae=0 / 从未浮盈 mfe=0 产生虚高或无穷值
  const ratio = (mae != null && mfe != null && mae !== 0 && mfe !== 0) ? Math.abs(mfe / mae) : null;

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
  // P1-2 修复：捕捉率改用"实际实现的价格收益% ÷ MFE%"——两者同量纲（都不含杠杆），
  // 消除原 actualPnlPct(含杠杆收益率)÷mfe 在杠杆>1 时系统性高估捕捉率的量纲错误。
  // 整笔价格收益% = 整笔累计毛利(realizedPnl+realizedFee) ÷ 初始名义仓位 initialPositionSize；
  // 一次性全平退化为 (close−entry)/entry，部分平仓为各腿按仓位加权，均不含杠杆。
  // 天然兼容已平仓 positionSize=0（C2：用 initialPositionSize，不再依赖 positionSize/margin）。
  if (mfe != null && mfe !== 0 && item.pnlAmount != null) {
    var _grossTotal = (item.realizedPnl != null ? parseFloat(item.realizedPnl) : 0) +
                      (item.realizedFee != null ? parseFloat(item.realizedFee) : 0);
    var _nominal = (item.initialPositionSize != null && parseFloat(item.initialPositionSize) > 0)
      ? parseFloat(item.initialPositionSize)
      : (item.positionSize && parseFloat(item.positionSize) > 0 ? parseFloat(item.positionSize) : null);
    var pricePnlPct = null;
    if (_nominal != null && _nominal > 0 && isFinite(_grossTotal)) {
      pricePnlPct = _grossTotal / _nominal * 100;
    }
    if (pricePnlPct != null) {
      // mfe 已钳≥0 且此处 ≠0，必为正值；亏损单 pricePnlPct<0 → "利润回吐过多"解读合理
      const captureRatio = pricePnlPct / mfe;
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
    // P2 修复（2026-10-04）：Object.assign 只能覆盖已存在的键，删不掉这次编辑【新增】的键。
    // 新建日志（saveLog 不写 closes / closedRatio / closeTime / initial*）在编辑弹窗里把
    // 平仓类型选成「分批」并填了比例，syncCloseBookkeeping 会写入那一整套键；此时若校验
    // 失败，浅回滚后这些键全部残留——closeType 已回滚成空、isClosedTrade 判「未平仓」，
    // 却带着 closes:[{ratio:50}] / closedRatio=50 / closeTime，即「全额在仓的持仓同时
    // 带着已平簿记和平仓时间戳」。而 utils.syncCloseBookkeeping 的空值护栏（closeType 为
    // 空即不动簿记）会让这条残留永远得不到清理。先删掉快照里没有的键再覆盖。
    Object.keys(item).forEach(function (k) {
      if (!(k in beforeEdit)) delete item[k];
    });
    Object.assign(item, beforeEdit);
    showToast(msg, level || 'warn');
    return false;
  }
  // 品种归一（trim + 大写）：与品种管理保存口径一致（saveCustomSymbols 同规则）。
  // 编辑时手打 "btc" 会与既有 "BTC" 在统计/筛选里裂成两个品种，这里统一。
  v = gv('emSymbol'); if (v !== undefined) item.symbol = String(v).trim().toUpperCase();
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
    // 编辑前累计已平——「本次操作发生时的剩余基数」取决于用户在弹窗里选了哪种意图：
    //   修改最后一笔 → 末条事件是被【替换】的对象，基数是末条发生前的累计（排除末条自身）
    //   新增一笔     → 全部既有事件都是历史，基数是本次保存前的累计（含末条）
    // 两种意图共用同一个比例输入框，换算基准差一个末条事件；不区分就等价于每次都在改写
    // 上一笔，上一笔的 ratio 被覆盖、closedRatio/positionSize 随之错账，而已实现盈亏是按
    // 累加算的——两条字段从此互相矛盾（实测：2 笔分批后 closedRatio=40、positionSize=600，
    // 而 realizedPnl 已按 70% 计）。意图由弹窗里的 emPartialLegMode 单选显式给出，不靠猜。
    var _legModeEl = document.querySelector('input[name="emPartialLegMode"]:checked');
    var _legMode = (_legModeEl && _legModeEl.value === 'add') ? 'add' : 'edit';
    var cumClosedBeforeEvt = 0;
    if (_legMode === 'add') {
      cumClosedBeforeEvt = cumClosedOld;
    } else {
      for (var _ci1 = 0; _ci1 < _partialsNow.length - 1; _ci1++) {
        cumClosedBeforeEvt += (parseFloat(_partialsNow[_ci1].ratio) || 0);
      }
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
    // P1 修复（2026-10-04）：增量合法不等于累计不越界。「原始仓位」口径下增量本身就
    // 是占原始仓位的比例，与已平部分相加可能超过 100%——实测已平 50 时输入 80，
    // 保存成功却得到 closes=[50,80]（sum=130）、closedRatio 被 clamp 到 100、
    // positionSize 归 0 而 closeType 仍是 partialTP：挂单中间态被判全额平仓，剩余
    // 敞口从账面消失，且打破 sum(closes[].ratio) === closedRatio 不变量。
    // 「剩余仓位」口径代数上不会越界（cumBefore + partialRatio×fracBefore =
    // 100 − fracBefore×(100 − partialRatio) < 100），但两种口径统一校验更稳。
    if (cumClosedBeforeEvt + deltaOriginal > 100 + 1e-9) {
      return abortSave('按所选口径换算后累计已平超过 100%：之前已平 ' + cumClosedBeforeEvt.toFixed(2)
        + '%，本笔 ' + deltaOriginal.toFixed(2) + '%，超出 '
        + (cumClosedBeforeEvt + deltaOriginal - 100).toFixed(2) + '%');
    }
    var _orphanClosed = (_partialsNow.length === 0 && cumClosedBeforeEvt > 0) ? cumClosedBeforeEvt : 0;
    // P1 修复（2026-10-03）：簿记同步。confirmClose 在 logs.js 实际读的是 closedRatio/closes，
    // 不是 partialRatio —— 不写回去，下一次部分平仓会在新旧比例之间错误叠加。
    window.utils.syncCloseBookkeeping(item, item.closeType, deltaOriginal, { append: _legMode === 'add' });
    // #1 FIX（2026-10-14 基数错位）：本腿的结算基数必须是「该腿事件【发生前】的剩余
    // 仓位与费用」，而 item.positionSize / item.fee 是「本次编辑后的当前剩余」（已含
    // 该腿自身的缩减）。下方 _legFraction 用的是 fracBeforeEvt（该腿发生前的口径），
    // 两个基数混用会让本腿盈亏恰好按正确值的一半入账（实测 500 单位基数、净盈亏 18
    // 记成 9，费用 6 记成 3）。
    // 因子 fracBeforeEvt/fracOld 在「新增一笔」模式为 1（fracOld === fracBeforeEvt，
    // 行为不变）；在「修改最后一笔」模式差一个末腿，把当前剩余还原到该腿发生前。
    // 四个现存不变量（riskAmount 恒等式、Σratio===closedRatio、Σpnl===realizedPnl、
    // positionSize 按 fracNow 缩减）在此全部成立，任何校验都抓不到这个错。
    var _legBaseFactor = (fracOld > 0) ? (fracBeforeEvt / fracOld) : 1;
    var _prePosSize = (parseFloat(item.positionSize) || 0) * _legBaseFactor;
    var _preFee = (parseFloat(item.fee) || 0) * _legBaseFactor;
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
    // 末腿「占剩余仓位」比例：原始口径下是换算值，剩余口径下就是用户输入本身。
    // 单独留个变量——下方补审计字段时不能再写 partialRatio，原始口径下那是换算前的数字，
    // 会把这个字段覆盖回未换算值（下次打开弹窗「剩余仓位」单选就预填成错的数字）。
    var _lastLegRoR = (_baseMode === 'initial')
      ? (fracBeforeEvt > 0 ? parseFloat((deltaOriginal / fracBeforeEvt).toFixed(4)) : deltaOriginal)
      : partialRatio;
    if (_lastEvt2) {
      _lastEvt2.ratioOfRemaining = _lastLegRoR;
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
    // #1 FIX：编辑弹窗部分平仓必须按「本腿」折算 P&L 并初始化累计字段，
    // 与 confirmClose 部分平仓口径严格一致（logs.js:286-331）。否则本腿盈亏不入 realizedPnl，
    // 最终平仓时 confirmClose 把 undefined 的 realizedPnl 初始化为 0 → 首腿整段丢失（实测少记 38%）。
    var _legCp = gn('emClosePrice');
    if (_legCp != null && !isNaN(_legCp) && typeof calculateCloseSettlement === 'function') {
      // 本腿占「事件前剩余仓位」的比例（与 confirmClose:224 同构）
      var _legFraction = (_baseMode === 'initial')
        ? (fracBeforeEvt > 0 ? (deltaOriginal / (100 * fracBeforeEvt)) : 0)
        : (partialRatio / 100);
      if (_legFraction > 0) {
        // 用「本次事件前剩余仓位」+ 缩减前费用作结算基数
        var _preItem = Object.assign({}, item, { positionSize: _prePosSize, fee: _preFee });
        var _legSett = calculateCloseSettlement(_preItem, _legCp, _preFee);
        if (_legSett) {
          var _legGross = _legSett.grossPnl * _legFraction;
          var _legFee = _legSett.fee * _legFraction;
          var _legNet = _legGross - _legSett.legacySlippageCost * _legFraction - _legFee;
          var _rpB = parseFloat(item.realizedPnl);
          // 账本里带 pnl/fee/gross 的腿各有几笔——这是「累计字段当初是否真的累加过」的判据。
          // confirmClose 从第一次部分平仓起就维护 realizedPnl/realizedFee（logs.js:291-292），
          // 而存量与旧 CSV 数据常见「closes[] 有逐腿 pnl、realizedPnl 从没落过」。
          var _ledgPnl = 0, _ledgFees = 0, _ledgGross = 0;
          if (Array.isArray(item.closes)) {
            for (var _si0 = 0; _si0 < item.closes.length; _si0++) {
              var _sv0 = item.closes[_si0];
              if (isFinite(parseFloat(_sv0.pnl))) _ledgPnl++;
              if (isFinite(parseFloat(_sv0.fee))) _ledgFees++;
              if (isFinite(parseFloat(_sv0.gross)) || isFinite(parseFloat(_sv0.pnl))) _ledgGross++;
            }
          }
          var _rpWasFinite = isFinite(_rpB);
          // 累计盈亏缺失时的两种情形必须分开处理：
          //  - 账本里有带 pnl 的腿 → 用权威 pnlAmount 播种（它已含全部腿），再扣回旧腿；
          //  - 账本里没有带 pnl 的腿 → 置 0 起算（等价 confirmClose 的初始化）。
          // 无论哪种都不能「从 0 里扣回旧腿」：存量数据里 realizedPnl 从未落过，扣回会凭空
          // 造出负累计（实测 pnlAmount=600 的盈利单被算成 -300），盈利单随即被下方亏损原因
          // 闸门拦死、编辑无法保存。
          var _rpAccrue = _rpWasFinite || _ledgPnl > 0;
          if (!_rpWasFinite) {
            item.realizedPnl = parseFloat((isFinite(parseFloat(item.pnlAmount))
              ? parseFloat(item.pnlAmount) : 0).toFixed(2));
            _rpB = parseFloat(item.realizedPnl);
          }
          // realizedFee / grossPnlAmount 只在【可重建】时才动账：
          //  - 字段已落过 → 可重建（confirmClose 从第一次部分平仓起就维护）；
          //  - 字段缺失但账本里已有带费用/毛利的腿（存量数据，或旧 CSV 无「累计手续费」列）
          //    → 原始费用无从还原，绝不能新写：baseFee = 剩余 fee + 已实现 fee 依赖它，
          //    写个部分值会让下一次编辑把原始费用越算越小（实测 5 → 3.75 → 2.76…）；
          //  - 字段缺失且账本为空 → 全新记录，等价 confirmClose 的初始化。
          var _rfOk = isFinite(parseFloat(item.realizedFee));
          if (!_rfOk && _ledgFees === 0) { item.realizedFee = 0; _rfOk = true; }
          var _rgOk = isFinite(parseFloat(item.grossPnlAmount));
          if (!_rgOk && _ledgGross === 0) {
            // 以「累计净盈亏 + 累计费用」起算（与 logs.js:330 的「整笔累计价格毛利」口径一致）。
            // 第一次部分平仓时 realizedPnl 与 pnlAmount 都还没有，此处必须播种：否则
            // confirmClose 最终平仓从 undefined(→0) 起算，第一腿毛利被永久抹掉（实测 65→40）。
            item.grossPnlAmount = parseFloat((_rpB
              + (_rfOk ? (parseFloat(item.realizedFee) || 0) : 0)).toFixed(2));
            _rgOk = true;
          }
          // 旧数据的事件可能只有 {type, ratio}：缺失字段按 0 扣回——那笔腿本就从未进过累计，
          // 扣 0 才是自洽的；gross 缺失时退回 pnl + 本腿费用（不含滑点的近似）。
          var _oldEvt = (Array.isArray(item.closes) && item.closes.length) ? item.closes[item.closes.length - 1] : null;
          var _oldPnl = 0, _oldFee = 0, _oldGross = 0;
          if (_legMode === 'edit' && _oldEvt) {
            if (_rpAccrue && isFinite(parseFloat(_oldEvt.pnl))) _oldPnl = parseFloat(_oldEvt.pnl);
            if (_rfOk && isFinite(parseFloat(_oldEvt.fee))) _oldFee = parseFloat(_oldEvt.fee);
            if (_rgOk) {
              if (isFinite(parseFloat(_oldEvt.gross))) _oldGross = parseFloat(_oldEvt.gross);
              else if (_rpAccrue && isFinite(parseFloat(_oldEvt.pnl))) {
                _oldGross = parseFloat(_oldEvt.pnl)
                  + (isFinite(parseFloat(_oldEvt.fee)) ? parseFloat(_oldEvt.fee) : 0);
              }
            }
          }
          item.realizedPnl = parseFloat(((_rpB || 0) - _oldPnl + _legNet).toFixed(2));
          // 不可重建的累计不写：写了就把「剩余 fee + 已实现 fee = 原始费用」这条链永久打脏。
          if (_rfOk) item.realizedFee = parseFloat(((parseFloat(item.realizedFee) || 0) - _oldFee + _legFee).toFixed(8));
          if (_rgOk) item.grossPnlAmount = parseFloat(((parseFloat(item.grossPnlAmount) || 0) - _oldGross + _legGross).toFixed(2));
          item.pnlAmount = parseFloat(item.realizedPnl.toFixed(2));
          var _bR1 = parseFloat(item.initialRiskAmount);
          item.rMultiple = (isFinite(_bR1) && _bR1 > 0)
            ? parseFloat((item.realizedPnl / _bR1).toFixed(2))
            : (_legSett.rMultiple == null ? null : parseFloat(_legSett.rMultiple.toFixed(2)));
          var _bM1 = parseFloat(item.initialMargin);
          item.pnlPercent = (isFinite(_bM1) && _bM1 > 0)
            ? parseFloat((item.realizedPnl / _bM1 * 100).toFixed(2))
            : parseFloat(_legSett.pnlPercent.toFixed(2));
          // 与 emRecalc 实时预览口径对齐：把本腿盈亏/收益率/R 写回表单，
          // 否则下方 gv('emPnlAmount'/'emPnlPercent'/'emRMultiple') 回读 emRecalc 的全仓值覆盖本腿结果
          var _pnlEl = document.getElementById('emPnlAmount');
          if (_pnlEl) _pnlEl.value = String(item.pnlAmount);
          var _ppEl = document.getElementById('emPnlPercent');
          if (_ppEl) _ppEl.value = String(item.pnlPercent);
          var _rmEl = document.getElementById('emRMultiple');
          if (_rmEl) _rmEl.value = String(item.rMultiple);
          // 补全 closes[] 末条审计字段（syncCloseBookkeeping 只写了 type/ratio）
          var _lastEvt = (Array.isArray(item.closes) && item.closes.length) ? item.closes[item.closes.length - 1] : null;
          if (_lastEvt && (item.closeType === 'partialTP' || item.closeType === 'reducePosition')) {
            if (_lastEvt.type !== item.closeType) _lastEvt.type = item.closeType;
            _lastEvt.price = _legCp;
            _lastEvt.pnl = parseFloat(_legNet.toFixed(2));
            _lastEvt.fee = parseFloat(_legFee.toFixed(8));
            _lastEvt.gross = parseFloat(_legGross.toFixed(2));
            _lastEvt.time = new Date().toISOString();
            _lastEvt.ratioOfRemaining = _lastLegRoR;
          }
        }
      }
    }
  } else {
    // P1 修复（2026-10-03）：closeType 改成非分批类型 = 断言整笔已退出，同步
    // closedRatio/closes，避免留下 closedRatio=50 + closes 非空的孤立簿记。
    // 权威实现在 utils.js（closedRatio 置 100 而非 0）。
    // closeType 为空（emCloseType 的「—」选项，即用户主动取消平仓标记）时 syncCloseBookkeeping
    // 直接不动簿记——见 utils.js 里该函数开头的护栏。
    window.utils.syncCloseBookkeeping(item, item.closeType, null);
  }
  // 空串必须显式写 null：gn('') 返 null，只写 `!== null` 的守卫会跳过赋值，旧的平仓价被
  // 静默沿用 —— 下方「平仓价格不能为空」闸门永不触发，用户以为删掉了价格实际还是老值。
  // 同款分支 1314/1315/1316/1336/1337 都有，只有平仓价漏了。
  v = gn('emClosePrice'); if (v !== undefined && v !== null) item.closePrice = v;
  else if (document.getElementById('emClosePrice')?.value === '') item.closePrice = null;
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
  // 极值合法性校验（编辑路径同样生效：用户主动修正时提示填反/未包住关键价位）
  if (typeof validateExtremes === 'function') {
    var _editCp = (item.closePrice != null && !isNaN(parseFloat(item.closePrice)) && parseFloat(item.closePrice) > 0)
      ? parseFloat(item.closePrice) : null;
    validateExtremes(item, _editCp);
  }
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

  // P1 修复（2026-10-14）：撤销平仓标记必须显式清理，不能依赖 syncCloseBookkeeping 的
  // 空值护栏。护栏只防「凭空造悬空态」，不清理已存在的平仓数据 —— 实测 closeType 改回「—」
  // 后 closedRatio=100 / closes / closePrice / closeTime / pnlAmount=30 全留，而
  // utils.isClosedTrade 判「未平仓」，这笔交易从已平仓统计（胜率/期望/曲线/凯利样本）
  // 里整笔消失；同时 positionSize 仍为 0（下方置零守卫被空 closeType 挡住）而敞口无法
  // 回滚，CSV 会导出一条「已平 100% 却没平」的矛盾记录。
  // 位置必须在全部表单回读（1318/1333-1335 等）之后 —— 回读会把 emPnlAmount /
  // emPnlPercent 的预填值写回 item，放前面等于白清。closeNote 是用户文本，保留。
  if (!item.closeType && beforeEdit.closeType) {
    item.closedRatio = 0;
    delete item.closes;
    delete item.partialRatio;
    delete item.closePrice;
    delete item.closeTime;
    delete item.holdDuration;
    delete item.pnlAmount;
    delete item.realizedPnl;
    delete item.realizedFee;
    delete item.grossPnlAmount;
    delete item.rMultiple;
    delete item.pnlPercent;
    delete item.lossReason;
    delete item.actualCloseFee;
    delete item.actualExitLegacySlippageCost;
    // 敞口按初始仓位锚点恢复。初始锚点是 confirmClose 开仓时写入的权威值；缺失（旧数据 /
    // 手工 CSV）时退回 保证金×杠杆，仍无则只能提示——静默保留 0 敞口比报错更危险，
    // 但也不该凭空编一个仓位出来。
    var _unmarkPos = parseFloat(item.initialPositionSize);
    var _unmarkLev = parseFloat(item.leverage) || 0;
    var _unmarkMg = parseFloat(item.initialMargin) || parseFloat(item.actualMargin) || 0;
    if (!isFinite(_unmarkPos) || _unmarkPos <= 0) {
      _unmarkPos = (_unmarkMg > 0 && _unmarkLev > 0) ? _unmarkMg * _unmarkLev : NaN;
    }
    if (isFinite(_unmarkPos) && _unmarkPos > 0) {
      item.positionSize = _unmarkPos;
      var _unmarkRisk = parseFloat(item.initialRiskAmount);
      if (isFinite(_unmarkRisk) && _unmarkRisk > 0) item.riskAmount = _unmarkRisk;
      var _unmarkMargin = parseFloat(item.initialMargin);
      if (isFinite(_unmarkMargin) && _unmarkMargin > 0) item.actualMargin = _unmarkMargin;
    } else {
      showToast('已撤销平仓标记，但缺少初始仓位锚点，敞口无法自动恢复——请手动补填仓位', 'warn');
    }
  }

  // ticks-v1 记录的执行字段改变后必须同步重建有效入场价、各路径滑点和计划费用。
  rebuildTickSlippageSnapshot(item);
  // P0 修复（2026-09-07 实测）：部分平仓链（中间态/最终平仓）的结算字段保存整笔累计口径
  // （realizedPnl/pnlAmount），编辑时不得用"剩余仓位全量"重算覆盖——否则 pnlAmount/rMultiple/
  // grossPnlAmount 被污染且与 realizedPnl 脱节，后续统计失真；最终平仓（positionSize=0）还会
  // 被结算无效拦截导致完全无法编辑。全新平仓记录（从未部分平仓）保留自动重算（改价同步 PnL）。
  // 「曾经分批」的判定必须取簿记同步之前的快照：上面的 syncCloseBookkeeping 会重建事件链，
  // 靠同步后的 closes.length 判定会与调用顺序耦合——顺序一变，收尾编辑就退化成
  // 「剩余仓位单腿重算」，把之前已实现的盈亏整段覆盖掉（实测少记 79%）。
  // P0 修复（2026-10-14 快照时机）：「曾经分批」必须取**簿记同步之前**的快照，且判据是
  // closes 里存在 PARTIAL 类型事件，而不是 closes 非空。原实现读在 syncCloseBookkeeping
  // 之后，而该调用对非分批类型必把 closedRatio 置 100 并补一条收尾事件 —— 同步后
  // closes.length 对任何已平仓记录恒 > 0，「曾分批」因此对全部已平仓记录恒真：
  //   · 「分批链收尾」分支要求 positionSize > 0，已全平记录不满足；
  //   · 「全新平仓重算」分支要求 !_hadPartialEvt，已全平记录也不满足。
  // 两个分支对已全平记录双双不可达，pnlAmount 更新了而 realizedPnl / grossPnlAmount /
  // pnlPercent / rMultiple 全部冻结在旧值 —— 实测改平仓价 52000→49000，一笔 −30 的
  // 亏损单仍带着 +30 已实现毛利和 +40 累计毛利进统计。全新平仓写入的收尾事件
  // （logs.js:384）本身不是分批事件，把它计入「曾分批」是判据本身的错误。
  var _partialNow = (item.closeType === 'partialTP' || item.closeType === 'reducePosition');
  var _PARTIAL_TYPES_RECALC = ['partialTP', 'reducePosition'];
  var _hadPartialEvt = false;
  var _partialsRatioSum = 0, _partialsPnlSum = 0, _partialsFeeSum = 0, _partialsGrossSum = 0;
  var _closeEvtFee = null;   // 旧收尾事件记录的 fee（已全平记录的收尾腿费用权威来源）
  if (Array.isArray(beforeEdit.closes)) {
    for (var _psi0 = 0; _psi0 < beforeEdit.closes.length; _psi0++) {
      var _pe0 = beforeEdit.closes[_psi0];
      if (_PARTIAL_TYPES_RECALC.indexOf(_pe0.type) < 0) {
        if (_closeEvtFee == null && isFinite(parseFloat(_pe0.fee))) {
          _closeEvtFee = parseFloat(_pe0.fee);
        }
        continue;
      }
      _hadPartialEvt = true;
      _partialsRatioSum += (parseFloat(_pe0.ratio) || 0);
      var _pePnl = parseFloat(_pe0.pnl) || 0;
      var _peFee = parseFloat(_pe0.fee) || 0;
      var _peGross = parseFloat(_pe0.gross);
      _partialsPnlSum += _pePnl;
      _partialsFeeSum += _peFee;
      // 旧事件缺 gross 时按 pnl + fee 近似（不含滑点），与下方分批腿补审计字段的口径一致
      _partialsGrossSum += isFinite(_peGross) ? _peGross : (_pePnl + _peFee);
    }
  }
  // 收尾腿占开仓原始仓位的比例（与 logs.js:346 ratioFinal 同口径）。positionSize 在最终
  // 平仓后是 0，「收尾腿实际代表多少仓位」只能由 initialPositionSize 还原 —— 不还原的话
  // calculateCloseSettlement 遇 positionSize<=0 返 null，「改一次平仓价」会退化成保存被拒。
  var _closeLegFrac = Math.max(0, Math.min(1, (100 - _partialsRatioSum) / 100));
  if (item.closeType && item.closePrice != null && typeof calculateCloseSettlement === 'function') {
    // 收尾腿结算基数：持仓中第一次收尾用当前 positionSize；已全平记录（positionSize=0）
    // 退回 initialPositionSize × 收尾腿占比（与 emRecalc 673-687 的兜底链同序）。
    var _closeLegPos = parseFloat(item.positionSize);
    var _closeFeeOverride;
    if (!isFinite(_closeLegPos) || _closeLegPos <= 0) {
      // 已全平记录：item.fee 是 confirmClose 遗留的「最终平仓前剩余费用」，并不等于收尾腿
      // 承担的费用（分批链上它已被逐腿分走）。收尾腿的费用权威来源是收尾事件自身记录的
      // fee —— 优先用它，否则无分批的旧数据退回 item.fee。不区分的话「打开即保存」会把
      // 累计盈亏从 61 改成 59（收尾腿被多扣一笔本不属于它的费用）。
      _closeFeeOverride = (_closeEvtFee != null && isFinite(_closeEvtFee) && _closeEvtFee >= 0)
        ? _closeEvtFee : null;
      var _initPos3 = parseFloat(item.initialPositionSize);
      var _lev3 = parseFloat(item.leverage) || parseFloat((document.getElementById('emLeverage') || {}).value) || 0;
      if (isFinite(_initPos3) && _initPos3 > 0) {
        _closeLegPos = _initPos3 * _closeLegFrac;
      } else {
        var _mg3 = parseFloat(item.initialMargin) || parseFloat(item.actualMargin) || 0;
        if (isFinite(_mg3) && _mg3 > 0 && _lev3 > 0) _closeLegPos = _mg3 * _lev3 * _closeLegFrac;
      }
    }
    var _closeSett = calculateCloseSettlement(
      Object.assign({}, item, { positionSize: _closeLegPos }), item.closePrice, _closeFeeOverride);
    if (!_closeSett) {
      Object.assign(item, beforeEdit);
      showToast('编辑后的平仓结算无效，请检查价格、仓位和费用。', 'warn');
      return;
    }
    if (_hadPartialEvt && !_partialNow) {
      // —— 分批链收尾 / 已全平记录改价 —— 累计按「历史分批腿之和 + 新收尾腿」重建。
      // 收尾腿是**替换**不是追加：已全平记录改价时旧收尾腿整条作废，按「累加」处理会把
      // 最后一腿算两遍（实测 50% 分批 + 收尾的单子改一次价，累计盈亏翻倍）。按分批腿
      // 求和也不依赖旧收尾腿是否有审计字段 —— 历史版本写的是裸 {type,ratio}，扣回它必漏。
      item.realizedPnl = parseFloat((_partialsPnlSum + _closeSett.netPnl).toFixed(2));
      item.realizedFee = parseFloat((_partialsFeeSum + _closeSett.fee).toFixed(8));
      // grossPnlAmount 保持"整笔累计价格毛利"语义（logs.js:354）
      item.grossPnlAmount = parseFloat((_partialsGrossSum + _closeSett.grossPnl).toFixed(2));
      item.pnlAmount = parseFloat(item.realizedPnl.toFixed(2));
      var _bRisk = parseFloat(item.initialRiskAmount);
      item.rMultiple = (Number.isFinite(_bRisk) && _bRisk > 0)
        ? parseFloat((item.realizedPnl / _bRisk).toFixed(2))
        : (_closeSett.rMultiple == null ? null : parseFloat(_closeSett.rMultiple.toFixed(2)));
      var _bMargin = parseFloat(item.initialMargin);
      item.pnlPercent = (Number.isFinite(_bMargin) && _bMargin > 0)
        ? parseFloat((item.realizedPnl / _bMargin * 100).toFixed(2))
        : parseFloat(_closeSett.pnlPercent.toFixed(2));
    } else if (!_hadPartialEvt && !_partialNow) {
      // —— 全新平仓记录（从未分批）：整笔重算，含「已全平后再改价」 ——
      item.grossPnlAmount = parseFloat(_closeSett.grossPnl.toFixed(2));
      item.pnlAmount = parseFloat(_closeSett.netPnl.toFixed(2));
      item.pnlPercent = parseFloat(_closeSett.pnlPercent.toFixed(2));
      item.rMultiple = _closeSett.rMultiple == null ? null : parseFloat(_closeSett.rMultiple.toFixed(2));
      // P0 修复：全新平仓的 realizedPnl 应该等于 pnlAmount，否则统计模块会用到旧值
      item.realizedPnl = parseFloat(_closeSett.netPnl.toFixed(2));
      item.realizedFee = parseFloat(_closeSett.fee.toFixed(8));
    }
    // 收尾事件的逐腿审计字段随新价刷新：syncCloseBookkeeping 就地更新的只有 type/ratio，
    // price/pnl/fee/gross 仍是改价前的值 —— 不改的话 CSV 导出会带上旧的逐腿明细。
    var _lastEvtF = (Array.isArray(item.closes) && item.closes.length) ? item.closes[item.closes.length - 1] : null;
    if (_lastEvtF && !_partialNow) {
      _lastEvtF.price = item.closePrice;
      _lastEvtF.pnl = parseFloat(_closeSett.netPnl.toFixed(2));
      _lastEvtF.fee = parseFloat(_closeSett.fee.toFixed(8));
      _lastEvtF.gross = parseFloat(_closeSett.grossPnl.toFixed(2));
      _lastEvtF.time = new Date().toISOString();
    }
  }

  // 平仓价格空值校验（基于 item.closePrice 原值，不依赖 DOM 空字符串误判）
  if (item.closeType && (item.closePrice == null || isNaN(item.closePrice) || item.closePrice <= 0)) {
    return abortSave('平仓价格不能为空');
  }
  // 平仓时间空值校验
  if (item.closeType && !item.closeTime) {
    return abortSave('平仓时间不能为空');
  }
  // 已平仓必须有盈亏金额。pnlAmount 为 null 时 utils.isClosedTrade 首行即判「未平仓」，
  // 「closeType=平仓 + closedRatio=100 + positionSize=0」的记录会变成既不是已平仓也
  // 不是部分平仓的悬空态：从胜率/期望值/资金曲线/凯利样本里整笔消失，同时反向进入
  // getOpenPositions 虚增持仓保证金、抬高组合热量，而 CSV 仍把它导出为已平仓。
  if (item.closeType && (item.pnlAmount == null || isNaN(parseFloat(item.pnlAmount)))) {
    return abortSave('已平仓记录的盈亏金额不能为空');
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

  // #2 FIX：已平仓记录以权威 item.pnlAmount 判定亏损，禁用实时重算。
  // 实时重算用表单「剩余仓位」(已平仓=0) 算 grossPnl = 0 - fee - slippage < 0 → 误判亏损，
  // 强拦「亏损原因」，导致已平仓记录（尤其二次编辑、或经编辑弹窗全平后）被卡死无法保存。
  // 已平仓记录的 pnlAmount 是结算权威值，实时重算对剩余 0 仓位毫无意义。
  const _alreadyClosed = !!(item.closeType && item.pnlAmount != null && !isNaN(parseFloat(item.pnlAmount)));
  let realTimeNetPnl = null;
  if (!_alreadyClosed && closePrice != null && entryForPnl != null && entryForPnl > 0) {
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

  // P0 修复：分批改非分批后补零 positionSize（对齐 logs.js:303 confirmClose 收尾口径）。
  // syncCloseBookkeeping 只把 closedRatio 置 100，却不动 positionSize，于是「已平仓」记录
  // 带着剩余敞口：CSV 仓位列与实际不符，getOpenPositions 也不再把它算进持仓（差值凭空消失）。
  // 位置必须在上面的分批链收尾结算【之后】置零——:1080 用 positionSize > 0 作为累加最后一腿的
  // 守卫，提前清零会让整段已实现盈亏被跳过（这正是该处注释所述的「少记 79%」退化）。
  // 只在「非分批 + 已平仓」时清零：分批中间态的剩余仓位是真实敞口，必须保留。
  if (item.closeType && item.closeType !== 'partialTP' && item.closeType !== 'reducePosition') {
    var _psBefore = parseFloat(item.positionSize);
    if (isFinite(_psBefore) && _psBefore !== 0) {
      item.positionSize = 0;
      delete item.partialRatio;
    }
  }

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
  // 分批建仓面板已打开时，默认拆分数 = 面板批次数（此时才按各批 alloc 比例切仓）；
  // 用户仍手填其它数字时退化为等分（见 doSaveSplit 的 hasAlloc 判定）。
  const _defCount = (calc._splitBatches && calc._splitBatches.length >= 2 && calc._splitBatches.length <= 10)
    ? calc._splitBatches.length : 2;
  overlay.innerHTML = '<div class="modal-content" style="max-width:400px;">' +
    '<div class="modal-header"><h3>拆分保存</h3><button class="modal-close" onclick="closeModalOverlay(this.closest(\'.modal-overlay\'))">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="fp"><label>拆分为几笔？</label>' +
      '<input type="number" id="splitCountInput" min="2" max="10" value="' + _defCount + '" />' +
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
  // 兜底走权威 _getDefaultFeeRate（读 feeRateLimit/feeRateMarket 设置），
  // 不再写死 0.04/0.08 —— 否则用户改手续费率后，分批快照的 item.fee
  // 会按旧费率落库，污染「成本侵蚀」等指标。
  const feeRate = Number(calc.feeRate) || _getDefaultFeeRate(calc.orderType);
  const slippageBase = calc.slippage.planning || calc.slippage.atStop;
  // 读取分批独立止损信息（由 calculate() 写入 calc._splitBatches）
  const splitBatches = calc._splitBatches || [];

  // ===== 批次占比 → 仓位分配（2026-10-12 修复）=====
  // 原实现在任何情况下都按 calc.positionSize/count 等分 N 笔，但 splitEntries.alloc
  // 却写 UI 分批面板里的各批占比（如 60/40）——「记录的占比」与「实际切出的仓位」
  // 两个权威自相矛盾：读端（编辑弹窗 e.alloc + 风险中心按 positionSize 加权）各算
  // 各话。现改为按 splitBatches 的实际占比切总仓位，占比缺失/批次与 count 不匹配
  // 时退化为等分——退化路径与旧行为一致，只有「面板明确填了 alloc」时才走比例切。
  // 末笔补余数保证 Σ(pos) === calc.positionSize（守恒，避免两位小数截断后总和漂移）。
  const hasAlloc = splitBatches.length === count &&
    splitBatches.every(function(b) { return b.alloc !== '' && b.alloc != null &&
      !isNaN(parseFloat(b.alloc)) && parseFloat(b.alloc) > 0; });
  var positions, batchAllocs;
  if (hasAlloc) {
    var _allocs = splitBatches.map(function(b) { return parseFloat(b.alloc); });
    var _allocSum = _allocs.reduce(function(s, x) { return s + x; }, 0);
    // 归一化后的占比（alloc 总和 ≠100 时自动归到 100），仓位与 batchAllocs 同用这一份，
    // 保证「记录的占比」与「实际切出的仓位」始终同源——若各算各话，70/70 会出现
    // position 按 70/30 切而 batchAllocs 记 50/50 的新矛盾。
    var _normPcts = _allocs.map(function(a) { return a / _allocSum * 100; });
    var _basePos = calc.positionSize / 100;  // 每 1% 占比对应的 USDT
    positions = []; batchAllocs = [];
    var _used = 0;
    for (var _ai = 0; _ai < count; _ai++) {
      var _p = (_ai === count - 1)
        ? calc.positionSize - _used                 // 末笔取余数，Σ 精确守恒
        : Math.round(_normPcts[_ai] * _basePos * 100) / 100;
      _used += _p;
      positions.push(parseFloat(_p.toFixed(2)));
      batchAllocs.push(parseFloat(_normPcts[_ai].toFixed(1)));
    }
  } else {
    // 等分（旧行为，含 calc.positionSize 缺省为 0 时的除零守卫由下方 hasAlloc 之外的
    // 独立判断统一在循环内兜底；count 已限 2~10）
    var _each = parseFloat((calc.positionSize / count).toFixed(2));
    positions = []; batchAllocs = [];
    for (var _ei = 0; _ei < count; _ei++) {
      var _ep = (_ei === count - 1) ? parseFloat((calc.positionSize - _each * (count - 1)).toFixed(2)) : _each;
      positions.push(_ep);
      batchAllocs.push(parseFloat((100 / count).toFixed(1)));
    }
  }

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
  // splitBatches / hasIndepSL 已在上方「批次占比 → 仓位分配」处声明（循环需要共用）
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
    // 1R 基准开仓即锁定 + 含费净 RR 落库（2026-10-10），与 saveLog 同源同字段集。
    // 缺 initialRiskAmount 会让分批记录的 R 倍数为 NaN（该字段是全站 R 的分母）；
    // 缺 rrAmounts 则复盘无法还原含费净口径。
    initialRiskAmount: parseFloat(calc.riskAmount != null ? Number(calc.riskAmount).toFixed(2) : risk.toFixed(2)),
    rrGrossProfit: calc.rrGrossProfit != null ? parseFloat(calc.rrGrossProfit.toFixed(8)) : null,
    rrNetProfit: calc.rrNetProfit != null ? parseFloat(calc.rrNetProfit.toFixed(8)) : null,
    rrNetLoss: calc.rrNetLoss != null ? parseFloat(calc.rrNetLoss.toFixed(8)) : null,
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
    // 与 saveLog 同源（rrAmounts.netProfit）。「盈亏比偏差」靠它做同口径比对，
    // 分批保存路径漏掉这里会让分批记录永远进不了该指标的分母。
    plannedNetProfit: calc.targetNetProfit != null ? calc.targetNetProfit : null,
    groupLabel: groupLabel,
    splitEntries: [],  // F4: 记录分批明细
    checklistResults: calc.checklistResults ? JSON.parse(JSON.stringify(calc.checklistResults)) : {},
    // 2026-10-10：与 saveLog 同源落库风控阈值快照，字段集必须保持一致，
    // 否则「单笔保存」与「分批保存」产出的日志无法互相复盘。
    settingsSnapshot: (typeof captureSettingsSnapshot === 'function')
      ? captureSettingsSnapshot() : (calc.settingsSnapshot ? JSON.parse(JSON.stringify(calc.settingsSnapshot)) : {}),
  });

  const splitEntries = [];
  let _stopBadCount = 0;  // P2 FIX：止损方向与仓位方向相反的批次计数
  for (let i = 0; i < count; i++) {
    const pos = positions[i];
    // 分批模式下优先使用独立止损价，未设置则回退全局。
    // 2026-10-12：独立止损方向与开仓方向相反时（如做多却填了高于入场价的止损），
    // 主计算路径按 calculator.js skippedCount 的口径**跳过该批、不计入加权止损距离**。
    // 保存路径必须对称：该批不用独立止损价（回退全局 calc.stopLoss）、风险回退均分，
    // 并记 _stopBadCount 供保存后 toast。原实现在此对 saveLog 路径不校验、doSaveSplit
    // 路径却照算 batchRisk 落库——同一份 _splitBatches 在两个权威下结论相反。
    var batchStopLoss = null;
    var _indepSL = splitBatches[i] && splitBatches[i].stopLoss && !isNaN(parseFloat(splitBatches[i].stopLoss));
    if (hasIndepSL && _indepSL) {
      var _candSL = parseFloat(splitBatches[i].stopLoss);
      var _effEntryD = calc.effectiveEntryPrice || calc.entryPrice;
      var _dirOk = (calc.direction === 'short') ? (_candSL > _effEntryD) : (_candSL < _effEntryD);
      if (_dirOk) batchStopLoss = _candSL;
      else _stopBadCount++;   // 方向非法 → 回退全局止损，下方 _stopDirOk 判定自然失效
    }
    const costs = createBatchCosts(pos, batchStopLoss);
    // 每笔风险按该笔实际止损距离重算（含批次独立止损），
    // 与主计算器 positionSize × |entry − stopLoss| / entry 口径一致；
    // 无独立止损 / 方向非法时退化为 calc.riskAmount / count 均分（与仓位切分对称）。
    const effEntry = calc.effectiveEntryPrice || calc.entryPrice;
    // P2 FIX（2026-09-23 开仓逻辑审计）：原 Math.abs 吞掉方向，止损设在错误侧也照样算出
    // "有效"风险额并落库。主计算器分批路径已按方向跳过非法批次，此处对称校验。
    var _stopDirOk = true;
    if (costs.stopLoss != null && effEntry > 0) {
      _stopDirOk = (calc.direction === 'short') ? (costs.stopLoss > effEntry) : (costs.stopLoss < effEntry);
    }
    const batchRisk = (_stopDirOk && effEntry > 0)
      ? pos * Math.abs(effEntry - costs.stopLoss) / effEntry
      : NaN;
    const risk = !isNaN(batchRisk) && batchRisk >= 0 ? batchRisk : (calc.riskAmount / count);
    const label = i === 0 ? '主' : ('第' + (i + 1) + '笔');
    const entry = makeEntry(pos, costs, risk, label, i);
    // P1 FIX（2026-09-23 开仓逻辑审计）：补 price / alloc——读取端（编辑弹窗明细表）
    // 按 e.price、e.alloc、e.stopLoss、se.weightedEntry 读取，原写入形状缺前两者。
    // 2026-10-12：alloc 改用本笔实际占比 batchAllocs[i]（比例路径=归一化后的 alloc，
    // 等分路径=100/count），与 positionSize 同源；不再直接读 UI 面板 alloc（两者可能矛盾）。
    var _b = splitBatches[i];
    var _bPrice = (_b && !isNaN(parseFloat(_b.price))) ? parseFloat(_b.price) : (calc.entryPrice || null);
    splitEntries.push({
      index: i + 1,
      price: _bPrice,
      alloc: batchAllocs[i],
      positionSize: parseFloat(pos.toFixed(2)),
      fee: parseFloat(costs.fee.toFixed(8)),
      slippageCost: parseFloat(costs.slippage.planning.totalCost.toFixed(8)),
      slippage: costs.slippage,
      riskAmount: parseFloat(risk.toFixed(2)),
      label: label,
      stopLoss: costs.stopLoss,  // 记录每笔实际使用的止损价（含方向非法时的全局回退）
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
      + '方向相反，该批已回退到全局止损价、按本批实际仓位计风险，请检查止损价设置。', 'warn');
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
  // 品种：候选 = 品种管理定义 ∪ 日志里出现过的值，两者都要。
  //   · 只取 logs（原实现）：设置里新增但还没交易过的品种在筛选器里永远选不到；
  //   · 只取定义：会漏掉历史日志里的临时品种（当初手打、没加进设置列表的）。
  // 排序：定义在前且保持设置页顺序（用户自己排的优先级），日志独有的按字母追加在后。
  var selSym = document.getElementById('fltSymbol');
  if (selSym) {
    var curVal = selSym.value;
    var symbols = [];
    var _seenSym = {};
    if (typeof getDefinedSymbols === 'function') {
      getDefinedSymbols().forEach(function(s) {
        if (_seenSym[s.symbol]) return;
        _seenSym[s.symbol] = true;
        symbols.push(s.symbol);
      });
    }
    var _fromLogs = [];
    for (var i = 0; i < logs.length; i++) { if (logs[i].symbol) _fromLogs.push(logs[i].symbol); }
    _fromLogs.sort();
    for (var j = 0; j < _fromLogs.length; j++) {
      if (_seenSym[_fromLogs[j]]) continue;
      _seenSym[_fromLogs[j]] = true;
      symbols.push(_fromLogs[j]);
    }
    selSym.innerHTML = '<option value="">全部品种</option>';
    symbols.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s === curVal) opt.selected = true;
      selSym.appendChild(opt);
    });
    // 同步自定义外壳（v5.6.14 SelectUI）：原生 innerHTML 重建后外壳 listbox 也要重绘
    if (window.SelectUI) SelectUI.syncFromNative('fltSymbol');
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
    if (window.SelectUI) SelectUI.syncFromNative('fltStrategy');
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
