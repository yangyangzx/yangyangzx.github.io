// 整改回归：验证索引状态统一重置 / 重映射已生效
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const ROOT=path.join(__dirname,'..');
const LO=['chart-guard','constants','utils','select-ui','toast','slippage','storage','skills-integration',
'calc-visuals','calculation-ui','calculator','logs','rendering','stats','modals','navigation','dashboard',
'planner','discipline-led','settings','risk','chart-factory','analytics','review','io','dom-cache','app','version'];
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:8000/'});
const w=dom.window;
w.eval("window.Chart=function(){return{destroy(){},update(){},data:{},config:{},options:{}}};window.Chart.getChart=function(){return null;};window.Chart.defaults={plugins:{legend:{labels:{color:'#000'}}}};");
for(const n of LO){const p=path.join(ROOT,'js',n+'.js');if(!fs.existsSync(p))continue;
 const s=w.document.createElement('script');s.textContent=fs.readFileSync(p,'utf8');w.document.head.appendChild(s);}

let pass=0,fail=0;
const say=s=>process.stdout.write(s+'\n');
const check=(l,c,d)=>{if(c){pass++;say('  ✅ '+l);}else{fail++;say('  ❌ '+l);if(d)say('       '+d);}};

say('========== R1 权威函数已就位 ========');
check('window.resetAllIndexState 可用', typeof w.resetAllIndexState==='function');
check('window.remapIndexStateAfterSplice 可用', typeof w.remapIndexStateAfterSplice==='function');

// 完整 7 项清单
const r1=w.eval(`(function(){
  var logs=[]; for(var i=0;i<6;i++) logs.push({id:'L'+i,time:new Date(2026,0,10-i).toISOString(),
    symbol:'BTC',direction:'long',positionSize:10,entryPrice:100});
  window.logs=logs;
  _expandedRows.clear(); _expandedRows.add(3); _selectedIndices.clear(); _selectedIndices.add(0); _selectedIndices.add(1);
  window._pendingDeleteIndices=new Set([2]);
  openClosePanelIdx=4; actionPanelIdx=4; _batchMode=true; Object.keys(_closePriceEdited).forEach(function(k){delete _closePriceEdited[k];}); _closePriceEdited[4]=true;
  _closePanelType='initialTP'; _closePanelPrice='110';
  window.resetAllIndexState();
  return { exp:Array.from(_expandedRows), sel:Array.from(_selectedIndices),
    pend:Array.from(window._pendingDeleteIndices), close:openClosePanelIdx,
    act:actionPanelIdx, batch:_batchMode, edited:JSON.stringify(_closePriceEdited),
    pt:_closePanelType, pp:_closePanelPrice };
})()`);
check(`7 项全部重置（展开=${JSON.stringify(r1.exp)} 勾选=${JSON.stringify(r1.sel)} 待删=${JSON.stringify(r1.pend)}）`,
  r1.exp.length===0 && r1.sel.length===0 && r1.pend.length===0, JSON.stringify(r1));
check('面板索引归 -1', r1.close===-1 && r1.act===-1, `close=${r1.close} act=${r1.act}`);
check('_batchMode 归 false', r1.batch===false, `实际=${r1.batch}`);
check('_closePriceEdited 清空', r1.edited==='{}', r1.edited);
check('平仓面板类型/价格缓存清空', r1.pt==='' && r1.pp==='', `pt="${r1.pt}" pp="${r1.pp}"`);

say('\n========== R2 splice 重映射：面板下标不再漂移 ========');
const r2=w.eval(`(function(){
  var logs=[]; for(var i=0;i<6;i++) logs.push({id:'L'+i,time:new Date(2026,0,10-i).toISOString(),
    symbol:'BTC',direction:'long',positionSize:10,entryPrice:100,closeType:'',pnlAmount:null});
  window.logs=logs;
  window.resetAllIndexState();
  // 模拟：面板开在 L4，用户勾选 L3/L5
  openClosePanelIdx=4; actionPanelIdx=4; Object.keys(_closePriceEdited).forEach(function(k){delete _closePriceEdited[k];}); _closePriceEdited[4]=true;
  _selectedIndices.clear(); _selectedIndices.add(3); _selectedIndices.add(5); _expandedRows.clear(); _expandedRows.add(3);
  // 删除 L1（索引 1）
  window.logs.splice(1,1);
  window.remapIndexStateAfterSplice(1);
  var ids=Array.from(_selectedIndices).map(function(i){return (window.logs[i]||{}).id||'OOB';});
  return { sel:Array.from(_selectedIndices), ids:ids,
    exp:Array.from(_expandedRows), close:openClosePanelIdx, act:actionPanelIdx,
    edited:JSON.stringify(_closePriceEdited),
    atClose:(window.logs[openClosePanelIdx]||{}).id };
})()`);
// 删除 L1（索引 1）后：原 L3 落到下标 2、原 L5 落到下标 4。
// 断言的是「重映射后仍指向用户当初勾的那两条记录」，不是下标字面值不变。
check(`勾选重映射后指向 ${JSON.stringify(r2.ids)}（期望仍是用户勾过的 L3/L5 两条）`,
  JSON.stringify(r2.ids)==='["L3","L5"]' && r2.sel.length===2,
  `实际下标=${JSON.stringify(r2.sel)} → 记录=${JSON.stringify(r2.ids)}`);
