# Trade Guard: Avoid Trading Mistakes

A pre-trade checklist built from 27 personal trading rules, plus a full trading journal (P&L, R-multiples, equity curve, calendar, profit factor, drawdown, win rate, results by pair, setup and weekday). It shows **OK TO TRADE** only when every rule passes, and locks for the day once the trade or SL limit is reached.

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

Run the API tests with `cd backend; python -m pytest`.

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

Optional: ping `<api-url>/api/health` every 10 minutes with a free monitor such as UptimeRobot to avoid the cold start.

## Configuration (API environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite:///./dev.db` | PostgreSQL connection string |
| `SECRET_KEY` | dev value | Signs login tokens. **Must be set in production** |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed frontend origins |
| `ALLOW_REGISTRATION` | `true` | Set `false` to close sign-ups |
| `TOKEN_DAYS` | `30` | How long a login lasts |

## Notes
- Session times use the device's local time. The defaults are for IST: London 12:30–17:30, your session 18:00–22:30. Change them in **Settings**.
- The offline/PWA service worker was dropped, because the app now needs the API. Your journal lives in PostgreSQL; Neon keeps its own backups and point-in-time restore.
