// ==================== Toast 通知模块 ====================
// 挂载：window.showToast、window.showUndoToast
// 内部状态：_pendingDelete、_undoToastEl、_undoToastTimer、_commitPendingDelete

(function() {

  var TOAST_DEFAULT_DURATION = 4000; // 4s — WCAG 建议可交互通知 ≥ 4s
  var TOAST_UNDO_DURATION = 5000;    // 5s — undo toast 更长时间让用户有操作空间

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
      if (window._undoToastEl) { window._undoToastEl.remove(); window._undoToastEl = null; }
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
    if (window._undoToastEl) { window._undoToastEl.remove(); window._undoToastEl = null; }
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
      if (window._undoToastEl === el) { el.remove(); window._undoToastEl = null; }
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
    var timer = setTimeout(function() { el.remove(); }, TOAST_DEFAULT_DURATION);
    // pause-on-hover / pause-on-focus — WCAG 2.2.2
    el.addEventListener('mouseenter', function() { clearTimeout(timer); });
    el.addEventListener('focus', function() { clearTimeout(timer); });
    el.addEventListener('mouseleave', function() {
      timer = setTimeout(function() { el.remove(); }, 1500); // 重新计时 1.5s
    });
    el.addEventListener('blur', function() {
      timer = setTimeout(function() { el.remove(); }, 1500);
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
    el.setAttribute('role', 'alert');
    el.innerHTML = '<span style="flex:1;">' + msg + '</span>' +
      '<button class="toast-undo-btn" aria-label="撤销操作">撤销</button>';
    var undoBtn = el.querySelector('.toast-undo-btn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _clearToastTimer(el);
        el.remove();
        window._undoToastEl = null;
        if (onUndo) onUndo();
      });
    }
    container.appendChild(el);
    window._undoToastEl = el;
    var duration = timeoutMs || TOAST_UNDO_DURATION;
    window._undoToastTimer = setTimeout(function() {
      if (window._undoToastEl === el) { el.remove(); window._undoToastEl = null; }
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
