/**
 * 通用渲染工具模块
 * 提取重复的 UI 生成逻辑，减少代码重复
 */

/**
 * 渲染仪表盘卡片
 * 
 * @param {string} title - 卡片标题
 * @param {string|number} value - 主要数值
 * @param {string} [sub] - 副标题/说明
 * @param {string} [className=''] - 额外 CSS 类名
 * @returns {string} HTML 字符串
 */
function renderDashCard(title, value, sub, className = '') {
  const subHTML = sub ? `<div class="dash-card-sub">${sub}</div>` : '';
  return `
    <div class="dash-card${className ? ' ' + className : ''}">
      <div class="dash-card-title">${title}</div>
      <div class="dash-card-value">${value}</div>
      ${subHTML}
    </div>
  `;
}

/**
 * 渲染结果卡片（计算器结果区域）
 * 
 * @param {string} label - 标签
 * @param {string|number} value - 值
 * @param {string} [sub] - 副标题
 * @param {string} [className=''] - 额外 CSS 类名
 * @returns {string} HTML 字符串
 */
function renderResultCard(label, value, sub = '', className = '') {
  const subHTML = sub ? `<div class="result-card-sub">${sub}</div>` : '';
  return `
    <div class="result-card ${className}">
      <div class="result-card-label">${label}</div>
      <div class="result-card-value">${value}</div>
      ${subHTML}
    </div>
  `;
}

/**
 * 渲染统计表格行
 * 
 * @param {string} label - 标签
 * @param {string|number} value - 值
 * @param {string} [className=''] - 额外 CSS 类名
 * @returns {string} HTML 字符串
 */
function renderStatRow(label, value, className = '') {
  return `
    <div class="stat-item ${className}">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    </div>
  `;
}

/**
 * 渲染日志表格行
 * 
 * @param {TradeLog} log - 交易日志对象
 * @param {number} index - 行索引
 * @returns {string} HTML 字符串
 */
function renderLogRow(log, index) {
  const date = log.openTime ? new Date(log.openTime).toLocaleDateString('zh-CN') : '—';
  const pnlClass = log.pnlAmount > 0 ? 'profit' : (log.pnlAmount < 0 ? 'loss' : '');
  const pnlText = log.pnlAmount != null 
    ? (log.pnlAmount > 0 ? '+' : '') + log.pnlAmount.toFixed(2)
    : '—';
  
  return `
    <tr data-id="${log.id}">
      <td>${date}</td>
      <td>${log.symbol || '—'}</td>
      <td>${log.direction === 'long' ? '做多' : '做空'}</td>
      <td>${log.entryPrice || '—'}</td>
      <td>${log.stopLoss || '—'}</td>
      <td>${log.positionSize ? log.positionSize.toFixed(2) : '—'}</td>
      <td>${log.leverage || '—'}x</td>
      <td class="${pnlClass}">${pnlText}</td>
      <td>
        <button onclick="openClosePanel(${index})">平仓</button>
        <button onclick="editLog('${log.id}')">编辑</button>
      </td>
    </tr>
  `;
}

/**
 * 渲染空状态提示
 * 
 * @param {string} message - 提示信息
 * @param {string} [icon=''] - 图标（Font Awesome class）
 * @returns {string} HTML 字符串
 */
function renderEmptyState(message, icon = '') {
  const iconHTML = icon ? `<i class="fas ${icon}"></i> ` : '';
  return `
    <div class="empty-state">
      <div class="empty-icon">${iconHTML}</div>
      <div class="empty-message">${message}</div>
    </div>
  `;
}

/**
 * 渲染警告标签
 * 
 * @param {string} message - 警告信息
 * @param {string} [type='warn'] - 类型 (warn/error/success)
 * @returns {string} HTML 字符串
 */
function renderWarning(message, type = 'warn') {
  const iconMap = {
    warn: 'fa-exclamation-triangle',
    error: 'fa-times-circle',
    success: 'fa-check-circle'
  };
  const icon = iconMap[type] || iconMap.warn;
  
  return `
    <div class="warning-tag ${type}">
      <i class="fas ${icon}"></i> ${message}
    </div>
  `;
}

/**
 * 渲染批量操作按钮
 * 
 * @param {string} text - 按钮文字
 * @param {string} icon - 图标类名
 * @param {string} onClick - 点击事件
 * @param {string} [className=''] - 额外类名
 * @returns {string} HTML 字符串
 */
function renderBatchButton(text, icon, onClick, className = '') {
  return `
    <button class="btn btn-sm ${className}" onclick="${onClick}">
      <i class="fas ${icon}"></i> ${text}
    </button>
  `;
}

// 导出（如果使用 ES Modules）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderDashCard,
    renderResultCard,
    renderStatRow,
    renderLogRow,
    renderEmptyState,
    renderWarning,
    renderBatchButton
  };
}
