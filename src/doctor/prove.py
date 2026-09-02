"""Falsification on demand: you pick the merchant, the answer is sealed first.

The standing objection to every accuracy claim in this project is reasonable:
the validation merchants are synthetic, so how does anyone know the engine
was not tuned until the committed numbers looked good?

This is the answer, and it only works BECAUSE the data is synthetic. A
merchant generated here carries its exact Shapley decomposition, computed
analytically over the true generating distribution before a single payment is
sampled. So the answer exists before the engine sees anything -- which means
it can be committed to, in public, and checked afterwards.

    1. SEAL     you choose the shape of a merchant; it is generated, and the
                SHA-256 of its ground truth is published. The truth itself is
                withheld.
    2. DIAGNOSE the engine runs on the batch alone. It cannot read the truth:
                `blind_batch` is what it is handed, and it carries no
                ground_truth field at all.
    3. REVEAL   the truth is released along with the exact bytes that were
                hashed. Anyone can recompute the digest and confirm it matches
                the one published in step 1.

If the engine is wrong, this says so. That is the point: a demo that cannot
fail proves nothing, and the honest claim here has never been that the
attribution is exact -- it is that the error is about half a point and that
the agent refuses to act inside it.

Nobody holding real merchant data can run this, because nobody knows the real
answer. That is not a weakness of synthetic data; it is the one thing it is
uniquely good for.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any, Sequence

from pydantic import BaseModel

from chitragupta.canonical import canonical_json, sha256_hex

from .features import FACTORS
from .generator import GeneratedMerchant, generate_merchant
from .plan import AUTO_RATIO, WITHHOLD_RATIO

ROOT = Path(__file__).resolve().parents[2]
CHALLENGES = ROOT / "data" / "challenges"

#: What a challenger is allowed to inject. Same vocabulary the validation
#: sweep uses -- offering causes the sweep never covers would be quietly
#: choosing an easier exam.
CAUSES = [
    "bank_concentration",
    "midnight_billing_penalty",
    "amount_band_risk",
    "method_mix_mismatch",
    "no_soft_decline_retry",
]

#: Categories with a real NPCI-backed cohort behind them.
CATEGORIES = [
    {"mcc": "5411", "label": "Grocery"},
    {"mcc": "5814", "label": "Food and beverage"},
    {"mcc": "5912", "label": "Pharmacy"},
    {"mcc": "5651", "label": "Apparel"},
    {"mcc": "4900", "label": "Utilities"},
    {"mcc": "5541", "label": "Fuel"},
]


class Challenge(BaseModel):
    """A sealed problem. Everything here is safe to show before the run."""

    challenge_id: str
    created_at: float
    #: SHA-256 of the canonical ground truth. Published BEFORE the diagnosis.
    seal: str
    #: What the challenger asked for. Not what the answer is.
    spec: dict
    #: Batch-level facts, visible because the engine sees them too.
    observed: dict


class FactorVerdict(BaseModel):
    factor: str
    true_pts: float
    found_pts: float
    error_pts: float
    mae: float | None = None
    #: Did the estimate land inside the error this method reports for itself?
    within_error_bar: bool
    #: What the planner would do with this attribution, by the same ratio rule
    #: it applies in production: above 2x its own error it may act alone,
    #: 1-2x goes to the merchant, below 1x it refuses.
    agent_would: str


class Reveal(BaseModel):
    challenge_id: str
    seal: str
    #: True when the batch is too small for the gap to be resolved four ways.
    #: The interesting demo: a wrong answer the engine had already disowned.
    underpowered: bool = False
    #: The exact bytes that were hashed, so the digest can be recomputed.
    sealed_payload: dict
    seal_verified: bool
    true_primary: str | None
    found_primary: str | None
    primary_correct: bool | None
    factors: list[FactorVerdict]
    worst_error_pts: float
    verdict: str


def _sealed_payload(m: GeneratedMerchant) -> dict:
    """Exactly what gets hashed. Kept minimal so it is easy to re-check by eye."""
    gt = m.ground_truth
    return {
        "merchant_id": m.profile.merchant_id,
        "injected_causes": list(gt.injected_causes),
        "primary_cause": gt.primary_cause,
        "true_attribution": dict(gt.true_attribution),
        "true_process_gap_pts": gt.true_process_gap_pts,
        "s_true": gt.s_true,
        "s_star": gt.s_star,
    }


def new_challenge(
    *,
    mcc: str,
    n_txns: int,
    causes: Sequence[str],
    magnitude_pts: float,
    seed: int,
    rho: float = 0.0,
) -> tuple[Challenge, GeneratedMerchant]:
    """Generate a merchant and publish the hash of its answer.

    The merchant is persisted whole, ground truth included, so `reveal` is
    reading back the same object that was sealed rather than regenerating and
    hoping it matches.
    """
    causes = [c for c in causes if c in CAUSES]
    cid = "chal_%s" % sha256_hex(
        {"mcc": mcc, "n": n_txns, "causes": sorted(causes), "seed": seed,
         "mag": magnitude_pts, "rho": rho}
    )[:12]

    m = generate_merchant(
        merchant_id=cid,
        name="Sealed Challenge",
        mcc=mcc,
        n_txns=n_txns,
        seed=seed,
        causes=causes,
        target_pts={c: magnitude_pts for c in causes},
        rho=rho,
    )

    payload = _sealed_payload(m)
    seal = sha256_hex(payload)

    fails = [t for t in m.transactions if not t.succeeded]
    challenge = Challenge(
        challenge_id=cid,
        created_at=time.time(),
        seal=seal,
        spec={
            "mcc": mcc,
            "category": next(
                (c["label"] for c in CATEGORIES if c["mcc"] == mcc), mcc
            ),
            "n_txns": n_txns,
            # How many causes, but never which. The shape of the exam, not
            # its answers.
            "n_causes": len(causes),
            "magnitude_pts": magnitude_pts,
            "rho": rho,
            "seed": seed,
        },
        observed={
            "transactions": len(m.transactions),
            "failures": len(fails),
            "observed_success_pct": round(
                100 * (len(m.transactions) - len(fails)) / len(m.transactions), 3
            ),
            "at_risk_paise": sum(t.amount_paise for t in fails),
        },
    )

    CHALLENGES.mkdir(parents=True, exist_ok=True)
    (CHALLENGES / (cid + ".json")).write_text(
        json.dumps(
            {
                "challenge": challenge.model_dump(mode="json"),
                "merchant": m.model_dump(mode="json"),
            },
            indent=2,
        ),
        encoding="utf-8",
        newline="\n",
    )
    return challenge, m


def load_challenge(cid: str) -> tuple[Challenge, GeneratedMerchant]:
    p = CHALLENGES / (cid + ".json")
    if not p.exists():
        raise FileNotFoundError("no such challenge: %s" % cid)
    d = json.loads(p.read_text(encoding="utf-8"))
    return (
        Challenge.model_validate(d["challenge"]),
        GeneratedMerchant.model_validate(d["merchant"]),
    )


def blind_batch(m: GeneratedMerchant) -> list:
    """The payments, and nothing else.

    The engine is handed this. There is no ground truth to accidentally read,
    which is a stronger guarantee than promising not to look at one.
    """
    return list(m.transactions)


def _agent_would(pts: float, mae: float | None) -> str:
    """The planner's ratio rule, mirrored so the reveal shows real behaviour."""
    if mae is None or mae <= 0:
        return "no measured error"
    ratio = abs(pts) / mae
    if ratio < WITHHOLD_RATIO:
        return "refuse"
    if ratio < AUTO_RATIO:
        return "ask the merchant"
    return "act alone"


