// ==================== 核心算法回归（v5.6.41 新增 / v5.6.42 扩展，常驻脚本） ====================
//
// v5.6.41 立项：基线 14 个跑测器 / 3300+ 断言全绿，但保护的是「计算自洽」，
//   不覆盖异常路径与数值稳健性——连亏熔断被 IIFE 吞掉早退、Infinity 能写进
//   pnlAmount、凯利 Infinity/NaN 穿透钳制（A~G 组，21 条红）。
// v5.6.42 扩展：三项数学口径 + 存量脏值收口（H~K 组，再补 27 条红）：
//   强平价计价口径、分批调和均价与止损距离量纲、夏普日收益率/样本标准差/rf、
//   toFiniteNum + loadLogs 脏值隔离。并新增 H8~H10 护栏防止 1x 强平价=0 被误判无解。
//
// 本脚本按 CLAUDE.md 的纪律编写：每条断言都描述「修复后的正确行为」，
// 且带 --inject 自检模式——把守卫 monkey-patch 回旧实现，断言必须变红，
// 否则说明断言是恒真的、没有捕获力。
//
// 用法：node test/verify_core_algo.js            正常跑（全绿才算修复完成）
//       node test/verify_core_algo.js --inject   注入旧实现，必须出现 FAIL（验证脚本有效）
// 退出码：0 = 符合预期；1 = 不符合预期。
'use strict';
const path = require('path');
const fs = require('fs');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const INJECT = process.argv.includes('--inject');
const ROOT = path.join(__dirname, '..');

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
  const dom = await JSDOM.fromFile(path.join(ROOT, 'index.html'), {
    runScripts: 'dangerously', resources: new LL(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: makeStorage() });
      w.Element.prototype.scrollIntoView = function () {};
    }
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 900));
  const d = w.document;

  // ---- 取数探针：统计一次 calculate() 内 loadSettings 被调用几次 ----
  const _origLoadSettings = w.loadSettings;
  let loadCount = 0;
  w.loadSettings = function () { loadCount++; return _origLoadSettings.apply(this, arguments); };

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
  if (rs) for (const o of rs.options) { if (o.text && o.text.includes('趋势突破')) { rs.value = o.value; break; } }
  const fillOk = () => {
    w.logs.length = 0;
    type('symbol', 'BTC'); type('entryPrice', '1000'); type('capital', '100000');
    type('stopLoss', '980'); type('leverage', '10'); type('direction', 'long'); type('targetPrice', '1060');
  };
  const run = () => { w.calculate(); return { calc: w.getCalc(), blocker: w.getCalcBlocker() }; };
  const mkLoss = (i, pnl) => {
    const x = new Date().toISOString();
    return {
      id: 'loss' + i, symbol: 'BTC', direction: 'long', capital: 100000, pnlAmount: pnl,
      closeType: 'closeAll', closeTime: x, time: x, status: 'closed', initialRiskAmount: 2000
    };
  };

  // ---- 注入自检：把守卫退回旧实现，断言必须变红 ----
  if (INJECT) {
    w._getTodayLossStreak = function () { return { streak: 0, totalLossCount: 0 }; };
    w.getLegacySlippageCost = function (item, o) { return parseFloat(o) || 0; };
    w.calcKelly = function (wr, aw, al, cap) {
      if (isNaN(aw) || isNaN(al) || al <= 0 || aw <= 0) return null;
      return { kellyPct: 0.3, halfKellyPct: 0.15, kellyRiskAmount: cap * 0.3,
        halfKellyRiskAmount: cap * 0.15, expectancy: 1, recommendation: '', kellyCapped: false, halfKellyCapped: false };
    };
    // v5.6.42 数学口径注入：把四项修复退回升级前的实现，H/I/J/K 组必须变红。
    w.utils.calcLiquidationPrice = function (E, dir, L, m) {
      if (!E || E <= 0 || !L || L <= 0 || m == null || m < 0) return NaN;
      var i = 1 / L;
      var lp = dir === 'long' ? E * (1 - i + m) / (1 - m)
             : dir === 'short' ? E * (1 + i - m) / (1 + m) : NaN;
      return isFinite(lp) && lp > 0 ? lp : NaN;
    };
    // 用页面 eval 造闭包，才能读到经典脚本词法环境里的 _splitBatches。
    w.computeWeightedEntry = w.eval('(function(){var s=0,a=0;' +
      'for(var i=0;i<_splitBatches.length;i++){var p=parseFloat(_splitBatches[i].price),q=parseFloat(_splitBatches[i].alloc);' +
      'if(!isNaN(p)&&p>0&&!isNaN(q)&&q>0){s+=p*q;a+=q;}}return a>0?s/a:null;})');
    w.getSplitEntries = function () {
      var w2 = w.computeWeightedEntry();
      return w2 === null ? null : { entries: [], weightedEntry: w2 };
    };
    w.utils.dailySharpe = function (closed, opt) {
      opt = opt || {};
      var ad = 365, vals = [], arr = Array.isArray(closed) ? closed : [];
      for (var i = 0; i < arr.length; i++) vals.push(parseFloat(arr[i].pnlAmount) || 0);
      if (vals.length < 2) return null;
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var sd = Math.sqrt(vals.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / vals.length);
      if (sd <= 0) return null;
      return { sharpe: mean / sd * Math.sqrt(ad), days: vals.length, zeroDays: 0, mean: mean, sd: sd };
    };
    w.utils.sanitizeLogNumbers = function () { return 0; };
    w.toFiniteNum = function (v) { return parseFloat(v) || 0; };
    w.computeWeightedStopDistance = function (batches) {
      var s = 0, a = 0;
      for (var i = 0; i < batches.length; i++) {
        var p = parseFloat(batches[i].price), q = parseFloat(batches[i].alloc);
        if (!isFinite(p) || p <= 0 || !isFinite(q) || q <= 0) continue;
        s += Math.abs(p - parseFloat(batches[i].stopLoss)) * q; a += q;
      }
      return { distance: a > 0 ? s / a : null, totalAlloc: a, skippedCount: 0 };
    };
    console.log('[注入自检] 已把连亏计数 / 旧式滑点 / 凯利守卫 + 强平价 / 加权均价 / 夏普 / 脏值守卫退回旧实现\n');
  }

  // ==================== A. 连亏熔断必须真正早退（P0-1） ====================
  console.log('[A] 连亏熔断的早退语义');
  setS({}); fillOk();
  for (let i = 0; i < 3; i++) w.logs.push(mkLoss(i, -100));
  let r = run();
  ck('A1 当日连亏达阈值时不得产出计算结果（IIFE 的 return 不能只退出匿名函数）',
    r.calc === null, 'calc.positionSize=' + (r.calc && r.calc.positionSize));
  ck('A2 blocker 为 loss-streak-limit',
    !!r.blocker && r.blocker.code === 'loss-streak-limit', 'blocker=' + JSON.stringify(r.blocker));

  // 取数异常路径：权威实现抛错时必须 fail-closed，且阻断态不得被覆盖
  if (!INJECT) {
    const _origStreak = w._getTodayLossStreak;
    w._getTodayLossStreak = function () { throw new Error('模拟日志读取失败'); };
    setS({}); fillOk();
    r = run();
    ck('A3 连亏计数异常 → loss-streak-unavailable 硬阻断',
      !!r.blocker && r.blocker.code === 'loss-streak-unavailable', 'blocker=' + JSON.stringify(r.blocker));
    ck('A4 异常阻断后同样不得产出计算结果', r.calc === null,
      'calc.positionSize=' + (r.calc && r.calc.positionSize));
    w._getTodayLossStreak = _origStreak;
  } else {
    ck('A3（注入模式跳过）', true); ck('A4（注入模式跳过）', true);
  }

  // ==================== B. 平仓结算非有限数终检（P0-2） ====================
  console.log('[B] 结算脏值不得写入日志');
  const dirty = { symbol: 'BTC', direction: 'long', entryPrice: 100, positionSize: 1000,
    fee: 1, slippageCost: 'Infinity', riskAmount: 100 };
  const sl = w.getLegacySlippageCost(dirty, undefined);
  ck('B1 旧式滑点脏值必须归为有限非负数',
    Number.isFinite(sl) && sl >= 0, 'getLegacySlippageCost=' + sl);
  const st = w.calculateCloseSettlement(dirty, 110, undefined, undefined);
  ck('B2 结算返回值本身必须存在且每个数值字段有限',
    !!st && Object.keys(st).every(k => typeof st[k] !== 'number' || Number.isFinite(st[k])),
    'settlement=' + JSON.stringify(st));
  ck('B3 override 传入 "Infinity" 也不得污染结算',
    Number.isFinite(w.getLegacySlippageCost({}, 'Infinity')) &&
    w.getLegacySlippageCost({}, 'Infinity') >= 0);
  ck('B4 负滑点（脏数据/返佣）不得反向放大盈亏',
    w.getLegacySlippageCost({ slippageCost: '-50' }, undefined) >= 0);

  // ==================== C. 凯利入参/出参有限性（P0-2） ====================
  console.log('[C] 凯利公式不得输出 NaN/Infinity 仓位建议');
  ck('C1 winRate=NaN → null', w.calcKelly(NaN, 100, 50, 10000) === null);
  ck('C2 avgWin=Infinity → null', w.calcKelly(0.6, Infinity, 50, 10000) === null);
  ck('C3 avgLoss=Infinity → null', w.calcKelly(0.6, 100, Infinity, 10000) === null);
  ck('C4 accountSize=Infinity → null', w.calcKelly(0.6, 100, 50, Infinity) === null);
  ck('C5 合法输入结果不变（kellyPct=0.025，未触及 5% 上限）',
    (function () { const k = w.calcKelly(0.5, 100, 95, 10000); return !!k && Math.abs(k.kellyPct - 0.025) < 1e-12; })());

  // ==================== D. ATR 止损的数值边界（P1） ====================
  console.log('[D] ATR 止损距离不得为 0 / 非有限');
  ck('D1 极小 ATR×倍数（下溢为 0）返回 null', w.calcATRStop(100, 1e-320, 1e-320, 'long') === null);
  ck('D2 ATR=Infinity 返回 null', w.calcATRStop(100, Infinity, 2, 'long') === null);
  ck('D3 合法 ATR 结果不变（100 / 2 / 2.0 → 4）',
    (function () { const a = w.calcATRStop(100, 2, 2, 'long'); return !!a && a.stopDistance === 4; })());

  // ==================== E. 闸门 readFailed 语义对称（P1） ====================
  console.log('[E] 无本金时闸门必须透出「不可判定」');
  setS({ accountBalance: 0 });
  const dl = w.checkDailyLossLimit();
  ck('E1 日亏损闸门无本金时透出 readFailed', dl && dl.readFailed === true, JSON.stringify(dl));
  const cc = w.checkSymbolConcentration('BTC', 1000, 10, 0, []);
  ck('E2 集中度闸门无本金时透出 readFailed', cc && cc.readFailed === true, JSON.stringify(cc));
  ck('E3 有本金时不得误标 readFailed',
    w.checkDailyLossLimit(100000).readFailed !== true &&
    w.checkSymbolConcentration('BTC', 1000, 10, 100000, []).readFailed !== true);

  // ==================== F. 单次计算的取数上下文（P1） ====================
  console.log('[F] 一次计算的设置快照');
  setS({}); fillOk();
  loadCount = 0;
  w.calculate();
  console.log('  [诊断] 单次 calculate() 内 loadSettings 调用次数 = ' + loadCount + '（升级前 30）');
  const calcSrc = fs.readFileSync(path.join(ROOT, 'js', 'calculator.js'), 'utf8');
  ck('F1 取数次数低于升级前基线（30 次）', loadCount < 30, '实测 ' + loadCount);
  ck('F2 _numSetting 走单次计算快照，不再每调一次读一次设置',
    /_getCalcSettingsSnapshot\(\)/.test(calcSrc) &&
    /_calcInProgress \? _getCalcSettingsSnapshot\(\)/.test(calcSrc));
  ck('F3 快照作用域严格限定在 calculate() 内（入口置真 / finally 复位）',
    /_calcInProgress = true/.test(calcSrc) &&
    /finally[\s\S]{0,300}_calcInProgress = false/.test(calcSrc));

  // ==================== G. 源码级不变量（防「改完又漏」） ====================
  console.log('[G] 源码级不变量');
  const logsSrc = fs.readFileSync(path.join(ROOT, 'js', 'logs.js'), 'utf8');
  const skillsSrc = fs.readFileSync(path.join(ROOT, 'js', 'skills-integration.js'), 'utf8');
  ck('G1 calculate() 用 finally 单点收口 _calcCleanup',
    /function calculate\(\)[\s\S]{0,1200}finally[\s\S]{0,300}_calcCleanup\(\)/.test(calcSrc));
  ck('G2 连亏闸门的结果提到 IIFE 之外判定（不再在 IIFE 内 return）',
    /_streakBlock/.test(calcSrc) && /if \(_streakBlock\)/.test(calcSrc));
  ck('G3 组合热量两处消费点都判 readFailed',
    /heatCheck\.readFailed/.test(calcSrc) && /_heatRecheck\.readFailed/.test(calcSrc));
  ck('G4 结算出口有非有限数终检',
    /Number\.isFinite\(netPnl\)/.test(logsSrc));
  ck('G5 凯利入口用 Number.isFinite 而非全局 isNaN',
    /Number\.isFinite\(winRate\)/.test(skillsSrc) || /every\(Number\.isFinite\)/.test(skillsSrc));
  ck('G6 ATR 输出有限性校验在 skills-integration.js',
    /Number\.isFinite\(stopDistance\)/.test(skillsSrc));

  // ==================== H. 强平价：单一计价口径（v5.6.42 数学升级） ====================
  // 旧公式把「初始保证金按开仓名义」与「维持保证金按强平价名义」两种口径拼在一起：
  // LP=E(1−IMR+MMR)/(1−MMR)。逐仓强平的严格恒等式是 IM − 亏损 = MM（MM 按强平价名义），
  // 即 多头 E−LP = E/L − LP·MMR、空头 LP−E = E/L − LP·MMR。旧公式两式都不成立。
  console.log('[H] 强平价计价口径与风控边界');
  const LP = (E, dir, L, m) => (w.utils && typeof w.utils.calcLiquidationPrice === 'function')
    ? w.utils.calcLiquidationPrice(E, dir, L, m) : NaN;
  const HE = 100000, HM = 0.005, HL = 10;
  const lpL = LP(HE, 'long', HL, HM), lpS = LP(HE, 'short', HL, HM);
  ck('H1 多头满足 IM−亏损=MM 恒等式',
    Number.isFinite(lpL) && Math.abs((HE - lpL) - (HE / HL - lpL * HM)) < 1e-6, 'LP=' + lpL);
  ck('H2 空头满足 IM−亏损=MM 恒等式',
    Number.isFinite(lpS) && Math.abs((lpS - HE) - (HE / HL - lpS * HM)) < 1e-6, 'LP=' + lpS);
  ck('H3 10x/0.5% 多头 = 90452.2613（旧拼接口径 90954.77）',
    Math.abs(lpL - 90452.2613065) < 1e-5, '得 ' + lpL);
  ck('H4 空头 = 109452.7363（与多头同口径）',
    Math.abs(lpS - 109452.7363184) < 1e-5, '得 ' + lpS);
  ck('H5 MMR ≥ 1 直接 NaN，不产出负价/Infinity',
    Number.isNaN(LP(HE, 'long', 10, 1)) && Number.isNaN(LP(HE, 'short', 10, 1.5)));
  ck('H6 非法杠杆/方向仍返回 NaN',
    Number.isNaN(LP(HE, 'long', 0, HM)) && Number.isNaN(LP(HE, 'x', 10, HM)));
  ck('H7 风控边界显式解耦：上限仍锁 floor(1/(2×MMR))=100x，不随公式放宽到 200x',
    /Math\.floor\(1 \/ \(2 \* mmr\)\)/.test(calcSrc) && /保守风控边界/.test(calcSrc));
  // 回归护栏：新公式在 IMR=1 时 LP=0（价格归零才亏完本金）是合法解。
  // 早期实现把 <=0 判成 NaN，让 1x 仓位被 liquidation-unsolvable 误拦 216 组参数。
  ck('H8 1x 杠杆强平价 = 0 是合法解而非 NaN',
    LP(HE, 'long', 1, HM) === 0 && Number.isFinite(LP(HE, 'long', 1, HM)));
  ck('H9 calculator 终检允许 LP=0（源码级）', /liquidationPrice < 0/.test(calcSrc));
  setS({}); fillOk(); type('leverage', '1');
  const r1x = run();
  ck('H10 1x 开仓计算不得因强平价=0 被判无解',
    !(r1x.blocker && r1x.blocker.code === 'liquidation-unsolvable'),
    'blocker=' + JSON.stringify(r1x.blocker));

  // ==================== I. 分批加权入场价与止损距离（v5.6.42 数学升级） ====================
  // 每批投入资金按 alloc 分配、成交价 bp_i 不同 → 数量 q_i ∝ alloc/bp_i，
  // 等效均价必须是调和平均 E=Σa/Σ(a/bp)，而非资金权重算术平均 Σ(a·bp)/Σa。
  // 止损距离同理：总损失=Σ q_i·dist_i=名义×Σ(w_i·dist_i/bp_i)，故 dist=E×Σ(w_i·dist_i/bp_i)。
  console.log('[I] 分批加权入场价 / 止损距离');
  const savedB = w.eval('JSON.stringify(_splitBatches)');
  const savedM = w.eval('_splitMode');
  const setB = arr => w.eval('_splitBatches = ' + JSON.stringify(arr) + '; _splitMode = true;');
  setB([{ price: '100', alloc: '50', stopLoss: '' }, { price: '200', alloc: '50', stopLoss: '' }]);
  const we1 = w.computeWeightedEntry();
  ck('I1 100/200 各 50% → 调和均价 133.3333（旧算术平均错给 150）',
    Math.abs(we1 - 133.3333333333) < 1e-6, '得 ' + we1);
  setB([{ price: '50000', alloc: '50' }, { price: '51000', alloc: '30' }, { price: '52000', alloc: '20' }]);
  const se3 = w.getSplitEntries();
  ck('I2 三批落库加权入场价 = 50688.07339（旧口径 50700）',
    !!se3 && Math.abs(se3.weightedEntry - 50688.0733945) < 1e-3, '得 ' + (se3 && se3.weightedEntry));
  ck('I3 新记录带 weightedEntryModel=harmonic（旧记录无标记 → 只读不重算）',
    !!se3 && se3.weightedEntryModel === 'harmonic', '得 ' + (se3 && se3.weightedEntryModel));
  setB([{ price: '123.45', alloc: '30' }, { price: '123.45', alloc: '70' }]);
  ck('I4 同价批次退化为该价（反向用例）', Math.abs(w.computeWeightedEntry() - 123.45) < 1e-9);
  setB([{ price: '100', alloc: '50' }, { price: '200', alloc: '50' }]);
  ck('I5 调和均价 ≤ 算术均价（Jensen）', w.computeWeightedEntry() <= 150 + 1e-9);
  // bp=100/200、dist=10/40、各 50%：E=133.333，Σ(w·dist/bp)=0.15 → 正确距离 20；旧算术加权给 25
  setB([{ price: '100', alloc: '50', stopLoss: '90' }, { price: '200', alloc: '50', stopLoss: '160' }]);
  const ws1 = (typeof w.computeWeightedStopDistance === 'function')
    ? w.computeWeightedStopDistance(w.eval('_splitBatches'), 'long', 90, w.computeWeightedEntry()) : null;
  ck('I6 加权止损距离补 E/bp_i 因子 → 20（旧算术加权 25）',
    !!ws1 && Math.abs(ws1.distance - 20) < 1e-9, '得 ' + (ws1 && ws1.distance));
  setB([{ price: '100', alloc: '50', stopLoss: '90' }, { price: '100', alloc: '50', stopLoss: '80' }]);
  const ws2 = (typeof w.computeWeightedStopDistance === 'function')
    ? w.computeWeightedStopDistance(w.eval('_splitBatches'), 'long', 90, w.computeWeightedEntry()) : null;
  ck('I7 同价批次量纲因子退化为 1（反向用例）',
    !!ws2 && Math.abs(ws2.distance - 15) < 1e-9, '得 ' + (ws2 && ws2.distance));
  ck('I8 calculate() 通过纯函数消费加权止损距离，不再内联 Σ(dist·alloc)',
    /computeWeightedStopDistance\(/.test(calcSrc) && !/weightedStopPct \+=/.test(calcSrc));
  w.eval('_splitBatches = ' + savedB + '; _splitMode = ' + savedM + ';');

  // ==================== J. 夏普：日收益率 / 样本标准差 / 无风险利率 ====================
  console.log('[J] 夏普口径');
  const DS = (w.utils && typeof w.utils.dailySharpe === 'function')
    ? w.utils.dailySharpe : function () { return null; };
  const day = n => new Date(2026, 0, 1 + n, 12, 0, 0).toISOString();
  const seqA = [{ closeTime: day(0), pnlAmount: 10 }, { closeTime: day(1), pnlAmount: -10 },
                { closeTime: day(2), pnlAmount: 5 }];
  const sh = DS(seqA, { startEquity: 100 });
  ck('J1 返回 basis=return（按日收益率，不是日盈亏金额）', !!sh && sh.basis === 'return');
  ck('J2 mean 为收益率量纲 0.01969697（旧金额口径 1.6667）',
    !!sh && Math.abs(sh.mean - 0.0196969697) < 1e-9, '得 ' + (sh && sh.mean));
  ck('J3 sd 用样本标准差 ÷(n−1)=0.09899634（旧总体 ÷n=0.0808）',
    !!sh && Math.abs(sh.sd - 0.09899634075) < 1e-9, '得 ' + (sh && sh.sd));
  ck('J4 夏普 = mean/sd×√365 = 3.8012524',
    !!sh && Math.abs(sh.sharpe - 3.8012523981) < 1e-8, '得 ' + (sh && sh.sharpe));
  const shRf = DS(seqA, { startEquity: 100, riskFreeRate: 0.0365 });
  ck('J5 无风险利率生效（年化 3.65% → 日 0.0001）',
    !!shRf && !!sh && shRf.sharpe < sh.sharpe &&
    Math.abs(shRf.sharpe - (sh.mean - 0.0001) / sh.sd * Math.sqrt(365)) < 1e-8,
    '得 ' + (shRf && shRf.sharpe));
  ck('J6 缺 startEquity → null（fail-closed，不拿金额冒充收益率）', DS(seqA) === null);
  ck('J7 startEquity 非正/非有限 → null',
    DS(seqA, { startEquity: 0 }) === null && DS(seqA, { startEquity: Infinity }) === null);
  const sh20 = DS([{ closeTime: day(0), pnlAmount: 100 }, { closeTime: day(19), pnlAmount: 100 }],
                  { startEquity: 1000 });
  ck('J8 空闲日铺满仍生效（20 日 / 18 个零日 / 逐日权益递推）',
    !!sh20 && sh20.days === 20 && sh20.zeroDays === 18 &&
    Math.abs(sh20.mean - 0.0095454545454) < 1e-9 &&
    Math.abs(sh20.sd - 0.0294172780954) < 1e-9, JSON.stringify(sh20));
  // UI 真链路：stats.js 必须把期初权益传给 dailySharpe；缺本金时 fail-closed 并给出指引
  const shEl = d.getElementById('statSharpe');
  const mkClosed = (n, pnl, cap) => ({ id: 'j' + n, symbol: 'BTC', direction: 'long',
    closeType: 'closeAll', status: 'closed', closeTime: day(n), time: day(n),
    pnlAmount: pnl, capital: cap, fee: 0 });
  w.eval('logs = []');
  w.logs.push(mkClosed(0, 100, 1000), mkClosed(1, -50, 1000), mkClosed(2, 80, 1000));
  setS({ accountBalance: 1000 });
  try { w.updateStats(); } catch (e) { /* 下面断言会如实报红 */ }
  ck('J9 有期初权益时统计面板显示夏普数值（日收益率口径已接通 UI）',
    !!shEl && /^-?\d+\.\d{2}$/.test(shEl.textContent.trim()),
    '得 ' + (shEl && shEl.textContent));
  ck('J10 面板 title 标明日收益率口径与期初权益',
    !!shEl && /日收益率口径/.test(shEl.title) && /1000/.test(shEl.title),
    '得 ' + (shEl && shEl.title));
  w.eval('logs = []');   // 清掉 capital 快照兜底，模拟「从未填账户余额」的新用户
  w.logs.push(mkClosed(0, 100, undefined), mkClosed(1, -50, undefined));
  setS({ accountBalance: 0 });
  try { w.updateStats(); } catch (e) { /* 同上 */ }
  ck('J11 缺期初权益时 fail-closed 显示「—」并指引填写账户余额',
    !!shEl && shEl.textContent.trim() === '—' && /账户余额/.test(shEl.title),
    '得 ' + (shEl && shEl.textContent) + ' / ' + (shEl && shEl.title));
  w.eval('logs = []');

  // ==================== K. 存量脏日志与读端守卫 ====================
  console.log('[K] 存量脏值隔离');
  const tfn = (typeof w.toFiniteNum === 'function') ? w.toFiniteNum : null;
  ck('K1 toFiniteNum("Infinity")=0（旧 parseFloat||0 放行 Infinity）',
    !!tfn && tfn('Infinity') === 0, '得 ' + (tfn && tfn('Infinity')));
  ck('K2 toFiniteNum 保留 parseFloat 前缀语义（"12.5abc"→12.5）',
    !!tfn && tfn('12.5abc') === 12.5);
  ck('K3 toFiniteNum 支持自定义 fallback', !!tfn && tfn(null, 7) === 7);
  const san = (w.utils && typeof w.utils.sanitizeLogNumbers === 'function')
    ? w.utils.sanitizeLogNumbers : null;
  const rows = [{ pnlAmount: 'Infinity', fee: 'NaN', positionSize: '1000', entryPrice: '1e999',
                  closes: [{ pnl: 'Infinity', ratio: 100 }],
                  splitEntries: { entries: [{ price: 'Infinity' }] } }];
  const fixed = san ? san(rows) : -1;
  ck('K4 存量脏日志按字段原地规范化（修复字段 ≥ 4）', fixed >= 4, 'fixed=' + fixed);
  ck('K5 规范化后嵌套对象内的数值全部有限',
    rows[0].pnlAmount === 0 && rows[0].fee === 0 && rows[0].entryPrice === 0 &&
    rows[0].closes[0].pnl === 0 && rows[0].splitEntries.entries[0].price === 0,
    JSON.stringify(rows[0]));
  ck('K6 合法字段不被误改', !!san && (function () {
    const r2 = [{ symbol: 'BTC', pnlAmount: 12.5, closeType: 'closeAll', fee: '0.4' }];
    san(r2);
    return r2[0].symbol === 'BTC' && r2[0].pnlAmount === 12.5 && r2[0].fee === '0.4';
  })());
  const storageSrc = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf8');
  ck('K7 loadLogs 在 JSON.parse 之后无条件隔离脏值（覆盖导入/多标签同步）',
    /JSON\.parse\(raw\)[\s\S]{0,400}_sanitizeLoadedLogs\(\)/.test(storageSrc) &&
    /sanitizeLogNumbers\(logs\)/.test(storageSrc) &&
    (storageSrc.match(/_sanitizeLoadedLogs\(\)/g) || []).length >= 3);
  const jsDir = path.join(ROOT, 'js');
  const dirtyPnlReads = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).filter(f => {
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    return src.split('\n').some(l => /pnlAmount/.test(l) && /parseFloat\([^)]*\)\s*\|\|\s*0/.test(l));
  });
  ck('K8 读端不再有 parseFloat(pnlAmount)||0 放行脏值',
    dirtyPnlReads.length === 0, '残留文件: ' + dirtyPnlReads.join(','));
  ck('K9 null 保持原样（改成 0 会凭空造一笔 0 盈亏已平仓交易，污染胜率分母）',
    !!san && (function () {
      const r3 = [{ pnlAmount: null, symbol: 'BTC' }];
      san(r3);
      return r3[0].pnlAmount === null && r3[0].symbol === 'BTC';
    })());
  // 真链路（不是纯函数、也不是源码正则）：脏日志落进 localStorage 后由 loadLogs 隔离
  (function () {
    var key = w.eval('typeof STORAGE_KEY !== "undefined" ? STORAGE_KEY : null');
    if (!key) { ck('K10 loadLogs 真链路隔离脏日志', false, '取不到 STORAGE_KEY'); return; }
    w.localStorage.setItem(key, JSON.stringify([
      { id: 'dirty-1', symbol: 'BTC', closeType: 'closeAll', pnlAmount: 'Infinity', fee: 'NaN' }
    ]));
    var loaded = w.loadLogs();
    var row = w.eval('logs && logs[0]');
    ck('K10 loadLogs 真链路隔离脏日志',
      loaded !== false && !!row && row.pnlAmount === 0 && row.fee === 0,
      'row=' + JSON.stringify(row));
    w.localStorage.removeItem(key);
    w.eval('logs = []');
  })();

  // ==================== 汇总 ====================
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (INJECT) {
    // 注入模式下「有失败」才是正确结果：证明断言不是恒真的
    const ok = fail > 0;
    console.log(ok ? '[注入自检] ✅ 断言确实捕获了被架空的守卫（FAIL ' + fail + ' 条）'
                   : '[注入自检] ❌ 注入旧实现后仍全绿，断言无捕获力');
    process.exit(ok ? 0 : 1);
  }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
