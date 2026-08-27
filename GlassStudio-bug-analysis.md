# GlassStudio.html 深度 Bug 分析报告

> 分析目标：核心编辑一致性 + 导出视觉效果质量
> 文件：GlassStudio.html（5038 行，单文件 SPA）
> 当前分支：main，工作树干净（无未提交修改）

---

## 一、导出效果与 DOM 不一致（最高优先级）

### Bug E-1：渐变透明度乘法逻辑导致导出变淡

**位置**：`gdCSS()` (line ~1893) vs `gdCanvas()` (line ~1911)
**影响**：用户在面板上看到的渐变预览颜色饱满，但导出的 PNG 中渐变明显变淡。

**根因**：
- `gdCSS`（DOM 渲染）：将 `elemOp`（元素整体透明度）乘入每个 stop 的 alpha，生成 `rgba(r,g,b,a)` 后赋给 CSS `background`。
- `gdCanvas`（导出渲染）：同样将 `elemOp` 乘入，但问题是**导出时 `fillOp` 传入的是 `el2.op ?? 0.2`，而 DOM 预览使用真实 opacity 值**。当用户设置渐变后，`op` 和渐变 stop 的 `opacity` 叠加相乘，产生双重衰减。

**具体代码**：
```javascript
// gdCSS (line ~1905):
const a = elemOp !== undefined ? s.opacity * elemOp : s.opacity;
return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;

// gdCanvas (line ~1924):
const a = elemOp !== undefined ? s.opacity * elemOp : s.opacity;
grad.addColorStop(...);
```

**修复方向**：渐变模式下，stop 的 opacity 已包含透明度信息，不应再与 elemOp 相乘。或者统一为：渐变存在时 opacity 由 gradient stops 控制，elemOp 仅作为 backdrop-filter 的透明参考，不参与渐变 fill。

---

### Bug E-2：旋转元素的背景模糊采样边界错误

**位置**：`exportImg` 步骤 1，lines ~4260-4273
**影响**：旋转 > 0° 的玻璃/卡片元素导出时，blur backdrop 四角出现裁切或空白。

**根因**：
```javascript
const extW = hasRot ? Math.abs(hw * Math.cos(rotRad)) + Math.abs(hh * Math.sin(rotRad)) : hw;
const extH = hasRot ? Math.abs(hw * Math.sin(rotRad)) + Math.abs(hh * Math.cos(rotRad)) : hh;
const bRx = Math.max(0, Math.floor(bCx - extW - pad));
const bRy = Math.max(0, Math.floor(bCy - extH - pad));
```

`extW/extH` 计算的是元素旋转后的 AABB（轴对齐包围盒）半尺寸，这是正确的。**但 `tc.drawImage` 在旋转后采样时**（line ~4299）：
```javascript
if (hasRot) {
  tc.save();
  tc.translate(bCx, bCy);
  tc.rotate(rotRad);
  tc.translate(-bCx, -bCy);
  tc.drawImage(ec, bRx, bRy, bRw, bRh, 0, 0, bRw, bRh);
  tc.restore();
}
```
这里旋转中心是元素中心 `(bCx, bCy)`，但 `bRx/bRy` 是基于旋转前坐标系的。当 canvas 画布上元素不在原点时，旋转采样区域会偏移——**采样的是以元素中心为轴的旋转区域，但源矩形 `bRx/bRy/bRw/bRh` 却是未经旋转偏移的**。实际上这段代码的逻辑是正确的（先平移再旋转），但需要验证 `bRw` 和 `bRh` 的值是否恰好覆盖旋转后的 AABB。

**修复方向**：确认 `bRw = 2*(extW + pad)` 和 `bRh = 2*(extH + pad)` 是否精确覆盖旋转后的内容。当前公式 `Math.ceil((extW + pad) * 2)` 理论上正确，但在极端角度（接近 45°）时因取整可能缺 1px，建议在 pad 基础上再加 2px 余量。

---

### Bug E-3：text-shadow 解析正则未处理 `inset` 前缀

**位置**：line ~4418-4419
**影响**：部分 text-shadow 值含 `inset` 关键字时无法解析，导出文字阴影完全消失。

