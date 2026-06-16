#!/usr/bin/env bash
# Idempotent cloud environment bootstrap. Runs on each agent VM startup.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Verifying runtime tools"
python3 --version
node --version

echo "==> Validating resume data"
python3 -c "import json; json.load(open('data/resume_pack.json'))"

echo "==> Cloud environment ready"
