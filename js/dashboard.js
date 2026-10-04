// ==================== 仪表盘渲染 ====================

/**
 * 统一调用 utils.getClosedSorted()，避免与 storage/risk 实现分叉。
 * 已平仓判定统一使用 window.utils.isClosedTrade（要求 closeType 非空且 pnlAmount 可解析）。
 */
function getClosedLogs() {
  return window.utils.getClosedSorted();
}

/**
 * P0-1 FIX：筛选"持仓中"日志。
 * 语义：未平仓 + 部分平仓中间态（partialTP / reducePosition 剩余仓位仍属持仓，
 * 必须继续计入在仓风险 / 保证金占用 / 强平预警）。
 */
function _getOpenLogs() {
  var result = [];
  for (var i = 0; i < logs.length; i++) {
    if (typeof window.utils !== 'undefined' && typeof window.utils.isClosedTrade === 'function') {
      if (!window.utils.isClosedTrade(logs[i])) result.push(logs[i]);
    } else {
      if (!logs[i].closeType || logs[i].closeType === '') result.push(logs[i]);
    }
  }
  return result;
}

/**
 * 格式化金额为 USDT 显示
 */
function _fmtUSDT(val) {
  if (val == null || isNaN(val)) return '—';
  var abs = Math.abs(val);
  var sign = val >= 0 ? '+' : '-';
  if (abs >= 1000) return sign + ' ' + abs.toFixed(0) + ' USDT';
  if (abs >= 1) return sign + ' ' + abs.toFixed(2) + ' USDT';
  return sign + ' ' + abs.toFixed(4) + ' USDT';
}

/**
 * 格式化百分比
 */
function _fmtPct(val) {
  if (val == null || !isFinite(val)) return '—';
  return val.toFixed(1) + '%';
}

// ==================== P0-8: 数值计数器动画工具 ====================
/**
 * 数值计数器动画（P0-8）
 *
 * P2-11 FIX：改为结构化参数，不再从展示字符串反解数字/后缀。
 * 原实现用「去掉数字后剩下的字符串」当后缀，对 "+ 12.34 USDT" 得到 "+  USDT"
 * （+ 后有空格，正则匹配不到它），动画期间显示成 "12.34+  USDT"；终帧又被调用方的
 * innerHTML 覆盖，涨跌箭头从不显示；被打断时还会带入上次渲染的旧箭头 span（"▲ 配负数"）。
 *
 * @param {HTMLElement} el    目标元素（写入 innerHTML）
 * @param {number}      value 目标数值
 * @param {Object}      opts
 *   - {Function} format   (current:number) => 完整展示文本；终帧也用它，保证与目标文本一致
 *   - {string}   prefix   前缀 HTML（如涨跌箭头 span），每一帧原样保留，动画不覆盖箭头
 *   - {number}   duration 时长 ms（默认 400）
 *   - {number}   start    起始数值（默认取上次动画的中断值或 0）
 */
window._animateDashValue = function(el, value, opts) {
  opts = opts || {};
  var duration = opts.duration || 400;
  var format = typeof opts.format === 'function' ? opts.format : function(v) { return String(v); };
  var prefix = opts.prefix || '';

  var targetNum = typeof value === 'number' ? value : (parseFloat(value) || 0);
  if (isNaN(targetNum)) targetNum = 0;

  // 中断上一次未完成的动画，避免两个 rAF 循环互相覆盖
  if (el._animRaf) { cancelAnimationFrame(el._animRaf); el._animRaf = null; }

  var startNum = opts.start;
  if (startNum == null) {
    startNum = parseFloat(el.dataset.animCurrent);
    if (isNaN(startNum)) startNum = 0;
  }

  var startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    var current = startNum + (targetNum - startNum) * ease;
    el.innerHTML = prefix + format(current);
    el.dataset.animCurrent = String(current);
    if (progress < 1) {
      el._animRaf = requestAnimationFrame(step);
    } else {
      // 终帧严格等于 prefix + format(target)，与调用方写入的目标文本一致
      el.innerHTML = prefix + format(targetNum);
      // 保留终值作为下次动画的起点（原实现用 data-anim-target 承载，效果相同），
      // 使"今日 PnL 100 → 125"这类更新从旧值滚动到新值，而不是每次归零重播
      el.dataset.animCurrent = String(targetNum);
      el._animRaf = null;
    }
  }
  el._animRaf = requestAnimationFrame(step);
};

