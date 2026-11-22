"""Run with Python 3, psycopg 3 and initdb/pg_ctl on PATH as a non-root user."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
import os
import secrets
import socket
import subprocess
import tempfile
import time

from permissions import check_permissions

import psycopg
from psycopg import sql


def apply(conn, op, base, value, field="done", sub="leaf"):
    return conn.execute("select * from wf_demo.apply('board','entry',%s,%s,%s,%s,%s)",
                        (op, base, field, sub, value)).fetchone()


def race(admin, holder, waiter, attempt):
    # Release only after PostgreSQL itself confirms the waiter is blocked.
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(attempt)
            try:
                limit = time.monotonic() + 4
                while holder.info.backend_pid not in admin.execute(
                    "select pg_blocking_pids(%s)", (waiter.info.backend_pid,)
                ).fetchone()[0]:
                    if time.monotonic() > limit or pending.done():
                        raise AssertionError("expected contention on the same entry")
                    time.sleep(0.02)
            finally:
                holder.commit()
            return pending.result(timeout=5)
    finally:
        holder.rollback()


def check(port, pwd):
    def connect(user):
        return psycopg.connect(host="127.0.0.1", port=port, dbname="postgres",
                               user=user, password=pwd, autocommit=True,
                               options="-c statement_timeout=8000")
    with ExitStack() as stack:
        admin = stack.enter_context(connect("fixture_admin"))
        admin.execute(Path(__file__).with_name("prototype.sql").read_text())
        roles = ["wf_demo_phone", "wf_demo_pc", "wf_demo_cc"]
        for role in roles:
            admin.execute(sql.SQL("alter role {} password {}").format(sql.Identifier(role), sql.Literal(pwd)))
        phone, pc, cc = [stack.enter_context(connect(r)) for r in roles]
        admin.execute("""insert into wf_demo.entries values ('learner','board','entry',8,
          '{"notes":"keep","ccActive":false,"subtasks":[{"id":"leaf","done":false,"src":"origin"}]}')""")
        assert apply(phone, "initial", 8, True) == ("applied", 9)
        phone.autocommit = False
        assert apply(phone, "reopen", 9, False) == ("applied", 10)
        assert race(admin, phone, pc, lambda: apply(pc, "queued", 8, True)) == ("conflict", 10)
        assert apply(pc, "initial", 8, True) == ("replayed", 9)
        assert apply(pc, "initial", 10, True) == ("id-reused", 10)
        assert apply(pc, "legacy", None, True) == ("missing-precondition", None)
        state = "select revision,payload from wf_demo.entries"
        assert admin.execute(state).fetchone()[1]["subtasks"][0]["done"] is False
        print("PASS offline PC conflict, preserved reopen and original receipt after lost acknowledgment")
        assert apply(phone, "next", 10, True) == ("applied", 11)
        assert race(admin, phone, cc, lambda: apply(cc, "reflect", 10, True, "ccActive", None)) == ("conflict", 11)
        assert apply(cc, "reflect-new", 11, True, "ccActive", None) == ("applied", 12)
        assert admin.execute(state).fetchone() == (12, {"notes":"keep","ccActive":True,
                "subtasks":[{"id":"leaf","done":True,"src":"origin"}]})
        assert apply(cc, "wrong-field", 12, False) == ("refused", None)
        print("PASS concurrent CC flag update preserved checklist, provenance and notes")
        assert apply(phone, "abort", 12, False) == ("applied", 13)
        phone.rollback()
        assert apply(pc, "abort", 12, False) == ("applied", 13)
        assert admin.execute("select count(*) from wf_demo.receipts").fetchone() == (5,)
        print("PASS rollback removed both edit and receipt")
        assert apply(phone, "duplicate", 13, True) == ("applied", 14)
        assert race(admin, phone, pc, lambda: apply(pc, "duplicate", 13, True)) == ("replayed", 14)
        assert admin.execute("select count(*) from wf_demo.receipts").fetchone() == (6,)
        print("PASS concurrent duplicate applied once")
        check_permissions(admin, connect, cc, pwd, apply)
        from lifecycle import check_lifecycle
        check_lifecycle(admin, connect)
        if os.getenv("WF_BROWSER_QUEUE") == "1":
            from browser_queue import check_browser_queue
            check_browser_queue(connect)
        if os.getenv("WF_SYNC_PILOT_PORT"):
            from pilot import serve
            with serve(connect, int(os.environ["WF_SYNC_PILOT_PORT"])) as url:
                print("Synthetic Weekly Focus preview:", url, flush=True)
                try:
                    while True: time.sleep(1)
                except KeyboardInterrupt:
                    pass
        print("PostgreSQL", admin.execute("show server_version").fetchone()[0])


def main():
    with tempfile.TemporaryDirectory(prefix="wf-revisions-") as folder:
        root = Path(folder)
        pwd = secrets.token_hex(24)
        password_file = root / "password"
        password_file.write_text(pwd)
        data = str(root / "cluster")
        subprocess.run(["initdb","-D",data,"-U","fixture_admin","-A","scram-sha-256",
                        "--no-locale","--encoding=UTF8","--pwfile",str(password_file)],check=True,stdout=subprocess.DEVNULL)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0))
            port = sock.getsockname()[1]
        ctl = ["pg_ctl","-D",data,"-w"]
        try:
            subprocess.run(ctl+["-l",str(root/"log"),"-o",f"-h 127.0.0.1 -p {port} -c unix_socket_directories=''","start"],check=True)
            check(port,pwd)
            from recovery import rehearse
            rehearse(port, pwd)
        finally:
            if (Path(data)/"postmaster.pid").exists():
                subprocess.run(ctl+["-m","fast","stop"],check=True)
            elif (root/"log").exists():
                print((root/"log").read_text()[-2000:])


if __name__ == "__main__":
    main()
