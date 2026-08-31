

def test_credentials_can_be_checked_without_mailing_anyone():
    """The alternative is finding out they are wrong by sending a real
    merchant a real email during a demo."""
    from doctor.outreach import verify

    r = verify()
    assert r.sent is False, "verify must never send"
    assert r.detail


def test_an_unconfigured_install_says_what_to_set():
    import os

    from doctor.outreach import verify

    saved = {k: os.environ.pop(k, None) for k in
             ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD")}
    try:
        r = verify()
        assert r.configured is False
        for key in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"):
            assert key in r.detail
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


def test_gmails_rejection_is_translated_into_the_fix():
    """535 5.7.8 is the commonest failure here and the raw string is a wall
    of numbers at exactly the moment someone is trying to fix it."""
    from doctor.outreach import _explain

    err = Exception(
        "(535, b'5.7.8 Username and Password not accepted. For more "
        "information, go to https://support.google.com/mail/?p=BadCredentials')"
    )
    msg = _explain(err)
    assert "App Password" in msg
    assert "apppasswords" in msg


def test_an_unknown_failure_is_not_swallowed():
    """A translated message must never hide a cause nobody anticipated."""
    from doctor.outreach import _explain

    msg = _explain(ValueError("something nobody predicted"))
    assert "something nobody predicted" in msg
    assert "ValueError" in msg


def test_sending_never_invents_a_success():
    """A send that failed must not report as sent -- this one goes to a real
    merchant's inbox."""
    import inspect

    from doctor import outreach

    src = inspect.getsource(outreach.send)
    assert "sent=True" in src
    assert src.count("sent=True") == 1, "only the success path may claim it sent"
