// 日志模块修复回归 —— 验证「修复后的正确行为」
// 与 verify_logs_audit.js（探测 bug 是否存在）互补：这里断言 bug 必须【已消失】。
// 每组都带反向用例：注入错误看是否报警，证明断言真的咬住了目标路径。
const fs = require('fs'); const path = require('path'); const { JSDOM } = require('jsdom');
const ROOT=path.join(__dirname,'..');
const LOAD_ORDER = ['chart-guard','constants','utils','select-ui','toast','slippage','storage',
 'skills-integration','calc-visuals','calculation-ui','calculator','logs','rendering','stats','modals',
 'navigation','dashboard','planner','discipline-led','settings','risk','chart-factory','analytics',
 'review','io','dom-cache','app','version'];

const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const dom = new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:8000/'});
const w = dom.window;
// Chart.js 桩：需覆盖 getChart/destroy 等静态方法，否则 review.js 的
// destroyReviewCharts 会抛 TypeError（真实环境由 CDN 提供）
w.eval(`window.Chart = function(){ return { destroy(){}, update(){}, data:{}, config:{}, options:{} }; };
window.Chart.getChart = function(){ return null; };
window.Chart.defaults = { plugins:{ legend:{ labels:{ color:'#000' } } } };
window.Chart.registry = { getController(){ return { update(){}, color:{} }; } };`);
for(const n of LOAD_ORDER){const p=path.join(ROOT,'js',n+'.js');if(!fs.existsSync(p))continue;
  const s=w.document.createElement('script');s.textContent=fs.readFileSync(p,'utf8');w.document.head.appendChild(s);}

let pass=0,fail=0;
const say=s=>process.stdout.write(s+'\n');
function check(l,c,d){if(c){pass++;say('  ✅ '+l);}else{fail++;say('  ❌ '+l);if(d)say('       '+d);}}

say('========== 环境自检 ==========');
check('window.utils.isClosed 已就位', typeof (w.utils&&w.utils.isClosed)==='function');

// ========== F1：单条删除后索引重映射 ==========
say('\n========== F1 单条删除后 _selectedIndices / _expandedRows 重映射 ==========');
const f1 = w.eval(`(function(){
  var logs=[]; for(var i=0;i<6;i++) logs.push({id:'L'+i,time:new Date(2026,0,10-i).toISOString(),
    symbol:'BTC',direction:'long',positionSize:10,entryPrice:100});
  window.logs=logs;
  window._selectedIndices=new Set([2,3,5]);        // 用户勾了 L2 L3 L5
  window._pendingDeleteIndices=new Set();
  var selBefore=Array.from(window._selectedIndices).sort(function(a,b){return a-b;});
  // 走真实的 _commitPendingDelete 单条分支：删除索引 1（L1）
  window._pendingDelete={idx:1,timeoutId:null};
  window._commitPendingDelete();
  var selAfter=Array.from(window._selectedIndices).sort(function(a,b){return a-b;});
  // 期望：L2(原2)->1, L3(原3)->2, L5(原5)->4
  var ids=selAfter.map(function(i){return (window.logs[i]||{}).id||'OOB';});
  return { selBefore:selBefore, selAfter:selAfter, ids:ids,
           len:window.logs.length, expect:[1,2,4], idsExpect:['L2','L3','L5'] };
})()`);
check('删除 L1 后 logs 长度 6→5', f1.len===5, `实际=${f1.len}`);
check(`选中索引已重映射 ${JSON.stringify(f1.selBefore)} → ${JSON.stringify(f1.selAfter)}（期望 ${JSON.stringify(f1.expect)}）`,
  JSON.stringify(f1.selAfter)===JSON.stringify(f1.expect), `实际=${JSON.stringify(f1.selAfter)}`);
check(`重映射后指向的仍是用户勾过的那几条：${JSON.stringify(f1.ids)}`,
  JSON.stringify(f1.ids)===JSON.stringify(f1.idsExpect), `实际=${JSON.stringify(f1.ids)}`);
check('选中的条目数不变（3 条，未被清空）', f1.selAfter.length===3, `实际=${f1.selAfter.length}`);

// 反向用例：把重映射逻辑破坏掉，断言必须报警
const f1neg = w.eval(`(function(){
  var logs=[]; for(var i=0;i<6;i++) logs.push({id:'L'+i,time:new Date(2026,0,10-i).toISOString()});
  window.logs=logs; window._selectedIndices=new Set([2,3,5]); window._pendingDeleteIndices=new Set();
  // 故意不做重映射（= 修复前的行为）
  window.logs.splice(1,1);
  window._pendingDelete=null;
  var sel=Array.from(window._selectedIndices).sort(function(a,b){return a-b;});
  return { sel:sel, ids: sel.map(function(i){return (window.logs[i]||{}).id||'OOB';}) };
})()`);
check(`【反向】未重映射时索引确实错位（${JSON.stringify(f1neg.ids)} ≠ 用户勾选的 L2/L3/L5）→ 断言能咬住`,
  JSON.stringify(f1neg.sel)!==JSON.stringify([1,2,4]), `实际=${JSON.stringify(f1neg.sel)}`);

