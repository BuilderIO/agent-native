import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => p.url().includes(":9310"));
const composer = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('[contenteditable="true"]')].find((e) => e.offsetParent && (e.getAttribute("aria-label") || e.getAttribute("data-placeholder") || "").includes("Message agent"));
  if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (!(await composer())) { await page.mouse.click(1484, 24); await page.waitForTimeout(4000); }
const c = await composer();
console.log("composer", c);
await page.mouse.click(c.x, c.y);
await page.keyboard.type("Probe A: which slide am I on?");
await page.keyboard.press("Enter");
await page.waitForTimeout(25000);
fs.writeFileSync("/root/app/code/.tmp/proof/dry6.png", await page.screenshot({ timeout: 30000 }));
console.log((await page.evaluate(() => document.body.innerText)).match(/Probe A[^\n]*/g));
process.exit(0);
