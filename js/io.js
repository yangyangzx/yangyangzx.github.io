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
    const line = [fmtTime(row.time),row.symbol,row.direction,row.orderType||'market',row.entryPrice,row.stopLoss,row.targetPrice??'',row.positionSize,row.leverage,row.riskAmount,row.capital??'',ms,sf,ss,row.session||'',row.marketCondition||'',ctl,row.closePrice??'',closeTimeFormatted,row.holdDuration??'',String(row.rMultiple??'').replace(/R$/,''),row.pnlAmount??'',String(row.pnlPercent??'').replace(/%/g,''),row.mae??'',row.mfe??'',row.executionScore??'',row.exitReason??'',Array.isArray(row.lossReason)?row.lossReason.join(';'):(row.lossReason||''),Array.isArray(row.emotions)?row.emotions.join(';'):(row.emotions||''),row.closeNote??'',row.reason,row.fee??'',row.slippageCost??''].map(v=>'"'+(v==null?'':String(v).replace(/"/g,'""'))+'"').join(',');
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
    
    // 业务规则验证
    if (item.direction && !this.validDirections.includes(item.direction.toLowerCase())) {
      errors.push(`第${index}条记录方向无效：${item.direction}`);
    }
    
    if (item.entryPrice && (isNaN(Number(item.entryPrice)) || Number(item.entryPrice) <= 0)) {
      errors.push(`第${index}条记录入场价无效：${item.entryPrice}`);
    }
    
    if (item.leverage && (isNaN(Number(item.leverage)) || Number(item.leverage) < 1 || Number(item.leverage) > 125)) {
      errors.push(`第${index}条记录杠杆超出合理范围：1-125倍`);
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
        
        // HTML实体编码
        sanitized[field] = value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;');
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

function importJSON(file) {
  const r = new FileReader();
  r.onload = function(e) {
    try {
      const d = JSON.parse(e.target.result);
      
      // 使用多层验证器进行安全检查
      const validationReport = importValidator.validateAndSanitize(d);
      
      if (validationReport.errors.length > 0) {
        const errorMsg = `导入验证失败:\n${validationReport.errors.slice(0, 5).join('\n')}`;
        if (validationReport.errors.length > 5) {
          errorMsg += `\n... 还有${validationReport.errors.length - 5}个错误`;
        }
        alert(errorMsg);
        return;
      }
      
      if (validationReport.valid.length === 0) {
        showToast('没有有效的记录可导入','warn');
        return;
      }
      
      // 显示导入报告
      let msg = `导入验证完成：\n✅ 有效记录: ${validationReport.valid.length}条\n⚠️ 跳过记录: ${validationReport.errors.length}条`;
      if (validationReport.warnings.length > 0) {
        msg += `\n📋 警告: ${validationReport.warnings.join(', ')}`;
      }
      
      if (confirm(msg + '\n\n是否继续导入有效记录？')) {
        // 合并去重逻辑可以在这里添加
        logs.push(...validationReport.valid);
        saveLogs();
        showToast(`成功导入 ${validationReport.valid.length} 条记录`,'success');
      }
    } catch(err) { 
      showToast('解析失败: '+err.message,'error'); 
    }
  };
  r.readAsText(file);
}

// ======== JSON导入Schema验证系统 ========
/**
 * JSON导入数据验证器 - 多层安全验证体系
 * 基于华尔街交易数据标准和OWASP安全规范设计
 */
