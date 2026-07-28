// ==================== 导入导出模块 ====================
// 为 index.html 和 trading.html 提供统一的 I/O 函数

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

// 暴露到全局窗口对象
window.exportCSV = exportCSV;
window.exportJSON = exportJSON;
window.importJSON = importJSON;
