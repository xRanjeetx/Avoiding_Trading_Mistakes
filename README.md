# Trade Guard: Avoid Trading Mistakes

A pre-trade checklist built from 27 personal trading rules, plus a full trading journal (P&L, R-multiples, equity curve, calendar, profit factor, drawdown, win rate, results by pair, setup and weekday). It shows **OK TO TRADE** only when every rule passes, and locks for the day once the trade or SL limit is reached.

Also: editable rules (switch any off, add your own), a **News** tab that locks trading before high-impact news (pulled automatically from a free calendar, plus any you add), an emotion tag on every trade, CSV export and import, and a **Learning** tab with a fixed set of PDF books (strategy, psychology, analysis) that everyone reads in the app.

**Stack:** React (Vite) · FastAPI · PostgreSQL. Each user has a login, and the journal is stored in the database, so it follows you across devices.

```
backend/           FastAPI + SQLAlchemy + JWT login
  app/core/          config, database, security, schema migrations
  app/routers/       API endpoints, one file per domain
  app/models/        database tables
  app/schemas/       request/response shapes
  app/services/      mail and image storage
  app/cli/           command-line tools (create_admin)
  data/library/      the Learning PDFs
  tests/             API tests
frontend/          React app (Vite)
  src/pages/         one file per screen
  src/components/    shared UI pieces
  src/lib/           pure logic (rules, stats, formatting)
  tests/unit/        logic tests    tests/e2e/   browser tests
deploy/render.yaml Render blueprint for the API
scripts/           start.cmd / stop.cmd (Windows dev helpers)
docs/              architecture and deployment notes
docker-compose.yml whole stack in containers
```

See [docs/architecture.md](docs/architecture.md) and [docs/deployment.md](docs/deployment.md).

## Run locally

You need Python 3.11+, Node.js 18+ and (optionally) PostgreSQL. Without `DATABASE_URL` the API uses a local SQLite file, which is fine for trying it out.

```powershell
# terminal 1: API on http://localhost:8000  (docs at /docs)
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload

# terminal 2: web app on http://localhost:5173
cd frontend
npm install
npm run dev
```

To use local PostgreSQL instead of SQLite, set `DATABASE_URL=postgresql://user:pass@localhost:5432/tradeguard` before starting the API. Tables are created automatically on startup.

## Tests

```powershell
# API tests on SQLite (fast)
cd backend; .\.venv\Scripts\python.exe -m pytest

# API tests on the real local PostgreSQL. Uses a SEPARATE database named tradeguard_test
# (create it once: CREATE DATABASE tradeguard_test). The tests refuse to run against any
# database whose name does not look like a test database, so your journal is never touched.
$env:TEST_DB = "postgres"; .\.venv\Scripts\python.exe -m pytest

# Frontend logic (rules, stats, formatting)
cd frontend; npm test

# Browser end-to-end (needs Edge or Chrome). Start the API against the TEST database and the
# frontend dev server first, e.g. API on :8765 and `API_PROXY=http://localhost:8765 npx vite --port 5199`
$env:E2E_URL = "http://localhost:5199"; node tests/e2e/app.e2e.mjs
```

## Deploy for free

| Part | Service | Free-tier behaviour |
|------|---------|---------------------|
| Database | [Neon](https://neon.tech) PostgreSQL | 0.5 GB, no expiry. Pauses when idle and wakes in about a second. |
| API | [Render](https://render.com) web service | Sleeps after ~15 min idle; the first request then takes 30–60 s. |
| Web app | [Vercel](https://vercel.com), Netlify or Cloudflare Pages | Static hosting, always on. |

Free-tier limits change, so check each site's current pricing page. Do not use Render's own free PostgreSQL: it is deleted after a short trial period.

1. **Push to GitHub.** Create a repository and push this folder (`.gitignore` already excludes `node_modules`, `.venv` and `.env`).
2. **Database.** In Neon, create a project and copy the connection string (`postgresql://...?sslmode=require`).
3. **API on Render.** New → *Blueprint*, pick your repo (set the blueprint path to `deploy/render.yaml`). When asked, set:
   - `DATABASE_URL`: the Neon string
   - `CORS_ORIGINS`: your frontend URL (you can fill this in after step 4, then redeploy)

   `SECRET_KEY` is generated for you. Note the API URL, e.g. `https://trade-guard-api.onrender.com`. Check `<url>/api/health` returns `{"ok": true}`.
4. **Web app on Vercel.** New project → import the repo, set *Root Directory* to `frontend`, and add the environment variable `VITE_API_URL` = your Render URL (no trailing slash). Deploy.
5. Go back to Render and set `CORS_ORIGINS` to the Vercel URL, e.g. `https://trade-guard.vercel.app`.
6. Open the site and **Sign up**. Then set `ALLOW_REGISTRATION=false` on Render so nobody else can create accounts.

