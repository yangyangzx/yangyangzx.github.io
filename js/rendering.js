// ==================== 渲染日志 ====================
let _expandedRows = new Set();   // 已展开的日志行索引集合

function renderLogs() {
  const tbody = document.getElementById('logBody');

  // 构建显式列表（排除待删除）
  var pendingDelete = window._pendingDeleteIndices || new Set();
  var dl = []; // [{item, origIdx}]
  for (var i = 0; i < logs.length; i++) {
    if (!pendingDelete.has(i)) dl.push({item: logs[i], origIdx: i});
  }
  
  // 按时间从新到旧排序
  dl.sort(function(a, b) {
    var timeA = a.item.time ? new Date(a.item.time).getTime() : 0;
    var timeB = b.item.time ? new Date(b.item.time).getTime() : 0;
    return timeB - timeA;
  });
  
  dl = filterEntries(dl);

  const visibleCount = dl.length;
  document.getElementById('logCount').textContent = '共 ' + visibleCount + ' 条';

  // 更新过滤结果标签
  var fr = document.getElementById('filterResult');
  if (fr) {
    var hasAnyFilter = !!( _activeFilters.direction || _activeFilters.symbol || _activeFilters.strategy ||
                           _activeFilters.status || _activeFilters.pnl || _activeFilters.time );
    if (hasAnyFilter) {
      fr.textContent = '\u5f53\u524d\u7b5b\u9009\u7ed3\u679c ' + visibleCount + ' \u6761';
    } else {
      fr.textContent = '\u5168\u90e8 ' + visibleCount + ' \u6761';
    }
  }

  // 批量模式 class
  const tw = document.getElementById('tableWrap');
  if (tw) tw.classList.toggle('batch-mode', _batchMode);
  // 清理旧平仓面板键盘监听
  if (_closePanelKeyHandler) { document.removeEventListener('keydown', _closePanelKeyHandler); _closePanelKeyHandler = null; }

  if (visibleCount === 0) {
    const emptyMsg = logs.length === 0
      ? '填写上方计算器，点击「保存日志」开始'
      : '当前筛选条件无匹配，试试清除过滤';
    const emptyTitle = logs.length === 0 ? '暂无交易记录' : '无匹配结果';
    tbody.innerHTML = '<tr><td colspan="9" class="empty"><div class="empty-icon"><i class="fas fa-chart-bar"></i></div><div class="empty-title">' + emptyTitle + '</div><div class="empty-sub">' + emptyMsg + '</div></td></tr>';
    // 仅在全表为空时重置面板状态；筛选无匹配时保留当前面板状态
    if (logs.length === 0) {
      openClosePanelIdx = -1;
      actionPanelIdx = -1;
    }
    document.getElementById('statsPanel').style.display = 'none';
    document.getElementById('summaryBar').style.display = 'none';
    autoCountLossStreak();
    populateFilterOptions();
    return;
  }

  document.getElementById('summaryBar').style.display = 'flex';

  let html = '';

  for (var ri = 0; ri < dl.length; ri++) {
    var entry = dl[ri];
    var item = entry.item;
    var realIdx = entry.origIdx;
    var isClosed = !!(item.closeType && item.closeType !== '');
    var isExpanded = _expandedRows.has(realIdx);

    const dir    = item.direction === 'long' ? '多' : '空';
    const dirCls = item.direction === 'long' ? 'badge long' : 'badge short';
    const mindset = item.mindsetScore ? '\u2605'.repeat(item.mindsetScore) + '\u2606'.repeat(5 - item.mindsetScore) : '—';

    let strategyShort = '—';
    if (item.strategyFramework) {
      strategyShort = esc(item.strategyFramework);
      if (item.strategyPattern) {
        const pts = item.strategyPattern.split('|');
        if (pts.length === 2) {
          strategyShort += ' · ' + esc(PATTERN_GROUP_LABELS[pts[0]] || pts[0]) + ' · ' + esc(pts[1]);
        } else {
          strategyShort += ' · ' + esc(item.strategyPattern);
        }
      }
    }

    let signalShort = '—';
    if (item.signals && item.signals.length > 0) {
      signalShort = item.signals.map(s => SIGNAL_LABELS[s] || s).join(' / ');
    }

    // ====== 平仓类型标签 ======
    let ctBadge = '—';
    if (!isClosed) {
      ctBadge = '<span class="badge-ct holding">持仓</span>';
    } else if (item.closeType === 'initialSL') {
      ctBadge = '<span class="badge-ct sl">止损</span>';
    } else if (item.closeType === 'trailingSL') {
      ctBadge = '<span class="badge-ct trail">追踪损</span>';
    } else if (item.closeType === 'initialTP') {
      ctBadge = '<span class="badge-ct tp">止盈</span>';
    } else if (item.closeType === 'manualWin') {
      ctBadge = '<span class="badge-ct win">赢</span>';
    } else if (item.closeType === 'manualLoss') {
      ctBadge = '<span class="badge-ct loss">损</span>';
    } else if (item.closeType === 'liquidation') {
      ctBadge = '<span class="badge-ct liquidation">爆仓</span>';
    } else if (item.closeType === 'partialTP') {
      ctBadge = '<span class="badge-ct tp">部分止</span>';
    } else if (item.closeType === 'timeStop') {
      ctBadge = '<span class="badge-ct trail">时损</span>';
    } else {
      ctBadge = '<span class="badge-ct holding">' + esc(CLOSE_TYPE_LABELS[item.closeType] || item.closeType) + '</span>';
    }
    const ctLabel = isClosed ? (CLOSE_TYPE_LABELS[item.closeType] || item.closeType) : '持仓中';

    // ====== 盈亏 + R 倍数子文本 ======
    let pnlVal = parseFloat(item.pnlAmount);
    let pnlHtml = '<span class="pnl-none">—</span>';
    let rSubHtml = '';
    if (!isNaN(pnlVal)) {
      const cls = pnlVal >= 0 ? 'pnl-positive' : 'pnl-negative';
      const prefix = pnlVal >= 0 ? '+' : '';
      pnlHtml = '<span class="' + cls + '">' + prefix + pnlVal.toFixed(2) + '</span>';
      // R 倍数子文本
      const storedR = parseFloat(String(item.rMultiple || '').replace(/R/g, ''));
      let rVal = NaN;
      if (!isNaN(storedR)) { rVal = storedR; }
      else {
        const risk = parseFloat(item.riskAmount);
        if (!isNaN(risk) && risk > 0) { rVal = pnlVal / risk; }
      }
      if (!isNaN(rVal)) {
        rSubHtml = '<span class="pnl-sub">' + (rVal >= 0 ? '+' : '') + rVal.toFixed(2) + 'R</span>';
      }
    }

    // R倍数（detail用）
    let rMultipleHtml = '—';
    const storedR2 = parseFloat(String(item.rMultiple || '').replace(/R/g, ''));
    if (!isNaN(storedR2)) {
      rMultipleHtml = (storedR2 >= 0 ? '+' : '') + storedR2.toFixed(2) + 'R';
    } else if (!isNaN(pnlVal)) {
      const risk = parseFloat(item.riskAmount);
      if (!isNaN(risk) && risk > 0) {
        rMultipleHtml = (pnlVal/risk >= 0 ? '+' : '') + (pnlVal/risk).toFixed(2) + 'R';
      }
    }

    const otGroup = ORDER_TYPE_GROUP[item.orderType] || '';
    const otName = ORDER_TYPE_LABELS[item.orderType] || (item.orderType || '—');
    const otLabel = otGroup ? otGroup + ' ' + otName : otName;

    let targetPriceDisplay = item.targetPrice != null ? item.targetPrice : '—';

    let closeNoteDisplay = '—';
    if (item.closeNote && item.closeNote.trim()) {
      const cn = esc(item.closeNote.trim());
      closeNoteDisplay = cn.length > 15 ? cn.substring(0, 15) + '...' : cn;
    }

    let groupBadge = '';
    let groupClass = '';
    if (item.groupId) {
      groupBadge = '<span class="group-badge">' + (item.groupLabel || '分组') + '</span>';
      groupClass = ' group-highlight';
    }

    // ====== 紧凑操作按钮 ======
    let actionHtml = '';
    actionHtml += '<button class="btn edit-trigger" data-idx="' + realIdx + '" title="编辑"><i class="fas fa-pen"></i></button>';
    actionHtml += '<button class="btn btn-danger-outline delete-trigger" data-idx="' + realIdx + '" title="删除"><i class="fas fa-trash"></i></button>';
    if (!isClosed) {
      actionHtml += '<button class="btn btn-close-action close-trigger" data-idx="' + realIdx + '"><i class="fas fa-check-circle"></i> 平仓</button>';
      actionHtml += '<button class="btn action-record-trigger" data-idx="' + realIdx + '" title="记录动作"><i class="fas fa-clipboard-list"></i> 记录</button>';
    }

    // ====== 核心行（7 列 + 展开按钮 + 批量选） ======
    html += '<tr data-log-idx="' + realIdx + '" class="log-row ' + groupClass + '">' +
      '<td class="batch-col"><input type="checkbox" class="batch-checkbox" data-batch-idx="' + realIdx + '" /></td>' +
      '<td><button class="btn-expand" data-expand-idx="' + realIdx + '">' + (isExpanded ? '\u25bc' : '\u25b6') + '</button></td>' +
      '<td data-label="\u65f6\u95f4">' + groupBadge + fmtTime(item.time) + '</td>' +
      '<td data-label="\u54c1\u79cd">' + (esc(item.symbol) || '') + '</td>' +
      '<td data-label="\u65b9\u5411"><span class="' + dirCls + '">' + dir + ' ' + ctBadge + '</span></td>' +
      '<td data-label="\u5165\u573a\u4ef7">' + (item.entryPrice != null ? item.entryPrice : '—') + '</td>' +
      '<td data-label="\u5e73\u4ed3\u4ef7">' + (item.closePrice != null ? item.closePrice : '—') + '</td>' +
      '<td data-label="\u76c8\u4e8f"><span class="pnl-cell">' + pnlHtml + rSubHtml + '</span>' +
        // Execution score badge
        (item.executionScore != null ? '<span class="exec-badge exec-' + item.executionScore + '">执行 ' + item.executionScore + '/3</span>' : '') +
        // Loss reason tags
        (item.lossReason ? '<div class="loss-reason-tags">' + (Array.isArray(item.lossReason) ? item.lossReason : [item.lossReason]).map(function(r) { return '<span class="loss-reason-tag">' + esc(r) + '</span>'; }).join('') + '</div>' : '') +
        // Emotion tags
        (item.emotions && item.emotions.length ? '<div class="emotion-tags">' + item.emotions.map(function(e) { return '<span class="emotion-tag">' + esc(e) + '</span>'; }).join('') + '</div>' : '') +
      '</td>' +
      '<td data-label="\u64cd\u4f5c" class="action-col">' + actionHtml + '</td>' +
    '</tr>';

    // ====== 详情行 ======
    if (isExpanded) {
      html += '<tr class="detail-row"><td colspan="9"><div class="detail-grid">' +
        '<div class="ditem"><span class="dlabel">订单类型</span><span class="dval">' + otLabel + '</span></div>' +
        '<div class="ditem"><span class="dlabel">止损价</span><span class="dval">' + (item.stopLoss != null ? item.stopLoss : '—') + '</span></div>' +
        '<div class="ditem"><span class="dlabel">目标价</span><span class="dval">' + targetPriceDisplay + '</span></div>' +
        '<div class="ditem"><span class="dlabel">仓位(USDT)</span><span class="dval">' + (item.positionSize != null ? Number(item.positionSize).toFixed(2) : '—') + '</span></div>' +
        '<div class="ditem"><span class="dlabel">杠杆</span><span class="dval">' + (item.leverage ?? 0) + '</span></div>' +
        '<div class="ditem"><span class="dlabel">风险额</span><span class="dval">' + (item.riskAmount != null ? item.riskAmount : '—') + '</span></div>' +
        '<div class="ditem"><span class="dlabel">心态分</span><span class="dval">' + mindset + '</span></div>' +
        '<div class="ditem"><span class="dlabel">形态/策略</span><span class="dval">' + strategyShort + '</span></div>' +
        '<div class="ditem"><span class="dlabel">信号K</span><span class="dval">' + signalShort + '</span></div>' +
        '<div class="ditem"><span class="dlabel">平仓类型</span><span class="dval">' + ctLabel + '</span></div>' +
        '<div class="ditem"><span class="dlabel">R倍数</span><span class="dval">' + rMultipleHtml + '</span></div>' +
        '<div class="ditem"><span class="dlabel">持仓时长</span><span class="dval" style="font-size:12px;color:var(--color-text-muted);">' + formatHoldDuration(item.closeTime, item.time) + '</span></div>' +
        '<div class="ditem"><span class="dlabel">备注</span><span class="dval">' + closeNoteDisplay + '</span></div>' +
        '<div class="ditem"><span class="dlabel">入场原因</span><span class="dval">' + (esc(item.reason) || '—') + '</span></div>' +
        '<div class="ditem"><span class="dlabel">本金快照</span><span class="dval">' + (item.capital != null ? item.capital : '—') + '</span></div>' +
        '<div class="ditem"><span class="dlabel">交易时段</span><span class="dval">' + (item.session || '—') + '</span></div>' +
        '<div class="ditem"><span class="dlabel">市场环境</span><span class="dval">' + esc(getMarketConditionLabel(item.marketCondition)) + '</span></div>' +
        '<div class="ditem"><span class="dlabel">出场理由</span><span class="dval">' + (item.exitReason || '—') + '</span></div>' +
        (item.actions && item.actions.length ? '<div class="ditem" style="grid-column:span 4;"><span class="dlabel">盘中动作</span><div class="dval">' + renderActionsHtml(item.actions) + '</div></div>' : '') +
      '</div></td></tr>';
    }

    // ====== 内联动作记录面板（持仓中的交易） ======
    if (!isClosed && actionPanelIdx === realIdx) {
      html += '<tr class="close-panel-row" data-action-panel="' + realIdx + '"><td colspan="9">' +
        '<div class="trade-action-panel">' +
          '<div class="fp">' +
            '<label>动作类型</label>' +
            '<select id="actType_' + realIdx + '">' +
              '<option value="sl_move">移动止损</option>' +
              '<option value="partial">部分止盈</option>' +
              '<option value="add">加仓</option>' +
              '<option value="reduce">减仓</option>' +
              '<option value="other">其他</option>' +
            '</select>' +
          '</div>' +
          '<div class="fp">' +
            '<label>价格</label>' +
            '<input type="number" id="actPrice_' + realIdx + '" step="0.01" placeholder="价格" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>时间</label>' +
            '<input type="datetime-local" id="actTime_' + realIdx + '" />' +
          '</div>' +
          '<div class="fp span-3">' +
            '<label>备注</label>' +
            '<input type="text" id="actNote_' + realIdx + '" placeholder="补充说明..." />' +
          '</div>' +
          '<div class="action-actions">' +
            '<button class="btn btn-ghost btn-sm" id="actCancel_' + realIdx + '">取消</button>' +
            '<button class="btn btn-success btn-sm" onclick="saveTradeAction(' + realIdx + ')"><i class="fas fa-save"></i> 保存</button>' +
          '</div>' +
        '</div></td></tr>';
    }

    // ====== 内联平仓面板 ======
    if (openClosePanelIdx === realIdx) {
      const ctVal = '';
      const cpVal = '';
      const paVal = '';
      const ppVal = '';
      const rmVal = '';
      const cnEscaped = '';

      html += '<tr class="close-panel-row" data-close-panel="' + realIdx + '"><td colspan="9">' +
        '<div class="close-panel">' +
          '<div class="fp">' +
            '<label>平仓类型 <span style="color:var(--color-danger);margin-left:2px">*</span></label>' +
            '<select id="cpCloseType_' + realIdx + '">' +
              '<option value="">— 请选择 —</option>' +
              '<option value="initialSL"' + (ctVal === 'initialSL' ? ' selected' : '') + '>初始止损 — 自动填入止损价</option>' +
              '<option value="trailingSL"' + (ctVal === 'trailingSL' ? ' selected' : '') + '>追踪止损</option>' +
              '<option value="initialTP"' + (ctVal === 'initialTP' ? ' selected' : '') + '>初始止盈</option>' +
              '<option value="manualWin"' + (ctVal === 'manualWin' ? ' selected' : '') + '>现价手平赢</option>' +
              '<option value="manualLoss"' + (ctVal === 'manualLoss' ? ' selected' : '') + '>现价手平损</option>' +
              '<option value="liquidation"' + (ctVal === 'liquidation' ? ' selected' : '') + '>强平/爆仓</option>' +
              '<option value="partialTP"' + (ctVal === 'partialTP' ? ' selected' : '') + '>部分止盈</option>' +
              '<option value="timeStop"' + (ctVal === 'timeStop' ? ' selected' : '') + '>时间止损</option>' +
              '<option value="reducePosition"' + (ctVal === 'reducePosition' ? ' selected' : '') + '>减仓</option>' +
            '</select>' +
          '</div>' +
          '<div class="fp">' +
            '<label>平仓价格 <span style="color:var(--color-danger);margin-left:2px">*</span></label>' +
            '<input type="number" id="cpClosePrice_' + realIdx + '" step="0.01" placeholder="价格" value="' + cpVal + '" />' +
          '</div>' +
          '<div class="fp readonly">' +
            '<label>盈亏金额 (USDT)</label>' +
            '<input type="text" id="cpPnlAmount_' + realIdx + '" readonly placeholder="自动计算" value="' + paVal + '" />' +
          '</div>' +
          '<div class="fp readonly">' +
            '<label>盈亏百分比 <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（保证金回报率）</span></label>' +
            '<input type="text" id="cpPnlPercent_' + realIdx + '" readonly placeholder="自动计算" value="' + ppVal + '" />' +
          '</div>' +
          '<div class="fp readonly">' +
            '<label>R 倍数</label>' +
            '<input type="text" id="cpRMultiple_' + realIdx + '" readonly placeholder="自动计算" value="' + rmVal + '" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>手续费 (USDT)</label>' +
            '<input type="text" id="cpFee_' + realIdx + '" readonly placeholder="从日志读取" value="' + (item.fee || '') + '" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>滑点成本 (USDT)</label>' +
            '<input type="text" id="cpSlippage_' + realIdx + '" readonly placeholder="从日志读取" value="' + (item.slippageCost || '') + '" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>平仓时间</label>' +
            '<input type="text" readonly style="color:var(--color-text-muted);font-size:12px;" value="' + (item.closeTime ? new Date(item.closeTime).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).replace(/\//g,'-') : '—') + '" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>持仓时长</label>' +
            '<input type="text" readonly style="color:var(--color-text-muted);font-size:12px;" value="' + formatHoldDuration(item.closeTime, item.time) + '" />' +
          '</div>' +
          '<div class="fp span-2">' +
            '<label>平仓备注<span class="optional-tag" style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（选填）</span></label>' +
            '<textarea id="cpCloseNote_' + realIdx + '" placeholder="平仓总结、教训等...">' + cnEscaped + '</textarea>' +
          '</div>' +
          // ====== 执行评分 ======
          '<div class="fp span-2" style="padding-top:4px;border-top:1px solid var(--color-border-light);">' +
            '<label>执行评分（0-3）<span id="cpExecScore_' + realIdx + '" style="margin-left:8px;font-weight:700;font-size:15px;color:var(--color-text-muted);">0</span></label>' +
            '<div class="checkbox-group" style="padding-top:2px;" id="cpExecChecks_' + realIdx + '">' +
              '<label style="color:var(--color-text);"><input type="checkbox" value="planEntry" onchange="cpUpdateExecScore(' + realIdx + ')" /> 按计划入场</label>' +
              '<label style="color:var(--color-text);"><input type="checkbox" value="stopLossIntact" onchange="cpUpdateExecScore(' + realIdx + ')" /> 止损未被移动/破坏</label>' +
              '<label style="color:var(--color-text);"><input type="checkbox" value="planExit" onchange="cpUpdateExecScore(' + realIdx + ')" /> 按计划减仓/平仓</label>' +
            '</div>' +
          '</div>' +
          // ====== MAE / MFE（极值价格输入） ======
          '<div class="fp span-2" style="padding-top:4px;border-top:1px solid var(--color-border-light);">' +
            '<label>持仓期间极值价格<span class="optional-tag" style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（选填）</span></label>' +
            '<span class="field-tip" style="display:block;margin-bottom:6px;">填入持仓期间触及的极值价格，系统自动计算偏离百分比</span>' +
          '</div>' +
          '<div class="fp">' +
            '<label>最低价</label>' +
            '<input type="number" id="cpLowPrice_' + realIdx + '" step="0.01" placeholder="' + (item.entryPrice || '入场价') + '" value="' + (item.lowPrice != null ? item.lowPrice : '') + '" oninput="calcMAEMFE(' + realIdx + ')" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>最高价</label>' +
            '<input type="number" id="cpHighPrice_' + realIdx + '" step="0.01" placeholder="' + (item.entryPrice || '入场价') + '" value="' + (item.highPrice != null ? item.highPrice : '') + '" oninput="calcMAEMFE(' + realIdx + ')" />' +
          '</div>' +
          '<div class="fp span-2" id="cpMAEMFEDisplay_' + realIdx + '" style="display:none;background:var(--color-surface);border-radius:var(--radius-md);padding:8px 12px;font-size:13px;line-height:1.6;">' +
          '</div>' +
          '<div class="fp span-2" id="cpMAEMFEInterpret_' + realIdx + '" style="display:none;font-size:12px;color:var(--color-text-secondary);line-height:1.5;">' +
          '</div>' +
          // ====== 亏损原因 ======
          '<div class="fp span-2" id="cpLossReasonRow_' + realIdx + '" style="display:' + ((item.pnlAmount != null && parseFloat(item.pnlAmount) < 0) || item.closeType === 'manualLoss' || item.closeType === 'liquidation' ? 'block' : 'none') + ';">' +
            '<label>亏损原因<span style="font-size:11px;color:var(--color-danger);font-weight:400;">（必填·多选）</span></label>' +
            '<div class="checkbox-group" id="cpLossReason_' + realIdx + '" style="flex-wrap:wrap;gap:4px 12px;">' +
              (function makeLossReasonCheckboxes(reasons, selected) {
                var h = '';
                var arr = Array.isArray(selected) ? selected : (typeof selected === 'string' && selected ? [selected] : []);
                reasons.forEach(function(r) {
                  h += '<label style="font-size:13px;color:var(--color-text);white-space:nowrap;"><input type="checkbox" value="' + r + '"' + (arr.indexOf(r) !== -1 ? ' checked' : '') + ' /> ' + r + '</label>';
                });
                return h;
              }(LOSS_REASON_OPTIONS, item.lossReason)) +
            '</div>' +
          '</div>' +
          '<div class="fp span-2">' +
            '<label>本次交易情绪<span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（可选·多选）</span></label>' +
            '<div class="checkbox-group" id="cpEmotions_' + realIdx + '" style="flex-wrap:wrap;gap:4px 16px;">' +
              (function makeEmotionCheckboxes(selected) {
                var arr = Array.isArray(selected) ? selected : [];
                var h = '';
                EMOTION_OPTIONS.forEach(function(o) {
                  h += '<label style="font-size:13px;color:var(--color-text);white-space:nowrap;" title="' + o.desc + '"><input type="checkbox" value="' + o.value + '"' + (arr.indexOf(o.value) !== -1 ? ' checked' : '') + ' /> ' + o.value + ' <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">' + o.desc + '</span></label>';
                });
                return h;
              }(item.emotions)) +
            '</div>' +
          '</div>' +
          '<div class="fp span-2">' +
            '<label>出场理由<span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（可选，主观出场动机）</span></label>' +
            '<textarea id="cpExitReason_' + realIdx + '" placeholder="如：到达前高阻力位、出现看跌吞没、时间止损...">' + esc(item.exitReason || '') + '</textarea>' +
          '</div>' +
          '<div class="close-actions">' +
            '<button class="btn btn-success btn-sm" id="cpConfirm_' + realIdx + '"><i class="fas fa-check"></i> 确认平仓</button>' +
            '<button class="btn btn-outline btn-sm" id="cpCancel_' + realIdx + '"><i class="fas fa-times"></i> 取消</button>' +
          '</div>' +
        '</div>' +
      '</td></tr>';
    }
  }

  tbody.innerHTML = html;

  // 展开/折叠事件
  tbody.querySelectorAll('.btn-expand').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.expandIdx, 10);
      if (_expandedRows.has(idx)) {
        _expandedRows.delete(idx);
      } else {
        _expandedRows.add(idx);
      }
      renderLogs();
    });
  });

  // Close panel triggers
  tbody.querySelectorAll('.close-trigger').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.idx);
      openClosePanelIdx = (openClosePanelIdx === idx) ? -1 : idx;
      actionPanelIdx = -1;
      renderLogs();
    });
  });

  // Action record triggers
  tbody.querySelectorAll('.action-record-trigger').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.idx);
      actionPanelIdx = (actionPanelIdx === idx) ? -1 : idx;
      openClosePanelIdx = -1;
      renderLogs();
      if (actionPanelIdx === idx) {
        setTimeout(function() {
          const timeEl = document.getElementById('actTime_' + idx);
          if (timeEl) { const now = new Date(); timeEl.value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + 'T' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0'); }
        }, 50);
      }
    });
  });

  // Action panel cancel buttons
  tbody.querySelectorAll('[id^="actCancel_"]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      actionPanelIdx = -1;
      renderLogs();
    });
  });

  // Edit/Delete triggers — 将 delete/edit 按钮事件绑定移到此处闭包，保证 idx 捕获正确
  (function bindEditDeleteAfter() {
    tbody.querySelectorAll('.edit-trigger').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        openEditModal(idx);
      });
    });

    tbody.querySelectorAll('.delete-trigger').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.idx);
        const item = logs[idx];
        if (!item) return;
        const msg = '确定删除 ' + (item.symbol || '') + ' ' + (item.direction === 'long' ? '做多' : '做空') + ' 这笔日志？';
        if (!confirm(msg)) return;
        if (!confirm('⚠️ 再次确认：删除后将无法恢复，确定继续？')) return;
        
        // F5: 单条删除 — 实际不立即从 logs 中移除，而是通过 _pendingDeleteIndices 标记隐藏
        // 超时后由 _commitPendingDelete() 执行 splice 真正删除；撤销时只清除标记即可
        if (_pendingDelete) {
          clearTimeout(_pendingDelete.timeoutId);
          _commitPendingDelete();
        }
        _pendingDelete = { idx, timeoutId: null };
        if (!window._pendingDeleteIndices) window._pendingDeleteIndices = new Set();
        window._pendingDeleteIndices.add(idx);
        showUndoToast('已删除，点击撤销（5秒）', function() {
          window._pendingDeleteIndices.delete(idx);
          _pendingDelete = null;
          renderLogs();
        }, function() {
          _commitPendingDelete();
        }, 5000);
      });
    });
  })();

  // Close panel init
  for (let i = 0; i < logs.length; i++) {
    const cpType = document.getElementById('cpCloseType_' + i);
    const cpPrice = document.getElementById('cpClosePrice_' + i);
    if (cpPrice) { cpPrice.addEventListener('input', function() { _closePriceEdited[i] = true; calcClosePnL(i); }); cpPrice.addEventListener('change', function() { _closePriceEdited[i] = true; }); }
    if (cpType) cpType.addEventListener('change', function() { 
      if (cpType.value === 'initialSL' && !_closePriceEdited[i]) {
        const item = logs[i];
        const cpPriceEl = document.getElementById('cpClosePrice_' + i);
        if (item && cpPriceEl && item.stopLoss != null && item.stopLoss !== '') {
          cpPriceEl.value = item.stopLoss;
          cpPriceEl.select();
        }
      }
      calcClosePnL(i); 
    });
    const confirmBtn = document.getElementById('cpConfirm_' + i);
    const cancelBtn = document.getElementById('cpCancel_' + i);
    if (confirmBtn) confirmBtn.addEventListener('click', function(e) { e.preventDefault(); confirmClose(i); });
    if (cancelBtn) cancelBtn.addEventListener('click', function(e) { e.preventDefault(); openClosePanelIdx = -1; renderLogs(); });
    // 键盘快捷键：Enter→确认平仓, Esc→关闭面板
    // —— handler 统一在循环外注册，避免每轮 addEventListener 泄漏
    // 自动聚焦到平仓价格
    (function(idx) {
      setTimeout(function() {
        const cpEl = document.getElementById('cpClosePrice_' + idx);
        if (cpEl) cpEl.focus();
      }, 80);
    })(i);
  }
  // 统一键盘 handler（只注册一次，基于 openClosePanelIdx 全局变量）
  // FIX #13: Use stable handler from constants.js to prevent duplicate event listeners
  if (_closePanelKeyHandler) {
    document.removeEventListener('keydown', _closePanelKeyHandler);
  }
  _closePanelKeyHandler = createClosePanelKeyDownHandler();
  document.addEventListener('keydown', _closePanelKeyHandler);
  // 恢复执行评分复选框状态
  for (let i = 0; i < logs.length; i++) {
    const item = logs[i];
    const container = document.getElementById('cpExecChecks_' + i);
    if (!container || item.executionScore == null) continue;
    const checks = container.querySelectorAll('input[type="checkbox"]');
    const seq = ['planEntry', 'stopLossIntact', 'planExit'];
    for (let j = 0; j < seq.length; j++) {
      checks[j].checked = j < item.executionScore;
    }
    // 移除旧 onchange 后重新绑定（避免重复绑定）
    checks.forEach(cb => { cb.onchange = null; cb.addEventListener('change', function() { cpUpdateExecScore(i); }); });
    cpUpdateExecScore(i);
  }
  // 恢复 MAE/MFE 计算（已平仓交易有极值价格时触发）
  for (let i = 0; i < logs.length; i++) {
    const item = logs[i];
    if (item.lowPrice != null || item.highPrice != null) {
      calcMAEMFE(i);
    }
  }
  // 批量复选框事件
  tbody.querySelectorAll('.batch-checkbox[data-batch-idx]').forEach(cb => {
    cb.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.batchIdx, 10);
      handleBatchCheck(idx, this.checked);
    });
  });
  // 恢复已选状态
  tbody.querySelectorAll('.batch-checkbox[data-batch-idx]').forEach(cb => {
    const idx = parseInt(cb.dataset.batchIdx, 10);
    cb.checked = _selectedIndices.has(idx);
  });
  try { updateStats(); } catch(e) { console.error('[renderLogs] updateStats error:', e); }
  autoCountLossStreak();
  populateFilterOptions();
}
