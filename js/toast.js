// ==================== Toast 通知模块 ====================
// 挂载：window.showToast、window.showUndoToast
// 内部状态：_pendingDelete、_undoToastEl、_undoToastTimer、_commitPendingDelete

(function() {

  // ── 待删除状态（由 storage.js 中 delete 逻辑设置） ──
  window._pendingDelete = null;
  window._undoToastEl = null;
  window._undoToastTimer = null;

  /**
   * 提交待删除的日志项（超时或手动触发）
   * Supports two formats:
   * 1. Single deletion: { idx: number, timeoutId: Timer } - from rendering.js
   * 2. Batch deletion: { idx: -1, logs: Array } - from logs.js (items already removed from logs)
   */
  window._commitPendingDelete = function() {
    if (!window._pendingDelete) return;

    // Handle batch deletion format
    if (_pendingDelete && Array.isArray(_pendingDelete.logs)) {
      // For batch delete, items are already removed from logs in batchDelete()
      // Just clear indices and toast state
      if (window._pendingDeleteIndices) window._pendingDeleteIndices.clear();
      window._pendingDelete = null;
      if (window.saveLogs) saveLogs(true);
      if (window._undoToastEl) { window._undoToastEl.remove(); window._undoToastEl = null; }
      return;
    }

    // Single deletion format: { idx: number, timeoutId: ... }
    var idx = window._pendingDelete.idx;
    if (window.logs && idx >= 0 && idx < window.logs.length) {
      window.logs.splice(idx, 1);
    }
    if (window._pendingDeleteIndices) window._pendingDeleteIndices.clear();
    window._pendingDelete = null;
    if (window.saveLogs) window.saveLogs(true);
    if (window._undoToastEl) { window._undoToastEl.remove(); window._undoToastEl = null; }
  };

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
    setTimeout(function() { el.remove(); }, 2800);
  };

  /**
   * 显示带撤销按钮的 Toast
   * @param {string} msg - 消息内容
   * @param {Function} onUndo - 点击撤销时的回调
   * @param {Function} onDismiss - 超时关闭时的回调
   * @param {number} [timeoutMs=3000] - 自动关闭时间
   */
  window.showUndoToast = function(msg, onUndo, onDismiss, timeoutMs) {
    if (window._undoToastEl) { window._undoToastEl.remove(); window._undoToastEl = null; }
    if (window._undoToastTimer) { clearTimeout(window._undoToastTimer); window._undoToastTimer = null; }
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast info';
    el.style.cursor = 'default';
    el.innerHTML = '<span style="flex:1;">' + msg + '</span>' +
      '<button class="toast-undo-btn" style="background:none;border:1px solid var(--color-primary);color:var(--color-primary);border-radius:4px;padding:2px 10px;cursor:pointer;font-size:12px;margin-left:8px;">撤销</button>';
    var undoBtn = el.querySelector('.toast-undo-btn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (window._undoToastTimer) { clearTimeout(window._undoToastTimer); window._undoToastTimer = null; }
        el.remove(); window._undoToastEl = null;
        if (onUndo) onUndo();
      });
    }
    container.appendChild(el);
    window._undoToastEl = el;
    window._undoToastTimer = setTimeout(function() {
      if (window._undoToastEl === el) { el.remove(); window._undoToastEl = null; }
      window._undoToastTimer = null;
      if (onDismiss) onDismiss();
    }, timeoutMs || 3000);
  };

})();
