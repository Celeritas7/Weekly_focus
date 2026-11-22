const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
const startup = html.match(/<script id="wfStartupBoot">([\s\S]*?)<\/script>/)[1];
const login = fs.readFileSync('js/wf-login.js','utf8');
const tick = () => new Promise(resolve=>setImmediate(resolve));
function classes(initial=[]){const s=new Set(initial);return {add:x=>s.add(x),remove:x=>s.delete(x),contains:x=>s.has(x)};}
function fixture({session,online=true,stored,serviceWorker}={}){
  const nodes={},timeouts=[],intervals=[],events={},windowEvents={},buttons=[{},{}],saved=new Map([['wf_pending','keep'],['other_app','keep']]);
  if(stored)saved.set('wf2_sb_auth',JSON.stringify(stored));
  function node(){return {hidden:false,innerHTML:'',textContent:'',classList:classes(),setAttribute(k,v){this[k]=v},addEventListener(){}};}
  for(const id of ['wfStartup','wfStartupMessage'])nodes[id]=node();
  nodes.wfStartupMessage.textContent='Checking your sign-in and opening your week…';
  const document={readyState:'complete',documentElement:{classList:classes(['wf-starting'])},
    addEventListener:(k,fn)=>{(events[k] ||= []).push(fn)},getElementById:id=>nodes[id]||null,createElement:node,
    querySelector:()=>null,querySelectorAll:s=>s==='[data-wf-boot]'?buttons:[],
    body:{appendChild:n=>{nodes[n.id]=n},classList:classes()}};
  let reloads=0,authCallback;
  const window={addEventListener:(k,fn)=>{windowEvents[k]=fn}};
  window.__wfSb={auth:{onAuthStateChange:fn=>{authCallback=fn},getSession:()=>session||new Promise(()=>{})}};
  const navigator={onLine:online};if(serviceWorker)navigator.serviceWorker=serviceWorker;
  const c={window,document,navigator,URL,Promise,Date,location:{href:'https://fixture.test/Weekly_focus/',reload(){reloads++}},
    localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    setTimeout:(fn,ms)=>{timeouts.push({fn,ms});return timeouts.length},clearTimeout(){},
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},clearInterval(){}};
  vm.createContext(c);vm.runInContext(startup,c);vm.runInContext(login,c);
  intervals.find(t=>t.ms===100).fn();
  return {c,nodes,saved,buttons,windowEvents,
    timeout:ms=>timeouts.find(t=>t.ms===ms).fn(),auth:(event,s)=>authCallback(event,s),
    click:action=>events.click.forEach(fn=>fn({target:{closest:s=>s==='[data-wf-boot]'?{disabled:false,getAttribute:()=>action}:null}})),reloads:()=>reloads};
}
const session={user:{id:'fixture',email:'fixture@example.invalid'},refresh_token:'synthetic-only'};
test('stalled session has bounded visible feedback, stays locked and preserves unsent data',()=>{
  const f=fixture();f.c.window.WFStartup.appReady();f.timeout(12000);
  assert.match(f.nodes.wfStartupMessage.textContent,/longer than expected/);
  assert.equal(f.nodes.wfStartup.hidden,false);assert(f.c.document.body.classList.contains('wf-locked'));
  assert(f.c.document.documentElement.classList.contains('wf-starting'));
  f.click('retry');assert.equal(f.reloads(),1);assert.equal(f.saved.get('wf_pending'),'keep');
});
test('resolved session opens the app even without an auth event',async()=>{
  const f=fixture({session:Promise.resolve({data:{session}})});f.c.window.WFStartup.appReady();await tick();
  assert.equal(f.nodes.wfStartup.hidden,true);assert.equal(f.c.document.body.classList.contains('wf-locked'),false);
});
test('late successful session recovers after timeout without a forced reload',async()=>{
  let resolve;const f=fixture({session:new Promise(r=>{resolve=r})});f.c.window.WFStartup.appReady();f.timeout(12000);
  resolve({data:{session}});await tick();assert.equal(f.nodes.wfStartup.hidden,true);assert.equal(f.reloads(),0);
});
test('a newer sign-out wins over an old pending session response',async()=>{
  let resolve;const f=fixture({session:new Promise(r=>{resolve=r})});f.c.window.WFStartup.appReady();
  f.auth('SIGNED_OUT',null);resolve({data:{session}});await tick();
  assert(f.c.document.body.classList.contains('wf-locked'));assert.match(f.nodes.wflScreen.innerHTML,/Continue with Google/);
});
test('signed-out users reach sign-in while a failed core script retains recovery',async()=>{
  const f=fixture({session:Promise.resolve({data:{session:null}})});await tick();
  assert.equal(f.nodes.wfStartup.hidden,false);
  f.windowEvents.error({filename:'https://fixture.test/Weekly_focus/js/wf-task-engine.js?v=161'});
  assert.match(f.nodes.wfStartupMessage.textContent,/app file could not start/);
  f.c.window.WFStartup.appReady();assert.equal(f.nodes.wfStartup.hidden,true);
  assert(f.c.document.body.classList.contains('wf-locked'));
});
test('offline stored-session policy is retained and does not unlock an online signed-out user',async()=>{
  for(const online of [true,false]){
    const f=fixture({online,stored:session,session:Promise.resolve({data:{session:null}})});f.c.window.WFStartup.appReady();await tick();
    assert.equal(f.c.document.body.classList.contains('wf-locked'),online);
    assert.equal(f.saved.get('wf2_sb_auth'),JSON.stringify(session));
  }
});
test('failed auth request shows recovery without clearing the saved session',async()=>{
  const f=fixture({stored:session,session:Promise.reject(new Error('offline-ish'))});f.c.window.WFStartup.appReady();await tick();
  assert.match(f.nodes.wfStartupMessage.textContent,/Sign-in could not be checked/);
  assert(f.c.document.body.classList.contains('wf-locked'));assert(f.saved.has('wf2_sb_auth'));
});
test('Update app files updates only this scope, reloads and preserves all local data',async()=>{
  let updates=0;const f=fixture({stored:session,serviceWorker:{getRegistration:async()=>({scope:'https://fixture.test/Weekly_focus/',update:async()=>{updates++}})}});
  const before=[...f.saved];f.click('update');await tick();assert.equal(updates,1);assert.equal(f.reloads(),1);assert.deepEqual([...f.saved],before);
});
test('failed or stalled update keeps recovery controls available',async()=>{
  for(const pending of [false,true]){
    const f=fixture({serviceWorker:{getRegistration:()=>pending?new Promise(()=>{}):Promise.reject(new Error('network'))}});
    f.click('update');if(pending)f.timeout(15000);await tick();
    assert.match(f.nodes.wfStartupMessage.textContent,/could not be refreshed/);assert.equal(f.reloads(),0);assert(f.buttons.every(b=>!b.disabled));
  }
});
test('startup UI is in the page before dependency downloads and changed assets are versioned',()=>{
  assert(html.indexOf('id="wfStartupBoot"')<html.indexOf('js/vendor/supabase-2.119.0.js'));
  assert(html.includes('id="wfStartupMessage"'));assert(html.includes('data-wf-boot="update"'));
  assert([...html.matchAll(/<script([^>]+)src="([^"]+)"/g)].every(m=>m[1].includes(m[2].startsWith('https://')?'async':'defer')));
  assert(!html.includes('cdn.jsdelivr.net'));
  assert(html.includes('id="wfStartupDetail"'));
  const app=fs.readFileSync('js/weekly-focus-app.js','utf8'),sw=fs.readFileSync('sw.js','utf8');
  const release=app.match(/APP_BUILD = "v(\d+)"/)[1];
  for(const file of ['wf-login.js','wf-login.css'])for(const text of [html,sw])assert(text.includes(file+'?v='+release));
});

function worker(fetchImpl){
  const listeners={},deleted=[],writes=[],timers=[],cached=new Response('<h1>Saved app</h1>',{headers:{'content-type':'text/html'}});
  const cache={match:async()=>cached.clone(),put:async(k,v)=>{writes.push({key:k,status:v.status})}};
  const c={URL,Response,Promise,setTimeout:(fn)=>{timers.push(fn)},fetch:fetchImpl,
    self:{location:{origin:'https://fixture.test'},registration:{scope:'https://fixture.test/Weekly_focus/'},clients:{claim:async()=>{}},addEventListener:(k,fn)=>{listeners[k]=fn}},
    caches:{keys:async()=>['weekly-focus-v159','weekly-focus-v160','weekly-focus-v161','weekly-focus-v162','weekly-focus-v163','weekly-focus-v164','weekly-focus-v165','wf-logos-v1','arrow-v10','commonplace-v1'],
      delete:async k=>{deleted.push(k)},open:async()=>cache,match:async()=>undefined}};
  vm.createContext(c);vm.runInContext(fs.readFileSync('sw.js','utf8'),c);
  return {listeners,deleted,writes,timers,request(mode='navigate'){
    let response;listeners.fetch({request:{url:'https://fixture.test/Weekly_focus/'+(mode==='navigate'?'':'js/test.js'),mode,method:'GET'},respondWith:p=>{response=p},waitUntil(){}});return response;
  }};
}
test('activation removes only old Weekly Focus builds, keeping other apps and logos',async()=>{
  const w=worker();let done;w.listeners.activate({waitUntil:p=>{done=p}});await done;
  assert.deepEqual(w.deleted,['weekly-focus-v159','weekly-focus-v160','weekly-focus-v161','weekly-focus-v162','weekly-focus-v163','weekly-focus-v164']);
});
test('navigation failures and non-HTML responses cannot poison the offline page',async()=>{
  for(const fn of [async()=>{throw Error('network')},async()=>new Response('Unavailable',{status:503}),async()=>new Response('wrong type')]){
    const w=worker(fn),r=await w.request();assert.match(await r.text(),/Saved app/);assert.equal(w.writes.length,0);
  }
});
test('slow navigation falls back to the saved shell after the timeout',async()=>{
  const w=worker(()=>new Promise(()=>{})),response=w.request();w.timers[0]();assert.match(await (await response).text(),/Saved app/);
});
test('successful page refresh is cached but failed scripts are not',async()=>{
  let w=worker(async()=>new Response('<h1>New app</h1>',{headers:{'content-type':'text/html'}}));
  assert.match(await (await w.request()).text(),/New app/);assert.equal(w.writes.length,1);
  w=worker(async()=>new Response('Missing',{status:404}));assert.equal((await w.request('cors')).status,404);assert.equal(w.writes.length,0);
});

// A best-effort CDN add still waits forever when the network never settles.
test('offline installation requires only same-origin files, including the pinned auth SDK',async()=>{
  const source=fs.readFileSync('sw.js','utf8'),listeners={},assets=[];let skipped=false;
  const ctx={URL,Response,Promise,setTimeout,self:{addEventListener:(k,fn)=>listeners[k]=fn,skipWaiting:async()=>{skipped=true}},
    caches:{open:async()=>({addAll:async xs=>{assert(xs.every(x=>x.startsWith('./')));assets.push(...xs)}})}};
  vm.createContext(ctx);vm.runInContext(source,ctx);let done;listeners.install({waitUntil:p=>done=p});await done;
  assert(skipped);assert(assets.includes('./js/vendor/supabase-2.119.0.js'));
});

test('late optional broadcaster starts once and an overlay error cannot abort sign-in',()=>{
  const source=fs.readFileSync('js/weekly-focus-app.js','utf8');
  const part=source.slice(source.indexOf('  function startBroadcast()'),source.indexOf('  function ensureClient()'));
  let listener,starts=0;const ctx={sb:{},window:{},console:{warn(){}},document:{addEventListener:(name,fn)=>{listener=fn}}};
  vm.createContext(ctx);vm.runInContext(part,ctx);ctx.startBroadcast();assert.equal(starts,0);
  ctx.window.AkatsukiBroadcast=()=>({start(){starts++}});
  listener({target:{src:'https://example.invalid/Akatsuki/js/akatsuki-broadcast.js'}});ctx.startBroadcast();
  assert.equal(starts,1);
  delete ctx.window.__wfBroadcast;ctx.window.AkatsukiBroadcast=()=>{throw Error('optional failure')};
  assert.doesNotThrow(()=>ctx.startBroadcast());assert(!ctx.window.__wfBroadcast);
});
