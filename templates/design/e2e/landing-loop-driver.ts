/**
 * Not a spec: the runner aborts on first failure, so each step below isolates
 * its own throw and keeps authoring. Run: pnpm exec tsx this-file.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  chromium,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:9401";
const OUT_DIR = process.env.OUT ?? "/tmp/design-loop";
const HEADED = process.env.HEADED === "1";
const EMAIL = process.env.E2E_EMAIL ?? "loop-qa@local.test";
const PASSWORD = "password-loop-qa-1234";
const RUN_ID = process.env.RUN_ID ?? "1";
const ONLY = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const MOD = process.platform === "darwin" ? "Meta" : "Control";

type Severity = "bug" | "suspect" | "note";

interface Finding {
  step: string;
  severity: Severity;
  title: string;
  detail: string;
}

interface StepRecord {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  screenshot?: string;
}

const findings: Finding[] = [];
const steps: StepRecord[] = [];
let consoleErrors: string[] = [];
let pageErrors: string[] = [];
let failedRequests: string[] = [];
let currentStep = "boot";
let designId = "";
let shotIndex = 0;

function report(severity: Severity, title: string, detail: string): void {
  findings.push({ step: currentStep, severity, title, detail });
  const tag = severity === "bug" ? "BUG " : severity === "suspect" ? "SUS " : "NOTE";
  console.log(`  [${tag}] ${title} — ${detail}`);
}

/** Dev-server noise that says nothing about the product. */
function isInfraNoise(text: string): boolean {
  return /Outdated Optimize Dep|optimized dependency|favicon|ERR_INTERNET_DISCONNECTED|\/@vite\/client|Invalid hook call|more than one copy of React|reading 'useEffect'|react-dom_client\.js|Download the React DevTools/i.test(
    text,
  );
}