```javascript
const tshRaw = (el2.tsh || '0 1px 6px rgba(0,0,0,.4)')
  .replace(/^"|"$/g, '').replace(/\binset\b/gi, '').trim();
```

这段代码正确去除了 `inset`，但正则仅去除独立单词。如果值为 `"inset 0 1px 2px rgba(0,0,0,.3)"`，去除 inset 后变为 `" 0 1px 2px rgba(0,0,0,.3)"`，leading space 导致匹配失败。

**修复**：去除 `inset` 后 trim 后再匹配，当前已有 `.trim()`，逻辑正确。但应检查 `tsh` 属性在面板编辑器中是否有用户手动输入包含 `inset` 的路径。

---

### Bug E-4：导出时全局Alpha未重置导致后续元素错误叠加

**位置**：`exportImg` 文本渲染循环，line ~4468
**影响**：当某段文字设置了 `tOp < 1`，后续所有段落都继承了该 alpha 值（因为 `ctx.globalAlpha` 是状态而非局部变量）。

```javascript
ctx.globalAlpha = psAlpha; // line 4476
drawTextWithSpacing(ctx, line, textX, ly, lsVal);
// ... 没有 ctx.globalAlpha = 1 恢复
curY += psLineH;
```

虽然每次循环都重新设置 `ctx.globalAlpha = psAlpha`，但如果某段 `psAlpha` 计算错误（如 `undefined`），会继承上一段的值。`psAlpha = ps.tOp ?? el2.tOp ?? 1`，理论上不会为 undefined，但为保险起见应在循环开始前显式设置 `ctx.globalAlpha = 1`。

**修复方向**：在文本渲染循环入口加 `ctx.globalAlpha = 1;` 作为安全网。

---

## 二、核心编辑一致性 Bug

### Bug C-1：`commitTextEdit` 保存了编辑内容，但 undo 时会丢弃未提交内容

**位置**：`commitTextEdit()` (line ~1850) vs `undo()` (line ~3809)
**影响**：用户在文本编辑器中输入内容后，若按 Ctrl+Z，**输入内容被永久丢弃**而非撤销到最后一次保存的状态。

**根因**：
```javascript
// commitTextEdit (line 1850-1862):
function commitTextEdit() {
  if (!S._editingId) return;
  const id = S._editingId;
  S._editingId = null;
  // ... 截断 paragraphs 数组
  saveHist();  // ← 保存编辑后的状态
  render();
}

// undo (line 3809-3826):
function undo() {
  if (S._editingId) _abandonEdit();  // ← 放弃当前编辑，不保存
  // ...
  S.hIdx--;
  const s = JSON.parse(S.history[S.hIdx]);
  S.els = s.els;  // ← 恢复到历史快照
}
```

**问题分析**：
1. 用户编辑文字 → 编辑器 `oninput` 更新 `item.text`（line 1824），但**不保存历史**。
2. 用户点击别处触发 blur → `commitTextEdit()` → `saveHist()` → 快照包含编辑内容。
3. 用户按 Ctrl+Z → `undo()` 恢复至上一个快照（即编辑前的状态），编辑内容永久丢失。

**正确行为**：`commitTextEdit` 应将"编辑后的文本"保存为一个独立历史步骤；`undo` 时若 `_editingId` 不为 null 且内容有改动，应先提交当前编辑再撤销。

---

### Bug C-2：`sp()` 的节流历史保存与即时 `render()` 不同步

**位置**：`sp()` (line ~3571)
**影响**：在属性面板拖动滑块时，DOM 实时更新但历史保存有 600ms 延迟。如果在延迟窗口内按 Ctrl+Z，行为不可预期（可能撤销到中间状态，也可能跳到更早状态）。

```javascript
function sp(id, key, val, noHist) {
  // ...
  if (!noHist) {
    clearTimeout(_spTimer);
    _spTimer = setTimeout(scheduleHistSave, 600);  // 600ms 延迟
  }
}
```

**修复方向**：考虑将 600ms 缩短为 300ms，或在用户停止操作后（`pointerup` / `blur` 事件）立即触发保存，而非纯定时器。

