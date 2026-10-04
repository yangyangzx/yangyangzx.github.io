// ==================== 系统设置 ====================

var SETTINGS_KEY = 'trade_settings_v1';

var SETTINGS_CACHE = null; // 缓存已解析的设置对象，避免重复 localStorage 读写

var SETTINGS_DEFAULTS = {
  accountBalance: 0,
  riskPercent: 2,
  // 未填止损价时生成临时止损价的止损宽度（%）。null = 未配置：calculator 走内置默认
  //（ETH 0.8%，其余 1%），与历史行为一致；设置页留空保存时同样写回 null。
  // 不用 0 作默认：0 会被 calculator 判为越界值，虽会回退到同一默认，但语义含糊。
  provisionalStopPct: null,
  dailyLossLimit: 5,
  maxDrawdownAlert: 20,
  defaultLeverage: 10,
  mmr: 0.5,
  backupCount: 10,
  autoBackup: true,
  customStopLimit: {},       // 新增：品种自定义止损比例，如 { "ETH": 2, "BTC": 3 }
  mindsetMinScore: 3,        // 新增：心态评分最低通过值
  // Skills 融合新增配置
  atrStopEnabled: false,     // ATR 动态止损开关
  atrDefaultMultiplier: 2,   // ATR 默认倍数
  portfolioHeatMax: 8,       // 组合热量最大百分比 (默认 8%)
  minRRRatio: 2,             // 最低盈亏比 (默认 2:1)
  singleSymbolMaxPct: 30,    // 单品种最大占比 (%) —— 用户自定 30%
  dailyTradeMax: 8,          // 每日建议最大交易笔数
  riskHeatMax: 6,              // 组合热量安全上限 (%)
  tpRRs: [1.5, 2.0, 3.0],      // P2-7 FIX：多止盈位默认盈亏比（planner 真正读取，可被用户设置覆盖）
  customSymbols: [             // 新增：自定义品种列表 [{symbol, desc}]
    { symbol: 'BTC', desc: '比特币' },
    { symbol: 'ETH', desc: '以太坊' },
    { symbol: 'SOL', desc: 'Solana' },
    { symbol: 'GOLD', desc: '黄金' }
  ]
};

var SETTINGS_VALIDATORS = {
  accountBalance:  { min: 0,     max: Infinity,  label: '账户余额' },
  riskPercent:     { min: 1,     max: 10,        label: '单笔风险比例' },
  // 临时止损宽度的 % 口径（唯一权威）；calculator.getProvisionalStopLoss 按此判定是否越界，
  // 越界回退内置默认，采用值时再 ÷100 换成小数参与价格计算。改这里的边界是唯一入口。
  provisionalStopPct: { min: 0.3, max: 5,       label: '临时止损宽度' },
  dailyLossLimit:  { min: 1,     max: 50,        label: '日亏损上限' },
  maxDrawdownAlert:{ min: 5,     max: 50,        label: '最大回撤告警' },
  defaultLeverage: { min: 1,     max: 125,       label: '默认杠杆' },
  mmr:             { min: 0.1,   max: 5,         label: '维持保证金率' },
  backupCount:     { min: 3,     max: 50,        label: '备份份数', integer: true },
  atrDefaultMultiplier: { min: 0.5, max: 5,      label: 'ATR 默认倍数' },
  portfolioHeatMax:{ min: 5,     max: 20,        label: '组合热量上限' },
  minRRRatio:      { min: 1,     max: 5,         label: '最低盈亏比' },
  singleSymbolMaxPct: { min: 5, max: 50,        label: '单品种最大占比' },
  dailyTradeMax:   { min: 5,     max: 30,        label: '日最大交易笔数', integer: true },
  riskHeatMax:     { min: 3,     max: 15,        label: '组合热量安全上限' }
  // customStopLimit、mindsetMinScore、provisionalStopPct 不在上方 fields 循环里校验，
  // 原因各不相同，见 saveSettings() 内各段注释
};

// customStopLimit 的边界（唯一权威）；saveSettings 用它校验，getStopLimitPct 读时也用它兜底。
// 下限 0.5% 避免把止损门收窄到「几乎不拦截」，上限 50% 避免形同虚设。
var CUSTOM_STOP_LIMIT_RANGE = { min: 0.5, max: 50 };
// 键必须是纯品种名：字母数字加连字符（BTC / ETHUSDT / XRP-USDC-PERP），
// 拒绝空白、引号、括号，以及 constructor/toString/__proto__ 之类能命中原型链的键。
var CUSTOM_STOP_LIMIT_KEY_RE = /^[A-Za-z][A-Za-z0-9-]{0,15}$/;

/**
 * 校验 customStopLimit 配置对象，返回可直接入库的净化副本；非法时返回 null。
 * 拒绝：非纯对象（数组/字符串/null）、非有限数字的值、越界值、可疑键。
 * 逐键丢弃而不是整段报错时也可用，但保存路径选择整段拒绝以给出明确反馈。
 * @returns {Object|null}
 */
function validateCustomStopLimit(parsed) {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  var out = {};
  var keys = Object.keys(parsed);
  if (keys.length === 0) return out;
  if (keys.length > 200) return null;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = parsed[k];
    if (!CUSTOM_STOP_LIMIT_KEY_RE.test(k)) return null;
    if (typeof v !== 'number' || !isFinite(v)) return null;
    if (v < CUSTOM_STOP_LIMIT_RANGE.min || v > CUSTOM_STOP_LIMIT_RANGE.max) return null;
    out[k.toUpperCase()] = v;
  }
  return out;
}

/**
 * 加载设置（返回对象）
 */
function loadSettings() {
  if (SETTINGS_CACHE !== null) return SETTINGS_CACHE;
  var raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) { SETTINGS_CACHE = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)); return SETTINGS_CACHE; }
  try {
    var settings = JSON.parse(raw);
    var merged = {};
    var keys = Object.keys(SETTINGS_DEFAULTS);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      merged[k] = (settings[k] != null) ? settings[k] : SETTINGS_DEFAULTS[k];
    }
    SETTINGS_CACHE = merged;
    return merged;
  } catch (e) {
    SETTINGS_CACHE = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
    return SETTINGS_CACHE;
  }
}

