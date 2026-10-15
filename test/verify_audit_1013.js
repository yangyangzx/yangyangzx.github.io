// ==================== 开仓计划 / 交易日志模块审计 + 回归实证（2026-10-13） ====================
// 目的：对 7 个已确认真实 bug（#1~#7）做行为级回归验证——每条断言描述「修复后的正确行为」，
//       打印 FAIL 即代表回归（修复被破坏 / 旧缺陷复发）。
// 历史：经复核，原审计的 #8（stats 直调 isClosedTrade）与 #9（dashboard try 外）为假阳性，已撤回。
// 运行：cd notes && node test/verify_audit_1013.js
// 退出码：0 = 全部回归通过；1 = 有回归（FAIL 数 > 0）。
'use strict';
const { JSDOM } = require('jsdom');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
const w = dom.window;
const vmc = dom.getInternalVMContext();

// ---- 加载真实脚本（顺序与 index.html 一致：constants → utils → logs → modals → planner → io）----
['js/constants.js', 'js/utils.js', 'js/logs.js', 'js/modals.js', 'js/planner.js', 'js/io.js'].forEach(function(f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), vmc);
});

// ---- 最小 stub（calculator/storage/navigation 未加载，按需补齐）----
const toasts = [];
const saveCalls = [];
w.showToast = function(m, t) { toasts.push({ m: m, t: t || 'info' }); };
w.saveLogs = function(ext) { saveCalls.push(!!ext); return true; };
w.renderLogs = function() {};
w.renderDashboard = function() {};
w.buildPatternOptions = function() { return ''; };
w.getReason = function() { return ''; };
w.getMindsetScore = function() { return 3; };
w.formatHoldDuration = function() { return '—'; };
w.getDefinedSymbols = function() { return []; };
w.getCalc = function() { return null; };
w.getCalcDirty = function() { return false; };
w.getCalcBlocker = function() { return null; };
w._getDefaultFeeRate = function() { return 0.08; };
w.loadSettings = function() { return {}; };

