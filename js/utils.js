// ==================== 工具函数库 ====================
// 全局挂载：window.utils = { ... }
// 依赖：全局变量 logs（由 trading.html 内联脚本或 storage.js 定义）

(function() {
  var util = {};

  // ======== 来自 risk.js ========
  /**
   * P0-1 判定：一条日志是否为"最终平仓"（整笔交易已全部退出）。
   * partialTP / reducePosition 是部分平仓中间态，剩余仓位仍属持仓，
   * 只有全部平仓后才进入"已平仓"统计（胜率/资金曲线/日盈亏/凯利样本）。
   * @param {Object} item 日志对象
   * @returns {boolean}
   */
  util.isClosedTrade = function(item) {
    if (!item || !item.closeType || item.closeType === '') return false;
    if (item.pnlAmount == null || isNaN(parseFloat(item.pnlAmount))) return false;
    if (item.closeType === 'partialTP' || item.closeType === 'reducePosition') {
      // 新格式：以累计平仓比例判定；旧格式一律视为中间态（剩余仓位回归持仓监控）
      if (Array.isArray(item.closes)) {
        var cr = parseFloat(item.closedRatio);
        return !isNaN(cr) && cr >= 99.999;
      }
      return false;
    }
    return true;
  };

  /**
   * P0-1 判定：是否为"部分平仓"中间态（有剩余仓位在持仓监控中）
   * @param {Object} item 日志对象
   * @returns {boolean}
   */
  util.isPartialClosed = function(item) {
    if (!item || !item.closeType) return false;
    if (item.closeType === 'partialTP' || item.closeType === 'reducePosition') {
      if (Array.isArray(item.closes)) {
        var cr = parseFloat(item.closedRatio);
        return !isNaN(cr) && cr > 0 && cr < 99.999;
      }
      return true;
    }
    return false;
  };

  /**
   * 获取按平仓时间排序的"最终平仓"日志（整笔交易已全部退出，pnlAmount 为整笔累计已实现盈亏）
   * @returns {Array} 已平仓日志数组（按 closeTime 升序）
   */
  util.getClosedSorted = function() {
    var closed = [];
    for (var i = 0; i < logs.length; i++) {
      if (util.isClosedTrade(logs[i])) {
        var item = Object.assign({}, logs[i]);
        item.pnlAmount = parseFloat(item.pnlAmount);
        closed.push(item);
      }
    }
    closed.sort(function(a, b) {
      var ta = a.closeTime ? new Date(a.closeTime).getTime() : 0;
      var tb = b.closeTime ? new Date(b.closeTime).getTime() : 0;
      return ta - tb;
    });
    return closed;
  };

  // ======== 来自 analytics.js ========
  /**
   * 格式化 ISO 日期字符串为 yyyy-MM-dd
   * @param {string} isoStr - ISO 日期字符串
   * @returns {string} 格式化的日期字符串
   */
  util.fmtDate = function(isoStr) {
    if (!isoStr) return '—';
    var d = new Date(isoStr);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  };

  /**
   * 安全解析数字，失败返回 null
   * @param {*} val - 待解析的值
   * @returns {number|null} 解析后的数字或 null
   */
  util.safeParseNum = function(val) {
    if (val == null || val === '') return null;
    var n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  // ======== 来自 storage.js ========
  /**
   * 时间格式化（兼容 ISO / locale）
   * @param {string} t - 时间字符串
   * @returns {string} 格式化的时间字符串 yyyy-MM-dd HH:mm
   */
  util.fmtTime = function(t) {
    if (!t) return '';
    var d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0') + ' ' +
      String(d.getHours()).padStart(2,'0') + ':' +
      String(d.getMinutes()).padStart(2,'0');
  };

  /**
   * 旧版 zh-CN locale 时间 → ISO 字符串
   * @param {string} t - 时间字符串
   * @returns {string} ISO 格式时间字符串
   */
  util._localeToISO = function(t) {
    if (!t || t.indexOf('T') !== -1) return t;
    var m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') +
      'T' + m[4].padStart(2, '0') + ':' + m[5].padStart(2, '0') + ':' + m[6].padStart(2, '0') + '.000Z';
    return t;
  };

  /**
   * 持仓时长格式化
   * @param {string} closeTime - 平仓时间
   * @param {string} openTime - 开仓时间
   * @returns {string} 格式化的持仓时长
   */
  util.formatHoldDuration = function(closeTime, openTime) {
    if (!closeTime || !openTime) return '—';
    try {
      var diffMs = new Date(closeTime) - new Date(openTime);
      if (isNaN(diffMs) || diffMs < 0) return '—';
      var totalMin = Math.round(diffMs / 60000);
      if (totalMin < 60) return totalMin + 'm';
      var hrs = Math.floor(totalMin / 60);
      var mins = totalMin % 60;
      if (hrs < 24) return hrs + 'h' + (mins > 0 ? ' ' + mins + 'm' : '');
      var days = Math.floor(hrs / 24);
      var remainHrs = hrs % 24;
      return days + 'd' + (remainHrs > 0 ? ' ' + remainHrs + 'h' : '');
    } catch(e) { return '—'; }
  };

  // ======== 共享公式 ========
  /**
   * USDT-M 逐仓强平价格（标准公式，参考主流交易所）
   * 公式来源: 币安/OKX/火币等主流期货交易所标准
   * Long:  LP = Entry × (1 - InitialMargin% + MMR%) / (1 - MMR%)
   * Short: LP = Entry × (1 + InitialMargin% - MMR%) / (1 + MMR%)
   * 其中: InitialMargin% = 1/leverage, MMR% = 维持保证金率
   * @param {number} entryPrice - 入场价
   * @param {string} direction - 'long' | 'short'
   * @param {number} leverage - 杠杆倍数
   * @param {number} mmr - 维持保证金率（小数，如 0.005 表示 0.5%）
   * @returns {number} 强平价格
   */
  util.calcLiquidationPrice = function(entryPrice, direction, leverage, mmr) {
    // 参数验证
    if (!entryPrice || entryPrice <= 0) {
      console.error('calcLiquidationPrice: invalid entryPrice', entryPrice);
      return NaN;
    }
    if (!leverage || leverage <= 0) {
      console.error('calcLiquidationPrice: invalid leverage', leverage);
      return NaN;
    }
    if (mmr == null || mmr < 0) {
      console.error('calcLiquidationPrice: invalid mmr', mmr);
      return NaN;
    }
    
    // 初始保证金率 = 1/杠杆
    const initialMarginRatio = 1 / leverage;

    let liquidationPrice;
    if (direction === 'long') {
      // BUG 修复：使用币安/OKX 标准强平价格公式
      // 正确公式: LP = Entry × (1 - IMR + MMR) / (1 - MMR)
      // 原公式缺少 MMR 修正项，导致强平价被低估约 MMR% (约 0.5%)
      liquidationPrice = entryPrice * (1 - initialMarginRatio + mmr) / (1 - mmr);

      // 合理性检查：多头强平价应低于入场价
      if (liquidationPrice >= entryPrice) {
        console.warn('calcLiquidationPrice: long liquidation price >= entry price, check parameters');
      }
    } else if (direction === 'short') {
      // 正确公式: LP = Entry × (1 + IMR - MMR) / (1 + MMR)
      liquidationPrice = entryPrice * (1 + initialMarginRatio - mmr) / (1 + mmr);

      // 合理性检查：空头强平价应高于入场价
      if (liquidationPrice <= entryPrice) {
        console.warn('calcLiquidationPrice: short liquidation price <= entry price, check parameters');
      }
    } else {
      console.error('calcLiquidationPrice: invalid direction', direction);
      return NaN;
    }
    
    // 防止负数和异常值
    if (!isFinite(liquidationPrice) || liquidationPrice <= 0) {
      console.error('calcLiquidationPrice: calculated invalid liquidation price', liquidationPrice);
      return NaN;
    }
    
    return liquidationPrice;
  };

  // ======== 本地日期字符串（统一口径） ========
  /**
   * ISO 字符串 → YYYY-MM-DD（本地时区）
   * @param {string} isoStr - ISO 时间字符串
   * @returns {string} YYYY-MM-DD 格式日期，非法输入返回空串
   */
  util.toLocalDateStr = function(isoStr) {
    if (!isoStr) return '';
    // 优先尝试 ISO 格式解析
    var d = new Date(isoStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
    // 兼容旧格式：YYYY/MM/DD HH:mm:ss 或 YYYY-MM-DD HH:mm:ss
    var m = String(isoStr).match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (m) {
      return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    }
    return '';
  };

  // ======== 已平仓交易判断（统一过滤条件） ========
  /**
   * P0-1 FIX：判断一条日志是否为"最终平仓"交易（与文件头部定义一致，此处为历史重复定义，统一语义）
   * @param {Object} item - 日志条目
   * @returns {boolean}
   */
  util.isClosedTrade = function(item) {
    if (!item || !item.closeType || item.closeType === '') return false;
    if (item.pnlAmount == null || isNaN(parseFloat(item.pnlAmount))) return false;
    if (item.closeType === 'partialTP' || item.closeType === 'reducePosition') {
      if (Array.isArray(item.closes)) {
        var cr = parseFloat(item.closedRatio);
        return !isNaN(cr) && cr >= 99.999;
      }
      return false;
    }
    return true;
  };

  /**
   * 计算权益曲线数据 — 供 stats.js / dashboard.js 统一调用
   * @param {Array} closed - 已平仓日志（需已按 closeTime 排序）
   * @param {Object} [settingsOverride] - 可选，覆盖 accountBalance
   * @returns {{ data: Array<{eq:number, pnl:number, label:string}>,
   *             initCap: number, peakVal: number, maxDDPercent: number,
   *             finalEq: number, totalPnl: number }}
   */
  util.calcEquityCurve = function(closed, settingsOverride, opts) {
    opts = opts || {};
    if (!closed || closed.length === 0) {
      return { data: [], initCap: 0, peakVal: 0, maxDDPercent: 0, finalEq: 0, totalPnl: 0 };
    }

    var sorted = [].concat(closed).sort(function(a, b) {
      return new Date(a.closeTime || a.time) - new Date(b.closeTime || b.time);
    });

    var _initCap = 0;
    if (opts.purePnl) {
      _initCap = 0;
    } else {
      // BUG#7 修复：优先使用设置中的账户余额作为权益曲线起点，避免首笔日志 capital 快照偏移导致曲线失真
      var bal = (settingsOverride && settingsOverride.accountBalance > 0) ? settingsOverride.accountBalance : 0;
      if (!bal) {
        try { var _s = loadSettings(); if (_s && _s.accountBalance > 0) bal = _s.accountBalance; } catch(e) { console.error('[utils]', e); }
      }
      if (bal > 0) _initCap = bal;
      else if (sorted.length > 0 && sorted[0].capital != null && !isNaN(sorted[0].capital) && sorted[0].capital > 0) {
        _initCap = sorted[0].capital;
      }
    }

    var data = [], cum = _initCap, peakVal = _initCap, maxDD = 0;
    for (var i = 0; i < sorted.length; i++) {
      var l = sorted[i];
      // capital 是开仓时的账户快照，不能在每次平仓时被当作“当前权益”覆盖累计 PnL。
      // 仅支持显式的 balanceAdjustment 作为未来存取款流水；未提供时权益严格连续累加已实现盈亏。
      var balanceAdjustment = Number(l.balanceAdjustment);
      if (!opts.purePnl && Number.isFinite(balanceAdjustment) && balanceAdjustment !== 0) cum += balanceAdjustment;
      var pnl = Number(l.pnlAmount);
      if (Number.isFinite(pnl)) cum += pnl;
      data.push({ eq: cum, pnl: Number.isFinite(pnl) ? pnl : 0, idx: data.length + 1 });
      peakVal = Math.max(peakVal, cum);
      maxDD = peakVal > 0 ? Math.max(maxDD, (peakVal - cum) / peakVal * 100) : maxDD;
    }

    var totalPnl = cum - _initCap;
    return {
      data: data,
      initCap: _initCap,
      peakVal: peakVal,
      maxDDPercent: maxDD,
      finalEq: cum,
      totalPnl: totalPnl
    };
  };

  // ======== 主题感知 Chart.js / Canvas 颜色桥接 ========
  /**
   * 从 CSS 变量读取当前主题的 Chart.js 配置颜色
   * @returns {{tooltipBg, tooltipTitle, tooltipBody, gridColor, tickColor, axisTitle, legendText, barBorder, positivePoint, negativePoint}}
   */
  util.getChartColors = function() {
    var style = getComputedStyle(document.documentElement);
    return {
      tooltipBg:     style.getPropertyValue('--chart-tooltip-bg').trim(),
      tooltipTitle:  style.getPropertyValue('--chart-tooltip-title').trim(),
      tooltipBody:   style.getPropertyValue('--chart-tooltip-body').trim(),
      gridColor:     style.getPropertyValue('--chart-grid-color').trim(),
      tickColor:     style.getPropertyValue('--chart-tick-color').trim(),
      axisTitle:     style.getPropertyValue('--chart-axis-title').trim(),
      legendText:    style.getPropertyValue('--chart-legend-text').trim(),
      barBorder:     style.getPropertyValue('--chart-bar-border').trim(),
      positivePoint: style.getPropertyValue('--chart-positive-point').trim(),
      negativePoint: style.getPropertyValue('--chart-negative-point').trim(),
      barWin:        style.getPropertyValue('--chart-bar-win').trim(),
      barWarn:       style.getPropertyValue('--chart-bar-warn').trim(),
      barLoss:       style.getPropertyValue('--chart-bar-loss').trim(),
      barNeutral:    style.getPropertyValue('--chart-bar-neutral').trim(),
      accentWarning: style.getPropertyValue('--chart-accent-warning').trim(),
      scatterWin:    style.getPropertyValue('--chart-scatter-win').trim(),
      scatterLoss:   style.getPropertyValue('--chart-scatter-loss').trim(),
      canvasText:    style.getPropertyValue('--chart-canvas-text').trim()
    };
  };

  /**
   * 从 CSS 变量读取当前主题的 Canvas 2D 绘制颜色
   * @returns {{text, grid, fill}}
   */
  util.getCanvasColors = function() {
    var style = getComputedStyle(document.documentElement);
    return {
      text:     style.getPropertyValue('--chart-canvas-text').trim(),
      grid:     style.getPropertyValue('--chart-canvas-grid').trim(),
      fill:     style.getPropertyValue('--chart-canvas-fill').trim(),
      bg:       style.getPropertyValue('--chart-canvas-bg').trim(),
      zero:     style.getPropertyValue('--chart-canvas-zero').trim(),
      up:       style.getPropertyValue('--chart-canvas-up').trim(),
      down:     style.getPropertyValue('--chart-canvas-down').trim(),
      ptCenter: style.getPropertyValue('--chart-canvas-ptcenter').trim()
    };
  };

// ======== 滑点成本计算 ========
// P2-6 FIX：删除未接入的"市场微观结构"静态模拟模型（calculateOrderSizeImpact /
// calculateVolatilityImpact / calculateLiquidityImpact）。这三个函数此前无任何调用点，
// 且其硬编码的日交易量/订单簿深度/波动率并非真实市场数据，保留会误导维护者。
// 实际滑点统一由 slippage.js 的 ticks-v1 模型（用户显式输入 ticks + 交易所 tickSize）承担。

// ======== Chart.js 生命周期管理系统 ========
/**
 * ChartManager - Chart.js实例生命周期管理器
 * 解决内存泄漏问题，确保所有Chart实例正确销毁和重用
 * 基于专业前端性能优化最佳实践设计
 */
const ChartManager = {
  // 注册表：跟踪所有活跃的Chart实例
  instances: new Map(),
  
  // 配置常量
  CONFIG: {
    maxInstances: 20,        // 最大实例数限制
    cleanupThreshold: 15,    // 触发清理的阈值
    destroyTimeout: 1000,    // 销毁超时时间(ms)
    memoryCheckInterval: 30000 // 内存检查间隔(ms)
  },
  
  /**
   * 注册Chart实例
   * @param {string} key - 实例唯一标识
   * @param {Chart} chartInstance - Chart.js实例
   * @param {HTMLElement} canvasElement - Canvas DOM元素
   * @param {Object} metadata - 元数据（可选）
   * @returns {boolean} 注册是否成功
   */
  register(key, chartInstance, canvasElement, metadata = {}) {
    try {
      // 参数验证
      if (!key || typeof key !== 'string') {
        console.error('ChartManager.register: 无效的key参数');
        return false;
      }
      
      if (!chartInstance || typeof chartInstance.destroy !== 'function') {
        console.error('ChartManager.register: 无效的chartInstance参数');
        return false;
      }
      
      if (!canvasElement || !(canvasElement instanceof HTMLElement)) {
        console.error('ChartManager.register: 无效的canvasElement参数');
        return false;
      }
      
      // 检查实例数量限制
      if (this.instances.size >= this.CONFIG.maxInstances) {
        console.warn(`Chart实例数量已达上限(${this.CONFIG.maxInstances})，触发清理`);
        this.cleanup();
      }
      
      // 如果key已存在，先销毁旧实例
      if (this.instances.has(key)) {
        console.warn(`Chart实例key冲突: ${key}，销毁旧实例`);
        this.unregister(key);
      }
      
      // 注册新实例
      const instanceInfo = {
        chart: chartInstance,
        canvas: canvasElement,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        metadata: metadata,
        destroyed: false
      };
      
      this.instances.set(key, instanceInfo);
      
      // 设置DOM元素引用，便于垃圾回收
      instanceInfo.canvas.__chartKey = key;
      
      console.log(`Chart实例已注册: ${key}, 当前总数: ${this.instances.size}`);
      return true;
      
    } catch (error) {
      console.error('ChartManager.register失败:', error);
      return false;
    }
  },
  
  /**
   * 注销Chart实例
   * @param {string} key - 实例唯一标识
   * @param {boolean} immediate - 是否立即销毁（默认延迟销毁）
   * @returns {boolean} 注销是否成功
   */
  unregister(key, immediate = false) {
    try {
      if (!this.instances.has(key)) {
        console.warn(`Chart实例不存在: ${key}`);
        return false;
      }
      
      const instanceInfo = this.instances.get(key);
      
      // 防止重复销毁
      if (instanceInfo.destroyed) {
        console.warn(`Chart实例已被销毁: ${key}`);
        this.instances.delete(key);
        return true;
      }
      
      // 标记为销毁中
      instanceInfo.destroyed = true;
      instanceInfo.destroyStarted = Date.now();
      
      if (immediate) {
        // 立即销毁
        return this._destroyInstance(instanceInfo, key);
      } else {
        // 延迟销毁，避免频繁操作导致的闪烁
        setTimeout(() => {
          this._destroyInstance(instanceInfo, key);
        }, this.CONFIG.destroyTimeout);
        
        // 立即从注册表中移除，但保留销毁过程
        this.instances.delete(key);
        console.log(`Chart实例已安排销毁: ${key}`);
        return true;
      }
      
    } catch (error) {
      console.error(`ChartManager.unregister失败 (${key}):`, error);
      return false;
    }
  },
  
  /**
   * 内部方法：销毁单个实例
   * @param {Object} instanceInfo - 实例信息
   * @param {string} key - 实例key
   * @returns {boolean} 销毁是否成功
   */
  _destroyInstance(instanceInfo, key) {
    try {
      // 销毁Chart实例
      if (instanceInfo.chart && typeof instanceInfo.chart.destroy === 'function') {
        instanceInfo.chart.destroy();
        instanceInfo.chart = null;
      }
      
      // 清理DOM引用
      if (instanceInfo.canvas) {
        instanceInfo.canvas.__chartKey = undefined;
        // 移除resize监听器（如果存在）
        if (instanceInfo.canvas.resizeHandler) {
          window.removeEventListener('resize', instanceInfo.canvas.resizeHandler);
          instanceInfo.canvas.resizeHandler = null;
        }
      }
      
      // 强制垃圾回收提示（仅作提醒，实际GC由浏览器控制）
      if (typeof window.gc === 'function') {
        try { window.gc(); } catch (e) { /* 忽略错误 */ }
      }
      
      const destroyTime = Date.now() - instanceInfo.destroyStarted;
      console.log(`Chart实例已销毁: ${key}, 耗时: ${destroyTime}ms`);
      return true;
      
    } catch (error) {
      console.error(`ChartManager._destroyInstance失败 (${key}):`, error);
      return false;
    }
  },
  
  /**
   * 获取Chart实例
   * @param {string} key - 实例唯一标识
   * @returns {Chart|null} Chart实例或null
   */
  getInstance(key) {
    const instanceInfo = this.instances.get(key);
    if (instanceInfo && !instanceInfo.destroyed) {
      instanceInfo.lastUsed = Date.now(); // 更新使用时间
      return instanceInfo.chart;
    }
    return null;
  },
  
  /**
   * 清理所有实例
   * @param {boolean} force - 是否强制清理（包括活跃实例）
   */
  cleanup(force = false) {
    console.log(`开始Chart实例清理，当前总数: ${this.instances.size}, force: ${force}`);
    
    const now = Date.now();
    const instancesToDestroy = [];
    
    // 收集需要销毁的实例
    for (const [key, instanceInfo] of this.instances.entries()) {
      // 强制清理或实例已标记为销毁
      if (force || instanceInfo.destroyed) {
        instancesToDestroy.push(key);
        continue;
      }
      
      // 长时间未使用的实例（超过5分钟）
      if (now - instanceInfo.lastUsed > 5 * 60 * 1000) {
        console.log(`清理长时间未使用的Chart实例: ${key}`);
        instancesToDestroy.push(key);
      }
    }
    
    // 执行销毁
    let destroyedCount = 0;
    instancesToDestroy.forEach(key => {
      if (this.unregister(key, true)) {
        destroyedCount++;
      }
    });
    
    console.log(`Chart实例清理完成，销毁: ${destroyedCount}/${instancesToDestroy.length}个`);
  },
  
  /**
   * 页面卸载时的清理
   */
  cleanupOnUnload() {
    console.log('页面卸载，执行Chart实例完整清理');
    
    // 立即销毁所有实例
    for (const key of this.instances.keys()) {
      this.unregister(key, true);
    }
    
    // 清空注册表
    this.instances.clear();
  },
  
  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      totalInstances: this.instances.size,
      activeInstances: 0,
      destroyedInstances: 0,
      oldestInstance: null,
      newestInstance: null
    };
    
    const now = Date.now();
    let oldestTime = now;
    let newestTime = 0;
    
    for (const [key, instanceInfo] of this.instances.entries()) {
      if (instanceInfo.destroyed) {
        stats.destroyedInstances++;
      } else {
        stats.activeInstances++;
        
        if (instanceInfo.createdAt < oldestTime) {
          oldestTime = instanceInfo.createdAt;
          stats.oldestInstance = {
            key: key,
            age: Math.round((now - instanceInfo.createdAt) / 1000)
          };
        }
        
        if (instanceInfo.createdAt > newestTime) {
          newestTime = instanceInfo.createdAt;
          stats.newestInstance = {
            key: key,
            age: Math.round((now - instanceInfo.createdAt) / 1000)
          };
        }
      }
    }
    
    return stats;
  }
};

// 页面卸载时自动清理
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    ChartManager.cleanupOnUnload();
  });
  
  // 定期检查内存使用情况
  setInterval(() => {
    const stats = ChartManager.getStats();
    if (stats.totalInstances >= ChartManager.CONFIG.cleanupThreshold) {
      console.log('Chart实例数量较高，执行预防性清理:', stats);
      ChartManager.cleanup();
    }
  }, ChartManager.CONFIG.memoryCheckInterval);
}

