/* 编辑日志细分场景数值探针（运行在 jsdom 文档内）
   所有期望值手工推导：entry 50000 / 名义仓位 1000 USDT / 费率按手填 fee=10。
   价格变动 ±2000 = ±4%，故毛利 = 4% × 名义仓位。 */

// ---- 拦截副作用（避免依赖真实渲染/持久化 DOM）----
window.__toasts = [];
window.showToast = function (msg, level) { window.__toasts.push({ msg: msg, level: level || '' }); };
window.confirmDialog = function () { return Promise.resolve(true); };
window.saveLogs = function () { return true; };
window.renderLogs = function () {};
window.renderDashboard = function () {};
window.showUndoToast = function () { return null; };

// ---- 断言 ----
var __R = { pass: 0, fail: 0, fails: [], notes: [] };
function T(name, cond, detail) {
  if (cond) { __R.pass++; }
  else { __R.fail++; __R.fails.push(name + (detail ? '  →  ' + detail : '')); }
}
function near(label, actual, expected, tol) {
  T(label, typeof actual === 'number' && isFinite(actual) &&
    Math.abs(actual - expected) <= (tol == null ? 0.011 : tol),
    '期望 ' + expected + '，实际 ' + (actual === null ? 'null' : actual));
}

// ---- 驱动 ----
function freshItem() {
  return {
    id: 't' + Math.random().toString(36).slice(2, 8),
    time: '2026-10-10T10:00:00.000Z', symbol: 'BTC', direction: 'long',
    orderType: 'market', stopType: 'stop-market',
    entryPrice: 50000, stopLoss: 49000, targetPrice: 52000,
    positionSize: 1000, leverage: 10, riskAmount: 200, actualMargin: 100,
    capital: 10000, mindsetScore: 3
  };
}
function el(id) { return document.getElementById(id); }
function val(id) { var e = el(id); return e ? e.value : undefined; }
function set(id, v) { var e = el(id); if (e) e.value = String(v); }
function fire(id, type) { var e = el(id); if (e) e.dispatchEvent(new Event(type, { bubbles: true })); }
function modalCount() { return document.querySelectorAll('#editModal').length; }
function purgeModals() {
  // closeModalOverlay 只把 overlay.id 清成 ''、然后 setTimeout(200ms) 才 remove；
  // jsdom 同步脚本里定时器永不触发，旧弹窗的输入框（emPositionSize 等）仍带 id 挂在 DOM 上，
  // 后续 getElementById 就会命中上一个弹窗的陈旧 prefill 值。所以每次开/关都要强清。
  var ms = document.querySelectorAll('.modal-overlay');
  for (var i = 0; i < ms.length; i++) ms[i].remove();
}
function openFirst() {
  purgeModals();
  openEditModal(0);
  T('弹窗唯一（无残留旧弹窗）', modalCount() === 1, 'count=' + modalCount());
}
function closeModal() {
  try { closeEditModal(true); } catch (e) {}
  purgeModals();
}
function edit(mutate) {
  purgeModals();
  openEditModal(0);
  window.__toasts = [];
  if (mutate) mutate();
  var ok = saveEditLog(0);
  closeModal();
  return ok;
}
function S() { return logs[0]; }
function legSum(key) {
  var c = S().closes || [];
  return c.reduce(function (s, e) { return s + (parseFloat(e[key]) || 0); }, 0);
}
function closesJson() { return JSON.stringify(S().closes); }
function modeAdd() {
  var r = document.querySelector('input[name="emPartialLegMode"][value="add"]');
  if (r) r.checked = true;
}
function baseInitial() {
  var r = document.querySelector('input[name="emPartialRatioBase"][value="initial"]');
  if (r) r.checked = true;
}
function tickLossReason() {
  var cbs = document.querySelectorAll('#emLossReason input[type="checkbox"]');
  if (cbs.length) cbs[0].checked = true;
}
function dump(label) {
  var s = S();
  T('串扰检查·' + label + '（id 未被后续场景污染）', s.id === window.__loadedId,
    '期望 ' + window.__loadedId + ' 实际 ' + s.id);
  __R.notes.push(label + ' | id=' + s.id + ' closedRatio=' + s.closedRatio + ' pos=' + s.positionSize +
    ' fee=' + s.fee + ' pnl=' + s.pnlAmount + ' realizedPnl=' + s.realizedPnl +
    ' realizedFee=' + s.realizedFee + ' gross=' + s.grossPnlAmount +
    ' closeType=' + s.closeType + ' cp=' + s.closePrice +
    ' Σpnl=' + legSum('pnl') + ' closes=' + closesJson());
}
function load(item) { logs.length = 0; logs.push(item); window.__loadedId = item.id; return item; }
function loadFresh() { return load(freshItem()); }
function seedFirstLeg() {
  return edit(function () {
    set('emCloseType', 'partialTP'); set('emPartialRatio', 50);
    set('emClosePrice', 52000); set('emFee', 10);
    fire('emCloseType', 'change'); fire('emClosePrice', 'input');
  });
}
function seedCloseWin() {
  return edit(function () {
    set('emCloseType', 'initialTP'); set('emClosePrice', 52000); set('emFee', 10);
    fire('emCloseType', 'change'); fire('emClosePrice', 'input');
  });
}
function seedCloseThenWin() {
  seedFirstLeg();
  return edit(function () {
    set('emCloseType', 'manualWin'); set('emClosePrice', 53000);
    fire('emCloseType', 'change'); fire('emClosePrice', 'input');
  });
}

