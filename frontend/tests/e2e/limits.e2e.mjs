// End-to-end test for the daily and overall loss limits: a real browser against the real frontend and API.
//
//   E2E_URL=http://localhost:5199 node tests/tests/e2e/limits.e2e.mjs
//
// Start the API on a TEST database first (see README). The test creates a brand-new account each run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5199";
const SHOTS = process.env.SHOTS || path.resolve("e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const email = `limits-${Date.now()}@example.com`;
const results = [];
const problems = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✖ ${name}\n      ${String(err.message).split("\n").slice(0, 5).join("\n      ")}`);
  }
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 800 }, colorScheme: "dark", reducedMotion: "reduce" });
context.setDefaultTimeout(8000);
const page = await context.newPage();
// A fixed Tuesday at 11:00 New York (London Close session), so the session rule passes whatever day the test runs.
const CLOCK = new Date("2026-10-27T15:00:00Z");
await page.clock.install({ time: CLOCK });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|fonts\.g/.test(m.text())) problems.push(`console.error: ${m.text()}`);
});
const nav = (label) => page.locator(".sidebar button", { hasText: label }).first().click();
const field = (label) => page.locator("label.field", { hasText: label }).locator("input, textarea").first();
const toast = () => page.locator(".toast");
const api = (method, url, body) => page.evaluate(async ([method, url, body]) => {
  const { token } = JSON.parse(localStorage.getItem("atm_session"));
  const res = await fetch(`/api${url}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return res.status === 204 ? null : res.json();
}, [method, url, body]);
const setLimits = async (lossLimits) => api("PUT", "/settings", { ...(await api("GET", "/settings")), lossLimits });
const row = () => page.locator("#checklist .rules li", { hasText: "Within Loss Limits" });
const openCheck = async () => { await page.reload(); await nav("Check"); };
async function fillTrade({ pair = "XAUUSD", entry = "2000", sl = "1990", tp = "2020", lot = "0.02" } = {}) {
  await field("Pair").fill(pair);
  await page.locator('#dir button[data-val="buy"]').click();
  await page.locator('#setup button[data-val="fvg"]').click();
  await field("Lot size").fill(lot);
  await field("Entry").fill(entry);
  await field("Stop loss").fill(sl);
  await field("Take profit").fill(tp);
}

console.log(`\nLoss limits E2E against ${URL} as ${email}\n`);

await step("sign up and open the app", async () => {
  await page.goto(URL);
  const res = await page.evaluate(async (email) => {
    const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) });
    return r.json();
  }, email);
  await page.evaluate((s) => localStorage.setItem("atm_session", JSON.stringify({ token: s.access_token, email: s.email, isAdmin: false })), res);
  await page.reload();
  await page.locator(".sidebar").waitFor();
});

await step("with no limits set the rule passes and says so", async () => {
  await nav("Check");
  await fillTrade();
  await row().waitFor();
  assert.match(await row().innerText(), /No loss limits set/);
  assert.ok(await page.locator("#checklist .rules li.pass", { hasText: "Within Loss Limits" }).count());
});

await step("limits are set in Settings, saved, and survive a reload", async () => {
  await nav("Settings");
  await field("Daily max loss").fill("50");
  await field("Overall max loss").fill("1000");
  await page.getByRole("button", { name: /save settings/i }).click();
  await toast().filter({ hasText: "Settings saved" }).waitFor();
  assert.deepEqual((await api("GET", "/settings")).lossLimits, { daily: 50, overall: 1000, since: null });
  await page.reload();
  await nav("Settings");
  assert.equal(await field("Daily max loss").inputValue(), "50");
});

await step("a trade within the limits shows its risk and what is left, and can be OK to trade", async () => {
  await openCheck();
  await fillTrade(); // XAUUSD 2000 -> 1990 at 0.02 lot = 20
  const yes = page.locator(".yn button.yes");
  for (let i = 0, n = await yes.count(); i < n; i++) await yes.nth(i).click();
  const text = await row().innerText();
  assert.match(text, /Risk \$20\.00/);
  assert.match(text, /daily left \$50\.00/);
  assert.match(text, /overall left \$1,000\.00/);
  await page.locator("#verdict.ok").waitFor();
  await page.screenshot({ path: path.join(SHOTS, "limits-ok.png") });
});

await step("a trade that risks more than what is left is blocked and the log button is disabled", async () => {
  await field("Stop loss").fill("1960"); // risk 80 > 50 left
  await page.locator("#verdict.no").waitFor();
  assert.match(await row().innerText(), /Daily: this trade risks \$80\.00 but only \$50\.00 is left/);
  assert.ok(await page.getByRole("button", { name: /log this trade/i }).first().isDisabled());
  await page.screenshot({ path: path.join(SHOTS, "limits-blocked.png") });
});

await step("a profit today gives room back: +30 with a daily limit of 20 allows 50, not 52", async () => {
  const now = await page.evaluate(() => Date.now());
  await setLimits({ daily: 20, overall: null, since: null });
  await api("POST", "/entries", { id: "win1", timestamp: now - 3600000, pair: "XAUUSD", dir: "buy", lot: 0.02, entry: 2000, sl: 1990, result: "tp", pnl: 30, closedAt: now - 1800000 });
  await openCheck();
  await fillTrade({ sl: "1975", tp: "2050" }); // risk 50
  assert.match(await row().innerText(), /daily left \$50\.00/);
  assert.ok(await page.locator("#checklist .rules li.pass", { hasText: "Within Loss Limits" }).count());
  await field("Stop loss").fill("1974"); // risk 52
  assert.ok(await page.locator("#checklist .rules li.fail", { hasText: "Within Loss Limits" }).count());
});

