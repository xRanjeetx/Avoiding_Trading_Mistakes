// End-to-end test for trade screenshots: a real browser against the real frontend and API.
//
//   E2E_URL=http://localhost:5199 node tests/tests/e2e/shots.e2e.mjs
//
// Start the API on a TEST database first (see README). The test creates a brand-new account each run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5199";
const SHOTS = process.env.SHOTS || path.resolve("e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });

// A valid PNG made on the spot: `w` x `h` pixels of one colour.
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const file = (name, w, h, rgb) => ({ name, mimeType: "image/png", buffer: png(w, h, rgb) });

const email = `shots-${Date.now()}@example.com`;
const results = [];
const problems = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✖ ${name}\n      ${String(err.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 800 }, colorScheme: "dark", reducedMotion: "reduce" });
context.setDefaultTimeout(8000);
const page = await context.newPage();
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|fonts\.g/.test(m.text())) problems.push(`console.error: ${m.text()}`);
});
const nav = (label) => page.locator(".sidebar button", { hasText: label }).first().click();
const api = async (method, url, body) => page.evaluate(async ([method, url, body]) => {
  const { access_token: token } = await fetch("/api/auth/refresh", { method: "POST" }).then((r) => r.json());
  const res = await fetch(`/api${url}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return res.status === 204 ? null : res.json();
}, [method, url, body]);

console.log(`\nScreenshots E2E against ${URL} as ${email}\n`);

await step("sign up through the API and open the app", async () => {
  await page.goto(URL);
  const res = await page.evaluate(async (email) => {
    const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "correct-horse-42" }) });
    return r.json();
  }, email);
  await page.evaluate((s) => localStorage.setItem("atm_hint", JSON.stringify({ email: s.email, isAdmin: false })), res);
  await page.evaluate(async () => fetch("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await fetch("/api/auth/refresh", { method: "POST" }).then((r) => r.json())).access_token}` },
    body: JSON.stringify({ id: "e2eshot1", timestamp: Date.now(), pair: "XAUUSD", dir: "buy", setup: "fvg", lot: 0.02, entry: 2000, sl: 1990, tp: 2020, rr: 2 }),
  }));
  await page.goto(URL);
  await page.locator(".sidebar").waitFor();
});

await step("the edit sheet offers two empty screenshot slots", async () => {
  await nav("Journal");
  await page.locator("#log .entry", { hasText: "XAUUSD" }).locator(".entry-head").click();
  await page.locator("#log .entry.open").getByRole("button", { name: /Close trade/ }).click();
  await page.locator("#sheet").waitFor();
  assert.equal(await page.locator("#sheet .shot-add").count(), 2);
});

await step("picking a file uploads it, shrinks it to WebP and shows a preview", async () => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#sheet .shot-add", { hasText: "Before entry" }).click(),
  ]);
  await chooser.setFiles(file("big.png", 3200, 1800, [34, 211, 238]));
  await page.locator("#sheet .shot-frame img").waitFor();
  assert.equal(await page.locator("#sheet .shot-add").count(), 1);
  const stored = await api("GET", "/entries");
  assert.deepEqual(Object.keys(stored[0].images), ["before"]);
  const info = await page.evaluate(async () => {
    const { access_token: token } = await fetch("/api/auth/refresh", { method: "POST" }).then((r) => r.json());
    const res = await fetch("/api/entries/e2eshot1/images/before", { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, size: blob.size, w: bmp.width, h: bmp.height };
  });
  assert.equal(info.type, "image/webp");
  assert.equal(info.w, 1600, `expected the 3200px image to be shrunk to 1600, got ${info.w}`);
  assert.ok(info.size < 200 * 1024, `compressed size ${info.size}`);
});

await step("replacing a screenshot shows the new picture, not a cached copy of the old one", async () => {
  const oldToken = (await api("GET", "/entries"))[0].images.before;
  await page.locator("#sheet input[type=file]").first().setInputFiles(file("new.png", 500, 300, [34, 197, 94]));
  await page.waitForFunction(() => document.querySelector("#sheet .shot-frame img")?.naturalWidth === 500);
  const newToken = (await api("GET", "/entries"))[0].images.before;
  assert.notEqual(newToken, oldToken);
});

