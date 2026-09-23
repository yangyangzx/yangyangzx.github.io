/**
 * Chart Config Factory — 统一图表配置模板，消除重复样板代码
 *
 * 设计原则：
 * - 所有图表共享一套基础 options（responsive / interaction / tooltip / legend）
 * - 特定图表通过 overrides 参数覆盖个别配置
 * - 颜色完全从 CSS 变量读取，禁止硬编码
 */

/**
 * 读取 CSS 变量当前值（主题切换后自动跟随）
 * @param {string} name CSS 变量名（含 -- 前缀）
 * @param {string} [fallback] 取不到时的兜底值
 * @returns {string}
 */
function readCssVar(name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) ? v.trim() : fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * 递归合并图表配置（createStandardOptions 的 overrides 专用）
 *
 * 与浅合并的区别：override 只覆盖它给定的键，未给定的键保留 base 的主题化配置
 * （tooltipBg / titleColor / bodyColor / legendText / grid.color / ticks.color）。
 * 数组与函数整体替换——Chart.js 回调与 backgroundColor 数组不能被逐项合并。
 *
 * @param {Object} target 被合并对象（原地修改）
 * @param {Object} source 覆盖源
 * @returns {Object} target
 */
function deepMergeChartConfig(target, source) {
  if (!source) return target;
  for (var k in source) {
    if (!source.hasOwnProperty(k)) continue;
    var sv = source[k];
    var tv = target[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) &&
        tv && typeof tv === 'object' && !Array.isArray(tv)) {
      deepMergeChartConfig(tv, sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

/**
 * 为颜色字符串设置透明度，不依赖 CSS 变量当前的 alpha 字面值。
 *
 * 原实现用 color.replace('0.95', '0.06')，把透明度调整耦合到 --chart-canvas-up 里的
 * 字面量 0.95——一旦 CSS 改动 alpha，replace 会静默失败，"理想区域"变成不透明实心块
 * 盖住整个散点图。此处解析 oklch / rgb(a) / hex 后重写 alpha。
 *
 * @param {string} color CSS 颜色字符串
 * @param {number} alpha 0-1
 * @returns {string} 解析成功返回新颜色；无法解析时原样返回
 */
function withAlpha(color, alpha) {
  if (!color) return color;
  var s = String(color).trim();
  var m;
  // oklch(L% C H) 或 oklch(L% C H / a)
  m = /^oklch\(\s*([^)]*)\s*\)/i.exec(s);
  if (m) {
    return 'oklch(' + m[1].split('/')[0].trim() + ' / ' + alpha + ')';
  }
  // rgb(r,g,b) / rgba(r,g,b,a)（支持逗号或空白分隔）
  m = /^rgba?\(\s*([^)]+)\)/i.exec(s);
  if (m) {
    var parts = m[1].split(/[,\s]+/).filter(function(p) { return p !== ''; });
    if (parts.length >= 3) {
      return 'rgba(' + parts[0] + ', ' + parts[1] + ', ' + parts[2] + ', ' + alpha + ')';
    }
  }
  // #rgb / #rrggbb
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    var hex = m[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return 'rgba(' + parseInt(hex.substr(0, 2), 16) + ', ' +
      parseInt(hex.substr(2, 2), 16) + ', ' + parseInt(hex.substr(4, 2), 16) + ', ' + alpha + ')';
  }
  return s;
}
// withAlpha 供 dashboard.js / analytics.js 使用；readCssVar 同理（analytics.js 图表
// 描边读 --chart-canvas-ptcenter）。显式导出避免依赖经典脚本的隐式全局作用域。
window.withAlpha = withAlpha;
window.readCssVar = readCssVar;

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

  // 深合并 overrides（P2-7 FIX：原浅合并整对象替换，18 个调用全传了 tooltip/legend，
  // 导致 getChartColors() 的 tooltipBg/tooltipTitle/tooltipBody/legendText 全部丢失；
  // y 轴只传 ticks 的图表网格与刻度退回 Chart.js 默认 #666）
  if (overrides) {
    if (overrides.plugins) {
      if (overrides.plugins.legend)  deepMergeChartConfig(base.plugins.legend,  overrides.plugins.legend);
      if (overrides.plugins.tooltip) deepMergeChartConfig(base.plugins.tooltip, overrides.plugins.tooltip);
      // 其余 plugins 键（自定义插件 barLabels / idealZone 等）整体挂载，不合并
      for (var pk in overrides.plugins) {
        if (overrides.plugins.hasOwnProperty(pk) && pk !== 'legend' && pk !== 'tooltip') {
          base.plugins[pk] = overrides.plugins[pk];
        }
      }
    }
    if (overrides.scales) {
      for (var sk in overrides.scales) {
        if (!overrides.scales.hasOwnProperty(sk)) continue;
        // 未在 base 定义的轴（如 y1）以主题化基础配置为底，避免退回 Chart.js 默认 #666
        if (!base.scales[sk]) {
          base.scales[sk] = {
            grid: { color: cc.gridColor },
            ticks: { color: cc.tickColor, font: { size: 12 } }
          };
        }
        deepMergeChartConfig(base.scales[sk], overrides.scales[sk]);
      }
    }
    // interaction、responsive 等顶层不合并，直接覆盖
    for (var key in overrides) {
      if (overrides.hasOwnProperty(key) && key !== 'plugins' && key !== 'scales') {
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
    // P3-18 FIX：原硬编码白点描边在浅色主题下近乎隐形，改读主题变量
    pointBorderColor: readCssVar('--chart-canvas-ptcenter', 'rgba(255,255,255,0.5)'),
    pointBorderWidth: 2
  }, extras || {});
}
