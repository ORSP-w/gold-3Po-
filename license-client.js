const gate=document.querySelector('#licenseGate'),keyInput=document.querySelector('#licenseKeyInput'),message=document.querySelector('#licenseMessage'),meta=document.querySelector('#licenseMeta'),machineNode=document.querySelector('#licenseMachineId'),statusNode=document.querySelector('#licenseStatus');
const reasonText={
 missing_license:'Enter the licence key you received from the vendor.',
 malformed_key:'That does not look like a GOLD-3Po key. Paste the whole string starting with GOLD1.',
 bad_signature:'Invalid key signature. Use the exact key issued for this computer.',
 wrong_machine:'This key was issued for a different computer. Send your Machine ID below to the vendor.',
 wrong_product:'This key is for a different product.',
 invalid_days:'The key contains an invalid validity period. Contact the vendor.',
 invalid_dates:'The key contains invalid dates. Contact the vendor.',
 expired:'Your licence has expired. Contact the vendor to renew it.',
 not_yet_valid:'This key is not valid yet. Check that the system clock is correct.',
 clock_rollback:'The system clock appears to be set back. Restore the correct date and time to continue.',
 license_write_failed:'Could not save the licence next to the application. Check folder permissions.',
 disabled:''
};
function paintStatus(s){
 if(!statusNode)return;
 if(!s.required){statusNode.textContent='NOT REQUIRED';statusNode.className='ok';return;}
 if(s.valid){statusNode.textContent='ACTIVE · '+(s.daysLeft??0)+'d LEFT';statusNode.className=s.daysLeft<=7?'warning':'ok';}
 else{statusNode.textContent=(s.reason||'INVALID').toUpperCase().replace(/_/g,' ');statusNode.className='error';}
}
function render(s){
 paintStatus(s);
 if(machineNode)machineNode.textContent=s.machineId||'—';
 if(!s.required||s.valid){gate.hidden=true;return;}
 gate.hidden=false;
 if(message)message.textContent=reasonText[s.reason]||'Licence problem: '+(s.reason||'unknown')+'.';
 if(meta){
  const parts=[];
  if(s.expiresAt)parts.push('Expired: '+new Date(s.expiresAt).toISOString().slice(0,10));
  if(s.keyId)parts.push('Key ID: '+s.keyId);
  meta.textContent=parts.join(' · ');
 }
}
async function refresh(){
 try{const r=await fetch('/v1/license/status',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);render(await r.json());}
 catch{if(statusNode){statusNode.textContent='API OFFLINE';statusNode.className='error';}}
}
document.querySelector('#activateLicense')?.addEventListener('click',async()=>{
 const key=(keyInput?.value||'').trim();
 if(!key){if(message)message.textContent=reasonText.missing_license;return;}
 if(message)message.textContent='Checking key…';
 try{
  const r=await fetch('/v1/license/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key})});
  const s=await r.json();
  if(r.ok&&s.valid){if(keyInput)keyInput.value='';if(message)message.textContent='Licence activated. Happy researching!';render(s);window.dispatchEvent(new CustomEvent('license-activated',{detail:s}));}
  else{render(s);if(message)message.textContent=reasonText[s.reason]||'Activation failed: '+(s.reason||'unknown')+'.';}
 }catch{if(message)message.textContent='Activation request failed. Is the local server running?';}
});
document.querySelector('#copyMachineId')?.addEventListener('click',async()=>{
 const id=machineNode?.textContent||'';
 try{await navigator.clipboard.writeText(id);if(message)message.textContent='Machine ID copied. Send it to the vendor.';}
 catch{if(message)message.textContent='Copy failed. Select the Machine ID manually.';}
});
keyInput?.addEventListener('keydown',e=>{if(e.key==='Enter')document.querySelector('#activateLicense')?.click();});
refresh();window.setInterval(refresh,60000);
