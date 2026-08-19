// ==================== 主题管理器 ====================
// 独立于 DOMContentLoaded，页面随时可调用
var ThemeManager = (function() {
  var THEME_KEY = 'user_theme_v1';

  // 从 localStorage 加载主题，或根据系统偏好自动选择
  function loadPreferredTheme() {
    // 优先读取用户手动设置
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    // 其次检查系统偏好（prefers-color-scheme）
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark'; // 默认深色
  }

  function applyTheme(theme) {
    var isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    var checkbox = document.getElementById('themeToggleCheckbox');
    if (checkbox) {
      checkbox.checked = isDark;
    }
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggle() {
    var current = document.documentElement.getAttribute('data-theme');
    var newTheme = current === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    return newTheme;
  }

  // 初始化：应用保存的主题并绑定滑动开关
  function init() {
    var preferred = loadPreferredTheme();
    applyTheme(preferred);

    // 绑定滑动开关复选框（只绑定一次）
    var checkbox = document.getElementById('themeToggleCheckbox');
    if (checkbox && !checkbox._themeListenerBound) {
      checkbox.addEventListener('change', function() {
        applyTheme(this.checked ? 'dark' : 'light');
      });
      checkbox._themeListenerBound = true;
    }
  }

  return { init, toggle, applyTheme };
})();

// 如果 DOM 已就绪，立即初始化；否则等待 DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { ThemeManager.init(); });
} else {
  ThemeManager.init();
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
  // loadLogs() 已由 navigation.js 在 DOMContentLoaded 中调用，此处不再重复
  // 将已保存的设置值同步到开仓计算器表单（本金、风险比例、杠杆）
  if (typeof syncSettingsToForm === 'function') syncSettingsToForm();
  // 刷新检查清单标签文字（使其与当前设置一致）
  if (typeof refreshChecklistLabels === 'function') refreshChecklistLabels();
  updateLastUpdate();
  populateFilterOptions();
  updateBackupTime();
  filterOrderTypes(document.getElementById('direction').value);

  var directionEl = document.getElementById('direction'); if (directionEl) directionEl.addEventListener('change', function() { filterOrderTypes(this.value); });

  // P0-6 FIX: 页面可见性变化时刷新仪表盘，防止多标签页数据延迟导致 Heat / PnL / 强平预警显示过时
  var _dashRefreshTimer = null;
  function _refreshDashOnVisible() {
    if (document.hidden) return;
    if (typeof renderDashboard === 'function') renderDashboard();
  }
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      clearTimeout(_dashRefreshTimer);
      _dashRefreshTimer = setTimeout(_refreshDashOnVisible, 100);
    }
  });
  // 页面卸载时清理 timer，防止定时器泄漏
  window.addEventListener('beforeunload', function() {
    clearTimeout(_dashRefreshTimer);
  });

  var mindsetStarsEl = document.getElementById('mindsetStars');
  if (mindsetStarsEl) mindsetStarsEl.addEventListener('click', function(e) {
    if (e.target.classList.contains('star')) { renderMindsetStars(parseInt(e.target.dataset.val, 10)); }
  });

  var strategyFrameworkEl = document.getElementById('strategyFramework');
  if (strategyFrameworkEl) strategyFrameworkEl.addEventListener('change', function() { populatePatternSelect(); });

  // 全局监听所有 checkbox 变化，自动更新视觉状态（支持编辑弹窗、close panel 等动态容器）
  document.addEventListener('change', function(e) {
    if (e.target.type === 'checkbox') updateCheckboxStyle();
  });

  var calcBtn = document.getElementById('calcBtn'); if (calcBtn) calcBtn.addEventListener('click', calculate);

  // 亏损比例选择时更新金额提示
  var riskInputEl = document.getElementById('riskInput');
  if (riskInputEl) riskInputEl.addEventListener('change', function() {
    var raw = this.value.trim();
    var capitalEl = document.getElementById('capital');
    var capital = capitalEl ? parseFloat(capitalEl.value) || 0 : 0;
    var amount = NaN;
    if (raw.endsWith('%')) { amount = parseFloat(raw) / 100 * capital; }
    var hint = document.getElementById('riskHint');
    if (hint) { hint.textContent = !isNaN(amount) && amount > 0 ? '≈ ' + amount.toFixed(2) + ' USDT' : ''; }
  });
  var saveBtn = document.getElementById('saveBtn'); if (saveBtn) saveBtn.addEventListener('click', saveLog);
  var splitSaveBtn = document.getElementById('splitSaveBtn'); if (splitSaveBtn) splitSaveBtn.addEventListener('click', saveSplit);
  var resetBtn = document.getElementById('resetBtn'); if (resetBtn) resetBtn.addEventListener('click', resetForm);
  var exportBtn = document.getElementById('exportBtn'); if (exportBtn) exportBtn.addEventListener('click', exportCSV);
  var clearBtn = document.getElementById('clearBtn'); if (clearBtn) clearBtn.addEventListener('click', clearLogs);
  var batchBtn = document.getElementById('batchBtn'); if (batchBtn) batchBtn.addEventListener('click', toggleBatchMode);
  var batchDeleteBtn = document.getElementById('batchDeleteBtn'); if (batchDeleteBtn) batchDeleteBtn.addEventListener('click', batchDelete);
  var batchExportBtn = document.getElementById('batchExportBtn'); if (batchExportBtn) batchExportBtn.addEventListener('click', batchExport);
  var batchCancelBtn = document.getElementById('batchCancelBtn'); if (batchCancelBtn) batchCancelBtn.addEventListener('click', toggleBatchMode);
  var batchSelectAllEl = document.getElementById('batchSelectAll'); if (batchSelectAllEl) batchSelectAllEl.addEventListener('change', function() { batchSelectAll(this.checked); });

  var importJsonBtn = document.getElementById('importJsonBtn'); if (importJsonBtn) importJsonBtn.addEventListener('click', function() { var fi = document.getElementById('fileInput'); if (fi) fi.click(); });
  var fileInput = document.getElementById('fileInput'); if (fileInput) fileInput.addEventListener('change', function(e) {
    if (this.files && this.files.length>0) { importJSON(this.files[0]); } this.value='';
  });
  var backupBtn = document.getElementById('backupBtn'); if (backupBtn) backupBtn.addEventListener('click', function() {
    if (!logs.length) { showToast('暂无日志','info'); return; }
    downloadBackup();
  });

  // 分批建仓切换
  var splitToggleBtn = document.getElementById('splitToggleBtn'); if (splitToggleBtn) splitToggleBtn.addEventListener('click', toggleSplitMode);

  // ATR 止损辅助
  var applyAtrBtn = document.getElementById('applyAtrBtn'); if (applyAtrBtn) applyAtrBtn.addEventListener('click', function() {
    const atr = parseFloat(document.getElementById('atrValue').value);
    const mult = parseFloat(document.getElementById('atrMultiplier').value) || 1.5;
    // FIX #9: Use actual entry price (considering split mode weighted average)
    let entry;
    if (typeof getActiveEntryPrice === 'function') {
      entry = getActiveEntryPrice();
    } else {
      entry = parseFloat(document.getElementById('entryPrice').value);
    }
    if (isNaN(entry) || entry <= 0) { showToast('请先输入有效的入场价格','warn'); return; }
    if (isNaN(atr) || atr <= 0) { showToast('请输入有效 ATR 值','warn'); return; }
    const stopDistance = atr * mult;
    const dir = document.getElementById('direction').value;
    const sl = dir === 'long' ? entry - stopDistance : entry + stopDistance;
    document.getElementById('stopLoss').value = sl.toFixed(5);
    calculate();
  });

  // 计算器面板 Enter 触发计算（仅第一个 .card 内的输入框）
  document.querySelectorAll('.card:first-of-type input[type="text"], .card:first-of-type input[type="number"]').forEach(el => {
    el.addEventListener('keydown', function(e) {
      if (e.key==='Enter') { e.preventDefault(); var cb = document.getElementById('calcBtn'); if (cb) cb.click(); }
    });
  });

  var sfEl = document.getElementById('strategyFramework'); if (sfEl && sfEl.value) populatePatternSelect();

  // 入场价自动聚焦
  var entryPriceEl = document.getElementById('entryPrice');
  if (entryPriceEl) entryPriceEl.focus();

  // 表格滚动阴影
  const tw = document.getElementById('tableWrap');
  if (tw) {
    tw.addEventListener('scroll', function() {
      tw.classList.toggle('scrolled', tw.scrollTop > 2);
    }, {passive:true});
  }

});

