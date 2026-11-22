"""Restore the disposable fixture archive into a second, empty database."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

import psycopg
from psycopg import sql

from permissions import request


def snapshot(conn):
    tables = ["actors", "entries", "receipts", "batch_receipts", "closed_boards"]
    return {table: conn.execute(sql.SQL(
        "select to_jsonb(t) from wf_demo.{} t order by to_jsonb(t)"
    ).format(sql.Identifier(table))).fetchall() for table in tables}


def rehearse(port, pwd):
    params = dict(host="127.0.0.1", port=port, user="fixture_admin", password=pwd)
    env = dict(os.environ, PGHOST=params["host"], PGPORT=str(port), PGUSER=params["user"],
               PGPASSWORD=pwd)
    with tempfile.TemporaryDirectory() as folder, psycopg.connect(
            **params, dbname="postgres", autocommit=True) as source:
        before = snapshot(source)
        assert all(before.values())
        archive = str(Path(folder) / "fixture.dump")
        subprocess.run(["pg_dump", "-Fc", "-f", archive, "postgres"], env=env, check=True)
        source.execute("create database recovery template template0")
        subprocess.run(["pg_restore", "--exit-on-error", "--single-transaction", "-d",
                        "recovery", archive], env=env, check=True)
        with psycopg.connect(**params, dbname="recovery") as restored:
            assert snapshot(restored) == before
            assert not restored.execute("""select has_table_privilege('wf_demo_authenticated',
                      'wf_demo.entries','UPDATE')""").fetchone()[0]
        params["user"] = "wf_demo_gateway"
        with psycopg.connect(**params, dbname="recovery", autocommit=True) as gateway:
            with request(gateway, json.dumps({"sub":"00000000-0000-4000-8000-000000000001"})):
                assert gateway.execute("""select * from wf_demo.apply('board','entry',
                    'shared-id',0,'done','leaf',true)""").fetchone() == ("replayed",1)
                assert gateway.execute("""select wf_demo.batch('new-board','late','[]',false)"""
                                       ).fetchone()[0] == "deleted"
    print("PASS restore into empty database: fixture rows, receipts, closed boards and permissions")
