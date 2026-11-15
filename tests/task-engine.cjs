const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../js/wf-task-engine.js');
const D = require('../js/wf-task-data.js');
const source = fs.readFileSync('js/weekly-focus-app.js', 'utf8');
const task = (id, parentId, done = false, extra = {}) => ({id,t:id,parentId,done,u:10,...extra});
const tree = () => [task('root',null),task('group','root'),task('a','group',true),task('b','group'),task('c','root',true)];
const by = (items,id) => items.find(n=>n.id===id);
const cmd = (items,action) => E.command(items,action,{now:50});

test('nested progress counts terminal work once: 2/3, and 3/4 with a standalone task',()=>{
  const a=tree(), p=E.progress(a,'root');
  assert.equal(p.done,2);assert.equal(p.total,3);assert.equal(p.pct,2/3);
  assert.deepEqual(new Set(p.blockerIds),new Set(['group','b']));
  const all=E.progress(a.concat(task('standalone',null,true)));
  assert.equal(all.done,3);assert.equal(all.total,4);
  assert.equal(E.progress(a).total,3);
});
test('no checklist, completed checklist, archived-only and broken references are distinct',()=>{
  assert.equal(E.progress([]).kind,'none');
  assert.equal(E.progress([task('leaf',null,true)],'leaf').pct,null);
  assert.equal(E.progress([task('p',null),task('a','p',true)],'p').pct,1);
  const archived=[task('p',null,true),task('a','p',false,{archived:true})];
  assert.equal(E.progress(archived,'p').kind,'empty-active');
  assert.equal(E.progress(archived).total,0);assert.equal(E.progress(archived).pct,null);
  assert.equal(E.progress(archived,'a').kind,'inactive');
  assert.equal(E.progress(archived,'missing').issues[0].code,'missing-task');
  assert.equal(E.progress([task('orphan','absent')]).kind,'unresolved');
});
test('parent stays open until every descendant and intermediate parent is done',()=>{
  let a=tree(); const snapshot=JSON.stringify(a);
  const rejected=cmd(a,{type:'done',id:'root',done:true});
  assert.equal(rejected.ok,false);assert(rejected.blockerIds.includes('b'));
  assert.equal(JSON.stringify(a),snapshot);
  a=cmd(a,{type:'done',id:'b',done:true}).items;
  assert.equal(E.progress(a,'root').pct,1);assert.equal(by(a,'root').done,false);
  assert.equal(E.completion(a,'root').allowed,false); // group still needs confirmation
  a=cmd(a,{type:'done',id:'group',done:true}).items;
  assert.equal(E.completion(a,'root').allowed,true);
  assert.equal(cmd(a,{type:'done',id:'root',done:true}).ok,true);
});
test('reopening a deep child atomically reopens ancestors and preserves history/identities',()=>{
  const a=tree().map(n=>({...n,done:true,u:500,src:{app:'fixture',id:n.id},history:[{at:2}],rating:4}));
  const result=cmd(a,{type:'done',id:'b',done:false});assert.equal(result.ok,true);
  assert.deepEqual(new Set(result.changedIds),new Set(['root','group','b']));
  for(const id of ['root','group','b']){assert.equal(by(result.items,id).done,false);assert.equal(by(result.items,id).u,501);}
  assert.equal(by(result.items,'c').u,500);assert(a.every(n=>n.done));
  for(const n of result.items){assert.deepEqual(n.src,by(a,n.id).src);assert.deepEqual(n.history,[{at:2}]);assert.equal(n.rating,4);}
});
test('archive excludes an entire branch regardless of order; restore reopens parents',()=>{
  let a=tree().reverse();a=cmd(a,{type:'archive',id:'group'}).items;
  assert.equal(E.progress(a,'root').total,1);assert.equal(E.completion(a,'root').allowed,true);
  a=cmd(a,{type:'done',id:'root',done:true}).items;
  const restored=cmd(a,{type:'restore',id:'group'});assert.equal(restored.ok,true);
  assert.equal(by(restored.items,'root').done,false);assert.equal(E.progress(restored.items,'root').total,3);
  assert.equal(by(restored.items,'b').id,'b');assert.equal(a.find(n=>n.id==='group').archived,true);
});
test('restoring a branch retains separately archived children; hidden edits are rejected',()=>{
  let a=tree();a=cmd(a,{type:'archive',id:'b'}).items;a=cmd(a,{type:'archive',id:'group'}).items;
  assert.equal(cmd(a,{type:'restore',id:'b'}).ok,false);
  assert.equal(cmd(a,{type:'done',id:'b',done:true}).ok,false);
  a=cmd(a,{type:'restore',id:'group'}).items;
  assert.equal(by(a,'b').archived,true);assert.equal(E.progress(a,'root').total,2);
});
test('parked branches still count and block completion but are not actionable',()=>{
  const a=tree();by(a,'group').lat=true;const g=E.analyze(a);
  assert.equal(E.progress(a,'root').total,3);assert.equal(E.completion(a,'root').allowed,false);
  assert.equal(g.active.has('b'),true);assert.equal(g.actionable.has('b'),false);
  assert.equal(cmd(a,{type:'done',id:'b',done:true}).ok,true); // existing For later action
});
test('bulk changes cannot complete only the parent but can confirm all completed work',()=>{
  const a=tree();let p=a.map(n=>({...n,done:n.id==='root'?true:n.done}));
  assert.equal(E.transition(a,p).ok,false);
  p=a.map(n=>({...n,done:true}));assert.equal(E.transition(a,p).ok,true);
  const hidden=[task('a',null,false,{archived:true})];
  assert.equal(E.transition(hidden,hidden.map(n=>({...n,done:true}))).ok,false);
});
test('adding or moving unfinished work into a done parent reopens its ancestry',()=>{
  const a=[task('root',null,true),task('group','root',true),task('outside',null)];
  let r=cmd(a,{type:'add',item:task('new','group')});assert.equal(r.ok,true);
  assert.equal(by(r.items,'root').done,false);assert.equal(by(r.items,'group').done,false);
  r=cmd(a,{type:'reparent',id:'outside',parentId:'group'});assert.equal(r.ok,true);
  assert.equal(by(r.items,'root').done,false);assert.equal(by(r.items,'outside').id,'outside');
  assert.equal(cmd(a,{type:'add',item:task('root',null)}).ok,false);
});
test('duplicate IDs, cycles, missing parents and invalid records are rejected without edits',()=>{
  for(const a of [[task('a','b'),task('b','a')],[task('a','a')],[task('a','gone')],
    [task('a',null),task('a',null)],[null],{bad:true}]){
    const snapshot=JSON.stringify(a);assert(E.analyze(a).issues.length);
    assert.equal(cmd(a,{type:'done',id:'a',done:true}).ok,false);assert.equal(JSON.stringify(a),snapshot);
  }
  assert.equal(cmd(tree(),{type:'reparent',id:'root',parentId:'b'}).ok,false);
});
test('soft deletion keeps records; hard deletion is rejected; replay is idempotent',()=>{
  const a=[task('a',null,false,{history:[{at:1}]})];
  assert.equal(E.transition(a,[]).ok,false);
  const r=cmd(a,{type:'remove',id:'a'});assert.equal(r.ok,true);assert.equal(r.items.length,1);
  assert.deepEqual(r.items[0].history,[{at:1}]);assert.equal(E.progress(r.items).pct,null);
  assert.equal(cmd(r.items,{type:'restore',id:'a'}).ok,false);
  const done=cmd(a,{type:'done',id:'a',done:true});
  const again=cmd(done.items,{type:'done',id:'a',done:true});assert.deepEqual(again.items,done.items);assert.deepEqual(again.changedIds,[]);
});
test('older edit payloads retain omitted metadata and relationship fields',()=>{
  const a=[task('p',null),task('a','p',false,{src:{id:'origin'},history:[{at:1}],notes:'keep'})];
  const r=E.transition(a,[a[0],{id:'a',t:'renamed'}],{now:100});assert.equal(r.ok,true);
  assert.equal(by(r.items,'a').parentId,'p');assert.equal(by(r.items,'a').notes,'keep');
  assert.deepEqual(by(r.items,'a').history,[{at:1}]);assert.deepEqual(by(r.items,'a').src,{id:'origin'});
  assert.equal(E.transition(a,a,{now:NaN}).ok,false);
});
test('deep trees and child-before-parent imports do not overflow the call stack',()=>{
  const a=Array.from({length:2500},(_,i)=>task(String(i),i?String(i-1):null,true)).reverse();
  assert.equal(E.progress(a).total,1);assert.equal(E.analyze(a).issues.length,0);
  const r=cmd(a,{type:'done',id:'2499',done:false});assert.equal(r.ok,true);
  assert.equal(r.changedIds.length,2500);assert(r.items.every(n=>!n.done));
});

