"""Hosted-style authorization checks using synthetic data and real sessions."""
from contextlib import contextmanager
from pathlib import Path
import json

from psycopg import sql
from psycopg.errors import InsufficientPrivilege


@contextmanager
def request(gateway, claims):
    with gateway.transaction():
        gateway.execute("set local role wf_demo_authenticated")
        if claims is not None:
            gateway.execute("select set_config('request.jwt.claims',%s,true)", (claims,))
        yield gateway


def check_permissions(admin, connect, cc, pwd, apply):
    admin.execute(Path(__file__).with_name("permissions.sql").read_text())
    admin.execute(sql.SQL("alter role wf_demo_gateway password {}").format(sql.Literal(pwd)))
    first, second = [f"00000000-0000-4000-8000-{n:012d}" for n in (1, 2)]
    for owner in (first, second):
        admin.execute("""insert into wf_demo.entries values (%s,'board','entry',0,
            jsonb_build_object('notes',%s::text,'ccActive',false,
            'subtasks','[{"id":"leaf","done":false}]'::jsonb))""", (owner,owner))
    admin.execute("""insert into wf_demo.entries select owner_id,board,'private',revision,payload
                     from wf_demo.entries where owner_id=%s""", (second,))

    read = "select revision,payload from wf_demo.read_entry('board','entry')"
    with connect("wf_demo_gateway") as gateway:
        for owner in (first, second):
            with request(gateway, json.dumps({"sub": owner})) as client:
                assert client.execute(read).fetchone()[1]["notes"] == owner
                assert apply(client, "shared-id", 0, True) == ("applied", 1)
                assert apply(client, "cc", 1, True, "ccActive", None) == ("refused", None)
        with request(gateway, json.dumps({"sub": first})) as client:
            assert not client.execute(read.replace("'entry'", "'private'")).fetchall()
            assert client.execute("""select * from wf_demo.apply('board','private','op',0,
                                   'done','leaf',true)""").fetchone() == ("missing", None)
        for claims in (None, "{}", '{"sub":"invalid"}', "invalid-json"):
            with request(gateway, claims) as client:
                assert not client.execute(read).fetchall()
                assert apply(client, "missing-actor", 1, False) == ("refused", None)
    print("PASS two owners, isolated receipts, private item, pooled session claim reset")

    assert apply(cc, "reflect", 1, True, "ccActive", None) == ("applied", 2)
    assert apply(cc, "wrong-field", 2, False) == ("refused", None)
    assert admin.execute("""select owner_id,revision,payload->'ccActive' from wf_demo.entries
                         where owner_id in (%s,%s) and item='entry' order by owner_id""",
                         (first, second)).fetchall() == [(first, 2, True), (second, 1, False)]
    try:
        cc.execute(read)
    except InsufficientPrivilege:
        pass
    else:
        raise AssertionError("bridge could read the full entry")

    write_rpc = "wf_demo.apply(text,text,text,bigint,text,text,boolean)"
    read_rpc = "wf_demo.read_entry(text,text)"
    for role in ("wf_demo_anon", "wf_demo_gateway", "wf_demo_phone", "wf_demo_pc",
                 "wf_demo_cc", "wf_demo_authenticated"):
        rights = admin.execute("""select has_function_privilege(%s,%s,'execute'),
                              has_function_privilege(%s,%s,'execute')""",
                              (role,write_rpc,role,read_rpc)).fetchone()
        assert rights == (role in ("wf_demo_cc", "wf_demo_authenticated"),
                          role == "wf_demo_authenticated")
    for role in ("wf_demo_anon", "wf_demo_authenticated", "wf_demo_cc", "wf_demo_gateway",
                 "wf_demo_phone", "wf_demo_pc"):
        for table in ("actors", "entries", "receipts"):
            assert not admin.execute("""select has_table_privilege(%s,%s,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')""",
                (role, "wf_demo." + table)).fetchone()[0]
        assert not admin.execute("select has_function_privilege(%s,'wf_demo.actor()','execute')",
                                 (role,)).fetchone()[0]
    print("PASS bridge field and owner restrictions, private tables and actor resolver")
