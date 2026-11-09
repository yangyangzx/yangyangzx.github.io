// ==================== 导航品牌区「回主入口」回归（v5.6.45 新增，常驻脚本） ====================
//
// 立项原因：v5.6.45 之前 .nav-logo 是纯 <div>，无 href / 无监听 / 无 cursor，
//   点击左上角图标或「交易风险管理终端」完全无反应。改为 <a href="#planner"> 后，
//   风险不在「能不能跳」，而在四个更隐蔽的接缝：
//     ① 复用 activateNav 才能继承设置页脏检查、退出批量模式、销毁图表等副作用；
//     ② 一律 preventDefault 会吃掉 Cmd/Ctrl/中键的「新标签打开」；
//     ③ 键盘 Enter/Space 必须与菜单项同等可达；
//     ④ 同视图重复点击会重跑 onViewActivated('planner')，监听器必须幂等。
//   纯函数断言（run-tests.html）碰不到真实 click / hash / 全局函数覆盖，
//   故本脚本加载真实 index.html 走端到端 jsdom 链路。
//
// 纪律：--inject 逐条独立注入 9 个确定错误，每次单独 boot 一个干净 JSDOM，
//   对应断言必须各自变红；注入只改内存副本，绝不碰磁盘文件。
//
// 用法：node test/verify_nav_logo.js            正常跑（全绿才算接线完整）
//       node test/verify_nav_logo.js --inject   注入错误，必须 9/9 全被捕获
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const INJECT = process.argv.includes('--inject');
const FILES = {
  html: 'index.html',
  css: 'css/layout.css',
  navJs: 'js/navigation.js',
  plannerJs: 'js/planner.js'
};

function loadInputs() {
  const o = {};
  Object.keys(FILES).forEach(k => { o[k] = fs.readFileSync(path.join(ROOT, FILES[k]), 'utf8'); });
  return o;
}
function clone(D) { return Object.assign({}, D); }

// 只把被注入的两个脚本换成内存副本，其余资源照常从磁盘加载。
// 缓存戳 ?v= 只影响 URL 查询串，按 basename 匹配即可。
function makeLoader(D) {
  const patched = { 'navigation.js': D.navJs, 'planner.js': D.plannerJs };
  class L extends ResourceLoader {
    fetch(url, opts) {
      const u = String(url);
      if (u.indexOf('file://') !== 0) return Promise.reject(new Error('blocked: ' + u));
      const name = u.split('?')[0].split('/').pop();
      if (Object.prototype.hasOwnProperty.call(patched, name)) {
        return Promise.resolve(Buffer.from(patched[name], 'utf8'));
      }
      return super.fetch(url, opts);
    }
  }
  return new L();
}
function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
}