let pass = 0, fail = 0;
function T(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
function runInVM(expr) { return vm.runInContext(expr, vmc); }
function el(tag, id, value) {
  var e = w.document.createElement(tag || 'input');
  e.id = id;
  if (value !== undefined) e.value = value;
  w.document.body.appendChild(e);
  return e;
}
function fire(node, type) { node.dispatchEvent(new w.Event(type, { bubbles: true })); }
function clearBody() { w.document.body.innerHTML = ''; }
// closes[] 可能未初始化（保存被拦时 item 原样不动）；无守卫的 .reduce 会让整份脚本在这里中断，
// 后续所有断言都不再执行——那比一条 FAIL 更隐蔽（脚本退出码是 1，看起来"有缺陷"，实际什么都没跑完）。
function legSum(key) {
  var L = w.logs[0];
  if (!Array.isArray(L.closes) || !L.closes.length) return NaN;
  return L.closes.reduce(function(s, c) { return s + (parseFloat(c[key]) || 0); }, 0);
}
function legRatios() {
  var L = w.logs[0];
  return Array.isArray(L.closes) ? L.closes.map(function(c) { return c.ratio; }) : undefined;
}
function leg(n) {
  var C = w.logs[0].closes;
  return Array.isArray(C) && C[n] ? C[n] : undefined;
}

// 构造行内平仓面板 DOM（confirmClose 直接读这些元素）
function mkClosePanel(idx, opts) {
  ['cpClosePrice_', 'cpPnlAmount_', 'cpPnlPercent_', 'cpRMultiple_', 'cpCloseNote_', 'cpFee_',
   'cpSlippage_', 'cpPartialRatio_', 'cpLowPrice_', 'cpHighPrice_'].forEach(function(p) { el('input', p + idx); });
  var ct = el('select', 'cpCloseType_' + idx);
  ['', 'initialSL', 'trailingSL', 'initialTP', 'manualWin', 'manualLoss', 'liquidation',
   'partialTP', 'timeStop', 'reducePosition'].forEach(function(v) {
    var o = w.document.createElement('option'); o.value = v; ct.appendChild(o);
  });
  ct.value = opts.type;
  w.document.getElementById('cpClosePrice_' + idx).value = opts.price;
  w.document.getElementById('cpFee_' + idx).value = opts.fee;
  w.document.getElementById('cpSlippage_' + idx).value = opts.slip || '';
  if (opts.ratio !== undefined) w.document.getElementById('cpPartialRatio_' + idx).value = opts.ratio;
  var lr = el('div', 'cpLossReason_' + idx);
  if (opts.lossReason) {
    var cb = w.document.createElement('input'); cb.type = 'checkbox'; cb.value = '追涨杀跌'; cb.checked = true;
    lr.appendChild(cb);
  }
  el('div', 'cpExecChecks_' + idx);
  el('span', 'cpExecScore_' + idx);
}

function mkOpenTrade() {
  return {
    id: 'x1', time: '2026-10-10T10:00:00.000Z', symbol: 'BTC', direction: 'long',
    orderType: 'market', stopType: 'stop-market', entryPrice: 100, effectiveEntryPrice: 100,
    stopLoss: 95, targetPrice: 115, positionSize: 1000, leverage: 10,
    riskAmount: 50, initialRiskAmount: 50, actualMargin: 100, initialMargin: 100,
    initialPositionSize: 1000, fee: 4, slippageCost: 0, slippage: null,
    closeType: '', closePrice: null, pnlAmount: null, rMultiple: null, pnlPercent: null,
    mindsetScore: 3, capital: 10000, closeTime: null, holdDuration: null
  };
}
// 经「部分平仓链」走出来的已平仓盈利单（positionSize 已归零、realizedPnl 已累计）。
// fee 取「剩余 round-trip 费用」——confirmClose 最终平仓不清零 item.fee，
// 故已平仓记录常态是 positionSize=0 且 fee>0（这正是 A 组误判的触发条件）。
function mkClosedWinViaPartialChain(fee) {
  return {
    id: 'x2', time: '2026-10-01T10:00:00.000Z', closeTime: '2026-10-01T12:00:00.000Z',
    symbol: 'BTC', direction: 'long', orderType: 'market', stopType: 'stop-market',
    entryPrice: 100, effectiveEntryPrice: 100, stopLoss: 95, targetPrice: 115,
    positionSize: 0, leverage: 10, riskAmount: 0, initialRiskAmount: 50,
    actualMargin: 0, initialMargin: 100, initialPositionSize: 1000,
    closeType: 'initialTP', closePrice: 108, pnlAmount: 61, pnlPercent: 61, rMultiple: 1.22,
    realizedPnl: 61, realizedFee: fee, grossPnlAmount: 65, closedRatio: 100,
    closes: [
      { type: 'partialTP', price: 105, ratio: 50, fee: fee / 2, pnl: 23, time: '2026-10-01T11:00:00.000Z' },
      { type: 'initialTP', price: 108, ratio: 50, fee: fee / 2, pnl: 38, time: '2026-10-01T12:00:00.000Z' }
    ],
    fee: fee, slippageCost: 0, slippage: null, mindsetScore: 4, capital: 10000,
    holdDuration: 120, executionScore: 2
  };
}

// =====================================================================
console.log('\n== A. 编辑弹窗：已平仓盈利单（positionSize=0 且 fee>0）被「亏损原因」误拦 ==');
// 背景：modals.js saveEditLog 的实时盈亏校验用表单 positionSize（已平仓=0）算 grossPnl，
//        realTimeNetPnl = 0 − fee < 0 → isLoss 恒真 → 要求选亏损原因 → 保存被拒。
{
  clearBody(); toasts.length = 0;
  w.logs = [mkClosedWinViaPartialChain(4)];   // 剩余 fee=2 > 0（部分平仓链常态）
  w.openEditModal(0);
  var r = w.saveEditLog(0);
  T('A1 已平仓盈利单（部分平仓链）可直接保存', r === true);
  T('A1 不应弹出「亏损原因」拦截', !toasts.some(function(t) { return String(t.m).indexOf('亏损原因') !== -1; }));
  T('A1 pnlAmount 保留 61 不被回滚', w.logs[0].pnlAmount === 61);
}
{
  clearBody(); toasts.length = 0;
  w.logs = [mkClosedWinViaPartialChain(0)];   // 对照组：fee=0 时 realTimeNetPnl=0，不触发误判
  w.openEditModal(0);
  var r = w.saveEditLog(0);
  T('A2 对照组 fee=0 时可保存（证明误判由 fee>0 触发）', r === true);
}
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];                   // 真亏损单：闸门本就应该拦
  w.openEditModal(0);
  var ct = w.document.getElementById('emCloseType'); ct.value = 'manualLoss'; fire(ct, 'change');
  var cp = w.document.getElementById('emClosePrice'); cp.value = '90'; fire(cp, 'input');
  var r = w.saveEditLog(0);
  T('A3 真亏损单（无亏损原因）仍被正确拦截（闸门本身有效）', r === false &&
    toasts.some(function(t) { return String(t.m).indexOf('亏损原因') !== -1; }));
}
{
  // A4：全新平仓记录（confirmClose 不归零 positionSize，见 C 组）第一次编辑正常，
  // 但 saveEditLog 会把 positionSize 置 0 而 fee 保留 → 第二次编辑必被误拦。
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];
  mkClosePanel(0, { type: 'initialTP', price: '110', fee: '4' });
  w.confirmClose(0);
  w.openEditModal(0);
  var r1 = w.saveEditLog(0);
  T('A4a 已平仓记录第一次编辑可保存', r1 === true && w.logs[0].positionSize === 0);
  clearBody(); toasts.length = 0;
  w.openEditModal(0);
  var r2 = w.saveEditLog(0);
  T('A4b 第二次编辑应可保存（#2 修复后不再误拦）', r2 === true);
  T('A4b 修复后第二次编辑无误拦（无「亏损原因」提示）', r2 === true && !toasts.some(function(t) { return String(t.m).indexOf('亏损原因') !== -1; }));
}

