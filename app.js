import { barDelta, totalVolume, allocateVolume } from './market-data.js';
const $ = s => document.querySelector(s);
const chart=$('#priceChart'), grid=$('#footprintGrid'), zoneList=$('#zoneList'), toast=$('#toast'), chartEmpty=$('#chartEmpty');
let bars=[], zones=[], selected=-1, selectedZone=null, showZones=true, showNumbers=true, mode='bidask', live=false, replayMode=false, toastTimer;
let levels=[], analysisMeta=null, hasAutoScrolled=false;
const fmt=(v,d=2)=>Number(v).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const timeLabel=(value,options={},method='toLocaleString')=>{const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date[method]('en-GB',options);};
const zonesWord=n=>{const tens=n%100,ones=n%10;if(ones===1&&tens!==11)return n+' зона';if(ones>=2&&ones<=4&&(tens<12||tens>14))return n+' зоны';return n+' зон';};
const barsWord=n=>{const tens=n%100,ones=n%10;if(ones===1&&tens!==11)return n+' СВЕЧА';if(ones>=2&&ones<=4&&(tens<12||tens>14))return n+' СВЕЧИ';return n+' СВЕЧЕЙ';};
const zoneStates={UNTESTED:'НЕ ПРОВЕРЕНА',SWEPT:'ПРОБИТА',TESTED:'ПРОВЕРЕНА',FLIPPED:'СМЕНА РОЛИ','AT PRICE':'У ЦЕНЫ','NEAR PRICE':'РЯДОМ'};
const zoneStateText=state=>zoneStates[String(state||'').toUpperCase()]||'НАЙДЕНА';
function zoneLabelText(label){
 const text=String(label||'Уровень'),flipped=text.endsWith(' · role flip'),base=flipped?text.slice(0,-' · role flip'.length):text;
 const translated=base
  .replace(/^Role-flip level \(highs \+ lows\)$/,'Смена роли (максимумы и минимумы)')
  .replace(/^Repeated swing highs$/,'Повторный максимум')
  .replace(/^Repeated swing lows$/,'Повторный минимум')
  .replace(/^Swing high$/,'Максимум свинга')
  .replace(/^Swing low$/,'Минимум свинга')
  .replace(/^Range high$/,'Максимум диапазона')
  .replace(/^Range low$/,'Минимум диапазона')
  .replace(/^Volume node$/,'Узел объёма')
  .replace(/^Round number$/,'Круглый уровень')
  .replace(/^(\d+)-bar high$/,'Максимум $1 свечей')
  .replace(/^(\d+)-bar low$/,'Минимум $1 свечей');
 return flipped?translated+' · смена роли':translated;
}
function notify(s){toast.textContent=s;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),2100);}
function currentLevels(){if(!live)return levels;const start=Math.max(0,Math.min(Math.max(0,bars.length-24),selected-12)),subset=bars.slice(start,start+24),set=new Set();for(const b of subset)for(const l of b.levels||[])set.add(Number(l.price));return [...set].sort((a,b)=>b-a).slice(0,32);}
function setEmptyState(empty){if(chartEmpty)chartEmpty.hidden=!empty;}
function renderChart(){
 if(!bars.length){chart.innerHTML='';chart.setAttribute('viewBox','0 0 1000 390');chart.style.width='100%';setEmptyState(true);return;}
 setEmptyState(false);
 const left=64, step=bars.length<=120?850/Math.max(1,bars.length):7, width=Math.max(850,bars.length*step), svgWidth=left+width+85;
 const allPrices=bars.flatMap(b=>[b.h,b.l]); if(!allPrices.length){setEmptyState(true);return;}
 const min=Math.min(...allPrices)-1,max=Math.max(...allPrices)+1,x=i=>left+step*(i+.5),y=p=>34+(max-p)/(max-min)*315,cw=Math.max(2,Math.min(10,step*.62));
 const rawStep=(max-min)/8,mag=10**Math.floor(Math.log10(rawStep)),gridStep=[1,2,2.5,5,10].map(m=>m*mag).find(v=>v>=rawStep);
 let html=''; for(let p=Math.ceil(min/gridStep)*gridStep;p<=max;p+=gridStep)html+=`<line x1="${left}" y1="${y(p)}" x2="${left+width}" y2="${y(p)}" class="grid-line"/><text x="${left+width+12}" y="${y(p)+4}" class="axis-label">${fmt(p,gridStep<1?2:gridStep<10?1:0)}</text>`;
 if(showZones)for(const z of zones){const top=y(z.high),h=Math.max(4,y(z.low)-y(z.high)),c=z.side==='buy'?'zone-buy':'zone-sell';html+=`<rect x="${left}" y="${top}" width="${width}" height="${h}" class="${c} ${selectedZone===z.id?'selected-zone':''}" opacity="${.08+z.strength*.2}"/><line x1="${left}" y1="${top}" x2="${left+width}" y2="${top}" class="${c}-edge"/>`;}
 bars.forEach((b,i)=>{const cx=x(i),up=b.c>=b.o,top=Math.min(y(b.o),y(b.c)),h=Math.max(1.5,Math.abs(y(b.o)-y(b.c)));html+=`<g class="candle ${i===selected?'selected-candle':''}" data-index="${i}" tabindex="0" role="button" aria-label="Выбрать свечу ${i+1}"><line x1="${cx}" y1="${y(b.h)}" x2="${cx}" y2="${y(b.l)}" class="wick ${up?'wick-up':'wick-down'}"/><rect x="${cx-cw/2}" y="${top}" width="${cw}" height="${h}" rx="1" class="${up?'candle-up':'candle-down'}"/><rect x="${cx-step/2}" y="30" width="${step}" height="322" class="hit-area"/></g>`;
 if(i%(Math.ceil(bars.length/8))===0)html+=`<text x="${cx}" y="378" text-anchor="middle" class="time-label">${timeLabel(b.time,{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})}</text>`;});
 const last=bars.at(-1),py=y(last.c);html+=`<line x1="${left}" y1="${py}" x2="${left+width}" y2="${py}" class="last-price-line"/><rect x="${left+width-2}" y="${py-11}" width="70" height="22" rx="5" class="last-price-tag"/><text x="${left+width+33}" y="${py+4}" text-anchor="middle" class="last-price-text">${fmt(last.c)}</text>`;
 chart.setAttribute('viewBox',`0 0 ${svgWidth} 390`);chart.style.width=svgWidth+'px';chart.innerHTML=html;
 chart.querySelectorAll('.candle').forEach(n=>{const f=()=>select(Number(n.dataset.index));n.addEventListener('click',f);n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();f();}});});if(live&&!hasAutoScrolled){chart.parentElement.scrollLeft=chart.parentElement.scrollWidth;hasAutoScrolled=true;}
}
function renderZones(){
 const buyCount=zones.filter(z=>z.side==='buy').length,sellCount=zones.filter(z=>z.side==='sell').length;
 $('#zoneCount').textContent=String(zones.length).padStart(2,'0');$('#aboveZones').textContent=zonesWord(buyCount);$('#belowZones').textContent=zonesWord(sellCount);
 if(!zones.length){zoneList.innerHTML='<div class="zone-empty">Зон пока нет. Они появятся, когда загрузится история брокера.</div>';return;}
 zoneList.innerHTML=zones.map(z=>`<button class="zone-row ${selectedZone===z.id?'selected':''}" data-zone="${z.id}"><span class="zone-side-dot ${z.side}"></span><span class="zone-info"><strong>${zoneLabelText(z.label)}</strong><small>${fmt(z.low)} — ${fmt(z.high)}</small><span class="zone-meter"><i class="${z.side}" style="width:${z.strength*100}%"></i></span></span><span class="zone-right"><b>${z.distance||''}</b><small>${zoneStateText(z.state)}</small><small class="zone-reaction">${z.reactions?.touches?`реакция ${z.reactions.respected}/${z.reactions.touches}`:'касаний не было'}</small></span></button>`).join('');
 zoneList.querySelectorAll('button').forEach(n=>n.addEventListener('click',()=>{selectedZone=selectedZone===n.dataset.zone?null:n.dataset.zone;renderZones();renderChart();}));
}
function cell(b,p){if(Array.isArray(b.levels)){const v=b.levels.find(l=>Math.abs(l.price-p)<1e-7);return v?{bid:v.bid,ask:v.ask,unknown:v.unknown||0,imbalance:b.imbalances?.find(x=>Math.abs(x.price-p)<1e-7)?.side||null}:{bid:0,ask:0,unknown:0,imbalance:null};}const ri=levels.indexOf(p),ci=bars.indexOf(b),bw=levels.map((_,i)=>1+((i*7+ci*3)%5)),aw=levels.map((_,i)=>1+((i*5+ci*7+2)%5));return{bid:allocateVolume(b.bid,bw)[ri]||0,ask:allocateVolume(b.ask,aw)[ri]||0,unknown:0};}
function renderFootprint(){
 if(!bars.length){grid.innerHTML='<div class="detail-caption">Тики брокера ещё не поступили. Подключите MT5, чтобы построить футпринт.</div>';return;}
 const windowSize=24,start=Math.max(0,Math.min(Math.max(0,bars.length-windowSize),selected-Math.floor(windowSize/2))),visible=bars.slice(start,start+windowSize),offset=start,priceRows=currentLevels();if(!priceRows.length){grid.innerHTML='<div class="detail-caption">Ожидание тиков брокера…</div>';return;}
 const cols=visible.length,template=`68px repeat(${cols},minmax(34px,1fr))`;
 const head=`<div class="foot-row foot-head" style="grid-template-columns:${template};min-width:${68+cols*37}px"><div class="price-level">ЦЕНА</div>${visible.map((b,i)=>`<div class="bar-head ${offset+i===selected?'active':''}">#${String(offset+i+1).padStart(3,'0')}</div>`).join('')}</div>`;
 const rows=priceRows.map(p=>`<div class="foot-row" style="grid-template-columns:${template};min-width:${68+cols*37}px"><div class="price-level">${fmt(p)}</div>${visible.map((b,i)=>{const v=cell(b,p),delta=v.ask-v.bid,total=v.ask+v.bid+v.unknown,intensity=Math.min(.72,.12+total/24);let content='',cls='';if(mode==='bidask'){content=`<span>${showNumbers?(v.unknown?'·':v.bid):''}</span><span>${showNumbers?(v.unknown?'·':v.ask):''}</span>`;cls='bidask';}if(mode==='delta'){content=showNumbers?(v.unknown?'·':(delta>0?'+':'')+delta):'';cls=delta>=0?'delta-positive':'delta-negative';}if(mode==='volume'){content=showNumbers?fmt(total,0):'';cls='volume-cell';}if(v.imbalance)cls+=' imbalance-'+v.imbalance;return `<button class="foot-cell ${cls} ${offset+i===selected?'active':''}" data-index="${offset+i}" style="--intensity:${intensity}" title="Бид ${v.bid}; аск ${v.ask}; без стороны ${v.unknown}" aria-label="Свеча ${offset+i+1}, цена ${fmt(p)}, бид ${v.bid}, аск ${v.ask}, без стороны ${v.unknown}">${content}</button>`;}).join('')}</div>`).join('');
 const times=`<div class="foot-row foot-times" style="grid-template-columns:${template};min-width:${68+cols*37}px"><div class="price-level">ВРЕМЯ</div>${visible.map((b,i)=>`<button class="bar-time ${offset+i===selected?'active':''}" data-index="${offset+i}">${timeLabel(b.time,{hour:'2-digit',minute:'2-digit',timeZone:'UTC'},'toLocaleTimeString')}</button>`).join('')}</div>`;
 grid.innerHTML=`<div class="footprint-table" style="min-width:${68+cols*37}px">${head}${rows}${times}</div>`;grid.querySelectorAll('[data-index]').forEach(n=>n.addEventListener('click',()=>select(Number(n.dataset.index))));
}
function renderInspector(){
 const clear=()=>{$('#selectedBar').textContent='—';$('#selectedDelta').textContent='— Δ';$('#selectedDelta').className='delta-chip';$('#bidVolume').textContent='—';$('#askVolume').textContent='—';$('#totalVolume').textContent='—';$('#imbalance').textContent='—';};
 const b=bars[selected];if(!b){clear();return;}
 const d=(b.unknown||0)>0?null:(b.delta??barDelta(b)),bid=b.bid||0,ask=b.ask||0;
 $('#selectedBar').textContent=`#${String(selected+1).padStart(3,'0')} · ${timeLabel(b.time,{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',timeZone:'UTC'})}`;$('#selectedDelta').textContent=d===null?'— Δ':`${d>0?'+':''}${fmt(d,0)} Δ`;$('#selectedDelta').className=`delta-chip ${d===null?'':d>=0?'positive-bg':'negative-bg'}`;$('#bidVolume').textContent=fmt(bid,0);$('#askVolume').textContent=fmt(ask,0);$('#totalVolume').textContent=fmt(b.volume??totalVolume(b),0);$('#imbalance').textContent=bid&&ask?`${(Math.max(bid,ask)/Math.min(bid,ask)).toFixed(2)}×`:'—';
}
function select(i){
 if(!Number.isInteger(i)||i<0||i>=bars.length){selected=-1;renderInspector();renderChart();renderFootprint();return;}
 selected=i;renderInspector();renderChart();renderFootprint();
}
$('#zonesToggle').addEventListener('click',e=>{showZones=!showZones;e.currentTarget.setAttribute('aria-pressed',String(showZones));e.currentTarget.classList.toggle('is-off',!showZones);renderChart();notify(showZones?'Зоны ликвидности показаны':'Зоны ликвидности скрыты');});
$('#numbersToggle').addEventListener('click',e=>{showNumbers=!showNumbers;e.currentTarget.setAttribute('aria-pressed',String(showNumbers));renderFootprint();});
$('#footprintModes').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;$('#footprintModes').querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));renderFootprint();}));
$('#resetView').addEventListener('click',()=>{replayMode=false;showZones=true;showNumbers=true;mode='bidask';selectedZone=null;$('#zonesToggle').setAttribute('aria-pressed','true');$('#numbersToggle').setAttribute('aria-pressed','true');$('#zonesToggle').classList.remove('is-off');renderZones();$('#footprintModes').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.mode==='bidask'));select(bars.length-1);notify('Вид сброшен');});
$('#layoutButton').addEventListener('click',()=>{$('#workspace').classList.toggle('focus-chart');notify($('#workspace').classList.contains('focus-chart')?'Режим графика включён':'Рабочая область восстановлена');});
window.addEventListener('market-analysis',e=>{if(replayMode)return;const a=e.detail;if(!a?.bars?.length)return;const previousTime=bars[selected]?.time,wasAtLatest=selected===bars.length-1;bars=a.bars;live=true;analysisMeta=a;zones=a.zones||[];selected=wasAtLatest||selected<0?bars.length-1:Math.max(0,bars.findIndex(b=>b.time===previousTime));levels=currentLevels();const feedLive=a.feed?.status==='online';const status=$('#chartStatus');if(status){status.textContent=(feedLive?'ОНЛАЙН · ':'ИСТОРИЯ · ')+barsWord(bars.length);status.className=feedLive?'ok':'warning';}const signalSummary=$('#signalSummary');if(signalSummary){const sweeps=bars.reduce((n,b)=>n+(b.sweeps?.length||0),0),stacked=bars.reduce((n,b)=>n+(b.stackedImbalances?.length||0),0),absorption=bars.filter(b=>b.absorption).length,exhaustion=bars.filter(b=>b.exhaustion).length;signalSummary.textContent='СНЯТИЯ '+sweeps+' · НАКОПЛЕНИЯ '+stacked+' · ПОГЛОЩЕНИЕ '+absorption+' · ИСТОЩЕНИЕ '+exhaustion;}const tag=$('#dataMode');if(tag)tag.textContent=feedLive?'ROBOFOREX MT5 · ОНЛАЙН':'ROBOFOREX MT5 · ИСТОРИЯ';const range=$('#barCount');if(range)range.textContent=barsWord(bars.length);const windowNode=$('#sessionWindow');if(windowNode){const hh=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');};windowNode.textContent=hh(bars[0].time)+' — '+hh(bars.at(-1).time);}renderZones();select(selected);});
window.addEventListener('market-replay',e=>{
 const a=e.detail;if(!a?.bars?.length)return;
 replayMode=true;bars=a.bars;live=true;analysisMeta=a;zones=a.zones||[];selected=0;levels=currentLevels();hasAutoScrolled=false;
 const status=$('#chartStatus');if(status){status.textContent='ПОВТОР · '+barsWord(bars.length);status.className='ok';}
 const tag=$('#dataMode');if(tag)tag.textContent='ИСТОРИЧЕСКИЙ ПОВТОР';
 const count=$('#barCount');if(count)count.textContent=barsWord(bars.length);
 const summary=$('#signalSummary');if(summary)summary.textContent='ПОВТОР · '+(a.eventCount||0)+' ТИКОВ БРОКЕРА';
 renderZones();select(0);
});
window.addEventListener('market-replay-step',e=>{if(replayMode)select(Number(e.detail?.index));});
window.addEventListener('exit-replay',()=>{replayMode=false;});
const initialStatus=$('#chartStatus');if(initialStatus&&!live){initialStatus.textContent='ОЖИДАНИЕ ДАННЫХ · ПОДКЛЮЧИТЕ MT5';initialStatus.className='warning';}
renderZones();renderInspector();renderChart();renderFootprint();
