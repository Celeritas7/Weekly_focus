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
    if(slowDependency&&u.hostname==='cdn.jsdelivr.net')return; // intentionally unresolved script download
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
  await run('stalled dependency does not prevent startup feedback from painting',async()=>{
    const {context,page}=await fixture('pending',{slowDependency:true});
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor({timeout:5000});
    assert(await page.locator('#wfStartupMessage').isVisible());await context.close();
  });
  await run('existing goal picker and notes fixtures still pass at all three widths',async()=>{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    const page=await context.newPage();await page.goto(origin+'/tests/details.html');
    await page.waitForFunction(()=>document.querySelector('#results').textContent.split('\n').length===3,{},{timeout:15000});
    const result=await page.locator('#results').innerText();assert.equal((result.match(/PASS/g)||[]).length,3,result);await context.close();
  });
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close();});
