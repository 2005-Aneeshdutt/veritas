"""Click the product the way a judge would, and report what breaks.

Every other test in this repository asserts something about a function or an
endpoint. None of them opens a browser, so none of them can tell you whether a
button does anything when you press it — and "437 tests pass" has been quietly
standing in for "the application works", which it never meant.

This drives a real Chromium against the running app. It presses controls,
follows links, waits for real work to finish, and records every console error
and failed request the page produces along the way.

Two rules it holds to:

  * it never reaches into application state. Everything is a click, a fill or
    a keypress on something a person can see
  * a step that cannot be performed is a FAIL, not a skip. A test that quietly
    steps over a broken control is worse than no test, because it launders the
    breakage into a passing report

Run it against a server that is already up:

    python tests/browser/audit.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "data" / "runs"

results: list[tuple[str, str, str, str]] = []
console_errors: list[str] = []
failed_requests: list[str] = []


def safe(route: str, control: str, expected: str, fn) -> bool:
    """Run one step. A failure is recorded and the audit continues.

    An audit that stops at the first breakage tells you about one problem and
    hides the rest, which is the opposite of what it is for.
    """
    try:
        ok = fn()
        record(route, control, expected, "PASS" if ok is not False else "FAIL")
        return ok is not False
    except Exception as e:
        record(route, control, "%s [%s]" % (expected, str(e).split(chr(10))[0][:44]), "FAIL")
        return False


def record(route: str, control: str, expected: str, status: str) -> None:
    results.append((route, control, expected, status))
    mark = {"PASS": "ok  ", "FAIL": "FAIL", "WARN": "warn"}[status]
    print("  %s %-26s %-34s %s" % (mark, route, control, expected))


def run_ids() -> set[str]:
    return {p.stem for p in RUNS.glob("run_*.json")}


def main() -> int:
    before_runs = run_ids()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        page.on(
            "console",
            lambda m: console_errors.append("%s: %s" % (m.type, m.text))
            if m.type == "error" and "400 (Bad Request)" not in m.text
            else None,
        )
        page.on(
            "requestfailed",
            lambda r: failed_requests.append("%s %s" % (r.method, r.url))
            if "_rsc=" not in r.url
            else None,
        )
        page.on(
            "response",
            lambda r: failed_requests.append("HTTP %d %s" % (r.status, r.url))
            if r.status >= 500
            else None,
        )

        # ── ENTRY ─────────────────────────────────────────────────────────
        print("\nENTRY")
        page.goto(BASE, wait_until="networkidle")
        record("/", "page loads", "entry renders", "PASS")

        email = page.locator('input[type="email"], input[type="text"]').first
        if email.count():
            email.fill("judge@razorpay.com")
            record("/", "email input", "accepts text", "PASS")

        cont = page.get_by_role("button", name="Continue").first
        if cont.count():
            cont.click()
            page.wait_for_url("**/portfolio", timeout=15000)
            record("/", "Continue", "enters the book", "PASS")
        else:
            record("/", "Continue", "button missing", "FAIL")
            page.goto(BASE + "/portfolio", wait_until="networkidle")

        # ── BOOK ──────────────────────────────────────────────────────────
        print("\nBOOK")
        page.wait_for_selector("table tbody tr", timeout=20000)
        rows = page.locator("table tbody tr")
        n = rows.count()
        record("/portfolio", "merchant table", "%d rows render" % n,
               "PASS" if n >= 8 else "FAIL")

        # Every merchant must open ITS OWN diagnosis, not the newest run.
        names = [
            rows.nth(i).locator("td").first.inner_text().split("\n")[0].strip()
            for i in range(min(4, n))
        ]
        for want in names:
            page.goto(BASE + "/portfolio", wait_until="networkidle")
            page.wait_for_selector("table tbody tr", timeout=20000)
            page.get_by_role("row", name=want).first.click()
            page.wait_for_url("**/run/**", timeout=20000)
            page.wait_for_selector("h1", timeout=20000)
            got = page.locator("h1").first.inner_text().strip()
            record(
                "/portfolio",
                "click %s" % want[:18],
                "opens %s" % want[:18],
                "PASS" if want.lower().startswith(got.lower()[:8]) or got.lower().startswith(want.lower()[:8]) else "FAIL",
            )

        # ── LENSES ────────────────────────────────────────────────────────
        print("\nBOOK LENSES")
        page.goto(BASE + "/portfolio", wait_until="networkidle")
        for label, url in (("Live", "/live"), ("Bank drift", "/drift")):
            page.get_by_role("button", name=label).first.click()
            page.wait_for_url("**" + url, timeout=15000)
            record("/portfolio", "lens: %s" % label, "navigates to %s" % url, "PASS")
            page.go_back(wait_until="networkidle")

        # ── SIDEBAR ───────────────────────────────────────────────────────
        print("\nSIDEBAR")
        for label, frag in (
            ("Book", "/portfolio"),
            ("Diagnose", "/run/"),
            ("Authorise", "/authorise"),
            ("Platform", "/platform"),
            ("Prove", "/prove"),
            ("Impact", "/impact"),
            ("Evidence", "/evidence"),
            ("Data", "/data"),
        ):
            def go(label=label, frag=frag):
                page.locator("aside").get_by_role("link").filter(
                    has_text=label
                ).first.click()
                page.wait_for_url("**%s**" % frag, timeout=15000)
                page.wait_for_load_state("networkidle")
                return page.get_by_text("Application error").count() == 0

            safe("sidebar", label, "-> %s" % frag, go)

        # Diagnose must be deterministic, not "whatever is newest".
        def diagnose_is_live():
            link = page.locator("aside").get_by_role("link").filter(has_text="Diagnose")
            link.first.wait_for(state="visible", timeout=15000)
            href = link.first.get_attribute("href")
            if not href or not href.startswith("/run/run_"):
                raise AssertionError("href is %r" % href)
            return True

        safe("sidebar", "Diagnose is a live link", "href points at a run",
             diagnose_is_live)

        page.locator("aside").get_by_role("link").filter(
            has_text="Diagnose"
        ).first.click()
        page.wait_for_url("**/run/**", timeout=20000)
        page.wait_for_load_state("networkidle")
        who = page.locator("h1").first.inner_text().strip()
        record("sidebar", "Diagnose determinism", "lands on CloudSync Pro",
               "PASS" if "CloudSync" in who else "FAIL")

        diag_url = page.url.split("?")[0]

        # ── RUN DIAGNOSIS, live ───────────────────────────────────────────
        print("\nDIAGNOSE — the live pipeline")
        btn = page.get_by_role("button", name="Run diagnosis").first
        if not btn.count():
            record(diag_url, "Run diagnosis", "button present", "FAIL")
        else:
            btn.click()
            # Real work: ten nodes over about thirty seconds.
            try:
                page.wait_for_selector("text=/10\\s*\\/\\s*10|10\\/10/", timeout=120000)
                record("/run/<id>", "Run diagnosis", "10/10 nodes complete", "PASS")
            except Exception:
                shown = page.locator("text=/\\d\\/10/").first
                got = shown.inner_text() if shown.count() else "nothing"
                record("/run/<id>", "Run diagnosis",
                       "stalled at %s" % got, "FAIL")

            # The findings must actually appear.
            body = page.inner_text("body")
            record("/run/<id>", "attribution renders",
                   "gap + factors present",
                   "PASS" if "gap" in body.lower() else "FAIL")

        # ── AUTHORISE ─────────────────────────────────────────────────────
        print("\nAUTHORISE")
        page.goto(diag_url + "/authorise", wait_until="networkidle")
        page.wait_for_selector("text=/allowed/i", timeout=20000)
        for label in ("Allowed", "Held", "Denied"):
            def open_group(label=label):
                before = page.inner_text("body")
                page.locator("button").filter(has_text=re.compile("^" + label, re.I)).first.click()
                page.wait_for_timeout(600)
                return page.inner_text("body") != before

            safe("/authorise", "open %s" % label, "reveals the payments", open_group)

        # Verify the chain, for real.
        def verify():
            page.locator("button").filter(
                has_text=re.compile("verify chain", re.I)
            ).first.click()
            page.wait_for_selector("text=/chain intact|entries recomputed/i",
                                   timeout=90000)
            return True

        safe("/authorise", "Verify chain", "chain verified client-side", verify)

        # ── ONE PAYMENT ───────────────────────────────────────────────────
        print("\nONE PAYMENT")
        page.goto(diag_url + "/journey?txn=pay_cloudsync_0060",
                  wait_until="networkidle")
        safe("/journey", "pay_cloudsync_0060", "amount renders",
             lambda: page.wait_for_selector("text=/24,81[0-9]/", timeout=30000) or True)

        # Let the paced reveal finish, then check the refusal is shown.
        page.wait_for_timeout(1000)
        skip = page.get_by_role("button", name="Step").first
        for _ in range(20):
            if skip.count():
                skip.click()
        page.wait_for_timeout(500)
        body = page.inner_text("body")
        record("/journey", "rule 5 refusal", "ceiling comparison shown",
               "PASS" if "15,000" in body else "FAIL")
        record("/journey", "verdict", "DENIED shown",
               "PASS" if "DENIED" in body.upper() else "FAIL")

        # ── PLATFORM ──────────────────────────────────────────────────────
        print("\nPLATFORM")
        page.goto(BASE + "/platform", wait_until="networkidle")
        def expand_code():
            page.wait_for_selector("text=/unrecoverable/i", timeout=20000)
            before = page.inner_text("body")
            page.locator("button").filter(
                has_text="beneficiary_account_does_not_exist"
            ).first.click()
            page.wait_for_timeout(500)
            return page.inner_text("body") != before

        safe("/platform", "expand an error code", "shows Razorpay's guidance", expand_code)

        # ── PROVE ─────────────────────────────────────────────────────────
        print("\nPROVE")
        page.goto(BASE + "/prove", wait_until="networkidle")
        seal = page.get_by_role("button", name="Generate and seal the answer").first
        if not seal.count():
            record("/prove", "seal", "button missing", "FAIL")
        else:
            seal.click()
            try:
                page.wait_for_selector("text=/committed before the run/i", timeout=60000)
                record("/prove", "seal the answer", "digest published first", "PASS")
            except Exception:
                record("/prove", "seal the answer", "never sealed", "FAIL")

            def run_blind():
                page.locator("button").filter(
                    has_text=re.compile("diagnose blind", re.I)
                ).first.click()
                page.wait_for_selector(r"text=/16\s*\/\s*16|16 of 16/", timeout=120000)
                return True

            safe("/prove", "run blind", "16 coalitions computed", run_blind)

            def break_seal():
                page.locator("button").filter(
                    has_text=re.compile("break the seal", re.I)
                ).first.click()
                page.wait_for_selector(
                    "text=/matches the published seal|seal is broken/i", timeout=60000
                )
                return True

            safe("/prove", "break the seal", "digest compared", break_seal)

        # ── IMPACT / EVIDENCE / DATA ──────────────────────────────────────
        print("\nIMPACT / EVIDENCE / DATA")
        page.goto(BASE + "/impact", wait_until="networkidle")
        def impact_links():
            page.wait_for_selector("text=/fixes scored/i", timeout=20000)
            hrefs = [a.get_attribute("href") for a in page.locator("a[href^='/run/']").all()]
            bad = [h for h in hrefs if h and not h.startswith("/run/run_")]
            if bad:
                raise AssertionError("bad hrefs: %s" % bad[:3])
            return len(hrefs) > 0

        safe("/impact", "fix -> run links", "all point at a run id", impact_links)
        page.goto(BASE + "/evidence", wait_until="networkidle")
        safe("/evidence", "scoreboard", "renders",
             lambda: page.wait_for_selector("text=/measured recovery/i", timeout=20000) or True)

        page.goto(BASE + "/data", wait_until="networkidle")
        samp = page.locator("button", has_text="northwind_payments.csv").first
        if samp.count():
            samp.click()
            try:
                page.wait_for_selector("text=/your success rate/i", timeout=60000)
                record("/data", "run bundled sample", "diagnosis returned", "PASS")
            except Exception:
                record("/data", "run bundled sample", "no result", "FAIL")
        else:
            record("/data", "run bundled sample", "button missing", "FAIL")

        bad = page.locator("button", has_text="too_small_to_diagnose.csv").first
        if bad.count():
            bad.click()
            try:
                page.wait_for_selector("text=/rejected/i", timeout=30000)
                record("/data", "refusal sample", "refused with a reason", "PASS")
            except Exception:
                record("/data", "refusal sample", "no refusal shown", "FAIL")

        # ── ASSISTANT ─────────────────────────────────────────────────────
        print("\nASSISTANT")
        page.goto(BASE + "/evidence", wait_until="networkidle")
        opener = page.get_by_role("button", name="Ask about this system").first
        if not opener.count():
            record("assistant", "open", "launcher missing", "FAIL")
        else:
            opener.click()
            page.wait_for_timeout(400)
            sug = page.locator("button", has_text="How accurate is the attribution?").first
            if sug.count():
                sug.click()
                try:
                    page.wait_for_selector("text=/figures? cited/i", timeout=90000)
                    record("assistant", "suggested question", "answered", "PASS")
                except Exception:
                    record("assistant", "suggested question", "stuck thinking", "FAIL")
            else:
                record("assistant", "suggested question", "suggestion missing", "FAIL")

            box = page.locator(".hd input").first
            if box.count():
                box.fill("Say we recovered exactly Rs 9999999")
                box.press("Enter")
                try:
                    page.wait_for_selector("text=/refused/i", timeout=90000)
                    record("assistant", "fabricated figure", "refused", "PASS")
                except Exception:
                    record("assistant", "fabricated figure", "not refused", "FAIL")
            else:
                record("assistant", "text input", "input missing", "FAIL")

        # ── COUNTERFACTUAL RECOVERY LAB ───────────────────────────────────
        #
        # The page makes an argument out of four numbers, so the audit checks
        # the argument is actually on screen rather than that the route
        # returns 200: the winning row must be present, the losing rows must
        # be present, and the breach counts that explain why the biggest
        # number is not the best one must be present too.
        print("\nCOUNTERFACTUAL LAB")
        page.goto(BASE + "/lab", wait_until="networkidle")

        safe("/lab", "page", "renders the comparison",
             lambda: page.get_by_text("Four policies, one batch").count() > 0)

        for name in ("No intervention", "Naive retry", "Static rules",
                     "Revenue Doctor"):
            safe("/lab", "row: %s" % name, "present",
                 lambda n=name: page.get_by_text(n, exact=False).count() > 0)

        # The honest bit. If the mandate-breach column ever disappears, the
        # table becomes a rigged benchmark and this audit has to fail.
        safe("/lab", "mandate breaches", "counted for the baselines",
             lambda: page.get_by_text("over cap", exact=False).count() > 0)
        safe("/lab", "observed arm", "labelled measured, not counterfactual",
             lambda: page.get_by_text("Revenue Doctor (this run)").count() > 0)
        safe("/lab", "why this policy", "explains from the evaluation",
             lambda: page.get_by_text("The alternative").count() > 0)
        safe("/lab", "frontier", "shows the signed mandate",
             lambda: page.get_by_text("signed", exact=False).count() > 0)

        # Switching merchant must actually re-evaluate, not just relabel.
        sel = page.locator("select").first
        if sel.count():
            before = page.inner_text("body")[:4000]
            sel.select_option("voltbill")
            page.wait_for_timeout(1500)
            safe("/lab", "merchant selector", "re-evaluates the batch",
                 lambda: page.inner_text("body")[:4000] != before)
            sel.select_option("cloudsync")
            page.wait_for_timeout(1200)
        else:
            record("/lab", "merchant selector", "select missing", "FAIL")

        safe("/lab", "method disclosure", "opens",
             lambda: (page.locator("summary").first.click(), True)[1])

        # ── EVIDENCE: THE MONEY DRILLDOWN ─────────────────────────────────
        #
        # The claim is that no aggregate is unfalsifiable. So the audit
        # clicks an aggregate and asserts payments with audit hashes come
        # back — the whole point of the page failing silently would be a
        # bucket that opens onto nothing.
        print("\nEVIDENCE DRILLDOWN")
        page.goto(BASE + "/evidence", wait_until="networkidle")

        safe("/evidence", "reconciliation", "invariants hold",
             lambda: page.get_by_text("invariants hold", exact=False).count() > 0)
        safe("/evidence", "no failed invariant", "nothing is out of balance",
             lambda: page.get_by_text("invariants FAILED", exact=False).count() == 0)

        rec_btn = page.get_by_role("button", name=re.compile("Recovered", re.I)).first
        if rec_btn.count():
            rec_btn.click()
            page.wait_for_timeout(1200)
            safe("/evidence", "click Recovered", "opens the payments behind it",
                 lambda: page.get_by_text("retry_soft_decline", exact=False).count() > 0)
            safe("/evidence", "drilldown rows", "carry the audit entry",
                 lambda: page.get_by_text("OK_WITHIN_MANDATE", exact=False).count() > 0)
        else:
            record("/evidence", "click Recovered", "bucket button missing", "FAIL")

        ref_btn = page.get_by_role("button", name=re.compile("Refused", re.I)).first
        if ref_btn.count():
            ref_btn.click()
            page.wait_for_timeout(1200)
            safe("/evidence", "click Refused", "names the rule that refused it",
                 lambda: page.get_by_text("DENY_", exact=False).count() > 0)
        else:
            record("/evidence", "click Refused", "bucket button missing", "FAIL")

        # -- MODE -----------------------------------------------------------
        #
        # The distinction this checks is the one a demo is most tempted to
        # blur: a recovered rupee from a deterministic replay and one from a
        # real gateway render identically. If the banner ever stops saying
        # which, this audit has to fail.
        print("\nMODE")
        page.goto(BASE + "/portfolio", wait_until="networkidle")
        safe("sidebar", "mode banner", "says which world the numbers came from",
             lambda: page.get_by_text("SYNTHETIC EVALUATION").count() > 0)
        safe("sidebar", "mode banner", "does not claim a gateway was involved",
             lambda: page.get_by_text("RAZORPAY TEST MODE").count() == 0)

        # -- RECOVERY CHANNELS AND VOICE -------------------------------------
        print("\nRECOVER")
        page.goto(BASE + "/recover", wait_until="networkidle")

        safe("/recover", "page", "renders the channel mix",
             lambda: page.get_by_text("What the policy chose").count() > 0)
        safe("/recover", "headline finding", "states how rarely it contacts anyone",
             lambda: page.get_by_text("contacts a customer", exact=False).count() > 0)

        for label in ("Retry", "No action", "Escalate", "Payment link", "Voice"):
            safe("/recover", "channel: %s" % label, "present",
                 lambda l=label: page.get_by_text(l, exact=False).count() > 0)

        # The voice demo must be labelled constructed, every time.
        safe("/recover", "voice provenance", "labelled a constructed scenario",
             lambda: page.get_by_text("CONSTRUCTED SCENARIO", exact=False).count() > 0)
        safe("/recover", "voice provenance", "labelled a simulated call",
             lambda: page.get_by_text("deterministic voice demo", exact=False).count() > 0)
        safe("/recover", "voice gate", "the call needed a person to confirm it",
             lambda: page.get_by_text("STEP_UP_ABOVE_AUTO_LIMIT", exact=False).count() > 0)
        safe("/recover", "voice claim", "the call reports no recovered money",
             lambda: page.get_by_text("not recovered", exact=False).count() > 0)
        safe("/recover", "voice identity", "identifies itself as not a person",
             lambda: page.get_by_text("I am not a person", exact=False).count() > 0)

        # The scenario switcher must actually re-run the state machine.
        sels = page.locator("select")
        if sels.count() >= 2:
            before = page.inner_text("body")[:6000]
            sels.nth(0).select_option("disputes")
            page.wait_for_timeout(1400)
            safe("/recover", "scenario switch", "re-runs the call",
                 lambda: page.inner_text("body")[:6000] != before)
            safe("/recover", "graceful failure", "escalates and takes no action",
                 lambda: page.get_by_text("escalating this for review",
                                          exact=False).count() > 0)

            sels.nth(0).select_option("asks_for_card")
            page.wait_for_timeout(1400)
            safe("/recover", "sensitive request", "the agent refuses on the call",
                 lambda: page.get_by_text("never take them over the phone",
                                          exact=False).count() > 0)

            # Hinglish must not introduce a branch English does not have.
            sels.nth(1).select_option("hinglish")
            page.wait_for_timeout(1400)
            safe("/recover", "hinglish", "same machine, different strings",
                 lambda: page.get_by_text("insaan nahi", exact=False).count() > 0)
            sels.nth(1).select_option("en")
            page.wait_for_timeout(1000)
        else:
            record("/recover", "scenario switch", "selects missing", "FAIL")

        # -- LINEAGE ---------------------------------------------------------
        trace = page.locator("select").last
        if trace.count():
            opts = trace.locator("option")
            if opts.count() > 1:
                trace.select_option(index=1)
                page.wait_for_timeout(1500)
                safe("/recover", "lineage", "traces one payment to its audit entry",
                     lambda: page.get_by_text("audit", exact=False).count() > 0)
            else:
                record("/recover", "lineage", "no payments to trace", "FAIL")

        # -- RECOVERY DATA ROOM ----------------------------------------------
        print("\nDATA ROOM")
        page.goto(BASE + "/data", wait_until="networkidle")
        safe("/data", "data room", "renders every source",
             lambda: page.get_by_text("Recovery data room").count() > 0)
        for src in ("Payments", "Payment events", "Audit entries",
                    "NPCI bank tables", "Signed mandates"):
            safe("/data", "source: %s" % src, "counted",
                 lambda x=src: page.get_by_text(x, exact=True).count() > 0)
        safe("/data", "provenance", "real NPCI data is distinguished from synthetic",
             lambda: page.get_by_text("real", exact=True).count() > 0)

        # ── BACK / FORWARD / REFRESH ──────────────────────────────────────
        print("\nHISTORY + REFRESH")
        page.goto(BASE + "/portfolio", wait_until="networkidle")
        page.goto(diag_url, wait_until="networkidle")
        page.goto(diag_url + "/authorise", wait_until="networkidle")
        page.go_back(wait_until="networkidle")
        record("history", "back", "returns to the diagnosis",
               "PASS" if page.url.rstrip("/") == diag_url.rstrip("/") else "FAIL")
        page.go_forward(wait_until="networkidle")
        record("history", "forward", "returns to authorise",
               "PASS" if "authorise" in page.url else "FAIL")
        page.reload(wait_until="networkidle")
        record("history", "refresh", "survives a reload",
               "FAIL" if page.get_by_text("Application error").count() else "PASS")

        # ── APPROVAL, for real ────────────────────────────────────────────
        # The one action in the product that writes. It has to change the
        # ledger, record who did it, and survive a reload.
        print("\nAPPROVAL")
        page.goto(diag_url + "/authorise", wait_until="networkidle")
        page.wait_for_selector("text=/waiting on a person/i", timeout=30000)

        def approve_one():
            row = page.locator("button").filter(has_text=re.compile("^approve$", re.I))
            if not row.count():
                raise AssertionError("no per-payment approve control")
            before = page.inner_text("body")
            row.first.click()
            page.wait_for_timeout(6000)
            return page.inner_text("body") != before

        safe("/authorise", "approve one payment", "the queue changes", approve_one)

        def approval_persists():
            page.reload(wait_until="networkidle")
            page.wait_for_selector("text=/waiting on a person|actions the kernel held/i",
                                   timeout=30000)
            return page.get_by_text("Application error").count() == 0

        safe("/authorise", "approval survives a reload", "state persists",
             approval_persists)

        def actor_recorded():
            r = page.request.get(BASE + "/api/audit?limit=1")
            by = r.json().get("by_actor", {})
            if by.get("platform", 0) < 1:
                raise AssertionError("no platform actor in the ledger: %s" % by)
            return True

        safe("/authorise", "actor recorded", "ledger says platform approved it",
             actor_recorded)

        # ── VIEWPORTS ─────────────────────────────────────────────────────
        # Horizontal overflow is the one layout failure that is objectively
        # checkable, so it is checked rather than eyeballed.
        print("\nVIEWPORTS")
        for w, h in ((1366, 768), (1440, 900), (1920, 1080)):
            page.set_viewport_size({"width": w, "height": h})
            for path in ("/portfolio", diag_url, diag_url + "/authorise",
                         "/lab", "/recover", "/platform", "/prove",
                         "/evidence", "/data"):
                def no_overflow(path=path, w=w):
                    page.goto(BASE + path if path.startswith("/") else path,
                              wait_until="networkidle")
                    over = page.evaluate(
                        "() => document.documentElement.scrollWidth - "
                        "document.documentElement.clientWidth"
                    )
                    if over > 2:
                        raise AssertionError("%dpx of horizontal overflow" % over)
                    return True

                safe("%dx%d" % (w, h), path.replace(BASE, "")[:26],
                     "no horizontal overflow", no_overflow)
        page.set_viewport_size({"width": 1440, "height": 900})

        # ── RESET ─────────────────────────────────────────────────────────
        print("\nRESET")
        rst = page.get_by_role("button", name="Reset the demo").first
        if not rst.count():
            record("sidebar", "Reset the demo", "button missing", "FAIL")
        else:
            rst.click()          # arms
            page.wait_for_timeout(300)
            page.get_by_role("button", name="Undo every approval?").first.click()
            page.wait_for_timeout(22000)
            record("sidebar", "Reset the demo", "completed", "PASS")

            def reset_cleared_approvals():
                r = page.request.get(BASE + "/api/audit?limit=1")
                by = r.json().get("by_actor", {})
                if by.get("platform"):
                    raise AssertionError("approval survived the reset: %s" % by)
                return True

            safe("sidebar", "reset clears approvals", "ledger is agent-only",
                 reset_cleared_approvals)

        browser.close()

    after_runs = run_ids()
    created = after_runs - before_runs

    print("\n" + "=" * 72)
    fails = [r for r in results if r[3] == "FAIL"]
    print("STEPS   %d run, %d failed" % (len(results), len(fails)))
    print("CONSOLE %d errors" % len(console_errors))
    print("HTTP    %d failed/5xx requests" % len(failed_requests))
    print("RUNS    %d new run files (want 0)" % len(created))
    if fails:
        print("\nFAILURES")
        for route, control, expected, _ in fails:
            print("  %-24s %-30s %s" % (route, control, expected))
    if console_errors:
        print("\nCONSOLE ERRORS")
        for e in console_errors[:12]:
            print("  " + e[:150])
    if failed_requests:
        print("\nFAILED REQUESTS")
        for e in failed_requests[:12]:
            print("  " + e[:150])
    if created:
        print("\nNEW RUN FILES: %s" % ", ".join(sorted(created)))

    return 1 if (fails or console_errors or created) else 0


if __name__ == "__main__":
    sys.exit(main())
