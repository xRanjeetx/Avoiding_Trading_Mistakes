import {
  KILLZONE_NAMES, activeZones, fmtDuration, marketStatus, minutesLeft, nextZone, normalizeKillzones, nyClock, nyToLocal,
} from "../lib/killzones.js";

// Which market session is live right now, and when the next one opens (shown on the Check tab).
export default function SessionStrip({ settings, now }) {
  const zones = normalizeKillzones(settings.killzones);
  const live = activeZones(zones, now);
  const next = nextZone(zones, now);
  const market = marketStatus(now);
  const lead = live[0];

  return (
    <div className={`kz-strip ${lead ? "live" : ""}`} style={lead ? { "--kz": lead.color } : undefined}>
      <div className="kz-status">
        <span className="kz-pulse" aria-hidden="true" />
        <div>
          {lead ? (
            <>
              <b>{KILLZONE_NAMES[lead.key]} is live</b>
              <small>ends in {fmtDuration(minutesLeft(lead, now))}</small>
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
