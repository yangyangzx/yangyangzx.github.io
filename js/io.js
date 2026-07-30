// ==================== 导入导出模块 ====================
// 为 index.html 和 trading.html 提供统一的 I/O 函数
var fmtTime = window.utils.fmtTime;

function exportCSV() {
  if (!logs.length) { showToast('暂无日志','info'); return; }
  const headers = ['时间','品种','方向','订单类型','入场价','止损价','目标价','仓位(USDT)','杠杆','风险额','本金','心态评分','形态/策略','信号K','交易时段','市场环境','平仓类型','平仓价','平仓时间','持仓时长(分钟)','R倍数','盈亏金额','盈亏百分比','MAE%','MFE%','执行评分','出场理由','亏损原因','交易情绪','平仓备注','入场原因','手续费','滑点成本'];
  let csv = headers.join(',') + '\n';
  for (const row of logs) {
    const ms = row.mindsetScore ? '★'.repeat(row.mindsetScore)+'☆'.repeat(5-row.mindsetScore) : '';
    let sf = row.strategyFramework || '';
    if (row.strategyPattern) {
      const pts = row.strategyPattern.split('|');
      if (pts.length===2) sf += ' - ' + (PATTERN_GROUP_LABELS[pts[0]]||pts[0]) + ' - ' + pts[1];
      else sf += ' - ' + row.strategyPattern;
    }
    const ss = (row.signals&&row.signals.length) ? row.signals.map(s=>SIGNAL_LABELS[s]||s).join(' / ') : '';
    const ctl = row.closeType ? (CLOSE_TYPE_LABELS[row.closeType]||row.closeType) : '';
    const closeTimeFormatted = fmtTime(row.closeTime);
    const line = [fmtTime(row.time),row.symbol,row.direction,row.orderType||'market',row.entryPrice,row.stopLoss,row.targetPrice??'',row.positionSize,row.leverage,row.riskAmount,row.capital??'',ms,sf,ss,row.session||'',row.marketCondition||'',ctl,row.closePrice??'',closeTimeFormatted,row.holdDuration??'',String(row.rMultiple??'').replace(/R$/,''),row.pnlAmount??'',String(row.pnlPercent??'').replace(/%/g,''),row.closeNote??'',row.reason,row.fee??'',row.slippageCost??''].map(v=>'"'+(v==null?'':String(v).replace(/"/g,'""'))+'"').join(',');
    csv += line + '\n';
  }
  const b = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download='trade_logs_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
}

function exportJSON(indices) {
  const data = indices ? indices.map(i => logs[i]).filter(Boolean) : logs;
  if (!data.length) { showToast('暂无日志','info'); return; }
  const b = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download='trade_logs_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
}

function importJSON(file) {
  const r = new FileReader();
  r.onload = function(e) {
    try {
      const d = JSON.parse(e.target.result);
      if (!Array.isArray(d)) { showToast('格式错误: 需要数组','error'); return; }
      // 逐条校验必要字段
      const valid = [], skipped = [];
      for (const item of d) {
        if (item && item.symbol != null && item.direction != null && item.entryPrice != null) {
          valid.push(item);
        } else {
          skipped.push(item);
        }
      }
      if (skipped.length > 0) {
        showToast('共导入 ' + valid.length + ' 条，跳过 ' + skipped.length + ' 条（缺少必要字段）','warn');
      } else {
        showToast('导入成功，共 ' + valid.length + ' 条','success');
      }
      if (valid.length === 0) return;
      if (logs.length > 0) {
        if (!confirm('导入将替换现有的 ' + logs.length + ' 条日志，当前数据将被覆盖，是否继续？')) return;
      }
      logs = valid;
      _migrateTimes(logs);
      openClosePanelIdx = -1; saveLogs();
    } catch(err) { showToast('解析失败: '+err.message,'error'); }
  };
  r.readAsText(file);
}

// ======== JSON导入Schema验证系统 ========
/**
 * JSON导入数据验证器 - 多层安全验证体系
 * 基于华尔街交易数据标准和OWASP安全规范设计
 */
const ImportValidator = {
  
  // 必需字段定义
  REQUIRED_FIELDS: ['symbol', 'direction', 'entryPrice'],
  
  // 字段类型验证规则
  FIELD_TYPES: {
    symbol: 'string',
    direction: 'string', 
    entryPrice: 'number',
    exitPrice: 'number',
    quantity: 'number',
    pnl: 'number',
    pnlType: 'string',
    strategyTags: 'array',
    note: 'string',
    time: 'number',
    exitTime: 'number',
    mae: 'number',
    mfe: 'number',
    splitMode: 'boolean',
    splits: 'array'
  },
  
  // 字段值约束
  FIELD_CONSTRAINTS: {
    direction: ['long', 'short'],
    pnlType: ['realized', 'unrealized'],
    symbol: { minLength: 1, maxLength: 20, pattern: /^[A-Za-z0-9_.-]+$/ }
  },
  
  /**
   * 第一层：基础数据结构验证
   * @param {any} data - 待验证的数据
   * @returns {{valid: boolean, error?: string}} 验证结果
   */
  validateStructure(data) {
    if (!data) {
      return { valid: false, error: '数据为空' };
    }
    
    if (!Array.isArray(data)) {
      return { valid: false, error: '数据格式错误：需要JSON数组' };
    }
    
    if (data.length === 0) {
      return { valid: false, error: '数据为空数组' };
    }
    
    if (data.length > 10000) {
      return { valid: false, error: '数据量过大：单次导入不能超过10000条记录' };
    }
    
    return { valid: true };
  },
  
  /**
   * 第二层：字段类型和格式验证
   * @param {Object} item - 单条记录
   * @param {number} index - 记录索引（用于错误定位）
   * @returns {{valid: boolean, errors: Array, sanitizedItem?: Object}} 验证结果
   */
  validateFieldTypes(item, index) {
    const errors = [];
    const sanitizedItem = {};
    
    // 检查必需字段
    for (const field of this.REQUIRED_FIELDS) {
      if (!(field in item) || item[field] == null || item[field] === '') {
        errors.push(`第${index + 1}条记录缺少必需字段: ${field}`);
      }
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    // 验证每个字段的类型和约束
    for (const [field, rule] of Object.entries(this.FIELD_TYPES)) {
      if (field in item && item[field] != null) {
        const value = item[field];
        const typeError = this.validateFieldType(field, value, rule);
        
        if (typeError) {
          errors.push(`第${index + 1}条记录字段[${field}]: ${typeError}`);
        } else {
          // 类型验证通过，进行数据清理和净化
          const sanitized = this.sanitizeField(field, value);
          if (sanitized !== undefined) {
            sanitizedItem[field] = sanitized;
          }
        }
      }
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    return { valid: true, sanitizedItem };
  },
  
  /**
   * 验证单个字段的类型
   * @param {string} field - 字段名
   * @param {any} value - 字段值
   * @param {string} expectedType - 期望类型
   * @returns {string|null} 错误信息，null表示验证通过
   */
  validateFieldType(field, value, expectedType) {
    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          return `应为字符串类型，实际为${typeof value}`;
        }
        
        // 字符串长度和格式检查
        if (field === 'symbol') {
          const constraints = this.FIELD_CONSTRAINTS.symbol;
          if (value.length < constraints.minLength || value.length > constraints.maxLength) {
            return `长度应在${constraints.minLength}-${constraints.maxLength}字符之间`;
          }
          if (!constraints.pattern.test(value)) {
            return '包含非法字符，只允许字母、数字、下划线、点号和横线';
          }
        }
        
        if (field === 'direction') {
          if (!this.FIELD_CONSTRAINTS.direction.includes(value)) {
            return `方向值无效，只能是: ${this.FIELD_CONSTRAINTS.direction.join(', ')}`;
          }
        }
        
        if (field === 'pnlType') {
          if (!this.FIELD_CONSTRAINTS.pnlType.includes(value)) {
            return `PNL类型无效，只能是: ${this.FIELD_CONSTRAINTS.pnlType.join(', ')}`;
          }
        }
        break;
        
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return `应为数字类型，实际为${typeof value}`;
        }
        
        if (!isFinite(value)) {
          return '数字值无效（无穷大或NaN）';
        }
        
        // 数值范围检查
        if (field === 'entryPrice' || field === 'exitPrice' || field === 'quantity') {
          if (value <= 0) {
            return '价格或数量必须大于0';
          }
          if (value > 100000000) { // 1亿上限，防止异常数据
            return '数值过大，疑似数据错误';
          }
        }
        
        if (field === 'pnl') {
          if (Math.abs(value) > 10000000) { // 1000万上限
            return '盈亏金额异常，请检查数据';
          }
        }
        
        if ((field === 'mae' || field === 'mfe') && value < 0) {
          return `${field.toUpperCase()}不能为负数`;
        }
        break;
        
      case 'array':
        if (!Array.isArray(value)) {
          return `应为数组类型，实际为${typeof value}`;
        }
        
        if (field === 'strategyTags' && value.length > 20) {
          return '策略标签数量不能超过20个';
        }
        
        if (field === 'splits' && value.length > 10) {
          return '分批建仓最多支持10批';
        }
        break;
        
      case 'boolean':
        if (typeof value !== 'boolean') {
          return `应为布尔类型，实际为${typeof value}`;
        }
        break;
    }
    
    return null; // 验证通过
  },
  
  /**
   * 净化字段值，防止安全风险
   * @param {string} field - 字段名
   * @param {any} value - 原始值
   * @returns {any} 净化后的值
   */
  sanitizeField(field, value) {
    switch (field) {
      case 'symbol':
      case 'direction':
      case 'pnlType':
        // 字符串字段去除首尾空格，限制长度
        return String(value).trim().substring(0, 50);
        
      case 'note':
        // 备注字段特殊处理：防止XSS攻击
        let sanitized = String(value)
          .trim()
          .replace(/[<>]/g, '') // 移除HTML标签符号
          .replace(/javascript:/gi, '') // 移除javascript协议
          .replace(/on\w+\s*=/gi, ''); // 移除事件处理器
        
        // 限制长度和字符集
        if (sanitized.length > 1000) {
          sanitized = sanitized.substring(0, 1000) + '...(已截断)';
        }
        
        return sanitized || undefined; // 空字符串转为undefined
        
      case 'strategyTags':
        // 净化标签数组
        return Array.isArray(value) ? 
          value
            .map(tag => String(tag).trim().substring(0, 20))
            .filter(tag => tag.length > 0)
            .slice(0, 20) : // 最多20个标签
          undefined;
          
      default:
        return value;
    }
  },
  
  /**
   * 第三层：业务逻辑合理性验证
   * @param {Object} item - 单条记录
   * @param {number} index - 记录索引
   * @returns {{valid: boolean, errors: Array}} 验证结果
   */
  validateBusinessLogic(item, index) {
    const errors = [];
    
    // 验证价格逻辑
    if (item.exitPrice != null && item.entryPrice != null) {
      if (item.direction === 'long' && item.exitPrice < 0) {
        errors.push(`第${index + 1}条记录：多头交易出场价不应为负数`);
      }
      if (item.direction === 'short' && item.exitPrice < 0) {
        errors.push(`第${index + 1}条记录：空头交易出场价不应为负数`);
      }
    }
    
    // 验证时间逻辑
    if (item.time != null && item.exitTime != null) {
      if (item.exitTime < item.time) {
        errors.push(`第${index + 1}条记录：出场时间不能早于入场时间`);
      }
      
      // 检查时间是否在合理范围内（1970-2100年）
      const minTime = 0; // 1970年
      const maxTime = 4102444800000; // 2100年
      if (item.time < minTime || item.time > maxTime) {
        errors.push(`第${index + 1}条记录：入场时间超出合理范围`);
      }
      if (item.exitTime < minTime || item.exitTime > maxTime) {
        errors.push(`第${index + 1}条记录：出场时间超出合理范围`);
      }
    }
    
    // 验证分批建仓数据
    if (item.splitMode && item.splits) {
      if (!Array.isArray(item.splits)) {
        errors.push(`第${index + 1}条记录：分批建仓数据格式错误`);
      } else if (item.splits.length < 2) {
        errors.push(`第${index + 1}条记录：分批建仓至少需要2批`);
      } else if (item.splits.length > 5) {
        errors.push(`第${index + 1}条记录：分批建仓最多支持5批`);
      }
    }
    
    return { valid: errors.length === 0, errors };
  },
  
  /**
   * 完整的记录验证流程
   * @param {Object} item - 待验证的记录
   * @param {number} index - 记录索引
   * @returns {{valid: boolean, errors: Array, sanitizedItem?: Object}} 验证结果
   */
  validateRecord(item, index) {
    // 第一层：基础结构验证已在validateStructure中完成
    
    // 第二层：字段类型和格式验证
    const typeResult = this.validateFieldTypes(item, index);
    if (!typeResult.valid) {
      return typeResult;
    }
    
    // 第三层：业务逻辑合理性验证
    const businessResult = this.validateBusinessLogic(typeResult.sanitizedItem, index);
    if (!businessResult.valid) {
      return { 
        valid: false, 
        errors: [...(typeResult.errors || []), ...businessResult.errors]
      };
    }
    
    return typeResult; // 返回净化后的数据
  }
};

// ======== 改进的JSON导入函数 ========
function importJSON(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = function() {
    try {
      const fileContent = r.result;
      
      // 安全检查：防止超大文件导致内存溢出
      if (fileContent.length > 50 * 1024 * 1024) { // 50MB限制
        showToast('文件过大（>50MB），请分批导入', 'error');
        return;
      }
      
      const imported = JSON.parse(fileContent);
      
      // ===== 使用新的多层验证系统 =====
      // 第一层：基础数据结构验证
      const structureResult = ImportValidator.validateStructure(imported);
      if (!structureResult.valid) {
        showToast('导入失败: ' + structureResult.error, 'error');
        return;
      }
      
      // 逐条记录和验证
      const valid = [], skipped = [], allErrors = [];
      
      for (let i = 0; i < imported.length; i++) {
        const item = imported[i];
        const result = ImportValidator.validateRecord(item, i);
        
        if (result.valid && result.sanitizedItem) {
          valid.push(result.sanitizedItem);
        } else {
          skipped.push({
            index: i,
            item: item,
            errors: result.errors || ['未知验证错误']
          });
          allErrors.push(...(result.errors || []));
        }
      }
      
      // 生成详细的验证报告
      if (skipped.length > 0) {
        const errorSummary = generateErrorSummary(allErrors);
        showImportValidationReport(valid.length, skipped.length, errorSummary);
      } else {
        showToast('导入成功，共 ' + valid.length + ' 条记录通过完整验证', 'success');
      }
      
      if (valid.length === 0) return;
      
      // 确认覆盖现有数据
      if (logs.length > 0) {
        if (!confirm('导入将替换现有的 ' + logs.length + ' 条日志，当前数据将被覆盖，是否继续？')) {
          return;
        }
      }
      
      logs = valid;
      _migrateTimes(logs);
      openClosePanelIdx = -1; 
      saveLogs();
      
      // 如果有跳过的记录，提供详细错误报告下载
      if (skipped.length > 0) {
        offerErrorReportDownload(skipped);
      }
      
    } catch(err) {
      showToast('JSON解析失败: ' + err.message, 'error');
    }
  };
  r.readAsText(file);
}

/**
 * 生成错误摘要统计
 * @param {Array} allErrors - 所有错误信息
 * @returns {Object} 错误摘要
 */
function generateErrorSummary(allErrors) {
  const summary = {
    totalErrors: allErrors.length,
    byField: {},
    byType: {}
  };
  
  allErrors.forEach(error => {
    // 按字段分类
    const fieldMatch = error.match(/字段\[(\w+)\]/);
    if (fieldMatch) {
      const field = fieldMatch[1];
      summary.byField[field] = (summary.byField[field] || 0) + 1;
    }
    
    // 按错误类型分类
    if (error.includes('缺少必需字段')) {
      summary.byType['missing_required'] = (summary.byType['missing_required'] || 0) + 1;
    } else if (error.includes('类型')) {
      summary.byType['type_mismatch'] = (summary.byType['type_mismatch'] || 0) + 1;
    } else if (error.includes('范围') || error.includes('长度')) {
      summary.byType['constraint_violation'] = (summary.byType['constraint_violation'] || 0) + 1;
    } else {
      summary.byType['business_logic'] = (summary.byType['business_logic'] || 0) + 1;
    }
  });
  
  return summary;
}

/**
 * 显示导入验证报告
 * @param {number} validCount - 有效记录数
 * @param {number} skippedCount - 跳过记录数
 * @param {Object} errorSummary - 错误摘要
 */
function showImportValidationReport(validCount, skippedCount, errorSummary) {
  let message = `导入结果：成功 ${validCount} 条，跳过 ${skippedCount} 条\n\n`;
  
  if (errorSummary.totalErrors > 0) {
    message += `发现 ${errorSummary.totalErrors} 个验证错误：\n`;
    
    if (Object.keys(errorSummary.byField).length > 0) {
      message += '\n按字段分布：\n';
      Object.entries(errorSummary.byField).forEach(([field, count]) => {
        message += `- ${field}: ${count} 个错误\n`;
      });
    }
    
    if (Object.keys(errorSummary.byType).length > 0) {
      message += '\n按错误类型分布：\n';
      Object.entries(errorSummary.byType).forEach(([type, count]) => {
        const typeNames = {
          'missing_required': '缺少必需字段',
          'type_mismatch': '类型不匹配', 
          'constraint_violation': '约束违反',
          'business_logic': '业务逻辑错误'
        };
        message += `- ${typeNames[type] || type}: ${count} 个错误\n`;
      });
    }
  }
  
  showToast(message, 'warn', 15000); // 15秒显示时间
}

/**
 * 提供错误报告下载
 * @param {Array} skippedRecords - 跳过的记录详情
 */
function offerErrorReportDownload(skippedRecords) {
  setTimeout(() => {
    if (confirm('检测到数据验证错误，是否下载详细的错误报告以便修正？')) {
      const errorReport = {
        timestamp: new Date().toISOString(),
        totalSkipped: skippedRecords.length,
        records: skippedRecords
      };
      
      const blob = new Blob([JSON.stringify(errorReport, null, 2)], 
        {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import_errors_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('错误报告已下载，请根据报告修正数据后重新导入', 'info');
    }
  }, 1000);
}

// 暴露到全局窗口对象
window.exportCSV = exportCSV;
window.exportJSON = exportJSON;
window.importJSON = importJSON;
