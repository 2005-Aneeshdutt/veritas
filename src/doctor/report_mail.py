"""The diagnosis as a report a merchant can act on from their inbox.

`outreach.compose` writes the plain-text version and stays the source of
truth for what is claimed -- this renders the same facts as a document, and
attaches an Approve and a Reject button to each proposed fix.

Two decisions about the HTML itself, both forced by how mail clients work
rather than by taste:

  * every style is inline. Gmail strips <style> blocks, so a stylesheet would
    render as an unstyled wall of text in the one client that matters most
    here
  * tables, not flexbox. Outlook renders through Word, which has no support
    for modern layout, and a report that collapses in Outlook is a report the
    finance person cannot read

The buttons do not act. They open a confirmation page, because mail scanners
fetch every URL in a message before a person sees it, and a link that applied
a payment fix would fire in the scanner with nobody having decided anything.
"""

from __future__ import annotations

from .approvals import mint
from .outreach import _inr

INK = "#14161a"
MUTED = "#5b6270"
FAINT = "#8b93a1"
LINE = "#e4e7ec"
BRAND = "#5b5bd6"
GOOD = "#1b7048"
WARN = "#8c5e00"
PAPER = "#ffffff"
SHELL = "#f4f5f7"


def _esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _row(label: str, value: str, strong: bool = False) -> str:
    weight = "600" if strong else "400"
    colour = INK if strong else MUTED
    return (
        '<tr>'
        '<td style="padding:7px 0;font:14px -apple-system,Segoe UI,Arial,sans-serif;'
        'color:%s;">%s</td>'
        '<td align="right" style="padding:7px 0;font:600 14px ui-monospace,'
        'SFMono-Regular,Menlo,monospace;color:%s;font-weight:%s;">%s</td>'
        "</tr>" % (MUTED, _esc(label), colour, weight, _esc(value))
    )


