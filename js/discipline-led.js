// ==================== 纪律 LED 滚动屏 ====================
//
// 开仓计划视图顶部的满宽提示条，替代原单句静态提醒条。两轨就是全部 34 条：
// A 轨放 A 组 14 条、B 轨放 B 组 20 条，所以**没有**第三个逐行滚动面板——那会
// 把同一批 34 条原文再重复播一遍。
//
//   · 上轨 A 向左、下轨 B 向右（反向），内容各复制 LED_COPY 份做
//     translateX(-50%) 无缝循环；间距必须放在 .led-item 自身的 padding-right 上
//     （不能放在 flex 容器 gap 上），否则总宽 = 2w + gap，-50% 会偏移半格
//
// 全部为 transform 动画（合成器友好）。切离开仓计划视图或收起时用
// animation-play-state: paused 停在当前位置——移除/替换 animation 会从 0 重启。
//
// 数据是唯一事实来源：34 条文案只在这里定义一次，index.html 里只有空壳容器。
// 动画时长由本模块测量后注入 CSS 变量，CSS 不写死条数。

// ── 文案（唯一事实来源，一字不改） ──
var LED_RULES = Object.freeze({
  A: Object.freeze([
    '没有明确止损，不交易。',
    '单笔风险超过计划上限，不交易。',
    '三个独立理由不足，不交易。',
    '看不懂行情，不交易。',
    '错过最佳入场，不追。',
    '止损之后，不报复交易。',
    '连续盈利，不增加风险。',
    '连续亏损，不急于翻本。',
    '没有优势，空仓就是优势。',
    '先定义风险，再考虑收益。',
    '不要预测市场，等待市场给出信号。',
    '保护本金，比抓住下一次机会重要。',
    '一笔交易的结果不重要，100笔交易后的期望值才重要。',
    '你的工作不是预测每一次行情，而是执行有优势的交易。'
  ]),
  B: Object.freeze([
    '不要只寻找支持你观点的证据，也要寻找证明你错了的证据。',
    '你的入场价不是市场价值，成本价不能决定下一步。',
    '已经亏了多少，不应该决定接下来还亏多少。',
    '如果现在没有仓位，你还会在这里开仓吗？',
    '连续盈利不代表你找到了圣杯。',
    '连续亏损也不代表下一笔“该赢了”。',
    '赚钱不一定代表决策正确，亏钱也不一定代表决策错误。',
    '行情走出来以后，任何走势都看起来很明显。',
    '不要用结果修改记忆，用当时的信息评价当时的决定。',
    '一个成功案例不能证明一个策略有效。',
    '你看到的是成功交易者，没看到的是被市场淘汰的人。',
    '不要因为价格已经涨很多，就认为它不能继续涨。',
    '不要因为价格已经跌很多，就认为它不能继续跌。',
    '害怕错过行情，本身不是开仓理由。',
    '没赶上的行情不是你的亏损。',
    '刚止损，不要急着把钱赢回来。',
    '下一笔交易不是上一笔交易的复仇。',
    '没有交易机会也是一种交易结果：保持空仓。',
    '更多指标不一定带来更多优势，可能只是更多噪音。',
    '你的第一目标不是赚钱，而是避免一次不可逆的错误。'
  ])
});

// ── 常量 ──
var LED_COLLAPSED_KEY = 'user_discipline_led_collapsed_v1';  // 沿用 user_theme_v1 的 UI 偏好命名
var LED_SPEED_A = 44;     // A 轨 px/s
var LED_SPEED_B = 52;     // B 轨 px/s —— 故意不同速，两轨不同相位
var LED_COPY = 2;         // 轨道内重复份数（-50% 无缝循环的前提，必须为偶数）
var LED_FALLBACK_CJK_W = 1.0;     // 兜底测量：CJK/全角标点 ≈ 1 字宽
var LED_FALLBACK_LATIN_W = 0.56;  // 兜底测量：Latin/数字 ≈ 0.56 字宽
var LED_MIN_COPY_WIDTH = 1600;    // 兜底测量的下限，避免算出 0 或负数

