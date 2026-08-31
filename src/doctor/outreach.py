"""The email an account manager would actually send, generated from the run.

This is not a chatbot bolted on. It is the last mile of the same pipeline: a
diagnosis nobody reads is worth nothing, and the thing that gets read is a
short email with one number and one action.

Composed DETERMINISTICALLY from the report rather than by a model. Every figure
is copied from a field, so the email cannot invent a statistic, drift from the
diagnosis, or quote a number the decomposition does not support -- which is
exactly the failure mode that would be fatal in a project about honest
measurement. The model already did its work upstream; this is formatting.

Two safeguards worth naming:
  * factors the overlap check rejected are never mentioned as causes
  * projected figures are labelled in the body, not just in the UI
"""

from __future__ import annotations

import os
import re

from pydantic import BaseModel

FACTOR_LABEL = {
    "bank": "the mix of banks your customers pay from",
    "hour": "when your payments are charged",
    "amount_band": "how your high-value payments are routed",
    "method": "which payment methods you default to",
    "process_gap": "recoverable failures that were never retried",
}

FACTOR_FIX = {
    "bank": "enable multi-bank routing so failures stop concentrating on one issuer",
    "hour": "move the recurring charge out of the 23:00–06:00 window",
    "amount_band": "route high-ticket payments separately and retry them on a longer horizon",
    "method": "add a fallback rail at checkout for the methods that underperform",
    "process_gap": "turn on automatic retries for recoverable declines",
}


class Email(BaseModel):
    to_name: str
    subject: str
    body: str
    #: Rendered separately so the UI can show what is safe to promise.
    headline_inr: int
    is_projected: bool = True


