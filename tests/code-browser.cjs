// Real IndexedDB and UI, isolated origin and synthetic cloud writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"]});
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("http://fixture.test/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({contentType:"text/html",body:'<link rel="stylesheet" href="/css/wf-code-browser.css"><section id="scrChats"></section><div class="htabbar"></div><script src="/js/wf-code-hl.js"></script><script src="/js/wf-zip.js"></script><script src="/js/wf-code.js"></script>'});
      return route.fulfill({contentType:path.endsWith("css")?"text/css":"text/javascript",body:fs.readFileSync("." + path)});
    });
    await page.addInitScript(() => {
      window.writes = []; window.busy = 0; window.peak = 0;
      window.__wfSb = {
        auth:{getSession: async () => ({data:{session:{user:{id:"fixture"}}}}),onAuthStateChange(){}},
        from() {return {
          select(){return {eq:async()=>({data:[]}),data:[]}},
          async upsert(row) {
            window.peak = Math.max(++window.busy,window.peak);
            window.writes.push([row.item_key,Date.now()]);
            await new Promise(resolve=>setTimeout(resolve,90));
            window.busy--;
            return window.writes.length === 1 ? {error:{message:"Synthetic timeout"}} : {};
          }
        };}
      };
    });
    await page.goto("http://fixture.test");
    await page.waitForFunction(()=>window.__wfCode);
    await page.click("#wfcAdd");
    await page.click("#wfcPick");
    await page.setInputFiles("#wfcFiles",["one","two","three"].map(name=>({name:name+".js",mimeType:"text/plain",buffer:Buffer.from(name)})));
    await page.click("#wfcProgress");
    await page.waitForFunction(()=>document.querySelector("#wfcUploadBody").textContent.includes("Waiting to retry"));
    await page.waitForFunction(()=>document.querySelector("#wfcProgress").textContent.includes("3 of 3"));
    const {writes,peak} = await page.evaluate(()=>({writes,peak}));
    assert.equal(peak,1); assert.equal(writes.length,4); assert.ok(writes[1][1]-writes[0][1]>=3000);
    await page.click("button[aria-label='Close uploads']");
    await page.context().setOffline(true);
    await page.evaluate(()=>window.__wfCode.add("nested.txt","offline text",["example"]));
    await page.waitForFunction(()=>document.querySelector("#wfcProgress").textContent.includes("4 saved on this device"));
    await page.reload();
    await page.waitForFunction(()=>window.__wfCode);
    await page.click("[data-parent]");
    await page.click(".wfc-fold");
    await page.click(".wfc-file");
    assert.equal(await page.inputValue("#wfcName"),"nested.txt");
    await page.click("[data-wfa=back]");
    await page.click("[data-parent]");
    await page.context().setOffline(false);
    await page.waitForFunction(()=>document.querySelector("#wfcProgress").textContent.includes("4 of 4"));
    await page.click("[data-fmenu]");
    const download = page.waitForEvent("download");
    await page.click("[data-fa=zip]");
    assert.equal((await download).suggestedFilename(),"example.zip");
    await page.setViewportSize({width:1200,height:840});
    await page.waitForSelector(".wfc-root");
    assert.deepEqual(errors,[]);
    console.log("PASS mobile batch, serial retries, confirmed counts, offline reload/resume, folder navigation, ZIP and desktop tree");
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
