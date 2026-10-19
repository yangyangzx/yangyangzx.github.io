// 冒烟：改动后核心渲染/统计链路是否仍可用（捕获 ReferenceError 一类运行期错误）
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const ROOT=path.join(__dirname,'..');
const LO=['chart-guard','constants','utils','select-ui','toast','slippage','storage','skills-integration',
'calc-visuals','calculation-ui','calculator','logs','rendering','stats','modals','navigation','dashboard',
'planner','discipline-led','settings','risk','chart-factory','analytics','review','io','dom-cache','app','version'];
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:8000/'});
const w=dom.window;
w.eval("window.Chart=function(){return{destroy(){},update(){},data:{},config:{},options:{}}};window.Chart.getChart=function(){return null;};window.Chart.defaults={plugins:{legend:{labels:{color:'#000'}}}};");
for(const n of LO){
  const p=path.join(ROOT,'js',n+'.js'); if(!fs.existsSync(p)) continue;
  const s=w.document.createElement('script'); s.textContent=fs.readFileSync(p,'utf8'); w.document.head.appendChild(s);
}
const results=w.eval(`(function(){
  var out=[];
  function t(name, fn){ try { fn(); out.push('OK   '+name); } catch(e){ out.push('FAIL '+name+' :: '+e.message); } }
  var one={symbol:'BTC',direction:'long',entryPrice:100,stopLoss:95,positionSize:10,leverage:3,
    riskAmount:5,mindsetScore:3,signals:[],time:new Date().toISOString()};
  var closed=Object.assign({},one,{closeType:'initialTP',closePrice:110,pnlAmount:10,pnlPercent:1.0,
    rMultiple:2,grossPnlAmount:10.4,closedRatio:100,realizedPnl:10,realizedFee:0.4,
    initialRiskAmount:5,initialPositionSize:10,closes:[{type:'initialTP',price:110,ratio:100,fee:0.4,pnl:10}],
    closeTime:new Date().toISOString(),fee:0.4});
  var partial=Object.assign({},one,{closeType:'partialTP',closePrice:110,pnlAmount:10,pnlPercent:1.0,
    rMultiple:2,grossPnlAmount:10.4,closedRatio:50,realizedPnl:10,realizedFee:0.2,
    initialRiskAmount:5,initialPositionSize:10,positionSize:5,partialRatio:50,
    closes:[{type:'partialTP',price:110,ratio:50,fee:0.2,pnl:10}],closeTime:new Date().toISOString()});

  t('renderLogs 空态', function(){ window.logs=[]; window.renderLogs(); });
  t('renderLogs 持仓', function(){ window.logs=[one]; window.renderLogs(); });
  t('renderLogs 已平仓', function(){ window.logs=[closed]; window.renderLogs(); });
  t('renderLogs 分批中间态', function(){ window.logs=[partial]; window.renderLogs(); });
  t('updateStats', function(){ window.logs=[one,closed,partial]; window.updateStats(); });
  t('_getOpenLogs', function(){ window._getOpenLogs(); });
  t('isTradeStillOpen', function(){ window.isTradeStillOpen(one); window.isTradeStillOpen(closed); window.isTradeStillOpen(partial); });
  t('dailySharpe', function(){ window.utils.dailySharpe([closed]); });
  t('_getTodayLossStreak', function(){ window._getTodayLossStreak(); });
  t('状态筛选 open', function(){ window._activeFilters={status:'open'}; window._filterMatch(one); window._activeFilters={status:'open'}; window._filterMatch(partial); });
  t('状态筛选 closed', function(){ window._activeFilters={status:'closed'}; window._filterMatch(closed); window._activeFilters={status:'closed'}; window._filterMatch(one); });
  t('时间筛选', function(){ window._activeFilters={time:'last30'}; window._filterMatch(closed); });
  window._activeFilters={};
  t('syncCloseBookkeeping 分批', function(){ var x=Object.assign({},partial); window.utils.syncCloseBookkeeping(x,'partialTP',30); });
  t('syncCloseBookkeeping 收尾', function(){ var x=Object.assign({},partial); window.utils.syncCloseBookkeeping(x,'initialTP',null); });
  t('closedRatioDelta', function(){ window.utils.closedRatioDelta(50,500,1000); });
  return out;
})()`);
results.forEach(r=>process.stdout.write(r+'\n'));
const failed=results.filter(r=>r.startsWith('FAIL'));
process.stdout.write('\n结果：'+results.length+' 项，失败 '+failed.length+' 项\n');
process.exit(failed.length > 0 ? 1 : 0);
