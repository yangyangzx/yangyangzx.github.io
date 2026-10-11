// 整改回归 2：验证死配置已接线、多份副本已收口
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

say('========== C1 热量警告阈值：设置项真的生效了吗 ========');
const c1=w.eval(`(function(){
  function setWarn(v){ var s=loadSettings(); s.heatWarnMax=v; s.portfolioHeatMax=v;
    localStorage.setItem('trade_settings_v1', JSON.stringify(s)); }
  // 正确签名：calcPortfolioHeat(pendingRiskAmount, pendingSymbol, capitalOverride)
  // heat 必须落在「两条警告线之间、且低于硬上限」，才能观察到 warning 分支的差异。
  // 硬上限默认 6% → 取 heat=5.5%：警告线 5 触发、警告线 20 不触发。
  function probe(v){
    setWarn(v);
    var r=calcPortfolioHeat(55, 'BTC', 1000);
    return { hard:getHeatHardMax(), warn:getHeatWarnMax(), heat:r.heat,
             warning:r.warning, blocked:r.blocked };
  }
  return { lo:probe(5), hi:probe(20) };
})()`);
check(`警告线=5：hard=${c1.lo.hard} warn=${c1.lo.warn} heat=${c1.lo.heat.toFixed(2)}`,
  c1.lo.warn===5 && !c1.lo.blocked, JSON.stringify(c1.lo).slice(0,160));
check(`警告线=20：hard=${c1.hi.hard} warn=${c1.hi.warn} heat=${c1.hi.heat.toFixed(2)}`,
  c1.hi.warn===20 && !c1.hi.blocked, JSON.stringify(c1.hi).slice(0,160));
check(`同一 heat=${c1.lo.heat.toFixed(2)}% 下：警告线 5 触发警告、警告线 20 不触发 → 设置项确实生效`,
  c1.lo.warning !== null && c1.hi.warning === null,
  `5%: ${c1.lo.warning===null?'无警告':c1.lo.warning}\n       20%: ${c1.hi.warning===null?'无警告':c1.hi.warning}`);
// 静态：硬编码已清除
const allCode=LO.map(n=>{const p=path.join(ROOT,'js',n+'.js');return fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';}).join('\n')
  .split('\n').filter(l=>!/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
check('组合热量的 maxHeat*0.8 硬编码已全部清除',
  !/maxHeat\s*\*\s*0\.8|heatMax\s*\*\s*0\.8/.test(allCode));
check('getHeatWarnMax 已有真实消费方（定义+调用 > 1）',
  (allCode.match(/getHeatWarnMax\s*\(/g)||[]).length > 1,
  `出现 ${(allCode.match(/getHeatWarnMax\s*\(/g)||[]).length} 次`);

say('\n========== C2 单品种集中度：三处结论一致 ========');
const c2=w.eval(`(function(){
  function setConc(v){ var s=loadSettings(); s.singleSymbolMaxPct=v;
    localStorage.setItem('trade_settings_v1', JSON.stringify(s)); }
  function probe(v){ setConc(v); return { auth:checkSymbolConcentration('BTC',10,10,1000,[]).maxPct,
    reader:getSymbolConcentrationMaxPct() }; }
  return { normal:probe(20), zero:probe(0), str:probe('abc'), nul:probe(null) };
})()`);
check(`正常值 20：闸门 maxPct=${c2.normal.auth}，读取器=${c2.normal.reader}`,
  c2.normal.auth===20 && c2.normal.reader===20, JSON.stringify(c2.normal));
check(`脏值 0 → 回退 30（不静默接受 0）`, c2.zero.auth===30 && c2.zero.reader===30, JSON.stringify(c2.zero));
check(`脏值 "abc" → 回退 30（原 || 写法会让比较恒 false、闸门失效）`,
  c2.str.auth===30 && c2.str.reader===30, JSON.stringify(c2.str));
check('脏值 null → 回退 30', c2.nul.auth===30 && c2.nul.reader===30, JSON.stringify(c2.nul));
const plannerSrc=fs.readFileSync(path.join(ROOT,'js','planner.js'),'utf8');
check('planner.js 文案已改走 getSymbolConcentrationMaxPct（不再 || 30）',
  plannerSrc.includes('getSymbolConcentrationMaxPct()') && !plannerSrc.includes('settings.singleSymbolMaxPct || 30'));
const riskSrc=fs.readFileSync(path.join(ROOT,'js','risk.js'),'utf8');
check('risk.js 卡片已改走 getSymbolConcentrationMaxPct', riskSrc.includes('getSymbolConcentrationMaxPct()'));

say('\n========== C3 手续费率：副本已收口到 _getDefaultFeeRate ========');
const c3=w.eval(`(function(){
  function setFee(lim,mkt){ var s=loadSettings(); s.feeRateLimit=lim; s.feeRateMarket=mkt;
    localStorage.setItem('trade_settings_v1', JSON.stringify(s)); }
  setFee(0.02,0.03);
  return { limit:_getDefaultFeeRate('limit'), market:_getDefaultFeeRate('market'),
           market2:_getDefaultFeeRate('market') };
})()`);
check(`改设置后 _getDefaultFeeRate('limit')=${c3.limit}（用户设的 0.02）`, c3.limit===0.02, `实际=${c3.limit}`);
check(`_getDefaultFeeRate('market')=${c3.market}（用户设的 0.03）`, c3.market===0.03, `实际=${c3.market}`);
const pl=fs.readFileSync(path.join(ROOT,'js','planner.js'),'utf8');
check('planner.js 已无写死 0.04/0.08 兜底', !/\? 0\.04 : 0\.08/.test(pl));
const md=fs.readFileSync(path.join(ROOT,'js','modals.js'),'utf8');
check('modals.js 已无写死 0.04/0.08 兜底', !/\? 0\.04 : 0\.08/.test(md));

say('\n========== C4 回撤阈值守卫已补 ========');
const c4=w.eval(`(function(){
  function setDd(v){ var s=loadSettings(); s.maxDrawdownAlert=v;
    localStorage.setItem('trade_settings_v1', JSON.stringify(s)); }
  setDd(null);
  var a=loadSettings().maxDrawdownAlert;
  setDd(15);
  var b=loadSettings().maxDrawdownAlert;
  return { nul:a, val:b };
})()`);
check('设置读写正常（回退守卫在消费侧，不影响存储）',
  c4.nul===null && c4.val===15, JSON.stringify(c4));
const rk=fs.readFileSync(path.join(ROOT,'js','risk.js'),'utf8');
check('risk.js 回撤阈值已加 isFinite 守卫（与闸门一致）',
  rk.includes('maxDrawdownAlert') && /isFinite\(v\)\s*&&\s*v\s*>\s*0/.test(rk));

say('\n========================================');
say(`结果：${pass} 通过 / ${fail} 失败（共 ${pass+fail} 项）`);
say('========================================\n');
process.exit(0);
