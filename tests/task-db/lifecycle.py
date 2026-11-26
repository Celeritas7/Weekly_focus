from pathlib import Path
import json

from permissions import request


def check_lifecycle(admin, connect):
    admin.execute(Path(__file__).with_name("lifecycle.sql").read_text())
    owner = "00000000-0000-4000-8000-000000000001"
    board = "new-board"
    payload = {"notes":"keep","rating":4,"subtasks":[{"id":"leaf","done":False,"src":"rm"}]}
    with connect("wf_demo_gateway") as gateway:
        def batch(op, changes, close=False):
            with request(gateway, json.dumps({"sub":owner})):
                return gateway.execute("select wf_demo.batch(%s,%s,%s,%s)",
                                       (board,op,json.dumps(changes),close)).fetchone()[0]

        def read(item):
            with request(gateway, json.dumps({"sub":owner})):
                return gateway.execute("select * from wf_demo.read_entry(%s,%s)", (board,item)).fetchone()

        def edit(item, base, kind, **extra):
            return dict(item=item,base=base,kind=kind,**extra)

        create = [edit(i,0,"create",payload=payload) for i in ("app:a","study:b")]
        assert batch("cc via import",[edit("app:a",0,"create",payload={"ccActive":True})]) == "refused"
        assert batch("import",create) == "applied"
        assert batch("import",create) == "replayed"
        assert batch("second import",create) == "conflict"
        done = edit("app:a",1,"done",sub="leaf",value=True)
        assert batch("bulk",[done,edit("study:b",0,"delete")]) == "conflict"
        assert read("app:a") == (1,payload)
        assert batch("bulk",[done,edit("study:b",1,"delete")]) == "applied"
        assert read("study:b") is None
        assert batch("stale create",[create[1]]) == "conflict"
        assert batch("restore",[edit("study:b",2,"restore")]) == "applied"
        assert read("study:b") == (3,payload)
        deletes = [edit("app:a",2,"delete"),edit("study:b",3,"delete")]
        assert batch("close",deletes[:1],True) == "conflict"
        assert read("app:a")[0] == 2
        assert batch("close",deletes,True) == "applied"
        assert batch("close",deletes,True) == "replayed"
        assert batch("late import",create) == "deleted"
        assert not admin.execute("""select has_function_privilege('wf_demo_cc',
            'wf_demo.batch(text,text,jsonb,boolean)','execute')""").fetchone()[0]
    print("PASS atomic bulk rollback, import replay, tombstone restore and closed board fence")


def check_branch_restore(admin, connect):
    owner = "00000000-0000-4000-8000-000000000001"
    tasks = [
        {"id":"parent","done":True},{"id":"branch","parentId":"parent","archived":True},
        {"id":"leaf","parentId":"branch","done":False,"history":[1,2],"src":"rm"},
        {"id":"separate","parentId":"branch","archived":True,"done":False}
    ]
    admin.execute("insert into wf_demo.entries(owner_id,board,item,revision,payload) values(%s,'archive','entry',1,%s)",
                  (owner,json.dumps({"notes":"keep","subtasks":tasks})))
    with connect("wf_demo_gateway") as db, request(db,json.dumps({"sub":owner})):
        def edit(op, base, sub, value):
            return db.execute("select * from wf_demo.apply('archive','entry',%s,%s,'archived',%s,%s)",
                              (op,base,sub,value)).fetchone()
        assert edit("hidden",1,"separate",False) == ("blocked",1)
        assert edit("restore",1,"branch",False) == ("applied",2)
        assert edit("restore",1,"branch",False) == ("replayed",2)
        assert edit("stale",1,"branch",True) == ("conflict",2)
        data = db.execute("select payload from wf_demo.read_entry('archive','entry')").fetchone()[0]
        parent, branch, leaf, separate = data["subtasks"]
        assert not parent["done"] and not branch["archived"]
        assert leaf == tasks[2] and separate == tasks[3] and data["notes"]=="keep"
        assert edit("hide",2,"branch",True) == ("applied",3)
    print("PASS branch restoration reopens ancestors, preserves history and nested archives")


