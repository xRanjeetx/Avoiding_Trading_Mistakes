import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// index.html runs one inline script (it applies the saved theme before first paint). The CSP only allows it by hash,
// so editing that script without updating the hash would silently block it in production.
// Hashed with LF line endings: that is what Git stores and what the hosts build from. A Windows checkout may hold CRLF, which
// would give a different hash for the very same script.
const inline = read("index.html").match(/<script>([\s\S]*?)<\/script>/)[1].split("\r\n").join("\n");
const hash = `sha256-${createHash("sha256").update(inline).digest("base64")}`;

test("the CSP allows the inline theme script by its current hash", () => {
  const vercel = JSON.parse(read("vercel.json"));
  const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.ok(csp.includes(`'${hash}'`), `vercel.json CSP must contain '${hash}'`);
  assert.ok(read("nginx.conf").includes(`'${hash}'`), `nginx.conf CSP must contain '${hash}'`);
});

test("the CSP never allows inline or eval scripts or framing", () => {
  const csp = JSON.parse(read("vercel.json")).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
  assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"));
  assert.ok(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"));
});