// ========================================================================
console.log('== S0. 持仓 → 编辑弹窗一次性全平 ==');
loadFresh();
T('S0 保存成功', seedCloseWin() === true);
var s = S();
dump('S0');
near('S0 pnlAmount=30', s.pnlAmount, 30);
near('S0 realizedPnl=30', s.realizedPnl, 30);
near('S0 grossPnlAmount=40', s.grossPnlAmount, 40);
near('S0 realizedFee=10', s.realizedFee, 10);
near('S0 closedRatio=100', s.closedRatio, 100);
near('S0 positionSize=0', s.positionSize, 0);
T('S0 closes 审计字段完整（price/pnl/fee/time）',
  (s.closes || []).every(function (e) { return e.price != null && e.pnl != null && e.fee != null && e.time != null; }),
  'closes=' + closesJson());

// ========================================================================
console.log('== S0b. 已平仓改价 → 累计字段是否同步 ==');
loadFresh();
seedCloseWin();
T('S0b 前置 pnlAmount=30', Math.abs((S().pnlAmount || 0) - 30) < 0.011, 'pnl=' + S().pnlAmount);
var ok = edit(function () {
  set('emClosePrice', 49000); fire('emClosePrice', 'input'); tickLossReason();
});
s = S();
dump('S0b');
T('S0b 保存成功', ok === true, 'toasts=' + JSON.stringify(window.__toasts));
near('S0b pnlAmount=-30', s.pnlAmount, -30);
near('S0b realizedPnl=-30', s.realizedPnl, -30);
near('S0b grossPnlAmount=-20', s.grossPnlAmount, -20);
near('S0b realizedFee=10', s.realizedFee, 10);
T('S0b 不变量 pnlAmount===realizedPnl',
  Math.abs((parseFloat(s.pnlAmount) || 0) - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'pnlAmount=' + s.pnlAmount + ' realizedPnl=' + s.realizedPnl);

// ========================================================================
console.log('== S0c. emRecalc 自动改类型（计划止盈→实际亏损）==');
loadFresh();
seedCloseWin();
openFirst();
set('emClosePrice', 49000); fire('emClosePrice', 'input');
T('S0c 预览已算出 -30', val('emPnlAmount') === '-30.00', 'emPnlAmount="' + val('emPnlAmount') + '"');
T('S0c 表单平仓类型已自动切到手平损', val('emCloseType') === 'manualLoss',
  'emCloseType=' + val('emCloseType'));
T('S0c 自动调整说明已显示',
  (el('emCloseTypeMismatchWarn') || {}).style && el('emCloseTypeMismatchWarn').style.display === 'block',
  'display=' + (el('emCloseTypeMismatchWarn') ? el('emCloseTypeMismatchWarn').style.display : '无元素'));
closeModal();

// ========================================================================
console.log('== S1. 已平仓 → 撤销平仓标记（类型选「—」）==');
load({
  id: 't1', time: '2026-10-10T10:00:00.000Z', symbol: 'BTC', direction: 'long',
  entryPrice: 50000, stopLoss: 49000, targetPrice: 52000, positionSize: 0, leverage: 10,
  riskAmount: 200, actualMargin: 100, fee: 10,
  closeType: 'initialTP', closePrice: 52000, closeTime: '2026-10-10T12:00:00.000Z',
  closedRatio: 100, closes: [{ type: 'initialTP', ratio: 100 }],
  pnlAmount: 30, realizedPnl: 30, realizedFee: 10, grossPnlAmount: 40
});
ok = edit(function () { set('emCloseType', ''); fire('emCloseType', 'change'); });
s = S();
dump('S1');
T('S1 保存成功', ok === true);
T('S1 closeType 已清空', s.closeType === '' || s.closeType == null, 'closeType=' + s.closeType);
T('S1 判定为「未平仓」', !window.utils.isClosed(s));
T('S1 closedRatio 已回退', s.closedRatio !== 100, 'closedRatio=' + s.closedRatio);
T('S1 positionSize 已恢复敞口', (parseFloat(s.positionSize) || 0) > 0, 'positionSize=' + s.positionSize);
T('S1 pnlAmount 已清空', s.pnlAmount == null, 'pnlAmount=' + s.pnlAmount);
T('S1 closePrice 已清空', s.closePrice == null, 'closePrice=' + s.closePrice);
T('S1 closeTime 已清空', s.closeTime == null, 'closeTime=' + s.closeTime);
T('S1 closes 事件链已清理', !(Array.isArray(s.closes) && s.closes.length > 0), 'closes=' + closesJson());

// ========================================================================
console.log('== S2. 单笔分批 → 编辑「修改最后一笔」比例 50→60 ==');
loadFresh();
T('S2 首次分批保存成功', seedFirstLeg() === true);
s = S();
dump('S2 首次');
near('S2 首次 closedRatio=50', s.closedRatio, 50);
near('S2 首次 剩仓=500', s.positionSize, 500);
near('S2 首次 剩余费=5', s.fee, 5);
near('S2 首次 realizedPnl=15', s.realizedPnl, 15);
near('S2 首次 grossPnlAmount=20', s.grossPnlAmount, 20);
near('S2 首次 pnlAmount=15', s.pnlAmount, 15);

T('S2 修改比例保存成功', edit(function () { set('emPartialRatio', 60); }) === true);
s = S();
dump('S2 修改后');
near('S2 修改后 closedRatio=60', s.closedRatio, 60);
near('S2 修改后 剩仓=400', s.positionSize, 400);
near('S2 修改后 剩余费=4', s.fee, 4);
near('S2 修改后 grossPnlAmount=24', s.grossPnlAmount, 24);
near('S2 修改后 realizedFee=6', s.realizedFee, 6);
near('S2 修改后 realizedPnl=18', s.realizedPnl, 18);
near('S2 修改后 pnlAmount=18', s.pnlAmount, 18);
T('S2 不变量 fee+realizedFee===原始费用 10',
  Math.abs((parseFloat(s.fee) || 0) + (parseFloat(s.realizedFee) || 0) - 10) < 0.011,
  'fee=' + s.fee + ' realizedFee=' + s.realizedFee);
T('S2 不变量 realizedPnl===grossPnlAmount−realizedFee',
  Math.abs((parseFloat(s.realizedPnl) || 0) -
    ((parseFloat(s.grossPnlAmount) || 0) - (parseFloat(s.realizedFee) || 0))) < 0.011,
  'pnl=' + s.realizedPnl + ' gross=' + s.grossPnlAmount + ' fee=' + s.realizedFee);
T('S2 不变量 Σcloses.pnl===realizedPnl',
  Math.abs(legSum('pnl') - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'Σ=' + legSum('pnl') + ' realizedPnl=' + s.realizedPnl);

// ========================================================================
console.log('== S3. 两笔分批 → 编辑末腿比例 50→40 ==');
loadFresh();
seedFirstLeg();
T('S3 新增腿2 保存成功', edit(function () {
  modeAdd();
  set('emPartialRatio', 50); set('emClosePrice', 53000); fire('emClosePrice', 'input');
}) === true);
s = S();
dump('S3 腿2后');
near('S3 腿2 closedRatio=75', s.closedRatio, 75);
near('S3 腿2 剩仓=250', s.positionSize, 250);
near('S3 腿2 realizedPnl=27.5', s.realizedPnl, 27.5);
near('S3 腿2 grossPnlAmount=35', s.grossPnlAmount, 35);
near('S3 腿2 realizedFee=7.5', s.realizedFee, 7.5);
near('S3 腿2 pnlAmount=27.5', s.pnlAmount, 27.5);

T('S3 修改末腿保存成功', edit(function () { set('emPartialRatio', 40); }) === true);
s = S();
dump('S3 修改后');
near('S3 修改后 closedRatio=70', s.closedRatio, 70);
near('S3 修改后 剩仓=300', s.positionSize, 300);
near('S3 修改后 剩余费=3', s.fee, 3);
near('S3 修改后 grossPnlAmount=32', s.grossPnlAmount, 32);
near('S3 修改后 realizedFee=7', s.realizedFee, 7);
T('S3 不变量 fee+realizedFee===原始费用 10',
  Math.abs((parseFloat(s.fee) || 0) + (parseFloat(s.realizedFee) || 0) - 10) < 0.011,
  'fee=' + s.fee + ' realizedFee=' + s.realizedFee);
near('S3 修改后 realizedPnl=25', s.realizedPnl, 25);
near('S3 修改后 pnlAmount=25', s.pnlAmount, 25);
T('S3 不变量 Σcloses.pnl===realizedPnl',
  Math.abs(legSum('pnl') - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'Σ=' + legSum('pnl') + ' realizedPnl=' + s.realizedPnl);

// ========================================================================
console.log('== S4. 两笔分批 → 新增第三腿 ==');
loadFresh();
seedFirstLeg();
edit(function () {
  modeAdd();
  set('emPartialRatio', 50); set('emClosePrice', 53000); fire('emClosePrice', 'input');
});
T('S4 新增腿3 保存成功', edit(function () {
  modeAdd();
  set('emPartialRatio', 50); set('emClosePrice', 54000); fire('emClosePrice', 'input');
}) === true);
s = S();
dump('S4');
T('S4 closes=3 条', (s.closes || []).length === 3, 'len=' + (s.closes || []).length);
near('S4 closedRatio=87.5', s.closedRatio, 87.5);
near('S4 剩仓=125', s.positionSize, 125);
near('S4 realizedPnl=36.25', s.realizedPnl, 36.25);

// ========================================================================
console.log('== S5. 分批中间态 → 收尾全平（累加不覆盖首腿）==');
loadFresh();
seedCloseThenWin();
s = S();
dump('S5');
near('S5 closedRatio=100', s.closedRatio, 100);
near('S5 positionSize=0', s.positionSize, 0);
near('S5 realizedPnl=40', s.realizedPnl, 40);
near('S5 pnlAmount=40', s.pnlAmount, 40);
near('S5 grossPnlAmount=50', s.grossPnlAmount, 50);
near('S5 realizedFee=10', s.realizedFee, 10);

// ========================================================================
console.log('== S6. 收尾后再改最终平仓价 → 累计字段是否同步 ==');
loadFresh();
seedCloseThenWin();
T('S6 前置 pnlAmount=40', Math.abs((S().pnlAmount || 0) - 40) < 0.011, 'pnl=' + S().pnlAmount);
T('S6 改价保存成功', edit(function () {
  set('emClosePrice', 54000); fire('emClosePrice', 'input');
}) === true);
s = S();
dump('S6');
near('S6 pnlAmount=50', s.pnlAmount, 50);
near('S6 realizedPnl=50', s.realizedPnl, 50);
near('S6 grossPnlAmount=60', s.grossPnlAmount, 60);
near('S6 realizedFee=10', s.realizedFee, 10);
T('S6 不变量 pnlAmount===realizedPnl',
  Math.abs((parseFloat(s.pnlAmount) || 0) - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'pnlAmount=' + s.pnlAmount + ' realizedPnl=' + s.realizedPnl);
T('S6 不变量 pnlAmount===grossPnlAmount−realizedFee',
  Math.abs((parseFloat(s.pnlAmount) || 0) -
    ((parseFloat(s.grossPnlAmount) || 0) - (parseFloat(s.realizedFee) || 0))) < 0.011,
  'pnl=' + s.pnlAmount + ' gross=' + s.grossPnlAmount + ' fee=' + s.realizedFee);

// ========================================================================
console.log('== S7. 簿记审计链完整性（非分批编辑不应销毁逐腿明细）==');
loadFresh();
seedCloseThenWin();
T('S7 前置：收尾后 closes 审计字段完整',
  (S().closes || []).every(function (e) { return e.price != null && e.pnl != null && e.fee != null && e.time != null; }),
  'closes=' + closesJson());
edit(function () { set('emClosePrice', 54000); fire('emClosePrice', 'input'); });
T('S7 再次编辑后 closes 审计字段仍完整',
  (S().closes || []).every(function (e) { return e.price != null && e.pnl != null && e.fee != null && e.time != null; }),
  'closes=' + closesJson());

// ========================================================================
console.log('== S8. 比例校验与回滚 ==');
loadFresh();
seedFirstLeg();
ok = edit(function () { set('emPartialRatio', ''); });
T('S8 比例留空被拒', ok === false, 'toasts=' + JSON.stringify(window.__toasts));
T('S8 拒绝后回滚', S().closedRatio === 50 && S().positionSize === 500,
  'closedRatio=' + S().closedRatio + ' pos=' + S().positionSize);

loadFresh();
seedFirstLeg();
ok = edit(function () { baseInitial(); set('emPartialRatio', 80); });
// 单笔「修改最后一笔」把唯一那腿改成原始口径 80%：旧腿是被替换对象，
// 累计 = 0（无其他历史腿）+ 80 = 80 ≤ 100，本就该放行。
T('S8b 单笔替换到 80% 合法（不越界）→ 放行且 closedRatio=80',
  ok === true && S().closedRatio === 80 && S().positionSize === 200,
  'ok=' + ok + ' closedRatio=' + S().closedRatio + ' pos=' + S().positionSize);

// 真正的越界：两腿已平 75%，再新增原始口径 40%（累计 115%）必须被拦
loadFresh();
seedFirstLeg();
edit(function () {
  modeAdd();
  set('emPartialRatio', 50); set('emClosePrice', 53000); fire('emClosePrice', 'input');
});
T('S8c 前置：两腿累计 75%', S().closedRatio === 75, 'closedRatio=' + S().closedRatio);
ok = edit(function () { modeAdd(); baseInitial(); set('emPartialRatio', 40); });
T('S8c 累计 115% 被拒', ok === false, 'toasts=' + JSON.stringify(window.__toasts));
T('S8c 拒绝后回滚（closedRatio 仍 75）', S().closedRatio === 75, 'closedRatio=' + S().closedRatio);

// ========================================================================
console.log('== S9. 平仓价为空应拦截 ==');
loadFresh();
ok = edit(function () {
  // 先选类型再清空价格：closeType 的 change 处理器会在 closePrice 为空时自动填回
  // targetPrice，所以必须换序，否则被测的是「空串被自动填充」而不是「空价是否拦截」。
  set('emCloseType', 'initialTP'); fire('emCloseType', 'change');
  set('emClosePrice', ''); fire('emClosePrice', 'input');
});
T('S9 平仓价为空被拒', ok === false, 'toasts=' + JSON.stringify(window.__toasts));

// ========================================================================
console.log('== S10. 预览口径 ==');
loadFresh();
seedFirstLeg();
openFirst();
var p1 = parseFloat(val('emPnlAmount'));
T('S10 中间态预览=本腿口径 15', isFinite(p1) && Math.abs(p1 - 15) < 1,
  'emPnlAmount="' + val('emPnlAmount') + '"');
var p2 = val('emPnlAmount');
set('emPartialRatio', 80);
fire('emPartialRatio', 'input');
T('S10b 改比例后预览随之更新', p2 !== val('emPnlAmount'),
  '改前="' + p2 + '" 改后="' + val('emPnlAmount') + '"');
closeModal();

// ========================================================================
console.log('== S11. 已全平记录改价后预览能算（pos=0 回退兜底）==');
load({
  id: 't11', time: '2026-10-10T10:00:00.000Z', symbol: 'BTC', direction: 'long',
  entryPrice: 50000, stopLoss: 49000, targetPrice: 52000, positionSize: 0, leverage: 10,
  riskAmount: 200, actualMargin: 100, fee: 10, initialPositionSize: 1000,
  closeType: 'initialTP', closePrice: 52000, closeTime: '2026-10-10T12:00:00.000Z',
  closedRatio: 100,
  closes: [{ type: 'initialTP', ratio: 100, price: 52000, pnl: 30, fee: 10, gross: 40,
             time: '2026-10-10T12:00:00.000Z' }],
  pnlAmount: 30, realizedPnl: 30, realizedFee: 10, grossPnlAmount: 40
});
openFirst();
set('emClosePrice', 49000); fire('emClosePrice', 'input');
T('S11 全平记录改价后预览已更新为 -30', val('emPnlAmount') === '-30.00',
  'emPnlAmount="' + val('emPnlAmount') + '"');
closeModal();

// ========================================================================
console.log('== S12. 亏损原因闸门（改价使盈利转亏损）==');
loadFresh();
seedCloseWin();
ok = edit(function () {
  set('emClosePrice', 49000); fire('emClosePrice', 'input');   // 未勾亏损原因
});
T('S12 盈利改亏损且未勾原因 → 保存被拒', ok === false,
  'toasts=' + JSON.stringify(window.__toasts));
T('S12 拒绝后记录回滚（pnlAmount 仍 30、类型仍 initialTP）',
  Math.abs((S().pnlAmount || 0) - 30) < 0.011 && S().closeType === 'initialTP',
  'pnlAmount=' + S().pnlAmount + ' closeType=' + S().closeType);

// 同一操作但勾了原因 → 应保存
loadFresh();
seedCloseWin();
ok = edit(function () {
  set('emClosePrice', 49000); fire('emClosePrice', 'input'); tickLossReason();
});
T('S12b 勾选亏损原因后保存成功', ok === true, 'toasts=' + JSON.stringify(window.__toasts));

// ========================================================================
console.log('== S13. 已全平记录·手动锁防线（emFee/emSlippageCost 刻意不进解锁名单）==');
// emBindRecalc 的解锁名单只有 emClosePrice/emEntryPrice/emPositionSize/emPartialRatio
// （+ change 型 emCloseType/emDirection）。emFee/emSlippageCost 被刻意排除：已全平记录
// 若被费用解锁，emRecalc 会按 initialPositionSize 重算整笔毛利，把分批链的累计
// realizedPnl 覆盖掉（modals.js 550 注释引用的实测：realizedPnl=40 会被写成 30）。
// 此前这防线只有注释自证，没有断言——解锁名单或锁判定任何一处回归，绿灯不会红。
loadFresh();
seedCloseThenWin();   // → closedRatio=100, closes=2 腿, realizedPnl=40, fee=5, realizedFee=10
openFirst();
// 打开时手动锁生效，emRecalc 提前 return，预览保持落库原值（未格式化），所以
// 断言用「打开时快照」对比，不写字面量格式。
var _pnlBefore13 = val('emPnlAmount');
T('S13 打开即锁定（_emPnlManual=true，「手动」标签亮）',
  window._emPnlManual === true && (el('emPnlManualTag') || {}).style &&
    el('emPnlManualTag').style.display === 'inline',
  '_emPnlManual=' + window._emPnlManual + '  tag=' + ((el('emPnlManualTag') || {}).style || {}).display);
T('S13 打开时预览仍为落库值 40', isFinite(parseFloat(_pnlBefore13)) &&
  Math.abs(parseFloat(_pnlBefore13) - 40) < 0.011, 'emPnlAmount="' + _pnlBefore13 + '"');
set('emFee', 12); fire('emFee', 'input');
T('S13 改 emFee 后预览不变（防解锁重算）', val('emPnlAmount') === _pnlBefore13,
  'emPnlAmount="' + val('emPnlAmount') + '"');
// 滑点也试一下锁，再还原（不 fire）：滑点若带着改值进保存路径，会经
// item.slippageCost 进入收尾腿重建（见 S13b），S13 里只单独验证 fee。
set('emSlippageCost', 100); fire('emSlippageCost', 'input');
T('S13 改 emSlippageCost 后预览不变', val('emPnlAmount') === _pnlBefore13,
  'emPnlAmount="' + val('emPnlAmount') + '"');
set('emSlippageCost', '');
T('S13 手动标签仍亮', (el('emPnlManualTag') || { style: {} }).style.display === 'inline');
var ok13 = saveEditLog(0); closeModal();
T('S13 保存成功', ok13 === true, 'toasts=' + JSON.stringify(window.__toasts));
s = S();
dump('S13');
near('S13 realizedPnl 不被费用改写=40', s.realizedPnl, 40);
near('S13 realizedFee 不被费用改写=10', s.realizedFee, 10);
near('S13 pnlAmount 不被费用改写=40', s.pnlAmount, 40);
// 收尾腿结算的 fees 权威 = 历史收尾事件里的 fee（modals.js _closeFeeOverride）；编辑里
// 改的 emFee 12 不进重建。item.fee=12 是 :1073 的无能力裸写并存语义，如实钉住。
T('S13 item.fee 保留手动覆盖值 12（裸写语义，逐腿账本不动）',
  Math.abs((parseFloat(s.fee) || 0) - 12) < 0.011, 'fee=' + s.fee);
T('S13 closes 账本未受影响（仍是 2 腿）', (s.closes || []).length === 2, 'len=' + (s.closes || []).length);

// S13b：改滑点会经 item.slippageCost 进入收尾腿重建（calculateCloseSettlement 的
// legacySlippageCost 直读该字段），重建结果 15 + (30−5−100) = −60 < 0 → 亏损原因闸门
// 拦下（#2 FIX 用权威 item.pnlAmount 判亏，此时重建后的 pnlAmount 已变负）。
// 预览却因手动锁停留在 40 —— 这正是「预览防锁 + 保存闸门」两级防线组合的实际行为：
// 不是静默把 −60 写进账本（那会污染统计），而是保存被拒、记录回滚。
loadFresh();
seedCloseThenWin();
openFirst();
set('emSlippageCost', 100); fire('emSlippageCost', 'input');
var ok13b = saveEditLog(0); closeModal();
T('S13b 改滑点致重建转亏 → 保存被拒', ok13b === false,
  'toasts=' + JSON.stringify(window.__toasts));
s = S();
dump('S13b');
near('S13b 回滚后 realizedPnl=40', s.realizedPnl, 40);
near('S13b 回滚后 pnlAmount=40', s.pnlAmount, 40);
near('S13b 回滚后 realizedFee=10', s.realizedFee, 10);
T('S13b 滑点未写入（item.slippageCost 未被污染）', s.slippageCost == null,
  'slippageCost=' + s.slippageCost);
T('S13b closes 账本完整（2 腿）', (s.closes || []).length === 2, 'len=' + (s.closes || []).length);

// S13c：锁是活的——改平仓价仍解锁并重算（防线不是死锁）
// 重开：emFee=5（S13b 未保存成功、费用|账本均原样）。
// 改平仓价 52000 → 预览毛 40 − 费 5 = 净 35.00（解锁后 emRecalc 格式化）。
openFirst();
T('S13c 重开仍锁定', window._emPnlManual === true);
set('emClosePrice', 52000); fire('emClosePrice', 'input');
T('S13c 解锁后重算：40−5=35.00', val('emPnlAmount') === '35.00',
  'emPnlAmount="' + val('emPnlAmount') + '"');
closeEditModal(true); purgeModals();

// ========================================================================
console.log('== S14. 5 腿分批满载链（MAX_SPLITS 只管建仓，closes[] 无上限）==');
// 手工推导（entry 50000, 初始仓 1000, 初始费 10, 各腿 ratioOfRemaining=50%）：
//   腿i: 毛=事件前仓位×价差比, 净=毛×50% − 腿费, 剩仓/费各 ×0.5
//   1000/10 → 500/5 → 250/2.5 → 125/1.25 → 62.5/0.625 → 31.25/0.3125 → 收尾 0
//   Σ净 = 15+12.5+8.75+5.625+3.4375+4.0625 = 49.375
//   Σ费 = 10（原始费用 10 全部实现）  →  毛 = 49.375 + 10 = 59.375
loadFresh();
T('S14 腿1 成功', seedFirstLeg() === true);
var _chainPrices = [53000, 54000, 55000, 56000];
var _chainCum = [75, 87.5, 93.75, 96.875];
var _chainRem = [250, 125, 62.5, 31.25];
var _chainNet = [27.5, 36.25, 41.875, 45.3125];
for (var _ci = 0; _ci < _chainPrices.length; _ci++) {
  (function (i) {
    var okLeg = edit(function () {
      modeAdd();
      set('emPartialRatio', 50);
      set('emClosePrice', _chainPrices[i]); fire('emClosePrice', 'input');
    });
    T('S14 腿' + (i + 2) + ' 成功', okLeg === true, 'toasts=' + JSON.stringify(window.__toasts));
    s = S();
    near('S14 腿' + (i + 2) + ' closedRatio=' + _chainCum[i], s.closedRatio, _chainCum[i]);
    near('S14 腿' + (i + 2) + ' 剩仓=' + _chainRem[i], s.positionSize, _chainRem[i]);
    near('S14 腿' + (i + 2) + ' realizedPnl=' + _chainNet[i], s.realizedPnl, _chainNet[i]);
  })(_ci);
}
// 收尾：第 6 事件（manualWin 全平剩余 31.25 @57000）
T('S14 收尾成功', edit(function () {
  set('emCloseType', 'manualWin'); set('emClosePrice', 57000);
  fire('emCloseType', 'change'); fire('emClosePrice', 'input');
}) === true);
s = S();
dump('S14');
near('S14 Σpnl=realizedPnl=49.375', s.realizedPnl, 49.375);
near('S14 grossPnlAmount=59.375（Σ净+Σ费）', s.grossPnlAmount, 59.375);
near('S14 realizedFee=10（原始费用全额实现）', s.realizedFee, 10);
near('S14 closedRatio=100', s.closedRatio, 100);
near('S14 剩仓=0', s.positionSize, 0);
T('S14 closes=6 条', (s.closes || []).length === 6, 'len=' + (s.closes || []).length);
T('S14 逐腿审计字段完整',
  (s.closes || []).every(function (e) { return e.price != null && e.pnl != null && e.fee != null && e.time != null; }),
  'closes=' + closesJson());
T('S14 不变量 Σcloses.pnl===realizedPnl',
  Math.abs(legSum('pnl') - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'Σ=' + legSum('pnl') + ' realizedPnl=' + s.realizedPnl);
T('S14 不变量 realizedPnl===gross−realizedFee',
  Math.abs((parseFloat(s.realizedPnl) || 0) -
    ((parseFloat(s.grossPnlAmount) || 0) - (parseFloat(s.realizedFee) || 0))) < 0.011,
  'pnl=' + s.realizedPnl + ' gross=' + s.grossPnlAmount + ' fee=' + s.realizedFee);
// 越界闸门在满载后仍有效。注意前提：满载收尾后 item.closeType=manualWin，弹窗预填的是
// 收尾态——继续保存走 manualWin 全平分支，比例校验根本不参与；必须先在弹窗里把类型
// 切回 partialTP（用户「还想再平一笔」的真实路径），越界校验才在路径上。
// 96.875% 已平 + 新增原始口径 30% → 累计 126.875%，必须被拦。
ok = edit(function () {
  modeAdd(); baseInitial();
  set('emCloseType', 'partialTP'); fire('emCloseType', 'change');
  set('emPartialRatio', 30);
});
T('S14 满载后越界仍被拦', ok === false, 'toasts=' + JSON.stringify(window.__toasts));
T('S14 拒绝后回滚（realizedPnl 仍 49.375）', Math.abs((S().realizedPnl || 0) - 49.375) < 0.011,
  'realizedPnl=' + S().realizedPnl);
// 对照：同一状态、剩余口径 30%（占改判后仅剩 3.125% 剩余仓位的 30%）→ 换算 0.9375%
// 原始口径 → 累计 97.8125 <100，合法放行。同一输入框两种口径一个被拦一个放行。
// 放行后的账本 = 改判重述：旧收尾腿（manualWin，net 4.06 / fee 0.3125 / gross 4.375）
// 随事件扣回，新腿（占剩余 30% @57000，基数 31.25）净 1.21875 入账：
//   realizedPnl = 49.38 − 4.06 + 1.21875 → 46.54（=Σcloses.pnl 46.53125，容差内）
//   realizedFee = 10 − 0.3125 + 0.09375 = 9.78125（=Σcloses.fee 恒等）
//   gross       = 59.38 − 4.38 + 1.3125 → 56.31（净+费恒等：46.53125+9.78125=56.3125）
//   剩余仓位 = 1000×(1−97.8125%) = 21.875；剩余费 = 10×2.1875% = 0.21875
//   （baseFee = fee 0.3125 + realizedFee 9.6875 = 原始 10，锚点因此精确）
ok = edit(function () {
  modeAdd();
  set('emCloseType', 'partialTP'); fire('emCloseType', 'change');
  set('emPartialRatio', 30);
});
T('S14b 满载后剩余口径 30% 合法放行', ok === true &&
  Math.abs((parseFloat(S().closedRatio) || 0) - 97.8125) < 0.011,
  'ok=' + ok + ' closedRatio=' + S().closedRatio + ' toasts=' + JSON.stringify(window.__toasts));
s = S();
dump('S14b');
near('S14b 改判重述 realizedPnl=46.53', s.realizedPnl, 46.54);
near('S14b 改判重述 realizedFee=9.78125', s.realizedFee, 9.78125, 1e-4);
near('S14b 改判重述 grossPnlAmount=56.31', s.grossPnlAmount, 56.31, 0.011);
near('S14b 改判后剩余仓位=21.875', s.positionSize, 21.875);
near('S14b 剩余费=10×2.1875%（锚点精确）', parseFloat(s.fee), 0.21875, 1e-4);
T('S14b 逐腿审计字段完整（新腿非裸骨架）',
  (s.closes || []).every(function (e) { return e.price != null && e.pnl != null && e.fee != null && e.time != null; }),
  'closes=' + closesJson());
T('S14b 前 5 条历史腿未被改判污染（比例/价格原样）',
  (s.closes || []).slice(0, 5).every(function (e, i) {
    return e.ratio === [50, 25, 12.5, 6.25, 3.125][i] && e.price === [52000, 53000, 54000, 55000, 56000][i];
  }),
  'closes=' + closesJson());
T('S14b 不变量 Σcloses.pnl===realizedPnl（改判后仍成立）',
  Math.abs(legSum('pnl') - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'Σ=' + legSum('pnl') + ' realizedPnl=' + s.realizedPnl);
T('S14b 不变量 realizedPnl===gross−realizedFee（阈值含 toFixed 双重舍入余量）',
  Math.abs((parseFloat(s.realizedPnl) || 0) -
    ((parseFloat(s.grossPnlAmount) || 0) - (parseFloat(s.realizedFee) || 0))) < 0.02,
  'pnl=' + s.realizedPnl + ' gross=' + s.grossPnlAmount + ' fee=' + s.realizedFee +
  '（46.53125 精确值 46.53125，三字段各自 toFixed 后交叉项最多漂 ±0.015）');
T('S14b 不变量 fee+realizedFee===原始费用 10',
  Math.abs((parseFloat(s.fee) || 0) + (parseFloat(s.realizedFee) || 0) - 10) < 0.011,
  'fee=' + s.fee + ' realizedFee=' + s.realizedFee);
T('S14b 不变量 pnlAmount===realizedPnl（DOM 回读不再污染累计口径）',
  Math.abs((parseFloat(s.pnlAmount) || 0) - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'pnlAmount=' + s.pnlAmount + ' realizedPnl=' + s.realizedPnl);
T('S14b 记录回退到部分平仓态（isPartialClosed）', window.utils.isPartialClosed(s));

// ========================================================================
console.log('== S15. 分批中间态·手动锁防线（fee/滑点改动不重算本腿预览）==');
// 中间态记录也有 pnlAmount（=本腿累计口径 15），打开同样进手动锁。改 emFee 不解锁，
// _isPartialMid 分支若被费用触发会用 emFee×feeFactor×newFrac 重写预览，与落库累计
// 口径立即分叉、保存前无从察觉。
loadFresh();
seedFirstLeg();          // → pos 500, closes=[L1@52000], realizedPnl=15, fee=5, pnlAmount=15
openFirst();
T('S15 中间态打开即锁定', window._emPnlManual === true);
var _pnlBefore15 = val('emPnlAmount');
T('S15 基线预览=本腿口径 15', isFinite(parseFloat(_pnlBefore15)) &&
  Math.abs(parseFloat(_pnlBefore15) - 15) < 0.011, 'emPnlAmount="' + _pnlBefore15 + '"');
set('emFee', 20); fire('emFee', 'input');
T('S15 改 emFee 后预览不变', val('emPnlAmount') === _pnlBefore15,
  'emPnlAmount="' + val('emPnlAmount') + '"');
set('emSlippageCost', 100); fire('emSlippageCost', 'input');
T('S15 改 emSlippageCost 后预览不变', val('emPnlAmount') === _pnlBefore15,
  'emPnlAmount="' + val('emPnlAmount') + '"');
// 还原费用/滑点 DOM 值（不 fire，不触发解锁）：emFee 一旦带着 20 进保存路径，
// 它会先于部分平仓重算写入 item.fee，把「原始费用 = 剩余 + 已实现」的锚点改写，
// 本腿净盈亏期望值就不再是纯比例口径——防线测试与费用覆盖语义解耦。
set('emFee', 5); set('emSlippageCost', '');
// 反例：解锁链依旧活性——改比例仍解锁重算，预览应与落库一致
set('emPartialRatio', 80); fire('emPartialRatio', 'input');
T('S15 改比例仍解锁重算（预览离开基线）', val('emPnlAmount') !== _pnlBefore15,
  'emPnlAmount="' + val('emPnlAmount') + '"');
// 预览 = 落库口径：本腿净 = 毛 40×80% − 费 10×80% = 24
T('S15 解锁后预览=24.00（与保存口径同构）', val('emPnlAmount') === '24.00',
  'emPnlAmount="' + val('emPnlAmount') + '"');
var _ok15 = saveEditLog(0); closeModal();
T('S15 保存成功', _ok15 === true);
s = S();
dump('S15');
near('S15 realizedPnl 按 80% 本腿重算=24', s.realizedPnl, 24);
T('S15 费用锚点未被污染（fee+realizedFee===10）',
  Math.abs((parseFloat(s.fee) || 0) + (parseFloat(s.realizedFee) || 0) - 10) < 0.011,
  'fee=' + s.fee + ' realizedFee=' + s.realizedFee);
T('S15 逐腿账本未被费用干预破坏（Σpnl===realizedPnl）',
  Math.abs(legSum('pnl') - (parseFloat(s.realizedPnl) || 0)) < 0.011,
  'Σ=' + legSum('pnl') + ' realizedPnl=' + s.realizedPnl);

window.__editResult = __R;