check(`展开行同步重映射 → ${JSON.stringify(r2.exp)}（期望 [2]）`,
  JSON.stringify(r2.exp)==='[2]', `实际=${JSON.stringify(r2.exp)}`);
check(`面板下标 4→3，且该位置现在是 ${r2.atClose}（= 原 L4，未漂移到 L5）`,
  r2.close===3 && r2.atClose==='L4', `close=${r2.close} atClose=${r2.atClose}`);
check(`_closePriceEdited 键同步迁移 → ${r2.edited}（期望 {"3":true}）`,
  r2.edited==='{"3":true}', r2.edited);

say('\n========== R3 删除面板所在行本身 → 面板关闭而非漂移 ========');
const r3=w.eval(`(function(){
  var logs=[]; for(var i=0;i<5;i++) logs.push({id:'L'+i,time:new Date(2026,0,10-i).toISOString()});
  window.logs=logs; window.resetAllIndexState();
  openClosePanelIdx=2; actionPanelIdx=2;
  window.logs.splice(2,1);
  window.remapIndexStateAfterSplice(2);
  return { close:openClosePanelIdx, act:actionPanelIdx };
})()`);
check('删除面板所在行 → openClosePanelIdx = -1（不会指向邻居）', r3.close===-1, `实际=${r3.close}`);
check('actionPanelIdx 同样归 -1', r3.act===-1, `实际=${r3.act}`);

say('\n========== R4 各路径已接入统一入口 ========');
const paths=[
  ['logs.js','batchDelete'],['logs.js','clearLogs'],['logs.js','批量删除撤销'],
  ['toast.js','单条删除'],['settings.js','覆盖导入'],['settings.js','追加导入'],
  ['settings.js','备份恢复'],['storage.js','_safeRenderAfterStorageChange']];
for(const [f,label] of paths){
  const src=fs.readFileSync(path.join(ROOT,'js',f),'utf8');
  check(`${label}（${f}）已走 resetAllIndexState/remap`, /resetAllIndexState|remapIndexStateAfterSplice/.test(src));
}
// 反向：确认没有残留的手工清理（应全部收敛）
const logsSrc=fs.readFileSync(path.join(ROOT,'js','logs.js'),'utf8');
const manual=(logsSrc.match(/_expandedRows\.clear\(\)|_closePriceEdited\[.?.?.?\] *=|for \(var _?k in _closePriceEdited\)/g)||[]);
check('logs.js 已无手工逐项清理残留', manual.length===0, `残留=${JSON.stringify(manual)}`);

say('\n========== R5 真实调用链（走 _commitImportedLogs / restoreFromAutoBackup）==========');
const r5=w.eval(`(function(){
  function mk(n,tag){var a=[];for(var i=0;i<n;i++)a.push({id:tag+i,time:new Date(2026,0,10-i).toISOString(),
    symbol:'BTC',direction:'long',positionSize:10,entryPrice:100,closeType:'',pnlAmount:null});return a;}
  var out={};
  // 覆盖导入
  window.logs=mk(6,'L'); window.resetAllIndexState();
  _selectedIndices.clear(); _selectedIndices.add(0); _selectedIndices.add(1); _expandedRows.clear(); _expandedRows.add(3);
  openClosePanelIdx=4; actionPanelIdx=4; _batchMode=true; Object.keys(_closePriceEdited).forEach(function(k){delete _closePriceEdited[k];}); _closePriceEdited[4]=true;
  window._commitImportedLogs(mk(3,'N'));
  out.import={sel:Array.from(_selectedIndices).length, exp:_expandedRows.size,
    close:openClosePanelIdx, act:actionPanelIdx, batch:_batchMode, ed:Object.keys(_closePriceEdited).length};
  // 备份恢复
  window.logs=mk(6,'L'); window.resetAllIndexState();
  _selectedIndices.clear(); _selectedIndices.add(0); _selectedIndices.add(1); _expandedRows.clear(); _expandedRows.add(3); openClosePanelIdx=4; _batchMode=true;
  var bak={data:mk(3,'R')};
  window.localStorage.setItem('trade_backup_auto_0', JSON.stringify(bak));
  out.restoreCalled = window.restoreFromAutoBackup(0);
  out.restore={sel:Array.from(_selectedIndices).length, exp:_expandedRows.size,
    close:openClosePanelIdx, batch:_batchMode};
  return out;
})()`);
check(`覆盖导入后状态全清（勾选=${r5.import.sel} 展开=${r5.import.exp} 面板=${r5.import.close}/${r5.import.act} 批量=${r5.import.batch} 改价标记=${r5.import.ed}）`,
  r5.import.sel===0 && r5.import.exp===0 && r5.import.close===-1 && r5.import.act===-1
  && r5.import.batch===false && r5.import.ed===0, JSON.stringify(r5.import));