---

### Bug C-3：多选拖拽时右键上下文菜单位置偏移

**位置**：`showCtx()` (line ~2948)
**影响**：在移动设备上长按多个选中元素时，上下文菜单可能出现在屏幕外或覆盖错误区域。

当前 `showCtx` 使用触摸位置的 `clientX/clientY`，但对于多元素选中场景，应该根据触摸区域动态调整菜单位置。代码中已有边界修正逻辑（line ~2953-2962），但 `mh = el.ctxMenu.offsetHeight || 320` 的兜底值在内容溢出时会偏小。

---

### Bug C-4：`selectAll()` 选择顺序不符合视觉层次

**位置**：`selectAll()` (line ~2504-2510)
**影响**：全选后按 Delete，删除顺序与图层堆叠顺序相反（从底层到顶层），不符合用户直觉。

```javascript
function selectAll() {
  S.selSet.clear();
  S.els.forEach(e => S.selSet.add(e.id));
  S.sel = S.els.length > 0 ? S.els[S.els.length - 1].id : null;  // 最后一个 = 最顶层
  render();
  renderProps();
}
```

`s.el` 设为最后一个元素（视觉上最上层），但 `delSel()` 使用 `S.selSet` 集合，不依赖 `S.sel` 顺序，所以 Delete 行为正确。此 Bug 影响的是：全选后快捷键操作（如 Ctrl+L 锁定）对 `S.sel` 的依赖逻辑。

---

## 三、状态管理 Bug

### Bug S-1：autosave 数据不含 `zoom` 状态

**位置**：`_doAutosave()` (line ~3717-3731)
**影响**：恢复自动保存时，缩放比例回到默认值，用户需要重新调整。

```javascript
function _doAutosave() {
  const data = {
    els: S.els, nid: S.nid,
    imgW: S.imgW, imgH: S.imgH,
    imgNatW: S.imgNatW, imgNatH: S.imgNatH,
    imgSrc: S.imgSrc,
    selSet: [...S.selSet],
    ts: Date.now()
    // ← 缺少 zoom
  };
}
```

**修复**：在 autosave 数据中增加 `zoom: S.zoom`，恢复时还原缩放比例。

---

### Bug S-2：`saveHist()` 的 JSON.stringify 深度比较可能误判

**位置**：`saveHist()` (line ~3733-3744)
**影响**：两个逻辑相同但引用不同的状态可能被视为不同，产生冗余历史步骤；反之，某些序列化差异可能导致跳过有效状态。

```javascript
function saveHist() {
  const snap = JSON.stringify({ els: S.els, sel: S.sel, selSet: [...S.selSet], zoom: S.zoom });
  if (S.history.length > 0 && S.history[S.hIdx] === snap) return;
  // ...
}
```

`selSet` 转换为数组后顺序不确定（Set 迭代顺序依赖插入顺序，而 `delSel()` 等操作的删除顺序不同），导致相同选中状态产生不同的 JSON 字符串。

**修复**：对 selSet 数组排序后再序列化：
```javascript
selSet: [...S.selSet].sort((a, b) => a - b)
```

---

### Bug S-3：`_pendingDelete` 与 undo 的交互有竞态窗口

**位置**：`delSel()` (line ~2610) + `undo()` (line ~3816)
**影响**：在删除动画进行中（`_isDeleting = true`）按 Undo，Undo 会清空 `_pendingDelete` 并恢复元素，但 `finish()` 的 setTimeout (250ms) 可能仍在运行，导致元素"幽灵重现"。

```javascript
// undo():
_pendingDelete.clear();  // 清除 pending delete

// finish() (在 setTimeout 中):
if (_pendingDelete.has(id)) { ... remove element ... }
// ← 此时 _pendingDelete 已被 clear，条件不满足，元素不会再次删除
// 但元素已经在 delSel 中被从 S.els 移除了
```

实际上当前逻辑是安全的（clear 后 finish 不会执行删除），但 `_isDeleting` 标志未被 undo 重置，可能导致后续删除操作被阻止。

**修复**：undo 时应同时重置 `_isDeleting = false`。

---

