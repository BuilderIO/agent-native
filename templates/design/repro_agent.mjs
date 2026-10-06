import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('/root/app/.tmp/test-logo.svg', 'utf8');
const target = process.argv[2] ?? 'chat';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes('/design')) ?? ctx.pages()[0];
await page.bringToFront();
await page.route('**/_agent-native/file-upload/status*', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, activeProvider: 's3', providers: [{ id: 's3', name: 'S3', configured: true }], builderConfigured: false, builderUploadConfigured: false }) });
});
await page.goto('http://127.0.0.1:8080/design/design/qa6xfjc7v256?editorView=overview&screen=qa6xfjc7v256-f1', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Agent' }).first().waitFor({ state: 'visible', timeout: 90000 });
await page.getByRole('button', { name: 'Agent' }).first().click();
await page.locator('.agentkit-chat').first().waitFor({ state: 'visible', timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(({ svg, target }) => {
  const chat = document.querySelector('.agentkit-chat');
  const el = target === 'editor' ? chat.querySelector('[data-agent-composer-slot="editor"] .ProseMirror') : (chat.querySelector('.agentkit-chat-footer') ?? chat);
  const file = new File([svg], 'logo.svg', { type: 'image/svg+xml' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const r = el.getBoundingClientRect();
  const cx = r.left + 20, cy = r.top + Math.min(20, r.height / 2);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  }
}, { svg, target });
await page.waitForTimeout(1500);
await page.screenshot({ path: `../../.tmp/agent-${target}.png` });
const alerts = await page.evaluate(() => Array.from(document.querySelectorAll('.agentkit-chat [role="alert"]')).map(a => {
  const span = a.querySelector('span');
  return { text: a.textContent, cls: a.className, w: Math.round(a.getBoundingClientRect().width), spanW: span ? Math.round(span.getBoundingClientRect().width) : null, spanScrollW: span?.scrollWidth };
}));
console.log(JSON.stringify(alerts, null, 2));
process.exit(0);
