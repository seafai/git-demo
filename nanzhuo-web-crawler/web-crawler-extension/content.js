(function () {
  'use strict';
  if (globalThis.__wcExtensionController) return;
  const defaults = {mode:'auto',effect:'mix',speed:1,intensity:1.4,size:1};
  const css = `
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:dark;font-family:Arial,"Microsoft YaHei",sans-serif}
    *{box-sizing:border-box}button,select{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid #a2ffe9;outline-offset:3px}
    .panel{position:fixed;right:18px;bottom:18px;width:286px;padding:14px;background:#0d1517f5;color:#cfddd6;border:1px solid #405b50;border-radius:10px;box-shadow:0 10px 40px #0007;pointer-events:auto;font-size:12px}
    .top{display:flex;align-items:center;justify-content:space-between;gap:12px}.title{color:#a2ffe9;font-size:13px;font-weight:bold}.buttons{display:flex;gap:5px}button{border:1px solid #344c42;color:#c3d6ca;background:#1a2b24;border-radius:5px;padding:7px 9px;font-size:11px}
    .icon{padding:2px 7px;font-size:18px;line-height:22px;background:transparent;color:#91a49b}.meta{color:#879c92;font-size:10px;line-height:1.8;margin:9px 0 12px}.row{display:flex;align-items:center;justify-content:space-between;gap:8px}.row button{flex:1}.row select{max-width:106px;background:#13241c;border:1px solid #344c42;color:#a2ffe9;border-radius:4px;padding:6px;font-size:11px}
    .stats{margin:11px 0 0;font:10px monospace;color:#91b6a2}.overlay{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;background:#0002}.hint{position:fixed;top:20px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:13px 18px;border:1px solid #a2ffe980;border-radius:7px;background:#0c1e18f5;color:#d3ffe9;font-size:13px;box-shadow:0 10px 35px #0006;text-align:center;pointer-events:none;white-space:nowrap}
    .selection{position:fixed;display:none;border:2px solid #a2ffe9;background:#a2ffe918;box-shadow:0 0 0 9999px #0004;pointer-events:none}.selection.area{border-style:dashed}.toast{position:fixed;top:22px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 40px);padding:14px 20px;background:#14231c;color:#d0fbe5;border:1px solid #587867;border-radius:7px;font-size:13px;line-height:1.8;box-shadow:0 10px 35px #0005}
    @media(max-width:440px){.panel{right:10px;bottom:10px;width:266px}.hint{white-space:normal;width:calc(100vw - 32px)}}
  `;
  const create = (tag,className,text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (text,label,handler,className='') => {
    const element = create('button',className,text); element.type='button';
    if (label) element.setAttribute('aria-label',label);
    element.addEventListener('click',handler); return element;
  };

  const controller = {
    crawler:null,host:null,shadow:null,picker:null,timer:null,settings:{...defaults},scope:'',lastError:'',
    mount() {
      if (this.host?.isConnected) return;
      this.host = document.createElement('web-crawler-ui');
      this.host.dataset.crawlIgnore = ''; this.host.dataset.webCrawlerUi = '';
      this.host.style.setProperty('position','fixed','important');
      this.host.style.setProperty('inset','0','important');
      this.host.style.setProperty('z-index','2147483647','important');
      this.host.style.setProperty('pointer-events','none','important');
      this.shadow = this.host.attachShadow({mode:'open'});
      const sheet = new CSSStyleSheet(); sheet.replaceSync(css); this.shadow.adoptedStyleSheets=[sheet];
      document.documentElement.appendChild(this.host);
    },
    state() {
      return {status:this.picker?'selecting':this.crawler?(this.crawler.paused?'paused':'running'):'idle',
        scope:this.scope,state:this.crawler?.getState()||null,error:this.lastError};
    },
    cleanupCSS() {
      try { chrome.runtime.sendMessage({type:'wc-clean-css'}).catch(()=>{}); } catch {}
    },
    stop(cleanCSS=true) {
      if (this.picker) this.cancelPick(false);
      this.crawler?.destroy(); this.crawler=null;
      clearInterval(this.timer); this.timer=null; clearTimeout(this.toastTimer);
      this.host?.remove(); this.host=null; this.shadow=null; this.scope=''; this.lastError='';
      document.removeEventListener('keydown',this.keyHandler,true);
      if (cleanCSS) this.cleanupCSS();
    },
    start(root=document.body,region=null,scope='当前网页') {
      this.stop(false);
      if (!root?.isConnected) throw new Error('所选区域已经发生变化，请重新选择。');
      this.crawler = new WebCrawler(root,{...this.settings,allText:true,region,lazyText:true,
        injectStyle:false,zIndex:2147483645,respectReducedMotion:false,maxTargets:1400});
      if (!this.crawler.targets.length) {
        this.crawler.destroy(); this.crawler=null;
        this.lastError='所选区域没有可交互的文字。请扩大范围，或选择普通文字与代码区域。';
        this.toast(this.lastError); return;
      }
      this.scope=scope; this.panel();
      document.addEventListener('keydown',this.keyHandler,true);
    },
    setSettings(settings) {
      this.settings={...this.settings,...settings};
      if (this.crawler) {
        this.crawler.setMode(this.settings.mode);
        if (this.crawler.options.effect!==this.settings.effect) this.crawler.setEffect(this.settings.effect);
        this.crawler.setSpeed(this.settings.speed); this.crawler.setIntensity(this.settings.intensity);
        if (this.crawler.options.size!==this.settings.size) {
          this.crawler.options.size=this.settings.size; this.crawler.place();
        }
        this.renderPanel();
      }
    },
    saveSettings() { try { chrome.storage.local.set({settings:this.settings}).catch(()=>{}); } catch {} },
    panel() {
      this.mount(); this.shadow.replaceChildren();
      const panel=create('section','panel'); panel.setAttribute('aria-label','文字蜘蛛控制条');
      const top=create('div','top'),actions=create('div','buttons');
      top.append(create('span','title','✦ 文字蜘蛛'));
      actions.append(button('−','收起控制条',()=>{panel.style.display='none';},'icon'),
        button('×','关闭并恢复网页',()=>this.stop(),'icon'));
      top.append(actions); panel.append(top);
      this.meta=create('p','meta'); panel.append(this.meta);
      const row=create('div','row');
      this.pauseButton=button('暂停',null,()=>{this.crawler?.toggle();this.renderPanel();});
      this.modeButton=button('自动游走',null,()=>{
        this.settings.mode=this.settings.mode==='auto'?'follow':'auto';
        this.crawler?.setMode(this.settings.mode); this.saveSettings(); this.renderPanel();
      });
      const choose=create('select'); choose.setAttribute('aria-label','文字蜘蛛接触效果');
      for (const [value,label] of [['mix','混合效果'],['grab','抓取抬起'],['flip','翻转反向'],['invert','颜色反转'],['twist','扭转摆动'],['stretch','拉伸挤压']]) {
        const option=create('option','',label); option.value=value; choose.append(option);
      }
      choose.value=this.settings.effect;
      choose.addEventListener('change',()=>{this.settings.effect=choose.value;this.crawler?.setEffect(choose.value);this.saveSettings();});
      this.effectSelect=choose; row.append(this.pauseButton,this.modeButton,choose); panel.append(row);
      this.stats=create('p','stats'); panel.append(this.stats);
      this.shadow.append(panel); this.renderPanel();
      clearInterval(this.timer); this.timer=setInterval(()=>this.renderPanel(),700);
    },
    renderPanel() {
      if (!this.crawler || !this.meta) return;
      const state=this.crawler.getState();
      this.meta.textContent=`${this.scope} · Alt + Shift + S 暂停 / 继续`;
      this.pauseButton.textContent=state.paused?'继续':'暂停';
      this.modeButton.textContent=state.mode==='auto'?'自动游走':'跟随指针';
      this.effectSelect.value=this.settings.effect;
      this.stats.textContent=`${state.targetCount} 个文字片段 · ${state.activeEffects} 处互动`;
    },
    toast(message) {
      this.mount(); this.shadow.replaceChildren(create('div','toast',message));
      clearTimeout(this.toastTimer); this.toastTimer=setTimeout(()=>{if(!this.crawler&&!this.picker){this.host?.remove();this.host=null;this.shadow=null;}},6500);
    },
    cancelPick(cleanCSS=true) {
      if (!this.picker) return;
      const pick=this.picker;
      pick.overlay.removeEventListener('pointerdown',pick.down);
      pick.overlay.removeEventListener('pointermove',pick.move);
      pick.overlay.removeEventListener('pointerup',pick.up);
      document.removeEventListener('keydown',pick.key,true);
      this.picker=null; this.host?.remove(); this.host=null; this.shadow=null;
      if (cleanCSS) this.cleanupCSS();
    },
    select(kind) {
      this.stop(false); this.mount();
      const overlay=create('div','overlay'),hint=create('div','hint',kind==='area'?
        '按住鼠标拖拽框选，松开开始 · Esc 取消':'移动鼠标选中内容块，点击开始 · Esc 取消');
      const selection=create('div',kind==='area'?'selection area':'selection');
      this.shadow.append(overlay,selection,hint);
      const pick={kind,overlay,hint,selection,start:null,candidate:null,rect:null};
      this.picker=pick;
      const paint=rect=>{
        selection.style.display='block';
        Object.assign(selection.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
      };
      const underlying=(x,y)=>{
        const element=document.elementsFromPoint(x,y).find(element=>element!==this.host&&!element.closest('[data-web-crawler-ui],canvas[data-web-crawler]'));
        if(!element || element.closest('input,textarea,select,button,[contenteditable]:not([contenteditable="false"])')) return null;
        return element.closest('pre,p,li,article,section,main,[role="main"],div')||element;
      };
      pick.move=event=>{
        if(kind==='element') {
          pick.candidate=underlying(event.clientX,event.clientY);
          if(pick.candidate) paint(pick.candidate.getBoundingClientRect());
          else selection.style.display='none';
        } else if(pick.start) {
          const left=Math.min(event.clientX,pick.start.x),top=Math.min(event.clientY,pick.start.y);
          pick.rect={left,top,width:Math.abs(event.clientX-pick.start.x),height:Math.abs(event.clientY-pick.start.y)};
          paint(pick.rect);
        }
      };
      pick.down=event=>{
        if(event.button!==0) return;
        event.preventDefault();event.stopPropagation();
        if(kind==='element') {pick.candidate=underlying(event.clientX,event.clientY);if(pick.candidate)paint(pick.candidate.getBoundingClientRect());}
        else {pick.start={x:event.clientX,y:event.clientY};overlay.setPointerCapture(event.pointerId);pick.move(event);}
      };
      pick.up=event=>{
        if(event.button!==0) return;
        event.preventDefault();event.stopPropagation();
        if(kind==='element'&&pick.candidate) {
          const root=pick.candidate;this.cancelPick(false);
          try{this.start(root,null,root.matches('pre')?'选定代码块':'选定内容块');}catch(error){this.toast(error.message);}
        } else if(kind==='area'&&pick.start) {
          pick.move(event);
          if(!pick.rect || pick.rect.width<100 || pick.rect.height<100) {hint.textContent='请框选至少 100 × 100 的区域，容纳文字和蜘蛛 · Esc 取消';pick.start=null;return;}
          const region={x:pick.rect.left+scrollX,y:pick.rect.top+scrollY,width:pick.rect.width,height:pick.rect.height};
          this.cancelPick(false);
          try{this.start(document.body,region,'框选区域');}catch(error){this.toast(error.message);}
        }
      };
      pick.key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.cancelPick();}};
      overlay.addEventListener('pointerdown',pick.down);
      overlay.addEventListener('pointermove',pick.move);
      overlay.addEventListener('pointerup',pick.up);
      document.addEventListener('keydown',pick.key,true);
    },
    command(command,settings) {
      if (settings) this.setSettings(settings);
      if(command==='startPage')this.start();
      else if(command==='selectElement')this.select('element');
      else if(command==='selectArea')this.select('area');
      else if(command==='pause'){this.crawler?.toggle();this.renderPanel();}
      else if(command==='stop')this.stop();
      else if(command==='showPanel'&&this.crawler)this.panel();
      return this.state();
    }
  };
  controller.keyHandler=event=>{
    if(event.altKey&&event.shiftKey&&event.code==='KeyS'){event.preventDefault();controller.crawler?.toggle();controller.renderPanel();}
    if(event.altKey&&event.shiftKey&&event.code==='KeyX'){event.preventDefault();controller.stop();}
  };
  globalThis.__wcExtensionController=controller;
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type==='wc-ping'){respond({ok:true});return;}
    if(message?.type!=='wc-command')return;
    try{respond(controller.command(message.command,message.settings));}
    catch(error){respond({status:'idle',error:String(error.message||error)});}
  });
})();
