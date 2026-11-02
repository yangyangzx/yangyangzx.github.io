// 独立验证脚本：驱动真实模块复现候选 bug（不依赖 runAll）
// 用法: node test/_verify_bugs.js
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const SL = String.fromCharCode(47);
const Q  = String.fromCharCode(34);
const BT = String.fromCharCode(92);
const esc = function (ch) { return BT + ch; };
const open = '<script src=' + Q;
const close = '>' + '<' + SL + 'script>';

const extRe = new RegExp(open + '(?:' + esc('.') + esc('.') + esc(SL) + ')?(js' + esc(SL) + '[^' + Q + ']+?)(?=\\?v=)', 'g');
const srcs = [...html.matchAll(extRe)];
let inlined = html;
for (const m of srcs) {
  const f = m[1];
  const body = fs.readFileSync(path.join(root, f), 'utf8');
  if (body.indexOf('</script>') !== -1) throw new Error(f + ' 含 </script>');
  inlined = inlined.replace(m[0], '<script>' + body + '</script>');
}
inlined = inlined.replace(new RegExp(open + 'https?:[^' + Q + ']+' + close, 'g'), '');
inlined = inlined.replace(/<link[^>]*>/g, '');

function makeStore(win, key) {
  const data = Object.create(null);
  const store = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    clear: function () { for (const k in data) delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
  Object.defineProperty(store, 'length', { get: function () { return Object.keys(data).length; }, configurable: true });
  try { Object.defineProperty(win, key, { value: store, configurable: true, writable: true }); } catch (e) { win[key] = store; }
  return data;
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', function (e) { errors.push('jsdomError: ' + (e.stack || e.message || e)); });

let dom;
try {
  dom = new JSDOM(inlined, {
    url: 'http://localhost/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse: function (win) {
      makeStore(win, 'localStorage');
      makeStore(win, 'sessionStorage');
      // jsdom 未实现 scrollIntoView（真实浏览器均支持）。补 no-op 使 calculate 尾部
      // 的 updateKellySidebar/autoCalcMultiTP/updateChecklist 得以执行——否则
      // calc.checklistResults 永不写入，保存闸门报「检查清单结果缺失」，污染
      // A2/A3 这类「验证闸门放行」的断言（无头环境产物，非产品缺陷）。
      if (win.Element && win.Element.prototype && !win.Element.prototype.scrollIntoView) {
        win.Element.prototype.scrollIntoView = function () {};
      }
    }
  });
} catch (e) {
  console.error('JSDOM 构造失败:', e);
  process.exit(2);
}

const w = dom.window;
const d = w.document;
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

function waitFor(fn, ms) {
  return new Promise(function (resolve) {
    var t0 = Date.now();
    (function poll() {
      if (fn()) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(poll, 50);
    })();
  });
}

(async function main() {
  const ready = await waitFor(function () { return typeof w.calculate === 'function'; }, 8000);
  if (!ready) {
    console.error('FAIL | 页面脚本未就绪 calculate=' + typeof w.calculate + ' errs=' + errors.length);
    if (errors.length) console.error(errors.slice(0, 5).join('\n'));
    process.exit(2);
  }
  try {
  // ===== 基础场景 =====
  function fillBase(symbol) {
    d.getElementById('capital').value = '10000';
    d.getElementById('symbol').value = symbol;
    d.getElementById('direction').value = 'long';
    d.getElementById('entryPrice').value = '50000';
    d.getElementById('stopLoss').value = '49000';
    d.getElementById('riskInput').value = '2%';
    d.getElementById('orderType').value = 'market';
    d.getElementById('stopType').value = 'stop-market';
    // 入场原因选一个合法值，保证 checkReason 通过、保存闸门走到后续检查
    d.getElementById('reasonSelect').value = '趋势突破';
  }
  function calcOK() {
    w.calculate();
    const c = w.getCalc();
    return c && c.positionSize > 0;
  }

  // ---------- Test A: 小写品种 + 保存闸门 ----------
  fillBase('btc');                       // 用户手输小写
  const a1 = calcOK();                   // 计算成功，快照 symbol = "BTC"
  const gateA = w.assertSavableCalculation();
  check('A1 小写品种可正常计算', a1, a1 ? ('positionSize=' + w.getCalc().positionSize) : 'calculate 失败');
  // 修复①（2026-11-02）：闸门改为大小写不敏感比较 → 小写品种保存应放行
  check('A2 小写品种保存闸门放行（修复验证）', !!gateA.ok, JSON.stringify(gateA));

  // 修正为大写后应通过
  fillBase('BTC');
  const a2 = calcOK();
  const gateB = w.assertSavableCalculation();
  check('A3 大写品种保存闸门放行', gateB.ok, JSON.stringify(gateB));

  // ---------- Test B: 凯利取消后热量预检用过期值 ----------
  // 收紧热量上限，让「凯利驱动值 5%」超限而「真实 2%」不超限
  const settings = JSON.parse(w.localStorage.getItem('trade_settings_v1') || '{}');
  settings.riskHeatMax = 4;
  w.localStorage.setItem('trade_settings_v1', JSON.stringify(settings));
  if (typeof w._clearSettingsCache === 'function') w._clearSettingsCache();  // loadSettings 有缓存
  w.loadSettings();
  console.log('DIAG getHeatHardMax=' + w.getHeatHardMax() + ' heat(500)=' + JSON.stringify(w.calcPortfolioHeat(500, 'BTC', 10000)) + ' heat(200)=' + JSON.stringify(w.calcPortfolioHeat(200, 'BTC', 10000)));

  fillBase('BTC');
  d.getElementById('kellyEnableCalc').checked = true;
  d.getElementById('kellyWinRate').value = '0.6';
  d.getElementById('kellyAvgWin').value = '100';
  d.getElementById('kellyAvgLoss').value = '30';
  d.getElementById('riskInput').value = '2%';           // preKelly
  const b1 = w.calculate();
  const c1 = w.getCalc();
  check('B1 凯利驱动后 riskInput 变为驱动值', /%/.test(d.getElementById('riskInput').value), 'riskInput=' + d.getElementById('riskInput').value);
  check('B2 凯利驱动后 preKelly 已保存', !!d.getElementById('riskInput').dataset.preKelly, 'preKelly=' + d.getElementById('riskInput').dataset.preKelly);

  // 用户取消凯利 → 重新计算：热量预检必须读到「还原后」的真实风险（修复②验证）
  d.getElementById('kellyEnableCalc').checked = false;
  const b2 = w.calculate();
  const c2b = w.getCalc();
  const blocker = w.getCalcBlocker();
  console.log('DIAG B3 riskInput=' + d.getElementById('riskInput').value + ' blocker=' + JSON.stringify(blocker && { code: blocker.code, detail: blocker.detail }));
  check('B3 取消凯利后重算正常放行（修复验证）', !!(c2b && c2b.positionSize > 0),
    c2b ? ('positionSize=' + c2b.positionSize) : JSON.stringify(blocker && { code: blocker.code, detail: blocker.detail }));
  check('B3b 取消凯利后 riskInput 已还原为 2%（无残留驱动值）', d.getElementById('riskInput').value === '2%',
    'riskInput=' + d.getElementById('riskInput').value);
  // 对照：直接把 riskInput 改回 2% 再算 → 应放行
  d.getElementById('riskInput').value = '2%';
  const b3 = w.calculate();
  const c3 = w.getCalc();
  check('B4 对照：手动 2% 可放行', !!(c3 && c3.positionSize > 0), c3 ? ('positionSize=' + c3.positionSize) : JSON.stringify(w.getCalcBlocker()));

  // ---------- Test C: 全胜策略凯利统计 avgLoss=0 → 凯利静默失效 ----------
  // 清空日志，注入 5 笔全胜已平仓（autoFill 的 minSamples=5 需要）
  w.localStorage.removeItem('trade_logs_plus_v4');
  const now = new Date();
  const mkClosed = (i, pnl) => ({
    id: 'v_' + i, time: now.toISOString(), closeTime: new Date(now.getTime() - i * 86400000).toISOString(),
    symbol: 'BTC', direction: 'long', entryPrice: 50000, effectiveEntryPrice: 50000, stopLoss: 49000,
    positionSize: 1000, leverage: 3, riskAmount: 100, initialRiskAmount: 100,
    closeType: 'tp', closePrice: 52000, rMultiple: 2, pnlAmount: pnl, pnlPercent: 20,
    closeNote: '', fee: 0.5, splitMode: false, calculationVersion: 2
  });
  w.logs = [mkClosed(1, 50), mkClosed(2, 80), mkClosed(3, 70), mkClosed(4, 60), mkClosed(5, 90)];
  const stats = w.calcKellyStatsFromLogs(5, undefined, 0);
  check('C1 全胜样本 winRate=1, avgLoss=0, noLosses=true', stats && stats.winRate === 1 && stats.avgLoss === 0 && stats.noLosses === true, JSON.stringify(stats));
  const kelly = w.calcKelly(1, 66.67, 0, 10000, true, 1, 0);
  check('C2 calcKelly(全胜) 返回 null（凯利不适用）', kelly === null, 'kelly=' + JSON.stringify(kelly));
  // 修复④：自动填充不再写 0.00，并给出「样本无亏损」明确提示
  d.getElementById('kellyWinRate').value = '';
  d.getElementById('kellyAvgWin').value = '';
  d.getElementById('kellyAvgLoss').value = '';
  w.autoFillKellyFromLogs();
  const _avgLossEl = d.getElementById('kellyAvgLoss');
  const _tipEl = d.querySelector('.kelly-tip');
  check('C3 无亏损样本自动填充不填 avgLoss=0 且有明确提示（修复验证）', _avgLossEl.value === '' && !!_tipEl && /样本无亏损/.test(_tipEl.textContent),
    'avgLoss=' + JSON.stringify(_avgLossEl.value) + ' tip=' + (_tipEl ? _tipEl.textContent : 'no-tip'));

  // ---------- Test D: slippage 与 RR 一致性（顺带数值核对） ----------
  const slip = w.Slippage.calculate({ direction: 'long', expectedEntryPrice: 50000, expectedExitPrice: 51000, quantity: 0.4, tickSize: 0.1, entryTicks: 2, exitTicks: 1 });
  check('D1 滑点模型有效成交价方向正确', slip.effectiveEntryPrice > 50000 && slip.effectiveExitPrice < 51000,
    'entry=' + slip.effectiveEntryPrice + ' exit=' + slip.effectiveExitPrice);

  // ---------- Test E: ChartManager 同 key 重注册立即销毁（修复⑤） ----------
  const destroyedSeq = [];
  function fakeChart(name) { return { destroy: function () { destroyedSeq.push(name); } }; }
  const canvOld = d.createElement('canvas');
  w.ChartManager.register('ckey', fakeChart('old'), canvOld);
  const canvNew = d.createElement('canvas');
  const regNew = w.ChartManager.register('ckey', fakeChart('new'), canvNew);
  check('E1 同 key 重注册同步销毁旧实例（无延迟竞态，修复验证）', regNew && destroyedSeq.length === 1 && destroyedSeq[0] === 'old',
    'destroyed=' + JSON.stringify(destroyedSeq));
  await new Promise(function (res) { setTimeout(res, 1200); });   // 越过 destroyTimeout(1000ms)
  check('E2 延迟窗口过后新实例 canvas 标记完好、未被延迟销毁误伤', canvNew.__chartKey === 'ckey' && destroyedSeq.length === 1,
    'key=' + canvNew.__chartKey + ' destroyed=' + JSON.stringify(destroyedSeq));

} catch (e) {
  console.error('验证过程异常:', e && e.stack || e);
  results.push({ name: 'EXCEPTION', ok: false, detail: String(e && e.stack || e) });
}

console.log('\n==== 汇总 ====');
let pass = results.filter(r => r.ok).length;
console.log('PASS=' + pass + ' FAIL=' + (results.length - pass) + ' TOTAL=' + results.length);
if (errors.length) {
  console.log('\n--- 页面错误（前 5 条）---');
  errors.slice(0, 5).forEach(e => console.log(String(e).slice(0, 800)));
}
process.exit(results.some(r => !r.ok) ? 1 : 0);
})();
