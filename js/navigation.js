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

var _currentView = 'planner';

/**
 * 切换到指定视图
 * @param {string} viewName - dashboard | planner | journal | risk | analytics | review | settings
 * @param {boolean} [writeHistory] - true: 用户主动导航（pushState，浏览器后退可回退视图）
 *                                   false: popstate 回退触发（不写历史，避免 popstate→pushState 递归）
 *                                   未传: 首次加载/深链（replaceState，不产生多余历史条目）
 */
var _bypassSettingsDirtyOnce = false;

/**
 * 切换视图（对外入口）。
 * 离设置页时若检测到未保存修改，复用 confirmDialog 弹确认；
 * 取消则中止本次切换（不写历史、不丢失修改），确认则继续。
 */
function switchView(viewName, writeHistory) {
  if (!_viewMap[viewName]) {
    console.warn('[Navigation] 无效视图名:', viewName);
    return;
  }
  // 离开设置页：未保存修改需确认（避免静默丢失）。
  // confirmDialog 为异步；确认回调里用 _bypassSettingsDirtyOnce 跳过二次脏检查，
  // 否则重入 switchView 会再次触发确认形成死循环。
  if (!_bypassSettingsDirtyOnce &&
      _currentView === 'settings' && viewName !== 'settings' &&
      typeof window.settingsIsDirty === 'function' && window.settingsIsDirty()) {
    if (typeof window.confirmDialog === 'function') {
      window.confirmDialog({
        title: '放弃未保存的设置？',
        message: '系统设置页有未保存的修改，切换页面后这些修改会丢失。',
        confirmText: '放弃并切换',
        danger: true
      }).then(function(ok) {
        if (ok) {
          _bypassSettingsDirtyOnce = true;
          _doSwitchView(viewName, writeHistory);
          _bypassSettingsDirtyOnce = false;
        }
      });
      return;
    }
  }
  _doSwitchView(viewName, writeHistory);
}

