// Drives a fixed editing session on a seeded stress board in Chromium and
// checks heap, blanked screens and the live-editor pool against
// runtime-budget.json. Exit 0 within budget, 1 over budget, 2 when a step did
// not take effect.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium, type CDPSession, type Page } from "@playwright/test";

type BudgetFile = {
  copies: number;
  iterations: number;
  gates: Record<string, { max: number; why: string }>;
  reported: string[];
};

let seededDesignId: string | undefined;
async function deleteSeededDesign() {
  if (!seededDesignId) return;
  const id = seededDesignId;
  seededDesignId = undefined;
  await postAction("delete-design", { id });
}
// A throw outside a measured step means the session never ran, not that it was over budget.
process.on("uncaughtException", async (error) => {
  console.error(error);
  await deleteSeededDesign().catch(() => {});
  process.exit(2);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await deleteSeededDesign().catch(() => {});
    process.exit(2);
  });
}

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    design: { type: "string" },
    out: { type: "string" },
    summary: { type: "string" },
    headed: { type: "boolean", default: false },
  },
});
const baseUrl = values["base-url"]?.replace(/\/$/, "");
if (!baseUrl) {
  throw new Error(
    "--base-url is required; point it at a production build started with AUTH_DISABLED=1",
  );
}
const designRoot = fileURLToPath(new URL("..", import.meta.url));
const budgets = JSON.parse(
  readFileSync(new URL("./runtime-budget.json", import.meta.url), "utf8"),
) as BudgetFile;

function seedDesign(): string {
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "e2e/fixtures/seed-perf-stress-design.ts",
      "--base-url",
      baseUrl!,
      "--copies",
      String(budgets.copies),
      "--title",
      "Runtime budget",
    ],
    { cwd: designRoot, encoding: "utf8" },
  );
  const id = /^design (\S+) /m.exec(output)?.[1];
  if (!id) throw new Error(`seeding printed no design id:\n${output}`);
  return id;
}

async function postAction(name: string, input: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-CSRF": "1",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `${name} failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

if (!values.design) seededDesignId = seedDesign();
const designId = values.design ?? seededDesignId!;
const sessionStartedAt = Date.now();

const browser = await chromium.launch({ headless: !values.headed });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.addInitScript("globalThis.__name = (fn) => fn;");
await page.addInitScript(() => {
  const w = window as unknown as Record<string, unknown> & {
    __budget: {
      longFrames: { at: number; duration: number }[];
      refreshes: { at: number; screen: string; from: string; to: string }[];
      liveInserts: number[];
      previewRemounts: number[];
    };
  };
  w.__budget = {
    longFrames: [],
    refreshes: [],
    liveInserts: [],
    previewRemounts: [],
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      w.__budget.longFrames.push({
        at: entry.startTime,
        duration: entry.duration,
      });
    }
  }).observe({ type: "long-animation-frame", buffered: true });

  const isLive = (frame: Element) =>
    frame.hasAttribute("data-design-preview-iframe");
  const isStatic = (frame: Element) =>
    frame.hasAttribute("data-screen-static-preview");
  const previewedScreens = new Set<string>();
  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLIFrameElement) {
        event.target.setAttribute("data-budget-loaded", "");
      }
    },
    true,
  );
  // An editor draws as its document parses and says so with this message;
  // its load event waits for images and fonts as well.
  addEventListener("message", (event) => {
    if (event.data?.type !== "agent-native:editor-chrome-ready") return;
    for (const frame of document.querySelectorAll(
      "iframe[data-design-preview-iframe]",
    )) {
      if ((frame as HTMLIFrameElement).contentWindow === event.source) {
        frame.setAttribute("data-budget-loaded", "");
      }
    }
  });
  addEventListener("DOMContentLoaded", () => {
    new MutationObserver((records) => {
      for (const record of records) {
        // A new srcdoc reloads the same element, which blanks it like a swap does.
        if (record.type === "attributes") {
          (record.target as Element).removeAttribute("data-budget-loaded");
          continue;
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const frames =
            node instanceof HTMLIFrameElement
              ? [node]
              : [...node.querySelectorAll("iframe")];
          for (const frame of frames) {
            if (isLive(frame)) w.__budget.liveInserts.push(performance.now());
            const screenId = frame.getAttribute("data-screen-iframe-id");
            if (!isStatic(frame) || !screenId) continue;
            if (previewedScreens.has(screenId)) {
              w.__budget.previewRemounts.push(performance.now());
            }
            previewedScreens.add(screenId);
          }
        }
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["srcdoc", "src"],
    });
  });

  // A refresh is a visible screen that was showing a loaded document and no
  // longer is: the blank a user sees while one view of it replaces another.
  const showing = new Map<string, string>();
  const kindOf = (frame: Element) => (isLive(frame) ? "editor" : "preview");
  setInterval(() => {
    for (const shell of document.querySelectorAll(
      "[data-screen-shell][data-frame-id]",
    )) {
      const id = shell.getAttribute("data-frame-id")!;
      const content = shell.querySelector("[data-screen-content]");
      const rect = content?.getBoundingClientRect();
      const visible =
        rect !== undefined &&
        rect.width > 24 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < innerWidth &&
        rect.top < innerHeight;
      if (!visible) {
        showing.delete(id);
        continue;
      }
      const frames = [...content!.querySelectorAll("iframe")].filter(
        (frame) => isLive(frame) || isStatic(frame),
      );
      const loaded = frames.filter((frame) =>
        frame.hasAttribute("data-budget-loaded"),
      );
      const was = showing.get(id);
      if (loaded.length) {
        showing.set(id, loaded.map(kindOf).join("+"));
      } else if (was !== undefined) {
        showing.delete(id);
        w.__budget.refreshes.push({
          at: performance.now(),
          screen:
            shell.querySelector("[data-frame-title]")?.getAttribute("title") ??
            id,
          from: was,
          to: frames.length
            ? `${frames.map(kindOf).join("+")} loading`
            : content!.querySelector("[data-screen-placeholder]")
              ? "placeholder"
              : "nothing",
        });
      }
    }
  }, 50);
});

