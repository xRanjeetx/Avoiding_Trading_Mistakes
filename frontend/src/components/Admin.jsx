import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.js";
import { CardHead, Icon } from "./ui.jsx";

const TILES = [
  ["totalUsers", "Users"], ["verifiedUsers", "Verified"], ["activeLast7Days", "Active 7d"],
  ["newLast7Days", "New 7d"], ["disabledUsers", "Disabled"], ["totalEntries", "Entries"],
];

const day = (iso) => (iso ? new Date(iso + "Z").toLocaleDateString() : "—");

// Admin-only page. Shows counts and win rate per user, never trade contents.
export default function Admin({ active, confirm, say, onExpired }) {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null); // `${id}:${action}`
  const [error, setError] = useState("");

  const guard = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onExpired();
      else if (err instanceof ApiError) say(err.message);
      else say("Something went wrong.");
      return undefined;
    }
  }, [onExpired, say]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [o, u] = await Promise.all([api.adminOverview(), api.adminUsers(q)]);
      setOverview(o);
      setUsers(u);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onExpired();
      else setError(err.message);
    }
  }, [q, onExpired]);

  // Refresh when the tab opens and (debounced) when the search changes.
  useEffect(() => {
    if (!active) return undefined;
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [active, load]);

  const run = async (user, action, fn, doneMsg) => {
    setBusy(`${user.id}:${action}`);
    const ok = await guard(async () => { await fn(); return true; });
    setBusy(null);
    if (ok) { say(doneMsg); load(); }
  };

  const toggle = async (u) => {
    if (u.isActive) {
      const ok = await confirm({ title: "Disable this account?", text: `${u.email} will be signed out and cannot log in until you enable it again. Their data is kept.`, okLabel: "Disable" });
      if (!ok) return;
    }
    run(u, "active", () => api.adminSetActive(u.id, !u.isActive), u.isActive ? "Account disabled." : "Account enabled.");
  };
  const remove = async (u) => {
    const ok = await confirm({ title: "Delete this user?", text: `${u.email} and all of their trades will be erased. This cannot be undone.`, okLabel: "Delete user" });
    if (ok) run(u, "delete", () => api.adminDeleteUser(u.id), "User deleted.");
  };

  return (
    <section id="admin" className={`tab ${active ? "active" : ""}`}>
      {error && <div className="banner">{error}</div>}

      <div className="admin-tiles">
        {TILES.map(([key, label]) => (
          <div className="stat" key={key}>
            <small>{label}</small>
            <span>{overview ? overview[key] : "…"}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <CardHead icon="user" title="Users">
          <label className="admin-search">
            <Icon name="search" size={16} />
            <input type="search" placeholder="Search email" aria-label="Search users by email" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </CardHead>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>Email</th><th>Status</th><th>Joined</th><th>Trades</th><th>Closed</th><th>Win %</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "off"}>
                  <td className="em">{u.email}</td>
                  <td>
                    {u.isAdmin && <span className="chip admin">Admin</span>}
                    {!u.isActive ? <span className="chip bad">Disabled</span>
                      : !u.emailVerified ? <span className="chip warn">Unverified</span>
                      : <span className="chip good">Active</span>}
                  </td>
                  <td>{day(u.createdAt)}</td>
                  <td>{u.entries}</td>
                  <td>{u.closedTrades}</td>
                  <td>{u.winRate == null ? "—" : `${u.winRate}%`}</td>
                  <td className="acts">
                    {!u.isAdmin && (
                      <>
                        {!u.emailVerified && (
                          <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => run(u, "verify", () => api.adminVerify(u.id), "Email marked verified.")}>Verify</button>
                        )}
                        <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => run(u, "reset", () => api.adminSendReset(u.id), "Password reset email sent.")}>Reset</button>
                        <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => toggle(u)}>{u.isActive ? "Disable" : "Enable"}</button>
                        <button type="button" className="btn danger-outline sm" disabled={!!busy} onClick={() => remove(u)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {overview && users.length === 0 && <tr><td colSpan="7" className="muted">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
