// 聚合回归跑测器 —— 一次性跑完所有无头跑测器，汇总失败项并以退出码反映结果。
//
// 背景：本仓库的断言全部在自研跑测器里（run-tests.html / _rt_headless.js /
// verify_*.js / _edit_scenarios.js），没有一个挂进 package.json，导致「3,000+ 条
// 断言」事实上不可达——改完代码没有任何自动门禁。历史遗留的 `npm test`（jest）
// 配置指向已删除的 tests/ 目录，会直接 Validation Error 失败。
//
// 退出码：0 = 全部通过；1 = 有跑测器失败 / 崩溃 / 契约缺失 / 断言数退化（CI / 预提交钩子）。
//
// v5.6.46 批次 0「门禁可信化」：
//   旧版只信 exit code，且靠正则猜 7 种中文汇总文案（基线 18 个里有 7 个显示「(无摘要)」）。
//   实证：一个输出「失败 5」却 exit(0) 的假跑测器、以及一个零断言跑测器，都被判 PASS。
//   现在所有跑测器统一打印 `GATE PASS=.. FAIL=.. TOTAL=..`（注入模式为
//   `GATE INJECT CAUGHT=.. EXPECTED=..`），本文件只认这一行，解析不到即 fail-closed。
//
// 用法：node test/run-all.js

const path = require('path');
const { spawnSync } = require('child_process');
const gate = require('./_gate');

const TEST_DIR = __dirname;

// [标签, 文件, min] —— min 是 v5.6.46 基线实测的断言总数下限。
// 「全绿 ≠ 没退化」：历史上有过不变量 2207→1910、主回归 675→672 仍 exit 0 的先例，
// 这里把断言数下限写进门禁，掉一条就报红。
const SUITES = [
  ['主回归（run-tests.html，无头）', '_rt_headless.js', 675],
  ['核心算法升级', 'verify_core_algo.js', 67],
  ['跨模块计算逻辑', 'verify_crossmodule.js', 56],
  ['品牌图标与缓存戳接线', 'verify_assets.js', 15],
  ['导航品牌区回主入口', 'verify_nav_logo.js', 12],
  ['编辑场景（S0~S15）', '_edit_scenarios.js', 189],
  ['平仓类型一致性', 'verify_close_type_consistency.js', 79],
  ['日志簿记回归', 'verify_logs_fixed.js', 42],
  ['配置修复', 'verify_config_fix.js', 17],
  ['重置流程', 'verify_reset_fix.js', 31],
  ['冒烟', 'verify_smoke.js', 15],
  ['统计浮层', 'verify_stat_tip.js', 17],
  ['参数化阈值', 'verify_param_fix.js', 35],
  ['副作用（副作用链）', 'verify_sideeffects.js', 47],
  ['不变量遍历', 'verify_invariants.js', 2207],
  ['MAE/MFE', 'verify_mae_mfe.js', 21],
  ['开仓链路审计', 'verify_audit_1013.js', 63],
  ['覆盖率补盲', 'verify_coverage_gaps.js', 36],
  ['历史缺陷验证（批次 0 补跑）', '_verify_bugs.js', 14],
  ['门禁自身回归（假绿 / 结构守护）', 'verify_gate.js', 20],
  ['数据完整性（时间 / 缓存 / 并发 / 恢复）', 'verify_data_integrity.js', 16],
  ['批次 2/3 数据准确度（6 组 50 条）', 'verify_batch2.js', 50],
  ['侧栏柔光样式守护（5 组 18 条）', 'verify_nav_glow.js', 18],
];

// 注入自检组：[标签, 文件, 参数, 环境变量, 期望捕获点数]
// 语义统一：注入确定错误后，跑测器必须逐条报红，并以 exit 0 + INJECT 契约表示「捕获成功」。
// 旧版 `--inject` 从不进 npm test，等于新断言的捕获力从未被门禁验证过。
const INJECT_SUITES = [
  ['核心算法（旧实现注入）', 'verify_core_algo.js', ['--inject'], {}, 1],
  ['跨模块（旧实现注入）', 'verify_crossmodule.js', ['--inject'], {}, 1],
  ['资产接线（7 点逐条）', 'verify_assets.js', ['--inject'], {}, 7],
  ['导航品牌区（9 点逐条）', 'verify_nav_logo.js', ['--inject'], {}, 9],
  ['统计浮层（bad-read）', 'verify_stat_tip.js', [], { REGRESSION: 'bad-read' }, 1],
  ['统计浮层（bad-hover）', 'verify_stat_tip.js', [], { REGRESSION: 'bad-hover' }, 1],
  ['门禁自身（11 点守卫变异）', 'verify_gate.js', ['--inject'], {}, 11],
  ['数据完整性（4 点独立注入）', 'verify_data_integrity.js', ['--inject'], {}, 4],
  ['批次 2/3（25 点逐条独立注入）', 'verify_batch2.js', ['--inject'], {}, 25],
  ['侧栏柔光（12 点逐条独立注入）', 'verify_nav_glow.js', ['--inject'], {}, 12],
];

