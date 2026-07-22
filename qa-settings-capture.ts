import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "./node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";

const [, , app, port, mode = "light"] = process.argv;
if (!app || !port) {
  throw new Error("usage: qa-settings-capture.ts <app> <port> [light|dark]");
}
const root = process.cwd();
const db = `${root}/examples/${app}/data/app.db`;
const token = execFileSync("sqlite3", [
  db,
  "select token from sessions order by created_at desc limit 1;",
], { encoding: "utf8" }).trim();
if (!token) throw new Error(`No session for ${app}`);
const baseURL = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
});
await context.addInitScript((theme) => {
  window.localStorage.setItem("theme", theme);
}, mode);
await context.addCookies([
  {
    name: `an_session_${app}`,
    value: token,
    url: baseURL,
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
await page.goto("/settings", { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForTimeout(2_000);
if (page.url().includes("/_agent-native/sign-in")) {
  const email = `qa-${app}-${Date.now()}@example.com`;
  await page.locator('[data-tab="signup"]').click();
  await page.locator("#s-email").fill(email);
  await page.locator("#s-pass").fill("qa-screenshot-password");
  await page.locator("#s-pass2").fill("qa-screenshot-password");
  await page.locator('#signup-form button[type="submit"]').click();
  await page.waitForTimeout(2_000);
  if (page.url().includes("/_agent-native/sign-in")) {
    throw new Error(`Sign-up did not establish a session: ${await page.locator("body").innerText()}`);
  }
  await page.goto("/settings", { waitUntil: "domcontentloaded", timeout: 45_000 });
}
await page.waitForTimeout(2_000);
const info = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  bodyText: document.body.innerText.slice(0, 3000),
  tabs: [...document.querySelectorAll('[role="tab"]')].map((node) => ({
    text: node.textContent?.trim(),
    visible: (node as HTMLElement).offsetParent !== null,
  })),
  tablists: [...document.querySelectorAll('[role="tablist"]')].map((node) => ({
    orientation: node.getAttribute("aria-orientation"),
    className: node.className,
  })),
  mui: document.querySelectorAll('[class*="Mui"]').length,
  ant: document.querySelectorAll('[class*="ant-"]').length,
}));
console.log(JSON.stringify({ app, info, errors }, null, 2));
mkdirSync("/tmp/agent-native-ds-shots", { recursive: true });
const output = `/tmp/agent-native-ds-shots/chat-${app}-settings-${mode}.png`;
await page.screenshot({ path: output, fullPage: true });
console.log(`screenshot ${output}`);
await context.close();
await browser.close();
