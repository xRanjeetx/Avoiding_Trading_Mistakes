# MT5 Guard: full plan

Status: proposal, nothing built yet. The app has no MT5 connection today; every journal entry is typed in by hand.

## 1. Goal

Make the rules in Trade Guard apply to the real trading account (The5ers $2.5k, MT5).

1. **Auto-journal.** Every MT5 position appears in the journal with accurate P&L, with no typing.
2. **Guard.** An Expert Advisor (EA) in MT5 enforces the rules that can be computed, and fixes or closes a position that breaks one.
3. **Checklist gate.** A position stays open only if the checklist said OK TO TRADE for it.

The EA never opens trades. Entries stay manual, so the checklist keeps its purpose and the prop-firm risk stays low.

## 2. Architecture

```
Trade Guard app (FastAPI + PostgreSQL)  <-- HTTPS -->  Guard EA (MQL5, on a VPS)  -->  MT5 account
  rules, settings, news, journal                        pulls rules, sends trades + heartbeat,
  checklist approvals                                   enforces on every trade event
```

- The EA calls the app. The app never connects to MT5, and the VPS needs no open ports.
- The EA caches the last good rules in a file. If the API is down (Render free tier sleeps), it keeps enforcing the cached rules. Protection never depends on the API being awake.
- The EA authenticates with its own device key, separate from the user login and 2FA. The key can only read the guard config and write guard data.

## 3. Rules and what the EA does

Rule numbers refer to [frontend/src/lib/rules.js](../frontend/src/lib/rules.js).

| Rule | Enforcement |
|---|---|
| 3 Lot size fixed | Wrong lot for the pair: close immediately. |
| 22 Move SL to cost at 1:1.5 | Automatic, no human action. |
| 15 Max trades per day | Extra position: close. |
| 8 No multiple trades in the same direction | Second same-direction position on a pair: close the new one. |
| 30 Cooldown after a loss (10 min, per pair) | Position opened inside the window: close. |
| 11 Trade only in a market session | Opened outside the enabled killzones (New York time): close. |
| 19 After max SL, stop trading | After the SL count is reached, close any new position. |
| 32 No trade before high-impact news | High-impact event: opened inside its lead window: close. Medium-impact event: warning only (alert on the chart and in the app, log it), never close. |
| 33 Within loss limits | Daily/overall loss from equity (including floating P&L) at the limit: block or close all (see section 9). |
| 17 self rules (emotion, FOMO, discipline, ...) | Cannot be automated. They stay in the checklist; the approval gate proves the checklist was passed, not that the answers were honest. |

Action policy:
- Prefer fixing (add SL, adjust TP) over closing.
- Close only when a rule cannot be fixed: wrong lot, extra trade, cooldown, session, news, no checklist.
- Every action is written to the MT5 Experts log, to a local CSV, and sent to the app.
- The EA reacts in `OnTradeTransaction` (the moment a position opens). A timer is only a backup.

## 4. Auto-journaling

The EA sends positions to the app. No separate script is needed.

- **One journal entry per MT5 position.** The entry id is the MT5 position id, so a resend updates the entry and never duplicates it.
- **Partial closes:** the EA sends one position with entry price, average exit price, total P&L and the close time.
- **P&L is net** of commission, swap and fees. This matches what the account earned and what The5ers counts.
- **Open positions** are sent as `open` and updated to `win`, `loss` or `breakeven` on close. This gives the open-risk part of the loss limits real data (see [risk.js](../frontend/src/lib/risk.js)).
- **Fields mapped:** pair, direction, lot, entry, SL, TP, exit, P&L, close time. RR is computed from entry, SL and TP.
- **Manual fields are never overwritten:** setup, emotion before/after, notes, lesson, screenshots. Synced trades that still lack them show a "needs your review" marker.
- **Synced numbers are read-only in the UI**, so the next sync cannot silently undo an edit.
- **Linking to the checklist:** when the approval gate is on, the approval carries the checklist result. The EA matches position to approval, so the entry gets its answers and failed rules automatically. A trade with no approval is marked "no checklist" and shows on the Discipline screen.
- **Retries:** failed sends go into a local queue file that survives an MT5 restart.
- **Symbol map:** an EA setting translates broker names (for example `XAUUSD.x`) to the journal's pair names.
- **Backfill:** on first run, optionally send the last N days of closed positions (default proposal: 30).

## 5. Backend work

In `backend/app`, following the conventions in CLAUDE.md.

1. **Models and migration**
   - `guard_keys` table: user, hashed key, label, created, last seen, revoked.
   - Entry gets `source` (`manual` or `mt5`) and `mt5_position_id`, unique per user.
   - Approvals table: user, pair, direction, entry, SL, TP, lot, checklist result, created, expires, matched position id.
   - Guard events table: user, time, rule, action, position, detail.
   - Generate each with `alembic revision --autogenerate`, read it, use `sa.true()`/`sa.false()` for booleans. `tests/test_migrations.py` must pass.
2. **`routers/guard.py`** (device-key auth, rate limited with `core/ratelimit`)
   - `GET /api/guard/config`: read-only snapshot of pairs and lots, `minRR`, `maxTrades`, `maxSL`, killzones, upcoming news events and lead time, loss limits, cooldown.
   - `POST /api/guard/trades`: upsert a batch of positions, validated with the existing entry schema.
   - `POST /api/guard/heartbeat`: EA version, account equity and balance, time.
   - `POST /api/guard/events`: the EA's actions.
   - `GET /api/guard/approvals`: valid approvals for the EA to match.
