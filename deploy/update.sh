#!/usr/bin/env bash
# AutoDex — pull latest code, migrate, and restart. Safe to re-run.
# Installed by setup.sh as /usr/local/bin/autodex-update
set -euo pipefail

APP_DIR="/var/www/autodex"
PM2_NAME="autodex"

echo "[update] pulling latest..."
git -C "$APP_DIR" fetch --quiet origin
git -C "$APP_DIR" reset --quiet --hard "origin/$(git -C "$APP_DIR" symbolic-ref --short HEAD 2>/dev/null || echo main)"

echo "[update] installing deps..."
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null \
  || npm install --omit=dev --no-audit --no-fund

echo "[update] running migrations..."
NODE_ENV=production npx sequelize-cli db:migrate

echo "[update] reloading nginx..."
nginx -t 2>/dev/null && systemctl reload nginx

echo "[update] restarting app..."
pm2 restart "$PM2_NAME" --update-env >/dev/null
sleep 2
pm2 describe "$PM2_NAME" >/dev/null 2>&1 \
  && echo "[update] done — AutoDex restarted" \
  || { echo "[update] FAILED"; pm2 logs "$PM2_NAME" --lines 30 --nostream; exit 1; }
