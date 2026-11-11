// ==================== 品牌图标与缓存戳接线回归（v5.6.44 新增，常驻脚本） ====================
//
// 立项原因：v5.6.44 把全站图标统一成一套浅米底派生成品，新增 6 个资源引用点并
//   同步「版本四处」。图标与 ?v= 全靠手工同步，漏改任何一处都是静默缓存事故；
//   而既有 30.8 组断言只守护 run-tests.html 自己的 script 标签，完全看不到
//   index.html / manifest.json / 图标文件本身（尺寸、透明通道、ICO 帧）。
//   收尾时又发现零引用的源图 assets/logo.png（584KB 透明大图，页面从不加载），
//   已清理；故补一条「assets/ 不得有未被引用的冗余文件」，防止同类堆积复发。
//   源图原件副本在 ~/Downloads/LOGO.png，需要重做图标时先把它复制回来。
//
// v5.6.48 补丁：补三类「文档 / 结构」守护，都是本轮真实踩过的坑——
//   ① 升版时把 CHANGELOG 的 run-tests.html 缓存戳写成 18 处，实测只有 17 处
//      （18 是版本号字面量总数，被误当成外链戳数）；文档与实测必须机器自洽。
//   ② index.html 省略 </body>，任何按 </body> 找锚点的注入工具都会静默失败。
//   ③ 43 个 js/css 外链没有存在性守护，路径拼错只会静默 404。
//
// 纪律：--inject 逐条独立注入 10 个确定错误，对应断言必须各自变红。
//   逐条独立（而非一次性全注）是为了避免交叉影响掩盖某条断言没有捕获力。
//   注入只改内存副本，绝不碰磁盘文件。
//
// 用法：node test/verify_assets.js            正常跑（全绿才算接线完整）
//       node test/verify_assets.js --inject   注入错误，必须 10/10 全被捕获
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const INJECT = process.argv.includes('--inject');

// 只列在用的 7 个成品；源图 logo.png 已清理，别再加回来。
const ASSETS = [
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png',
  'assets/apple-touch-icon.png', 'assets/favicon-32.png', 'assets/favicon-16.png',
  'assets/favicon.ico'
];
const EXPECTED_SIZE = {
  'assets/icon-192.png': 192,
  'assets/icon-512.png': 512,
  'assets/icon-maskable-512.png': 512,
  'assets/apple-touch-icon.png': 180,
  'assets/favicon-32.png': 32,
  'assets/favicon-16.png': 16
};

function rel(p) { return path.join(ROOT, p); }
function text(p) { return fs.readFileSync(rel(p), 'utf8'); }
function loadInputs() {
  const bytes = {};
  ASSETS.forEach(r => { if (fs.existsSync(rel(r))) bytes[r] = fs.readFileSync(rel(r)); });
  const m = /\bAPP_VERSION\s*=\s*'([^']+)'/.exec(text('js/version.js'));
  return {
    version: m ? m[1] : '',
    html: text('index.html'),
    testHtml: text('test/run-tests.html'),
    manifestText: text('manifest.json'),
    changelog: text('CHANGELOG.md'),
    dirFiles: fs.readdirSync(rel('assets')),
    bytes
  };
}
function clone(D) {
  return Object.assign({}, D, {
    bytes: Object.assign({}, D.bytes),
    dirFiles: D.dirFiles.slice()
  });
}

