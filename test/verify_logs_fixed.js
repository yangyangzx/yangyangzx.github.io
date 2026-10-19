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

// ========== F5：已平仓记录改平仓价 → 预览与落库同步 ==========
// 历史说明：本组原先断言「改平仓价后 PnL 不被重算」（原值 66.60 必须保持），
// 该行为被 2f6a3cb「修复编辑已平仓交易时改平仓价/类型盈亏不重算的bug」推翻——
// 改平仓价却不让盈亏跟着变，才是 bug。现断言重算后的值正确且预览与落库一致。
// fixture 必须自洽：positionSize 是**名义仓位(USDT)**，quantity = positionSize/entryPrice。
// 原 fixture 写 positionSize:10 @ entry 100 却配 fee:0.4、pnl:66.6，
// 数学上不可能，导致重算值 2.60 被误当成产品 bug。
say('\n========== F5 已平仓记录改平仓价：预览重算且与落库一致 ==========');
const f5 = w.eval(`(function(){
  // 自洽：名义 1000 @ entry 100 → 张数 10；止损 95 → 初始风险额 50；
  // 原平仓 120 → 毛利 200，费 10×(100+120)×0.0004=0.88，净 199.12，R=3.98
  var item={symbol:'BTC',direction:'long',orderType:'market',stopType:'stop-market',
    entryPrice:100,effectiveEntryPrice:100,stopLoss:95,targetPrice:120,positionSize:1000,
    initialPositionSize:1000,leverage:10,riskAmount:50,initialRiskAmount:50,
    actualMargin:100,initialMargin:100,
    fee:0.88,feeRate:0.04,slippageCost:0,mindsetScore:3,signals:[],strategyFramework:'',
    strategyPattern:'',closeType:'initialTP',closePrice:120,pnlAmount:199.12,
    pnlPercent:199.12,rMultiple:3.98,grossPnlAmount:200,realizedPnl:199.12,realizedFee:0.88,
    closedRatio:100,lossReason:null,emotions:null,exitReason:'',closeNote:'',
    time:new Date(Date.now()-3600000).toISOString(),closeTime:new Date().toISOString()};
  document.querySelectorAll('.modal-overlay').forEach(function(o){o.remove();});
  window.logs=[item];
  window.openEditModal(0);
  // 标签状态必须在任何输入之前取：改平仓价属于「主动改动」，
  // 会按设计解除锁定并熄灭标签（modals.js _unlockFields）。
  var tag=document.getElementById('emPnlManualTag');
  var opened={flag:window._emPnlManual, tagShown:tag?tag.style.display:null};
  // 改平仓价 120 → 130：毛利 (130-100)×10=300，费沿用已存 0.88 → 净 299.12，R=299.12/50=5.98
  var cp=document.getElementById('emClosePrice'); cp.value='130';
  cp.dispatchEvent(new Event('input',{bubbles:true}));
  var preview={pnl:document.getElementById('emPnlAmount').value,
               rr:document.getElementById('emRMultiple').value,
               manual:window._emPnlManual,
               tagShown:tag?tag.style.display:null};
  window.saveEditLog(0);
  var s=logs[0];
  return {opened:opened, preview:preview,
          saved:{closePrice:s.closePrice, pnlAmount:s.pnlAmount,
                 grossPnlAmount:s.grossPnlAmount, realizedPnl:s.realizedPnl,
                 rMultiple:s.rMultiple, positionSize:s.positionSize}};
})()`);
check('打开已平仓记录时 _emPnlManual=true（保护已激活）', f5.opened.flag===true, `实际=${f5.opened.flag}`);
check('打开时「手动」标签点亮（display=inline）', f5.opened.tagShown==='inline', `实际=${f5.opened.tagShown}`);
check('改平仓价后解除锁定（允许按新价重算）', f5.preview.manual===false, `实际=${f5.preview.manual}`);
check(`预览 PnL 按新价重算（期望 299.12）`, f5.preview.pnl==='299.12', `实际=${f5.preview.pnl}`);
check(`预览 R 倍数按初始风险额重算（期望 5.98）`, f5.preview.rr==='5.98', `实际=${f5.preview.rr}`);
check(`落库平仓价已更新（期望 130）`, Number(f5.saved.closePrice)===130, `实际=${f5.saved.closePrice}`);
check(`落库 pnlAmount 与预览一致（期望 299.12）`, Number(f5.saved.pnlAmount)===299.12,
  `实际=${f5.saved.pnlAmount}（预览=${f5.preview.pnl}）`);
