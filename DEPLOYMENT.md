# AutoDex — Deployment

Production runs on **Render**, from the blueprint in `render.yaml`. A push to
`main` is the deploy: Render rebuilds, runs migrations, and restarts the web
service on its own.

| | |
| --- | --- |
| Host | Render (managed) |
| Blueprint | `render.yaml` (web service `autodex` + Postgres `autodex-db`) |
| Region / plan | `oregon`, `starter` web + `basic-256mb` Postgres 16 |
| Deploy trigger | `autoDeploy: true` on `main` |
| Build command | `npm ci && npx sequelize-cli db:migrate` |
| Start command | `npm start` |
| Health check | `GET /` |
| Domain | `autodx.io` (DNS → Render; TLS issued by Render) |
| Database | Render Postgres — `DATABASE_URL` injected from `autodex-db` |
| Secrets | Render dashboard → service → Environment (the `sync: false` keys) |

> The Hetzner VPS at `178.156.219.19` is **not** serving `autodx.io` and has not
> been since the move to Render. Nothing in this repo deploys to it any more;
> its PM2/nginx scripts were removed (recoverable in git history if a self-host
> move ever comes back). Ignore any `ssh root@…`, `pm2 restart autodex`, or
> `/var/www/autodex` instructions left in an old branch or in shell history —
> running them updates a box no visitor reaches.

## Deploying a change

```bash
git push origin main
```

That's the whole flow. Then watch it land: Render dashboard → **autodex** →
*Events* / *Logs*. A deploy is done when the health check on `/` passes.

To deploy without a code change (for example after editing an env var), use
**Manual Deploy → Deploy latest commit** in the dashboard. Changing an env var
already triggers a restart on its own.

Verify afterwards:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://autodx.io/
```

## Environment variables

`NODE_ENV`, `DATABASE_URL`, `SECRET_SESSION` and `BASE_URL` are set by
`render.yaml` — `DATABASE_URL` from the managed database, `SECRET_SESSION`
generated once by Render and kept stable across deploys. Note the name:
`SECRET_SESSION`, not `SESSION_SECRET`; the app refuses to boot without it.

The rest are marked `sync: false` and must be filled in the dashboard, never
committed: `EMAIL_FROM`, `RESEND_API_KEY`, `UKEY` (Unsplash),
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
`EMAIL_FROM` is currently unset in the dashboard; `config/email.js` falls back
to `AutoDex <noreply@autodx.io>`, so set it there if that address ever changes.
`SENTRY_DSN` is optional: leave it unset and error tracking stays off
(`instrument.js`); set it to a Sentry project's DSN to report server errors
(no cookies, IPs or emails are sent). `.env.example` documents all of them.

## Editing the blueprint

The service is Blueprint-managed, so treat plan, region, commands and env var
declarations in `render.yaml` as live configuration, not documentation: a sync
can overwrite settings changed only in the dashboard. Keep the two in step.

In practice the blueprint has synced exactly once (the original apply on
2026-09-01, which the dashboard still shows as **Failed sync** because that
first deploy failed before the secrets were filled in). Deploys have run on
auto-deploy ever since, independent of blueprint syncs — which is why deleting
`render.yaml` in `22a1ee8` broke nothing visible. A **Manual sync** from the
blueprint page clears that stale state and re-applies the file; do it
deliberately, not as routine maintenance.

## Migrations

Migrations run in the build command on every deploy, and are idempotent via the
`SequelizeMeta` table. A migration that fails fails the build, and Render keeps
the previous version serving.

Before deploying a migration that rewrites existing data, rehearse it against a
dump of production (connection string: dashboard → `autodex-db` → *Connect* →
External Connection):

```bash
pg_dump "$RENDER_EXTERNAL_DATABASE_URL" > prod.sql
createdb autodex_prodtest && psql autodex_prodtest < prod.sql
DATABASE_URL=postgres:///autodex_prodtest NODE_ENV=production npx sequelize-cli db:migrate
dropdb autodex_prodtest
```

Watch the build log for warnings the migrations emit — `20260916000000` logs
colliding user emails rather than deleting them, and those have to be resolved
by hand. (On the 2026-09-17 deploy it logged none, so there are no collisions
outstanding.)

## One-off scripts

Run them in **Render Shell** (dashboard → service → *Shell*), where the
service's environment is already loaded:

```bash
node scripts/recount-favcounts.js     # recompute cars.favcount
node scripts/purge-junk-cars.js       # dry run: junk catalog rows, nothing deleted
node scripts/purge-junk-cars.js --apply
```

## Files

| File | Purpose |
| ---- | ------- |
| `render.yaml` | Blueprint: web service, database, build/start commands, env vars |
| `.env.example` | Template for all required environment variables |

## Troubleshooting

### Deploy fails during build

Open the failed deploy's log in the dashboard. The usual causes are a migration
error (fix it, push again — the old version is still serving) and a missing
dependency in `package.json` (`npm ci` installs from the lockfile only, so a
package that only exists locally will not be there).

### App boots, then 500s

Check the service logs. The most common cause is a missing env var: the app
refuses to boot without `SECRET_SESSION`, and Cloudinary/Resend/Unsplash
features fail at call time if their keys are unset. Confirm the `sync: false`
keys are all filled in the dashboard.

### Database connection errors

Confirm `DATABASE_URL` is still wired to `autodex-db` in the service's
Environment tab — that link breaks if the database is recreated. The free
Postgres tier has no backups and expires; `autodex-db` is on `basic-256mb`
deliberately, so keep it on a paid plan.

### Domain or TLS problems

Dashboard → service → *Settings* → **Custom Domains** shows verification and
certificate state for `autodx.io`. DNS must point at Render (the apex resolves
to Render's anycast addresses); if it points anywhere else, visitors are not
reaching this service at all.
