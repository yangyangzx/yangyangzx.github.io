'use strict';

// 门禁自身回归（v5.6.46 · 批次 0）
//
// P0-1 红测：旧 run-all.js 只信 exit code、零断言也放行、--inject 从不进 npm test、
// 失败时 results 双 push。修复后必须有一个能捕获这些 bug 的常驻断言。
//
// 做法：把【真实的 run-all.js 源码】复制到临时 fixture 目录，只替换 SUITES /
// INJECT_SUITES 两个字面量，塞进自制假跑测器，再 spawn 这份副本判定整体退出码。
// 测的是真实判定逻辑，不是复刻品；生产文件里不需要留任何测试钩子。
//
//   node test/verify_gate.js            正常模式：15 个场景 + 5 条静态守护
//   node test/verify_gate.js --inject   注入自检：把 11 条守卫逐条独立架空，
//                                      确认对应场景会被错误放行（证明断言有捕获力）

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const gate = require('./_gate');

const TEST_DIR = __dirname;
const RUN_ALL = path.join(TEST_DIR, 'run-all.js');
const GATE_SRC = path.join(TEST_DIR, '_gate.js');
const INJECT = process.argv.includes('--inject');
const RAW = fs.readFileSync(RUN_ALL, 'utf8');

const FIX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'td_gate_'));
const FAKE = 'fake.js';
fs.copyFileSync(GATE_SRC, path.join(FIX_DIR, '_gate.js'));

// [key, 说明, 假跑测器源码, min/expected, 模式, 期望门禁退出码]
const CASES = [
  ['fake-green', '假绿：FAIL=5 但 exit 0 必须判红',
    "console.log('通过 1 / 失败 5');\nconsole.log('GATE PASS=1 FAIL=5 TOTAL=6');\nprocess.exit(0);\n", 1, 'assert', 1],
  ['empty', '零断言 / 无契约且 exit 0 必须判红',
    "process.exit(0);\n", 0, 'assert', 1],
  ['no-contract', '只有中文汇总、无 GATE 契约必须判红（旧版会显示「(无摘要)」并放行）',
    "console.log('通过 10 / 失败 0');\nprocess.exit(0);\n", 0, 'assert', 1],
  ['degraded', '断言总数退化（2 < 下限 10）必须判红',
    "console.log('GATE PASS=2 FAIL=0 TOTAL=2');\nprocess.exit(0);\n", 10, 'assert', 1],
  ['total-mismatch', 'TOTAL 不自洽必须判红',
    "console.log('GATE PASS=5 FAIL=0 TOTAL=99');\nprocess.exit(0);\n", 1, 'assert', 1],
  ['zero-pass', 'PASS=0 零断言必须判红',
    "console.log('GATE PASS=0 FAIL=0 TOTAL=0');\nprocess.exit(0);\n", 0, 'assert', 1],
  ['honest-fail', 'FAIL=1 且 exit 1 必须判红',
    "console.log('GATE PASS=5 FAIL=1 TOTAL=6');\nprocess.exit(1);\n", 1, 'assert', 1],
  ['bad-exit', '契约全绿但 exit 1 必须判红',
    "console.log('GATE PASS=5 FAIL=0 TOTAL=5');\nprocess.exit(1);\n", 1, 'assert', 1],
  ['crash', '跑测器抛异常崩溃必须判红',
    "throw new Error('boom');\n", 1, 'assert', 1],
  ['honest-pass', '诚实通过必须判绿（防止门禁过敏到恒红）',
    "console.log('GATE PASS=12 FAIL=0 TOTAL=12');\nprocess.exit(0);\n", 10, 'assert', 0],
  ['inject-ok', '注入 7/7 全捕获必须判绿',
    "console.log('GATE INJECT CAUGHT=7 EXPECTED=7');\nprocess.exit(0);\n", 7, 'inject', 0],
  ['inject-miss', '注入只捕获 6/7 必须判红',
    "console.log('GATE INJECT CAUGHT=6 EXPECTED=7');\nprocess.exit(0);\n", 7, 'inject', 1],
  ['inject-zero', 'EXPECTED=0 的无效自检必须判红',
    "console.log('GATE INJECT CAUGHT=0 EXPECTED=0');\nprocess.exit(0);\n", 7, 'inject', 1],
  ['inject-wrong-kind', '注入模式产出 assert 契约必须判红',
    "console.log('GATE PASS=12 FAIL=0 TOTAL=12');\nprocess.exit(0);\n", 7, 'inject', 1],
  ['inject-registered', '注入点数与登记值不符必须判红',
    "console.log('GATE INJECT CAUGHT=7 EXPECTED=7');\nprocess.exit(0);\n", 9, 'inject', 1],
];

