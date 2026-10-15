/* 平仓类型 vs 实算盈亏方向一致性探针（运行在 jsdom 文档内）
   覆盖四层：
     G  utils.resolveCloseType 纯函数（唯一权威实现）
     H  utils.normalizeExistingCloseTypes 存量归一
     I  内联平仓面板 calcClosePnL / confirmClose 集成
     J  渲染层徽章与盈亏金额同向（用户报告的原始症状）
   基准：entry 50000 / 名义仓位 1000 USDT / fee 10 / 滑点 0。
   平仓价 ±2000 = ±4% → 毛利 ±40；价 48000 → 毛利 -40、净盈亏 -50。 */

window.__toasts = [];
window.showToast = function (msg, level) { window.__toasts.push({ msg: msg, level: level || '' }); };
window.showUndoToast = function () { return null; };
window.confirmDialog = function () { return Promise.resolve(true); };
// 筛选下拉填充与筛选器无关，本探针不需要；置空避免它去摸测试页里不存在的下拉
window.populateFilterOptions = function () {};
// navigation.js 未内联，而 renderLogs 靠 _currentView 决定要不要刷统计。取一个不匹配的
// 值让 updateStats（stats.js，未内联）被跳过——不取 'journal'/'stats' 以免触发未定义引用
var _currentView = 'close-type-probe';

var __R = { pass: 0, fail: 0, fails: [], notes: [] };
function T(name, cond, detail) {
  if (cond) { __R.pass++; }
  else { __R.fail++; __R.fails.push(name + (detail ? '  →  ' + detail : '')); }
}
function el(id) { return document.getElementById(id); }
function val(id) { var e = el(id); return e ? e.value : undefined; }
function set(id, v) { var e = el(id); if (e) e.value = String(v); }
function fire(id, type) { var e = el(id); if (e) e.dispatchEvent(new Event(type, { bubbles: true })); }
function txt(id) { var e = el(id); return e ? e.textContent : undefined; }
function shown(id) { var e = el(id); return !!(e && e.style.display === 'block'); }
// 基线上提示条/比例行等元素可能整体不存在，detail 字符串不能踩 (el(x)||{}).style
function disp(id) { var e = el(id); return e ? e.style.display : '(元素不存在)'; }

function ensureTable() {
  if (el('logBody')) return;
  var wrap = document.createElement('div');
  wrap.id = 'view-journal';
  // 日志视图的最小骨架：renderLogs 会无守卫地摸 statsPanel / summaryBar，必须预置
  wrap.innerHTML = '<div id="statsPanel"></div><div id="summaryBar"></div>' +
    '<div id="logCount"></div><div id="filterResult"></div>' +
    '<table id="logTable"><thead><tr></tr></thead><tbody id="logBody"></tbody></table>';
  document.body.appendChild(wrap);
}
function resetPanelState() {
  openClosePanelIdx = -1;
  if (typeof _closePriceEdited !== 'undefined') {
    for (var k in _closePriceEdited) delete _closePriceEdited[k];
  }
}
function loadItem(item) {
  logs.length = 0;
  logs.push(item);
  ensureTable();
  resetPanelState();
  renderLogs();
  return item;
}
function freshItem() {
  return {
    id: 'ct' + Math.random().toString(36).slice(2, 8),
    time: '2026-10-10T10:00:00.000Z', symbol: 'BTC', direction: 'long',
    orderType: 'market', stopType: 'stop-market',
    entryPrice: 50000, stopLoss: 49000, targetPrice: 52000,
    positionSize: 1000, leverage: 10, riskAmount: 200, actualMargin: 100,
    capital: 10000, mindsetScore: 3, fee: 10, slippageCost: 0
  };
}
function openPanel() { openClosePanelIdx = 0; renderLogs(); }
function rowHtml() {
  var r = document.querySelector('#logBody tr[data-log-idx="0"]');
  return r ? r.innerHTML : '';
}
function bannerOn() { return shown('cpTypeMismatch_0'); }

