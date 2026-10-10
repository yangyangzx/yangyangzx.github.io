// 参数化修复验证脚本（2026-10-10）——一次性冒烟，不属于 test/ 回归套件。
// 作用：确认新增/修正的设置项真实改变 calculate() 的输出，而不是只存不读。
//
// 关键前提（踩过的坑，改脚本时注意）：
//  1) 日志是启动时载入内存的全局数组 logs，事后写 localStorage 不会同步进去；
//     构造「已有持仓」必须直接 push 进 w.logs。
//  2) 上游闸门会抢先阻断，下游截断就观察不到。组合热量按「名义仓位」而非保证金计风险，
//     在仓一不小心就portfolio-heat-limit 抢先。故下面用现货(0x)绕开强平/最小止损距离，
//     并把 riskHeatMax 调高留出余量。
//  3) 保证金上限仅对 leverage>0 生效（现货由聚合上限与交易所上限管），属原有设计。
// 用法：node verify_param_fix.js
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

class LocalOnlyLoader extends ResourceLoader {
  fetch(url, opts) {
    return url.startsWith('file://')
      ? super.fetch(url, opts)
      : Promise.reject(new Error('blocked: ' + url));
  }
}

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; }
  };
}

(async () => {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = await JSDOM.fromFile(path.join(__dirname, 'index.html'), {
    runScripts: 'dangerously',
    resources: new LocalOnlyLoader(),
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: makeStorage() });
      w.Element.prototype.scrollIntoView = function () {};
    }
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 900));

  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
  };
  const BASE = { accountBalance: 10000, mmr: 0.5, riskPercent: 2 };
  const setS = o => {
    w.localStorage.setItem('trade_settings_v1',
      JSON.stringify(Object.assign({}, BASE, { riskHeatMax: 15, singleSymbolMaxPct: 50, minRRRatio: 1 }, o)));
    w._clearSettingsCache();
  };
  const set = (id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };
  const putOpen = margin => {
    w.logs.length = 0;
    if (margin > 0) {
      w.logs.push({
        id: 'open1', symbol: 'ETH', direction: 'long', capital: 10000,
        positionSize: margin * 20, leverage: 20, entryPrice: 2000, stopLoss: 1990,
        closeTime: null, time: new Date().toISOString(), status: 'open', closedRatio: 0
      });
    }
  };
  const run = () => { w.calculate(); return w.getCalc(); };
  const fill = (o = {}) => {
    set('symbol', o.symbol || 'BTC');
    set('entryPrice', o.entryPrice || '100000');
    set('capital', o.capital || '10000');
    set('stopLoss', o.stopLoss || '99000');
    set('leverage', String(o.leverage != null ? o.leverage : 0));
    set('direction', 'long');
    const fa = w.document.getElementById('formAtrStopEnabled');
    if (fa) fa.checked = false;
  };
  // 构造「历史大回撤、今日无亏损」：亏损日期设为过去，
  // 否则 -6000 的当日亏损会先触发 daily-loss-limit 闸门（它在回撤闸门之前），
  // 回撤闸门永远轮不到，就测不出它是否真实生效。
  const pushLoss = (pnl, daysAgo = 0) => {
    w.logs.length = 0;
    const t = new Date(Date.now() - daysAgo * 86400000).toISOString();
    w.logs.push({
      id: 'c1', symbol: 'BTC', direction: 'long', capital: 10000, pnlAmount: pnl,
      closeType: 'closeAll', closeTime: t, time: t,
      exitReason: 'test', closedRatio: 1, status: 'closed', initialRiskAmount: 200
    });
  };

  console.log('\n[1] 基线：默认设置可正常计算');
  setS({});
  putOpen(0);
  fill();
  const c0 = run();
  check('产生有效仓位', c0 && c0.positionSize > 0, 'pos=' + (c0 && c0.positionSize));

  console.log('\n[2] 总保证金上限参数化（在仓保证金 8000 = 80% 本金）');
  setS({ marginUsageLimitPct: 100, aggregateMarginLimitPct: 100 });
  putOpen(8000); fill();
  const cAg100 = run();
  setS({ marginUsageLimitPct: 100, aggregateMarginLimitPct: 85 });
  putOpen(8000); fill();
  const cAg85 = run();
  // 保证金上限 100 时，会被交易所上限 / 集中度上限截断（capped 也是 true），
  // 故这里不断言 capped，只断言聚合上限 85 确实把仓位压到 ≤ 85% 本金。
  check('聚合上限 85% 触发截断', cAg85 && cAg85.cappedByMargin === true,
    'capped=' + (cAg85 && cAg85.cappedByMargin));
  check('截断后仓位变小', cAg85 && cAg100 && cAg85.positionSize < cAg100.positionSize,
    '100%→' + (cAg100 && cAg100.positionSize.toFixed(0)) + ' 85%→' + (cAg85 && cAg85.positionSize.toFixed(0)));
  const rAg = cAg85 && cAg85.capital ? cAg85.actualMargin / cAg85.capital : null;
  check('保证金占比 ≤ 85%', rAg !== null && rAg <= 0.8501, 'ratio=' + (rAg && (rAg * 100).toFixed(1)) + '%');