// ==================== 卡片 1：今日 PnL ====================
function _renderTodayPnl() {
  var todayStr = window.utils.toLocalDateStr(new Date().toISOString());
  var closed = getClosedLogs();
  var totalPnl = 0;
  var count = 0;

  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var closeDateStr = window.utils.toLocalDateStr(ct);
    if (!closeDateStr) continue;
    if (closeDateStr === todayStr) {
      totalPnl += parseFloat(closed[i].pnlAmount) || 0;
      count++;
    }
  }

  var valueEl = document.getElementById('dashPnlValue');
  var subEl = document.getElementById('dashPnlSub');

  if (count === 0) {
    valueEl.textContent = '0.00';
    valueEl.className = 'dash-card-value pnl-neutral';
    subEl.textContent = '今日无交易';
    return;
  }

  var cls = totalPnl > 0 ? 'pnl-positive' : (totalPnl < 0 ? 'pnl-negative' : 'pnl-neutral');
  valueEl.className = 'dash-card-value ' + cls;

  var arrow = totalPnl > 0 ? '<span class="pnl-arrow-up">&#9650;</span>' : (totalPnl < 0 ? '<span class="pnl-arrow-down">&#9660;</span>' : '');
  // P2-11 FIX：箭头由 prefix 统一提供，动画期间不再覆盖/丢失箭头（原实现在箭头后
  // 补空格与 format 生成的 "+ 12.34 USDT" 叠加，且终帧被下面的 innerHTML 覆盖）
  var prefix = arrow ? arrow + ' ' : '';
  var displayTxt = _fmtUSDT(totalPnl);
  // P0-8: 数值计数器动画（结构化参数，format 与终帧口径一致）
  window._animateDashValue(valueEl, totalPnl, { prefix: prefix, format: _fmtUSDT, duration: 350 });
  valueEl.innerHTML = prefix + displayTxt;
  subEl.textContent = '共 ' + count + ' 笔已平仓';

  var card = document.getElementById('dashTodayPnl');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add(totalPnl > 0 ? 'status-positive' : (totalPnl < 0 ? 'status-negative' : ''));
}

// ==================== 卡片 2：本周胜率 ====================
function _renderWinRate() {
  // 计算本周一的本地日期字符串
  var now = new Date();
  var day = now.getDay();
  var diff = day === 0 ? 6 : day - 1;
  var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  var mondayStr = window.utils.toLocalDateStr(monday.toISOString());
  var closed = getClosedLogs();
  var wins = [];
  var losses = [];
  var totalPnl = 0;
  var count = 0;

  for (var i = 0; i < closed.length; i++) {
    var ct = closed[i].closeTime;
    if (!ct) continue;
    var closeDateStr = window.utils.toLocalDateStr(ct);
    if (!closeDateStr) continue;
    if (closeDateStr >= mondayStr) {
      var pnl = parseFloat(closed[i].pnlAmount) || 0;
      totalPnl += pnl;
      count++;
      if (pnl > 0) wins.push(pnl);
      else if (pnl < 0) losses.push(Math.abs(pnl));
      else {
        // break-even: 不算赢也不算输
      }
    }
  }

  var valueEl = document.getElementById('dashWinRateValue');
  var subEl = document.getElementById('dashWinRateSub');

  if (count === 0) {
    valueEl.textContent = '—';
    valueEl.className = 'dash-card-value pnl-neutral';
    subEl.textContent = '本周暂无交易';
    return;
  }

  // P1-2 FIX：胜率口径与统计页统一——分母为本周全部已平仓（保本计入分母，与期望值自洽）
  var decided = wins.length + losses.length;
  var winRate = count > 0 ? ((wins.length / count) * 100) : 0;

  valueEl.textContent = _fmtPct(winRate);
  valueEl.className = 'dash-card-value ' + (winRate >= 50 ? 'pnl-positive' : 'pnl-negative');

  var avgWin = wins.length > 0 ? wins.reduce(function(a,b){return a+b;}, 0) / wins.length : 0;
  var avgLoss = losses.length > 0 ? losses.reduce(function(a,b){return a+b;}, 0) / losses.length : 0;
  var wlRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '—';

  subEl.textContent = '盈亏比 ' + wlRatio + '  \u00B7  ' + decided + ' 笔（共 ' + count + '）';

  var card = document.getElementById('dashWinRate');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add(winRate >= 50 ? 'status-positive' : 'status-negative');
}

