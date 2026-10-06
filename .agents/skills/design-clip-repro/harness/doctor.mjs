// Checks the harness can do its job:  node .agents/skills/design-clip-repro/harness/doctor.mjs
// PASS: go on. WAIT (exit 75): the dev server is still starting or compiling;
// run it again. FAIL (exit 1): report the line and its screenshot, and stop.
import { action, api, newDesign, openEditor } from "./dlib.mjs";
import { FIGMA_LOGIN_COOKIE } from "./figlib.mjs";
import {
  BASE,
  CDP_URL,
  FUSION,
  PROD_BASE,
  SHOTS_DIR,
  TEST_ACCOUNT,
  chromium,
  describeEnv,
} from "./harness-env.mjs";

const results = [];
const check = async (name, fn, { required = true } = {}) => {
  console.error(`doctor: ${name}…`);
  const started = Date.now();
  try {
    const detail = await fn();
    results.push(
      `PASS  ${name}${detail ? `: ${detail}` : ""} (${Math.round((Date.now() - started) / 1000)}s)`,
    );
    return true;
  } catch (err) {
    const status = err.wait ? "WAIT" : required ? "FAIL" : "WARN";
    results.push(`${status}  ${name}: ${err.message.split("\n")[0]}`);
    return false;
  }
};

async function answers(url, timeoutMs, hint = "") {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    }).catch((e) => e);
    if (res instanceof Response && res.status < 500)
      return `HTTP ${res.status}`;
    last = res instanceof Response ? `HTTP ${res.status}` : res.message;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Object.assign(new Error(`${url} not answering (${last})${hint}`), {
    wait: FUSION,
  });
}

await check(
  FUSION ? "branch browser" : "your Chrome on :9222 (Figma and osmouse only)",
  () =>
    answers(
      `${CDP_URL}/json/version`,
      FUSION ? 30000 : 3000,
      FUSION ? "" : ". Start Chrome with --remote-debugging-port=9222",
    ),
  { required: false },
);
const up = await check("dev server", () =>
  answers(
    `${BASE}/`,
    FUSION ? 45000 : 10000,
    FUSION
      ? ""
      : ". Start it: .agents/skills/design-clip-repro/harness/start-dev.sh",
  ),
);
if (up && (await check("local login", async () => (await api()).dispose()))) {
  await check("editor opens a design", async () => {
    let d;
    try {
      d = await openEditor(await newDesign("Harness doctor"));
    } catch (err) {
      throw Object.assign(err, {
        wait: err.compiling || err.name === "TimeoutError",
      });
    }
    const shot = `${SHOTS_DIR}/doctor-editor.png`;
    await d.page.screenshot({ path: shot });
    await d.close();
    const ctx = await api();
    await action(ctx, "delete-design", { id: d.designId }).catch(() => {});
    await ctx.dispose();
    return shot;
  });
}
await check(
  "test account",
  async () => {
    if (!TEST_ACCOUNT)
      throw new Error("DESIGN_TEST_EMAIL / DESIGN_TEST_PASSWORD not set");
    await (await api(PROD_BASE, TEST_ACCOUNT)).dispose();
    return TEST_ACCOUNT.email;
  },
  { required: false },
);

/** In Fusion, the secret new branches log in with; locally, your Chrome's session. */
async function figmaCookies() {
  if (!FUSION) {
    const browser = await chromium.connectOverCDP(CDP_URL);
    try {
      return await browser.contexts()[0].cookies("https://www.figma.com");
    } finally {
      await browser.close();
    }
  }
  if (!process.env.FIGMA_COOKIES_B64)
    throw new Error("FIGMA_COOKIES_B64 not set");
  try {
    return JSON.parse(
      Buffer.from(process.env.FIGMA_COOKIES_B64, "base64").toString(),
    );
  } catch {
    throw new Error(
      "FIGMA_COOKIES_B64 is not a cookie export; refresh it (reference/figma.md)",
    );
  }
}
await check(
  "Figma login",
  async () => {
    const refresh = FUSION
      ? "refresh FIGMA_COOKIES_B64 (reference/figma.md)"
      : "log in to Figma in your Chrome on :9222";
    const login = (await figmaCookies()).find(
      (c) => c.name === FIGMA_LOGIN_COOKIE,
    );
    if (!login) throw new Error(`not logged in to Figma; ${refresh}`);
    if (login.expires <= 0) return "logged in (no expiry set)";
    const until = new Date(login.expires * 1000);
    const date = until.toISOString().slice(0, 10);
    const days = Math.floor((until - Date.now()) / 86_400_000);
    if (days < 0)
      throw new Error(`the Figma login expired on ${date}; ${refresh}`);
    if (days < 7)
      throw new Error(`the Figma login expires on ${date}; ${refresh}`);
    return `valid until ${date}`;
  },
  { required: false },
);

console.log(describeEnv());
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
if (results.some((r) => r.startsWith("WAIT"))) {
  console.log(
    "Still starting or compiling: run the doctor again. Do not work around it.",
  );
  process.exit(75);
}
