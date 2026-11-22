const {test} = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../js/wf-revision-writers.mjs");

test("Roadmap retries a lost commit or reply with the originating ID and revision", async () => {
  const {applyRoadmap} = await modulePromise;
  for (const kind of ["task.done","task.skipped"]) {
    const request = {id:"hub-2",board:"board",item:"app:a",sub:"leaf",base:5,kind};
    const seen = [];
    let replies = 0;
    async function commit(op) {
      seen.push(op);
      if (seen.length === 1) throw Error("offline after commit");
      return {status:"replayed",version:6};
    }
    async function reply() {
      if (++replies === 1) throw Error("hub unavailable");
    }
    await assert.rejects(applyRoadmap(request,commit,reply),/offline/);
    assert.equal(replies,0);
    await assert.rejects(applyRoadmap(request,commit,reply),/unavailable/);
    assert.equal(await applyRoadmap(request,commit,reply),"confirmed");
    assert.deepEqual(seen[0], seen[2]);
    assert.equal(seen[0].intent.field,kind === "task.done" ? "done" : "lat");
    assert.equal(await applyRoadmap(request,async()=>({status:"conflict"}),assert.fail),"review");
    assert.equal(await applyRoadmap({...request,base:null},assert.fail,assert.fail),"review");
  }
});

test("CC rereads the desired flag after a conflict and sends only the owned field",async () => {
  const {reflectCC} = await modulePromise;
  let reads = 0, writes = 0;
  assert.equal(await reflectCC(async()=>({board:"board",item:"app:a",revision:++reads,
      current:false,desired:reads === 1}),async op=>{
    writes++;
    assert.deepEqual(op.intent,{field:"ccActive",sub:null,value:true});
    return {status:"conflict"};
  }),"current");
  assert.equal(writes,1);
  assert.equal(reads,2);
});
