# Deployment

## Render + Neon + Vercel
See the "Deploy for free" section of the README. The Render blueprint is `deploy/render.yaml`; when creating the Blueprint in Render, set its path to that file (Render looks for `render.yaml` at the repo root by default).

## Docker
```
cp .env.example .env     # then edit the values
docker compose up --build
```
The app is at http://localhost:8080. nginx serves the frontend and proxies `/api` to the backend; PostgreSQL data lives in the `pgdata` volume.

Create an admin account:
```
docker compose exec backend python -m app.cli.create_admin you@example.com "a-strong-password"
```

## Environment variables
See `backend/.env.example` and the table in the README.
