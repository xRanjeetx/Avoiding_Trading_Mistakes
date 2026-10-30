// End-to-end test for the News tab and the automatic calendar: a real browser against the real frontend and API.
//
// The test starts its own fake feed on port 8799, so start the API pointing at it (and on a TEST database):
//   CALENDAR_URLS=http://localhost:8799/this.json,http://localhost:8799/next.json  (API)
//   E2E_URL=http://localhost:5199 node tests/tests/e2e/news.e2e.mjs
// The test creates a brand-new account each run.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5199";
const SHOTS = process.env.SHOTS || path.resolve("e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });

// ---- the fake feed: events relative to the moment it is asked, in the feed's own format (UTC-4 offset) ----
// With the default 120 minute lead time, every event here except the USD rate decision is inside the window:
//   JPY high  (+30 min)  blocks USDJPY only          EUR high (+40 min)  blocks EURUSD only
//   USD medium (+60 min) only warns (all 3 pairs)    USD high (+6 h)     far away, blocks nobody yet
//   GBP events never matter: GBP is not a currency of the three pairs
const MIN = 60000;
const iso = (minAhead) => new Date(Date.now() + minAhead * MIN - 4 * 3600000).toISOString().replace(/\.\d+Z$/, "-04:00");
const feed = () => [
  { title: "Federal Funds Rate", country: "USD", date: iso(360), impact: "High", forecast: "4.00%", previous: "4.00%" },
  { title: "FOMC Statement", country: "USD", date: iso(360), impact: "High", forecast: "", previous: "" },
  { title: "BOJ Policy Rate", country: "JPY", date: iso(30), impact: "High", forecast: "", previous: "" },
  { title: "ECB Rate", country: "EUR", date: iso(40), impact: "High", forecast: "", previous: "" },
  { title: "Main Refinancing Rate", country: "EUR", date: iso(40), impact: "High", forecast: "", previous: "" },
  { title: "Consumer Sentiment", country: "USD", date: iso(60), impact: "Medium", forecast: "", previous: "" },
  { title: "BOE Rate", country: "GBP", date: iso(20), impact: "High", forecast: "", previous: "" },
  { title: "Retail Sales m/m", country: "GBP", date: iso(90), impact: "Medium", forecast: "", previous: "" },
  { title: "Minor Data", country: "EUR", date: iso(50), impact: "Low", forecast: "", previous: "" },
];
const server = http.createServer((req, res) => {
  if (req.url === "/this.json") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(feed())); }
  else { res.statusCode = 404; res.end("<html>404</html>"); } // like the real next-week feed early in the week
});
await new Promise((r) => server.listen(8799, r));

