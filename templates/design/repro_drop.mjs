import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('/root/app/.tmp/test-logo.svg', 'utf8');
const fileKind = process.argv[3] ?? 'svg';
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes('/design')) ?? ctx.pages()[0];
await page.bringToFront();
await page.route('**/_agent-native/file-upload/status*', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, activeProvider: 's3', providers: [{ id: 's3', name: 'S3', configured: true }], builderConfigured: false, builderUploadConfigured: false }) });
});
await page.goto('http://127.0.0.1:8080/design/home', { waitUntil: 'domcontentloaded' });
await page.locator('[data-agent-composer-slot="plus-button"]').first().waitFor({ state: 'visible', timeout: 60000 });
for (let i = 0; i < 20; i++) {
  const n = await page.evaluate(() => document.querySelectorAll('[data-agent-composer-slot="toolbar"] input[type="file"]').length);
  if (n > 0) break;
  await page.waitForTimeout(500);
}
const mode = process.argv[2] ?? 'drop';
page.on('console', m => { if (/attach|accept|svg|error/i.test(m.text())) console.log('[console]', m.type(), m.text().slice(0,300)); });
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,300)));
await page.evaluate(({ svg, mode, fileKind, pngB64 }) => {
  const target = document.querySelector('[data-agent-composer-slot="editor"] .ProseMirror');
  const file = fileKind === 'png' ? new File([Uint8Array.from(atob(pngB64), c => c.charCodeAt(0))], 'logo.png', { type: 'image/png' }) : new File([svg], 'logo.svg', { type: 'image/svg+xml' });
  const dt = new DataTransfer();
  dt.items.add(file);
  if (mode === 'paste') {
    target.focus();
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } else {
    const r = target.getBoundingClientRect();
    const cx = r.left + 20, cy = r.top + r.height / 2;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    }
  }
}, { svg, mode, fileKind, pngB64 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `../../.tmp/after-${mode}.png` });
const alerts = await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"], [data-sonner-toast]')).map(a => ({ text: a.textContent, cls: a.className })));
console.log(JSON.stringify(alerts, null, 2));
const chips = await page.evaluate(() => document.querySelector('[data-agent-composer-slot="root"]')?.innerText);
console.log('composer text:', chips);
process.exit(0);