console.log('\n[3] 连亏降仓阈值与系数（现货，连亏 2 笔）');
  // 变量隔离说明：仓位会同时受心态评分、集中度、交易所上限等多个因子影响，
  // 单看 positionSize 无法归因到连亏降仓。故分两层验证：
  //  (a) 参数确实被读取 —— 直接断言 helper 返回值随设置变化；
  //  (b) 阈值/系数确实驱动计算 —— 用杠杆仓 + 2% 止损（不触发最小止损距离阻断）
  //      + mindsetScore 满分 + 各项上限放开，排除其他因子干扰后对照 riskAmount。
  // ⚠️ 现货(0x)下不可用本方法：现货仓位上限 = 可用本金，会先把风险压到同一值，
  //    降仓差异被抹平（实测两组 riskAmount 均为 50）。
  setS({ lossStreakDerisk: 3, lossStreakDeriskFactor: 0.8 });
  check('helper 读取阈值 3 / 系数 0.8',
    w._getLossStreakDeriskThreshold() === 3 && w._getLossStreakDeriskFactor() === 0.8,
    w._getLossStreakDeriskThreshold() + '/' + w._getLossStreakDeriskFactor());
  setS({ lossStreakDerisk: 2, lossStreakDeriskFactor: 0.5 });
  check('helper 读取阈值 2 / 系数 0.5（设置变更即生效）',
    w._getLossStreakDeriskThreshold() === 2 && w._getLossStreakDeriskFactor() === 0.5,
    w._getLossStreakDeriskThreshold() + '/' + w._getLossStreakDeriskFactor());

  const mindsetEl = w.document.getElementById('mindsetScore');
  if (mindsetEl) mindsetEl.value = '5';   // 满分，排除心态降仓干扰
  const fillLev = () => { putOpen(0); fill({ leverage: 10, stopLoss: '98000' }); set('lossStreak', '2'); };
  setS({ marginUsageLimitPct: 100, aggregateMarginLimitPct: 100, riskPercent: 20,
    lossStreakDerisk: 3, lossStreakDeriskFactor: 0.8 });
  fillLev();
  const dNoDerisk = run();                     // streak=2 < 阈值3 → 不降仓
  setS({ marginUsageLimitPct: 100, aggregateMarginLimitPct: 100, riskPercent: 20,
    lossStreakDerisk: 2, lossStreakDeriskFactor: 0.8 });
  fillLev();
  const dDerisk = run();                       // streak=2 >= 阈值2 → 降仓 ×0.8
  check('阈值未命中时不降仓（风险=计划 200）',
    dNoDerisk && Math.abs(dNoDerisk.riskAmount - 200) < 1,
    'risk=' + (dNoDerisk && dNoDerisk.riskAmount.toFixed(2)));
  check('阈值命中时实际风险额被降仓（< 未命中）',
    dNoDerisk && dDerisk && dDerisk.riskAmount < dNoDerisk.riskAmount,
    '未命中→' + (dNoDerisk && dNoDerisk.riskAmount.toFixed(2)) +
    ' 命中→' + (dDerisk && dDerisk.riskAmount.toFixed(2)));
  check('降仓比例精确等于 lossStreakDeriskFactor=0.8',
    dDerisk && dNoDerisk && Math.abs(dDerisk.riskAmount / dNoDerisk.riskAmount - 0.8) < 0.02,
    '实际比例=' + (dDerisk && dNoDerisk && (dDerisk.riskAmount / dNoDerisk.riskAmount).toFixed(3)));
  // 系数可配：0.5 应降得更狠
  setS({ marginUsageLimitPct: 100, aggregateMarginLimitPct: 100, riskPercent: 20,
    lossStreakDerisk: 2, lossStreakDeriskFactor: 0.5 });
  fillLev();
  const dF5 = run();
  check('系数 0.5 时风险减半（100 = 200×0.5）',
    dF5 && Math.abs(dF5.riskAmount - 100) < 1, 'risk=' + (dF5 && dF5.riskAmount.toFixed(2)));

  console.log('\n[4] tpRRs 与新增设置项 UI 可达');
  const ids = ['setTpRR1', 'setTpRR2', 'setTpRR3', 'setMarginUsageLimitPct', 'setAggregateMarginLimitPct',
    'setLossStreakDerisk', 'setLossStreakDeriskFactor', 'setKellyRiskLimitPct',
    'setFeeRateLimit', 'setFeeRateMarket', 'setMinStopDistancePct'];
  const missing = ids.filter(id => !w.document.getElementById(id));
  check('11 个新设置输入框均存在', missing.length === 0, '缺失: ' + missing.join(','));

  console.log('\n[5] 保存设置后回同步开仓表单');
  setS({});
  fill();
  const capEl = w.document.getElementById('capital');
  const levEl = w.document.getElementById('leverage');
  capEl.value = '7777'; levEl.value = '3';
  setS({ accountBalance: 55555, defaultLeverage: 25 });
  w.syncSettingsToForm();
  check('本金回同步 55555', String(capEl.value) === '55555', '实际=' + capEl.value);
  check('杠杆回同步 25', String(levEl.value) === '25', '实际=' + levEl.value);

  console.log('\n[6] 回撤熔断闸门（2026-10-10 新增 P0 修复）');
  w.logs.length = 0;
  const dd0 = w.getCurrentDrawdown();
  check('无日志时不阻断', dd0 && dd0.blocked === false, 'blocked=' + (dd0 && dd0.blocked));
  pushLoss(-6000, 5);           // 5 天前，今日无亏损 → 不会被日亏损闸门拦下
  const dd1 = w.getCurrentDrawdown();
  check('历史亏损后回撤被算出（非 0）', dd1 && dd1.drawdownPct > 5,
    'dd%=' + (dd1 && dd1.drawdownPct.toFixed(2)) + ' peak=' + (dd1 && dd1.peak.toFixed(0)) + ' equity=' + (dd1 && dd1.equity.toFixed(0)));
  // 本金 10000 亏 6000 → 真实回撤 60%（峰值 10000、净值 4000）。
  // 修复 utils.calcEquityCurve 的重复计入前，这里算出的10.8% 是失真值
  // （accountBalance 被当作曲线起点又叠加历史盈亏），故本断言随口径修正更新。
  check('历史亏损 60% 被如实算出', dd1 && Math.abs(dd1.drawdownPct - 60) < 1,
    'dd%=' + (dd1 && dd1.drawdownPct.toFixed(2)));
  // 默认阈值 20% < 60% → 应判定阻断（此前因口径失真而算成 10.8% 未阻断）
  check('默认阈值 20% 下判定阻断', dd1 && dd1.blocked === true,
    'dd%=' + (dd1 && dd1.drawdownPct.toFixed(2)) + ' blocked=' + (dd1 && dd1.blocked));
  // 阈值低于实际回撤时才阻断
  setS({ maxDrawdownAlert: 10 });
  const dd1b = w.getCurrentDrawdown();
  check('阈值下调到 10% 后判定阻断', dd1b && dd1b.blocked === true,
    'dd%=' + (dd1b && dd1b.drawdownPct.toFixed(2)) + ' blocked=' + (dd1b && dd1b.blocked));
  setS({ maxDrawdownAlert: 90 });
  const dd2 = w.getCurrentDrawdown();
  check('阈值放宽 90% 后不再阻断', dd2 && dd2.blocked === false,
    'dd%=' + (dd2 && dd2.drawdownPct.toFixed(2)) + ' th=' + (dd2 && dd2.thresholdPct));

  console.log('\n[7] 回撤熔断真实阻断开仓（阈值 10% < 历史回撤）');
  setS({ maxDrawdownAlert: 10, dailyLossLimit: 50 });
  fill();
  run();
  const blk1 = w.getCalcBlocker();
  check('开仓被 drawdown-limit 阻断', !!(blk1 && blk1.code === 'drawdown-limit'),
    'blocker=' + (blk1 && blk1.code));
  setS({ maxDrawdownAlert: 90, dailyLossLimit: 50 });
  fill();
  run();
  const blk2 = w.getCalcBlocker();
  check('阈值放宽后可正常计算', !(blk2 && blk2.code === 'drawdown-limit'), 'blocker=' + (blk2 && blk2.code));
  w.logs.length = 0;

  console.log('\n[8] applyKellyRisk 止损区间走 getStopLimitPct（不再写死 3%）');
  setS({ customStopLimit: { BTC: 1 } });
  fill();
  set('kellyAvgLoss', '3000');
  w.applyKellyRisk && w.applyKellyRisk();
  const slEl = w.document.getElementById('stopLoss');
  const genStop = slEl ? parseFloat(slEl.value) : NaN;
  const genPct = (100000 - genStop) / 100000 * 100;
  check('生成止损 ≤ 设置上限 1%', isFinite(genPct) && genPct <= 1.0,
    '止损=' + genStop + ' (' + genPct.toFixed(3) + '%)');

  console.log('\n[9] 组合热量硬上限与警告上限解耦');
  setS({ riskHeatMax: 12 });
  const hard = w.getHeatHardMax();
  check('硬上限 = riskHeatMax 12（不被警告值 8 拉低）', hard === 12, 'hard=' + hard);
  check('警告上限独立 = 8', w.getHeatWarnMax() === 8, 'warn=' + w.getHeatWarnMax());

  console.log('\n[10] 设置快照落库');
  setS({ mmr: 0.5, riskPercent: 2 });
  putOpen(0); fill();
  const cS = run();
  check('calc 阶段即可取得快照辅助函数', typeof w.captureSettingsSnapshot === 'function');
  const snap = w.captureSettingsSnapshot();
  check('快照含关键阈值', snap && snap.mmr === 0.005 && snap.marginUsageLimitPct === 80,
    'mmr=' + (snap && snap.mmr) + ' mu=' + (snap && snap.marginUsageLimitPct));

  // 2026-10-10 补充：calc-visuals 曾在参数化时留下 MARGIN_SOFT_CAP 残余引用，
  // 抛错发生在工厂执行期 → root.CalcVisuals 从未被赋值 → 整个结果可视化模块消失，
  // 而 renderCalcVisuals 的 try/catch 把它吞成一行 console.error，
  // 页面上只表现为「两张图不见了」，极难归因。这里钉住模块加载与刻度跟随设置。
  console.log('\n[11] 结果可视化模块加载 + 刻度跟随设置');
  check('CalcVisuals 正常挂载（工厂执行未抛错）',
    !!w.CalcVisuals && typeof w.CalcVisuals.render === 'function',
    'type=' + typeof w.CalcVisuals);
  const marginIds = ['marginVisualCard', 'marginBadge', 'marginFill', 'gMarkSoft', 'gMarkAgg'];
  const missM = marginIds.filter(id => !w.document.getElementById(id));
  check('保证金图 DOM 齐全', missM.length === 0, '缺失: ' + missM.join(','));

  setS({ marginUsageLimitPct: 40, aggregateMarginLimitPct: 50, riskPercent: 10 });
  putOpen(0); fill({ leverage: 10, stopLoss: '990', entryPrice: '1000', targetPrice: '1020' });
  run();
  const mkAgg = w.document.getElementById('gMarkAgg');
  const mkSoft = w.document.getElementById('gMarkSoft');
  check('聚合刻度显示设置的 50%（非写死 90%）',
    mkAgg && mkAgg.textContent === '50%' && mkAgg.style.left === '50%',
    '文本=' + (mkAgg && mkAgg.textContent) + ' left=' + (mkAgg && mkAgg.style.left));
  check('单笔刻度显示设置的 40%',
    mkSoft && mkSoft.textContent === '单笔 40%',
    '文本=' + (mkSoft && mkSoft.textContent));
  const badge = w.document.getElementById('marginBadge');
  check('保证金占比徽标已渲染（非占位 —）',
    badge && /%$/.test(badge.textContent), 'badge=' + (badge && badge.textContent));

  console.log('\n================ 结果 ================');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });