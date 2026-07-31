// ==================== 渲染日志 ====================
// 重构要点：
// 1. 事件委托：所有点击/输入事件统一在 tbody 上委托，消除重复绑定
// 2. 职责拆分：buildRowsHTML（纯函数）→ restoreAfterRender（状态恢复）→ renderLogs（编排）
// 3. 可测试性：构建逻辑与 DOM 操作解耦

let _expandedRows = new Set();   // 已展开的日志行索引集合
let _tbodyEventsBound = false;   // 事件委托是否已初始化

// ==================== 纯函数：构建行 HTML ====================
function buildRowsHTML(dl) {
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
      signalShort = item.signals.map(s => esc(SIGNAL_LABELS[s] || s)).join(' / ');
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

    const stopTypeLabel = item.stopType === 'stop-limit' ? '限价止损 (Stop-Limit)' : item.stopType === 'stop-market' ? '市价止损 (Stop-Market)' : (item.stopType || '—');

    const effEntryDisplay = item.effectiveEntryPrice != null
      ? item.effectiveEntryPrice + (String(item.effectiveEntryPrice) !== String(item.entryPrice) ? ' <span style="font-size:11px;color:var(--color-warning);">(修正)</span>' : '')
      : '—';

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

    // ====== 操作按钮（带 data-action 属性支持事件委托） ======
    let actionHtml = '';
    actionHtml += '<button class="btn edit-trigger" data-action="edit" data-idx="' + realIdx + '" title="编辑"><i class="fas fa-pen"></i></button>';
    actionHtml += '<button class="btn btn-danger-outline delete-trigger" data-action="delete" data-idx="' + realIdx + '" title="删除"><i class="fas fa-trash"></i></button>';
    if (!isClosed) {
      actionHtml += '<button class="btn btn-close-action close-trigger" data-action="close" data-idx="' + realIdx + '"><i class="fas fa-check-circle"></i> 平仓</button>';
      actionHtml += '<button class="btn action-record-trigger" data-action="action-record" data-idx="' + realIdx + '" title="记录动作"><i class="fas fa-clipboard-list"></i> 记录</button>';
    }

    // ====== 核心行 ======
    html += '<tr data-log-idx="' + realIdx + '" class="log-row ' + groupClass + '">' +
      '<td class="batch-col"><input type="checkbox" class="batch-checkbox" data-action="batch-check" data-batch-idx="' + realIdx + '" /></td>' +
      '<td><button class="btn-expand" data-action="expand" data-idx="' + realIdx + '">' + (isExpanded ? '\u25bc' : '\u25b6') + '</button></td>' +
      '<td data-label="\u65f6\u95f4">' + groupBadge + fmtTime(item.time) + '</td>' +
      '<td data-label="\u54c1\u79cd">' + (esc(item.symbol) || '') + '</td>' +
      '<td data-label="\u65b9\u5411"><span class="' + dirCls + '">' + dir + ' ' + ctBadge + '</span></td>' +
      '<td data-label="\u5165\u573a\u4ef7">' + (item.entryPrice != null ? item.entryPrice : '—') + '</td>' +
      '<td data-label="\u5e73\u4ed3\u4ef7">' + (item.closePrice != null ? item.closePrice : '—') + '</td>' +
      '<td data-label="\u76c8\u4e8f"><span class="pnl-cell">' + pnlHtml + rSubHtml + '</span>' +
        (item.executionScore != null ? '<span class="exec-badge exec-' + item.executionScore + '">执行 ' + item.executionScore + '/3</span>' : '') +
        (item.lossReason ? '<div class="loss-reason-tags">' + (Array.isArray(item.lossReason) ? item.lossReason : [item.lossReason]).map(function(r) { return '<span class="loss-reason-tag">' + esc(r) + '</span>'; }).join('') + '</div>' : '') +
        (item.emotions && item.emotions.length ? '<div class="emotion-tags">' + item.emotions.map(function(e) { return '<span class="emotion-tag">' + esc(e) + '</span>'; }).join('') + '</div>' : '') +
      '</td>' +
      '<td data-label="\u64cd\u4f5c" class="action-col">' + actionHtml + '</td>' +
    '</tr>';

    // ====== 详情行 ======
    if (isExpanded) {
      html += '<tr class="detail-row"><td colspan="9"><div class="detail-grid">' +
        '<div class="ditem"><span class="dlabel">订单类型</span><span class="dval">' + otLabel + '</span></div>' +
        '<div class="ditem"><span class="dlabel">止损类型</span><span class="dval">' + stopTypeLabel + '</span></div>' +
        '<div class="ditem"><span class="dlabel">实入场价</span><span class="dval">' + effEntryDisplay + '</span></div>' +
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
        '<div class="ditem"><span class="dlabel">交易时段</span><span class="dval">' + esc(item.session || '—') + '</span></div>' +
        '<div class="ditem"><span class="dlabel">市场环境</span><span class="dval">' + esc(getMarketConditionLabel(item.marketCondition)) + '</span></div>' +
        '<div class="ditem"><span class="dlabel">出场理由</span><span class="dval">' + esc(item.exitReason || '—') + '</span></div>' +
        (item.actions && item.actions.length ? '<div class="ditem" style="grid-column:span 4;"><span class="dlabel">盘中动作</span><div class="dval">' + renderActionsHtml(item.actions) + '</div></div>' : '') +
      '</div></td></tr>';
    }

    // ====== 内联动作记录面板 ======
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
            '<button class="btn btn-ghost btn-sm" data-action="action-cancel" data-idx="' + realIdx + '">取消</button>' +
            '<button class="btn btn-success btn-sm" data-action="action-save" data-idx="' + realIdx + '"><i class="fas fa-save"></i> 保存</button>' +
          '</div>' +
        '</div></td></tr>';
    }

    // ====== 内联平仓面板 ======
    if (openClosePanelIdx === realIdx) {
      html += '<tr class="close-panel-row" data-close-panel="' + realIdx + '"><td colspan="9">' +
        '<div class="close-panel">' +
          '<div class="fp">' +
            '<label>平仓类型 <span style="color:var(--color-danger);margin-left:2px">*</span></label>' +
            '<select id="cpCloseType_' + realIdx + '">' +
              '<option value="">— 请选择 —</option>' +
              '<option value="initialSL">初始止损 — 自动填入止损价</option>' +
              '<option value="trailingSL">追踪止损</option>' +
              '<option value="initialTP">初始止盈</option>' +
              '<option value="manualWin">现价手平赢</option>' +
              '<option value="manualLoss">现价手平损</option>' +
              '<option value="liquidation">强平/爆仓</option>' +
              '<option value="partialTP">部分止盈</option>' +
              '<option value="timeStop">时间止损</option>' +
              '<option value="reducePosition">减仓</option>' +
            '</select>' +
          '</div>' +
          '<div class="fp">' +
            '<label>平仓价格 <span style="color:var(--color-danger);margin-left:2px">*</span></label>' +
            '<input type="number" id="cpClosePrice_' + realIdx + '" step="0.01" placeholder="价格" />' +
          '</div>' +
          '<div class="fp readonly">' +
            '<label>盈亏金额 (USDT)</label>' +
            '<input type="text" id="cpPnlAmount_' + realIdx + '" readonly placeholder="自动计算" />' +
          '</div>' +
          '<div class="fp readonly">' +
            '<label>盈亏百分比 <span style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（保证金回报率）</span></label>' +
            '<input type="text" id="cpPnlPercent_' + realIdx + '" readonly placeholder="自动计算" />' +
          '</div>' +
          '<div class="fp readonly">' +
            '<label>R 倍数</label>' +
            '<input type="text" id="cpRMultiple_' + realIdx + '" readonly placeholder="自动计算" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>手续费 (USDT)</label>' +
            '<input type="text" id="cpFee_' + realIdx + '" readonly placeholder="从日志读取" value="' + (item.fee != null ? item.fee : '') + '" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>滑点成本 (USDT)</label>' +
            '<input type="text" id="cpSlippage_' + realIdx + '" readonly placeholder="从日志读取" value="' + (item.slippageCost != null ? item.slippageCost : '') + '" />' +
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
            '<textarea id="cpCloseNote_' + realIdx + '" placeholder="平仓总结、教训等...">' + esc(item.closeNote || '') + '</textarea>' +
          '</div>' +
          '<div class="fp span-2" style="padding-top:4px;border-top:1px solid var(--color-border-light);">' +
            '<label>执行评分（0-3）<span id="cpExecScore_' + realIdx + '" style="margin-left:8px;font-weight:700;font-size:15px;color:var(--color-text-muted);">0</span></label>' +
            '<div class="checkbox-group" style="padding-top:2px;" id="cpExecChecks_' + realIdx + '">' +
              '<label style="color:var(--color-text);"><input type="checkbox" value="planEntry" /> 按计划入场</label>' +
              '<label style="color:var(--color-text);"><input type="checkbox" value="stopLossIntact" /> 止损未被移动/破坏</label>' +
              '<label style="color:var(--color-text);"><input type="checkbox" value="planExit" /> 按计划减仓/平仓</label>' +
            '</div>' +
          '</div>' +
          '<div class="fp span-2" style="padding-top:4px;border-top:1px solid var(--color-border-light);">' +
            '<label>持仓期间极值价格<span class="optional-tag" style="font-size:11px;color:var(--color-text-muted);font-weight:400;">（选填）</span></label>' +
            '<span class="field-tip" style="display:block;margin-bottom:6px;">填入持仓期间触及的极值价格，系统自动计算偏离百分比</span>' +
          '</div>' +
          '<div class="fp">' +
            '<label>最低价</label>' +
            '<input type="number" id="cpLowPrice_' + realIdx + '" step="0.01" placeholder="' + (item.entryPrice || '入场价') + '" value="' + (item.lowPrice != null ? item.lowPrice : '') + '" />' +
          '</div>' +
          '<div class="fp">' +
            '<label>最高价</label>' +
            '<input type="number" id="cpHighPrice_' + realIdx + '" step="0.01" placeholder="' + (item.entryPrice || '入场价') + '" value="' + (item.highPrice != null ? item.highPrice : '') + '" />' +
          '</div>' +
          '<div class="fp span-2" id="cpMAEMFEDisplay_' + realIdx + '" style="display:none;background:var(--color-surface);border-radius:var(--radius-md);padding:8px 12px;font-size:13px;line-height:1.6;">' +
          '</div>' +
          '<div class="fp span-2" id="cpMAEMFEInterpret_' + realIdx + '" style="display:none;font-size:12px;color:var(--color-text-secondary);line-height:1.5;">' +
          '</div>' +
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
            '<button class="btn btn-success btn-sm" data-action="cp-confirm" data-idx="' + realIdx + '"><i class="fas fa-check"></i> 确认平仓</button>' +
            '<button class="btn btn-outline btn-sm" data-action="cp-cancel" data-idx="' + realIdx + '"><i class="fas fa-times"></i> 取消</button>' +
          '</div>' +
        '</div>' +
      '</td></tr>';
    }
  }

  return html;
}

// ==================== 事件委托（一次性绑定，避免重复 addEventListener） ====================
function bindTbodyEvents() {
  var tbody = document.getElementById('logBody');
  if (!tbody || tbody._delegated) return;
  tbody._delegated = true;

  // 统一点击事件委托
  tbody.addEventListener('click', function(e) {
    var delegate = e.target.closest('[data-action]');
    if (!delegate) return;
    e.stopPropagation();

    var idx = parseInt(delegate.dataset.idx, 10);
    var batchIdx = parseInt(delegate.dataset.batchIdx, 10);
    var resolvedIdx = !isNaN(idx) ? idx : (!isNaN(batchIdx) ? batchIdx : -1);
    if (resolvedIdx < 0) return;

    var action = delegate.dataset.action;
    switch (action) {
      case 'expand':
        if (_expandedRows.has(resolvedIdx)) _expandedRows.delete(resolvedIdx);
        else _expandedRows.add(resolvedIdx);
        renderLogs();
        break;
      case 'close':
        openClosePanelIdx = (openClosePanelIdx === resolvedIdx) ? -1 : resolvedIdx;
        actionPanelIdx = -1;
        if (openClosePanelIdx === -1) delete _closePriceEdited[resolvedIdx];
        renderLogs();
        break;
      case 'action-record':
        actionPanelIdx = (actionPanelIdx === resolvedIdx) ? -1 : resolvedIdx;
        openClosePanelIdx = -1;
        renderLogs();
        if (actionPanelIdx === resolvedIdx) {
          setTimeout(function() {
            var timeEl = document.getElementById('actTime_' + resolvedIdx);
            if (timeEl) {
              var now = new Date();
              timeEl.value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + 'T' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
            }
          }, 50);
        }
        break;
      case 'action-save':
        if (typeof saveTradeAction === 'function') saveTradeAction(resolvedIdx);
        break;
      case 'action-cancel':
        actionPanelIdx = -1;
        renderLogs();
        break;
      case 'edit':
        openEditModal(resolvedIdx);
        break;
      case 'delete':
        handleDeleteClick(resolvedIdx);
        break;
      case 'batch-check':
        handleBatchCheck(resolvedIdx, delegate.checked);
        break;
      case 'cp-confirm':
        confirmClose(resolvedIdx);
        break;
      case 'cp-cancel':
        delete _closePriceEdited[resolvedIdx];
        openClosePanelIdx = -1;
        renderLogs();
        break;
    }
  });

  // 统一 input 事件委托（平仓面板价格输入、MAE/MFE 极值输入）
  tbody.addEventListener('input', function(e) {
    var id = e.target.id || '';
    var cpMatch = id.match(/^cpClosePrice_(\d+)$/);
    if (cpMatch) {
      var idx = parseInt(cpMatch[1]);
      _closePriceEdited[idx] = true;
      calcClosePnL(idx);
      return;
    }
    var maeMatch = id.match(/^(cpLowPrice|cpHighPrice)_(\d+)$/);
    if (maeMatch) {
      calcMAEMFE(parseInt(maeMatch[2]));
    }
  });

  // 统一 change 事件委托（平仓类型切换、执行评分复选框）
  tbody.addEventListener('change', function(e) {
    var id = e.target.id || '';
    var cpTypeMatch = id.match(/^cpCloseType_(\d+)$/);
    if (cpTypeMatch) {
      var idx = parseInt(cpTypeMatch[1]);
      var item = logs[idx];
      if (item && e.target.value === 'initialSL' && !_closePriceEdited[idx]) {
        var cpPriceEl = document.getElementById('cpClosePrice_' + idx);
        if (item.stopLoss != null && item.stopLoss !== '' && cpPriceEl) {
          cpPriceEl.value = item.stopLoss;
          cpPriceEl.select();
        }
      }
      calcClosePnL(idx);
      return;
    }
    // 执行评分复选框变化
    if (e.target.type === 'checkbox' && e.target.closest) {
      var container = e.target.closest('[id^="cpExecChecks_"]');
      if (container) {
        var cidx = parseInt(container.id.replace('cpExecChecks_', ''));
        if (!isNaN(cidx)) cpUpdateExecScore(cidx);
      }
    }
  });
}

// 删除操作（从 renderLogs 中提取，供事件委托调用）
function handleDeleteClick(idx) {
  var item = logs[idx];
  if (!item) return;
  var msg = '确定删除 ' + (item.symbol || '') + ' ' + (item.direction === 'long' ? '做多' : '做空') + ' 这笔日志？';
  if (!confirm(msg)) return;
  if (!confirm('⚠️ 再次确认：删除后将无法恢复，确定继续？')) return;

  if (_pendingDelete) {
    if (window._undoToastTimer) { clearTimeout(window._undoToastTimer); window._undoToastTimer = null; }
    _commitPendingDelete();
  }
  _pendingDelete = { idx: idx, timeoutId: null };
  if (!window._pendingDeleteIndices) window._pendingDeleteIndices = new Set();
  window._pendingDeleteIndices.add(idx);
  showUndoToast('已删除，点击撤销（5秒）', function() {
    window._pendingDeleteIndices.delete(idx);
    _pendingDelete = null;
    renderLogs();
  }, function() {
    _commitPendingDelete();
  }, 5000);
}

// ==================== 状态恢复（每次渲染后调用） ====================
function restoreAfterRender() {
  // 1. 恢复执行评分复选框状态
  for (var i = 0; i < logs.length; i++) {
    var item = logs[i];
    var container = document.getElementById('cpExecChecks_' + i);
    if (!container || item.executionScore == null) continue;
    var checks = container.querySelectorAll('input[type="checkbox"]');
    for (var j = 0; j < checks.length; j++) {
      checks[j].checked = j < item.executionScore;
    }
    cpUpdateExecScore(i);
  }

  // 2. 恢复 MAE/MFE 显示
  for (var k = 0; k < logs.length; k++) {
    var l = logs[k];
    if (l.lowPrice != null || l.highPrice != null) {
      calcMAEMFE(k);
    }
  }

  // 3. 恢复批量复选框勾选状态
  document.querySelectorAll('.batch-checkbox[data-batch-idx]').forEach(function(cb) {
    var bidx = parseInt(cb.dataset.batchIdx, 10);
    cb.checked = _selectedIndices.has(bidx);
  });

  // 4. 平仓面板自动聚焦
  if (openClosePanelIdx >= 0) {
    var cpEl = document.getElementById('cpClosePrice_' + openClosePanelIdx);
    if (cpEl) {
      setTimeout(function(el) { if (el) el.focus(); }(cpEl), 80);
    }
  }

  // 5. 重建键盘快捷键 handler
  if (_closePanelKeyHandler) {
    document.removeEventListener('keydown', _closePanelKeyHandler);
  }
  _closePanelKeyHandler = createClosePanelKeyDownHandler();
  document.addEventListener('keydown', _closePanelKeyHandler);
}

// ==================== 主渲染函数（编排器） ====================
function renderLogs() {
  var tbody = document.getElementById('logBody');

  // 延迟绑定事件委托（首次调用时绑定一次）
  if (!_tbodyEventsBound) {
    bindTbodyEvents();
    _tbodyEventsBound = true;
  }

  // 1. 构建显示列表（排除待删除）
  var pendingDelete = window._pendingDeleteIndices || new Set();
  var dl = [];
  for (var i = 0; i < logs.length; i++) {
    if (!pendingDelete.has(i)) dl.push({item: logs[i], origIdx: i});
  }

  // 2. 按时间从新到旧排序
  dl.sort(function(a, b) {
    var timeA = a.item.time ? new Date(a.item.time).getTime() : 0;
    var timeB = b.item.time ? new Date(b.item.time).getTime() : 0;
    return timeB - timeA;
  });

  // 3. 过滤
  dl = filterEntries(dl);

  var visibleCount = dl.length;
  document.getElementById('logCount').textContent = '共 ' + visibleCount + ' 条';

  // 4. 更新过滤结果标签
  var fr = document.getElementById('filterResult');
  if (fr) {
    var hasAnyFilter = !!( _activeFilters.direction || _activeFilters.symbol || _activeFilters.strategy ||
                           _activeFilters.status || _activeFilters.pnl || _activeFilters.time );
    fr.textContent = hasAnyFilter ? '\u5f53\u524d\u7b5b\u9009\u7ed3\u679c ' + visibleCount + ' \u6761' : '\u5168\u90e8 ' + visibleCount + ' \u6761';
  }

  // 5. 批量模式 class
  var tw = document.getElementById('tableWrap');
  if (tw) tw.classList.toggle('batch-mode', _batchMode);

  // 6. 空状态处理
  if (visibleCount === 0) {
    var emptyMsg = logs.length === 0
      ? '填写上方计算器，点击「保存日志」开始'
      : '当前筛选条件无匹配，试试清除过滤';
    var emptyTitle = logs.length === 0 ? '暂无交易记录' : '无匹配结果';
    tbody.innerHTML = '<tr><td colspan="9" class="empty"><div class="empty-icon"><i class="fas fa-chart-bar"></i></div><div class="empty-title">' + emptyTitle + '</div><div class="empty-sub">' + emptyMsg + '</div></td></tr>';
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

  // 7. 构建并设置 HTML
  var html = buildRowsHTML(dl);
  tbody.innerHTML = html;

  // 8. 恢复动态状态
  restoreAfterRender();

  // 9. 触发统计更新（仅在需要的视图）
  if (_currentView === 'journal' || _currentView === 'stats') {
    try { updateStats(); } catch(e) { console.error('[renderLogs] updateStats error:', e); }
  }
  autoCountLossStreak();
  populateFilterOptions();
}