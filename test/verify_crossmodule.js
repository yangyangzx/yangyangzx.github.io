// ==================== 跨模块计算逻辑回归（v5.6.43 新增，常驻脚本） ====================
//
// 立项原因：v5.6.42 全量门禁 15/15 全绿（3300+ 断言），但四组并行审计 + 两轮
//   jsdom 真链路探针仍复现出 12 条「算错钱 / 闸门失效 / 数据往返毁库」缺陷——
//   既有断言保护的是「单模块计算自洽」，不覆盖跨模块接线、异常路径与 UI↔落库口径。
//
// 纪律：每条断言描述修复后的正确行为；--inject 把守卫 monkey-patch 回旧实现，
//   断言必须变红，否则说明断言恒真、没有捕获力。
//
// 用法：node test/verify_crossmodule.js            正常跑（全绿才算修完）
//       node test/verify_crossmodule.js --inject   注入旧实现，必须出现 FAIL
'use strict';
const path = require('path'), fs = require('fs');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const INJECT = process.argv.includes('--inject');

class LL extends ResourceLoader {
  fetch(url, opts) { return url.startsWith('file://') ? super.fetch(url, opts) : Promise.reject(new Error('blocked')); }
}
function makeStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), clear: () => m.clear(), key: i => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; } };
}

