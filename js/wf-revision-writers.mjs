// The hub is a durable source of requests. Its originating identity and observed
// revision must survive delivery retries; reply only on a confirmed result.
export async function applyRoadmap(request, commit, reply) {
  const {id, board, item, sub, base, kind} = request;
  if (!id || !board || !item || !sub || !Number.isSafeInteger(base) || base < 0 ||
      !["task.done", "task.skipped"].includes(kind)) return "review";
  const op = { board, item, base, id: JSON.stringify(["roadmap", id]),
    intent: {field: kind === "task.done" ? "done" : "lat", sub, value:true} };
  const result = await commit(op);
  if (!["applied","replayed"].includes(result.status) || result.version !== base + 1)
    return "review";
  await reply(id, result.version);
  return "confirmed";
}

// Trusted bridge supplies owner-scoped observations and the narrow commit RPC.
// Never send back a copied task payload. Refresh both inputs on conflict.
export async function reflectCC(readCurrent, commit) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const {board,item,revision,current,desired} = await readCurrent();
    if (!board || !item || !Number.isSafeInteger(revision) || revision < 0 ||
        typeof current !== "boolean" || typeof desired !== "boolean") return "review";
    if (current === desired) return "current";
    const result = await commit({board,item,base:revision,
      id:JSON.stringify(["reflect",revision,desired]),intent:{field:"ccActive",sub:null,value:desired}});
    if (["applied","replayed"].includes(result.status) && result.version === revision + 1)
      return "confirmed";
    if (result.status !== "conflict") return "review";
  }
  return "retry";
}
