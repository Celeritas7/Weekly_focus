/* Real app shell and login, isolated synthetic sessions. No production requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
  if(relative==='js/config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end("window.WF_CONFIG={url:'https://fixture.supabase.co',key:'synthetic-key',board:'fixture'};");}
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(err?'Not found':data);});
});
let browser,origin;
async function fixture(mode,{width=390,missingEngine=false,slowDependency=false}={}){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const allowed=new Set(['wf-detail-ui.js','wf-task-data.js','wf-task-engine.js','weekly-focus-app.js','wf-sphere-draft.js','wf-login.js']);
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(slowDependency&&u.pathname.includes('/Akatsuki/'))return; // intentionally unresolved script download
    if(u.origin!==origin)return route.fulfill({status:200,contentType:'text/javascript',body:''});
    if(missingEngine&&u.pathname.endsWith('/wf-task-engine.js'))return route.abort();
    if(u.pathname.endsWith('.js')&&!allowed.has(path.basename(u.pathname)))return route.fulfill({status:200,contentType:'text/javascript',body:''});
    return route.continue();
  });
  await context.addInitScript(mode=>{
    const session={user:{id:'fixture',email:'fixture@example.invalid'},refresh_token:'synthetic-only'};
    localStorage.setItem('wf_pending_fixture','keep draft');
    window.__WF_SEED={apps:[{id:'app:fixture',name:'Mobile fixture',group:'General'}],study:[],office:[],targets:['app:fixture'],
      entries:{'app:fixture':{active:true,subtasks:[{id:'one',t:'Synthetic task',done:false}],notes:'Preserve notes'}},meta:{}};
    window.__wfSb={auth:{onAuthStateChange(callback){window.__authEvent=callback},getSession(){
      if(mode==='pending')return new Promise(resolve=>{window.__resolveSession=resolve});
      return Promise.resolve({data:{session:mode==='signedout'?null:session}});
    }}};
  },mode);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/',{waitUntil:slowDependency?'commit':'load'});
  return {context,page,errors};
}
async function run(name,fn){await fn();console.log('PASS '+name);}
// No seed hook or fake auth client: exercise the shipped SDK, app, Code tab,
// service worker and user/board cache. Every external request stays isolated.
async function realFixture(cached=false,expired=false){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin===origin)return route.continue();
    if(u.pathname.includes('/Akatsuki/'))return; // keep optional downloads pending
    if(expired&&u.hostname==='fixture.supabase.co'&&u.pathname.startsWith('/auth/'))return;
    if(u.hostname==='fixture.supabase.co')return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic offline backend"}'});
    return route.abort();
  });
  if(cached)await context.addInitScript(expired=>{
    if(localStorage.getItem('fixture_initialized'))return;
    const uid='00000000-0000-4000-8000-000000000001',exp=Math.floor(Date.now()/1000)+(expired?-600:3600);
    const jwt=[btoa(JSON.stringify({alg:'HS256',typ:'JWT'})),btoa(JSON.stringify({sub:uid,exp,role:'authenticated'})),'synthetic'].join('.');
    localStorage.setItem('wf2_sb_auth',JSON.stringify({access_token:jwt,refresh_token:'synthetic',token_type:'bearer',expires_at:exp,expires_in:3600,user:{id:uid,email:'fixture@example.invalid'}}));
    const apps=Array.from({length:65},(_,i)=>({id:'app:cached-'+i,name:'Saved app '+i,group:'General Purpose'})),entries={};
    apps.forEach((a,i)=>{entries[a.id]={active:true,notes:'Saved note '+i,subtasks:Array.from({length:5},(_,j)=>({id:'task-'+j,t:'Existing task '+j,done:j===0}))};});
    localStorage.setItem('wf_cache:'+uid+':fixture',JSON.stringify({v:1,at:Date.now(),inv:{apps,study:[],office:[]},entries,meta:{},t:apps.slice(0,5).map(a=>a.id)}));
    localStorage.setItem('wf_outbox:'+uid+':fixture',JSON.stringify({'entry:app:cached-0':{row:{item_key:'app:cached-0',payload:{...entries['app:cached-0'],notes:'Unsent note'}}}}));
    localStorage.setItem('fixture_initialized','1');
  },expired);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  return {context,page,errors};
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{});
  fs.mkdirSync('test-results',{recursive:true});
  await run('mobile stalled session keeps visible recovery and later recovers',async()=>{
    const {context,page,errors}=await fixture('pending',{width:360});
    await page.locator('#wfStartup').waitFor({state:'visible'});
    await page.getByText('Opening is taking longer than expected.',{exact:false}).waitFor({timeout:15000});
    assert(await page.getByRole('button',{name:'Update app files',exact:true}).isVisible());
    assert.equal(await page.locator('.topbar').isVisible(),false);
    await page.screenshot({path:'test-results/startup-stalled-mobile.png'});
    await page.evaluate(()=>window.__resolveSession({data:{session:{user:{id:'fixture'},refresh_token:'synthetic-only'}}}));
    await page.locator('#wfStartup').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('wf_pending_fixture')),'keep draft');
    assert.deepEqual(errors,[]);await context.close();
  });
  await run('valid session opens the real Sphere screen on mobile',async()=>{
    const {context,page,errors}=await fixture('signedin');
    await page.locator('#wfStartup').waitFor({state:'hidden'});
    assert(await page.locator('#scrSphere').isVisible());
    await page.locator('.sd-slot[data-sdk="app:fixture"]').waitFor({state:'visible'});
    assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('wf-locked')),false);
    await page.screenshot({path:'test-results/startup-signedin-mobile.png'});
    assert.deepEqual(errors,[]);await context.close();
  });
  await run('signed-out session shows login and keeps private app UI hidden',async()=>{
    const {context,page,errors}=await fixture('signedout');
    await page.getByRole('button',{name:'Continue with Google'}).waitFor();
    assert.equal(await page.locator('.topbar').isVisible(),false);assert.deepEqual(errors,[]);await context.close();
  });
  await run('late session cannot undo a newer sign-out',async()=>{
    const {context,page}=await fixture('pending');
    await page.waitForFunction(()=>typeof window.__authEvent==='function');
    await page.evaluate(()=>{window.__authEvent('SIGNED_OUT',null);window.__resolveSession({data:{session:{user:{id:'fixture'}}}});});
    await page.getByRole('button',{name:'Continue with Google'}).waitFor();
    assert.equal(await page.locator('.topbar').isVisible(),false);await context.close();
  });
  await run('missing task module shows an actionable recovery message',async()=>{
    const {context,page}=await fixture('signedin',{missingEngine:true});
    await page.getByText('An app file could not start.',{exact:false}).waitFor();
    assert(await page.getByRole('button',{name:'Update app files',exact:true}).isEnabled());
    assert.equal(await page.locator('.topbar').isVisible(),false);await context.close();
  });
  await run('stalled optional downloads no longer block Sphere or sign-in',async()=>{
    const {context,page}=await fixture('signedin',{slowDependency:true});
    await page.locator('#wfStartup').waitFor({state:'hidden',timeout:5000});
    await page.locator('.sd-slot[data-sdk="app:fixture"]').waitFor({state:'visible'});await context.close();
  });
  await run('existing goal picker and notes fixtures still pass at all three widths',async()=>{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    const page=await context.newPage();await page.goto(origin+'/tests/details.html');
    await page.waitForFunction(()=>document.querySelector('#results').textContent.split('\n').length===3,{},{timeout:15000});
    const result=await page.locator('#results').innerText();assert.equal((result.match(/PASS/g)||[]).length,3,result);await context.close();
  });
  await run('shipped auth library reaches sign-in and installs offline files with optional network stalled',async()=>{
    const {context,page,errors}=await realFixture();
    await page.getByRole('button',{name:'Continue with Google'}).waitFor({timeout:10000});
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:10000});
    assert.equal(await page.evaluate(()=>document.readyState),'interactive'); // optional scripts still pending
    assert.deepEqual(errors,[]);await context.close();
  });
  await run('real saved session opens 65 apps, retains unsent notes and reopens offline',async()=>{
    const {context,page,errors}=await realFixture(true);
    await page.locator('.sd-slot[data-sdk="app:cached-0"]').waitFor({state:'visible',timeout:10000});
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:10000});
    const key='wf_outbox:00000000-0000-4000-8000-000000000001:fixture';
    const before=await page.evaluate(k=>localStorage.getItem(k),key);assert(before.includes('Unsent note'));
    await page.screenshot({path:'test-results/startup-cached-mobile.png'});
    await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.sd-slot[data-sdk="app:cached-0"]').waitFor({state:'visible',timeout:10000});
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),before);
    assert.deepEqual(errors,[]);await context.close();
  });
  await run('stalled real auth refresh reports its stage and Update app files responds without deleting data',async()=>{
    const {context,page}=await realFixture(true,true);
    await page.getByText('Opening is taking longer than expected.',{exact:false}).waitFor({timeout:15000});
    assert.equal(await page.locator('#wfStartupDetail').innerText(),'Waiting for sign-in response');
    const before=await page.evaluate(()=>localStorage.getItem('wf2_sb_auth'));
    await Promise.all([page.waitForEvent('domcontentloaded',{timeout:20000}),page.getByRole('button',{name:'Update app files',exact:true}).click()]);
    assert.equal(await page.evaluate(()=>localStorage.getItem('wf2_sb_auth')),before);
    await context.close();
  });
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close();});
