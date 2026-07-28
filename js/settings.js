// ==================== 系统设置 ====================

var SETTINGS_KEY = 'trade_settings_v1';

var SETTINGS_DEFAULTS = {
  accountBalance: 0,
  riskPercent: 2,
  dailyLossLimit: 5,
  maxDrawdownAlert: 20,
  defaultLeverage: 10,
  mmr: 0.5,
  backupCount: 10,
  autoBackup: true
};

var SETTINGS_VALIDATORS = {
  accountBalance:  { min: 0,     max: Infinity,  label: '账户余额' },
  riskPercent:     { min: 1,     max: 10,        label: '单笔风险比例' },
  dailyLossLimit:  { min: 1,     max: 50,        label: '日亏损上限' },
  maxDrawdownAlert:{ min: 5,     max: 50,        label: '最大回撤告警' },
  defaultLeverage: { min: 1,     max: 125,       label: '默认杠杆' },
  mmr:             { min: 0.1,   max: 5,         label: '维持保证金率' },
  backupCount:     { min: 3,     max: 50,        label: '备份份数' }
};

/**
 * 加载设置（返回对象）
 */
function loadSettings() {
  var raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  try {
    var settings = JSON.parse(raw);
    var merged = {};
    var keys = Object.keys(SETTINGS_DEFAULTS);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      merged[k] = (settings[k] != null) ? settings[k] : SETTINGS_DEFAULTS[k];
    }
    return merged;
  } catch (e) {
    return JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  }
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
}

/**
 * 保存设置
 */
function saveSettings() {
  var settings = loadSettings();

  // 读取 + 验证
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

  // 布尔值
  var autoBackupEl = document.getElementById('setAutoBackup');
  settings.autoBackup = autoBackupEl ? autoBackupEl.checked : true;

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

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
            logs = data;
            // 迁移时间格式为 ISO（与 logs.js 的 importJSON 保持一致）
            if (typeof _migrateTimes === 'function') _migrateTimes(logs);
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
      if (h === 'emotions' || h === 'lossReason' || h === 'signals') {
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
        obj[h] = parseInt(v) || null;
      } else {
        obj[h] = v;
      }
    }
    imported.push(obj);
  }

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
  renderSettings();
  showToast('设置已重置为默认值', 'success');
}
