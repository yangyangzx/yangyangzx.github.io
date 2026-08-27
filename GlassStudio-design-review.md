# GlassStudio.html 与 DESIGN.md 规范对照分析

> 对照基准：DESIGN.md（Apple Design System）
> 文件：GlassStudio.html（5083 行，暗色主题编辑器）
> 日期：2026-08-27

## 总体结论

GlassStudio 是一个**暗色主题生产力工具**，与 Apple 官网的浅色产品页面在设计目标上根本不同。DESIGN.md 的核心原则（产品优先、单一蓝色强调色、SF Pro 字体）需要适配到暗色工具语境下重新解读。

本文从四个维度进行逐项对照：**色彩系统**、**按钮与交互**、**排版**、**阴影与渐变**。

---

## 一、色彩系统对照

### 1.1 Accent Color（强调色）

| 规范 | GlassStudio | 符合度 |
|---|---|---|
| 单一品牌色 #0066cc | 主色 `#097757`（深翠绿），次色 `#0c9a6e`（亮翠绿） | ⚠️ 偏离 |

**分析**：DESIGN.md 明确禁止第二个强调色。GlassStudio 使用了两套相近的绿色系，但二者在功能上并非"品牌色+次要色"的关系——`--accent` 是操作主色，`--accent2` 是信息提示色，语义不同。对于暗色生产力工具，这套配色是可接受的变体，但严格来说违反了"单一强调色"原则。

**建议**：将 `--accent2` 统一为 `--accent-focus`（即 #0071e3 蓝色系的亮变体），或保留绿色系但移除独立的 accent2 变量，改为 accent 的明度变体。

### 1.2 Surface Colors（表面色）

| DESIGN.md | GlassStudio | 符合度 |
|---|---|---|
| canvas: #ffffff | --bg: #090909 | ✅ 暗色等效 |
| canvas-parchment: #f5f5f7 | --surface: #111111 | ✅ 暗色等效 |
| surface-pearl: #fafafc | --surface2: #181818 | ✅ 暗色等效 |
| surface-tile-1: #272729 | --surface3: #222222 | ✅ 暗色等效 |
| ink: #1d1d1f | --text: #F9F6ED | ✅ 暗色等效 |
| body-muted: #cccccc | --text-muted: rgba(249,246,237,0.52) | ✅ 暗色等效 |

**分析**：表面色系完整实现了暗色映射，间距 token（`--space-*`）也覆盖了 DESIGN.md 的 4/8/12/16/24 序列。符合度良好。

### 1.3 Border / Hairline

| DESIGN.md | GlassStudio | 符合度 |
|---|---|---|
| divider-soft: rgba(0,0,0,0.04) | --border: rgba(249,246,237,0.06) | ✅ 暗色等效 |
| hairline: #e0e0e0 | --border2: rgba(249,246,237,0.12) | ✅ 暗色等效 |

---

## 二、按钮与交互对照

### 2.1 按钮形态

| DESIGN.md 规范 | GlassStudio 实现 | 符合度 |
|---|---|---|
| primary pill: bg=#0066cc, text=white, pill-radius, padding 11×22px | `.hb.primary`: bg=accent, text=color-accent-ink, pill-radius, padding 6px 12px | ⚠️ 形态正确，尺寸偏小 |
| dark utility: bg=#1d1d1f, text=white, radius=sm(8px), padding 8×15px | `.hb` base: bg=transparent, text=muted, radius=full(pill), padding 6px 12px | ❌ 半径不一致 |
| icon circular: 44×44px | `.tb`: 36×36px, pill-radius | ⚠️ 偏小 |
| pearl capsule: bg=surface-pearl, radius=md(11px), padding 8×14px | `.mini-btn`: bg=surface2, radius=md, padding 4px 8px | ⚠️ 偏小 |
| Active state: `transform: scale(0.95)` | `.hb:active` scale(0.97), `.tb:active` scale(0.93), `.preset:active` scale(0.96) | ❌ 不统一 |

### 2.2 触达区域（Touch Targets）

DESIGN.md 要求最小 **44×44px**。

| 元素 | 实际尺寸 | 符合度 |
|---|---|---|
| `.tb` (工具栏按钮) | 36×36px | ❌ 小于 44px |
| `.hb` (header 按钮) | 自动高度 + 6px padding | 约 30px 高 |
| `.mini-btn` | 自动高度 + 4px padding | 约 24px 高 |
| `.preset` | 自动高度 + 4px padding | 约 24px 高 |
| `#zoom-slider` thumb | 11×11px | ❌ 过小 |
| canvas resize handles | 8×8px (CSS 声明) + transparent hit area | ⚠️ 依赖视觉大小而非交互区域 |

**建议**：
- `.tb` 从 36×36 增至 44×44（或至少 40×40）
- 缩小尺寸元素的 hit area 通过 CSS `padding` 或 `::before` 伪元素扩展透明点击区
- zoom-slider thumb 从 11px 增至 16px

### 2.3 Press 状态

DESIGN.md: **所有按钮使用统一的 `transform: scale(0.95)`**

