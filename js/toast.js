// ==================== Toast 通知模块 ====================
// 挂载：window.showToast、window.showUndoToast
// 内部状态：_pendingDelete、_undoToastEl、_undoToastTimer、_commitPendingDelete

(function() {

  var TOAST_DEFAULT_DURATION = 4000; // 4s — WCAG 建议可交互通知 ≥ 4s
  var TOAST_UNDO_DURATION = 5000;    // 5s — undo toast 更长时间让用户有操作空间
  var TOAST_EXIT_MS = 200;           // 退出动画时长，与 --dur-normal 一致

  // 退出动画由 JS 驱动：先加 .toast-exit 播 toastOutBottom，结束后再移除。
  // 修复 CSS 固定 2.5s 退出 vs JS 4s/5s 移除的错位（不可见 toast 曾拦截点击，
  // 撤销按钮后半程不可见）。
  function _dismissToast(el) {
    if (!el || el._toastDismissing) return;
    el._toastDismissing = true;
    el.classList.add('toast-exit');
    setTimeout(function() { el.remove(); }, TOAST_EXIT_MS);
  }

  // ── 待删除状态（由 storage.js 中 delete 逻辑设置） ──
  window._pendingDelete = null;
  window._undoToastEl = null;
  window._undoToastTimer = null;

  /**
   * 提交待删除的日志项（超时或手动触发）
   */
  window._commitPendingDelete = function() {
    if (!window._pendingDelete) return;

    // Handle batch deletion format
    if (_pendingDelete && Array.isArray(_pendingDelete.logs)) {
      if (window._pendingDeleteIndices) window._pendingDeleteIndices.clear();
      window._pendingDelete = null;
      if (window.saveLogs) saveLogs(true);
      // P0-6: 批量删除后刷新仪表盘
      if (typeof renderDashboard === 'function') renderDashboard();
      // P0: 同步刷新日志表，清除幽灵行（DOM 行残留会导致 data-idx 索引错位）
      if (typeof renderLogs === 'function') renderLogs();
      if (window._undoToastEl) { _dismissToast(window._undoToastEl); window._undoToastEl = null; }
      return;
    }

    // Single deletion format
    var idx = window._pendingDelete.idx;
    if (window.logs && idx >= 0 && idx < window.logs.length) {
      window.logs.splice(idx, 1);
    }
    if (window._pendingDeleteIndices) window._pendingDeleteIndices.clear();
    window._pendingDelete = null;
    if (window.saveLogs) window.saveLogs(true);
    // P0-6: 单条删除后刷新仪表盘
    if (typeof renderDashboard === 'function') renderDashboard();
    // P0: 同步刷新日志表，清除幽灵行（DOM 行残留会导致 data-idx 索引错位）
    if (typeof renderLogs === 'function') renderLogs();
    if (window._undoToastEl) { _dismissToast(window._undoToastEl); window._undoToastEl = null; }
  };

  /**
   * 清除定时器（由 pause-on-hover/focus 使用）
   */
  function _clearToastTimer(el) {
    if (window._undoToastTimer) {
      clearTimeout(window._undoToastTimer);
      window._undoToastTimer = null;
    }
  }

  /**
   * 重新计时的定时器（用户交互后重置）
   */
  function _restartToastTimer(el, onDismiss, duration) {
    if (window._undoToastTimer) clearTimeout(window._undoToastTimer);
    window._undoToastTimer = setTimeout(function() {
      if (window._undoToastEl === el) { _dismissToast(el); window._undoToastEl = null; }
      window._undoToastTimer = null;
      if (onDismiss) onDismiss();
    }, duration);
  }

  /**
   * 显示 Toast 通知
   * @param {string} msg - 消息内容
   * @param {string} [type='info'] - 类型：info / success / warn / error
   */
  window.showToast = function(msg, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var existing = container.querySelector('.toast.' + type);
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    // 4s 自动消失
    var timer = setTimeout(function() { _dismissToast(el); }, TOAST_DEFAULT_DURATION);
    // pause-on-hover / pause-on-focus — WCAG 2.2.2
    el.addEventListener('mouseenter', function() { clearTimeout(timer); });
    el.addEventListener('focus', function() { clearTimeout(timer); });
    el.addEventListener('mouseleave', function() {
      timer = setTimeout(function() { _dismissToast(el); }, 1500); // 重新计时 1.5s
    });
    el.addEventListener('blur', function() {
      timer = setTimeout(function() { _dismissToast(el); }, 1500);
    });
  };

  /**
   * 显示带撤销按钮的 Toast
   * @param {string} msg - 消息内容
   * @param {Function} onUndo - 点击撤销时的回调
   * @param {Function} onDismiss - 超时关闭时的回调
   * @param {number} [timeoutMs] - 自动关闭时间
   */
  window.showUndoToast = function(msg, onUndo, onDismiss, timeoutMs) {
    if (window._undoToastEl) { window._undoToastEl.remove(); window._undoToastEl = null; }
    if (window._undoToastTimer) { clearTimeout(window._undoToastTimer); window._undoToastTimer = null; }
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast info';
    // 容器 #toastContainer 已挂 role="status" + aria-live="polite"，
    // 这里不再单独挂 role="alert"——两个朗读源会让读屏把同一条消息念两遍
    el.innerHTML = '<span style="flex:1;">' + msg + '</span>' +
      '<button class="toast-undo-btn" aria-label="撤销操作">撤销</button>';
    var undoBtn = el.querySelector('.toast-undo-btn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _clearToastTimer(el);
        _dismissToast(el);
        window._undoToastEl = null;
        if (onUndo) onUndo();
      });
    }
    container.appendChild(el);
    window._undoToastEl = el;
    var duration = timeoutMs || TOAST_UNDO_DURATION;
    window._undoToastTimer = setTimeout(function() {
      if (window._undoToastEl === el) { _dismissToast(el); window._undoToastEl = null; }
      window._undoToastTimer = null;
      if (onDismiss) onDismiss();
    }, duration);
    // pause-on-hover / pause-on-focus
    el.addEventListener('mouseenter', function() { _clearToastTimer(el); });
    el.addEventListener('focus', function() { _clearToastTimer(el); });
    el.addEventListener('mouseleave', function() {
      _restartToastTimer(el, onDismiss, 2000);
    });
    el.addEventListener('blur', function() {
      _restartToastTimer(el, onDismiss, 2000);
    });
  };

  // ==================== 指标说明弹出层 ====================
  // 统计指标的解释文案原先只写在 title= 属性里：触屏永不显示、键盘不可达。
  // 现由 .stat-info 按钮（index.html 内的 ⓘ）触发应用内弹出层，鼠标/键盘/触屏三条路径都能读。
  //
  // 文案来源有两处，合并展示：
  //   1) .stat-item[data-tip]      —— 静态写在 index.html 的「计算公式 / 参考价值」
  //   2) 后代元素的 title          —— stats.js 每次渲染按当前数据补的（如「跨度 12.3 天」）
  // 动态部分不缓存，每次打开都重新读，避免显示上一轮渲染的过期数字。
  //
  // 事件全部委托到 document：stats.js 会整块重写 .stats-panel 的 innerHTML，
  // 逐元素绑定会在重渲染后失效。

  var _tipEl = null;
  var _tipOwner = null;
  var _tipOpenedAt = 0;

  // 自带转义，不依赖全局 esc —— 跨模块裸标识符是本项目踩过的坑（见 CLAUDE.md）
  function _escTip(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function closeStatTip() {
    if (_tipEl && _tipEl.parentNode) _tipEl.parentNode.removeChild(_tipEl);
    _tipEl = null;
    if (_tipOwner) {
      var prev = _tipOwner.querySelector('.stat-info');
      if (prev) prev.setAttribute('aria-expanded', 'false');
    }
    _tipOwner = null;
  }

  function openStatTip(btn) {
    var item = btn.closest ? btn.closest('.stat-item') : null;
    if (!item) return;
    closeStatTip();

    var parts = [];
    var base = item.getAttribute('data-tip');
    if (base) parts.push(base);
    var titled = item.querySelectorAll('[title]');
    for (var i = 0; i < titled.length; i++) {
      var t = titled[i].getAttribute('title');
      if (t) parts.push(t);
    }
    if (!parts.length) return;

    var el = document.createElement('div');
    el.className = 'stat-tip-popover';
    el.setAttribute('role', 'tooltip');
    var html = '';
    for (var p = 0; p < parts.length; p++) html += '<p>' + _escTip(parts[p]) + '</p>';
    el.innerHTML = html;
    document.body.appendChild(el);

    // 默认贴在按钮下方；下方放不下就翻到上方。水平居中后 clamp 进视口。
    var r = btn.getBoundingClientRect();
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    el.style.left = left + 'px';
    el.style.top = top + 'px';

    _tipEl = el;
    _tipOwner = item;
    _tipOpenedAt = Date.now();
    btn.setAttribute('aria-expanded', 'true');
  }

  document.addEventListener('click', function(e) {
    var btn = e.target.closest ? e.target.closest('.stat-info') : null;
    if (btn) {
      e.preventDefault();
      var sameOwner = !!( _tipOwner && _tipOwner.contains(btn) );
      // 指针点击会先派发 focusin（已把浮层展开），紧接着才轮到 click。
      // 若不区分「刚被这次交互打开」和「本来就开着」，单击会立刻把自己的浮层关掉。
      if (sameOwner && Date.now() - _tipOpenedAt < 400) return;
      if (sameOwner) { closeStatTip(); return; }   // 再点一次 = 收起
      openStatTip(btn);
      return;
    }
    if (_tipEl && !_tipEl.contains(e.target)) closeStatTip();
  }, true);

  // 键盘：聚焦即展开（与 title 的 hover 行为对齐），失焦收起
  document.addEventListener('focusin', function(e) {
    var btn = e.target.closest ? e.target.closest('.stat-info') : null;
    if (btn) openStatTip(btn);
  });

  document.addEventListener('focusout', function(e) {
    var btn = e.target.closest ? e.target.closest('.stat-info') : null;
    if (btn && _tipOwner && _tipOwner.contains(btn)) closeStatTip();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _tipEl) { closeStatTip(); }
  });

  // 滚动/缩放后锚点位置失效，直接收起，避免浮层停在错误的位置
  window.addEventListener('scroll', closeStatTip, true);
  window.addEventListener('resize', closeStatTip);

})();