def _inr(paise: int) -> str:
    return "Rs " + format(paise // 100, ",d")


def compose(rec: dict) -> Email:
    r = rec["report"]
    m, p, d = r["measured"], r["projected"], r["decomposition"]
    name = rec["merchant_name"]

    identified = [f for f in d["factors"] if f["identified"] and f["points"] > 0]
    top = max(identified, key=lambda f: f["points"], default=None)
    use_process = d["process_gap_pts"] > (top["points"] if top else 0)
    key = "process_gap" if use_process else (top["factor"] if top else None)

    lines: list[str] = []
    lines.append("Hi %s team," % name)
    lines.append("")

    healthy = p["gap_pts"] < 0.75 or key is None
    if healthy:
        lines.append(
            "We ran a diagnostic across your %s payments this month. Your success "
            "rate of %.2f%% is in line with what merchants in your category "
            "achieve (%.2f%%), so there is nothing we would ask you to change "
            "right now."
            % (format(m["transactions"], ",d"), m["observed_success_pct"],
               p["cohort_achievable_pct"])
        )
        lines.append("")
        lines.append(
            "We will keep monitoring and only get in touch when something moves."
        )
    else:
        lines.append(
            "We ran a diagnostic across your %s payments this month. Your success "
            "rate is %.2f%%. Merchants in your category are achieving %.2f%%."
            % (format(m["transactions"], ",d"), m["observed_success_pct"],
               p["cohort_achievable_pct"])
        )
        lines.append("")
        lines.append(
            "That %.2f point gap is worth about %s a month at your current volume."
            % (p["gap_pts"], _inr(p["gap_value_paise"]))
        )
        lines.append("")
        lines.append("What is causing it")
        lines.append("")
        pts = d["process_gap_pts"] if use_process else top["points"]
        lines.append(
            "  The largest single cause is %s, worth %.2f points of the gap."
            % (FACTOR_LABEL.get(key, key), pts)
        )
        if not use_process and top.get("mae"):
            lines.append(
                "  Our own measured error on this factor is +/- %.2f points, so "
                "this is a signal we are confident enough to act on."
                % top["mae"]
            )
        lines.append("")
        lines.append("  What we suggest: %s." % FACTOR_FIX.get(key, "review the routing"))
        lines.append("")

        auto = [g for g in (rec.get("pending_actions") or []) if g.get("auto")]
        if auto:
            lines.append("What we can do for you today")
            lines.append("")
            for g in auto[:3]:
                lines.append("  - %s" % g["title"])
            lines.append("")
            lines.append(
                "  These stay inside the limits on your signed authorisation, and "
                "every action is recorded in an audit trail you can inspect."
            )
            lines.append("")

        if p["unrecoverable_count"]:
            lines.append(
                "Being straight with you: %s across %d payments is not recoverable "
                "by any retry -- expired cards and closed accounts. We have listed "
                "each one rather than leaving it out of the numbers."
                % (_inr(p["unrecoverable_paise"]), p["unrecoverable_count"])
            )
            lines.append("")

        lines.append(
            "The recovery figures above are projected from a model of how often a "
            "retry converts, not observed outcomes. The success-rate gap itself is "
            "measured from your own transactions."
        )

    lines.append("")
    lines.append("Happy to walk through the full breakdown whenever suits.")
    lines.append("")
    lines.append("Revenue Doctor")
    lines.append("run %s - reproducible from the audit trail" % rec["run_id"])

    subject = (
        "%s: payment success is on track" % name
        if healthy
        else "%s: %s/month recoverable on payment failures" % (
            name, _inr(p["gap_value_paise"])
        )
    )

    return Email(
        to_name=name,
        subject=subject,
        body="\n".join(lines),
        headline_inr=p["gap_value_paise"] // 100,
    )


class SendResult(BaseModel):
    sent: bool
    detail: str
    configured: bool


#: A Gmail App Password as Google displays it: sixteen lowercase letters
#: shown in four groups of four. It is presented WITH spaces and accepted
#: WITHOUT them, so copying what is on the screen produces a credential the
#: server refuses -- and the refusal it produces is identical to the one a
#: genuinely wrong password gives.
_APP_PASSWORD = re.compile(r"^[a-z]{16}$")


def _password() -> str:
    """The configured password, de-spaced only when that is unambiguous.

    Whitespace is not stripped from passwords in general -- a password may
    legitimately contain a space, and quietly altering one would be a way to
    fail that is very hard to see. It is stripped only when what remains is
    exactly Google's App Password shape, which is a format their own UI hands
    you with spaces in it.
    """
    raw = os.environ.get("SMTP_PASSWORD", "")
    squashed = "".join(raw.split())
    return squashed if _APP_PASSWORD.match(squashed) else raw


def smtp_configured() -> bool:
    import os

    return bool(
        os.environ.get("SMTP_HOST")
        and os.environ.get("SMTP_USER")
        and os.environ.get("SMTP_PASSWORD")
    )


#: Providers phrase failure in their own dialect, and the raw string is a
#: wall of numbers at the moment someone is trying to fix it. These are the
#: three that actually happen with Gmail, translated into the thing to do.
def _explain(err: Exception) -> str:
    raw = str(err)
    low = raw.lower()
    if "5.7.8" in raw or "username and password not accepted" in low:
        return (
            "Gmail rejected the credentials. With 2-Step Verification on, "
            "SMTP_PASSWORD must be a 16-character App Password from "
            "myaccount.google.com/apppasswords -- your normal account "
            "password will always be refused here."
        )
    if "5.5.1" in raw and "authentication required" in low:
        return "The server wants authentication before it will accept mail. Check SMTP_USER."
    if "application-specific password required" in low:
        return (
            "This account has 2-Step Verification on and needs an App Password. "
            "Generate one at myaccount.google.com/apppasswords."
        )
    if isinstance(err, (TimeoutError, OSError)) and "timed out" in low:
        return (
            "Could not reach the mail server. Check SMTP_HOST and SMTP_PORT, "
            "and whether outbound port 587 is open on this network."
        )
    return "%s: %s" % (type(err).__name__, raw[:200])


def verify() -> SendResult:
    """Prove the credentials work without mailing anyone.

    Worth its own path: the alternative is finding out they are wrong by
    sending a real merchant a real email during a demo, and the failure a
    typo produces looks identical to the failure a missing App Password
    produces unless something says which it was.
    """
    import os
    import smtplib

    if not smtp_configured():
        return SendResult(
            sent=False, configured=False,
            detail="SMTP is not configured. Set SMTP_HOST, SMTP_PORT, "
            "SMTP_USER and SMTP_PASSWORD in .env, then restart the API.",
        )
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    try:
        with smtplib.SMTP(host, port, timeout=20) as srv:
            srv.starttls()
            srv.login(os.environ["SMTP_USER"], _password())
    except Exception as e:
        return SendResult(sent=False, configured=True, detail=_explain(e))
    return SendResult(
        sent=False, configured=True,
        detail="Signed in to %s as %s. Nothing was sent."
        % (host, os.environ["SMTP_USER"]),
    )


def send(email: Email, to_addr: str) -> SendResult:
    """Actually send, if SMTP credentials are configured.

    Opt-in and off by default. Nothing about this project needs to hold a mail
    credential to be demonstrated -- the .eml download and the pre-filled Gmail
    compose window do the same job without one -- so an unconfigured install
    says so plainly rather than pretending to have sent.

    App-password SMTP rather than an OAuth flow on purpose: an auth redirect is
    one more thing that can fail in front of an audience, for no additional
    capability.
    """
    import os
    import smtplib
    from email.message import EmailMessage

    if not smtp_configured():
        return SendResult(
            sent=False,
            configured=False,
            detail="SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER "
            "and SMTP_PASSWORD to enable sending; until then use the .eml "
            "download or the Gmail compose link.",
        )
    if not to_addr or "@" not in to_addr:
        return SendResult(sent=False, configured=True, detail="No valid recipient.")

    msg = EmailMessage()
    msg["Subject"] = email.subject
    msg["From"] = os.environ["SMTP_USER"]
    msg["To"] = to_addr
    msg.set_content(email.body)

    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    try:
        with smtplib.SMTP(host, port, timeout=20) as srv:
            srv.starttls()
            srv.login(os.environ["SMTP_USER"], _password())
            srv.send_message(msg)
    except Exception as e:  # surface the real reason, do not swallow it
        return SendResult(sent=False, configured=True, detail=_explain(e))
    return SendResult(sent=True, configured=True, detail="Sent to %s" % to_addr)


def as_eml(email: Email, to_addr: str = "") -> str:
    """RFC-822 so it opens in any mail client. Nothing is sent from here.

    Sending would need credentials this project deliberately does not hold --
    the same principle as the agent never holding the merchant's signing key.
    """
    return "\r\n".join(
        [
            "To: %s" % (to_addr or "merchant@example.com"),
            "Subject: %s" % email.subject,
            "X-Generated-By: Revenue Doctor",
            "Content-Type: text/plain; charset=utf-8",
            "",
            email.body,
        ]
    )