// ── 模块状态 ──
var _collapsed = false;

/**
 * 纪律 LED 滚动屏控制器
 *
 * 只暴露 rules/all/measure/renderAll/applyActive/applyCollapsed/
 * toggleCollapsed/init —— 其余为闭包私有。测试页无 #disciplineLed 时
 * init() 直接 no-op，零副作用。
 */
var DisciplineLed = (function() {
  function wall() {
    return document.getElementById('disciplineLed');
  }

  function rules() {
    return { A: LED_RULES.A.slice(), B: LED_RULES.B.slice() };
  }

  // A 组 + B 组的全量顺序：两轨各自播一组，此处的合并只作为数据契约暴露给
  // 测试页断言条数/顺序/完整性（test/run-tests.html），生产侧不再消费它。
  function all() {
    return LED_RULES.A.concat(LED_RULES.B);
  }

  /**
   * 读取 .led-item 的真实字号与项间距，供兜底宽度公式使用。
   * 间距与字号都从 CSS 反读，不在 JS 里重复写死 36px / 13px。
   */
  function itemMetrics() {
    var item = wall() ? wall().querySelector('.led-item') : null;
    var fontSize = 13;
    var gap = 0;
    if (item && window.getComputedStyle) {
      var cs = window.getComputedStyle(item);
      var fs = parseFloat(cs.fontSize);
      var pr = parseFloat(cs.paddingRight);
      if (fs > 0) fontSize = fs;
      if (pr > 0) gap = pr;
    }
    return { fontSize: fontSize, gap: gap };
  }

  /**
   * 兜底单份宽度：真实布局量不出（未渲染 / display:none / jsdom）时用字数估。
   * 这是纯函数，便于在测试页断言「测不出来时仍返回正数」。
   */
  function fallbackCopyWidth(texts, fontSize, gap) {
    var width = 0;
    for (var i = 0; i < texts.length; i++) {
      var text = texts[i] || '';
      var chars = 0;
      for (var c = 0; c < text.length; c++) {
        // U+2E80 起为 CJK 部首/标点与汉字区（含 。，「」：、“”）
        chars += (text.charCodeAt(c) >= 0x2E80) ? LED_FALLBACK_CJK_W : LED_FALLBACK_LATIN_W;
      }
      width += chars * fontSize + gap;
    }
    return width > 0 ? width : LED_MIN_COPY_WIDTH;
  }

  /**
   * 单份副本宽度 = 滚动一个循环所需距离（px）。
   * @param {HTMLElement|null} innerEl 横滚轨道内层
   * @param {string[]} texts 该轨文案
   */
  function measure(innerEl, texts) {
    var real = (innerEl && innerEl.scrollWidth) ? (innerEl.scrollWidth / LED_COPY) : 0;
    if (real > 0) return real;
    var m = itemMetrics();
    return fallbackCopyWidth(texts, m.fontSize, m.gap);
  }

  function esc(text) {
    return String(text);
  }

  function makeItem(text) {
    var el = document.createElement('span');
    el.className = 'led-item';
    el.textContent = esc(text);  // 文案含「，”「」：」等标点，一律走 textContent
    return el;
  }

  /**
   * 构建一条横滚轨道：LED_COPY 份副本，间距落在 .led-item 的 padding-right 上
   * （CSS 负责），容器不得有 gap——否则 -50% 偏移半格，循环点跳帧。
   */
  function buildTrack(innerEl, texts) {
    innerEl.textContent = '';
    for (var c = 0; c < LED_COPY; c++) {
      for (var i = 0; i < texts.length; i++) {
        innerEl.appendChild(makeItem(texts[i]));
      }
    }
    return innerEl;
  }

  function renderAll() {
    var host = wall();
    if (!host) return false;

    var trackA = document.getElementById('ledTrackA');
    var trackB = document.getElementById('ledTrackB');
    if (!trackA || !trackB) return false;

    buildTrack(trackA, LED_RULES.A);
    buildTrack(trackB, LED_RULES.B);

    // 时长由测量结果注入 —— CSS 只消费变量，不写死条数
    var css = host.style;
    css.setProperty('--led-track-dur-a', (measure(trackA, LED_RULES.A) / LED_SPEED_A).toFixed(2) + 's');
    css.setProperty('--led-track-dur-b', (measure(trackB, LED_RULES.B) / LED_SPEED_B).toFixed(2) + 's');
    return true;
  }

  function applyActive(active) {
    // 单一事实来源：折叠时一律暂停 —— 面板此时是 max-height:0 的不可见容器，
    // 动画在空容器里跑只白耗合成器。判定收口在这一处，新增调用点不会漏掉它。
    // （P1 修复：此前只按「当前视图」判断，于是「在非开仓计划视图上收起 →
    //   切回开仓计划」会把 data-active 重新置 true，收起态下面板却在滚动。）
    var host = wall();
    if (host) host.setAttribute('data-active', (active && !_collapsed) ? 'true' : 'false');
  }

  function applyCollapsed(collapsed) {
    _collapsed = collapsed ? true : false;
    var host = wall();
    if (host) host.setAttribute('data-collapsed', collapsed ? 'true' : 'false');

    var btn = document.getElementById('ledWallToggle');
    var label = document.getElementById('ledWallToggleLabel');
    var icon = btn ? btn.querySelector('.led-wall-chevron') : null;
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', collapsed ? '展开纪律提示' : '收起纪律提示');
    }
    if (label) label.textContent = collapsed ? '展开' : '收起';
    if (icon) icon.className = 'fas ' + (collapsed ? 'fa-chevron-down' : 'fa-chevron-up') + ' led-wall-chevron';

    // 折叠时一律暂停：即使仍停在开仓计划视图，也不让内容在不可见区域空转
    // （判定收口在 applyActive，此处只需表达「视图维度允许播放」）
    applyActive(!collapsed);
  }

  function toggleCollapsed() {
    applyCollapsed(!_collapsed);
    try {
      localStorage.setItem(LED_COLLAPSED_KEY, _collapsed ? '1' : '0');
    } catch (e) {
      console.warn('[DisciplineLed] 折叠状态保存失败:', e);
    }
  }

  function readCollapsed() {
    try {
      return localStorage.getItem(LED_COLLAPSED_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function init() {
    var host = wall();
    if (!host) return;

    renderAll();

    var btn = document.getElementById('ledWallToggle');
    if (btn) btn.addEventListener('click', toggleCollapsed);

    // viewchange 接缝：切离开仓计划即暂停。监听注册后立刻同步一次当前视图，
    // 覆盖「首条 viewchange 早于本监听」的竞态（脚本顺序无关）。
    window.addEventListener('viewchange', function(e) {
      if (e && e.detail) applyActive(e.detail.view === 'planner');
    });
    // getCurrentView 由 navigation.js 提供；未就绪时默认视为在开仓计划视图
    var getView = (typeof getCurrentView === 'function') ? getCurrentView : null;
    applyActive(getView ? getView() === 'planner' : true);

    // 先渲染测量，再应用持久化折叠态 —— 折叠后测量不可靠
    applyCollapsed(readCollapsed());
  }

  return {
    rules: rules,
    all: all,
    measure: measure,
    fallbackCopyWidth: fallbackCopyWidth,
    renderAll: renderAll,
    applyActive: applyActive,
    applyCollapsed: applyCollapsed,
    toggleCollapsed: toggleCollapsed,
    init: init
  };
})();

window.LED_RULES = LED_RULES;
window.DisciplineLed = DisciplineLed;

// 自动初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', DisciplineLed.init);
} else {
  DisciplineLed.init();
}
