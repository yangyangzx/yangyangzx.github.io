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

    return cache;
  }

  return { init, get, cache };
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
