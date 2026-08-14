/**
 * Chart Config Factory — 统一图表配置模板，消除重复样板代码
 *
 * 设计原则：
 * - 所有图表共享一套基础 options（responsive / interaction / tooltip / legend）
 * - 特定图表通过 overrides 参数覆盖个别配置
 * - 颜色完全从 CSS 变量读取，禁止硬编码
 */

/**
 * 创建标准图表 options
 *
 * @param {Object} cc        — getChartColors() 返回值
 * @param {Object} overrides — 逐项覆盖 { legend, tooltip, scales, plugins, ... }
 * @returns {Object} Chart.js options
 */
function createStandardOptions(cc, overrides) {
  // 深拷贝基础配置，避免引用污染
  var base = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          color: cc.legendText,
          font: { size: 12 },
          usePointStyle: true,
          pointStyleWidth: 12,
          padding: 12
        }
      },
      tooltip: {
        backgroundColor: cc.tooltipBg,
        titleColor: cc.tooltipTitle,
        bodyColor: cc.tooltipBody,
        borderColor: cc.gridColor,
        borderWidth: 1,
        padding: 12
      }
    },
    scales: {
      x: {
        grid: { color: cc.gridColor },
        ticks: { color: cc.tickColor, font: { size: 12 } }
      },
      y: {
        grid: { color: cc.gridColor },
        ticks: { color: cc.tickColor, font: { size: 12 } }
      }
    }
  };

  // 合并 overrides（浅合并一层）
  if (overrides) {
    if (overrides.plugins) {
      base.plugins.legend = overrides.plugins.legend || base.plugins.legend;
      base.plugins.tooltip = overrides.plugins.tooltip || base.plugins.tooltip;
    }
    if (overrides.scales) {
      base.scales.x = overrides.scales.x || base.scales.x;
      base.scales.y = overrides.scales.y || base.scales.y;
    }
    // interaction、responsive 等顶层不合并，直接覆盖
    for (var key in overrides) {
      if (key !== 'plugins' && key !== 'scales') {
        base[key] = overrides[key];
      }
    }
  }

  return base;
}

/**
 * 创建柱状图常用 dataset 配置
 *
 * @param {string} label   — 数据集标签
 * @param {Array}  data    — 数值数组
 * @param {Object} cc      — getChartColors()
 * @param {Object} extras  — 额外属性 { borderRadius, borderWidth, borderColor, yAxisID, ... }
 * @returns {Object} dataset 配置
 */
function createBarDataset(label, data, cc, extras) {
  return Object.assign({
    label: label,
    data: data,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: cc.barBorder
  }, extras || {});
}

/**
 * 创建折线图常用 dataset 配置（权益曲线等）
 *
 * @param {string} label  — 数据集标签
 * @param {Array}  data   — 数值数组
 * @param {Object} cc     — getChartColors()
 * @param {Object} extras — 额外属性
 * @returns {Object} dataset 配置
 */
function createLineDataset(label, data, cc, extras) {
  return Object.assign({
    label: label,
    data: data,
    borderColor: cc.barBorder,
    fill: true,
    tension: 0.25,
    pointRadius: 3,
    pointHoverRadius: 5,
    borderWidth: 2.5
  }, extras || {});
}

/**
 * 创建散点图常用 dataset 配置
 *
 * @param {string} label  — 数据集标签
 * @param {Array}  data   — {x, y} 对象数组
 * @param {string} color  — 填充色（CSS 变量或 rgba）
 * @param {Object} extras — 额外属性
 * @returns {Object} dataset 配置
 */
function createScatterDataset(label, data, color, extras) {
  return Object.assign({
    label: label,
    data: data,
    backgroundColor: color,
    pointRadius: 5,
    pointHoverRadius: 10,
    pointBorderColor: 'rgba(255,255,255,0.5)',
    pointBorderWidth: 2
  }, extras || {});
}
