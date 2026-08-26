"""Prove the committed numbers actually reproduce.

Run:  python scripts/verify_reproducibility.py

RULE 3 of this project says a panellist should be able to clone the repo and
reproduce every number. That is easy to claim and easy to quietly break -- one
tweak to a threshold and the committed results no longer match the code that
supposedly produced them.

So this checks it mechanically: regenerate the data and re-run every
deterministic eval, then ask git whether anything under evals/results/ moved.
If a single figure changed, the check fails and says which file.

Timing-dependent results are excluded by name rather than by guesswork --
scale_benchmark.json contains wall-clock measurements that cannot be identical
across machines, and pretending otherwise would make this check either useless
or permanently red.

The LLM evals are also excluded here: they replay from the committed cache and
are verified separately, because a cache miss on a machine with no API key
should fail loudly on its own rather than being reported as a reproducibility
break.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Results whose content legitimately varies between machines.
TIMING_DEPENDENT = {"scale_benchmark.json"}

#: Enough to diagnose a break without burying the log.
MAX_DIFF_FILES = 4

STEPS: list[tuple[str, list[str]]] = [
    ("regenerate demo merchants", ["scripts/generate_batch.py", "--demo"]),
    ("regenerate validation sweep", ["scripts/generate_batch.py", "--sweep", "200"]),
    ("validation sweep", ["evals/run_validation_sweep.py"]),
    ("sensitivity analysis", ["evals/run_s_star_sensitivity.py"]),
    ("baseline ladder", ["evals/run_baseline_ladder.py"]),
    ("stress test", ["evals/run_stress_test.py"]),
    ("NPCI finding", ["evals/run_npci_finding.py"]),
    ("NPCI backtest", ["evals/run_backtest.py"]),
    ("outcome accuracy", ["evals/run_outcome_eval.py"]),
    ("recovery accuracy", ["evals/run_recovery_eval.py"]),
]


def run(desc: str, args: list[str]) -> bool:
    print("  running %s ..." % desc, flush=True)
    r = subprocess.run(
        [sys.executable] + args, cwd=ROOT, capture_output=True, text=True
    )
    if r.returncode != 0:
        print("    FAILED\n%s\n%s" % (r.stdout[-2000:], r.stderr[-2000:]))
        return False
    return True


def changed_results() -> list[str]:
    r = subprocess.run(
        ["git", "diff", "--name-only", "--", "evals/results", "data/synthetic"],
        cwd=ROOT, capture_output=True, text=True,
    )
    out = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        if Path(line).name in TIMING_DEPENDENT:
            continue
        out.append(line)
    return out


def show_first_difference(rel: str, context: int = 60) -> None:
    """Print the first byte at which the file stopped matching what is committed.

    Deliberately compares raw bytes against the committed blob rather than
    printing `git diff`. Line-ending filters can make git's diff come back
    empty on a file it has just listed as changed, which tells you nothing.
    A byte offset and the text either side of it always says what moved.
    """
    print("  %s" % rel)
    committed = subprocess.run(
        ["git", "show", "HEAD:" + rel], cwd=ROOT, capture_output=True
    ).stdout
    current = (ROOT / rel).read_bytes()

    if committed == current:
        print("    identical as bytes -- only the index or file mode moved")
        return

    n = min(len(committed), len(current))
    i = next((k for k in range(n) if committed[k] != current[k]), n)
    a = committed[max(0, i - context): i + context].decode("utf-8", "replace")
    b = current[max(0, i - context): i + context].decode("utf-8", "replace")
    print("    first difference at byte %d of %d" % (i, len(committed)))
    print("    committed: %s" % a.replace("\n", " "))
    print("    regenerated: %s" % b.replace("\n", " "))


def main() -> int:
    print("Reproducibility check")
    print("  regenerating data and re-running every deterministic eval,")
    print("  then asking git whether any committed number moved.")
    print("")

    for desc, args in STEPS:
        if not run(desc, args):
            return 1

    print("")
    diffs = changed_results()
    if diffs:
        print("REPRODUCIBILITY BROKEN -- %d file(s) changed:" % len(diffs))
        for d in diffs:
            print("  %s" % d)
        print("")
        print("Either the code changed without the results being re-committed,")
        print("or something non-deterministic crept into the pipeline.")
        print("")
        for d in diffs[:MAX_DIFF_FILES]:
            show_first_difference(d)
        if len(diffs) > MAX_DIFF_FILES:
            print("... and %d more file(s)" % (len(diffs) - MAX_DIFF_FILES))
        return 1

    print("REPRODUCIBLE -- every committed figure regenerated identically.")
    print("(scale_benchmark.json is excluded: it measures wall-clock time.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