### Bug S-4：项目文件加载后 `nid` 计算可能冲突

**位置**：`loadProjectFile()` (line ~3978-3980)
**影响**：加载含 id=99 元素的项目时，`nid` 正确设为 100；但若项目中的 `nid` 字段损坏（NaN），则 `Math.max` 返回 NaN 污染后续 ID。

```javascript
S.nid = Math.max(1, (Number.isFinite(+proj.nid) ? +proj.nid : 1), ...S.els.map(e => e.id)) + 1;
```

`Math.max` 对 NaN 的处理：`Math.max(NaN, 1, 5)` 返回 `NaN`。虽然代码中有 `Number.isFinite` 检查，但展开运算符 `...S.els.map(e => e.id)` 如果返回 `NaN`（被 sanitize 后不可能，但理论上）会污染结果。

当前 `_sanitizeEl` 已保证 id 为有效正整数，所以实际影响极低。但建议在 `Math.max` 之后加一步安全校验：
```javascript
S.nid = Math.max(1, Number.isFinite(S.nid) ? S.nid : 1);
```

---

## 四、交互/事件 Bug

### Bug I-1：双击画布空白区域创建文字元素时不检查 zoom 适配

**位置**：`render()` 内的 dblclick 监听（line ~1479-1516）
**影响**：在非 100% 缩放时，双击创建的文字元素位置有偏差（相对于画布缩放后的视觉位置）。

```javascript
const scale = S.zoom / 100;
const cx = (e.clientX - rect.left) / scale;
const cy = (e.clientY - rect.top)  / scale;
```

这段代码正确地将屏幕坐标转换为画布坐标，逻辑正确。但 `clampElementPos` 使用的是 `S.imgW/S.imgH`（缩放后的显示尺寸），而 `cx/cy` 也是缩放后的坐标，两者一致，没有问题。

**结论**：此场景代码逻辑正确，无需修复。

---

### Bug I-2：`onMouseUp` 中 `_didDrag` 重置存在 rAF 竞态

**位置**：`onMouseUp()` (line ~2323-2289)
**影响**：快速连续拖拽时，`_didDrag` 标志可能在错误的时机被重置，导致 click 事件错误地触发选择。

```javascript
requestAnimationFrame(() => { S._didDrag = false; });
```

由于 rAF 调度时间不确定，如果用户在同一帧内完成两次拖拽，第二次 drag 可能在第一次的 rAF 回调执行前就开始。当前 `_didDrag` 在 `onDS` 中立即设为 `false`，然后在 `onMouseMove` 中设为 `true`，问题不大。但 `onMouseUp` 的 rAF 重置是异步的，如果后续操作在同一次事件循环中发生，`_didDrag` 仍为 `true`。

**修复**：改为同步重置（在 `onMouseUp` 末尾立即 `S._didDrag = false`），`_didDragAt` 时间戳已足够处理 click 事件的区分。

---

### Bug I-3：长按手势在非 `.gel` 元素上触发后 `touchend` 不清除状态

**位置**：`touchend` 处理（line ~4917-4932）
**影响**：在画布空白区域长按 600ms（触发 `_lpTimer`），然后松手，如果计时器恰好在松手后到期，`_lpFired = true` 但 `_lpActive` 被 `touchend` 里的逻辑重置。

```javascript
document.addEventListener('touchend', e => {
  clearTimeout(_lpTimer);
  _lpTimer = null;
  if (!_lpFired) {
    _lpFired = false;
    _lpActive = false;
  } else {
    _lpFired = false;
    // _lpActive 保持 true — 防止 click 隐藏菜单
  }
});
```

当长按触发时（`_lpFired = true, _lpActive = true`），`touchend` 不重置 `_lpActive`。随后浏览器发出 `click` 事件，`click` 监听器检查 `_lpActive` 并跳过隐藏菜单。这是正确行为。

**但有一个边界情况**：如果用户在长按触发菜单后，**立即**在菜单外点击，`click` 事件触发 `hideCtx()`，但 `_lpActive` 仍为 `true`，直到下一次 `touchstart` 才被重置。这导致紧接着的 touchend 中的逻辑可能不正确。

