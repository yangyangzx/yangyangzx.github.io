'use strict';

// 统一机器可读契约（v5.6.46 · 批次 0 门禁可信化）
//
// 背景：各跑测器汇总文案有 7 种以上格式（PASS=N / 通过 N / N 项…），
// run-all.js 靠正则猜，基线 18 个跑测器里有 7 个显示「(无摘要)」，
// 且旧聚合器只信 exit code —— 一个输出「失败 5」却 exit(0) 的假跑测器会被判 PASS。
//
// 纪律：每个跑测器收尾必须且只需调用本模块一次，打印一行以 "GATE " 开头的契约；
// run-all.js 只认这一行，解析不到即 fail-closed。人读文案由本模块一并输出。
//
//   node test/xxx.js           → GATE PASS=<n> FAIL=<n> TOTAL=<n>
//   node test/xxx.js --inject → GATE INJECT CAUGHT=<n> EXPECTED=<n>

const PREFIX = 'GATE ';

function _int(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// 最小侵入接口：只打印契约行，不改跑测器原有的汇总文案与 process.exit 逻辑。
// 存量 19 个跑测器收尾统一调用 emit / emitInject 一次即可。
function emit(pass, fail) {
  const p = _int(pass);
  const f = _int(fail);
  console.log(PREFIX + 'PASS=' + p + ' FAIL=' + f + ' TOTAL=' + (p + f));
  return { pass: p, fail: f, total: p + f };
}

function emitInject(caught, expected) {
  const c = _int(caught);
  const e = _int(expected);
  console.log(PREFIX + 'INJECT CAUGHT=' + c + ' EXPECTED=' + e);
  return { caught: c, expected: e };
}

// 供新跑测器使用：打印人读文案 + 契约，并直接返回退出码。
function report(pass, fail) {
  const r = emit(pass, fail);
  console.log('通过 ' + r.pass + ' / 失败 ' + r.fail);
  return r.fail > 0 || r.pass === 0 ? 1 : 0;
}

// 注入自检模式：期望每个注入点都被逐条捕获；EXPECTED=0 视为无效自检。
function inject(caught, expected) {
  const r = emitInject(caught, expected);
  console.log('[注入自检] ' + r.caught + '/' + r.expected + ' 个注入点被捕获');
  return r.expected > 0 && r.caught === r.expected ? 0 : 1;
}

// 从输出末尾反向找契约行：注入模式可能先打印 assert 契约，再打印 INJECT 契约。
function parse(output) {
  const lines = String(output || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.indexOf(PREFIX) !== 0) continue;
    let m = /^GATE PASS=(\d+) FAIL=(\d+) TOTAL=(\d+)$/.exec(line);
    if (m) return { kind: 'assert', pass: +m[1], fail: +m[2], total: +m[3] };
    m = /^GATE INJECT CAUGHT=(\d+) EXPECTED=(\d+)$/.exec(line);
    if (m) return { kind: 'inject', caught: +m[1], expected: +m[2] };
  }
  return null;
}

module.exports = { emit, emitInject, report, inject, parse, PREFIX };