/**
 * 清除设置缓存（设置变更后调用）
 */
function _clearSettingsCache() {
  SETTINGS_CACHE = null;
}

/**
 * 读取维护保证金率，返回小数（0.005 = 0.5%）。
 *
 * 单一来源：强平价对 MMR 极度敏感——mmr = 0 时公式退化成「零缓冲」，calculator 会判定
 * 开仓即被强平并把 maxViableLev 算成 0；mmr = NaN 会让整个强平价列变成 NaN。设置页
 * 的 mmr 字段有 min 校验，但 localStorage 手工改写、旧版本写入或备份导入都可能落进
 * 0 / NaN / 负数 / 字符串。三处读取点（calculator 强平校验、risk 中心安全距离、
 * dashboard 强平列）历史上各写一份，只有 calculator 判了 > 0，另两处只判 != null——
 * 同一份设置在三个面板会给出不同的强平价。统一收口到这里。
 */
function loadMmr() {
  var mmr = DEFAULT_MMR;
  try {
    var raw = parseFloat(loadSettings().mmr);
    if (Number.isFinite(raw) && raw > 0) mmr = raw / 100;
  } catch (e) {
    console.error('[settings] loadMmr 失败，回退默认', e);
  }
  return mmr;
}

/**
 * 设置写入 localStorage（带配额保护）
 * 与 storage.js 的 saveLogs 防护对齐：setItem 抛 QuotaExceededError 时不得静默丢失——
 * 必须给出错误提示并让调用方感知失败，否则会误报"已保存"而数据实际未落盘。
 * @returns {boolean} 写入成功返回 true；失败（含存储空间不足）返回 false
 */
function _safeSetSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    if (typeof showToast === 'function') showToast('设置保存失败：存储空间不足，请清理或先导出数据', 'error');
    return false;
  }
  return true;
}

/**
 * 渲染设置表单
 */
function renderSettings() {
  var settings = loadSettings();

  var el = document.getElementById('setAccountBalance'); if (el) el.value = settings.accountBalance;
  el = document.getElementById('setRiskPercent');      if (el) el.value = settings.riskPercent;
  // 临时止损宽度：null（未配置）渲染为空，让用户看得出当前用的是内置默认规则
  // （loadSettings 合并后该值只会是 null 或已保存的数字，故无需 != null 判空）
  el = document.getElementById('setProvisionalStopPct');
  if (el) el.value = settings.provisionalStopPct === null ? '' : settings.provisionalStopPct;
  el = document.getElementById('setDailyLossLimit');   if (el) el.value = settings.dailyLossLimit;
  el = document.getElementById('setMaxDrawdownAlert'); if (el) el.value = settings.maxDrawdownAlert;
  el = document.getElementById('setDefaultLeverage');  if (el) el.value = settings.defaultLeverage;
  el = document.getElementById('setMmr');              if (el) el.value = settings.mmr;
  el = document.getElementById('setBackupCount');      if (el) el.value = settings.backupCount;
  el = document.getElementById('setAutoBackup');       if (el) el.checked = settings.autoBackup;

  // ✅ 新增：渲染 mindsetMinScore
  el = document.getElementById('setMindsetMinScore');
  if (el) el.value = settings.mindsetMinScore !== undefined ? settings.mindsetMinScore : 3;

  // ✅ Skills 融合：ATR 动态止损配置
  el = document.getElementById('setAtrStopEnabled');
  if (el) el.checked = settings.atrStopEnabled === true;
  el = document.getElementById('setAtrMultiplier');
  if (el) el.value = settings.atrDefaultMultiplier != null ? settings.atrDefaultMultiplier : 2;

  // ✅ Skills 融合：组合热量配置
  el = document.getElementById('setPortfolioHeatMax');
  if (el) el.value = settings.portfolioHeatMax != null ? settings.portfolioHeatMax : 8;
  el = document.getElementById('setRiskHeatMax');
  if (el) el.value = settings.riskHeatMax != null ? settings.riskHeatMax : 6;

  // ✅ Skills 融合：盈亏比最低限制
  el = document.getElementById('setMinRRRatio');
  if (el) el.value = settings.minRRRatio != null ? settings.minRRRatio : 2;

  // ✅ Skills 融合：单品种集中度限制
  el = document.getElementById('setSingleSymbolMaxPct');
  if (el) el.value = settings.singleSymbolMaxPct != null ? settings.singleSymbolMaxPct : 30;

  // ✅ Skills 融合：日最大交易笔数
  el = document.getElementById('setDailyTradeMax');
  if (el) el.value = settings.dailyTradeMax != null ? settings.dailyTradeMax : 8;

  // ✅ 新增：渲染 customStopLimit 字段（简化版：显示为文本框，JSON 格式）
  el = document.getElementById('setCustomStopLimit');
  if (el) el.value = settings.customStopLimit && Object.keys(settings.customStopLimit).length > 0
    ? JSON.stringify(settings.customStopLimit)
    : '';
}

/**
 * 保存设置
 */
