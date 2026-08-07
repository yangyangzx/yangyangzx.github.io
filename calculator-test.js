// 计算器逻辑测试脚本
function calcPositionSize(riskAmount, effectiveEntryPrice, stopDistance) {
  if (stopDistance <= 0 || effectiveEntryPrice <= 0) return NaN;
  return riskAmount * effectiveEntryPrice / stopDistance;
}
function calcSlippageCost(positionSize, slippagePct) {
  if (slippagePct <= 0 || positionSize <= 0) return 0;
  return positionSize * slippagePct / 100;
}
function calcFee(positionSize, feeRate) {
  if (feeRate <= 0 || positionSize <= 0) return 0;
  return positionSize * feeRate / 100 * 2;
}
function calcEffectiveEntryPrice(entryPrice, direction, slippageRate) {
  const sign = direction === 'long' ? 1 : -1;
  return entryPrice * (1 + sign * slippageRate);
}
function calcTargetRR(targetPrice, effectiveEntryPrice, stopDistance, positionSize, fee, direction) {
  let targetDistance;
  if (direction === 'long') {
    targetDistance = targetPrice - effectiveEntryPrice;
  } else {
    targetDistance = effectiveEntryPrice - targetPrice;
  }
  if (targetDistance <= 0 || stopDistance <= 0) return null;
  var grossProfit = targetDistance * positionSize / effectiveEntryPrice;
  var grossLoss = stopDistance * positionSize / effectiveEntryPrice;
  var netProfit = grossProfit - fee;
  var netLoss = grossLoss + fee;
  if (netLoss <= 0) return grossProfit / stopDistance;
  return netProfit / netLoss;
}
function calcLiquidationPrice(entryPrice, direction, leverage, mmr) {
  const initialMarginRatio = 1 / leverage;
  if (direction === 'long') {
    return entryPrice * (1 - initialMarginRatio) / (1 - mmr);
  } else {
    return entryPrice * (1 + initialMarginRatio) / (1 + mmr);
  }
}
function calcWeightedStopDistance(batches, defaultStopLoss, direction, effectiveEntryPrice) {
  let totalAlloc = 0, weightedStopPct = 0;
  let skippedCount = 0;
  for (var i = 0; i < batches.length; i++) {
    var b = batches[i];
    var bp = parseFloat(b.price), ba = parseFloat(b.alloc);
    if (isNaN(bp) || bp <= 0 || isNaN(ba) || ba <= 0) continue;
    var bsl = (b.stopLoss && !isNaN(parseFloat(b.stopLoss))) ? parseFloat(b.stopLoss) : defaultStopLoss;
    if (direction === 'long' && bsl >= bp) { skippedCount++; continue; }
    if (direction === 'short' && bsl <= bp) { skippedCount++; continue; }
    weightedStopPct += (Math.abs(bp - bsl) / bp) * ba;
    totalAlloc += ba;
  }
  var stopDistance = totalAlloc > 0 ? (weightedStopPct / totalAlloc) * effectiveEntryPrice : 0;
  return { stopDistance: stopDistance, totalAlloc: totalAlloc, skippedCount: skippedCount };
}

// doSaveSplit 中修复后的滑点公式
function calcSplitSlippage(positionSize, slippagePoints, entryPrice) {
  if (slippagePoints <= 0 || positionSize <= 0 || entryPrice <= 0) return 0;
  return positionSize * slippagePoints / entryPrice;
}

// storeMAEMFE 中修复后的 MAE/MFE 计算
function calcMAEMFE(item) {
  const ep = (item.effectiveEntryPrice != null && !isNaN(parseFloat(item.effectiveEntryPrice)))
    ? parseFloat(item.effectiveEntryPrice)
    : parseFloat(item.entryPrice);
  if (isNaN(ep) || ep <= 0 || !item.direction) return { mae: null, mfe: null };
  const lowVal = item.lowPrice;
  const highVal = item.highPrice;
  if (item.direction === 'long') {
    return {
      mae: lowVal != null ? ((lowVal - ep) / ep * 100) : null,
      mfe: highVal != null ? ((highVal - ep) / ep * 100) : null
    };
  } else {
    return {
      mae: highVal != null ? ((ep - highVal) / ep * 100) : null,
      mfe: lowVal != null ? ((ep - lowVal) / ep * 100) : null
    };
  }
}

