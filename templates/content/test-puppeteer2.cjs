const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const page = await browser.newPage();
  
  page.on('pageerror', err => {
    console.log('PAGE_ERROR:', err.message);
  });
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('CONSOLE_ERROR:', msg.text());
    }
  });
  
  await page.goto('http://localhost:8080/alice/how-to-run-claude-code-on-mobile');
  
  // wait for editor to load
  await page.waitForSelector('button');
  
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Notion')) {
      console.log('Clicking Notion button...');
      await btn.click();
      break;
    }
  }
  
  await page.waitForTimeout(3000);
  await browser.close();
})();
