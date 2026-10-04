/*
 * 计算结果视图和开仓硬阻断（P0-01）
 *
 * 该模块只处理 UI 与状态呈现，不包含仓位或风控公式。
 * 调用 calculate() 的第一行即应调用 getResultUI()，在任意校验前完成 DOM 获取。
 */
(function attachCalculationUI(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CalculationUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createCalculationUI() {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  // 盈亏比对照图 + 保证金占用图由 calc-visuals.js 维护。计算失败或硬阻断时结果区
  // 会被换成阻断文案，两张图必须一起收起，否则上一轮的 R:R 与保证金比例会继续
  // 挂在面板上，读者会拿旧数值做新决策。用 window.CalcVisuals 而非裸标识符，
  // 与仓库跨模块调用约定一致（calc-visuals.js 在 calculation-ui.js 之前加载）。
  function hideCalcVisuals() {
    if (window.CalcVisuals && typeof window.CalcVisuals.hide === 'function') {
      window.CalcVisuals.hide();
    }
  }

  function getResultUI() {
    return {
      resultBox: byId('resultBox'),
      calcBtn: byId('calcBtn'),
      saveBtn: byId('saveBtn'),
      splitSaveBtn: byId('splitSaveBtn'),
      position: byId('positionDisplay'),
      margin: byId('marginDisplay'),
      leverage: byId('leverageDisplay'),
      rr: byId('rrDisplay'),
      cardRR: byId('cardRR'),
      cardMargin: byId('cardMargin'),
      targetDistance: byId('targetDistDisplay'),
      costLine1: byId('costLine1'),
      costLine2: byId('costLine2'),
      triggerRow: byId('triggerRow'),
      splitArea: byId('resultSplitArea'),
      warning: byId('warningDisplay'),
      kellyCard: byId('kellyCard'),
      riskHint: byId('riskHint')
    };
  }

  function setText(node, text) {
    if (node) node.textContent = (text === null || text === undefined) ? '' : String(text);
  }

  function setHidden(node, hidden) {
    if (node) node.style.display = hidden ? 'none' : '';
  }

  function setButtonState(node, options) {
    if (!node) return;
    var blocked = !!options.blocked;
    node.disabled = !!options.disabled;
    node.classList.toggle('blocked', blocked);
    node.setAttribute('aria-disabled', node.disabled ? 'true' : 'false');
    node.replaceChildren();
    if (options.iconClass) {
      var icon = document.createElement('i');
      icon.className = options.iconClass;
      node.appendChild(icon);
      node.appendChild(document.createTextNode(' '));
    }
    node.appendChild(document.createTextNode(options.label));
  }

  function createWarningTag(severity, message) {
    var tag = document.createElement('span');
    tag.className = 'warning-tag ' + (severity === 'blocker' ? 'alert' : '');
    var icon = document.createElement('i');
    icon.className = severity === 'blocker' ? 'fas fa-ban' : 'fas fa-exclamation-triangle';
    tag.appendChild(icon);
    tag.appendChild(document.createTextNode(' ' + message));
    return tag;
  }

  /**
   * 所有硬阻断均走这里。它在任何风险计算之前可安全调用，
   * 因为 UI 引用已由 getResultUI() 提前建立。
   */
  function renderBlocker(ui, blocker) {
    if (!ui) throw new Error('必须先通过 getResultUI() 获取 UI 引用');
    blocker = blocker || {};
    hideCalcVisuals();
    var title = blocker.title || '禁止开仓';
    var detail = blocker.detail || '当前交易计划未通过开仓前风险控制。';

    setText(ui.position, title);
    setText(ui.margin, '—');
    setText(ui.leverage, '');
    setText(ui.rr, '— : 1');
    if (ui.cardRR) ui.cardRR.className = 'result-card rr-neutral';
    if (ui.cardMargin) ui.cardMargin.classList.remove('margin-danger');
    setHidden(ui.targetDistance, true);
    setText(ui.costLine1, detail);
    setText(ui.costLine2, '');
    setHidden(ui.triggerRow, true);
    setHidden(ui.splitArea, true);
    setHidden(ui.kellyCard, true);
    setText(ui.riskHint, '');

    if (ui.warning) {
      ui.warning.replaceChildren(createWarningTag('blocker', detail));
      ui.warning.dataset.blockerCode = blocker.code || 'unknown';
    }
    if (ui.resultBox) {
      ui.resultBox.classList.add('warn', 'is-blocked');
      ui.resultBox.setAttribute('aria-live', 'assertive');
    }

    setButtonState(ui.calcBtn, { blocked: true, disabled: false, iconClass: 'fas fa-ban', label: title });
    setButtonState(ui.saveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-save', label: '风险阻断，不能保存' });
    setButtonState(ui.splitSaveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-layer-group', label: '风险阻断，不能拆分保存' });
  }

  function renderValidationError(ui, title, detail) {
    renderBlocker(ui, { code: 'validation', title: title, detail: detail });
  }

  function resetForCalculation(ui) {
    if (!ui) throw new Error('必须先通过 getResultUI() 获取 UI 引用');
    // 每次重算开头都会走到这里：先收起上一次的图，_calculateImpl 成功时再重新填充
    hideCalcVisuals();
    if (ui.resultBox) {
      // 清除所有状态类：warn（有警告）/ is-blocked（硬阻断）/ is-dirty（参数已变更）/ is-provisional（临时止损）
      ui.resultBox.classList.remove('warn', 'is-blocked', 'is-dirty', 'is-provisional');
      ui.resultBox.setAttribute('aria-live', 'polite');
    }
    if (ui.warning) {
      ui.warning.replaceChildren();
      delete ui.warning.dataset.blockerCode;
    }
    setButtonState(ui.calcBtn, { blocked: false, disabled: false, iconClass: 'fas fa-sync-alt', label: '计算仓位' });
    setButtonState(ui.saveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-save', label: '请先完成计算' });
    setButtonState(ui.splitSaveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-layer-group', label: '请先完成计算' });
  }

  function renderCalculated(ui) {
    if (!ui) return;
    if (ui.resultBox) ui.resultBox.classList.remove('is-blocked', 'is-dirty');
    setButtonState(ui.calcBtn, { blocked: false, disabled: false, iconClass: 'fas fa-sync-alt', label: '重新计算仓位' });
    setButtonState(ui.saveBtn, { blocked: false, disabled: false, iconClass: 'fas fa-save', label: '保存日志' });
    setButtonState(ui.splitSaveBtn, { blocked: false, disabled: false, iconClass: 'fas fa-layer-group', label: '拆分保存' });
  }

  function renderDirty(ui) {
    if (!ui) return;
    if (ui.resultBox) ui.resultBox.classList.add('is-dirty');
    setButtonState(ui.calcBtn, { blocked: false, disabled: false, iconClass: 'fas fa-sync-alt', label: '参数已变更，重新计算' });
    setButtonState(ui.saveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-save', label: '请重新计算后保存' });
    setButtonState(ui.splitSaveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-layer-group', label: '请重新计算后拆分保存' });
  }

  function renderProvisionalStop(ui) {
    if (!ui) return;
    if (ui.resultBox) ui.resultBox.classList.add('is-provisional');
    setButtonState(ui.calcBtn, { blocked: false, disabled: false, iconClass: 'fas fa-sync-alt', label: '确认止损后重新计算' });
    setButtonState(ui.saveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-save', label: '确认止损后保存' });
    setButtonState(ui.splitSaveBtn, { blocked: false, disabled: true, iconClass: 'fas fa-layer-group', label: '确认止损后拆分保存' });
  }

  // 注：这里曾有 evaluateOpeningBlockers(checks)——一个把「检查顺序 + 阻断文案」
  // 收敛成单一可测试配置的规则表入口，但生产代码零调用：真实阻断链是 _calculateImpl
  // 内部按 IIFE 顺序执行的早返回序列（capital/leverage/heat/mindset/…），从未走它。
  // 留着一个从不被调用的「中央配置」入口会让维护者误以为阻断逻辑已经集中，
  // 于是改文案时只改规则表而实际不生效。已删（v5.6.7，grep 全库确认零调用点）。

  return {
    getResultUI: getResultUI,
    renderBlocker: renderBlocker,
    renderValidationError: renderValidationError,
    resetForCalculation: resetForCalculation,
    renderCalculated: renderCalculated,
    renderDirty: renderDirty,
    renderProvisionalStop: renderProvisionalStop
  };
});