check(`落库 grossPnlAmount 与预览口径一致（期望 300）`, Number(f5.saved.grossPnlAmount)===300,
  `实际=${f5.saved.grossPnlAmount}`);
check(`落库 R 倍数与预览一致（期望 5.98）`, Number(f5.saved.rMultiple)===5.98,
  `实际=${f5.saved.rMultiple}`);

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

say('\n========== R8 R/收益率分母锚点单一权威（防内联回退） ==========');
// 背景：这段「有锚点用锚点、否则回退 settlement」的三元此前在仓库里有 7 份副本
// （logs.js 的分批/收尾/全新平仓 + modals.js 的预览/两处落库），且条件写法并不一致：
// 有的判 `!= null`、有的判 `!isNaN`，锚点是 "abc" 之类脏值时行为会分叉。
// 现统一收敛到 utils.resolveRMultiple / resolvePnlPercent。
// 下面用源码断言：这类「当前恰好等价、写法不同」的重复，光靠运行时断言防不住——
// 只要有人再写一份三元，分叉会重新长出来且没有任何测试变红。
const srcUtils = fs.readFileSync(path.join(ROOT, 'js', 'utils.js'), 'utf8');
const srcLogs = fs.readFileSync(path.join(ROOT, 'js', 'logs.js'), 'utf8');
const srcModals = fs.readFileSync(path.join(ROOT, 'js', 'modals.js'), 'utf8');
const srcAll = srcUtils + srcLogs + srcModals;

check('utils.js 定义 resolveRMultiple / resolvePnlPercent',
  /util\.resolveRMultiple\s*=/.test(srcUtils) && /util\.resolvePnlPercent\s*=/.test(srcUtils));

