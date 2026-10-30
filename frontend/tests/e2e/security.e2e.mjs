// End-to-end test of the account security features in a real browser: admin approval of sign-ups, two-factor sign-in with
// recovery codes, staying signed in after a reload, "log out of all devices", and "download my data".
//
// Start the API on a TEST database with these settings, plus an admin (see README):
//   REQUIRE_ADMIN_APPROVAL=true  ADMIN_REQUIRE_2FA=true  CORS_ORIGINS=<the URL below>
//   python -m app.cli.create_admin e2e-admin@example.com correct-horse-42        (once per run: its 2FA is set up here)
//   E2E_URL=http://localhost:5299 E2E_ADMIN_EMAIL=e2e-admin@example.com node tests/e2e/security.e2e.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5299";
const ADMIN = process.env.E2E_ADMIN_EMAIL;
const SHOTS = process.env.SHOTS || path.resolve("e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
if (!ADMIN) throw new Error("Set E2E_ADMIN_EMAIL to an admin created with app.cli.create_admin (password correct-horse-42)");

const password = "correct-horse-42";
const applicant = `applicant-${Date.now()}@example.com`;
const results = [];
const problems = [];

// ---- a TOTP generator (RFC 6238, SHA-1, 6 digits, 30 s) so the test can read the setup key and type real codes ----
const base32 = (s) => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...s.replace(/=+$/, "")].map((c) => A.indexOf(c).toString(2).padStart(5, "0")).join("");
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
};
const totp = (secret, step) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
};
const nowStep = () => Math.floor(Date.now() / 30000);

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
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|fonts\.g|status of (401|403|409|422|429)/.test(m.text())) problems.push(`console.error: ${m.text()}`);
  });
  return page;
}
const adminPage = await newPage();
const userPage = await newPage();

const nav = (page, label) => page.locator(".sidebar button", { hasText: label }).first().click();
const toast = (page) => page.locator(".toast");
const tab = async (page, name) => { await page.locator(".auth-tabs button", { hasText: name }).click(); };
async function submitAuth(page, email, pw, mode) {
  await tab(page, mode);
  await page.locator('#auth input[type="email"]').fill(email);
  await page.locator('#auth input[type="password"]').fill(pw);
  await page.locator(".af-submit").click();
}
async function login(page, email, pw = password) {
  await page.goto(URL);
  await submitAuth(page, email, pw, "Log in");
}
const logout = async (page) => { await page.getByRole("button", { name: "Log out" }).first().click(); await page.locator("#auth").waitFor(); };
const inApp = (page) => page.locator(".app-header h1").waitFor({ timeout: 60000 });
const storedSecrets = (page) => page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));

console.log(`\nSecurity E2E against ${URL} (admin ${ADMIN}, applicant ${applicant})\n`);

console.log("Admin approval");
await step("a new sign-up lands on 'waiting for approval', not in the app", async () => {
  await userPage.goto(URL);
  await submitAuth(userPage, applicant, password, "Sign up");
  await userPage.getByRole("heading", { name: "Waiting for approval" }).waitFor();
  assert.equal(await userPage.locator(".app-header").count(), 0);
  await userPage.screenshot({ path: path.join(SHOTS, "sec-01-waiting.png") });
});
await step("logging in before approval is refused with a clear message", async () => {
  await userPage.getByRole("button", { name: "Back to log in" }).click();
  await submitAuth(userPage, applicant, password, "Log in");
  await userPage.locator(".af-error").waitFor();
  assert.match(await userPage.locator(".af-error").innerText(), /waiting for admin approval/i);
});

