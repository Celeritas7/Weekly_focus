const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

// Exercise the actual Code IIFE with a deterministic clock, isolated storage
// and a cloud endpoint whose responses the test controls.
test("batch writes wait for local commits, serialize, back off and preserve an in-flight edit", async () => {
  const timers = [], commits = [], requests = [];
  let now = 1000;
  const c = {
    document:{readyState:"loading",addEventListener(){},getElementById(){return null;}},
    navigator:{onLine:true}, window:{}, Blob, Date:class extends Date {static now(){return now;}},
    setTimeout(fn,delay){timers.push({fn,delay});return timers.length;}, clearTimeout(){}
  };
  c.window.__wfSb = {auth:{getSession:async()=>({data:{session:{user:{id:"fixture"}}}})},
    from(){return {upsert(row){return new Promise(resolve=>requests.push({row,resolve}));}};}};
  const source = fs.readFileSync("js/wf-code.js","utf8").replace("  if (document.readyState",`
    put = r => new Promise(resolve => commits.push(resolve));
    db = {}; paintTreeSoon = function () {};
    globalThis.fixture = {save,items,deviceState};
    if (document.readyState`);
  c.commits = commits;
  vm.runInNewContext(source,c);
  const flush = () => new Promise(resolve=>setImmediate(resolve));
  function file(id){return {id,kind:"file",name:id,code:"v1",vers:[]};}
  async function start(){assert.equal(timers.length,1);const t=timers.shift();now+=t.delay;t.fn();await flush();}
  for(const id of ["a","b"]) c.fixture.save(file(id));
  assert.equal(timers.length,0);
  commits.splice(0).forEach(fn=>fn()); await flush();
  await start(); assert.equal(requests.length,1); assert.equal(timers.length,0);
  requests.shift().resolve({error:{message:"timeout"}}); await flush();
  assert.ok(timers[0].delay>=3000);
  await start(); const b=c.fixture.items.b;
  b.code="v2"; c.fixture.save(b); commits.shift()(); await flush();
  requests.shift().resolve({}); await flush();
  assert.equal(b.synced,false);
  await start(); requests.shift().resolve({}); await flush(); commits.shift()(); await flush();
  await start(); assert.equal(requests[0].row.payload.code,"v2");
  requests.shift().resolve({}); await flush(); commits.shift()(); await flush();
  assert.equal(b.synced,true);
  assert.equal(timers.length,0);
});
