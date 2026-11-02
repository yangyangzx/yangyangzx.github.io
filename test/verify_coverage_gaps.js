/**
 * verify_coverage_gaps.js — analytics.js / review.js / stats.js 最小断言集
 *
 * 这三个模块此前零测试覆盖（run-tests.html 只加载 17 个 JS，不含它们）。
 * 本跑测器用 jsdom 内联加载真实 JS，测试其中的纯函数和边界逻辑。
 *
 * 断言原则：只测不需要 DOM 的纯函数 + 边界值，不测渲染（渲染依赖 Chart.js）。
 */

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// ─── 内联 JS 文件 ───
// jsdom 的 window.eval 各自建词法作用域，顶层函数声明跨 eval 不可见。
// 必须把 JS 文件就地内联进 HTML，让 jsdom 按文档顺序当经典脚本执行。
const JS_FILES = [
  'js/constants.js',
  'js/utils.js',
  'js/skills-integration.js',
  'js/analytics.js',
  'js/review.js',
  'js/stats.js',
];

let inlineScripts = '';
for (const f of JS_FILES) {
  const body = fs.readFileSync(path.join(root, f), 'utf8');
  if (body.indexOf('</script>') !== -1) throw new Error(f + ' 含 </script>');
  inlineScripts += '<script>\n' + body + '\n</script>\n';
}

const html = '<!DOCTYPE html><html><body>' + inlineScripts + '</body></html>';

let pass = 0, fail = 0;
const failures = [];

function T(name, cond) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.error('  ✗ ' + name); }
}

const vc = new VirtualConsole();
vc.on('jsdomError', function(e) { console.error('[jsdomError]', e.message); });

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = window.matchMedia || function() { return { matches: false, addListener() {}, removeListener() {} }; };
    window.IntersectionObserver = window.IntersectionObserver || function() { return { observe() {}, unobserve() {}, disconnect() {} }; };
    window.Chart = function() { return { destroy() {}, update() {} }; };
    window.Chart.register = function() {};
    window.localStorage = {
      _d: {},
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
      clear() { this._d = {}; },
    };
    window.logs = [];
    window.loadSettings = function() { return { accountBalance: 10000, dailyLossLimit: 5, dailyTradeMax: 8 }; };
  }
});

const { window } = dom;

