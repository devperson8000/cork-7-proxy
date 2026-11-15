from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os
ROOT=Path(__file__).resolve().parents[2]
html=(ROOT/'vercel/bot/index.html').read_text()
# Speed up only the fixture's seed schedule; production code retains the real timings.
html=html.replace('const takeoffs=[14500,33000,51500,70500];','const takeoffs=[1500,3000,4500,6000];')
# about:srcdoc is the local-only frame URL used by this offline fixture.
html=html.replace('!!frameUrl&&!/^about:(blank|srcdoc)$/i.test(frameUrl)','!!frameUrl')

game_html='''<!doctype html><html><body>
<div id="stage">PAUSE MENU</div><canvas id="game" width="800" height="500" style="width:800px;height:500px"></canvas>
<script>
(() => {
 const stage=document.getElementById('stage');
 let completionStarted=false, runNumber=0, resultTimer=null, menuOpen=true, returnStage='APEX ACTIVE';
 const keyLog=[];
 function active(){stage.textContent='APEX ACTIVE';}
 function completeBaseline(){stage.textContent='RUN COMPLETE FINAL SCORE: 8000';}
 function startNewScoredRun(){runNumber++;active();clearTimeout(resultTimer);resultTimer=setTimeout(()=>{stage.textContent='RUN COMPLETE FINAL SCORE: '+(8000+runNumber*2000);},9000);}
 function openMenu(){if(!menuOpen){returnStage=stage.textContent;menuOpen=true;stage.textContent='PAUSE MENU';}}
 window.__C7_KEYS__=keyLog; window.__C7_OPEN_MENU__=openMenu;
 window.addEventListener('keydown',event=>{
   keyLog.push('keydown:'+event.key);
   if(event.key==='Escape'){if(menuOpen){menuOpen=false;stage.textContent=returnStage;}return;}
   if(menuOpen)return;
   if(event.key==='f'&&!completionStarted&&runNumber===0){completionStarted=true;clearTimeout(resultTimer);resultTimer=setTimeout(completeBaseline,1750);}
   if(event.key==='r'&&/RUN COMPLETE/.test(stage.textContent))startNewScoredRun();
 });
 window.addEventListener('keyup',event=>keyLog.push('keyup:'+event.key));
 window.addEventListener('keydown',()=>{}); window.addEventListener('keyup',()=>{});
 window.__CORK7_AGENT__={
   status:()=>({ready:true,canvasFound:true,visibleCanvas:true,keydownCount:3,keyupCount:3,canSend:true,trustedHardwareEvents:false}),
   send(key,type,target){
     const map={Escape:['Escape','Escape',27],Space:[' ','Space',32],Shift:['Shift','ShiftLeft',16],ArrowLeft:['ArrowLeft','ArrowLeft',37],ArrowRight:['ArrowRight','ArrowRight',39],ArrowUp:['ArrowUp','ArrowUp',38],ArrowDown:['ArrowDown','ArrowDown',40]};
     const m=map[key]||[String(key),String(key).length===1?'Key'+String(key).toUpperCase():String(key),String(key).toUpperCase().charCodeAt(0)];
     target.dispatchEvent(new KeyboardEvent(type,{key:m[0],code:m[1],keyCode:m[2],which:m[2],bubbles:true,cancelable:true,composed:true}));
     return {ok:true,registeredOnPath:3,trusted:false,defaultPrevented:false};
   }
 };
})();
</script></body></html>'''
player_html='''<!doctype html><html><body><div class="game-frame"><iframe id="gameFrame"></iframe></div>
<script>window.__CORK7_AGENT_BOOT_STATUS__={ready:true,version:'test',page:'player'};document.getElementById('gameFrame').srcdoc='''+json.dumps(game_html).replace('</','<\\/')+''';</script>
</body></html>'''
init_script='''(() => {
 const d=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
 Object.defineProperty(HTMLIFrameElement.prototype,'src',{configurable:true,enumerable:d.enumerable,
   get(){return d.get.call(this)},set(value){
     if(this.id==='c7LocalPlayer'&&String(value).includes('/c7-agent/')){this.srcdoc=PLAYER_HTML;return;}
     return d.set.call(this,value);
   }});
 const c7Store=window.__C7_STORE__||(window.__C7_STORE__=new Map());
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
   get length(){return c7Store.size}, key(i){return Array.from(c7Store.keys())[i]??null},
   getItem(k){return c7Store.has(String(k))?c7Store.get(String(k)):null},
   setItem(k,v){c7Store.set(String(k),String(v))}, removeItem(k){c7Store.delete(String(k))}, clear(){c7Store.clear()}
 }});
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,init={})=>{
   const url=String(input);
   if(url.includes('/api/bot/owner-session'))return new Response(JSON.stringify({authenticated:true}),{status:200,headers:{'content-type':'application/json'}});
   if(url.includes('/api/bot/cork7-status'))return new Response(JSON.stringify({connected:false,starting:false,phase:'offline',trainer:null}),{status:200,headers:{'content-type':'application/json'}});
   if(url.includes('/api/bot/cork7-client-training')){if(window.__C7_SYNC_SHOULD_FAIL__)return new Response(JSON.stringify({error:'Mock Northflank offline'}),{status:503,headers:{'content-type':'application/json'}});return new Response(JSON.stringify({trainer:{completionTest:{attempts:1,completedRuns:1}}}),{status:200,headers:{'content-type':'application/json'}});}
   if(url.includes('/api/bot/owner-logout'))return new Response(JSON.stringify({authenticated:false}),{status:200,headers:{'content-type':'application/json'}});
   if(url.includes('/api/bot/'))return new Response(JSON.stringify({error:'Mock endpoint unavailable'}),{status:503,headers:{'content-type':'application/json'}});
   return nativeFetch(input,init);
 };
})();'''.replace('PLAYER_HTML',json.dumps(player_html).replace('</','<\\/'))

