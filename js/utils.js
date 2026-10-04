// ==================== 工具函数库 ====================
// 全局挂载：window.utils = { ... }
// 依赖：全局变量 logs（由 trading.html 内联脚本或 storage.js 定义）

(function() {
  var util = {};

  // ======== 来自 risk.js ========
  /**
   * P0-1 判定：一条日志是否为"最终平仓"（整笔交易已全部退出）。
   * partialTP / reducePosition 是部分平仓中间态，剩余仓位仍属持仓，
   * 只有全部平仓后才进入"已平仓"统计（胜率/资金曲线/日盈亏/凯利样本）。
   * @param {Object} item 日志对象
   * @returns {boolean}
   */
  util.isClosedTrade = function(item) {
    if (!item || !item.closeType || item.closeType === '') return false;
    if (item.pnlAmount == null || isNaN(parseFloat(item.pnlAmount))) return false;
    if (item.closeType === 'partialTP' || item.closeType === 'reducePosition') {
      // 新格式：以累计平仓比例判定；旧格式一律视为中间态（剩余仓位回归持仓监控）
      if (Array.isArray(item.closes)) {
        var cr = parseFloat(item.closedRatio);
        return !isNaN(cr) && cr >= 99.999;
      }
      return false;
    }
    return true;
  };

  /**
   * P0-1 判定：是否为"部分平仓"中间态（有剩余仓位在持仓监控中）
   * @param {Object} item 日志对象
   * @returns {boolean}
   */
  util.isPartialClosed = function(item) {
    if (!item || !item.closeType) return false;
    if (item.closeType === 'partialTP' || item.closeType === 'reducePosition') {
      if (Array.isArray(item.closes)) {
        var cr = parseFloat(item.closedRatio);
        return !isNaN(cr) && cr > 0 && cr < 99.999;
      }
      return true;
    }
    return false;
  };

  /**
   * 平仓簿记同步（单一事实来源，P1 修复 2026-10-03）。
   * 编辑平仓类型 / 分批比例后，让 item.closedRatio 与 item.closes 自洽：
   *   sum(closes[].ratio) === closedRatio。
   * 下游读的是这两个字段，**不是 partialRatio**：
   *   - isClosedTrade / isPartialClosed 用 closedRatio 判持仓状态（并看 closes 是否为数组）
   *   - confirmClose（logs.js）用 closedRatio 算 ratioFinal = 100 - closedRatio
   *   - CSV 导出原样 JSON.stringify(closes)，closes 是逐次平仓的审计链
   * 所以比例被编辑后必须同步，否则下一次部分平仓会在新旧比例之间错误叠加，
   * 最终平仓的 ratioFinal 也会套在错误的剩余比例上。
   * @param {Object} item 日志条目（就地修改）
   * @param {string} closeType 保存后的平仓类型
   * @param {number|null} partialRatio 分批比例（0<r<100）；非分批类型或无比例时传 null
   * @returns {Object} item
   */
  util.syncCloseBookkeeping = function(item, closeType, partialRatio) {
    if (!item) return item;
    // 没有有效平仓类型就不做簿记。modals.js 的平仓类型下拉有 <option value="">—</option>，
    // 用户把它选成「—」是在主动取消平仓标记；若空值走到下面的「非分批类型」分支，会把
    // closedRatio 强设成 100、并把 closes[] 整链清空，而 isClosedTrade 首行又因 closeType
    // 为空判「未平仓」——于是留下「closedRatio=100 + 未平仓 + 剩余敞口仍在」的悬空记录，
    // 本来想撤销平仓标记却把分批簿记毁掉了。护栏放在权威实现里，任何调用方都安全。
    if (!closeType || typeof closeType !== 'string') return item;
    var PARTIAL_TYPES = ['partialTP', 'reducePosition'];
    var clamp4 = function(x) { return parseFloat(Math.max(0, Math.min(100, x)).toFixed(4)); };
    var evts = Array.isArray(item.closes) ? item.closes.slice() : [];

    if (PARTIAL_TYPES.indexOf(closeType) >= 0) {
      var r = parseFloat(partialRatio);
      if (!(r > 0 && r < 100)) {
        // 无有效比例：本次不产生部分平仓簿记，保持原有 closedRatio/closes 不变
        delete item.partialRatio;
        return item;
      }
      // closes 里 type 非分批的"收尾"事件（confirmClose 的最终平仓）在改成分批类型后
      // 不再成立，一并移除——否则 closedRatio 仍会算到 100，与剩余仓位自相矛盾。
      var partials = evts.filter(function(e) { return PARTIAL_TYPES.indexOf(e.type) >= 0; });
      if (partials.length > 0) {
        // 有事件簿记：只换最后一次部分平仓事件的 ratio，其余历史不动
        partials[partials.length - 1].ratio = r;
      } else {
        // 无部分平仓事件簿记（首次 / 旧数据 / CSV 导入）：本次即第一条。
        // 带 type，保证下次编辑仍被识别为分批事件，且 CSV 往返后可重建。
        partials.push({ type: closeType, ratio: r });
      }
      item.closes = partials;
      item.closedRatio = clamp4(partials.reduce(function(s, c) {
        return s + (parseFloat(c.ratio) || 0);
      }, 0));
      item.partialRatio = r;
      return item;
    }

    // 非分批类型 = 断言整笔已退出：closedRatio 必须是 100（对齐 logs.js 收尾口径）。
    // 此前清成 0，会让"已平仓"记录的 CSV 导出显示 0% 已平，口径与 pnlAmount 脱节。
    delete item.partialRatio;
    // 收尾事件必须写成 closes 的最后一条，而不是清空整链。清空同时坏在两处：
    //   ① 本函数 JSDoc 声明的不变量 sum(closes[].ratio) === closedRatio 变成 0 === 100，
    //      且分批历史从 CSV 往返里彻底消失、无法恢复；
    //   ② modals.js 靠 closes 判断「这条记录曾经分批」——清空后判定失效，收尾编辑就
    //      走「剩余仓位单腿重算」，把之前已实现的盈亏整段覆盖掉（少记 79%）。
    // 收尾比例 = 100 − 已平之和；先只保留分批事件再求缺口，避免脏数据里已存在的
    // 收尾事件被重复追加（PARTIAL_TYPES 分支对收尾事件也是同样处理）。
    var partialEvts = evts.filter(function(e) {
      return PARTIAL_TYPES.indexOf(e.type) >= 0;
    });
    var closedSum = parseFloat(partialEvts.reduce(function(s, e) {
      return s + (parseFloat(e.ratio) || 0);
    }, 0).toFixed(4));
    item.closedRatio = 100;
    if (closedSum < 99.999) {
      partialEvts.push({ type: closeType, ratio: clamp4(100 - closedSum) });
    }
    item.closes = partialEvts;
    return item;
  };

  /**
   * 把「占当前剩余仓位」的平仓比例换算成「占开仓原始仓位」的比例增量。
   *
   * 唯一权威换算。两个基数在本系统里并存：
   *   - 金额口径（盈亏/费用/保证金）按当前剩余仓位计价，用户输入的比例也是相对剩余仓位；
   *   - 簿记口径（closedRatio、closes[].ratio）按开仓原始仓位计，
   *     满足不变量 sum(closes[].ratio) === closedRatio，且 fully closed 时为 100。
   * 直接相加会把「剩余的 50%」当成「原始的 50%」，两次及以上部分平仓时 closedRatio
   * 虚高到 100、被判为已全额平仓，而 positionSize 仍有余额——那部分敞口既不进持仓
   * 统计也不产生已实现盈亏。首次部分平仓时 frac=1，返回输入值，历史行为不变。
   *
   * @param {number} partialRatioOfRemaining 用户输入的比例（% of 当前剩余仓位），0<r<100
   * @param {number} remainingSize 本次操作前的剩余仓位数量
   * @param {number} initialSize   开仓原始仓位数量
   * @returns {number} 应累加进 closedRatio 的 % 增量（占原始仓位）
   */
  util.closedRatioDelta = function(partialRatioOfRemaining, remainingSize, initialSize) {
    var r = parseFloat(partialRatioOfRemaining);
    var rem = parseFloat(remainingSize);
    var ini = parseFloat(initialSize);
    if (!Number.isFinite(r)) return 0;
    if (!Number.isFinite(rem) || rem <= 0) return 0;
    if (!Number.isFinite(ini) || ini <= 0) return r;   // 无原始仓位基准时按 1:1 处理
    var frac = Math.min(1, Math.max(0, rem / ini));
    return parseFloat((r * frac).toFixed(4));
  };

  /**
   * P2 修复：记录一次止损移动。
   *
   * 为什么不用 closes[]：closes[] 是平仓簿记账本，syncCloseBookkeeping() 会按 type 过滤
   * 分批事件并重建整个数组（item.closes = partials），非分批事件写进去下次编辑就被丢弃；
   * 而且它参与不变量 sum(closes[].ratio) === closedRatio，动一下就会污染已平仓比例。
   * 止损移动不是减仓，不该进这个账本。这里用独立的 stopHistory 时间线保存轨迹。
   *
   * 副作用只有两个：① 追加一条轨迹；② 把 item.stopLoss 更新为新值——dashboard 的持仓
   * 监控与「止损 vs 强平」距离都读 log.stopLoss，不更新就仍在用旧止损，风险展示是错的。
   * R 倍数基准是 initialRiskAmount（开仓即锁定），此处不动，R 口径不变。
   *
   * @param {Object} item       日志记录
   * @param {number} newPrice   新止损价
   * @param {string} timeIso    动作时间（ISO）
   * @param {string} note       备注
   * @returns {{recorded: boolean, skipped: string, stop: number}}
   */
  util.recordStopMove = function(item, newPrice, timeIso, note) {
    var p = parseFloat(newPrice);
    var out = { recorded: false, skipped: '', stop: parseFloat(item && item.stopLoss) };
    if (!item) { out.skipped = '记录不存在'; return out; }
    if (!Number.isFinite(p) || p <= 0) { out.skipped = '止损价无效'; return out; }

    // 首次移动时把原始止损补成时间线的第一条，保证轨迹完整。
    // 判据是「时间线为空」而不是「字段不存在」：CSV 导入会得到 stopHistory: []，
    // 只判字段缺失会让第一次移动直接丢掉开仓时的原始止损。幂等：已有起点则不重复补。
    var hist = Array.isArray(item.stopHistory) ? item.stopHistory.slice() : [];
    if (hist.length === 0) {
      var initStop = parseFloat(item.stopLoss);
      if (Number.isFinite(initStop) && initStop > 0) {
        hist.push({ price: initStop, time: item.time || null, note: '初始止损' });
      }
    }
    var last = hist.length ? hist[hist.length - 1] : null;
    // P2 修复（2026-10-04）：幂等判据必须比「当前止损」而不是「时间线末条」。
    // 时间线末条只反映 recordStopMove 自己写过的点；用户用编辑弹窗直改 item.stopLoss
    // （modals.js 的 emStopLoss 不写 stopHistory）后两者就会分叉。此时再移动止损是
    // 【真实变化】，按末条比较会把它判成「无需记录」，留下 stopLoss 与时间线长期
    // 不一致——而仪表盘持仓监控与「止损 vs 强平」距离读的是 stopLoss。
    // stopLoss 缺失或无效时才退回末条（例如旧数据只有时间线没有 stopLoss）。
    var currentStop = parseFloat(item.stopLoss);
    if (!Number.isFinite(currentStop) || currentStop <= 0) {
      currentStop = last ? parseFloat(last.price) : NaN;
    }
    if (Number.isFinite(currentStop) && Math.abs(currentStop - p) < 1e-12) {
      out.skipped = '新止损与当前止损相同（' + currentStop.toFixed(5) + '），无需记录';
      out.stop = p;
      return out;
    }
    hist.push({ price: p, time: timeIso || new Date().toISOString(), note: note || '' });
    item.stopHistory = hist;
    item.stopLoss = p;
    out.recorded = true;
    out.stop = p;
    return out;
  };

  /**
   * 获取按平仓时间排序的"最终平仓"日志（整笔交易已全部退出，pnlAmount 为整笔累计已实现盈亏）
   * @returns {Array} 已平仓日志数组（按 closeTime 升序）
   */
  util.getClosedSorted = function() {
    var closed = [];
    for (var i = 0; i < logs.length; i++) {
      if (util.isClosedTrade(logs[i])) {
        var item = Object.assign({}, logs[i]);
        item.pnlAmount = parseFloat(item.pnlAmount);
        closed.push(item);
      }
    }
    closed.sort(function(a, b) {
      var ta = a.closeTime ? new Date(a.closeTime).getTime() : 0;
      var tb = b.closeTime ? new Date(b.closeTime).getTime() : 0;
      return ta - tb;
    });
    return closed;
  };

  // ======== 来自 analytics.js ========
  /**
   * 格式化 ISO 日期字符串为 yyyy-MM-dd
   * @param {string} isoStr - ISO 日期字符串
   * @returns {string} 格式化的日期字符串
   */
  util.fmtDate = function(isoStr) {
    if (!isoStr) return '—';
    var d = new Date(isoStr);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  };

  /**
   * 安全解析数字，失败返回 null
   * @param {*} val - 待解析的值
   * @returns {number|null} 解析后的数字或 null
   */
  util.safeParseNum = function(val) {
    if (val == null || val === '') return null;
    var n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  // ======== 来自 storage.js ========
  /**
   * 时间格式化（兼容 ISO / locale）
   * @param {string} t - 时间字符串
   * @returns {string} 格式化的时间字符串 yyyy-MM-dd HH:mm
   */
  util.fmtTime = function(t) {
    if (!t) return '';
    var d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0') + ' ' +
      String(d.getHours()).padStart(2,'0') + ':' +
      String(d.getMinutes()).padStart(2,'0');
  };

  /**
   * 旧版 zh-CN locale 时间 → ISO 字符串
   * @param {string} t - 时间字符串
   * @returns {string} ISO 格式时间字符串
   */
  util._localeToISO = function(t) {
    if (!t || t.indexOf('T') !== -1) return t;
    var m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') +
      'T' + m[4].padStart(2, '0') + ':' + m[5].padStart(2, '0') + ':' + m[6].padStart(2, '0') + '.000Z';
    return t;
  };

  /**
   * 持仓时长格式化
   * @param {string} closeTime - 平仓时间
   * @param {string} openTime - 开仓时间
   * @returns {string} 格式化的持仓时长
   */
  util.formatHoldDuration = function(closeTime, openTime) {
    if (!closeTime || !openTime) return '—';
    try {
      var diffMs = new Date(closeTime) - new Date(openTime);
      if (isNaN(diffMs) || diffMs < 0) return '—';
      var totalMin = Math.round(diffMs / 60000);
      if (totalMin < 60) return totalMin + 'm';
      var hrs = Math.floor(totalMin / 60);
      var mins = totalMin % 60;
      if (hrs < 24) return hrs + 'h' + (mins > 0 ? ' ' + mins + 'm' : '');
      var days = Math.floor(hrs / 24);
      var remainHrs = hrs % 24;
      return days + 'd' + (remainHrs > 0 ? ' ' + remainHrs + 'h' : '');
    } catch(e) { return '—'; }
  };

  // ======== 共享公式 ========
  /**
   * USDT-M 逐仓强平价格（标准公式，参考主流交易所）
   * 公式来源: 币安/OKX/火币等主流期货交易所标准
   * Long:  LP = Entry × (1 - InitialMargin% + MMR%) / (1 - MMR%)
   * Short: LP = Entry × (1 + InitialMargin% - MMR%) / (1 + MMR%)
   * 其中: InitialMargin% = 1/leverage, MMR% = 维持保证金率
   * @param {number} entryPrice - 入场价
   * @param {string} direction - 'long' | 'short'
   * @param {number} leverage - 杠杆倍数
   * @param {number} mmr - 维持保证金率（小数，如 0.005 表示 0.5%）
   * @returns {number} 强平价格
   */
  util.calcLiquidationPrice = function(entryPrice, direction, leverage, mmr) {
    // 参数验证
    if (!entryPrice || entryPrice <= 0) {
      console.error('calcLiquidationPrice: invalid entryPrice', entryPrice);
      return NaN;
    }
    if (!leverage || leverage <= 0) {
      console.error('calcLiquidationPrice: invalid leverage', leverage);
      return NaN;
    }
    if (mmr == null || mmr < 0) {
      console.error('calcLiquidationPrice: invalid mmr', mmr);
      return NaN;
    }
    
    // 初始保证金率 = 1/杠杆
    const initialMarginRatio = 1 / leverage;

    let liquidationPrice;
    if (direction === 'long') {
      // BUG 修复：使用币安/OKX 标准强平价格公式
      // 正确公式: LP = Entry × (1 - IMR + MMR) / (1 - MMR)
      // 原公式缺少 MMR 修正项，导致强平价被低估约 MMR% (约 0.5%)
      liquidationPrice = entryPrice * (1 - initialMarginRatio + mmr) / (1 - mmr);

      // 合理性检查：多头强平价应低于入场价
      if (liquidationPrice >= entryPrice) {
        console.warn('calcLiquidationPrice: long liquidation price >= entry price, check parameters');
      }
    } else if (direction === 'short') {
      // 正确公式: LP = Entry × (1 + IMR - MMR) / (1 + MMR)
      liquidationPrice = entryPrice * (1 + initialMarginRatio - mmr) / (1 + mmr);

      // 合理性检查：空头强平价应高于入场价
      if (liquidationPrice <= entryPrice) {
        console.warn('calcLiquidationPrice: short liquidation price <= entry price, check parameters');
      }
    } else {
      console.error('calcLiquidationPrice: invalid direction', direction);
      return NaN;
    }
    
    // 防止负数和异常值
    if (!isFinite(liquidationPrice) || liquidationPrice <= 0) {
      console.error('calcLiquidationPrice: calculated invalid liquidation price', liquidationPrice);
      return NaN;
    }
    
    return liquidationPrice;
  };

  // ======== 日频夏普比率（单一权威实现，可单测） ========
  /**
   * 按平仓日聚合日盈亏，并按「首笔平仓 → 末笔平仓」逐日铺满后计算夏普。
   *
   * 两处口径要点（历史上都让夏普被系统性高估，故收敛为唯一实现）：
   * ① 空闲日必须计入。只取「有平仓的交易日」会把持有中无平仓的日子整段丢弃，
   *    持有 20 天只在其中 3 天平仓的账户会按 3 天算，波动率被低估、夏普被抬高。
   *    本实现从首日铺到末日，无平仓日记 0。
   * ② 年化系数默认 365：本站交易的是 7×24 永续合约，不是 A 股/美股，
   *    按 252 折算会把年化低估约 31%。
   *
   * 标准差用总体口径（样本即全部观测日，不做 n-1 无偏修正）。
   *
   * @param {Array} closed  已平仓日志数组（需含 closeTime、pnlAmount）
   * @param {Object} [opt]  { annualDays: number } 年化天数，默认 365
   * @returns {{sharpe:number,days:number,zeroDays:number,mean:number,sd:number}|null}
   *          有效日数 < 2 或标准差为 0 时返回 null（调用方显示「—」）
   */
  util.dailySharpe = function(closed, opt) {
    opt = opt || {};
    var annualDays = Number.isFinite(opt.annualDays) && opt.annualDays > 0 ? opt.annualDays : 365;
    var arr = Array.isArray(closed) ? closed : [];
    var dayMap = {}, minT = null, maxT = null;
    for (var i = 0; i < arr.length; i++) {
      var t = new Date(arr[i] && arr[i].closeTime).getTime();
      if (isNaN(t)) continue;
      var pnl = parseFloat(arr[i].pnlAmount);
      if (!isFinite(pnl)) continue;
      var dk = util.toLocalDateStr(arr[i].closeTime);
      if (!dk) continue;
      dayMap[dk] = (dayMap[dk] || 0) + pnl;
      if (minT === null || t < minT) minT = t;
      if (maxT === null || t > maxT) maxT = t;
    }
    // 铺满空闲日：按本地日界线逐日推进，避免 86400000ms 步进在 DST 边界重复或漏日
    var zeroDays = 0;
    if (minT !== null && maxT > minT) {
      var cursor = new Date(minT);
      cursor.setHours(0, 0, 0, 0);
      var end = new Date(maxT);
      end.setHours(0, 0, 0, 0);
      while (cursor.getTime() <= end.getTime()) {
        var ck = util.toLocalDateStr(cursor.toISOString());
        if (dayMap[ck] === undefined) { dayMap[ck] = 0; zeroDays++; }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    var vals = Object.keys(dayMap).map(function(k) { return dayMap[k]; });
    if (vals.length < 2) return null;
    var mean = 0;
    for (var a = 0; a < vals.length; a++) mean += vals[a];
    mean /= vals.length;
    var sumSq = 0;
    for (var b = 0; b < vals.length; b++) sumSq += Math.pow(vals[b] - mean, 2);
    var sd = Math.sqrt(sumSq / vals.length);
    if (sd <= 0) return null;
    return {
      sharpe: mean / sd * Math.sqrt(annualDays),
      days: vals.length,
      zeroDays: zeroDays,
      mean: mean,
      sd: sd
    };
  };

  // ======== 本地日期字符串（统一口径） ========
  /**
   * ISO 字符串 → YYYY-MM-DD（本地时区）
   * @param {string} isoStr - ISO 时间字符串
   * @returns {string} YYYY-MM-DD 格式日期，非法输入返回空串
   */
  util.toLocalDateStr = function(isoStr) {
    if (!isoStr) return '';
    // 优先尝试 ISO 格式解析
    var d = new Date(isoStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
    // 兼容旧格式：YYYY/MM/DD HH:mm:ss 或 YYYY-MM-DD HH:mm:ss
    var m = String(isoStr).match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (m) {
      return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    }
    return '';
  };

  // ======== 日志唯一标识 ========
  /**
   * 生成日志记录的唯一 id（时间戳前缀 + 随机尾巴）。
   *
   * 历史背景：日志一直靠「数组索引」寻址（data-idx、_pendingDeleteIndices、
   * openClosePanelIdx 等），记录本身没有任何稳定标识。两个后果：
   *   1. storage.js 的 _logFingerprint 读 item.id 永远得到 undefined，v3→v4 去重指纹退化；
   *   2. 导入/导出/合并后无法判断两条记录是不是同一笔交易。
   *
   * id 只做「身份」用途——不参与计算、排序、风控校验，也不能当作寻址手段
   * （删除记录后索引仍会变）。因此为存量记录回填 id 对既有逻辑零影响。
   *
   * @param {Array} [logs] 当前日志数组；给定时保证返回值在数组内唯一
   * @returns {string} 形如 'lg_20261004T074503_8k3n2a'
   */
  util.genLogId = function(logs) {
    var taken = Object.create(null);
    if (Array.isArray(logs)) {
      for (var i = 0; i < logs.length; i++) {
        var eid = logs[i] && logs[i].id;
        if (typeof eid === 'string' && eid) taken[eid] = true;
      }
    }
    var d = new Date();
    var stamp = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') +
      'T' +
      String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0') +
      String(d.getSeconds()).padStart(2, '0');
    var id = '';
    for (var g = 0; g < 50; g++) {
      id = 'lg_' + stamp + '_' + Math.random().toString(36).slice(2, 8);
      if (!taken[id]) break;
    }
    return id;
  };

  // ======== 已平仓交易判断（统一过滤条件） ========
  // isClosedTrade 的权威定义在文件头部（第 16 行附近）。此处曾有一份逐字相同的重复定义，
  // 靠"后赋值覆盖"保持语义一致——历史上已实际漂移过一次，且掩盖了"该改哪一份"的歧义。
  // 已删除，保留单一实现。

  /**
   * 计算权益曲线数据 — 供 stats.js / dashboard.js 统一调用
   * @param {Array} closed - 已平仓日志（需已按 closeTime 排序）
   * @param {Object} [settingsOverride] - 可选，覆盖 accountBalance
   * @returns {{ data: Array<{eq:number, pnl:number, label:string}>,
   *             initCap: number, peakVal: number, maxDDPercent: number,
   *             finalEq: number, totalPnl: number }}
   */
  util.calcEquityCurve = function(closed, settingsOverride, opts) {
    opts = opts || {};
    if (!closed || closed.length === 0) {
      return { data: [], initCap: 0, peakVal: 0, maxDDPercent: 0, finalEq: 0, totalPnl: 0 };
    }

    var sorted = [].concat(closed).sort(function(a, b) {
      return new Date(a.closeTime || a.time) - new Date(b.closeTime || b.time);
    });

    var _initCap = 0;
    if (opts.purePnl) {
      _initCap = 0;
    } else {
      // BUG#7 修复：优先使用设置中的账户余额作为权益曲线起点，避免首笔日志 capital 快照偏移导致曲线失真
      var bal = (settingsOverride && settingsOverride.accountBalance > 0) ? settingsOverride.accountBalance : 0;
      if (!bal) {
        try { var _s = loadSettings(); if (_s && _s.accountBalance > 0) bal = _s.accountBalance; } catch(e) { console.error('[utils]', e); }
      }
      if (bal > 0) _initCap = bal;
      else if (sorted.length > 0 && sorted[0].capital != null && !isNaN(sorted[0].capital) && sorted[0].capital > 0) {
        _initCap = sorted[0].capital;
      }
    }

    var data = [], cum = _initCap, peakVal = _initCap, maxDD = 0;
    for (var i = 0; i < sorted.length; i++) {
      var l = sorted[i];
      // capital 是开仓时的账户快照，不能在每次平仓时被当作“当前权益”覆盖累计 PnL。
      // 仅支持显式的 balanceAdjustment 作为未来存取款流水；未提供时权益严格连续累加已实现盈亏。
      var balanceAdjustment = Number(l.balanceAdjustment);
      if (!opts.purePnl && Number.isFinite(balanceAdjustment) && balanceAdjustment !== 0) cum += balanceAdjustment;
      var pnl = Number(l.pnlAmount);
      if (Number.isFinite(pnl)) cum += pnl;
      data.push({ eq: cum, pnl: Number.isFinite(pnl) ? pnl : 0, idx: data.length + 1 });
      peakVal = Math.max(peakVal, cum);
      maxDD = peakVal > 0 ? Math.max(maxDD, (peakVal - cum) / peakVal * 100) : maxDD;
    }

    var totalPnl = cum - _initCap;
    return {
      data: data,
      initCap: _initCap,
      peakVal: peakVal,
      maxDDPercent: maxDD,
      finalEq: cum,
      totalPnl: totalPnl
    };
  };

  // ======== 主题感知 Chart.js / Canvas 颜色桥接 ========
  /**
   * 从 CSS 变量读取当前主题的 Chart.js 配置颜色
   * @returns {{tooltipBg, tooltipTitle, tooltipBody, gridColor, tickColor, axisTitle, legendText, barBorder, positivePoint, negativePoint}}
   */
  util.getChartColors = function() {
    var style = getComputedStyle(document.documentElement);
    return {
      tooltipBg:     style.getPropertyValue('--chart-tooltip-bg').trim(),
      tooltipTitle:  style.getPropertyValue('--chart-tooltip-title').trim(),
      tooltipBody:   style.getPropertyValue('--chart-tooltip-body').trim(),
      gridColor:     style.getPropertyValue('--chart-grid-color').trim(),
      tickColor:     style.getPropertyValue('--chart-tick-color').trim(),
      axisTitle:     style.getPropertyValue('--chart-axis-title').trim(),
      legendText:    style.getPropertyValue('--chart-legend-text').trim(),
      barBorder:     style.getPropertyValue('--chart-bar-border').trim(),
      positivePoint: style.getPropertyValue('--chart-positive-point').trim(),
      negativePoint: style.getPropertyValue('--chart-negative-point').trim(),
      barWin:        style.getPropertyValue('--chart-bar-win').trim(),
      barWarn:       style.getPropertyValue('--chart-bar-warn').trim(),
      barLoss:       style.getPropertyValue('--chart-bar-loss').trim(),
      barNeutral:    style.getPropertyValue('--chart-bar-neutral').trim(),
      accentWarning: style.getPropertyValue('--chart-accent-warning').trim(),
      scatterWin:    style.getPropertyValue('--chart-scatter-win').trim(),
      scatterLoss:   style.getPropertyValue('--chart-scatter-loss').trim(),
      canvasText:    style.getPropertyValue('--chart-canvas-text').trim()
    };
  };

  /**
   * 从 CSS 变量读取当前主题的 Canvas 2D 绘制颜色
   * @returns {{text, grid, fill}}
   */
  util.getCanvasColors = function() {
    var style = getComputedStyle(document.documentElement);
    return {
      text:     style.getPropertyValue('--chart-canvas-text').trim(),
      grid:     style.getPropertyValue('--chart-canvas-grid').trim(),
      fill:     style.getPropertyValue('--chart-canvas-fill').trim(),
      bg:       style.getPropertyValue('--chart-canvas-bg').trim(),
      zero:     style.getPropertyValue('--chart-canvas-zero').trim(),
      up:       style.getPropertyValue('--chart-canvas-up').trim(),
      down:     style.getPropertyValue('--chart-canvas-down').trim(),
      ptCenter: style.getPropertyValue('--chart-canvas-ptcenter').trim()
    };
  };

// ======== 滑点成本计算 ========
// P2-6 FIX：删除未接入的"市场微观结构"静态模拟模型（calculateOrderSizeImpact /
// calculateVolatilityImpact / calculateLiquidityImpact）。这三个函数此前无任何调用点，
// 且其硬编码的日交易量/订单簿深度/波动率并非真实市场数据，保留会误导维护者。
// 实际滑点统一由 slippage.js 的 ticks-v1 模型（用户显式输入 ticks + 交易所 tickSize）承担。

// ======== Chart.js 生命周期管理系统 ========
/**
 * ChartManager - Chart.js实例生命周期管理器
 * 解决内存泄漏问题，确保所有Chart实例正确销毁和重用
 * 基于专业前端性能优化最佳实践设计
 */
const ChartManager = {
  // 注册表：跟踪所有活跃的Chart实例
  instances: new Map(),
  
  // 配置常量
  CONFIG: {
    maxInstances: 20,        // 最大实例数限制
    cleanupThreshold: 15,    // 触发清理的阈值
    destroyTimeout: 1000,    // 销毁超时时间(ms)
    memoryCheckInterval: 30000 // 内存检查间隔(ms)
  },
  
  /**
   * 注册Chart实例
   * @param {string} key - 实例唯一标识
   * @param {Chart} chartInstance - Chart.js实例
   * @param {HTMLElement} canvasElement - Canvas DOM元素
   * @param {Object} metadata - 元数据（可选）
   * @returns {boolean} 注册是否成功
   */
  register(key, chartInstance, canvasElement, metadata = {}) {
    try {
      // 参数验证
      if (!key || typeof key !== 'string') {
        console.error('ChartManager.register: 无效的key参数');
        return false;
      }
      
      if (!chartInstance || typeof chartInstance.destroy !== 'function') {
        console.error('ChartManager.register: 无效的chartInstance参数');
        return false;
      }
      
      if (!canvasElement || !(canvasElement instanceof HTMLElement)) {
        console.error('ChartManager.register: 无效的canvasElement参数');
        return false;
      }
      
      // 检查实例数量限制
      if (this.instances.size >= this.CONFIG.maxInstances) {
        console.warn(`Chart实例数量已达上限(${this.CONFIG.maxInstances})，触发清理`);
        this.cleanup();
      }
      
      // 如果key已存在，先销毁旧实例
      if (this.instances.has(key)) {
        console.warn(`Chart实例key冲突: ${key}，销毁旧实例`);
        this.unregister(key);
      }
      
      // 注册新实例
      const instanceInfo = {
        chart: chartInstance,
        canvas: canvasElement,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        metadata: metadata,
        destroyed: false
      };
      
      this.instances.set(key, instanceInfo);
      
      // 设置DOM元素引用，便于垃圾回收
      instanceInfo.canvas.__chartKey = key;
      
      console.log(`Chart实例已注册: ${key}, 当前总数: ${this.instances.size}`);
      return true;
      
    } catch (error) {
      console.error('ChartManager.register失败:', error);
      return false;
    }
  },
  
  /**
   * 注销Chart实例
   * @param {string} key - 实例唯一标识
   * @param {boolean} immediate - 是否立即销毁（默认延迟销毁）
   * @returns {boolean} 注销是否成功
   */
  unregister(key, immediate = false) {
    try {
      if (!this.instances.has(key)) {
        console.warn(`Chart实例不存在: ${key}`);
        return false;
      }
      
      const instanceInfo = this.instances.get(key);
      
      // 防止重复销毁
      if (instanceInfo.destroyed) {
        console.warn(`Chart实例已被销毁: ${key}`);
        this.instances.delete(key);
        return true;
      }
      
      // 标记为销毁中
      instanceInfo.destroyed = true;
      instanceInfo.destroyStarted = Date.now();
      
      if (immediate) {
        // 立即销毁
        return this._destroyInstance(instanceInfo, key);
      } else {
        // 延迟销毁，避免频繁操作导致的闪烁
        setTimeout(() => {
          this._destroyInstance(instanceInfo, key);
        }, this.CONFIG.destroyTimeout);
        
        // 立即从注册表中移除，但保留销毁过程
        this.instances.delete(key);
        console.log(`Chart实例已安排销毁: ${key}`);
        return true;
      }
      
    } catch (error) {
      console.error(`ChartManager.unregister失败 (${key}):`, error);
      return false;
    }
  },
  
  /**
   * 内部方法：销毁单个实例
   * @param {Object} instanceInfo - 实例信息
   * @param {string} key - 实例key
   * @returns {boolean} 销毁是否成功
   */
  _destroyInstance(instanceInfo, key) {
    try {
      // 销毁Chart实例
      if (instanceInfo.chart && typeof instanceInfo.chart.destroy === 'function') {
        instanceInfo.chart.destroy();
        instanceInfo.chart = null;
      }
      
      // 清理DOM引用
      if (instanceInfo.canvas) {
        instanceInfo.canvas.__chartKey = undefined;
        // 移除resize监听器（如果存在）
        if (instanceInfo.canvas.resizeHandler) {
          window.removeEventListener('resize', instanceInfo.canvas.resizeHandler);
          instanceInfo.canvas.resizeHandler = null;
        }
      }
      
      // 强制垃圾回收提示（仅作提醒，实际GC由浏览器控制）
      if (typeof window.gc === 'function') {
        try { window.gc(); } catch (e) { /* 忽略错误 */ }
      }
      
      const destroyTime = Date.now() - instanceInfo.destroyStarted;
      console.log(`Chart实例已销毁: ${key}, 耗时: ${destroyTime}ms`);
      return true;
      
    } catch (error) {
      console.error(`ChartManager._destroyInstance失败 (${key}):`, error);
      return false;
    }
  },
  
  /**
   * 获取Chart实例
   * @param {string} key - 实例唯一标识
   * @returns {Chart|null} Chart实例或null
   */
  getInstance(key) {
    const instanceInfo = this.instances.get(key);
    if (instanceInfo && !instanceInfo.destroyed) {
      instanceInfo.lastUsed = Date.now(); // 更新使用时间
      return instanceInfo.chart;
    }
    return null;
  },
  
  /**
   * 清理所有实例
   * @param {boolean} force - 是否强制清理（包括活跃实例）
   */
  cleanup(force = false) {
    console.log(`开始Chart实例清理，当前总数: ${this.instances.size}, force: ${force}`);
    
    const now = Date.now();
    const instancesToDestroy = [];
    
    // 收集需要销毁的实例
    for (const [key, instanceInfo] of this.instances.entries()) {
      // 强制清理或实例已标记为销毁
      if (force || instanceInfo.destroyed) {
        instancesToDestroy.push(key);
        continue;
      }
      
      // 长时间未使用的实例（超过5分钟）
      if (now - instanceInfo.lastUsed > 5 * 60 * 1000) {
        console.log(`清理长时间未使用的Chart实例: ${key}`);
        instancesToDestroy.push(key);
      }
    }
    
    // 执行销毁
    let destroyedCount = 0;
    instancesToDestroy.forEach(key => {
      if (this.unregister(key, true)) {
        destroyedCount++;
      }
    });
    
    console.log(`Chart实例清理完成，销毁: ${destroyedCount}/${instancesToDestroy.length}个`);
  },
  
  /**
   * 页面卸载时的清理
   */
  cleanupOnUnload() {
    console.log('页面卸载，执行Chart实例完整清理');
    
    // 立即销毁所有实例
    for (const key of this.instances.keys()) {
      this.unregister(key, true);
    }
    
    // 清空注册表
    this.instances.clear();
  },
  
  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      totalInstances: this.instances.size,
      activeInstances: 0,
      destroyedInstances: 0,
      oldestInstance: null,
      newestInstance: null
    };
    
    const now = Date.now();
    let oldestTime = now;
    let newestTime = 0;
    
    for (const [key, instanceInfo] of this.instances.entries()) {
      if (instanceInfo.destroyed) {
        stats.destroyedInstances++;
      } else {
        stats.activeInstances++;
        
        if (instanceInfo.createdAt < oldestTime) {
          oldestTime = instanceInfo.createdAt;
          stats.oldestInstance = {
            key: key,
            age: Math.round((now - instanceInfo.createdAt) / 1000)
          };
        }
        
        if (instanceInfo.createdAt > newestTime) {
          newestTime = instanceInfo.createdAt;
          stats.newestInstance = {
            key: key,
            age: Math.round((now - instanceInfo.createdAt) / 1000)
          };
        }
      }
    }
    
    return stats;
  }
};

// 页面卸载时自动清理
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    ChartManager.cleanupOnUnload();
  });
  
  // 定期检查内存使用情况
  setInterval(() => {
    const stats = ChartManager.getStats();
    if (stats.totalInstances >= ChartManager.CONFIG.cleanupThreshold) {
      console.log('Chart实例数量较高，执行预防性清理:', stats);
      ChartManager.cleanup();
    }
  }, ChartManager.CONFIG.memoryCheckInterval);
}

// 挂载到全局
window.utils = util;
window.ChartManager = ChartManager; // 暴露给全局使用
// BUG FIX：skills-integration.js 的 calcKellyStatsFromLogs 以裸标识符调用 getClosedSorted，
// 此前仅挂在 window.utils 上导致调用即 ReferenceError（凯利统计从未真正生效）。补全局别名。
window.getClosedSorted = util.getClosedSorted;
window.isClosedTrade = util.isClosedTrade;
window.isPartialClosed = util.isPartialClosed;
})();

// ======== Chart.js 页面级清理方法 ========
/**
 * 清理指定页面的所有图表实例
 * @param {string} page - 页面标识符
 */
ChartManager.cleanupPage = function(page) {
  if (!page || typeof page !== 'string') {
    console.error('ChartManager.cleanupPage: 无效的page参数');
    return;
  }
  
  console.log(`开始清理页面 "${page}" 的所有图表实例`);
  
  const keysToRemove = [];
  
  // 查找该页面的所有实例
  for (const [key, instanceInfo] of this.instances.entries()) {
    if (instanceInfo.metadata && instanceInfo.metadata.page === page) {
      keysToRemove.push(key);
    }
  }
  
  // 清理找到的实例
  let cleanedCount = 0;
  keysToRemove.forEach(key => {
    if (this.unregister(key, true)) {
      cleanedCount++;
    }
  });
  
  console.log(`页面 "${page}" 清理完成，共清理 ${cleanedCount} 个图表实例`);
  
  // 如果还有很多实例，执行全局清理
  const stats = this.getStats();
  if (stats.totalInstances > this.CONFIG.cleanupThreshold) {
    console.log('页面清理后实例数量仍然较多，执行全局清理');
    this.cleanup();
  }
};
