'use strict';

// ==================== 批次 2 / 3 数据准确度回归（v5.6.47 · 常驻脚本） ====================
//
// 立项原因：v5.6.46 深度审计的 2 个 P0 + 15 个 P1 全都没有断言守护（AUDIT.md 第 1/2 节）。
//   审计探针只在 /tmp 里活过一次，不能作为门禁。本脚本把结论固化成常驻断言：
//     A 计算链  P0-4 有效入场价双来源 / P1-07 MAE 基准 / P1-16 脏费率 / P1-17 边界
//     B 统计链  P0-5 权益曲线 capital / P1-01 本周上界 / P1-02 闸门分叉 /
//               P1-03 本金口径 / P1-04 图表样本 / P1-06 成本侵蚀
//     C 日志链  P1-05 末腿均价 / P1-08 落库精度
//     D 导入导出 P1-09~13 告警 / 枚举 / signals / strategyPattern / 欧式小数
//     E 路由    P1-15 脏检查取消后 URL 漂移
//     F 结构文档 兜底递推收敛 / D-07 历史口径 / D-06 离线口径
//
// 纪律：--inject 逐条独立把「修复后的源码」在内存里改回旧实现，每次单独 boot 一个
//   干净 JSDOM，对应断言组必须各自变红；注入只改内存副本，绝不碰磁盘文件。
//
// 用法：node test/verify_batch2.js            正常跑（全绿才算整改完成）
//       node test/verify_batch2.js --inject   注入错误，必须 N/N 全被捕获

process.env.TZ = 'Asia/Shanghai';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const gate = require('./_gate');

const ROOT = path.join(__dirname, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const INJECT = process.argv.includes('--inject');

// 只有这些文件会走内存副本；其余脚本 / CSS / 图标照常从磁盘加载。
const MUTABLE = [
  'calculator.js', 'utils.js', 'settings.js', 'io.js', 'logs.js', 'modals.js',
  'stats.js', 'dashboard.js', 'analytics.js', 'risk.js', 'skills-integration.js',
  'navigation.js', 'constants.js', 'slippage.js'
];
const DOCS = ['README.md', 'CLAUDE.md'];

function readInputs(mutators) {
  const D = { html: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') };
  for (const f of MUTABLE) D[f] = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  for (const f of DOCS) D[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of (mutators || [])) {
    if (D[m.file] == null) throw new Error('注入目标文件不存在: ' + m.file);
    if (D[m.file].indexOf(m.from) === -1) throw new Error('注入锚点未命中: ' + m.key + ' @ ' + m.file);
    D[m.file] = D[m.file].replace(m.from, m.to);
  }
  return D;
}

function makeLoader(D) {
  class L extends ResourceLoader {
    fetch(url, opts) {
      const u = String(url);
      if (u.indexOf('file://') !== 0) return Promise.reject(new Error('blocked: ' + u));
      const name = u.split('?')[0].split('/').pop();
      if (Object.prototype.hasOwnProperty.call(D, name)) {
        return Promise.resolve(Buffer.from(D[name], 'utf8'));
      }
      return super.fetch(url, opts);
    }
  }
  return new L();
}
function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
}

function boot(D) {
  return new Promise((resolve, reject) => {
    const vc = new VirtualConsole();
    vc.on('jsdomError', () => {});
    vc.on('error', () => {});
    let markReady, dom;
    const ready = new Promise(r => { markReady = r; });
    const timer = setTimeout(() => {
      try { if (dom) dom.window.close(); } catch (e) { /* ignore */ }
      reject(new Error('boot timeout'));
    }, 10000);
    try {
      dom = new JSDOM(D.html, {
        url: INDEX_URL, runScripts: 'dangerously', resources: makeLoader(D),
        pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
          Object.defineProperty(w, 'localStorage', { value: makeStorage() });
          w.Element.prototype.scrollIntoView = function () {};
          // 捕获 exportCSV 生成的 CSV 文本（jsdom 不实现 createObjectURL / 下载）
          const OrigBlob = w.Blob;
          w.Blob = function (parts, opts) {
            try { w.__csv = (parts || []).join(''); } catch (e) { /* ignore */ }
            return new OrigBlob(parts, opts);
          };
          try { w.URL.createObjectURL = () => 'blob:mock'; } catch (e) { /* ignore */ }
          w.addEventListener('DOMContentLoaded', () => setTimeout(() => markReady(w), 0));
        }
      });
    } catch (e) { clearTimeout(timer); reject(e); return; }
    ready.then(w => { clearTimeout(timer); resolve(w); }, reject);
  });
}

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F'];