def check_repeat(admin, connect):
    owner = "00000000-0000-4000-8000-000000000001"
    tasks = [{"id":"a","t":"Read","done":True,"history":[123],"rv":"keep"},
             {"id":"b","t":"Write","done":True}]
    def seed(item, **overrides):
        payload = dict(repeatChecklist=True, notes="keep", subtasks=tasks)
        payload.update(overrides)
        admin.execute("insert into wf_demo.entries(owner_id,board,item,revision,payload) values(%s,'repeat',%s,1,%s)",
                      (owner,item,json.dumps(payload)))
    seed("sample")
    hidden = {"id":"keep","parentId":"hidden","done":True,"u":4}
    seed("tree", subtasks=[dict(tasks[0],parentId="branch"),dict(tasks[1],parentId="branch"),
                          {"id":"branch","parentId":"root","done":True},{"id":"root","done":True},
                          {"id":"hidden","parentId":"root","archived":True},hidden])
    seed("loop", subtasks=[dict(tasks[0],parentId="b"),dict(tasks[1],parentId="a")])
    seed("orphan", subtasks=[dict(tasks[0],parentId="missing")])
    for item, overrides in [
        ("ordinary", {"repeatChecklist":False}), ("empty", {"subtasks":[]}),
        ("archived", {"subtasks":[dict(tasks[0], archived=True)]}),
        ("shared", {"subtasks":[dict(tasks[0], src="rm")]}),
        ("duplicate", {"subtasks":tasks[:1]*2}), ("history", {"checklistRuns":{}}),
    ]:
        seed(item, **overrides)
    with connect("wf_demo_gateway") as db, request(db,json.dumps({"sub":owner})):
        def reset(item, op, base):
            return db.execute("select * from wf_demo.apply('repeat',%s,%s,%s,'nextRun',null,true)",
                              (item,op,base)).fetchone()
        for item in ["loop","orphan","ordinary","empty","archived","shared","duplicate","history"]:
            assert reset(item,"try",1) == ("blocked",1)
        def toggle(task, base, value):
            return db.execute("select * from wf_demo.apply('repeat','tree',%s,%s,'done',%s,%s)",
                              (task+str(base),base,task,value)).fetchone()
        def read_tree():
            return db.execute("select payload from wf_demo.read_entry('repeat','tree')").fetchone()[0]
        assert toggle("a",1,False) == ("applied",2)
        assert [n["done"] for n in read_tree()["subtasks"][:4]] == [False,True,False,False]
        assert toggle("branch",2,True) == ("blocked",2)
        assert toggle("keep",2,False) == ("blocked",2)
        for base, key in enumerate(["a","branch","root"],2):
            assert reset("tree","early",base) == ("blocked",base)
            assert toggle(key,base,True) == ("applied",base+1)
        assert reset("tree","again",5) == ("applied",6)
        assert reset("tree","again",5) == ("replayed",6)
        tree = read_tree()
        assert tree["checklistRuns"][0]["completedTasks"] == [{"id":"a","text":"Read"},{"id":"b","text":"Write"}]
        assert all(not n["done"] for n in tree["subtasks"][:4])
        assert tree["subtasks"][4:] == [{"id":"hidden","parentId":"root","archived":True},hidden]
        assert reset("sample","one",1) == ("applied",2)
        assert reset("sample","one",1) == ("replayed",2)
        assert reset("sample","other-device",1) == ("conflict",2)
        assert reset("sample","premature",2) == ("blocked",2)
        for base, task in enumerate(tasks,2):
            assert db.execute("select * from wf_demo.apply('repeat','sample',%s,%s,'done',%s,true)",
                              ("finish-"+task["id"],base,task["id"])).fetchone() == ("applied",base+1)
        assert reset("sample","two",4) == ("applied",5)
        payload = db.execute("select payload from wf_demo.read_entry('repeat','sample')").fetchone()[0]
        assert [run["id"] for run in payload["checklistRuns"]] == ["one","two"]
        for run in payload["checklistRuns"]:
            assert run["completedTasks"] == [{"id":t["id"],"text":t["t"]} for t in tasks]
        for current, original in zip(payload["subtasks"],tasks):
            assert current == dict(original,done=False,u=current["u"])
        assert payload["notes"] == "keep"
    print("PASS recurring checklist history across two runs, retries and stale devices")
