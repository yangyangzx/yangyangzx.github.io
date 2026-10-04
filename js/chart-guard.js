/**
 * Chart.js 离线兜底守卫
 *
 * 背景：index.html 从 cdn.jsdelivr.net 加载 Chart.js。本项目定位是「完全离线」（数据全在
 * localStorage，不依赖任何后端），但断网时该 CDN 脚本静默失败，`typeof Chart === 'undefined'`，
 * 此后 analytics/dashboard/review 里约 20 处 `new Chart(...)` 全部抛 ReferenceError——
 * 图表区整片空白且没有任何解释，而风控计算、日志、复盘等功能其实完全可用（本地数据）。
 *
 * 处理方式：在 CDN <script> 之后立即挂载最小桩，把「静默空白」变成「明确的说明」：
 *   - `new Chart(ctx, config)` 返回惰性实例，destroy/update/resize 均为 no-op
 *   - `Chart.getChart(canvas)` 恒返回 null（调用方都写成
 *     `var existing = Chart.getChart(canvas); if (existing) existing.destroy();`）
 *   - 构造时往 canvas 上画一行说明文字，用户能直接看到图表为空的原因
 *
 * 桩实例额外置 `__stub: true`，供将来若有代码想区分「真图表」与「占位」使用。
 *
 * 注意：这里只覆盖本项目实际用到的三个 API（new Chart / Chart.getChart / 实例
 * destroy|update|resize）。刻意**不**补 Chart.defaults / Chart.register / Chart.helpers /
 * Chart.types——项目当前没用到，补了会掩盖未来引入真实 Chart.js 特性时的依赖缺口。
 *
 * 加载位置：index.html 中必须紧跟 Chart.js 的 CDN <script> 之后，且在任何调用 Chart 的
 * 模块（dashboard / analytics / review / chart-factory）之前。
 *
 * `installChartGuard()` 同时暴露为全局：除自检外，异步/本地 Chart.js 加载失败重试的场景
 * 可直接调用它重新判定（Chart 已存在时不做任何改动，直接返回 false）。
 */
(function () {
  'use strict';

  var NOTE_LINES = [
    '图表不可用：Chart.js 需联网加载，',
    '当前处于离线状态。日志与计算功能不受影响。'
  ];

  /**
   * 在给定 2d 上下文上画离线说明。上下文可能不可用（jsdom 等环境），全部兜底为静默失败。
   * @returns {boolean} 是否真正画出了文字（false = 上下文缺失或绘制抛错，已静默跳过）
   */
  function drawNote(ctx) {
    if (!ctx) return false;
    var canvas = ctx.canvas || null;
    var w = (canvas && canvas.width) || 300;
    var h = (canvas && canvas.height) || 150;

    // 从 CSS 变量取色，跟随主题；取不到时退到中性灰，避免在代码里硬编码颜色
    var fg = '#6b7280';
    var bg = 'transparent';
    try {
      var cs = getComputedStyle(document.body);
      var t = cs.getPropertyValue('--color-muted').trim();
      if (t) fg = t;
      var b = cs.getPropertyValue('--bg-surface').trim() || cs.getPropertyValue('--bg').trim();
      if (b) bg = b;
    } catch (e2) { /* 保持默认色 */ }

    try {
      if (bg !== 'transparent') {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }
    } catch (e3) { /* 忽略填充失败 */ }

    try {
      ctx.fillStyle = fg;
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var lineH = 18;
      var startY = h / 2 - (lineH * (NOTE_LINES.length - 1)) / 2;
      for (var i = 0; i < NOTE_LINES.length; i++) {
        ctx.fillText(NOTE_LINES[i], w / 2, startY + i * lineH);
      }
      return true;
    } catch (e4) { return false; }
  }

  /**
   * 惰性图表实例桩。只实现本项目实际调用的方法。
   */
  function ChartStub(canvas, config) {
    var ctx = null;
    if (canvas && typeof canvas.getContext === 'function') {
      try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    }
    this.canvas = canvas || null;
    this.ctx = ctx;
    this.config = config || null;
    this.__stub = true;
    this.__noteDrawn = drawNote(ctx);
  }
  ChartStub.prototype.destroy = function () { };
  ChartStub.prototype.update = function () { };
  ChartStub.prototype.resize = function () { };

  /**
   * 构造函数桩：`new Chart(ctx, config)` 返回带 destroy/update/resize 的惰性实例。
   * ctx 既可能是 2d context（有 .canvas），也可能直接是 canvas 元素，两种都容忍。
   */
  function ChartShim(ctx, config) {
    ChartShim.__drawCalls++;
    var canvas = null;
    // 2d context 一定有 .canvas 指向画布；canvas 元素没有这个属性。
    // 不能反过来用「有没有 getContext」区分——canvas 元素本身就有 getContext。
    canvas = (ctx && ctx.canvas) ? ctx.canvas : (ctx || null);
    var instance = new ChartStub(canvas, config);
    instance.config = config || instance.config;
    return instance;
  }
  ChartShim.getChart = function () { return null; };
  // 可观测性钩子：统计「惰性实例尝试画离线说明」的次数。
  // 非枚举属性，不会出现在 config 迭代里；真实 Chart.js 加载时该计数恒为 0。
  // 用途：验证离线说明真的画出去了（而不是静默失败成一张白 canvas）。
  ChartShim.__drawCalls = 0;
  Object.defineProperty(ChartShim, '__drawCalls', { enumerable: false });

  /**
   * 安装守卫。Chart 已存在时不做任何改动。
   * @returns {boolean} true=本次安装了占位桩；false=Chart 已存在，未改动
   */
  function installChartGuard() {
    if (typeof window.Chart !== 'undefined') {
      window.__CHART_MISSING = false;
      return false;
    }
    window.Chart = ChartShim;
    window.__CHART_MISSING = true;
    console.warn('[chart-guard] Chart.js 未加载（CDN 不可达或离线），已启用占位桩；图表将显示离线说明。');
    return true;
  }

  window.__CHART_MISSING = false;
  window.installChartGuard = installChartGuard;
  installChartGuard();
})();
