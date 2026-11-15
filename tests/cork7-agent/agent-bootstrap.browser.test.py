from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import os

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT/'vercel/c7-agent/agent-bootstrap.js').read_text()
source = source.replace(
    'new Set(["cork7.com", "www.cork7.com", "live.cork7.com"])',
    'new Set(["", "cork7.com", "www.cork7.com", "live.cork7.com"])'
)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CORK7_CHROMIUM_EXECUTABLE') or None, args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content('<!doctype html><html><body><div id="unrelated"></div><canvas id="game" width="800" height="500" style="width:800px;height:500px"></canvas></body></html>')
    page.add_script_tag(content='''
      class ManagedPlugin {
        constructor(name){ this.name=name; }
        install(){}
        tap(bucket,fn){ bucket.push(fn); }
      }
      class Controller {}
      Controller.prototype.createFrame=function(element,options){ return {element,options}; };
      window.$scramjetController={Controller,ManagedPlugin};
    ''')
    page.add_script_tag(content=source)
    result = page.evaluate('''() => {
      const controller=new window.$scramjetController.Controller();
      const frameResult=controller.createFrame(document.createElement('div'),{});
      const plugin=frameResult.options.plugins.find(p=>p.name==='cork7-input-agent');
      if(!plugin) throw new Error('controller hook did not append input plugin');
      const hooks={init:{post:[]}};
      plugin.install({hooks});
      if(hooks.init.post.length!==1) throw new Error('input plugin init hook missing');
      hooks.init.post[0]({isTopLevel:true,window});
      const agent=window.__CORK7_AGENT__;
      if(!agent) throw new Error('input agent did not install');
      const canvas=document.querySelector('#game');
      const unrelated=document.querySelector('#unrelated');
      const baseline=agent.status();
      if(!baseline.canvasFound||baseline.canSend) throw new Error('unexpected baseline readiness');

      // Unrelated key listeners must not make the game path ready.
      const outsideDown=()=>{}; const outsideUp=()=>{};
      unrelated.addEventListener('keydown',outsideDown);
      unrelated.addEventListener('keyup',outsideUp);
      let status=agent.status();
      if(status.canSend||status.keydownCount!==0||status.keyupCount!==0) throw new Error('unrelated listeners counted as game input');

      const diagnosticDown=()=>{}; diagnosticDown.__CORK7_DIAGNOSTIC__=true;
      const diagnosticUp=()=>{}; diagnosticUp.__CORK7_DIAGNOSTIC__=true;
      window.addEventListener('keydown',diagnosticDown);
      window.addEventListener('keyup',diagnosticUp);
      status=agent.status();
      if(status.canSend||status.keydownCount!==0||status.keyupCount!==0) throw new Error('diagnostic listeners counted as game input');

      const order=[];
      const capture=e=>{order.push('window-capture:'+e.eventPhase+':'+(e.target===canvas)+':'+(e.currentTarget===window));};
      const docCapture=e=>{order.push('document-capture:'+e.eventPhase+':'+(e.target===canvas));};
      const atCanvas=e=>{order.push('canvas:'+e.eventPhase+':'+(e.currentTarget===canvas));e.preventDefault();};
      const docBubble=e=>{order.push('document-bubble:'+e.eventPhase);};
      const keyUp=e=>{order.push('keyup:'+e.key+':'+e.code+':'+e.isTrusted);};
      window.addEventListener('keydown',capture,true);
      document.addEventListener('keydown',docCapture,true);
      canvas.addEventListener('keydown',atCanvas,false);
      document.addEventListener('keydown',docBubble,false);
      window.addEventListener('keyup',keyUp,false);
      status=agent.status();
      if(!status.canSend||status.keydownCount!==4||status.keyupCount!==1) throw new Error('canvas path handler counts incorrect: '+JSON.stringify(status));
      const down=agent.send('d','keydown',canvas);
      if(!down.ok||down.trusted!==false||!down.defaultPrevented) throw new Error('native keydown dispatch result incorrect: '+JSON.stringify(down));
      const up=agent.send('d','keyup',canvas);
      if(!up.ok||up.trusted!==false) throw new Error('native keyup dispatch result incorrect: '+JSON.stringify(up));
      if(order.length!==5) throw new Error('expected five event callbacks, got '+JSON.stringify(order));
      if(order[0]!=='window-capture:1:true:true'||order[1]!=='document-capture:1:true'||order[2]!=='canvas:2:true'||order[3]!=='document-bubble:3'||order[4]!=='keyup:d:KeyD:false') throw new Error('native event path/order incorrect: '+JSON.stringify(order));

      // once:true handlers are retired after native dispatch.
      const onceDown=()=>{}; const onceUp=()=>{};
      canvas.addEventListener('keydown',onceDown,{once:true});
      canvas.addEventListener('keyup',onceUp,{once:true});
      agent.send('a','keydown',canvas); agent.send('a','keyup',canvas);
      const afterOnce=agent.status();
      if(afterOnce.keydownCount!==4||afterOnce.keyupCount!==1) throw new Error('once handlers remained active: '+JSON.stringify(afterOnce));

      // Removal and AbortSignal remove only their own active records.
      const aborter=new AbortController();
      const abortedDown=()=>{}; const abortedUp=()=>{};
      canvas.addEventListener('keydown',abortedDown,{signal:aborter.signal});
      canvas.addEventListener('keyup',abortedUp,{signal:aborter.signal});
      const beforeAbort=agent.status();
      aborter.abort();
      const afterAbort=agent.status();
      if(beforeAbort.keydownCount!==5||beforeAbort.keyupCount!==2||afterAbort.keydownCount!==4||afterAbort.keyupCount!==1) throw new Error('AbortSignal accounting incorrect');
      const removable=()=>{};
      canvas.addEventListener('keydown',removable);
      const beforeRemove=agent.status();
      canvas.removeEventListener('keydown',removable);
      const afterRemove=agent.status();
      if(beforeRemove.keydownCount!==5||afterRemove.keydownCount!==4) throw new Error('removeEventListener accounting incorrect');

      // Re-adding same listener with a new signal must not let the old signal deactivate it.
      const oldAborter=new AbortController();
      const newAborter=new AbortController();
      const shared=()=>{};
      canvas.addEventListener('keydown',shared,{signal:oldAborter.signal});
      canvas.removeEventListener('keydown',shared);
      canvas.addEventListener('keydown',shared,{signal:newAborter.signal});
      oldAborter.abort();
      const afterOldSignal=agent.status();
      if(afterOldSignal.keydownCount!==5) throw new Error('old AbortSignal disabled newly registered listener');
      newAborter.abort();
      if(agent.status().keydownCount!==4) throw new Error('new AbortSignal did not remove listener');

      // Property handlers participate in the event path; no listeners on game path means cannot send.
      window.onkeydown=()=>{}; window.onkeyup=()=>{};
      if(!agent.status().canSend) throw new Error('window property handlers were not counted');
      window.onkeydown=null; window.onkeyup=null;
      return {ok:true,version:agent.version,finalStatus:agent.status(),eventOrder:order,keydownTrusted:down.trusted,keyupTrusted:up.trusted};
    }''')
    print(json.dumps(result,indent=2))
    browser.close()