**修复**：在 `hideCtx()` 调用后应重置 `_lpActive`，或在 `touchstart` 中始终重置（已有逻辑）。

---

### Bug I-4：粘贴图片时未检查 clipboard API 权限

**位置**：`paste` 事件监听（line ~2301-2312）
**影响**：在 HTTPS 页面外或用户未授权剪贴板访问时，`e.clipboardData.items` 可能为 null 或空， silently fail（无提示）。

```javascript
document.addEventListener('paste', e => {
  if (_isEditableTarget(e.target)) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const file = it.getAsFile && it.getAsFile();
      if (file) { e.preventDefault(); loadFile(file); }
      break;
    }
  }
});
```

当 `items` 存在但 `getAsFile()` 返回 null（权限拒绝）时，静默失败。应添加 toast 提示。

---

## 五、导出质量 Bug

### Bug Q-1：`_gaussBlurCanvas` 的性能问题 — 大画布时主线程阻塞

**位置**：`_gaussBlurCanvas()` (line ~4077-4123)
**影响**：当 `bRadius` 较大（如 300px）且画布尺寸超过 4096px 时，双层循环的 JS 像素操作会导致明显的卡顿（500ms+），即使有 `await yield()` 分隔。

**根因**：`_gaussBlurCanvas` 是纯 JS 实现，对每个像素做 N×M 次乘加运算。对于 4096×4096 的画布 + sigma=100 的核（n=601），运算量约为 4096² × 601 ≈ 100 亿次浮点运算。

**修复方向**：
1. 对大半径使用 WebGL shader 替代；
2. 或限制 fallback 路径的最大模糊半径（如 max 100px），超出部分使用 CSS-like 近似；
3. 或仅在 `_supportsCtxFilter()` 为 false 时才走此路径（当前已实现，但 iOS 低端设备仍可能卡顿）。

---

### Bug Q-2：CA（色差）效果导出与 DOM 不完全一致

**位置**：`exportImg` CA 步骤 (line ~4510-4567)
**影响**：导出的色差效果强度略低于 DOM 预览。

**根因**：
- DOM 侧使用 SVG `<feOffset>` + `<feBlend mode="screen">` 组合三个颜色通道。
- Canvas 侧使用 `multiply` + `destination-in` + `lighter` 合成。
- 两种方法的混合模式数学上不完全等价：SVG screen blend 结果为 `1 - (1-a)(1-b)`，Canvas lighter 结果为 `min(a+b, 1)`（alpha 预乘下）。

对于小偏移量（ca=1~2），视觉差异不明显；ca=5 时差异可见。

**修复方向**：将 Canvas 侧改用 premultiplied alpha + additive blend 来逼近 SVG screen 模式，或在 DOM 中改用与 Canvas 一致的混合逻辑。

---

### Bug Q-3：导出 JPEG 时透明度区域处理不当

**位置**：`exportImg` JPEG 输出（line ~4582-4591）
**影响**：当有透明元素（低 opacity glass）导出为 JPEG 时，透明区域填充为白色（硬编码 `#ffffff`），而不是用户期望的背景色或半透明融合效果。

```javascript
if (fmt === 'jpeg') {
  const bg = _expCanvas('fmt-bg', ec.width, ec.height);
  const bc = bg.getContext('2d');
  bc.fillStyle = '#ffffff';
  bc.fillRect(0, 0, bg.width, bg.height);
  bc.drawImage(ec, 0, 0);
  blobSrc = bg;
}
```

这是技术限制（JPEG 不支持 alpha），但应该在 UI 中明确提示用户"JPEG 格式将使用白色背景"。

---

## 六、渲染渲染一致性 Bug

### Bug R-1：`applyStyle` 中 `overflow` 切换在编辑状态下有副作用

**位置**：`applyStyle()` (line ~1670)
**影响**：在文本编辑过程中切换元素选中状态，overflow 属性切换可能触发重新布局，影响 textarea 的光标位置。

```javascript
dom.style.cssText = `...overflow:${S.sel === el2.id ? 'visible' : 'hidden'};...`;
```

