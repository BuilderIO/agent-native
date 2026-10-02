// Prints the figma.com login from your Chrome on :9222 as the value for the
// FIGMA_COOKIES_B64 project secret (reference/figma.md, "Refreshing the Figma
// login"). Pipe it straight into the clipboard: it is a live session.
import { FIGMA_LOGIN_COOKIE } from "../harness/figlib.mjs";
import { CDP_URL, chromium } from "../harness/harness-env.mjs";

const browser = await chromium.connectOverCDP(CDP_URL).catch(() => null);
if (!browser) {
  console.error(
    `figma: no Chrome at ${CDP_URL}. Start it with --remote-debugging-port=9222 (reference/figma.md).`,
  );
  process.exit(1);
}
let cookies;
try {
  cookies = await browser.contexts()[0].cookies("https://www.figma.com");
} finally {
  await browser.close();
}
const login = cookies.find((c) => c.name === FIGMA_LOGIN_COOKIE);
if (!login) {
  console.error(
    `figma: that Chrome is not logged in to Figma (no ${FIGMA_LOGIN_COOKIE} cookie). Log in there, then run this again.`,
  );
  process.exit(1);
}
const until =
  login.expires > 0
    ? `valid until ${new Date(login.expires * 1000).toISOString().slice(0, 10)}`
    : "with no expiry set";
console.error(`figma: exported ${cookies.length} cookies, login ${until}`);
process.stdout.write(Buffer.from(JSON.stringify(cookies)).toString("base64"));
