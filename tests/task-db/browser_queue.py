"""Run Chromium's real localStorage/Web Locks against the disposable database."""
from pathlib import Path
import json
import os

from playwright.sync_api import sync_playwright
from permissions import request


def check_browser_queue(connect):
    module = Path(__file__).resolve().parents[2] / "js/wf-revision-outbox.mjs"
    owner = "00000000-0000-4000-8000-000000000002"
    with connect("wf_demo_gateway") as db, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM_BIN"),
                                     args=["--no-sandbox"])
        def device():
            context = browser.new_context()
            def route(r):
                if r.request.url.endswith(".mjs"):
                    return r.fulfill(content_type="text/javascript", body=module.read_bytes())
                r.fulfill(content_type="text/html", body="<title>Queue fixture</title>")
            context.route("http://localhost/**", route)
            page = context.new_page()
            def send(op):
                assert op["owner"] == owner and op["board"] == "board"
                with request(db, json.dumps({"sub": owner})):
                    status, version = db.execute("select * from wf_demo.apply(%s,%s,%s,%s,'done','leaf',%s)",
                        (op["board"], op["item"], op["id"], op["base"], op["intent"]["done"])).fetchone()
                return {"status": status, "version": version}
            page.expose_function("send", send)
            page.goto("http://localhost/")
            return page

        def boot(page):
            page.evaluate("""async owner => {
                const {openTaskOutbox} = await import('/queue.mjs');
                window.q = openTaskOutbox(owner, 'board', async op => {
                    const reply = await send(op);
                    if (window.drop) throw Error('lost response');
                    return reply;
                });
            }""", owner)

        pc, phone = device(), device()
        for page in (pc, phone):
            boot(page)
            page.evaluate("q.observe('entry', 1, {done:true})")
        pc.evaluate("q.enqueue('entry', 1, {done:true})")
        phone.evaluate("q.enqueue('entry', 1, {done:false})")
        phone.evaluate("q.flush()")
        pc.reload()
        boot(pc)
        pc.evaluate("q.observe('entry', 2, {done:false})")
        pc.evaluate("q.flush()")
        state = pc.evaluate("q.inspect()")
        assert state["operations"][0]["reason"] == "conflict"
        assert state["operations"][0]["base"] == 1 and state["snapshots"][0]["revision"] == 2
        op = pc.evaluate("q.enqueue('entry', 2, {done:true})")
        assert pc.evaluate("async () => {window.drop=true;try{await q.flush()}catch(e){return e.message}}") == "lost response"
        pc.reload()
        boot(pc)
        assert pc.evaluate("q.inspect()")["operations"][1]["id"] == op
        pc.evaluate("q.flush()")
        legacy = {"entry:app:old": {"table":"weekly_focus_entries","row":{
            "board_id":"board","item_key":"app:old","payload":{"notes":"keep"}}}}
        for _ in range(2):
            pc.evaluate("rows => q.preserveLegacy(rows)", legacy)
        pc.evaluate("q.flush()")
        drafts = pc.evaluate("q.inspect()")["operations"]
        assert [r["status"] for r in drafts] == ["review", "legacy-draft"]
        assert drafts[1]["intent"] == legacy["entry:app:old"]
        with request(db, json.dumps({"sub":owner})):
            revision, payload = db.execute("select * from wf_demo.read_entry('board','entry')").fetchone()
        assert revision == 3 and payload["subtasks"][0]["done"]
        from pilot import check_pilot, check_shared_writers
        check_shared_writers(connect)
        check_pilot(connect, browser)
        browser.close()
        print("PASS Chromium two-device conflict, reload, lost reply, replay and legacy draft")
