# Trade Guard: Avoid Trading Mistakes

A pre-trade checklist built from 27 personal trading rules, plus a full trading journal (P&L, R-multiples, equity curve, calendar, profit factor, drawdown, win rate, results by pair, setup and weekday). It shows **OK TO TRADE** only when every rule passes, and locks for the day once the trade or SL limit is reached.

Also: editable rules (switch any off, add your own), a **News** tab that locks trading before high-impact news (pulled automatically from a free calendar, plus any you add), an emotion tag on every trade, CSV export and import, and a **Learning** tab with a fixed set of PDF books (strategy, psychology, analysis) that everyone reads in the app, with each user's page remembered on every device.

**Stack:** React (Vite) · FastAPI · PostgreSQL. Each user has a login, and the journal is stored in the database, so it follows you across devices.

```
backend/    FastAPI + SQLAlchemy + JWT login      (tests in backend/tests)
frontend/   React app (Vite)
render.yaml Render blueprint for the API
```

## Run locally

You need Python 3.11+, Node.js 18+ and (optionally) PostgreSQL. Without `DATABASE_URL` the API uses a local SQLite file, which is fine for trying it out.

```powershell
# terminal 1: API on http://localhost:8000  (docs at /docs)
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
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
$env:E2E_URL = "http://localhost:5199"; node e2e/app.e2e.mjs
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
3. **API on Render.** New → *Blueprint*, pick your repo (it reads `render.yaml`). When asked, set:
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
3. If CI is green, Render redeploys the API (`autoDeployTrigger: checksPass` in `render.yaml`) and Vercel rebuilds the web app. Pull requests get a Vercel preview URL but are never deployed to production.

Turn on "Require status checks to pass" for `main` in GitHub → Settings → Branches so a red build can't be merged. Database tables are created on API startup, so schema changes in code roll out with the deploy; for destructive schema changes use a migration tool (e.g. Alembic) first.

Optional: ping `<api-url>/api/health` every 10 minutes with a free monitor such as UptimeRobot to avoid the cold start.

## Configuration (API environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite:///./dev.db` | PostgreSQL connection string |
| `SECRET_KEY` | dev value | Signs login tokens. **Must be set in production** |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed frontend origins |
| `ALLOW_REGISTRATION` | `true` | Set `false` to close sign-ups |
| `TOKEN_DAYS` | `30` | How long a login lasts |
| `APP_URL` | `http://localhost:5173` | Your frontend URL. Used in the links inside emails |
| `SMTP_HOST` | empty | Any SMTP server. **Leave empty to turn email off**: links are printed in the API log and sign-ups log in directly |
| `SMTP_PORT` | `587` | `587` for STARTTLS, `465` with `SMTP_SSL=true` |
| `SMTP_USER` / `SMTP_PASSWORD` | empty | SMTP login (for Gmail use an app password) |
| `SMTP_FROM` | `SMTP_USER` | The From address on emails |
| `REQUIRE_EMAIL_VERIFICATION` | `true` when `SMTP_HOST` is set | New accounts must click the emailed link before logging in. Accounts created earlier count as verified |
| `LIBRARY_DIR` | `backend/library` | Folder of PDFs loaded into the Learning tab at startup, shown to every user (read-only). See `backend/library/README.md` |
| `CALENDAR_ENABLED` | `true` | Set `false` to stop downloading the news calendar (only the news users add by hand then lock trading) |
| `VERIFY_HOURS` / `RESET_MINUTES` | `48` / `60` | How long the verification and reset links last |
| `MAX_IMAGE_BYTES` / `MAX_IMAGES_PER_USER` | 2 MB / `600` | Limits per screenshot and per account. The app shrinks screenshots to about 150-300 KB first |

News (News tab): the server downloads the free ForexFactory-style weekly calendar (`nfs.faireconomy.media`) and keeps the high-impact events (medium ones optionally) in the `calendar_events` table. One download serves every user, and it is repeated at most once an hour (the feed is unofficial and allows only a few downloads per IP), on the first request after the data gets old, so it also works on hosts that sleep. Calendar news covers three pairs only and is pair-specific: trading XAUUSD is affected by USD news, EURUSD by EUR and USD news, USDJPY by USD and JPY news. **High-impact** news blocks the pair for the lead time before it, **medium-impact** news only shows a warning (it can be switched off), and the user's own events block every pair. If the calendar cannot be loaded or is over a day old, the rule still passes but says "Auto calendar unavailable: only the news you added is checked", and the last good events are kept. `CALENDAR_ENABLED=false` switches it off, and `CALENDAR_URLS`, `CALENDAR_REFRESH_MIN` and `CALENDAR_RETRY_MIN` tune it.

Loss limits (Settings > Loss limits): set a **daily** and an **overall** max loss in money. Before each trade the checklist works out the money its stop loss risks (`|entry - SL| x lot x value`) and fails the "Within Loss Limits" rule if that is more than what is left. What is left is `limit + net P&L - risk of trades still open`, so a profit gives room back (daily limit 20 and +30 today leaves 50). "Value" is what 1 lot gains or loses per 1.00 price move: XAUUSD (100), EURUSD (100000) and USDJPY (100000 / price) are built in, and any other pair needs its value typed in Settings > Pairs. The overall count can be restarted with "Start from now" for a new challenge or account.

Trade screenshots: each entry can hold a **Before** and an **After** image, added from the close/edit sheet (pick a file, or paste with Ctrl+V). The API checks the login before returning an image. Deleting a trade, all data or the account deletes its images too. Screenshots are stored in the database (table `stored_images`) and take about 150-300 KB each, so they count towards your database size.

Forgot password and email verification use signed, expiring links, so they need no extra database tables. A reset link works once.

## Notes
- **Market sessions** (Asian 20:00-00:00, London 02:00-05:00, New York 07:00-10:00, London Close 10:00-12:00) are set in **Settings** in New York time, so US daylight saving needs no edit. The checklist rule "Trade Only in a Market Session" passes only while one of the switched-on sessions is live, and the Check tab shows which one that is, in your own clock. Existing databases get the new column automatically at startup.
- The offline/PWA service worker was dropped, because the app now needs the API. Your journal lives in PostgreSQL; Neon keeps its own backups and point-in-time restore.

## Admin account
Admins are stored in the database (`users.is_admin`); there is no env setting. Create or promote one from the `backend` folder:

```
python -m app.create_admin admin@example.com "a-strong-password"
```

The account is created verified and enabled (an existing account with that email is promoted and its password reset). Run it against production with `DATABASE_URL` pointing at that database.