// ==================== 卡片 3：在仓风险 ====================
function _renderRiskExposure() {
  var openLogs = _getOpenLogs();
  var rowsEl = document.getElementById('dashRiskRows');

  if (openLogs.length === 0) {
    rowsEl.innerHTML = '<span style="color:var(--color-text-muted);font-size:var(--font-sm);">无持仓</span>';
    return;
  }

  var totalPosition = 0;
  var totalRisk = 0;
  var totalMargin = 0;

  for (var i = 0; i < openLogs.length; i++) {
    var log = openLogs[i];
    totalPosition += parseFloat(log.positionSize) || 0;
    // 按当前止损价实时重算，不读冻结的 riskAmount：止损可移动（recordStopMove 只改
    // stopLoss/stopHistory，不动 riskAmount），读 riskAmount 会让本卡与组合热量闸门/
    // 风控中心对同一笔持仓报出相差数倍的敞口，而下方还用热量阈值给它上色。
    totalRisk += (typeof positionCurrentRisk === 'function')
      ? positionCurrentRisk(log) : (parseFloat(log.riskAmount) || 0);
    var lev = parseFloat(log.leverage) || 0;
    // BUG-7 修复：现货(leverage=0)时保证金等于仓位本身
    if (lev > 0) {
      totalMargin += (parseFloat(log.positionSize) || 0) / lev;
    } else {
      totalMargin += parseFloat(log.positionSize) || 0;
    }
  }

  // P2-2 FIX：风险占比分母统一为账户本金（与组合热量/风控中心口径一致），
  // 阈值对齐 riskHeatMax（默认 6%）：≥80% 预警、≥100% 危险
  var capital = (typeof getAccountCapital === 'function') ? getAccountCapital() : null;
  // P1 修复：display 字符串与判断用的数值分离，避免 .toFixed(1) 再 parseFloat 的精度往返丢失
  var riskNum = (totalRisk > 0 && capital > 0) ? (totalRisk / capital) * 100 : 0;
  var riskPctDisplay = (totalRisk > 0 && capital > 0) ? riskNum.toFixed(1) : '—';
  var heatMax = 6;
  try {
    if (typeof getHeatHardMax === 'function') heatMax = getHeatHardMax();
  } catch(e) {}
  var riskCls = riskNum >= heatMax ? 'danger' : (riskNum >= heatMax * 0.8 ? 'warn' : '');

  rowsEl.innerHTML =
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">总持仓</span>' +
      '<span class="dash-risk-value">' + _fmtUSDT(totalPosition) + '</span>' +
    '</div>' +
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">总风险（占本金）</span>' +
      '<span class="dash-risk-value ' + riskCls + '">' + _fmtUSDT(totalRisk) + (riskPctDisplay === '—' ? '' : ' (' + riskPctDisplay + '%)') + '</span>' +
    '</div>' +
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">占用保证金</span>' +
      '<span class="dash-risk-value">' + _fmtUSDT(totalMargin) + '</span>' +
    '</div>' +
    '<div class="dash-risk-row">' +
      '<span class="dash-risk-label">持仓数</span>' +
      '<span class="dash-risk-value">' + openLogs.length + ' 笔</span>' +
    '</div>';

  var card = document.getElementById('dashRiskExposure');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add(riskNum >= heatMax ? 'status-negative' : (riskNum >= heatMax * 0.8 ? 'status-warning' : 'status-positive'));
}

