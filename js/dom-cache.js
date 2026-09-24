/**
 * DOM 元素缓存模块
 * 避免重复查询 DOM，提升性能和代码可读性
 */

/**
 * 缓存所有常用的 DOM 元素
 * 在页面加载时一次性查询，后续直接使用缓存
 */
const DOMCache = (function() {
  const cache = {};

  /**
   * 缓存单个元素
   * @param {string} id - 元素 ID
   * @returns {HTMLElement|null}
   */
  function cacheElement(id) {
    const el = document.getElementById(id);
    if (el) {
      cache[id] = el;
    }
    return el;
  }

  /**
   * 批量缓存元素
   * @param {string[]} ids - 元素 ID 数组
   * @returns {Object} 缓存对象
   */
  function cacheElements(ids) {
    ids.forEach(id => cacheElement(id));
    return cache;
  }

  /**
   * 获取缓存的元素
   * @param {string} id - 元素 ID
   * @returns {HTMLElement|null}
   */
  function get(id) {
    return cache[id] || null;
  }

  // ==================== 表单 label 自动绑定 ====================
  //
  // 项目里大量标签是「<label>名称</label><input id="..."/>' 的分离写法
  // （index.html 静态 42 处 + rendering.js / modals.js 动态渲染 35 处），
  // 缺少 for 关联，屏幕阅读器读不到字段名。这里用规则统一补上：
  //   label 无 for 且自身不含控件时，绑定「同层级下一个 <label> 之前」
  //   出现的最近一个 input/select/textarea；该控件没写 id 时补一个。
  // 用 nextElementSibling 遍历可保证不跨越父级边界。
  // 不处理的两种情况（都属预期）：
  //   1. 控件包在另一个 <label> 里（如 .switch 开关）——已有自己的标签；
  //   2. 标签下是复选框组 / 多字段说明 —— 属组标题，绑定单个控件反而误导。

  const CONTROL_SELECTOR = 'input, select, textarea';
  const wiredLabels = new WeakSet();
  let idSeq = 0;

  function freshId() {
    do {
      idSeq += 1;
    } while (document.getElementById('lbl-ctrl-' + idSeq));
    return 'lbl-ctrl-' + idSeq;
  }

  function bindLabel(label) {
    if (label.htmlFor || label.querySelector(CONTROL_SELECTOR)) return;
    let node = label.nextElementSibling;
    while (node) {
      const control = node.matches(CONTROL_SELECTOR) ? node : node.querySelector(CONTROL_SELECTOR);
      if (control && control.type !== 'hidden'
          && !control.closest('label')
          && !document.querySelector('label[for="' + control.id + '"]')) {
        // 控件没写 id 时补一个，否则 label[for] 无处可指
        // （如平仓面板的「平仓时间/持仓时长」两个只读显示框）
        if (!control.id) control.id = freshId();
        label.htmlFor = control.id;
        return;
      }
      node = node.nextElementSibling;
    }
  }

  /**
   * 为 scope 内（默认整页）未绑定的 label 补上 for 关联
   * @param {Element} [scope] - 仅扫描该子树
   */
  function wireFormLabels(scope) {
    const labels = (scope || document).querySelectorAll('label:not([for])');
    labels.forEach(label => {
      if (wiredLabels.has(label)) return;
      wiredLabels.add(label);
      bindLabel(label);
    });
  }

  let labelRaf = 0;
  let labelObserverOn = false;
  function observeLabelMutations() {
    if (!('MutationObserver' in window) || labelObserverOn) return;
    if (!document.body) return;
    labelObserverOn = true;
    const observer = new MutationObserver(mutations => {
      const targets = [];
      mutations.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n && typeof n.querySelectorAll === 'function') targets.push(n);
        });
      });
      if (!targets.length) return;
      if (labelRaf) cancelAnimationFrame(labelRaf);
      labelRaf = requestAnimationFrame(() => {
        labelRaf = 0;
        targets.forEach(wireFormLabels);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * 初始化所有 DOM 缓存
   */
  function init() {
    // 核心计算器元素
    cacheElements([
      'symbol', 'entryPrice', 'stopLoss', 'capital',
      'riskInput', 'leverage', 'direction', 'orderType', 'stopType',
      'targetPrice', 'lossStreak', 'atrValue', 'atrMultiplier'
    ]);

    // 结果展示元素
    cacheElements([
      'positionDisplay', 'marginDisplay', 'leverageDisplay', 'rrDisplay',
      'costLine1', 'costLine2', 'triggerContent', 'warningDisplay',
      'triggerRow', 'resultSplitArea', 'splitSummary', 'splitTable'
    ]);

    // 凯利相关元素
    cacheElements([
      'kellyCard', 'kellyFullPct', 'kellyHalfPct',
      'kellyExpectancy', 'kellyRiskAmount', 'kellyWarning', 'kellyApplyBtn',
      'kellyWinRate', 'kellyAvgWin', 'kellyAvgLoss', 'kellyBody', 'kellyToggleIcon'
    ]);

    // 仪表盘元素
    cacheElements([
      'dashPnlValue', 'dashPnlSub', 'dashWinRateValue', 'dashWinRateSub',
      'dashStreakValue', 'dashStreakSub', 'dashLiqList'
    ]);

    // 过滤器元素
    cacheElements([
      'fltDirection', 'fltSymbol', 'fltStrategy', 'fltStatus', 'fltPnl', 'fltTime'
    ]);

    // 按钮元素
    cacheElements([
      'calcBtn', 'saveBtn', 'resetBtn', 'exportBtn', 'clearBtn',
      'batchBtn', 'batchDeleteBtn', 'batchExportBtn', 'batchCancelBtn',
      'splitToggleBtn', 'splitSaveBtn', 'applyAtrBtn'
    ]);

    // 表单 label 关联：先扫静态 HTML，再监听后续 JS 动态渲染的标签
    wireFormLabels();
    observeLabelMutations();

    return cache;
  }

  return { init, get, cache, wireFormLabels, bindLabel };
})();

// 自动初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', DOMCache.init);
} else {
  DOMCache.init();
}

// 导出（如果使用 ES Modules）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMCache;
}