// ========================================================================
console.log('== G. resolveCloseType 纯函数（唯一权威实现）==');
function adj(t, p) { return window.utils.resolveCloseType(t, p); }
// 权威实现缺失时降级为单条 FAIL，而不是让整段抛错——崩掉的脚本比失败的断言更危险
// （后续行为断言不会执行，等于没验）。同理适用于 H。
if (typeof window.utils.resolveCloseType === 'function') {
T('G1 初始止盈+亏损 → 手平损', adj('initialTP', -50).type === 'manualLoss' && adj('initialTP', -50).adjusted);
T('G2 初始止盈+盈利 → 不改', adj('initialTP', 30).adjusted === false && adj('initialTP', 30).type === 'initialTP');
T('G3 初始止盈+保本(0) → 不改（0 不算亏损，边界有意为之）', adj('initialTP', 0).adjusted === false);
T('G4 部分止盈+亏损 → 减仓（保留分批语义，不同属 PARTIAL_TYPES）', adj('partialTP', -50).type === 'reducePosition' && adj('partialTP', -50).adjusted);
T('G5 部分止盈+盈利 → 不改', adj('partialTP', 20).adjusted === false);
T('G6 初始止损+亏损 → 不改', adj('initialSL', -50).adjusted === false);
T('G7 初始止损+盈利 → 手平赢', adj('initialSL', 30).type === 'manualWin' && adj('initialSL', 30).adjusted);
T('G8 追踪止损+盈利 → 手平赢', adj('trailingSL', 30).type === 'manualWin');
T('G9 追踪止损+亏损 → 不改', adj('trailingSL', -50).adjusted === false);
// 人工判断型不自动改写（emRecalc 侧仅 warn）
T('G10 手平赢+亏损 → 不改（人工判断型，不静默改写）', adj('manualWin', -50).adjusted === false);
T('G11 手平损+盈利 → 不改', adj('manualLoss', 30).adjusted === false);
T('G12 爆仓+盈利 → 不改（强平是既成事件，不动标签）', adj('liquidation', 30).adjusted === false);
T('G13 时间止损+盈利 → 不改', adj('timeStop', 30).adjusted === false);
T('G14 减仓+亏损 → 不改（中性语义，本身不断言盈亏方向）', adj('reducePosition', -50).adjusted === false);
// fail-safe：无法判定时原样返回，绝不猜
T('G15 盈亏缺失(null) → 原样返回', adj('initialTP', null).adjusted === false && adj('initialTP', null).type === 'initialTP');
T('G16 盈亏为 NaN → 原样返回', adj('initialTP', NaN).adjusted === false);
T('G17 类型为空串 → 原样返回', adj('', -50).adjusted === false);
T('G18 类型未定义 → 原样返回不抛错', adj(undefined, -50).adjusted === false);
T('G19 幂等：改完再判不再改', adj(adj('initialTP', -50).type, -50).adjusted === false);
(function () {
  var o = 'initialTP';
  var r = adj(o, -50);
  T('G20 纯函数不改入参', o === 'initialTP' && r.from === 'initialTP');
})();
} else {
  T('G0 权威实现 utils.resolveCloseType 存在', false, '未定义（HEAD 基线预期）');
}

