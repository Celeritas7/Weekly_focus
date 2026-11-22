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
