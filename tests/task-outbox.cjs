const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");
const {spawnSync} = require("node:child_process");

test("offline edit, fresh process recovery, lost acknowledgment and legacy drafts", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-queue-"));
  function session(commands) {
    const result = spawnSync(process.execPath, ["--experimental-webstorage", "--localstorage-file=" + join(dir, "pc"),
      "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import {openTaskOutbox} from './js/wf-revision-outbox.mjs';
      let send = () => {throw new Error('unexpected send')};
      const q = openTaskOutbox('owner','board', op => send(op));
      ` + commands], {cwd: join(__dirname, ".."), encoding:"utf8"});
    assert.equal(result.status, 0, result.stderr);
  }
  try {
    session(`await q.observe('entry', 8, {done:false});
      await q.enqueue('entry', 8, {done:true}, 'pc');
      const legacy = {old:{table:'weekly_focus_entries', row:{item_key:'app:a',board_id:'board',payload:{notes:'keep'}}}};
      await q.preserveLegacy(legacy); await q.preserveLegacy(legacy);`);
    session(`await q.observe('entry',10,{done:false});
      send = op => {assert.equal(op.base,8);return {status:'conflict',version:10}};
      await q.flush();
      await q.enqueue('entry',10,{done:true},'retry');
      send = op => {assert.equal(op.id,'retry');throw Error('reply lost')};
      await assert.rejects(q.flush(), /reply lost/);`);
    session(`send = op => {assert.equal(op.id,'retry');assert.equal(op.base,10);return {status:'replayed',version:11}};
      await q.flush();
      const state = await q.inspect();
      assert.deepEqual(state.operations.map(op=>op.status),['review','legacy-draft']);
      assert.equal(state.operations[1].intent.row.payload.notes,'keep');
      assert.deepEqual(state.snapshots,[{item:'entry',revision:10,payload:{done:false}}]);
      assert.deepEqual((await openTaskOutbox('other','board',send).inspect()).operations,[]);
      const changes = [{item:'entry',base:10,kind:'delete'}];
      await q.enqueueBatch(changes,false,'batch-1');
      send = op => {assert.deepEqual(op.intent.changes,changes);return {status:'replayed'}};
      await q.flush();
      assert.equal((await q.inspect()).operations.length,2);`);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
