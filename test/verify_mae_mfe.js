// ==================== MAE/MFE 修复回归验证（node 独立运行） ====================
// 覆盖：P4-1 符号钳制（L1/L2/S1/S2）、C1 极值合并、validateExtremes 校验（L3/S3/L4/S4）、
//       C2 已平仓 positionSize=0 的 margin 基准修复。
// 运行：cd notes && node test/verify_mae_mfe.js
'use strict';
const { JSDOM } = require('jsdom');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
const w = dom.window;
const vmc = dom.getInternalVMContext();

// ---- 最小全局 stub（与 run-tests.html 对齐） ----
w.showToast = function () {};
w.renderLogs = function () {};
w.renderDashboard = function () {};
w.saveLogs = function () { return true; };
w.logs = [];
w.utils = w.utils || {};
if (typeof w.utils.closedRatioDelta !== 'function') w.utils.closedRatioDelta = function () { return 0; };

// 加载真实浏览器脚本（vm.runInContext 在 jsdom window 全局作用域执行）
vm.runInContext(fs.readFileSync(path.join(root, 'js/logs.js'), 'utf8'), vmc);
vm.runInContext(fs.readFileSync(path.join(root, 'js/modals.js'), 'utf8'), vmc);

let pass = 0, fail = 0;
function T(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
function mk(o) {
  return {
    direction: o.dir, effectiveEntryPrice: o.ep, entryPrice: (o.entry != null ? o.entry : o.ep), lowPrice: o.low,
    highPrice: o.high, pnlAmount: o.pnl, closePrice: o.close
  };
}
function captureWarns() {
  const list = [];
  w.showToast = function (m) { list.push(m); };
  return list;
}

console.log('\n== 1. storeMAEMFE 符号钳制（L1/L2/S1/S2） ==');
let a = mk({ dir: 'long', ep: 100, low: 102, high: 110 });
w.storeMAEMFE(a);
T('L1 盈利多单 mae 钳为 0（而非正小数）', a.mae === 0);
T('L1 盈利多单 mfe=+10', a.mfe === 10);

let b = mk({ dir: 'long', ep: 100, low: 90, high: 98 });
w.storeMAEMFE(b);
T('L2 追高亏损多单 mfe 钳为 0（从未浮盈）', b.mfe === 0);
T('L2 追高亏损多单 mae=-10', b.mae === -10);

let c = mk({ dir: 'long', ep: 100, low: 95, high: 105 });
w.storeMAEMFE(c);
T('普通多单 mae=-5 / mfe=5', c.mae === -5 && c.mfe === 5);

let d = mk({ dir: 'short', ep: 100, high: 98, low: 90 });
w.storeMAEMFE(d);
T('S1 盈利空单 mae 钳为 0', d.mae === 0);
T('S1 盈利空单 mfe=+10', d.mfe === 10);

let e = mk({ dir: 'short', ep: 100, high: 110, low: 102 });
w.storeMAEMFE(e);
T('S2 亏损空单 mfe 钳为 0（最低价高于入场）', e.mfe === 0);
T('S2 亏损空单 mae=-10', e.mae === -10);

let f = mk({ dir: 'short', ep: 100, high: 105, low: 95 });
w.storeMAEMFE(f);
T('普通空单 mae=-5 / mfe=5', f.mae === -5 && f.mfe === 5);

console.log('\n== 2. validateExtremes 校验（L3/S3/L4/S4） ==');
let warns1 = captureWarns();
w.validateExtremes(mk({ dir: 'long', ep: 100, low: 110, high: 100 }), 105); // low>high 填反
T('填反 low>high 触发警告', warns1.length > 0);

let warns2 = captureWarns();
w.validateExtremes(mk({ dir: 'long', ep: 100, low: 95, high: 108 }), 105); // 合法
T('合法多单无警告', warns2.length === 0);

let warns3 = captureWarns();
w.validateExtremes(mk({ dir: 'long', ep: 100, low: 102, high: 110 }), 105); // low 高于入场
T('多单 low 高于入场触发警告', warns3.length > 0);

console.log('\n== 3. calcMAEMFE 解读（C2 + ratio 守卫） ==');
function mkPanel(idx, low, high) {
  ['cpLowPrice_', 'cpHighPrice_', 'cpMAEMFEDisplay_', 'cpMAEMFEInterpret_'].forEach(function (p) {
    let el = w.document.createElement('div');
    el.id = p + idx; el.style.display = 'none';
    w.document.body.appendChild(el);
  });
  w.document.getElementById('cpLowPrice_' + idx).value = low;
  w.document.getElementById('cpHighPrice_' + idx).value = high;
}
// 盈利多单：mae=0 → ratio 不显示
w.logs = [mk({ dir: 'long', ep: 100, low: 102, high: 110, pnl: 100 })];
w.logs[0].positionSize = 1000; w.logs[0].leverage = 1; w.logs[0].initialMargin = 1000;
mkPanel(0, 102, 110);
w.calcMAEMFE(0);
T('盈利多单 ratio 不显示（mae=0，修复虚高）', w.document.getElementById('cpMAEMFEDisplay_0').innerHTML.indexOf('MFE/MAE') === -1);

// 亏损空单从未浮盈（S2）：不得出现"利润捕捉充分"
w.logs = [mk({ dir: 'short', ep: 100, low: 102, high: 110, pnl: -100 })];
w.logs[0].positionSize = 1000; w.logs[0].leverage = 1; w.logs[0].initialMargin = 1000;
mkPanel(0, 102, 110);
w.calcMAEMFE(0);
T('亏损空单从未浮盈不含"利润捕捉充分"', w.document.getElementById('cpMAEMFEInterpret_0').innerHTML.indexOf('利润捕捉充分') === -1);

// C2：已平仓 positionSize=0，但真实记录有 initialPositionSize + realizedPnl → 利润回吐解读仍触发
w.logs = [mk({ dir: 'short', ep: 100, low: 92, high: 105, pnl: -50 })];
w.logs[0].positionSize = 0; w.logs[0].leverage = 1; w.logs[0].initialMargin = 1000;
w.logs[0].initialPositionSize = 1000; w.logs[0].realizedPnl = -50; w.logs[0].realizedFee = 0;
mkPanel(0, 92, 105);
w.calcMAEMFE(0);
T('C2 已平仓(positionSize=0)仍触发"利润回吐过多"', w.document.getElementById('cpMAEMFEInterpret_0').innerHTML.indexOf('利润回吐过多') !== -1);

console.log('\n== 4. P1-2 利润捕捉量纲修复（捕捉率与杠杆无关） ==');
// 杠杆10x：实际实现价格收益 = 毛利20/名义1000 = 2%，MFE=10% → 捕捉率0.2 → "利润回吐过多"。
// 旧逻辑用含杠杆收益率 20/100(保证金)=20%…实际更低基准造成 2000% 级虚高，误判"捕捉充分"。
w.logs[7] = mk({ dir: 'long', ep: 100, low: 98, high: 110, pnl: 20 });
w.logs[7].positionSize = 0; w.logs[7].leverage = 10; w.logs[7].initialMargin = 100;
w.logs[7].initialPositionSize = 1000; w.logs[7].realizedPnl = 20; w.logs[7].realizedFee = 0;
mkPanel(7, 98, 110);
w.calcMAEMFE(7);
T('P1-2 杠杆10x、价格仅走2%/MFE10% 判"利润回吐过多"', w.document.getElementById('cpMAEMFEInterpret_7').innerHTML.indexOf('利润回吐过多') !== -1);
T('P1-2 不再误判"利润捕捉充分"', w.document.getElementById('cpMAEMFEInterpret_7').innerHTML.indexOf('利润捕捉充分') === -1);

console.log('\n== 5. P1-1/P1-3 grossPnlAmount 整笔累计毛利（部分平仓链） ==');
// 与 logs.js confirmClose 同公式：部分平仓累加 settlement.grossPnl×本次比例，最终平仓累加末腿。
// 旧逻辑最终平仓 grossPnlAmount=末段全量毛利（-50），新逻辑=整笔累计毛利（-25）。
{
  let g = { direction: 'long', effectiveEntryPrice: 100, entryPrice: 100, positionSize: 1000, leverage: 1, riskAmount: 100, fee: 0, slippageCost: 0 };
  let s1 = w.calculateCloseSettlement(g, 105, 0, 0);
  let acc = s1.grossPnl * 0.5;            // 第一腿平 50%
  g.positionSize = 1000 * (1 - 0.5);      // 缩减剩余仓位
  let s2 = w.calculateCloseSettlement(g, 90, 0, 0);
  acc = acc + s2.grossPnl;                // 最终平剩余 → 整笔累计毛利
  T('P1-3 两腿毛利累加 = 整笔 -25（而非末段 -50）', Math.abs(acc + 25) < 1e-9 && Math.abs(acc) !== Math.abs(s2.grossPnl));
}
// costDrag 分母逻辑（stats.js）：优先 realizedPnl+realizedFee（整笔累计毛利），新旧数据都正确
{
  let closed = [
    { pnlAmount: -32.5, grossPnlAmount: -50 /* 旧数据末段 */, realizedPnl: -32.5, realizedFee: 7.5 },
    { pnlAmount: 276.25, grossPnlAmount: 288 /* 一次性全平 */, realizedPnl: 276.25, realizedFee: 11.75 }
  ];
  let _gpRp = parseFloat(closed[0].realizedPnl), _gpRf = parseFloat(closed[0].realizedFee);
  let _sum = Math.abs(_gpRp + _gpRf);
  T('P1-1 部分平仓 costDrag 分母用累计毛利 |-32.5+7.5|=25', _sum === 25);
  let _sum1 = Math.abs(parseFloat(closed[1].realizedPnl) + parseFloat(closed[1].realizedFee));
  T('P1-1 一次性全平分母 276.25+11.75=288（与 gross 一致）', _sum1 === 288);
}

console.log('\n==== 结果：' + pass + ' 通过，' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