// =====================================================================
console.log('\n== B. 编辑弹窗首次创建部分平仓：本腿盈亏未按比例折算 + realizedPnl 未初始化 ==');
// 背景：saveEditLog 的部分平仓分支只同步 closedRatio/positionSize/风险/费用，
//       不写 realizedPnl/realizedFee，pnlAmount 取表单值（emRecalc 按全仓计算的）。
//       随后经行内面板最终平仓时 confirmClose 以 parseFloat(undefined)+netPnl 累加 → NaN 毒化。
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];
  w.openEditModal(0);
  var cp = w.document.getElementById('emClosePrice'); cp.value = '105'; fire(cp, 'input');
  var ct = w.document.getElementById('emCloseType'); ct.value = 'partialTP'; fire(ct, 'change');
  var ra = w.document.getElementById('emPartialRatio'); ra.value = '50';
  var r = w.saveEditLog(0);
  T('B0 编辑弹窗首次部分平仓保存成功', r === true);
  T('B1 簿记正确：closedRatio=50 / positionSize=500', w.logs[0].closedRatio === 50 && w.logs[0].positionSize === 500);
  // 本腿净盈亏应为 (50 毛利 − 0 滑点) × 50% − 4 × 50% = 23
  T('B2 pnlAmount 应为本腿 23（实际为全仓 46 → 缺陷）', Math.abs(w.logs[0].pnlAmount - 23) < 0.01);
  T('B3 realizedPnl 应初始化为 23（实际 undefined → 缺陷）', Math.abs(parseFloat(w.logs[0].realizedPnl) - 23) < 0.01);
  T('B4 rMultiple 应以本腿计 0.46（实际 0.92 → 缺陷）', Math.abs(parseFloat(w.logs[0].rMultiple) - 0.46) < 0.01);

  // 第二阶段：用户经行内平仓面板做最终平仓（confirmClose 权威路径）。
  // confirmClose 会把 undefined 的 realizedPnl 初始化为 0（logs.js:281-283），
  // 因此不是 NaN 毒化，而是【第一腿已实现盈亏被静默抹掉】：整笔累计只剩末腿。
  clearBody();
  mkClosePanel(0, { type: 'initialTP', price: '108', fee: '2' });
  var r2 = w.confirmClose(0);
  T('B5 最终平仓成功', r2 === true);
  // 正确值：realizedPnl = 23（第一腿）+ 38（末腿）= 61；缺陷值：38（第一腿丢失）
  T('B6 realizedPnl 应为 61（实际 38 → 第一腿 +23 被抹掉）', Math.abs(parseFloat(w.logs[0].realizedPnl) - 61) < 0.01);
  T('B7 pnlAmount 应为 61（实际 38 → 统计少记一笔已实现盈利）', Math.abs(parseFloat(w.logs[0].pnlAmount) - 61) < 0.01);
  T('B8 rMultiple 应为 1.22（实际 0.76 → R 倍数随分批次数漂移）', Math.abs(parseFloat(w.logs[0].rMultiple) - 1.22) < 0.01);
  T('B9 grossPnlAmount 应为 65（实际 40 → 成本侵蚀分母失真）', Math.abs(parseFloat(w.logs[0].grossPnlAmount) - 65) < 0.01);
  T('B10 closes[0] 应含 price/pnl/fee/time 审计字段（实际只有 type/ratio → 审计链断档）',
    !!(leg(0) && leg(0).pnl === 23 && leg(0).price === 105 && leg(0).fee === 2));
  T('B11 审计链 Σ closes[].pnl 应还原整笔 61（实际 38 → 与真实经济盈亏脱节）',
    Math.abs(legSum('pnl') - 61) < 0.01);
  T('B12 closedRatio=100 且 positionSize=0（收尾簿记本身正确）', w.logs[0].closedRatio === 100 && w.logs[0].positionSize === 0);
}

