// ==================== 存储 ====================

// showToast / showUndoToast 已提取到 toast.js，由外部脚本加载
// _pendingDelete / _undoToastEl / _undoToastTimer / _commitPendingDelete 已提取到 toast.js

// 存储安全增强配置
const STORAGE_CONFIG = {
  maxSizeBytes: 4 * 1024 * 1024, // 4MB安全限制（浏览器通常5-10MB）
  warningThreshold: 3 * 1024 * 1024, // 3MB警告阈值
  compressionEnabled: false // 暂不启用压缩，避免复杂性
};

// 存储容量检查和备份工具
const StorageSecurity = {
  /**
   * 检查存储容量是否充足
   * @param {number} additionalBytes 预计要添加的字节数
   * @returns {Object} {canWrite: boolean, available: number, recommendation: string}
   */
  checkCapacity(projectedBytes) {
    try {
      // 本应用的安全上限针对“替换后”的完整日志 JSON，而不是旧数据加新数据。
      // localStorage.setItem 会替换同一键，因此不能把同一份数据重复计算两次。
      const nextSize = Number(projectedBytes);
      if (!Number.isFinite(nextSize) || nextSize < 0) {
        return { canWrite: false, available: 0, recommendation: '无法计算日志数据大小' };
      }
      const available = STORAGE_CONFIG.maxSizeBytes - nextSize;
      if (available < 0) {
        return { canWrite: false, available: available, recommendation: '日志数据超过本应用的安全存储上限，请先完整导出并归档历史记录' };
      }
      if (nextSize > STORAGE_CONFIG.warningThreshold) {
        return { canWrite: true, available: available, recommendation: '存储使用率较高，建议备份重要数据' };
      }
      return { canWrite: true, available: available, recommendation: '存储容量正常' };
    } catch (error) {
      console.error('StorageSecurity.checkCapacity失败:', error);
      return { canWrite: false, available: 0, recommendation: '无法检查存储容量' };
    }
  },
  
  /**
   * 创建紧急备份（追加模式：带时间戳键名，避免覆写旧备份）
   */
  createEmergencyBackup() {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupKey = 'emergency_backup_' + ts;
      const backup = {
        timestamp: new Date().toISOString(),
        data: JSON.parse(JSON.stringify(logs)), // 深拷贝
        version: 'emergency_backup_v1'
      };
      localStorage.setItem(backupKey, JSON.stringify(backup));
      console.log('紧急备份已创建:', backupKey);
      return true;
    } catch (error) {
      console.error('创建紧急备份失败:', error);
      return false;
    }
  },
  
  /**
   * 下载备份文件
   */
  downloadBackup() {
    try {
      const dataStr = JSON.stringify(logs, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `trade_logs_backup_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      console.log('备份文件下载已开始');
      return true;
    } catch (error) {
      console.error('下载备份失败:', error);
      return false;
    }
  }
};

// ── 工具：旧版 zh-CN locale 时间 → ISO 字符串（委托给 utils.js） ──
function _localeToISO(t) {
  return window.utils._localeToISO(t);
}

// ── 时间迁移函数（可复用：loadLogs / importJSON 均可调用） ──
function _migrateTimes(logArr) {
  var changed = false;
  for (var i = 0; i < logArr.length; i++) {
    var l = logArr[i];
    // 迁移 time（开仓时间）
    var origTime = l.time;
    l.time = _localeToISO(l.time);
    if (l.time !== origTime) changed = true;
    // 迁移 closeTime（平仓时间）
    if (l.closeTime) {
      var origCT = l.closeTime;
      l.closeTime = _localeToISO(l.closeTime);
      if (l.closeTime !== origCT) changed = true;
    }
    // 回填 closeTime：已平仓但无 closeTime → 用 time 兜底
    if (l.closeType && !l.closeTime) {
      l.closeTime = l.time;
      changed = true;
    }
    // 回填/修复 holdDuration
    if (l.closeTime && l.time) {
      var durMs = new Date(l.closeTime) - new Date(l.time);
      if (!isNaN(durMs) && durMs >= 0) {
        var newDur = Math.round(durMs / 60000);
        if (l.holdDuration !== newDur) { l.holdDuration = newDur; changed = true; }
      }
    }
  }
  return changed;
}

function migrateLogsToCurrentSchema(rows, fromVersion) {
  var changed = false;
  // v3 → v4: entry reason 标准化，将旧字符串映射到 ENTRY_REASON_OPTIONS
  if (fromVersion < 4 && typeof ENTRY_REASON_OPTIONS !== 'undefined') {
    // 旧计算器选项 → 新标准选项的映射
    var REASON_MAP = {
      '突破': '趋势突破',
      '回踩': '回调入场',
      '形态': 'K线形态确认',
      '趋势': '趋势突破',
      '背离交易': '情绪反转',
      '成交量异常': '订单块入场',
      '新闻': null  // 无对应标准选项，保留原值
    };
    var migrated = 0;
    for (var mi = 0; mi < rows.length; mi++) {
      var row = rows[mi];
      var r = row.reason;
      if (r == null) continue;
      // 如果是字符串，尝试映射
      if (typeof r === 'string' && r !== '') {
        var mapped = REASON_MAP[r];
        if (mapped != null) {
          row.reason = [mapped];
          migrated++;
        }
        // mapped === null 时保留原字符串（如"新闻"等自定义值）
      } else if (Array.isArray(r)) {
        // 已经是数组，确保每个值都在标准选项中（含旧字符串映射）
        var valid = [];
        for (var ai = 0; ai < r.length; ai++) {
          if (ENTRY_REASON_OPTIONS.indexOf(r[ai]) !== -1) {
            valid.push(r[ai]);
          } else {
            // 尝试映射旧字符串到新标准选项
            var mapped = REASON_MAP[r[ai]];
            if (mapped != null) valid.push(mapped);
          }
        }
        if (valid.length === 0 && r.length > 0) valid.push(r[0]); // fallback
        row.reason = valid.length > 0 ? valid : null;
      }
    }
    if (migrated > 0) console.log('[storage] v3→v4 migration: ' + migrated + ' reasons normalized');
    changed = changed || migrated > 0;
  }
  if (fromVersion < 1) changed = _migrateTimes(rows) || changed;
  // v2 → v3: executionScore 0（旧写入值）→ null（未评分）
  if (fromVersion < 3) {
    var migrated = 0;
    for (var mi = 0; mi < rows.length; mi++) {
      var row = rows[mi];
      if (row.closeType && row.executionScore === 0) {
        row.executionScore = null;
        changed = true;
        migrated++;
      }
    }
    if (migrated > 0) console.log('[storage] v2→v3 migration: ' + migrated + ' executionScore 0→null');
  }
  if (fromVersion < 2 && window.Slippage && typeof window.Slippage.migrateLegacyLog === 'function') {
    for (var i = 0; i < rows.length; i++) {
      changed = window.Slippage.migrateLegacyLog(rows[i]) || changed;
    }
  }
  return changed;
}

function _logFingerprint(item) {
  return [item && item.id, item && item.groupId, item && item.time, item && item.symbol,
    item && item.direction, item && item.entryPrice, item && item.positionSize].join('|');
}

function _safeRenderAfterStorageChange() {
  if (typeof renderLogs === 'function') renderLogs();
  if (typeof updateLastUpdate === 'function') updateLastUpdate();
  if (typeof populateFilterOptions === 'function') populateFilterOptions();
  // 迁移后刷新复盘图表，避免显示旧数据
  if (typeof destroyReviewCharts === 'function' && typeof renderReview === 'function') {
    renderReview();
  }
}

function loadLogs() {
  var raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    logs = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(logs)) throw new Error('日志根节点不是数组');
  } catch (e) {
    // 保留原始 localStorage 值，绝不以空数组覆盖损坏数据。
    logs = [];
    console.error('日志数据读取失败，原始数据已保留等待恢复:', e);
    if (typeof showToast === 'function') showToast('日志数据无法读取，原始数据未被覆盖。请从备份恢复后再编辑。', 'error');
    return false;
  }

  // v3 → v4：使用完整业务指纹去重，避免同时间同品种的不同拆分交易被误丢弃。
  if (!localStorage.getItem('trade_migrated_v3_to_v4')) {
    try {
      var legacyRaw = localStorage.getItem('trade_logs_plus_v3');
      var v3logs = legacyRaw ? JSON.parse(legacyRaw) : [];
      if (!Array.isArray(v3logs)) throw new Error('旧版日志不是数组');
      var existing = new Set(logs.map(_logFingerprint));
      var additions = v3logs.filter(function(item) {
        var key = _logFingerprint(item);
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      });
      if (additions.length) logs = logs.concat(additions);
      if (additions.length && !saveLogs(true)) throw new Error('旧版日志迁移写入失败');
      localStorage.setItem('trade_migrated_v3_to_v4', '1');
    } catch (e) {
      console.error('v3 日志迁移未完成，将在下次加载时重试:', e);
      if (typeof showToast === 'function') showToast('旧版日志迁移未完成，原始数据已保留，将在下次加载时重试。', 'warn');
    }
  }

  // Schema 版本仅在数据与版本标记均成功写入后提交；失败时保留旧标记以支持下次重试。
  var schemaVer = parseInt(localStorage.getItem('trade_schema_version'), 10) || 0;
  if (schemaVer < SCHEMA_VERSION) {
    try {
      var changed = migrateLogsToCurrentSchema(logs, schemaVer);
      if (changed && !saveLogs(true)) throw new Error('Schema 迁移数据写入失败');
      localStorage.setItem('trade_schema_version', String(SCHEMA_VERSION));
      localStorage.removeItem('trade_time_migration_ver');
      localStorage.removeItem('trade_time_iso_migrated');
    } catch (e) {
      console.error('日志 Schema 迁移未完成，将在下次加载时重试:', e);
      if (typeof showToast === 'function') showToast('日志升级未完成，原始数据已保留，将在下次加载时重试。', 'error');
    }
  }

  if (!window.__tradeStorageListenerBound) {
    window.__tradeStorageListenerBound = true;
    window.addEventListener('storage', function(e) {
      if (e.key !== STORAGE_KEY || e.newValue === e.oldValue || !e.newValue) return;
      try {
        var remoteLogs = JSON.parse(e.newValue);
        if (!Array.isArray(remoteLogs)) return;
        var needsSync = JSON.stringify(remoteLogs) !== JSON.stringify(logs);
        if (needsSync && confirm('检测到另一标签页修改了日志数据。\n\n点击「确定」刷新为最新数据，点击「取消」保留当前数据。')) {
          logs = remoteLogs;
          _safeRenderAfterStorageChange();
          if (typeof showToast === 'function') showToast('已同步为最新数据', 'info');
        }
      } catch (e2) { console.error('多标签页日志同步失败:', e2); }
    });
  }
  return true;
}
// 返回值契约：仅当主日志写入并读回校验成功时返回 true；任何失败均返回 false。
// skipBackup: true 时跳过备份轮转（用于迁移和高频自动保存）。
function saveLogs(skipBackup) {
  var jsonStr;
  try { jsonStr = JSON.stringify(logs); }
  catch (e) {
    if (typeof showToast === 'function') showToast('日志序列化失败: ' + e.message, 'error');
    return false;
  }
  var sizeBytes = jsonStr.length;
  var capacityCheck = StorageSecurity.checkCapacity(sizeBytes);
  if (!capacityCheck.canWrite) {
    if (typeof showToast === 'function') showToast('存储空间不足: ' + capacityCheck.recommendation, 'error');
    StorageSecurity.createEmergencyBackup();
    return false;
  }
  if (!preCheckStorageCapacity(sizeBytes)) {
    if (typeof showToast === 'function') showToast('存储空间检查失败，未写入任何日志数据。请先导出并清理浏览器数据。', 'error');
    return false;
  }

  try {
    localStorage.setItem(STORAGE_KEY, jsonStr);
    var verification = localStorage.getItem(STORAGE_KEY);
    if (verification !== jsonStr) throw new Error('写入验证失败：内容不一致');
  } catch (e) {
    // 不自动截断或改写内存日志；所有数据必须保持可恢复。
    StorageSecurity.createEmergencyBackup();
    console.error('日志保存失败，未修改内存日志:', e);
    if (typeof showToast === 'function') showToast('存储失败，当前日志未被截断。已尝试创建紧急备份，请先导出并清理存储空间。', 'error');
    return false;
  }

  _safeRenderAfterStorageChange();
  if (capacityCheck.recommendation.indexOf('较高') >= 0) {
    StorageSecurity.createEmergencyBackup();
    if (typeof showToast === 'function') showToast('存储使用率较高，已创建紧急备份。', 'warn');
  }
  if (skipBackup) return true;

  try {
    var autoSettings = null;
    var rawSettings = localStorage.getItem('trade_settings_v1');
    if (rawSettings) autoSettings = JSON.parse(rawSettings);
    var autoBackupEnabled = autoSettings ? autoSettings.autoBackup !== false : true;
    var backupCount = autoSettings ? (autoSettings.backupCount || 10) : 10;
    if (autoBackupEnabled) {
      _autoBackupIndex = (_autoBackupIndex + 1) % backupCount;
      // ADR-3 FIX: 使用明确前缀 trade_backup_auto，避免与 emergency_backup_ 混淆
      localStorage.setItem('trade_backup_auto_index', String(_autoBackupIndex));
      localStorage.setItem('trade_backup_auto_' + _autoBackupIndex, JSON.stringify({ time: new Date().toISOString(), data: logs }));
      if (typeof updateBackupTime === 'function') updateBackupTime();
    }
  } catch (backupError) {
    // 主日志已经确认写入，备份轮转失败不应把主事务标记为失败。
    console.warn('自动备份轮转失败:', backupError);
  }
  return true;
}
function updateLastUpdate() {
  const el = document.getElementById('lastUpdate');
  if (el) { const d = new Date(); el.textContent = '\u{1F552} 更新: ' + d.toLocaleTimeString('zh-CN',{hour12:false}); }
}

// ==================== 心态星级 ====================
function renderMindsetStars(score) {
  document.querySelectorAll('#mindsetStars .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= score);
  });
  document.getElementById('mindsetLabel').textContent = MINDSET_LABELS[score] || '';
  document.getElementById('mindsetScore').value = score;
}

// ==================== 形态选项公共构建 ====================
function buildPatternOptions(selectedValue, useOptgroup) {
  const cats = [
    { key:'bullish-continuation', label:PATTERN_GROUP_LABELS['bullish-continuation'] },
    { key:'bearish-continuation', label:PATTERN_GROUP_LABELS['bearish-continuation'] },
    { key:'bullish-reversal', label:PATTERN_GROUP_LABELS['bullish-reversal'] },
    { key:'bearish-reversal', label:PATTERN_GROUP_LABELS['bearish-reversal'] }
  ];
  if (useOptgroup) {
    let html = '<option value="">— 不选择 —</option>';
    for (const cat of cats) {
      html += '<optgroup label="' + cat.label + '">';
      for (const o of PATTERN_OPTIONS[cat.key]) {
        const v = cat.key + '|' + o.value;
        html += '<option value="' + v + '"' + (selectedValue === v ? ' selected' : '') + '>' + o.label + '</option>';
      }
      html += '</optgroup>';
    }
    return html;
  } else {
    let html = '<option value="">—</option>';
    for (const cat of cats) {
      for (const o of PATTERN_OPTIONS[cat.key]) {
        const v = cat.key + '|' + o.value;
        html += '<option value="' + v + '"' + (selectedValue === v ? ' selected' : '') + '>' + cat.label + ' - ' + o.label + '</option>';
      }
    }
    return html;
  }
}

// ==================== 形态二级联动 ====================
function populatePatternSelect() {
  const framework = document.getElementById('strategyFramework').value;
  const patternSelect = document.getElementById('strategyPattern');
  if (!framework) {
    patternSelect.innerHTML = '<option value="">— 不选择 —</option>';
    return;
  }
  patternSelect.innerHTML = buildPatternOptions('', true);
}

// ==================== 订单类型过滤 ====================
function filterOrderTypes(direction) {
  const sel = document.getElementById('orderType');
  const disabledSet = direction === 'long'
    ? ORDER_TYPES_DISABLED_ON_LONG
    : ORDER_TYPES_DISABLED_ON_SHORT;
  const allOptions = sel.querySelectorAll('option');
  let firstEnabled = null;
  const cur = sel.value;
  allOptions.forEach(opt => {
    if (disabledSet.includes(opt.value)) {
      opt.disabled = true;
      opt.hidden = true;
    } else {
      opt.disabled = false;
      opt.hidden = false;
      if (!firstEnabled) firstEnabled = opt;
    }
  });
  if (disabledSet.includes(cur)) {
    sel.value = firstEnabled ? firstEnabled.value : 'market';
    // 闪烁高亮提示 orderType 已被自动修改
    sel.classList.remove('flash-highlight');
    void sel.offsetWidth; // force reflow
    sel.classList.add('flash-highlight');
  } else {
    sel.value = cur;
  }
}

// ==================== 策略/信号 取值 ====================
function getReason() {
  const c = document.getElementById('reasonCustom').value.trim();
  return c || document.getElementById('reasonSelect').value;
}
function getSignals() {
  return Array.from(document.querySelectorAll('#signalCheckboxes input[type="checkbox"]:checked')).map(cb => cb.value);
}

// ==================== 持仓时长格式化（委托给 utils.js） ====================
function formatHoldDuration(closeTime, openTime) {
  return window.utils.formatHoldDuration(closeTime, openTime);
}

// ==================== 存储容量预检查 ====================
/**
 * 预检查localStorage容量是否足够
 * @param {number} requiredBytes - 需要的字节数
 * @returns {boolean} 是否有足够空间
 */
function preCheckStorageCapacity(requiredBytes) {
  try {
    // 实际写入时 localStorage.setItem 会替换旧值，因此剩余容量 = quota - 当前所有键值总大小
    var totalUsed = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      var v = localStorage.getItem(k);
      if (k) totalUsed += k.length + (v ? v.length : 0);
    }
    // 尝试写入一个小测试键来验证写权限
    const testKey = '__storage_test_capacity__';
    const testData = 'x'.repeat(Math.min(requiredBytes, 1024));
    localStorage.setItem(testKey, testData);
    localStorage.removeItem(testKey);
    // 估算剩余空间（使用 navigator.storage API 或安全默认值）
    var estRemaining = -1;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        var est = navigator.storage.estimate();
        if (est && Number.isFinite(est.quota) && est.quota > 0) {
          estRemaining = Math.max(0, est.quota - totalUsed);
        }
      } catch(e) {}
    }
    if (estRemaining > 0 && requiredBytes > estRemaining * 0.5) {
      console.warn(`存储容量不足：需要${requiredBytes}字节，估计剩余${estRemaining}字节`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('存储容量预检查失败:', e);
    return false;
  }
}

/**
 * 估算localStorage剩余容量
 * 优先使用 navigator.storage.estimate()（Chrome/Edge/Firefox 支持），fallback 到探测方式
 * @returns {number} 估计的剩余字节数，-1表示无法确定
 */
function estimateLocalStorageCapacity() {
  // 优先使用现代 Storage API（精确且无副作用）
  if (navigator.storage && navigator.storage.estimate) {
    try {
      var est = navigator.storage.estimate();
      if (est && Number.isFinite(est.quota) && est.quota > 0) {
        var used = est.usage || 0;
        var remaining = est.quota - used;
        // 减去本应用已知使用的 key 大小（更精确）
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            var v = localStorage.getItem(k);
            if (k) used += k.length + (v ? v.length : 0);
          }
          remaining = est.quota - used;
        } catch(e) { console.error('[storage-est]', e); }
        return Math.max(0, remaining);
      }
    } catch(e) { console.error('[storage-est-fallback]', e); }
  }

  // Fallback: 探测方式写入测试数据来估算
  try {
    const testSizes = [1024, 10*1024, 100*1024, 1024*1024]; // 1KB, 10KB, 100KB, 1MB
    let capacity = 5 * 1024 * 1024; // 默认假设5MB

    for (let size of testSizes) {
      try {
        const testKey = `__capacity_test_${size}__`;
        const testData = 'x'.repeat(size);
        localStorage.setItem(testKey, testData);
        localStorage.removeItem(testKey);
        capacity = Math.max(capacity, size * 10); // 能写入size，假设至少10倍空间
      } catch (e) {
        // 写入失败，容量小于当前测试大小
        capacity = size / 2;
        break;
      }
    }

    // 减去已使用空间
    let usedSpace = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      if (key && key !== '__capacity_test_') {
        usedSpace += (key.length + (value ? value.length : 0));
      }
    }

    return Math.max(0, capacity - usedSpace);
  } catch (e) {
    console.warn('无法估算localStorage容量:', e);
    return -1; // 无法确定
  }
}

// ==================== 时间格式化（委托给 utils.js） ====================
function fmtTime(t) {
  return window.utils.fmtTime(t);
}