// 每次 boot 一个全新 JSDOM；DOMContentLoaded 后所有同步脚本已执行完，
// 再让出一帧即可开始触发事件。8s 超时防止任何异常让进程静默挂起。
function boot(D) {
  return new Promise((resolve, reject) => {
    const vc = new VirtualConsole();
    vc.on('jsdomError', () => {});
    vc.on('error', () => {});
    let markReady, dom;
    const domReady = new Promise(r => { markReady = r; });
    const timer = setTimeout(() => {
      try { if (dom) dom.window.close(); } catch (e) { /* ignore */ }
      reject(new Error('boot timeout: DOMContentLoaded never fired'));
    }, 8000);
    try {
      dom = new JSDOM(D.html, {
        url: INDEX_URL,
        runScripts: 'dangerously',
        resources: makeLoader(D),
        pretendToBeVisual: true,
        virtualConsole: vc,
        beforeParse(w) {
          Object.defineProperty(w, 'localStorage', { value: makeStorage() });
          w.Element.prototype.scrollIntoView = function () {};
          // 统计多止盈输入框的 input 监听器绑定次数，用来证明同视图重复点击不重复绑定
          w.__tpAddCount = 0;
          const origAdd = w.EventTarget.prototype.addEventListener;
          w.EventTarget.prototype.addEventListener = function (type, fn, opts) {
            if (type === 'input' && this && /^tp[123](Price|Ratio)$/.test(this.id || '')) {
              w.__tpAddCount++;
            }
            return origAdd.call(this, type, fn, opts);
          };
          w.addEventListener('DOMContentLoaded', function () {
            setTimeout(() => markReady(w), 0);
          });
        }
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    domReady.then(
      w => { clearTimeout(timer); resolve({ dom, w }); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

async function runChecks(D, quiet) {
  const { dom, w } = await boot(D);
  const d = w.document;
  let pass = 0;
  const failures = [];
  const ck = (key, label, cond, extra) => {
    if (cond) { pass++; return; }
    failures.push(key);
    if (!quiet) console.log('  \u2717 ' + label + (extra ? ' \u2192 ' + extra : ''));
  };
  const logo = d.querySelector('#mainNav .nav-logo');
  const view = () => (typeof w.getCurrentView === 'function' ? w.getCurrentView() : w._currentView);
  const fire = (init) => {
    const e = new w.MouseEvent('click', Object.assign(
      { bubbles: true, cancelable: true, button: 0 }, init || {}));
    if (logo) logo.dispatchEvent(e);
    return e;
  };
  const press = (k) => {
    const e = new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    if (logo) logo.dispatchEvent(e);
    return e;
  };

  // ---------- 静态接线 ----------
  ck('dom-anchor', '.nav-logo 是真 <a> 链接（不是无交互的 div）',
    !!logo && logo.tagName === 'A');
  ck('dom-href', '品牌区指向 #planner 且 data-view=planner',
    !!logo && logo.getAttribute('href') === '#planner' && logo.getAttribute('data-view') === 'planner');
  ck('dom-a11y', 'aria-label / title 齐全，装饰图标 alt 为空',
    !!logo && /开仓计划/.test(logo.getAttribute('aria-label') || '') &&
    !!logo.getAttribute('title') &&
    !!logo.querySelector('img') && logo.querySelector('img').getAttribute('alt') === '');
  ck('dom-css', 'layout.css 为品牌区补了 cursor / hover / active / focus-visible',
    /\.nav-logo\s*\{[^}]*cursor:\s*pointer/s.test(D.css) &&
    /\.nav-logo:hover/.test(D.css) && /\.nav-logo:active/.test(D.css) &&
    /\.nav-logo:focus-visible/.test(D.css));
  ck('nav-not-active', '品牌区不带 .nav-item，也不会被 updateNavActive 标 active',
    !!logo && logo.className === 'nav-logo' &&
    !logo.classList.contains('active') && !logo.hasAttribute('aria-current'));

  // ---------- 真链路行为 ----------
  const plannerEl = d.getElementById('view-planner');
  const plannerNav = d.querySelector('#mainNav .nav-item[data-view="planner"]');

  // 从别的视图点品牌区：必须走 switchView 而不是裸改 hash
  w._currentView = 'journal';
  const e1 = fire();
  ck('click-from-other', '从其它视图点品牌区回到开仓计划（真链路 switchView）',
    view() === 'planner' && !!plannerEl && plannerEl.classList.contains('active') &&
    w.location.hash === '#planner' &&
    !!plannerNav && plannerNav.getAttribute('aria-current') === 'page',
    'view=' + view() + ' hash=' + w.location.hash);

  // 修饰键必须放行；当前 hash 已是 #planner，jsdom 的同片段导航不会触发 hashchange
  w._currentView = 'journal';
  const e2 = fire({ metaKey: true });
  ck('modifier-passthrough', 'Cmd/修饰键点击放行原生新标签语义（不拦截、不切当前页）',
    e2.defaultPrevented === false && view() === 'journal',
    'prevented=' + e2.defaultPrevented + ' view=' + view());

  w._currentView = 'dashboard';
  const e3 = press('Enter');
  ck('keyboard-enter', '键盘 Enter 可激活品牌区',
    e3.defaultPrevented === true && view() === 'planner');
  w._currentView = 'risk';
  press(' ');
  ck('keyboard-space', '键盘 Space 可激活品牌区', view() === 'planner');

  // 设置页脏检查：点品牌区不能静默丢弃未保存修改
  w.settingsIsDirty = () => true;
  w.confirmDialog = () => Promise.resolve(false);
  w._currentView = 'settings';
  fire();
  ck('settings-dirty', '设置页未保存时点品牌区不静默切走（脏检查仍生效）',
    view() === 'settings', 'view=' + view());

  // 用户确认后仍应正常回到主入口
  w.confirmDialog = () => Promise.resolve(true);
  w._currentView = 'settings';
  fire();
  await new Promise(r => setTimeout(r, 0));
  ck('dirty-confirm-ok', '确认放弃未保存修改后仍可正常回到开仓计划',
    view() === 'planner', 'view=' + view());

  // 同视图重复点击：onViewActivated('planner') 会重跑，多止盈监听器必须幂等
  w._currentView = 'planner';
  const base = w.__tpAddCount;
  fire(); fire(); fire();
  ck('same-view-idempotent', '已在开仓计划时重复点击不会重复绑定多止盈监听器',
    w.__tpAddCount === base, '新增 ' + (w.__tpAddCount - base) + ' 个');

  return { pass, failures, dom };
}

// 每条注入只制造一个确定错误，独立 boot 一次，避免交叉影响掩盖断言捕获力
const INJECTIONS = [
  ['dom-anchor', D => {
    const X = clone(D);
    X.html = X.html.replace(/<a class="nav-logo"([\s\S]*?)<\/a>/, '<div class="nav-logo"$1</div>');
    return X;
  }],
  ['dom-href', D => {
    const X = clone(D);
    X.html = X.html.replace('href="#planner" data-view="planner"', 'href="#dashboard" data-view="dashboard"');
    return X;
  }],
  ['dom-a11y', D => {
    const X = clone(D);
    X.html = X.html.replace('aria-label="返回开仓计划首页" ', '');
    return X;
  }],
  ['dom-css', D => {
    const X = clone(D);
    X.css = X.css.replace('  text-decoration: none;\n  cursor: pointer;\n', '  text-decoration: none;\n');
    return X;
  }],
  ['nav-not-active', D => {
    const X = clone(D);
    // 让 updateNavActive 把 logo 也当菜单项，会误加 active / aria-current
    X.navJs = X.navJs.replace("document.querySelectorAll('#mainNav .nav-item')",
      "document.querySelectorAll('#mainNav .nav-item, #mainNav .nav-logo')");
    return X;
  }],
  ['click-from-other', D => {
    const X = clone(D);
    // 从绑定选择器里摘掉 logo：点击无任何反应（回到 v5.6.44 的死区）
    X.navJs = X.navJs.replace("'#mainNav .nav-item, #mainNav .nav-logo'", "'#mainNav .nav-item'");
    return X;
  }],
  ['modifier-passthrough', D => {
    const X = clone(D);
    X.navJs = X.navJs.replace(
      "      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||\n          (typeof e.button === 'number' && e.button !== 0)) return;",
      "      /* injected: modifier guard removed */");
    return X;
  }],
  ['settings-dirty', D => {
    const X = clone(D);
    // 绕过 switchView 直接 _doSwitchView：脏检查与 window.switchView 包装全被跳过
    X.navJs = X.navJs.replace('switchView(viewName, true);', '_doSwitchView(viewName, true);');
    return X;
  }],
  ['same-view-idempotent', D => {
    const X = clone(D);
    X.plannerJs = X.plannerJs.replace('if (el && !el._tpListenerAttached) {', 'if (el) {');
    return X;
  }]
];

(async () => {
  if (INJECT) {
    let caught = 0;
    for (const [key, fn] of INJECTIONS) {
      let r, bootErr = '';
      try {
        r = await runChecks(fn(loadInputs()), true);
      } catch (e) {
        r = { pass: 0, failures: ['BOOT-ERROR'], dom: null };
        bootErr = ' boot=' + e.message;
      }
      const ok = r.failures.indexOf(key) >= 0;
      if (ok) caught++;
      console.log('  ' + (ok ? '\u2705' : '\u274c') + ' ' + key.padEnd(22) +
        (ok ? '已捕获（本轮 ' + r.failures.length + ' 条复红）' : '未捕获 \u2192 断言无捕获力' + bootErr));
      if (r.dom) { try { r.dom.window.close(); } catch (e) { /* ignore */ } }
    }
    console.log('\n[注入自检] ' + caught + '/' + INJECTIONS.length + ' 个注入点被逐条捕获');
    process.exit(caught === INJECTIONS.length ? 0 : 1);
  } else {
    let r;
    try {
      r = await runChecks(loadInputs(), false);
    } catch (e) {
      console.log('  \u2717 boot 失败：' + e.message);
      process.exit(1);
    }
    console.log('\n通过 ' + r.pass + ' / 失败 ' + r.failures.length);
    try { r.dom.window.close(); } catch (e) { /* ignore */ }
    process.exit(r.failures.length > 0 ? 1 : 0);
  }
})();
