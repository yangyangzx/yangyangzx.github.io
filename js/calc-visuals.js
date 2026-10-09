/*
 * 计算结果可视化（v5.6.11 新增）
 *
 * 两块纯展示组件，挂在「计算结果」卡片顶部：
 *   1. 盈亏比对照 —— 止损 / 入场 / 目标三个价位，用一段从入场价向两侧发散的比例条
 *      直接画出 R:R。条长严格按【价格距离】比例分配，所以肉眼看到的长短比就是盈亏比，
 *      不需要读者再去心算两个百分比的比值。
 *   2. 保证金占用 —— 本仓保证金 + 已有持仓保证金的堆叠条，刻度上标 80%（单笔上限）
 *      与 90%（聚合上限）两道真实截断边界，一眼看出还剩多少余量。
 *
 * 设计约束（与仓库既有约定一致）：
 *   - 本模块不含任何仓位或风控公式。layoutRR / layoutMargin 只做「已算好的数值 →
 *     展示用比例与档位」的换算，金额与 RR 一律由 _calculateImpl 传入。
 *   - RR 档位颜色复用现有 rrMeetsMin()（skills-integration.js）与卡片三色语义，
 *     不自己写第二套阈值。
 *   - 全部用 DOM API 构造（textContent），不使用 innerHTML，避免再引入一处转义面。
 */
