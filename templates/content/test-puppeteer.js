const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  
  await page.goto('http://localhost:8080/alice/how-to-run-claude-code-on-mobile', { waitUntil: 'networkidle0' });
  
  console.log('Page loaded, looking for Notion button...');
  
  // Find Notion button
  const buttons = await page.$$('button');
  let notionBtn;
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Notion')) {
      notionBtn = btn;
      break;
    }
  }
  
  if (notionBtn) {
    console.log('Clicking Notion button...');
    await notionBtn.click();
    await page.waitForTimeout(2000); // Wait for potential crash
  } else {
    console.log('Could not find Notion button');
  }
  
  await browser.close();
})();
