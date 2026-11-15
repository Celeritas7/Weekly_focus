const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../js/wf-task-data.js');
const fixture = {id:'s1',t:'改善案\nမြန်မာစာ',done:false,u:20,tag:'fix',ctx:['@train'],
  src:{app:'fixture',id:'origin-1'},notes:'Keep me',rating:4,history:[{doneAt:10}],
  extra:{nested:['b','a'],nullable:null}};

test('normalization preserves all extension data without mutating input',()=>{
  const before=JSON.stringify(fixture), out=D.normalize([fixture])[0];
  for(const key of Object.keys(fixture))assert.deepEqual(out[key],fixture[key]);
  out.extra.nested.push('new');assert.equal(JSON.stringify(fixture),before);
  assert.deepEqual(D.normalize(D.normalize([fixture])),D.normalize([fixture]));
});
test('legacy IDs remain stable and ambiguous legacy records are detected',()=>{
  assert.equal(D.normalize([{t:'same'}])[0].id,D.legacyId('same'));
  assert.equal(D.inspect([{t:'same'},{t:'same'}])[0].code,'duplicate-id');
  assert.equal(D.inspect([{id:1},{id:'1'}])[0].code,'duplicate-id');
});
test('merge preserves provenance and unknown fields on equal and newer clocks',()=>{
  const old={...fixture,done:true};
  for(const u of [20,21]){
    const out=D.merge([old],[{id:'s1',t:'renamed',u}])[0];
    assert.deepEqual(out.src,fixture.src);assert.deepEqual(out.history,fixture.history);
    assert.deepEqual(out.extra,fixture.extra);
  }
  assert.equal(D.merge([old],[{id:'s1',u:21,done:false}])[0].done,false);
});
test('equal-clock merge is symmetric and idempotent while retaining legacy union semantics',()=>{
  const a={id:'a',t:'alpha',done:true,u:5,src:{id:1}},b={id:'a',t:'beta',done:false,u:5,tag:'fix'};
  const m=D.merge([a],[b]);assert.deepEqual(m,D.merge([b],[a]));
  assert.deepEqual(D.merge(m,m),m);assert.equal(m[0].done,true);
});
test('union does not resurrect a newer tombstone and safely handles object-key IDs',()=>{
  const m=D.merge([{id:'__proto__',u:1},{id:'a',u:20,del:true}],[{id:'constructor',u:1},{id:'a',u:3,del:false}]);
  assert.equal(m.length,3);assert.equal(m.find(s=>s.id==='a').del,true);
});
test('ambiguous repeated imports retain duplicate evidence, without expanding on replay',()=>{
  const raw=[{id:'a',t:'one'},{id:'a',t:'two'},null];
  const merged=D.merge(raw,raw);assert.deepEqual(merged,raw);
  assert(D.writeIssue({subtasks:merged}));assert.deepEqual(D.merge(merged,raw),merged);
});
test('signature sees source, tags, history and future fields but ignores outer/key order',()=>{
  const before=D.signature([fixture]);
  for(const patch of [{tag:'new'},{src:{id:'new'}},{history:[]},{parentId:'parent'},{extra:{nested:['a','b']}}])
    assert.notEqual(D.signature([{...fixture,...patch}]),before);
  assert.equal(D.signature([{id:'b'},{id:'a'}]),D.signature([{id:'a'},{id:'b'}]));
  assert.equal(D.canonical({a:1,b:2}),D.canonical({b:2,a:1}));
});
test('newer shapes stay readable and serialize losslessly but cannot be written',()=>{
  for(const entry of [{taskSchemaVersion:2,subtasks:[fixture]}, {subtasks:[{...fixture,parentId:'p'}]},
    {subtasks:[{...fixture,archived:true}]},{subtasks:[{...fixture,occurrenceId:'run1'}]},
    {subtasks:'invalid'}, {subtasks:[null]}, {taskSchemaVersion:'2'}]){
    const raw=JSON.stringify(entry);assert(D.writeIssue(entry));assert.equal(JSON.stringify(entry),raw);
  }
  assert.equal(D.writeIssue({subtasks:[fixture]}),'');
});
test('app patch rejects an unsafe record before changing in-memory state or queuing',()=>{
  const source=fs.readFileSync('js/weekly-focus-app.js','utf8');
  const start=source.indexOf('  function taskWriteIssue('),end=source.indexOf('  /* ---------------- inventory',start);
  const messages=[],writes=[];
  const c={TaskData:D,TaskEngine:require('../js/wf-task-engine.js'),TASK_LOCKS:{},entries:{a:{subtasks:[fixture]}},STALE:false,toast:x=>messages.push(x),save:()=>{},cloudPushEntry:(...x)=>writes.push(x)};
  vm.createContext(c);vm.runInContext(source.slice(start,end),c);
  assert.equal(c.patch('a',{notes:'saved'}),true);assert.equal(writes.length,1);
  c.TASK_LOCKS.a='Newer format';assert.equal(c.patch('a',{notes:'unsafe'}),false);
  assert.equal(c.entries.a.notes,'saved');assert.equal(writes.length,1);
  c.TASK_LOCKS={};c.STALE=true;assert.equal(c.patch('a',{notes:'stale'}),false);
  assert.equal(writes.length,1);assert.equal(messages.length,2);
});
test('queued unsafe and stale writes remain queued and never reach the database',async()=>{
  const source=fs.readFileSync('js/weekly-focus-app.js','utf8');
  const start=source.indexOf('  async function flushOutbox()'),end=source.indexOf('\n  function ',start);
  // Stop at the next top-level function (cloudPullInventory in the current app).
  const next=source.indexOf('\n  async function ',start+10),stop=Math.min(end<0?Infinity:end,next<0?Infinity:next);
  let writes=0;
  const c={syncReady:()=>true,flushing:false,session:{user:{id:'fixture-user'}},outbox:{'entry:a':{table:'weekly_focus_entries',row:{item_key:'a',payload:{taskSchemaVersion:2,subtasks:[]}},onConflict:'key'}},
    boardPulled:true,invPulled:true,STALE:false,BOARD_ITEM:'__board',taskWriteIssue:(k,p)=>D.writeIssue(p),OB_ERR:null,
    sb:{from:()=>({upsert:()=>{writes++;return Promise.resolve({})}})},saveOutbox:()=>{},updateCloudStatus:()=>{},saveCache:()=>{},recMigrating:false,navigator:{onLine:true}};
  vm.createContext(c);vm.runInContext(source.slice(start,stop),c);
  await c.flushOutbox();assert.equal(writes,0);assert.equal(Object.keys(c.outbox).length,1);assert(c.OB_ERR);
  c.outbox['entry:a'].row.payload={};c.STALE=true;await c.flushOutbox();assert.equal(writes,0);assert.equal(Object.keys(c.outbox).length,1);
});
test('offline shell and main app agree on release and load the storage module first',()=>{
  const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('js/weekly-focus-app.js','utf8'),sw=fs.readFileSync('sw.js','utf8');
  const build=app.match(/APP_BUILD = "(v\d+)"/)[1];
  assert(html.includes('weekly-focus-app.js?'+build.replace('v','v=')));
  assert(sw.includes('weekly-focus-'+build));
  assert(sw.includes('wf-task-data.js?'+build.replace('v','v=')));
  assert(html.indexOf('js/wf-task-data.js')<html.indexOf('js/weekly-focus-app.js'));
});
