// 修复副作用回归核查（2026-10-10 新增，常驻脚本）
//
// 为什么需要它：v5.6.19~v5.6.23 这轮修复里，v5.6.19 自己引入了两个 P0
// （降仓阈值参数化不一致、calc-visuals 加载失败），两次都是「上一轮校验全绿」的状态。
// 也就是说verify_invariants / verify_param_fix 只能证明**计算结果自洽**，
// 证明不了**新加的闸门不会误拦正常用户**、**新增的钳制不会误伤合法设置**。
// 本脚本专攻这一类「过度修复」风险，每次改动风控/闸门/设置读取后必跑。
//
// 用法：node verify_sideeffects.js
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

class LL extends ResourceLoader {
  fetch(url, opts) { return url.startsWith('file://') ? super.fetch(url, opts) : Promise.reject(new Error('blocked')); }
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
    runScripts: 'dangerously', resources: new LL(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: makeStorage() });
      w.Element.prototype.scrollIntoView = function () {};
    }
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 900));
  const d = w.document;

  let pass = 0, fail = 0;
  const ck = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (e ? ' → ' + e : '')); } };

  const type = (id, v) => {
    const el = d.getElementById(id); if (!el) return;
    el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const DEFAULTS = {
    accountBalance: 100000, mmr: 0.5, riskPercent: 10, riskHeatMax: 50, singleSymbolMaxPct: 50,
    minRRRatio: 2, marginUsageLimitPct: 100, aggregateMarginLimitPct: 100,
    lossStreakBlock: 3, lossStreakDerisk: 2, lossStreakDeriskFactor: 0.8, maxDrawdownAlert: 20
  };
  const setS = o => {
    w.localStorage.setItem('trade_settings_v1', JSON.stringify(Object.assign({}, DEFAULTS, o)));
    w._clearSettingsCache();
  };
  const fa = d.getElementById('formAtrStopEnabled'); if (fa) fa.checked = false;
  const ms = d.getElementById('mindsetScore'); if (ms) ms.value = '5';
  const rs = d.getElementById('reasonSelect');
  for (const o of rs.options) { if (o.text && o.text.includes('趋势突破')) { rs.value = o.value; break; } }
  const fillOk = () => {
    w.logs.length = 0;
    type('symbol', 'BTC'); type('entryPrice', '1000'); type('capital', '100000');
    type('stopLoss', '980'); type('leverage', '10'); type('direction', 'long'); type('targetPrice', '1060');
  };
  const run = () => { w.calculate(); return { calc: w.getCalc(), blocker: w.getCalcBlocker() }; };
  const mkTrade = (days, pnl) => {
    const x = new Date(Date.now() - days * 86400000).toISOString();
    return {
      id: 'x' + days, symbol: 'BTC', direction: 'long', capital: 100000, pnlAmount: pnl,
      closeType: 'closeAll', closeTime: x, time: x, status: 'closed', initialRiskAmount: 2000
    };
  };

  console.log('[A] 新增 fail-closed 不得误阻断正常开仓');
  setS({}); fillOk();
  let r = run();
  ck('全新用户（无日志无持仓）能开仓', !!r.calc && !r.blocker, 'blocker=' + (r.blocker && r.blocker.code));
  setS({}); fillOk();
  const t1 = mkTrade(5, 500);
  w.logs.length = 0; w.logs.push(t1);
  r = run();
  const dd = w.getCurrentDrawdown();
  ck('小幅盈利（回撤 0%）不触发回撤熔断', !!r.calc && !r.blocker,
    'dd%=' + (dd && dd.drawdownPct.toFixed(2)) + ' blocker=' + (r.blocker && r.blocker.code));
  ck('getCurrentDrawdown 未标记读失败', dd && dd.readFailed === false, 'readFailed=' + (dd && dd.readFailed));

  // 反向断言：上限必须**真的会拦**。
  // 只断言「不误拦」是不够的——若上限被某种方式架空（如被放大、被旁路），
  // 「不误拦」仍然全绿。此处显式验证超限被拦，避免闸门形同虚设却测不出来。
  setS({ riskPercent: 2 }); fillOk();
  type('riskInput', '9%');
  r = run();
  ck('风险 9% 超 2% 上限时被拦', !!(r.blocker && r.blocker.code === 'single-risk-exceeds-limit'),
    'blocker=' + (r.blocker && r.blocker.code));
  setS({ riskPercent: 10 }); fillOk();
  type('riskInput', '9%');
  r = run();
  ck('上限放宽到 10% 后同一输入放行', !!r.calc && !r.blocker,
    'blocker=' + (r.blocker && r.blocker.code));

  console.log('[B] _numSetting 区间钳制：合法边界全部放行');
  const legit = [
    ['marginUsageLimitPct', 20], ['marginUsageLimitPct', 100],
    ['aggregateMarginLimitPct', 30], ['aggregateMarginLimitPct', 100],
    ['lossStreakDerisk', 2], ['lossStreakDerisk', 10],
    ['lossStreakDeriskFactor', 0.1], ['lossStreakDeriskFactor', 1],
    ['kellyRiskLimitPct', 1], ['kellyRiskLimitPct', 20],
    ['feeRateLimit', 0], ['feeRateMarket', 1],
    ['minStopDistancePct', 0.01], ['minStopDistancePct', 5],
    ['riskPercent', 1], ['riskPercent', 10]
  ];
  for (const [k, v] of legit) {
    setS({ [k]: v });
    const got = w._numSetting(k, NaN);
    ck(`合法边界 ${k}=${v} 被采纳`, got === v, '实际=' + got);
  }
  console.log('[C] _numSetting 区间钳制：越界值回退默认');
  setS({ marginUsageLimitPct: 150 });
  ck('150 → 默认 80', w._numSetting('marginUsageLimitPct', 80) === 80);
  setS({ minStopDistancePct: -1 });
  ck('-1 → 默认 0.1', w._numSetting('minStopDistancePct', 0.1) === 0.1);
  setS({ lossStreakDeriskFactor: 0 });
  ck('系数 0 → 默认 0.8（避免仓位归零）', w._numSetting('lossStreakDeriskFactor', 0.8) === 0.8);

  console.log('[D] 熔断线与降仓线拆分');
  setS({});
  ck('默认熔断 3 / 降仓 2', w._getLossStreakBlockThreshold() === 3 && w._getLossStreakDeriskThreshold() === 2);
  ck('降仓线 < 熔断线', w._getLossStreakDeriskThreshold() < w._getLossStreakBlockThreshold());

  console.log('[E] 权益曲线起点改动：全站6 处调用口径');
  setS({ accountBalance: 100000 });
  const cases = [
    ['无日志（早退分支，不受影响）', [], 0],
    ['单笔盈亏 +2000', [mkTrade(5, 2000)], 102000],
    ['涨3000后跌1000', [mkTrade(10, 3000), mkTrade(5, -1000)], 102000]
  ];
  for (const [name, logs, expect] of cases) {
    const c = w.utils.calcEquityCurve(logs);
    ck(`${name} 终点 = ${expect}`, Math.abs(c.finalEq - expect) < 1, '实际=' + c.finalEq);
    ck(`${name} 各点均有限`, c.data.every(p => isFinite(p.eq)));
    // 双参数路径（risk.js / skills-integration.js 用）
    const c2 = w.utils.calcEquityCurve(logs, w.loadSettings(), {});
    ck(`${name} 双参数路径一致`, Math.abs(c2.finalEq - expect) < 1, '实际=' + c2.finalEq);
  }
  const pure = w.utils.calcEquityCurve([mkTrade(5, 2000)], w.loadSettings(), { purePnl: true });
  ck('purePnl 起点仍为 0（统计口径不受影响）', pure.initCap === 0, '实际=' + pure.initCap);

  console.log('[F] getHeatHardMax 语义拆分');
  setS({ riskHeatMax: 6 });
  ck('默认硬上限仍 6（历史行为不变）', w.getHeatHardMax() === 6, '实际=' + w.getHeatHardMax());
  setS({ riskHeatMax: 15 });
  ck('调至 15 时不被警告值拉回', w.getHeatHardMax() === 15, '实际=' + w.getHeatHardMax());
  setS({});
  ck('警告上限独立 = 8', w.getHeatWarnMax() === 8, '实际=' + w.getHeatWarnMax());

  console.log('[G] 保存链路新增字段');
  setS({}); fillOk(); w.calculate();
  ck('可保存', w.saveLog() === true);
  const rec = w.logs[0];
  ck('initialRiskAmount 已落库（R 不为 NaN）',
    rec.initialRiskAmount != null && isFinite(rec.riskAmount / rec.initialRiskAmount),
    '实际=' + rec.initialRiskAmount);
  ck('rrNetProfit/rrNetLoss 已落库（含费 RR 可还原）',
    rec.rrNetProfit != null && rec.rrNetLoss != null && rec.rrNetLoss > 0);
  if (rec.rrNetLoss > 0) {
    ck('日志值重算 RR 与 targetRR 一致',
      Math.abs(rec.rrNetProfit / rec.rrNetLoss - rec.targetRR) < 0.01,
      '重算=' + (rec.rrNetProfit / rec.rrNetLoss).toFixed(3) + ' targetRR=' + rec.targetRR.toFixed(3));
  }

  console.log('[H] 脏标记与清单闸门（真实事件）');
  setS({}); fillOk(); w.calculate(); w.saveLog();
  ck('重算后 dirty=false', w.getCalcDirty() === false);
  type('entryPrice', '1001');
  ck('改表单后 dirty=true', w.getCalcDirty() === true);
  ck('保存按钮被禁用', d.getElementById('saveBtn').disabled === true);
  ck('拒绝保存过期计算', w.saveLog() === false);

  console.log('');
  console.log('================ 结果 ================');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });