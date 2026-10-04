// ==================== 导入导出模块 ====================
// 为 index.html 和 trading.html 提供统一的 I/O 函数
var fmtTime = window.utils.fmtTime;

function exportCSV() {
  if (!logs.length) { showToast('暂无日志','info'); return; }
  // 防重入：防止快速双击触发多次下载
  if (window.__exportingCSV) { showToast('正在导出中，请稍候', 'info'); return; }
  window.__exportingCSV = true;
  try {
  const headers = ['ID','时间','品种','方向','订单类型','入场价','有效入场价','止损价','目标价','仓位(USDT)','杠杆','风险额','本金','心态评分','形态/策略','信号K','交易时段','市场环境','平仓类型','平仓价','平仓时间','持仓时长(分钟)','R倍数','盈亏金额','盈亏百分比','MAE%','MFE%','执行评分','出场理由','亏损原因','交易情绪','平仓备注','入场原因','手续费','滑点成本','计算版本','滑点Schema','入场Ticks','退出Ticks','TickSize','计划有效退出价','GroupId','已实现盈亏','累计手续费','已平仓比例%','初始风险','初始仓位','平仓明细','部分平仓','盘中动作','止损轨迹','目标盈亏比','计划净盈利'];
  // P2: 导出当前过滤结果（复用 logs.js 的 _filterMatch），无过滤时导出全部
  var hasActiveFilter = !!( _activeFilters.direction || _activeFilters.symbol || _activeFilters.strategy ||
                            _activeFilters.status || _activeFilters.pnl || _activeFilters.time );
  var exportRows = (hasActiveFilter && typeof _filterMatch === 'function')
    ? logs.filter(function(l) { return _filterMatch(l); })
    : logs;
  if (!exportRows.length) { showToast('当前筛选条件下无记录可导出', 'info'); return; }
  var scopeLabel = hasActiveFilter ? '当前筛选范围' : '全部日志';
  let csv = headers.join(',') + '\n';
  for (const row of exportRows) {
    const ms = row.mindsetScore ? '★'.repeat(row.mindsetScore)+'☆'.repeat(5-row.mindsetScore) : '';
    let sf = row.strategyFramework || '';
    if (row.strategyPattern) {
      const pts = row.strategyPattern.split('|');
      if (pts.length===2) sf += ' - ' + (PATTERN_GROUP_LABELS[pts[0]]||pts[0]) + ' - ' + pts[1];
      else sf += ' - ' + row.strategyPattern;
    }
    const ss = (row.signals&&row.signals.length) ? row.signals.map(s=>SIGNAL_LABELS[s]||s).join(' / ') : '';
    const ctl = row.closeType ? (CLOSE_TYPE_LABELS[row.closeType]||row.closeType) : '';
    // 时间列走 ISO 8601（带秒与时区），不能走 fmtTime：fmtTime 是本地时区的「yyyy-MM-dd HH:mm」，
    // 既丢秒又丢时区。同机往返无感，换一台不同时区的机器导入就整体偏移（UTC+8 导出 → UTC 机器
    // 读回偏移 8 小时），而下游按日分桶的熔断/连亏/夏普/权益曲线全部跟着错。
    // 秒丢失还会破坏无 ID 列的旧导出：同一分钟内两笔时间串完全相同，重新导入会被判重复丢掉。
    // 导入侧用 new Date() 解析，ISO 与旧的本地格式都能读，向后兼容。
    const timeISO = row.time ? new Date(row.time).toISOString() : '';
    const closeTimeFormatted = row.closeTime ? new Date(row.closeTime).toISOString() : '';
    const planSlip = row.slippage && row.slippage.planning ? row.slippage.planning : {};
    const line = [row.id ?? '',timeISO,row.symbol,row.direction,row.orderType||'market',row.entryPrice,row.effectiveEntryPrice??planSlip.effectiveEntryPrice??'',row.stopLoss,row.targetPrice??'',row.positionSize,row.leverage,row.riskAmount,row.capital??'',ms,sf,ss,row.session||'',row.marketCondition||'',ctl,row.closePrice??'',closeTimeFormatted,row.holdDuration??'',String(row.rMultiple??'').replace(/R$/,''),row.pnlAmount??'',String(row.pnlPercent??'').replace(/%/g,''),row.mae??'',row.mfe??'',row.executionScore??'',row.exitReason??'',Array.isArray(row.lossReason)?row.lossReason.join(';'):(row.lossReason||''),Array.isArray(row.emotions)?row.emotions.join(';'):(row.emotions||''),row.closeNote??'',Array.isArray(row.reason)?row.reason.join(';'):(row.reason||''),row.fee??'',row.slippageCost??'',row.calculationVersion??'',planSlip.schema??'',planSlip.entryTicks??'',planSlip.exitTicks??'',planSlip.tickSize??'',planSlip.effectiveExitPrice??'',row.groupId??'',row.realizedPnl??'',row.realizedFee??'',row.closedRatio??'',row.initialRiskAmount??'',row.initialPositionSize??'',Array.isArray(row.closes)?JSON.stringify(row.closes):'',row.isPartial??'',Array.isArray(row.actions)?JSON.stringify(row.actions):'',Array.isArray(row.stopHistory)?JSON.stringify(row.stopHistory):'',row.targetRR??'',row.plannedNetProfit??''].map(v=>'"'+(v==null?'':String(v).replace(/"/g,'""'))+'"').join(',');
    csv += line + '\n';
  }
  const b = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download='trade_logs_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
  // P2: 明确标注导出范围，避免用户误以为导出全部
  showToast('已导出 ' + exportRows.length + ' 条（' + scopeLabel + '）', 'success');
  } catch(e) { showToast('导出失败: ' + e.message, 'error'); }
  finally { window.__exportingCSV = false; }
}

function exportJSON(indices) {
  const data = indices ? indices.map(i => logs[i]).filter(Boolean) : logs;
  if (!data.length) { showToast('暂无日志','info'); return; }
  const b = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download='trade_logs_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
}

// ===== JSON导入安全防护：多层验证和XSS过滤 =====
class ImportValidator {
  constructor() {
    // 定义必需字段和类型
    this.requiredFields = {
      symbol: 'string',
      direction: 'string', 
      entryPrice: 'number',
      time: 'string'
    };
    
    this.validDirections = ['long', 'short'];
    this.validOrderTypes = ['market', 'limit', 'stop'];
    this.xssPatterns = [/<script/i, /javascript:/i, /on\w+\s*=/i, /<iframe/i, /<object/i];
  }
  
  /**
   * 第一层：结构验证
   */
  validateStructure(data) {
    if (!Array.isArray(data)) {
      throw new Error('数据结构错误：必须是数组格式');
    }
    
    if (data.length > 10000) {
      throw new Error('数据量过大：单次导入不能超过10000条记录');
    }
    
    return { valid: true, message: '结构验证通过' };
  }
  
  /**
   * 第二层：字段类型和业务规则验证
   */
  validateFields(item, index) {
    const errors = [];
    
    // 检查必需字段
    for (const [field, expectedType] of Object.entries(this.requiredFields)) {
      if (!(field in item)) {
        errors.push(`第${index}条记录缺少必需字段: ${field}`);
        continue;
      }
      
      // 类型检查
      const actualType = typeof item[field];
      if (actualType !== expectedType) {
        errors.push(`第${index}条记录字段${field}类型错误：期望${expectedType}，实际${actualType}`);
      }
    }
    
    // 业务规则验证：不能用 if(value) 跳过 0、NaN 或空字符串。
    if (typeof item.direction !== 'string' || !this.validDirections.includes(item.direction.toLowerCase())) {
      errors.push(`第${index}条记录方向无效：${item.direction}`);
    }
    var entryPrice = Number(item.entryPrice);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) errors.push(`第${index}条记录入场价必须为大于 0 的有限数字：${item.entryPrice}`);
    if (typeof item.time !== 'string' || isNaN(new Date(item.time).getTime())) errors.push(`第${index}条记录时间无效：${item.time}`);
    if (item.positionSize != null) {
      var positionSize = Number(item.positionSize);
      // 允许 positionSize 为 0（数据损坏场景下由计算模块拦截），仅校验有限数值
      if (!Number.isFinite(positionSize)) errors.push(`第${index}条记录仓位必须为有限数字：${item.positionSize}`);
    }
    if (item.stopLoss != null) {
      var stopLoss = Number(item.stopLoss);
      if (!Number.isFinite(stopLoss) || stopLoss <= 0) errors.push(`第${index}条记录止损价无效`);
    }
    if (item.leverage != null) {
      var leverage = Number(item.leverage);
      if (!Number.isFinite(leverage) || leverage < 0 || leverage > 125) errors.push(`第${index}条记录杠杆超出合理范围：0-125倍`);
    }
    // 已平仓记录必须有平仓价与盈亏金额。两者任一缺失时 utils.isClosedTrade 判「未平仓」，
    // 该记录会从胜率/期望值/资金曲线/凯利样本里整笔消失，同时反向进入持仓统计虚增
    // 保证金、抬高组合热量，而 CSV 里仍标着已平仓。与编辑弹窗（modals.js saveEditLog）同守。
    // 注意 Number('') === 0：CSV 里的空单元格必须先按空处理，否则「平仓价已校验、
    // 盈亏金额漏检」——正好漏掉本次要拦的那一半。
    if (item.closeType != null && String(item.closeType).trim() !== '') {
      var _cpRaw = item.closePrice;
      var _cp = (_cpRaw === null || _cpRaw === undefined || String(_cpRaw).trim() === '')
        ? NaN : Number(_cpRaw);
      if (!Number.isFinite(_cp) || _cp <= 0) {
        errors.push(`第${index}条记录已标记平仓但平仓价无效：${item.closePrice}`);
      }
      var _paRaw = item.pnlAmount;
      var _pa = (_paRaw === null || _paRaw === undefined || String(_paRaw).trim() === '')
        ? NaN : Number(_paRaw);
      if (!Number.isFinite(_pa)) {
        errors.push(`第${index}条记录已标记平仓但盈亏金额不能为空：${item.pnlAmount}`);
      }
    }
    return errors;
  }
  
  /**
   * 第三层：XSS和安全过滤
   */
  sanitizeItem(item) {
    const sanitized = JSON.parse(JSON.stringify(item)); // 深拷贝
    
    // 清理字符串字段的潜在XSS
    const stringFields = ['symbol', 'direction', 'orderType', 'strategyFramework', 'reason', 'closeNote', 'emotions'];
    
    for (const field of stringFields) {
      if (sanitized[field] && typeof sanitized[field] === 'string') {
        let value = sanitized[field];
        
        // 检查XSS模式
        for (const pattern of this.xssPatterns) {
          if (pattern.test(value)) {
            console.warn(`检测到潜在的XSS内容，已清理字段 ${field}:`, value);
            value = value.replace(pattern, '[FILTERED]');
          }
        }
        
        // 存储为普通文本；渲染层负责统一转义，避免导入后出现双重实体编码。
        sanitized[field] = value.replace(/<[^>]*>/g, '[已移除标签]');
      }
    }
    
    // 确保数值字段安全
    const numericFields = ['entryPrice', 'stopLoss', 'targetPrice', 'positionSize', 'leverage', 'pnlAmount'];
    for (const field of numericFields) {
      if (sanitized[field] != null) {
        const num = Number(sanitized[field]);
        if (isNaN(num) || !isFinite(num)) {
          sanitized[field] = null;
        } else {
          sanitized[field] = num;
        }
      }
    }
    
    return sanitized;
  }
  
  /**
   * 主验证方法
   */
  validateAndSanitize(data) {
    const report = {
      total: data.length,
      valid: [],
      errors: [],
      warnings: []
    };
    
    try {
      // 第一层验证
      this.validateStructure(data);
      
      // 第二层和第三层验证
      data.forEach((item, index) => {
        try {
          const fieldErrors = this.validateFields(item, index);
          if (fieldErrors.length > 0) {
            report.errors.push(...fieldErrors);
            return;
          }
          
          // 清理和净化
          const sanitized = this.sanitizeItem(item);
          report.valid.push(sanitized);
          
        } catch (error) {
          report.errors.push(`第${index}条记录处理失败: ${error.message}`);
        }
      });
      
      // 生成警告
      if (report.valid.length > 500) {
        report.warnings.push(`导入数据量较大(${report.valid.length}条)，可能影响性能`);
      }
      
      return report;
      
    } catch (error) {
      throw new Error(`验证失败: ${error.message}`);
    }
  }
}

const importValidator = new ImportValidator();

/**
 * 拖拽 / 点选导入 JSON（追加模式，与现有日志共存）。
 *
 * v5.6.9：只保留「读文件」这一件 io.js 独有的事，迁移 → 校验 → 补 id → 去重 → 确认 → 提交
 * 全部委托给 settings.js 的公共流水线（_prepareImportedRecords / _confirmImportThenCommit），
 * 与设置页文件选择器的覆盖导入共用同一套口径。此前这里自有一份：校验有、去重有，但去重键
 * 用的是刚生成的 id，同一文件内两条重复记录会各拿一个新 id 而双双通过；确认文案也与
 * parseCSVImport 各写一套。
 */
function importJSON(file) {
  var r = new FileReader();
  r.onload = function(e) {
    var d;
    try {
      // stripBOM：JSON.parse 遇到 BOM 直接抛 SyntaxError
      d = JSON.parse(typeof stripBOM === 'function' ? stripBOM(e.target.result) : e.target.result);
    } catch (err) {
      showToast('JSON 解析失败: ' + err.message, 'error');
      return;
    }
    if (!Array.isArray(d)) { showToast('JSON 格式不正确（应为数组）', 'error'); return; }
    if (typeof _prepareImportedRecords !== 'function' || typeof _confirmImportThenCommit !== 'function') {
      showToast('导入功能不可用', 'error');
      return;
    }
    var report = _prepareImportedRecords(d);
    if (report.errors.length > 0) {
      if (typeof _showImportValidationFailure === 'function') _showImportValidationFailure(report.errors);
      return;
    }
    _confirmImportThenCommit(report, 'append');
  };
  r.readAsText(file);
}

// ======== JSON导入Schema验证系统 ========
/**
 * JSON导入数据验证器 - 多层安全验证体系
 * 基于华尔街交易数据标准和OWASP安全规范设计
 */
