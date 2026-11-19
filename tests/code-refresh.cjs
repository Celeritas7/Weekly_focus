const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("second device pages metadata, resumes downloads and protects local edits", async () => {
  const cloud = new Map(), device = {}, requests = [], saved = new Map();
  for (let i = 0; i < 105; i++) {
    const id = String(i).padStart(3, "0"), key = "code:" + id;
    const record = {id, kind:"file", name:id, u:1000, code:"unchanged", lang:"Text", synced:true};
    cloud.set(key, {item_key:key, updated_at:new Date(1000).toISOString(), payload:{...record}});
    device[id] = record;
  }
  for (const id of ["001","002","003","100"]) {
    const row = cloud.get("code:"+id);
    row.updated_at = new Date(2000).toISOString();
    Object.assign(row.payload,{u:2000,code:"new",del:id==="100"});
  }
  device["003"].synced = false;
  let failKey = "code:002";
  const client = { auth:{getSession:async()=>({data:{session:{user:{id:"fixture"}}}})},
    from(){return { select(columns){
      const filters = {};
      return {
        eq(k,v){filters[k]=v;return this;}, order(){return this;}, limit(n){filters.limit=n;return this;},
        gt(k,v){filters.after=v;return this;},
        then(resolve){assert.equal(columns,"item_key,updated_at");assert.equal(filters.user_id,"fixture");
          resolve({data:[...cloud.values()].filter(r=>r.item_key>(filters.after||"")).slice(0,filters.limit)
            .map(({item_key,updated_at})=>({item_key,updated_at}))});},
        maybeSingle(){assert.equal(columns,"payload,updated_at");requests.push(filters.item_key);
          return filters.item_key===failKey?{error:new Error("timeout")}:{data:cloud.get(filters.item_key)};}
      };
    }};}
  };
  const c = {window:{__wfSb:client},document:{readyState:"loading",addEventListener(){},getElementById(){return null;}},
    navigator:{onLine:true}, device,saved};
  const source = fs.readFileSync("js/wf-code.js","utf8").replace("  if (document.readyState",`
    items=device; readyToRefresh=true; put=async r=>saved.set(r.id,r);
    loadShares=()=>{}; globalThis.run=pull; globalThis.status=()=>[lastRefresh,refreshMessage];
    if (document.readyState`);
  vm.runInNewContext(source,c);
  await c.run(); assert.equal(c.status()[0],0); assert.match(c.status()[1],/incomplete/);
  assert.equal(saved.get("001").code,"new"); assert.deepEqual(requests,["code:001","code:002"]);
  failKey=""; requests.length=0; await c.run();
  assert.deepEqual(requests,["code:002","code:100"]); assert.equal(device["100"].del,true);
  assert.equal(device["003"].code,"unchanged"); assert.ok(c.status()[0]>0);
  requests.length=0; await c.run(); assert.deepEqual(requests,[]);
});