def score(
    m: GeneratedMerchant,
    dec: Any,
    mae_by_factor: dict[str, float] | None = None,
    underpowered: bool = False,
) -> Reveal:
    """Open the envelope and mark the paper."""
    payload = _sealed_payload(m)
    seal = sha256_hex(payload)

    gt = m.ground_truth
    true = gt.true_attribution
    found = dec.by_factor()
    mae = mae_by_factor or {}

    verdicts: list[FactorVerdict] = []
    for f in FACTORS:
        t_pts = float(true.get(f, 0.0))
        f_pts = float(found.get(f, 0.0))
        err = f_pts - t_pts
        bar = mae.get(f)
        verdicts.append(
            FactorVerdict(
                factor=f,
                true_pts=round(t_pts, 4),
                found_pts=round(f_pts, 4),
                error_pts=round(err, 4),
                mae=round(bar, 4) if bar is not None else None,
                within_error_bar=bar is not None and abs(err) <= bar,
                agent_would=_agent_would(f_pts, bar),
            )
        )

    # Only meaningful when something was actually injected -- a merchant with
    # no cause has no primary cause to find, and scoring one would be scoring
    # noise.
    true_primary = (
        max(true, key=lambda k: true[k])
        if any(abs(v) > 1e-9 for v in true.values())
        else None
    )
    found_primary = dec.primary_cause()
    primary_correct = None if true_primary is None else found_primary == true_primary
    worst = max((abs(v.error_pts) for v in verdicts), default=0.0)

    acted = [v.factor for v in verdicts if v.agent_would == "act alone"]
    if primary_correct is None:
        verdict = "Nothing was injected, so there is no primary cause to find."
    elif primary_correct and not underpowered:
        verdict = "Found the injected cause. Worst factor error %.2f points." % worst
    elif primary_correct and underpowered:
        verdict = (
            "Found the injected cause, but this batch is too small to resolve "
            "the gap four ways -- worst error %.2f points against a %.2f point "
            "bar. The engine flagged that itself, and the planner would act "
            "unattended on %s."
            % (worst, max((v.mae or 0) for v in verdicts),
               ", ".join(acted) if acted else "nothing")
        )
    else:
        verdict = (
            "MISSED: the truth was %s, the engine said %s. This is what the "
            "error bar is for -- and on this batch the planner would act "
            "unattended on %s."
            % (true_primary, found_primary,
               ", ".join(acted) if acted else "nothing at all")
        )

    return Reveal(
        challenge_id=m.profile.merchant_id,
        seal=seal,
        underpowered=underpowered,
        sealed_payload=payload,
        seal_verified=seal == sha256_hex(payload),
        true_primary=true_primary,
        found_primary=found_primary,
        primary_correct=primary_correct,
        factors=verdicts,
        worst_error_pts=round(worst, 4),
        verdict=verdict,
    )


