#!/usr/bin/env bash
# AutoDex — one-shot server setup script for a fresh Ubuntu/Debian Hetzner VM.
#
# Usage:
#   1. Spin up a new Hetzner server (Ubuntu 22.04 LTS recommended).
#   2. SSH in as root, then run:
#        bash <(curl -fsSL https://raw.githubusercontent.com/lrakoto/auto-dex/main/deploy/setup.sh)
#   3. Fill in /opt/autodex/.env with your real secrets (see .env.example).
#   4. Run the deploy script to pull the latest code:
#        bash /opt/autodex/deploy/update.sh
#
# This script is idempotent: safe to re-run.

set -euo pipefail

DOMAIN="autodx.io"
APP_DIR="/opt/autodex"
APP_USER="autodex"
REPO_URL="https://github.com/lrakoto/auto-dex.git"
DB_NAME="autodex"
DB_USER="autodex"

log()  { echo -e "\033[1;34m[setup]\033[0m $*"; }
ok()   { echo -e "\033[1;32m  OK\033[0m  $*"; }
die()  { echo -e "\033[1;31m FATAL\033[0m $*" >&2; exit 1; }

# ─── Root check ──────────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash setup.sh"

# ─── System packages ─────────────────────────────────────────────────────────
log "Updating apt and installing packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl git build-essential \
  nodejs npm \
  nginx \
  postgresql postgresql-contrib \
  ufw fail2ban \
  certbot python3-certbot-nginx \
  > /dev/null

ok "system packages installed"

# ─── Node via NodeSource (newer than Debian default) ─────────────────────────
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null | cut -dv -f2 | cut -d. -f1)" -lt 18 ]]; then
  log "Installing Node.js 20 LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs > /dev/null
fi
ok "node $(node -v), npm $(npm -v)"

# ─── Dedicated unprivileged user ─────────────────────────────────────────────
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating user '$APP_USER'..."
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
fi
ok "user '$APP_USER' exists"

# ─── App directory + clone ───────────────────────────────────────────────────
log "Cloning/updating repo to $APP_DIR..."
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --quiet --hard origin/$(git -C "$APP_DIR" symbolic-ref --short HEAD 2>/dev/null || echo main)
else
  rm -rf "$APP_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --quiet "$REPO_URL" "$APP_DIR"
fi
ok "repo at $APP_DIR"

# ─── .env (only create if missing — never overwrite secrets) ─────────────────
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating .env from .env.example..."
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env created — edit it: nano $ENV_FILE"
else
  ok ".env already exists (preserved)"
fi

# ─── PostgreSQL ──────────────────────────────────────────────────────────────
log "Setting up PostgreSQL database..."
DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32 || true)"
# Fall back if openssl missing
[[ -z "$DB_PASS" ]] && DB_PASS="$(head -c 32 /dev/urandom | base64)"

# Start postgres if not running
systemctl enable --now postgresql >/dev/null 2>&1 || true

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
else
  ok "db user '$DB_USER' already exists"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  ok "db '$DB_NAME' created"
else
  ok "db '$DB_NAME' already exists"
fi

# Patch DATABASE_URL in .env if it's empty (local Postgres)
if grep -q '^DATABASE_URL=$' "$ENV_FILE" 2>/dev/null; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}|" "$ENV_FILE"
  ok "DATABASE_URL set to local postgres (password saved in .env)"
  echo -e "\033[1;33m  NOTE\033[0m local DB password: $DB_PASS"
fi

# ─── npm install (production deps only) ──────────────────────────────────────
log "Running npm install (production)..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund" >/dev/null 2>&1 \
  || sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund" >/dev/null
ok "dependencies installed"

# ─── Sequelize migrations ────────────────────────────────────────────────────
log "Running database migrations..."
if [[ -f "$ENV_FILE" ]]; then
  sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && NODE_ENV=production npx sequelize-cli db:migrate" 2>&1 | tail -n 5
fi
ok "migrations applied"

# ─── systemd service ─────────────────────────────────────────────────────────
log "Installing systemd service..."
install -m644 "$APP_DIR/deploy/autodex.service" /etc/systemd/system/autodex.service
systemctl daemon-reload
systemctl enable autodex >/dev/null
ok "systemd service installed"

# ─── nginx ───────────────────────────────────────────────────────────────────
log "Configuring nginx..."
install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
install -m644 "$APP_DIR/deploy/nginx.conf" "/etc/nginx/sites-available/${DOMAIN}"

# Enable site, disable default
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default

nginx -t 2>/dev/null
systemctl reload nginx
ok "nginx configured"

# ─── Firewall (UFW) ──────────────────────────────────────────────────────────
log "Configuring firewall (UFW)..."
ufw --force reset >/dev/null
ufw allow 22/tcp    comment 'SSH'       >/dev/null
ufw allow 80/tcp    comment 'HTTP'      >/dev/null
ufw allow 443/tcp   comment 'HTTPS'     >/dev/null
ufw --force enable >/dev/null
ok "firewall: 22,80,443 open"

# ─── fail2ban ────────────────────────────────────────────────────────────────
log "Enabling fail2ban..."
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled = true
port = 22
maxretry = 5
bantime = 3600
JAIL
systemctl enable --now fail2ban >/dev/null 2>&1 || true
ok "fail2ban enabled for SSH"

# ─── TLS certificate (Let's Encrypt) ──────────────────────────────────────────
log "Issuing TLS certificate (Let's Encrypt)..."
if [[ -d /etc/letsencrypt/live/${DOMAIN} ]]; then
  ok "certificate already exists"
else
  if certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email -q; then
    ok "TLS certificate issued"
  else
    echo -e "\033[1;33m  NOTE\033[0m certbot failed — run manually after DNS points here:"
    echo "    certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
  fi
fi

# ─── Start / restart app ─────────────────────────────────────────────────────
log "Starting AutoDex service..."
systemctl restart autodex
sleep 2
systemctl is-active --quiet autodex && ok "AutoDex is running" || die "AutoDex failed to start — check: journalctl -u autodex -n 50"

# ─── Auto-update timer (optional, off by default) ────────────────────────────
install -m755 "$APP_DIR/deploy/update.sh" /usr/local/bin/autodex-update

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "\033[1;32m════════════════════════════════════════════════════════════\033[0m"
echo -e " AutoDex deployment complete."
echo -e "  • App:     http://localhost:3000  (proxied via nginx)"
echo -e "  • Service: systemctl {start,stop,status,restart} autodex"
echo -e "  • Logs:    journalctl -u autodex -f"
echo -e "  • Nginx:   systemctl {reload,status} nginx"
echo -e "  • DB:      sudo -u postgres psql autodex"
echo -e "  • .env:    nano $ENV_FILE"
echo -e ""
echo -e " Next steps:"
echo -e "  1. Make sure DNS for ${DOMAIN} points to this server's IP."
echo -e "  2. Edit .env and fill in real API keys/secret session:"
echo -e "       nano $ENV_FILE"
echo -e "  3. Restart to pick up new env:"
echo -e "       systemctl restart autodex"
echo -e "  4. (If certbot was skipped) Issue the TLS cert:"
echo -e "       certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo -e "\033[1;32m════════════════════════════════════════════════════════════\033[0m"