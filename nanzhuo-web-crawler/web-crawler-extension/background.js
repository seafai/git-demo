'use strict';
const DEFAULTS = {mode:'auto',effect:'mix',speed:1,intensity:1.4,size:1};
const COMMANDS = new Set(['state','startPage','selectElement','selectArea','pause','stop','settings','showPanel']);

function cleanSettings(values = {}) {
  const numeric = (name,min,max) => Number.isFinite(Number(values[name])) ? Math.min(max,Math.max(min,Number(values[name]))) : DEFAULTS[name];
  return {mode:['auto','follow'].includes(values.mode)?values.mode:DEFAULTS.mode,
    effect:['mix','grab','flip','invert','twist','stretch'].includes(values.effect)?values.effect:DEFAULTS.effect,
    speed:numeric('speed',.4,2.4),intensity:numeric('intensity',.4,2.6),size:numeric('size',.6,1.5)};
}

async function tabState(tabId) {
  try { return await chrome.tabs.sendMessage(tabId,{type:'wc-command',command:'state'}); }
  catch { return {status:'idle',scope:'',state:null}; }
}

async function ensureController(tabId) {
  try { await chrome.tabs.sendMessage(tabId,{type:'wc-ping'}); return; } catch {}
  await chrome.scripting.executeScript({target:{tabId},files:['engine.js','content.js'],world:'ISOLATED'});
}

async function dispatch(message) {
  if (!COMMANDS.has(message.command)) throw new Error('无法识别此操作。');
  const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if (!tab?.id) throw new Error('请先打开一个网页。');
  const stored = await chrome.storage.local.get('settings');
  const settings = cleanSettings({...DEFAULTS,...stored.settings,...message.settings});
  const url = tab.url || '';
  const supported = /^(https?:|file:)/i.test(url) && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i.test(url);
  if (message.command === 'state') {
    return {ok:true,supported,settings,title:tab.title||'当前网页',...await tabState(tab.id)};
  }
  if (message.command === 'settings') {
    await chrome.storage.local.set({settings});
    const current = await tabState(tab.id);
    if (current.status !== 'idle') await chrome.tabs.sendMessage(tab.id,{type:'wc-command',command:'settings',settings});
    return {ok:true,supported,settings,...await tabState(tab.id)};
  }
  if (!supported) throw new Error('此页面受浏览器保护。请切换到普通网页后使用。');
  if (url.startsWith('file:') && !await chrome.extension.isAllowedFileSchemeAccess()) {
    throw new Error('使用本地 HTML 时，请在扩展的“详细信息”中开启“允许访问文件网址”。');
  }
  await chrome.storage.local.set({settings});
  if (message.command === 'stop') {
    const current = await tabState(tab.id);
    if (current.status !== 'idle') await chrome.tabs.sendMessage(tab.id,{type:'wc-command',command:'stop'});
    await chrome.scripting.removeCSS({target:{tabId:tab.id},files:['page.css'],origin:'USER'}).catch(()=>{});
    return {ok:true,supported,settings,...await tabState(tab.id)};
  }
  await ensureController(tab.id);
  if (['startPage','selectElement','selectArea'].includes(message.command)) {
    await chrome.scripting.removeCSS({target:{tabId:tab.id},files:['page.css'],origin:'USER'}).catch(()=>{});
    await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['page.css'],origin:'USER'});
  }
  const current = await chrome.tabs.sendMessage(tab.id,{type:'wc-command',command:message.command,settings});
  return {ok:true,supported,settings,...current};
}

chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message?.type === 'wc-clean-css' && sender.tab?.id) {
    chrome.scripting.removeCSS({target:{tabId:sender.tab.id},files:['page.css'],origin:'USER'})
      .then(()=>respond({ok:true}),()=>respond({ok:false}));
    return true;
  }
  if (message?.type !== 'wc-popup' || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  dispatch(message).then(respond,error => respond({ok:false,error: String(error.message || error)}));
  return true;
});
