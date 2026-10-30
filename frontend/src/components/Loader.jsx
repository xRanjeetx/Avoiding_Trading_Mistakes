import { useEffect, useState } from "react";

const STEPS = [
  "Waking the server…",
  "Pulling your journal…",
  "Checking your rules…",
  "Almost there…",
];

export default function Loader() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="auth tg-loader" role="status" aria-live="polite">
      <div className="tg-loader-box">
        <div className="tg-logo-wrap" aria-hidden="true">
          <span className="tg-ring" />
          <span className="tg-ring r2" />
          <img src="/icon.svg" alt="" className="tg-logo" />
        </div>
        <div className="head-brand tg-lockup"><b>Trade Guard</b><small>Trade by the rules</small></div>
        <p key={step} className="tg-loader-step">{STEPS[step]}</p>
        <div className="tg-bar"><i /></div>
      </div>
    </main>
  );
}
