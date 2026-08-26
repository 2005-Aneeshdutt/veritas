"""Can the classifier generalise to error codes it has never seen?

Run:  ANTHROPIC_API_KEY=... python evals/run_classification_eval.py

The framing matters, because otherwise the obvious objection lands: all 110
published codes are hand-labelled in evals/error_labels.json and answered by a
dictionary with no API call. So what is the model for?

For the codes that are NOT in the taxonomy. Gateways emit their own codes and
new ones appear over time. That is why this eval holds out **codes**, not rows:
the training split is what the deterministic lookup is allowed to answer, and
the held-out codes genuinely reach the model with nothing memorised about them.

Small denominators are handled honestly. A 30% stratified holdout of 110 codes
gives ~33 codes across 4 classes, so some classes land in single digits.
Bare percentages there would be misleading, so every rate is reported with a
Wilson 95% interval.

This script REFUSES to run without an API key rather than scoring stubs. A
stub is a placeholder, and scoring one would produce a number that looks like
a measurement.
"""

from __future__ import annotations

import json
import os
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from doctor.classify import Classifier, load_taxonomy  # noqa: E402
from doctor.llm import LLMClient  # noqa: E402
from doctor.stats import wilson_interval  # noqa: E402

RESULTS = ROOT / "evals" / "results"
CLASSES = ["soft_decline", "hard_decline", "technical", "auth_failure"]
HOLDOUT = 0.30
SEED = 20260824


def stratified_holdout(taxonomy: dict, frac: float, seed: int):
    """Hold out `frac` of the CODES in each class, not of the rows."""
    rng = random.Random(seed)
    by_class: dict[str, list[str]] = defaultdict(list)
    for code, rec in taxonomy.items():
        by_class[rec["category"]].append(code)
    train, test = set(), set()
    for cls in sorted(by_class):
        codes = sorted(by_class[cls])
        rng.shuffle(codes)
        k = max(1, round(len(codes) * frac))
        test.update(codes[:k])
        train.update(codes[k:])
    return train, test


def main() -> int:
    client = LLMClient()
    if not client.has_key and not list(client.cache_dir.glob("*.json")):
        raise SystemExit(
            "No API key and an empty llm_cache/.\n"
            "This eval will not score stub responses -- a placeholder must "
            "never be mistaken for a measurement.\n"
            "Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY once to populate the "
            "cache; after that it reproduces these numbers offline."
        )

    taxonomy = load_taxonomy()
    train, test = stratified_holdout(taxonomy, HOLDOUT, SEED)
    print("%d codes: %d train, %d held out" % (len(taxonomy), len(train), len(test)))
    print("provider: %s" % client.describe())

    # The lookup may answer ONLY the training split, so held-out codes really
    # do reach the model.
    clf = Classifier(client, taxonomy, known_codes=train)

    rows = []
    for code in sorted(test):
        rec = taxonomy[code]
        pred, res = clf.classify(code, rec["explanation"])
        if res is not None and getattr(res, "stub", False):
            raise SystemExit(
                "Got a stub response for %r -- refusing to score placeholders. "
                "Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY." % code
            )
        rows.append(
            {
                "code": code,
                "true": rec["category"],
                "pred": pred.category.value,
                "true_recoverable": rec["recoverable"],
                "pred_recoverable": pred.recoverable,
                "confidence": pred.confidence,
                "correct": pred.category.value == rec["category"],
                "cache_hit": bool(getattr(res, "cache_hit", False)),
            }
        )

    n = len(rows)
    hits = sum(r["correct"] for r in rows)
    acc, acc_lo, acc_hi = wilson_interval(hits, n)

    # per-class P/R/F1 with support and Wilson intervals on recall
    per_class = {}
    for cls in CLASSES:
        tp = sum(1 for r in rows if r["true"] == cls and r["pred"] == cls)
        fp = sum(1 for r in rows if r["true"] != cls and r["pred"] == cls)
        fn = sum(1 for r in rows if r["true"] == cls and r["pred"] != cls)
        support = tp + fn
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / support if support else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall)
            else 0.0
        )
        _, r_lo, r_hi = wilson_interval(tp, support) if support else (0, 0, 1)
        per_class[cls] = {
            "support": support,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "recall_ci95": [round(r_lo, 4), round(r_hi, 4)],
            "f1": round(f1, 4),
        }

    macro_f1 = sum(v["f1"] for v in per_class.values()) / len(CLASSES)
    confusion = {t: {p: 0 for p in CLASSES} for t in CLASSES}
    for r in rows:
        confusion[r["true"]][r["pred"]] += 1

    rec_hits = sum(1 for r in rows if r["true_recoverable"] == r["pred_recoverable"])
    rec_acc, rec_lo, rec_hi = wilson_interval(rec_hits, n)
    low_conf = [r for r in rows if r["confidence"] < 0.85]

    out = {
        "note": (
            "Held-out CODES, not rows. The deterministic lookup was restricted "
            "to the training split, so every code scored here reached the "
            "model with nothing memorised. Small per-class support is real -- "
            "hence Wilson intervals rather than bare percentages."
        ),
        "n_codes_total": len(taxonomy),
        "n_train": len(train),
        "n_test": n,
        "accuracy": round(acc, 4),
        "accuracy_ci95": [round(acc_lo, 4), round(acc_hi, 4)],
        "macro_f1": round(macro_f1, 4),
        "per_class": per_class,
        "recoverable_accuracy": round(rec_acc, 4),
        "recoverable_ci95": [round(rec_lo, 4), round(rec_hi, 4)],
        "low_confidence_routed_to_review": len(low_conf),
        "cache_hit_rate": round(client.stats.cache_hit_rate, 4),
        "errors": [r for r in rows if not r["correct"]],
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "classification_f1.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8", newline="\n"
    )
    (RESULTS / "confusion_matrix.json").write_text(
        json.dumps(confusion, indent=2), encoding="utf-8", newline="\n"
    )

    print("\naccuracy   %.1f%%  (95%% CI %.1f - %.1f)"
          % (100 * acc, 100 * acc_lo, 100 * acc_hi))
    print("macro F1   %.4f" % macro_f1)
    print("\n%-15s %8s %10s %8s %8s" % ("class", "support", "precision", "recall", "F1"))
    for cls, v in per_class.items():
        print("%-15s %8d %10.3f %8.3f %8.3f"
              % (cls, v["support"], v["precision"], v["recall"], v["f1"]))
        print("%-15s %8s recall 95%% CI %.3f - %.3f"
              % ("", "", v["recall_ci95"][0], v["recall_ci95"][1]))
    print("\nrecoverable flag %.1f%% (95%% CI %.1f - %.1f)"
          % (100 * rec_acc, 100 * rec_lo, 100 * rec_hi))
    print("routed to human review: %d" % len(low_conf))
    print("cache hit rate: %.0f%%" % (100 * client.stats.cache_hit_rate))
    if out["errors"]:
        print("\nmisclassified:")
        for r in out["errors"]:
            print("  %-42s true=%-14s pred=%-14s conf=%.2f"
                  % (r["code"], r["true"], r["pred"], r["confidence"]))
    print("\nwrote evals/results/classification_f1.json, confusion_matrix.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