// PNG IHDR：宽高在 offset 16/20，colorType 在 25（4=灰度+α、6=RGBA 都带透明通道）
function pngInfo(buf) {
  if (!buf || buf.length < 26 || buf.slice(1, 4).toString() !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] };
}
// ICO：header 6 字节 + 每帧 16 字节目录项，首字节为宽高（0 表示 256）
function icoFrames(buf) {
  if (!buf || buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return [];
  const n = buf.readUInt16LE(4), out = [];
  for (let i = 0; i < n && 6 + i * 16 + 2 <= buf.length; i++) out.push(buf[6 + i * 16] || 256);
  return out;
}
// 只看真实标签属性，注释里的 "?v=" 字面量不算
function assetRefs(html) {
  const out = [], re = /(?:src|href)="(assets\/[^"?]+)(?:\?[^"]*)?"/g;
  let m; while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
function cacheStamps(html) {
  const out = [], re = /(?:src|href)="[^"]*\?v=([^"&]+)"/g;
  let m; while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function runChecks(D, quiet) {
  let pass = 0;
  const failures = [];
  const ck = (key, label, cond, extra) => {
    if (cond) { pass++; return; }
    failures.push(key);
    if (!quiet) console.log('  \u2717 ' + label + (extra ? ' \u2192 ' + extra : ''));
  };
  const has = r => Object.prototype.hasOwnProperty.call(D.bytes, r);

  ck('version-format', 'APP_VERSION 形如 x.y.z', /^\d+\.\d+\.\d+$/.test(D.version), D.version);

  const hs = cacheStamps(D.html);
  ck('index-stamps', 'index.html 所有外链 ?v= 与 APP_VERSION 一致（含图标/manifest）',
    hs.length >= 40 && hs.every(v => v === D.version),
    '共 ' + hs.length + ' 处，漂移: ' + [...new Set(hs.filter(v => v !== D.version))].join(','));
  const ts = cacheStamps(D.testHtml);
  ck('test-stamps', 'run-tests.html 所有外链脚本 ?v= 与 APP_VERSION 一致',
    ts.length >= 15 && ts.every(v => v === D.version),
    '共 ' + ts.length + ' 处，漂移: ' + [...new Set(ts.filter(v => v !== D.version))].join(','));
  // 只认版本号字面量：同页还有一条 `APP_VERSION === 'string'` 的类型断言，
  // 若用 /'([^']+)'/ 会先命中 'string'，绊线检查就恒假。
  const trip = /APP_VERSION === '(\d+\.\d+\.\d+)'/.exec(D.testHtml);
  ck('tripwire', '30.8 组 APP_VERSION 字面量绊线已同步', !!trip && trip[1] === D.version,
    trip ? trip[1] : '未找到绊线');

  const refs = assetRefs(D.html);
  const missing = refs.filter(r => !has(r));
  ck('asset-missing', 'index.html 引用的每个图标文件都存在',
    refs.length >= 5 && missing.length === 0,
    '引用 ' + refs.length + ' 个，缺失: ' + missing.join(','));
  ck('no-source-favicon', 'index.html 不引用已清理的源图 assets/logo.png（会 404；成品才是唯一权威）',
    !/(?:src|href)="assets\/logo\.png/.test(D.html));

  let man = null;
  try { man = JSON.parse(D.manifestText); } catch (e) { /* 下一条断言负责报错 */ }
  ck('manifest-json', 'manifest.json 可解析且有 icons 数组',
    !!man && Array.isArray(man.icons) && man.icons.length >= 3);
  const icons = man && Array.isArray(man.icons) ? man.icons : [];
  const srcs = icons.map(i => String(i.src || '').split('?')[0]);
  // 零引用源图被清理后补的护栏：assets/ 下任何文件都必须被 index.html 或 manifest 引用。
  const referenced = refs.concat(srcs);
  const orphans = D.dirFiles.filter(f => referenced.indexOf('assets/' + f) < 0);
  ck('no-orphan-assets', 'assets/ 下没有未被页面 / manifest 引用的冗余文件',
    D.dirFiles.length >= 7 && orphans.length === 0, orphans.join(','));
  ck('manifest-src', 'manifest 每个 icon 的 src 指向真实文件',
    srcs.length >= 3 && srcs.every(has), '缺失: ' + srcs.filter(r => !has(r)).join(','));
  ck('manifest-stamp', 'manifest 图标 src 带当前版本缓存戳（同名覆盖必须破缓存）',
    icons.length > 0 && icons.every(i => String(i.src).indexOf('v=' + D.version) > 0));
  const anys = icons.filter(i => i.purpose === 'any');
  const masks = icons.filter(i => i.purpose === 'maskable');
  const anySrcs = anys.map(i => String(i.src).split('?')[0]);
  // 必须比「全部 any」而不是只比 anys[0]：注入把 maskable 指回 icon-512 时，
  // 若只比第一个 any（icon-192）会误判为已分离。
  ck('maskable-split', 'maskable 专用图不与任何 any 图标共用文件（否则圆环会被裁掉）',
    anys.length > 0 && masks.length > 0 &&
    masks.every(i => anySrcs.indexOf(String(i.src).split('?')[0]) < 0));
  ck('purpose-valid', '每个 icon 的 purpose 都是合法值',
    icons.length > 0 && icons.every(i => /^(any|maskable|monochrome)( (any|maskable|monochrome))*$/.test(String(i.purpose))));

  const badSize = Object.keys(EXPECTED_SIZE).filter(r => {
    const p = pngInfo(D.bytes[r]);
    return !p || p.w !== EXPECTED_SIZE[r] || p.h !== EXPECTED_SIZE[r];
  });
  ck('png-size', '所有成品图标尺寸与文件名声明一致（正方形）', badSize.length === 0, badSize.join(','));
  const withAlpha = Object.keys(EXPECTED_SIZE).filter(r => {
    const p = pngInfo(D.bytes[r]);
    return !p || p.colorType === 4 || p.colorType === 6;
  });
  ck('png-alpha', '成品图标均为不透明 PNG（iOS 不会把透明区渲染成黑块）',
    withAlpha.length === 0, withAlpha.join(','));
  const frames = icoFrames(D.bytes['assets/favicon.ico']);
  ck('ico-frames', 'favicon.ico 含 16/32/48 三帧', frames.join(',') === '16,32,48', frames.join(','));

  // ── v5.6.48 补丁：文档 / 结构三类缺陷守护 ──────────────────────────────
  // 只解析 CHANGELOG 中「当前版本」那一段，历史条目的验收数字是当时的证据，不参与比对。
  const heads = [];
  const entryRe = /^\/\/ (\d+\.\d+\.\d+)：/gm;
  let hm;
  while ((hm = entryRe.exec(D.changelog))) heads.push({ ver: hm[1], at: hm.index });
  const cur = heads.find(x => x.ver === D.version);
  const next = heads.find(x => cur && x.at > cur.at);
  const entry = cur ? D.changelog.slice(cur.at, next ? next.at : D.changelog.length) : '';
  const declared = {
    index: /index\.html\s+(\d+)\s*处/.exec(entry),
    test: /run-tests\.html\s+(\d+)\s*处/.exec(entry),
    manifest: /manifest(?:\.json)?\s+(\d+)\s*处/.exec(entry)
  };
  const actual = {
    index: hs.length,
    test: ts.length,
    manifest: icons.filter(i => /[?&]v=/.test(String(i.src))).length
  };
  const docOk = declared.index && declared.test && declared.manifest &&
    Number(declared.index[1]) === actual.index &&
    Number(declared.test[1]) === actual.test &&
    Number(declared.manifest[1]) === actual.manifest;
  ck('doc-stamp-count', 'CHANGELOG 当前版本条目声明的三处缓存戳数量与实测一致',
    !!docOk,
    '声明=' + [declared.index && declared.index[1], declared.test && declared.test[1],
      declared.manifest && declared.manifest[1]].join('/') +
    ' 实测=' + [actual.index, actual.test, actual.manifest].join('/'));

  // 省略 </body> 虽是合法 HTML5，但会让按 </body> 找锚点的注入工具静默失败。
  const bodyOpen = /<body\b/i.test(D.html);
  const bodyClose = /<\/body>/i.test(D.html);
  ck('html-body-closed', 'index.html 有 <body> 与 </body>，且闭合标签在 </html> 之前',
    bodyOpen && bodyClose && D.html.lastIndexOf('</body>') < D.html.lastIndexOf('</html>'),
    'open=' + bodyOpen + ' close=' + bodyClose);

  // 43 个 js/css 外链路径拼错只会静默 404，原有 asset-missing 只管 assets/ 图标。
  const localRefs = Array.from(D.html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)(?:\?[^"]*)?"/g))
    .map(m => m[1]);
  const dangling = localRefs.filter(r => !fs.existsSync(rel(r)));
  ck('local-refs-exist', 'index.html 引用的每个本地 js/css 文件都真实存在',
    localRefs.length >= 40 && dangling.length === 0,
    '引用 ' + localRefs.length + ' 个，缺失: ' + dangling.join(','));

  return { pass, failures };
}

// 每条注入只制造一个确定错误，独立跑一遍断言，避免互相污染捕获力判定
const INJECTIONS = [
  ['index-stamps', D => {
    const X = clone(D);
    X.html = X.html.replace('?v=' + D.version, '?v=0.0.0');              // 缓存戳漂移
    return X;
  }],
  ['asset-missing', D => {
    const X = clone(D);
    X.html = X.html.replace('assets/favicon-32.png', 'assets/__missing__.png');
    return X;
  }],
  ['maskable-split', D => {
    const X = clone(D), man = JSON.parse(X.manifestText);
    man.icons = man.icons.filter(i => i.purpose !== 'maskable')
      .concat([{ src: 'assets/icon-512.png?v=' + D.version, sizes: '512x512', type: 'image/png', purpose: 'maskable' }]);
    X.manifestText = JSON.stringify(man, null, 2);
    return X;
  }],
  ['png-size', D => {
    const X = clone(D), b = Buffer.from(X.bytes['assets/icon-192.png']);
    b.writeUInt32BE(191, 16); X.bytes['assets/icon-192.png'] = b;
    return X;
  }],
  ['png-alpha', D => {
    const X = clone(D), b = Buffer.from(X.bytes['assets/icon-512.png']);
    b[25] = 6; X.bytes['assets/icon-512.png'] = b;
    return X;
  }],
  ['no-source-favicon', D => {
    const X = clone(D);
    X.html = X.html.replace('<link rel="icon" href="assets/favicon.ico?v=' + D.version + '" sizes="any">',
      '<link rel="icon" href="assets/logo.png">');                        // 故意引用已清理文件名
    return X;
  }],
  ['no-orphan-assets', D => {
    const X = clone(D);
    X.dirFiles = X.dirFiles.concat(['orphan-logo.png']);                 // 冗余文件复活
    return X;
  }],
  ['doc-stamp-count', D => {
    const X = clone(D);
    // 只把「当前版本条目」声明的戳数 +1，不依赖具体数字，锚点恒有效
    X.changelog = X.changelog.replace(/run-tests\.html (\d+) 处/,
      (m, n) => 'run-tests.html ' + (Number(n) + 1) + ' 处');
    return X;
  }],
  ['html-body-closed', D => {
    const X = clone(D);
    X.html = X.html.replace(/<body[^>]*>/i, '');                          // 结构闭合缺陷
    return X;
  }],
  ['local-refs-exist', D => {
    const X = clone(D);
    X.html = X.html.replace(/(src=")js\/[^"?]+/, '$1js/__missing__.js');  // 静默 404
    return X;
  }]
];

if (INJECT) {
  let caught = 0;
  for (const [key, fn] of INJECTIONS) {
    const r = runChecks(fn(loadInputs()), true);
    const ok = r.failures.indexOf(key) >= 0;
    if (ok) caught++;
    console.log('  ' + (ok ? '\u2705' : '\u274c') + ' ' + key.padEnd(20) +
      (ok ? '已捕获（本轮 ' + r.failures.length + ' 条复红）' : '未捕获 → 断言无捕获力'));
  }
  console.log('\n[注入自检] ' + caught + '/' + INJECTIONS.length + ' 个注入点被逐条捕获');
  require('./_gate').emitInject(caught, INJECTIONS.length);
  process.exit(caught === INJECTIONS.length ? 0 : 1);
} else {
  const r = runChecks(loadInputs());
  console.log('\n通过 ' + r.pass + ' / 失败 ' + r.failures.length);
  require('./_gate').emit(r.pass, r.failures.length);
  process.exit(r.failures.length > 0 ? 1 : 0);
}