// 静态守护：这些是「看源码结构」才能发现的历史缺陷（双 push / 漏跑 / 注入组未纳入）。
const STATIC_LABELS = {
  S1: 'results.push 只出现一次（旧版失败分支双 push）',
  S2: 'SUITES 已补跑 _verify_bugs.js',
  S3: 'INJECT_SUITES 至少 4 组，--inject 已进入 npm test',
  S4: '每组 SUITES 都登记了 >0 的断言下限 min',
  S5: 'evaluate 保留 G1 fail-closed 契约缺失守卫',
};

function staticFindings(src) {
  const pushCount = (src.match(/results\.push\(/g) || []).length;
  const injBlock = /const INJECT_SUITES = \[([\s\S]*?)\n\];/.exec(src);
  const injCount = injBlock ? (injBlock[1].match(/^\s*\[/gm) || []).length : 0;
  const suiteBlock = /const SUITES = \[([\s\S]*?)\n\];/.exec(src);
  const rows = suiteBlock ? (suiteBlock[1].match(/^\s*\[[^\]]*\],?\s*$/gm) || []) : [];
  const minsOk = rows.length >= 15 && rows.every(function (r) {
    const m = /,\s*(\d+)\s*\]\s*,?\s*$/.exec(r);
    return m && Number(m[1]) > 0;
  });
  return {
    S1: pushCount === 1,
    S2: /'_verify_bugs\.js'/.test(src),
    S3: injCount >= 4,
    S4: minsOk,
    S5: src.indexOf("if (!c) return fail('G1") !== -1,
  };
}

// 用真实源码装配一份 fixture 副本：只替换两个 SUITES 字面量，其余逐字保留。
function build(spec, mutatedSrc) {
  const isInject = spec[4] === 'inject';
  const suites = isInject
    ? 'const SUITES = [];'
    : "const SUITES = [\n  ['" + spec[0] + "', '" + FAKE + "', " + spec[3] + "],\n];";
  const injectSuites = isInject
    ? "const INJECT_SUITES = [\n  ['" + spec[0] + "', '" + FAKE + "', [], {}, " + spec[3] + "],\n];"
    : 'const INJECT_SUITES = [];';

  let out = mutatedSrc.replace(/const SUITES = \[[\s\S]*?\n\];/, suites);
  out = out.replace(/const INJECT_SUITES = \[[\s\S]*?\n\];/, injectSuites);
  const replaced = out.indexOf(FAKE) !== -1 && out !== mutatedSrc;
  fs.writeFileSync(path.join(FIX_DIR, 'run-all.js'), out);
  fs.writeFileSync(path.join(FIX_DIR, FAKE), spec[2]);
  return replaced;
}

function runFixture() {
  const r = spawnSync(process.execPath, [path.join(FIX_DIR, 'run-all.js')], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

let pass = 0, fail = 0;
function ck(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' → ' + detail : '')); }
}

