// 聚合回归跑测器 —— 一次性跑完所有无头跑测器，汇总失败项并以退出码反映结果。
//
// 背景：本仓库的断言全部在自研跑测器里（run-tests.html / _rt_headless.js /
// verify_*.js / _edit_scenarios.js），没有一个挂进 package.json，导致「3,000+ 条
// 断言」事实上不可达——改完代码没有任何自动门禁。历史遗留的 `npm test`（jest）
// 配置指向已删除的 tests/ 目录，会直接 Validation Error 失败。
//
// 退出码：0 = 全部通过；1 = 有跑测器失败或崩溃（用于 CI / 预提交钩子）。
//
// 用法：node test/run-all.js

const path = require('path');
const { spawnSync } = require('child_process');

const TEST_DIR = __dirname;

// 顺序即优先级：先跑覆盖面最大的主回归，再跑各专项。
// 排在前面的是「最可能因改动失败」的那几组。
const SUITES = [
  ['主回归（run-tests.html，无头）', '_rt_headless.js'],
  ['编辑场景（S0~S12）', '_edit_scenarios.js'],
  ['平仓类型一致性', 'verify_close_type_consistency.js'],
  ['日志簿记回归', 'verify_logs_fixed.js'],
  ['配置修复', 'verify_config_fix.js'],
  ['重置流程', 'verify_reset_fix.js'],
  ['冒烟', 'verify_smoke.js'],
  ['统计浮层', 'verify_stat_tip.js'],
  ['参数化阈值', 'verify_param_fix.js'],
  ['副作用（副作用链）', 'verify_sideeffects.js'],
  ['不变量遍历', 'verify_invariants.js'],
  ['MAE/MFE', 'verify_mae_mfe.js'],
  ['开仓链路审计', 'verify_audit_1013.js'],
];

const results = [];
let failed = 0;

for (const [label, file] of SUITES) {
  const full = path.join(TEST_DIR, file);
  process.stdout.write(`▶ ${label} (${file})\n`);
  const r = spawnSync(process.execPath, [full], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (r.error) {
    failed++;
    results.push({ label, file, code: 'ERR', summary: r.error.message });
    process.stdout.write(`  启动失败：${r.error.message}\n\n`);
    continue;
  }

  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // 各跑测器的汇总文案格式不统一，逐个匹配；匹配不到只报退出码，
  // 避免「摘要抓取失败」被误判成「断言失败」。
  const m =
    out.match(/通过\s*\d+\s*\/\s*失败\s*\d+/) ||
    out.match(/PASS=\d+\s+FAIL=\d+/) ||
    out.match(/\d+\s*项，失败\s*\d+\s*项/) ||
    out.match(/\d+\s*项\s*失败\s*\d+\s*项/);
  const summary = m ? m[0].replace(/\s+/g, ' ') : '(无摘要)';

  if (r.status !== 0) {
    failed++;
    results.push({ label, file, code: r.status, summary });
    // 打印失败明细，便于直接定位，不用再去翻该跑测器的输出。
    const fails = out.match(/^\s*[❌✗].*$/gm) || out.match(/--- FAIL 明细 ---[\s\S]*?(?=\n---|\n$|$)/g) || [];
    if (fails.length) {
      process.stdout.write(fails.slice(0, 20).join('\n') + '\n');
    }
  }
  results.push({ label, file, code: r.status, summary });
  process.stdout.write(`  ${r.status === 0 ? '✅' : '❌'} exit=${r.status}  ${summary}\n\n`);
}

console.log('='.repeat(64));
results.forEach((r) => {
  console.log(
    `${r.code === 0 ? 'PASS' : 'FAIL'}  ${String(r.file).padEnd(40)} exit=${String(r.code).padEnd(4)} ${r.summary}`
  );
});
console.log('='.repeat(64));
console.log(`合计：${results.length - failed} 通过 / ${failed} 失败（共 ${results.length} 个跑测器）`);

process.exit(failed > 0 ? 1 : 0);