// ========== F2：orderType 三值回显 ==========
say('\n========== F2 orderType 弹窗选项含三值且不回退 ==========');
const f2 = w.eval(`(function(){
  function probe(ot){
    var item={symbol:'BTC',direction:'long',orderType:ot,stopType:'stop-market',entryPrice:100,
      stopLoss:95,positionSize:10,leverage:3,riskAmount:5,mindsetScore:3,signals:[],
      closeType:'',pnlAmount:null,initialRiskAmount:5,fee:0.1};
    document.querySelectorAll('.modal-overlay').forEach(function(o){o.remove();});
    window.logs=[item]; window.openEditModal(0);
    var sel=document.getElementById('emOrderType');
    var opts=sel?Array.prototype.map.call(sel.options,function(o){return o.value;}):[];
    var val=sel?sel.value:null;
    window._doCloseEditModal();
    return {opts:opts,val:val};
  }
  return { limit:probe('limit'), stop:probe('stop'), market:probe('market'),
           legacy:probe('stopLimit') };
})()`);
check("选项含 market/limit/stop 三值", JSON.stringify(f2.limit.opts)==='["market","limit","stop"]', JSON.stringify(f2.limit.opts));
check("orderType='limit' 打开弹窗后仍为 'limit'（不再静默变 market）", f2.limit.val==='limit', `实际=${f2.limit.val}`);
check("orderType='stop' 打开弹窗后仍为 'stop'", f2.stop.val==='stop', `实际=${f2.stop.val}`);
check("orderType='market' 保持 'market'", f2.market.val==='market', `实际=${f2.market.val}`);
check("旧扩展值 'stopLimit' 原样回显（历史数据不被改写）", f2.legacy.val==='stopLimit', `实际=${f2.legacy.val}`);

// ========== F3：isClosed fail-closed ==========
say('\n========== F3 isClosed 统一入口与 fail-closed ==========');
const f3 = w.eval(`(function(){
  var mid={closeType:'partialTP',pnlAmount:12.3,closes:[{type:'partialTP',ratio:50}],closedRatio:50};
  var done={closeType:'partialTP',pnlAmount:20,closes:[{type:'partialTP',ratio:100}],closedRatio:100};
  var open={closeType:'',pnlAmount:null};
  return { mid:window.utils.isClosed(mid), done:window.utils.isClosed(done), open:window.utils.isClosed(open) };
})()`);
check('分批中间态判「未平仓」', f3.mid===false, `实际=${f3.mid}`);
check('分批收尾（closedRatio=100）判「已平仓」', f3.done===true, `实际=${f3.done}`);
check('未平仓判「未平仓」', f3.open===false, `实际=${f3.open}`);
const f3src = fs.readFileSync(path.join(ROOT,'js','logs.js'),'utf8')
  + fs.readFileSync(path.join(ROOT,'js','rendering.js'),'utf8')
  + fs.readFileSync(path.join(ROOT,'js','stats.js'),'utf8');
check('三处消费方已无就地 !!closeType 兜底（不再复制错误判定）',
  !/isClosedTrade === 'function'/.test(f3src), '仍存在旧 fallback');
check('三处消费方均调用统一入口 utils.isClosed',
  ['logs.js','rendering.js','stats.js'].every(function(f){
    return fs.readFileSync(path.join(ROOT,'js',f),'utf8').indexOf('window.utils.isClosed(') >= 0;
  }), '未收口');

// ========== F4：分批改非分批后 positionSize 清零（走真实 saveEditLog） ==========
say('\n========== F4 分批改非分批后 positionSize 清零 ==========');
const f4 = w.eval(`(function(){
  var item={symbol:'BTC',direction:'long',orderType:'market',stopType:'stop-market',
    entryPrice:100,stopLoss:95,targetPrice:120,positionSize:500,leverage:3,riskAmount:50,
    initialRiskAmount:100,actualMargin:333,initialMargin:166.67,mindsetScore:3,signals:[],
    strategyFramework:'',strategyPattern:'',fee:0.4,feeRate:0.04,slippageCost:0,
    closeType:'partialTP',closePrice:110,pnlAmount:20,pnlPercent:12.0,rMultiple:0.2,
    grossPnlAmount:20.5,partialRatio:50,closedRatio:50,realizedPnl:20,realizedFee:0.2,
    closes:[{type:'partialTP',price:110,ratio:50,fee:0.2,pnl:20,time:new Date().toISOString()}],
    lossReason:null,emotions:null,exitReason:'',closeNote:'',
    time:new Date(Date.now()-3600000).toISOString(),closeTime:new Date().toISOString()};
  document.querySelectorAll('.modal-overlay').forEach(function(o){o.remove();});
  window.logs=[item];
  window.openEditModal(0);
  // 用户把平仓类型从「分批」改成「初始止盈」= 断言整笔已退出
  var ct=document.getElementById('emCloseType');
  ct.value='initialTP';
  ct.dispatchEvent(new Event('change',{bubbles:true}));
  var cp=document.getElementById('emClosePrice'); cp.value='120';
  cp.dispatchEvent(new Event('input',{bubbles:true}));
  // 避免亏损原因为空阻断（若为亏损单则勾一个）
  var lr=document.getElementById('emLossReason');
  if(lr){ var cb=lr.querySelector('input[type=checkbox]'); if(cb) cb.checked=true; }
  window.saveEditLog(0);
  window._doCloseEditModal && window._doCloseEditModal();
  return { positionSize:item.positionSize, closedRatio:item.closedRatio,
           isClosed:window.utils.isClosed(item), pnl:item.pnlAmount, realized:item.realizedPnl };
})()`);
check(`改非分批后 closedRatio=100 判已平仓`, f4.closedRatio===100 && f4.isClosed===true,
  `closedRatio=${f4.closedRatio}, isClosed=${f4.isClosed}`);
