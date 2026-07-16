import { execFileSync } from "node:child_process";

import { chromium } from "playwright";

const root = "/Users/steve/Projects/builder/agent-native/framework";
const outputDir =
  "/Users/steve/.codex/visualizations/2026/07/16/019f6b50-4f11-7973-bd24-97660fa817a1/creative-context";
const nativeHarness = `${root}/packages/creative-context/scripts/tmp-final-native-qa.ts`;
const password = "final-creative-context-live-qa";
const apps = [
  { name: "slides", port: 9231, connector: "Google Slides", native: true },
  { name: "design", port: 9232, connector: "Figma", native: true },
  { name: "assets", port: 9233, connector: "Website", native: false },
  { name: "content", port: 9234, connector: "Notion", native: false },
].filter((app) => !process.env.QA_APP || app.name === process.env.QA_APP);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function runNative(mode, app, email, itemId, versionId) {
  const args = [
    "pnpm",
    "exec",
    "tsx",
    nativeHarness,
    mode,
    app,
    email,
    ...(itemId ? [itemId] : []),
    ...(versionId ? [versionId] : []),
  ];
  const stdout = execFileSync("corepack", args, {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: `file:/tmp/an-cc-final-${app}.sqlite`,
      AGENT_USER_EMAIL: email,
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const marker = stdout
    .split("\n")
    .findLast((line) => line.startsWith("QA_JSON="));
  if (!marker) throw new Error(`No QA_JSON from ${mode} ${app}: ${stdout}`);
  return JSON.parse(marker.slice("QA_JSON=".length));
}

async function callAction(page, name, input, method = "POST") {
  return page.evaluate(
    async ({ name, input, method }) => {
      const query = new URLSearchParams();
      if (method === "GET") {
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined && value !== null)
            query.set(key, String(value));
        }
      }
      const response = await fetch(
        `/_agent-native/actions/${name}${method === "GET" ? `?${query}` : ""}`,
        method === "GET"
          ? { headers: { Accept: "application/json" } }
          : {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            },
      );
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { text };
      }
      return { ok: response.ok, status: response.status, json };
    },
    { name, input, method },
  );
}

function unwrap(value) {
  return value?.result ?? value?.data ?? value;
}

async function authenticate(page, email) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
  const auth = await page.evaluate(
    async ({ email, password }) => {
      const post = (path, body) =>
        fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (response) => ({
          ok: response.ok,
          status: response.status,
          body: await response.json().catch(() => ({})),
        }));
      let login = await post("/_agent-native/auth/login", { email, password });
      if (!login.ok) {
        await post("/_agent-native/auth/register", {
          email,
          password,
          name: "Final Creative Context QA",
          callbackURL: "/",
        });
        login = await post("/_agent-native/auth/login", { email, password });
      }
      const session = await fetch("/_agent-native/auth/session").then(
        (response) => response.json().catch(() => ({})),
      );
      return { login, session };
    },
    { email, password },
  );
  invariant(
    auth.login.ok,
    `Login failed for ${email}: ${JSON.stringify(auth)}`,
  );
  invariant(
    auth.session.email === email,
    `No session for ${email}: ${JSON.stringify(auth)}`,
  );
  await page.waitForTimeout(2_000);
}

