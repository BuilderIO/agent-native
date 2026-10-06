import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes('/design')) ?? ctx.pages()[0];
await page.bringToFront();
const bodyText = await page.evaluate(() => document.body.innerText);
console.log(bodyText.slice(0, 2000));
process.exit(0);
