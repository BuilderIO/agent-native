import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes('/design')) ?? ctx.pages()[0];
await page.bringToFront();
await page.route('**/_agent-native/file-upload/status*', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, activeProvider: 's3', providers: [{ id: 's3', name: 'S3', configured: true }], builderConfigured: false, builderUploadConfigured: false }) });
});
await page.goto('http://127.0.0.1:8080/design/home', { waitUntil: 'domcontentloaded' });
await page.locator('[data-agent-composer-slot="plus-button"]').first().waitFor({ state: 'visible', timeout: 60000 });
// wait for after-startup status query
for (let i = 0; i < 20; i++) {
  const n = await page.evaluate(() => document.querySelectorAll('[data-agent-composer-slot="toolbar"] input[type="file"]').length);
  if (n > 0) break;
  await page.waitForTimeout(500);
}
const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="file"]')).map(i => i.getAttribute('accept')));
console.log('inputs', inputs);
await page.locator('[data-agent-composer-slot="plus-button"]').first().click();
await page.waitForTimeout(400);
const chooserP = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
await page.getByRole('menuitem', { name: 'Upload File' }).click();
const chooser = await chooserP;
console.log('chooser', !!chooser);
if (chooser) await chooser.setFiles('/root/app/.tmp/test-logo.svg');
await page.waitForTimeout(1500);
await page.screenshot({ path: '../../.tmp/after-svg.png' });
const alerts = await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"]')).map(a => ({ text: a.textContent, cls: a.className, w: a.getBoundingClientRect().width, sw: a.scrollWidth, cw: a.clientWidth })));
console.log(JSON.stringify(alerts, null, 2));
process.exit(0);
