"""Serve a fixed synthetic board on loopback. Exposes no arbitrary SQL or data."""
from contextlib import contextmanager, nullcontext
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
from threading import Thread
from urllib.parse import urlsplit
from uuid import uuid4

from permissions import request

ROOT = Path(__file__).resolve().parents[2]
OWNER = "00000000-0000-4000-8000-000000000001"
ITEM = "app:pilot"
BOARD = "pilot"


@contextmanager
def serve(connect, port=0):
    instance = str(uuid4())
    payload = {"repeatChecklist":True,"active":True,"notes":"Synthetic test board","ccActive":False,
               "subtasks":[{"id":"leaf","t":"Review the sample checklist","done":False,"parentId":"review"},
                          {"id":"review","t":"Weekly review","done":False},
                          {"id":"saved","t":"Archived idea","parentId":"review","archived":True}]}
    with connect("fixture_admin") as admin:
        admin.execute("insert into wf_demo.entries(owner_id,board,item,revision,payload) values(%s,%s,%s,1,%s)",
                      (OWNER,BOARD,ITEM,json.dumps(payload)))
    shell = (ROOT / "index.html").read_text()
    allowed = {"wf-login.js","wf-task-data.js","wf-task-engine.js","weekly-focus-app.js",
               "wf-detail-ui.js","wf-sphere-draft.js","wf-revision-outbox.mjs"}
    shell = re.sub(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*></script>',
                   lambda m: m[0] if Path(urlsplit(m[1]).path).name in allowed else "",shell)
    shell = shell.replace('<script defer src="js/wf-detail-ui', '<script type="module" src="/pilot.mjs"></script>\n<script defer src="js/wf-detail-ui')
    toolbar = """<aside id="pilot-tools" style="position:fixed;bottom:0;left:0;z-index:2147483647;background:white;
        color:black;padding:.4rem;max-width:100%;border:1px solid #999;font:14px system-ui">
        <b>Sync preview</b> <output id="pilot-status" aria-live="polite">Connecting…</output>
        <label><input type="checkbox" id="pilot-offline">Pause sync</label>
        <button id="pilot-open">Open sample task</button><button id="pilot-refresh">Sync now</button>
        <button id="pilot-next" disabled>Start next checklist</button>
        <output id="pilot-history"></output>
        <span hidden id="pilot-review"><button data-choice="keep">Keep saved task</button>
        <button data-choice="retry">Apply my edit</button></span></aside>"""
    shell = re.sub(r"<body\b([^>]*)>",lambda m:f'<body{m[1]} data-pilot="{instance}">'+toolbar,shell,count=1)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass

        def send(self, data, mime):
            self.send_response(200)
            self.send_header("Content-Type",mime)
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'; "
                             "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def host_ok(self):
            return self.headers.get("Host") in (f"localhost:{self.server.server_port}",
                                               f"127.0.0.1:{self.server.server_port}")

        def do_GET(self):
            if not self.host_ok(): return self.send_error(403)
            path = urlsplit(self.path).path
            if path == "/": return self.send(shell.encode(),"text/html; charset=utf-8")
            if path == "/pilot/entry":
                with connect("wf_demo_gateway") as db, request(db,json.dumps({"sub":OWNER})):
                    revision, data = db.execute("select * from wf_demo.read_entry(%s,%s)",(BOARD,ITEM)).fetchone()
                return self.send(json.dumps(dict(revision=revision,payload=data)).encode(),"application/json")
            if path == "/pilot.mjs": file = Path(__file__).with_name("pilot.mjs")
            elif path in {"/js/"+name for name in allowed}: file = ROOT / path[1:]
            elif re.fullmatch(r"/(?:css/[\w-]+\.css|icons/[\w-]+\.png)",path): file = ROOT / path[1:]
            else: return self.send_error(404)
            if not file.is_file(): return self.send_error(404)
            self.send(file.read_bytes(), "text/javascript" if file.suffix in (".js",".mjs") else mimetypes.guess_type(file)[0])

        def do_POST(self):
            if not self.host_ok() or self.headers.get("Origin") != "http://"+self.headers["Host"]:
                return self.send_error(403)
            if self.path != "/pilot/commit": return self.send_error(404)
            try:
                size=int(self.headers.get("Content-Length",0))
                if not 0<size<=8192: return self.send_error(400)
                op=json.loads(self.rfile.read(size))
                intent=op["intent"]
                if (op["owner"]!=instance or op["board"]!=BOARD or op["item"]!=ITEM or
                    not ((intent["field"] in ("done","archived") and isinstance(intent["sub"],str))
                         or (intent["field"]=="nextRun" and intent["sub"] is None and intent["value"] is True)) or type(intent["value"]) is not bool or
                    type(op["base"]) is not int or not isinstance(op["id"],str)):
                    return self.send_error(400)
            except (KeyError,TypeError,ValueError): return self.send_error(400)
            with connect("wf_demo_gateway") as db, request(db,json.dumps({"sub":OWNER})):
                status,version=db.execute("select * from wf_demo.apply(%s,%s,%s,%s,%s,%s,%s)",
                    (BOARD,ITEM,op["id"],op["base"],intent["field"],intent["sub"],intent["value"])).fetchone()
            self.send(json.dumps(dict(status=status,version=version)).encode(),"application/json")
    with ThreadingHTTPServer(("127.0.0.1",port),Handler) as server:
        thread=Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try: yield f"http://localhost:{server.server_port}"
        finally: server.shutdown(); thread.join()