// =====================================================================
console.log('\n== C. confirmClose 全新平仓不把 positionSize 归零（与编辑路径口径不对称）==');
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];
  mkClosePanel(0, { type: 'initialTP', price: '110', fee: '4' });
  var r = w.confirmClose(0);
  T('C1 全新平仓后 positionSize 应归零（实际保留 1000 → 缺陷）', w.logs[0].positionSize === 0);
  T('C2 已平仓判定为 true（isClosed 不依赖 positionSize，爆炸半径受限）', w.utils.isClosed(w.logs[0]) === true);
  // 与编辑路径对照：同一记录过一遍编辑弹窗即被置零 → 两个权威对同一事实给出不同账面
  clearBody();
  w.openEditModal(0);
  w.saveEditLog(0);
  T('C3 同一记录经编辑保存后 positionSize=0（证明两条路径口径不对称）', w.logs[0].positionSize === 0);
}

// =====================================================================
console.log('\n== D. 平仓面板选「部分止盈/减仓」但不填比例 → 静默按全平处理 ==');
// 背景：confirmClose 的 partialValid 为 false 时既不报错也不回退，直接走全平分支，
//       用户「部分平仓」的意图被无声改写为全部退出。
// 修复口径（fail-closed）：能确定用户不想全平，就拦下让用户改口径，不替用户做全平决定。
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];
  mkClosePanel(0, { type: 'partialTP', price: '105', fee: '4', ratio: '' });
  var r = w.confirmClose(0);
  T('D1 空比例时不再保存（修复前：保存成功但按全平落库 closedRatio=100）', r === undefined);
  T('D1 记录未被改动：仍是未平仓开仓态（closeType 空、无 closedRatio）',
    w.logs[0].closeType === '' && w.logs[0].closedRatio === undefined &&
    w.logs[0].positionSize === 1000 && w.logs[0].closes === undefined);
  T('D2 空比例时给出指向明确原因的提示（修复前：无任何 toast）',
    toasts.some(function(t) { return /比例/.test(String(t.m)); }));
}
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];                   // 对照组：填了比例 → 正常部分平仓
  mkClosePanel(0, { type: 'partialTP', price: '105', fee: '4', ratio: '50' });
  w.confirmClose(0);
  T('D3 对照组 ratio=50 时部分平仓正确（closedRatio=50 / positionSize=500）',
    w.logs[0].closedRatio === 50 && w.logs[0].positionSize === 500);
}
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];                   // 边界：比例填 100 等于「全部退出」，不属分批语义
  mkClosePanel(0, { type: 'reducePosition', price: '105', fee: '4', ratio: '100' });
  var r4 = w.confirmClose(0);
  T('D4 比例填 100（等价全平）同样被拦，提示改选平仓类型',
    r4 === undefined && w.logs[0].closedRatio === undefined &&
    toasts.some(function(t) { return /比例/.test(String(t.m)); }));
}
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];                   // 反向：非分批类型不受此拦，全平路径不回归
  mkClosePanel(0, { type: 'initialTP', price: '110', fee: '4' });
  var r5 = w.confirmClose(0);
  T('D5 非分批类型（初始止盈）不被比例拦截，全平正常落库',
    r5 === true && w.logs[0].closedRatio === 100 && w.logs[0].positionSize === 0);
}

