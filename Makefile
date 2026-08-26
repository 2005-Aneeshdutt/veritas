# Revenue Doctor
#
#   make setup     install everything
#   make demo      run the app (backend + frontend)
#   make test      63 tests
#   make verify    regenerate and fail if any committed number moved
#
# Nothing here needs an API key. Every LLM response is cached and committed.

.PHONY: help setup data demo run test lint evals evals-llm verify clean

PY      ?= python
PYPATH  := PYTHONPATH=src
MERCHANT ?= quickmart

help:
	@echo "setup      install python and frontend dependencies"
	@echo "data       fetch source data, generate merchants and mandates"
	@echo "demo       start backend :8000 and frontend :3000"
	@echo "run        diagnose one merchant on the CLI (MERCHANT=quickmart)"
	@echo "test       run the test suite"
	@echo "evals      run every deterministic eval"
	@echo "evals-llm  run the three evals that replay from the LLM cache"
	@echo "verify     regenerate everything and check the committed numbers hold"

setup:
	$(PY) -m pip install -e ".[dev]"
	cd frontend && npm install --no-fund --no-audit

# Only needed from a bare checkout -- the generated data is committed.
data:
	$(PY) scripts/fetch_data.py
	$(PY) scripts/build_error_labels.py
	$(PY) scripts/generate_batch.py --demo --sweep 200
	@for m in quickmart cloudsync techbazaar chaipoint medisure voltbill urbanthread fuelstop; do \
		$(PYPATH) $(PY) -m chitragupta.mandate --generate --merchant $$m >/dev/null; \
	done
	@echo "data ready"

demo:
	bash scripts/dev.sh

run:
	$(PYPATH) $(PY) -m doctor.run --merchant $(MERCHANT)

test:
	$(PY) -m pytest -q

lint:
	$(PY) -m ruff check src scripts evals tests

evals:
	$(PY) evals/run_validation_sweep.py
	$(PY) evals/run_s_star_sensitivity.py
	$(PY) evals/run_baseline_ladder.py
	$(PY) evals/run_stress_test.py
	$(PY) evals/run_npci_finding.py
	$(PY) evals/run_backtest.py
	$(PY) evals/run_outcome_eval.py
	$(PY) evals/run_scale_benchmark.py

# These replay from the committed cache. They refuse to score stub responses
# rather than emit a number that looks like a measurement.
evals-llm:
	$(PY) evals/run_classification_eval.py
	$(PY) evals/run_root_cause_eval.py
	$(PY) evals/run_verifier_ablation.py

verify:
	$(PY) scripts/verify_reproducibility.py

clean:
	rm -rf frontend/.next
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "cleaned build artifacts (generated data is committed and untouched)"
