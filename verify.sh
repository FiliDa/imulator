#!/usr/bin/env bash

# Quick verification script for Ubuntu/Debian
# - Checks server health at BASE_URL
# - Runs English external tests and final screenshot tests
# - Summarizes results from 5test/ and finaltest/
# Requires: bash, curl, node >= 18

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
IMG_DIR="tests/skrin_test"
RUN_5TEST="scripts/run-5tests-external-en.js"
RUN_FINAL="scripts/run-finaltest.js"

usage() {
  cat <<EOF
Usage: ./verify.sh [options]

Options:
  --base <url>   Set BASE_URL (default: ${BASE_URL})
  --help         Show this help

Environment:
  BASE_URL       API base, e.g. http://127.0.0.1:9999

This script:
  1) Checks health at BASE_URL/health
  2) Verifies screenshots exist under ${IMG_DIR}
  3) Runs English external tests (5 cases)
  4) Runs final screenshot tests across all images
  5) Prints summaries and basic format checks
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      [[ $# -ge 2 ]] || { echo "Missing value for --base"; exit 2; }
      BASE_URL="$2"; shift 2;
      ;;
    --help|-h)
      usage; exit 0;
      ;;
    *)
      echo "Unknown option: $1"; usage; exit 2;
      ;;
  esac
done

echo "[1/5] Checking prerequisites (curl, node)"
command -v curl >/dev/null 2>&1 || { echo "Error: curl not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: node not found"; exit 1; }

NODE_VER=$(node -v | sed 's/^v//')
MAJOR=${NODE_VER%%.*}
if [[ ${MAJOR} -lt 18 ]]; then
  echo "Error: Node ${NODE_VER} detected; please use Node 18+"
  exit 1
fi

echo "[2/5] Health check: ${BASE_URL}/health"
if ! curl -sf "${BASE_URL}/health" >/dev/null; then
  echo "Error: server not healthy or unreachable at ${BASE_URL}"
  echo "Hint: start the server (e.g., ./mainstart.sh) and re-run"
  exit 1
fi
echo "OK: server is healthy"

echo "[3/5] Checking screenshots in ${IMG_DIR}"
if [[ ! -d "${IMG_DIR}" ]]; then
  echo "Error: directory ${IMG_DIR} not found"
  exit 1
fi
shopt -s nullglob
IMGS=("${IMG_DIR}"/*.png "${IMG_DIR}"/*.jpg "${IMG_DIR}"/*.jpeg)
if [[ ${#IMGS[@]} -eq 0 ]]; then
  echo "Error: no images (*.png|*.jpg|*.jpeg) in ${IMG_DIR}"
  exit 1
fi
echo "Found ${#IMGS[@]} images for testing"
shopt -u nullglob

echo "[4/5] Running 5 English external tests (text/text+image/image)"
TEST_BASE_URL="${BASE_URL}" node "${RUN_5TEST}" || {
  echo "run-5tests-external-en failed"; exit 1;
}
if [[ -f "5test/summary.json" ]]; then
  echo "5test summary:"; cat "5test/summary.json"
else
  echo "Warning: 5test/summary.json not found"
fi

echo "[5/5] Running final screenshot tests across all images"
BASE_URL="${BASE_URL}" node "${RUN_FINAL}" || {
  echo "run-finaltest failed"; exit 1;
}
if [[ -f "finaltest/summary.json" ]]; then
  echo "finaltest summary:"; cat "finaltest/summary.json"
else
  echo "Warning: finaltest/summary.json not found"
fi

echo "Done. Artifacts: 5test/ and finaltest/"
echo "If format_ok is below expectations, check prompts and compact rules."