console.log("\nAdmin and two-factor sign-in");
await step("the admin logs in with the password", async () => {
  await login(adminPage, ADMIN);
  await inApp(adminPage);
  await nav(adminPage, "Admin");
});
await step("admin tools are blocked until two-factor sign-in is on", async () => {
  await adminPage.locator("#admin .banner").waitFor();
  assert.match(await adminPage.locator("#admin .banner").innerText(), /two-factor/i);
  assert.equal(await adminPage.locator(".pending-card").count(), 0);
});
let secret;
let recovery;
await step("Settings > Security walks through setup: password, QR code, first code, recovery codes", async () => {
  await nav(adminPage, "Settings");
  await adminPage.getByRole("button", { name: "Turn on two-factor sign-in" }).click();
  await adminPage.getByLabel("Password").fill(password);
  await adminPage.getByRole("button", { name: "Continue" }).click();
  await adminPage.locator("img.tf-qr").waitFor();
  assert.match(await adminPage.locator("img.tf-qr").getAttribute("src"), /^data:image\/svg\+xml/);
  secret = (await adminPage.locator(".tf-key code").innerText()).trim();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  await adminPage.screenshot({ path: path.join(SHOTS, "sec-02-2fa-setup.png") });
  await adminPage.getByLabel("6-digit code").fill(totp(secret, nowStep()));
  await adminPage.getByRole("button", { name: "Turn on", exact: true }).click();
  await adminPage.locator("pre.tf-codes").waitFor();
  recovery = (await adminPage.locator("pre.tf-codes").innerText()).trim().split("\n");
  assert.equal(recovery.length, 10);
  assert.ok(recovery.every((c) => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)), "recovery codes look like xxxxx-xxxxx");
  await adminPage.screenshot({ path: path.join(SHOTS, "sec-03-recovery-codes.png") });
  await adminPage.getByRole("button", { name: "I have saved them" }).click();
  await adminPage.getByRole("button", { name: "Turn off two-factor sign-in" }).waitFor();
});
await step("an admin cannot switch two-factor sign-in off again", async () => {
  await adminPage.getByRole("button", { name: "Turn off two-factor sign-in" }).click();
  await adminPage.getByLabel("Password", { exact: true }).fill(password);
  await adminPage.getByLabel("Code or recovery code").fill(recovery[9]);
  await adminPage.getByRole("button", { name: "Turn off", exact: true }).click();
  await adminPage.locator(".af-error").waitFor();
  assert.match(await adminPage.locator(".af-error").innerText(), /admins cannot turn/i);
  await adminPage.getByRole("button", { name: "Cancel" }).click();
});
await step("the admin tab now shows the waiting sign-up, and Approve lets them in", async () => {
  await nav(adminPage, "Admin");
  const card = adminPage.locator(".pending-card");
  await card.waitFor();
  assert.match(await card.innerText(), new RegExp(applicant));
  await adminPage.screenshot({ path: path.join(SHOTS, "sec-04-admin-requests.png") });
  const row = card.locator("li", { hasText: applicant }); // other sign-ups may be waiting too: act on this one only
  await row.getByRole("button", { name: /^\s*Approve/ }).click();
  await toast(adminPage).filter({ hasText: "Approved" }).waitFor();
  await row.waitFor({ state: "detached" });
});
await step("the approved user can now log in and use the app", async () => {
  await login(userPage, applicant);
  await inApp(userPage);
  assert.match(await userPage.locator(".user-email").innerText(), new RegExp(applicant.split("@")[0]));
});

console.log("\nSessions");
await step("no login token is stored in the browser (only a hint), yet a reload keeps the user signed in", async () => {
  const stored = await storedSecrets(userPage);
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(stored), "a JWT is in localStorage/sessionStorage");
  assert.ok(!/access_token|refresh/i.test(stored), "token fields are in storage");
  await userPage.reload();
  await inApp(userPage);
  assert.match(await userPage.locator(".user-email").innerText(), new RegExp(applicant.split("@")[0]));
});
await step("the refresh cookie is HttpOnly and scripts cannot read it", async () => {
  assert.equal(await userPage.evaluate(() => document.cookie), "");
  const cookies = await userPage.context().cookies();
  const c = cookies.find((x) => x.name === "tg_refresh");
  assert.ok(c, "refresh cookie is set");
  assert.equal(c.httpOnly, true);
  assert.equal(c.path, "/api/auth");
});
await step("an expired access token is renewed silently while working", async () => {
  // The app is already open. Make the next save look like the token expired mid-session (the server answers 401): the app must
  // renew it from the cookie and repeat the save without bothering the user.
  const refreshes = [];
  userPage.on("response", (r) => { if (r.url().includes("/api/auth/refresh")) refreshes.push(r.status()); });
  let broke = false;
  await userPage.route("**/api/settings", async (route, request) => {
    if (request.method() === "PUT" && !broke) { broke = true; return route.continue({ headers: { ...request.headers(), authorization: "Bearer expired.token.value" } }); }
    return route.continue();
  });
  await nav(userPage, "Settings");
  await userPage.locator("label.field", { hasText: "Starting balance" }).locator("input").fill("2468");
  await userPage.getByRole("button", { name: /save settings/i }).click();
  await toast(userPage).filter({ hasText: "Settings saved" }).waitFor();
  await userPage.unroute("**/api/settings");
  assert.ok(broke, "the save was intercepted");
  assert.ok(refreshes.includes(200), `the app renewed its token (refresh answers: ${refreshes})`);
  await userPage.reload();
  await inApp(userPage);
  await nav(userPage, "Settings");
  assert.equal(await userPage.locator("label.field", { hasText: "Starting balance" }).locator("input").inputValue(), "2468");
});