// ========================================================================
console.log('== H. normalizeExistingCloseTypes 存量归一 ==');
function closedSingle(ct, pnl, extra) {
  var e = freshItem();
  e.closeType = ct;
  e.closePrice = 48000;
  e.closeTime = '2026-10-10T12:00:00.000Z';
  e.closedRatio = 100;
  e.positionSize = 0;
  e.pnlAmount = pnl;
  e.realizedPnl = pnl;
  e.realizedFee = 10;
  e.grossPnlAmount = pnl + 10;
  e.closes = [{ type: ct, ratio: 100, price: 48000, pnl: pnl, fee: 10,
                gross: pnl + 10, time: '2026-10-10T12:00:00.000Z' }];
  if (extra) for (var k in extra) e[k] = extra[k];
  return e;
}
// 权威实现缺失时同样降级为单条 FAIL（同上：崩掉的脚本等于没验），保证 I/J 照常跑
if (typeof window.utils.normalizeExistingCloseTypes === 'function') {
var arr = [closedSingle('initialTP', -50)];
var n = window.utils.normalizeExistingCloseTypes(arr);
T('H1 改动了 1 条', n === 1, 'n=' + n);
T('H2 closeType 归一为手平损', arr[0].closeType === 'manualLoss', 'closeType=' + arr[0].closeType);
T('H3 closes 收尾事件 type 同步归一', arr[0].closes[0].type === 'manualLoss', 'ev=' + arr[0].closes[0].type);
// 只动标签：账目一分不动
T('H4 pnlAmount 未动', arr[0].pnlAmount === -50, 'pnl=' + arr[0].pnlAmount);
T('H5 realizedPnl 未动', arr[0].realizedPnl === -50, 'rp=' + arr[0].realizedPnl);
T('H6 grossPnlAmount 未动', arr[0].grossPnlAmount === -40, 'gross=' + arr[0].grossPnlAmount);
T('H7 realizedFee 未动', arr[0].realizedFee === 10, 'rf=' + arr[0].realizedFee);
T('H8 closes 逐腿账目未动', arr[0].closes[0].pnl === -50 && arr[0].closes[0].fee === 10,
  'pnl=' + arr[0].closes[0].pnl + ' fee=' + arr[0].closes[0].fee);
T('H9 closedRatio 未动', arr[0].closedRatio === 100);
T('H10 ratio 未动', arr[0].closes[0].ratio === 100);
T('H11 幂等：再跑返回 0', window.utils.normalizeExistingCloseTypes(arr) === 0);
T('H12 非数组入参返回 0', window.utils.normalizeExistingCloseTypes(null) === 0);

// 反向边界：末腿盈、整笔亏 → 绝不能误改（这是判定基准取「那一腿」的意义）
var legCase = closedSingle('initialTP', -10, {});
legCase.closes = [
  { type: 'partialTP', ratio: 50, price: 47500, pnl: -40, fee: 5, gross: -30,
    time: '2026-10-10T11:00:00.000Z', ratioOfRemaining: 50 },
  { type: 'initialTP', ratio: 50, price: 52000, pnl: 30, fee: 5, gross: 40,
    time: '2026-10-10T12:00:00.000Z' }
];
legCase.realizedPnl = -10;
legCase.closedRatio = 100;
T('H13 末腿盈+整笔亏 → 不改（若用累计值会误改成手平损）',
  window.utils.normalizeExistingCloseTypes([legCase]) === 0, 'closeType=' + legCase.closeType);
T('H14 该情形下 closeType 仍是初始止盈', legCase.closeType === 'initialTP');

// 末腿亏、整笔盈 → 必须改
var legCase2 = closedSingle('initialTP', 20, {});
legCase2.closes = [
  { type: 'partialTP', ratio: 50, price: 52500, pnl: 40, fee: 5, gross: 50,
    time: '2026-10-10T11:00:00.000Z', ratioOfRemaining: 50 },
  { type: 'initialTP', ratio: 50, price: 48000, pnl: -20, fee: 5, gross: -10,
    time: '2026-10-10T12:00:00.000Z' }
];
legCase2.realizedPnl = 20;
T('H15 末腿亏 → 改（closeType 与收尾事件 type 同步）',
  window.utils.normalizeExistingCloseTypes([legCase2]) === 1 && legCase2.closeType === 'manualLoss' &&
  legCase2.closes[1].type === 'manualLoss', 'ct=' + legCase2.closeType + ' ev1=' + legCase2.closes[1].type);
T('H16 分批事件 type 未被波及', legCase2.closes[0].type === 'partialTP', 'ev0=' + legCase2.closes[0].type);
T('H17 逐腿盈亏未被波及', legCase2.closes[0].pnl === 40 && legCase2.closes[1].pnl === -20);

// 旧数据无 closes → 退回 pnlAmount
var legacy = closedSingle('initialTP', -50, {});
delete legacy.closes;
T('H18 无 closes 的旧数据按 pnlAmount 归一',
  window.utils.normalizeExistingCloseTypes([legacy]) === 1 && legacy.closeType === 'manualLoss');

// 不在归一范围
var midState = freshItem();
midState.closeType = 'partialTP';
midState.closePrice = 48000;
midState.partialRatio = 50;
midState.positionSize = 500;
midState.closedRatio = 50;
midState.pnlAmount = -25;
midState.closes = [{ type: 'partialTP', ratio: 50, price: 48000, pnl: -25, fee: 5,
                     gross: -15, time: '2026-10-10T12:00:00.000Z', ratioOfRemaining: 50 }];
T('H19 分批中间态不归一（未平仓，本腿盈亏口径未定）',
  window.utils.normalizeExistingCloseTypes([midState]) === 0, 'closeType=' + midState.closeType);
var openPos = freshItem();
T('H20 未平仓记录不归一', window.utils.normalizeExistingCloseTypes([openPos]) === 0);
var emptyType = closedSingle('', -50, {});
T('H21 closeType 为空不归一', window.utils.normalizeExistingCloseTypes([emptyType]) === 0);
var goodOne = closedSingle('initialTP', 50);
T('H22 本就一致不改', window.utils.normalizeExistingCloseTypes([goodOne]) === 0 && goodOne.closeType === 'initialTP');
T('H23 混合批次只改该改的',
  window.utils.normalizeExistingCloseTypes([goodOne, closedSingle('initialTP', -50), openPos]) === 1);
} else {
  T('H0 权威实现 utils.normalizeExistingCloseTypes 存在', false, '未定义（HEAD 基线预期）');
}