// 挂载到全局
window.utils = util;
window.ChartManager = ChartManager; // 暴露给全局使用
// BUG FIX：skills-integration.js 的 calcKellyStatsFromLogs 以裸标识符调用 getClosedSorted，
// 此前仅挂在 window.utils 上导致调用即 ReferenceError（凯利统计从未真正生效）。补全局别名。
window.getClosedSorted = util.getClosedSorted;
window.isClosedTrade = util.isClosedTrade;
window.isPartialClosed = util.isPartialClosed;
})();

// ======== Chart.js 页面级清理方法 ========
/**
 * 清理指定页面的所有图表实例
 * @param {string} page - 页面标识符
 */
ChartManager.cleanupPage = function(page) {
  if (!page || typeof page !== 'string') {
    console.error('ChartManager.cleanupPage: 无效的page参数');
    return;
  }
  
  console.log(`开始清理页面 "${page}" 的所有图表实例`);
  
  const keysToRemove = [];
  
  // 查找该页面的所有实例
  for (const [key, instanceInfo] of this.instances.entries()) {
    if (instanceInfo.metadata && instanceInfo.metadata.page === page) {
      keysToRemove.push(key);
    }
  }
  
  // 清理找到的实例
  let cleanedCount = 0;
  keysToRemove.forEach(key => {
    if (this.unregister(key, true)) {
      cleanedCount++;
    }
  });
  
  console.log(`页面 "${page}" 清理完成，共清理 ${cleanedCount} 个图表实例`);
  
  // 如果还有很多实例，执行全局清理
  const stats = this.getStats();
  if (stats.totalInstances > this.CONFIG.cleanupThreshold) {
    console.log('页面清理后实例数量仍然较多，执行全局清理');
    this.cleanup();
  }
};