def check_pilot(connect, browser):
    with serve(connect) as url:
        devices=[]
        for width in (1280,390):
            context=browser.new_context(viewport={"width":width,"height":800})
            page=context.new_page()
            page.goto(url)
            page.get_by_text("Synced · revision 1",exact=True).wait_for()
            page.locator("#pilot-open").click()
            devices.append((context,page))
        def toggle(page):
            page.locator('#bsBody [data-act="subtoggle"]').first.click()
        parent = '#bsBody [data-sid="review"] [data-act="subtoggle"]'
        assert devices[0][1].locator(parent).is_disabled()
        revision=1
        for local, remote in (devices,devices[::-1]):
            ctx,page=local
            _,phone=remote
            ctx.set_offline(True)
            toggle(page)
            page.get_by_text("Edit saved on this device.",exact=True).wait_for()
            toggle(phone)
            phone.get_by_text(f"Synced · revision {revision+1}",exact=True).wait_for()
            toggle(phone)
            revision+=2
            phone.get_by_text(f"Synced · revision {revision}",exact=True).wait_for()
            ctx.set_offline(False)
            page.get_by_text("Review needed. Saved task: open. Your edit: complete.",exact=True).wait_for()
            assert " on" not in page.locator('#bsBody [data-act="subtoggle"]').first.get_attribute("class")
            if ctx == devices[1][0]:
                page.get_by_role("button",name="Apply my edit").click()
                revision+=1
                page.get_by_text(f"Synced · revision {revision}",exact=True).wait_for()
                assert " on" in page.locator('#bsBody [data-act="subtoggle"]').first.get_attribute("class")
                phone.locator("#pilot-refresh").click()
                phone.get_by_text(f"Synced · revision {revision}",exact=True).wait_for()
                assert " on" in phone.locator('#bsBody [data-act="subtoggle"]').first.get_attribute("class")
                continue
            page.get_by_role("button",name="Keep saved task").click()
            page.get_by_text(f"Synced · revision {revision}",exact=True).wait_for()
        page = devices[0][1]
        for action in ("Archive","Restore"):
            panel = page.locator("#bsBody details").filter(has=page.get_by_text("Archive / restore tasks",exact=True))
            leaf_button = panel.locator('[data-archive-id="leaf"]')
            if not leaf_button.is_visible():
                panel.locator("summary").click()
            assert leaf_button.inner_text() == action
            leaf_button.click()
            revision += 1
            page.get_by_text(f"Synced · revision {revision}",exact=True).wait_for()
            assert page.locator('#bsBody [data-act="subtoggle"]').count() == (1 if action=="Archive" else 2)
        assert page.locator("#pilot-next").is_disabled()
        page.locator(parent).click()
        revision += 1
        page.get_by_text(f"Synced · revision {revision}",exact=True).wait_for()
        page.get_by_role("button",name="Start next checklist").click()
        revision += 1
        page.get_by_text(f"Synced · revision {revision}",exact=True).wait_for()
        other = devices[1][1]
        other.locator("#pilot-refresh").click()
        for device in (page,other):
            device.get_by_text("1 finished run · last run 1 of 1 complete",exact=True).wait_for()
            assert device.locator(parent).is_disabled()
            assert device.locator("#pilot-next").is_disabled()
            assert " on" not in device.locator('#bsBody [data-act="subtoggle"]').first.get_attribute("class")
        for ctx,_ in devices: ctx.close()
    print("PASS real Weekly Focus checklist: offline conflict and review in both directions")


def check_shared_writers(connect):
    import subprocess
    with connect("fixture_admin") as admin:
        admin.execute("""insert into wf_demo.entries(owner_id,board,item,revision,payload)
            values(%s,'shared',%s,1,'{"ccActive":false,"subtasks":[{"id":"leaf","done":false}]}')""",
                      (OWNER,ITEM))
    with subprocess.Popen(["node", str(Path(__file__).with_name("bridge_session.mjs"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as proc:
        try:
            for line in proc.stdout:
                msg=json.loads(line)
                method=msg["method"]
                if method=="read":
                    with connect("wf_demo_gateway") as db, request(db,json.dumps({"sub":OWNER})):
                        revision,payload=db.execute("select * from wf_demo.read_entry('shared',%s)",(ITEM,)).fetchone()
                    result=dict(revision=revision,payload=payload)
                else:
                    assert method in ("wf","cc")
                    op=msg["args"]
                    intent=op["intent"]
                    with connect("wf_demo_cc" if method=="cc" else "wf_demo_gateway") as db:
                        with request(db,json.dumps({"sub":OWNER})) if method=="wf" else nullcontext():
                            status,version=db.execute("select * from wf_demo.apply(%s,%s,%s,%s,%s,%s,%s)",
                                (op["board"],op["item"],op["id"],op["base"],intent["field"],intent["sub"],intent["value"])).fetchone()
                    result=dict(status=status,version=version)
                proc.stdin.write(json.dumps(result)+"\n")
                proc.stdin.flush()
        finally:
            proc.stdin.close()
        assert proc.wait(timeout=10)==0
    print("PASS Roadmap acknowledgment and replay, trusted CC flag update through PostgreSQL")