// ==================== 卡片 4：连亏计数 ====================
// P0-2 FIX：统一复用 stats.js 的当日连亏实现（_getTodayLossStreak）。
// 原实现存在双重计数（totalLossCount 累加两次）且 streak 未限定当日，与
// 风控/熔断的"当日连亏≥3"口径不一致；现与统计页完全一致。
function _renderLossStreak() {
  var valueEl = document.getElementById('dashStreakValue');
  var subEl = document.getElementById('dashStreakSub');

  var streakResult = (typeof _getTodayLossStreak === 'function')
    ? _getTodayLossStreak()
    : { streak: 0, totalLossCount: 0 };
  var streak = streakResult.streak || 0;
  var totalLossCount = streakResult.totalLossCount || 0;

  if (streak === 0 && totalLossCount === 0) {
    valueEl.textContent = '0';
    valueEl.className = 'dash-card-value pnl-positive';
    subEl.innerHTML = '<span class="streak-safe">安全</span>  连续亏损 0 笔（今日无亏损）';
    var card0 = document.getElementById('dashLossStreak');
    if (card0) {
      card0.className = card0.className.replace(/\bstatus-\w+/g, '');
      card0.classList.add('status-positive');
    }
    return;
  }

  valueEl.textContent = streak;
  valueEl.className = 'dash-card-value';
  // P0-8/P2-11: 连亏数值动画——笔数是整数，必须走整数格式化分支；
  // 原实现传 String(streak) 会被金额逻辑 toFixed(2) 成 "1.00"
  window._animateDashValue(valueEl, streak, {
    format: function(v) { return String(Math.round(v)); },
    duration: 300
  });

  var tag = '';
  var tip = '';
  if (streak <= 1) {
    valueEl.className += ' pnl-positive';
    tag = '<span class="streak-safe">安全</span>';
  } else if (streak === 2) {
    valueEl.className += ' pnl-negative';
    tag = '<span class="streak-warn">注意</span>';
  } else {
    valueEl.className += ' pnl-negative';
    tag = '<span class="streak-danger">危险</span>';
    tip = '<div class="streak-tip"><i class="fas fa-exclamation-triangle"></i> 建议降仓至 60%</div>';
  }

  // BUG-6 修复：明确显示"连续亏损"而非"连亏"，并补充总亏损笔数（当日口径，无重复计数）
  subEl.innerHTML = tag + '  连续亏损 ' + streak + ' 笔（当日共 ' + totalLossCount + ' 笔亏损）' + tip;

  var card = document.getElementById('dashLossStreak');
  if (card) {
    card.className = card.className.replace(/\bstatus-\w+/g, '');
    card.classList.add(streak <= 1 ? 'status-positive' : (streak === 2 ? 'status-warning' : 'status-negative'));
  }
}

