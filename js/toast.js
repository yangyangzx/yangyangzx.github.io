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

})();