(async () => {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
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
  const OrigBlob = w.Blob;

  let pass = 0, fail = 0;
  const ck = (n, c, e) => { if (c) pass++; else { fail++; console.log('  \u2717 ' + n + (e ? ' \u2192 ' + e : '')); } };
  const src = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  const S = {
    calc: src('calculator.js'), skills: src('skills-integration.js'), settings: src('settings.js'),
    io: src('io.js'), stats: src('stats.js'), logs: src('logs.js'), utils: src('utils.js')
  };
  const type = (id, v) => { const el = d.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); } };
  const setS = o => {
    w.localStorage.setItem('trade_settings_v1', JSON.stringify(Object.assign({ accountBalance: 10000 }, o)));
    if (typeof w._clearSettingsCache === 'function') w._clearSettingsCache();
  };
  const setLogs = rows => w.eval('logs = ' + JSON.stringify(rows));
  const ymd = (() => { const x = new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); })();
  const fa = d.getElementById('formAtrStopEnabled'); if (fa) fa.checked = false;

  // ---- --inject：把守卫退回旧实现，断言必须变红 ----
  if (INJECT) {
    const origLoad = w.loadSettings;
    w.loadSettings = function () { return JSON.parse(w.localStorage.getItem('trade_settings_v1') || '{}'); };
    w.calcKelly = function (wr, aw, al, cap) {
      const p = Math.min((wr * aw - (1 - wr) * al) / aw, 0.05);
      return { kellyPct: p, halfKellyPct: p, kellyRiskAmount: cap * p, halfKellyRiskAmount: cap * p,
        expectancy: 1, recommendation: '', kellyCapped: false, halfKellyCapped: false };
    };
    w.getHeatWarnMax = () => 8;
    w.getHeatHardMax = () => 999;
    w.getSymbolConcentrationMaxPct = () => 999;
    w.checkDailyLossLimit = () => ({ limit: 99900, overLimit: false, blocked: false, readFailed: false, capitalKnown: true });
    w._getTodayLossStreak = () => ({ streak: 1, totalLossCount: 1 });
    w.utils.safeParseNum = function (v) { const n = parseFloat(v); return isNaN(n) ? null : n; };
    w.computeWinLoss = function (arr) { let gp = 0, gl = 0; const wi = [], lo = [];
      for (const l of arr) { const v = parseFloat(l.pnlAmount); if (isNaN(v)) continue; if (v > 0) { wi.push(l); gp += v; } else if (v < 0) { lo.push(l); gl += Math.abs(v); } }
      return { wins: wi, losses: lo, grossProfit: gp, grossLoss: gl }; };
    w._getDefaultFeeRate = () => 0.08;
    w._normalizeCsvCloseType = v => v;
    w._safeISOString = function (v) { return new Date(v).toISOString(); };  // 旧实现：非法值抛 RangeError
    // 旧缩减规则：只缩 positionSize / fee，漏掉 slippageCost
    w.applyPartialShrink = function (rec, ratio) {
      var keep = 1 - ratio / 100;
      rec.positionSize = parseFloat((rec.positionSize * keep).toFixed(2));
      rec.fee = parseFloat((rec.fee * keep).toFixed(8));
      return rec;
    };
    console.log('[注入自检] 已把 13 处守卫退回旧实现\n');
  }

  // ==================== A. 半凯利必须是完整凯利的一半 ====================
  console.log('[A] 半凯利钳制顺序');
  setS({ kellyRiskLimitPct: 5 });
  const kA = w.calcKelly(0.8, 200, 20, 10000, true, 1, 0);
  ck('A1 kellyPct 钳到 5%', !!kA && Math.abs(kA.kellyPct - 0.05) < 1e-12, JSON.stringify(kA));
  ck('A2 halfKellyPct = kellyPct / 2', !!kA && Math.abs(kA.halfKellyPct - 0.025) < 1e-12, JSON.stringify(kA));
  ck('A3 半凯利 / 完整凯利比值恒为 0.5', !!kA && Math.abs(kA.halfKellyPct / kA.kellyPct - 0.5) < 1e-12);
  ck('A4 半凯利风险额 250（原 500，风险预算翻倍）', !!kA && Math.abs(kA.halfKellyRiskAmount - 250) < 1e-9, kA && kA.halfKellyRiskAmount);
  const kA2 = w.calcKelly(0.4, 20, 10, 10000, true, 1, 0);
  ck('A5 未触顶时半凯利仍为一半', !!kA2 && Math.abs(kA2.halfKellyPct / kA2.kellyPct - 0.5) < 1e-12);

  // ==================== B. 阈值读侧越界必须 fail-closed ====================
  console.log('[B] 阈值读侧净化');
  setS({ dailyLossLimit: 999, singleSymbolMaxPct: 999, riskHeatMax: 999, dailyTradeMax: 9999, maxDrawdownAlert: 999 });
  setLogs([]);
  ck('B1 日亏上限回退默认 5% → 500 U', Math.abs(w.checkDailyLossLimit(10000).limit - 500) < 1e-9, w.checkDailyLossLimit(10000).limit);
  ck('B2 集中度上限回退 30%', Math.abs(w.getSymbolConcentrationMaxPct() - 30) < 1e-9, w.getSymbolConcentrationMaxPct());
  ck('B3 热量硬上限回退 6%', Math.abs(w.getHeatHardMax() - 6) < 1e-9, w.getHeatHardMax());
  ck('B4 日交易笔数上限回退 8', Math.abs(w.checkDailyTradeFrequency().maxCount - 8) < 1e-9, w.checkDailyTradeFrequency().maxCount);
  setS({ dailyLossLimit: -3, singleSymbolMaxPct: 'abc', riskHeatMax: 0 });
  ck('B5 负数/字符串/0 一律回退默认', Math.abs(w.getSymbolConcentrationMaxPct() - 30) < 1e-9 && Math.abs(w.getHeatHardMax() - 6) < 1e-9);
  setS({ dailyLossLimit: 10, singleSymbolMaxPct: 40, riskHeatMax: 12, dailyTradeMax: 20 });
  ck('B6 区间内合法设置必须原样生效', Math.abs(w.checkDailyLossLimit(10000).limit - 1000) < 1e-9 && w.getSymbolConcentrationMaxPct() === 40 && w.getHeatHardMax() === 12);

  // ==================== C. heatWarnMax 可配置 + 默认可达 ====================
  console.log('[C] 组合热量警告线');
  setS({ portfolioHeatMax: 15 });
  ck('C1 用户设 15 → getHeatWarnMax() = 15（原恒为 8）', w.getHeatWarnMax() === 15, w.getHeatWarnMax());
  setS({});
  ck('C2 默认警告线 < 默认硬上限（warn 档可达）', w.getHeatWarnMax() < w.getHeatHardMax(), w.getHeatWarnMax() + ' vs ' + w.getHeatHardMax());
  ck('C3 警告线读的是 portfolioHeatMax 唯一来源', /getHeatWarnMax[\s\S]{0,300}portfolioHeatMax/.test(S.skills));

  // ==================== D. CSV 往返：机器值 / 中文反查 / 补列 ====================
  console.log('[D] CSV 往返数据完整性');
  setS({});
  const rowD = { id: 'L1', symbol: 'BTC', direction: 'long', entryPrice: 100, positionSize: 1000,
    leverage: 1, riskAmount: 100, capital: 10000, closeType: 'partialTP', closePrice: 110,
    pnlAmount: 45, closedRatio: 50, closes: [{ type: 'partialTP', ratio: 50, pnl: 45 }],
    realizedPnl: 45, initialPositionSize: 1000, initialRiskAmount: 100,
    time: '2026-01-01T00:00:00Z', closeTime: '2026-01-02T00:00:00Z' };
  setLogs([rowD]);
  let capD = '';
  w.Blob = function (parts, opts) { capD = String(parts[0]); return new OrigBlob(parts, opts); };
  w.URL.createObjectURL = () => 'blob:fake';
  w.showToast = () => {};
  try { w.exportCSV(); } catch (e) { /* 断言会捕获 */ }
  let recD = [], hiD = -1, ctD = '';
  try { recD = w.parseCSVRecords(capD.replace(/^\uFEFF/, '')); hiD = recD[0].indexOf('平仓类型'); ctD = recD[1][hiD]; } catch (e) {}
  ck('D1 导出「平仓类型」写机器键 partialTP（不可逆丢键）', ctD === 'partialTP', ctD);
  ck('D2 机器键保持中间态语义 isClosedTrade=false', w.utils.isClosedTrade(Object.assign({}, rowD, { closeType: ctD })) === false);
  ck('D3 历史中文标签导入可反查回机器键', typeof w._normalizeCsvCloseType === 'function' && w._normalizeCsvCloseType('部分止盈') === 'partialTP');
  ck('D4 未知 closeType 被显式标记且不静默伪装成合法键',
    typeof w._isKnownCloseType === 'function' && w._isKnownCloseType('__bogus__') === false &&
    w._normalizeCsvCloseType('__bogus__') === '__bogus__');
  const hdrD = recD[0] || [];
  ck('D5 导出补齐 splitEntries / weightedEntryModel / 初始保证金 / 三段 RR 列',
    ['分批明细', '加权均价模型', '初始保证金', '毛利盈利', '净盈利', '净亏损'].every(h => hdrD.indexOf(h) !== -1),
    hdrD.slice(-10).join('|'));

  // ==================== E. 非法 closeTime 不得毁掉整批导出 ====================
  console.log('[E] 导出容错');
  setLogs([
    { id: 'bad', symbol: 'BTC', direction: 'long', entryPrice: 100, closeType: 'initialTP', closePrice: 110, pnlAmount: 10, time: '2026-01-01T00:00:00Z', closeTime: 'not-a-date' },
    { id: 'good', symbol: 'ETH', direction: 'long', entryPrice: 10, closeType: 'initialTP', closePrice: 11, pnlAmount: 1, time: '2026-01-01T00:00:00Z', closeTime: '2026-01-02T00:00:00Z' }
  ]);
  let capE = '';
  w.Blob = function (parts, opts) { capE = String(parts[0]); return new OrigBlob(parts, opts); };
  try { w.exportCSV(); } catch (e) {}
  ck('E1 一条非法时间仍导出 2 行数据（原 0 行）', capE ? capE.trim().split('\n').length - 1 === 2 : false, capE ? capE.trim().split('\n').length - 1 : 0);
  ck('E2 _safeISOString 对非法输入不抛异常', (function () {
    try { return typeof w._safeISOString === 'function' && w._safeISOString('not-a-date') === ''; }
    catch (e) { return false; }
  })());

  // ==================== F. 当日连亏按真实时刻排序 ====================
  console.log('[F] 连亏排序');
  setS({});
  setLogs([
    { closeType: 'manualLoss', pnlAmount: -10, closeTime: ymd + 'T18:00:00+08:00', time: ymd + 'T10:00:00Z' },
    { closeType: 'manualWin', pnlAmount: 50, closeTime: ymd + 'T11:00:00.000Z', time: ymd + 'T11:00:00Z' }
  ]);
  ck('F1 真实序末尾是盈利 → streak = 0（字典序误判 1）', w._getTodayLossStreak().streak === 0, w._getTodayLossStreak().streak);
  ck('F2 排序依据为时间戳而非 localeCompare', /_closedTimeMs|getTime\(\)/.test(S.stats) && !/closeTime \|\| ''\)\.localeCompare/.test(S.stats));

  // ==================== G. 部分平仓 legacy 滑点按剩余比例缩减 ====================
  console.log('[G] 部分平仓簿记');
  ck('G1 缩减纯函数含 slippageCost（与 fee 同口径）',
    /function applyPartialShrink[\s\S]{0,1400}record\.slippageCost\s*=/.test(S.logs));
  (function () {
    const base = { direction: 'long', entryPrice: 100, positionSize: 1000, leverage: 1, riskAmount: 100, slippageCost: 10, closePrice: 110 };
    const whole = w.calculateCloseSettlement(base, 110);
    const item = Object.assign({}, base);
    const leg = ratio => {
      const s = w.calculateCloseSettlement(item, 110);
      const net = (s.grossPnl - s.legacySlippageCost) * (ratio / 100) - s.fee * (ratio / 100);
      w.applyPartialShrink(item, ratio);   // 真代码（注入模式下被 patch 回旧规则）
      return net;
    };
    const sum = leg(50) + leg(50) + w.calculateCloseSettlement(item, 110).netPnl;
    ck('G2 三腿累计净盈亏 === 整笔一次性结算', Math.abs(sum - whole.netPnl) < 1e-9, sum + ' vs ' + whole.netPnl);
  })();

  // ==================== H. 分批展示占比与落库归一化同源 ====================
  console.log('[H] 分批展示归一化');
  (function () {
    setS({ accountBalance: 100000 });
    w.eval('logs.length = 0');
    type('symbol', 'BTC'); type('entryPrice', '100'); type('capital', '100000');
    type('stopLoss', '99'); type('leverage', '1'); type('direction', 'long'); type('targetPrice', '120');
    const ms = d.getElementById('mindsetScore'); if (ms) ms.value = '5';
    w.eval('_splitMode = true; _splitBatches = [{price:"100",alloc:"70",stopLoss:"99"},{price:"200",alloc:"70",stopLoss:"199"}];');
    const cb = d.getElementById('splitMode'); if (cb) cb.checked = true;
    try { w.calculate(); } catch (e) {}
    const tbl = d.getElementById('splitTable');
    const cells = tbl ? Array.from(tbl.querySelectorAll('tbody tr')).map(tr => tr.cells[2] && tr.cells[2].textContent) : [];
    ck('H1 70/70 两批各显示 50%（原各 70%，合计 140%）',
      cells.length === 2 && cells.every(c => /50(\.0)?%/.test(c || '')), JSON.stringify(cells));
    const ent = w.getSplitEntries && w.getSplitEntries();
    ck('H2 展示占比合计与落库占比合计一致（100%）',
      !!ent && Math.abs(ent.entries.reduce((s, e) => s + e.alloc, 0) - 100) < 0.2,
      ent && ent.entries.map(e => e.alloc).join('+'));
    ck('H3 归一化实现抽成共用纯函数（展示/触发行/落库同源）', /computeNormalizedSplitAlloc/.test(S.calc));
  })();

  // ==================== I. RR 两腿入场成交价必须唯一 ====================
  console.log('[I] RR 双入场价');
  ck('I1 目标腿入场 ticks 复用止损腿入场 ticks', /entryTicks:\s*stopEntryTicks/.test(S.calc));
  (function () {
    const c = { direction: 'long', expectedEntryPrice: 50000, expectedExitPrice: 49000, tickSize: 0.1, quantity: 0.2 };
    const a = w.Slippage.calculate(Object.assign({}, c, { entryTicks: 1, exitTicks: 1 }));
    const b = w.Slippage.calculate(Object.assign({}, c, { entryTicks: 1, exitTicks: 2 }));
    ck('I2 同一入场 ticks 下退出 ticks 不同不改变入场成交价',
      Math.abs(a.effectiveEntryPrice - b.effectiveEntryPrice) < 1e-12);
  })();

  // ==================== J. 限价单费率联动 ====================
  console.log('[J] 费率联动');
  setS({ feeRateLimit: 0.04, feeRateMarket: 0.08 });
  (function () {
    const ot = d.getElementById('orderType'), fr = d.getElementById('feeRate');
    if (ot) { ot.value = 'limit'; ot.dispatchEvent(new w.Event('change', { bubbles: true })); }
    ck('J1 切到限价单 feeRate 联动为 0.04（原仍 0.08）', fr && Math.abs(Number(fr.value) - 0.04) < 1e-9, fr && fr.value);
    ck('J2 _getDefaultFeeRate(limit) 与设置同源', Math.abs(w._getDefaultFeeRate('limit') - 0.04) < 1e-9);
  })();

  // ==================== K. Infinity 漏网（防御纵深） ====================
  console.log('[K] 非有限数守卫');
  ck('K1 utils.safeParseNum("Infinity") === null', w.utils.safeParseNum('Infinity') === null, String(w.utils.safeParseNum('Infinity')));
  ck('K2 safeParseNum("12.5abc") 保留前缀解析', w.utils.safeParseNum('12.5abc') === 12.5);
  ck('K3 computeWinLoss 不再把 Infinity 计入 grossProfit',
    Number.isFinite(w.computeWinLoss([{ pnlAmount: 'Infinity' }, { pnlAmount: 10 }, { pnlAmount: -5 }]).grossProfit),
    String(w.computeWinLoss([{ pnlAmount: 'Infinity' }, { pnlAmount: 10 }]).grossProfit));

  // ==================== L. 年化收益改 CAGR（基于本金、复利） ====================
  console.log('[L] 年化收益口径');
  setS({ accountBalance: 10000 });
  setLogs([
    { closeType: 'manualWin', pnlAmount: 40, capital: 10000, closeTime: ymd + 'T01:00:00.000Z', time: ymd + 'T00:00:00Z' },
    { closeType: 'manualWin', pnlAmount: 30, capital: 10000, closeTime: ymd + 'T06:00:00.000Z', time: ymd + 'T00:00:00Z' },
    { closeType: 'manualWin', pnlAmount: 30, capital: 10000, closeTime: ymd + 'T10:00:00.000Z', time: ymd + 'T00:00:00Z' }
  ]);
  try {
    w.updateStats();
    const el = d.getElementById('statAnnReturn');
    ck('L1 年化收益以百分比显示（原金额线性外推 +36500 U/年）', !!el && /%/.test(el.textContent) && !/U\/年/.test(el.textContent), el && el.textContent);
    ck('L2 title 明示 CAGR / 期初权益 / 期末权益', !!el && /CAGR/.test(el.title) && /权益/.test(el.title), el && el.title);
  } catch (e) { ck('L1/L2 updateStats 可执行', false, e.message); }
  ck('L3 源码用 Math.pow 复利而非 totalPnl × 365/span', /Math\.pow\([^)]*365/.test(S.stats) && !/totalPnl \* \(365/.test(S.stats));

  // ==================== M. 批次 B：闸门/指标口径 ====================
  console.log('[M] 闸门与指标口径');
  ck('M1 组合热量预检降级为软标记（唯一硬阻断在截断后复核点）',
    /_heatPrecheckSoft/.test(S.calc) && !/if \(heatCheck\.blocked\)[\s\S]{0,300}renderHardBlock/.test(S.calc));
  ck('M2 凯利小样本收缩（真计算：5 笔 → 系数 0.2）',
    (function () { const k = w.calcKelly(0.8, 200, 20, 10000, true, 1, 0, 5);
      return !!k && Math.abs(k.shrinkFactor - 0.2) < 1e-12 && k.samples === 5; })());
  ck('M2b 样本 ≥30 不收缩', (function () { const k = w.calcKelly(0.8, 200, 20, 10000, true, 1, 0, 30);
    return !!k && k.shrinkFactor === 1; })());
  ck('M3 夏普筛选态期初权益有明确处理（不再无条件用全局本金）',
    /_sharpeEquity/.test(S.stats) && /hasAnyFilter/.test(S.stats));
  ck('M4 loadSettings 内部调用 _sanitizeLoadedSettings（唯一入口）',
    /SETTINGS_CACHE = _sanitizeLoadedSettings\(merged\)/.test(S.settings));
  ck('M5 CSV 数值列用 toFiniteNum 归一（Infinity 不入库）',
    /toFiniteNum\(_numSrc\)|Number\.isFinite\(parsed\)/.test(S.settings));

  // ==================== N. 源码级防回退护栏 ====================
  console.log('[N] 源码护栏');
  ck('N1 渲染层不再写死 2/3 批字面量（5 批可达）',
    !/_splitBatches\.length < 3|_splitBatches\.length > 2|initSplitBatches\(2\)/.test(S.calc));
  ck('N2 stats.js 已无 parseFloat(pnlAmount) 裸解析', !/parseFloat\(l\.pnlAmount\)/.test(S.stats));
  ck('N3 io.js 时间转换走 _safeISOString', /_safeISOString/.test(S.io));
  ck('N4 导出平仓类型不再直接 CLOSE_TYPE_LABELS 化', !/CLOSE_TYPE_LABELS\[row\.closeType\]/.test(S.io));
  ck('N5 settings.js 导入有 closeType 值域归一', /_normalizeCsvCloseType/.test(S.settings));
  ck('N6 部分平仓累计比例封顶 100', /Math\.min\(100,\s*parseFloat\(logs\[idx\]\.closedRatio\)/.test(S.logs));

  // ==================== O. 展示层 / 曲线 / 导入防线 ====================
  console.log('[O] 展示层与曲线口径');
  const visualsSrc = src('calc-visuals.js');
  ck('O1 RR 色阶读 settings.minRRRatio（不再写死 3/2）',
    /rrMeets\(rr, _minRR\)/.test(visualsSrc) && !/rrMeets\(rr, 3\)/.test(visualsSrc));
  // 真链路：把 minRRRatio 调到 3，同一个 2.5R 必须从 green 变 amber，
  // 否则「迁移旧断言期望值」就等于把断言改成恒真，证不了色阶真的跟随设置。
  ck('O1b 色阶真跟随设置：minRRRatio=3 时 2.8R 判 amber', (function () {
    try {
      setS({ minRRRatio: 3 });
      var V = w.CalcVisuals;
      var m = V && V.layoutRR ? V.layoutRR({ entryPrice: 50000, stopPrice: 49000,
        targetPrice: 52000, grossProfit: 280, netProfit: 280, netLoss: 100, targetRR: 2.8 }) : null;
      return !!m && m.tier === 'amber';
    } catch (e) { return false; }
  })());
  ck('O1c 同一 2.8R 在 minRRRatio=2 时判 green', (function () {
    try {
      setS({ minRRRatio: 2 });
      var V = w.CalcVisuals;
      var m = V && V.layoutRR ? V.layoutRR({ entryPrice: 50000, stopPrice: 49000,
        targetPrice: 52000, grossProfit: 280, netProfit: 280, netLoss: 100, targetRR: 2.8 }) : null;
      return !!m && m.tier === 'green';
    } catch (e) { return false; }
  })());
  ck('O2 权益曲线对非法日期显式兜底（不再让 NaN 参与排序）',
    /_curveTimeMs/.test(S.utils));
  ck('O3 导入设置逐字段过 _validateImportedField',
    /_validateImportedField\(k, val\)/.test(S.settings));
  ck('O4 导出列数与行数据列数一致（补列后不错位）', (function () {
    try {
      const head = recD[0] || [], line = recD[1] || [];
      return head.length > 0 && head.length === line.length;
    } catch (e) { return false; }
  })(), 'header=' + (recD[0] || []).length + ' line=' + (recD[1] || []).length);

  console.log('\n============================================');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败' + (INJECT ? '  [注入自检模式，期望出现失败]' : ''));
  console.log('============================================');
  require('./_gate').emit(pass, fail);
  if (INJECT) require('./_gate').emitInject(fail > 0 ? 1 : 0, 1);
  process.exit(INJECT ? (fail > 0 ? 0 : 1) : (fail === 0 ? 0 : 1));
})().catch(e => { fs.writeSync(2, '跑测器崩溃: ' + (e && e.stack || e) + '\n'); process.exit(1); });
