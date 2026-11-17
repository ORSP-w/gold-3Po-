const api=document.querySelector('#apiStatus'),mt5=document.querySelector('#mt5Status'),comex=document.querySelector('#comexStatus');
const labels={mt5,comex};let source;let analysisTimer=null;let lastAnalysisAt=0;
function paint(node,label,state){if(!node)return;node.textContent=label;node.className=state==='online'?'ok':state==='error'?'error':'warning';}
function ageLabel(ms){if(!Number.isFinite(ms))return '—';if(ms<1000)return 'NOW';if(ms<60000)return Math.floor(ms/1000)+'s AGO';return Math.floor(ms/60000)+'m AGO';}
async function refreshAnalysis(){
 try{
  const response=await fetch('/v1/market/analysis?symbol=XAUUSD&intervalMs=900000&priceStep=0.1',{cache:'no-store'});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const data=await response.json();
  if(data.bars?.length){
   window.dispatchEvent(new CustomEvent('market-analysis',{detail:data}));
   const mode=document.querySelector('#dataMode');if(mode)mode.textContent='ROBOFOREX MT5 · '+data.bars.length+' BARS';
   const price=document.querySelector('#referencePrice');if(price)price.textContent=Number(data.bars.at(-1).c).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
   const count=document.querySelector('#barCount');if(count)count.textContent=data.bars.length+' BARS';
   lastAnalysisAt=Date.now();
  }
 }catch{ /* A missing broker feed must not replace the fixture or break the workspace. */ }
}
function scheduleAnalysis(){if(analysisTimer)return;analysisTimer=window.setTimeout(()=>{analysisTimer=null;refreshAnalysis();},1500);}
async function refreshHealth(){
 try{
  const response=await fetch('/health',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);
  const health=await response.json();paint(api,health.ingestConfigured?'API ONLINE':'TOKEN MISSING',health.ingestConfigured?'online':'warning');
  for(const name of ['mt5','comex']){const feed=health.feeds.find(item=>item.source===name&&(name==='comex'||!item.symbol||item.symbol==='XAUUSD'));if(!feed)paint(labels[name],'WAITING','warning');else paint(labels[name],feed.status.toUpperCase()+' · '+ageLabel(feed.ageMs),feed.status);}
  if(Date.now()-lastAnalysisAt>10000)scheduleAnalysis();
 }catch{paint(api,'API OFFLINE','error');paint(mt5,'UNAVAILABLE','error');paint(comex,'UNAVAILABLE','error');}
}
function connectStream(){
 if(!('EventSource'in window)){paint(api,'SSE UNSUPPORTED','error');return;}
 source=new EventSource('/v1/stream');source.onopen=()=>{refreshHealth();scheduleAnalysis();};source.onerror=()=>paint(api,'RECONNECTING','warning');
 source.addEventListener('market',event=>{try{const message=JSON.parse(event.data);const target=labels[message.source];if(target)paint(target,'LIVE · '+ageLabel(Date.now()-Date.parse(message.receivedAt)),'online');if(message.source==='mt5'&&message.symbol==='XAUUSD')scheduleAnalysis();}catch{/* malformed frame ignored; health polling remains authoritative */}});
}
refreshHealth();refreshAnalysis();connectStream();window.setInterval(refreshHealth,5000);