def verify_seal(payload: dict, seal: str) -> bool:
    """Recompute the digest. Exposed so a sceptic can call it themselves."""
    return sha256_hex(payload) == seal


def canonical_bytes(payload: dict) -> str:
    """The exact bytes hashed, as text, so the check can be done by hand."""
    return canonical_json(payload).decode("utf-8")

# --------------------------------------------------------------------------
# letting the model set the exam
# --------------------------------------------------------------------------

ADVERSARY_SYSTEM = """You design exams that break a payment-attribution engine.

The engine decomposes a merchant's success-rate gap across four factors using
Shapley values, and reports a measured error of about 0.57 points per factor.
Its published failure list says it misses the primary cause on 2.5% of
merchants, and every one of those misses was an UNDERPOWERED BATCH -- too few
payments for the gap to be resolved four ways.

Design ONE merchant that is most likely to defeat it. You may set:
  n_txns        40 to 8000   (small is harder for it)
  causes        one or more of: bank_concentration, midnight_billing_penalty,
                amount_band_risk, method_mix_mismatch, no_soft_decline_retry
  magnitude_pts 0.3 to 5.0   (near its 0.57 error bar is harder)
  rho           0.0 to 0.8   (correlated causes break the independence
                              assumption its reweighting relies on)

Think about what actually makes attribution hard: too little data, two causes
of nearly equal size so the ranking is a coin flip, and correlation so the
marginal reweighting cannot separate them.

Reply with JSON and nothing else:
{"n_txns": 0, "causes": [], "magnitude_pts": 0.0, "rho": 0.0,
 "reasoning": "one sentence on why this should break it"}
"""


class AdversarialSpec(BaseModel):
    """What the model chose, after clamping to what the generator accepts."""

    n_txns: int
    causes: list[str]
    magnitude_pts: float
    rho: float
    reasoning: str
    #: True when the model asked for something outside the allowed range and
    #: it was clamped rather than honoured.
    clamped: bool = False


def compose_adversarial(client=None) -> AdversarialSpec:
    """Ask the model to design a merchant that defeats the engine.

    Every value is clamped to what the generator accepts. The model is picking
    a point inside a fixed space, not handing over an arbitrary payload -- the
    same containment the planner uses, applied to a different model call.
    """
    from .llm import MODEL_REASONING, LLMClient

    client = client or LLMClient()
    res = client.complete(
        system=ADVERSARY_SYSTEM,
        prompt="Design the exam. Reply with the JSON object only.",
        model=MODEL_REASONING,
        schema_name="adversarial_challenge",
        max_tokens=400,
    )
    d = res.parsed if isinstance(res.parsed, dict) else {}

    # Model-supplied numbers, so they may be NaN or infinite: `json.loads`
    # accepts those tokens and this is a raw dict rather than a validated
    # model. The clamps below happen to survive a NaN today -- `max(0.3, nan)`
    # keeps 0.3 because the comparison is False -- but that is an accident of
    # argument order, not a property, and `int(nan)` raises outright. Made
    # explicit so a reordering cannot quietly turn it into a fail-open.
    def _finite(value, fallback: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return fallback
        return v if math.isfinite(v) else fallback

    raw_n = int(_finite(d.get("n_txns"), 900.0))
    raw_mag = _finite(d.get("magnitude_pts"), 2.0)
    raw_rho = _finite(d.get("rho"), 0.0)
    causes = [c for c in (d.get("causes") or []) if c in CAUSES] or [
        "midnight_billing_penalty"
    ]

    n = max(40, min(raw_n, 8000))
    mag = max(0.3, min(raw_mag, 5.0))
    rho = max(0.0, min(raw_rho, 0.8))

    return AdversarialSpec(
        n_txns=n,
        causes=causes,
        magnitude_pts=round(mag, 2),
        rho=round(rho, 2),
        reasoning=str(d.get("reasoning") or "")[:400],
        clamped=(n, mag, rho) != (raw_n, raw_mag, raw_rho),
    )
