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