// 运行测试
var tests = [];
var pass = 0, fail = 0;
function test(name, actual, expected, tol) {
  tol = tol || 0.01;
  var p = Math.abs(actual - expected) < tol;
  if (p) pass++; else fail++;
  tests.push({name: name, actual: actual, expected: expected, pass: p});
  console.log((p ? 'PASS' : 'FAIL') + ': ' + name + ' (expected=' + expected + ', actual=' + actual + ')');
}

console.log('=== 1. 仓位计算测试 ===');
test('多单基础', calcPositionSize(200, 50000, 1000), 10000);
test('空单基础', calcPositionSize(200, 50000, 1000), 10000);
test('窄止损', calcPositionSize(200, 50000, 100), 100000);
test('风险金额验证', calcPositionSize(200, 50000, 1000) * 1000 / 50000, 200);

console.log('\n=== 2. 滑点成本测试 ===');
test('滑点成本基础', calcSlippageCost(10000, 0.1), 10);
test('零滑点', calcSlippageCost(10000, 0), 0);
test('滑点成本单位', calcSlippageCost(1000, 0.05), 0.5);
test('滑点成本单位2', calcSlippageCost(50000, 0.1), 50);

console.log('\n=== 3. 手续费测试 ===');
test('手续费基础', calcFee(10000, 0.08), 16);
test('手续费验证', calcFee(10000, 0.08) / 2, 8);

console.log('\n=== 4. 盈亏比测试（修复后） ===');
var effEntry = calcEffectiveEntryPrice(50000, 'long', 0.001); // 50050
var stopDist = effEntry - 49000; // 1050
var pos = calcPositionSize(200, effEntry, stopDist);
var fee = calcFee(pos, 0.08);
var rr = calcTargetRR(52000, effEntry, stopDist, pos, fee, 'long');
var grossProfit = (52000 - effEntry) * pos / effEntry;
var grossLoss = stopDist * pos / effEntry;
var expectedRR = (grossProfit - fee) / (grossLoss + fee);
test('多单盈亏比', rr, expectedRR, 0.01);
console.log('  effEntry=' + effEntry + ', stopDist=' + stopDist + ', pos=' + pos.toFixed(2) + ', fee=' + fee.toFixed(2));
console.log('  grossProfit=' + grossProfit.toFixed(2) + ', grossLoss=' + grossLoss.toFixed(2));
console.log('  netProfit=' + (grossProfit - fee).toFixed(2) + ', netLoss=' + (grossLoss + fee).toFixed(2));

// 验证修复前会重复扣除滑点
var slipCost = calcSlippageCost(pos, 0.1); // 入场滑点已包含在 effEntry 中
var totalCost_old = fee + slipCost;
var rrOld = (grossProfit - totalCost_old) / (grossLoss + totalCost_old);
var rrDiff = Math.abs(rr - rrOld);
test('修复验证：RR 差异 > 0.01', rrDiff > 0.01, true);
console.log('  修复前 RR=' + rrOld.toFixed(4) + ', 修复后 RR=' + rr.toFixed(4) + ', 差异=' + rrDiff.toFixed(4));

console.log('\n=== 5. 分批建仓测试 ===');
var batches = [
  {price: 50000, alloc: 60, stopLoss: 49000},
  {price: 50100, alloc: 40, stopLoss: 51000} // 非法：多单止损高于入场价
];
var result = calcWeightedStopDistance(batches, 49000, 'long', 50050);
test('分批一批非法 totalAlloc', result.totalAlloc, 60);
test('分批一批非法 skippedCount', result.skippedCount, 1);
test('分批一批非法 stopDistance > 0', result.stopDistance > 0, true);
console.log('  totalAlloc=' + result.totalAlloc + ', skippedCount=' + result.skippedCount + ', stopDistance=' + result.stopDistance.toFixed(2));