// ==================== 卡片 5：强平预警 ====================
function _renderLiqWarn() {
  var openLogs = _getOpenLogs();
  var listEl = document.getElementById('dashLiqList');

  if (openLogs.length === 0) {
    listEl.innerHTML = '<span style="color:var(--color-text-muted);font-size:var(--font-sm);">无持仓</span>';
    return;
  }

  var warnings = [];
  // P2-12：有杠杆但未设置止损的仓位——无法计算强平距离，不计入"安全"数量
  var noSlPositions = [];

  for (var i = 0; i < openLogs.length; i++) {
    var log = openLogs[i];
    var lev = log.leverage || 0;
    if (lev <= 0) continue; // 现货无强平

    var entry = log.entryPrice;
    var sl = log.stopLoss;
    // P2-12 FIX：原实现此处 continue 只考虑除零防御，没有"跳过即安全"的语义补偿，
    // 50x 多单不填止损也会落到"所有仓位安全"。这类仓位单独收集，保持"有止损才算强平距离"的原逻辑
    if (sl == null || isNaN(sl) || sl <= 0) {
      noSlPositions.push(log);
      continue;
    }
    var dir = log.direction;

    // 强平价：统一使用 utils.calcLiquidationPrice；MMR 走 loadMmr() 统一读取
    //（mmr = 0 / NaN 会让强平价退化为零缓冲或 NaN，三面板必须同一口径）
    var mmr = loadMmr();
    var liqPrice = window.utils.calcLiquidationPrice(entry, dir, lev, mmr);
    if (isNaN(liqPrice) || liqPrice <= 0) continue; // 强平价无效跳过

    // 前置校验：止损价方向必须正确（long: sl < entry, short: sl > entry）
    var slDirectionValid;
    if (dir === 'long') {
      slDirectionValid = sl < entry;
    } else {
      slDirectionValid = sl > entry;
    }
    if (!slDirectionValid) {
      // 止损方向错误，直接报警
      warnings.push({
        symbol: log.symbol,
        stopLoss: sl,
        liqPrice: liqPrice,
        distance: 0,
        direction: dir,
        note: '止损方向错误'
      });
      continue;
    }

    // 检查止损是否在强平价之外（安全方向）
    var isSafe;
    var distance;
    if (dir === 'long') {
      // 做多：止损价 > 强平价 才安全
      isSafe = sl > liqPrice;
      distance = liqPrice > 0 ? ((sl - liqPrice) / entry * 100) : 0;
    } else {
      // 做空：止损价 < 强平价 才安全
      isSafe = sl < liqPrice;
      distance = liqPrice > 0 ? ((liqPrice - sl) / entry * 100) : 0;
    }

    if (!isSafe) {
      warnings.push({
        symbol: log.symbol,
        stopLoss: sl,
        liqPrice: liqPrice,
        distance: distance,
        direction: dir
      });
    }
  }

  // P2-12 FIX：无止损的杠杆仓位给出独立警示，不计入"所有仓位安全"
  var noSlHtml = '';
  if (noSlPositions.length > 0) {
    noSlHtml = '<div style="padding:6px 10px;background:var(--color-warning-bg);border-left:3px solid var(--color-warning);border-radius:var(--radius-xs);color:var(--color-warning);font-size:var(--font-sm);">' +
      '<i class="fas fa-exclamation-triangle"></i> ' + noSlPositions.length + ' 个杠杆仓位未设置止损，无法计算强平距离</div>';
  }
  var safeHtml = '<span class="liq-safe"><i class="fas fa-check-circle"></i> ' +
    (noSlPositions.length > 0 ? '已设止损的仓位安全' : '所有仓位安全') + '</span>';

  if (warnings.length === 0) {
    listEl.innerHTML = noSlHtml + safeHtml;
    var card = document.getElementById('dashLiqWarn');
    card.className = card.className.replace(/\bstatus-\w+/g, '');
    card.classList.add(noSlPositions.length > 0 ? 'status-warning' : 'status-positive');
    return;
  }

  var html = '';
  for (var j = 0; j < warnings.length; j++) {
    var w = warnings[j];
    // 额外防御：NaN 值不直接显示
    if (isNaN(w.stopLoss) || isNaN(w.liqPrice)) continue;
    var distText = isNaN(w.distance) ? '' : ' (' + Number(w.distance).toFixed(1) + '%)';
    var noteText = w.note ? ' <span style="color:var(--color-danger);">[' + esc(w.note) + ']</span>' : '';
    html += '<div class="liq-item">' +
      '<span class="liq-item-symbol">' + esc(w.symbol) + ' (' + (w.direction === 'long' ? '多' : '空') + ')</span>' +
      '<span class="liq-item-distance">止损 ' + Number(w.stopLoss).toFixed(5) + ' / 强平 ' + Number(w.liqPrice).toFixed(5) + distText + '</span>' +
      noteText +
    '</div>';
  }
  listEl.innerHTML = html + noSlHtml;
  var card = document.getElementById('dashLiqWarn');
  card.className = card.className.replace(/\bstatus-\w+/g, '');
  card.classList.add('status-negative');
}