GlassStudio 当前使用了至少 4 种不同的缩放值：
- `.hb:active` → `scale(0.97)`
- `.tb:active` → `scale(0.93)`
- `.preset:active` → `scale(0.96) translateY(1px)`
- `.zoom-btn:active` → `scale(0.94)`
- `.li:active` → `scale(0.98)`

**建议**：统一为 `scale(0.95)`，保持 SYSTEM-WIDE micro-interaction 一致性。

---

## 三、排版对照

### 3.1 字体族

| DESIGN.md | GlassStudio | 符合度 |
|---|---|---|
| Display: SF Pro Display, system-ui, -apple-system, sans-serif | `var(--font-display)` = 'Syne', sans-serif | ⚠️ Syne 替代了 SF Pro Display |
| Body/UI: SF Pro Text, system-ui, -apple-system, sans-serif | `var(--font-ui)` = 'DM Sans', sans-serif | ⚠️ DM Sans 是合理的开源替代 |
| Mono: JetBrains Mono / Fira Code | `var(--font-mono)` | ✅ |

**分析**：SYNE 作为 display 字体有强烈的几何感，与 SF Pro Display 的优雅曲线不同。DM Sans 作为 body 字体是一个优秀的开源替代，具有相似的阅读舒适度。但 **weight 700** 在 GlassStudio 的文字元素中频繁使用，而 DESIGN.md 明确规定 headline 用 weight 600，weight 500 "deliberately absent"。

### 3.2 字号

| DESIGN.md body | GlassStudio | 符合度 |
|---|---|---|
| 17px body | 11-13px UI（工具类暗色界面常见） | ⚠️ 偏小，但适合紧凑工具界面 |
| 14px caption | 10.5-12px 标签/说明文字 | ✅ 合理范围 |
| 12px fine-print | 10px 辅助说明 | ⚠️ 略小 |

**文字编辑区**使用 `el2.fs`（用户设置 8-400px），这不属于 UI 字体规范范畴，可接受。

### 3.3 Weight 使用

DESIGN.md: **ladder 是 300/400/600/700，500 故意缺失**

GlassStudio 使用的 weight：
- `font-weight: 500` — 大量用于 `.hb` 按钮、`.li` 图层项（❌ 违反规范）
- `font-weight: 600` — `.sec-hd` 标题、`.logo`（✅ 符合）
- `font-weight: 700` — `.logo`, `.text` 元素默认（⚠️ DESIGN.md 说 headline 用 600，700 仅用于 tagline 级别）
- `font-weight: 400` — textarea 内容（✅ 符合）

**建议**：将 `.hb` 等按钮从 weight 500 改为 600；logo 从 700 改为 600。

### 3.4 Letter-spacing

| DESIGN.md | GlassStudio | 符合度 |
|---|---|---|
| Display: -0.28 → -0.374px | logo: -0.022em ≈ -0.35px at 16px | ✅ 接近 |
| Caption: -0.224px | 图层标签: .09em uppercase（反向） | ❌ 方向相反 |
| Nav-link: -0.12px | 无类似用法 | - |

---

## 四、阴影与渐变对照

### 4.1 Box-shadow

DESIGN.md 核心原则：**"Exactly one drop-shadow in the entire system — product imagery only."**

GlassStudio 中 box-shadow 的使用：

| 位置 | Shadow 值 | 是否符合 |
|---|---|---|
| `.hb.primary` hover | `0 2px 14px rgba(9,119,87,.35)` | ❌ 按钮不应有 shadow |
| `.tb:hover` | `0 0 0 3px var(--accent-glow)` | ⚠️ ring 效果，可接受 |
| `.gel.sel` | `0 0 0 5px glow, 0 4px 20px shadow` | ❌ 元素选中态不应有 drop shadow |
| `.gel.dragging` | `0 16px 48px shadow` | ❌ 拖拽反馈不应有 drop shadow |
| `.sp-label.show` | `0 2px 8px shadow` | ❌ 工具提示不应有 shadow |
| `#exp-bar` | `0 0 8px glow` | ⚠️ glow 效果，可接受 |
| 导出预览 `.gel` (移动端) | `box-shadow:0 0 0 2px var(--border2)` | ✅ 仅 ring |
| 画布整体 | `box-shadow:var(--shadow-xl), 0 0 0 1px border` | ✅ 画布容器有 shadow 可接受 |

**结论**：GlassStudio 大量在非产品元素（按钮、选中态、拖拽反馈）上使用了 drop-shadow，严重偏离 DESIGN.md 的"仅产品图像用 shadow"原则。在暗色工具界面中，这些 shadow 有功能性意义（视觉层次），但应谨慎使用。

**建议**：
- 移除 `.gel.sel` 和 `.gel.dragging` 的 drop shadow，改用 outline/glow ring
- 按钮 hover 保持 glow ring（已有），移除 outer shadow
- 工具提示（sp-label）改用 backdrop blur + border 而非 shadow

### 4.2 渐变

DESIGN.md 核心原则：**"No decorative gradients."**