for (const key of ["design-selection", "navigation"]) {
  await page.request.delete(
    `${baseUrl}/_agent-native/application-state/${key}`,
    { headers: { "X-Agent-Native-CSRF": "1" } },
  );
}
const cdp = await context.newCDPSession(page);
await cdp.send("HeapProfiler.enable");

const metrics: Record<string, number> = {};
const failedSteps: string[] = [];

const loadStartedAt = Date.now();
await page.goto(`${baseUrl}/design/${designId}`, {
  waitUntil: "domcontentloaded",
});
await page
  .getByRole("button", { name: "Move", exact: true })
  .waitFor({ timeout: 180_000 });
metrics.editorVisibleMs = Date.now() - loadStartedAt;
await page.waitForTimeout(8000);

async function heapAfterGcMB(session: CDPSession): Promise<number> {
  await session.send("HeapProfiler.collectGarbage");
  const { usedSize } = await session.send("Runtime.getHeapUsage");
  return usedSize / 1e6;
}
const now = () => page.evaluate(() => performance.now());
function countSince(field: "liveInserts" | "previewRemounts", since: number) {
  return page.evaluate(
    ([name, t]) =>
      (
        (window as unknown as Record<string, Record<string, number[]>>)
          .__budget[name] ?? []
      ).filter((at) => at >= t).length,
    [field, since] as const,
  );
}
function worstFrameSince(since: number) {
  return page.evaluate(
    (t) =>
      Math.max(
        0,
        ...(
          window as unknown as {
            __budget: { longFrames: { at: number; duration: number }[] };
          }
        ).__budget.longFrames
          .filter((frame) => frame.at >= t)
          .map((frame) => frame.duration),
      ),
    since,
  );
}

const zoomOf = () =>
  page.evaluate(() => {
    const transform =
      document.querySelector<HTMLElement>("[data-multi-screen-canvas-world]")
        ?.style.transform ?? "";
    const match = /scale\(([0-9.]+)\)/.exec(transform);
    return match ? Number(match[1]) * 100 : null;
  });