const email = `news-${Date.now()}@example.com`;
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
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" });
context.setDefaultTimeout(8000);
const page = await context.newPage();
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|fonts\.g/.test(m.text())) problems.push(`console.error: ${m.text()}`);
});
const nav = (label) => page.locator(".sidebar button", { hasText: label }).first().click();
const api = (method, url, body) => page.evaluate(async ([method, url, body]) => {
  const { access_token: token } = await fetch("/api/auth/refresh", { method: "POST" }).then((r) => r.json());
  const res = await fetch(`/api${url}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return res.status === 204 ? null : res.json();
}, [method, url, body]);
async function savedNews(pred) { // the News tab saves on every change: wait until the server has it
  for (let i = 0; i < 30; i++) {
    const n = (await api("GET", "/settings")).news;
    if (pred(n)) return n;
    await page.waitForTimeout(100);
  }
  throw new Error(`news settings never matched: ${JSON.stringify((await api("GET", "/settings")).news)}`);
}
const list = () => page.locator("#news .news-list li");
const ruleRow = () => page.locator("#checklist .rules li", { hasText: "No Trade Before High-Impact News" });
const pairField = () => page.locator("label.field", { hasText: "Pair" }).locator("input").first();
async function checkPair(pair) {
  await nav("Check");
  await pairField().fill(pair);
  await ruleRow().waitFor();
  return { text: await ruleRow().innerText(), fails: await page.locator("#checklist .rules li.fail", { hasText: "No Trade Before High-Impact News" }).count() > 0 };
}

console.log(`\nNews E2E against ${URL} as ${email}\n`);

await step("sign up and open the app", async () => {
  await page.goto(URL);
  const res = await page.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "correct-horse-42" }) })).json(), email);
  await page.evaluate((s) => localStorage.setItem("atm_hint", JSON.stringify({ email: s.email, isAdmin: false })), res);
  await page.reload();
  await page.locator(".sidebar").waitFor();
});

await step("the sidebar has a News tab, and Settings no longer has anything about news", async () => {
  assert.ok(await page.locator(".sidebar button", { hasText: "News" }).count());
  await nav("Settings");
  const text = await page.locator("#settings").innerText();
  assert.doesNotMatch(text, /Stop trading before news|Add news|No news added/i); // the rule itself stays in the rules list, so it can be switched off
  assert.ok(await page.locator("#settings .rule-edit li", { hasText: "No Trade Before High-Impact News" }).count());
  assert.equal(await page.locator('#settings input[aria-label="News date and time"]').count(), 0);
  assert.equal(await page.locator("#settings .news-card").count(), 0);
});

await step("the News tab lists only news for the three pairs, with the pairs each one affects", async () => {
  await nav("News");
  await page.locator("#news .chip.good", { hasText: "Live" }).waitFor();
  await list().first().waitFor();
  const text = await page.locator("#news").innerText();
  assert.doesNotMatch(text, /GBP|BOE Rate|Retail Sales|Minor Data/); // other currencies and low impact never show
  assert.equal(await list().count(), 4);
  const rows = await list().allInnerTexts();
  assert.match(rows[0], /JPY BOJ Policy Rate[\s\S]*USDJPY/);
  assert.match(rows[0], /Locked/);
  assert.match(rows[1], /EUR ECB Rate, Main Refinancing Rate[\s\S]*EURUSD/); // two events at one time, shown as one
  assert.match(rows[2], /USD Consumer Sentiment[\s\S]*XAUUSD, EURUSD, USDJPY/);
  assert.match(rows[2], /Medium/);
  assert.match(rows[2], /Warning/);
  assert.doesNotMatch(rows[2], /Locked/); // medium never locks
  assert.match(rows[3], /USD Federal Funds Rate, FOMC Statement/);
  assert.doesNotMatch(rows[3], /Locked/); // six hours away
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "news-tab.png") });
});

await step("XAUUSD is not blocked by JPY or EUR news, only warned about the medium-impact USD news", async () => {
  const r = await checkPair("XAUUSD");
  assert.equal(r.fails, false);
  assert.match(r.text, /Heads up: USD Consumer Sentiment/);
  assert.match(r.text, /medium impact, not blocking/);
  assert.match(await page.locator("#checklist .banner.lock.warn").innerText(), /USD Consumer Sentiment/);
  assert.equal(await page.locator("#checklist .banner.lock:not(.warn)", { hasText: "news" }).count(), 0);
});

await step("EURUSD is blocked by the EUR rate decision and says so", async () => {
  const r = await checkPair("EURUSD");
  assert.equal(r.fails, true);
  assert.match(r.text, /EUR ECB Rate, Main Refinancing Rate/);
  assert.match(await page.locator("#checklist .banner.lock:not(.warn)").innerText(), /Trading is locked until it passes/);
  await page.screenshot({ path: path.join(SHOTS, "news-check-blocked.png") });
});

await step("USDJPY is blocked by the JPY rate decision, not by the EUR one", async () => {
  const r = await checkPair("USDJPY");
  assert.equal(r.fails, true);
  assert.match(r.text, /JPY BOJ Policy Rate/);
  assert.doesNotMatch(r.text, /ECB/);
});

await step("another pair is not covered by the calendar, and the rule says so", async () => {
  const r = await checkPair("GBPUSD"); // the GBP rate decision in the feed does not matter here either
  assert.equal(r.fails, false);
  assert.match(r.text, /Calendar news covers XAUUSD, EURUSD, USDJPY only/);
});

await step("the medium-impact warning can be switched off", async () => {
  await nav("News");
  await page.getByText("Warn about medium-impact news").click();
  await savedNews((n) => n.includeMedium === false);
  assert.doesNotMatch(await page.locator("#news").innerText(), /Consumer Sentiment/);
  const r = await checkPair("XAUUSD");
  assert.doesNotMatch(r.text, /Heads up/);
  await nav("News");
  await page.getByText("Warn about medium-impact news").click();
  await savedNews((n) => n.includeMedium === true);
});

await step("switching the automatic calendar off removes its events and every block", async () => {
  await nav("News");
  await page.getByText("Use the automatic calendar").click();
  await savedNews((n) => n.auto === false);
  await page.locator("#news .chip", { hasText: "Off" }).first().waitFor();
  assert.doesNotMatch(await page.locator("#news").innerText(), /BOJ|ECB|Consumer/);
  const r = await checkPair("EURUSD");
  assert.equal(r.fails, false);
  assert.doesNotMatch(r.text, /unavailable/);
  await nav("News");
  await page.getByText("Use the automatic calendar").click();
  await savedNews((n) => n.auto === true);
});

await step("a shorter lead time lifts the block for an event 40 minutes away", async () => {
  await nav("News");
  await page.locator('#news input[type="number"]').fill("10");
  await page.locator("#news").getByRole("button", { name: /^\s*Save\s*$/ }).click();
  await savedNews((n) => n.leadMin === 10);
  assert.equal(await page.locator("#news .news-list li.news-locked").count(), 0);
  assert.equal((await checkPair("EURUSD")).fails, false);
  await nav("News");
  await page.locator('#news input[type="number"]').fill("120");
  await page.locator("#news").getByRole("button", { name: /^\s*Save\s*$/ }).click();
  await savedNews((n) => n.leadMin === 120);
});

await step("your own news blocks every pair, and can be removed here", async () => {
  const local = await page.evaluate(() => {
    const d = new Date(Date.now() + 60 * 60000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  await nav("News");
  await page.locator('input[aria-label="News date and time"]').fill(local);
  await page.locator('input[aria-label="News name"]').fill("My CPI");
  await page.getByRole("button", { name: /add news/i }).click();
  await savedNews((n) => n.events.length === 1 && n.events[0].title === "My CPI");
  const mine = page.locator("#news .news-list li", { hasText: "My CPI" });
  await mine.waitFor();
  assert.match(await mine.innerText(), /Yours[\s\S]*|all pairs/);
  assert.match(await mine.innerText(), /all pairs/);
  for (const pair of ["XAUUSD", "GBPUSD"]) {
    const r = await checkPair(pair);
    assert.equal(r.fails, true, `${pair} should be blocked by your own news`);
    assert.match(r.text, /My CPI/);
  }
  await nav("News");
  await mine.getByRole("button", { name: /remove news/i }).click();
  await savedNews((n) => n.events.length === 0);
});

await step("a long list is paged: 5 at a time, with Prev and Next and no row-count choice", async () => {
  // 25 of your own news events on top of the 4 from the calendar = 29
  const base = Date.now() + 5 * 3600000;
  const events = Array.from({ length: 25 }, (_, i) => ({ at: base + i * 60000, title: `Own ${String(i + 1).padStart(2, "0")}` }));
  await api("PUT", "/settings", { ...(await api("GET", "/settings")), news: { ...(await api("GET", "/settings")).news, events } });
  await page.reload();
  await nav("News");
  await list().first().waitFor();
  const pager = page.locator("#news .pager");
  // Your own events show at once; the calendar arrives from a separate request. Wait for the final total instead of racing it
  // (against a database on another network the calendar can take a second or more).
  await page.locator("#news .pager", { hasText: /1–5 of 29/ }).waitFor();
  assert.equal(await list().count(), 5);
  assert.match(await pager.innerText(), /1–5 of 29/);
  assert.match(await pager.innerText(), /Page 1 of 6/);
  assert.ok(await pager.getByRole("button", { name: "Previous page" }).isDisabled());
  assert.equal(await page.locator("#news .news-card .card-head .chip").innerText(), "29"); // the card still counts every event
  await pager.getByRole("button", { name: "Next page" }).click();
  assert.match(await pager.innerText(), /6–10 of 29/);
  assert.equal(await list().count(), 5);
  for (let i = 0; i < 4; i++) await pager.getByRole("button", { name: "Next page" }).click();
  assert.match(await pager.innerText(), /26–29 of 29/);
  assert.match(await pager.innerText(), /Page 6 of 6/);
  assert.equal(await list().count(), 4);
  assert.ok(await pager.getByRole("button", { name: "Next page" }).isDisabled());
  await page.screenshot({ path: path.join(SHOTS, "news-paged.png") });
  // removing the events leaves the last page: the list moves back instead of showing an empty page
  assert.equal(await page.locator("#news select").count(), 0); // the page size is fixed at 5
  await api("PUT", "/settings", { ...(await api("GET", "/settings")), news: { ...(await api("GET", "/settings")).news, events: [] } });
  await page.reload();
  await nav("News");
  await page.locator("#news .chip.good", { hasText: "Live" }).waitFor(); // the calendar loads a moment after the page
  assert.equal(await page.locator("#news .pager").count(), 0); // 4 events: fits one page, so no pager
  assert.equal(await list().count(), 4);
});

await step("saving in Settings keeps the news settings untouched", async () => {
  await nav("News");
  await page.getByText("Warn about medium-impact news").click();
  await savedNews((n) => n.includeMedium === false);
  await nav("Settings");
  await page.locator('label.field:has-text("Max trades") input').fill("5");
  await page.getByRole("button", { name: /save settings/i }).click();
  await page.locator(".toast", { hasText: "Settings saved" }).waitFor();
  const s = await api("GET", "/settings");
  assert.equal(s.maxTrades, 5);
  assert.equal(s.news.includeMedium, false);
  assert.equal(s.news.leadMin, 120);
});

await step("when the calendar cannot be loaded the tab says so and the rule passes with a warning", async () => {
  await page.route("**/api/calendar", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"down"}' }));
  await page.reload();
  await nav("News");
  await page.locator("#news .chip.warn", { hasText: "Unavailable" }).waitFor();
  assert.match(await page.locator("#news").innerText(), /could not be loaded/i);
  const r = await checkPair("EURUSD");
  assert.equal(r.fails, false);
  assert.match(r.text, /Auto calendar unavailable/);
  await page.unroute("**/api/calendar");
});

await step("the News tab fits a phone with no sideways scroll", async () => {
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await nav("News");
  await page.locator("#news .chip.good", { hasText: "Live" }).waitFor();
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(m.sw <= m.iw, `page scrolls sideways (${m.sw} > ${m.iw})`);
  await page.screenshot({ path: path.join(SHOTS, "news-mobile.png") });
});

await step("no page errors or console errors", async () => assert.deepEqual(problems, []));

await browser.close();
server.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
