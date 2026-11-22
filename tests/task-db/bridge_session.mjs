// Drive the shared writer adapters through trusted fixture sessions. The
// browser-facing HTTP endpoint never receives a bridge credential.
import assert from "node:assert/strict";
import {createInterface} from "node:readline";
import {applyRoadmap, reflectCC} from "../../js/wf-revision-writers.mjs";
const lines = createInterface({input:process.stdin})[Symbol.asyncIterator]();
async function call(method, args) {
  console.log(JSON.stringify({method,args}));
  const {value,done} = await lines.next();
  if (done) throw Error("Fixture disconnected");
  return JSON.parse(value);
}
const {revision} = await call("read");
const request={id:"source-1",board:"shared",item:"app:pilot",base:revision,sub:"leaf",kind:"task.done"};
const reply=async(id,version)=>{
  const state=await call("read");
  assert.equal(state.revision,version);
  assert.equal(state.payload.subtasks[0].done,true);
};
const commit=op=>call("wf",op);
assert.equal(await applyRoadmap(request,commit,reply),"confirmed");
assert.equal(await applyRoadmap(request,commit,reply),"confirmed");
assert.equal(await reflectCC(async()=>{
  const {revision,payload}=await call("read");
  return {board:request.board,item:request.item,revision,current:payload.ccActive,desired:true};
},op=>call("cc",op)),"confirmed");
const after=await call("read");
assert.equal(after.revision,revision+2);
assert.equal(after.payload.ccActive,true);
assert.equal(after.payload.subtasks[0].done,true);
process.stdin.destroy();