3. **User-facing endpoints** (normal login): create and revoke a key (the key is shown once), create an approval when the checklist reaches OK TO TRADE, list guard events.
4. **Tests** (`backend/tests/test_guard.py`): key auth and revocation, a key cannot reach any other route or another user's data, upsert and dedupe, partial close and commission/swap handling, approval expiry and single-use matching, config shape.

## 6. EA work (MQL5)

- Inputs: API URL, key, symbol map, enforce mode (`alert-only` or `enforce`), fail-safe mode (`strict` or `lenient`), default SL distance.
- Whitelist the API domain in MT5 under Tools > Options > Expert Advisors.
- Every 60 s: `GET /api/guard/config`, validate, save to the cache file. Invalid response or unreachable API: keep the cache and show a warning on the chart.
- Trade events: evaluate every rule in section 3, act, log, send the event.
- Trade sync: section 4, with the queue file.
- Daily loss and drawdown are computed from equity, which includes floating P&L. This is stricter than the app (closed trades only), which is the safe direction.
- Hard buffer: an EA-side limit at about 70 to 80% of The5ers' real daily/overall limits, set once the real rules are known. Personal limits always sit inside it.
- Pin a version. Never auto-update the EA on the live account.

## 7. Frontend work

- **Settings, Guard card:** create or revoke a key, live status ("EA online, last seen 12 s ago"), enforce mode shown read-only, install instructions.
- **Checklist:** when it reaches OK TO TRADE, create an approval for the planned trade (pair, direction, entry, SL, TP, lot) and show its remaining validity.
- **Journal:** synced entries show a source badge, locked numbers and the "needs your review" marker.
- **Discipline screen:** guard actions and "no checklist" trades, with a weekly count.
- **Offline alert:** if the EA has sent no heartbeat for more than 2 minutes, show a warning and notify you.

## 8. Phases and order

Each phase ships on its own and is useful alone.

| Phase | Content | Done when |
|---|---|---|
| 0 | Prerequisites (section 11): The5ers answers, demo account, VPS | Written confirmation from The5ers, demo MT5 running 24/7 |
| 1 | Backend foundation: models, migration, device key, trades/heartbeat endpoints, tests | `pytest` passes, a curl with a key upserts a position |
| 2 | EA sync-only: sends trades, enforces nothing | A week of demo trades; journal matches MT5 history exactly |
| 3 | Guard card and journal UI for synced trades | Key created from the app, EA status visible |
| 4 | EA enforcement of the section 3 rules, alert-only | The log lists correct "would have acted" lines, no false positives |
| 5 | Enforce mode on demo | Rules act as designed; false positives fixed |
| 6 | Config sync, news lock, equity-based loss limits, hard buffer | Changing a setting in the app changes EA behaviour within 60 s |
| 7 | Approval gate and checklist linking | Trade without approval is closed; trade with approval is kept and linked |
| 8 | Live: alert-only for a few days, then enforce | Live trades follow the same logs as demo |

## 9. Decisions (proposed defaults, change any)

1. **At the loss limit:** close all open positions and lock new trades for the day. (Alternative: only block new trades.)
2. **Approval gate when the API is unreachable:** `lenient` on demo (apply only the computable rules), `strict` on live once stable.
3. **Hedging (two positions in one pair):** assumed not used. Rule 8 treats a same-pair opposite position as a violation unless you say otherwise.
4. **Backfill on first run:** 30 days.
5. **Existing manual entries:** left untouched. Only new synced entries are marked `mt5`.
6. **Approval validity:** 10 minutes, single use, matched on pair, direction and entry price within a small tolerance.

## 10. Risks

- **Prop-firm rules.** The5ers may restrict EAs or require specific SL behaviour. A protective EA that only modifies or closes is lower risk than one that opens trades, but it must be confirmed in writing (section 11).
- **Closing costs money.** A rule-based close can realise a loss or spread. This is accepted only where the alternative is breaking the rule.
- **Broker differences.** Slippage, symbol names, hedging vs netting. Handled by the symbol map and demo testing.
- **A buggy EA is dangerous.** Mitigated by alert-only phases, demo first, pinned versions.
- **VPS outage means no protection.** Mitigated by the offline alert. Consider a second check from the app.
- **Time zones.** Killzones are New York time in the app; the EA must convert using the broker server time offset, including daylight saving.
- **Checklist honesty.** The gate proves the checklist was passed, not that answers were true.

## 11. Phase 0 checklist (before writing code)

1. Ask The5ers support in writing: does your specific $2.5k program allow an EA that only modifies and closes positions and never opens them? Keep the reply.
2. Get their exact daily-loss and overall-drawdown rules, whether they use equity or balance, and their stop-loss requirement. Set the hard buffer from these.
3. Confirm the account platform is MT5, the server name, and that `WebRequest` is allowed.
4. Open a demo account on the same broker and server type.
5. Choose and set up the VPS (or a home PC as a stopgap).

## 12. Testing

- Backend: pytest on SQLite and PostgreSQL (`TEST_DB=postgres`), as in CLAUDE.md.
- Frontend: `npm test` for new pure logic in `lib/`.
- EA: demo account only until Phase 8. For each rule, place a violating trade and a compliant one and check the log and the result.
- Reconciliation: after every sync-only week, compare journal totals and per-trade P&L against MT5 history.
