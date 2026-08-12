/**
 * 应用状态管理模块
 * 统一管理全局状态，替代散落的全局变量
 */

/**
 * 应用状态
 * @typedef {Object} AppState
 * @property {TradeLog[]} logs - 交易日志列表
 * @property {Settings} settings - 系统设置
 * @property {CalcResult|null} lastCalc - 最后一次计算结果
 * @property {Object} filters - 当前过滤器状态
 */

/**
 * @typedef {Object} TradeLog
 * @property {string} id - 日志 ID
 * @property {string} symbol - 交易品种
 * @property {number} entryPrice - 入场价格
 * @property {number} stopLoss - 止损价格
 * @property {number} targetPrice - 目标价格
 * @property {number} positionSize - 仓位大小
 * @property {number} leverage - 杠杆倍数
 * @property {string} direction - 方向 (long/short)
 * @property {number} pnlAmount - 盈亏金额
 * @property {string} [closeTime] - 平仓时间
 * @property {string} [closeType] - 平仓类型
 */

/**
 * @typedef {Object} Settings
 * @property {boolean} atrStopEnabled - ATR 止损开关
 * @property {number} atrDefaultMultiplier - ATR 默认倍数
 * @property {number} riskPercent - 默认风险比例
 * @property {number} minRRRatio - 最低盈亏比要求
 */

/**
 * @typedef {Object} CalcResult
 * @property {string} symbol - 交易品种
 * @property {number} entryPrice - 入场价
 * @property {number} riskAmount - 风险金额
 * @property {number} riskPercent - 风险比例
 * @property {number} positionSize - 仓位大小
 * @property {number} stopDistance - 止损距离
 * @property {number} leverage - 杠杆
 * @property {string} direction - 方向
 * @property {KellyData|null} kellyData - 凯利数据
 */

/**
 * @typedef {Object} KellyData
 * @property {number} halfKellyPct - 半凯利比例
 * @property {number} halfKellyRisk - 半凯利风险金额
 * @property {number} expectancy - 期望收益
 * @property {boolean} isNegative - 是否负值
 */

const AppStore = (function() {
  // 私有状态
  let _logs = [];
  let _settings = {
    atrStopEnabled: false,
    atrDefaultMultiplier: 2,
    riskPercent: 2,
    minRRRatio: 2
  };
  let _lastCalc = null;
  let _filters = {
    direction: '',
    symbol: '',
    strategy: '',
    status: '',
    pnl: '',
    time: ''
  };

  // 变更监听器
  const _listeners = new Set();

  /**
   * 注册状态变更监听器
   * @param {Function} listener
   */
  function subscribe(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  function notify() {
    _listeners.forEach(listener => listener());
  }

  // ==================== 日志管理 ====================

  /**
   * 加载日志
   * @returns {TradeLog[]}
   */
  function loadLogs() {
    try {
      const data = localStorage.getItem('trade_logs');
      if (data) {
        _logs = JSON.parse(data);
        notify();
      }
    } catch (e) {
      console.error('加载日志失败:', e);
      _logs = [];
    }
    return _logs;
  }

  /**
   * 保存日志
   */
  function saveLogs() {
    try {
      localStorage.setItem('trade_logs', JSON.stringify(_logs));
      notify();
    } catch (e) {
      console.error('保存日志失败:', e);
    }
  }

  /**
   * 添加日志
   * @param {TradeLog} log
   */
  function addLog(log) {
    _logs.push(log);
    saveLogs();
  }

  /**
   * 删除日志
   * @param {string} id
   */
  function deleteLog(id) {
    _logs = _logs.filter(l => l.id !== id);
    saveLogs();
  }

  /**
   * 清空所有日志
   */
  function clearLogs() {
    _logs = [];
    saveLogs();
  }

  // ==================== 设置管理 ====================

  /**
   * 加载设置
   * @returns {Settings}
   */
  function loadSettings() {
    try {
      const data = localStorage.getItem('trade_settings_v1');
      if (data) {
        _settings = JSON.parse(data);
      }
    } catch (e) {
      console.error('加载设置失败:', e);
    }
    return _settings;
  }

  /**
   * 保存设置
   */
  function saveSettings() {
    localStorage.setItem('trade_settings_v1', JSON.stringify(_settings));
  }

  // ==================== 计算结果 ====================

  /**
   * 设置最后一次计算结果
   * @param {CalcResult} calc
   */
  function setLastCalc(calc) {
    _lastCalc = calc;
  }

  /**
   * 获取最后一次计算结果
   * @returns {CalcResult|null}
   */
  function getLastCalc() {
    return _lastCalc;
  }

  // ==================== 过滤器 ====================

  /**
   * 设置过滤器
   * @param {Object} newFilters
   */
  function setFilters(newFilters) {
    _filters = { ..._filters, ...newFilters };
    notify();
  }

  /**
   * 获取过滤器
   * @returns {Object}
   */
  function getFilters() {
    return _filters;
  }

  /**
   * 重置过滤器
   */
  function resetFilters() {
    _filters = {
      direction: '',
      symbol: '',
      strategy: '',
      status: '',
      pnl: '',
      time: ''
    };
    notify();
  }

  // ==================== 初始化 ====================

  /**
   * 初始化状态
   */
  function init() {
    loadLogs();
    loadSettings();
    return this;
  }

  return {
    init,
    subscribe,
    logs: {
      get: () => _logs,
      load: loadLogs,
      save: saveLogs,
      add: addLog,
      delete: deleteLog,
      clear: clearLogs
    },
    settings: {
      get: () => _settings,
      load: loadSettings,
      save: saveSettings
    },
    calc: {
      set: setLastCalc,
      get: getLastCalc
    },
    filters: {
      get: () => _filters,
      set: setFilters,
      reset: resetFilters
    }
  };
})();

// 自动初始化
AppStore.init();

// 导出（如果使用 ES Modules）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AppStore;
}