// =====================================================================
console.log('\n== E. io.js 导入校验：负仓位与大小写方向穿透（统计/平仓双路径矛盾）==');
{
  var rep1 = runInVM('importValidator.validateFields({symbol:"BTC",direction:"long",entryPrice:100,time:"2026-10-01T10:00:00.000Z",positionSize:-5000})');
  T('E1 positionSize=-5000 应被拒绝（实际放行 → 缺陷）', rep1.length > 0);
  var rep2 = runInVM('importValidator.validateFields({symbol:"BTC",direction:"long",entryPrice:-100,time:"2026-10-01T10:00:00.000Z"})');
  T('E2 对照组 entryPrice=-100 被拒绝（证明 E1 是遗漏而非设计）', rep2.length > 0);
  var rep3 = runInVM('importValidator.validateFields({symbol:"BTC",direction:"LONG",entryPrice:100,time:"2026-10-01T10:00:00.000Z"})');
  T('E3 direction="LONG" 校验通过（#4 归一化为小写，不再原样放行）', rep3.length === 0);
  var stored = runInVM('JSON.stringify(importValidator.validateAndSanitize([{symbol:"BTC",direction:"LONG",entryPrice:100,time:"2026-10-01T10:00:00.000Z"}]).valid[0].direction)');
  T('E4 "LONG" 归一化为 "long" 落库（与 calculateCloseSettlement 口径对齐）', stored === '"long"');
  var settlement = runInVM('String(calculateCloseSettlement({direction:"long",effectiveEntryPrice:100,entryPrice:100,positionSize:-5000,fee:0,slippageCost:0,riskAmount:50},110))');
  T('E5 负仓位记录平仓结算返回 null（导入放行 → 平仓路径拒绝，两条路径结论矛盾）', settlement === 'null');
}

// =====================================================================
console.log('\n== F. planner.js 反推函数在生产 DOM 下必崩（卡片已移除，仅测试存活）==');
// index.html 自 v5.6.23 移除盈亏比反推卡片后 #desiredRR/#reverseTP/#reverseSL 均不存在，
// 而 calcReverseTP/calcReverseSL 首行即读 #desiredRR.value；目前无生产调用方（仅 run-tests 第27组）。
{
  clearBody();
  el('input', 'entryPrice', '100'); el('input', 'stopLoss', '95');
  el('input', 'direction', 'long'); el('input', 'feeRate', '0.08');
  var r1 = runInVM('(function(){ try { calcReverseTP(); return "ok"; } catch(e) { return e.constructor.name + ": " + e.message; } })()');
  T('F1 生产 DOM（无 #desiredRR）下调 calcReverseTP 不再抛 TypeError（#7 修复）',
    !/TypeError/.test(r1));
  el('input', 'desiredRR', '2'); el('input', 'reverseTP');
  var r2 = runInVM('(function(){ calcReverseTP(); return document.getElementById("reverseTP").value; })()');
  var tp = parseFloat(r2);
  T('F2 对照组补齐 #desiredRR 后正常反推（110.48 附近）', !isNaN(tp) && tp > 110 && tp < 111);
}

