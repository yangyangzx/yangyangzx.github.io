'use strict';

// 侧栏柔光样式守护（v5.6.48）
//
// 背景：用户提供 Uiverse「12 光斑金黄 CTA」CSS，评估后选「改良版」——
//   保留 7 色相 / 凹槽立体 / 双主题 / 仅 active 播动画，只借「缓慢漂移的柔光」。
// 本跑测器静态守护这次设计决策的边界，防止后人把原版粗糙地套回 7 个导航按钮：
//   A 作用域：柔光动画只能挂 active / hover，不得全按钮常驻
//   B 颜色  ：柔光必须从 --nav-hue 派生；禁止原版四色硬编码；7 色相不得抹平
//   C 无障碍：reduced-motion 兜底必须真的覆盖 .nav-item 及其伪元素（不能只护 body）
//   D 结构  ：零新增 DOM；::before/::after 职责不被原版内阴影环顶掉
//   E 成本  ：无 8~16px 重模糊 / 无 mask 复合；layout.css 缓存戳与 APP_VERSION 一致
//
// 纪律：--inject 逐条独立注入「内存副本」，绝不改磁盘；每个注入点必须让对应组复红。
//   node test/verify_nav_glow.js            正常跑（18 条断言）
//   node test/verify_nav_glow.js --inject   12 个注入点必须 12/12 被捕获

const fs = require('fs');
const path = require('path');
const gate = require('./_gate');

const ROOT = path.join(__dirname, '..');
const INJECT = process.argv.includes('--inject');

function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }

function readInputs() {
  const css = stripComments(fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf8'));
  const html = stripComments(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'));
  return { css, html, ver: m ? m[1] : '' };
}

// 取所有最内层规则块。@media / @keyframes 的外层壳会被跳过，内层规则仍可拿到。
function ruleBlocks(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  return out;
}

// 花括号配平，取出所有 prefers-reduced-motion 媒体块的内部内容
function reducedMotionBodies(css) {
  const out = [];
  const re = /@media\s*\([^)]*prefers-reduced-motion[^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(m.index + m[0].length, i - 1));
  }
  return out.join('\n');
}

function runChecks(D) {
  const groups = { A: [], B: [], C: [], D: [], E: [] };
  const ck = (g, name, cond, detail) => groups[g].push({ name, ok: !!cond, detail: detail || '' });
  const blocks = ruleBlocks(D.css);
  const activeBefore = blocks.find(b => b.sel.indexOf('.nav-item.active::before') >= 0);
  const baseItem = blocks.find(b => b.sel === '.nav-item');
  const anim = activeBefore ? /animation:\s*([^;]+);/.exec(activeBefore.body) : null;

  // ---------- A · 作用域 ----------
  ck('A', 'A1 选中态浮起层仍在且承载背景层',
    !!activeBefore && /background-image/.test(activeBefore.body));
  ck('A', 'A2 navGlowDrift 真的挂进 active::before 的 animation',
    !!anim && anim[1].indexOf('navGlowDrift') >= 0);
  const animated = blocks.filter(b => b.sel.indexOf('.nav-item') >= 0 &&
    /animation:/.test(b.body) && b.body.indexOf('navGlowDrift') >= 0);
  ck('A', 'A3 柔光动画只挂 active / hover，裸 .nav-item 不得常驻',
    animated.length >= 1 && animated.every(b => /\.nav-item\.active|\.nav-item:hover/.test(b.sel)),
    '命中块=' + animated.map(b => b.sel).join(' | '));
  ck('A', 'A4 原有三波扫光未被柔光顶掉',
    !!anim && ['navSweep', 'navSweep2', 'navSweep3'].every(k => anim[1].indexOf(k) >= 0));
  const hasProp = /@property\s+--nav-glow-x\b/.test(D.css) && /@property\s+--nav-glow-y\b/.test(D.css);
  const hasKf = /@keyframes\s+navGlowDrift\b/.test(D.css);
  ck('A', 'A5 柔光走注册属性插值，且不是死代码',
    hasProp && hasKf && !!activeBefore && activeBefore.body.indexOf('var(--nav-glow-x)') >= 0);
  const baseDur = baseItem ? /--nav-glow-duration:\s*([\d.]+)s/.exec(baseItem.body) : null;
  const hoverDur = blocks.filter(b => b.sel.indexOf('.nav-item:hover') >= 0)
    .map(b => /--nav-glow-duration:\s*([\d.]+)s/.exec(b.body)).find(Boolean);
  ck('A', 'A6 hover 只覆写周期变量做加速，不新开常驻动画',
    !!baseDur && !!hoverDur && Number(hoverDur[1]) < Number(baseDur[1]),
    'base=' + (baseDur && baseDur[1]) + ' hover=' + (hoverDur && hoverDur[1]));

  // ---------- B · 颜色派生 ----------
  const bgImg = activeBefore ? activeBefore.body.slice(activeBefore.body.indexOf('background-image')) : '';
  const radCount = (bgImg.match(/radial-gradient\(/g) || []).length;
  ck('B', 'B1 柔光至少两层且颜色从本模块 --nav-hue 派生',
    radCount >= 2 && (bgImg.match(/var\(--nav-hue\)/g) || []).length >= 2 && !/#[0-9a-fA-F]{3,8}\b/.test(bgImg),
    'radial=' + radCount);
  const legacy = ['#1a23ff', '#e21bda', '#ffd215', '#fff172', '255, 163, 26', '255, 232, 26'];
  ck('B', 'B2 原版四色硬编码不得混进 layout.css',
    !legacy.some(c => D.css.toLowerCase().indexOf(c) >= 0));
  const hueMap = Array.from(D.css.matchAll(/\.nav-item\[data-view='[^']+'\]\s*\{\s*--nav-hue:\s*(\d+)\s*;/g))
    .map(m => Number(m[1]));
  ck('B', 'B3 七个模块色相映射齐全且互不相同',
    hueMap.length === 7 && new Set(hueMap).size === 7, '映射=' + hueMap.join(','));

  // ---------- C · 可访问性 ----------
  const rmBlocks = ruleBlocks(reducedMotionBodies(D.css))
    .filter(b => b.sel.indexOf('.nav-item') >= 0 && /animation:\s*none/.test(b.body));
  ck('C', 'C1 reduced-motion 兜底作用于 .nav-item 本身（不能只护 body）', rmBlocks.length > 0);
  ck('C', 'C2 兜底同时覆盖 ::before 与 ::after',
    rmBlocks.some(b => b.sel.indexOf('::before') >= 0) && rmBlocks.some(b => b.sel.indexOf('::after') >= 0));
  ck('C', 'C3 键盘焦点轮廓仍在',
    blocks.some(b => b.sel.indexOf('.nav-item:focus-visible') >= 0 && /outline/.test(b.body)));

  // ---------- D · 结构 ----------
  const navItems = D.html.match(/<a class="nav-item[^>]*>[\s\S]*?<\/a>/g) || [];
  ck('D', 'D1 七项导航仍是 i + span 的原生结构，无 wrapper/circle',
    navItems.length === 7 && navItems.every(s => /<i\s/.test(s) && /<span>/.test(s) && !/circle|wrapper|uiverse/i.test(s)),
    '条数=' + navItems.length);
  ck('D', 'D2 HTML 与 CSS 都无 .uiverse / .wrapper / .circle 残留',
    !/class="(?:wrapper|circle|uiverse)/i.test(D.html) && !/\.uiverse|\.wrapper\s*\{|\.circle\b/i.test(D.css));
  const beforeBlock = blocks.find(b => b.sel === '.nav-item::before');
  const afterBlock = blocks.find(b => b.sel === '.nav-item::after');
  ck('D', 'D3 ::before 仍是浮起层、::after 仍是同色相色标',
    !!beforeBlock && /box-shadow/.test(beforeBlock.body) && !!afterBlock &&
    /background/.test(afterBlock.body) && /var\(--nav-hue\)/.test(afterBlock.body));

  // ---------- E · 成本与缓存 ----------
  const blurs = Array.from(D.css.matchAll(/blur\(([\d.]+)px\)/g)).map(m => Number(m[1]));
  ck('E', 'E1 无 8~16px 级重模糊（现有 2.5px 上限）',
    blurs.length > 0 && blurs.every(v => v <= 2.5), 'blur=' + blurs.join(','));
  ck('E', 'E2 不引入 mix-blend-mode / mask 复合（本库曾两次静默失效）',
    !/mix-blend-mode|-webkit-mask-image|mask-image\s*:/i.test(D.css));
  const link = /css\/layout\.css\?v=([^"'\s]+)/.exec(D.html);
  ck('E', 'E3 layout.css 缓存戳与 APP_VERSION 一致',
    !!link && !!D.ver && link[1] === D.ver, '戳=' + (link && link[1]) + ' 版本=' + D.ver);

  return groups;
}

// 每个注入点单独读一份内存副本、只改一处，对应组必须复红。
// mutate 返回 false 视为锚点失效（不算捕获），避免「注入没生效却当成捕获」的假绿。
const INJECTIONS = [
  { key: 'glow-on-all', group: 'A', mutate(D) {
      const a = '--nav-glow-duration: 9s;';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, a + '\n  animation: navGlowDrift 7s linear infinite;');
      return true;
    } },
  { key: 'glow-removed', group: 'A', mutate(D) {
      const a = ', navGlowDrift var(--nav-glow-duration) ease-in-out infinite alternate';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, '');
      return true;
    } },
  { key: 'keyframes-dead', group: 'A', mutate(D) {
      const a = '@keyframes navGlowDrift {';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, '@keyframes navGlowDriftDisabled {');
      return true;
    } },
  { key: 'hardcoded-color', group: 'B', mutate(D) {
      const a = 'oklch(68% 0.10 var(--nav-hue) / 0.13)';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, '#e21bda');
      return true;
    } },
  { key: 'hues-flattened', group: 'B', mutate(D) {
      const before = D.css;
      D.css = D.css.replace(/(--nav-hue:\s*)\d+(\s*;)/g, (m, a, b) => a + '248' + b);
      return D.css !== before;
    } },
  { key: 'reduced-motion-body-only', group: 'C', mutate(D) {
      const a = '.nav-item, .nav-item::before, .nav-item::after {';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, 'body {');
      return true;
    } },
  { key: 'reduced-motion-partial', group: 'C', mutate(D) {
      const a = '.nav-item, .nav-item::before, .nav-item::after {';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, '.nav-item::before {');
      return true;
    } },
  { key: 'focus-visible-removed', group: 'C', mutate(D) {
      const a = '.nav-item:focus-visible {';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, '.nav-item-focus-disabled {');
      return true;
    } },
  { key: 'wrapper-dom', group: 'D', mutate(D) {
      const a = '<i class="fas fa-calculator"></i> <span>开仓计划</span>';
      if (D.html.indexOf(a) < 0) return false;
      D.html = D.html.replace(a, a + '<span class="circle circle-1"></span>');
      return true;
    } },
  { key: 'after-replaced', group: 'D', mutate(D) {
      const a = 'background: oklch(var(--nav-accent-l) 0.14 var(--nav-hue) / 0.32);';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, 'box-shadow: inset 0 3px 12px rgba(255, 223, 52, 0.9);');
      return true;
    } },
  { key: 'blur-heavy', group: 'E', mutate(D) {
      const a = 'filter: blur(2.5px);';
      if (D.css.indexOf(a) < 0) return false;
      D.css = D.css.replace(a, 'filter: blur(16px);');
      return true;
    } },
  { key: 'cache-stale', group: 'E', mutate(D) {
      const a = 'css/layout.css?v=' + D.ver;
      if (D.html.indexOf(a) < 0) return false;
      D.html = D.html.replace(a, 'css/layout.css?v=0.0.0');
      return true;
    } },
];

