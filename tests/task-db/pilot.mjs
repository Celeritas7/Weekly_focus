import {openTaskOutbox} from "/js/wf-revision-outbox.mjs";
const item = "app:pilot", board = "pilot", owner = document.body.dataset.pilot;
let display, sheet, revision, shown, draft, busy = false;
const status = document.querySelector("#pilot-status");
const controls = document.querySelector("#pilot-review");
async function api(path, op) {
  const response = await fetch("/pilot/" + path, op ? {method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(op)} : {});
  if (!response.ok) throw Error("Preview server unavailable");
  return response.json();
}
const queue = openTaskOutbox(owner,board,op=>api("commit",op));
async function paint() {
  const state = await queue.inspect();
  const snapshot = state.snapshots.find(row=>row.item===item);
  if (!snapshot) {status.textContent="Connect once to load the sample task.";return;}
  revision = snapshot.revision;
  shown = structuredClone(snapshot.payload);
  const pending = state.operations.find(row=>row.status==="pending");
  draft = state.operations.find(row=>row.status==="review");
  if (pending) {
    const intent = pending.intent;
    const type = intent.field === "archived" ? (intent.value ? "archive" : "restore") : "done";
    const edit = WFTaskEngine.command(shown.subtasks,{type,id:intent.sub,done:intent.value});
    if (edit.ok) shown.subtasks = edit.items;
  }
  display(item, shown);
  controls.hidden = !draft;
  if (draft && draft.intent.field === "archived") {
    status.textContent = "Review needed. Your edit: " + (draft.intent.value ? "archive" : "restore") +
      ". Check the saved branch before retrying.";
    return;
  }
  status.textContent = draft ? "Review needed. Saved task: " + (shown.subtasks[0].done?"complete":"open") +
    ". Your edit: " + (draft.intent.value?"complete":"open") + "." :
    pending ? "Edit saved on this device." : "Synced · revision " + revision;
}
async function sync() {
  if (!navigator.onLine || document.querySelector("#pilot-offline").checked) return;
  const pull = async () => {
    const row = await api("entry");
    await queue.observe(item,row.revision,row.payload);
  };
  await pull(); await queue.flush(); await pull();
}
async function run(action) {
  if (busy) return;
  busy = true;
  try { if (action) await action(); await sync(); await paint(); }
  catch (error) { await paint(); status.append(" · " + error.message); }
  finally {busy=false;}
}
window.__WF_SEED = {apps:[{id:item,name:"Sync practice",group:"General"}],targets:[item],
  entries:{[item]:{active:true}},meta:{},previewSync:{
    mount(update,open) {
      display=update; sheet=open;
      document.querySelector("#pilot-open").onclick=()=>sheet(item,true);
      document.querySelector("#pilot-refresh").onclick=()=>run();
      document.querySelector("#pilot-offline").onchange=()=>run();
      controls.onclick=e=>{
        const action=e.target.dataset.choice;
        if (action && draft) run(()=>queue.resolveReview(draft.id,revision,action==="retry"));
      };
      window.addEventListener("online",()=>run());
      run();
    },
    archive(key,sub,value) {
      if (key!==item || !shown || draft) return;
      run(async()=>{
        const state=await queue.inspect();
        if (state.operations.some(op=>op.status==="pending")) throw Error("Sync your pending edit first");
        await queue.enqueue(item,revision,{field:"archived",sub,value});
      });
    },
    toggle(key,sub) {
      if (key!==item || sub!=="leaf" || !shown || draft) return;
      run(async()=>{
        const state=await queue.inspect();
        if (state.operations.some(op=>op.status==="pending")) throw Error("Sync your pending edit first");
        await queue.enqueue(item,revision,{field:"done",sub,value:!shown.subtasks[0].done});
      });
    }
  }};
window.__wfSb={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{
  user:{id:owner,email:"preview@example.invalid"},refresh_token:"preview"}}})}};