// =====================================================================
console.log('\n== G. 编辑弹窗多次部分平仓：本腿折算 + 累计不变量（≥3 腿） ==');
// 背景：#1 的修复只经「一次部分平仓 → 最终平仓」验证过。多次分批时要同时考两块换算：
//       syncCloseBookkeeping 的「剩余口径 → 原始口径」增量（utils.closedRatioDelta 标量形式）
//       与 #1 新写的本腿结算（_prePosSize / _preFraction 基数）。两块各自对过一次不代表叠起来对。
// 基准：entry 100 / stop 95 / 原始仓位 1000 / round-trip 费 4 / 初始风险 50 / 初始保证金 100。
//   腿1 平剩余 50%（500 单位）@105 → 毛利 25 − 费 2 = 23
//   腿2 平剩余 40%（500×40%=200 单位，原始口径增量 20）@110 → 毛利 20 − 费 0.8 = 19.2
//   末腿 全平剩余 300 @112 → 毛利 36 − 费 1.2 = 34.8
//   合计 77；三腿费用合计 4（等于原始 round-trip 费，不多扣不重扣）。
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];
  w.openEditModal(0);
  w.document.getElementById('emClosePrice').value = '105';
  // 触发 emRecalc 回填盈亏，与真实输入一致（否则 emPnlAmount 为空，保存被拒）
  fire(w.document.getElementById('emClosePrice'), 'input');
  w.document.getElementById('emCloseType').value = 'partialTP';
  w.document.getElementById('emPartialRatio').value = '50';
  var g1 = w.saveEditLog(0);
  T('G1 腿1 保存成功', g1 === true);
  T('G1 腿1 簿记：closedRatio=50 / positionSize=500 / 剩余费=2',
    w.logs[0].closedRatio === 50 && w.logs[0].positionSize === 500 && w.logs[0].fee === 2);
  T('G1 腿1 本腿盈亏 23 已进累计（realizedPnl=23 / realizedFee=2）',
    Math.abs(w.logs[0].realizedPnl - 23) < 0.011 && Math.abs(w.logs[0].realizedFee - 2) < 1e-6);

  clearBody();
  w.openEditModal(0);
  var _addRadio = w.document.querySelector('input[name="emPartialLegMode"][value="add"]');
  if (_addRadio) _addRadio.checked = true;   // 显式声明「新增一笔」，不是改写上一笔
  w.document.getElementById('emClosePrice').value = '110';
  // 触发 emRecalc 回填盈亏，与真实输入一致（否则 emPnlAmount 为空，保存被拒）
  fire(w.document.getElementById('emClosePrice'), 'input');
  w.document.getElementById('emPartialRatio').value = '40';   // 剩余口径：40% × 500 = 200 单位
  var g2 = w.saveEditLog(0);
  T('G2 腿2 保存成功', g2 === true);
  // 原始口径增量 = 40 × (1 − 50/100) = 20 → closedRatio 70（若按剩余口径误叠 40 会得到 90）
  T('G2 腿2 簿记按原始口径换算：closedRatio=70 / positionSize=300',
    w.logs[0].closedRatio === 70 && w.logs[0].positionSize === 300);
  T('G2 腿2 追加新事件而非覆盖上一笔：closes=[50,20]',
    JSON.stringify(legRatios()) === '[50,20]');
  T('G2 腿2 累计盈亏 42.2（23 + 19.2），未把首腿重复计入',
    Math.abs(w.logs[0].realizedPnl - 42.2) < 0.011);
  T('G2 累计费用 2.8（2 + 0.8），剩余费 1.2',
    Math.abs(w.logs[0].realizedFee - 2.8) < 1e-6 && w.logs[0].fee === 1.2);

  // 末腿走行内面板最终平仓（confirmClose 权威路径）
  clearBody();
  mkClosePanel(0, { type: 'initialTP', price: '112', fee: '1.2' });
  var g3 = w.confirmClose(0);
  T('G3 末腿最终平仓成功', g3 === true);
  T('G3 整笔累计 realizedPnl=77 / pnlAmount=77（三腿 23+19.2+34.8 全数在账）',
    Math.abs(w.logs[0].realizedPnl - 77) < 0.011 && Math.abs(parseFloat(w.logs[0].pnlAmount) - 77) < 0.011);
  T('G3 累计费用 4.0 恰好等于原始 round-trip 费（不多扣不重扣）',
    Math.abs(w.logs[0].realizedFee - 4) < 1e-6);
  T('G3 整笔 R=1.54 / 累计毛利 81（以初始风险/初始保证金为基准）',
    Math.abs(parseFloat(w.logs[0].rMultiple) - 1.54) < 0.011 &&
    Math.abs(parseFloat(w.logs[0].grossPnlAmount) - 81) < 0.011);
  T('G3 收尾簿记：closedRatio=100 / positionSize=0',
    w.logs[0].closedRatio === 100 && w.logs[0].positionSize === 0);
  // 两条不变量：审计链必须能还原整笔
  T('G4 不变量 Σ closes[].pnl === 整笔 77',
    Math.abs(legSum('pnl') - 77) < 0.011);
  T('G4 不变量 Σ closes[].ratio === closedRatio(100)，且 Σ closes[].fee === 累计费 4',
    Math.abs(legSum('ratio') - 100) < 1e-6 &&
    Math.abs(legSum('fee') - 4) < 1e-6);
  T('G4 三条事件各带 price/pnl/fee/time 审计字段（可逐腿追查）',
    legRatios().length === 3 && [0, 1, 2].every(function(i) {
      var c = leg(i);
      return !!c && c.price > 0 && isFinite(parseFloat(c.pnl)) && isFinite(parseFloat(c.fee)) && !!c.time;
    }));
}