async function zoomTo(target: number, x: number, y: number): Promise<boolean> {
  const distance = async () => Math.log(((await zoomOf()) ?? 10) / target);
  // A CI runner reads the zoom back several times slower than a laptop.
  const giveUpAt = Date.now() + 60_000;
  while (Date.now() < giveUpAt) {
    const off = await distance();
    if (Math.abs(off) < 0.06) break;
    // Fire and forget: awaiting each wheel event lets the camera settle between
    // them. Smaller steps near the target, because events queued behind a long
    // frame all land at once and overshoot.
    void cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY: Math.sign(off) * Math.min(40, Math.max(2, Math.abs(off) * 40)),
      modifiers: 2,
    });
    // Near the target, let the camera apply each step before reading again;
    // otherwise a slow runner overshoots back and forth around it.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.abs(off) < 0.3 ? 120 : 16),
    );
  }
  await page.waitForTimeout(1500);
  return Math.abs(await distance()) < 0.15;
}

async function until(check: () => Promise<boolean>, timeoutMs = 30_000) {
  const giveUpAt = Date.now() + timeoutMs;
  while (Date.now() < giveUpAt) {
    if (await check()) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

// An editor can reboot while the board settles after a camera move, detaching
// whatever was found in it a moment ago.
async function settledBox(locator: ReturnType<Page["locator"]>) {
  const giveUpAt = Date.now() + 120_000;
  while (Date.now() < giveUpAt) {
    // coercion-ok: a missed poll retries, and the loop throws once time runs out.
    const box = await locator.boundingBox({ timeout: 5_000 }).catch(() => null);
    if (box) return box;
  }
  throw new Error(`${locator} never appeared`);
}

const tree = page.getByRole("tree", { name: "Layers" });
const editorFrame = (filename: string) =>
  page.frameLocator(
    `[data-screen-shell]:has([data-frame-title][title="${filename}" i]) iframe[data-design-preview-iframe]`,
  );
async function selectScreenRow(name: string) {
  // A deep selection expands its screen's whole subtree, burying the other
  // screens' rows. One page call: the button disables itself as rows collapse.
  await page.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>(
        '[data-layers-panel-action="collapse"]:not(:disabled)',
      )
      ?.click(),
  );
  await tree.getByRole("button", { name, exact: true }).click();
}
async function focusScreen(name: string) {
  await page.keyboard.press("Escape");
  await selectScreenRow(name);
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press("Shift+2");
  await page.waitForTimeout(2500);
}
const worstFrameByStep: Record<string, number> = {};
const stepWindows: { name: string; start: number; end: number }[] = [];
async function step(name: string, run: () => Promise<boolean>) {
  const startedAt = await now();
  let tookEffect = false;
  try {
    tookEffect = await run();
  } catch (error) {
    console.log(`  ${name} threw: ${String(error).slice(0, 200)}`);
  }
  stepWindows.push({ name, start: startedAt, end: await now() });
  if (!tookEffect) {
    failedSteps.push(name);
    if (values.out) {
      await page
        .screenshot({
          timeout: 10_000,
          path: values.out.replace(
            /\.json$/,
            `-${name}-${stepWindows.length}.png`,
          ),
        })
        .catch((error) =>
          console.log(
            `  no screenshot of ${name}: ${String(error).slice(0, 120)}`,
          ),
        );
    }
  }
  worstFrameByStep[name] = Math.max(
    worstFrameByStep[name] ?? 0,
    await worstFrameSince(startedAt),
  );
}

const heapSeries = [await heapAfterGcMB(cdp)];
metrics.heapAfterLoadMB = heapSeries[0]!;
const refreshesFrom = await now();
const visits = [
  "Nested 2",
  "Absolute 1",
  "Kanban 3",
  "Settings 4",
  "Catalog 2",
  "Article 3",
  "Icons 2",
  "Dashboard 4",
];
const zoomPoints = [
  [640, 360],
  [500, 300],
  [800, 420],
  [600, 500],
] as const;
let zoomCycleBoots = 0;
let zoomCycleRemounts = 0;

async function runSession() {
  for (let iteration = 0; iteration < budgets.iterations; iteration += 1) {
    console.log(`iteration ${iteration + 1}/${budgets.iterations}`);
    await focusScreen("Dashboard 2");
    const heading = editorFrame("dashboard-2.html")
      .locator("main header h1")
      .first();
    const box = await settledBox(heading);
    await zoomTo(60, Math.round(box.x + 4), Math.round(box.y + box.height / 2));
    await page.waitForTimeout(2500);

    await step("select", async () => {
      await page.keyboard.press("Escape");
      await editorFrame("dashboard-2.html")
        .locator('[data-agent-native-edit-overlay="shield"]')
        .first()
        .waitFor({ state: "attached", timeout: 30_000 });
      const target = await settledBox(heading);
      await page.keyboard.down("ControlOrMeta");
      await page.mouse.click(
        target.x + target.width / 2,
        target.y + target.height / 2,
      );
      await page.keyboard.up("ControlOrMeta");
      await page
        .getByRole("button", { name: "Typography details" })
        .waitFor({ timeout: 10_000 });
      return true;
    });
    const original = (await heading.textContent())?.trim() ?? "";
    await step("textEdit", async () => {
      await page.keyboard.press("Enter");
      await editorFrame("dashboard-2.html")
        .locator('[contenteditable="true"]')
        .first()
        .waitFor({ timeout: 10_000 });
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(`Budget ${iteration}`, { delay: 20 });
      await page.keyboard.press("ControlOrMeta+Enter");
      await page.waitForTimeout(1500);
      const edited = (await heading.textContent())?.trim();
      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(2000);
      return (
        edited === `Budget ${iteration}` &&
        (await heading.textContent())?.trim() === original
      );
    });
    await step("color", async () => {
      const fill = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: /^Fill$/i }) })
        .first();
      await fill
        .getByRole("button", { name: "Open color picker" })
        .first()
        .click();
      const hex = page.locator('[aria-label="Hex"]').first();
      await hex.fill(iteration % 2 ? "2563EB" : "DC2626");
      await hex.press("Enter");
      const applied = (await hex.inputValue())
        .toUpperCase()
        .includes(iteration % 2 ? "2563EB" : "DC2626");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(1500);
      return applied;
    });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await step("duplicate", async () => {
      await selectScreenRow("Dashboard 3");
      await page.waitForTimeout(1200);
      const cards = page.locator("[data-screen-card]");
      const before = await cards.count();
      await page.keyboard.press("ControlOrMeta+d");
      const duplicated = await until(
        async () => (await cards.count()) === before + 1,
      );
      await page.waitForTimeout(1500);
      await page.keyboard.press("ControlOrMeta+z");
      const undone = await until(async () => (await cards.count()) === before);
      await page.waitForTimeout(1500);
      return duplicated && undone;
    });
    const [x, y] = zoomPoints[iteration % zoomPoints.length]!;
    await step("zoomCycle", async () => {
      const startedAt = await now();
      let arrivedEverywhere = true;
      for (const zoom of [13, 31, 7, 145, 10]) {
        arrivedEverywhere = (await zoomTo(zoom, x, y)) && arrivedEverywhere;
      }
      zoomCycleBoots += await countSince("liveInserts", startedAt);
      zoomCycleRemounts += await countSince("previewRemounts", startedAt);
      return arrivedEverywhere;
    });
    await step("visits", async () => {
      const start = (iteration * 3) % visits.length;
      for (const name of visits.slice(start, start + 3)) {
        await focusScreen(name);
        const filename = `${name.toLowerCase().replace(" ", "-")}.html`;
        const editor = page.locator(
          `[data-screen-shell]:has([data-frame-title][title="${filename}" i]) iframe[data-design-preview-iframe]`,
        );
        const box = await settledBox(editor);
        // A selected screen's drag surface can cover its content and take the click.
        await page.keyboard.press("Escape");
        await editorFrame(filename)
          .locator('[data-agent-native-edit-overlay="shield"]')
          .first()
          .waitFor({ state: "attached", timeout: 30_000 });
        await page.keyboard.down("ControlOrMeta");
        await page.mouse.click(
          box.x + box.width / 2,
          Math.min(box.y + Math.min(box.height / 2, 200), 680),
        );
        await page.keyboard.up("ControlOrMeta");
        const selectedRows = tree.locator(
          '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
        );
        const selectedInsideScreen = async () =>
          (await selectedRows.count()) > 0 &&
          (await selectedRows.first().innerText()).trim() !== name;
        if (!(await until(selectedInsideScreen, 10_000))) return false;
        await page.waitForTimeout(1200);
      }
      return true;
    });
    await page.keyboard.press("Escape");
    await zoomTo(8, 640, 360);
    heapSeries.push(await heapAfterGcMB(cdp));
  }
}

