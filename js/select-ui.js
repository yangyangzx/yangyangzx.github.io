// ==================== 全站 select 统一组件（v5.6.14）====================
// 自定义 listbox 替代原生 <select>。核心设计：
//   1. 保留原 <select> 在 DOM（加 .sl-native 视觉隐藏），20+ 处
//      document.getElementById('xxx').value 读点与 change 监听零改动——
//      组件每次写值时同步 select.value 并 dispatch change。
//   2. 外壳 = 玻璃底 + 柔和氛围光（--sl-hue 派生，见 select-ui.css）
//      + 未选择态专属底色 + 装饰图标 hover/展开归位（Uiverse 手法移植）。
//   3. 键盘：ArrowUp/Down 移动、Enter/Space 选中、Esc 关闭、
//      Home/End 跳首尾、a-z 首字母跳转。
//   4. 读屏：role=combobox + aria-expanded + role=listbox/option +
//      aria-activedescendant + aria-selected。
//   5. 触屏：点外壳展开、点选项选中、点外部/滚动自动关闭。
//
// 依赖：constants.js 的 esc()（全站唯一 HTML 转义）。
// 加载：constants.js 之后、app.js 之前（index.html script 顺序）。
// 初始化：每个增强点在 app.js DOMContentLoaded 里调
//   SelectUI.enhance('direction', { hue: 248, ... })

