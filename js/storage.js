// ==================== 存储 ====================

// showToast / showUndoToast 已提取到 toast.js，由外部脚本加载
// _pendingDelete / _undoToastEl / _undoToastTimer / _commitPendingDelete 已提取到 toast.js

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
  const sizeMB = sizeBytes / (1024 * 1024);
  
  // ===== 修复数据持久化风险：提前容量检查和优雅降级 =====
  // 原Bug: 只在>4MB时警告，但localStorage通常只有5-10MB，为时已晚
  // 新逻辑: 提前在3MB时警告，2.5MB时开始保护模式
  
  const WARNING_THRESHOLD_MB = 3.0;    // 3MB开始警告
  const PROTECTION_THRESHOLD_MB = 2.5; // 2.5MB进入保护模式
  const CRITICAL_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB临界值
  
  if (sizeMB >= CRITICAL_THRESHOLD_BYTES / (1024 * 1024)) {
    showToast('存储空间严重不足！(' + sizeMB.toFixed(1) + 'MB)，立即停止写入以防数据丢失', 'error');
    // 紧急情况下强制触发完整备份下载
    emergencyBackupAndCleanup();
    return false;
  } else if (sizeMB >= WARNING_THRESHOLD_MB) {
    showToast('存储空间紧张（' + sizeMB.toFixed(1) + 'MB/' + (CRITICAL_THRESHOLD_BYTES/(1024*1024)).toFixed(1) + 'MB），建议立即导出备份', 'warn');
    
    if (sizeMB >= PROTECTION_THRESHOLD_MB) {
      // 保护模式：启用数据压缩和清理
      console.warn('进入存储保护模式，启用数据优化...');
      enableStorageProtectionMode();
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

/**
 * 紧急备份并清理数据
 */
function emergencyBackupAndCleanup() {
  try {
    console.error('触发紧急备份和清理程序！');
    
    // 1. 立即创建完整备份
    const emergencyBackup = JSON.stringify(logs);
    const blob = new Blob([emergencyBackup], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EMERGENCY_BACKUP_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    
    // 自动触发下载
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('紧急备份已下载！请立即保存文件以防数据丢失', 'error');
    
    // 2. 清理旧备份释放空间（保留最近3个）
    cleanupOldBackups(3);
    
    // 3. 提示用户手动清理
    setTimeout(() => {
      if (confirm('存储空间严重不足！\n\n建议立即：\n1. 导出所有交易记录\n2. 清理浏览器数据\n3. 重启浏览器\n\n是否现在清理旧备份？')) {
        cleanupAllBackups();
      }
    }, 2000);
    
  } catch (cleanupError) {
    console.error('紧急备份清理失败:', cleanupError);
    showToast('紧急备份失败！请立即手动导出数据', 'error');
  }
}

/**
 * 启用存储保护模式
 */
function enableStorageProtectionMode() {
  try {
    // 启用数据压缩（移除不必要字段）
    const originalLength = JSON.stringify(logs).length;
    const optimizedLogs = optimizeLogData(logs);
    const optimizedLength = JSON.stringify(optimizedLogs).length;
    
    const savedBytes = originalLength - optimizedLength;
    console.log(`存储保护模式：优化节省 ${savedBytes} 字节 (${(savedBytes/originalLength*100).toFixed(1)}%)`);
    
    // 临时替换为优化后的数据
    const tempOriginalLogs = [...logs];
    logs = optimizedLogs;
    
    // 尝试保存优化后的数据
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
      showToast(`存储保护模式已启用，节省 ${(savedBytes/1024).toFixed(1)}KB 空间`, 'info');
    } catch (saveError) {
      // 优化后仍无法保存，恢复原数据
      logs = tempOriginalLogs;
      console.error('优化后仍无法保存，恢复原数据');
    }
    
  } catch (protectionError) {
    console.error('启用存储保护模式失败:', protectionError);
  }
}

/**
 * 优化日志数据大小
 * @param {Array} logArray - 原始日志数组
 * @returns {Array} 优化后的日志数组
 */
function optimizeLogData(logArray) {
  return logArray.map(log => {
    const optimized = {...log};
    
    // 移除调试字段
    delete optimized._debug;
    delete optimized._temp;
    
    // 压缩备注字段（如果过长）
    if (optimized.note && optimized.note.length > 500) {
      optimized.note = optimized.note.substring(0, 500) + '...(已截断)';
    }
    
    // 移除空的自定义字段
    Object.keys(optimized).forEach(key => {
      if (optimized[key] === '' || optimized[key] === null || optimized[key] === undefined) {
        if (key !== 'id' && key !== 'time' && key !== 'symbol' && key !== 'direction') {
          delete optimized[key];
        }
      }
    });
    
    return optimized;
  });
}

/**
 * 清理旧备份文件
 * @param {number} keepCount - 保留的备份数量
 */
function cleanupOldBackups(keepCount = 5) {
  try {
    const backupKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('trade_auto_backup_')) {
        backupKeys.push(key);
      }
    }
    
    if (backupKeys.length > keepCount) {
      // 按时间排序，删除最旧的
      backupKeys.sort();
      const keysToRemove = backupKeys.slice(0, backupKeys.length - keepCount);
      
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`已清理旧备份: ${key}`);
      });
      
      showToast(`已清理 ${keysToRemove.length} 个旧备份文件`, 'info');
    }
  } catch (cleanupError) {
    console.error('清理旧备份失败:', cleanupError);
  }
}

/**
 * 清理所有备份文件
 */
function cleanupAllBackups() {
  try {
    let removedCount = 0;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('trade_auto_backup_') || key.startsWith('trade_backup_'))) {
        localStorage.removeItem(key);
        removedCount++;
      }
    }
    showToast(`已清理 ${removedCount} 个备份文件`, 'info');
  } catch (cleanupError) {
    console.error('清理所有备份失败:', cleanupError);
  }
}

// ==================== 时间格式化（委托给 utils.js） ====================
function fmtTime(t) {
  return window.utils.fmtTime(t);
}
