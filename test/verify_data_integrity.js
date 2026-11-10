'use strict';

// 数据完整性回归（v5.6.46 · 批次 1）
//
// 红测来源（2026-11-10 深度审计，TZ=Asia/Shanghai 实证）：
//   P0-6  utils._localeToISO 把本地墙钟时间硬拼 'Z' → +8h，11-09 晚间单漂到 11-10
//   P0-3  loadSettings() 返回可变缓存引用，外部原地改写把日亏闸门从 500 放大到 4500
//   P0-2  saveLogs 全量覆盖，另一标签写入的 from-B 被本标签静默抹掉
//   P1-14 restoreFromAutoBackup 跳过迁移/补 id/脏值隔离
//
// 纪律：--inject 逐条独立注入旧实现，每次单独 boot 一个干净 JSDOM，
//       对应断言组必须各自变红（证明不是恒真断言）。
//
//   node test/verify_data_integrity.js            正常跑（全绿）
//   node test/verify_data_integrity.js --inject   4 个注入点必须 4/4 被捕获

process.env.TZ = 'Asia/Shanghai';

const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const gate = require('./_gate');

const ROOT = path.join(__dirname, '..');
const INJECT = process.argv.includes('--inject');

class LL extends ResourceLoader {
  fetch(url, opts) { return url.startsWith('file://') ? super.fetch(url, opts) : Promise.reject(new Error('blocked')); }
}
function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; }
  };
}

async function boot() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = await JSDOM.fromFile(path.join(ROOT, 'index.html'), {
    runScripts: 'dangerously', resources: new LL(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      const store = makeStorage();
      Object.defineProperty(w, 'localStorage', { value: store });
      w.__store = store;   // 供写盘失败场景 patch
      w.Element.prototype.scrollIntoView = function () {};
    }
  });
  await new Promise(r => setTimeout(r, 900));
  return dom;
}

// 四组断言，返回每组的通过/失败明细。patch 用于 --inject 注入旧实现。
function runChecks(w, patch) {
  const groups = { A: [], B: [], C: [], D: [] };
  const ck = (g, name, cond, detail) => {
    groups[g].push({ name, ok: !!cond, detail: detail || '' });
  };
  if (patch) patch(w);

  const reset = () => {
    w.localStorage.clear();
    if (typeof w._clearSettingsCache === 'function') w._clearSettingsCache();
    w.eval('logs = []');
  };

  // ---------- A · 时间迁移（P0-6） ----------
  reset();
  const incoming = '2026/11/09 20:00:00';
  const converted = w.utils._localeToISO(incoming);
  const expectedISO = new w.Date(2026, 10, 9, 20, 0, 0).toISOString();
  ck('A', 'A1 本地墙钟 2026/11/09 20:00 → UTC ISO 与 Date 一致',
    converted === expectedISO, '实得=' + converted + ' 应为=' + expectedISO);
  ck('A', 'A2 转换后 toLocalDateStr 仍落在 11-09（不漂到次日）',
    typeof w.utils.toLocalDateStr === 'function' && w.utils.toLocalDateStr(converted) === '2026-11-09',
    '实得=' + (w.utils.toLocalDateStr && w.utils.toLocalDateStr(converted)));
  const migrated = [{ time: incoming, closeTime: incoming, closeType: 'manualWin' }];
  try { w.eval('typeof _migrateTimes === "function"') && w._migrateTimes(migrated); } catch (e) { /* ignore */ }
  ck('A', 'A3 _migrateTimes 真链路同样按本地时区迁移',
    migrated[0].time === expectedISO, '实得=' + migrated[0].time);
  ck('A', 'A4 非法日历日期不得被 Date 溢出伪装成合法 ISO',
    w.utils._localeToISO('2026/13/45 20:00:00') === '2026/13/45 20:00:00',
    '实得=' + w.utils._localeToISO('2026/13/45 20:00:00'));
  ck('A', 'A5 已是 ISO 的字符串原样返回',
    w.utils._localeToISO('2026-11-09T12:00:00.000Z') === '2026-11-09T12:00:00.000Z');

  // ---------- B · 设置缓存（P0-3） ----------
  reset();
  const origDaily = w.loadSettings().dailyLossLimit;
  const before = (typeof w.checkDailyLossLimit === 'function') ? w.checkDailyLossLimit(10000).limit : null;
  const leaked = w.loadSettings();
  leaked.dailyLossLimit = 45;
  ck('B', 'B1 外部原地改写 loadSettings() 返回值不得污染后续读取',
    w.loadSettings().dailyLossLimit === origDaily,
    '改写后=' + w.loadSettings().dailyLossLimit + ' 原值=' + origDaily);
  ck('B', 'B2 风控硬闸门不得被缓存污染放大',
    (typeof w.checkDailyLossLimit === 'function') && w.checkDailyLossLimit(10000).limit === before,
    '前=' + before + ' 后=' + (w.checkDailyLossLimit && w.checkDailyLossLimit(10000).limit));

  // 写盘失败：patch _safeSetSettings 返回 false，saveSettings 必须清缓存且不留脏值。
  // 先把默认值渲染进表单，否则 parseFloat('') 会让 saveSettings 在首个字段就早退，
  // 断言会退化成恒假。
  try { w.renderSettings(); } catch (e) { /* ignore */ }
  let safeCalled = 0;
  const origSafe = w._safeSetSettings;
  w._safeSetSettings = function () { safeCalled++; return false; };
  try { w.saveSettings(); } catch (e) { /* 表单可能不完整，忽略 */ }
  w._safeSetSettings = origSafe;
  ck('B', 'B3 写盘失败场景确实走到写入点（防止断言恒真）', safeCalled > 0, 'called=' + safeCalled);
  ck('B', 'B4 写盘失败后 loadSettings() 仍是落库值',
    w.loadSettings().dailyLossLimit === origDaily,
    '实得=' + w.loadSettings().dailyLossLimit);

  // ---------- C · 多标签并发（P0-2） ----------
  reset();
  const KEY = w.eval('typeof STORAGE_KEY !== "undefined" ? STORAGE_KEY : null');
  w.eval('logs = [{ id: "from-A", symbol: "BTC", time: "2026-11-09T12:00:00.000Z" }]');
  w.saveLogs(true);
  w.localStorage.setItem(KEY, JSON.stringify([{ id: 'from-B', symbol: 'ETH', time: '2026-11-09T12:00:00.000Z' }]));
  w.saveLogs(true);
  const diskRaw = w.localStorage.getItem(KEY) || '';
  ck('C', 'C1 另一标签写入的记录不得被本标签保存静默抹掉',
    diskRaw.indexOf('from-B') >= 0, '磁盘=' + diskRaw);
  ck('C', 'C2 合并后本标签自己的记录仍在',
    diskRaw.indexOf('from-A') >= 0, '磁盘=' + diskRaw);
  let diskArr = [];
  try { diskArr = JSON.parse(diskRaw); } catch (e) { /* ignore */ }
  ck('C', 'C3 合并结果恰好 2 条、无重复',
    diskArr.length === 2 && diskArr.filter(r => r.id === 'from-A').length === 1,
    '条数=' + diskArr.length);

  // ---------- D · 备份恢复（P1-14） ----------
  reset();
  const backup = { time: '2026-11-09T12:00:00.000Z', data: [
    { symbol: 'BTC', time: incoming, pnlAmount: 'Infinity', fee: 'NaN' }
  ] };
  w.localStorage.setItem('trade_backup_auto_0', JSON.stringify(backup));
  let restored = false;
  try { restored = w.restoreFromAutoBackup(0); } catch (e) { /* ignore */ }
  const row = w.eval('logs && logs[0]');
  ck('D', 'D1 备份恢复成功', restored === true && !!row, 'restored=' + restored);
  ck('D', 'D2 恢复后补齐稳定 id', !!(row && row.id), 'row=' + JSON.stringify(row));
  ck('D', 'D3 恢复后时间按本地时区迁移为 ISO',
    !!(row && row.time === expectedISO), 'time=' + (row && row.time));
  ck('D', 'D4 恢复后非有限脏值被隔离为有限数',
    !!(row && Number.isFinite(Number(row.pnlAmount)) && Number.isFinite(Number(row.fee))),
    'pnlAmount=' + (row && row.pnlAmount) + ' fee=' + (row && row.fee));

  return groups;
}

