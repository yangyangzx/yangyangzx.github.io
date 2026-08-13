/* eslint-env jest */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Slippage = require('../js/slippage');
const CalculationUI = require('../js/calculation-ui');

function mountCalculatorDom() {
  document.body.innerHTML = `
    <input id="symbol" value="BTC" />
    <input id="entryPrice" value="100" />
    <input id="capital" value="1000" />
    <input id="riskInput" value="2%" />
    <input id="leverage" value="10" />
    <select id="direction"><option value="long" selected>long</option></select>
    <select id="orderType"><option value="market" selected>market</option></select>
    <select id="stopType"><option value="stop-market" selected>stop-market</option></select>
    <input id="stopLoss" value="95" />
    <input id="targetPrice" value="110" />
    <input id="lossStreak" value="0" />
    <input id="atrValue" value="" /><input id="atrMultiplier" value="1.5" />
    <input id="mindsetScore" value="3" /><input id="feeRate" value="0.08" />
    <select id="slippageMode"><option value="default" selected>default</option><option value="manual">manual</option></select>
    <input id="entrySlippageTicks" value="0" /><input id="exitSlippageTicks" value="0" />
    <input id="kellyWinRate" value="" /><input id="kellyAvgWin" value="" /><input id="kellyAvgLoss" value="" />
    <div id="riskHint"></div><button id="calcBtn"></button><button id="saveBtn"></button><button id="splitSaveBtn"></button>
    <div id="resultBox"><div id="positionDisplay"></div><div id="marginDisplay"></div><div id="leverageDisplay"></div>
      <div id="rrDisplay"></div><div id="cardRR"></div><div id="cardMargin"></div><div id="targetDistDisplay"></div>
      <div id="costLine1"></div><div id="costLine2"></div><div id="triggerRow"></div><div id="resultSplitArea"></div>
      <div id="warningDisplay"></div><div id="kellyCard"></div></div>
    <div id="splitSummary"></div><table id="splitTable"></table><div id="triggerContent"></div>
  `;
}

function loadCalculatorSource() {
  const source = fs.readFileSync(path.join(__dirname, '../js/calculator.js'), 'utf8');
  const context = {
    document,
    console,
    Date,
    Math,
    Number,
    JSON,
    setTimeout,
    clearTimeout,
    Slippage,
    CalculationUI,
    getTickSize: () => 0.5,
    getActiveEntryPrice: () => 100,
    loadSettings: () => ({ atrStopEnabled: false }),
    checkDailyLossLimit: () => ({ blocked: true, todayPnl: -25, limit: 20 }),
    checkDailyTradeFrequency: () => ({ blocked: false }),
    calcPortfolioHeat: () => ({ blocked: false }),
    _getTodayLossStreak: () => ({ streak: 0 }),
    getMindsetAdjustment: () => ({ blocked: false, adjustment: 1 }),
    showToast: jest.fn(),
    logs: [],
    _splitMode: false,
    _splitBatches: [],
    localStorage: { getItem: () => null },
    esc: (v) => String(v == null ? '' : v),
    getReason: () => '',
    getSignals: () => [],
    checkSymbolConcentration: () => ({ pass: true }),
    checkRRRequirement: () => ({ pass: true }),
    calcLiquidationPrice: () => 0,
    utils: { calcLiquidationPrice: () => 0 }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'calculator.js' });
  return context;
}

describe('P0-01：源码级风控阻断与保存门禁', () => {
  beforeEach(() => mountCalculatorDom());

  test('日亏损阻断不访问未初始化 DOM 变量，并禁用两种保存路径', () => {
    const app = loadCalculatorSource();
    expect(() => app.calculate()).not.toThrow();
    expect(document.getElementById('positionDisplay').textContent).toBe('日亏损熔断');
    expect(document.getElementById('resultBox').classList.contains('is-blocked')).toBe(true);
    expect(document.getElementById('saveBtn').disabled).toBe(true);
    expect(document.getElementById('splitSaveBtn').disabled).toBe(true);
    expect(app._lastCalc).toBeNull();
    expect(app._lastCalcBlocker.code).toBe('daily-loss-limit');
  });

  test('陈旧计算与硬阻断均不能绕过保存函数', () => {
    const app = loadCalculatorSource();
    app._lastCalc = { positionSize: 100, blockers: [] };
    app._lastCalcDirty = true;
    expect(app.assertSavableCalculation()).toMatchObject({ ok: false });

    app._lastCalcDirty = false;
    app._lastCalcBlocker = { code: 'daily-loss-limit' };
    expect(app.assertSavableCalculation()).toMatchObject({ ok: false });
  });
});

describe('P0-05：双侧 tick 滑点', () => {
  test('多头以不利有效成交价计算，价格冲击只体现一次', () => {
    const model = Slippage.calculate({
      direction: 'long', expectedEntryPrice: 100, expectedExitPrice: 110,
      quantity: 2, tickSize: 0.5, entryTicks: 1, exitTicks: 2
    });
    const grossPnl = (model.effectiveExitPrice - model.effectiveEntryPrice) * model.quantity;
    expect(model.effectiveEntryPrice).toBe(100.5);
    expect(model.effectiveExitPrice).toBe(109);
    expect(model.totalCost).toBe(3);
    expect(grossPnl).toBe(17);
  });

  test('历史现金滑点不会被伪造为 ticks', () => {
    const oldLog = { slippageCost: 4.5 };
    Slippage.migrateLegacyLog(oldLog);
    expect(oldLog.slippage).toMatchObject({ schema: 'legacy-cash-v0', totalCost: 4.5 });
    expect(oldLog.slippage.entryTicks).toBeUndefined();
  });
});