function saveSettings() {
  var settings = loadSettings();

  // ✅ 保存品种管理（从 settings UI 编辑）
  // quiet=true：本调用被 saveSettings 串联，成功提示由下方「设置已保存」统一给出。
  // 必须检查返回值——此处若因配额耗尽失败，后面的主设置写入必然同样失败，
  // 不中止就会连弹两条「存储空间不足」，且旧实现下本函数成功/失败都返回 undefined，
  // 无法区分。
  if (typeof saveCustomSymbols === 'function' && !saveCustomSymbols(true)) return;

  // 读取 + 验证（原有字段）
  var fields = [
    { key: 'accountBalance',  id: 'setAccountBalance',  parser: parseFloat },
    { key: 'riskPercent',     id: 'setRiskPercent',     parser: parseFloat },
    { key: 'dailyLossLimit',  id: 'setDailyLossLimit',  parser: parseFloat },
    { key: 'maxDrawdownAlert',id: 'setMaxDrawdownAlert',parser: parseFloat },
    { key: 'defaultLeverage', id: 'setDefaultLeverage', parser: parseFloat },
    { key: 'mmr',             id: 'setMmr',             parser: parseFloat },
    { key: 'backupCount',     id: 'setBackupCount',     parser: parseFloat },
    // ✅ Skills 融合字段：接入同一校验循环（原先仅判 NaN 后直接赋值，可写入越界值）
    { key: 'atrDefaultMultiplier', id: 'setAtrMultiplier',        parser: parseFloat },
    { key: 'portfolioHeatMax',     id: 'setPortfolioHeatMax',     parser: parseFloat },
    { key: 'riskHeatMax',          id: 'setRiskHeatMax',          parser: parseFloat },
    { key: 'minRRRatio',           id: 'setMinRRRatio',           parser: parseFloat },
    { key: 'singleSymbolMaxPct',   id: 'setSingleSymbolMaxPct',   parser: parseFloat },
    { key: 'dailyTradeMax',        id: 'setDailyTradeMax',        parser: parseFloat }
  ];

  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var el = document.getElementById(f.id);
    if (!el) continue;
    var val = f.parser(el.value);
    if (isNaN(val)) {
      showToast(SETTINGS_VALIDATORS[f.key].label + ' 不是有效数字', 'error');
      return;
    }
    var rule = SETTINGS_VALIDATORS[f.key];
    // 计数语义字段（备份份数 / 日最大笔数）必须为整数。旧实现用 parseInt 静默截断
    // （10.5 → 10），用户看不到自己填的值被改了；现在显式拒绝并提示。
    if (rule.integer && val % 1 !== 0) {
      showToast(rule.label + ' 需为整数（当前输入 ' + el.value + '）', 'error');
      return;
    }
    if (val < rule.min || val > rule.max) {
      showToast(rule.label + ' 需在 ' + rule.min + ' ~ ' + rule.max + ' 之间', 'error');
      return;
    }
    settings[f.key] = val;
  }

  // ✅ 新增：保存 mindsetMinScore（整数，范围 1-5）
  // 与主字段校验一致：解析失败或越界均报错并拒绝保存，不做静默回退/钳位
  var mindsetEl = document.getElementById('setMindsetMinScore');
  if (mindsetEl) {
    // parseFloat + 显式整数校验：parseInt 会把 2.5 静默截成 2 并通过校验，
    // 与下方提示语「需为 1–5 的整数」自相矛盾。
    var msVal = parseFloat(mindsetEl.value);
    if (isNaN(msVal) || msVal % 1 !== 0 || msVal < 1 || msVal > 5) {
      showToast('心态评分最低通过值需为 1–5 的整数', 'warn');
      return;
    }
    settings.mindsetMinScore = msVal;
  }

  // ✅ 保存临时止损宽度（%）：留空 = 恢复内置默认规则（ETH 0.8%，其余 1%）。
  // 不进上方 fields 循环——那里对空字符串报「不是有效数字」，而留空正是本字段
  // 表达「用默认」的唯一方式（同 customStopLimit 的特殊处理思路）。
  var provEl = document.getElementById('setProvisionalStopPct');
  if (provEl) {
    var provRaw = provEl.value.trim();
    if (provRaw === '') {
      settings.provisionalStopPct = null;
    } else {
      var provVal = parseFloat(provRaw);
      var provRule = SETTINGS_VALIDATORS.provisionalStopPct;
      if (isNaN(provVal)) {
        showToast(provRule.label + ' 不是有效数字', 'error');
        return;
      }
      if (provVal < provRule.min || provVal > provRule.max) {
        showToast(provRule.label + ' 需在 ' + provRule.min + ' ~ ' + provRule.max + ' 之间', 'error');
        return;
      }
      settings.provisionalStopPct = provVal;
    }
  }

  // ✅ Skills 融合：保存 ATR 动态止损开关（布尔值）
  // 数值型 Skills 字段（ATR 倍数 / 组合热量上限 / 热量安全上限 / 最低盈亏比 / 单品种占比 / 日最大笔数）
  // 已接入上方 fields 校验循环，NaN 或越界会 showToast 并拒绝保存，不再在此重复赋值。
  var atrEnableEl = document.getElementById('setAtrStopEnabled');
  if (atrEnableEl) settings.atrStopEnabled = atrEnableEl.checked;

  // ✅ 新增：保存 customStopLimit（JSON 格式字符串解析）
  // P1 修复：原实现只做 JSON.parse + typeof==='object'，于是
  //   - {"ETH":"abc"} / {"ETH":-1} / {"ETH":999} 全部静默入库，闸门读到非数字后比较恒为 false；
  //   - [] 也是 object，会被当成有效配置；
  //   - {"constructor":1} 会让 getStopLimitPct 的 custom[s] 命中 Object.prototype.constructor
  //     （返回一个函数，!= null 判定通过），下游拿到的「止损上限」是个函数。
  // 现按白名单键 + 有限数字 + 区间三重校验，任何一项不合格整段拒绝并保持原值。
  var stopLimitEl = document.getElementById('setCustomStopLimit');
  if (stopLimitEl) {
    var customRaw = stopLimitEl.value.trim();
    if (!customRaw || customRaw === '{}') {
      settings.customStopLimit = {};
    } else {
      var customParsed = null;
      try { customParsed = JSON.parse(customRaw); } catch (e) { customParsed = null; }
      var clean = validateCustomStopLimit(customParsed);
      if (!clean) {
        showToast('自定义止损比例无效：需为对象，如 {"ETH":2,"BTC":3}；'
          + '键为品种名（不含括号引号等），值需在 0.5 ~ 50 之间的数字', 'error');
        return;
      }
      settings.customStopLimit = clean;
    }
  }

  // 布尔值
  var autoBackupEl = document.getElementById('setAutoBackup');
  if (autoBackupEl) {
    settings.autoBackup = autoBackupEl.checked;
  }

  // 配额不足时不得误报"设置已保存"；失败则保留内存中的设置对象，避免表单输入被回滚
  if (!_safeSetSettings(settings)) return;
  _clearSettingsCache();

  // 同步全局变量（如果有的话）
  if (typeof _autoBackupIndex !== 'undefined') {
    // 不直接修改 _autoBackupIndex（它由 storage.js 维护）
    // 但可以通过设置的 backupCount 影响后续轮转逻辑
  }

  showToast('设置已保存', 'success');
}

// ==================== 数据管理 ====================