### Auto-deploy (CI/CD)

Once steps 1-6 are done, nothing else is needed per release:

1. You push or merge to `main`.
2. GitHub Actions (`.github/workflows/ci.yml`) runs the API tests on a real PostgreSQL, the frontend tests, and the production build.
3. If CI is green, Render redeploys the API (`autoDeployTrigger: checksPass` in `deploy/render.yaml`) and Vercel rebuilds the web app. Pull requests get a Vercel preview URL but are never deployed to production.

Turn on "Require status checks to pass" for `main` in GitHub → Settings → Branches so a red build can't be merged. Database tables are created on API startup, so schema changes in code roll out with the deploy; for destructive schema changes use a migration tool (e.g. Alembic) first.

**Security headers.** The web app's headers (CSP, HSTS, nosniff, frame and referrer rules) are in `frontend/vercel.json` and `frontend/nginx.conf`. The CSP allows API calls to `https://*.onrender.com`; if the API gets a custom domain, add it to `connect-src` in both files. If you edit the inline theme script in `frontend/index.html`, update its hash there too (`npm test` fails until you do).

Optional: ping `<api-url>/api/health` every 10 minutes with a free monitor such as UptimeRobot to avoid the cold start.

## Configuration (API environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite:///./dev.db` | PostgreSQL connection string |
| `SECRET_KEY` | dev value | Signs login tokens. **Must be set in production** |
| `PROXY_HOPS` | `0` | How many proxies add to `X-Forwarded-For` in front of the API (Render: `1`). Rate limits use the address this picks, so check it: with `1` the address in your Render logs for a request from your own phone should be yours |
| `RATE_LIMIT_ENABLED` | `true` | Limits, counted in memory per server: 5 wrong passwords per email per 15 min, 30 logins and 10 sign-ups per address, 3 reset/verification emails per address per hour. Resets when the server restarts |
| `BREACH_CHECK_ENABLED` | `true` | Rejects passwords found in known breaches (Have I Been Pwned; only the first 5 characters of a SHA-1 are sent, and sign-up still works if the service is down) |
| `TURNSTILE_SECRET` | empty | Optional free Cloudflare Turnstile secret. With it (and `VITE_TURNSTILE_SITE_KEY` on the web app) sign-up and forgot-password need the human check. |
| `ENVIRONMENT` | empty | `production` (also assumed on Render) enables HSTS, hides `/docs`, and **refuses to start** with a default/short `SECRET_KEY`, `*`/localhost/non-https `CORS_ORIGINS`, SQLite, or no `SMTP_HOST` (email verification is always on in production) |
| `TRUSTED_HOSTS` | empty | Optional comma-separated Host names the API answers to (e.g. `trade-guard-api.onrender.com`) |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed frontend origins |
| `ALLOW_REGISTRATION` | `true` | Set `false` to close sign-ups |
| `REQUIRE_ADMIN_APPROVAL` | `true` in production, else `false` | New sign-ups must be approved by an admin before they can log in (see *Approving sign-ups*) |
| `ADMIN_REQUIRE_2FA` | `true` in production, else `false` | Admins must have two-factor sign-in on to use the admin tools |
| `MAX_BODY_BYTES` | 5 MB | Largest request body the API accepts (checked while it streams in). Keep it in line with `client_max_body_size` in `frontend/nginx.conf` |
| `MAX_USER_IMAGE_BYTES` | 150 MB | All screenshots of one account together. Each upload is also limited to `MAX_IMAGE_BYTES`, 25 megapixels, and 60 uploads per 10 minutes |
| `SENTRY_DSN` | empty | Optional [Sentry](https://sentry.io) project address (free tier). Unhandled errors are reported without request bodies, cookies or user details |
| `LOG_LEVEL` | `INFO` | Python log level. Security events (failed and locked logins, reuse of a stolen login, resets) are logged by `tradeguard.security` with the address and account id, never passwords or tokens |
| `ACCESS_MINUTES` | `15` | How long an access token works. The app renews it silently from the refresh cookie |
| `TOKEN_DAYS` | `30` | How long a login survives without use (each renewal restarts the clock) |
| `SESSION_MAX_DAYS` | `90` | Absolute limit: after this the user logs in again however active they are |
| `COOKIE_SAMESITE` | `none` in production, `lax` locally | SameSite of the refresh cookie. `none` lets a Vercel app and a Render API on different domains share it, but Safari blocks such cookies. Use `strict` after the setup below |
| `APP_URL` | `http://localhost:5173` | Your frontend URL. Used in the links inside emails |
| `SMTP_HOST` | empty | Any SMTP server. **Leave empty to turn email off**: links are printed in the API log and sign-ups log in directly |
| `SMTP_PORT` | `587` | `587` for STARTTLS, `465` with `SMTP_SSL=true` |
| `SMTP_USER` / `SMTP_PASSWORD` | empty | SMTP login (for Gmail use an app password) |
| `SMTP_FROM` | `SMTP_USER` | The From address on emails |
| `REQUIRE_EMAIL_VERIFICATION` | `true` when `SMTP_HOST` is set | New accounts must click the emailed link before logging in. Accounts created earlier count as verified |
| `LIBRARY_DIR` | `backend/data/library` | Folder of PDFs loaded into the Learning tab at startup, shown to every user (read-only). See `backend/data/library/README.md` |
| `CALENDAR_ENABLED` | `true` | Set `false` to stop downloading the news calendar (only the news users add by hand then lock trading) |
| `VERIFY_HOURS` / `RESET_MINUTES` | `48` / `60` | How long the verification and reset links last |
| `MAX_IMAGE_BYTES` / `MAX_IMAGES_PER_USER` | 2 MB / `600` | Limits per screenshot and per account. The app shrinks screenshots to about 150-300 KB first |

News (News tab): the server downloads the free ForexFactory-style weekly calendar (`nfs.faireconomy.media`) and keeps the high-impact events (medium ones optionally) in the `calendar_events` table. One download serves every user, and it is repeated at most once an hour (the feed is unofficial and allows only a few downloads per IP), on the first request after the data gets old, so it also works on hosts that sleep. Calendar news covers three pairs only and is pair-specific: trading XAUUSD is affected by USD news, EURUSD by EUR and USD news, USDJPY by USD and JPY news. **High-impact** news blocks the pair for the lead time before it, **medium-impact** news only shows a warning (it can be switched off), and the user's own events block every pair. If the calendar cannot be loaded or is over a day old, the rule still passes but says "Auto calendar unavailable: only the news you added is checked", and the last good events are kept. `CALENDAR_ENABLED=false` switches it off, and `CALENDAR_URLS`, `CALENDAR_REFRESH_MIN` and `CALENDAR_RETRY_MIN` tune it.

Loss limits (Settings > Loss limits): set a **daily** and an **overall** max loss in money. Before each trade the checklist works out the money its stop loss risks (`|entry - SL| x lot x value`) and fails the "Within Loss Limits" rule if that is more than what is left. What is left is `limit + net P&L - risk of trades still open`, so a profit gives room back (daily limit 20 and +30 today leaves 50). "Value" is what 1 lot gains or loses per 1.00 price move: XAUUSD (100), EURUSD (100000) and USDJPY (100000 / price) are built in, and any other pair needs its value typed in Settings > Pairs. The overall count can be restarted with "Start from now" for a new challenge or account.

Trade screenshots: the server decodes every upload and stores its own WebP re-encoding, so camera metadata (such as location) and anything hidden inside the file are removed, and pictures are scaled to at most 4096 pixels on the longest side. Each entry can hold a **Before** and an **After** image, added from the close/edit sheet (pick a file, or paste with Ctrl+V). The API checks the login before returning an image. Deleting a trade, all data or the account deletes its images too. Screenshots are stored in the database (table `stored_images`) and take about 150-300 KB each, so they count towards your database size.

**Logins.** Logging in returns a 15-minute access token that the web app keeps in memory only (nothing secret is stored in `localStorage`), and sets a refresh token as an `HttpOnly` cookie limited to `/api/auth`. The database stores only a hash of the refresh token (table `auth_sessions`, one row per device). The cookie is replaced on every use; if an old one is replayed after a 30 second grace period the session is revoked. Logout, "Log out of all devices" (Settings), a password reset and an admin disabling the account all end sessions at once, not when a token expires. Users who were logged in before this change must log in once more.

**Recommended for production: serve the API from the web app's domain.** Browsers such as Safari block cookies that a page on `vercel.app` receives from `onrender.com`, which would log those users out on every reload. To avoid this, add to `frontend/vercel.json`:

```json
"rewrites": [{ "source": "/api/:path*", "destination": "https://YOUR-API.onrender.com/api/:path*" }]
```

then remove `VITE_API_URL` from the Vercel project, redeploy, and on Render set `COOKIE_SAMESITE=strict`. The browser now only talks to one domain. `CORS_ORIGINS` must still be the Vercel URL, and `PROXY_HOPS` probably becomes `2` (Vercel and Render both add an address), so check it again as described above.

Forgot password and email verification use signed, expiring links, so they need no extra database tables. A reset link works once.

## Notes
- **Market sessions** (Asian 20:00-00:00, London 02:00-05:00, New York 07:00-10:00, London Close 10:00-12:00) are set in **Settings** in New York time, so US daylight saving needs no edit. The checklist rule "Trade Only in a Market Session" passes only while one of the switched-on sessions is live, and the Check tab shows which one that is, in your own clock. Existing databases get the new column automatically at startup.
- The offline/PWA service worker was dropped, because the app now needs the API. Your journal lives in PostgreSQL; Neon keeps its own backups and point-in-time restore.

## Database migrations
The schema is managed with [Alembic](https://alembic.sqlalchemy.org). The API applies any new revision itself at startup, and stops if that fails, so it never serves a half-upgraded database. The first revision (`0001`) is a baseline that only creates what is missing, so **the existing live database upgrades by itself on the first deploy, with no manual step and no data touched**. To change the schema, edit the model and run `alembic revision --autogenerate -m "what changed"` in `backend`, then review and commit the new file (see `CLAUDE.md`). Take a `pg_dump` before a deploy that contains a migration. Rolling back means restoring that dump; revisions are not written to be undone.

## Approving sign-ups
With `REQUIRE_ADMIN_APPROVAL` on (the default in production), a new user goes through: sign up, click the verification link, then **wait for an admin**. Until approved they cannot log in or use the API by any route (login, verification link, password reset, token refresh). When the email is verified every active admin gets an email, and the request appears in the **Admin** tab under *Sign-up requests* (also counted in the *Awaiting* tile). **Approve** emails the user that they can log in. **Reject** deletes the account (it holds no data) and the person may apply again. Accounts that already existed when this was switched on stay approved, and accounts an admin creates are approved. Set `REQUIRE_ADMIN_APPROVAL=false` to let verified users in directly again; people already waiting are not approved by that, so approve them first.

## Two-factor sign-in
Anyone can turn on two-factor sign-in in **Settings > Security** with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password...). They scan a QR code, confirm one code, and receive 10 single-use recovery codes. After that, logging in (and finishing a password reset) also needs a 6-digit code; a code works once. Wrong codes lock the account's second step for 15 minutes after 5 tries. **In production admins must have it on** (`ADMIN_REQUIRE_2FA`): a new admin signs in with the password, opens Settings > Security, turns it on, and the Admin tab then works.
- Seeds are stored encrypted with a key derived from `SECRET_KEY`. Rotating `SECRET_KEY` therefore makes every stored seed unreadable: those users have to set 2FA up again (clear it for them first, see below).
- A user who lost their phone and recovery codes: an admin uses `POST /api/admin/users/{id}/reset-2fa` (audited), which also signs them out everywhere.
- An admin locked out of their own account: run `python -m app.cli.reset_2fa EMAIL` from `backend` with the production `DATABASE_URL`.

## Backups, monitoring and audit
- **Database.** Use a connection string with `?sslmode=require` (Neon adds it). Neon keeps a short point-in-time history on the free plan; for your own copy run `pg_dump "$DATABASE_URL" -Fc -f trade-guard-$(date +%F).dump` regularly (for example weekly) and keep the file somewhere private. A backup you have never restored is not a backup: try `pg_restore` into a scratch database once. Do not store dumps as public GitHub artifacts.
- **Errors.** Set `SENTRY_DSN` to get an alert when the API crashes. Point a free uptime monitor (UptimeRobot) at `<api-url>/api/health`.
- **Dependencies.** Dependabot opens weekly pull requests, and the *Security audit* workflow (`pip-audit`, `npm audit`, `bandit`) runs weekly and on pull requests. It is separate from *CI* on purpose, so a newly published advisory never blocks a deploy; treat a red run as "update soon". Run the same checks locally from `backend` with `pip-audit -r requirements.txt` and `bandit -r app -ll`.
- **Admin audit log.** Every admin action (create, enable, disable, delete, verify, send reset) is stored with who, whom, when and from which address in the `audit_log` table. Read it as an admin at `GET /api/admin/audit`. New users are invited with a link to choose their own password; no password is ever emailed.
- **Account data.** Settings > Security > Download my data (`GET /api/auth/export`) gives users all their data as JSON.

## Admin account
Admins are stored in the database (`users.is_admin`); there is no env setting. Create or promote one from the `backend` folder:

```
python -m app.cli.create_admin admin@example.com "a-strong-password"
```

The account is created verified and enabled (an existing account with that email is promoted and its password reset). Run it against production with `DATABASE_URL` pointing at that database.
