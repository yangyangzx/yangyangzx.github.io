// 开仓计划守恒校验（2026-10-10 深度审计）——一次性验证脚本，可重跑。
//
// 存在意义：本次审计发现的两个 P0 都是「同一个量在不同截断层各自更新」造成的
// （positionSize 与 adjPos 分叉、集中度按 adjPos 比例缩放 positionSize），
// 共同特征是破坏恒等式：riskAmount === positionSize × stopDistance / entryPrice。
// 单个场景手推容易漏，故这里批量遍历参数组合，把恒等式当不变量逐组断言。
//
// 用法：node verify_invariants.js
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

class LocalOnlyLoader extends ResourceLoader {
  fetch(url, opts) {
    return url.startsWith('file://') ? super.fetch(url, opts) : Promise.reject(new Error('blocked'));
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
    runScripts: 'dangerously', resources: new LocalOnlyLoader(),
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: makeStorage() });
      w.Element.prototype.scrollIntoView = function () {};
    }
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 900));
  const d = w.document;

  let pass = 0, fail = 0;
  const bad = [];
  const check = (name, cond, extra) => {
    if (cond) pass++;
    else { fail++; bad.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
  };

  const set = (id, v) => { const el = d.getElementById(id); if (el) el.value = v; };
  const setS = o => {
    w.localStorage.setItem('trade_settings_v1', JSON.stringify(Object.assign({
      accountBalance: 10000, mmr: 0.5, riskPercent: 10, riskHeatMax: 50,
      singleSymbolMaxPct: 50, minRRRatio: 1, marginUsageLimitPct: 100,
      aggregateMarginLimitPct: 100, lossStreakBlock: 99, mindsetMinScore: 3
    }, o)));
    w._clearSettingsCache();
  };
  const fa = d.getElementById('formAtrStopEnabled'); if (fa) fa.checked = false;
  const ms = d.getElementById('mindsetScore'); if (ms) ms.value = '5';

  // 遍历：止损距离 × 杠杆 × 风险比例 × 连亏降仓 × 集中度 × 心态
  const stops = ['980', '990', '950', '999'];
  const leverages = ['1', '5', '10', '20'];
  const risks = ['1%', '3%', '8%'];
  const derisks = [[2, 0.8], [2, 0.5], [3, 0.6]];
  const concs = [50, 10, 5];
  const mindsets = ['5', '2'];   // 2 分会触发 0.5 降仓

  let combos = 0, blocked = 0;
  const blockerTally = {};
  // 关键：阻断也是断言对象。若只校验「拿到 calc 时自洽」，把 bug 注入成「提前阻断」
  // 就能让校验全绿而问题仍在（反向验证已证实这一点）。故此处额外断言：
  // ① 阻断必须有明确 code（不能是无阻断的空 return）；
  // ② 任一闸门都不该在这组参数下**无故**触发——集中度上限 ≥50 且无降仓时不该阻断。
  console.log('遍历参数组合，校验 riskAmount === positionSize × stopDistance / entryPrice ...');
  for (const sl of stops)
    for (const lev of leverages)
      for (const risk of risks)
        for (const [dt, df] of derisks)
          for (const conc of concs)
            for (const mind of mindsets) {
              setS({ lossStreakDerisk: dt, lossStreakDeriskFactor: df, singleSymbolMaxPct: conc });
              w.logs.length = 0;
              if (ms) ms.value = mind;
              set('symbol', 'BTC'); set('entryPrice', '1000'); set('capital', '10000');
              set('stopLoss', sl); set('leverage', lev); set('direction', 'long');
              set('lossStreak', String(dt));
              try { w.calculate(); } catch (e) { /* 阻断路径不算 */ }
              const c = w.getCalc();
              const tag = `sl=${sl} lev=${lev} risk=${risk} derisk=${dt}/${df} conc=${conc} mind=${mind}`;
              if (!c) {
                blocked++;
                const blk = w.getCalcBlocker && w.getCalcBlocker();
                const code = (blk && blk.code) || '(无阻断原因)';
                blockerTally[code] = (blockerTally[code] || 0) + 1;
                // 阻断必须有明确原因，否则是「静默 return」
                check('阻断有明确 code ' + tag, !!(blk && blk.code), 'getCalc() 为 null 但无 blocker');
                // 这组参数不该触发的闸门：集中度 50%(不触发) + 心态 5 分(不降仓)
                // → 「集中度超限」「心态不足」是误阻断。
                // 注意不能顺带排除 custom-stop-limit-exceeded：sl=950 是 5% 止损，
                // 超过 BTC 默认上限 3%，该阻断是正确的。
                if (conc >= 50 && mind === '5') {
                  check('宽松参数下不应被集中度/心态类阻断 ' + tag,
                    !(code === 'symbol-concentration-limit' || code === 'mindset-limit'),
                    'blocker=' + code);
                }
                continue;
              }
              combos++;
              // 核心不变量
              const implied = c.positionSize * c.stopDistance / c.entryPrice;
              check('恒等式 ' + tag,
                Math.abs(implied - c.riskAmount) <= Math.max(0.5, c.riskAmount * 0.005),
                `pos=${c.positionSize.toFixed(2)} ×S/E=${implied.toFixed(2)} vs risk=${c.riskAmount.toFixed(2)}`);
              // 集中度不得被突破——**无条件断言**。
              // 反向验证教训：原写成 `if (!c.cappedByMargin || ...)`，而集中度正常截断时
              // cappedByMargin 恰为 true，于是「最该检查的场景」被跳过；
              // 注入量纲 bug 后校验仍全绿。集中度上限必须无条件成立。
              const effLev = Number(c.leverage) > 0 ? Number(c.leverage) : 1;
              const mgPct = (c.positionSize / effLev) / c.capital * 100;
              check('集中度未突破 ' + tag, mgPct <= conc + 1.0,
                `实际=${mgPct.toFixed(2)}% 上限=${conc}%`);
              // 聚合上限（100%）与保证金上限（100%）在本用例中均放开，此处只查集中度
              // 风险额不得超过计划风险额（降仓只会更小）
              check('risk ≤ plannedRisk ' + tag,
                c.riskAmount <= c.plannedRiskAmount + 0.5,
                `risk=${c.riskAmount.toFixed(2)} planned=${c.plannedRiskAmount.toFixed(2)}`);
            }

  console.log('\n[1] 守恒校验结果');
  check('至少跑通 100 组有效组合（避免断言空转）', combos >= 100, 'combos=' + combos);

  // 脏值防护：越界/非数字设置必须被 _numSetting 拦回默认
  console.log('\n[2] 脏值防护（_numSetting 区间钳制）');
  for (const [k, v, expect] of [['marginUsageLimitPct', 150, 80], ['marginUsageLimitPct', 'abc', 80],
    ['aggregateMarginLimitPct', -5, 90], ['lossStreakDerisk', 999, 2], ['lossStreakDeriskFactor', 'x', 0.8]]) {
    setS({ [k]: v });
    const got = w._numSetting(k, expect);
    check(`脏值 ${k}=${JSON.stringify(v)} 回退默认 ${expect}`, got === expect, '实际=' + got);
  }
  // 合法值必须被采纳（防止钳制写过头）
  setS({ marginUsageLimitPct: 60, aggregateMarginLimitPct: 70 });
  check('合法值 60 被采纳', w._numSetting('marginUsageLimitPct', 80) === 60, '实际=' + w._numSetting('marginUsageLimitPct', 80));
  check('合法值 70 被采纳', w._numSetting('aggregateMarginLimitPct', 90) === 70, '实际=' + w._numSetting('aggregateMarginLimitPct', 90));

  // 熔断线与降仓线必须解耦
  console.log('\n[3] 熔断线 / 降仓线解耦');
  setS({ lossStreakDerisk: 2, lossStreakBlock: 5 });
  check('降仓线 = 2', w._getLossStreakDeriskThreshold() === 2, '实际=' + w._getLossStreakDeriskThreshold());
  check('熔断线 = 5（与降仓线独立）', w._getLossStreakBlockThreshold() === 5, '实际=' + w._getLossStreakBlockThreshold());
  check('降仓线 < 熔断线（降仓才有意义）',
    w._getLossStreakDeriskThreshold() < w._getLossStreakBlockThreshold());

  console.log('\n================ 结果 ================');
  console.log('有效组合 ' + combos + ' 组，被阻断 ' + blocked + ' 组');
  console.log('阻断原因分布：');
  Object.keys(blockerTally).sort((a, b) => blockerTally[b] - blockerTally[a])
    .forEach(k => console.log('   ' + k + ' × ' + blockerTally[k]));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (bad.length) { console.log('\n失败明细：'); bad.slice(0, 12).forEach(b => console.log('  - ' + b)); if (bad.length > 12) console.log('  … 共 ' + bad.length + ' 条'); }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });