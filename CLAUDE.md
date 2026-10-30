# Trade Guard

Pre-trade checklist and trading journal. React (Vite) frontend, FastAPI + SQLAlchemy backend, PostgreSQL in production (SQLite locally).

## Layout
- `backend/app/main.py`: app setup only. Endpoints live in `routers/` (`auth`, `twofactor`, `settings`, `entries`, `admin`, `images`, `library`, `news_calendar`).
- `backend/app/core/`: `config` (env vars), `db`, `security` (JWT), `migrations` (runs Alembic at startup), `totp`/`crypto` (two-factor codes, encrypting the 2FA seed). Schema revisions live in `backend/app/migrations/versions/`.
- `backend/app/models/`, `schemas/`: tables and request/response shapes, split by domain; `__init__.py` re-exports every name.
- `backend/app/services/`: `mailer`, `storage`. `cli/`: `create_admin`. `data/library/`: the Learning PDFs.
- `frontend/src/pages/` one file per screen, `components/` shared pieces, `lib/` pure logic (no React), `api/` fetch client, `styles/` CSS (`index.css` sets the cascade order; theme is last).
- `deploy/render.yaml` (Render blueprint), `scripts/` (Windows dev helpers), `docs/`, `docker-compose.yml`.

## Commands
- Run API: `cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload`
- Run web: `cd frontend; npm run dev` (Vite proxies `/api` to :8000)
- Backend tests: `cd backend; .\.venv\Scripts\python.exe -m pytest` (SQLite). `$env:TEST_DB="postgres"` for PostgreSQL.
- Frontend tests: `cd frontend; npm test`. Build: `npm run build`.
- Browser e2e (manual): see README, files in `frontend/tests/e2e/`.
- Create admin: `python -m app.cli.create_admin EMAIL PASSWORD` (from `backend`). Admin locked out of 2FA: `python -m app.cli.reset_2fa EMAIL`.

## Conventions
- Node is at `C:\Program Files\nodejs`; add it to PATH if `npm` is not found.
- JSON uses camelCase, Python uses snake_case (`CamelModel` converts).
- Tests monkeypatch where a name is used, e.g. `routers.auth.send_link_email`, `routers.admin.send_link_email`. Keep that in mind when moving imports.
- New tables or columns: change the model, then from `backend` run `.\.venv\Scripts\alembic.exe revision --autogenerate -m "what changed"`, read the generated file in `app/migrations/versions/` (use `sa.true()`/`sa.false()` for boolean defaults, not `sa.text('1')`), and commit it with the model. The API applies it at startup. `tests/test_migrations.py` fails if a model and the revisions disagree. Never edit a revision that has been deployed; add a new one.
- Dependencies: runtime in `backend/requirements.txt`, test tools in `requirements-dev.txt`.
- Tests must never touch a real journal database: `conftest.py` refuses non-test database names.
- Never commit `.env` files or `*.db`.