GlassStudio 中的渐变使用：
1. `#header::after` — 边缘淡出遮罩（功能性，非装饰性） ✅
2. `.tsep` — 分隔线渐变（功能性装饰） ⚠️
3. `#canvas-grid` — 背景网格（功能性） ✅
4. `#dz-inner` — 拖拽区域发光背景（功能性） ✅
5. `.sp-label` — 进度条渐变（功能性） ✅
6. 预设缩略图 — 渐变预览（功能性） ✅
7. 元素本身 — glass/card 渐变填充（**核心功能**） ✅

**结论**：GlassStudio 的渐变使用均为功能性目的，不存在纯装饰性渐变。符合 DESIGN.md 精神。

---

## 五、组件规格对照

### 5.1 Header 导航

| DESIGN.md `global-nav` | GlassStudio `#header` | 符合度 |
|---|---|---|
| height 44px | height 50px | ⚠️ 略高 |
| bg surface-black (#000) | bg surface (#111) | ✅ 暗色等效 |
| text on-dark (white) | text muted (white 52%) | ✅ 暗色等效 |
| font-size 12px / weight 400 | font-size 12px / weight 500 | ⚠️ weight 500 违规 |

### 5.2 确认弹窗（Confirm Dialog）

| DESIGN.md | GlassStudio | 符合度 |
|---|---|---|
| 无专门规范 | #confirm-overlay: bg=surface, border-radius=2xl, padding 22×24px | - |

确认弹窗风格与整体暗色工具一致，无明显违规。

### 5.3 Toast 通知

| DESIGN.md | GlassStudio | 符合度 |
|---|---|---|
| 无专门规范 | bottom-fixed, border-radius=lg, subtle bg tints | - |

Toast 设计合理，未违反核心原则。

### 5.4 加载/导出进度条

| 元素 | 规范 | GlassStudio | 符合度 |
|---|---|---|---|
| 进度条轨道 | 无 | bg=surface3, radius=4px, height=5px, inset shadow | ⚠️ 偏细 |
| 进度条填充 | 无 | gradient(accent→accent2), radius=4px, glow shadow | ⚠️ glow shadow 多余 |

---

## 六、可访问性对照

| 规范 | GlassStudio | 符合度 |
|---|---|---|
| Focus ring: 2px solid accent | `outline:2px solid var(--accent)` | ✅ |
| aria-label on buttons | 大部分有 | ✅ |
| role/button on .preset | ✅ | ✅ |
| touch-action: manipulation | ✅ | ✅ |
| Reduced motion support | `@prefers-reduced-motion` 规则存在 | ✅ |
| Color contrast (text on surface) | text #F9F6ED on #111 ≈ 15:1 | ✅ 远超 WCAG AAA |
| Touch target ≥ 44px | 多处 < 44px | ❌ |

---

## 七、响应式对照

| DESIGN.md Breakpoint | GlassStudio `_isPhone()` | 符合度 |
|---|---|---|
| ≤ 419px (small phone) | 无专门处理 | ❌ |
| 420-640px (phone) | 无专门处理 | ❌ |
| 641-735px (large phone) | 无专门处理 | ❌ |
| 736-833px (tablet portrait) | `_isPhone()` 用 ≤768px + portrait | ⚠️ 边界偏移 |
| 834-1023px (tablet landscape) | 面板隐藏逻辑 | ✅ |
| ≥ 1069px (desktop) | 全屏布局 | ✅ |

**建议**：增加 small phone（≤419px）的专门样式，特别是顶部 header 的压缩和底部工具的适配。

---

## 八、问题汇总

### 🔴 严重偏离（需修复）

| # | 规范 | 现状 | 修复建议 |
|---|---|---|---|
| 1 | 单一强调色 | 两个绿色系变量 | 合并为 accent + accent-hover 变体 |
| 2 | 统一 scale(0.95) | 5 种不同缩放值 | 统一到 `scale(0.95)` |
| 3 | 按钮 shadow 仅用于产品图 | 按钮/选中态/拖拽均有 shadow | 改用 glow ring |
| 4 | weight 500 不在 ladder | 大量 UI 元素用 weight 500 | 改为 600 |
| 5 | touch target ≥ 44px | .tb 36px, .mini-btn ~24px | 增至 44px 或用 padding 扩展 hit area |

### 🟡 中等偏离（建议优化）

| # | 规范 | 现状 | 修复建议 |
|---|---|---|---|
| 6 | Header height 44px | 50px | 压缩至 44px |
| 7 | Display weight 600 | logo 用 700 | 改为 600 |
| 8 | letter-spacing 负值 | 图层标签用 +0.09em | 改为 -0.09em 或移除 |
| 9 | Zoom slider thumb ≥ 16px | 11px | 增至 16px |
| 10 | 缺少 small phone 适配 | 无 ≤419px 专门样式 | 增加响应式断点 |

### 🟢 基本符合

- 表面色系暗色映射 ✅
- Border/hairline 层级 ✅
- Focus ring 样式 ✅
- aria-label / role ✅
- Reduced motion ✅
- Color contrast ✅
- 渐变功能性使用 ✅
- 键盘快捷键支持 ✅
