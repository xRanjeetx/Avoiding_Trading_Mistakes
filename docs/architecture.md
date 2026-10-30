# Architecture

## Backend (`backend/app`)
| Folder | Contents |
|--------|----------|
| `main.py` | Creates the FastAPI app, middleware, startup, and registers the routers |
| `core/` | `config` (environment), `db` (engine/session), `security` (JWT, passwords), `migrations` (adds columns to existing tables) |
| `routers/` | `auth`, `settings`, `entries`, `admin`, `images`, `library`, `news_calendar` |
| `services/` | `mailer` (SMTP), `storage` (screenshot storage) |
| `cli/` | `create_admin` |
| `models/` | SQLAlchemy tables: `user`, `entry`, `library`, `calendar` |
| `schemas/` | Pydantic request/response shapes: `base`, `auth`, `settings`, `entry` |

`images`, `library` and `news_calendar` still keep their domain logic next to their routes.

## Frontend (`frontend/src`)
| Folder | Contents |
|--------|----------|
| `pages/` | One component per screen (Landing, Login, Today, Journal, Stats, ...) |
| `components/` | Shared pieces used by several pages |
| `lib/` | Pure logic with no React: rules, stats, formatting, CSV |
| `api/` | Fetch client and session handling |
| `styles/` | CSS split by layer (base, landing, shell, pages, theme); `index.css` imports them in cascade order |

## Tests
- `backend/tests`: API tests (`pytest`).
- `frontend/tests/unit`: logic tests (`npm test`).
- `frontend/tests/e2e`: browser tests, run by hand (see README).
