import { chromium } from "/Users/steve/Projects/builder/agent-native/framework/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js";

const TOKEN =
  "4UAJwZPD1esjvguATq2TLJcjVgk2Ep9S.eZsK4wwGLvISLENgWnjuDaV4pKXJmS81oZezWjfMU6Q%3D";
const BASE = "http://localhost:9211";

const deckId = process.argv[2];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
});
await context.addCookies([
  {
    name: "an_slides.session_token",
    value: TOKEN,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  },
]);
const page = await context.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/export|Error|warn/i.test(t)) console.log("PAGE>", t.slice(0, 300));
});

await page.goto(`${BASE}/deck/${deckId}`, {
  waitUntil: "domcontentloaded",
  timeout: 180000,
});
await page.waitForSelector("[data-slide-canvas]", { timeout: 180000 });
await page.waitForTimeout(6000);

const info = await page.evaluate(() => {
  const ids = [
    ...new Set(
      Array.from(document.querySelectorAll("[data-slide-canvas]")).map((el) =>
        el.getAttribute("data-slide-canvas"),
      ),
    ),
  ];
  const buttons = Array.from(
    document.querySelectorAll("button,[role=button],a"),
  )
    .map((b) => (b.textContent || "").trim())
    .filter((t) => t && t.length < 40);
  return { slideCount: ids.length, ids, buttons: [...new Set(buttons)] };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