// 逐条独立注入：每个注入点单独 boot 一个干净 DOM，只检查对应组是否变红。
const INJECTIONS = [
  { key: 'locale-old-impl', group: 'A', patch(w) {
      w.utils._localeToISO = function (t) {
        if (!t || t.indexOf('T') !== -1) return t;
        var m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
        if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') +
          'T' + m[4].padStart(2, '0') + ':' + m[5].padStart(2, '0') + ':' + m[6].padStart(2, '0') + '.000Z';
        return t;
      };
    } },
  { key: 'settings-ref', group: 'B', patch(w) {
      // 模拟旧实现「恒返回同一个可变缓存对象」：闭包捕获一份，且不让清缓存生效。
      // 不直接读 w.SETTINGS_CACHE —— 清缓存后它会变 null，旧实现是会重新加载的。
      var cache = w.loadSettings();
      w.loadSettings = function () { return cache; };
      w._clearSettingsCache = function () {};
    } },
  { key: 'no-reconcile', group: 'C', patch(w) {
      w._reconcileLogsWithDisk = function () { return null; };
    } },
  { key: 'no-restore-migration', group: 'D', patch(w) {
      w._normalizeRestoredLogs = function (records) { return records; };
    } },
];

(async () => {
  if (INJECT) {
    console.log('数据完整性注入自检：逐条独立注入旧实现，对应断言组必须变红\n');
    let caught = 0;
    for (const inj of INJECTIONS) {
      const dom = await boot();
      let hasRed = false, err = '';
      try {
        const groups = runChecks(dom.window, inj.patch);
        hasRed = groups[inj.group].some(r => !r.ok);
      } catch (e) { err = e.message; }
      if (hasRed) caught++;
      console.log('  ' + (hasRed ? '\u2705' : '\u274c') + ' ' + inj.key.padEnd(26) +
        (hasRed ? '已捕获（' + inj.group + ' 组复红）' : '未捕获 → 断言无捕获力' + (err ? ' | ' + err : '')));
      try { dom.window.close(); } catch (e) { /* ignore */ }
    }
    console.log('\n[注入自检] ' + caught + '/' + INJECTIONS.length + ' 个注入点被逐条捕获');
    gate.emitInject(caught, INJECTIONS.length);
    process.exit(caught === INJECTIONS.length ? 0 : 1);
  } else {
    const dom = await boot();
    const groups = runChecks(dom.window, null);
    let pass = 0, fail = 0;
    Object.keys(groups).forEach(g => {
      console.log('\n--- ' + g + ' 组 ---');
      groups[g].forEach(r => {
        if (r.ok) { pass++; console.log('  \u2713 ' + r.name); }
        else { fail++; console.log('  \u2717 ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
      });
    });
    gate.emit(pass, fail);
    try { dom.window.close(); } catch (e) { /* ignore */ }
    process.exit(fail > 0 ? 1 : 0);
  }
})().catch(e => { console.error('BOOT FAIL', e && e.stack || e); process.exit(1); });