// ==================== 卡片 6：资金曲线缩略图 ====================

function _renderEquityChart() {
  const closed = getClosedLogs();
  const canvas = document.getElementById('dashEquityChart');
  
  if (!canvas) {
    console.warn('资金曲线图表Canvas元素未找到');
    return;
  }
  
  const ctx = canvas.getContext('2d');
  // getContext 在极端情况下会返回 null（上下文数量超限 / 上下文创建失败）。
  // 此处不守卫的话，下面的 ctx.scale 会抛出并冒泡到 switchView，
  // 导致整个仪表盘渲染中断（不只是这张图不出来）。
  if (!ctx) { console.warn('资金曲线图表无法获取 2D 上下文，跳过绘制'); return; }
  // 处理 DPR 保证 Retina 屏幕清晰度
  const dpr = window.devicePixelRatio || 1;
  
  // FIX #10: Use reasonable dimensions even when hidden/initially zero width
  let rectWidth = 600, rectHeight = 200;
  if (canvas.parentElement) {
    const parentRect = canvas.parentElement.getBoundingClientRect();
    rectWidth = parentRect.width || 600;
    rectHeight = Math.max(parentRect.height || 200, 200);
  }
  canvas.style.width = rectWidth + 'px';
  canvas.style.height = rectHeight + 'px';
  canvas.width = rectWidth * dpr;
  canvas.height = rectHeight * dpr;
  ctx.scale(dpr, dpr);

  // ===== 使用ChartManager进行专业生命周期管理 =====
  const CHART_KEY = 'dashboard_equity_chart';

  // 安全清理：直接销毁绑定在此 Canvas 上的任何旧 Chart 实例
  // 使用同步销毁而非 ChartManager 的 1000ms 延迟，避免 Canvas 被占用时报错
  if (canvas._chart && typeof canvas._chart.destroy === 'function') {
    canvas._chart.destroy();
  }
  // 同时清理 ChartManager 注册（立即销毁，不走延迟队列）
  // 仅在确有注册时 unregister：首次渲染 / 无平仓数据时 key 从未注册，
  // 直接调会打出「Chart实例不存在」的无意义告警
  if (window.ChartManager && window.ChartManager.getInstance(CHART_KEY)) {
    window.ChartManager.unregister(CHART_KEY, true);
  }

  const curve = window.utils.calcEquityCurve(closed);
  // P3-13 FIX：排序键与 utils.calcEquityCurve 对齐（closeTime || time）——
  // 原实现只看 closeTime，缺 closeTime 的已平仓记录 x 轴日期与权益值会错位
  const sorted = closed.slice().sort(function(a, b) {
    const ta = new Date(a.closeTime || a.time).getTime();
    const tb = new Date(b.closeTime || b.time).getTime();
    return ta - tb;
  });

  // P3-13 FIX：占位/报错文字改读主题色（原 #ffffff / #ff4444 在浅色主题下基本不可见）
  const cc = utils.getChartColors();

  if (sorted.length === 0) {
    // 绘制占位文字（使用 CSS 像素坐标，因为 ctx 已缩放）
    ctx.clearRect(0, 0, rectWidth, rectHeight);
    ctx.fillStyle = cc.canvasText; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillText('暂无交易数据', rectWidth / 2, rectHeight / 2);
    return;
  }

  // 使用统一权益曲线计算结果
  const labels = [];
  const data = [];
  for (let i = 0; i < curve.data.length; i++) {
    const d = new Date(sorted[i].closeTime || sorted[i].time);
    labels.push(
      d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2)
    );
    data.push(curve.data[i].eq);
  }

  // 正/负分段颜色
  const pointColors = [];
  for (let j = 0; j < sorted.length; j++) {
    pointColors.push((sorted[j].pnlAmount || 0) >= 0 ? cc.positivePoint : cc.negativePoint);
  }

  try {
    // 创建新的Chart实例
    const chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '权益 (USDT)',
        data: data,
        borderColor: cc.barBorder,
        backgroundColor: function(context) {
          var chart = context.chart;
          var ctx2 = chart.ctx;
          var gradient = ctx2.createLinearGradient(0, 0, 0, chart.height);
          // P3-18 FIX（越出清单，同 analytics.js:202 的同类硬编码蓝渐变，一并改为主题色）
          gradient.addColorStop(0, withAlpha(cc.barWin, 0.25));
          gradient.addColorStop(1, withAlpha(cc.barWin, 0.02));
          return gradient;
        },
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: pointColors,
        // P3-19 FIX：原 'rgba(255,255,255,0.6)' 硬编码——浅色主题下白点边框在白卡片上消失；
        // 改读 --chart-canvas-ptcenter（与 chart-factory.js 散点图同一口径）
        pointBorderColor: readCssVar('--chart-canvas-ptcenter', 'rgba(255,255,255,0.6)'),
        pointBorderWidth: 1.5,
        fill: true,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: cc.tickColor,
            font: { size: 12 },
            usePointStyle: true,
            pointStyleWidth: 12,
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipTitle,
          bodyColor: cc.tooltipBody,
          borderColor: cc.gridColor,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(ctx) {
              return '权益: ' + (ctx.raw != null ? ctx.raw.toFixed(2) + ' USDT' : '—');
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: {
            font: { size: 11 },
            color: cc.tickColor,
            maxTicksLimit: 8,
            maxRotation: 0
          }
        },
        y: {
          display: true,
          grid: {
            color: cc.gridColor
          },
          ticks: {
            font: { size: 11 },
            color: cc.tickColor,
            callback: function(v) { return v.toFixed(0); }
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      }
    }
  });
  
  // 使用ChartManager注册实例，确保正确的生命周期管理
  if (window.ChartManager) {
    const registerSuccess = window.ChartManager.register(
      'dashboard_equity_chart', 
      chartInstance, 
      canvas,
      {
        type: 'equity_curve',
        page: 'dashboard',
        dataPoints: sorted.length,
        createdBy: '_renderEquityChart'
      }
    );
    
    if (!registerSuccess) {
      console.error('资金曲线图表注册失败，执行紧急销毁');
      chartInstance.destroy();
    }
  } else {
    console.warn('ChartManager不可用，使用传统方式管理图表实例');
    // 降级方案：传统的全局变量管理
    window._dashEquityChart = chartInstance;
  }
  
  } catch (error) {
    console.error('创建资金曲线图表失败:', error);
    
    // 错误情况下确保清理
    if (window.ChartManager) {
      window.ChartManager.unregister('dashboard_equity_chart', true);
    }
    
    // 绘制错误提示（P3-13 FIX：原 #ff4444 硬编码，浅色主题下偏淡，改读主题色）
    ctx.fillStyle = cc.barLoss; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '14px sans-serif';
    ctx.fillText('图表创建失败', rectWidth/2, rectHeight/2);
  }
}

// ==================== 主导出函数 ====================
function renderDashboard() {
  _renderTodayPnl();
  _renderWinRate();
  _renderRiskExposure();
  _renderLossStreak();
  _renderLiqWarn();
  _renderEquityChart();
}