async function verifyLibrary(page, app) {
  await page.goto("/agent#library", { waitUntil: "domcontentloaded" });
  await page
    .getByText("Library", { exact: true })
    .first()
    .waitFor({ timeout: 15_000 });
  await page
    .getByText("Sources", { exact: true })
    .first()
    .waitFor({ timeout: 30_000 });
  const body = await page.locator("body").innerText();
  invariant(
    !body.includes("Creative context is unavailable right now"),
    `${app.name} Library unavailable`,
  );
  invariant(body.includes("Sources"), `${app.name} Library missing Sources`);
  invariant(
    body.includes("Search context"),
    `${app.name} Library missing search`,
  );
  invariant(
    body.includes("Personal"),
    `${app.name} Library missing Personal scope`,
  );
  if (app.native) {
    invariant(
      body.includes(`Final Live ${app.name}`),
      `${app.name} seeded source missing in Library`,
    );
  } else {
    invariant(
      body.includes("No creative context yet"),
      `${app.name} empty Library changed`,
    );
  }
  await page.screenshot({
    path: `${outputDir}/${app.name}-library.png`,
    fullPage: true,
  });

  const addSource = page
    .locator("section")
    .filter({ hasText: "Add a source" })
    .last();
  const connector = addSource.getByRole("button", {
    name: app.connector,
    exact: false,
  });
  await connector.waitFor();
  await connector.click();
  await addSource.locator("form").waitFor();
  invariant(
    (await addSource.innerText()).includes(app.connector),
    `${app.name} source picker missing ${app.connector}`,
  );
  await page.screenshot({
    path: `${outputDir}/${app.name}-add-source.png`,
    fullPage: true,
  });

  const automatic = page.getByText("Automatic", { exact: true }).first();
  await automatic.click();
  const off = page.getByText("Off", { exact: true }).last();
  await off.click();
  await page.waitForTimeout(150);
  await page.getByText("Automatic", { exact: true }).first().click();
  await page.waitForTimeout(150);

  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  const libraryLink = page.locator('a[href="/agent#library"]').first();
  await libraryLink.waitFor({ timeout: 10_000 });
  await libraryLink.click();
  await page.getByText("Library", { exact: true }).first().waitFor();
}

