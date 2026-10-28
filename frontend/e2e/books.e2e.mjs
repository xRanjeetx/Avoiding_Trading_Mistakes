// End-to-end test for the Learning library: the shared books are listed, opened in the in-app reader, and your place is kept.
//
//   node e2e/make-library.mjs <folder>                      writes two test PDFs
//   LIBRARY_DIR=<folder> ...start the API on a TEST database, and the frontend dev server...
//   E2E_URL=http://localhost:5199 node e2e/books.e2e.mjs
//
// Like the main e2e test, it creates a brand-new account each run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5199";
const email = `books-${Date.now()}@example.com`;
const password = "password123";

// SHOTS=<folder> saves a picture at the main moments, to look at the screens.
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
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
const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: "dark", reducedMotion: "reduce" });
context.setDefaultTimeout(15000);
const page = await context.newPage();
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|fonts\.g/.test(m.text())) problems.push(`console.error: ${m.text()}`);
});

// How much of the page is dark (text and squares on white), and a fingerprint of the picture.
const ink = () => page.evaluate(() => {
  const c = document.querySelector(".reader canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) dark++;
  return { dark, w: c.width, h: c.height, sig: c.toDataURL().slice(-60) };
});
const shot = async (name, wait = 500) => { if (SHOTS) { await page.waitForTimeout(wait); await page.screenshot({ path: path.join(SHOTS, `books-${name}.png`) }); } };
const jump = () => page.getByLabel("Page number");
const waitPage = (n) => page.waitForFunction((n) => document.querySelector(".reader-jump input")?.value === String(n), n);
const drawn = async () => { await page.waitForFunction(() => { const c = document.querySelector(".reader canvas"); return c && c.width > 100; }); await page.waitForTimeout(500); };

console.log(`\nLearning E2E against ${URL} as ${email}\n`);

await step("sign up and open the Learning tab", async () => {
  await page.goto(URL);
  await page.locator("#auth").waitFor();
  await page.locator(".auth-tabs button", { hasText: /sign up|create/i }).first().click();
  await page.locator("#auth input[type=email]").fill(email);
  await page.locator("#auth input[type=password]").first().fill(password);
  await page.locator("#auth button[type=submit], #auth .af-submit").first().click();
  await page.locator(".sidebar button", { hasText: "Learning" }).waitFor();
  await page.locator(".sidebar button", { hasText: "Learning" }).click();
  await page.locator("#learn.active").waitFor();
});

await step("the shared books are already there, in order, and cannot be changed", async () => {
  await page.locator(".book-title", { hasText: "Trading Psychology" }).waitFor();
  const titles = await page.locator(".book-title").allInnerTexts();
  assert.deepEqual(titles, ["Trading Psychology", "Strategy"]);
  assert.match(await page.locator(".book").first().innerText(), /Not started/);
  assert.equal(await page.getByRole("button", { name: /Add PDF/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^(Rename|Delete)/ }).count(), 0);
  assert.equal(await page.locator("#learn input[type=file]").count(), 0);
  await shot("library");
});

await step("Read opens the reader and page 1 is really drawn", async () => {
  await page.locator(".book", { hasText: "Trading Psychology" }).getByRole("button", { name: "Read", exact: true }).click();
  await page.locator(".reader canvas").waitFor();
  await drawn();
  const a = await ink();
  assert.ok(a.dark > 500, `page looks blank (${a.dark} dark pixels)`);
  assert.equal(await jump().inputValue(), "1");
  assert.match(await page.locator(".reader-jump").innerText(), /of 5/);
  assert.equal(await page.getByRole("button", { name: /Prev/ }).isDisabled(), true);
  await shot("reader");
});

let darkOnPage1;
await step("Next turns the page, and each page looks different", async () => {
  darkOnPage1 = (await ink()).dark;
  const sig1 = (await ink()).sig;
  await page.getByRole("button", { name: /Next/ }).click();
  await waitPage(2);
  await drawn();
  const b = await ink();
  assert.ok(b.dark > darkOnPage1, `page 2 should have more ink than page 1 (${b.dark} vs ${darkOnPage1})`);
  assert.notEqual(b.sig, sig1);
});

await step("arrow keys turn pages", async () => {
  await page.keyboard.press("ArrowRight");
  await waitPage(3);
  await page.keyboard.press("ArrowLeft");
  await waitPage(2);
});

await step("typing a page number jumps there, and out-of-range numbers are clamped", async () => {
  await jump().fill("4");
  await jump().press("Enter");
  await waitPage(4);
  await jump().fill("99");
  await jump().press("Enter");
  await waitPage(5);
  assert.equal(await page.getByRole("button", { name: /Next/ }).isDisabled(), true);
  await jump().fill("4");
  await jump().press("Enter");
  await waitPage(4);
});

await step("zoom in makes the page bigger, zoom out smaller", async () => {
  await drawn();
  const w0 = (await ink()).w;
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(600);
  assert.ok((await ink()).w > w0);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(600);
  assert.ok((await ink()).w < w0);
});

await step("closing the book keeps your place: the library shows page 4 of 5 and Continue", async () => {
  await page.getByRole("button", { name: "Close book" }).click();
  await page.locator(".reader").waitFor({ state: "detached" });
  await page.waitForFunction(() => /Page 4 of 5/.test(document.querySelector(".book")?.textContent || ""));
  assert.equal(await page.getByRole("button", { name: "Continue" }).count(), 1); // only the book you started
});

await step("reopening starts on the page you left, even after a full reload", async () => {
  await page.reload();
  await page.locator(".sidebar button", { hasText: "Learning" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator(".reader canvas").waitFor();
  await drawn();
  assert.equal(await jump().inputValue(), "4");
  await page.keyboard.press("Escape");
  await page.locator(".reader").waitFor({ state: "detached" });
});

await step("the library works on a phone-sized screen without sideways scrolling", async () => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(400);
  await shot("library-phone", 2000);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(m.sw <= m.iw, `page is wider than the screen (${m.sw} > ${m.iw})`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator(".reader canvas").waitFor();
  await drawn();
  const c = await ink();
  assert.ok(c.dark > 500);
  await shot("reader-phone");
  const fits = await page.evaluate(() => {
    const body = document.querySelector(".reader-body");
    return body.scrollWidth <= body.clientWidth + 1;
  });
  assert.ok(fits, "page is wider than the phone screen");
  await page.getByRole("button", { name: "Close book" }).click();
  await page.setViewportSize({ width: 1100, height: 800 });
});

await step("each user keeps their own place: a second account starts at the beginning", async () => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.locator("#auth").waitFor();
  await page.locator(".auth-tabs button", { hasText: /sign up|create/i }).first().click();
  await page.locator("#auth input[type=email]").fill(`books2-${Date.now()}@example.com`);
  await page.locator("#auth input[type=password]").first().fill(password);
  await page.locator("#auth button[type=submit], #auth .af-submit").first().click();
  await page.locator(".sidebar button", { hasText: "Learning" }).click();
  await page.locator(".book-title", { hasText: "Trading Psychology" }).waitFor();
  assert.match(await page.locator(".book").first().innerText(), /Not started/);
  assert.equal(await page.getByRole("button", { name: "Continue" }).count(), 0);
});

await step("no console errors or page errors", async () => {
  assert.deepEqual(problems, []);
});

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed\n`);
if (problems.length) console.log("Problems seen:\n  " + problems.join("\n  "));
process.exit(failed ? 1 : 0);
