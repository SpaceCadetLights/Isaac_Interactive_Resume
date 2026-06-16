#!/usr/bin/env bash
# Start the static site dev server (portfolio, 3d-resume, standard resume).
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"

echo "Serving Isaac Interactive Resume at http://localhost:${PORT}/"
echo "  Portfolio:  http://localhost:${PORT}/portfolio/"
echo "  3D Resume:  http://localhost:${PORT}/3d-resume/"
echo "  Standard:   http://localhost:${PORT}/interactive_resume_spacecadets_v6_singlefile.html"

exec python3 -m http.server "$PORT" --bind 0.0.0.0
