# AutoDex — Deployment

Production runs on a Hetzner VPS behind nginx, with the Node process managed by
**PM2** (process name `autodex`).

| | |
| --- | --- |
| Server | Hetzner VPS, Ubuntu |
| IP | `178.156.219.19` |
| SSH | `ssh root@178.156.219.19` |
| App directory | `/var/www/autodex` |
| Process manager | PM2 (`pm2 restart autodex`) |
| Reverse proxy | nginx → `127.0.0.1:3000` |
| Domain | `autodx.io` (SSL via Certbot / Let's Encrypt) |
| Database | PostgreSQL — user `autodex_user`, database `autodex` |
| Env file | `/var/www/autodex/.env` |

> **Not** systemd, and **not** `/opt/autodex`. Earlier revisions of this repo
> shipped a systemd unit and `/opt/autodex` paths; those were never the live
> setup and have been removed. If you see them in an old branch or in your
> shell history, ignore them.

## Deploying a change

```bash
ssh root@178.156.219.19
cd /var/www/autodex && git pull \
  && npm install \
  && NODE_ENV=production npx sequelize-cli db:migrate \
  && pm2 restart autodex
```

Or use the helper installed on the server (does the same thing, plus an nginx
config test):

```bash
autodex-update
```

## First-time server setup

`deploy/setup.sh` bootstraps a fresh VM end to end (Node 22, PostgreSQL, nginx,
PM2, certbot, UFW, fail2ban; clones to `/var/www/autodex`, creates the DB, runs
migrations, starts the app under PM2, registers `pm2 startup`). Run it once, as
root, on a new server:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/lrakoto/auto-dex/main/deploy/setup.sh)
```

Then fill in the secrets and restart:

```bash
nano /var/www/autodex/.env
pm2 restart autodex
```

The script is idempotent (safe to re-run) but has **not** been exercised
end-to-end in CI — dry-run it on a throwaway VM before trusting it on prod.

## Common operations

```bash
pm2 status                        # app status
pm2 logs autodex                  # live logs
pm2 restart autodex               # restart after an .env change
pm2 restart autodex --update-env  # restart, re-reading environment
pm2 save                          # persist the process list
sudo systemctl {status,reload} nginx
sudo certbot renew --dry-run      # test TLS renewal
```

## Migrations

Migrations run on every deploy and are idempotent via the `SequelizeMeta`
table. Before deploying a migration that rewrites existing data, rehearse it
against a dump of production:

```bash
ssh root@178.156.219.19 "pg_dump -U autodex_user autodex" > prod.sql
createdb autodex_prodtest && psql autodex_prodtest < prod.sql
DATABASE_URL=postgres:///autodex_prodtest NODE_ENV=production npx sequelize-cli db:migrate
dropdb autodex_prodtest
```

## Files

| File | Purpose |
| ---- | ------- |
| `deploy/setup.sh` | One-shot bootstrap for a fresh VM (run once, as root) |
| `deploy/update.sh` | Pull, install, migrate, reload nginx, restart (installed as `autodex-update`) |
| `deploy/ecosystem.config.js` | PM2 process definition |
| `deploy/nginx.conf` | nginx site: HTTPS, reverse proxy, security headers, static assets from `/var/www/autodex/public` |
| `.env.example` | Template for all required environment variables |

## Troubleshooting

### `REMOTE HOST IDENTIFICATION HAS CHANGED`

SSH refuses to connect because the server's host key no longer matches the
entry in your local `known_hosts`. This happens when the server is rebuilt,
reprovisioned, or restored from a snapshot — which is expected over the life
of a box. It can also mean a man-in-the-middle, so **confirm the change was
yours before clearing anything.**

1. Confirm the rebuild in the Hetzner console (or with whoever manages it).
2. Compare the fingerprint against the one in the Hetzner console:
   ```bash
   ssh-keyscan -t ed25519 178.156.219.19 2>/dev/null | ssh-keygen -lf -
   ```
3. If it matches and you expected the rebuild, drop the stale entry and
   reconnect. `ssh-keygen -R` backs the file up automatically.
   ```bash
   ssh-keygen -R 178.156.219.19
   ssh root@178.156.219.19
   ```

The old key was removed this way during the September 2026 cleanup. If SSH
still fails afterward with `Permission denied (publickey)`, the problem is
authorized keys — not host verification. Check that your public key is in
`/root/.ssh/authorized_keys` on the server (the Hetzner console's rescue mode
is the way in if SSH is fully locked out).

### Static assets 404 / unstyled pages

nginx serves `/css`, `/js`, and images directly from disk. If that `alias`
path does not exist, assets break while the HTML still renders. Verify:

```bash
grep -n 'alias' /etc/nginx/sites-available/autodex.io
# should be: alias /var/www/autodex/public;
```

### App up but returning 500s

```bash
pm2 logs autodex --lines 50
# Most common cause: missing or malformed .env (the app refuses to boot
# without SECRET_SESSION).
```
