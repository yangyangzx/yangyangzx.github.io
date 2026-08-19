const STORAGE_KEY = 'trade_logs_plus_v4';
const SCHEMA_VERSION = 4;       // v4: entry reason 标准化迁移（旧字符串→标准选项）
var logs = [];
// ── 全局状态变量 ──
var openClosePanelIdx = -1;         // 当前打开的平仓面板索引（-1 表示无）
var actionPanelIdx = -1;            // 当前打开的动作记录面板索引
var _batchMode = false;             // 批量操作模式开关
var _selectedIndices = new Set();   // 批量模式下选中的日志索引集合
var _splitMode = false;
var _splitBatches = [];  // [{price, alloc, stopLoss}]
var _closePanelKeyHandler = null;   // 平仓面板键盘快捷键处理函数引用 - will be set as stable function

// Define stable keydown handler that doesn't change on each render
function createClosePanelKeyDownHandler() {
  return function(e) {
    if (openClosePanelIdx < 0) return;
    if (e.key === 'Enter') { e.preventDefault(); confirmClose(openClosePanelIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); openClosePanelIdx = -1; renderLogs(); }
  };
}
var _autoBackupIndex = (function() { try { const v = localStorage.getItem('trade_auto_backup_index'); return v !== null ? parseInt(v, 10) : 0; } catch(e) { return 0; } })();
var _activeFilters = { direction: '', symbol: '', strategy: '', status: '', pnl: '', time: '' };
// NOTE: SCHEMA_VERSION also referenced in storage.js - keep consistent

const MINDSET_LABELS = { 1:'极度焦虑', 2:'有些紧张', 3:'中性/平静', 4:'比较冷静', 5:'极度冷静专注' };

// ── 交易情绪标签（心态管理模块） ──
const EMOTION_OPTIONS = [
  { value:'恐惧', desc:'怕利润回吐、怕亏损扩大不敢持仓' },
  { value:'贪婪', desc:'想要赚更多，加大仓位，未按计划止盈' },
  { value:'报复/不甘心', desc:'连续亏损后急于回本，随意开仓' },
  { value:'无聊交易', desc:'没事干，为了交易而交易' },
  { value:'过度自信', desc:'连续盈利后无视风险随意大仓位' },
  { value:'FOMO', desc:'看到行情起飞怕踏空追进去' },
  { value:'犹豫不决', desc:'看到信号不敢入场、入场后不敢持仓' },
  { value:'侥幸心理', desc:'再扛一扛就回来了' }
];

const PATTERN_OPTIONS = {
  'bullish-continuation': [
    { value:'上升三角', label:'上升三角' },
    { value:'看涨楔形', label:'看涨楔形' },
    { value:'看涨旗形', label:'看涨旗形' },
    { value:'看涨对称三角', label:'看涨对称三角' },
    { value:'牛市旗', label:'牛市旗 (Bull Flag)' }
  ],
  'bearish-continuation': [
    { value:'下降三角', label:'下降三角' },
    { value:'看跌楔形', label:'看跌楔形' },
    { value:'看跌旗形', label:'看跌旗形' },
    { value:'看跌对称三角', label:'看跌对称三角' },
    { value:'熊市旗', label:'熊市旗 (Bear Flag)' }
  ],
  'bullish-reversal': [
    { value:'双底', label:'双底' },
    { value:'三重底', label:'三重底' },
    { value:'头肩底', label:'头肩底' },
    { value:'下降楔形', label:'下降楔形' }
  ],
  'bearish-reversal': [
    { value:'双顶', label:'双顶' },
    { value:'三重顶', label:'三重顶' },
    { value:'头肩顶', label:'头肩顶' },
    { value:'上升楔形', label:'上升楔形' }
  ]
};

const PATTERN_GROUP_LABELS = {
  'bullish-continuation':'看涨延续', 'bearish-continuation':'看跌延续',
  'bullish-reversal':'看涨反转', 'bearish-reversal':'看跌反转'
};

const ORDER_TYPES_LONG  = ['market','limit','stop'];
const ORDER_TYPES_SHORT = ['market','limit','stop'];
const ORDER_TYPES_DISABLED_ON_LONG  = [];  // HTML 使用三值方案（limit/stop 通用，方向仅影响 label）
const ORDER_TYPES_DISABLED_ON_SHORT = [];
const ORDER_TYPE_LABELS = {
  // HTML 三值方案（当前使用）
  market:'市价单 (Market Order)',
  limit:'限价单 (Limit Order)',
  stop:'止损单 (Stop Order)',
  // 兼容旧数据（历史日志中可能出现的 limitBuy 等扩展值）
  limitBuy:'Buy Limit', stopBuy:'Buy Stop',
   limitSell:'Sell Limit', stopSell:'Sell Stop',
  stopLimit:'Stop Limit', trailingStop:'Trailing Stop'
};
const ORDER_TYPE_GROUP = {
  market:'市价单', limit:'挂价单', stop:'挂价单',
  limitBuy:'挂价单', stopBuy:'挂价单',
  limitSell:'挂价单', stopSell:'挂价单',
  stopLimit:'条件单', trailingStop:'条件单'
};