(function attachCalcVisuals(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CalcVisuals = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createCalcVisuals() {
  'use strict';

  // 注意：root 是外层 IIFE 的参数，不是工厂作用域里的变量。
  // 这里显式捕获，否则下面 rrMeets() 里 `root.rrMeetsMin` 会在第一次真实计算时
  // 抛 ReferenceError（被 _calculateImpl 的 try/catch 吞掉，面板静默只剩结果卡片）。
  var root = (typeof globalThis !== 'undefined') ? globalThis : window;

  // 保证金刻度边界。权威实现在 calculator.js：单笔 80%（availableCapital*leverage*0.8）
  // 与聚合 90%（capital*0.9）。这里是纯展示刻度——参与不了截断计算，只负责把刻度线
  // 画在正确位置。改这三处时必须同步：calculator.js 两处字面量 + 本文件。
  var MARGIN_WARN = 0.5;
  var MARGIN_SOFT_CAP = 0.8;
  var MARGIN_AGG_CAP = 0.9;

  // 条宽小于该比例时不再放内嵌 R 倍数标签：文字会溢出到条外，不如留在下方金额行读
  var MIN_INLINE_FRAC = 12;

  function byId(id) { return document.getElementById(id); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  // 展示层只关心「有没有值」，null 与 undefined 等价；用同一个助手避免散落的 == null
  function isNil(v) { return v === null || v === undefined; }

  function fmtAmt(v, d) {
    if (!isNum(v)) return '—';
    var dec = isNil(d) ? 2 : d;
    try {
      return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    } catch (e) { return Number(v).toFixed(dec); }
  }

  // 价格小数位按量级收敛：图例要的是可比大小，不是逐位精确，
  // 50000 显示成 50000.00000 会吃掉条上方整行宽度
  function fmtPrice(v) {
    if (!isNum(v) || v === 0) return '—';
    var a = Math.abs(v);
    var d = a >= 100 ? 2 : (a >= 1 ? 4 : (a >= 0.01 ? 6 : 8));
    return fmtAmt(v, d);
  }

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (!isNil(text)) n.textContent = text;
    return n;
  }

  // RR 档位判定统一走 rrMeetsMin（含 toFixed(2) 显示口径的容差），
  // 与结果卡片、检查清单三处共用，避免「图上一个色、卡片另一个色」
  function rrMeets(rr, min) {
    if (root.rrMeetsMin && typeof root.rrMeetsMin === 'function') return root.rrMeetsMin(rr, min);
    return rr + 1e-9 >= min;
  }

  /**
   * 盈亏比对照的展示模型。纯函数，可直接单测。
   *
   * 条长基准必须是含费净金额，不是价格距离：
   *   ep 50000 / sp 49000 / tp 52000 / 费率 0.08% 时，价格距离比是 2.00，
   *   而含费净 RR = 1.78。条长画成 2:1 而徽章写 1.78:1 会直接自相矛盾，
   *   并且会把本来判 amber 的 2.00 与判 red 的 1.78 混在一起——用户拿图去对照
   *   检查清单的 2R 闸门时会得出相反结论。所以基准取 netLoss / netProfit，
   *   两者恰好相除等于卡片上的 targetRR；拿不到净金额时才退回价格距离。
   */
  function layoutRR(d) {
    d = d || {};
    var entry = Number(d.entryPrice) || 0;
    var stop = Number(d.stopPrice) || 0;
    var target = Number(d.targetPrice);
    var hasTargetInput = isNum(target) && target > 0;

    // 必须先看 stop 是不是有效价：stop 缺失时 Math.abs(entry − 0) = entry，stopDist 恒 > 0，
    // 下面的兜底 if 永远走不进去——条会被画成满宽、注脚显示 100% 止损距离。
    // （当前唯一调用方 calculator.js 已在闸门校验止损价 > 0，故生产不可达；但这是函数
    // 契约，测试也必须覆盖 stopPrice 缺失这一支。）
    var stopDist = (stop > 0) ? Math.abs(entry - stop) : 0;
    if (!(stopDist > 0) && isNum(d.stopDistance)) stopDist = d.stopDistance;

    var grossProfit = Number(d.grossProfit);
    var targetDist = hasTargetInput ? Math.abs(target - entry) : 0;
    var netLoss = isNum(d.netLoss) ? d.netLoss : null;
    var netProfit = isNum(d.netProfit) ? d.netProfit : null;

    // 目标价必须真的落在盈利方向上，且含费后仍有余，才画绿色条。
    // 只判 grossProfit > 0 不够：很窄的目标价会被手续费吃光，grossProfit > 0 但
    // netProfit ≤ 0，此时画绿色条等于把亏损侧画成盈利。
    var gainValid = false;
    var invalidReason = '';
    if (hasTargetInput) {
      if (targetDist <= 0) {
        invalidReason = '目标价与入场价相同，没有盈利空间';
      } else if (!isNum(grossProfit)) {
        invalidReason = '止损价与目标价方向异常，未计入盈利';
      } else if (grossProfit <= 0) {
        invalidReason = '目标价与持仓方向相反，未计入盈利';
      } else if (!isNil(netProfit) && netProfit <= 0) {
        invalidReason = '扣除手续费后已无盈利空间';
      } else {
        gainValid = true;
      }
    }

    // 条长基准：净金额优先，缺净金额才退价格距离
    var lossAmt = null, gainAmt = null, basisNet = false;
    if (gainValid && netLoss > 0 && isNum(netProfit) && netProfit > 0) {
      lossAmt = netLoss;
      gainAmt = netProfit;
      basisNet = true;
    } else if (gainValid) {
      lossAmt = stopDist;
      gainAmt = targetDist;
    } else {
      lossAmt = stopDist;
      gainAmt = 0;
    }

    var span = lossAmt + gainAmt;
    var lossPct = 0, gainPct = 0;
    if (span > 0) {
      lossPct = lossAmt / span * 100;
      gainPct = 100 - lossPct;
    } else {
      lossPct = 100; // 无可比标度：满宽中性条 + 说明原因
      gainPct = 0;
    }

    var rr = Number(d.targetRR);
    // 基准退回价格距离时，调用方给的 rr 是含费净口径、与条长不同源——直接用条长
    // 自身比例得出，保证徽章与图永远一致（正常路径 basisNet 恒为真，此处是兜底）。
    if (gainValid && !basisNet && lossAmt > 0) rr = gainAmt / lossAmt;

    var tier = 'neutral';
    if (gainValid && isNum(rr) && rr > 0) {
      tier = rrMeets(rr, 3) ? 'green' : (rrMeets(rr, 2) ? 'amber' : 'red');
    } else if (hasTargetInput) {
      tier = 'invalid';
    }

    return {
      hasTargetInput: hasTargetInput,
      gainValid: gainValid,
      invalidReason: invalidReason,
      entry: entry, stop: stop, target: target,
      stopDist: stopDist, targetDist: targetDist,
      lossPct: lossPct, gainPct: gainPct,
      // 左条 = 1R 的绝对金额；basisNet 为真时是含费净止损，否则是价格距离
      lossAmt: lossAmt, gainAmt: gainAmt, basisNet: basisNet,
      rr: isNum(rr) ? rr : null,
      netLoss: netLoss,
      netProfit: netProfit,
      grossProfit: isNum(grossProfit) ? grossProfit : null,
      tier: tier
    };
  }

  /**
   * 保证金占用的展示模型。纯函数，可直接单测。
   *
   * 两条刻度来自两道不同的权威截断（calculator.js），分母并不相同：
   *   - 聚合上限：usedMargin + 本仓保证金 ≤ capital × 0.9 —— 直接落在「占本金」轴上。
   *   - 单笔上限：本仓保证金 ≤ availableCapital × 0.8，而 availableCapital = capital
   *     − consumedCapital（consumedCapital = 已有持仓保证金 + 滑点 + 手续费，不只是
   *     保证金）。换算到「占本金」轴上是 0.8 × availableCapital / capital，已有持仓
   *     越多这条刻度越靠左。把它画在固定的 80% 会系统性偏松：本金 10000、已有持仓
   *     保证金 3000 时真实上限是 56% 本金，画在 80% 等于让 72% 看起来还有余量。
   *   - 现货（leverage=0）没有这道 80% 上限，刻度整体隐藏。
   */
  function layoutMargin(d) {
    d = d || {};
    var capital = Math.max(0, Number(d.capital) || 0);
    var thisM = Math.max(0, Number(d.thisMargin) || 0);
    var usedM = Math.max(0, Number(d.usedMargin) || 0);

    // 可用本金：优先用 calculator.js 已算好的 availableCapital（已扣滑点与手续费），
    // 缺失或为负时才退回「本金 − 已有保证金」的纯保证金口径。
    //
    // 两个边界都不能省：
    //   - availableCapital 允许【低于】 capital − usedMargin——滑点与手续费也是真实占用，
    //     把它夹到 capital − usedMargin 会把占用算少（10000 本金、保证金 3000、
    //     真实可用 6800 的例子就落在这里）。
    //   - availableCapital 为负说明上游数据坏了，退回纯保证金口径比显示负可用更诚实；
    //     大于本金同样是不可能的输入，夹到本金。
    var avail;
    if (capital > 0) {
      if (isNum(d.availableCapital) && d.availableCapital >= 0) {
        avail = Math.min(capital, d.availableCapital);
      } else {
        avail = Math.max(0, capital - usedM);
      }
    } else {
      avail = 0;
    }
    var consumed = capital - avail;

    var total = thisM + usedM;
    var ratio = capital > 0 ? total / capital : 0;
    var tier = ratio > MARGIN_AGG_CAP ? 'danger'
      : (ratio > MARGIN_SOFT_CAP ? 'warn'
        : (ratio > MARGIN_WARN ? 'primary' : 'ok'));

    var softOn = Number(d.leverage) > 0;

    return {
      capital: capital,
      thisMargin: thisM,
      usedMargin: usedM,
      consumedCapital: consumed,
      availableCapital: avail,
      totalMargin: total,
      ratio: ratio,
      pct: ratio * 100,
      // 堆叠条内已有持仓段占比
      usedShare: total > 0 ? (usedM / total * 100) : 0,
      tier: tier,
      // 单笔保证金上限在「占本金」轴上的真实位置
      softOn: softOn,
      posCapPct: softOn && capital > 0 ? (MARGIN_SOFT_CAP * avail / capital * 100) : 0,
      // 本仓保证金占可用本金的比例——这才是单笔 80% 上限真正比较的量
      posUtilPct: avail > 0 ? thisM / avail * 100 : (thisM > 0 ? 100 : 0),
      overCapital: total > capital,
      free: total < capital ? capital - total : 0
    };
  }

  // ---------- 盈亏比对照 ----------

  function renderRR(m, d) {
    var card = byId('rrVisualCard');
    if (!card) return;
    card.style.display = m.hasTargetInput ? '' : 'none';
    if (!m.hasTargetInput) return;

    var badge = byId('rrBadge');
    if (badge) {
      badge.className = 'vv-badge vv-badge-' + (m.tier === 'invalid' ? 'invalid' : m.tier);
      badge.textContent = (isNil(m.rr) ? '—' : m.rr.toFixed(2)) + ' : 1';
    }

    var ladder = byId('rrLadder');
    if (!ladder) return;
    ladder.replaceChildren();

    var cols = m.lossPct.toFixed(2) + 'fr 2px ' + m.gainPct.toFixed(2) + 'fr';

    // 价格行：止损价标在左条正上方、目标价标在右条正上方
    var scale = mk('div', 'vv-row vv-row-scale');
    scale.style.gridTemplateColumns = cols;
    scale.appendChild(mk('span', 'vv-cell vv-price-stop', '止损 ' + fmtPrice(m.stop)));
    scale.appendChild(mk('span', 'vv-cell vv-axis-cell'));
    scale.appendChild(mk('span', 'vv-cell vv-price-target', m.gainValid ? '目标 ' + fmtPrice(m.target) : ''));

    // 比例条行
    var barRow = mk('div', 'vv-row vv-row-bar');
    barRow.style.gridTemplateColumns = cols;

    var lossCell = mk('span', 'vv-cell');
    var lossBar = mk('div', 'vv-bar vv-bar-loss' + (m.tier === 'invalid' ? ' is-neutral' : ''));
    if (m.lossPct >= MIN_INLINE_FRAC) lossBar.appendChild(mk('span', 'vv-bar-in', '1R'));
    lossCell.appendChild(lossBar);

    var gainCell = mk('span', 'vv-cell');
    if (m.gainValid) {
      var gainBar = mk('div', 'vv-bar vv-bar-gain');
      if (m.gainPct >= MIN_INLINE_FRAC) {
        gainBar.appendChild(mk('span', 'vv-bar-in', (isNil(m.rr) ? '' : m.rr.toFixed(m.rr >= 10 ? 0 : 1)) + 'R'));
      }
      gainCell.appendChild(gainBar);
    }
    barRow.appendChild(lossCell);
    barRow.appendChild(mk('span', 'vv-cell vv-axis-line'));
    barRow.appendChild(gainCell);

    // 金额行：与条同一套网格，标签溢出时向外侧溢出，不会互相压到入场价轴上。
    // 金额取 lossAmt / gainAmt——它们就是用来算条长的同一对数，标签与条长不可能分叉。
    var meta = mk('div', 'vv-row vv-row-meta');
    meta.style.gridTemplateColumns = cols;

    var lossMeta = mk('span', 'vv-cell vv-price-stop');
    if (m.gainValid) {
      lossMeta.appendChild(mk('b', '', '−' + fmtAmt(m.lossAmt) + (m.basisNet ? ' U' : '')));
      lossMeta.appendChild(mk('em', '', '1.0R'));
    }

    var gainMeta = mk('span', 'vv-cell vv-price-target');
    if (m.gainValid) {
      gainMeta.appendChild(mk('b', '', '+' + fmtAmt(m.gainAmt) + (m.basisNet ? ' U' : '')));
      gainMeta.appendChild(mk('em', '', (isNil(m.rr) ? '—' : m.rr.toFixed(2)) + 'R'));
    }

    meta.appendChild(lossMeta);
    meta.appendChild(mk('span', 'vv-cell vv-axis-cell'));
    meta.appendChild(gainMeta);

    ladder.appendChild(scale);
    ladder.appendChild(barRow);
    ladder.appendChild(meta);

    // 口径说明：把图上读到的东西说清楚——入场价、止损距离、1R 基准是什么口径
    var note = byId('rrNote');
    if (note) {
      note.replaceChildren();
      if (m.invalidReason) {
        note.appendChild(mk('span', 'vv-note-item warn', m.invalidReason));
        note.appendChild(noteItem('入场', fmtPrice(m.entry)));
      } else {
        note.appendChild(noteItem('入场', fmtPrice(m.entry)));
        var sdPct = stopPctOf(d);
        if (isNum(sdPct)) note.appendChild(noteItem('止损距离', sdPct.toFixed(2) + '%'));
        if (m.gainValid && !isNil(m.lossAmt) && m.lossAmt > 0) {
          // 1R 的含义必须写明：这里的 1R 是含费净止损，而复盘 R 倍数（logs.js）
          // 的分母是 initialRiskAmount = 开仓风险额（纯毛利），两者差一个手续费，
          // 杠杆越高差得越多。不写清楚，用户在复盘页会看到「不同的 R」。
          note.appendChild(noteItem(m.basisNet ? '1R = 含费净止损' : '1R = 价格距离',
            fmtAmt(m.lossAmt) + (m.basisNet ? ' U' : '')));
        }
        if (m.basisNet && isNum(d.riskAmount) && d.riskAmount > 0 && m.lossAmt > 0
            && Math.abs(d.riskAmount - m.lossAmt) > m.lossAmt * 0.01) {
          note.appendChild(noteItem('复盘 1R 基准', fmtAmt(d.riskAmount) + ' U（开仓风险，不含费）'));
        }
        if (d && isNum(d.fee) && d.fee > 0) {
          note.appendChild(noteItem('手续费', fmtAmt(d.fee) + ' U'));
        }
      }
    }
  }

  // 说明行片段：标签 + 加粗数值
  function noteItem(label, value) {
    var s = mk('span', 'vv-note-item');
    s.appendChild(mk('span', 'vv-note-key', label));
    s.appendChild(mk('b', '', value));
    return s;
  }

  // 1R 基准：有目标价时用含费净亏损（与 R 倍数定义一致），无目标价时用计划风险额
  // ---------- 保证金占用 ----------

  function renderMargin(m, d) {
    var card = byId('marginVisualCard');
    if (!card) return;
    card.style.display = '';

    var badge = byId('marginBadge');
    if (badge) {
      badge.className = 'vv-badge vv-badge-' + m.tier;
      badge.textContent = m.pct.toFixed(1) + '%';
    }

    var fill = byId('marginFill');
    if (fill) {
      fill.className = 'vv-g-fill vv-g-fill-' + m.tier;
      fill.style.width = Math.min(100, m.pct).toFixed(2) + '%';
    }
    var usedSeg = byId('marginFillUsed');
    if (usedSeg) usedSeg.style.flexBasis = m.usedShare.toFixed(2) + '%';

    // 刻度线位置由常量 + 已算好的 availableCapital 驱动，HTML 里不写死数字。
    // 聚合 90% 是固定值；单笔 80% 随已有持仓左移（它是「可用本金 × 80%」，不是
    // 「本金 × 80%」）。现货没有这道上限，整条刻度隐藏。
    var mkSoft = byId('gMarkSoft'), tickSoft = byId('gTickSoft');
    var mkAgg = byId('gMarkAgg'), tickAgg = byId('gTickAgg');
    // 保留两位有效精度但去掉尾随零：默认态正好是 '80%'，非整数仍是 '56%' / '54.4%'
    var softLeft = (Math.round(m.posCapPct * 100) / 100) + '%';
    var aggLeft = (MARGIN_AGG_CAP * 100) + '%';
    var softHidden = m.softOn ? '' : 'none';
    if (mkSoft) {
      mkSoft.style.left = softLeft;
      mkSoft.style.display = softHidden;
      mkSoft.textContent = '单笔 ' + m.posCapPct.toFixed(0) + '%';
    }
    if (mkAgg) mkAgg.style.left = aggLeft;
    if (tickSoft) { tickSoft.style.left = softLeft; tickSoft.style.display = softHidden; }
    if (tickAgg) tickAgg.style.left = aggLeft;
    if (mkAgg) mkAgg.textContent = Math.round(MARGIN_AGG_CAP * 100) + '%';

    var scaleLabel = byId('marginScaleLabel');
    if (scaleLabel) scaleLabel.textContent = '本金 ' + fmtAmt(m.capital, 0) + ' U';

    var note = byId('marginNote');
    if (note) {
      note.replaceChildren();
      note.appendChild(noteItem('本仓保证金', fmtAmt(m.thisMargin) + ' U'));
      if (m.usedMargin > 0) note.appendChild(noteItem('已有持仓', fmtAmt(m.usedMargin) + ' U'));
      note.appendChild(noteItem(m.overCapital ? '已超出本金' : '剩余可用',
        fmtAmt(Math.abs(m.overCapital ? m.totalMargin - m.capital : m.free)) + ' U'));
    }

    var note2 = byId('marginNote2');
    if (note2) {
      note2.replaceChildren();
      if (d && isNum(d.leverage)) {
        note2.appendChild(noteItem(d.leverage > 0 ? '保证金率' : '现货', d.leverage > 0 ? (100 / d.leverage).toFixed(1) + '%' : '100%'));
      }
      if (d && d.cappedByMargin) {
        var w = mk('span', 'vv-note-item warn');
        w.appendChild(mk('i', 'fas fa-shield-alt'));
        w.appendChild(document.createTextNode(' 仓位已被保证金上限截断'));
        note2.appendChild(w);
      }
    }
  }

  // ---------- 对外入口 ----------

  /**
   * d 由 _calculateImpl 传入，字段全部是已算好的数值（含费口径的金额与 targetRR
   * 同块计算）。本函数只做展示。
   */
  function render(d) {
    var wrap = byId('resultVisuals');
    if (!wrap || !d) return;
    var model = layoutRR(d);
    renderRR(model, d);
    renderMargin(layoutMargin(d), d);
    // 外层容器：两块都不可见时整块收起（无目标价时 RR 卡隐藏，保证金卡始终显示）
    var rrCard = byId('rrVisualCard');
    var mCard = byId('marginVisualCard');
    var anyVisible = (rrCard && rrCard.style.display !== 'none') || (mCard && mCard.style.display !== 'none');
    wrap.style.display = anyVisible ? '' : 'none';
  }

  function hide() {
    var wrap = byId('resultVisuals');
    if (wrap) wrap.style.display = 'none';
  }

  // 止损距离百分比：优先用 _calculateImpl 已算好的 stopPct，缺失时按价格反推
  function stopPctOf(d) {
    if (d && isNum(d.stopPct)) return d.stopPct;
    var m = layoutRR(d);
    var entry = Number(d && d.entryPrice) || 0;
    return entry > 0 && m.stopDist > 0 ? m.stopDist / entry * 100 : null;
  }

  return {
    MARGIN_WARN: MARGIN_WARN,
    MARGIN_SOFT_CAP: MARGIN_SOFT_CAP,
    MARGIN_AGG_CAP: MARGIN_AGG_CAP,
    MIN_INLINE_FRAC: MIN_INLINE_FRAC,
    fmtPrice: fmtPrice,
    fmtAmt: fmtAmt,
    layoutRR: layoutRR,
    layoutMargin: layoutMargin,
    render: render,
    hide: hide
  };
});