(function() {
  'use strict';

  var instances = {};  // id -> instance

  // ─────────────────────────────────────────
  // 公共 API
  // ─────────────────────────────────────────
  function enhance(id, opts) {
    var nativeSel = document.getElementById(id);
    if (!nativeSel || nativeSel.tagName !== 'SELECT') return null;
    opts = opts || {};
    var instance = _buildInstance(nativeSel, opts);
    instances[id] = instance;
    return instance;
  }

  // 动态替换选项（strategyPattern 用）。opts.html 是 <option> 或
  // <optgroup><option> 串，同 buildPatternOptions 的输出。
  function setOptions(id, html) {
    var inst = instances[id];
    if (!inst) return;
    inst.nativeSel.innerHTML = html;
    // 若当前值不在新选项里，清成第一个（与原生行为一致）
    var cur = inst.nativeSel.value;
    var stillExists = Array.prototype.some.call(
      inst.nativeSel.options, function(o) { return o.value === cur; });
    if (!stillExists) {
      var first = inst.nativeSel.querySelector('option');
      if (first) { inst.nativeSel.value = first.value; }
    }
    _renderList(inst);
    _renderValue(inst);
  }

  function getValue(id) {
    var inst = instances[id];
    if (inst) return inst.nativeSel.value;
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  // 其它 JS（filterOrderTypes / populateFilterOptions / syncFilterDOM /
  // resetForm 等）直接改原生 select 的 option.disabled / option.hidden /
  // .value / .innerHTML 时，调本方法让外壳 listbox 同步重绘。
  function syncFromNative(id) {
    var inst = instances[id];
    if (!inst) return;
    _renderList(inst);
    _renderValue(inst);
  }

  function setValue(id, val) {
    var inst = instances[id];
    if (!inst) {
      var el = document.getElementById(id);
      if (el) el.value = val;
      return;
    }
    inst.nativeSel.value = val;
    _renderList(inst);
    _renderValue(inst);
  }

  // ─────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────
  function _buildInstance(nativeSel, opts) {
    var parent = nativeSel.parentNode;
    var id = nativeSel.id;

    // 氛围光色相：从调用方传入（默认 248 蓝），各模块可覆写
    var hue = opts.hue != null ? opts.hue : 248;

    // 外壳 DOM
    var wrap = document.createElement('div');
    wrap.className = 'sl-select';
    wrap.setAttribute('data-sl-id', id);
    wrap.style.setProperty('--sl-hue', String(hue));

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sl-select-btn';
    btn.setAttribute('role', 'combobox');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'sl-list-' + id);

    var valSpan = document.createElement('span');
    valSpan.className = 'sl-select-value';
    valSpan.setAttribute('aria-hidden', 'true');

    // 装饰图标（Uiverse 同款：收起态 -rotate-45，hover/open 归位）
    var iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('viewBox', '0 0 100 100');
    iconSvg.setAttribute('class', 'sl-select-icon');
    iconSvg.setAttribute('aria-hidden', 'true');
    iconSvg.innerHTML = '<path stroke-width="4" stroke-linejoin="round" stroke-linecap="round" fill="none" '
      + 'd="M60.7,53.6,50,64.3m0,0L39.3,53.6M50,64.3V35.7m0,46.4A32.1,32.1,0,1,1,82.1,50,32.1,32.1,0,0,1,50,82.1Z" '
      + 'style="stroke:currentColor;"/>';

    btn.appendChild(valSpan);
    btn.appendChild(iconSvg);

    var list = document.createElement('ul');
    list.className = 'sl-select-list';
    list.id = 'sl-list-' + id;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    list.setAttribute('aria-labelledby', 'sl-label-' + id);

    // 氛围光
    var glow = document.createElement('span');
    glow.className = 'sl-select-glow';
    glow.setAttribute('aria-hidden', 'true');
    btn.appendChild(glow);

    wrap.appendChild(btn);
    wrap.appendChild(list);

    // 原 select 视觉隐藏（保留 DOM 供 JS 读 .value 与 change）
    nativeSel.classList.add('sl-native');
    parent.insertBefore(wrap, nativeSel);
    parent.insertBefore(nativeSel, wrap.nextSibling);  // nativeSel 留在 wrap 里

    var inst = {
      nativeSel: nativeSel,
      wrap: wrap,
      btn: btn,
      valSpan: valSpan,
      list: list,
      activeIdx: -1,
      open: false,
      opts: opts
    };

    _bindEvents(inst);
    _renderList(inst);
    _renderValue(inst);
    return inst;
  }

  function _renderList(inst) {
    var sel = inst.nativeSel;
    inst.list.innerHTML = '';
    var idxMap = [];  // 记录每个可选项在 list 里的 li 顺序（disabled 也占位但不可激活）
    Array.prototype.forEach.call(sel.children, function(child) {
      if (child.tagName === 'OPTION') {
        _addOptionLi(inst, child, idxMap);
      } else if (child.tagName === 'OPTGROUP') {
        var groupEl = document.createElement('li');
        groupEl.className = 'sl-select-group';
        groupEl.setAttribute('role', 'presentation');
        groupEl.textContent = child.label;
        inst.list.appendChild(groupEl);
        Array.prototype.forEach.call(child.children, function(o) {
          _addOptionLi(inst, o, idxMap);
        });
      }
    });
    inst._optionLis = idxMap;
  }

  function _addOptionLi(inst, opt, idxMap) {
    var li = document.createElement('li');
    li.className = 'sl-select-opt';
    li.setAttribute('role', 'option');
    li.setAttribute('data-value', opt.value);
    li.setAttribute('aria-disabled', opt.disabled ? 'true' : 'false');
    li.setAttribute('aria-selected', opt.value === inst.nativeSel.value ? 'true' : 'false');
    li.textContent = opt.textContent;
    if (!opt.disabled) idxMap.push(li);
    inst.list.appendChild(li);
  }

  function _renderValue(inst) {
    var sel = inst.nativeSel;
    // 与原生 select 显示行为对齐：始终显示 options[selectedIndex] 的文案。
    // 原实现对 value='' 的 select 只认 option[selected] 显式标记，而筛选器的
    // 占位首项（「全部方向」等）没有 selected 属性 → 按钮文字渲染成空框
    // （原生 select 在 value='' 时会正常显示第一项文案）。
    var valEl = sel.options[sel.selectedIndex] || null;
    var text = valEl ? valEl.textContent : '';
    inst.valSpan.textContent = text;
    // 未选择态判定：value 为空 或 第一项是空占位（— 不选择 —）且未选其它
    var isEmpty = (sel.value === '' ||
      (sel.options.length > 0 && sel.selectedIndex === 0 &&
       /不选择|全部|请选择/.test(sel.options[0].textContent)));
    inst.wrap.classList.toggle('is-empty', isEmpty && sel.value === '');
    inst.btn.setAttribute('aria-label', (inst.opts && inst.opts.ariaLabel)
      || '下拉选择' + (text ? '：' + text : ''));
  }

  function _open(inst) {
    if (inst.open) return;
    _closeAll();
    inst.open = true;
    inst.list.hidden = false;
    inst.wrap.classList.add('open');
    inst.btn.setAttribute('aria-expanded', 'true');
    _clampListHoriz(inst);
    // 光标定位到当前选中项（或第一项）
    var cur = inst.nativeSel.selectedIndex;
    var pos = 0;
    for (var i = 0; i < inst._optionLis.length; i++) {
      var v = inst._optionLis[i].getAttribute('data-value');
      if (v === inst.nativeSel.value) { pos = i; break; }
    }
    _setActive(inst, pos);
  }

  // 列表宽度自适应（width:max-content）后可能比触发器宽：若因此溢出视口右缘，
  // 改为右对齐展开。必须在 hidden=false 之后实测（此时才有布局尺寸）。
  function _clampListHoriz(inst) {
    inst.wrap.classList.remove('sl-flip-right');  // 先复位再实测，避免上次状态干扰测量
    var listRect = inst.list.getBoundingClientRect();
    if (listRect.right > window.innerWidth - 8 && listRect.width > inst.btn.offsetWidth) {
      inst.wrap.classList.add('sl-flip-right');
    }
  }

  function _close(inst) {
    if (!inst.open) return;
    inst.open = false;
    inst.list.hidden = true;
    inst.wrap.classList.remove('open');
    inst.btn.setAttribute('aria-expanded', 'false');
    inst.activeIdx = -1;
    Array.prototype.forEach.call(inst.list.querySelectorAll('.sl-select-opt'),
      function(li) { li.classList.remove('sl-active'); });
  }

  function _closeAll() {
    Object.keys(instances).forEach(function(k) { _close(instances[k]); });
    _combos.forEach(function(c) { _comboClose(c); });
  }

  function _setActive(inst, idx) {
    var lis = inst._optionLis;
    if (!lis.length) return;
    // clamp
    idx = Math.max(0, Math.min(idx, lis.length - 1));
    // 跳过禁用项（disabled 不进 idxMap，所以 lis 里天然没有 disabled）
    inst.activeIdx = idx;
    Array.prototype.forEach.call(inst.list.querySelectorAll('.sl-select-opt'),
      function(li) { li.classList.remove('sl-active'); });
    var li = lis[idx];
    li.classList.add('sl-active');
    inst.btn.setAttribute('aria-activedescendant', li.id || 'sl-opt-' + idx);
    // 保证 active 项在可视区
    var listRect = inst.list.getBoundingClientRect();
    var liRect = li.getBoundingClientRect();
    if (liRect.top < listRect.top) inst.list.scrollTop -= (listRect.top - liRect.top) + 4;
    else if (liRect.bottom > listRect.bottom) inst.list.scrollTop += (liRect.bottom - listRect.bottom) + 4;
  }

  function _commit(inst, value) {
    inst.nativeSel.value = value;
    inst.nativeSel.dispatchEvent(new Event('change', { bubbles: true }));
    _renderList(inst);
    _renderValue(inst);
  }

  function _bindEvents(inst) {
    var sel = inst.nativeSel;

    // 外壳点击：展开/收起
    inst.btn.addEventListener('click', function(e) {
      e.stopPropagation();
      inst.open ? _close(inst) : _open(inst);
    });

    // 选项点击
    inst.list.addEventListener('click', function(e) {
      var li = e.target.closest ? e.target.closest('.sl-select-opt') : null;
      if (!li || li.getAttribute('aria-disabled') === 'true') return;
      e.stopPropagation();
      _commit(inst, li.getAttribute('data-value'));
      _close(inst);
      inst.btn.focus();
    });

    // 键盘
    inst.btn.addEventListener('keydown', function(e) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!inst.open) { _open(inst); }
          else { _setActive(inst, inst.activeIdx + 1); }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!inst.open) { _open(inst); }
          else { _setActive(inst, inst.activeIdx - 1); }
          break;
        case 'Home':
          if (inst.open) { e.preventDefault(); _setActive(inst, 0); }
          break;
        case 'End':
          if (inst.open) { e.preventDefault(); _setActive(inst, inst._optionLis.length - 1); }
          break;
        case 'Enter':
        case ' ':
          if (inst.open) {
            e.preventDefault();
            var li = inst._optionLis[inst.activeIdx];
            if (li) _commit(inst, li.getAttribute('data-value'));
            _close(inst);
          }
          break;
        case 'Escape':
          if (inst.open) { e.preventDefault(); _close(inst); inst.btn.focus(); }
          break;
        case 'Tab':
          _close(inst);
          break;
        default:
          // 首字母跳转（a-z / 0-9）
          if (inst.open && /^[a-z0-9]$/i.test(e.key)) {
            var target = _findFirstByPrefix(inst, e.key.toLowerCase());
            if (target >= 0) _setActive(inst, target);
          }
      }
    });

    // 列表自身键盘（焦点在选项上时）
    inst.list.addEventListener('keydown', function(e) {
      var key = e.key;
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'
          || key === 'Enter' || key === ' ' || key === 'Escape' || key === 'Tab') {
        // 把事件转发给 btn 的 handler（复用同一套逻辑）
        inst.btn.dispatchEvent(new KeyboardEvent('keydown', {
          key: key, bubbles: true, cancelable: true
        }));
      }
    });

    // 原生 select 的 value 走标准 HTMLSelectElement 行为（不劫持 getter/setter——
    // 劫持会让 test/run-tests.html 对 fltStatus.value 的读值被外壳的 __slShadow
    // 吞掉，onFilterChange 永远读到 ''，筛选全失效）。
    // 外壳同步靠调用方在【直接写原生 .value 的地方】补 SelectUI.syncFromNative：
    //   syncFilterDOM（app.js）/ resetForm（calculator.js）/
    //   filterOrderTypes / populateFilterOptions（storage.js / modals.js）。

    // 外部点击关闭
    document.addEventListener('click', function(e) {
      if (inst.open && !inst.wrap.contains(e.target)) _close(inst);
    });

    // 注意：不再监听 window scroll 来关闭下拉。原因：
    //   1. .sl-select-list 是 position:absolute 相对 .sl-select（按钮），页面滚动时
    //      它跟随按钮一起移动，位置不会错位，没有关闭的必要；
    //   2. 列表自身 overflow-y:auto，选项多时内部滚动会触发 scroll 事件，该事件在
    //      捕获阶段被 window 监听到 → 立即 _close()，表现就是「下拉一滚就消失」。
    // 因此滚动时保持打开；外部点击 / Esc / Tab / resize 仍可关闭。

    // resize / 方向变化：关闭（视口尺寸变化可能让弹出位置需要重算）
    window.addEventListener('resize', function() {
      if (inst.open) _close(inst);
    });
  }

  function _findFirstByPrefix(inst, prefix) {
    for (var i = 0; i < inst._optionLis.length; i++) {
      var li = inst._optionLis[i];
      var label = li.textContent.toLowerCase();
      if (label.indexOf(prefix) === 0) return i;
    }
    return -1;  // 没找到则返回 -1（调用方判 != null 才 _setActive）
  }

  // ─────────────────────────────────────────
  // combobox：input + datalist 的自绘建议列表
  // ─────────────────────────────────────────
  // 背景：原生 datalist 弹层由浏览器合成器绘制，不参与页面层级，在部分渲染
  // 环境（内嵌预览 WebView）没有不透明背景——选项文字直接透叠在页面内容上，
  // 完全不可用（用户截图所示）。故改为自绘列表：与 .sl-select-list 同一套
  // 玻璃视觉、参与页面 z-index、右缘防溢出翻转。
  // 自由输入能力保留：建议列表只是辅助，输入框始终可编辑任意值。
  var _combos = [];   // 全部 combobox 实例，供 _closeAll / 外部点击统一关闭
  var _comboSeq = 0;  // li id 序号（aria-activedescendant 用）

  // inputId: input 元素或其 id。opts: { ariaLabel }
  function combobox(inputId, opts) {
    var input = typeof inputId === 'string' ? document.getElementById(inputId) : inputId;
    if (!input || input.tagName !== 'INPUT') return null;
    var dlId = input.getAttribute('list');
    var datalist = dlId ? document.getElementById(dlId) : (input.list || null);
    if (!datalist) return null;
    opts = opts || {};
    // 关键：摘掉 list 属性禁用原生弹层（透叠问题元凶）；datalist 元素保留在
    // DOM 作为选项数据源（symbolDatalist 由设置页动态填充，每次展开时重读）。
    input.removeAttribute('list');

    var wrap = document.createElement('div');
    wrap.className = 'sl-combo';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var listId = 'sl-combo-list-' + (++_comboSeq);
    var list = document.createElement('ul');
    list.className = 'sl-combo-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);

    var inst = {
      input: input, wrap: wrap, list: list, datalist: datalist,
      open: false, activeIdx: -1, _lis: [], opts: opts
    };
    _combos.push(inst);
    _bindComboEvents(inst);
    return inst;
  }

  function _comboOpen(inst) {
    if (inst.open) { _renderCombo(inst); return; }
    _closeAll();
    inst.open = true;
    inst.list.hidden = false;
    _renderCombo(inst);
    inst.activeIdx = -1;
    _comboClamp(inst);
  }

  function _comboClose(inst) {
    if (!inst.open) return;
    inst.open = false;
    inst.list.hidden = true;
    inst.activeIdx = -1;
    inst.input.setAttribute('aria-expanded', 'false');
  }

  // 右缘防溢出：与 _clampListHoriz 同思路，先复位再实测
  function _comboClamp(inst) {
    inst.wrap.classList.remove('sl-flip-right');
    var r = inst.list.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) inst.wrap.classList.add('sl-flip-right');
  }

  // 按当前输入值过滤 datalist 选项并重绘。返回可见建议数。
  function _renderCombo(inst) {
    var q = inst.input.value.trim().toLowerCase();
    var list = inst.list;
    list.innerHTML = '';
    inst._lis = [];
    var opts = Array.prototype.filter.call(
      inst.datalist.querySelectorAll('option'),
      function(o) { return !!o.value; });
    var matched = 0;
    Array.prototype.forEach.call(opts, function(o) {
      var v = o.value;
      var hit = q ? v.toLowerCase().indexOf(q) : 0;
      if (hit === -1) return;
      matched++;
      var li = document.createElement('li');
      li.className = 'sl-combo-opt';
      li.id = 'sl-combo-opt-' + (++_comboSeq);
      li.setAttribute('role', 'option');
      li.setAttribute('data-value', v);
      if (q && hit > -1) {
        // 命中片段高亮
        li.appendChild(document.createTextNode(v.slice(0, hit)));
        var mark = document.createElement('span');
        mark.className = 'sl-combo-hit';
        mark.textContent = v.slice(hit, hit + q.length);
        li.appendChild(mark);
        li.appendChild(document.createTextNode(v.slice(hit + q.length)));
      } else {
        li.textContent = v;
      }
      list.appendChild(li);
      inst._lis.push(li);
    });
    if (!matched) {
      var hint = document.createElement('li');
      hint.className = 'sl-combo-hint';
      hint.setAttribute('role', 'presentation');
      hint.textContent = '无匹配预设，可直接输入自定义值';
      list.appendChild(hint);
    }
    return matched;
  }

  function _comboSetActive(inst, idx) {
    var lis = inst._lis;
    if (!lis.length) return;
    idx = Math.max(0, Math.min(idx, lis.length - 1));
    inst.activeIdx = idx;
    lis.forEach(function(li) { li.classList.remove('sl-active'); });
    var li = lis[idx];
    li.classList.add('sl-active');
    inst.input.setAttribute('aria-activedescendant', li.id);
    inst.input.setAttribute('aria-expanded', 'true');
    // 保证 active 项在可视区
    var lr = inst.list.getBoundingClientRect();
    var ir = li.getBoundingClientRect();
    if (ir.top < lr.top) inst.list.scrollTop -= (lr.top - ir.top) + 4;
    else if (ir.bottom > lr.bottom) inst.list.scrollTop += (ir.bottom - lr.bottom) + 4;
  }

  function _comboCommit(inst, value) {
    inst.input.value = value;
    // 与真实键入一致：先 input 再 change（populatePatternSelect 等监听 change）
    inst.input.dispatchEvent(new Event('input', { bubbles: true }));
    inst.input.dispatchEvent(new Event('change', { bubbles: true }));
    _comboClose(inst);
    // 不调 input.focus()：键盘路径焦点本就在输入框；点击路径靠列表上的
    // mousedown preventDefault 保住了焦点。再 focus() 会在「焦点原本不在
    // 输入框」的调用场景重新触发 focus→展开，把刚关上的列表又弹开。
  }

  function _bindComboEvents(inst) {
    var input = inst.input;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', inst.list.id);
    input.setAttribute('aria-autocomplete', 'list');

    // 聚焦/点击即展开全部预设（桌面原生 datalist 点击不弹的问题在此一并解决）
    input.addEventListener('focus', function() { _comboOpen(inst); });
    input.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!inst.open) _comboOpen(inst);
    });

    // 输入即过滤
    input.addEventListener('input', function() {
      _comboOpen(inst);
      inst.activeIdx = -1;
    });

    input.addEventListener('keydown', function(e) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!inst.open) _comboOpen(inst);
          else _comboSetActive(inst, inst.activeIdx + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!inst.open) _comboOpen(inst);
          else _comboSetActive(inst, inst.activeIdx - 1);
          break;
        case 'Enter':
          if (inst.open && inst.activeIdx >= 0 && inst._lis[inst.activeIdx]) {
            e.preventDefault();
            _comboCommit(inst, inst._lis[inst.activeIdx].getAttribute('data-value'));
          } else {
            _comboClose(inst);
          }
          break;
        case 'Escape':
          if (inst.open) { e.preventDefault(); _comboClose(inst); }
          break;
        case 'Tab':
          _comboClose(inst);
          break;
      }
    });

    // 选项点击：mousedown preventDefault 让输入框不丢焦点（否则 blur 顺序问题
    // 会先把列表收掉）；选项均为 textContent 构建，无注入面。
    inst.list.addEventListener('mousedown', function(e) { e.preventDefault(); });
    inst.list.addEventListener('click', function(e) {
      var li = e.target.closest ? e.target.closest('.sl-combo-opt') : null;
      if (!li) return;
      _comboCommit(inst, li.getAttribute('data-value'));
    });

    // 外部点击 / resize 关闭（与 select 下拉同一约定；不监听 scroll，理由同前）
    document.addEventListener('click', function(e) {
      if (inst.open && !inst.wrap.contains(e.target)) _comboClose(inst);
    });
    window.addEventListener('resize', function() {
      if (inst.open) _comboClose(inst);
    });
  }

  // 暴露
  window.SelectUI = {
    enhance: enhance,
    setOptions: setOptions,
    syncFromNative: syncFromNative,
    getValue: getValue,
    setValue: setValue,
    combobox: combobox,
    closeAll: _closeAll
  };
})();