function countGroups(groups) {
  let pass = 0, fail = 0;
  Object.keys(groups).forEach(g => groups[g].forEach(r => { if (r.ok) pass++; else fail++; }));
  return { pass, fail };
}

if (INJECT) {
  console.log('侧栏柔光注入自检：逐条独立注入旧实现 / 缺陷，对应断言组必须复红\n');
  let caught = 0;
  for (const inj of INJECTIONS) {
    let hasRed = false, note = '';
    try {
      const D = readInputs();
      if (!inj.mutate(D)) note = '锚点失效（注入未生效）';
      else {
        const groups = runChecks(D);
        hasRed = groups[inj.group].some(r => !r.ok);
        if (!hasRed) note = '对应组未复红 → 断言无捕获力';
      }
    } catch (e) { note = '异常：' + e.message; }
    if (hasRed) caught++;
    console.log('  ' + (hasRed ? '\u2705' : '\u274c') + ' ' + inj.key.padEnd(28) +
      (hasRed ? '已捕获（' + inj.group + ' 组复红）' : note));
  }
  console.log('\n[注入自检] ' + caught + '/' + INJECTIONS.length + ' 个注入点被逐条捕获');
  gate.emitInject(caught, INJECTIONS.length);
  process.exit(caught === INJECTIONS.length ? 0 : 1);
} else {
  const groups = runChecks(readInputs());
  Object.keys(groups).forEach(g => {
    console.log('\n--- ' + g + ' 组 ---');
    groups[g].forEach(r => {
      console.log('  ' + (r.ok ? '\u2713' : '\u2717') + ' ' + r.name + (!r.ok && r.detail ? ' → ' + r.detail : ''));
    });
  });
  const { pass, fail } = countGroups(groups);
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  gate.emit(pass, fail);
  process.exit(fail > 0 ? 1 : 0);
}
