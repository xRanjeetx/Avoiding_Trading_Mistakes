import { useEffect, useState } from "react";
import { fmtDuration } from "../lib/killzones.js";
import { NEWS_PAIRS, blocks, calendarState, newsEvents, newsOf, paginate, pruneEvents, withNewsDraft } from "../lib/news.js";
import { CardHead, Icon } from "./ui.jsx";

const when = (at) => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (ms) => {
  const min = Math.max(0, Math.round(ms / 60000));
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};
const PAGE_SIZE = 5; // upcoming events per page
const IMPACT = { high: ["bad", "High"], medium: ["warn", "Medium"] };

// Everything about news: the automatic calendar, how long before news trading stops, the list of upcoming events and the
// user's own events. Every change is saved at once (onSave takes the whole news settings).
export default function News({ active, settings, calendar, now, onSave, onRefresh }) {
  const news = newsOf(settings);
  const t = now.getTime();
  const state = calendarState(settings, calendar, now);

  const [lead, setLead] = useState(String(news.leadMin));
  useEffect(() => { setLead(String(news.leadMin)); }, [news.leadMin]);
  useEffect(() => { if (active) onRefresh(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draft, setDraft] = useState({ when: "", title: "" });
  const canAdd = withNewsDraft(news, draft) !== news;

  const save = (patch) => onSave({ ...news, ...patch, events: pruneEvents(patch.events ?? news.events, t) });
  const leadNum = Math.min(1440, Math.max(1, Math.round(Number(lead) || news.leadMin)));
  async function add() {
    if (!canAdd) return;
    if (await save({ events: withNewsDraft(news, draft).events })) setDraft({ when: "", title: "" });
  }
  const removeOwn = (e) => save({ events: news.events.filter((x) => !(x.at === e.at && x.title === e.title)) });

  const upcoming = newsEvents(settings, calendar, now).filter((e) => e.at > t);
  const [pageNo, setPageNo] = useState(1);
  const pg = paginate(upcoming, pageNo, PAGE_SIZE);
  const inWindow = (e) => e.at - news.leadMin * 60000 <= t;

  return (
    <section id="news" className={`tab ${active ? "active" : ""}`}>
      <div className="card">
        <CardHead icon="calendar" title="Automatic calendar">
          {state === "ok" && <span className="chip good">Live</span>}
          {state === "unavailable" && <span className="chip warn">Unavailable</span>}
          {state === "off" && <span className="chip">Off</span>}
        </CardHead>
        <ul className="rule-edit">
          <li>
            <label>
              <input type="checkbox" className="rb-input" checked={news.auto} onChange={() => save({ auto: !news.auto })} />
              <i className={`rb ${news.auto ? "on" : "off"}`} aria-hidden="true"><Icon name={news.auto ? "check" : "x"} size={16} /></i>
              <span><b>Use the automatic calendar</b><small>High-impact news blocks trading, for the pairs it affects</small></span>
            </label>
          </li>
          <li>
            <label>
              <input type="checkbox" className="rb-input" checked={news.includeMedium} disabled={!news.auto} onChange={() => save({ includeMedium: !news.includeMedium })} />
              <i className={`rb ${news.auto && news.includeMedium ? "on" : "off"}`} aria-hidden="true"><Icon name={news.auto && news.includeMedium ? "check" : "x"} size={16} /></i>
              <span><b>Warn about medium-impact news</b><small>A heads-up only, it never blocks</small></span>
            </label>
          </li>
        </ul>
        <p className="muted hint news-status">
          {state === "ok" && <>Covers {NEWS_PAIRS.join(", ")}. Updated {ago(t - calendar.updatedAt)}, refreshed about every hour.</>}
          {state === "unavailable" && <>The calendar could not be loaded, so only the news you add below can lock trading.</>}
          {state === "off" && <>Only the news you add below can lock trading.</>}
        </p>
      </div>

      <div className="card">
        <CardHead icon="clock" title="Stop trading before news" />
        <div className="row news-lead">
          <label className="field"><span>Minutes before each event</span>
            <input type="number" min="1" max="1440" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && leadNum !== news.leadMin && save({ leadMin: leadNum })} /></label>
          <button type="button" className="btn small" disabled={leadNum === news.leadMin} onClick={() => save({ leadMin: leadNum })}><Icon name="check" size={16} /> Save</button>
        </div>
      </div>

      <div className="card news-card">
        <CardHead icon="alert" title="Upcoming news"><span className="chip">{upcoming.length}</span></CardHead>
        <ul className="rule-edit news-list">
          {pg.items.map((e) => {
            const [cls, label] = IMPACT[e.impact] || [];
            return (
              <li key={`${e.source}-${e.at}-${e.title}`} className={inWindow(e) && blocks(e) ? "news-locked" : ""}>
                <span>
                  <b>{e.title || "High-impact news"}</b>
                  <small>{when(e.at)} · in {fmtDuration(Math.ceil((e.at - t) / 60000))} · {e.source === "manual" ? "all pairs" : e.pairs.join(", ")}</small>
                </span>
                <span className="row">
                  {inWindow(e) && blocks(e) && <span className="chip bad"><Icon name="lock" size={12} /> Locked</span>}
                  {inWindow(e) && !blocks(e) && <span className="chip warn"><Icon name="alert" size={12} /> Warning</span>}
                  {e.source === "auto" ? <span className={`chip ${cls}`}>{label}</span> : <span className="chip">Yours</span>}
                  {e.source === "manual" && (
                    <button type="button" className="btn small danger-outline" aria-label={`Remove news ${e.title || when(e.at)}`} onClick={() => removeOwn(e)}><Icon name="trash" size={16} /></button>
                  )}
                </span>
              </li>
            );
          })}
          {!upcoming.length && <li><span><small>No news coming up.</small></span></li>}
        </ul>
        {pg.pages > 1 && (
          <div className="pager">
            <span className="muted">{pg.from}–{pg.to} of {pg.total}</span>
            <div className="pager-ctl">
              <button type="button" className="btn ghost sm" disabled={pg.page <= 1} aria-label="Previous page" onClick={() => setPageNo(pg.page - 1)}>Prev</button>
              <span className="muted">Page {pg.page} of {pg.pages}</span>
              <button type="button" className="btn ghost sm" disabled={pg.page >= pg.pages} aria-label="Next page" onClick={() => setPageNo(pg.page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <CardHead icon="plus" title="Add your own news" />
        <div className="rule-add">
          <input type="datetime-local" aria-label="News date and time" value={draft.when} onChange={(e) => setDraft((d) => ({ ...d, when: e.target.value }))} />
          <input placeholder="Name, e.g. NFP or FOMC (optional)" maxLength={60} aria-label="News name" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          <button type="button" className="btn small" disabled={!canAdd} onClick={add}><Icon name="plus" size={16} /> Add news</button>
        </div>
      </div>
    </section>
  );
}