// 返回每个断言组的明细；注入模式下由调用方检查目标组是否至少一条变红。
function runChecks(w, D) {
  const G = {};
  for (const g of GROUPS) G[g] = [];
  const ck = (g, name, cond, detail) => G[g].push({ name, ok: !!cond, detail: detail || '' });
  // 单条断言抛异常也只算该条失败，不让整组崩掉
  const safe = (g, name, fn) => {
    try { const r = fn(); ck(g, name, r && r.ok !== undefined ? r.ok : r, r && r.detail ? r.detail : ''); }
    catch (e) { ck(g, name, false, 'EX: ' + (e && e.message)); }
  };
  const src = f => D[f] || '';
  const has = (f, re) => re.test(src(f));
  const count = (f, re) => (src(f).match(re) || []).length;

  // ---------------- A · 计算链 ----------------
  const fillBase = () => {
    const d = w.document;
    const set = (id, v) => { const el = d.getElementById(id); if (el) el.value = v; };
    set('capital', '10000'); set('symbol', 'BTC'); set('direction', 'long');
    set('entryPrice', '50000'); set('stopLoss', '49000'); set('targetPrice', '52000');
    set('riskInput', '2%'); set('orderType', 'market'); set('stopType', 'stop-market');
    set('reasonSelect', '趋势突破');
  };
  let calc = null;
  safe('A', 'A0 真链路 calculate() 成功产出计划', () => {
    fillBase();
    w.calculate();
    calc = w.getCalc();
    return { ok: !!(calc && calc.positionSize > 0), detail: 'positionSize=' + (calc && calc.positionSize) };
  });
  safe('A', 'A1 顶层有效入场价与三份滑点快照完全一致（P0-4）', () => {
    const s = calc && calc.slippage;
    if (!s) return { ok: false, detail: '无滑点快照' };
    const vals = [calc.effectiveEntryPrice, s.planning && s.planning.effectiveEntryPrice,
      s.atStop && s.atStop.effectiveEntryPrice, s.atTarget && s.atTarget.effectiveEntryPrice];
    const ok = vals.every(v => Number.isFinite(Number(v)) && Math.abs(Number(v) - Number(vals[0])) < 1e-9);
    return { ok, detail: '四价=' + JSON.stringify(vals) };
  });
  safe('A', 'A2 三份快照入场 ticks 一律取 orderType 默认值（P0-4）', () => {
    const s = calc && calc.slippage;
    const def = (w.Slippage && w.Slippage.getDefaultTicks) ? w.Slippage.getDefaultTicks('market').entry : 1;
    if (!s) return { ok: false, detail: '无滑点快照' };
    const ticks = [s.planning && s.planning.entryTicks, s.atStop && s.atStop.entryTicks,
      s.atTarget && s.atTarget.entryTicks];
    return { ok: ticks.every(t => Number(t) === def), detail: 'ticks=' + JSON.stringify(ticks) + ' 期望=' + def };
  });
  safe('A', 'A3 退出腿 ticks 仍按各腿执行类型区分（不得连坐放宽）', () => {
    const s = calc && calc.slippage;
    if (!s) return { ok: false, detail: '无滑点快照' };
    const ok = Number(s.atStop.exitTicks) === 2 && Number(s.atTarget.exitTicks) === 1;
    return { ok, detail: 'atStop.exit=' + s.atStop.exitTicks + ' atTarget.exit=' + s.atTarget.exitTicks };
  });
  safe('A', 'A4 L1 滑点文案读实际生效 ticks，不再写死入场默认值（P1-17）', () => {
    const el = w.document.getElementById('costLine1');
    const t = el ? el.textContent : '';
    return { ok: !/1\+1\s*ticks/.test(t) && /入场/.test(t) && /退出/.test(t), detail: t.slice(0, 160) };
  });
  safe('A', 'A5 MAE/MFE 基准与 PnL 取价同源（P1-07）', () => {
    const item = { direction: 'long', entryPrice: 100, effectiveEntryPrice: 100,
      slippage: { planning: { effectiveEntryPrice: 101 } }, lowPrice: 90, highPrice: 110 };
    w.storeMAEMFE(item);
    const expected = (90 - 101) / 101 * 100;
    return { ok: Math.abs(item.mae - expected) < 1e-9, detail: 'mae=' + item.mae + ' 期望=' + expected };
  });
  safe('A', 'A6 calcRoundTripFee 脏费率 / Infinity / 负值一律安全（P1-16）', () => {
    const a = w.calcRoundTripFee(1, 100, 100, 'abc');
    const b = w.calcRoundTripFee(1, 100, 100, Infinity);
    const c = w.calcRoundTripFee(1, 100, 100, -1);
    const ok = Number.isFinite(a) && a >= 0 && Number.isFinite(b) && b >= 0 && Number.isFinite(c) && c >= 0;
    return { ok, detail: 'abc=' + a + ' Inf=' + b + ' neg=' + c };
  });
  ck('A', 'A7 calcRoundTripFee 走全局 toFiniteNum 而非 Number()||0（P1-16）',
    has('calculator.js', /function calcRoundTripFee[\s\S]{0,260}toFiniteNum/));
  safe('A', 'A8 manual 滑点输入框默认留空，避免零滑点假设（P1-17）', () => {
    const a = w.document.getElementById('entrySlippageTicks');
    const b = w.document.getElementById('exitSlippageTicks');
    return { ok: !!a && !!b && a.value === '' && b.value === '', detail: 'entry=' + (a && a.value) + ' exit=' + (b && b.value) };
  });
  ck('A', 'A9 负 targetRR 不得落库（P1-17）',
    has('calculator.js', /netLoss\s*>\s*0\s*&&\s*rrAmounts\.netProfit\s*>\s*0/));
  ck('A', 'A10 本金读取走 toFiniteNum 且二次校验 Number.isFinite（P1-17）',
    has('calculator.js', /toFiniteNum\(capitalEl\.value/) && has('calculator.js', /Number\.isFinite\(capital\)/));
  safe('A', 'A11 capital=1e999 不得产生 NaN/Infinity 计划（P1-17）', () => {
    fillBase();
    w.document.getElementById('capital').value = '1e999';
    w.calculate();
    const c = w.getCalc();
    const vals = c ? [c.positionSize, c.riskAmount, c.maxLoss, c.effectiveEntryPrice] : [];
    return { ok: vals.every(v => v == null || Number.isFinite(Number(v))), detail: JSON.stringify(vals) };
  });

  // ---------------- B · 统计链 ----------------
  const tradesNoCap = [
    { time: '2026-11-01T02:00:00.000Z', closeTime: '2026-11-01T03:00:00.000Z', pnlAmount: 100 },
    { time: '2026-11-02T02:00:00.000Z', closeTime: '2026-11-02T03:00:00.000Z', pnlAmount: 50 },
    { time: '2026-11-03T02:00:00.000Z', closeTime: '2026-11-03T03:00:00.000Z', pnlAmount: 100 }
  ];
  safe('B', 'B1 有日志但全缺 capital → fail-closed，不重复计入（P0-5）', () => {
    const r = w.utils.calcEquityCurve(tradesNoCap, { accountBalance: 10250 });
    return { ok: r.capitalKnown === false && r.data.length === 0 && r.finalEq !== 10500 && r.reason === 'capital-missing',
      detail: 'capitalKnown=' + r.capitalKnown + ' finalEq=' + r.finalEq + ' data=' + r.data.length + ' reason=' + r.reason };
  });
  safe('B', 'B2 最早一条缺 capital 但后续有时，用最早有效快照（P0-5）', () => {
    const t = tradesNoCap.map(x => Object.assign({}, x));
    t[1].capital = 10000;
    const r = w.utils.calcEquityCurve(t, { accountBalance: 10250 });
    return { ok: r.capitalKnown === true && r.initCap === 10000 && Number.isFinite(r.finalEq),
      detail: 'initCap=' + r.initCap + ' capitalKnown=' + r.capitalKnown };
  });
  safe('B', 'B3 全部带 capital 的正常路径不受影响（P0-5 回归）', () => {
    const t = tradesNoCap.map(x => Object.assign({ capital: 10000 }, x));
    const r = w.utils.calcEquityCurve(t, { accountBalance: 10250 });
    return { ok: r.capitalKnown === true && r.initCap === 10000 && r.finalEq === 10250,
      detail: 'initCap=' + r.initCap + ' finalEq=' + r.finalEq };
  });
  safe('B', 'B4 缺 capital 时硬闸门 getCurrentDrawdown().readFailed=true（P0-5）', () => {
    // getClosedSorted() 会先按 isClosedTrade 过滤，探针必须给足 closeType/pnlAmount，
    // 否则取数为空会走「新用户无交易」的正常分支，readFailed 自然为 false。
    const closedLogs = tradesNoCap.map((x, i) => Object.assign({}, x, {
      id: 'nc' + i, closeType: 'manualWin', direction: 'long',
      entryPrice: 100, closePrice: 110, positionSize: 1000, capital: null
    }));
    w.eval('logs = ' + JSON.stringify(closedLogs) + ';');
    const r = w.getCurrentDrawdown();
    return { ok: !!(r && r.readFailed === true), detail: JSON.stringify(r) };
  });
  safe('B', 'B5 getWeekRange / isInThisWeek 纯函数可用且未来日期被排除（P1-01）', () => {
    const now = new w.Date(2026, 10, 10, 12, 0, 0);
    const r = w.utils.getWeekRange(now);
    const ok = r && Number.isFinite(r.startMs) && Number.isFinite(r.endMs) &&
      w.utils.isInThisWeek(new w.Date(2026, 10, 9, 20, 0, 0).toISOString(), now) === true &&
      w.utils.isInThisWeek('2099-01-01T00:00:00.000Z', now) === false;
    return { ok, detail: JSON.stringify(r) };
  });
  ck('B', 'B6 仪表盘本周胜率改用统一周区间（P1-01）',
    has('dashboard.js', /isInThisWeek|getWeekRange/));
  ck('B', 'B7 日志筛选 thisWeek 有上界（P1-01）',
    has('logs.js', /getWeekRange|weekEnd/));
  ck('B', 'B8 今日盈亏收敛为单一函数且四处调用（P1-02 / 批次 3）',
    has('utils.js', /util\.computeTodayPnl\s*=/) &&
      ['dashboard.js', 'risk.js', 'skills-integration.js'].every(f => has(f, /computeTodayPnl/)) &&
      count('risk.js', /computeTodayPnl/g) >= 2);
  ck('B', 'B9 硬闸门与风控中心显示共用全量样本（P1-02）',
    has('risk.js', /renderDailyLoss\(getClosedSorted\(\)\)/) &&
      has('skills-integration.js', /getClosedSorted\(\)/));
  ck('B', 'B10 CAGR 与夏普共用同一本金决议（P1-03）',
    has('utils.js', /util\.resolveStartEquity\s*=/) &&
      has('stats.js', /resolveStartEquity\(/) &&
      has('stats.js', /_sharpeEquity/) && has('stats.js', /hasAnyFilter/) &&
      count('stats.js', /resolveStartEquity\(/g) >= 2);
  ck('B', 'B11 筛选样本单一入口 getDisplayClosed 三处共用（P1-04）',
    has('utils.js', /util\.getDisplayClosed\s*=/) &&
      ['analytics.js', 'stats.js', 'risk.js'].every(f => has(f, /getDisplayClosed/)));
  safe('B', 'B12 成本侵蚀分母计入 legacy slippageCost（P1-06）', () => {
    w.eval('logs = [];');
    const rows = [
      { id: 'x1', time: '2026-11-01T02:00:00.000Z', closeTime: '2026-11-01T03:00:00.000Z',
        closeType: 'manualWin', direction: 'long', entryPrice: 100, effectiveEntryPrice: 100,
        closePrice: 110, positionSize: 1000, pnlAmount: 88.2, fee: 1.8,
        slippageCost: 10, grossPnlAmount: 100, realizedPnl: 88.2, realizedFee: 1.8 }
    ];
    w.eval('logs = ' + JSON.stringify(rows) + ';');
    w.updateStats();
    const el = w.document.getElementById('statCostDrag');
    const txt = el ? el.textContent : '';
    // 分母 = |88.2 + 1.8 + 10| = 100 → 1.8%；漏 slippageCost 时 90 → 2.0%
    return { ok: /1\.8%/.test(txt), detail: 'statCostDrag=' + txt };
  });
  ck('B', 'B13 分析页权益图起点改读曲线自身，不再自行重算（批次 3）',
    has('analytics.js', /_curve\.initCap|curve\.initCap/));
  ck('B', 'B14 两份兜底权益递推已删除，fail-closed 不留后门（批次 3）',
    !has('risk.js', /equity\s*\+=\s*_adj/) && !has('skills-integration.js', /equity\s*\+=\s*adj/));

  // ---------------- C · 日志落库 ----------------
  safe('C', 'C1 加权平仓均价纯函数：105/130 各 50% → 117.5（P1-05）', () => {
    const f = w.utils.computeWeightedClosePrice;
    if (typeof f !== 'function') return { ok: false, detail: '未定义 computeWeightedClosePrice' };
    const v = f([{ price: 105, ratio: 50 }, { price: 130, ratio: 50 }]);
    return { ok: Math.abs(v - 117.5) < 1e-9, detail: '实得=' + v };
  });
  ck('C', 'C2 confirmClose 落库 weightedClosePrice（P1-05）',
    has('logs.js', /weightedClosePrice\s*=\s*window\.utils\.computeWeightedClosePrice|weightedClosePrice\s*=\s*computeWeightedClosePrice/));
  ck('C', 'C3 目标达成率优先加权均价，末腿价不再误导（P1-05）',
    has('stats.js', /weightedClosePrice/));
  ck('C', 'C4 加权均价进 CSV 表头 / 映射 / 数值列（P1-05）',
    has('io.js', /加权平仓价/) && has('settings.js', /'加权平仓价'\s*:\s*'weightedClosePrice'/));
  ck('C', 'C5 金额链统一 8 位精度，pnlAmount 不再 toFixed(2)（P1-08）',
    has('utils.js', /util\.PNL_DIGITS\s*=\s*8/) &&
      has('logs.js', /window\.utils\.roundAmount/) &&
      count('logs.js', /window\.utils\.roundAmount\(/g) >= 6 &&
      !has('logs.js', /pnlAmount\s*=\s*parseFloat\([^)]*toFixed\(2\)\)/));
  safe('C', 'C6 100 笔 0.0049 累加不丢失（P1-08 真链路）', () => {
    const f = w.utils.roundAmount;
    if (typeof f !== 'function') return { ok: false, detail: '未定义 roundAmount' };
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += f(0.0049);
    return { ok: Math.abs(sum - 0.49) < 1e-9, detail: 'Σ=' + sum };
  });
  // C7 首版只查「文件里出现过 roundAmount」，恒真到连 modals.js:1330~1390 整段
  // 编辑平仓链仍用 toFixed(2) 都抓不住（跨模块同类审计才揭出）。改为精确禁止
  // 「金额链累计字段」再用 parseFloat(...toFixed(2/8)) 落库；positionSize / riskAmount /
  // pnlPercent 等按业务 2 位口径落库，不在本断言范围，别为改而改。
  const moneyChain = /(?:pnlAmount|realizedPnl|realizedFee|grossPnlAmount|_lastEvt\.(?:pnl|fee|gross))\s*=\s*parseFloat\([\s\S]{0,260}?\.toFixed\([28]\)\)/;
  ck('C', 'C7 编辑链金额精度与平仓链同源，无金额链 toFixed(2/8) 残留（P1-08）',
    has('modals.js', /window\.utils\.roundAmount/) &&
      !moneyChain.test(src('modals.js')) && !moneyChain.test(src('logs.js')));

  // ---------------- D · 导入导出 ----------------
  const prepImport = () => {
    w.__rep = null;
    w._confirmImportThenCommit = function (rep) { w.__rep = rep; };
    w._showImportEmptyResult = function () {};
    w._showImportValidationFailure = function () { w.__rep = { errors: ['validation'] }; };
    w.showToast = function () {};
  };
  // 用真实 exportCSV 产出合法 CSV 作模板，只改写目标列 —— 避免手写 fixture 被
  // ImportValidator 的必填校验拦下，把「告警文案」的红测伪装成「校验失败」。
  const mkRow = (i, extra) => Object.assign({
    id: 'm' + i, time: '2026-11-0' + i + 'T02:00:00.000Z', symbol: 'BTC', direction: 'long',
    entryPrice: 100, stopLoss: 90, closePrice: 110, pnlAmount: 88.2, closeType: 'manualWin',
    strategyFramework: '趋势', signals: []
  }, extra || {});
  const csvFromLogs = rows => {
    w.eval('logs = ' + JSON.stringify(rows) + ';');
    w.__csv = '';
    try { w.exportCSV(); } catch (e) { /* ignore */ }
    return w.__csv;
  };
  const rewriteColumn = (csv, colName, fn) => {
    const lines = csv.replace(/^\uFEFF/, '').replace(/\s+$/, '').split(/\r?\n/);
    const head = w.parseCSVLine(lines[0]);
    const ci = head.indexOf(colName);
    if (ci < 0) return csv;
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      const arr = w.parseCSVLine(lines[i]);
      arr[ci] = fn(i, arr[ci]);
      out.push(arr.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','));
    }
    return out.join('\n') + '\n';
  };
  safe('D', 'D1 3 条未知 closeType 全部导入且不误报「已跳过」（P1-09）', () => {
    const rows = [1, 2, 3].map(i => mkRow(i));
    const csv = rewriteColumn(csvFromLogs(rows), '平仓类型', i => 'weirdType' + i);
    prepImport();
    w.parseCSVImport(csv);
    const rep = w.__rep;
    const warn = rep && (rep.warnings || []).join(' | ');
    const n = rep && rep.valid ? rep.valid.length : 0;
    return { ok: n === 3 && warn && warn.indexOf('已跳过') === -1 && warn.indexOf('平仓类型') >= 0,
      detail: 'n=' + n + ' warn=' + warn + ' errors=' + JSON.stringify(rep && rep.errors) };
  });
  safe('D', 'D2 真正列数不符仍明确报「已跳过」（P1-09 反向）', () => {
    prepImport();
    const csv = '"ID","时间","品种"\n"id1","2026-11-01T02:00:00.000Z"\n';
    w.parseCSVImport(csv);
    const rep = w.__rep;
    const warn = rep && (rep.warnings || []).join(' | ');
    return { ok: !!(warn && warn.indexOf('已跳过') >= 0), detail: 'warn=' + warn };
  });
  safe('D', 'D3 JSON 导入保留 stopType / atrStopMode / calculationVersion（P1-10）', () => {
    const rec = [{ id: 'e1', time: '2026-11-01T02:00:00.000Z', symbol: 'BTC', direction: 'long',
      entryPrice: '50000', stopType: 'stop-limit', atrStopMode: true, calculationVersion: 'v5.6.43' }];
    w._normalizeImportedValues(rec);
    return { ok: rec[0].stopType === 'stop-limit' && rec[0].atrStopMode === true &&
      rec[0].calculationVersion === 'v5.6.43' && rec[0].entryPrice === 50000,
      detail: JSON.stringify(rec[0]) };
  });
  ck('D', 'D4 IMPORT_NUM_FIELDS 不再包含枚举/布尔/版本列（P1-10）',
    !/var IMPORT_NUM_FIELDS[\s\S]{0,900}'stopType'/.test(src('settings.js')));
  safe('D', 'D5 signals 导出→导入机器键往返保真（P1-11）', () => {
    w.eval('logs = ' + JSON.stringify([{ id: 's1', time: '2026-11-01T02:00:00.000Z',
      symbol: 'BTC', direction: 'long', entryPrice: 100, stopLoss: 90,
      signals: ['engulfing', 'macdCross'], strategyFramework: '趋势',
      strategyPattern: 'bullish-continuation|上升三角' }]) + ';');
    w.__csv = '';
    try { w.exportCSV(); } catch (e) { /* createObjectURL 在 jsdom 里可能抛，CSV 已捕获 */ }
    prepImport();
    w.parseCSVImport(w.__csv);
    const rep = w.__rep;
    const rec = rep && rep.valid && rep.valid[0];
    return { ok: !!(rec && Array.isArray(rec.signals) && rec.signals.indexOf('engulfing') >= 0 &&
      rec.signals.indexOf('macdCross') >= 0), detail: 'csv=' + (w.__csv || '').slice(0, 90) + ' signals=' + JSON.stringify(rec && rec.signals) };
  });
  safe('D', 'D6 历史中文 signals 标签可反查回机器键（P1-11）', () => {
    const csv = rewriteColumn(csvFromLogs([mkRow(1)]), '信号K', () => '吞没;MACD 金叉/死叉');
    prepImport();
    w.parseCSVImport(csv);
    const rec = w.__rep && w.__rep.valid && w.__rep.valid[0];
    return { ok: !!(rec && rec.signals && rec.signals[0] === 'engulfing' && rec.signals[1] === 'macdCross'),
      detail: JSON.stringify(rec && rec.signals) };
  });
  safe('D', 'D7 strategyPattern 独立成列且 strategyFramework 不被拼接污染（P1-12）', () => {
    w.eval('logs = ' + JSON.stringify([{ id: 'p1', time: '2026-11-01T02:00:00.000Z',
      symbol: 'BTC', direction: 'long', entryPrice: 100, stopLoss: 90,
      strategyFramework: '趋势', strategyPattern: 'bullish-continuation|上升三角' }]) + ';');
    w.__csv = '';
    try { w.exportCSV(); } catch (e) { /* ignore */ }
    prepImport();
    w.parseCSVImport(w.__csv);
    const rec = w.__rep && w.__rep.valid && w.__rep.valid[0];
    return { ok: !!(rec && rec.strategyPattern === 'bullish-continuation|上升三角' &&
      rec.strategyFramework === '趋势'), detail: 'pattern=' + (rec && rec.strategyPattern) + ' framework=' + (rec && rec.strategyFramework) };
  });
  safe('D', 'D8 欧式小数逗号不再静默漂移（P1-13）', () => {
    const f = w.parseImportNumber;
    if (typeof f !== 'function') return { ok: false, detail: '未定义 parseImportNumber' };
    const a = f('1,5'), b = f('1.234,56'), c = f('1,234.56'), d = f('Infinity');
    return { ok: a === 1.5 && b === 1234.56 && c === 1234.56 && d === null,
      detail: '1,5=' + a + ' 1.234,56=' + b + ' 1,234.56=' + c + ' Inf=' + d };
  });
  ck('D', 'D9 CSV 与 JSON 两条解析路径共用 parseImportNumber（P1-13）',
    count('settings.js', /parseImportNumber\(/g) >= 3);
  // 导出侧必须写机器键 + 分号。仅靠 D5「往返保真」守不住：导入侧的历史中文标签
  // 反查会把「导出重新写中文标签」这个退化兜住，往返仍然可逆但数据文件已不是机器键口径。
  safe('D', 'D10 导出的「信号K」列写机器键 + 分号，不写中文标签（P1-11 导出侧）', () => {
    w.eval('logs = ' + JSON.stringify([{ id: 'sig', time: '2026-11-01T02:00:00.000Z',
      symbol: 'BTC', direction: 'long', entryPrice: 100, stopLoss: 90,
      signals: ['engulfing', 'macdCross'] }]) + ';');
    w.__csv = '';
    try { w.exportCSV(); } catch (e) { /* createObjectURL 在 jsdom 里可能抛，CSV 已捕获 */ }
    const csv = w.__csv || '';
    const col = (csv.match(/"[^"]*engulfing[^"]*"/) || [''])[0];
    return { ok: csv.indexOf('"engulfing;macdCross"') >= 0 && csv.indexOf('吞没') === -1,
      detail: 'signalsCol=' + col };
  });

  // ---------------- E · 路由 ----------------
  ck('E', 'E1 存在 URL 回滚函数且用 replaceState（P1-15）',
    has('navigation.js', /_rollbackUrlToCurrentView/) && has('navigation.js', /history\.replaceState\(null, '', desired\)/));
  ck('E', 'E2 dirty 取消分支调用回滚，不再空 return（P1-15）',
    /\}\s*else\s*\{\s*_rollbackUrlToCurrentView\(\);/.test(src('navigation.js')));
  safe('E', 'E3 hashchange 脏检查取消后地址栏回到当前视图（P1-15 真链路）', () => {
    w.eval("_currentView = 'settings';");
    w.settingsIsDirty = () => true;
    w.confirmDialog = () => Promise.resolve(false);
    w.history.replaceState(null, '', '#journal');
    w.dispatchEvent(new w.Event('hashchange'));
    return { ok: false, detail: '待异步复核' };   // 由 checkRouteRollback 回填
  });

  // ---------------- F · 结构与文档 ----------------
  ck('F', 'F1 权益递推只剩 utils.calcEquityCurve 一处（批次 3）',
    !has('risk.js', /equity\s*\+=\s*_adj/) && !has('skills-integration.js', /equity\s*\+=\s*adj/));
  ck('F', 'F2 README 不再含过时的跑测器/断言/版本数字（D-07）',
    !/18 个跑测器|15 个跑测器|13 个跑测器|665 条|3300\+|5\.6\.37/.test(src('README.md')));
  ck('F', 'F3 CLAUDE 不再含过时的跑测器/断言/版本数字（D-07）',
    !/18 个跑测器|15 个跑测器|13 个跑测器|665 条|3300\+|5\.6\.37|28 处/.test(src('CLAUDE.md')));
  ck('F', 'F4 「完全离线」不再与 CDN 依赖自相矛盾（D-06）',
    /CDN/.test(src('README.md')) && /CDN/.test(src('CLAUDE.md')) &&
      !/完全离线运行/.test(src('README.md')) && !/完全离线/.test(src('CLAUDE.md')));

  return G;
}

// E3 需要等 Promise 微任务，单独异步复核并回填。
async function checkRouteRollback(w, G) {
  const item = G.E.find(x => x.name.indexOf('E3') === 0);
  if (!item) return;
  await new Promise(r => setTimeout(r, 60));
  const view = w.eval("typeof _currentView !== 'undefined' ? _currentView : null");
  const ok = view === 'settings' && w.location.hash === '#settings';
  item.ok = !!ok;
  item.detail = 'view=' + view + ' hash=' + w.location.hash;
}

async function normal() {
  const D = readInputs();
  const w = await boot(D);
  const G = runChecks(w, D);
  await checkRouteRollback(w, G);
  const all = [];
  for (const g of GROUPS) for (const r of G[g]) all.push(Object.assign({ group: g }, r));
  const fail = all.filter(r => !r.ok);
  for (const r of all) console.log((r.ok ? 'PASS' : 'FAIL') + ' [' + r.group + '] ' + r.name + (r.detail ? ' | ' + r.detail : ''));
  console.log('\n分组：' + GROUPS.map(g => g + '=' + G[g].filter(x => x.ok).length + '/' + G[g].length).join('  '));
  try { w.close(); } catch (e) { /* ignore */ }
  process.exit(gate.report(all.length - fail.length, fail.length));
}

// 逐条独立注入：每个注入点把修复后的源码改回旧实现，对应断言组必须报红。
// 只改内存副本，绝不碰磁盘；任何一个锚点失效都会打印 MISS 并计入未捕获。
const INJECTIONS = [
  { key: 'P0-4 入场 ticks 双来源', group: 'A', mutators: [
    { file: 'calculator.js', from: '    stopExitTicks = stopDefaults.exit;',
      to: '    stopEntryTicks = stopDefaults.entry;\n    stopExitTicks = stopDefaults.exit;' } ] },
  { key: 'P1-07 MAE 基准内联读顶层', group: 'A', mutators: [
    { file: 'logs.js', from: '  const ep = getEntryFillForPnL(item);\n  if (isNaN(ep) || ep <= 0 || !item.direction) {',
      to: '  const ep = (item.effectiveEntryPrice != null && !isNaN(parseFloat(item.effectiveEntryPrice))) ? parseFloat(item.effectiveEntryPrice) : parseFloat(item.entryPrice);\n  if (isNaN(ep) || ep <= 0 || !item.direction) {' } ] },
  { key: 'P1-16 脏费率 Number()||0', group: 'A', mutators: [
    { file: 'calculator.js', from: '  var rate = Math.max(0, toFiniteNum(feeRatePct, 0)) / 100;',
      to: '  var rate = (Number(feeRatePct) || 0) / 100;' } ] },
  { key: 'P1-17 manual ticks 预置 0', group: 'A', mutators: [
    { file: 'html', from: 'id="entrySlippageTicks" value=""', to: 'id="entrySlippageTicks" value="0"' } ] },
  { key: 'P1-17 负 targetRR 放行', group: 'A', mutators: [
    { file: 'calculator.js', from: 'if (rrAmounts.netLoss > 0 && rrAmounts.netProfit > 0) targetRR =',
      to: 'if (rrAmounts.netLoss > 0) targetRR =' } ] },
  { key: 'P1-17 本金 parseFloat 回退', group: 'A', mutators: [
    { file: 'calculator.js', from: 'let capital = capitalEl ? toFiniteNum(capitalEl.value, 0) : 0;',
      to: 'let capital = capitalEl ? parseFloat(capitalEl.value) : 0;' } ] },
  { key: 'P0-5 曲线缺 capital 回退净值', group: 'B', mutators: [
    { file: 'utils.js', from: '      if (!_capitalKnown) {\n        return { data: [],',
      to: '      if (false) {\n        return { data: [],' } ] },
  { key: 'P0-5 回撤闸门 readFailed 被吞', group: 'B', mutators: [
    { file: 'skills-integration.js', from: '    _readFailed = true;\n    capital = 0; equity = 0; peak = 0;',
      to: '    _readFailed = false;\n    capital = 0; equity = 0; peak = 0;' } ] },
  { key: 'P1-01 本周无上界', group: 'B', mutators: [
    { file: 'utils.js', from: 'return !!(r && Number.isFinite(t) && t >= r.startMs && t < r.endMs);',
      to: 'return !!(r && Number.isFinite(t) && t >= r.startMs);' } ] },
  { key: 'P1-02 风控卡传筛选样本', group: 'B', mutators: [
    { file: 'risk.js', from: '  renderDailyLoss(getClosedSorted());', to: '  renderDailyLoss(closed);' } ] },
  { key: 'P1-03 夏普自行取全局本金', group: 'B', mutators: [
    { file: 'stats.js', from: '      var _sharpeEquity = window.utils.resolveStartEquity(closed, hasAnyFilter,\n        (typeof getAccountCapital === \'function\') ? getAccountCapital() : null);',
      to: '      var _sharpeEquity = ((typeof getAccountCapital === \'function\') ? getAccountCapital() : null);' } ] },
  { key: 'P1-04 分析页用全量样本', group: 'B', mutators: [
    { file: 'analytics.js', from: '  var closed = window.utils.getDisplayClosed();\n\n  var fns = [',
      to: '  var closed = getClosedSorted();\n\n  var fns = [' } ] },
  { key: 'P1-06 成本侵蚀分母漏滑点', group: 'B', mutators: [
    { file: 'stats.js', from: 'Math.abs(_gpRp + _gpRf + _slip) : NaN;',
      to: 'Math.abs(_gpRp + _gpRf) : NaN;' } ] },
  { key: 'P1-05 加权均价恒为 null', group: 'C', mutators: [
    { file: 'utils.js', from: '    return sumR > 0 ? util.roundAmount(sumW / sumR) : null;',
      to: '    return null;' } ] },
  { key: 'P1-08 金额精度退回 2 位', group: 'C', mutators: [
    { file: 'utils.js', from: '  util.PNL_DIGITS = 8;', to: '  util.PNL_DIGITS = 2;' } ] },
  { key: 'P1-08 编辑平仓链精度退回 2 位', group: 'C', mutators: [
    { file: 'modals.js', from: '          item.pnlAmount = window.utils.roundAmount(item.realizedPnl);',
      to: '          item.pnlAmount = parseFloat(item.realizedPnl.toFixed(2));' } ] },
  { key: 'P1-09 值域告警误报已跳过', group: 'D', mutators: [
    { file: 'settings.js', from: "          valueWarnings.push('第 ' + (i + 1) + ' 行平仓类型「' + v + '」不在已知值域（记录已导入，请核对）');",
      to: "          skippedRows.push('第 ' + (i + 1) + ' 行平仓类型「' + v + '」不在已知值域');" } ] },
  { key: 'P1-10 枚举列重新数值化', group: 'D', mutators: [
    { file: 'settings.js', from: "'holdDuration','effectiveEntryPrice','grossPnlAmount'",
      to: "'holdDuration','effectiveEntryPrice','stopType','atrStopMode','calculationVersion','grossPnlAmount'" } ] },
  { key: 'P1-11 signals 导出中文标签', group: 'D', mutators: [
    { file: 'io.js', from: "    const ss = Array.isArray(row.signals) ? row.signals.join(';') : '';",
      to: "    const ss = (row.signals && row.signals.length) ? row.signals.map(s => SIGNAL_LABELS[s] || s).join(' / ') : '';" } ] },
  { key: 'P1-12 strategyPattern 拼进框架', group: 'D', mutators: [
    { file: 'io.js', from: "    let sf = row.strategyFramework || '';\n    // P1-11",
      to: "    let sf = row.strategyFramework || '';\n    if (row.strategyPattern) sf += ' - ' + row.strategyPattern;\n    // P1-11" } ] },
  { key: 'P1-13 欧式小数逗号不识别', group: 'D', mutators: [
    { file: 'settings.js', from: "  } else if (/^[+-]?\\d+,\\d{1,2}$/.test(s)) {\n    s = s.replace(',', '.');\n  } else {",
      to: '  } else {' } ] },
  { key: 'P1-15 脏检查取消不回滚 URL', group: 'E', mutators: [
    { file: 'navigation.js', from: '        } else {\n          _rollbackUrlToCurrentView();\n        }',
      to: '        } else {\n          /* 注入：取消后空 return */\n        }' } ] },
  { key: '批次3 兜底权益递推回归', group: 'F', mutators: [
    { file: 'risk.js', from: '  var capital = 0, equity = 0, peak = 0;',
      to: '  var capital = 0, equity = 0, peak = 0;\n  // equity += _adj;  ← 注入旧兜底递推' } ] },
  { key: 'D-06 文档重新宣称完全离线', group: 'F', mutators: [
    { file: 'README.md', from: '核心计算、风控闸门与全部交易数据仍可离线使用（不是「完全零外部依赖」）。',
      to: '核心计算、风控闸门与全部交易数据完全离线运行。' } ] },
  { key: 'D-07 CLAUDE 历史数字回归', group: 'F', mutators: [
    { file: 'CLAUDE.md', from: '`npm test` 现为 **31 项（22 正常 + 9 注入自检）**。',
      to: '`npm test` 现为 **18 个跑测器**。' } ] }
];

async function injectMode() {
  let caught = 0;
  for (const inj of INJECTIONS) {
    let D;
    try { D = readInputs(inj.mutators); }
    catch (e) { console.log('MISS ' + inj.key + ' | 锚点失效: ' + e.message); continue; }
    let w, G;
    try {
      w = await boot(D);
      G = runChecks(w, D);
      await checkRouteRollback(w, G);
    } catch (e) { console.log('ERR  ' + inj.key + ' | ' + e.message); continue; }
    const red = (G[inj.group] || []).filter(x => !x.ok);
    const ok = red.length > 0;
    if (ok) caught++;
    console.log((ok ? 'CAUGHT ' : 'MISSED ') + inj.key + ' | 组 ' + inj.group +
      ' 报红 ' + red.length + ' 条' + (red.length ? '（' + red[0].name + '）' : ''));
    try { w.close(); } catch (e) { /* ignore */ }
  }
  console.log('\n注入自检：' + caught + '/' + INJECTIONS.length);
  process.exit(gate.inject(caught, INJECTIONS.length));
}

(INJECT ? injectMode() : normal()).catch(e => {
  console.error('FATAL: ' + (e && e.stack || e));
  process.exit(2);
});