(async function() {
  // jsdom 同步执行内联脚本，此处无需等待

  // ─── analytics.js 纯函数 ───

  // extractPatternName
  T('analytics: extractPatternName(null) → 未标记', window.extractPatternName(null) === '未标记');
  T('analytics: extractPatternName("") → 未标记', window.extractPatternName('') === '未标记');
  T('analytics: extractPatternName("突破") → 突破', window.extractPatternName('突破') === '突破');
  T('analytics: extractPatternName("趋势|突破") → 含竖线拆分', window.extractPatternName('趋势|突破').indexOf('-') >= 0);

  // safeParseNum
  T('analytics: safeParseNum(null) → null', window.safeParseNum(null) === null);
  T('analytics: safeParseNum("abc") → null', window.safeParseNum('abc') === null);
  T('analytics: safeParseNum("100.5") → 100.5', window.safeParseNum('100.5') === 100.5);
  T('analytics: safeParseNum(0) → 0', window.safeParseNum(0) === 0);
  T('analytics: safeParseNum("") → null', window.safeParseNum('') === null);

  // groupByStrategy
  var sTest = window.groupByStrategy([
    { strategyFramework: '趋势', strategyPattern: '突破', pnlAmount: 100, rMultiple: 2 },
    { strategyFramework: '趋势', strategyPattern: '突破', pnlAmount: -50, rMultiple: -1 },
    { strategyFramework: '震荡', strategyPattern: '反转', pnlAmount: 200, rMultiple: 3 },
  ]);
  T('analytics: groupByStrategy 返回2组', sTest.length === 2);
  T('analytics: 趋势组胜率50%', Math.abs(sTest[0].winRate - 50) < 0.1);
  T('analytics: 震荡组胜率100%', Math.abs(sTest[1].winRate - 100) < 0.1);

  // groupByStrategy 空数据
  var sEmpty = window.groupByStrategy([]);
  T('analytics: groupByStrategy([]) → 0组', sEmpty.length === 0);

  // groupByDimension
  var dTest = window.groupByDimension([
    { session: '亚洲', pnlAmount: 100 },
    { session: '欧洲', pnlAmount: -50 },
    { session: '亚洲', pnlAmount: 200 },
  ], 'session');
  T('analytics: groupByDimension 亚洲2笔', dTest['亚洲'] && dTest['亚洲'].length === 2);
  T('analytics: groupByDimension 欧洲1笔', dTest['欧洲'] && dTest['欧洲'].length === 1);

  // computeGroupStats
  var gTest = window.computeGroupStats([
    { pnlAmount: 100 }, { pnlAmount: -50 }, { pnlAmount: 200 },
  ]);
  T('analytics: computeGroupStats count=3', gTest.count === 3);
  T('analytics: computeGroupStats wins=2', gTest.wins === 2);
  T('analytics: computeGroupStats losses=1', gTest.losses === 1);
  T('analytics: computeGroupStats avgPnl≈83.33', Math.abs(gTest.avgPnl - 250/3) < 0.01);
  T('analytics: computeGroupStats winRate≈66.67', Math.abs(gTest.winRate - 66.67) < 0.1);

  // computeGroupStats 空数据
  var gEmpty = window.computeGroupStats([]);
  T('analytics: computeGroupStats([]) avgPnl=0', gEmpty.avgPnl === 0);
  T('analytics: computeGroupStats([]) winRate=0', gEmpty.winRate === 0);

  // safeChart 存在且是函数
  T('analytics: safeChart 是函数', typeof window.safeChart === 'function');
  T('review: safeChart 是函数', typeof window.safeChart === 'function');

  // ─── stats.js 纯函数 ───
  if (typeof window.computeWinLoss === 'function') {
    var wl = window.computeWinLoss([
      { pnlAmount: 100 }, { pnlAmount: -50 }, { pnlAmount: 200 }, { pnlAmount: 'abc' },
    ]);
    T('stats: computeWinLoss wins=2', wl.wins.length === 2);
    T('stats: computeWinLoss losses=1', wl.losses.length === 1);
    T('stats: computeWinLoss grossProfit=300', wl.grossProfit === 300);
    T('stats: computeWinLoss grossLoss=50', wl.grossLoss === 50);
    T('stats: computeWinLoss 跳过NaN', wl.wins.length + wl.losses.length === 3);
  } else {
    T('stats: computeWinLoss 已加载', false);
  }

  // computeWinLoss 空数据
  if (typeof window.computeWinLoss === 'function') {
    var wlEmpty = window.computeWinLoss([]);
    T('stats: computeWinLoss([]) grossProfit=0', wlEmpty.grossProfit === 0);
    T('stats: computeWinLoss([]) wins=0', wlEmpty.wins.length === 0);
  }

  // ─── safeChart 行为测试 ───
  // Chart 抛异常
  var origChart = window.Chart;
  window.Chart = function() { throw new Error('Chart not available'); };
  var fakeReg = {};
  var fakeCtx = { canvas: {} };
  var result = window.safeChart(fakeReg, 'testKey', fakeCtx, { type: 'bar' });
  T('safeChart: Chart抛异常返回null', result === null);
  T('safeChart: Chart抛异常不写入registry', !fakeReg.testKey);
  window.Chart = origChart;

  // Chart 未定义
  delete window.Chart;
  var result2 = window.safeChart({}, 'testKey2', { canvas: {} }, { type: 'bar' });
  T('safeChart: Chart未定义返回null', result2 === null);
  window.Chart = origChart;

  // 正常创建
  var fakeReg2 = {};
  var fakeCtx2 = { canvas: {} };
  var result3 = window.safeChart(fakeReg2, 'normalKey', fakeCtx2, { type: 'line', data: { labels: [], datasets: [] } });
  T('safeChart: 正常创建返回chart对象', result3 !== null);
  T('safeChart: 正常写入registry', !!fakeReg2.normalKey);

  // ─── 输出 ───
  console.log('');
  console.log('='.repeat(60));
  console.log('覆盖率补盲跑测器 (verify_coverage_gaps.js)');
  console.log('  PASS=' + pass + ' FAIL=' + fail);
  if (failures.length > 0) {
    console.log('  失败明细:');
    failures.forEach(f => console.log('    - ' + f));
  }
  console.log('='.repeat(60));
  process.exit(fail > 0 ? 1 : 0);
})();
