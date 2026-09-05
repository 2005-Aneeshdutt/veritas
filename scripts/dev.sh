#!/usr/bin/env bash
# Start VERITAS: FastAPI engine + the operator console.
#
#   bash scripts/dev.sh          production build, what the demo should use
#   bash scripts/dev.sh --dev    hot reload, for editing the console
#
# Ctrl-C stops both.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

MODE="${1:-prod}"

# --- preflight -------------------------------------------------------------
missing=0
for f in data/synthetic/merchant_quickmart.json \
         data/mandates/quickmart_mandate.json \
         evals/results/attribution_mae_by_factor.json; do
  if [ ! -f "$f" ]; then
    echo "MISSING: $f"
    missing=1
  fi
done
if [ "$missing" = "1" ]; then
  cat <<'EOF'

Run these first:
  python scripts/fetch_data.py
  python scripts/build_error_labels.py
  python scripts/generate_batch.py --demo --sweep 200
  python -m chitragupta.mandate --generate --merchant quickmart --auto-limit-paise 60000  --ceiling-paise 500000
  python -m chitragupta.mandate --generate --merchant cloudsync --auto-limit-paise 300000 --ceiling-paise 1500000
  python -m chitragupta.mandate --generate --merchant techbazaar --auto-limit-paise 800000 --ceiling-paise 3000000
  python evals/run_validation_sweep.py
EOF
  exit 1
fi

if [ ! -d console/node_modules ]; then
  echo "installing console deps..."
  (cd console && npm install --no-fund --no-audit)
fi

cleanup() {
  echo ""
  echo "stopping..."
  kill ${API_PID:-} ${WEB_PID:-} 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- backend ---------------------------------------------------------------
export PYTHONPATH="$ROOT/src"
echo "starting backend on :8000 ..."
python -m uvicorn doctor.api:app --port 8000 --log-level warning &
API_PID=$!

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
  echo "backend failed to start"
  exit 1
fi

# Whether a key is present decides whether the run is real or stubbed, so say
# it up front rather than letting someone demo placeholders by accident.
python - <<'PY'
import sys
sys.path.insert(0, "src")
from doctor.llm import LLMClient
c = LLMClient()
n = len(list(c.cache_dir.glob("*.json")))
if c.has_key:
    print("  LLM: %s, %d cached responses" % (c.describe(), n))
elif n:
    print("  LLM: no key, %d cached responses -- cached runs replay fine" % n)
else:
    print("  LLM: NO KEY AND NO CACHE -- runs will emit STUBS, labelled as such")
PY

# --- console ---------------------------------------------------------------
# Always the dev server. The console's production build targets a serverless
# runtime and has no `start`, so there is nothing to run in front of a
# panellist here that the dev server does not already do.
cd console
echo "starting console on :8080 ..."
npm run dev &
WEB_PID=$!
cd "$ROOT"

for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8080/ >/dev/null 2>&1; then break; fi
  sleep 0.5
done

cat <<'EOF'

  ---------------------------------------------------
   VERITAS is up

     http://localhost:8080        the console
     http://localhost:8080/login  the landing page
     http://localhost:8000/docs   the API

   Ctrl-C to stop both.
  ---------------------------------------------------
EOF

wait
