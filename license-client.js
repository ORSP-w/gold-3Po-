const gate=document.querySelector('#licenseGate'),keyInput=document.querySelector('#licenseKeyInput'),message=document.querySelector('#licenseMessage'),meta=document.querySelector('#licenseMeta'),machineNode=document.querySelector('#licenseMachineId'),statusNode=document.querySelector('#licenseStatus');
const reasonText={
 missing_license:'Вставьте лицензионный ключ, полученный от продавца.',
 malformed_key:'Это не похоже на ключ GOLD-3Po. Вставьте строку целиком, она начинается с GOLD1.',
 bad_signature:'Подпись ключа неверна. Используйте ключ, выданный именно для этого компьютера.',
 wrong_machine:'Ключ выдан для другого компьютера. Отправьте продавцу ID компьютера, указанный ниже.',
 wrong_product:'Ключ относится к другому продукту.',
 invalid_days:'В ключе неверный срок действия. Свяжитесь с продавцом.',
 invalid_dates:'В ключе неверные даты. Свяжитесь с продавцом.',
 expired:'Срок лицензии истёк. Свяжитесь с продавцом для продления.',
 not_yet_valid:'Ключ ещё не вступил в силу. Проверьте системные дату и время.',
 clock_rollback:'Системные часы установлены назад. Восстановите правильные дату и время, чтобы продолжить.',
 license_write_failed:'Не удалось сохранить лицензию рядом с приложением. Проверьте права на папку.',
 disabled:''
};
const statusText={
 missing_license:'НЕТ КЛЮЧА',malformed_key:'НЕВЕРНЫЙ КЛЮЧ',bad_signature:'НЕВЕРНАЯ ПОДПИСЬ',wrong_machine:'ДРУГОЙ КОМПЬЮТЕР',
 wrong_product:'ДРУГОЙ ПРОДУКТ',invalid_days:'НЕВЕРНЫЙ СРОК',invalid_dates:'НЕВЕРНЫЕ ДАТЫ',expired:'ИСТЕКЛА',
 not_yet_valid:'ЕЩЁ НЕ ДЕЙСТВУЕТ',clock_rollback:'ЧАСЫ НАЗАД',license_write_failed:'ОШИБКА ЗАПИСИ'
};
function paintStatus(s){
 if(!statusNode)return;
 if(!s.required){statusNode.textContent='НЕ ТРЕБУЕТСЯ';statusNode.className='ok';return;}
 if(s.valid){statusNode.textContent='АКТИВНА · '+(s.daysLeft??0)+' дн.';statusNode.className=s.daysLeft<=7?'warning':'ok';}
 else{statusNode.textContent=statusText[s.reason]||(s.reason||'НЕВЕРНЫЙ КЛЮЧ').toUpperCase().replace(/_/g,' ');statusNode.className='error';}
}
function render(s){
 paintStatus(s);
 if(machineNode)machineNode.textContent=s.machineId||'—';
 if(!s.required||s.valid){gate.hidden=true;return;}
 gate.hidden=false;
 if(message)message.textContent=reasonText[s.reason]||'Проблема с лицензией: '+(s.reason||'неизвестно')+'.';
 if(meta){
  const parts=[];
  if(s.expiresAt)parts.push('Действует до '+new Date(s.expiresAt).toISOString().slice(0,10));
  if(s.keyId)parts.push('ID ключа: '+s.keyId);
  meta.textContent=parts.join(' · ');
 }
}
async function refresh(){
 try{const r=await fetch('/v1/license/status',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);render(await r.json());}
 catch{if(statusNode){statusNode.textContent='API НЕДОСТУПЕН';statusNode.className='error';}}
}
document.querySelector('#activateLicense')?.addEventListener('click',async()=>{
 const key=(keyInput?.value||'').trim();
 if(!key){if(message)message.textContent=reasonText.missing_license;return;}
 if(message)message.textContent='Проверяем ключ…';
 try{
  const r=await fetch('/v1/license/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key})});
  const s=await r.json();
  if(r.ok&&s.valid){if(keyInput)keyInput.value='';if(message)message.textContent='Лицензия активирована. Удачной работы!';render(s);window.dispatchEvent(new CustomEvent('license-activated',{detail:s}));}
  else{render(s);if(message)message.textContent=reasonText[s.reason]||'Активация не удалась: '+(s.reason||'неизвестно')+'.';}
 }catch{if(message)message.textContent='Запрос активации не прошёл. Локальный сервер запущен?';}
});
document.querySelector('#copyMachineId')?.addEventListener('click',async()=>{
 const id=machineNode?.textContent||'';
 try{await navigator.clipboard.writeText(id);if(message)message.textContent='ID компьютера скопирован. Отправьте его продавцу.';}
 catch{if(message)message.textContent='Скопировать не удалось. Выделите ID компьютера вручную.';}
});
keyInput?.addEventListener('keydown',e=>{if(e.key==='Enter')document.querySelector('#activateLicense')?.click();});
refresh();window.setInterval(refresh,60000);