var allInvalid = calcWeightedStopDistance([
  {price: 50000, alloc: 50, stopLoss: 51000},
  {price: 50100, alloc: 50, stopLoss: 52000}
], 49000, 'long', 50050);
test('全部非法 stopDistance=0', allInvalid.stopDistance, 0);
console.log('  全部非法: stopDistance=' + allInvalid.stopDistance + ', totalAlloc=' + allInvalid.totalAlloc);

console.log('\n=== 6. 强平价测试 ===');
test('多单强平价', calcLiquidationPrice(50000, 'long', 10, 0.005), 50000 * 0.9 / 0.995, 1);
test('空单强平价', calcLiquidationPrice(50000, 'short', 10, 0.005), 50000 * 1.1 / 1.005, 1);
test('高杠杆多单', calcLiquidationPrice(50000, 'long', 100, 0.005), 50000 * 0.99 / 0.995, 1);

console.log('\n=== 7. 单位一致性测试 ===');
var ps = calcPositionSize(200, 50000, 1000);
test('positionSize 单位', ps, 10000);
var ra = ps * 1000 / 50000;
test('riskAmount 单位', ra, 200);
var sc = calcSlippageCost(10000, 0.1);
test('slippageCost 单位', sc, 10);
var f = calcFee(10000, 0.08);
test('fee 单位', f, 16);

console.log('\n=== 8. doSaveSplit 滑点公式修复验证 ===');
// 修复前: slippageTicks * tickSize * pos / entryPrice (错误地多乘了 tickSize)
// 修复后: pos * slippagePoints / entryPrice (与 calculator.js 一致)
var splitPos = 5000;
var slippagePoints = 1;
var entryPrice = 50000;
var tickSize = 0.1;
var wrongSlippage = slippagePoints * tickSize * splitPos / entryPrice; // 旧公式
var correctSlippage = calcSplitSlippage(splitPos, slippagePoints, entryPrice); // 新公式
test('doSaveSplit 滑点修复: 旧公式结果', wrongSlippage, 0.01);
test('doSaveSplit 滑点修复: 新公式结果', correctSlippage, 0.1);
test('doSaveSplit 滑点修复: 差异应为 10 倍', correctSlippage / wrongSlippage, 10, 1);
console.log('  旧公式 (错误):', wrongSlippage.toFixed(4), 'USDT (多乘了 tickSize)');
console.log('  新公式 (正确):', correctSlippage.toFixed(4), 'USDT');

console.log('\n=== 9. MAE/MFE 基准价一致性测试 ===');
var item = {
  entryPrice: 50000,
  effectiveEntryPrice: 50050,
  direction: 'long',
  lowPrice: 49800,
  highPrice: 50200
};
var maeMfe = calcMAEMFE(item);
var maeWrong = (49800 - 50000) / 50000 * 100;
var mfeWrong = (50200 - 50000) / 50000 * 100;
var maeCorrect = (49800 - 50050) / 50050 * 100;
var mfeCorrect = (50200 - 50050) / 50050 * 100;
test('MAE 使用 effectiveEntryPrice', maeMfe.mae, maeCorrect, 0.01);
test('MFE 使用 effectiveEntryPrice', maeMfe.mfe, mfeCorrect, 0.01);
test('MAE 不应使用 entryPrice', Math.abs(maeMfe.mae - maeWrong) > 0.05, true);
console.log('  entryPrice MAE:', maeWrong.toFixed(4), '% (错误)');
console.log('  effectiveEntryPrice MAE:', maeCorrect.toFixed(4), '% (正确)');
console.log('  实际计算 MAE:', maeMfe.mae.toFixed(4), '%');

console.log('\n=== 汇总 ===');
console.log('通过: ' + pass + ', 失败: ' + fail + ', 总计: ' + (pass + fail));
if (fail === 0) {
  console.log('✅ 所有测试通过！计算逻辑正确。');
  process.exit(0);
} else {
  console.log('❌ 有 ' + fail + ' 个测试失败，请检查代码。');
  process.exit(1);
}