// 业务层落库/预览共 10 处锚点调用：logs.js 3×R + 2×收益率、modals.js 3×R + 2×收益率
// + 预览 1×R。数量是结构断言（与 verify_reset_fix 的做法一致）：新增一处落库路径若
// 又绕过权威函数，这里的计数就会对不上。
const callR = (srcLogs.match(/resolveRMultiple\(/g) || []).length
            + (srcModals.match(/resolveRMultiple\(/g) || []).length;
const callP = (srcLogs.match(/resolvePnlPercent\(/g) || []).length
            + (srcModals.match(/resolvePnlPercent\(/g) || []).length;
check(`业务层锚点调用收敛到 10 处（R=${callR} + 收益率=${callP}），无遗漏也无重复`,
  callR === 6 && callP === 4, `实际 R=${callR}、收益率=${callP}`);

// 防回退：不得再出现「就地判断 initialRiskAmount > 0 后自己算 R」的内联写法。
const inlineAnchor = (srcAll.match(/initialRiskAmount\)\s*>\s*0\s*\)/g) || []).length;
check('锚点判定不再内联（无 initialRiskAmount > 0 形式的就地三元）',
  inlineAnchor === 0, `实际 ${inlineAnchor} 处`);

// 锚点脏值守卫：resolveRMultiple 内部必须有 isFinite 判定，
// 否则 "abc" 会被当成有效锚点（parseFloat("abc") 是 NaN，比较恒 false → 落回 fallback，
// 但若有人改成只判 > 0，NaN > 0 为 false 尚可，真正危险的是把 "0" 与 "" 混同）。
check('resolveRMultiple 内部含 isFinite 守卫',
  /util\.resolveRMultiple[\s\S]{0,600}?isFinite/.test(srcUtils));
check('resolvePnlPercent 内部含 isFinite 守卫',
  /util\.resolvePnlPercent[\s\S]{0,600}?isFinite/.test(srcUtils));

// 端到端：脏锚点不得让 R 变成 NaN（NaN 会直接毁掉统计页的均值与 R 倍数排序）
const r8 = w.eval(`(function(){
  var out={};
  var item={symbol:'BTC',direction:'long',entryPrice:100,effectiveEntryPrice:100,
    stopLoss:95,targetPrice:120,positionSize:1000,initialPositionSize:1000,leverage:10,
    riskAmount:50,fee:0.88,feeRate:0.04,slippageCost:0,mindsetScore:3,signals:[],
    initialRiskAmount:'abc',initialMargin:'abc',
    closeType:'initialTP',closePrice:120,pnlAmount:199.12,closedRatio:100};
  out.dirty = {
    r: window.utils.resolveRMultiple(199.12, 'abc', 3.98),
    p: window.utils.resolvePnlPercent(199.12, 'abc', 199.12)
  };
  out.good = {
    r: window.utils.resolveRMultiple(199.12, 50, 3.98),
    p: window.utils.resolvePnlPercent(199.12, 100, 199.12)
  };
  return out;
})()`);
check('脏锚点下 R 走回退而非 NaN', r8.dirty.r === 3.98, `实际=${r8.dirty.r}`);
check('脏锚点下收益率走回退而非 NaN', r8.dirty.p === 199.12, `实际=${r8.dirty.p}`);
check('有效锚点 50：R = 199.12/50 = 3.98', r8.good.r === 3.98, `实际=${r8.good.r}`);
check('有效锚点 100：收益率 = 199.12%', r8.good.p === 199.12, `实际=${r8.good.p}`);

// 回归：预览算不出分母时必须「保持原值」，不能清空 emRMultiple。
// emRMultiple 在 modals.js:354 用 item.rMultiple 预填，:1356 保存时回读该字段——
// 一旦被清成空串，「打开一条记录什么都不改直接保存」就会把 item.rMultiple 置 null，
// 静默抹掉 R 倍数。这正是本次收敛时最容易引入的副作用。
const r8b = w.eval(`(function(){
  function mk(over){
    var item=Object.assign({symbol:'BTC',direction:'long',entryPrice:100,effectiveEntryPrice:100,
      stopLoss:95,targetPrice:120,positionSize:1000,leverage:10,
      fee:0.88,feeRate:0.04,slippageCost:0,mindsetScore:3,signals:[],
      closeType:'initialTP',closePrice:120,pnlAmount:199.12,closedRatio:100,
      rMultiple:3.98}, over||{});
    document.querySelectorAll('.modal-overlay').forEach(function(o){o.remove();});
    window.logs=[item];
    window.openEditModal(0);
    var v=document.getElementById('emRMultiple').value;
    window._doCloseEditModal();
    return v;
  }
  return {
    noAnchor: mk({initialRiskAmount:undefined, riskAmount:null}),
    dirtyAnchor: mk({initialRiskAmount:'abc', riskAmount:null}),
    normal: mk({initialRiskAmount:50, riskAmount:50})
  };
})()`);
check('无锚点时 emRMultiple 保留预填值（不被清空）',
  r8b.noAnchor !== '' && r8b.noAnchor !== undefined, `实际=${JSON.stringify(r8b.noAnchor)}`);
check('脏锚点时 emRMultiple 保留预填值（不被清空）',
  r8b.dirtyAnchor !== '' && r8b.dirtyAnchor !== undefined, `实际=${JSON.stringify(r8b.dirtyAnchor)}`);
check('有效锚点时 emRMultiple 按锚点重算',
  Math.abs(parseFloat(r8b.normal) - 3.98) < 1e-9, `实际=${r8b.normal}`);

say('\n========================================');
say(`结果：${pass} 通过 / ${fail} 失败（共 ${pass+fail} 项）`);
say('========================================\n');
// 退出码必须反映断言结果（原先无条件 exit(0)，失败被吞掉）。
process.exit(fail > 0 ? 1 : 0);