check(`备份恢复后状态全清（勾选=${r5.restore.sel} 展开=${r5.restore.exp} 面板=${r5.restore.close} 批量=${r5.restore.batch}）`,
  r5.restore.sel===0 && r5.restore.exp===0 && r5.restore.close===-1 && r5.restore.batch===false,
  JSON.stringify(r5.restore));

say('\n========== R6 防回归：saveLogs 不得清空刚重映射的状态 ============');
const r6=w.eval(`(function(){
  // storage.js 的 _safeRenderAfterStorageChange 同时是每次 saveLogs 的收尾。
  // 若在那里无条件 resetAllIndexState，单条删除 remap 后的勾选/展开状态
  // 会被立刻清空（曾真实发生过：verify_logs_fixed 的 F1 组全红）。
  var logs=[]; for(var i=0;i<6;i++) logs.push({id:'L'+i,time:new Date(2026,0,10-i).toISOString(),
    symbol:'BTC',direction:'long',positionSize:10,entryPrice:100});
  window.logs=logs; window.resetAllIndexState();
  _selectedIndices.clear(); _selectedIndices.add(2); _selectedIndices.add(3); _selectedIndices.add(5);
  window.logs.splice(1,1);
  window.remapIndexStateAfterSplice(1);
  var afterRemap=Array.from(_selectedIndices).slice().sort();
  // 触发一次真实 saveLogs（其收尾会调 _safeRenderAfterStorageChange）
  saveLogs(true);
  var afterSave=Array.from(_selectedIndices).slice().sort();
  return { afterRemap:afterRemap, afterSave:afterSave };
})()`);
check(`remap 后勾选=${JSON.stringify(r6.afterRemap)}`,
  JSON.stringify(r6.afterRemap)==='[1,2,4]', JSON.stringify(r6.afterRemap));
check(`saveLogs 之后勾选仍保留（未被 _safeRenderAfterStorageChange 清空）`,
  JSON.stringify(r6.afterSave)===JSON.stringify(r6.afterRemap),
  `remap 后=${JSON.stringify(r6.afterRemap)} → saveLogs 后=${JSON.stringify(r6.afterSave)}`);
const storageSrc=fs.readFileSync(path.join(ROOT,'js','storage.js'),'utf8');
check('_safeRenderAfterStorageChange 接受 opts 且重置受 externalReplace 开关控制',
  /function _safeRenderAfterStorageChange\(opts\)/.test(storageSrc)
  && /opts && opts\.externalReplace/.test(storageSrc));
check('多标签页同步两处已显式传 externalReplace:true',
  (storageSrc.match(/externalReplace: true/g)||[]).length===2,
  `实际 ${(storageSrc.match(/externalReplace: true/g)||[]).length} 处`);
check('普通 saveLogs 收尾未传该标记（不清状态）',
  /_safeRenderAfterStorageChange\(\);/.test(storageSrc));

say('\n========== R7 resetForm 的手续费率必须读设置 ==========');
// 回归点：resetForm 曾写死 `feeRate.value = '0.08'`。_calculateImpl 优先读表单值、
// 仅在为空/非正数时才回退 _getDefaultFeeRate，所以写死等于让用户在设置页调好的
// 费率被「重置」按钮静默改回去。放在本跑测器是因为它加载真实 index.html，
// 表单 DOM 齐全，能真正执行 resetForm（run-tests.html 的精简 DOM 跑不了）。
const r7=w.eval(`(function(){
  var _old = localStorage.getItem('trade_settings_v1');
  var out = {};
  try {
    localStorage.setItem('trade_settings_v1', JSON.stringify({
      feeRateMarket: 0.06, feeRateLimit: 0.03
    }));
    _clearSettingsCache();
    document.getElementById('feeRate').value = '';
    resetForm();
    out.market = document.getElementById('feeRate').value;

    localStorage.removeItem('trade_settings_v1');
    _clearSettingsCache();
    resetForm();
    out.fallback = document.getElementById('feeRate').value;
  } finally {
    if (_old === null) localStorage.removeItem('trade_settings_v1');
    else localStorage.setItem('trade_settings_v1', _old);
    _clearSettingsCache();
  }
  return out;
})()`);
check(`resetForm 写入设置中的市价单费率（期望 0.06，修复前恒为 0.08）`,
  Math.abs(parseFloat(r7.market) - 0.06) < 1e-12, `实际=${r7.market}`);
check(`无设置时 resetForm 回退默认 0.08`,
  Math.abs(parseFloat(r7.fallback) - 0.08) < 1e-12, `实际=${r7.fallback}`);

say('\n========================================');
say(`结果：${pass} 通过 / ${fail} 失败（共 ${pass+fail} 项）`);
say('========================================\n');
process.exit(fail > 0 ? 1 : 0);