function _doSwitchView(viewName, writeHistory) {
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

  // 更新 URL hash：
  //  pushState 用于用户主动导航，使浏览器后退可回退视图；
  //  replaceState 用于首次加载/深链，避免产生多余历史条目；
  //  writeHistory === false 时完全不写（popstate 回退路径，写历史会造成递归）
  if (window.location.hash.substring(1) !== viewName) {
    if (writeHistory === true) {
      history.pushState(null, '', '#' + viewName);
    } else if (writeHistory !== false) {
      history.replaceState(null, '', '#' + viewName);
    }
  }

  _currentView = viewName;

  // P1 接缝（v5.5）：常驻动画按视图暂停 —— 开仓计划的纪律 LED 滚动屏靠此事件
  // 在切走时置 animation-play-state: paused，避免在 display:none 的隐藏视图上空转。
  // 模式对齐 app.js 的 themechange：解耦、与脚本加载顺序无关，接收方无需 typeof 判空。
  window.dispatchEvent(new CustomEvent('viewchange', { detail: { view: viewName } }));

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
  // P2-5 FIX：复位为全空串对象（不是 {}，字段为 undefined 会让过滤判断走异常分支）
  // 并同步下拉框 DOM——原实现只清 _activeFilters 对象，下拉框仍停在旧值（如 "BTC"），
  // 表格显示全部但再动任意过滤器时旧条件会突然重新生效
  if (viewName !== 'journal' && viewName !== 'risk' && viewName !== 'analytics') {
    _activeFilters = { direction: '', symbol: '', strategy: '', status: '', pnl: '', time: '' };
    if (typeof syncFilterDOM === 'function') syncFilterDOM();
  }

  // 切回开仓计划时恢复分批建仓状态（从 localStorage 读取）
  // P1-3 FIX：删除原"切出即清空 _splitMode/_splitBatches 并 persistSplitState"块——
  // 它先把 localStorage 抹成空状态，紧接着的恢复块读到的正是刚被抹空的值（恢复逻辑实为死代码），
  // 且切出期间 DOM 保持"分批开启"外观而引擎已按单笔计算（入场价取空 → NaN）。
  // 分批状态应在 planner 生命周期内持续，仅由用户主动关闭（toggleSplitMode）或保存日志后
  // 由 calculator.js 自行重置。此处仅在内存尚无状态时恢复，避免用 localStorage 里的旧值
  // 覆盖切出期间用户刚输入、尚未 persistSplitState 的分批明细
  if (viewName === 'planner') {
    try {
      var _resumedSplit = JSON.parse(localStorage.getItem('trade_split_persist') || '{}');
      if ((!_splitMode || !_splitBatches.length) && _resumedSplit.mode && _resumedSplit.batches && _resumedSplit.batches.length) {
        _splitMode = true;
        _splitBatches = _resumedSplit.batches.slice();
      }
    } catch(e) { /* 忽略损坏的持久化数据，保持内存现状 */ }
  }

  // 切出仪表盘时销毁 equity 图表实例，防止重复创建累积内存
  if (viewName !== 'dashboard') {
    if (window._dashEquityChart && typeof window._dashEquityChart.destroy === 'function') {
      window._dashEquityChart.destroy();
      window._dashEquityChart = null;
    }
  }

  // 视图切换后的钩子：重新渲染该视图内的动态内容
  onViewActivated(viewName);

  // P1-2 FIX：真正的滚动容器是 #mainContent（layout.css overflow-y:auto），
  // 切换后必须回到顶部——否则新视图带着旧 scrollTop 出现，短视图下半页整片空白
  var _main = document.getElementById('mainContent');
  if (_main) _main.scrollTop = 0;
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
 * 同步分批建仓 UI 与引擎状态（_splitMode / _splitBatches）
 * 只调整按钮/区域外观并重绘分批行，不改变状态本身（不调用 toggleSplitMode）。
 */
function syncSplitModeUI() {
  var btn = document.getElementById('splitToggleBtn');
  var area = document.getElementById('splitArea');
  if (!btn || !area) return;
  if (_splitMode) {
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-layer-group"></i> 关闭分批';
    area.classList.add('open');
    if (typeof renderSplitBatches === 'function') renderSplitBatches();
    if (typeof updateSplitButtons === 'function') updateSplitButtons();
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<i class="fas fa-layer-group"></i> + 分批建仓';
    area.classList.remove('open');
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
    // P1-3 FIX：同步分批建仓 DOM 与引擎状态。分批状态跨视图切换保持（见 switchView），
    // 原实现在切出时只清内存不动 DOM，切回后界面显示"分批开启"而引擎按单笔计算
    syncSplitModeUI();
    if (typeof initMultiTPListeners === 'function') {
      initMultiTPListeners();
    }
    // 切换回开仓计划时同步 datalist（确保从设置页返回后列表已更新）
    if (typeof syncSymbolDatalist === 'function') {
      syncSymbolDatalist();
    }
    // 刷新检查清单标签文字，使其与最新设置一致
    if (typeof refreshChecklistLabels === 'function') {
      refreshChecklistLabels();
    }
    // 刷新检查清单结果，显示当前状态（若无计算结果则显示提示）
    if (typeof updateChecklist === 'function') {
      updateChecklist();
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
  // 系统设置：渲染表单。先重置品种草稿（防止带出上次未保存的编辑），再渲染。
  if (viewName === 'settings') {
    if (typeof _symbolDraftReset === 'function') _symbolDraftReset();
    if (typeof renderSettings === 'function') {
      renderSettings();
    }
    if (typeof renderCustomSymbols === 'function') {
      renderCustomSymbols();
    }
    if (typeof syncSymbolDatalist === 'function') {
      syncSymbolDatalist();
    }
    // 渲染完成后建立脏检查基准（在草稿/表单已对齐落库值之后）
    if (typeof _captureSettingsSnapshot === 'function') {
      _captureSettingsSnapshot();
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

  // 绑定导航事件
  // P1-7 FIX：nav-item 补上 href="#view" 后进入 tab 序列（键盘可访问），需要：
  //  - click 必须 preventDefault：否则浏览器会先走 href 的 hash 导航（触发 hashchange），
  //    与点击处理器各调一次 switchView，一次点击产生两条 pushState 历史条目
  //  - 补 keydown 键盘激活：Enter/Space 若不 preventDefault，href 锚点会触发页面跳转/滚动
  function activateNav(viewName, e) {
    if (e) e.preventDefault();
    if (!viewName) return;
    // 第二参 true：用户主动导航写入历史，浏览器后退可回退视图
    switchView(viewName, true);
  }
  var navItems = document.querySelectorAll('#mainNav .nav-item');
  for (var i = 0; i < navItems.length; i++) {
    (function(item) {
      var viewName = item.getAttribute('data-view');
      item.addEventListener('click', function(e) {
        activateNav(viewName, e);
      });
      item.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          activateNav(viewName, e);
        }
      });
    })(navItems[i]);
  }

  // URL hash 路由：读取初始 hash
  var hash = window.location.hash.substring(1);
  if (hash && _viewMap[hash]) {
    switchView(hash);
  } else {
    // 默认开仓计划
    switchView('planner');
  }

  // 监听浏览器前进/后退
  // P2-4 FIX：pushState 写入的历史条目在 popstate 时回退视图。
  // pushState/replaceState 不触发 hashchange，后退/前进只触发 popstate，两者互不干扰；
  // hashchange 分支保留，处理用户手改地址栏的场景。
  window.addEventListener('hashchange', function() {
    var newHash = window.location.hash.substring(1);
    if (newHash && _viewMap[newHash] && newHash !== _currentView) {
      switchView(newHash);
    }
  });
  // 第二参 false：popstate 回退路径不再写历史，避免 popstate → pushState 递归
  window.addEventListener('popstate', function() {
    var v = (location.hash || '').replace('#', '');
    if (v && _viewMap[v] && v !== _currentView) {
      switchView(v, false);
    }
  });

  // ==================== 移动端汉堡菜单 ====================
  var toggle = document.getElementById('navMobileToggle');
  var nav = document.getElementById('mainNav');
  var overlay = document.getElementById('navMobileOverlay');
  // 真正的滚动容器是 #mainContent（layout.css 中 overflow-y:auto），不是 body：
  // html,body 均为 height:100%，body 没有 overflow-y。旧实现只锁 body，抽屉打开时
  // 背景内容仍可滚动，用户会划出抽屉范围、看到被 overlay 盖住的内容在动。
  // closeMobileNav 在点击 toggle / 点击 overlay / 切换视图(≤768) / 窗口放大(>768)
  // 四条路径都会被调用，故溢出恢复覆盖全部关闭路径。
  var _drawerScroll = document.getElementById('mainContent');
  function openMobileNav() {
    if (!toggle || !nav) return;
    toggle.classList.add('open');
    nav.classList.add('open');
    if (overlay) overlay.classList.add('show');
    if (_drawerScroll) _drawerScroll.style.overflowY = 'hidden';
    document.body.style.overflow = 'hidden';   // 兜底：极端情况下 body 可能参与滚动
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeMobileNav() {
    if (!toggle || !nav) return;
    toggle.classList.remove('open');
    nav.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    if (_drawerScroll) _drawerScroll.style.overflowY = '';
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
  window.switchView = function(viewName, writeHistory) {
    _origSwitchView(viewName, writeHistory);
    if (window.innerWidth <= 768) closeMobileNav();
  };
  // 窗口放大回桌面时重置状态
  window.addEventListener('resize', function() {
    if (window.innerWidth > 768) closeMobileNav();
  });
});
