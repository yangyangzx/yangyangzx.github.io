const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'test/run-tests.html'), 'utf8');

const SL = String.fromCharCode(47);
const Q  = String.fromCharCode(34);
const BT = String.fromCharCode(92);
const esc = function (ch) { return BT + ch; };
const open = '<script src=' + Q;
const close = '>' + '<' + SL + 'script>';

// 外链 script 就地内联：jsdom 的 window.eval 各自建词法作用域，顶层 const 跨 eval 不可见，
// 只有按文档顺序当经典脚本执行才能共享全局作用域。
const extRe = new RegExp(open + esc('.') + esc('.') + '/(js' + esc(SL) + '[^' + Q + ']+?)(?=\\?v=)', 'g');
const srcs = [...html.matchAll(extRe)];
console.log('外链 js 待内联: ' + srcs.length);
let inlined = html;
for (const m of srcs) {
  const f = m[1];
  const body = fs.readFileSync(path.join(root, f), 'utf8');
  if (body.indexOf('</script>') !== -1) throw new Error(f + ' 含 </script>');
  inlined = inlined.replace(m[0], '<script>' + body + '</script>');
}
// Chart.js CDN 不可达；chart-guard 靠 Chart 未定义注入占位桩，故不联网。
inlined = inlined.replace(new RegExp(open + 'https?:[^' + Q + ']+' + close, 'g'), '');
inlined = inlined.replace(/<link[^>]*>/g, '');

// jsdom 的 localStorage 是 Proxy，页面 test/run-tests.html:81 会 Object.defineProperty(localStorage,
// 'length', ...) 直接抛错让整个 runAll 崩掉；预置一个普通对象即可（各属性必须 configurable）。
const stores = new Map();
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
  stores.set(key, data);
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', function (e) { errors.push('jsdomError: ' + (e.stack || e.message || e)); });
vc.on('error', function () { errors.push('console.error: ' + [...arguments].join(' ')); });

const dom = new JSDOM(inlined, {
  url: 'http://localhost/test/run-tests.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse: function (win) {
    makeStore(win, 'localStorage');
    makeStore(win, 'sessionStorage');
  }
});

const doc = dom.window.document;
const summary = doc.getElementById('summary');
const out = doc.getElementById('out');
const text = summary ? summary.textContent : '';
// 计数按元素类名而非文本子串（textContent 不含 class 属性）。
const nPass = doc.querySelectorAll('#out .t-pass').length;
const nFail = doc.querySelectorAll('#out .t-fail').length;

console.log('summary: ' + JSON.stringify(text));
console.log('断言计数: PASS=' + nPass + ' FAIL=' + nFail + '（页面自报 summary 为权威）');
if (nFail) {
  console.log('\n--- FAIL 明细（前 40 条）---');
  [...doc.querySelectorAll('.t-fail')].slice(0, 60).forEach(function (e) { console.log('  FAIL ' + e.textContent.trim()); });
}
if (errors.length) {
  console.log('\n--- 页面错误（前 8 条）---');
  errors.slice(0, 4).forEach(function (e) { console.log(String(e).slice(0, 2200)); });
}
// 整段没执行时 summary 仍是初始占位、out 停在「加载中…」——静默失败也当失败上报。
const ran = /PASS=\d+ FAIL=\d+/.test(text) && (nPass + nFail) > 0;
if (!ran) console.log('ERROR: runAll 未产出任何断言结果（整段代码未执行）');
process.exit(ran && nFail === 0 ? 0 : 1);