const CLOSE_TYPE_LABELS = {
  initialSL:'初始止损', trailingSL:'追踪止损', initialTP:'初始止盈',
  manualWin:'手平赢', manualLoss:'手平损',
  liquidation:'强平/爆仓', partialTP:'部分止盈',
  timeStop:'时间止损', reducePosition:'减仓'
};

const SIGNAL_LABELS = {
  engulfing:'吞没', bodyBreak:'实体突破', emaSupport:'均线方向支持', fibLevel:'斐波那契回撤关键位',
  hammer:'锤子', invertedHammer:'倒锤子', h2:'二次突破', l2:'二次回踩',
  dojiAboveMA:'均线上十字星', dojiBelowMA:'均线下十字星',
  rsiDivergence:'RSI 背离', macdCross:'MACD 金叉/死叉', volumeConfirm:'成交量放量确认'
};

// L3: 交易时段与市场环境
const SESSION_OPTIONS = [
  { value: '', label: '—' },
  { value: 'asia', label: '亚盘' },
  { value: 'europe', label: '欧盘' },
  { value: 'us', label: '美盘' },
  { value: 'overlap', label: '重叠时段' },
  { value: 'allday', label: '全天' }
];
// L3: Market environment — Al Brooks price action taxonomy
const MARKET_CONDITION_OPTIONS = [
  { value: '', label: '—' },
  { value: 'trendStrong',   label: '强趋势' },  // 连续大实体 bar，很少重叠，回调浅短
  { value: 'trendWeak',     label: '弱趋势' },  // 中等 bar，偶尔反转，trapping
  { value: 'breakout',      label: '突破' },    // 从区间明确突破，方向性运动开始
  { value: 'rangeWide',     label: '宽区间' },  // 上下沿明确的通道式震荡
  { value: 'rangeNarrow',   label: '窄区间' },  // bar 实体很小，波动率压缩 (NR)
  { value: 'reversal',      label: '反转' },    // 突破后迅速反转（最危险形态）
  { value: 'pullback',      label: '回调' }     // 趋势中的正常回撤
];

// Helper: 获取 marketCondition 值的中文标签；空值或未知值返回 "—"
function getMarketConditionLabel(value) {
  if (!value) return '—';
  var found = MARKET_CONDITION_OPTIONS.find(function(o) { return o.value === value; });
  return found ? found.label : '—';
}
// LOSS_REASON_OPTIONS 集中定义，避免多处硬编码
const LOSS_REASON_OPTIONS = ['追涨杀跌','扛单/不设止损','过早止盈','逆势操作','情绪化加仓','频繁交易','未按计划执行','外部因素','技术面判断失误','止损设置过紧','黑天鹅事件'];

// ENTRY_REASON_OPTIONS: 入场原因选项（多选）
const ENTRY_REASON_OPTIONS = ['趋势突破','回调入场','震荡区间边界','支撑/压力位确认','均线信号','FVG入场','订单块入场','情绪反转','时间窗口','K线形态确认'];

// TICK_SIZE_MAP: 各品种的最小价格变动单位（tick size）
const TICK_SIZE_MAP = {
  'BTC': 0.1, 'ETH': 0.01, 'SOL': 0.001, 'GOLD': 0.01
};

function getTickSize(symbol) {
  if (!symbol) return 0.1;
  const upper = symbol.toUpperCase();
  for (const [key, value] of Object.entries(TICK_SIZE_MAP)) {
    if (upper.includes(key)) return value;
  }
  return 0.1;
}

// ======== 计算配置常量 ========
// 滑点假设已统一由 Slippage 模块按 tickSize 与双侧 ticks 计算。
// 禁止在其他模块以百分比或“点”重新解释滑点。

/**
 * 默认维持保证金率（USDT-M 期货强平阈值）
 * 主流交易所默认 0.5%
 */
const DEFAULT_MMR = 0.005;

/**
 * 默认杠杆倍数
 */
const DEFAULT_LEVERAGE = 10;

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
