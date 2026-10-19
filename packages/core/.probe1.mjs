import { chromium } from "playwright";
import fs from "node:fs";
const DECK = "deck-1792416171843-pl14m";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes(":9310")) ?? (await ctx.newPage());
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
await page.goto(`http://127.0.0.1:9310/deck/${DECK}?slide=2`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000);
fs.writeFileSync("/tmp/proof/dry1.png", await page.screenshot({ timeout: 30000 }));
const composers = await page.evaluate(() =>
  [...document.querySelectorAll('textarea, [contenteditable="true"]')].map((el) => ({
    tag: el.tagName, ph: el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("data-placeholder"), visible: !!el.offsetParent,
  })),
);
console.log(JSON.stringify(composers));