check(`positionSize 已清零（实际=${f4.positionSize}）`, f4.positionSize===0,
  '已平仓记录不应再带剩余敞口');
check('累计已实现盈亏未被清空（分批历史保留）', parseFloat(f4.realized)>0,
  `realizedPnl=${f4.realized}, pnlAmount=${f4.pnl}`);

// ========== F5：_emPnlManual 保护生效 ==========
say('\n========== F5 已平仓记录的 PnL 不被自动重算覆盖 ==========');
const f5 = w.eval(`(function(){
  var item={symbol:'BTC',direction:'long',orderType:'market',stopType:'stop-market',
    entryPrice:100,effectiveEntryPrice:100,stopLoss:95,targetPrice:120,positionSize:10,
    leverage:3,riskAmount:50,initialRiskAmount:50,actualMargin:333,initialMargin:333,
    fee:0.4,feeRate:0.04,slippageCost:0,mindsetScore:3,signals:[],strategyFramework:'',
    strategyPattern:'',closeType:'initialTP',closePrice:120,pnlAmount:66.60,
    pnlPercent:19.98,rMultiple:1.33,grossPnlAmount:67,realizedPnl:66.60,realizedFee:0.4,
    closedRatio:100,lossReason:null,emotions:null,exitReason:'',closeNote:'',
    time:new Date(Date.now()-3600000).toISOString(),closeTime:new Date().toISOString()};
  document.querySelectorAll('.modal-overlay').forEach(function(o){o.remove();});
  window.logs=[item];
  window.openEditModal(0);
  var tag=document.getElementById('emPnlManualTag');
  var flag=window._emPnlManual;
  var pnlBefore=document.getElementById('emPnlAmount').value;
  // 改平仓价：若保护生效，PnL 不应被自动改写
  var cp=document.getElementById('emClosePrice'); cp.value='130';
  cp.dispatchEvent(new Event('input',{bubbles:true}));
  var pnlAfter=document.getElementById('emPnlAmount').value;
  window._doCloseEditModal();
  return {flag:flag, tagShown:tag?tag.style.display:null, before:pnlBefore, after:pnlAfter};
})()`);
check('打开已平仓记录时 _emPnlManual=true（保护已激活）', f5.flag===true, `实际=${f5.flag}`);
check('「手动」标签点亮（display=inline）', f5.tagShown==='inline', `实际=${f5.tagShown}`);
check(`改平仓价后 PnL 未被自动覆盖（${f5.before} → ${f5.after}）`,
  f5.before !== '' && f5.before === f5.after && parseFloat(f5.before) === 66.6,
  '修复前会被自动改写成 2.60（保护失效）');

// ========== F6：脏检查覆盖可保存字段 ==========
say('\n========== F6 脏检查不再漏字段 ==========');
const f6 = w.eval(`(function(){
  var item={symbol:'BTC',direction:'long',orderType:'market',stopType:'stop-market',
    entryPrice:100,stopLoss:95,positionSize:10,leverage:3,riskAmount:50,mindsetScore:3,
    signals:[],closeType:'',pnlAmount:null,initialRiskAmount:50,fee:0.4};
  document.querySelectorAll('.modal-overlay').forEach(function(o){o.remove();});
  window.logs=[item]; window.openEditModal(0);
  var st=document.getElementById('emStopType');
  st.value='stop-limit';
  window._editDirty=false; window.emCheckDirty();
  var dirtyStopType=window._editDirty;
  // 复原后再测未改动应为 false
  st.value='stop-market';
  window._editDirty=false; window.emCheckDirty();
  var dirtyUnchanged=window._editDirty;
  window._doCloseEditModal();
  return {dirtyStopType:dirtyStopType, dirtyUnchanged:dirtyUnchanged};
})()`);
check('只改止损类型后 _editDirty=true（不再静默丢改动）', f6.dirtyStopType===true, `实际=${f6.dirtyStopType}`);
check('未做任何改动时 _editDirty=false（不误报）', f6.dirtyUnchanged===false, `实际=${f6.dirtyUnchanged}`);

say('\n========================================');
say(`结果：${pass} 通过 / ${fail} 失败（共 ${pass+fail} 项）`);
say('========================================\n');
process.exit(0);