async function verifyComposer(page, app) {
  await page.goto(app.name === "assets" ? "/brand-kits" : "/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2_000);
  const toggle = page.getByRole("button", { name: "Toggle agent" }).first();
  if ((await toggle.count()) && (await toggle.isVisible())) {
    await toggle.click();
  } else {
    await page.evaluate(() =>
      window.dispatchEvent(new Event("agent-panel:open")),
    );
  }
  const panel = page.locator(".agent-sidebar-panel");
  await panel.waitFor({ timeout: 15_000 });
  const chip = panel
    .locator("button")
    .filter({ hasText: app.native ? "Clone:" : "Automatic" })
    .last();
  await page.waitForTimeout(3_000);
  invariant(
    (await chip.count()) > 0,
    `${app.name} composer context chip missing: ${(await panel.innerText()).slice(0, 500)}`,
  );
  await chip.click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const menuText = await menu.innerText();
  invariant(
    menuText.includes("Automatic") &&
      menuText.includes("Off") &&
      menuText.includes("Library"),
    `${app.name} composer chip menu incomplete`,
  );
  await page.screenshot({
    path: `${outputDir}/${app.name}-composer-context-menu.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const app of apps) {
    const baseURL = `http://127.0.0.1:${app.port}`;
    const email = `creative-context-final-${app.name}@example.test`;
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120_000);
    const pageErrors = [];
    const actionFailures = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        response.url().includes("/_agent-native/actions/")
      ) {
        actionFailures.push(`${response.status()} ${response.url()}`);
      }
    });
    await authenticate(page, email);

    let nativeResult = null;
    if (app.native) {
      const v1 = runNative("seed-v1", app.name, email);
      await verifyLibrary(page, app);

      const searchResponse = await callAction(page, "search-creative-context", {
        query: "FinalNativeToken",
        kinds: [app.name === "slides" ? "google-slides-slide" : "figma-frame"],
        matchMode: "allTerms",
        limit: 5,
        snapshot: true,
        contextPackName: `Final live ${app.name} pinned v1`,
      });
      invariant(
        searchResponse.ok,
        `${app.name} live search failed: ${JSON.stringify(searchResponse)}`,
      );
      const search = unwrap(searchResponse.json);
      const hit = search.results?.find((entry) => entry.itemId === v1.itemId);
      invariant(
        hit?.itemVersionId === v1.itemVersionId,
        `${app.name} live search did not pin v1`,
      );
      invariant(
        search.contextPackId,
        `${app.name} search did not create a pack`,
      );

      const getResponse = await callAction(
        page,
        "get-context-item",
        { itemId: v1.itemId, itemVersionId: v1.itemVersionId },
        "GET",
      );
      invariant(
        getResponse.ok,
        `${app.name} get-context-item failed: ${JSON.stringify(getResponse)}`,
      );
      const detail = unwrap(getResponse.json);
      invariant(
        detail.version.nativeCode?.dataRole === "untrusted-reference",
        `${app.name} native code lacks untrusted role`,
      );
      invariant(
        detail.version.nativeCode?.content === v1.content,
        `${app.name} live native code was not exact`,
      );

      const clone = runNative(
        "clone",
        app.name,
        email,
        v1.itemId,
        v1.itemVersionId,
      );
      invariant(
        clone.exactContent === true,
        `${app.name} clone changed native code`,
      );
      invariant(
        clone.catalogNames.includes(
          app.name === "slides"
            ? "clone-context-slide"
            : "clone-creative-context-design",
        ),
        `${app.name} clone action missing from agent catalog`,
      );
      invariant(
        clone.packMembers.some(
          (entry) => entry.itemVersionId === v1.itemVersionId,
        ),
        `${app.name} clone pack missing pinned v1`,
      );
      invariant(
        /Creative Context is off/i.test(clone.offError),
        `${app.name} global Off did not reject clone`,
      );

      await page.goto(clone.openPath, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3_000);
      invariant(
        page.url().includes(clone.openPath) &&
          (app.name === "design" ||
            (await page.locator("body").innerText()).includes(
              "Final Native Slide V1",
            )),
        `${app.name} cloned artifact did not open: ${page.url()} ${(await page.locator("body").innerText()).slice(0, 500)}`,
      );
      await page.screenshot({
        path: `${outputDir}/${app.name}-clone-open.png`,
        fullPage: true,
      });

      const v2 = runNative("seed-v2", app.name, email);
      invariant(
        v2.itemId === v1.itemId && v2.itemVersionId !== v1.itemVersionId,
        `${app.name} resync did not append a version`,
      );
      const oldResponse = await callAction(
        page,
        "get-context-item",
        { itemId: v1.itemId, itemVersionId: v1.itemVersionId },
        "GET",
      );
      const currentResponse = await callAction(
        page,
        "get-context-item",
        { itemId: v1.itemId },
        "GET",
      );
      const oldDetail = unwrap(oldResponse.json);
      const currentDetail = unwrap(currentResponse.json);
      invariant(
        oldDetail.version.nativeCode?.content === v1.content,
        `${app.name} v1 evidence changed after resync`,
      );
      invariant(
        currentDetail.version.id === v2.itemVersionId,
        `${app.name} current pointer did not advance to v2`,
      );
      const packResponse = await callAction(
        page,
        "get-context-pack",
        { packId: search.contextPackId },
        "GET",
      );
      invariant(packResponse.ok, `${app.name} pinned pack lookup failed`);
      const pack = unwrap(packResponse.json).pack;
      invariant(
        pack.members.some((entry) => entry.itemVersionId === v1.itemVersionId),
        `${app.name} search pack rewrote pinned v1`,
      );

      await verifyComposer(page, app);
      nativeResult = {
        v1: v1.itemVersionId,
        v2: v2.itemVersionId,
        searchPackId: search.contextPackId,
        clonePackId: clone.cloneResult.contextPackId,
        cloneOpened: true,
        exactNativeCode: true,
        offRejected: true,
      };
    } else {
      await verifyLibrary(page, app);
      await verifyComposer(page, app);
    }

    invariant(
      actionFailures.length === 0,
      `${app.name} Creative Context action failures: ${actionFailures.join(", ")}`,
    );
    invariant(
      pageErrors.length === 0,
      `${app.name} page errors: ${pageErrors.join(" | ")}`,
    );
    results.push({ app: app.name, status: "passed", native: nativeResult });
    await context.close();
  }
  console.log(`FINAL_QA_JSON=${JSON.stringify(results)}`);
} finally {
  await browser.close();
}
