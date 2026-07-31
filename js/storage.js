// ==================== 存储 ====================

// showToast / showUndoToast 已提取到 toast.js，由外部脚本加载
// _pendingDelete / _undoToastEl / _undoToastTimer / _commitPendingDelete 已提取到 toast.js

// 存储安全增强配置
const STORAGE_CONFIG = {
  maxSizeBytes: 4 * 1024 * 1024, // 4MB安全限制（浏览器通常5-10MB）
  warningThreshold: 3 * 1024 * 1024, // 3MB警告阈值
  emergencyBackupKey: 'trade_logs_emergency_backup',
  compressionEnabled: false // 暂不启用压缩，避免复杂性
};

// 存储容量检查和备份工具
const StorageSecurity = {
  /**
   * 检查存储容量是否充足
   * @param {number} additionalBytes 预计要添加的字节数
   * @returns {Object} {canWrite: boolean, available: number, recommendation: string}
   */
  checkCapacity(additionalBytes = 0) {
    try {
      const currentUsage = JSON.stringify(logs).length;
      const available = STORAGE_CONFIG.maxSizeBytes - currentUsage - additionalBytes;
      
      if (available < 0) {
        return {
          canWrite: false,
          available: available,
          recommendation: '存储空间不足，需要清理历史数据'
        };
      }
      
      if (currentUsage > STORAGE_CONFIG.warningThreshold) {
        return {
          canWrite: true,
          available: available,
          recommendation: '存储使用率较高，建议备份重要数据'
        };
      }
      
      return {
        canWrite: true,
        available: available,
        recommendation: '存储容量正常'
      };
    } catch (error) {
      console.error('StorageSecurity.checkCapacity失败:', error);
      return { canWrite: false, available: 0, recommendation: '无法检查存储容量' };
    }
  },
  
  /**
   * 创建紧急备份
   */
  createEmergencyBackup() {
    try {
      const backup = {
        timestamp: new Date().toISOString(),
        data: JSON.parse(JSON.stringify(logs)), // 深拷贝
        version: 'emergency_backup_v1'
      };
      localStorage.setItem(STORAGE_CONFIG.emergencyBackupKey, JSON.stringify(backup));
      console.log('紧急备份已创建:', backup.timestamp);
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

function loadLogs() {
  try { const r = localStorage.getItem(STORAGE_KEY); logs = r ? JSON.parse(r) : []; }
  catch(e) { logs = []; console.error('日志数据读取失败，已重置为空，建议检查备份:', e); if (typeof showToast === 'function') showToast('日志数据损坏，已重置。请从备份恢复', 'error'); }
  // v3 → v4 自动迁移（仅执行一次，基于标记而非 v4 是否为空）
  if (!localStorage.getItem('trade_migrated_v3_to_v4')) {
    try {
      const r = localStorage.getItem('trade_logs_plus_v3');
      const v3logs = r ? JSON.parse(r) : [];
      if (v3logs.length > 0) {
        const existingIds = new Set(logs.map(l => l.time + '_' + l.symbol));
        const newLogs = v3logs.filter(l => !existingIds.has(l.time + '_' + l.symbol));
        if (newLogs.length > 0) {
          logs = logs.concat(newLogs);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(logs)); } catch {}
        }
      }
    } catch {}
    try { localStorage.setItem('trade_migrated_v3_to_v4', '1'); } catch {}
  }
  // ── 时间格式迁移（版本化；importJSON 也会调用 _migrateTimes 防绕过） ──
  // L2: 统一 schemaVersion 迁移管理
  var schemaVer = parseInt(localStorage.getItem('trade_schema_version')) || 0;
  if (schemaVer < SCHEMA_VERSION) {
    if (_migrateTimes(logs)) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(logs)); } catch {}
    }
    try { localStorage.setItem('trade_schema_version', String(SCHEMA_VERSION)); } catch {}
    try { localStorage.removeItem('trade_time_migration_ver'); } catch {}
    try { localStorage.removeItem('trade_time_iso_migrated'); } catch {}
  }

  // M2: 多标签页存储变更监听
  window.addEventListener('storage', function(e) {
    if (e.key === STORAGE_KEY && e.newValue !== e.oldValue) {
      try {
        var remoteLogs = JSON.parse(e.newValue);
        // 长度不同或内容不同都触发同步提示
        var needsSync = remoteLogs.length !== logs.length;
        if (!needsSync && remoteLogs.length > 0) {
          // 比较最后一个日志的时间戳判断是否更新
          var localLast = logs[logs.length - 1] ? (logs[logs.length - 1].time || '') : '';
          var remoteLast = remoteLogs[remoteLogs.length - 1] ? (remoteLogs[remoteLogs.length - 1].time || '') : '';
          needsSync = localLast !== remoteLast;
        }
        if (needsSync) {
          if (confirm('检测到另一标签页修改了日志数据（本地 ' + logs.length + ' 条 vs 远程 ' + remoteLogs.length + ' 条）。\n\n点击「确定」刷新为最新数据，点击「取消」保留当前数据（继续操作将被覆盖）。')) {
            logs = remoteLogs;
            renderLogs();
            updateLastUpdate();
            populateFilterOptions();
            showToast('已同步为最新数据', 'info');
          }
        }
      } catch {}
    }
  });
}
// skipBackup: 设为 true 时跳过自动备份轮转（用于高频 auto-save，避免快速耗尽备份槽位）
function saveLogs(skipBackup) {
  const jsonStr = JSON.stringify(logs);
  const sizeBytes = jsonStr.length;
  
  // ===== 使用StorageSecurity进行专业的容量检查和备份 =====
  const capacityCheck = StorageSecurity.checkCapacity(sizeBytes);
  
  if (!capacityCheck.canWrite) {
    showToast('存储空间不足: ' + capacityCheck.recommendation, 'error');
    // 尝试创建紧急备份
    if (StorageSecurity.createEmergencyBackup()) {
      showToast('已创建紧急备份，请及时下载保存', 'warn');
    }
    return false;
  }
  
  if (capacityCheck.recommendation.includes('较高')) {
    showToast('存储使用率较高: ' + capacityCheck.recommendation, 'warn');
    // 自动创建备份以防万一
    StorageSecurity.createEmergencyBackup();
  }
  
  // 大容量数据时提醒用户备份
  if (sizeBytes > STORAGE_CONFIG.warningThreshold) {
    console.warn('大额数据存储:', Math.round(sizeBytes/1024/1024*10)/10 + 'MB');
    if (confirm('当前数据量较大(' + Math.round(sizeBytes/1024/1024*10)/10 + 'MB)，建议先备份再继续操作。是否立即下载备份？')) {
      StorageSecurity.downloadBackup();
    }
  }
  
  // 预检查可用空间（尝试写入测试数据）
  if (!preCheckStorageCapacity(sizeBytes)) {
    showToast('存储空间检查失败，可能磁盘已满，请清理浏览器数据', 'error');
    return false;
  }
  
  try {
    localStorage.setItem(STORAGE_KEY, jsonStr);
    
    // 验证写入是否真的成功
    const verification = localStorage.getItem(STORAGE_KEY);
    if (!verification || verification.length !== jsonStr.length) {
      throw new Error('写入验证失败：数据长度不匹配');
    }
    
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      // L1: 满写时截断保留最近 80% 数据，再触发完整备份下载
      var keepCount = Math.max(1, Math.floor(logs.length * 0.8));
      var truncated = logs.slice(logs.length - keepCount);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(truncated));
        logs = truncated;
        showToast('存储空间已满，已自动保留最近 ' + keepCount + ' 条日志。完整数据已触发备份下载。', 'warn');
        // 先导出完整备份（在截断之前保存副本）
        var _backupData = JSON.stringify(truncated);
        setTimeout(function() {
          var b = new Blob([_backupData],{type:'application/json'});
          var a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = 'trade_backup_' + new Date().toISOString().slice(0,10) + '_auto.json';
          a.click();
        }, 500);
        renderLogs();
        updateLastUpdate();
        populateFilterOptions();
        return; // 已截断保存，跳过后续备份逻辑
      } catch(e2) {
        showToast('存储空间已满，自动截断也失败，请手动清理后导出备份', 'error');
      }
    } else {
      showToast('存储失败: ' + e.message,'error');
    }
  }
  renderLogs();
  updateLastUpdate();
  // skipBackup 为 true 时跳过自动备份轮转（高频 auto-save 场景）
  if (skipBackup) return;
  // 从设置中读取 autoBackup 开关和 backupCount（直接读 localStorage，避免循环依赖）
  var _autoSettings = null;
  try { var _raw = localStorage.getItem('trade_settings_v1'); if (_raw) _autoSettings = JSON.parse(_raw); } catch(e) {}
  var _autoBackupEnabled = _autoSettings ? (_autoSettings.autoBackup !== false) : true;
  var _backupCount = _autoSettings ? (_autoSettings.backupCount || 10) : 10;

  if (_autoBackupEnabled) {
    _autoBackupIndex = (_autoBackupIndex + 1) % _backupCount;
    localStorage.setItem('trade_auto_backup_index', _autoBackupIndex);
    localStorage.setItem('trade_auto_backup_' + _autoBackupIndex, JSON.stringify({time: new Date().toLocaleString('zh-CN',{hour12:false}), data: logs}));
    updateBackupTime();
  }
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
    // 尝试写入一个小的测试键来检查可用空间
    const testKey = '__storage_test_capacity__';
    const testData = 'x'.repeat(Math.min(requiredBytes, 1024)); // 最多测试1KB
    
    localStorage.setItem(testKey, testData);
    localStorage.removeItem(testKey);
    
    // 粗略估算剩余空间（不同浏览器差异很大）
    const estimatedRemaining = estimateLocalStorageCapacity();
    if (estimatedRemaining > 0 && requiredBytes > estimatedRemaining * 0.8) {
      console.warn(`存储容量不足：需要${requiredBytes}字节，估计剩余${estimatedRemaining}字节`);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('存储容量预检查失败:', e);
    return false; // 预检查失败，假设空间不足
  }
}

/**
 * 估算localStorage剩余容量（粗略估算）
 * @returns {number} 估计的剩余字节数，-1表示无法确定
 */
function estimateLocalStorageCapacity() {
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