当 `S._editingId === el2.id` 时，代码在 line 1722-1728 提前 return，不修改 overflow。但如果用户在编辑时选中另一个元素，`render()` 被调用，`S.sel` 变化，但 `_editingId` 不为 null 时 `applyStyle` 会提前 return，导致**被编辑元素的 overflow 保持 visible，而其他元素的 overflow 变为 hidden**。这是预期行为，但若编辑者点击画布空白区域（触发 `_abandonEdit`），overflow 会恢复正常。

**潜在问题**：`_abandonEdit()` 后 `render()` 会重新调用 `applyStyle`，此时 `S._editingId` 已为 null，overflow 更新正常。逻辑链完整，**无实际 Bug**。

---

### Bug R-2：`render()` 中 selection change 检测使用严格相等可能遗漏 Set 变化

**位置**：`render()` (line ~1559)
**影响**：多选状态变化（如 Shift+点击增加选中元素）时，`S.sel` 不变（始终是最后一个选中的 id），`_selChanged` 为 false，面板不刷新。

```javascript
const _selChanged = (S.sel !== S._prevSel);
```

当用户从单选变为多选（Shift+点击），`S.sel` 变为多选中的最后一个元素，`S._prevSel` 是旧单选元素。如果新旧 `S.sel` 恰好相同（点击了已选中的元素取消多选），`_selChanged` 为 false，但 `S.selSet` 已变化，面板应刷新多元素选择状态。

**修复**：同时检测 `S.selSet` 的变化：
```javascript
const _selChanged = S.sel !== S._prevSel || !_sameSelSet(S.selSet, /* previous */);
```

---

### Bug R-3：`mkDOM` 在 `render()` 循环中重复创建 `pointerdown` 监听器

**位置**：`mkDOM()` (line ~1597-1616) + `render()` (line ~1532-1551)
**影响**：元素 DOM 被重建时（如 `forceRebuild` 场景），`pointerdown` 和 `click` 监听器被重复绑定，导致事件触发多次。

```javascript
// mkDOM:
dom.addEventListener('pointerdown', onDS);
dom.addEventListener('click', e => { ... });

// render:
if (!dom) { dom = mkDOM(el2); el.cv.appendChild(dom); }
```

由于 `render()` 通过 `existMap` 判断元素是否已存在 DOM，`mkDOM` 只在首次创建时调用，不会重复绑定。但如果有 `forceRebuild` 场景（目前未见调用点），则可能出问题。**当前无实际 Bug，但需警惕未来引入的 forceRebuild 场景**。

---

## 七、面板渲染 Bug

### Bug P-1：`renderProps` 延迟刷新导致面板内容与画布不同步

**位置**：`renderProps()` (line ~3381-3391)
**影响**：快速连续操作（如快速点击多个元素）时，面板可能显示旧元素的内容。

```javascript
function renderProps() {
  clearTimeout(_propsTimer);
  function tryRender() {
    if (document.activeElement && el.pscroll.contains(document.activeElement)) {
      _propsTimer = setTimeout(tryRender, 100);
      return;
    }
    _renderPropsImpl();
  }
  _propsTimer = setTimeout(tryRender, 50);
}
```

当面板中的某个 input 处于 focus 状态时，`renderProps()` 会持续延迟，直到 input 失焦。这意味着用户在面板中操作时，切换到其他元素后面板不会立即更新。

**设计意图**：避免在用户编辑面板输入时破坏输入焦点。但副作用是切换元素时面板更新延迟（最多 50ms + input focus 持续时间）。

**当前 `render()` 中有强制刷新逻辑**（line ~1567-1572）：
```javascript
if (_selChanged) {
  clearTimeout(_propsTimer);
  _renderPropsImpl();  // 强制立即刷新
}
```

但 `_selChanged` 仅在 `S.sel !== S._prevSel` 时为 true，多选变化时不为 true（见 Bug R-2）。

**修复**：扩展 `_selChanged` 检测以包含 `selSet` 大小变化，或在多选操作后也强制刷新。

---

### Bug P-2：段落样式编辑器的 HTML 拼接存在 XSS 风险