try {
  await runSession();
} catch (error) {
  failedSteps.push(`session (${String(error).split("\n")[0]?.slice(0, 160)})`);
}

await page.waitForTimeout(4000);
metrics.liveEditorsAfterSettle = await page
  .locator("iframe[data-design-preview-iframe]")
  .count();
// Each refresh is named by the step it happened in, so a failing count points at the change.
const refreshes = (
  await page.evaluate(
    () =>
      (
        window as unknown as {
          __budget: {
            refreshes: {
              at: number;
              screen: string;
              from: string;
              to: string;
            }[];
          };
        }
      ).__budget.refreshes,
  )
)
  .filter((refresh) => refresh.at >= refreshesFrom)
  .map((refresh) => ({
    screen: refresh.screen,
    change: `${refresh.from} → ${refresh.to}`,
    step:
      stepWindows.find(
        (window) => refresh.at >= window.start && refresh.at <= window.end,
      )?.name ?? "between steps",
  }));
metrics.visibleRefreshes = refreshes.length;
metrics.editorBootsPerZoomCycle = zoomCycleBoots / budgets.iterations;
metrics.previewRemountsPerZoomCycle = zoomCycleRemounts / budgets.iterations;
metrics.heapEndMB = heapSeries[heapSeries.length - 1]!;
// The first iteration fills caches; growth after it is what a long session keeps paying.
const afterWarmUp = heapSeries.slice(2);
metrics.heapGrowthPerIterationMB =
  afterWarmUp.length > 1
    ? (afterWarmUp[afterWarmUp.length - 1]! - afterWarmUp[0]!) /
      (afterWarmUp.length - 1)
    : Number.NaN;
