'use strict';
const $=id=>document.getElementById(id);
let settings={mode:'auto',effect:'mix',speed:1,intensity:1.4,size:1};
let queue=Promise.resolve();
const request=command=>chrome.runtime.sendMessage({type:'wc-popup',command,settings:{...settings}});
function render(result) {
  if(!result?.ok){$('message').textContent=result?.error||'操作失败，请重新打开扩展。';return;}
  $('message').textContent=result.error||'';
  settings={...settings,...result.settings};
  if(result.title){$('page-title').textContent=result.title;$('page-title').title=result.title;}
  const active=['running','paused'].includes(result.status);
  const labels={idle:'尚未启动',running:'正在爬行',paused:'已暂停',selecting:'等待你在网页上选择区域'};
  $('status-text').textContent=(labels[result.status]||'尚未启动')+(result.scope?` · ${result.scope}`:'');
  $('status').className=result.status||'idle';
  $('pause').disabled=!active;$('panel').disabled=!active;$('stop').disabled=!active&&result.status!=='selecting';
  $('pause').textContent=result.status==='paused'?'继续':'暂停';
  for(const id of ['start','pick','area'])$(id).disabled=result.supported===false;
  if(result.supported===false)$('message').textContent='此页面受浏览器保护。请切换到普通网页。';
  $('effect').value=settings.effect;
  $('auto').setAttribute('aria-pressed',String(settings.mode==='auto'));
  $('follow').setAttribute('aria-pressed',String(settings.mode==='follow'));
  for(const name of ['speed','intensity','size']){$(name).value=settings[name];$(`${name}-value`).textContent=`${settings[name].toFixed(1)}×`;}
}
async function run(command,close=false) {
  try {const result=await request(command);render(result);if(close&&result.ok&&result.status==='selecting')window.close();}
  catch(error){$('message').textContent=String(error.message||error);}
}
$('start').addEventListener('click',()=>run('startPage'));
$('pick').addEventListener('click',()=>run('selectElement',true));
$('area').addEventListener('click',()=>run('selectArea',true));
$('pause').addEventListener('click',()=>run('pause'));
$('stop').addEventListener('click',()=>run('stop'));
$('panel').addEventListener('click',()=>run('showPanel'));
function save() {
  // Serialize slider updates so an older request cannot overwrite a newer setting.
  const snapshot={...settings};
  queue=queue.catch(()=>{}).then(()=>chrome.runtime.sendMessage({type:'wc-popup',command:'settings',settings:snapshot}))
    .then(result=>{if(!result.ok)$('message').textContent=result.error;}).catch(error=>{$('message').textContent=error.message;});
}
$('effect').addEventListener('change',()=>{settings.effect=$('effect').value;save();});
for(const mode of ['auto','follow'])$(mode).addEventListener('click',()=>{
  settings.mode=mode;$('auto').setAttribute('aria-pressed',String(mode==='auto'));$('follow').setAttribute('aria-pressed',String(mode==='follow'));save();
});
for(const name of ['speed','intensity','size'])$(name).addEventListener('input',()=>{
  settings[name]=Number($(name).value);$(`${name}-value`).textContent=`${settings[name].toFixed(1)}×`;save();
});
chrome.runtime.sendMessage({type:'wc-popup',command:'state'}).then(render).catch(error=>{$('message').textContent=error.message;});