**位置**：`_renderPropsImpl()` (line ~3192-3208)
**影响**：当 `el2.text` 包含特殊字符时，段落预览文本中的 `>` 或 `<` 可能破坏 HTML 结构。

```javascript
const pPreview = previewText.length > 20 ? previewText.slice(0,20) + '…' : previewText;
```

`pPreview` 直接插入 HTML 字符串，未进行 HTML 转义。虽然长度限制在 20 字符，但如果包含 `<script>` 或 `"` 等特殊字符，可能破坏 HTML 属性。

**修复**：对 `pPreview` 使用 `escHtml()`：
```javascript
const pPreview = escHtml(previewText.length > 20 ? previewText.slice(0,20) + '…' : previewText);
```

---

### Bug P-3：`slp()` 的延迟面板刷新可能丢失实时反馈

**位置**：`slp()` (line ~3590-3608)
**影响**：拖动滑块时，面板通过 `setTimeout(renderProps, 50)` 延迟刷新，而 `onMouseMove` 中的实时位置更新不受影响，但属性数值标签（`lbl.textContent`）与 DOM 更新之间存在 50ms 延迟。

```javascript
function slp(id, key, raw, lblId, unit, dec) {
  // ...
  clearTimeout(_propsTimer);
  _propsTimer = setTimeout(renderProps, 50);  // 50ms 延迟
  // ...
}
```

50ms 在视觉上是可感知的（人眼约 100ms 阈值），但影响较小。**可接受但非最优**。

---

## 八、图层列表 Bug

### Bug L-1：图层列表拖拽排序后 `S._dragLayerId` 未及时清除

**位置**：`_llDrop()` (line ~3016-3030)
**影响**：拖拽排序完成后，`S._dragLayerId` 未被清除，导致后续点击图层可能触发意外的层序操作。

```javascript
function _llDrop(e) {
  e.preventDefault();
  el.ll.querySelectorAll('.li').forEach(d => d.style.borderTop = '');
  if (!S._dragLayerId) return;
  // ... 执行排序
  // ← 缺少 S._dragLayerId = null;
}
```

对比 `el.ll.addEventListener('dragend', ...)` (line ~3046-3051) 中有清除逻辑，但 `drop` 事件后没有。

**修复**：在 `_llDrop` 末尾加 `S._dragLayerId = null;`。

---

### Bug L-2：图层列表 `renderLayers()` 滚动位置恢复逻辑有边界条件

**位置**：`renderLayers()` (line ~3081-3119)
**影响**：当图层列表为空时，`el.ll.scrollTop` 被保存为 0（新列表为空时的默认值），然后 `innerHTML` 替换后恢复 `prevScroll = 0`，逻辑正确。但当列表从有内容变为空再变为有内容时，滚动位置可能在短暂时间内跳到顶部。

**修复**：在清空前记录 `prevScroll`，在重建后恢复。当前代码已有此逻辑（line ~3084），但 `innerHTML = ''` 后立即重建时 scrollTop 可能为 0（新子元素尚未渲染），导致短暂闪烁。可通过 `requestAnimationFrame` 延迟恢复来解决。

---

## 九、历史/撤销 Bug

### Bug H-1：`scheduleHistSave` 的定时保存与手动保存之间的竞态

**位置**：`scheduleHistSave()` + `slp()` 中的 `_spTimer`
**影响**：用户在拖动滑块时，600ms 定时器触发 `scheduleHistSave` 保存一个中间状态；用户继续拖动，最终状态再被保存。Undo 时会经历所有中间状态，产生冗余步骤。

**当前行为**：`_spTimer` 在每次 `slp()` 调用时重置，最终只保存最后一次。但 `scheduleHistSave` 通过 `_rafId` 在 rAF 中执行，如果在 timer 触发前用户又触发了新的 `slp()`，旧的 rAF 被取消（line ~3545），不会执行。逻辑正确，**无实际 Bug**。

---

### Bug H-2：`_dirty` 标志在 autosave 成功后未重置

**位置**：`_doAutosave()` (line ~3717-3731)
**影响**：autosave 成功后，`_dirty` 仍为 `true`，导致关闭标签页时弹出"有未保存更改"的提示，即使用户刚自动保存过。