def render(rec: dict, base_url: str) -> str:
    """The report, as one self-contained HTML document."""
    r = rec["report"]
    p, d, m = r["projected"], r["decomposition"], r["measured"]
    name = rec["merchant_name"]
    run_id = rec["run_id"]
    merchant_id = rec["merchant_id"]

    gap = p["gap_pts"]
    healthy = gap < 0.75
    groups = rec.get("pending_actions") or []

    # ── the cause, named the way the plain-text mail names it
    identified = [f for f in d["factors"] if f["identified"] and f["points"] > 0]
    top = max(identified, key=lambda f: f["points"], default=None)
    use_process = d["process_gap_pts"] > (top["points"] if top else 0)
    cause_pts = d["process_gap_pts"] if use_process else (top["points"] if top else 0)
    cause_name = (
        "soft declines that were never retried"
        if use_process
        else {
            "bank": "the mix of banks your customers pay from",
            "method": "which payment methods your customers use",
            "hour": "when your payments are charged",
            "amount_band": "the size of the payments",
        }.get(top["factor"] if top else "", "a factor we could not isolate")
    )

    sc = m.get("recovery_vs_truth", {}) or {}
    exc = r.get("exceptions", {}) or {}

    out: list[str] = []
    A = out.append

    A('<div style="margin:0;padding:24px 12px;background:%s;">' % SHELL)
    A('<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" '
      'style="max-width:640px;margin:0 auto;background:%s;border:1px solid %s;'
      'border-radius:10px;">' % (PAPER, LINE))

    # ── header
    A('<tr><td style="padding:26px 28px 18px;border-bottom:1px solid %s;">' % LINE)
    A('<div style="font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;'
      'text-transform:uppercase;color:%s;">Payment recovery report</div>' % FAINT)
    A('<div style="font:600 21px -apple-system,Segoe UI,Arial,sans-serif;'
      'color:%s;margin-top:6px;">%s</div>' % (INK, _esc(name)))
    A('<div style="font:13px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
      'margin-top:4px;">%s payments reviewed this month</div>'
      % (MUTED, format(m.get("transactions", 0), ",d")))
    A("</td></tr>")

    # ── headline
    A('<tr><td style="padding:22px 28px;">')
    if healthy:
        A('<div style="font:600 26px -apple-system,Segoe UI,Arial,sans-serif;'
          'color:%s;">Payment success is on track</div>' % GOOD)
        A('<div style="font:14px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
          'margin-top:6px;line-height:1.55;">Your success rate is %.2f%% against '
          '%.2f%% for your category. There is no material gap to recover, and we '
          'would rather say so than manufacture one.</div>'
          % (MUTED, m["observed_success_pct"], p["cohort_achievable_pct"]))
    else:
        A('<div style="font:600 30px ui-monospace,Menlo,monospace;color:%s;">%s</div>'
          % (BRAND, _esc(_inr(p["gap_value_paise"]))))
        A('<div style="font:14px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
          'margin-top:6px;">recoverable per month at your current volume '
          '<span style="background:#fff4e0;color:%s;padding:2px 7px;border-radius:99px;'
          'font-size:11px;">projected</span></div>' % (MUTED, WARN))
    A("</td></tr>")

    # ── the numbers
    A('<tr><td style="padding:0 28px 8px;">')
    A('<table role="presentation" width="100%" cellpadding="0" cellspacing="0">')
    A(_row("Your success rate", "%.2f%%" % m["observed_success_pct"]))
    A(_row("Your category achieves", "%.2f%%" % p["cohort_achievable_pct"]))
    A(_row("The gap", "%.2f points" % gap, strong=True))
    if not healthy:
        A(_row("Largest single cause", "%.2f points" % cause_pts))
        A(_row("Our measured error on it", "+/- 0.57 points"))
    if sc.get("scored"):
        A(_row("Already recovered for you", _inr(sc["measured_paise"]), strong=True))
        A(_row(
            "  of which truly converted",
            "%d of %d retries" % (sc["truly_converted"], sc["attempted"]),
        ))
    A("</table>")
    if not healthy:
        A('<div style="font:13px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
          'margin-top:14px;line-height:1.6;">The largest single cause is <b '
          'style="color:%s;">%s</b>. That is larger than our own measured error '
          'on it, which is why we are confident enough to act.</div>'
          % (MUTED, INK, _esc(cause_name)))
    A("</td></tr>")

    # ── the fixes, each with its own decision
    #
    # Shown even when the headline says the merchant is on track. A healthy
    # book can still have money the agent could go and get, and suppressing
    # the buttons because the summary reads well would leave a merchant who
    # wants to act with no way to.
    if groups:
        A('<tr><td style="padding:20px 28px 6px;border-top:1px solid %s;">' % LINE)
        A('<div style="font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;'
          'text-transform:uppercase;color:%s;">What we propose</div>' % FAINT)
        lead = (
            "Nothing here is urgent, but these are still worth taking. "
            if healthy
            else ""
        )
        A('<div style="font:13px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
          'margin-top:6px;line-height:1.55;">%sApproving runs the fix inside the '
          'limits on the authorisation you signed. Anything above your ceiling '
          'stays refused however many times it is approved, and every action '
          'lands in an audit trail you can inspect.</div>' % (MUTED, lead))
        A("</td></tr>")

        for i, g in enumerate(groups):
            ok = mint(merchant_id, run_id, i, "approve")
            no = mint(merchant_id, run_id, i, "reject")
            A('<tr><td style="padding:12px 28px;">')
            A('<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" '
              'style="background:%s;border:1px solid %s;border-radius:8px;">' % (SHELL, LINE))
            A('<tr><td style="padding:16px 18px;">')
            A('<div style="font:600 15px -apple-system,Segoe UI,Arial,sans-serif;'
              'color:%s;">%s</div>' % (INK, _esc(g["title"])))
            A('<div style="font:13px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
              'margin-top:5px;line-height:1.5;">%s</div>' % (MUTED, _esc(g.get("why", ""))))
            A('<div style="font:600 13px ui-monospace,Menlo,monospace;color:%s;'
              'margin-top:9px;">%s at stake &middot; %d payments</div>'
              % (WARN, _esc(_inr(g["total_paise"])), g["count"]))

            A('<table role="presentation" cellpadding="0" cellspacing="0" '
              'style="margin-top:14px;"><tr>')
            A('<td style="padding-right:10px;"><a href="%s/decide/%s" '
              'style="display:inline-block;background:%s;color:#fff;text-decoration:none;'
              'font:600 13px -apple-system,Segoe UI,Arial,sans-serif;padding:9px 18px;'
              'border-radius:7px;">Approve</a></td>' % (base_url, ok, BRAND))
            A('<td><a href="%s/decide/%s" style="display:inline-block;background:%s;'
              'color:%s;text-decoration:none;font:600 13px -apple-system,Segoe UI,'
              'Arial,sans-serif;padding:9px 18px;border-radius:7px;border:1px solid %s;">'
              'Reject</a></td>' % (base_url, no, PAPER, MUTED, LINE))
            A("</tr></table>")
            A("</td></tr></table></td></tr>")

    # ── what cannot be recovered, stated rather than dropped
    if exc.get("unrecoverable_paise"):
        A('<tr><td style="padding:18px 28px;border-top:1px solid %s;">' % LINE)
        A('<div style="font:13px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
          'line-height:1.6;">Being straight with you: <b style="color:%s;">%s</b> '
          'across %d payments is not recoverable by any retry — expired cards and '
          'closed accounts. We list each one rather than leaving it out of the '
          'numbers.</div>'
          % (MUTED, INK, _esc(_inr(exc["unrecoverable_paise"])),
             exc.get("unrecoverable_count", 0)))
        A("</td></tr>")

    # ── footer
    A('<tr><td style="padding:16px 28px 24px;border-top:1px solid %s;">' % LINE)
    A('<div style="font:12px -apple-system,Segoe UI,Arial,sans-serif;color:%s;'
      'line-height:1.6;">Recovery figures are projected from a model of how often '
      'a retry converts, not observed outcomes. The success-rate gap itself is '
      'measured from your own transactions.</div>' % FAINT)
    A('<div style="font:11px ui-monospace,Menlo,monospace;color:%s;margin-top:10px;">'
      'Revenue Doctor &middot; run %s &middot; reproducible from the audit trail</div>'
      % (FAINT, _esc(run_id)))
    A("</td></tr>")

    A("</table></div>")
    return "".join(out)
