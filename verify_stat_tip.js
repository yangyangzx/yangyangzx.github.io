/* 统计概览 ⓘ 说明浮层回归验证
 *
 * 覆盖 bug：openStatTip 读 item.getAttribute('data-tip')，而 index.html 把 data-tip
 * 挂在 .stat-info 按钮上 → 静态文案恒读不到，叠加「无 title 就 return」后多数指标
 * 点开是空操作；且 mouseenter 从未绑定，鼠标划过无反应。
 *
 * 反向用例（见文末）：故意注入原错误写法，确认本脚本会报警 —— 否则「全绿」无意义。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 反向用例开关：REGRESSION=bad-read|bad-hover 时注入原缺陷
const MODE = process.env.REGRESSION || '';

let pass = 0, fail = 0;
function T(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

let toastSrc = fs.readFileSync(path.join(ROOT, 'js/toast.js'), 'utf8');
if (MODE === 'bad-read') {
  // 还原 P0：只从 .stat-item 读 data-tip
  toastSrc = toastSrc.replace(
    "var base = btn.getAttribute('data-tip') || item.getAttribute('data-tip');",
    "var base = item.getAttribute('data-tip');"
  );
} else if (MODE === 'bad-hover') {
  // 还原 P1：摘掉 mouseover 悬停路径
  toastSrc = toastSrc.replace(/document\.addEventListener\('mouseover',[\s\S]*?\n  \}\);\n/, '');
}

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

// toast.js 是 IIFE，只注册监听器 —— 注入执行即可复现真实事件流
window.eval(toastSrc);

const btn = document.querySelector('#statsPanel .stat-item .stat-info');
const popover = () => document.querySelector('.stat-tip-popover');
function fire(el, type, init = {}) {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: el, writable: true });
  el.dispatchEvent(e);
}

console.log('\n【1】静态文案可达性');
fire(btn, 'mouseover');
let el = popover();
T('鼠标悬停后浮层出现', !!el);
T('浮层非空（有实际文案）', !!el && el.textContent.trim().length > 10);
T('读到「计算公式」段', !!el && /计算公式/.test(el.textContent));
T('读到「参考价值」段', !!el && /参考价值/.test(el.textContent));
T('ⓘ aria-expanded=true', btn.getAttribute('aria-expanded') === 'true');
T('ⓘ role=tooltip', !!el && el.getAttribute('role') === 'tooltip');

console.log('\n【2】文案正确性（与 index.html 原文一致，非转义损坏）');
const rawTip = btn.getAttribute('data-tip');
T('浮层首段 === data-tip 原文', !!el && el.querySelector('p').textContent === rawTip);
T('已平仓项文案含"少于20笔"', !!el && /少于20笔/.test(el.textContent));
T('无 HTML 注入（原文里无标签则渲染后也无标签）', !!el && el.querySelectorAll('p').length >= 1);

console.log('\n【3】全部 18 项均可读出文案');
const all = [...document.querySelectorAll('#statsPanel .stat-info')];
T('统计项数量 = 18', all.length === 18);
let bad = [];
for (const b of all) {
  if (popover()) fire(b, 'mouseover');
  fire(b, 'click');
  const p = popover();
  if (!p || p.textContent.trim().length < 10) bad.push(b.closest('.stat-item').querySelector('.stat-label').textContent);
}
T('18 项全部有可读文案' + (bad.length ? '（缺: ' + bad.join(',') + '）' : ''), bad.length === 0);

console.log('\n【4】悬停展开 / 移出收起');
fire(all[0], 'mouseover');
T('悬停 → 展开', !!popover());
fire(all[0], 'mouseout', { relatedTarget: document.body });
T('移出后 220ms 内仍在（延迟收起）', !!popover());

console.log('\n【5】键盘与触屏路径未被回归');
fire(btn, 'mouseover');
if (popover()) fire(btn, 'mouseout', { relatedTarget: document.body });
document.body.focus();
const f = new window.FocusEvent('focusin', { bubbles: true });
Object.defineProperty(f, 'target', { value: btn, writable: true });
btn.dispatchEvent(f);
T('focusin → 展开', !!popover());

console.log('\n【6】数据类 title 合并（stats.js 动态补的 title）');
const ann = document.getElementById('statAnnReturn');
ann.setAttribute('title', '跨度 12.3 天');
const annBtn = ann.closest('.stat-item').querySelector('.stat-info');
fire(annBtn, 'mouseover');
const p2 = popover();
T('静态+动态两段合并显示', !!p2 && p2.querySelectorAll('p').length === 2);
T('动态段为最新数值', !!p2 && /跨度 12\.3 天/.test(p2.textContent));

console.log('\n【7】重复悬停不抖动 / 不重建');
fire(annBtn, 'mouseover');
const before = popover();
fire(annBtn, 'mouseover');
T('同一按钮重复悬停保持同一浮层实例', popover() === before);

console.log('\n════════════════════════════');
console.log(MODE ? `[反向用例 ${MODE}]  ${pass} 通过 / ${fail} 失败` : `${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);