// =====================================================================
console.log('\n== H. 编辑弹窗「修改最后一笔」：替换末腿不重复计入累计 ==');
// 背景：H/G 互为反向用例。同一个比例输入框有两种意图，弹窗里用 emPartialLegMode 单选显式区分。
//       G 组验「新增一笔」（追加事件），H 组验「修改最后一笔」（替换末事件）。
//       替换语义下累计必须先扣回被替换那一腿，否则旧腿盈亏/费用被重复计入。
// 基准同 G：entry 100 / 原始仓位 1000 / round-trip 费 4 / 初始风险 50 / 初始保证金 100。
//   腿1 平剩余 50% @105 → 毛利 25 − 费 2 = 23
//   改末腿为剩余 40%（1000×40% = 400 单位）@105 → 毛利 20 − 费 1.6 = 18.4（整笔只有这一腿）
// oracle 校正（2026-10-14）：原期望 9.2 是「基数错位」bug 的产物——它把 40% 乘在**腿1平仓后
// 的剩余仓位 500** 上（500×40% = 200 单位 → 毛利 10），费用也乘在剩余费 2 上（2×0.4 = 0.8）。
// 正确的结算基数是「该腿发生**前**的剩余仓位」（本例即开仓原始 1000），见 modals.js 的
// _legBaseFactor 修复。9.2 恰为正确值 18.4 的一半，与实测偏差系数一致。
{
  clearBody(); toasts.length = 0;
  w.logs = [mkOpenTrade()];
  w.openEditModal(0);
  w.document.getElementById('emClosePrice').value = '105';
  // 触发 emRecalc 回填盈亏，与真实输入一致（否则 emPnlAmount 为空，保存被拒）
  fire(w.document.getElementById('emClosePrice'), 'input');
  w.document.getElementById('emCloseType').value = 'partialTP';
  w.document.getElementById('emPartialRatio').value = '50';
  w.saveEditLog(0);
  T('H0 前置：腿1 已保存（closedRatio=50 / realizedPnl=23）',
    w.logs[0].closedRatio === 50 && Math.abs(w.logs[0].realizedPnl - 23) < 0.011);

  clearBody();
  w.openEditModal(0);
  var _editRadio = w.document.querySelector('input[name="emPartialLegMode"][value="edit"]');
  if (_editRadio) _editRadio.checked = true;   // 默认值即 edit，显式设一次以锁住 oracle
  w.document.getElementById('emClosePrice').value = '105';
  // 触发 emRecalc 回填盈亏，与真实输入一致（否则 emPnlAmount 为空，保存被拒）
  fire(w.document.getElementById('emClosePrice'), 'input');
  w.document.getElementById('emPartialRatio').value = '40';
  var h1 = w.saveEditLog(0);
  T('H1 修改末腿保存成功', h1 === true);
  T('H1 末腿被【替换】而非追加：closes 仍只有 1 条，ratio=40',
    JSON.stringify(legRatios()) === '[40]');
  T('H1 簿记随末腿重算：closedRatio=40 / positionSize=600 / 剩余费=2.4',
    w.logs[0].closedRatio === 40 && w.logs[0].positionSize === 600 && w.logs[0].fee === 2.4);
  T('H2 累计盈亏按事件前基数重算 = 18.4（旧口径误为 9.2；重复计入会是 41.4）',
    Math.abs(w.logs[0].realizedPnl - 18.4) < 0.011);
  T('H2 累计费用与毛利同步重算 = 1.6 / 20',
    Math.abs(w.logs[0].realizedFee - 1.6) < 1e-6 && Math.abs(w.logs[0].grossPnlAmount - 20) < 0.011);
  T('H2 R=0.37（以初始风险 50 为基准）', Math.abs(parseFloat(w.logs[0].rMultiple) - 0.37) < 0.011);
  // 反例：若仍用「平仓后剩余仓位」作基数，本腿盈亏会是正确值的一半（9.2）。
  // 这条断言专门钉住那个退化形态，避免修复被回退。
  T('H2 反例：基数错位下的旧值 9.2 不复现', Math.abs(w.logs[0].realizedPnl - 9.2) > 0.011);
  // 费用守恒：剩余费 + 已实现费 === 原始 round-trip 费 4
  T('H3 不变量 fee + realizedFee === 4（原始费用守恒）',
    Math.abs((parseFloat(w.logs[0].fee) || 0) + (parseFloat(w.logs[0].realizedFee) || 0) - 4) < 1e-6);
  // 四条不变量必须同时成立：账本与累计字段互相可还原
  T('H3 不变量 Σ closes[].pnl === realizedPnl / Σ ratio === closedRatio / Σ fee === realizedFee',
    Math.abs(legSum('pnl') - parseFloat(w.logs[0].realizedPnl)) < 0.011 &&
    Math.abs(legSum('ratio') - w.logs[0].closedRatio) < 1e-6 &&
    Math.abs(legSum('fee') - parseFloat(w.logs[0].realizedFee)) < 1e-6);
}

// =====================================================================
// 复核说明（2026-10-13）：原审计的撤回组（stats.js 直调 isClosedTrade）与（dashboard
// （dashboard getHeatWarnMax 在 try 外）经源码复核为【非真实 bug / 假阳性】，已撤回，
// 不再纳入回归断言：
//   G：utils.js:1043 已挂 window.isClosedTrade，且 utils 始终先于 stats 加载，真实环境不会缺失；
//      原断言是人为 delete utils 才触发的假设场景。
//   H：getHeatWarnMax 内部 loadSettings() 有兜底，实际不可达；仅为结构性瑕疵，非运行期缺陷。

console.log('\n==== 结果：' + pass + ' 项符合预期，' + fail + ' 项缺陷被实证确认 ====');
process.exit(fail ? 1 : 0);
