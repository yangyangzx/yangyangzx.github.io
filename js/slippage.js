/*
 * 统一滑点领域模型（P0-05）
 *
 * 设计原则：
 * 1. 用户输入仅接受 ticks；价格偏移 = ticks × tickSize。
 * 2. 计划、目标 R、平仓、拆分保存均调用本模块，不允许各自重算。
 * 3. 保存完整假设快照（tickSize、双侧 ticks、价格偏移、双侧成本），
 *    使历史日志可以被复算，而不是只保存一个无法解释的 slippageCost。
 */
(function attachSlippageModule(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Slippage = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createSlippageModule() {
  'use strict';

  var SCHEMA = 'ticks-v1';
  var DEFAULT_TICKS_BY_ORDER_TYPE = Object.freeze({
    market: { entry: 1, exit: 1 },
    stop:   { entry: 2, exit: 2 },
    limit:  { entry: 0, exit: 1 }
  });

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function nonNegative(value, fieldName) {
    var n = finiteNumber(value, NaN);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error((fieldName || '数值') + '必须是大于或等于 0 的有限数字');
    }
    return n;
  }

  function positive(value, fieldName) {
    var n = finiteNumber(value, NaN);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error((fieldName || '数值') + '必须是大于 0 的有限数字');
    }
    return n;
  }

  function getDefaultTicks(orderType) {
    var row = DEFAULT_TICKS_BY_ORDER_TYPE[orderType] || DEFAULT_TICKS_BY_ORDER_TYPE.market;
    return { entry: row.entry, exit: row.exit };
  }

  /**
   * 多头不利成交：入场更高、出场更低；空头相反。
   * 返回实际成交价，而非单纯成本，以便所有 PnL 计算复用同一价格事实。
   */
  function applyAdversePrice(price, direction, ticks, tickSize, leg) {
    price = positive(price, '价格');
    ticks = nonNegative(ticks, '滑点 ticks');
    tickSize = positive(tickSize, 'tickSize');
    if (direction !== 'long' && direction !== 'short') {
      throw new Error('direction 只能是 long 或 short');
    }
    if (leg !== 'entry' && leg !== 'exit') {
      throw new Error('leg 只能是 entry 或 exit');
    }

    var delta = ticks * tickSize;
    var sign;
    if (direction === 'long') sign = leg === 'entry' ? 1 : -1;
    else sign = leg === 'entry' ? -1 : 1;

    var filled = price + sign * delta;
    if (filled <= 0) throw new Error('滑点后的成交价必须大于 0');
    return { expectedPrice: price, filledPrice: filled, priceDelta: delta, adverseDirection: sign };
  }

  /**
   * positionNotional 为开仓名义价值（USDT）；quantity = positionNotional / expectedEntryPrice。
   * 该定义与现有项目的 positionSize 字段语义保持兼容。
   */
  function calculate(input) {
    input = input || {};
    var direction = input.direction;
    var expectedEntryPrice = positive(input.expectedEntryPrice, 'expectedEntryPrice');
    var expectedExitPrice = positive(input.expectedExitPrice, 'expectedExitPrice');
    var tickSize = positive(input.tickSize, 'tickSize');
    var entryTicks = nonNegative(input.entryTicks, 'entryTicks');
    var exitTicks = nonNegative(input.exitTicks, 'exitTicks');
    // 新代码应优先显式传入 quantity；为兼容现有 positionSize（USDT 名义价值）保留回退。
    var quantity = input.quantity !== null && input.quantity !== undefined
      ? positive(input.quantity, 'quantity')
      : positive(input.positionNotional, 'positionNotional') / expectedEntryPrice;

    var entry = applyAdversePrice(expectedEntryPrice, direction, entryTicks, tickSize, 'entry');
    var exit = applyAdversePrice(expectedExitPrice, direction, exitTicks, tickSize, 'exit');
    var entryCost = quantity * Math.abs(entry.filledPrice - expectedEntryPrice);
    var exitCost = quantity * Math.abs(exit.filledPrice - expectedExitPrice);

    return {
      schema: SCHEMA,
      unit: 'ticks',
      tickSize: tickSize,
      entryTicks: entryTicks,
      exitTicks: exitTicks,
      expectedEntryPrice: expectedEntryPrice,
      effectiveEntryPrice: entry.filledPrice,
      expectedExitPrice: expectedExitPrice,
      effectiveExitPrice: exit.filledPrice,
      quantity: quantity,
      entryPriceDelta: entry.priceDelta,
      exitPriceDelta: exit.priceDelta,
      entryCost: entryCost,
      exitCost: exitCost,
      totalCost: entryCost + exitCost
    };
  }

  /**
   * 仅用于“尚未指定未来出场价格”的计划显示：返回入场成交价和入场成本。
   * target/stop 的目标 R 计算必须调用 calculate() 并传入对应 exit price。
   */
  function calculateEntry(input) {
    input = input || {};
    var direction = input.direction;
    var expectedEntryPrice = positive(input.expectedEntryPrice, 'expectedEntryPrice');
    var tickSize = positive(input.tickSize, 'tickSize');
    var entryTicks = nonNegative(input.entryTicks, 'entryTicks');
    var quantity = input.quantity !== null && input.quantity !== undefined
      ? positive(input.quantity, 'quantity')
      : positive(input.positionNotional, 'positionNotional') / expectedEntryPrice;
    var entry = applyAdversePrice(expectedEntryPrice, direction, entryTicks, tickSize, 'entry');
    return {
      schema: SCHEMA,
      unit: 'ticks',
      tickSize: tickSize,
      entryTicks: entryTicks,
      expectedEntryPrice: expectedEntryPrice,
      effectiveEntryPrice: entry.filledPrice,
      quantity: quantity,
      entryPriceDelta: entry.priceDelta,
      entryCost: quantity * entry.priceDelta
    };
  }

  /**
   * 读取页面的“每侧滑点（ticks）”。为空时使用订单类型的保守默认值，
   * 并将来源写入快照。计划页应提供 slippageMode：manual/default。
   */
  function readPlanInput(options) {
    options = options || {};
    var mode = options.mode === 'manual' ? 'manual' : 'default';
    var defaults = getDefaultTicks(options.orderType || 'market');
    var entryValue = options.entryTicks;
    var exitValue = options.exitTicks;
    var entryTicks = mode === 'manual' ? nonNegative(entryValue || 0, 'entryTicks') : defaults.entry;
    var exitTicks = mode === 'manual' ? nonNegative(exitValue || 0, 'exitTicks') : defaults.exit;
    return {
      mode: mode,
      source: mode === 'manual' ? 'user-input' : 'order-type-default',
      entryTicks: entryTicks,
      exitTicks: exitTicks
    };
  }

  /**
   * 将新模型标准化为可以直接写入日志的快照。
   */
  function toLogSnapshot(model, meta) {
    meta = meta || {};
    if (!model || model.schema !== SCHEMA) throw new Error('无效的滑点模型');
    return {
      schema: SCHEMA,
      unit: 'ticks',
      source: meta.source || 'user-input',
      tickSize: model.tickSize,
      entryTicks: model.entryTicks,
      exitTicks: model.exitTicks,
      expectedEntryPrice: model.expectedEntryPrice,
      effectiveEntryPrice: model.effectiveEntryPrice,
      expectedExitPrice: model.expectedExitPrice,
      effectiveExitPrice: model.effectiveExitPrice,
      entryPriceDelta: model.entryPriceDelta,
      exitPriceDelta: model.exitPriceDelta,
      entryCost: model.entryCost,
      exitCost: model.exitCost,
      totalCost: model.totalCost
    };
  }

  /**
   * 兼容历史记录。绝不从旧 slippageCost 反推出 ticks（缺少价格、品种、双侧分配时不可逆）。
   */
  function migrateLegacyLog(log) {
    if (!log || log.slippage) return false;
    var legacyCost = finiteNumber(log.slippageCost, 0);
    log.slippage = {
      schema: 'legacy-cash-v0',
      unit: 'USDT',
      source: 'legacy-import',
      totalCost: legacyCost,
      migrationNote: '历史记录只保存了总滑点成本，无法可靠反推双侧 ticks 或成交价。'
    };
    return true;
  }

  return {
    SCHEMA: SCHEMA,
    DEFAULT_TICKS_BY_ORDER_TYPE: DEFAULT_TICKS_BY_ORDER_TYPE,
    getDefaultTicks: getDefaultTicks,
    applyAdversePrice: applyAdversePrice,
    calculate: calculate,
    calculateEntry: calculateEntry,
    readPlanInput: readPlanInput,
    toLogSnapshot: toLogSnapshot,
    migrateLegacyLog: migrateLegacyLog
  };
});