// ---- 注入自检：每条守卫独立架空，确认对应场景不再被拦住 ----
// 「不再被拦住」= 变异版 exit 0（行为类）或静态守护变 false（结构类）。
const MUTATIONS = [
  { key: 'G1 契约缺失 fail-closed', caseKey: 'empty',
    re: /if \(!c\) return fail\('G1 缺少 GATE 契约行'\);/, to: 'if (!c) return pass();' },
  { key: 'G2 契约类型校验', caseKey: 'inject-wrong-kind',
    re: /if \(c\.kind !== kind\) return fail\([^;]*\);/, to: 'if (c.kind !== kind) return pass();' },
  { key: 'G3 注入捕获不全', caseKey: 'inject-miss',
    re: /if \(c\.expected <= 0 \|\| c\.caught !== c\.expected\) return fail\([^;]*\);/, to: "if (false) return fail('x');" },
  { key: 'G4 注入点数登记', caseKey: 'inject-registered',
    re: /if \(expected && c\.expected !== expected\) return fail\([^;]*\);/, to: "if (false) return fail('x');" },
  { key: 'G5 断言失败优先于 exit code', caseKey: 'fake-green',
    re: /if \(c\.fail !== 0\) return fail\([^;]*\);/, to: "if (false) return fail('x');" },
  { key: 'G6 零断言', caseKey: 'zero-pass',
    re: /if \(c\.pass <= 0\) return fail\([^;]*\);/, to: "if (false) return fail('x');" },
  { key: 'G7 TOTAL 自洽', caseKey: 'total-mismatch',
    re: /if \(c\.total !== c\.pass \+ c\.fail\) return fail\([^;]*\);/, to: "if (false) return fail('x');" },
  { key: 'G8 退出码（两处）', caseKey: 'bad-exit',
    re: /if \(r\.status !== 0\) return fail\([^;]*\);/g, to: "if (false) return fail('x');" },
  // 断言总数有两层守护（逐组 min + 全局 totalAssertions>=minTotal），互相兜底；
  // 单独架空一层仍会被另一层拦住，故这一注入点必须成对架空才能暴露该职责。
  { key: 'G9 断言总数下限（逐组+全局）', caseKey: 'degraded',
    re: /if \(c\.total < min\) return fail\([^;]*\);/, to: "if (false) return fail('x');",
    re2: /const totalOk = totalAssertions >= minTotal;/, to2: 'const totalOk = true;' },
  { key: 'S1 双 push 守护', staticKey: 'S1',
    re: /results\.push\(\{ label, file, ok: verdict\.ok/, to: "results.push({ label, file }); results.push({ label, file, ok: verdict.ok" },
  { key: 'S3 注入组纳入 npm test', staticKey: 'S3',
    re: /const INJECT_SUITES = \[[\s\S]*?\n\];/, to: 'const INJECT_SUITES = [];' },
];

function cleanup() {
  // 仅删除本脚本自己刚创建的临时目录，不触碰任何用户文件。
  try { fs.rmSync(FIX_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

if (INJECT) {
  console.log('门禁注入自检：逐条独立架空守卫，确认断言会失去捕获力\n');
  let caught = 0;
  for (const m of MUTATIONS) {
    const hits = RAW.match(m.re);
    if (!hits || hits.length === 0) {
      console.log('  ❌ ' + m.key + ': 变异锚点未命中 run-all.js（注入失效）');
      continue;
    }
    let mutated = RAW.replace(m.re, m.to);
    if (m.re2) {
      if (!m.re2.test(RAW)) {
        console.log('  ❌ ' + m.key + ': 第二变异锚点未命中（注入失效）');
        continue;
      }
      mutated = mutated.replace(m.re2, m.to2);
    }
    let ok = false, detail = '';
    if (m.staticKey) {
      ok = staticFindings(mutated)[m.staticKey] === false;
    } else {
      const spec = CASES.find((c) => c[0] === m.caseKey);
      build(spec, mutated);
      const r = runFixture();
      ok = r.code === 0;
      detail = '变异版 exit=' + r.code + '（期望 0 = 假绿被放行）';
    }
    if (ok) caught++;
    console.log('  ' + (ok ? '✅' : '❌') + ' ' + m.key.padEnd(30) + (ok ? '已捕获（守卫确实在起作用）' : '未捕获 → 断言无捕获力' + (detail ? ' | ' + detail : '')));
  }
  console.log('\n[注入自检] ' + caught + '/' + MUTATIONS.length + ' 个注入点被逐条捕获');
  gate.emitInject(caught, MUTATIONS.length);
  cleanup();
  process.exit(caught === MUTATIONS.length ? 0 : 1);
} else {
  console.log('门禁回归：用真实 run-all.js 副本跑假跑测器\n');
  for (const spec of CASES) {
    const assembled = build(spec, RAW);
    const r = runFixture();
    const label = spec[0].padEnd(20) + ' ' + spec[1];
    ck(label + '（期望 exit=' + spec[5] + '，fixture 已装配=' + assembled + '）',
      assembled && r.code === spec[5],
      '实得 exit=' + r.code);
  }
  console.log('\n静态结构守护：');
  const findings = staticFindings(RAW);
  Object.keys(STATIC_LABELS).forEach(function (k) {
    ck(k + ' ' + STATIC_LABELS[k], findings[k] === true);
  });
  gate.emit(pass, fail);
  cleanup();
  process.exit(fail > 0 ? 1 : 0);
}
