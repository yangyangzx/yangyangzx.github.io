// ==================== 系统设置 ====================

var SETTINGS_KEY = 'trade_settings_v1';

var SETTINGS_CACHE = null; // 缓存已解析的设置对象，避免重复 localStorage 读写

var SETTINGS_DEFAULTS = {
  accountBalance: 0,
  riskPercent: 2,
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
  singleSymbolMaxPct: 10,    // 单品种最大占比 (%)
  dailyTradeMax: 8,          // 每日建议最大交易笔数
  riskHeatMax: 6,              // 组合热量安全上限 (%)
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
  dailyLossLimit:  { min: 1,     max: 50,        label: '日亏损上限' },
  maxDrawdownAlert:{ min: 5,     max: 50,        label: '最大回撤告警' },
  defaultLeverage: { min: 1,     max: 125,       label: '默认杠杆' },
  mmr:             { min: 0.1,   max: 5,         label: '维持保证金率' },
  backupCount:     { min: 3,     max: 50,        label: '备份份数' },
  atrDefaultMultiplier: { min: 0.5, max: 5,      label: 'ATR 默认倍数' },
  portfolioHeatMax:{ min: 5,     max: 20,        label: '组合热量上限' },
  minRRRatio:      { min: 1,     max: 5,         label: '最低盈亏比' },
  singleSymbolMaxPct: { min: 5, max: 50,        label: '单品种最大占比' },
  dailyTradeMax:   { min: 5,     max: 30,        label: '日最大交易笔数' },
  riskHeatMax:     { min: 3,     max: 15,        label: '组合热量安全上限' }
  // customStopLimit 和 mindsetMinScore 不需要简单的数值验证，特殊处理
};

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
 * 渲染设置表单
 */