// Execute the real app adapters with synthetic records. The permissive writeIssue
// below exists only in this fixture to exercise rules behind the production gate.
function appContext(items,allowNested=true){
  const messages=[],writes=[];
  const c={TaskData:allowNested?{...D,writeIssue:()=>''}:D,TaskEngine:E,TASK_LOCKS:{},STALE:false,
    entries:{'app:test':{subtasks:D.copy(items),notes:'notes'}},toast:m=>messages.push(m),save:()=>{},cloudPushEntry:(...args)=>writes.push(args),
    renderCols:()=>{},renderPulse:()=>{},renderFive:()=>{},renderAll:()=>{},renderTodayScreen:()=>{},renderCalScreen:()=>{},
    key:'app:test',k:'app:test',LAT_OPEN:{},esc:s=>String(s).replace(/"/g,'&quot;'),
    akNotReady:()=>'',cloud:{board:'test'},nowISO:()=> '2026-11-15T00:00:00Z',rmItemKey:()=>true,akLog:()=>{},akRender:()=>{}};
  c.subs=k=>c.entries[k].subtasks;c.normSubs=D.normalize;
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  function taskWriteIssue('),source.indexOf('  /* ---------------- inventory')),c);
  vm.runInContext(source.slice(source.indexOf('  function subCompletionAttrs('),source.indexOf('  /* ---- subtask identity')),c);
  return {c,messages,writes};
}
function handler(c,start,end,sid='root'){
  c.e={target:{closest:()=>({getAttribute:()=>sid})}};
  c.act={closest:()=>({getAttribute:()=>sid})};c.el={getAttribute:()=>sid};
  const i=source.indexOf(start);assert(i>=0);const j=source.indexOf(end,i+start.length);assert(j>i);
  vm.runInContext('function run(){'+source.slice(i,j)+'}\nrun();',c);
}
test('list/details, parked and Today/Calendar completion handlers all enforce the central rule',()=>{
  for(const [a,start,end] of [
    ['subtoggle','    if (a === "subtoggle") {','    if (a === "subdel")'],
    ['latdone','    if (a === "latpark" || a === "latback" || a === "latdone") {','    if (a === "medadd")'],
    ['sub2','      if (a === "sub2") {','      if (a === "tray")']]){
    const {c,writes}=appContext(tree());c.a=a;handler(c,start,end);
    assert.equal(writes.length,0,a);assert.equal(by(c.entries[c.k].subtasks,'root').done,false,a);
    c.entries[c.k].subtasks=tree().map(n=>({...n,done:true}));handler(c,start,end,'b');
    if(a!=='latdone'){assert.equal(by(c.entries[c.k].subtasks,'root').done,false,a);assert.equal(writes.length,1,a);}
  }
});
test('Roadmap does not acknowledge a blocked completion, and accepts an eligible one',()=>{
  const {c,writes}=appContext(tree());
  const i=source.indexOf('  function rmApply('),j=source.indexOf('  function pendingCount(',i);
  vm.runInContext(source.slice(i,j),c);
  const r={src_addr:{board_id:'test',item_key:c.k,sub_id:'root'}};
  assert(c.rmApply(r,'done').defer);assert.equal(writes.length,0);
  c.entries[c.k].subtasks=tree().map(n=>({...n,done:n.id!=='root'}));
  assert.equal(c.rmApply(r,'done').reply.status,'applied');assert.equal(writes.length,1);
  assert.equal(c.rmApply(r,'done').reply.status,'already');
});
test('production keeps hierarchy read-only; ordinary flat tasks and weekly completion remain usable',()=>{
  const {c,writes}=appContext([task('a',null)],false);
  assert.equal(c.patch(c.k,{subtasks:[task('a',null,true)]}),true);
  assert.equal(c.patch(c.k,{subtasks:[task('a',null),task('b','a')]}),false);
  assert.equal(writes.length,1);
  assert.equal(c.patch(c.k,{targetDone:true}),true);assert.equal(c.entries[c.k].targetDone,true);
  assert.equal(c.entries[c.k].notes,'notes');
});
test('completion controls expose disabled semantics and every checklist renderer uses them',()=>{
  const {c}=appContext(tree());assert.match(c.subCompletionAttrs(c.k,tree()[0]),/disabled aria-disabled="true"/);
  assert.equal(c.subCompletionAttrs(c.k,tree()[2]),'');
  c.STALE=true;assert.match(c.subCompletionAttrs(c.k,tree()[2]),/disabled/);
  const renderLines=source.split('\n').filter(l=>/data-act="(?:subtoggle|latdone)"|data-hact="sub2"/.test(l));
  assert.equal(renderLines.length,8);assert(renderLines.every(l=>l.includes('subCompletionAttrs(')));
});
test('rejected new-item and expanded-editor saves retain the draft',()=>{
  const {c}=appContext(tree(),false), box={value:'Keep this draft',blur:()=>{throw Error('must not blur')}};
  c.uid=()=> 'new';c.detailFocus=()=>null;
  const i=source.indexOf('  function addSub('),j=source.indexOf('  function sizeNotes(',i);
  vm.runInContext(source.slice(i,j),c);
  c.addSub({closest:()=>({querySelector:()=>box})},c.k);assert.equal(box.value,'Keep this draft');
  let options;c.window={WFDetailUI:{}};c.WFDetailUI={openWriter:o=>{options=o}};c.labelFor=()=>({name:'Fixture'});
  c.startSubEdit({closest:()=>({getAttribute:()=> 'b'})},c.k);
  assert.throws(()=>options.save('Keep the edited draft'),/not saved/);
  assert.equal(by(c.entries[c.k].subtasks,'b').t,'b');
});
test('offline shell loads engine before app and caches the matching release',()=>{
  const html=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('sw.js','utf8');
  const release=source.match(/APP_BUILD = "v(\d+)"/)[1];
  assert(html.indexOf('js/wf-task-data.js')<html.indexOf('js/wf-task-engine.js'));
  assert(html.indexOf('js/wf-task-engine.js')<html.indexOf('js/weekly-focus-app.js'));
  for(const s of [html,sw])for(const f of ['wf-task-engine.js','wf-detail-ui.css'])assert(s.includes(f+'?v='+release));
});
