#!/usr/bin/env bash
# AutoDex — pull latest code and restart. Safe to re-run.
# Installed by setup.sh as /usr/local/bin/autodex-update
set -euo pipefail

APP_DIR="/opt/autodex"
APP_USER="autodex"

echo "[update] pulling latest..."
sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin
sudo -u "$APP_USER" git -C "$APP_DIR" reset --quiet --hard "origin/$(git -C "$APP_DIR" symbolic-ref --short HEAD 2>/dev/null || echo main)"

echo "[update] installing deps..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund" 2>/dev/null \
  || sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund"

echo "[update] running migrations..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && NODE_ENV=production npx sequelize-cli db:migrate"

echo "[update] reloading nginx..."
nginx -t 2>/dev/null && systemctl reload nginx

echo "[update] restarting app..."
systemctl restart autodex
sleep 2
systemctl is-active --quiet autodex && echo "[update] done — AutoDex restarted" || { echo "[update] FAILED"; journalctl -u autodex -n 30 --no-pager; exit 1; }