for (const [name, worst] of Object.entries(worstFrameByStep)) {
  metrics[`${name}WorstFrameMs`] = worst;
}
await browser.close();
await deleteSeededDesign();
console.log(
  `session took ${Math.round((Date.now() - sessionStartedAt) / 1000)}s`,
);

const format = (value: number | undefined) =>
  value === undefined || Number.isNaN(value)
    ? "missing"
    : String(Math.round(value * 10) / 10);
// A metric the session failed to produce counts as over its gate.
const gateRows = Object.entries(budgets.gates).map(([name, { max, why }]) => {
  const value = metrics[name];
  const over = value === undefined || Number.isNaN(value) || value > max;
  return { name, value, max, why, over };
});
const overBudget = gateRows.filter((row) => row.over);
const table = [
  "| Gate | Measured | Max | Result | Why |",
  "| --- | --- | --- | --- | --- |",
  ...gateRows.map(
    (row) =>
      `| ${row.name} | ${format(row.value)} | ${row.max} | ${row.over ? "over" : "ok"} | ${row.why} |`,
  ),
  "",
  "| Reported only | Measured |",
  "| --- | --- |",
  ...budgets.reported.map((name) => `| ${name} | ${format(metrics[name])} |`),
].join("\n");
const verdict = failedSteps.length
  ? `Could not measure: ${[...new Set(failedSteps)].join(", ")} did not take effect.`
  : overBudget.length
    ? `Over budget: ${overBudget.map((row) => row.name).join(", ")}.`
    : "Within budget.";
const refreshLines = refreshes.map(
  (refresh) => `- ${refresh.step}: ${refresh.screen} (${refresh.change})`,
);
console.log(`\n${table}\n\n${verdict}`);
if (refreshLines.length)
  console.log(`\nRefreshes:\n${refreshLines.join("\n")}`);
if (values.out) {
  writeFileSync(
    values.out,
    JSON.stringify(
      { designId, metrics, heapSeries, failedSteps, refreshes },
      null,
      2,
    ),
  );
}
if (values.summary) {
  appendFileSync(
    values.summary,
    `## Design runtime budget\n\n${table}\n\n${verdict}\n`,
  );
}
process.exitCode = failedSteps.length ? 2 : overBudget.length ? 1 : 0;