function renderSettings() {
  var settings = loadSettings();

  var el = document.getElementById('setAccountBalance'); if (el) el.value = settings.accountBalance;
  el = document.getElementById('setRiskPercent');      if (el) el.value = settings.riskPercent;
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
  if (el) el.value = settings.singleSymbolMaxPct != null ? settings.singleSymbolMaxPct : 10;

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
  if (typeof saveCustomSymbols === 'function') saveCustomSymbols();

  // 读取 + 验证（原有字段）
  var fields = [
    { key: 'accountBalance',  id: 'setAccountBalance',  parser: parseFloat },
    { key: 'riskPercent',     id: 'setRiskPercent',     parser: parseFloat },
    { key: 'dailyLossLimit',  id: 'setDailyLossLimit',  parser: parseFloat },
    { key: 'maxDrawdownAlert',id: 'setMaxDrawdownAlert',parser: parseFloat },
    { key: 'defaultLeverage', id: 'setDefaultLeverage', parser: parseFloat },
    { key: 'mmr',             id: 'setMmr',             parser: parseFloat },
    { key: 'backupCount',     id: 'setBackupCount',     parser: parseInt }
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
    if (val < rule.min || val > rule.max) {
      showToast(rule.label + ' 需在 ' + rule.min + ' ~ ' + rule.max + ' 之间', 'error');
      return;
    }
    settings[f.key] = val;
  }

  // ✅ 新增：保存 mindsetMinScore（整数，范围 1-5）
  var mindsetEl = document.getElementById('setMindsetMinScore');
  if (mindsetEl) {
    var msVal = parseInt(mindsetEl.value) || 3;
    if (msVal < 1) msVal = 1;
    if (msVal > 5) msVal = 5;
    settings.mindsetMinScore = msVal;
  }

  // ✅ Skills 融合：保存 ATR 配置
  var atrEnableEl = document.getElementById('setAtrStopEnabled');
  if (atrEnableEl) settings.atrStopEnabled = atrEnableEl.checked;
  var atrMultEl = document.getElementById('setAtrMultiplier');
  if (atrMultEl) {
    var amVal = parseFloat(atrMultEl.value);
    if (!isNaN(amVal)) settings.atrDefaultMultiplier = amVal;
  }

  // ✅ Skills 融合：保存组合热量配置
  var phMaxEl = document.getElementById('setPortfolioHeatMax');
  if (phMaxEl) {
    var phVal = parseFloat(phMaxEl.value);
    if (!isNaN(phVal)) settings.portfolioHeatMax = phVal;
  }
  var rHeatEl = document.getElementById('setRiskHeatMax');
  if (rHeatEl) {
    var rhVal = parseFloat(rHeatEl.value);
    if (!isNaN(rhVal)) settings.riskHeatMax = rhVal;
  }

  // ✅ Skills 融合：保存盈亏比限制
  var minRREl = document.getElementById('setMinRRRatio');
  if (minRREl) {
    var minRRVal = parseFloat(minRREl.value);
    if (!isNaN(minRRVal)) settings.minRRRatio = minRRVal;
  }

  // ✅ Skills 融合：保存单品种限制
  var ssEl = document.getElementById('setSingleSymbolMaxPct');
  if (ssEl) {
    var ssVal = parseFloat(ssEl.value);
    if (!isNaN(ssVal)) settings.singleSymbolMaxPct = ssVal;
  }

  // ✅ Skills 融合：保存日最大笔数
  var dtmEl = document.getElementById('setDailyTradeMax');
  if (dtmEl) {
    var dtmVal = parseFloat(dtmEl.value);
    if (!isNaN(dtmVal)) settings.dailyTradeMax = dtmVal;
  }

  // ✅ 新增：保存 customStopLimit（JSON 格式字符串解析）
  var stopLimitEl = document.getElementById('setCustomStopLimit');
  if (stopLimitEl) {
    try {
      var customRaw = stopLimitEl.value.trim();
      if (customRaw && customRaw !== '{}') {
        var customParsed = JSON.parse(customRaw);
        if (typeof customParsed === 'object' && customParsed !== null) {
          settings.customStopLimit = customParsed;
        } else {
          settings.customStopLimit = {};
        }
      } else {
        settings.customStopLimit = {};
      }
    } catch(e) {
      showToast('自定义止损比例格式无效（请输入有效的 JSON 对象，如 {"ETH":2,"BTC":3}）', 'warn');
      settings.customStopLimit = {}; // 保持原状或清空
    }
  }

  // 布尔值
  var autoBackupEl = document.getElementById('setAutoBackup');
  if (autoBackupEl) {
    settings.autoBackup = autoBackupEl.checked;
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
          var data = JSON.parse(ev.target.result);
          if (Array.isArray(data) && (data.length === 0 || (data[0] && typeof data[0] === 'object' && (data[0].symbol != null || data[0].direction != null || data[0].entryPrice != null)))) {
            // 导入前归一化所有数值字段（JSON 中可能为字符串或 NaN/Infinity）
            var numFields = ['entryPrice','stopLoss','targetPrice','positionSize','leverage','riskAmount','capital','fee','slippageCost','closePrice','pnlAmount','mae','mfe','lowPrice','highPrice','rMultiple','pnlPercent','holdDuration'];
            for (var k = 0; k < data.length; k++) {
              for (var nf = 0; nf < numFields.length; nf++) {
                var f = numFields[nf];
                if (data[k][f] != null) {
                  var v = parseFloat(data[k][f]);
                  data[k][f] = isNaN(v) ? null : v;
                }
              }
            }
            // 所有导入数据先通过统一 Schema 迁移；v2 只标记历史现金滑点，绝不伪造 ticks。
            if (typeof migrateLogsToCurrentSchema === 'function') migrateLogsToCurrentSchema(data, 0);
            else if (typeof _migrateTimes === 'function') _migrateTimes(data);
            logs = data;
            saveLogs();
            showToast('已导入 ' + data.length + ' 条日志', 'success');
            renderLogs();
            renderSettings();
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

function parseCSVImport(csvText) {
  var lines = csvText.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
  if (lines.length < 2) { showToast('CSV 文件为空', 'error'); return; }

  var headers = parseCSVLine(lines[0]);
  var imported = [];
  for (var i = 1; i < lines.length; i++) {
    var values = parseCSVLine(lines[i]);
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var h = headers[j];
      var v = values[j] || '';
      if (h === 'emotions' || h === 'lossReason' || h === 'signals' || h === 'reason') {
        obj[h] = v ? v.split(';').filter(Boolean) : [];
      } else if (h === 'actions') {
        try { obj[h] = v ? JSON.parse(v) : []; } catch(e) { obj[h] = []; }
      } else if (h === 'splitEntries') {
        try { obj[h] = v ? JSON.parse(v) : null; } catch(e) { obj[h] = null; }
      } else if (['entryPrice','stopLoss','targetPrice','positionSize','leverage','riskAmount','capital','fee','slippageCost','closePrice','pnlAmount','mae','mfe','lowPrice','highPrice','rMultiple','pnlPercent','holdDuration'].indexOf(h) >= 0) {
        var parsed = parseFloat(v);
        // rMultiple 可能带 'R' 后缀（如 "2.5R"），需先去除
        if (h === 'rMultiple' && typeof v === 'string') parsed = parseFloat(v.replace(/R$/g, ''));
        obj[h] = isNaN(parsed) ? null : parsed;
      } else if (h === 'mindsetScore' || h === 'executionScore') {
        var parsedInt = parseInt(v);
        obj[h] = isNaN(parsedInt) ? null : parsedInt;
      } else {
        obj[h] = v;
      }
    }
    imported.push(obj);
  }

  if (typeof migrateLogsToCurrentSchema === 'function') migrateLogsToCurrentSchema(imported, 0);
  else if (typeof _migrateTimes === 'function') _migrateTimes(imported);
  logs = imported;
  saveLogs();
  showToast('已导入 ' + imported.length + ' 条日志', 'success');
  if (typeof renderLogs === 'function') renderLogs();
  renderSettings();
}

function parseCSVLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function resetSettings() {
  if (!confirm('确定要将所有设置恢复为默认值吗？交易日志不受影响。')) return;

  localStorage.removeItem(SETTINGS_KEY);
  _clearSettingsCache();
  renderSettings();
  showToast('设置已重置为默认值', 'success');
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
        // 合并：已保存的设置优先，导入数据补全缺失字段
        var current = loadSettings();
        var keys = Object.keys(SETTINGS_DEFAULTS);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (imported[k] != null && !(k in current)) {
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
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
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

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function addCustomSymbol() {
  var settings = loadSettings();
  if (!settings.customSymbols) settings.customSymbols = [];
  settings.customSymbols.push({ symbol: '', desc: '' });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  _clearSettingsCache();
  renderCustomSymbols();
}

function removeCustomSymbol(idx) {
  var settings = loadSettings();
  if (!settings.customSymbols) return;
  settings.customSymbols.splice(idx, 1);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  _clearSettingsCache();
  renderCustomSymbols();
}

function saveCustomSymbols() {
  var rows = document.querySelectorAll('#customSymbolsList .cs-symbol');
  var descs = document.querySelectorAll('#customSymbolsList .cs-desc');
  var symbols = [];
  rows.forEach(function(inp, i) {
    var sym = (inp.value || '').trim().toUpperCase();
    var desc = (descs[i].value || '').trim();
    if (sym) symbols.push({ symbol: sym, desc: desc });
  });
  var settings = loadSettings();
  settings.customSymbols = symbols;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  _clearSettingsCache();
  syncSymbolDatalist();
  showToast('品种列表已保存', 'success');
}
