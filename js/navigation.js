// ==================== 导航系统 ====================

// 视图名称映射：nav data-view -> section id
var _viewMap = {
  'dashboard':  'view-dashboard',
  'planner':    'view-planner',
  'journal':    'view-journal',
  'risk':       'view-risk',
  'analytics':  'view-analytics',
  'review':     'view-review',
  'settings':   'view-settings'
};

var _currentView = 'dashboard';

/**
 * 切换到指定视图
 * @param {string} viewName - dashboard | planner | journal | risk | analytics | review | settings
 */
function switchView(viewName) {
  // 合法性检查
  if (!_viewMap[viewName]) {
    console.warn('[Navigation] 无效视图名:', viewName);
    return;
  }

  var viewId = _viewMap[viewName];

  // 隐藏所有视图
  var allViews = document.querySelectorAll('.view');
  for (var i = 0; i < allViews.length; i++) {
    allViews[i].classList.remove('active');
  }

  // 显示目标视图
  var targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
  }

  // 更新导航高亮
  updateNavActive(viewName);

  // 更新 URL hash
  if (window.location.hash.substring(1) !== viewName) {
    history.replaceState(null, '', '#' + viewName);
  }

  _currentView = viewName;

  // 从日志视图切出时退出批量模式
  if (viewName !== 'journal' && window._batchMode) {
    window._batchMode = false;
    if (window._selectedIndices) window._selectedIndices.clear();
    var batchBar = document.getElementById('batchBar');
    if (batchBar) batchBar.classList.remove('show');
    var checkboxes = document.querySelectorAll('.batch-checkbox');
    for (var bi = 0; bi < checkboxes.length; bi++) checkboxes[bi].classList.remove('show');
  }

  // 切出非日志/统计视图时清除过滤器状态
  if (viewName !== 'journal' && viewName !== 'risk' && viewName !== 'analytics') {
    window._activeFilters = {};
  }

  // 视图切换后的钩子：重新渲染该视图内的动态内容
  onViewActivated(viewName);
}

/**
 * 更新导航菜单 active 状态
 */
function updateNavActive(viewName) {
  var items = document.querySelectorAll('#mainNav .nav-item');
  for (var i = 0; i < items.length; i++) {
    var dv = items[i].getAttribute('data-view');
    if (dv === viewName) {
      items[i].classList.add('active');
      items[i].setAttribute('aria-current', 'page');
    } else {
      items[i].classList.remove('active');
      items[i].removeAttribute('aria-current');
    }
  }
}

/**
 * 视图激活钩子：通知各模块视图已切换
 */
function onViewActivated(viewName) {
  // 仪表盘：渲染驾驶舱卡片
  if (viewName === 'dashboard') {
    if (typeof renderDashboard === 'function') {
      renderDashboard();
    }
  }
  // 如果切到 journal 视图，需要刷新日志表格
  if (viewName === 'journal') {
    if (typeof renderLogs === 'function') {
      renderLogs();
    }
  }
  // 开仓计划：初始化多止盈位事件监听
  if (viewName === 'planner') {
    if (typeof initMultiTPListeners === 'function') {
      initMultiTPListeners();
    }
    // 切换回开仓计划时同步 datalist（确保从设置页返回后列表已更新）
    if (typeof syncSymbolDatalist === 'function') {
      syncSymbolDatalist();
    }
  }
  // 风控中心：渲染风险指标
  if (viewName === 'risk') {
    if (typeof renderRiskCenter === 'function') {
      renderRiskCenter();
    }
  }
  // 统计分析：销毁旧图表并重新渲染
  if (viewName === 'analytics') {
    if (typeof destroyAnalyticsCharts === 'function') destroyAnalyticsCharts();
    if (typeof renderAnalytics === 'function') renderAnalytics();
  }
  // 复盘中心：销毁旧图表并重新渲染
  if (viewName === 'review') {
    if (typeof destroyReviewCharts === 'function') destroyReviewCharts();
    if (typeof renderReview === 'function') renderReview();
  }
  // 系统设置：渲染表单
  if (viewName === 'settings') {
    if (typeof renderSettings === 'function') {
      renderSettings();
    }
    if (typeof renderCustomSymbols === 'function') {
      renderCustomSymbols();
    }
    if (typeof syncSymbolDatalist === 'function') {
      syncSymbolDatalist();
    }
  }
}

/**
 * 获取当前视图名
 */
function getCurrentView() {
  return _currentView;
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
  // 必须在导航路由前加载日志数据，否则视图渲染时 logs 为空
  if (typeof loadLogs === 'function') loadLogs();
  // 加载日志后自动填充凯利参数
  if (typeof autoFillKellyFromLogs === 'function') autoFillKellyFromLogs();

  // 绑定导航点击事件
  var navItems = document.querySelectorAll('#mainNav .nav-item');
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function(e) {
      e.preventDefault();
      var viewName = this.getAttribute('data-view');
      if (viewName) {
        switchView(viewName);
      }
    });
  }

  // URL hash 路由：读取初始 hash
  var hash = window.location.hash.substring(1);
  if (hash && _viewMap[hash]) {
    switchView(hash);
  } else {
    // 默认仪表盘
    switchView('dashboard');
  }

  // 监听浏览器前进/后退
  window.addEventListener('hashchange', function() {
    var newHash = window.location.hash.substring(1);
    if (newHash && _viewMap[newHash] && newHash !== _currentView) {
      switchView(newHash);
    }
  });

  // ==================== 移动端汉堡菜单 ====================
  var toggle = document.getElementById('navMobileToggle');
  var nav = document.getElementById('mainNav');
  var overlay = document.getElementById('navMobileOverlay');
  function openMobileNav() {
    if (!toggle || !nav) return;
    toggle.classList.add('open');
    nav.classList.add('open');
    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeMobileNav() {
    if (!toggle || !nav) return;
    toggle.classList.remove('open');
    nav.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
    toggle.setAttribute('aria-expanded', 'false');
  }
  if (toggle) {
    toggle.addEventListener('click', function() {
      nav.classList.contains('open') ? closeMobileNav() : openMobileNav();
    });
  }
  if (overlay) {
    overlay.addEventListener('click', closeMobileNav);
  }
  // 切换视图后关闭移动端菜单
  var _origSwitchView = switchView;
  window.switchView = function(viewName) {
    _origSwitchView(viewName);
    if (window.innerWidth <= 768) closeMobileNav();
  };
  // 窗口放大回桌面时重置状态
  window.addEventListener('resize', function() {
    if (window.innerWidth > 768) closeMobileNav();
  });
});
