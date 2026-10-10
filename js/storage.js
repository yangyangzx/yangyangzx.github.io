// ==================== 存储 ====================

// showToast / showUndoToast 已提取到 toast.js，由外部脚本加载
// _pendingDelete / _undoToastEl / _undoToastTimer / _commitPendingDelete 已提取到 toast.js

// 存储安全增强配置
const STORAGE_CONFIG = {
  maxSizeBytes: 4 * 1024 * 1024, // 4MB安全限制（浏览器通常5-10MB）
  warningThreshold: 3 * 1024 * 1024, // 3MB警告阈值
  compressionEnabled: false // 暂不启用压缩，避免复杂性
};

// UTF-8 字节数。localStorage 的配额以 UTF-8 字节计，navigator.storage.estimate() 的
// quota / usage 同样以字节计；而 String.length 是 UTF-16 码元数——中文字符 1 码元 = 3 字节。
// 直接用 .length 与 maxSizeBytes 比较会让安全上限与警告阈值整体推迟（实测含中文日志
// 样本低估 24.8%），使备份建议来得比实际需要晚。数据形状越中文越严重。
var _utf8Encoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
// 注意：_autoBackupIndex 的声明与初始化在 constants.js:21（从 localStorage 恢复游标）。
// 这里绝不能重复 `var` 声明——storage.js 加载顺序在 constants.js 之后，
// 重复声明会把已从磁盘恢复的游标重置为 0，每次刷新页面都从槽位 1 开始覆盖旧备份。
function utf8ByteLength(str) {
  if (!str) return 0;
  if (_utf8Encoder) {
    try { return _utf8Encoder.encode(String(str)).length; } catch (e) {}
  }
  // 无 TextEncoder 时的等价实现（含代理对处理）
  var n = 0, c;
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) { n += 1; }
    else if (c < 0x800) { n += 2; }
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length &&
             str.charCodeAt(i + 1) >= 0xDC00 && str.charCodeAt(i + 1) <= 0xDFFF) { n += 4; i++; }
    else { n += 3; }
  }
  return n;
}

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

  // P1 FIX（2026-10-04）：为存量记录回填稳定 id。
  // 日志一直靠数组索引寻址，记录本身没有任何唯一标识——结果是 _logFingerprint 的 item.id
  // 分量恒为空，JSON 导入与 CSV 导入之间无法判定「同一笔交易」，跨导出副本也无法比对。
  // id 只做身份用途（不参与计算/排序/风控校验），回填对既有逻辑零影响。
  // 新记录在 saveLog / 分批保存 / CSV 导入 / JSON 导入处生成 id，因此用一次性标记即可，
  // 不必每次加载重跑。
  if (!localStorage.getItem('trade_ids_backfilled_v1')) {
    try {
      var _backfilled = 0;
      for (var _bi = 0; _bi < logs.length; _bi++) {
        if (logs[_bi] && !logs[_bi].id) {
          logs[_bi].id = window.utils.genLogId(logs);
          _backfilled++;
        }
      }
      if (_backfilled > 0 && !saveLogs(true)) throw new Error('id 回填写入失败');
      localStorage.setItem('trade_ids_backfilled_v1', '1');
    } catch (e) {
      console.error('日志 id 回填未完成，将在下次加载时重试:', e);
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
        if (!needsSync) return;
        // 原生 confirm 会阻塞 storage 事件回调（进而卡住本标签页渲染）；
        // 改用应用内对话框，保持非阻塞。
        if (typeof window.confirmDialog !== 'function') {
          logs = remoteLogs;
          _safeRenderAfterStorageChange();
          if (typeof showToast === 'function') showToast('已同步为最新数据', 'info');
          return;
        }
        window.confirmDialog({
          title: '检测到另一标签页修改了日志数据',
          message: '刷新会载入另一标签页的最新数据，当前标签页未保存的界面状态会丢失。',
          confirmText: '刷新为最新数据',
          cancelText: '保留当前数据'
        }).then(function(ok) {
          if (!ok) return;
          logs = remoteLogs;
          _safeRenderAfterStorageChange();
          if (typeof showToast === 'function') showToast('已同步为最新数据', 'info');
        });
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
  var sizeBytes = utf8ByteLength(jsonStr);
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
    // P1 修复：原先忽略返回值却无条件 toast「已创建紧急备份」。配额已满时
    // createEmergencyBackup 内部 setItem 抛错并返回 false，此时提示是假的。
    var _emergencyOk = StorageSecurity.createEmergencyBackup();
    if (typeof showToast === 'function') {
      showToast(_emergencyOk ? '存储使用率较高，已创建紧急备份。'
        : '存储使用率较高，但紧急备份创建失败（配额已满），请立即导出日志。', _emergencyOk ? 'warn' : 'error');
    }
  }
  if (skipBackup) return true;

  try {
    //走 loadSettings() 而非裸读 localStorage：原实现硬编码 key字符串
    //（与 settings.js 的 SETTINGS_KEY 重复，改 key 即失效），且绕过 SETTINGS_DEFAULTS
    // 合并与缓存失效机制，与全站其他 30+ 个读取点口径不一致。
    var autoSettings = (typeof loadSettings === 'function') ? loadSettings() : null;
    var autoBackupEnabled = autoSettings ? autoSettings.autoBackup !== false : true;
    var backupCount = autoSettings ? (Number(autoSettings.backupCount) || 10) : 10;
    if (autoBackupEnabled) {
      _autoBackupIndex = (_autoBackupIndex + 1) % backupCount;
      // ADR-3 FIX: 使用明确前缀 trade_backup_auto，避免与 emergency_backup_ 混淆
      // P1 修复：必须先写数据、再写索引。原顺序反了——数据 setItem 因配额抛错时
      // 索引已前进，下一次轮转又跳过这个槽位，最新备份既没存上、索引又指向别处，
      // 轮转表与真实槽位从此错位。数据写成功才推进索引。
      localStorage.setItem('trade_backup_auto_' + _autoBackupIndex, JSON.stringify({ time: new Date().toISOString(), data: logs }));
      localStorage.setItem('trade_backup_auto_index', String(_autoBackupIndex));
      if (typeof updateBackupTime === 'function') updateBackupTime();
    }
  } catch (backupError) {
    // 主日志已经确认写入，备份轮转失败不应把主事务标记为失败；
    // 但用户需要知道备份没成——「以为有备份」比没有备份更危险。
    console.warn('自动备份轮转失败:', backupError);
    if (typeof showToast === 'function') showToast('主日志已保存，但自动备份写入失败（存储配额不足）。请尽快导出日志。', 'error');
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
    const html = '<option value="">— 不选择 —</option>';
    // 走 SelectUI.setOptions 让自定义外壳同步刷新（未初始化时回退直接写 innerHTML）
    if (window.SelectUI) SelectUI.setOptions('strategyPattern', html);
    else patternSelect.innerHTML = html;
    return;
  }
  const html = buildPatternOptions('', true);
  if (window.SelectUI) SelectUI.setOptions('strategyPattern', html);
  else patternSelect.innerHTML = html;
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
  // 同步自定义外壳：option.disabled/hidden 变化后重绘 listbox，
  // 让被禁用的订单类型在 sl-select 里也灰显不可选。
  if (window.SelectUI) SelectUI.syncFromNative('orderType');
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
// navigator.storage.estimate() 返回 Promise，同步读 .quota 恒为 undefined。
// 原实现 `Number.isFinite(est.quota)` 因此永远为 false，estRemaining 恒为 -1，
// 容量预检查这一整段从未触发过——真正的保护只剩下方那次真实 setItem + 读回校验。
// 这里改成同步决策：用实测已用量对保守默认配额（5MB）比较，estimate() 的 Promise
// 解析后再异步刷新 _storageQuotaBytes，后续调用即用真实配额。
var _storageQuotaBytes = 5 * 1024 * 1024;
try {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(function(est) {
      if (est && Number.isFinite(est.quota) && est.quota > 0) _storageQuotaBytes = est.quota;
    }).catch(function() {});
  }
} catch (e) { /* 配额探测失败时沿用保守默认值 */ }

