import { useEffect, useRef } from "react";

// Cloudflare Turnstile "are you human" check. Set VITE_TURNSTILE_SITE_KEY (and TURNSTILE_SECRET on the API) to turn it
// on; without a key nothing is rendered and `turnstileOn` is false, so forms skip the check.
export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
export const turnstileOn = !!SITE_KEY;

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading;
function loadScript() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => { loading = undefined; reject(new Error("Could not load the human check")); };
    document.head.appendChild(s);
  });
  return loading;
}

// `onToken(token)` is called with the solved token, or with "" when it expires or fails. A token works once, so the parent
// remounts this component (change its `key`) after every submit.
export default function Turnstile({ onToken }) {
  const box = useRef(null);

  useEffect(() => {
    if (!turnstileOn) return undefined;
    let widget;
    let gone = false;
    loadScript()
      .then((ts) => {
        if (gone || !box.current) return;
        widget = ts.render(box.current, {
          sitekey: SITE_KEY,
          theme: document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch(() => onToken(""));
    return () => {
      gone = true;
      if (widget !== undefined) window.turnstile?.remove(widget);
    };
  }, []);

  return turnstileOn ? <div ref={box} className="af-turnstile" /> : null;
}