with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CORK7_CHROMIUM_EXECUTABLE') or None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':1000})
  page.on('pageerror',lambda e: print('PAGEERROR',repr(e),getattr(e,'message',None),getattr(e,'stack',None)))
  # Expose the private sync function only inside this mock test page. The
  # production dashboard keeps it scoped inside its own closure.
  dashboard_html=html.replace('\n})();\n</script>', '\nwindow.__C7_TEST_SYNC__=async(fail)=>{if(trainerSyncInFlight)await trainerSyncInFlight;trainerSyncFingerprint="";const originalApi=api;if(fail)api=async(action,method,payload)=>{if(action==="cork7-client-training")throw new Error("Mock Northflank offline");return originalApi(action,method,payload);};try{return await syncLocalTrainer();}finally{api=originalApi;}};\n})();\n</script>')
  page.set_content(dashboard_html.replace('<head>','<head><script>'+init_script+'</script>',1),wait_until='domcontentloaded')
  page.wait_for_function("document.getElementById('ownerStatus').textContent.includes('Owner verified')",timeout=10000)
  page.locator('#c7Start').click()
  page.wait_for_function("document.getElementById('c7SessionStatus').textContent.includes('synthetic') || document.getElementById('c7SessionStatus').textContent.includes('keyboard')",timeout=10000)
  assert page.locator('#c7ConfirmRide').count()==0, 'Manual ride-confirmation control must be removed'
  mouse_guard = page.evaluate("""() => {
    const button=document.querySelector('#c7TestStart');
    const player=document.querySelector('#c7LocalPlayer');
    const game=player.contentDocument.querySelector('.game-frame iframe').contentWindow;
    const event=new MouseEvent('mousedown',{bubbles:true,cancelable:true});
    button.dispatchEvent(event);
    return {defaultPrevented:event.defaultPrevented,guardUntil:Number(game.__CORK7_DASHBOARD_INTERACTION_UNTIL||0)};
  }""")
  assert not mouse_guard['defaultPrevented'], mouse_guard
  assert mouse_guard['guardUntil'] > page.evaluate('Date.now()'), mouse_guard
  page.locator('#c7TestStart').click()
  page.wait_for_function("document.getElementById('c7CompletionStats').textContent.includes('Completion baseline VERIFIED (')",timeout=12000)
  baseline_keys=page.evaluate("""() => {
    const game=document.getElementById('c7LocalPlayer').contentDocument.querySelector('.game-frame iframe').contentWindow;
    return game.__C7_KEYS__.slice(0,4);
  }""")
  assert baseline_keys==['keydown:Escape','keyup:Escape','keydown:f','keyup:f'], baseline_keys
  page.wait_for_function("!document.getElementById('c7TrainStart').disabled",timeout=5000)
  print('BASELINE VERIFIED',page.locator('#c7CompletionStats').inner_text(),flush=True)
  key_count_before_run=page.evaluate("""() => {
    const game=document.getElementById('c7LocalPlayer').contentDocument.querySelector('.game-frame iframe').contentWindow;
    const before=game.__C7_KEYS__.length;
    game.__C7_OPEN_MENU__();
    return before;
  }""")
  page.locator('#c7TrainStart').click(timeout=5000)
  page.wait_for_function("""before => {
    const game=document.getElementById('c7LocalPlayer').contentDocument.querySelector('.game-frame iframe').contentWindow;
    return game.__C7_KEYS__.length > before;
  }""",arg=key_count_before_run,timeout=5000)
  run_keys=page.evaluate("""before => {
    const game=document.getElementById('c7LocalPlayer').contentDocument.querySelector('.game-frame iframe').contentWindow;
    return game.__C7_KEYS__.slice(before,before+4);
  }""",key_count_before_run)
  assert run_keys[:2]==['keydown:Escape','keyup:Escape'], run_keys
  assert run_keys[2]=='keydown:r', run_keys
  for checkpoint in range(24):
    page.wait_for_timeout(1000)
    now=page.locator('#c7TrainerStats').inner_text()
    if 'Verified score runs 2' in now: break
  if 'Verified score runs 2' not in page.locator('#c7TrainerStats').inner_text(): raise AssertionError('Trainer did not complete two scored runs')
  stats=page.locator('#c7TrainerStats').inner_text()
  current=page.locator('#c7CurrentStrategy').inner_text()
  saved=page.evaluate("JSON.parse(localStorage.getItem('cork7-trainer-state-v1'))")
  page.locator('#c7TrainPause').click(timeout=5000)
  page.wait_for_function("document.getElementById('c7TrainerStats').textContent.includes('AI STOPPED')",timeout=5000)
  store=page.evaluate("Object.fromEntries(window.__C7_STORE__.entries())")
  assert saved['runsFinished']==2, saved
  assert len(saved['history'])==2, saved
  assert saved['history'][1]['score']>saved['history'][0]['score'], saved['history']

  # Owner access alone must not claim cloud sync. Force one failed checkpoint
  # request, verify the UI remains honest, then verify recovery after success.
  page.evaluate("window.__C7_TEST_SYNC__(true)")
  failed_sync_stats=page.locator('#c7TrainerStats').inner_text()
  assert 'Northflank sync pending' in failed_sync_stats, failed_sync_stats
  assert 'Northflank sync confirmed' not in failed_sync_stats, failed_sync_stats
  page.evaluate("window.__C7_TEST_SYNC__(false)")
  recovered_sync_stats=page.locator('#c7TrainerStats').inner_text()
  assert 'Northflank sync confirmed' in recovered_sync_stats, recovered_sync_stats

  # A fresh dashboard document must hydrate the saved local checkpoint.
  reload_script=init_script.replace(
    'const c7Store=window.__C7_STORE__||(window.__C7_STORE__=new Map());',
    'const c7Store=window.__C7_STORE__||(window.__C7_STORE__=new Map()); for(const [k,v] of Object.entries('+json.dumps(store)+')) c7Store.set(k,v);'
  )
  page2=browser.new_page(viewport={'width':1440,'height':1000})
  page2.on('pageerror',lambda e: print('PAGE2ERROR',repr(e),flush=True))
  evolution_probe='''window.__C7_TEST_EVOLUTION__=()=>{\n    const originalRandom=Math.random;\n    const sequence=[0.9,0.9,0.1,0.9,0.9,0.9,0.1,0.9]; let index=0;\n    Math.random=()=>sequence[index++%sequence.length];\n    const previous=localTrainer;\n    localTrainer={...localTrainer,runsFinished:10,bestPolicy:JSON.parse(JSON.stringify(CORK7_SEED_LIBRARY[2]))};\n    const candidate=nextLocalPolicy();\n    localTrainer=previous; Math.random=originalRandom;\n    return {name:candidate.name,parentName:candidate.parentName,events:candidate.events.length,\n      mutated:JSON.stringify(candidate.events)!==JSON.stringify(CORK7_SEED_LIBRARY[2].events)};\n  };\n'''
  reload_dashboard=dashboard_html.replace('\n})();\n</script>', '\n'+evolution_probe+'})();\n</script>')
  page2.set_content(reload_dashboard.replace('<head>','<head><script>'+reload_script+'</script>',1),wait_until='domcontentloaded')
  page2.wait_for_function("document.getElementById('c7TrainerStats').textContent.includes('Verified score runs 2')",timeout=10000)
  page2.wait_for_function("document.getElementById('c7CompletionStats').textContent.includes('Completion baseline VERIFIED (')",timeout=10000)
  restored=page2.locator('#c7TrainerStats').inner_text()

  # Verify the post-seed evolution path derives its child from the best parent.
  mutation=page2.evaluate('window.__C7_TEST_EVOLUTION__()')
  assert mutation['name'].startswith('Evolved · '), mutation
  assert mutation['parentName']=='03 · Frontflip baseline', mutation
  assert mutation['mutated'] and mutation['events']==4, mutation
  print(json.dumps({'ok':True,'trainerStats':stats,'nextStrategy':current,'savedRuns':saved['runsFinished'],
    'scores':[x['score'] for x in saved['history']],'completionBaseline':saved['completionTest']['baseline'],
    'restoredStats':restored,'evolutionMutation':mutation},indent=2))
  browser.close()