// ========================================================================
console.log('== I. 内联平仓面板（用户报告的场景）==');
loadItem(freshItem());
openPanel();
T('I1 面板已渲染（类型下拉存在）', !!el('cpCloseType_0'));
T('I2 初始无提示条', !bannerOn());

// 核心场景：做多 + 初始止盈 + 平仓价低于入场
set('cpCloseType_0', 'initialTP');
fire('cpCloseType_0', 'change');
set('cpClosePrice_0', 48000);
fire('cpClosePrice_0', 'input');
T('I3 盈亏算出 -50.00', val('cpPnlAmount_0') === '-50.00', 'pnl="' + val('cpPnlAmount_0') + '"');
T('I4 类型已自动改到手平损（不再落库 initialTP）', val('cpCloseType_0') === 'manualLoss',
  'cpCloseType="' + val('cpCloseType_0') + '"');
T('I5 提示条已显示', bannerOn(), 'display=' + disp('cpTypeMismatch_0'));
var _mt = txt('cpTypeMismatchText_0');
T('I6 提示文案含类型迁移方向', !!_mt && _mt.indexOf('初始止盈') !== -1 &&
  _mt.indexOf('手平损') !== -1, 'text="' + _mt + '"');
T('I7 亏损原因行随之展开（手平损要求填原因）', shown('cpLossReasonRow_0'));

// 用户手动改回矛盾类型 → 面板不允许其停留
set('cpCloseType_0', 'initialTP');
fire('cpCloseType_0', 'change');
T('I8 手动选回初始止盈会被重新归一（矛盾态不可停留）', val('cpCloseType_0') === 'manualLoss',
  'cpCloseType="' + val('cpCloseType_0') + '"');

// 程序式赋值不触发自激循环：连续多次触发仍稳定
fire('cpClosePrice_0', 'input');
fire('cpClosePrice_0', 'input');
T('I9 重复触发稳定（无自激循环、值不漂移）', val('cpCloseType_0') === 'manualLoss' &&
  val('cpPnlAmount_0') === '-50.00');

// 确认平仓落库
window.__toasts = [];
var cbs = document.querySelectorAll('#cpLossReason_0 input[type="checkbox"]');
if (cbs.length) cbs[0].checked = true;
confirmClose(0);
var saved = logs[0];
__R.notes.push('I 落库 | closeType=' + saved.closeType + ' pnl=' + saved.pnlAmount +
  ' realizedPnl=' + saved.realizedPnl + ' closes=' + JSON.stringify(saved.closes));
T('I10 落库类型是手平损', saved.closeType === 'manualLoss', 'closeType=' + saved.closeType);
T('I11 不再落库 initialTP', saved.closeType !== 'initialTP');
T('I12 closes 收尾事件 type 与 closeType 一致',
  Array.isArray(saved.closes) && saved.closes.length > 0 &&
  saved.closes[saved.closes.length - 1].type === 'manualLoss',
  'closes=' + JSON.stringify(saved.closes));
T('I13 落库盈亏 -50', Math.abs((parseFloat(saved.pnlAmount) || 0) - (-50)) < 0.011, 'pnl=' + saved.pnlAmount);
T('I14 无异常 toast', window.__toasts.filter(function (t) { return t.level === 'error'; }).length === 0,
  'toasts=' + JSON.stringify(window.__toasts));

// 反向：初始止损 + 平仓价高于入场 → 手平赢
loadItem(freshItem());
openPanel();
set('cpCloseType_0', 'initialSL');
fire('cpCloseType_0', 'change');
set('cpClosePrice_0', 52000);
fire('cpClosePrice_0', 'input');
T('I15 反向：初始止损+盈利 → 手平赢', val('cpCloseType_0') === 'manualWin',
  'cpCloseType="' + val('cpCloseType_0') + '"');
T('I16 提示条显示（反向亦然）', bannerOn());
T('I17 盈利时亏损原因行不展开', !shown('cpLossReasonRow_0'));

// 部分止盈 + 亏损 → 减仓，比例行保持可见（分批语义保留）
loadItem(freshItem());
openPanel();
set('cpCloseType_0', 'partialTP');
fire('cpCloseType_0', 'change');
set('cpPartialRatio_0', 50);
set('cpClosePrice_0', 48000);
fire('cpClosePrice_0', 'input');
T('I18 部分止盈+亏损 → 减仓', val('cpCloseType_0') === 'reducePosition',
  'cpCloseType="' + val('cpCloseType_0') + '"');
