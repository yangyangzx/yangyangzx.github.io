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
   * USDT-M 逐仓强平价格（精确公式）
   * @param {number} entryPrice - 入场价
   * @param {string} direction - 'long' | 'short'
   * @param {number} leverage - 杠杆倍数
   * @param {number} mmr - 维持保证金率（小数，如 0.005 表示 0.5%）
   * @returns {number} 强平价格
   */
  util.calcLiquidationPrice = function(entryPrice, direction, leverage, mmr) {
    if (direction === 'long') {
      return entryPrice * (1 - 1 / leverage) / (1 - mmr);
    } else {
      return entryPrice * (1 + 1 / leverage) / (1 + mmr);
    }
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

  // 挂载到全局
  window.utils = util;
})();
