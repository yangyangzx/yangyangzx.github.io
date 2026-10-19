// 编辑日志（openEditModal/saveEditLog）细分场景数值探针
// 用法: node test/_edit_scenarios.js
// 环境构造复用 test/_rt_headless.js 的成熟套路：把 test/run-tests.html 里的外链 js
// 按文档顺序就地内联，删掉测试页自己的内联脚本，再把 test/_edit_scenarios_body.js
// 追加为最后一个脚本。这样能拿到完整依赖（settings/storage/calculator/risk…）而不用
// 手写十几个 stub。
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'test/run-tests.html'), 'utf8');

const SL = String.fromCharCode(47);
const Q = String.fromCharCode(34);
const BT = String.fromCharCode(92);
const esc = function (ch) { return BT + ch; };
const openTag = '<script src=' + Q;

// 1) 外链 js 替换成占位符
const extRe = new RegExp(openTag + esc('.') + esc('.') + '/(js' + esc(SL) + '[^' + Q + ']+?)(?=\\?v=)', 'g');
const names = [];
let n = 0;
html = html.replace(extRe, function () { names.push(arguments[1]); return '@@INLINED' + (n++) + '@@'; });

// 2) 删掉测试页自己的内联脚本（保留占位符），CDN script 与 link 一并去掉
html = html.replace(/<script>([\s\S]*?)<\/script>/g, function (m, inner) {
  return /^@@INLINED\d+@@$/.test(inner.trim()) ? m : '';
});
html = html.replace(new RegExp('<script src=' + Q + 'https?:[^' + Q + ']+?' + Q + '><' + SL + 'script>', 'g'), '');
html = html.replace(/<link[^>]*>/g, '');

// 3) 还原内联 js
html = html.replace(/@@INLINED(\d+)@@/g, function (m, idx) {
  const f = names[+idx];
  const body = fs.readFileSync(path.join(root, f), 'utf8');
  if (body.indexOf('</script>') !== -1) throw new Error(f + ' 含 </script>');
  return '<script>' + body + '</script>';
});

// 4) 追加场景脚本
const scenario = fs.readFileSync(path.join(root, 'test/_edit_scenarios_body.js'), 'utf8');
html = html.replace('</body>', '<script>' + scenario + '</script></body>');

console.log('内联 js 文件数: ' + names.length);

// 5) localStorage 必须是普通对象（页面会 Object.defineProperty(localStorage,'length',…)）
function makeStore(win, key) {
  const data = Object.create(null);
  const store = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    clear: function () { for (const k in data) delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null }
  };
  Object.defineProperty(store, 'length', { get: function () { return Object.keys(data).length; }, configurable: true });
  try { Object.defineProperty(win, key, { value: store, configurable: true, writable: true }); }
  catch (e) { win[key] = store; }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', function (e) { errors.push('jsdomError: ' + (e.stack || e.message || e)); });
vc.on('error', function () { errors.push('console.error: ' + [...arguments].join(' ')); });
vc.on('log', function () { console.log('  [page] ' + [...arguments].join(' ')); });

const dom = new JSDOM(html, {
  url: 'http://localhost/test/edit_scenarios.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse: function (win) { makeStore(win, 'localStorage'); makeStore(win, 'sessionStorage'); }
});

const win = dom.window;
const r = win.__editResult;

if (!r) {
  console.log('ERROR: 场景脚本未产出结果（整段未执行）');
  if (errors.length) {
    console.log('\n--- 加载期错误（前 5 条） ---');
    errors.slice(0, 5).forEach(function (e) { console.log(String(e).slice(0, 1800)); });
  }
  console.log('typeof saveEditLog=' + (typeof win.saveEditLog) +
    '  typeof openEditModal=' + (typeof win.openEditModal) +
    '  typeof utils=' + (typeof win.utils));
  process.exit(2);
}

console.log('\n' + '='.repeat(64));
console.log('PASS=' + r.pass + '  FAIL=' + r.fail);
if (r.notes.length) {
  console.log('\n--- 各场景落库快照 ---');
  r.notes.forEach(function (n) { console.log('  · ' + n); });
}
if (r.fails.length) {
  console.log('\n--- FAIL 明细 ---');
  r.fails.forEach(function (f) { console.log('  ✗ ' + f); });
}
if (win.__toasts && win.__toasts.length) {
  console.log('\n--- 最近触发的 toast ---');
  win.__toasts.slice(-6).forEach(function (t) { console.log('  [' + t.level + '] ' + t.msg); });
}
if (errors.length) {
  console.log('\n--- 页面错误（前 5 条） ---');
  errors.slice(0, 5).forEach(function (e) { console.log(String(e).slice(0, 1800)); });
}
// 退出码必须反映断言结果：原先无条件 exit(0)，失败被吞掉，
// 聚合跑测器/预提交钩子无从判断这个文件是否通过。
process.exit(r.fail > 0 ? 1 : 0);