function exportLogs() {
  if (typeof exportCSV === 'function') {
    exportCSV();
    showToast('CSV 已导出', 'success');
  } else {
    showToast('导出功能不可用', 'error');
  }
}

function importLogs() {
  if (typeof document === 'undefined') return;
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.json';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'json') {
        try {
          // stripBOM：JSON.parse 遇到 BOM 直接抛 SyntaxError，提示会变成笼统的「解析失败」
          var data = JSON.parse(stripBOM(ev.target.result));
          if (Array.isArray(data) && (data.length === 0 || (data[0] && typeof data[0] === 'object' && (data[0].symbol != null || data[0].direction != null || data[0].entryPrice != null)))) {
            // v5.6.9：与 io.js 拖拽导入（importJSON）共用同一条「迁移→校验→补 id→去重→确认」
            // 流水线。此前这里只判断形状就全量覆盖，跳过了结构/字段/XSS 三层校验和去重——
            // 同一份文件走文件选择器与走拖拽会得到不同结果（甚至重复导入两次）。
            var rep = _prepareImportedRecords(data);
            if (rep.errors.length > 0) { _showImportValidationFailure(rep.errors); return; }
            _confirmImportThenCommit(rep, 'overwrite');
          } else {
            showToast('JSON 格式不正确（应为数组）', 'error');
          }
        } catch (e) {
          showToast('JSON 解析失败', 'error');
        }
      } else if (ext === 'csv') {
        try {
          parseCSVImport(ev.target.result);
        } catch (e) {
          showToast('CSV 解析失败', 'error');
        }
      } else {
        showToast('不支持的格式，仅支持 CSV/JSON', 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/**
 * 去掉文本首部的 UTF-8 BOM（U+FEFF）。
 *
 * 本站导出（io.js）会写 '﻿' 前缀以便 Excel 正确识别编码；导入侧若不去掉，
 * 首列 header 变成 "﻿时间" 而匹配不到字段映射表里的 '时间'，
 * 「时间 / 品种」这两列最关键的定位字段会整体丢失。JSON 导入同用。
 * @returns {string}
 */
function stripBOM(text) {
  return String(text == null ? '' : text).replace(/^﻿/, '');
}

function parseCSVImport(csvText) {
  var lines = parseCSVRecords(stripBOM(csvText));   // 引号内换行的安全解析，见 parseCSVRecords 注释
  if (lines.length < 2) { showToast('CSV 文件为空', 'error'); return; }

  // CSV 列映射：导出中文 header → 内部字段名
  // 修复（2026-09-07）：原先按英文 key 匹配，导出 header 是中文导致全部落入 else 分支，
  // 导入后字段存为中文 key，页面/统计全部读不到（CSV 导入实际长期失效）。
  var CSV_FIELD_MAP = {
    'ID':'id','时间':'time','品种':'symbol','方向':'direction','订单类型':'orderType','入场价':'entryPrice','有效入场价':'effectiveEntryPrice',
    '止损价':'stopLoss','目标价':'targetPrice','仓位(USDT)':'positionSize','杠杆':'leverage','风险额':'riskAmount','本金':'capital',
    '心态评分':'mindsetScore','形态/策略':'strategyFramework','信号K':'signals','交易时段':'session','市场环境':'marketCondition',
    '平仓类型':'closeType','平仓价':'closePrice','平仓时间':'closeTime','持仓时长(分钟)':'holdDuration','R倍数':'rMultiple',
    '盈亏金额':'pnlAmount','盈亏百分比':'pnlPercent','MAE%':'mae','MFE%':'mfe','执行评分':'executionScore','出场理由':'exitReason',
    '亏损原因':'lossReason','交易情绪':'emotions','平仓备注':'closeNote','入场原因':'reason','手续费':'fee','滑点成本':'slippageCost',
    '计算版本':'calculationVersion','滑点Schema':'slipSchema','入场Ticks':'slipEntryTicks','退出Ticks':'slipExitTicks',
    'TickSize':'slipTickSize','计划有效退出价':'slipEffectiveExit','GroupId':'groupId',
    '已实现盈亏':'realizedPnl','累计手续费':'realizedFee','已平仓比例%':'closedRatio','初始风险':'initialRiskAmount',
    '初始仓位':'initialPositionSize','平仓明细':'closes','部分平仓':'isPartial',
    '盘中动作':'actions','止损轨迹':'stopHistory',
    '目标盈亏比':'targetRR','计划净盈利':'plannedNetProfit'
  };
  var CSV_ARRAY_FIELDS = ['signals','lossReason','emotions','reason'];
  // actions/stopHistory 与 closes 同为 JSON 列：导出时序列化，导入时还原成数组。
  // 旧导出文件没有这两列，缺列时保持 undefined（recordStopMove 会按需懒初始化）
  var CSV_JSON_FIELDS = ['actions','splitEntries','closes','stopHistory'];
  // targetRR / plannedNetProfit 必须入表：stats.js 的「盈亏比偏差」靠这对字段比对，
  // 缺列时它们退成 undefined 被整笔排除，指标样本量静默缩小（导出→导入一轮后全丢）。
  var CSV_NUM_FIELDS = ['entryPrice','stopLoss','targetPrice','positionSize','leverage','riskAmount','capital','fee','slippageCost','closePrice','pnlAmount','mae','mfe','lowPrice','highPrice','rMultiple','pnlPercent','holdDuration','realizedPnl','realizedFee','closedRatio','initialRiskAmount','initialPositionSize','targetRR','plannedNetProfit'];
  var CSV_INT_FIELDS = ['mindsetScore','executionScore'];

  var headers = lines[0];
  var imported = [];
  var importWarnings = [];
  for (var i = 1; i < lines.length; i++) {
    var values = lines[i];
    // P1 修复：字段数与 header 不一致说明该行已损坏（换行/引号未闭合/列数变化）。
    // 静默跳过会让一条记录悄悄少列、且用户无从察觉；改为记录并提示。
    if (values.length !== headers.length) {
      importWarnings.push('第 ' + (i + 1) + ' 行字段数 ' + values.length + ' ≠ 表头 ' + headers.length);
      continue;
    }
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var h = headers[j];
      var v = values[j] || '';
      var key = CSV_FIELD_MAP[h] || h; // 中文 header 映射；未知/英文 header 原样使用
      if (CSV_ARRAY_FIELDS.indexOf(key) !== -1) {
        obj[key] = v ? v.split(';').filter(Boolean) : [];
      } else if (CSV_JSON_FIELDS.indexOf(key) !== -1) {
        try { obj[key] = v ? JSON.parse(v) : (key === 'closes' ? [] : null); } catch(e) { obj[key] = key === 'closes' ? [] : null; }
      } else if (key === 'isPartial') {
        obj[key] = v === 'true' || v === '1';
      } else if (CSV_NUM_FIELDS.indexOf(key) !== -1) {
        // Excel 里把单元格设成千位分隔后导出会是 "1,234.56"。parseFloat 遇到逗号只取
        // 逗号前一位（"1,234.56" → 1），26 个数值列全部静默截断且无任何告警。
        // 先剥掉千位分隔符与空白，让值能按预期还原成数字。
        var _numSrc = (typeof v === 'string') ? v.replace(/[, ]/g, '') : v;
        var parsed = parseFloat(_numSrc);
        // rMultiple 可能带 'R' 后缀（如 "2.5R"），需先去除
        if (key === 'rMultiple' && typeof v === 'string') parsed = parseFloat(v.replace(/R$/g, ''));
        obj[key] = isNaN(parsed) ? null : parsed;
      } else if (CSV_INT_FIELDS.indexOf(key) !== -1) {
        var parsedInt;
        if (key === 'mindsetScore' && typeof v === 'string' && v.indexOf('★') !== -1) {
          parsedInt = v.split('★').length - 1; // 兼容旧版星号串（如 ★★★☆ → 3）
        } else {
          parsedInt = parseInt(v);
        }
        obj[key] = isNaN(parsedInt) ? null : parsedInt;
      } else {
        obj[key] = v;
      }
    }
    // 滑点快照还原：导出时各滑点字段独立成列（slipSchema/slipEntryTicks/...），导入时重组进 slippage.planning
    var hasSlip = (obj.slipSchema && obj.slipSchema !== '') ||
      (obj.slipEntryTicks != null && obj.slipEntryTicks !== '') ||
      (obj.slipExitTicks != null && obj.slipExitTicks !== '') ||
      (obj.slipTickSize != null && obj.slipTickSize !== '') ||
      (obj.slipEffectiveExit != null && obj.slipEffectiveExit !== '');
    if (hasSlip) {
      var slipPlan = {};
      if (obj.slipSchema) slipPlan.schema = obj.slipSchema;
      if (obj.slipEntryTicks != null && obj.slipEntryTicks !== '') slipPlan.entryTicks = parseFloat(obj.slipEntryTicks);
      if (obj.slipExitTicks != null && obj.slipExitTicks !== '') slipPlan.exitTicks = parseFloat(obj.slipExitTicks);
      if (obj.slipTickSize != null && obj.slipTickSize !== '') slipPlan.tickSize = parseFloat(obj.slipTickSize);
      if (obj.slipEffectiveExit != null && obj.slipEffectiveExit !== '') slipPlan.effectiveExitPrice = parseFloat(obj.slipEffectiveExit);
      obj.slippage = { schema: 'ticks-v1', planning: slipPlan, unit: 'ticks', source: 'csv-import' };
    }
    delete obj.slipSchema; delete obj.slipEntryTicks; delete obj.slipExitTicks; delete obj.slipTickSize; delete obj.slipEffectiveExit;
    imported.push(obj);
  }

  // 迁移、补 id 与去重统一在 _prepareImportedRecords 里做（与 JSON 路径共用），避免两份实现。
  // 列数不匹配的行已跳过：必须让用户知道，否则「少了 N 条」无从追查。
  // 前 5 条明细 + 总数，避免对话框被一屏报错淹没。
  var warnMsg = null;
  if (importWarnings.length > 0) {
    warnMsg = importWarnings.length + ' 行列数与表头不一致，已跳过：\n'
      + importWarnings.slice(0, 5).join('\n')
      + (importWarnings.length > 5 ? '\n…（另有 ' + (importWarnings.length - 5) + ' 行）' : '');
  }
  // v5.6.9：与 JSON 导入共用「迁移→校验→补 id→去重→确认」流水线，覆盖确认文案只写一处。
  var rep = _prepareImportedRecords(imported, warnMsg);
  if (rep.errors.length > 0) { _showImportValidationFailure(rep.errors); return; }
  _confirmImportThenCommit(rep, 'overwrite');
}

/**
 * 解析整段 CSV 为二维数组（记录 × 字段）。
 *
 * P1 修复：原实现先 `text.split(/\r?\n/)` 再逐行 parseCSVLine，等价于假设「字段内
 * 不会有换行」。而本站导出（io.js）只把 `"` 转义成 `""`，用户文本字段（出场理由/平仓备注/
 * 入场原因/亏损原因/情绪/策略形态）里只要有一个换行，就会被拆成两条记录：
 * 该行后续所有列整体右移、其后的每一行也全部错位，一次导出→导入即静默损毁全表，
 * 且不报任何错（每行都能被 parseCSVLine 成功解析，只是内容已错）。
 * 引号内的换行是 RFC 4180 明确允许的合法 CSV，Excel 也照此导出，所以这里按
 * 完整状态机解析，而不靠 split 换行。
 * @returns {Array<Array<string>>}
 */
function parseCSVRecords(text) {
  var records = [];
  var field = '';
  var row = [];
  var inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;   // 含 \n / \r —— 引号内原样保留
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;   // \r\n 视为一个换行
      row.push(field); records.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  // 文件末尾无换行时，最后的字段/行还没落盘
  if (field.length > 0 || row.length > 0) { row.push(field); records.push(row); }
  // 丢弃全空行（含尾部空行）
  var out = [];
  for (var j = 0; j < records.length; j++) {
    var r = records[j];
    var empty = true;
    for (var k = 0; k < r.length; k++) { if (r[k].trim() !== '') { empty = false; break; } }
    if (!empty) out.push(r);
  }
  return out;
}

/**
 * 解析单行 CSV 为字段数组。保留供既有调用/测试使用；内部委托 parseCSVRecords，
 * 使行内解析与整表解析口径一致（此前是两份独立实现）。
 * @returns {Array<string>}
 */
function parseCSVLine(line) {
  var recs = parseCSVRecords(line == null ? '' : line);
  return (recs.length > 0) ? recs[0] : [];
}

/**
 * 导入落库 —— importLogs（JSON 文件）与 parseCSVImport（CSV）共用。
 * 导入是全量覆盖，属破坏性操作，故写入前用自研对话框确认。
 * @param {Array} newLogs 待写入的日志数组
 */
function _commitImportedLogs(newLogs) {
  logs = newLogs;
  saveLogs();
  showToast('已导入 ' + newLogs.length + ' 条日志', 'success');
  if (typeof renderLogs === 'function') renderLogs();
  renderSettings();
  // P0-6: 导入后刷新仪表盘
  if (typeof renderDashboard === 'function') renderDashboard();
}

/**
 * 去重键。_logFingerprint 把 id 放在第一分量，所以「导入时才补了 id 的记录」一旦换上新 id，
 * 完整指纹就和现有记录永远对不上——同一份没有 ID 列的旧版导出重复导入两次会产生两条记录。
 * 这里同时给出带 id 与去 id 两种键：带 id 的键负责不误合并不同记录，去 id 的键负责认出
 * 重复导入。调用方用 `_hadId` 决定是否启用第二种键。
 */
function _logKeys(item) {
  if (typeof _logFingerprint !== 'function') {
    var js = JSON.stringify(item);
    return [js, js];
  }
  var noId = Object.assign({}, item);
  delete noId.id;
  return [_logFingerprint(item), _logFingerprint(noId)];
}

// 导入时统一归一化的数值字段（JSON 里可能是字符串或 NaN/Infinity；CSV 解析已给数字，重复归一无害）
var IMPORT_NUM_FIELDS = ['entryPrice','stopLoss','targetPrice','positionSize','leverage','riskAmount','capital','fee','slippageCost','closePrice','pnlAmount','mae','mfe','lowPrice','highPrice','rMultiple','pnlPercent','holdDuration','effectiveEntryPrice','stopType','atrStopMode','calculationVersion','grossPnlAmount','actualCloseFee','actualExitLegacySlippageCost','realizedPnl','realizedFee','closedRatio','initialRiskAmount','initialPositionSize','targetRR','plannedNetProfit'];

/**
 * 数值字段归一化：必须在结构校验之前跑，否则 validateFields 会把 JSON 里的 '100'
 * 判成「字段类型错误：期望 number，实际 string」，一份纯数字型的备份会被整批拒绝。
 */
function _normalizeImportedValues(records) {
  for (var k = 0; k < records.length; k++) {
    for (var nf = 0; nf < IMPORT_NUM_FIELDS.length; nf++) {
      var f = IMPORT_NUM_FIELDS[nf];
      if (records[k][f] != null) {
        var v = parseFloat(records[k][f]);
        records[k][f] = isNaN(v) ? null : v;
      }
    }
  }
}

/**
 * 导入提交前的公共收尾：数值归一化 → Schema 迁移 → 结构/字段/XSS 校验 → 补稳定 id → 去重。
 *
 * CSV（parseCSVImport）与 JSON（importJSON / 设置页文件选择器）三条入口共用这一条流水线。
 * 此前每份入口各写一遍：JSON 走设置页选择器时只判断形状就直接全量覆盖，既跳过校验也跳过
 * 去重；io.js 的拖拽导入自己又做一遍带 id 的去重但用的是「已生成 id」做键，同一文件里
 * 两条重复记录会各拿一个新 id 因而双双通过。
 *
 * 失败即整批放弃（fail-closed）：半截导入会留下一份「看似成功」的部分数据，比整批拒绝危险。
 * @param {Array} records      解析出的记录数组（会被原地迁移与归一化）
 * @param {string} [extraWarnings] 解析阶段产出的告警文本
 * @returns {{errors: Array, warnings: Array, candidates: Array, deduped: number, total: number, existingCount: number}}
 */
function _prepareImportedRecords(records, extraWarnings) {
  var report = { errors: [], warnings: [], candidates: [], deduped: 0, total: records.length, existingCount: logs.length };
  try {
    _normalizeImportedValues(records);
    if (typeof migrateLogsToCurrentSchema === 'function') migrateLogsToCurrentSchema(records, 0);
    else if (typeof _migrateTimes === 'function') _migrateTimes(records);
    // 三层校验的唯一实现（结构 → 字段类型/业务规则 → XSS 净化），返回体是它自己的形状，
    // 这里挑字段拷回 report，保证 candidates/deduped 这些由本函数维护的字段不被丢掉
    var vr = (typeof importValidator !== 'undefined') ? importValidator.validateAndSanitize(records) : null;
    report.errors = vr ? vr.errors : [];
    report.warnings = vr ? vr.warnings.slice() : [];
    report.valid = vr ? vr.valid : records.slice();
    report.total = records.length;
    report.existingCount = logs.length;
  } catch (e) {
    report.errors = ['校验失败: ' + e.message];
  }
  if (report.errors.length > 0) {
    report.candidates = [];
    report.deduped = 0;
    return report;
  }
  report.warnings = report.warnings.slice();
  if (extraWarnings) report.warnings.push(extraWarnings);
  var valid = Array.isArray(report.valid) ? report.valid : [];
  var existing = new Set();
  for (var _ei = 0; _ei < logs.length; _ei++) {
    var _ek = _logKeys(logs[_ei]);
    existing.add(_ek[0]);
    existing.add(_ek[1]);
  }
  var candidates = [];
  for (var i = 0; i < valid.length; i++) {
    var rec = valid[i];
    // 必须先记住有没有原始 id：id 是上面刚生成的，同文件内两条重复记录 id 各不相同，
    // 只拿 id 当键会双双通过。
    var _hadId = !!rec.id;
    if (!_hadId) rec.id = window.utils.genLogId(logs.concat(candidates));
    var _keys = _logKeys(rec);
    if (existing.has(_keys[0]) || (!_hadId && existing.has(_keys[1]))) { report.deduped++; continue; }
    // P0 修复（2026-10-04）：候选之间不再互相比对——上面两行 existing.add 已删除。
    // 去重只针对【现有日志】，同一次导入内部不判重。原因：内容完全相同的两条记录，
    // 在数学上无法与「同一份文件被重复导入两次」区分（没有 ID 列时两者都是无 ID 的
    // 全同内容），判重必然二选一，而误伤的代价是静默丢掉真实交易——saveSplit 生成的
    // 多批次共用 groupId 与同一时间戳，_logFingerprint 只有 7 个字段且不含批次标签，
    // 等分时逐字相同，实测 3 笔分批导入后只剩 1 条、errors=0、无任何提示。
    // 「重复导入同一份文件」的判据由与现有日志比对承担，那条路径不受影响。
    candidates.push(rec);
  }
  report.candidates = candidates;
  return report;
}

/**
 * 追加提交：先记下原有长度，保存失败就回滚，避免出现「内存里已改、本地存储没变」。
 */
function _commitAppendedLogs(candidates) {
  var originalLength = logs.length;
  logs.push.apply(logs, candidates);
  if (!saveLogs()) {
    logs.splice(originalLength, candidates.length);
    showToast('导入未保存，已恢复到导入前状态。', 'error');
    return;
  }
  showToast('成功导入 ' + candidates.length + ' 条记录', 'success');
  // 导入后同步刷新日志表，并清空索引依赖型状态，避免索引错位
  if (window._pendingDeleteIndices) window._pendingDeleteIndices.clear();
  if (typeof _expandedRows !== 'undefined') _expandedRows.clear();
  if (typeof _closePriceEdited !== 'undefined') { for (var _ik in _closePriceEdited) delete _closePriceEdited[_ik]; }
  if (typeof renderLogs === 'function') renderLogs();
  // P0-6: 导入后刷新仪表盘
  if (typeof renderDashboard === 'function') renderDashboard();
}

/**
 * 校验失败提示：整批未导入，只列前 5 条，避免对话框被一屏报错淹没。
 */
function _showImportValidationFailure(errors) {
  window.confirmDialog({
    title: '导入验证失败',
    message: '为保证日志完整性，本次未导入任何记录。\n\n'
      + errors.slice(0, 5).join('\n')
      + (errors.length > 5 ? '\n…（另有 ' + (errors.length - 5) + ' 个错误）' : ''),
    alertOnly: true,
    confirmText: '知道了'
  });
}

/**
 * 0 条候选的收尾提示：明确说明没有写入任何数据，避免用户以为导入生效了。
 *
 * P1 修复（2026-10-04）：0 条候选原先仍能提交。覆盖模式会弹出
 * 「将用文件中的 0 条记录覆盖现有 N 条日志」，用户确认后 _commitImportedLogs([])
 * 直接把全部历史清空，并回一条「已导入 0 条日志」的 success 提示——数据已丢，
 * 提示还说是成功的。两个真实触发面：① 去重把整批丢弃（用户重新导入自己导出的
 * 那份 CSV，双键去重后 candidates=0）；② 解析阶段全部落空（表头列数与数据行
 * 不一致的行被整行跳过）。追加模式提交空数组虽无害，但会给「成功导入 0 条」的
 * 误导提示，故两种模式一并拦下。
 */
function _showImportEmptyResult(existing, warnTxt, deduped) {
  // 0 条候选最常见的原因是「整批与现有日志重复」（重新导入自己导出的文件）。
  // 不写出来用户只会以为文件是空的或格式坏了。
  window.confirmDialog({
    title: '没有可导入的记录',
    message: '文件里没有一条记录可通过校验，未写入任何数据。'
      + (deduped ? '\n其中 ' + deduped + ' 条与现有日志重复，已判为重复跳过。' : '')
      + (existing ? '\n现有 ' + existing + ' 条日志保持原样。' : '')
      + '\n请检查文件是否为正确的导出格式。' + warnTxt,
    alertOnly: true,
    confirmText: '知道了'
  });
}

/**
 * 导入确认（覆盖 / 追加两种模式共用一套文案与交互）：
 *   mode='overwrite' 全量覆盖现有日志，明确提示丢失数量；现有日志为空时没有可丢的数据，直接提交
 *   mode='append'     追加到现有日志之后
 * @param {Object} report  _prepareImportedRecords 的返回值
 * @param {string} mode    'overwrite' | 'append'
 */
function _confirmImportThenCommit(report, mode) {
  var candidates = report.candidates || [];
  var existing = report.existingCount || logs.length;
  var warnTxt = report.warnings.length ? '\n\n⚠ ' + report.warnings.join('\n') : '';
  // P1 修复：0 条候选直接收尾，不进任何提交路径。原先覆盖模式在 candidates=0 时仍会
  // 弹出「用文件中的 0 条记录覆盖现有 N 条日志」，确认后 _commitImportedLogs([]) 把全部
  // 历史清空并提示「已导入 0 条日志」——去重整批丢弃（重复导入自己导出的 CSV）或解析
  // 阶段全部落空都会走到这里。详见 _showImportEmptyResult 注释。
  if (candidates.length === 0) {
    _showImportEmptyResult(existing, warnTxt, report.deduped);
    return;
  }
  if (mode !== 'overwrite') {
    window.confirmDialog({
      title: '确认导入',
      message: '导入验证完成：\n有效新记录: ' + candidates.length + ' 条'
        + (report.deduped ? '\n重复跳过: ' + report.deduped + ' 条' : '')
        + warnTxt + '\n\n是否继续追加导入？',
      confirmText: '继续导入'
    }).then(function(ok) { if (ok) _commitAppendedLogs(candidates); });
    return;
  }
  if (!existing) { _commitImportedLogs(candidates); return; }
  window.confirmDialog({
    title: '导入将覆盖现有日志',
    message: '将用文件中的 ' + candidates.length + ' 条记录覆盖现有 ' + existing + ' 条日志。\n原有数据不可恢复。'
      // 去重发生在覆盖之前：不披露的话，用户看到的是「3 条覆盖 2 条」，实际只写入 1 条，
      // 被去重丢掉的那条若内容是改过的（同 id 已修改），修改会静默消失。
      // 追加模式已披露同一件事（见上方「重复跳过」），覆盖模式同样要披露。
      + (report.deduped ? '\n另有 ' + report.deduped + ' 条与现有日志重复，将一并跳过。' : '')
      + warnTxt,
    confirmText: '覆盖导入',
    danger: true
  }).then(function(ok) { if (ok) _commitImportedLogs(candidates); });
}

function resetSettings() {
  // 破坏性操作：自研对话框说明影响范围（只重置设置，不动日志数据）
  window.confirmDialog({
    title: '重置设置为默认值',
    message: '所有风控参数、交易参数与 Skills 融合参数将恢复默认值。\n交易日志不受影响。',
    confirmText: '重置',
    danger: true
  }).then(function(ok) {
    if (!ok) return;
    localStorage.removeItem(SETTINGS_KEY);
    _clearSettingsCache();
    renderSettings();
    showToast('设置已重置为默认值', 'success');
  });
}

// ==================== Settings 导入导出 ====================

/**
 * 导出设置为 JSON 文件
 */
function exportSettings() {
  var settings = loadSettings();
  var json = JSON.stringify(settings, null, 2);
  var b = new Blob([json], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'trading_settings_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('设置已导出', 'success');
}

/**
 * 从 JSON 文件导入设置（合并模式：保留现有值）
 */
function importSettings() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var imported = JSON.parse(ev.target.result);
        if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) {
          showToast('文件格式不正确', 'error');
          return;
        }
        // 合并：导入文件覆盖当前值（导入=恢复备份语义），仅跳过显式 null
        // 修复（2026-09-07）：原 `!(k in current)` 恒为 false（loadSettings 已合并全部默认键），
        // 导致导入的设置字段永不生效（只有 customSymbols 追加逻辑在跑）。
        var current = loadSettings();
        var keys = Object.keys(SETTINGS_DEFAULTS);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (imported[k] != null) {
            current[k] = imported[k];
          }
        }
        // 特殊处理 customSymbols（合并而非覆盖）
        if (imported.customSymbols && Array.isArray(imported.customSymbols)) {
          var existingSyms = {};
          for (var j = 0; j < current.customSymbols.length; j++) {
            existingSyms[current.customSymbols[j].symbol] = true;
          }
          imported.customSymbols.forEach(function(s) {
            if (!existingSyms[s.symbol]) {
              current.customSymbols.push(s);
            }
          });
        }
        if (!_safeSetSettings(current)) return;
        _clearSettingsCache();
        renderSettings();
        if (typeof renderCustomSymbols === 'function') renderCustomSymbols();
        showToast('设置已导入', 'success');
      } catch (err) {
        showToast('解析失败: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ==================== 品种管理 ====================

/**
 * 将 settings.customSymbols 同步到 input#symbol 的 datalist
 */
function syncSymbolDatalist() {
  var dl = document.getElementById('symbolDatalist');
  if (!dl) return;
  var symbols = loadSettings().customSymbols || [];
  dl.innerHTML = '';
  symbols.forEach(function(s) {
    var opt = document.createElement('option');
    opt.value = s.symbol;
    dl.appendChild(opt);
  });
}

/**
 * 渲染品种管理区域（在设置页的交易参数卡片中）
 */
function renderCustomSymbols() {
  var container = document.getElementById('customSymbolsList');
  if (!container) return;
  var symbols = loadSettings().customSymbols || [];
  var html = '<table class="custom-symbols-table"><thead><tr><th>品种</th><th>说明</th><th></th></tr></thead><tbody>';
  symbols.forEach(function(s, idx) {
    html += '<tr><td><input type="text" class="cs-symbol" value="' + esc(s.symbol) + '" /></td>';
    html += '<td><input type="text" class="cs-desc" value="' + esc(s.desc || '') + '" placeholder="如：比特币、以太坊..." /></td>';
    html += '<td><button class="btn-remove btn-sm" onclick="removeCustomSymbol(' + idx + ')">&times;</button></td></tr>';
  });
  html += '</tbody></table>';
  html += '<button class="btn btn-sm btn-outline" onclick="addCustomSymbol()" style="margin-top:8px;"><i class="fas fa-plus"></i> 添加品种</button>';
  container.innerHTML = html;
}

// esc() 不在此重复定义：constants.js 已提供全站唯一实现（含 ' → &#39;）。
// 此前这里另有一份更弱的版本（缺单引号转义），而 settings.js 在加载顺序里靠后，
// 把强版本全局覆盖掉了——于是所有 esc() 调用点都退化成弱转义。
// 另外 ?? 与 || 的差别：数字 0 应显示为 "0" 而非空串。


function addCustomSymbol() {
  var settings = loadSettings();
  if (!settings.customSymbols) settings.customSymbols = [];
  settings.customSymbols.push({ symbol: '', desc: '' });
  if (!_safeSetSettings(settings)) return;
  _clearSettingsCache();
  renderCustomSymbols();
}

function removeCustomSymbol(idx) {
  var settings = loadSettings();
  if (!settings.customSymbols) return;
  settings.customSymbols.splice(idx, 1);
  if (!_safeSetSettings(settings)) return;
  _clearSettingsCache();
  renderCustomSymbols();
}

// 返回值契约：true = 品种列表写入生效；false = 存储写入失败，调用方应中止后续保存。
// 旧实现成功与失败都返回 undefined，saveSettings() 无从区分，配额耗尽时
// 「品种列表」与「主设置」两处各弹一条错误，且用户会以为其余字段仍在保存中。
// quiet=true 时抑制成功提示——被 saveSettings 串联调用时由下方「设置已保存」统一提示，
// 避免两条成功 toast 叠加。
function saveCustomSymbols(quiet) {
  var rows = document.querySelectorAll('#customSymbolsList .cs-symbol');
  var descs = document.querySelectorAll('#customSymbolsList .cs-desc');
  var symbols = [];
  rows.forEach(function(inp, i) {
    var sym = (inp.value || '').trim().toUpperCase();
    var desc = (descs[i] && descs[i].value || '').trim();
    if (sym) symbols.push({ symbol: sym, desc: desc });
  });
  var settings = loadSettings();
  settings.customSymbols = symbols;
  if (!_safeSetSettings(settings)) return false;
  _clearSettingsCache();
  syncSymbolDatalist();
  if (!quiet) showToast('品种列表已保存', 'success');
  return true;
}
