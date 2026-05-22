#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "package.json" ]]; then
  echo "[ERROR] package.json not found. Run this script from ecoconnect-backend root."
  exit 1
fi

require_runtime() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed. Install Node.js v18+ first."
    exit 1
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[ERROR] pnpm is not installed. Install via: npm i -g pnpm"
    exit 1
  fi
}

update_code() {
  if [[ "${GIT_PULL:-0}" != "1" ]]; then
    echo "[INFO] Skipping git pull (set GIT_PULL=1 to enable)."
    return
  fi

  if [[ ! -d .git ]]; then
    echo "[WARN] .git directory not found, cannot pull updates."
    return
  fi

  echo "[STEP] Pull latest code"
  git fetch --all --prune
  git pull --ff-only
}

ensure_env() {
  if [[ ! -f ".env" ]]; then
    echo "[STEP] Creating .env from .env.example"
    cp .env.example .env
    echo "[WARN] .env created. Please review values before production use."
  fi
}

install_deps() {
  echo "[STEP] Installing dependencies"
  pnpm install
}

run_dev() {
  echo "[STEP] Starting backend in dev mode"
  pnpm run dev
}

deploy_systemd() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "[ERROR] systemd deployment is supported on Linux only."
    exit 1
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    echo "[ERROR] systemctl not found."
    exit 1
  fi

  echo "[STEP] Installing systemd units"
  sudo cp deploy/systemd/ecoconnect-backend.service /etc/systemd/system/
  sudo cp deploy/systemd/ecoconnect-detector.service /etc/systemd/system/

  echo "[STEP] Reloading and enabling services"
  sudo systemctl daemon-reload
  sudo systemctl enable ecoconnect-backend
  sudo systemctl enable ecoconnect-detector

  echo "[STEP] Restarting services"
  sudo systemctl restart ecoconnect-backend
  sudo systemctl restart ecoconnect-detector

  echo "[STEP] Service status"
  sudo systemctl --no-pager --full status ecoconnect-backend || true
  sudo systemctl --no-pager --full status ecoconnect-detector || true
}

usage() {
  cat <<'EOF'
Usage:
  ./deploy.sh dev
  ./deploy.sh prod

Modes:
  dev   Install deps, ensure .env, and run pnpm run dev
  prod  Install deps, ensure .env, and deploy/restart systemd units (Linux)

Optional:
  GIT_PULL=1 ./deploy.sh dev|prod
    Pulls latest changes with git pull --ff-only before deploy steps.
EOF
}

case "$MODE" in
  dev)
    require_runtime
    update_code
    ensure_env
    install_deps
    run_dev
    ;;
  prod)
    require_runtime
    update_code
    ensure_env
    install_deps
    deploy_systemd
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "[ERROR] Unknown mode: $MODE"
    usage
    exit 1
    ;;
esac
