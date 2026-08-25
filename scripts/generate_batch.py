"""Generate the demo merchants and the 200-merchant validation sweep.

Run:
    python scripts/generate_batch.py --demo
    python scripts/generate_batch.py --sweep 200
    python scripts/generate_batch.py --demo --sweep 200 --seed 20260824

Everything is a pure function of --seed (RULE 3). Re-running with the same
seed reproduces byte-identical batches, which is what lets evals/results/ be
committed and checked.

The sweep grid is deliberately wide rather than flattering:
  * injection strength 0.5 -> 5.0 points, so we can see where the estimator
    stops resolving an effect from noise
  * factor correlation rho 0.0 -> 0.8, which is the empirical measurement of
    the independence assumption in shapley.py
  * batch size 60 -> 1200, because at small n the sampling noise on the
    observed success rate is the same order as the effect being attributed,
    and a merchant deserves to be told that
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from doctor.baseline import Baseline  # noqa: E402
from doctor.generator import generate_merchant  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SYNTH = ROOT / "data" / "synthetic"
SWEEP = SYNTH / "validation_sweep"

DEFAULT_SEED = 20260824

#: The three demo merchants from the brief, each with a different fingerprint
#: so the dashboard's compare mode shows the system is adaptive, not hardcoded.
#:
#: Transaction counts are a realistic MONTH for each business, not the brief's
#: 142/87/63. Those were sized to clear the "50+ record batch" bar, but at
#: n=63 the Wilson half-width on the observed success rate is +/-4.5 points --
#: larger than the effects being attributed, so two of the three demo
#: merchants came out with a NEGATIVE observed gap despite carrying large
#: injected problems. That is a real property of small batches, and it is
#: reported as a finding (see the batch-size curve in the sweep) rather than
#: hidden by picking a luckier seed.
DEMO = [
    {
        "merchant_id": "quickmart",
        "name": "QuickMart",
        "mcc": "5411",
        "n_txns": 2840,
        "causes": ["bank_concentration", "no_soft_decline_retry"],
        "target_pts": {"bank_concentration": 2.6},
    },
    {
        "merchant_id": "cloudsync",
        "name": "CloudSync Pro",
        "mcc": "5734",
        "n_txns": 1180,
        "causes": ["midnight_billing_penalty", "amount_band_risk"],
        "target_pts": {"midnight_billing_penalty": 3.1, "amount_band_risk": 1.4},
    },
    {
        "merchant_id": "techbazaar",
        "name": "TechBazaar",
        "mcc": "5732",
        "n_txns": 940,
        "causes": ["amount_band_risk", "method_mix_mismatch"],
        "target_pts": {"amount_band_risk": 2.2, "method_mix_mismatch": 1.7},
    },
    {
        "merchant_id": "chaipoint",
        "name": "Chai Point",
        "mcc": "5814",
        "n_txns": 6200,
        "causes": ["no_soft_decline_retry"],
        "target_pts": {},
    },
    {
        "merchant_id": "medisure",
        "name": "MediSure Pharmacy",
        "mcc": "5912",
        "n_txns": 1560,
        "causes": ["bank_concentration"],
        "target_pts": {"bank_concentration": 3.4},
    },
    {
        "merchant_id": "voltbill",
        "name": "VoltBill Utilities",
        "mcc": "4900",
        "n_txns": 2100,
        "causes": ["midnight_billing_penalty", "no_soft_decline_retry"],
        "target_pts": {"midnight_billing_penalty": 4.0},
    },
    {
        "merchant_id": "urbanthread",
        "name": "UrbanThread",
        "mcc": "5691",
        "n_txns": 870,
        "causes": ["method_mix_mismatch"],
        "target_pts": {"method_mix_mismatch": 2.4},
    },
    {
        # The control. Nothing injected -- a healthy merchant, so the agent
        # gets a chance to say "nothing is wrong here" on camera. A system that
        # only ever finds problems is not diagnosing, it is pattern-matching.
        "merchant_id": "fuelstop",
        "name": "FuelStop Network",
        "mcc": "5541",
        "n_txns": 3400,
        "causes": [],
        "target_pts": {},
        "retry_rate_when_healthy": 1.0,
    },
]

#: MCCs the sweep draws from, all present in NPCI's published category table.
SWEEP_MCCS = ["5411", "5814", "5732", "5734", "4900", "5912", "5651", "4121"]

CAUSE_POOL = [
    ["bank_concentration"],
    ["midnight_billing_penalty"],
    ["amount_band_risk"],
    ["method_mix_mismatch"],
    ["no_soft_decline_retry"],
    ["bank_concentration", "no_soft_decline_retry"],
    ["midnight_billing_penalty", "amount_band_risk"],
    ["amount_band_risk", "method_mix_mismatch"],
    ["bank_concentration", "midnight_billing_penalty"],
    [],  # a healthy merchant -- the hypothesiser should say none_of_the_above
]


def write(path: Path, merchant) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(merchant.model_dump(mode="json"), indent=2), encoding="utf-8"
    )


def gen_demo(seed: int, baseline: Baseline) -> None:
    print("demo merchants")
    for spec in DEMO:
        m = generate_merchant(seed=seed, baseline=baseline, **spec)
        write(SYNTH / ("merchant_%s.json" % spec["merchant_id"]), m)
        gt = m.ground_truth
        obs = sum(t.succeeded for t in m.transactions) / len(m.transactions)
        print(
            "  %-11s mcc %-5s n=%4d  s_obs %.3f  s_true %.3f  s_star %.3f  "
            "gap %5.2f  primary %s"
            % (
                spec["merchant_id"], spec["mcc"], len(m.transactions),
                obs, gt.s_true, gt.s_star, (gt.s_star - obs) * 100.0,
                gt.primary_cause,
            )
        )
        print(
            "              true phi: %s  process_gap %.2f"
            % (
                {k: round(v, 2) for k, v in gt.true_attribution.items()},
                gt.true_process_gap_pts,
            )
        )


def gen_sweep(n: int, seed: int, baseline: Baseline) -> None:
    """Draw from a properly CROSSED grid.

    The first version of this indexed every dimension off the loop counter --
    CAUSE_POOL[i % 10] alongside sizes[i % 5] -- and because 5 divides 10 the
    two were perfectly confounded: every n=1200 merchant happened to be one
    with no Shapley factor injected at all, which made the batch-size curve
    read as 0% accuracy at the largest batch. The grid is now built as a full
    factorial and shuffled with the seeded RNG, so each dimension varies
    independently of the others and the marginal curves mean what they say.
    """
    import random

    rng = random.Random(seed)
    SWEEP.mkdir(parents=True, exist_ok=True)
    for old in SWEEP.glob("merchant_*.json"):
        old.unlink()

    strengths = [0.8, 1.5, 2.5, 4.0]
    rhos = [0.0, 0.2, 0.5, 0.8]
    sizes = [60, 150, 400, 1000]

    grid = [
        (causes, size, rho, strength, mcc)
        for causes in CAUSE_POOL
        for size in sizes
        for rho in rhos
        for strength in strengths
        for mcc in SWEEP_MCCS
    ]
    rng.shuffle(grid)
    grid = grid[:n]

    print("validation sweep: %d merchants from a crossed grid" % n)
    for i, (causes, size, rho, strength, mcc) in enumerate(grid):
        # rho only means anything when two factors were actually injected.
        eff_rho = rho if len([c for c in causes if c != "no_soft_decline_retry"]) >= 2 else 0.0
        targets = {
            c: strength * (1.0 if j == 0 else 0.6)
            for j, c in enumerate(causes)
            if c != "no_soft_decline_retry"
        }
        # A merchant with NO injected cause must be genuinely healthy, or the
        # ground-truth label lies. At the default 0.75 retry rate a "healthy"
        # merchant still leaves a quarter of its soft declines unretried --
        # a real process gap that a good diagnosis SHOULD name. Labelling that
        # merchant none_of_the_above and scoring the model wrong for spotting
        # it would be marking the model down for being right.
        #
        # 1.0 rather than skipping the draw, so the RNG stream is unchanged and
        # only the `retried` flag moves. The Shapley attributions are untouched.
        m = generate_merchant(
            merchant_id="sweep_%03d" % i,
            name="Sweep Merchant %03d" % i,
            mcc=mcc,
            n_txns=size,
            seed=seed + i,
            causes=causes,
            target_pts=targets,
            rho=eff_rho,
            baseline=baseline,
            retry_rate_when_healthy=1.0 if not causes else 0.75,
        )
        write(SWEEP / ("merchant_%03d.json" % i), m)
        if (i + 1) % 25 == 0:
            print("  %d/%d" % (i + 1, n))
    print("  wrote %d files to %s" % (n, SWEEP.relative_to(ROOT)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--sweep", type=int, default=0)
    args = ap.parse_args()
    if not args.demo and not args.sweep:
        args.demo = True

    baseline = Baseline()
    print("seed %d  period %s  banks %d" % (args.seed, baseline.period, len(baseline.stats)))
    if args.demo:
        gen_demo(args.seed, baseline)
    if args.sweep:
        gen_sweep(args.sweep, args.seed, baseline)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
