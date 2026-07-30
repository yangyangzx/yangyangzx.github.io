// ==================== 工具函数库 ====================
// 全局挂载：window.utils = { ... }
// 依赖：全局变量 logs（由 trading.html 内联脚本或 storage.js 定义）

(function() {
  var util = {};

  // ======== 来自 risk.js ========
  /**
   * 获取按平仓时间排序的已平仓日志（有 pnlAmount 的）
   * @returns {Array} 已平仓日志数组（按 closeTime 升序）
   */
  util.getClosedSorted = function() {
    var closed = [];
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].closeType && logs[i].pnlAmount != null && !isNaN(parseFloat(logs[i].pnlAmount))) {
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
      // 多头强平价格公式
      // LP = Entry × (1 - InitialMargin% + MMR%) / (1 - MMR%)
      if (1 - mmr <= 0) {
        console.error('calcLiquidationPrice: invalid mmr leads to division by zero');
        return NaN;
      }
      liquidationPrice = entryPrice * (1 - initialMarginRatio + mmr) / (1 - mmr);
      
      // 合理性检查：多头强平价应低于入场价
      if (liquidationPrice >= entryPrice) {
        console.warn('calcLiquidationPrice: long liquidation price >= entry price, check parameters');
      }
    } else if (direction === 'short') {
      // 空头强平价格公式  
      // LP = Entry × (1 + InitialMargin% - MMR%) / (1 + MMR%)
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
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  };

  // ======== 已平仓交易判断（统一过滤条件） ========
  /**
   * 判断一条日志是否为已平仓交易
   * @param {Object} item - 日志条目
   * @returns {boolean}
   */
  util.isClosedTrade = function(item) {
    return item && item.closeType && item.closeType !== '' &&
      item.pnlAmount != null && !isNaN(parseFloat(item.pnlAmount));
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
    } else if (sorted.length > 0 && sorted[0].capital != null && !isNaN(sorted[0].capital) && sorted[0].capital > 0) {
      _initCap = sorted[0].capital;
    } else {
      var bal = (settingsOverride && settingsOverride.accountBalance > 0) ? settingsOverride.accountBalance : 0;
      if (!bal) {
        try { var _s = loadSettings(); if (_s.accountBalance > 0) bal = _s.accountBalance; } catch(e) {}
      }
      if (bal > 0) _initCap = bal;
    }

    var data = [], cum = _initCap, peakVal = _initCap, maxDD = 0;
    for (var i = 0; i < sorted.length; i++) {
      var l = sorted[i];
      if (!opts.purePnl && l.capital != null && !isNaN(l.capital) && l.capital !== cum) {
        cum = l.capital;
      } else {
        cum += (parseFloat(l.pnlAmount) || 0);
      }
      data.push({ eq: cum, pnl: parseFloat(l.pnlAmount) || 0, idx: data.length + 1 });
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

// ======== 滑点成本计算 - 市场微观结构模型 ========
  /**
   * 计算订单规模对市场冲击的影响因子 (非线性模型)
   * 基于 Kyle(1985) 和 Almgren-Chriss(2000) 市场冲击理论
   * @param {number} positionSize - 仓位大小 (USDT)
   * @param {string} symbol - 交易品种
   * @returns {number} 订单规模影响因子 (>= 1.0)
   */
  util.calculateOrderSizeImpact = function(positionSize, symbol) {
    // 基础假设：不同品种的日均交易量 (简化模型)
    const dailyVolumeMap = {
      'BTC': 50000000000,  // 500亿 USDT
      'ETH': 20000000000,  // 200亿 USDT
      'BNB': 2000000000,   // 20亿 USDT
      'ADA': 500000000,    // 5亿 USDT
      'SOL': 800000000,    // 8亿 USDT
      'DOT': 300000000,    // 3亿 USDT
      'LINK': 400000000,   // 4亿 USDT
      'default': 1000000000 // 默认10亿 USDT
    };
    
    // 获取品种对应的日交易量
    const dailyVolume = dailyVolumeMap[symbol] || dailyVolumeMap['default'];
    
    // 标准化仓位大小 (相对于日交易量的比例)
    const sizeRatio = positionSize / dailyVolume;
    
    // 非线性冲击模型：小订单线性，大订单指数增长
    let impactFactor;
    if (sizeRatio <= 0.001) {
      // 小额订单 (< 0.1% 日交易量): 近似线性
      impactFactor = 1.0 + sizeRatio * 100;
    } else if (sizeRatio <= 0.01) {
      // 中等订单 (0.1%-1% 日交易量): 平方根增长
      impactFactor = 1.0 + Math.sqrt(sizeRatio) * 10;
    } else {
      // 大额订单 (> 1% 日交易量): 指数增长 (市场冲击严重)
      impactFactor = 1.0 + Math.pow(sizeRatio, 0.7) * 20;
    }
    
    // 确保最小影响为1.0，最大不超过100倍 (极端情况保护)
    return Math.min(Math.max(impactFactor, 1.0), 100.0);
  };

  /**
   * 计算波动率对滑点的影响因子
   * 高波动时期市场深度下降，滑点放大
   * @param {string} symbol - 交易品种
   * @returns {number} 波动率影响因子 (>= 0.5, <= 3.0)
   */
  util.calculateVolatilityImpact = function(symbol) {
    // 获取当前时间 (简化：使用系统时间)
    const now = new Date();
    const hour = now.getUTCHours();
    
    // 时间段波动率模型 (UTC时间)
    let baseVolatility;
    if (hour >= 0 && hour < 8) {
      // 亚洲早盘：相对较低波动
      baseVolatility = 1.0;
    } else if (hour >= 8 && hour < 16) {
      // 欧洲时段：中等波动
      baseVolatility = 1.2;
    } else if (hour >= 16 && hour < 24) {
      // 美洲时段：高波动
      baseVolatility = 1.5;
    } else {
      baseVolatility = 1.0;
    }
    
    // 品种特性调整 (基于历史波动率特征)
    const symbolVolatilityMap = {
      'BTC': 1.0,   // 基准
      'ETH': 1.1,   // 略高于BTC
      'SOL': 1.4,   // 高波动山寨币
      'ADA': 1.3,   // 中等波动
      'DOT': 1.2,   // 中等波动
      'LINK': 1.25, // 中等波动
      'default': 1.15
    };
    
    const symbolFactor = symbolVolatilityMap[symbol] || symbolVolatilityMap['default'];
    
    // 综合波动率影响 (考虑周末效应)
    const dayOfWeek = now.getUTCDay();
    const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.7 : 1.0; // 周末波动较低
    
    const volatilityImpact = baseVolatility * symbolFactor * weekendFactor;
    
    // 限制范围在 0.5-3.0 之间
    return Math.min(Math.max(volatilityImpact, 0.5), 3.0);
  };

  /**
   * 计算流动性对滑点的影响因子
   * 基于订单簿深度的流动性分析
   * @param {string} symbol - 交易品种
   * @param {number} positionSize - 仓位大小
   * @returns {number} 流动性影响因子 (>= 0.3, <= 5.0)
   */
  util.calculateLiquidityImpact = function(symbol, positionSize) {
    // 模拟订单簿深度 (实际应用中应从交易所API获取)
    const orderBookDepthMap = {
      'BTC': { depth: 5000000, spread: 0.02 },    // 500万USDT深度，0.02%价差
      'ETH': { depth: 2000000, spread: 0.05 },    // 200万USDT深度，0.05%价差
      'BNB': { depth: 500000, spread: 0.1 },      // 50万USDT深度，0.1%价差
      'SOL': { depth: 200000, spread: 0.15 },     // 20万USDT深度，0.15%价差
      'ADA': { depth: 100000, spread: 0.2 },      // 10万USDT深度，0.2%价差
      'DOT': { depth: 80000, spread: 0.25 },      // 8万USDT深度，0.25%价差
      'LINK': { depth: 150000, spread: 0.18 },    // 15万USDT深度，0.18%价差
      'default': { depth: 100000, spread: 0.2 }
    };
    
    const bookInfo = orderBookDepthMap[symbol] || orderBookDepthMap['default'];
    const marketDepth = bookInfo.depth;
    const baseSpread = bookInfo.spread;
    
    // 流动性冲击模型：仓位占市场深度的比例决定滑点放大倍数
    const depthRatio = positionSize / marketDepth;
    
    let liquidityFactor;
    if (depthRatio <= 0.01) {
      // 浅度冲击：滑点略大于基础价差
      liquidityFactor = 1.0 + depthRatio * 2;
    } else if (depthRatio <= 0.1) {
      // 中度冲击：滑点明显放大
      liquidityFactor = 1.0 + Math.pow(depthRatio, 0.8) * 5;
    } else {
      // 深度冲击：滑点急剧放大 (流动性枯竭)
      liquidityFactor = 1.0 + Math.pow(depthRatio, 0.6) * 10;
    }
    
    // 基础价差调整：流动性差的品种基础滑点就高
    const adjustedFactor = liquidityFactor * (baseSpread / 0.02); // 以BTC的0.02%为基准
    
    // 限制范围在 0.3-5.0 之间
    return Math.min(Math.max(adjustedFactor, 0.3), 5.0);
  };

  // 挂载到全局
  window.utils = util;
})();
