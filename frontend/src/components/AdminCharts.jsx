import { useState } from "react";

const W = 600, H = 190, PAD = { l: 30, r: 8, t: 10, b: 24 };
const IW = W - PAD.l - PAD.r, IH = H - PAD.t - PAD.b;

const fmtDay = (iso, long) => new Date(iso + "T00:00:00Z").toLocaleDateString([], { month: "short", day: "numeric", ...(long && { weekday: "short" }), timeZone: "UTC" });

// Whole-number axis: pick a step of 1, 2, 5, 10... so there are at most ~4 gridlines.
function scale(max) {
  const m = Math.max(max, 1);
  const raw = m / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw && Number.isInteger(s)) || Math.ceil(raw);
  const top = Math.max(step * Math.ceil(m / step), step * 2);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

// Bar with only the top (data end) corners rounded; the bottom sits flat on the baseline.
const barPath = (x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

function Chart({ title, note, data, field, kind }) {
  const [hoverRaw, setHover] = useState(null);
  // The data can be replaced (e.g. a new range) while the pointer is over the chart; ignore a stale index.
  const hover = hoverRaw != null && hoverRaw < data.length ? hoverRaw : null;
  const values = data.map((d) => d[field]);
  const total = values.reduce((a, b) => a + b, 0);
  const { top, ticks } = scale(Math.max(0, ...values));
  const band = IW / Math.max(data.length, 1);
  const cx = (i) => PAD.l + band * (i + 0.5);
  const y = (v) => PAD.t + IH * (1 - v / top);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(data.length - 1, Math.floor((x - PAD.l) / band))));
  };

  const line = data.map((d, i) => `${i ? "L" : "M"}${cx(i)},${y(d[field])}`).join("");
  const area = data.length ? `${line}L${cx(data.length - 1)},${y(0)}L${cx(0)},${y(0)}Z` : "";
  const barW = Math.min(14, Math.max(2, band * 0.6));
  const labelIdx = [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => data.length && a.indexOf(v) === i);

  return (
    <div className="card admin-chart">
      <div className="card-head ac-head">
        <h2>{title}</h2>
      </div>
      <p className="muted ac-note">{total} {note} · last {data.length} days</p>

      <div className="ac-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${total} ${note} in the last ${data.length} days`}
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="ac-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="ac-tick" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{t}</text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text key={i} className="ac-tick" x={cx(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>{fmtDay(data[i].date)}</text>
          ))}

          {kind === "bar" ? data.map((d, i) => d[field] > 0 && (
            <path key={d.date} className={`ac-bar ${hover === i ? "hot" : ""}`} d={barPath(cx(i) - barW / 2, y(d[field]), barW, y(0) - y(d[field]), 4)} />
          )) : (
            <>
              <path className="ac-area" d={area} />
              <path className="ac-line" d={line} />
            </>
          )}

          {hover != null && (
            <>
              <line className="ac-cross" x1={cx(hover)} x2={cx(hover)} y1={PAD.t} y2={y(0)} />
              {kind === "line" && <circle className="ac-dot" cx={cx(hover)} cy={y(data[hover][field])} r="4.5" />}
            </>
          )}
          <rect x={PAD.l} y={PAD.t} width={IW} height={IH} fill="transparent" />
        </svg>
        {hover != null && (
          <div className="ac-tip" style={{ left: `${(cx(hover) / W) * 100}%` }} data-flip={cx(hover) > W * 0.7 ? "left" : "right"}>
            <small>{fmtDay(data[hover].date, true)}</small>
            <b>{data[hover][field]}</b>
          </div>
        )}
      </div>
    </div>
  );
}

const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"]];

export default function AdminCharts({ data, days, onDays }) {
  return (
    <>
      <div className="pills" role="group" aria-label="Chart range">
        {RANGES.map(([d, label]) => <button key={d} type="button" className={days === d ? "on" : ""} onClick={() => onDays(d)}>{label}</button>)}
      </div>
      <div className="admin-charts">
        <Chart title="New signups" note="signups" data={data} field="signups" kind="bar" />
        <Chart title="Active users" note="active-user days" data={data} field="active" kind="line" />
      </div>
    </>
  );
}