await step("the Today tab shows the daily limit left and the net so far", async () => {
  await nav("Today");
  const card = page.locator("#today .loss-card");
  await card.waitFor();
  const text = await card.innerText();
  assert.match(text, /daily left/i);
  assert.match(text, /\$50\.00/);
  assert.match(text, /\+\$30\.00\s+net so far/i);
  assert.equal(await card.locator(".stat small b.pos").innerText(), "+$30.00"); // a profit is green
  assert.equal(await card.locator(".stat").count(), 1); // overall is off
  await card.screenshot({ path: path.join(SHOTS, "limits-today.png") });
});

await step("a spent limit blocks every trade, with a clear message", async () => {
  const now = await page.evaluate(() => Date.now());
  await api("POST", "/entries", { id: "loss1", timestamp: now - 600000, pair: "XAUUSD", dir: "buy", lot: 0.02, entry: 2000, sl: 1990, result: "sl", pnl: -50, closedAt: now - 300000 });
  await openCheck();
  assert.match(await row().innerText(), /Daily loss limit reached/);
  await nav("Today");
  assert.match(await page.locator("#today .loss-card").innerText(), /limit reached/i);
});

await step("a pair with no known value fails clearly, then works once its value is set in Settings", async () => {
  await setLimits({ daily: 500, overall: null, since: null });
  await openCheck();
  await fillTrade({ pair: "US30", entry: "40000", sl: "39990", tp: "40020", lot: "1" });
  assert.match(await row().innerText(), /Set the value for US30 in Settings/);
  await nav("Settings");
  await page.locator('input[aria-label="New pair lot size"]').fill("1");
  await page.locator('input[placeholder="Pair e.g. GBPUSD"]').fill("us30");
  await page.locator('input[aria-label="New pair value per 1.00 price move at 1 lot"]').fill("1");
  await page.getByRole("button", { name: /^\s*Add\s*$/ }).click();
  await page.getByRole("button", { name: /save settings/i }).click();
  await toast().filter({ hasText: "Settings saved" }).waitFor();
  assert.equal((await api("GET", "/settings")).pairs.find((p) => p.pair === "US30").value, 1);
  await nav("Check");
  await fillTrade({ pair: "US30", entry: "40000", sl: "39990", tp: "40020", lot: "1" });
  assert.match(await row().innerText(), /Risk \$10\.00/); // 10 points x 1 lot x value 1
});

await step("USDJPY works with no setup (value from the price)", async () => {
  await openCheck();
  await fillTrade({ pair: "USDJPY", entry: "150", sl: "149.5", tp: "151", lot: "0.1" });
  assert.match(await row().innerText(), /Risk \$33\.33/); // 0.5 x 0.1 x (100000 / 150)
});

await step("the USDJPY box shows an estimate, but each trade is still priced from its own entry", async () => {
  await nav("Settings");
  await page.locator('input[aria-label="New pair lot size"]').fill("0.2");
  await page.locator('input[placeholder="Pair e.g. GBPUSD"]').fill("usdjpy");
  await page.getByRole("button", { name: /^\s*Add\s*$/ }).click();
  const box = page.locator('input[aria-label="USDJPY value per 1.00 price move at 1 lot"]');
  assert.equal(await box.inputValue(), "666.67");
  await page.getByRole("button", { name: /save settings/i }).click();
  await toast().filter({ hasText: "Settings saved" }).waitFor();
  assert.equal((await api("GET", "/settings")).pairs.find((p) => p.pair === "USDJPY").value, null); // nothing typed, so nothing saved
  await nav("Check");
  await fillTrade({ pair: "USDJPY", entry: "140", sl: "139.5", tp: "141", lot: "0.2" });
  assert.match(await row().innerText(), /Risk \$71\.43/); // 0.5 x 0.2 x (100000 / 140), not the 150-based estimate
});

await step("Settings shows the built-in value hints for the default pairs, on a phone too", async () => {
  await nav("Settings");
  const box = (p) => page.locator(`input[aria-label="${p} value per 1.00 price move at 1 lot"]`);
  assert.equal(await box("XAUUSD").inputValue(), "100");
  assert.equal(await box("EURUSD").inputValue(), "100000");
  // typing a built-in pair in the new-pair row fills its value at once; USDJPY shows an estimate
  const draftPair = page.locator('input[placeholder="Pair e.g. GBPUSD"]');
  const draftValue = page.locator('input[aria-label="New pair value per 1.00 price move at 1 lot"]');
  await draftPair.fill("xauusd");
  assert.equal(await draftValue.inputValue(), "100");
  await draftPair.fill("eurusd");
  assert.equal(await draftValue.inputValue(), "100000");
  await draftPair.fill("usdjpy");
  assert.equal(await draftValue.inputValue(), "666.67"); // 100000 / 150 until there is a USDJPY trade
  await draftValue.fill("700");
  assert.equal(await draftValue.inputValue(), "700");
  await draftValue.fill("");
  assert.equal(await draftValue.inputValue(), "666.67");
  await draftPair.fill("us30");
  assert.equal(await draftValue.inputValue(), "");
  await draftPair.fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(m.sw <= m.iw, `page scrolls sideways (${m.sw} > ${m.iw})`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "limits-settings-mobile.png") });
});

await step("no page errors or console errors", async () => assert.deepEqual(problems, []));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