// ==================== 过滤器控制 ====================
// 防抖：合并高频 filter 变更，避免重复 renderLogs
function _debounce(fn, delay) {
  var timer = null;
  return function() {
    var args = arguments;
    var ctx = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}

var _debouncedFilterChange = _debounce(onFilterChange, 150);

function onFilterChange() {
  _activeFilters.direction = (document.getElementById('fltDirection') || {value:''}).value;
  _activeFilters.symbol    = (document.getElementById('fltSymbol')    || {value:''}).value;
  _activeFilters.strategy  = (document.getElementById('fltStrategy')  || {value:''}).value;
  _activeFilters.status    = (document.getElementById('fltStatus')    || {value:''}).value;
  _activeFilters.pnl       = (document.getElementById('fltPnl')       || {value:''}).value;
  _activeFilters.time      = (document.getElementById('fltTime')      || {value:''}).value;
  // M9: 过滤器变更时重置面板索引，避免过滤后 panel 状态与当前列表不匹配
  openClosePanelIdx = -1;
  actionPanelIdx = -1;
  // BUG#10 修复：移除递归调用 _debouncedFilterChange，避免防抖嵌套导致延迟翻倍
}

function applyPreset(preset) {
  // 清除当前过滤
  _activeFilters = { direction: '', symbol: '', strategy: '', status: '', pnl: '', time: '' };
  // 应用预设
  if (preset === 'today')    { _activeFilters.time = 'today'; }
  if (preset === 'thisWeek') { _activeFilters.time = 'thisWeek'; }
  if (preset === 'loss')     { _activeFilters.pnl = 'loss'; }
  if (preset === 'open')     { _activeFilters.status = 'open'; }
  // 同步 DOM
  syncFilterDOM();
  renderLogs();
}

function clearFilters() {
  _activeFilters = { direction: '', symbol: '', strategy: '', status: '', pnl: '', time: '' };
  syncFilterDOM();
  renderLogs();
}

function syncFilterDOM() {
  var f = _activeFilters;
  function setVal(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
  setVal('fltDirection', f.direction);
  setVal('fltSymbol',    f.symbol);
  setVal('fltStrategy',  f.strategy);
  setVal('fltStatus',    f.status);
  setVal('fltPnl',       f.pnl);
  setVal('fltTime',      f.time);
}

// ==================== P0 分析数据诊断工具 ====================
window.debugAnalysisData = function() {
  var closed = getClosedSorted();
  console.log('=== P0 分析数据诊断 ===');
  console.log('已平仓交易总数:', closed.length);
  console.log('有 mindsetScore:', closed.filter(function(l) { return l.mindsetScore != null; }).length);
  console.log('有 executionScore (>0):', closed.filter(function(l) { return l.executionScore != null && l.executionScore > 0; }).length);
  console.log('有 executionScore (>=0):', closed.filter(function(l) { return l.executionScore != null; }).length);
  console.log('有 marketCondition:', closed.filter(function(l) { return l.marketCondition && l.marketCondition !== '未标记'; }).length);
  console.log('有 session:', closed.filter(function(l) { return l.session && l.session !== '未标记'; }).length);
  
  // 显示 sample
  if (closed.length > 0) {
    console.log('Sample log:', JSON.stringify(closed[0], function(key, value) {
      if (key === 'actions' || key === 'splitEntries') return '[...]';
      return value;
    }, 2));
  }
  
  // 返回统计数据供页面显示
  return {
    total: closed.length,
    withMindset: closed.filter(function(l) { return l.mindsetScore != null; }).length,
    withExec: closed.filter(function(l) { return l.executionScore != null && l.executionScore > 0; }).length,
    withMarket: closed.filter(function(l) { return l.marketCondition && l.marketCondition !== '未标记'; }).length,
    withSession: closed.filter(function(l) { return l.session && l.session !== '未标记'; }).length
  };
};

// ==================== Service Worker 更新通知 ====================
(function _initSWUpdate() {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.ready.then(function(reg) {
    if (!reg.waiting) return;
    // 有新版本等待激活，提示用户刷新
    if (confirm('发现新版本，是否立即刷新以获取最新内容？')) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }).catch(function(err) { console.warn('[SW] update check failed:', err); });

  navigator.serviceWorker.addEventListener('controllerchange', function() {
    // SW 控制器变更，页面已自动更新
    showToast('系统已更新至最新版本', 'success');
  });
})();
