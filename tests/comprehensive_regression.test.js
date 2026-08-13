const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeLocalStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: key => data.delete(key),
    dump: () => Object.fromEntries(data)
  };
}

function runSource(relativePath, additions = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ click: jest.fn() })
  };
  const context = {
    console,
    Math,
    Number,
    Date,
    JSON,
    Set,
    Map,
    Array,
    Object,
    Promise,
    Blob: class Blob {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: jest.fn() },
    confirm: () => false,
    alert: jest.fn(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document,
    localStorage: makeLocalStorage(),
    logs: [],
    showToast: jest.fn(),
    renderLogs: jest.fn(),
    populateFilterOptions: jest.fn(),
    updateBackupTime: jest.fn(),
    preCheckStorageCapacity: () => true,
    STORAGE_KEY: 'trade_logs_plus_v4',
    SCHEMA_VERSION: 2,
    ...additions
  };
  context.window = context;
  context.window.addEventListener = jest.fn();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: relativePath });
  return context;
}

describe('全面修复：保存、迁移与容量事务', () => {
  test('正常保存明确返回 true，内存与持久化保持一致', () => {
    const context = runSource('js/storage.js');
    context.logs.push({ id: 't1', time: '2026-08-13T00:00:00.000Z', symbol: 'BTC' });
    expect(context.saveLogs(true)).toBe(true);
    expect(JSON.parse(context.localStorage.getItem('trade_logs_plus_v4'))).toEqual(context.logs);
  });

  test('覆盖写入容量按最终数据大小判断，而不是将同一数据计算两次', () => {
    const context = runSource('js/storage.js');
    const result = vm.runInContext('StorageSecurity.checkCapacity(3.5 * 1024 * 1024)', context);
    expect(result.canWrite).toBe(true);
    expect(result.recommendation).toContain('较高');
  });

  test('主存储写入失败明确返回 false 且不截断内存日志', () => {
    const storage = makeLocalStorage();
    storage.setItem = () => { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; };
    const context = runSource('js/storage.js', { localStorage: storage });
    context.logs.push({ id: 'old' }, { id: 'new' });
    expect(context.saveLogs(true)).toBe(false);
    expect(context.logs).toHaveLength(2);
  });
});

describe('全面修复：风控口径', () => {
  const utils = {
    toLocalDateStr: value => new Date(value).toISOString().slice(0, 10)
  };

  test('日交易频率按开仓时间计入未平仓计划，同组拆分只算一次', () => {
    const context = runSource('js/skills-integration.js', {
      utils,
      loadSettings: () => ({ dailyTradeMax: 3, singleSymbolMaxPct: 10 }),
      getClosedSorted: () => [],
      getAccountCapital: () => 1000
    });
    const today = new Date().toISOString();
    context.logs.push(
      { time: today, groupId: 'g1' },
      { time: today, groupId: 'g1' },
      { time: today, id: 'a' },
      { time: today, id: 'b' }
    );
    const result = context.checkDailyTradeFrequency();
    expect(result.todayCount).toBe(3);
    expect(result.blocked).toBe(true);
  });

  test('分批仓位的每一条记录均计入品种保证金集中度', () => {
    const context = runSource('js/skills-integration.js', {
      utils,
      loadSettings: () => ({ dailyTradeMax: 8, singleSymbolMaxPct: 100 }),
      getClosedSorted: () => [],
      getAccountCapital: () => 1000
    });
    const result = context.checkSymbolConcentration('BTC', 0, 10, 1000, [
      { symbol: 'BTC', positionSize: 5000, leverage: 10, groupId: 'split-1' },
      { symbol: 'BTC', positionSize: 5000, leverage: 10, groupId: 'split-1' }
    ]);
    expect(result.usedMargin).toBe(1000);
    expect(result.allowedNewMargin).toBe(0);
    expect(result.pass).toBe(true);
  });
});

describe('全面修复：导入、结算与缓存边界', () => {
  test('JSON 导入拒绝零入场价并保留普通文本而非双重实体编码', () => {
    const context = runSource('js/io.js', { utils: { fmtTime: () => '' } });
    const invalid = vm.runInContext("importValidator.validateAndSanitize([{symbol:'BTC',direction:'long',entryPrice:0,time:'2026-08-13T00:00:00.000Z'}])", context);
    expect(invalid.valid).toHaveLength(0);
    expect(invalid.errors.join(' ')).toContain('入场价必须为大于 0');
    const valid = vm.runInContext("importValidator.validateAndSanitize([{symbol:'BTC',direction:'long',entryPrice:100,time:'2026-08-13T00:00:00.000Z',reason:'A & B'}])", context);
    expect(valid.valid[0].reason).toBe('A & B');
  });

  test('平仓预览与确认可共享同一包含费用的净盈亏结算', () => {
    const context = runSource('js/logs.js');
    const settlement = context.calculateCloseSettlement({
      direction: 'long', entryPrice: 100, effectiveEntryPrice: 100,
      positionSize: 1000, leverage: 10, riskAmount: 20,
      fee: 1, slippage: { planning: { schema: 'ticks-v1', effectiveEntryPrice: 100 } }
    }, 110, 5, 0);
    expect(settlement.grossPnl).toBeCloseTo(100, 8);
    expect(settlement.netPnl).toBeCloseTo(95, 8);
    expect(settlement.rMultiple).toBeCloseTo(4.75, 8);
  });

  test('离线缓存忽略脚本版本查询参数，且只将导航请求回退到 index.html', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    expect(source).toContain('ignoreSearch: true');
    expect(source).toContain("event.request.mode === 'navigate'");
    expect(source).not.toContain('self.skipWaiting();\n});');
  });
});


describe('统计准确性：权益与策略样本口径', () => {
  test('权益曲线不将重复的开仓本金快照当作资金重置，回撤按连续权益计算', () => {
    const context = runSource('js/utils.js', { loadSettings: () => ({ accountBalance: 1000 }) });
    const curve = context.window.utils.calcEquityCurve([
      { closeTime: '2026-08-10T00:00:00.000Z', capital: 1000, pnlAmount: 100 },
      { closeTime: '2026-08-11T00:00:00.000Z', capital: 1000, pnlAmount: -50 }
    ]);
    expect(curve.data.map(point => point.eq)).toEqual([1100, 1050]);
    expect(curve.totalPnl).toBe(50);
    expect(curve.maxDDPercent).toBeCloseTo(4.54545, 4);
  });

  test('策略拆解将保本交易计入胜率和平均盈亏的全部执行样本', () => {
    const context = runSource('js/analytics.js', {
      utils: {
        safeParseNum: value => { const n = Number(value); return Number.isFinite(n) ? n : null; },
        fmtDate: value => value || ''
      },
      PATTERN_GROUP_LABELS: {}
    });
    const rows = context.groupByStrategy([
      { strategyFramework: '趋势', strategyPattern: '延续', pnlAmount: 100 },
      { strategyFramework: '趋势', strategyPattern: '延续', pnlAmount: -50 },
      { strategyFramework: '趋势', strategyPattern: '延续', pnlAmount: 0 }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    expect(rows[0].winRate).toBeCloseTo(100 / 3, 8);
    expect(rows[0].avgPnl).toBeCloseTo(50 / 3, 8);
  });
});