/**
 * 预检查localStorage容量是否足够
 * @param {number} requiredBytes - 需要的字节数
 * @returns {boolean} 是否有足够空间
 */
function preCheckStorageCapacity(requiredBytes) {
  try {
    // 非法字节数说明调用方算错了（见 StorageSecurity.checkCapacity 的同一约定）；
    // 放行负数/NaN 会让下面的 `> estRemaining * 0.5` 比较变成恒假，预检查被静默跳过。
    var req = Number(requiredBytes);
    if (!Number.isFinite(req) || req < 0) {
      console.warn('存储容量预检查失败：需要字节数非法', requiredBytes);
      return false;
    }
    // 实际写入时 localStorage.setItem 会替换旧值，因此剩余容量 = quota - 当前所有键值总大小
    var totalUsed = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      var v = localStorage.getItem(k);
      if (k) totalUsed += utf8ByteLength(k) + (v ? utf8ByteLength(v) : 0);
    }
    // 尝试写入一个小测试键来验证写权限
    const testKey = '__storage_test_capacity__';
    const testData = 'x'.repeat(Math.min(req, 1024));
    localStorage.setItem(testKey, testData);
    localStorage.removeItem(testKey);
    // 留 50% 余量：写入过程中旧值尚未释放，且部分浏览器对「同键替换」的峰值占用更高
    var estRemaining = Math.max(0, _storageQuotaBytes - totalUsed);
    if (estRemaining > 0 && req > estRemaining * 0.5) {
      console.warn('存储容量不足：需要' + req + '字节，估计剩余' + estRemaining + '字节');
      return false;
    }
    return true;
  } catch (e) {
    console.error('存储容量预检查失败:', e);
    return false;
  }
}

// ==================== 时间格式化（委托给 utils.js） ====================
function fmtTime(t) {
  return window.utils.fmtTime(t);
}
