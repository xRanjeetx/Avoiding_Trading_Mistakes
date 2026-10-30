// End-to-end test: a real browser (Edge/Chrome) against the real frontend, API and PostgreSQL.
//
//   E2E_URL=http://localhost:5199 SHOTS=C:\path\to\folder node tests/tests/e2e/app.e2e.mjs
//
// Start the API on a TEST database first (see README). The test creates a brand-new account each run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5199";
const SHOTS = process.env.SHOTS || path.resolve("e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const email = `e2e-${Date.now()}@example.com`;
const password = "correct-horse-42";
const results = [];
const problems = [];

async function step(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push([false, name]);
    console.log(`  ✖ ${name}\n      ${String(err.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
// reducedMotion: the landing card floats forever, and Playwright will not click an element that never settles.
const context = await browser.newContext({ viewport: { width: 1366, height: 700 }, colorScheme: "dark", reducedMotion: "reduce" });
context.setDefaultTimeout(8000);
const page = await context.newPage();
// A fixed Tuesday, so the market-session rule does not depend on the day the test happens to run.
await page.clock.install({ time: new Date("2026-10-27T15:00:00Z") });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|fonts\.g/.test(m.text())) problems.push(`console.error: ${m.text()}`);
});
// Wait for tab fades and the sheet's pop-in to finish so the picture shows the settled screen.
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const nav = (label) => page.locator(".sidebar button", { hasText: label }).first().click();
const field = (label) => page.locator("label.field", { hasText: label }).locator("input, textarea").first();
const toast = () => page.locator(".toast");
const theme = () => page.evaluate(() => document.documentElement.dataset.theme);

console.log(`\nE2E against ${URL} as ${email}\n`);

console.log("Landing page");
await step("loads with headline, form and no page scroll at 1366x700", async () => {
  await page.goto(URL);
  await page.getByRole("heading", { level: 1 }).waitFor();
  assert.match(await page.getByRole("heading", { level: 1 }).innerText(), /same trading mistakes/i);
  await page.locator("#auth").waitFor();
  const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(m.sh <= m.ih + 1, `page scrolls vertically (${m.sh} > ${m.ih})`);
  assert.ok(m.sw <= m.iw, "page scrolls horizontally");
  await shot("01-landing-dark");
});
await step("the candle/particle canvas is drawing", async () => {
  const painted = await page.evaluate(() => {
    const c = document.querySelector("canvas.lp-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
  assert.ok(painted, "canvas is blank");
});
await step("tabs switch between Log in and Sign up", async () => {
  await page.locator(".auth-tabs button", { hasText: "Log in" }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.locator(".auth-tabs button", { hasText: "Sign up" }).click();
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
});
await step("password strength meter and show/hide button work", async () => {
  const pw = page.locator('#auth input[autocomplete="new-password"]');
  await pw.fill("abc");
  assert.match(await page.locator(".af-meter small").innerText(), /weak/i);
  await pw.fill("Str0ng!Passw0rd#");
  assert.match(await page.locator(".af-meter small").innerText(), /strong/i);
  await page.getByRole("button", { name: "Show password" }).click();
  assert.equal(await pw.getAttribute("type"), "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  assert.equal(await pw.getAttribute("type"), "password");
});
await step("theme toggle switches dark <-> light", async () => {
  assert.equal(await theme(), "dark");
  await page.getByRole("button", { name: /switch light\/dark/i }).click();
  assert.equal(await theme(), "light");
  await shot("02-landing-light");
  await page.getByRole("button", { name: /switch light\/dark/i }).click();
  assert.equal(await theme(), "dark");
});
await step("a wrong login shows an error and stays on the page", async () => {
  await page.locator(".auth-tabs button", { hasText: "Log in" }).click();
  await page.locator('#auth input[type="email"]').fill("nobody@example.com");
  await page.locator('#auth input[type="password"]').fill("wrongpassword1");
  await page.locator(".af-submit").click();
  await page.locator(".af-error").waitFor();
  assert.match(await page.locator(".af-error").innerText(), /wrong email or password/i);
  await shot("03-login-error");
});

console.log("\nSign up");
await step("creating an account lands in the app, signed in", async () => {
  await page.locator(".auth-tabs button", { hasText: "Sign up" }).click();
  await page.locator('#auth input[type="email"]').fill(email);
  await page.locator('#auth input[type="password"]').fill(password);
  await page.locator(".af-submit").click();
  await page.locator(".app-header h1").waitFor({ timeout: 90000 });
  assert.match(await page.locator(".app-header h1").innerText(), /pre-trade checklist/i);
  assert.match(await page.locator(".user-email").innerText(), new RegExp(email.split("@")[0]));
});

console.log("\nSettings");
await step("set a starting balance and save", async () => {
  await nav("Settings");
  await field("Starting balance").fill("1000");
  await page.getByRole("button", { name: /save settings/i }).click();
  await toast().filter({ hasText: "Settings saved" }).waitFor();
  await shot("04-settings-dark");
});
await step("settings persist after reopening the tab", async () => {
  await nav("Check");
  await nav("Settings");
  assert.equal(await field("Starting balance").inputValue(), "1000");
  assert.equal(await page.getByText("London start").count(), 0, "the old London / My session card is gone");
  assert.equal(await page.getByText("My session start").count(), 0);
});

console.log("\nMarket sessions");
await step("Check tab shows the four sessions and which one is live", async () => {
  await nav("Check");
  await page.locator(".kz-strip").waitFor();
  assert.deepEqual(await page.locator(".kz-chips li span").allInnerTexts(), ["Asian", "London", "New York", "London Close"]);
  assert.match(await page.locator(".kz-status b").innerText(), /is live|No session live/);
  assert.match(await page.locator(".kz-status .chip").innerText(), /^NY \d\d:\d\d$/);
  await shot("04b-sessions-strip-dark");
});
await step("Settings lists the sessions with the default New York times", async () => {
  await nav("Settings");
  const row = (name) => page.locator(".kz-row", { hasText: name });
  assert.equal(await page.locator(".kz-row:has(.kz-times)").count(), 4); // the Pairs card reuses .kz-row
  assert.equal(await row("Asian").locator(".kz-times input").nth(0).inputValue(), "20:00");
  assert.equal(await row("Asian").locator(".kz-times input").nth(1).inputValue(), "00:00");
  assert.equal(await row("New York").locator(".kz-times input").nth(0).inputValue(), "07:00");
  assert.equal(await row("London Close").locator(".kz-times input").nth(1).inputValue(), "12:00");
  const card = page.locator(".card", { has: page.locator(".kz-times") });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await card.screenshot({ path: path.join(SHOTS, "04c-sessions-settings-dark.png") });
});
await step("a session can be edited and switched off, and the change survives a reload", async () => {
  const row = (name) => page.locator(".kz-row", { hasText: name });
  await row("London Close").locator(".kz-times input").nth(0).fill("10:30");
  await row("London").first().locator('input[type="checkbox"]').uncheck();
  // Asian all day, so the "trade only in a market session" rule passes whatever time the test runs
  await row("Asian").locator(".kz-times input").nth(0).fill("00:00");
  await row("Asian").locator(".kz-times input").nth(1).fill("23:59");
  await page.getByRole("button", { name: /save settings/i }).click();
  await toast().filter({ hasText: "Settings saved" }).waitFor();
  await page.reload();
  await page.locator(".app-header h1").waitFor();
  await nav("Settings");
  assert.equal(await row("London Close").locator(".kz-times input").nth(0).inputValue(), "10:30");
  assert.equal(await row("Asian").locator(".kz-times input").nth(0).inputValue(), "00:00");
  assert.equal(await row("Asian").locator(".kz-times input").nth(1).inputValue(), "23:59");
  assert.equal(await row("London").first().locator('input[type="checkbox"]').isChecked(), false);
  assert.equal(await row("Asian").locator('input[type="checkbox"]').isChecked(), true);
  await nav("Check");
  assert.ok(await page.locator(".kz-chips li.off", { hasText: "London" }).first().isVisible());
  assert.match(await page.locator(".kz-status b").innerText(), /Asian is live/);
});

await step("on a Saturday the strip says the market is closed, and Monday-Friday it is live again", async () => {
  await nav("Check");
  await page.clock.setSystemTime(new Date("2026-10-31T15:00:00Z")); // Saturday 11:00 in New York
  await page.clock.runFor(31000);                                    // the page re-checks the time every 30 s
  assert.match(await page.locator(".kz-status b").innerText(), /Market closed for the weekend/);
  assert.equal(await page.locator(".kz-chips li.now").count(), 0);
  await shot("04d-sessions-weekend-dark");
  await page.clock.setSystemTime(new Date("2026-10-27T15:00:00Z")); // back to Tuesday
  await page.clock.runFor(31000);
  assert.match(await page.locator(".kz-status b").innerText(), /Asian is live/);
});

console.log("\nChecklist");
await step("empty form is not OK to trade", async () => {
  await nav("Check");
  await page.locator("#checklist.active").waitFor();
  assert.ok(await page.locator("#verdict.pending").isVisible());
  assert.ok(await page.locator(".ready.pending, .ready:not(.ok):not(.no)").first().isVisible());
  assert.ok(await page.getByRole("button", { name: /log this trade/i }).isDisabled());
  await shot("05-checklist-empty-dark");
});
await step("a wrong-side stop loss breaks the RR rule", async () => {
  await field("Pair").fill("xauusd");
  await page.locator('#dir button[data-val="buy"]').click();
  await page.locator('#setup button[data-val="fvg"]').click();
  await field("Entry").fill("100");
  await field("Stop loss").fill("102"); // above entry on a BUY
  await field("Take profit").fill("104");
  assert.ok(await page.locator("#verdict.no").isVisible());
  assert.match(await page.locator("#verdict").innerText(), /DO NOT TRADE/);
  assert.ok(await page.getByRole("button", { name: /log this trade/i }).isDisabled());
});
await step("fixing the SL (1:2) and answering Yes to every question gives OK TO TRADE", async () => {
  await field("Stop loss").fill("98");
  const yes = page.locator(".yn button.yes");
  for (let i = 0, n = await yes.count(); i < n; i++) await yes.nth(i).click();
  await page.locator("#verdict.ok").waitFor();
  assert.match(await page.locator("#verdict").innerText(), /OK TO TRADE/);
  assert.match(await page.locator(".dock").innerText(), /OK to trade/i);
  await shot("06-checklist-ok-dark");
});
await step("one 'No' blocks the trade again", async () => {
  await page.locator(".yn button.no").first().click();
  await page.locator("#verdict.no").waitFor();
  await page.locator(".yn button.yes").first().click();
  await page.locator("#verdict.ok").waitFor();
});
await step("the lot rule rejects a different lot size", async () => {
  await field("Lot size").fill("0.5");
  await page.locator("#verdict.no").waitFor();
  await field("Lot size").fill("0.02");
  await page.locator("#verdict.ok").waitFor();
});
await step("logging the trade shows a toast and resets the form", async () => {
  await field("Why this trade?").fill("5m FVG retest, trend up");
  await page.getByRole("button", { name: /log this trade/i }).first().click();
  await toast().filter({ hasText: "Trade logged" }).waitFor();
  assert.equal(await field("Pair").inputValue(), "");
});

console.log("\nToday");
await step("the trade appears as OPEN with correct counters", async () => {
  await nav("Today");
  const card = page.locator("#today .entry", { hasText: "XAUUSD" });
  await card.waitFor();
  assert.match(await card.innerText(), /BUY/);
  assert.match(await card.innerText(), /OPEN/);
  assert.match(await page.locator("#today .stats-grid .stat").first().innerText(), /1\s*\/\s*4/);
  await shot("07-today-open-dark");
});
await step("closing with TP hit asks for an amount and saves a profit", async () => {
  await page.getByRole("button", { name: /TP hit/ }).click();
  await page.locator("#sheet").waitFor();
  await shot("08-close-sheet-dark");
  await page.locator("#sheet label.field", { hasText: "Profit amount" }).locator("input").fill("24.5");
  await page.locator("#sheet").getByRole("button", { name: /^\s*Save/ }).click();
  await toast().filter({ hasText: "Saved" }).waitFor();
  const card = page.locator("#today .entry", { hasText: "XAUUSD" });
  assert.match(await card.innerText(), /\+\$24\.50/);
  assert.match(await card.innerText(), /TP/);
  assert.match(await page.locator("#today .stats-grid .stat").nth(2).innerText(), /\+\$24\.50/);
});

console.log("\nJournal");
await step("shows the trade, search and filters work, card expands", async () => {
  await nav("Journal");
  const entry = page.locator("#log .entry", { hasText: "XAUUSD" });
  await entry.waitFor();
  await page.locator("#log .search").fill("zzz-nothing");
  await page.locator("#log .empty").waitFor();
  await page.locator("#log .search").fill("xau");
  await entry.waitFor();
  await page.locator("#log .pills button", { hasText: "Losses" }).click();
  await page.locator("#log .empty").waitFor();
  await page.locator("#log .pills button", { hasText: "Wins" }).click();
  await entry.waitFor();
  await entry.locator(".entry-head").click();
  await page.locator("#log .entry.open .kv").waitFor();
  assert.match(await entry.innerText(), /5m FVG retest/);
  await shot("09-journal-dark");
});

console.log("\nStats");
await step("net P&L, win rate, equity curve and calendar reflect the trade", async () => {
  await nav("Stats");
  const hero = page.locator("#stats .stats-grid.two .stat").first();
  assert.match(await hero.innerText(), /\+\$24\.50/);
  assert.match(await hero.innerText(), /Balance \$1,024\.50/);
  assert.match(await page.locator("#stats .stats-grid.two .stat", { hasText: "Win rate" }).innerText(), /100%/);
  // equity needs 2+ points: one closed trade gives the start point plus one
  await page.locator("#stats svg.eq").waitFor();
  assert.ok(await page.locator("#stats .cal-day.pos").count() >= 1, "calendar day not green");
  await shot("10-stats-dark");
});

console.log("\nPersistence (real database)");
await step("after a full page reload everything is still there", async () => {
  await page.reload();
  await page.locator(".app-header h1").waitFor({ timeout: 90000 });
  await nav("Journal");
  await page.locator("#log .entry", { hasText: "XAUUSD" }).waitFor();
});
await step("API returns exactly the stored entry and settings", async () => {
  const data = await page.evaluate(async () => {
    const h = { Authorization: "Bearer " + (await fetch("/api/auth/refresh", { method: "POST" }).then((r) => r.json())).access_token };
    const [e, s] = await Promise.all([fetch("/api/entries", { headers: h }).then((r) => r.json()), fetch("/api/settings", { headers: h }).then((r) => r.json())]);
    return { e, s };
  });
  assert.equal(data.e.length, 1);
  assert.deepEqual([data.e[0].pair, data.e[0].dir, data.e[0].setup, data.e[0].result, data.e[0].pnl], ["XAUUSD", "buy", "fvg", "tp", 24.5]);
  assert.equal(data.e[0].rr, 2);
  const asian = data.s.killzones.find((z) => z.key === "asian");
  assert.deepEqual([asian.start, asian.end, asian.on], ["00:00", "23:59", true]);
  assert.equal(data.s.killzones.find((z) => z.key === "london").on, false);
  assert.equal(data.s.londonStart, undefined, "removed field is not returned");
  assert.equal(data.s.balance, 1000);
});

console.log("\nLoss cooldown, discipline, reminders");
const fillTrade = async (pair) => {
  await field("Pair").fill(pair);
  await page.locator('#dir button[data-val="buy"]').click();
  await page.locator('#setup button[data-val="fvg"]').click();
  await field("Entry").fill("100");
  await field("Stop loss").fill("98");
  await field("Take profit").fill("104");
  const yes = page.locator(".yn button.yes");
  for (let i = 0, n = await yes.count(); i < n; i++) await yes.nth(i).click();
};
await step("after a stop loss the same pair is locked for 10 minutes, another pair is not", async () => {
  await nav("Check");
  await fillTrade("GBPJPY");
  await page.locator("#verdict.ok").waitFor();
  await page.getByRole("button", { name: /log this trade/i }).first().click();
  await toast().filter({ hasText: "Trade logged" }).waitFor();
  await nav("Today");
  await page.locator("#today .entry", { hasText: "GBPJPY" }).getByRole("button", { name: /SL hit/ }).click();
  await page.locator("#sheet").getByRole("button", { name: /^\s*Save/ }).click();
  await toast().filter({ hasText: "Saved" }).waitFor();
  await nav("Check");
  await fillTrade("GBPJPY");
  await page.locator("#verdict.no").waitFor();
  assert.match(await page.locator("#verdict").innerText(), /Cooldown After a Loss/);
  assert.match(await page.locator(".banner.lock").innerText(), /GBPJPY lost a trade/);
  await shot("18-cooldown-locked-dark");
  await field("Pair").fill("EURUSD");
  await field("Lot size").fill("0.2");
  await page.locator("#verdict.ok").waitFor();
  await field("Pair").fill("GBPJPY");
  await field("Lot size").fill("0.02");
  await page.locator("#verdict.no").waitFor();
  await page.clock.fastForward(11 * 60000); // ten minutes later the pair is free again
  await page.locator("#verdict.ok").waitFor();
});
await step("Stats and Today show the discipline score and streaks", async () => {
  await nav("Stats");
  const card = page.locator("#stats .disc");
  assert.match(await card.innerText(), /Discipline/);
  assert.match(await card.innerText(), /trade streak/i);
  await shot("19-discipline-stats-dark");
  await nav("Today");
  assert.match(await page.locator("#today .disc").innerText(), /day streak/i);
});
await step("Settings has a Reminders card with the two limits", async () => {
  await nav("Settings");
  const card = page.locator("#settings .card", { hasText: "Reminders" }).first();
  await card.waitFor();
  assert.equal(await card.locator('input[type="number"]').first().inputValue(), "5");
  assert.equal(await card.locator('input[type="number"]').nth(1).inputValue(), "120");
  await shot("20-reminders-settings-dark");
});
await step("remove the extra test trade again", async () => {
  await nav("Journal");
  const entry = page.locator("#log .entry", { hasText: "GBPJPY" });
  await entry.locator(".entry-head").click();
  await entry.getByRole("button", { name: /delete/i }).click();
  await page.locator(".confirm-toast").getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#log .entry", { hasText: "GBPJPY" }).count(), 0);
});

console.log("\nLight mode");
await step("every tab renders in light mode (screenshots)", async () => {
  await page.getByRole("button", { name: /switch light\/dark/i }).click();
  assert.equal(await theme(), "light");
  for (const [label, file] of [["Check", "11-checklist-light"], ["Today", "12-today-light"], ["Journal", "13-journal-light"], ["Stats", "14-stats-light"], ["Settings", "15-settings-light"]]) {
    await nav(label);
    await page.waitForTimeout(450);
    await shot(file);
  }
  await page.getByRole("button", { name: /switch light\/dark/i }).click();
});

console.log("\nDelete, logout, login");
await step("deleting a trade asks for confirmation", async () => {
  await nav("Journal");
  await page.locator("#log .entry", { hasText: "XAUUSD" }).locator(".entry-head").click().catch(() => {});
  const del = page.locator("#log .entry", { hasText: "XAUUSD" }).getByRole("button", { name: /delete/i });
  if (!(await del.isVisible())) await page.locator("#log .entry", { hasText: "XAUUSD" }).locator(".entry-head").click();
  const confirmBox = page.locator(".confirm-toast");
  await del.click();
  await confirmBox.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#log .entry", { hasText: "XAUUSD" }).count(), 1, "cancelling the confirm must keep the trade");
  await del.click();
  await confirmBox.getByRole("button", { name: "Delete", exact: true }).click();
  await page.locator("#log .empty").waitFor();
});
await step("logout returns to the landing page and clears the session", async () => {
  await page.getByRole("button", { name: "Log out" }).first().click();
  await page.locator("#auth").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("atm_hint")), null);
});
await step("logging back in with the same account works", async () => {
  await page.locator(".auth-tabs button", { hasText: "Log in" }).click();
  await page.locator('#auth input[type="email"]').fill(email);
  await page.locator('#auth input[type="password"]').fill(password);
  await page.locator(".af-submit").click();
  await page.locator(".app-header h1").waitFor({ timeout: 90000 });
  await nav("Settings");
  assert.equal(await page.locator(".kz-row", { hasText: "Asian" }).locator(".kz-times input").nth(1).inputValue(), "23:59");
});
await step("signing up again with the same email is refused", async () => {
  await page.getByRole("button", { name: "Log out" }).first().click();
  await page.locator(".auth-tabs button", { hasText: "Sign up" }).click();
  await page.locator('#auth input[type="email"]').fill(email.toUpperCase());
  await page.locator('#auth input[type="password"]').fill(password);
  await page.locator(".af-submit").click();
  await page.locator(".af-error").waitFor();
  assert.match(await page.locator(".af-error").innerText(), /already exists/i);
});

console.log("\nMobile (390x844)");
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true, reducedMotion: "reduce" });
mobile.setDefaultTimeout(8000);
const mp = await mobile.newPage();
mp.on("pageerror", (e) => problems.push(`mobile pageerror: ${e.message}`));
await step("landing fits the phone width with no sideways scroll", async () => {
  await mp.goto(URL);
  await mp.locator("#auth").waitFor();
  const m = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(m.sw <= m.iw, `horizontal scroll: ${m.sw} > ${m.iw}`);
  await mp.screenshot({ path: path.join(SHOTS, "16-landing-mobile.png"), fullPage: true });
});
await step("log in on the phone, open the menu, switch tabs", async () => {
  await mp.locator(".auth-tabs button", { hasText: "Log in" }).click();
  await mp.locator('#auth input[type="email"]').fill(email);
  await mp.locator('#auth input[type="password"]').fill(password);
  await mp.locator(".af-submit").click();
  await mp.locator(".app-header h1").waitFor({ timeout: 90000 });
  const m = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(m.sw <= m.iw, `horizontal scroll in app: ${m.sw} > ${m.iw}`);
  await mp.getByRole("button", { name: "Open menu" }).click();
  await mp.locator(".sidebar.open").waitFor();
  await mp.locator(".sidebar button", { hasText: "Stats" }).click();
  await mp.locator("#stats.active").waitFor();
  await mp.waitForTimeout(700);
  await mp.screenshot({ path: path.join(SHOTS, "17-stats-mobile.png") });
});

await browser.close();

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed`);
if (problems.length) {
  console.log(`\nBrowser errors (${problems.length}):`);
  [...new Set(problems)].forEach((p) => console.log("  - " + p));
}
console.log(`Screenshots: ${SHOTS}`);
process.exit(failed || problems.length ? 1 : 0);
