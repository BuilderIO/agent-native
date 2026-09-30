// Leaves a logged-in figma.com/design tab open in the shared browser, which is
// what figlib.open() looks for.
//
// In a Fusion branch the session comes from the FIGMA_COOKIES_B64 project
// secret, and FIGMA_FILE_URL is the file to open. On your machine, log in to
// Figma in your own Chrome (started with --remote-debugging-port=9222) and open
// the file there; this script only checks it.
import { CDP_URL, FUSION, chromium } from "../harness/harness-env.mjs";

const { FIGMA_FILE_URL, FIGMA_COOKIES_B64 } = process.env;
if (FUSION && (!FIGMA_FILE_URL || !FIGMA_COOKIES_B64)) {
  console.log("figma: skipped, FIGMA_FILE_URL or FIGMA_COOKIES_B64 is not set");
  process.exit(0);
}

const browser = await chromium.connectOverCDP(CDP_URL).catch(() => null);
if (!browser) {
  console.log(
    `figma: no browser at ${CDP_URL}. Start Chrome with --remote-debugging-port=9222 and log in to Figma.`,
  );
  process.exit(1);
}
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("figma.com/design"));
if (!page && FUSION) {
  await ctx.addCookies(
    JSON.parse(Buffer.from(FIGMA_COOKIES_B64, "base64").toString()),
  );
  page = await ctx.newPage();
  await page.goto(FIGMA_FILE_URL, { waitUntil: "domcontentloaded" });
}
if (page)
  await page.waitForSelector("canvas", { timeout: 60000 }).catch(() => {});
if (!page) {
  console.log(
    "figma: no figma.com/design tab in your Chrome. Log in and open the file there first.",
  );
  await browser.close();
  process.exit(1);
}
const state = await page.evaluate(() => ({
  blocked: /Request blocked/.test(document.body.innerText),
  loggedOut: /Sign in to Figma|Log in/.test(
    document.body.innerText.slice(0, 300),
  ),
  canvas: Boolean(document.querySelector("canvas")),
}));
console.log(
  "figma:",
  JSON.stringify({ url: page.url().slice(0, 90), ...state }),
);
await browser.close();
if (state.blocked || state.loggedOut || !state.canvas) process.exit(1);