T('I19 比例行仍可见（分批语义未被抹掉）', shown('cpPartialRatioRow_0'),
  'display=' + disp('cpPartialRatioRow_0'));
T('I20 比例值未被改动', val('cpPartialRatio_0') === '50', 'ratio="' + val('cpPartialRatio_0') + '"');

// 不矛盾：初始止盈 + 盈利 → 完全不动
loadItem(freshItem());
openPanel();
set('cpCloseType_0', 'initialTP');
fire('cpCloseType_0', 'change');
set('cpClosePrice_0', 52000);
fire('cpClosePrice_0', 'input');
T('I21 不矛盾时类型保持初始止盈', val('cpCloseType_0') === 'initialTP',
  'cpCloseType="' + val('cpCloseType_0') + '"');
T('I22 不矛盾时无提示条', !bannerOn());
T('I23 盈亏 +30', val('cpPnlAmount_0') === '+30.00' || val('cpPnlAmount_0') === '30.00',
  'pnl="' + val('cpPnlAmount_0') + '"');

// 早退路径：平仓价为空 → 提示条必须收起（不能残留上一轮）
loadItem(freshItem());
openPanel();
set('cpCloseType_0', 'initialTP');
fire('cpCloseType_0', 'change');
set('cpClosePrice_0', 48000);
fire('cpClosePrice_0', 'input');
T('I24 前置：提示条已显示', bannerOn());
set('cpClosePrice_0', '');
fire('cpClosePrice_0', 'input');
T('I25 价格为空的早退路径收起提示条', !bannerOn(),
  'display=' + disp('cpTypeMismatch_0'));
T('I26 同时清空盈亏显示', val('cpPnlAmount_0') === '', 'pnl="' + val('cpPnlAmount_0') + '"');

// ========================================================================
console.log('== J. 渲染层：徽章与盈亏金额同向（原始症状）==');
loadItem(freshItem());
openPanel();
set('cpCloseType_0', 'initialTP');
fire('cpCloseType_0', 'change');
set('cpClosePrice_0', 48000);
fire('cpClosePrice_0', 'input');
var cbs2 = document.querySelectorAll('#cpLossReason_0 input[type="checkbox"]');
if (cbs2.length) cbs2[0].checked = true;
confirmClose(0);
T('J1 列表已重渲染出该记录', !!document.querySelector('#logBody tr[data-log-idx="0"]'));
var h = rowHtml();
T('J2 徽章是「损」（badge-ct loss），不再是「止盈」', h.indexOf('badge-ct loss') !== -1,
  '含 tp=' + (h.indexOf('badge-ct tp') !== -1));
T('J3 行内不再出现止盈徽章', h.indexOf('badge-ct tp') === -1);
T('J4 盈亏按负值着色', h.indexOf('pnl-negative') !== -1);
T('J5 徽章与金额同为负向（不再一个绿一个红）',
  h.indexOf('badge-ct loss') !== -1 && h.indexOf('pnl-negative') !== -1);

// 对照组：盈利平仓 → 绿止盈 + 正盈亏
loadItem(freshItem());
openPanel();
set('cpCloseType_0', 'initialTP');
fire('cpCloseType_0', 'change');
set('cpClosePrice_0', 52000);
fire('cpClosePrice_0', 'input');
confirmClose(0);
h = rowHtml();
T('J6 对照组：盈利仍是止盈徽章', h.indexOf('badge-ct tp') !== -1);
T('J7 对照组：盈亏按正值着色', h.indexOf('pnl-positive') !== -1);

// 存量归一后渲染同样同向
var dirty = closedSingle('initialTP', -50);
loadItem(dirty);
T('J8 归一前列表显示绿止盈（bug 复现）', rowHtml().indexOf('badge-ct tp') !== -1);
if (typeof window.utils.normalizeExistingCloseTypes === 'function') {
window.utils.normalizeExistingCloseTypes(logs);
renderLogs();
h = rowHtml();
T('J9 归一后显示损徽章', h.indexOf('badge-ct loss') !== -1 && h.indexOf('badge-ct tp') === -1);
T('J10 归一未改盈亏金额（仍是 -50.00）', h.indexOf('-50.00') !== -1, 'html含 -50.00=' + (h.indexOf('-50.00') !== -1));
} else {
T('J9 归一后显示损徽章', false, '无归一实现');
T('J10 归一未改盈亏金额（仍是 -50.00）', false, '无归一实现');
}

window.__closeTypeResult = __R;
