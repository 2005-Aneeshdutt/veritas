"""Put the repository root on the import path for the test run.

`doctor` and `chitragupta` are installed from `src/` by `pip install -e .`, so
they import anywhere. `evals/` is not part of the installed package -- it is a
directory of scripts -- and one test imports from it deliberately, to assert
that the baseline ladder scores the same retry schedule the product ships.

Without this, that test passes under `python -m pytest` (which puts the
working directory on sys.path) and fails under `pytest` (which does not). CI
runs the second form, so the suite was green locally and red on push.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