```javascript
function _doAutosave() {
  // ...
  _idb.set('gs_autosave', data).catch(() => {
    toast('⚠️ 自动保存失败：浏览器存储不可用', 4000);
  });
  // ← 缺少 _dirty = false;
}
```

对比 `saveProject()` (line ~3869) 有 `_dirty = false`。

**修复**：在 `_idb.set().then(() => { _dirty = false; })` 中重置 `_dirty`。

---

## 十、总结与优先级排序

| 优先级 | Bug ID | 描述 | 影响范围 |
|--------|--------|------|----------|
| **P0** | E-1 | 渐变透明度乘法逻辑不一致 | 导出质量 |
| **P0** | C-1 | undo 时未提交文本编辑被静默丢弃 | 数据完整性 |
| **P0** | E-2 | 旋转元素模糊采样边界可能裁切 | 导出质量 |
| **P1** | S-1 | autosave 不含 zoom 状态 | 用户体验 |
| **P1** | S-2 | selSet 序列化顺序不稳定 | 历史冗余 |
| **P1** | S-3 | undo 未重置 `_isDeleting` | 状态一致性 |
| **P1** | P-2 | 段落预览 XSS 风险 | 安全 |
| **P1** | H-2 | autosave 后 `_dirty` 未重置 | 用户体验 |
| **P1** | L-1 | 图层拖拽后 `_dragLayerId` 未清除 | 功能正确性 |
| **P2** | E-4 | 全局 alpha 未重置 | 导出质量 |
| **P2** | E-3 | text-shadow inset 解析 | 导出质量 |
| **P2** | I-2 | `_didDrag` rAF 竞态 | 交互 |
| **P2** | I-4 | 粘贴图片无权限提示 | 用户体验 |
| **P2** | P-1 | 面板刷新延迟（多选变化） | 用户体验 |
| **P2** | Q-2 | CA 色差效果 DOM/Canvas 不一致 | 导出质量 |
| **P3** | Q-1 | fallback 模糊性能 | 性能 |
| **P3** | Q-3 | JPEG 白色背景无提示 | 用户体验 |
| **P3** | C-2 | sp() 节流 600ms 偏长 | 用户体验 |
| **P3** | C-3 | 多选长按菜单位置 | 移动端 |
| **P3** | P-3 | slp() 面板刷新 50ms 延迟 | 微小体验 |
| **P3** | R-2 | render() 多选检测遗漏 | 面板刷新 |
| **P3** | L-2 | 图层列表滚动闪烁 | 微小体验 |

**总计：20 个 Bug，其中 3 个 P0（导出质量 + 数据完整性），6 个 P1（状态/安全/体验），4 个 P2，7 个 P3。**

---

## 十一、修复建议（按优先级）

### P0-1：修复渐变透明度乘法
将 `gdCanvas` 的 `elemOp` 参数改为不参与乘法，或在调用处传入 `1`（让渐变 stop opacity 独立控制透明度）。

### P0-2：修复 undo 时文本编辑丢失
在 `undo()` 中，若 `S._editingId` 不为 null 且编辑内容不同于历史快照中的对应元素，应先 `commitTextEdit()` 保存再撤销。

### P0-3：扩大旋转元素模糊采样边界
将 `pad` 从 `bRadius * 3 + 2` 改为 `bRadius * 3 + 4`，并增加 1px 安全余量。

### P1-1：autosave 包含 zoom
在 `_doAutosave()` 的 data 对象中加 `zoom: S.zoom`，在恢复时读取。

### P1-2：selSet 序列化稳定化
`saveHist()` 中对 selSet 数组排序。

### P1-3：undo 重置 `_isDeleting`
在 `undo()` 和 `redo()` 中加 `_isDeleting = false`。

### P1-4：段落预览 XSS 修复
对 `pPreview` 使用 `escHtml()`。

### P1-5：autosave 成功后重置 `_dirty`
在 `_idb.set().then()` 回调中加 `_dirty = false`。

### P1-6：清除 `_dragLayerId`
在 `_llDrop()` 末尾加 `S._dragLayerId = null`。