function attachListeners(page: Page): void {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!isInfraNoise(text)) consoleErrors.push(text.slice(0, 400));
  });
  page.on("pageerror", (err) => {
    const text = `${err.name}: ${err.message}`;
    if (!isInfraNoise(text)) pageErrors.push(text.slice(0, 400));
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "";
    if (/ERR_ABORTED/.test(failure) || isInfraNoise(req.url())) return;
    failedRequests.push(`${req.method()} ${req.url().slice(0, 160)} — ${failure}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 500 && !isInfraNoise(res.url())) {
      failedRequests.push(`${res.status()} ${res.request().method()} ${res.url().slice(0, 160)}`);
    }
  });
}

async function cdpShot(page: Page, label: string): Promise<string | undefined> {
  try {
    const client = await page.context().newCDPSession(page);
    const { data } = await client.send("Page.captureScreenshot", { format: "png" });
    await client.detach().catch(() => {});
    const file = path.join(
      OUT_DIR,
      `r${RUN_ID}-${String(++shotIndex).padStart(3, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 55)}.png`,
    );
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  } catch {
    return undefined;
  }
}

async function step(page: Page, name: string, fn: () => Promise<void>): Promise<void> {
  if (ONLY && !ONLY.some((token) => name.includes(token))) return;
  currentStep = name;
  consoleErrors = [];
  pageErrors = [];
  failedRequests = [];
  const started = Date.now();
  let ok = true;
  let error: string | undefined;
  console.log(`\n▶ ${name}`);
  try {
    await fn();
  } catch (err) {
    ok = false;
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.log(`  ✗ ${error.split("\n")[0].slice(0, 220)}`);
  }
  const screenshot = await cdpShot(page, name);
  const record: StepRecord = {
    name,
    ok,
    ms: Date.now() - started,
    error,
    consoleErrors: [...new Set(consoleErrors)],
    pageErrors: [...new Set(pageErrors)],
    failedRequests: [...new Set(failedRequests)],
    screenshot,
  };
  steps.push(record);
  if (record.pageErrors.length) {
    report("bug", "Uncaught page error", record.pageErrors.join(" | ").slice(0, 500));
  }
  if (record.consoleErrors.length) {
    report("suspect", "Console error", record.consoleErrors.slice(0, 3).join(" | ").slice(0, 500));
  }
  if (record.failedRequests.length) {
    report("bug", "Failed/5xx request", record.failedRequests.slice(0, 3).join(" | ").slice(0, 500));
  }
  if (ok) console.log(`  ✓ ${record.ms}ms`);
}

// ---------------------------------------------------------------- actions api

async function postAction(page: Page, name: string, input: Record<string, unknown>): Promise<any> {
  const res = await page.request.post(`${BASE_URL}/_agent-native/actions/${name}`, {
    data: input,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) throw new Error(`action ${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function getAction(page: Page, name: string, input: Record<string, unknown>): Promise<any> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value != null) params.append(key, String(value));
  }
  const res = await page.request.get(`${BASE_URL}/_agent-native/actions/${name}?${params}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) throw new Error(`action ${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

interface DesignFile {
  id: string;
  filename: string;
  content: string;
  fileType?: string;
}

async function designFiles(page: Page): Promise<DesignFile[]> {
  const result = await getAction(page, "get-design", { id: designId });
  return (result.files ?? []).map((f: any) => ({
    id: String(f.id ?? ""),
    filename: String(f.filename ?? ""),
    content: String(f.content ?? ""),
    fileType: typeof f.fileType === "string" ? f.fileType : undefined,
  }));
}

async function fileContent(page: Page, filename = "index.html"): Promise<string> {
  const file = (await designFiles(page)).find((f) => f.filename === filename);
  if (!file) throw new Error(`file not found: ${filename}`);
  return file.content;
}

async function pollFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (Date.now() < deadline && !predicate(last)) {
    await new Promise((r) => setTimeout(r, 400));
    last = await fn();
  }
  return last;
}

function countPrimitive(html: string, kind: string): number {
  return (html.match(new RegExp(`data-an-primitive="${kind}"`, "g")) ?? []).length;
}

/** Pen commits an <svg> layer, not a data-an-primitive host. */
function countVectors(html: string): number {
  return (html.match(/data-agent-native-layer-name="Vector"/g) ?? []).length;
}

async function dump(name: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(OUT_DIR, `r${RUN_ID}-${name}`),
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}

// ------------------------------------------------------------------ ui probes

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function toolButton(page: Page, name: string): Locator {
  return toolbar(page).locator(`button[aria-label="${name}"]`).first();
}

function screenShell(page: Page, name = "Home"): Locator {
  return page.locator("[data-screen-shell]").filter({ hasText: name }).first();
}

function selectedLayerRow(page: Page): Locator {
  return page.locator('[role="treeitem"][aria-selected="true"]').first();
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

/** Visible intersection of the Home screen card and the viewport. */
async function workArea(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const card = screenShell(page).locator("[data-screen-card]").first();
  const box = await card.boundingBox();
  if (!box) throw new Error("no Home screen card box");
  const view = page.viewportSize() ?? { width: 1600, height: 1000 };
  // Keep clear of the left rail/layers panel, the right inspector, and the
  // bottom toolbar — a drag that starts under chrome never reaches the canvas.
  const left = Math.max(box.x, 360);
  const top = Math.max(box.y, 80);
  const right = Math.min(box.x + box.width, view.width - 260);
  const bottom = Math.min(box.y + box.height, view.height - 120);
  if (right - left < 60 || bottom - top < 60) {
    throw new Error(`Home card has no usable visible area: ${JSON.stringify(box)}`);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function at(area: { x: number; y: number; width: number; height: number }, fx: number, fy: number) {
  return { x: area.x + area.width * fx, y: area.y + area.height * fy };
}

async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.waitForTimeout(180);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.waitForTimeout(220);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function expectTool(page: Page, name: string, pressed: boolean, why: string): Promise<void> {
  const value = await pollFor(
    () => toolButton(page, name).getAttribute("aria-pressed").catch(() => null),
    (v) => v === String(pressed),
    6_000,
  );
  if (value !== String(pressed)) {
    report("bug", `Tool "${name}" aria-pressed=${value}, expected ${pressed}`, why);
  }
}

/** Pick a sub-tool from a toolbar group's chevron dropdown. */
async function pickSubTool(page: Page, groupLabel: string, itemName: string): Promise<void> {
  await toolbar(page).locator(`button[aria-label="${groupLabel} options"]`).first().click();
  await page.getByRole("menuitem", { name: new RegExp(itemName, "i") }).first().click();
  await page.waitForTimeout(300);
}

async function zoomToFit(page: Page): Promise<void> {
  await page.locator("body").click({ position: { x: 800, y: 500 } }).catch(() => {});
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(800);
}

const BLANK_SCREEN = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Loop Landing</title>
  </head>
  <body style="margin:0;min-height:900px;background:#ffffff;font-family:system-ui,sans-serif"></body>
</html>`;

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/_agent-native/sign-in`, { waitUntil: "domcontentloaded" });
  const isSignIn = async () => /sign in/i.test(await page.title());
  if (await isSignIn()) {
    await page.locator("#s-email").fill(EMAIL);
    await page.locator("#s-pass").fill(PASSWORD);
    await page.locator("#s-pass2").fill(PASSWORD);
    await page.locator("#signup-form button[type='submit']").click();
    await page.waitForTimeout(2500);
    if (await isSignIn()) {
      await page.getByRole("button", { name: "Sign in", exact: true }).first().click().catch(() => {});
      await page.locator("#l-email").fill(EMAIL);
      await page.locator("#l-pass").fill(PASSWORD);
      await page.locator("#login-form button[type='submit']").click();
      await page.waitForTimeout(2500);
    }
  }
  await page.waitForFunction(() => !/sign in/i.test(document.title), null, { timeout: 20_000 });
}

async function gotoEditor(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/design/${designId}`, { waitUntil: "domcontentloaded" });
  await toolButton(page, "Move").waitFor({ state: "visible", timeout: 45_000 });
  await page.locator("iframe[data-design-preview-iframe]").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1800);
  await zoomToFit(page);
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
  } catch {
    browser = await chromium.launch({ headless: !HEADED });
  }
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  attachListeners(page);

  await step(page, "setup: sign in", async () => {
    await signIn(page);
  });

  await step(page, "setup: create blank design", async () => {
    const created = await postAction(page, "create-design", {
      title: `Loop Landing r${RUN_ID}`,
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id ?? created?.design?.id;
    if (!designId) throw new Error(`no design id: ${JSON.stringify(created).slice(0, 300)}`);
    await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: BLANK_SCREEN,
      fileType: "html",
    });
    console.log(`  designId=${designId}`);
  });

  await step(page, "setup: open editor", async () => {
    await gotoEditor(page);
  });

  if (process.env.SCENARIO === "surfaces") await surfaceSweep(page);
  else await scenario(page);

  const outFile = path.join(OUT_DIR, `findings-run${RUN_ID}.json`);
  await writeFile(outFile, JSON.stringify({ designId, baseUrl: BASE_URL, steps, findings }, null, 2));
  console.log(`\n==== SUMMARY run ${RUN_ID} ====`);
  console.log(`designId: ${designId}  editor: ${BASE_URL}/design/${designId}`);
  console.log(`steps ${steps.length}, threw ${steps.filter((s) => !s.ok).length}`);
  const bugs = findings.filter((f) => f.severity === "bug");
  console.log(`findings: ${bugs.length} bug / ${findings.filter((f) => f.severity === "suspect").length} suspect`);
  for (const f of findings) console.log(`- [${f.severity}] (${f.step}) ${f.title}: ${f.detail}`);
  console.log(`\nwrote ${outFile}`);
  await context.close();
  await browser.close();
}

// ------------------------------------------------------------------ scenario

function rail(page: Page, name: string): Locator {
  return page.getByRole("navigation", { name: "Design workspace" }).getByRole("button", { name });
}

async function surfaceSweep(page: Page): Promise<void> {
  await step(page, "rail: every workspace section opens", async () => {
    const labels = await page
      .getByRole("navigation", { name: "Design workspace" })
      .locator("button")
      .evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()).filter(Boolean));
    console.log(`  rail: ${JSON.stringify(labels)}`);
    await dump("rail.json", labels);
    for (const label of labels) {
      const before = await page.locator("aside, [role='complementary']").count();
      await rail(page, label).first().click({ timeout: 8_000 }).catch(() => {
        report("bug", `Rail section "${label}" is not clickable`, "click timed out on the workspace navigation button");
      });
      await page.waitForTimeout(1200);
      const after = await page.locator("aside, [role='complementary']").count();
      if (after === 0 && before > 0) {
        report("bug", `Rail section "${label}" left the workspace with no side panel`, "every complementary panel disappeared after selecting this section");
      }
      if (pageErrors.length) return;
    }
    await rail(page, "File").first().click().catch(() => {});
    await page.waitForTimeout(1000);
  });

  await step(page, "keyboard shortcuts panel opens and lists its tabs", async () => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "?", code: "Slash", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    const panel = page.locator("[data-keyboard-shortcuts-panel]");
    if ((await panel.count()) === 0) {
      report("bug", "Ctrl+Shift+? opened no keyboard shortcuts panel", "no [data-keyboard-shortcuts-panel] in the DOM");
      return;
    }
    const tabs = await panel.getByRole("tab").allTextContents();
    console.log(`  ${tabs.length} tabs: ${JSON.stringify(tabs.map((t) => t.trim()))}`);
    for (const tab of tabs) {
      await panel.getByRole("tab", { name: tab.trim(), exact: true }).first().click().catch(() => {
        report("suspect", `Shortcuts tab "${tab.trim()}" would not activate`, "click failed on the tab");
      });
      await page.waitForTimeout(150);
      if (pageErrors.length) {
        report("bug", `Shortcuts tab "${tab.trim()}" threw on activation`, pageErrors.join(" | ").slice(0, 300));
        break;
      }
    }
    await page.keyboard.press("Escape");
  });

  await step(page, "breakpoints: add one and confirm it persists", async () => {
    await gotoEditor(page);
    const add = page.getByRole("button", { name: "Add breakpoint" });
    if ((await add.count()) === 0) {
      const bar = await page.locator("[data-breakpoint-bar], [data-design-breakpoint-bar]").count();
      report("bug", "No 'Add breakpoint' control in the editor", `breakpoint bar elements found: ${bar}`);
      return;
    }
    const before = await page.locator("[data-breakpoint-chip], [data-breakpoint-button]").count();
    await add.first().click();
    await page.waitForTimeout(1500);
    const menu = await page.getByRole("menuitem").allTextContents();
    if (menu.length) {
      console.log(`  breakpoint options: ${JSON.stringify(menu.map((m) => m.trim()))}`);
      await page.getByRole("menuitem").first().click();
      await page.waitForTimeout(2000);
    }
    const after = await page.locator("[data-breakpoint-chip], [data-breakpoint-button]").count();
    const data = await getAction(page, "get-design", { id: designId });
    const parsed = typeof data.data === "string" ? JSON.parse(data.data || "{}") : {};
    console.log(`  chips ${before} → ${after}; stored breakpointWidths=${JSON.stringify(parsed.breakpointWidths ?? null)}`);
    if (after === before && !parsed.breakpointWidths) {
      report("bug", "Adding a breakpoint changed neither the bar nor the stored design", `chip count stayed ${before} and design data has no breakpointWidths`);
    }
  });

  await step(page, "comments: pin a review comment on the canvas", async () => {
    await gotoEditor(page);
    const pin = toolbar(page).locator('button[aria-label="Pin comment"]');
    if ((await pin.count()) === 0) {
      report("bug", "No 'Pin comment' tool in the toolbar", "expected a comment tool alongside the draw tools");
      return;
    }
    await pin.first().click();
    await page.waitForTimeout(600);
    const area = await workArea(page);
    const p = at(area, 0.4, 0.3);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(1500);
    const composer = page.locator("textarea, [contenteditable='true']").last();
    if ((await composer.count()) === 0) {
      report("bug", "Clicking with the comment tool opened no comment composer", "no textarea/contenteditable appeared after placing a pin");
      return;
    }
    await composer.click();
    await composer.type("Loop QA: tighten the hero spacing", { delay: 10 });
    const submit = page.getByRole("button", { name: /Comment|Post|Send|Save/ }).last();
    if ((await submit.count()) === 0) {
      report("bug", "Comment composer has no submit control", "typed a comment but found no Comment/Post/Send button");
      return;
    }
    await submit.click();
    await page.waitForTimeout(2500);
    const listed = await getAction(page, "list-design-comments", { designId }).catch(() => null);
    if (!listed) {
      report("suspect", "Could not read comments back through an action", "list-design-comments is not callable with { designId }");
      return;
    }
    const payload = JSON.stringify(listed);
    if (!payload.includes("tighten the hero spacing")) {
      report("bug", "Pinned comment did not persist", `list-design-comments returned ${payload.slice(0, 250)}`);
    }
  });

  await step(page, "code view: opening a design file shows its source", async () => {
    await gotoEditor(page);
    await rail(page, "Code").first().click();
    await page.waitForTimeout(3000);
    const fileRow = page.getByText("Home", { exact: true }).last();
    await fileRow.click({ timeout: 8_000 }).catch(() => {
      report("bug", "Code workbench file tree row is not clickable", "could not open the only design file from DESIGN FILES");
    });
    await page.waitForTimeout(3000);
    const editor = page.locator(".monaco-editor, .view-lines, [data-code-workbench]");
    if ((await editor.count()) === 0) {
      report("bug", "Opening a design file mounted no code editor", "no .monaco-editor / .view-lines after clicking the file");
      return;
    }
    const text = await editor.first().innerText().catch(() => "");
    if (!/doctype|<html|<body/i.test(text)) {
      report("bug", "Code editor does not show the file's HTML", `visible text starts: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
    }
    await dump("code-workbench.txt", text.slice(0, 4000));
  });

  await step(page, "tokens: the panel opens and lists or offers tokens", async () => {
    await gotoEditor(page);
    await rail(page, "Tokens").first().click();
    await page.waitForTimeout(2500);
    const body = await page.locator("[data-design-left-panel], aside, [role='complementary']").first().innerText().catch(() => "");
    console.log(`  tokens panel text: ${body.slice(0, 200).replace(/\s+/g, " ")}`);
    if (!body.trim()) {
      report("bug", "Tokens panel rendered empty", "the tokens side panel has no text content at all");
    }
    await dump("tokens-panel.txt", body.slice(0, 3000));
  });

  await step(page, "motion: add a track for a selected element", async () => {
    await gotoEditor(page);
    await page.getByRole("button", { name: /^Motion$/ }).first().click();
    await page.waitForTimeout(2500);
    const addMotion = page.getByText("Add motion", { exact: true }).first();
    if ((await addMotion.count()) === 0) {
      report("bug", "Motion dock did not mount", 'no "Add motion" control after opening Motion');
      return;
    }
    await layersTree(page).getByRole("treeitem").first().click();
    await page.waitForTimeout(1200);
    await addMotion.click({ timeout: 8_000 }).catch(() => {
      report("bug", '"Add motion" is not clickable with a layer selected', "click timed out on the motion dock control");
    });
    await page.waitForTimeout(2500);
    const dockText = await page.locator("[data-motion-dock]").first().innerText().catch(() => "");
    const stillEmpty = /Select an element on the canvas/i.test(dockText);
    if (stillEmpty) {
      report(
        "bug",
        "Motion dock still shows its empty state after selecting a layer and adding motion",
        'dock reads "Select an element on the canvas, then add a track to animate it."',
      );
    }
    await dump("motion-dock.txt", dockText.slice(0, 2000));
  });

  await step(page, "open question: is a hand-authored div listed as a layer?", async () => {
    await gotoEditor(page);
    await postAction(page, "create-file", {
      designId,
      filename: "seeded.html",
      content: `<!doctype html><html><head><meta charset="utf-8"/><title>Seeded</title></head>
<body style="margin:0;min-height:900px;background:#fff">
  <div data-agent-native-node-id="seed-row" data-agent-native-layer-name="Seeded Row"
       style="position:absolute;left:40px;top:40px;width:400px;height:160px;background:#eee">
    <button data-agent-native-node-id="seed-cta" data-agent-native-layer-name="Seeded CTA">Seeded CTA</button>
  </div>
</body></html>`,
      fileType: "html",
    });
    await gotoEditor(page);
    const rows = await layersTree(page).getByRole("treeitem").allTextContents();
    console.log(`  layer rows: ${JSON.stringify(rows.map((r) => r.trim().slice(0, 22)))}`);
    const hasSeeded = rows.some((r) => /Seeded/i.test(r));
    if (!hasSeeded) {
      report(
        "bug",
        "A div with data-agent-native-node-id and layer-name is absent from the Layers tree",
        `the tree lists ${JSON.stringify(rows.map((r) => r.trim().slice(0, 18)))} — hand-authored and agent-authored nodes are not selectable as layers`,
      );
    }
  });

  await step(page, "open question: do inline scripts run in the preview?", async () => {
    await postAction(page, "create-file", {
      designId,
      filename: "script.html",
      content: `<!doctype html><html><head><meta charset="utf-8"/><title>Script</title></head>
<body style="margin:0;min-height:900px;background:#fff">
  <div id="probe">script-did-not-run</div>
  <script>document.getElementById('probe').textContent = 'script-ran';</script>
</body></html>`,
      fileType: "html",
    });
    await gotoEditor(page);
    const readProbe = async () => {
      const frames = page.locator("iframe[data-design-preview-iframe]");
      const n = await frames.count();
      for (let i = 0; i < n; i += 1) {
        const text = await frames.nth(i).contentFrame().locator("#probe").textContent().catch(() => null);
        if (text) return text;
      }
      return null;
    };
    const overview = await pollFor(readProbe, (v) => v === "script-ran", 8_000);
    console.log(`  overview probe: ${overview}`);
    if (overview === "script-did-not-run") {
      report(
        "note",
        "Inline <script> does not execute in the overview preview",
        "the overview composes a static document; interactive Alpine prototypes only come alive in Interact mode",
      );
    }
  });
}

const HEADLINE = "Ship design and code together";
const SUBHEAD = "One canvas the whole team can edit";

async function scenario(page: Page): Promise<void> {
  await step(page, "toolbar: every documented tool is reachable", async () => {
    const primary = await toolbar(page).locator("button[aria-label]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? ""),
    );
    console.log(`  toolbar buttons: ${JSON.stringify(primary)}`);
    const menus: Record<string, string[]> = {};
    for (const group of ["Move", "Rectangle", "Pen", "Frame", "Text"]) {
      const chevron = toolbar(page).locator(`button[aria-label="${group} options"]`);
      if ((await chevron.count()) === 0) continue;
      await chevron.first().click();
      menus[group] = (await page.getByRole("menuitem").allTextContents()).map((s) => s.trim());
      console.log(`  ${group} options: ${JSON.stringify(menus[group])}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    await dump("toolbar.json", { primary, menus });
  });

  await step(page, "hand+scale: sub-tools activate from the Move group", async () => {
    await pickSubTool(page, "Move", "Hand");
    await expectTool(page, "Hand", true, "Selected Hand from the Move group dropdown.");
    await pickSubTool(page, "Hand", "Scale");
    await expectTool(page, "Scale", true, "Selected Scale from the group dropdown.");
    await page.keyboard.press("v");
    await expectTool(page, "Move", true, "Pressed V to return to Move.");
  });

  await step(page, "frame: draw the hero section", async () => {
    const area = await workArea(page);
    await toolButton(page, "Frame").click();
    await expectTool(page, "Frame", true, "Clicked the Frame tool.");
    await dragBetween(page, at(area, 0.08, 0.08), at(area, 0.92, 0.4));
    await expectTool(page, "Move", true, "Tool should fall back to Move after a shape commits.");
    const frames = await pollFor(
      async () => countPrimitive(await fileContent(page), "frame"),
      (n) => n >= 1,
      20_000,
    );
    if (frames < 1) report("bug", "Frame did not persist", 'no [data-an-primitive="frame"] in index.html after drag');
  });

  await step(page, "text: click-insert the headline", async () => {
    const area = await workArea(page);
    await toolButton(page, "Text").click();
    await expectTool(page, "Text", true, "Clicked the Text tool.");
    await page.mouse.click(...Object.values(at(area, 0.14, 0.14)) as [number, number]);
    await page.waitForTimeout(500);
    await page.keyboard.press(`${MOD}+A`);
    await page.keyboard.type(HEADLINE, { delay: 12 });
    await page.keyboard.press("Escape");
    const content = await pollFor(() => fileContent(page), (c) => c.includes(HEADLINE), 20_000);
    if (!content.includes(HEADLINE)) report("bug", "Click-inserted text never persisted", `"${HEADLINE}" absent from index.html`);
  });

  await step(page, "attribution: my own edit must not be labelled AI", async () => {
    const labels = await page
      .locator("[data-recent-edit-highlight], [aria-label$='edited this']")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent ?? ""));
    const aiLabels = labels.filter((l) => /^AI\b|AI edited/i.test(l));
    if (aiLabels.length) {
      report(
        "bug",
        "Local canvas edit is attributed to the AI",
        `recent-edit highlight over my own hand-drawn text reads ${JSON.stringify(aiLabels)}`,
      );
    } else {
      console.log(`  recent-edit labels: ${JSON.stringify(labels)}`);
    }
  });

  await step(page, "text: drag-insert a bounded subhead", async () => {
    const area = await workArea(page);
    await toolButton(page, "Text").click();
    await expectTool(page, "Text", true, "Clicked the Text tool.");
    await dragBetween(page, at(area, 0.14, 0.24), at(area, 0.6, 0.3));
    await page.waitForTimeout(400);
    await page.keyboard.press(`${MOD}+A`);
    await page.keyboard.type(SUBHEAD, { delay: 12 });
    await page.keyboard.press("Escape");
    const content = await pollFor(() => fileContent(page), (c) => c.includes(SUBHEAD), 20_000);
    if (!content.includes(SUBHEAD)) {
      report("bug", "Drag-inserted bounded text never persisted", `"${SUBHEAD}" absent from index.html`);
    }
  });

  await step(page, "rectangle: draw the CTA block", async () => {
    const area = await workArea(page);
    const before = countPrimitive(await fileContent(page), "rectangle");
    await toolButton(page, "Rectangle").click();
    await expectTool(page, "Rectangle", true, "Clicked the Rectangle tool.");
    await dragBetween(page, at(area, 0.14, 0.46), at(area, 0.34, 0.56));
    await expectTool(page, "Move", true, "Tool should fall back to Move after the rectangle commits.");
    const after = await pollFor(
      async () => countPrimitive(await fileContent(page), "rectangle"),
      (n) => n > before,
      20_000,
    );
    if (after <= before) report("bug", "Rectangle did not persist", `rectangle count stayed at ${before} after a canvas drag`);
  });

  for (const shape of ["Ellipse", "Polygon", "Star", "Line", "Arrow"]) {
    await step(page, `shape: ${shape} from the Rectangle group`, async () => {
      const area = await workArea(page);
      const before = await fileContent(page);
      const active = await toolbar(page)
        .locator("button[aria-label$=' options']")
        .evaluateAll((els) => els.map((el) => (el.getAttribute("aria-label") ?? "").replace(/ options$/, "")));
      const group = active.find((g) => ["Rectangle", "Ellipse", "Polygon", "Star", "Line", "Arrow"].includes(g));
      if (!group) throw new Error(`no shape group in toolbar: ${JSON.stringify(active)}`);
      await pickSubTool(page, group, shape);
      await expectTool(page, shape, true, `Picked ${shape} from the ${group} group.`);
      await dragBetween(page, at(area, 0.62, 0.46), at(area, 0.76, 0.58));
      await page.waitForTimeout(600);
      const after = await pollFor(() => fileContent(page), (c) => c !== before, 15_000);
      if (after === before) {
        report("bug", `${shape} tool produced no document change`, "index.html byte-identical after arming the tool and dragging on the canvas");
      }
    });
  }

  await step(page, "pen: draw an accent vector", async () => {
    const area = await workArea(page);
    const before = countVectors(await fileContent(page));
    await toolButton(page, "Pen").click();
    await expectTool(page, "Pen", true, "Clicked the Pen tool.");
    const p1 = at(area, 0.14, 0.66);
    const p2 = at(area, 0.24, 0.6);
    const p3 = at(area, 0.34, 0.66);
    for (const p of [p1, p2, p3]) {
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(200);
    }
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    const after = await pollFor(async () => countVectors(await fileContent(page)), (n) => n > before, 20_000);
    if (after <= before) report("bug", "Pen path did not commit", `Vector layer count stayed at ${before} after 3 anchor clicks + Enter`);
    if ((await layersTree(page).getByRole("treeitem").filter({ hasText: "Vector" }).count()) > 0 && after <= before) {
      report("bug", "Pen created a Vector layer row with no document node", "the layers tree shows Vector but index.html has no matching svg");
    }
  });

  await step(page, "layers: tree lists what I drew", async () => {
    const rows = await layersTree(page).getByRole("treeitem").allTextContents();
    console.log(`  ${rows.length} rows: ${JSON.stringify(rows.map((r) => r.trim().slice(0, 24)))}`);
    if (rows.length <= 1) report("bug", "Layers tree did not list authored primitives", `only ${rows.length} treeitem row(s) after authoring several shapes`);
  });

  await step(page, "inspector: select the CTA rectangle and dump its controls", async () => {
    const rect = layersTree(page).getByRole("treeitem").filter({ hasText: "Rectangle" }).first();
    if ((await rect.count()) === 0) throw new Error("no Rectangle layer row");
    await rect.click();
    await page.waitForTimeout(900);
    const panel = page.locator("aside, [data-design-inspector]").last();
    const controls = await panel.locator("button[aria-label], input, [role='combobox']").evaluateAll((els) =>
      els.slice(0, 120).map((el) => ({
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? "",
        value: (el as HTMLInputElement).value ?? "",
      })),
    );
    await dump("inspector-controls.json", controls);
    console.log(`  ${controls.length} inspector controls dumped`);
  });

  await step(page, "inspector: fill colour reaches the document", async () => {
    const before = await fileContent(page);
    const swatch = page.getByRole("button", { name: "Open color picker" });
    const count = await swatch.count();
    if (count === 0) {
      report("bug", "Fill has no colour-picker trigger for a selected rectangle", "no button[aria-label='Open color picker'] anywhere in the inspector");
      return;
    }
    await swatch.first().click();
    await page.waitForTimeout(700);
    const hexInput = page.locator('[role="dialog"] input, [data-radix-popper-content-wrapper] input').first();
    if ((await hexInput.count()) === 0) {
      report("bug", "Colour picker popover exposes no text input", "opened the picker but found no input to type a hex value into");
      return;
    }
    await hexInput.fill("FF5A1F");
    await hexInput.press("Enter");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    const after = await pollFor(() => fileContent(page), (c) => c !== before, 15_000);
    if (after === before) report("bug", "Inspector fill change never reached the document", "index.html unchanged after committing hex FF5A1F");
    else if (!/ff5a1f/i.test(after)) report("bug", "Fill committed a different colour than typed", "document changed but contains no #FF5A1F");
  });

  await step(page, "inspector: corner radius commits", async () => {
    const before = await fileContent(page);
    const label = page.getByText("Corner radius", { exact: true }).first();
    if ((await label.count()) === 0) {
      report("bug", "Corner radius control missing for a selected rectangle", "no 'Corner radius' label in the inspector");
      return;
    }
    // Opacity and Corner radius are two labels above two inputs, so
    // `following::input[1]` after the radius label is the OPACITY box.
    const input = label.locator("xpath=following::input[2]");
    await input.fill("24");
    await input.press("Enter");
    await page.waitForTimeout(1200);
    const after = await pollFor(() => fileContent(page), (c) => c !== before, 15_000);
    if (after === before) report("bug", "Corner radius edit did not reach the document", "index.html unchanged after setting corner radius to 24");
    else if (!/border-radius/i.test(after)) report("suspect", "Corner radius edit wrote no border-radius", "document changed but has no border-radius declaration");
  });

  await step(page, "inspector: resize via the W field", async () => {
    const before = await fileContent(page);
    const w = page.locator("input").filter({ hasNot: page.locator("[disabled]") });
    void w;
    const wField = page.getByText("W", { exact: true }).first().locator("xpath=following::input[1]");
    if ((await wField.count()) === 0) {
      report("suspect", "No W field found in the Layout section", "expected a width input next to the 'W' label");
      return;
    }
    await wField.fill("420");
    await wField.press("Enter");
    await page.waitForTimeout(1200);
    const after = await pollFor(() => fileContent(page), (c) => c !== before, 15_000);
    if (after === before) report("bug", "Width edit did not reach the document", "index.html unchanged after setting W=420");
    else if (!/420px/.test(after)) report("bug", "Width edit committed a value other than 420px", "document changed but has no 420px");
  });

  await step(page, "auto layout: Shift+A on the hero frame", async () => {
    const frameRow = layersTree(page).getByRole("treeitem").filter({ hasText: /frame/i }).first();
    if ((await frameRow.count()) === 0) throw new Error("no Frame layer row to target");
    await frameRow.click();
    await page.waitForTimeout(500);
    const before = await fileContent(page);
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(1500);
    const after = await pollFor(() => fileContent(page), (c) => c !== before, 15_000);
    if (after === before) report("bug", "Shift+A did not enable auto layout", "index.html unchanged after Shift+A on a selected frame");
    else if (!/display\s*:\s*flex/i.test(after)) report("suspect", "Auto layout wrote no flex container", "document changed but no display:flex appeared");
  });

  await step(page, "duplicate: copy/paste keeps the copy positioned", async () => {
    const rows = layersTree(page).getByRole("treeitem");
    const beforeRows = await rows.count();
    await rows.nth(Math.min(1, beforeRows - 1)).click();
    await page.waitForTimeout(400);
    await page.keyboard.press(`${MOD}+C`);
    await page.keyboard.press(`${MOD}+V`);
    await page.waitForTimeout(1500);
    const afterRows = await pollFor(() => rows.count(), (n) => n > beforeRows, 12_000);
    if (afterRows <= beforeRows) {
      report("bug", "Copy/paste did not duplicate the layer", `layer count stayed at ${beforeRows}`);
      return;
    }
    const html = await fileContent(page);
    const copies = [...html.matchAll(/<[a-z]+[^>]*data-agent-native-node-id="copy-[^"]*"[^>]*style="([^"]*)"/g)].map((m) => m[1]);
    const unpositioned = copies.filter((s) => !/position\s*:\s*absolute/i.test(s));
    if (unpositioned.length) {
      report(
        "bug",
        "Pasted copy loses position:absolute/left/top",
        `the copy's style is "${unpositioned[0].slice(0, 120)}" so it drops out of canvas coordinates into normal flow`,
      );
    }
  });

  await step(page, "undo/redo: the last edit round-trips", async () => {
    const before = await fileContent(page);
    await page.keyboard.press(`${MOD}+z`);
    await page.waitForTimeout(1500);
    const undone = await pollFor(() => fileContent(page), (c) => c !== before, 12_000);
    if (undone === before) {
      report("bug", "Undo had no effect on the persisted document", "index.html byte-identical after Cmd+Z");
      return;
    }
    await page.keyboard.press(`${MOD}+Shift+z`);
    await page.waitForTimeout(1500);
    const redone = await pollFor(() => fileContent(page), (c) => c === before, 12_000);
    if (redone !== before) {
      report("bug", "Redo did not restore the pre-undo document", `lengths before=${before.length} redone=${redone.length}`);
    }
  });

  await step(page, "layers: rename a layer", async () => {
    const row = layersTree(page).getByRole("treeitem").filter({ hasText: "Rectangle" }).first();
    await row.click();
    await page.waitForTimeout(300);
    await row.dblclick();
    await page.waitForTimeout(400);
    const input = layersTree(page).locator("input").first();
    if ((await input.count()) === 0) {
      report("bug", "Double-clicking a layer row starts no rename", "no text input appeared in the layers tree");
      return;
    }
    await input.fill("CTA Button");
    await input.press("Enter");
    await page.waitForTimeout(1200);
    const named = await pollFor(
      () => layersTree(page).getByRole("treeitem").filter({ hasText: "CTA Button" }).count(),
      (n) => n > 0,
      10_000,
    );
    if (named === 0) report("bug", "Layer rename did not stick in the tree", 'no row named "CTA Button" after committing the rename');
    const html = await fileContent(page);
    if (!html.includes("CTA Button")) {
      report("bug", "Layer rename never reached the document", 'index.html has no data-agent-native-layer-name="CTA Button"');
    }
  });

  await step(page, "layers: hide then show a layer", async () => {
    const row = layersTree(page).getByRole("treeitem").filter({ hasText: /CTA Button|Rectangle/ }).first();
    await row.hover();
    const hide = row.getByRole("button", { name: "Hide layer" }).first();
    if ((await hide.count()) === 0) {
      report("bug", "No hide control on a layer row", "expected a 'Hide layer' button on hover");
      return;
    }
    const before = await fileContent(page);
    await hide.click();
    await page.waitForTimeout(1200);
    const hidden = await pollFor(() => fileContent(page), (c) => c !== before, 10_000);
    if (hidden === before) {
      report("bug", "Hiding a layer changed nothing in the document", "index.html unchanged after clicking Hide layer");
    }
    await row.hover();
    await row.getByRole("button", { name: /Hide layer|Show layer/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
  });

  await step(page, "canvas: drag the CTA to a new position", async () => {
    const row = layersTree(page).getByRole("treeitem").filter({ hasText: /CTA Button|Rectangle/ }).first();
    await row.click();
    await page.waitForTimeout(600);
    const frame = page.frameLocator('iframe[data-design-preview-iframe]').first();
    const target = frame.locator('[data-an-primitive="rectangle"]').first();
    const box = await target.boundingBox().catch(() => null);
    if (!box || box.width === 0) {
      report("bug", "Cannot grab the rectangle on canvas", `its iframe bounding box is ${JSON.stringify(box)}`);
      return;
    }
    const beforeLeft = /left:\s*([\d.]+)px/.exec((await fileContent(page)).slice((await fileContent(page)).indexOf('data-an-primitive="rectangle"')))?.[1];
    await dragBetween(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: box.x + box.width / 2 + 90, y: box.y + box.height / 2 + 40 },
    );
    await page.waitForTimeout(1200);
    const after = await fileContent(page);
    const afterLeft = /left:\s*([\d.]+)px/.exec(after.slice(after.indexOf('data-an-primitive="rectangle"')))?.[1];
    if (beforeLeft && afterLeft && beforeLeft === afterLeft) {
      report("bug", "Dragging a shape on the canvas did not move it", `left stayed at ${beforeLeft}px after a 90px pointer drag`);
    }
  });

  await step(page, "layers: delete a layer", async () => {
    const rows = layersTree(page).getByRole("treeitem");
    const before = await rows.count();
    const victim = rows.filter({ hasText: "Star" }).first();
    if ((await victim.count()) === 0) throw new Error("no Star layer to delete");
    await victim.click();
    await page.waitForTimeout(400);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(1200);
    const after = await pollFor(() => rows.count(), (n) => n < before, 10_000);
    if (after >= before) report("bug", "Delete did not remove the selected layer", `layer count stayed at ${before}`);
    else if ((await fileContent(page)).includes('data-an-primitive="star"')) {
      report("bug", "Deleted layer still present in the document", 'the Star row is gone from the tree but data-an-primitive="star" remains in index.html');
    }
  });

  await step(page, "interact: preview mode renders the page", async () => {
    await toolbar(page).locator('button[aria-label="Interact"]').first().click();
    await expectTool(page, "Interact", true, "Switched to Interact mode.");
    await page.waitForTimeout(1200);
    const frame = page.frameLocator('iframe[data-design-preview-iframe]').first();
    const visible = await frame.locator("[data-an-primitive]").count().catch(() => 0);
    if (visible === 0) report("bug", "Interact mode shows an empty preview", "no [data-an-primitive] nodes inside the preview iframe");
    await toolbar(page).locator('button[aria-label="Edit"]').first().click();
    await expectTool(page, "Edit", true, "Returned to Edit mode.");
  });

  await step(page, "screens: add a second screen", async () => {
    const before = (await designFiles(page)).filter((f) => f.fileType === "html").length;
    const add = page.getByRole("button", { name: "Add screen" }).first();
    if ((await add.count()) === 0) throw new Error("no 'Add screen' button");
    await add.click();
    await page.waitForTimeout(2000);
    const after = await pollFor(
      async () => (await designFiles(page)).filter((f) => f.fileType === "html").length,
      (n) => n > before,
      20_000,
    );
    if (after <= before) report("bug", "Add screen created no file", `html file count stayed at ${before}`);
  });

  await step(page, "annotate: draw a review stroke", async () => {
    const annotate = toolbar(page).locator('button[aria-label="Annotate"]');
    if ((await annotate.count()) === 0) {
      const labels = await toolbar(page).locator("button[aria-label]").evaluateAll((els) =>
        els.map((el) => el.getAttribute("aria-label") ?? ""),
      );
      report("bug", "No Annotate mode button in the toolbar", `toolbar exposes ${JSON.stringify(labels)}`);
      return;
    }
    await annotate.first().click({ timeout: 10_000 });
    await expectTool(page, "Annotate", true, "Clicked the Annotate mode.");
    if ((await page.locator("[data-draw-overlay]").count()) === 0) {
      report("bug", "Annotate mode rendered no draw overlay", "no [data-draw-overlay] after switching to Annotate");
    } else {
      const area = await workArea(page);
      await dragBetween(page, at(area, 0.3, 0.3), at(area, 0.6, 0.5));
      await page.waitForTimeout(500);
    }
    const edit = toolbar(page).locator('button[aria-label="Edit"]').first();
    try {
      await edit.click({ timeout: 8_000 });
    } catch {
      const box = await edit.boundingBox();
      const blocker = box
        ? await page.evaluate(
            ({ x, y }) => {
              const el = document.elementFromPoint(x, y);
              return el ? `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 70)}` : "none";
            },
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          )
        : "no box";
      report(
        "bug",
        "Cannot leave Annotate mode: the Edit button is unclickable",
        `button[aria-label="Edit"] is visible at ${JSON.stringify(box)} but fails actionability; elementFromPoint there is ${blocker}`,
      );
      await edit.click({ force: true }).catch(() => {});
    }
    await expectTool(page, "Edit", true, "Returned to Edit mode after annotating.");
  });

  await step(page, "render: every authored layer paints inside the preview iframe", async () => {
    const frame = page.frameLocator('iframe[data-design-preview-iframe]').first();
    const nodes = await frame.locator("[data-an-primitive]").evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const svgChild = el.querySelector("polygon, path, rect, circle, ellipse");
        return {
          kind: el.getAttribute("data-an-primitive") ?? "",
          name: el.getAttribute("data-agent-native-layer-name") ?? "",
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          background: cs.backgroundColor,
          borderTop: cs.borderTopWidth,
          childFill: svgChild ? getComputedStyle(svgChild).fill : null,
          childStroke: svgChild ? getComputedStyle(svgChild).stroke : null,
          text: (el.textContent ?? "").trim().slice(0, 30),
        };
      }),
    );
    await dump("rendered-nodes.json", nodes);
    console.log(`  ${nodes.length} primitives in the iframe`);
    for (const n of nodes) {
      if (n.w === 0 || n.h === 0) {
        report("bug", `Layer "${n.name}" (${n.kind}) renders with a zero-size box`, `getBoundingClientRect is ${n.w}x${n.h} inside the preview iframe`);
        continue;
      }
      if (n.display === "none" || n.visibility === "hidden") {
        report("bug", `Layer "${n.name}" (${n.kind}) is not displayed`, `display=${n.display} visibility=${n.visibility}`);
        continue;
      }
      const transparentBg = /rgba\(0, 0, 0, 0\)|transparent/.test(n.background);
      const noBorder = n.borderTop === "0px";
      const noSvgPaint =
        n.childFill === null
          ? true
          : /rgba\(0, 0, 0, 0\)|^none$/.test(n.childFill) && /rgba\(0, 0, 0, 0\)|^none$/.test(n.childStroke ?? "");
      if (!n.text && transparentBg && noBorder && noSvgPaint) {
        report(
          "bug",
          `Layer "${n.name}" (${n.kind}) draws nothing`,
          `no text, background=${n.background}, border=${n.borderTop}, svg fill=${n.childFill} stroke=${n.childStroke} — an invisible ${n.w}x${n.h} box the user cannot see or hit`,
        );
      }
      if (Number(n.opacity) < 0.5 && n.kind !== "frame") {
        report("suspect", `Layer "${n.name}" (${n.kind}) renders at opacity ${n.opacity}`, "nearly invisible without the user asking for it");
      }
    }
  });

  await step(page, "reload: everything I authored survives", async () => {
    const before = await fileContent(page);
    await dump("index-before-reload.html", before);
    await gotoEditor(page);
    const after = await fileContent(page);
    await dump("index-after-reload.html", after);
    for (const needle of [HEADLINE, SUBHEAD]) {
      if (!after.includes(needle)) report("bug", "Authored text missing after reload", `"${needle}" not in index.html`);
    }
    if (after !== before) {
      report("suspect", "Document mutated across a reload with no edits", `length ${before.length} → ${after.length}`);
    }
  });

  for (const action of ["export-html", "export-svg", "export-zip"]) {
    await step(page, `export: ${action}`, async () => {
      const result = await postAction(page, action, { id: designId }).catch((err) => ({ __error: String(err) }));
      if ((result as any).__error) {
        report("bug", `${action} failed`, String((result as any).__error).slice(0, 400));
        return;
      }
      const payload = JSON.stringify(result);
      if (!payload.includes(HEADLINE)) {
        report(
          "bug",
          `${action} output omits authored canvas content`,
          `the export payload (${payload.length} bytes) does not contain the headline I typed on the canvas`,
        );
      }
    });
  }

  await step(page, "export: export-pdf", async () => {
    const res = await page.request.get(`${BASE_URL}/_agent-native/actions/export-pdf?id=${designId}`);
    if (!res.ok()) report("bug", "export-pdf failed", `${res.status()} ${(await res.text()).slice(0, 250)}`);
  });

  await step(page, "error contract: unknown action returns a clean 4xx", async () => {
    const res = await page.request.post(`${BASE_URL}/_agent-native/actions/definitely-not-an-action`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.text();
    if (res.status() >= 500) {
      report("bug", `Unknown action returns HTTP ${res.status()} instead of 404`, `body starts: ${body.slice(0, 200).replace(/\s+/g, " ")}`);
    }
    if (/\/Users\/|\/home\/|node_modules\/\.pnpm/.test(body)) {
      report("bug", "Action error response leaks absolute server filesystem paths", `body contains a host path: ${(/(\/Users\/[^"\\ ]{0,80})/.exec(body)?.[1] ?? "").slice(0, 90)}`);
    }
  });
}

main().catch((err) => {
  console.error("driver crashed:", err);
  process.exit(1);
});