await step("a second slot works, and a non-image file is refused with a message", async () => {
  const [c1] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#sheet .shot-add").click()]);
  await c1.setFiles(file("after.png", 800, 500, [244, 63, 94]));
  await page.locator("#sheet .shot-frame").nth(1).waitFor();
  assert.equal(await page.locator("#sheet .shot-add").count(), 0);
  // Replace the first one with a text file: the server must not change.
  const before = (await api("GET", "/entries"))[0].images.before;
  const input = page.locator("#sheet input[type=file]").first();
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.locator(".toast", { hasText: /image file/i }).waitFor();
  assert.equal((await api("GET", "/entries"))[0].images.before, before);
});

await step("pasting a screenshot (Ctrl+V) fills the first empty slot", async () => {
  await page.getByRole("button", { name: /Remove after close screenshot/i }).click();
  await page.locator("#sheet .shot-add").waitFor();
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "paste.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png(600, 400, [250, 204, 21]).toString("base64"));
  await page.locator("#sheet .shot-frame").nth(1).waitFor();
  assert.deepEqual(Object.keys((await api("GET", "/entries"))[0].images).sort(), ["after", "before"]);
});

await step("saving the trade keeps the screenshots", async () => {
  await page.locator("#sheet").getByRole("button", { name: /^Save/ }).click();
  await page.locator("#sheet").waitFor({ state: "detached" });
  assert.deepEqual(Object.keys((await api("GET", "/entries"))[0].images).sort(), ["after", "before"]);
});

await step("the journal card shows a camera tag and both thumbnails after a reload", async () => {
  await page.reload();
  await nav("Journal");
  const card = page.locator("#log .entry", { hasText: "XAUUSD" });
  await card.locator(".entry-head").click();
  await card.locator(".shot-thumb img").nth(1).waitFor();
  assert.equal(await card.locator(".shot-thumb").count(), 2);
  assert.ok(await card.locator('[title="Has screenshots"]').count());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "shots-journal.png") });
});

await step("clicking a thumbnail opens it large, and Escape closes it", async () => {
  await page.locator("#log .shot-thumb").first().click();
  const img = page.locator(".lightbox img");
  await img.waitFor();
  const box = await img.boundingBox();
  assert.ok(box.width > 400, `lightbox image only ${box.width}px wide`);
  await page.screenshot({ path: path.join(SHOTS, "shots-lightbox.png") });
  await page.keyboard.press("Escape");
  await page.locator(".lightbox").waitFor({ state: "detached" });
});

await step("another account cannot see these images", async () => {
  const res = await page.evaluate(async (email) => {
    const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x" + email, password: "correct-horse-42" }) });
    const { access_token: accessToken } = await r.json();
    const get = await fetch("/api/entries/e2eshot1/images/before", { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
    const anon = await fetch("/api/entries/e2eshot1/images/before", { cache: "no-store" });
    return [get.status, anon.status];
  }, email);
  assert.deepEqual(res, [404, 401], `got ${JSON.stringify(res)}`);
});

await step("deleting the trade removes its images from the database", async () => {
  await page.evaluate(async () => { const { access_token } = await fetch("/api/auth/refresh", { method: "POST" }).then((r) => r.json()); return fetch("/api/entries/e2eshot1", { method: "DELETE", headers: { Authorization: `Bearer ${access_token}` } }); });
  assert.deepEqual(await api("GET", "/entries"), []);
});

await step("phone width: the sheet's screenshot slots fit with no sideways scroll", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await api("POST", "/entries", { id: "e2eshot2", timestamp: Date.now(), pair: "EURUSD", dir: "sell" });
  await page.reload();
  await nav("Journal").catch(async () => { await page.getByRole("button", { name: "Open menu" }).click(); await nav("Journal"); });
  await page.locator("#log .entry", { hasText: "EURUSD" }).locator(".entry-head").click();
  await page.locator("#log .entry.open").getByRole("button", { name: /Close trade/ }).click();
  await page.locator("#sheet .shot-add").first().waitFor();
  const m = await page.evaluate(() => ({ sw: document.querySelector(".sheet-card").scrollWidth, cw: document.querySelector(".sheet-card").clientWidth }));
  assert.ok(m.sw <= m.cw, `sheet scrolls sideways (${m.sw} > ${m.cw})`);
  await page.screenshot({ path: path.join(SHOTS, "shots-mobile-sheet.png") });
});

await step("no page errors or console errors", async () => assert.deepEqual(problems, []));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
