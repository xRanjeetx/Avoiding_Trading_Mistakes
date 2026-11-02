import {
  KILLZONE_NAMES, activeZones, fmtDuration, marketStatus, minutesLeft, nextZone, normalizeKillzones, nyClock, nyToLocal,
} from "../lib/killzones.js";

// Which market session is live right now, and when the next one opens (shown on the Check tab).
export default function SessionStrip({ settings, now, closeLead = 5 }) {
  const zones = normalizeKillzones(settings.killzones);
  const live = activeZones(zones, now);
  const next = nextZone(zones, now);
  const market = marketStatus(now);
  const lead = live[0];
  const left = lead ? minutesLeft(lead, now) : null;
  const closing = lead && left <= closeLead;

  return (
    <div className={`kz-strip ${lead ? "live" : ""} ${closing ? "closing" : ""}`} style={lead ? { "--kz": closing ? "var(--warn)" : lead.color } : undefined}>
      <div className="kz-status">
        <span className="kz-pulse" aria-hidden="true" />
        <div>
          {lead ? (
            <>
              <b>{KILLZONE_NAMES[lead.key]} {closing ? "is closing" : "is live"}</b>
              <small>{closing ? "closes" : "ends"} in {fmtDuration(left)}</small>
            </>
          ) : !market.open ? (
            <>
              <b>Market closed for the weekend</b>
              <small>reopens Sunday 17:00 New York, in {fmtDuration(market.reopensInMin)}</small>
            </>
          ) : (
            <>
              <b>No session live</b>
              <small>{next ? `${KILLZONE_NAMES[next.zone.key]} opens in ${fmtDuration(next.inMin)}` : "All sessions are switched off"}</small>
            </>
          )}
        </div>
        <span className="chip" title="Current time in New York">NY {nyClock(now).label}</span>
      </div>
      <ul className="kz-chips">
        {zones.map((z) => (
          <li key={z.key} className={`${z.on ? "" : "off"} ${live.includes(z) ? "now" : ""}`} style={{ "--kz": z.color }}>
            <i aria-hidden="true" />
            <span>{KILLZONE_NAMES[z.key]}</span>
            <small>{nyToLocal(z.start, now)}–{nyToLocal(z.end, now)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
