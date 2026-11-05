import { useEffect, useLayoutEffect, useRef, useState } from "react";

const STEPS = [
  "Waking the server…",
  "Pulling your journal…",
  "Checking your rules…",
  "Almost there…",
];

// One capsule per corner for the four big mistakes, in the order of a trade: entry, risk, holding, closing.
// The wording is an example of what Trade Guard says, not live data.
const ALERTS = [
  { pos: "tl", key: "fomo", status: "Blocked", name: "FOMO", title: "Price already ran 40 pips", text: "Wait for your setup. Don't chase.",
    icon: <><path d="M3 17l5-5 4 3 8-9" /><path d="M15 6h5v5" /></> },
  { pos: "tr", key: "fol", status: "Warning", name: "Fear of loss", title: "Stop moved away", text: "Keep your SL. A small loss is the plan.",
    icon: <><path d="M3 7l5 5 4-3 8 9" /><path d="M15 18h5v-5" /></> },
  { pos: "br", key: "fop", status: "Reminder", name: "Fear of profit", title: "Full TP is 1:2", text: "Hold it. Move SL to cost at 1:1.5.",
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.9-2.5.9-2.5 2 1 1.8 2.5 1.8 2.5-.8 2.5-1.8" /></> },
  { pos: "bl", key: "wrong", status: "Logged", name: "Being wrong", title: "Closed at SL, -1R", text: "As planned. No revenge. Tag it, move on.",
    icon: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.6 2.6 0 115 .9c0 1.7-2.5 2-2.5 3.6M12 17.2v.1" /></> },
];

export default function Loader() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(t);
  }, []);

  // The capsules only appear if the loader is still up after a moment. A fast start (server already awake) stays the plain
  // loader, instead of flashing half-grown capsules for a split second.
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // Each capsule grows out from behind the card as a small circle (its icon end): before the first frame, work out how far
  // that circle's resting place is from the card's centre.
  const boxRef = useRef(null);
  const capRefs = useRef([]);
  useLayoutEffect(() => {
    if (!show || !boxRef.current) return;
    const b = boxRef.current.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    capRefs.current.forEach((el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--fx", `${cx - (r.left + 23)}px`); // 23 = half the 46px icon circle
      el.style.setProperty("--fy", `${cy - (r.top + r.height / 2)}px`);
    });
  }, [show]);

  // Once they have all arrived, a glow and a progress line move round the corners in turn; hovering a capsule pauses on it.
  const [active, setActive] = useState(-1);
  const hold = useRef(false);
  useEffect(() => {
    if (!show) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer;
    const start = setTimeout(() => {
      setActive(0);
      if (!reduced) timer = setInterval(() => { if (!hold.current) setActive((a) => (a + 1) % ALERTS.length); }, 3600);
    }, 4300);
    return () => { clearTimeout(start); clearInterval(timer); };
  }, [show]);

  return (
    <main className="auth tg-loader" role="status" aria-live="polite">
      <div className="tg-loader-box" ref={boxRef}>
        <div className="tg-logo-wrap" aria-hidden="true">
          <span className="tg-ring" />
          <span className="tg-ring r2" />
          <img src="/icon.svg" alt="" className="tg-logo" />
        </div>
        <div className="head-brand tg-lockup"><b>Trade Guard</b><small>Trade by the rules</small></div>
        <p key={step} className="tg-loader-step">{STEPS[step]}</p>
        <div className="tg-bar"><i /></div>
      </div>
      {show && <span className="tg-spark" aria-hidden="true" />}
      {show && ALERTS.map((a, i) => (
        <div key={a.key} ref={(el) => { capRefs.current[i] = el; }} className={`tg-cap ${a.pos} ${a.key}${active === i ? " active" : ""}`} aria-hidden="true"
          onMouseEnter={() => { hold.current = true; setActive(i); }} onMouseLeave={() => { hold.current = false; }}>
          <span className="tg-cap-ico"><svg viewBox="0 0 24 24">{a.icon}</svg></span>
          <div className="tg-cap-txt"><b><u>{a.name}</u> &middot; {a.title}</b><span>{a.text}</span></div>
          <span className="tg-cap-st">{a.status}</span>
        </div>
      ))}
    </main>
  );
}