console.log("\nSigning in with two-factor");
await step("after logout, logging in asks for a code; a wrong one is refused", async () => {
  await logout(adminPage);
  await submitAuth(adminPage, ADMIN, password, "Log in");
  await adminPage.getByRole("heading", { name: "Two-factor code" }).waitFor();
  assert.equal(await adminPage.locator(".app-header").count(), 0, "no app before the code");
  await adminPage.screenshot({ path: path.join(SHOTS, "sec-05-2fa-login.png") });
  await adminPage.getByPlaceholder("123456").fill("000000");
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await adminPage.locator(".af-error").waitFor();
  assert.match(await adminPage.locator(".af-error").innerText(), /not right/i);
});
await step("the right code from the authenticator app opens the app", async () => {
  // the code used to turn 2FA on is spent; the next time step's code is accepted (clock tolerance of one step)
  await adminPage.getByPlaceholder("123456").fill(totp(secret, nowStep() + 1));
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await inApp(adminPage);
  await nav(adminPage, "Admin");
  await adminPage.locator("#admin .admin-tiles").waitFor();
});
await step("a recovery code works once, and only once", async () => {
  await logout(adminPage);
  await submitAuth(adminPage, ADMIN, password, "Log in");
  await adminPage.getByPlaceholder("123456").fill(recovery[0]);
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await inApp(adminPage);
  await logout(adminPage);
  await submitAuth(adminPage, ADMIN, password, "Log in");
  await adminPage.getByPlaceholder("123456").fill(recovery[0]);
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await adminPage.locator(".af-error").waitFor();
  assert.match(await adminPage.locator(".af-error").innerText(), /not right/i);
  await adminPage.getByPlaceholder("123456").fill(recovery[1]);
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await inApp(adminPage);
});

console.log("\nAccount data and signing out everywhere");
await step("Download my data saves a JSON file with the account's data", async () => {
  await nav(userPage, "Settings");
  const [download] = await Promise.all([userPage.waitForEvent("download"), userPage.getByRole("button", { name: "Download my data" }).click()]);
  assert.equal(download.suggestedFilename(), "trade-guard-data.json");
  const data = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.equal(data.account.email, applicant);
  assert.ok(Array.isArray(data.entries) && data.settings && "minRR" in data.settings);
  assert.ok(!JSON.stringify(data).includes("password"), "no password data in the export");
});
await step("'Log out of all devices' signs out this browser and every other session", async () => {
  const second = await newPage(); // the same user on a second device
  await login(second, applicant);
  await inApp(second);
  await userPage.getByRole("button", { name: "Log out of all devices" }).click();
  await userPage.locator("#auth").waitFor();
  await second.reload();
  await second.locator("#auth").waitFor(); // the other device lost its session too
  await userPage.reload();
  await userPage.locator("#auth").waitFor();
  assert.equal(await userPage.context().cookies().then((c) => c.filter((x) => x.name === "tg_refresh" && x.value).length), 0);
});
await step("no page errors or console errors", async () => {
  assert.deepEqual(problems, []);
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} steps passed`);
console.log(`Screenshots: ${SHOTS}`);
process.exit(passed === results.length ? 0 : 1);
