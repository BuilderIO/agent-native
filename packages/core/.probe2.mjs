import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes(":9310"));
const start = Date.now();
while (Date.now() - start < 150000) {
  const n = await page.locator('textarea:visible, [contenteditable="true"]:visible').count();
  if (n > 0) break;
  await page.waitForTimeout(3000);
}
fs.writeFileSync("/root/app/code/.tmp/proof/dry2.png", await page.screenshot({ timeout: 30000 }));
console.log(page.url(), JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter((el) => el.offsetParent).map((el) => ({
    tag: el.tagName, ph: el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("data-placeholder"), cls: el.className.slice(0, 80),
  })),
)));