// 单一判定入口。所有守卫独占一行，便于 test/verify_gate.js 做逐条独立注入变异。
function evaluate(r, out, min, kind, expected) {
  const c = gate.parse(out);
  const fail = (reason) => ({ ok: false, reason, c });
  const pass = () => ({ ok: true, reason: '', c });

  if (r.error) return fail('G0 启动失败：' + r.error.message);
  if (!c) return fail('G1 缺少 GATE 契约行');
  if (c.kind !== kind) return fail('G2 契约类型不符（期望 ' + kind + '，实得 ' + c.kind + '）');

  if (kind === 'inject') {
    if (c.expected <= 0 || c.caught !== c.expected) return fail('G3 注入捕获不全：' + c.caught + '/' + c.expected);
    if (expected && c.expected !== expected) return fail('G4 注入点数与登记不符：' + c.expected + ' ≠ ' + expected);
    if (r.status !== 0) return fail('G8 注入模式退出码 ' + r.status + '（应为 0）');
    return pass();
  }

  // 关键：断言结果优先于退出码。exit(0) 但 FAIL>0 一样判红（旧版假绿的直接修复点）。
  if (c.fail !== 0) return fail('G5 断言失败 ' + c.fail + ' 条（即使 exit=0 也判红）');
  if (c.pass <= 0) return fail('G6 零断言');
  if (c.total !== c.pass + c.fail) return fail('G7 TOTAL 不自洽：' + c.total + ' ≠ ' + (c.pass + c.fail));
  if (c.total < min) return fail('G9 断言总数退化：' + c.total + ' < 下限 ' + min);
  if (r.status !== 0) return fail('G8 退出码 ' + r.status);
  return pass();
}

const results = [];
let failed = 0;
let totalAssertions = 0;

function runOne(label, file, min, kind, args, env, expected) {
  const full = path.join(TEST_DIR, file);
  const printable = `${label} (${file}${args && args.length ? ' ' + args.join(' ') : ''})`;
  process.stdout.write(`▶ ${printable}\n`);

  const r = spawnSync(process.execPath, [full].concat(args || []), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, env || {}),
  });

  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const verdict = evaluate(r, out, min, kind, expected);
  if (!verdict.ok) failed++;
  if (kind === 'assert' && verdict.c && verdict.c.kind === 'assert') {
    totalAssertions += verdict.c.total;
  }

  // 每个跑测器只入表一次（旧版失败分支 push 一次、循环末尾再 push 一次，统计失真）。
  const c = verdict.c;
  const summary = !c ? '(无契约)'
    : (c.kind === 'inject' ? `INJECT ${c.caught}/${c.expected}` : `PASS=${c.pass} FAIL=${c.fail} TOTAL=${c.total}/min ${min}`);
  results.push({ label, file, ok: verdict.ok, code: r.error ? 'ERR' : r.status, summary, reason: verdict.reason });

  process.stdout.write(`  ${verdict.ok ? '✅' : '❌'} exit=${r.error ? 'ERR' : r.status}  ${summary}${verdict.ok ? '' : '  ← ' + verdict.reason}\n\n`);
  if (!verdict.ok) {
    // 打印失败明细，便于直接定位，不用再去翻该跑测器的输出。
    const fails = out.match(/^\s*[❌✗].*$/gm) || out.match(/--- FAIL 明细 ---[\s\S]*?(?=\n---|\n$|$)/g) || [];
    if (fails.length) process.stdout.write(fails.slice(0, 20).join('\n') + '\n');
  }
}

for (const [label, file, min] of SUITES) runOne(label, file, min, 'assert', [], {}, 0);
for (const [label, file, args, env, expected] of INJECT_SUITES) {
  runOne(label, file, 0, 'inject', args, env, expected);
}

console.log('='.repeat(64));
results.forEach((r) => {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${String(r.file).padEnd(40)} exit=${String(r.code).padEnd(4)} ${r.summary}${r.ok ? '' : '  ← ' + r.reason}`);
});
console.log('='.repeat(64));

// 全局断言总数守护：逐组 min 之外再兜一层，防止「删掉一整组 / 多组同时小幅退化」蒙混过关。
const minTotal = SUITES.reduce((s, x) => s + x[2], 0);
const totalOk = totalAssertions >= minTotal;
console.log(`合计：${results.length - failed} 通过 / ${failed} 失败（共 ${results.length} 项：${SUITES.length} 正常 + ${INJECT_SUITES.length} 注入自检）`);
console.log(`断言总数：${totalAssertions} 条（下限 ${minTotal} 条） ${totalOk ? '✅' : '❌ 退化'}`);
if (!totalOk) console.log('❌ 断言总数低于基线，即使全部跑测器 exit=0 也判失败');

process.exit(failed > 0 || !totalOk ? 1 : 0);
