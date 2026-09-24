/**
 * Real-browser edit-fidelity harness for the Slides editor: clicking into
 * text, typing, pressing Enter or just leaving an edit must not change any
 * styling or layout of the slide. See README.md.
 *
 * Exit codes: 0 pass, 1 regression against baseline.json, 2 could not run.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  pick,
  resolvePnpmEntry,
  WORKTREE_ROOT,
} from "../export-fidelity/resolve-pkg.ts";
import {
  CHROME_SELECTOR,
  installInPageHelpers,
  MASK_CSS,
  type EditorState,
  type Rect,
  type Snapshot,
  type TextTarget,
} from "./lib/in-page.ts";
import {
  diffPngs,
  diffSnapshots,
  findBaselineProblems,
  hardFailures,
  lineDiff,
  padRect,
  toBaselineEntry,
  type BaselineEntry,
  type PixelDiff,
  type ScenarioMetrics,
  type Status,
  type StyleDiff,
} from "./lib/metrics.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = [
  "noop",
  "typedelete",
  "append",
  "enter3",
  "clickout",
] as const;
type Scenario = (typeof SCENARIOS)[number];
/** Scenarios whose net text change is zero: nothing may change at all. */
const NET_NOOP = new Set<Scenario>(["noop", "typedelete", "clickout"]);

class CouldNotRun extends Error {}

// ------------------------------------------------------------------- cli ---

const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set([
  "--corpus",
  "--baseline",
  "--out",
  "--run",
  "--max-slides",
  "--max-targets-per-slide",
  "--slides",
  "--targets",
  "--scenarios",
  "--concurrency",
]);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const numOpt = (name: string, fallback: number) => {
  const raw = opt(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    fatal(`${name} expects a positive integer, got ${raw}`);
  return n;
};
const listOpt = (name: string) =>
  opt(name)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1] ?? ""),
);

const corpusDir = path.resolve(opt("--corpus") ?? path.join(HERE, "corpus"));
const baselinePath = path.resolve(
  opt("--baseline") ?? path.join(corpusDir, "..", "baseline.json"),
);
const runName = opt("--run") ?? new Date().toISOString().replace(/[:.]/g, "-");
const outRoot = path.resolve(
  opt("--out") ??
    path.join(WORKTREE_ROOT, ".tmp/slides-edit-fidelity", runName),
);
const caseFilter = positional[0];
const maxSlides = numOpt("--max-slides", Infinity as number);
const maxTargets = numOpt("--max-targets-per-slide", 4);
const slideFilter = listOpt("--slides")?.map(Number);
const targetFilter = listOpt("--targets")?.map(Number);
const scenarios = (listOpt("--scenarios") ?? [...SCENARIOS]) as Scenario[];
const concurrency = numOpt("--concurrency", 1);
const update = argv.includes("--update");
const headed = argv.includes("--headed");
for (const s of scenarios) {
  if (!SCENARIOS.includes(s))
    fatal(`unknown scenario ${s}; expected ${SCENARIOS.join(",")}`);
}

function fatal(message: string): never {
  console.error(`[edit-fidelity] could not run: ${message}`);
  process.exit(2);
}

// ---------------------------------------------------------------- corpus ---

interface CorpusSlide {
  id?: string;
  content: string;
  layout?: string;
  notes?: string;
}
interface CorpusCase {
  id: string;
  title: string;
  notes?: string;
  aspectRatio?: string;
  slides: CorpusSlide[];
  targets?: Record<string, number>;
}

function loadCorpus(): CorpusCase[] {
  if (!existsSync(corpusDir))
    fatal(`corpus directory ${corpusDir} does not exist`);
  const files = readdirSync(corpusDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const cases: CorpusCase[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    if (caseFilter && !id.includes(caseFilter)) continue;
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(path.join(corpusDir, file), "utf8"));
    } catch (error) {
      fatal(`${file} is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof raw?.title !== "string")
      fatal(`${file}: "title" must be a string`);
    if (!Array.isArray(raw.slides) || raw.slides.length === 0) {
      fatal(`${file}: "slides" must be a non-empty array`);
    }
    raw.slides.forEach((s: any, i: number) => {
      if (typeof s?.content !== "string" || !s.content.trim()) {
        fatal(`${file}: slides[${i}].content must be a non-empty string`);
      }
    });
    cases.push({ id, ...raw });
  }
  if (!cases.length) {
    fatal(
      `no corpus cases in ${corpusDir}${caseFilter ? ` matching "${caseFilter}"` : ""}`,
    );
  }
  return cases;
}

// ---------------------------------------------------------------- server ---

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function startServer(): Promise<{
  base: string;
  stop: () => Promise<void>;
}> {
  const port = await freePort();
  const logPath = path.join(outRoot, "server.log");
  const log = openSync(logPath, "a");
  // Scratch PGlite from claude-launch, wiped when the launcher exits.
  const child: ChildProcess = spawn(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/claude-launch.ts",
      "--name",
      "slides-edit-fidelity",
      "--dir",
      "templates/slides",
      "--env",
      "AUTH_MODE=local",
      "--env",
      "AUTH_DISABLED=true",
      "--",
      "dev",
      "--port",
      String(port),
    ],
    { cwd: WORKTREE_ROOT, detached: true, stdio: ["ignore", log, log] },
  );
  let exited: number | null = null;
  child.on("exit", (code) => {
    exited = code ?? 1;
  });
  // Last resort if the harness dies without awaiting stop(): the server runs
  // in its own process group and would otherwise outlive us.
  process.on("exit", () => {
    if (exited === null && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
        // coercion-ok: ESRCH means the server group already exited.
      } catch {
        // already gone
      }
    }
  });
  const stop = async () => {
    if (exited !== null || !child.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
      // coercion-ok: ESRCH means the server group already exited.
    } catch {
      return;
    }
    for (let i = 0; i < 50 && exited === null; i++) await sleep(200);
    if (exited === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
        // coercion-ok: ESRCH means the server group already exited.
      } catch {
        // already gone
      }
    }
  };
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new CouldNotRun(`dev server exited with ${exited}; see ${logPath}`);
    }
    try {
      const res = await fetch(`${base}/`);
      if (res.status < 500) return { base, stop };
      // coercion-ok: connection refused while the server boots; the loop's deadline fails loudly.
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  await stop();
  throw new CouldNotRun(
    `dev server did not answer on ${base} within 240s; see ${logPath}`,
  );
}

// --------------------------------------------------------------- browser ---

type Page = any;

const canvasSelector = (slideId: string) =>
  `[data-main-slide-canvas="true"] [data-slide-canvas="${slideId}"]`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function action<T = any>(
  page: Page,
  name: string,
  body: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const res = await page.evaluate(
    async ({ name, body, method }: any) => {
      const url =
        method === "GET"
          ? `/_agent-native/actions/${name}?${new URLSearchParams(body)}`
          : `/_agent-native/actions/${name}`;
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body),
      });
      return { ok: r.ok, status: r.status, text: await r.text() };
    },
    { name, body, method },
  );
  if (!res.ok)
    throw new Error(`${name} ${res.status}: ${res.text.slice(0, 400)}`);
  return JSON.parse(res.text);
}

async function getSlideContent(page: Page, deckId: string, slideId: string) {
  const deck = await action(
    page,
    "get-deck",
    { id: deckId, slideId, compact: "false" },
    "GET",
  );
  const slide = deck.slides?.find((s: any) => s.id === slideId);
  if (!slide) throw new Error(`get-deck returned no slide ${slideId}`);
  return String(slide.content);
}

async function ensureSignedIn(page: Page) {
  const status = () =>
    page.evaluate(
      async () =>
        (await fetch("/_agent-native/actions/list-decks?limit=1")).status,
    );
  if ((await status()) === 200) return;
  await page.evaluate(() =>
    fetch("/_agent-native/auth/local-dev", { method: "POST" }),
  );
  const after = await status();
  if (after !== 200)
    throw new CouldNotRun(
      `not signed in (list-decks ${after}) after local-dev sign-in`,
    );
}

async function settle(page: Page) {
  await page.evaluate(async (css: string) => {
    if (!document.querySelector("style[data-edit-fidelity-mask]")) {
      const style = document.createElement("style");
      style.setAttribute("data-edit-fidelity-mask", "");
      style.textContent = css;
      document.head.appendChild(style);
    }
    await document.fonts.ready;
    // Only the main canvas: sidebar thumbnails are lazy and may never load.
    // A broken image fires "error", never "load"; both views see the same one.
    const pending = Array.from(
      document.querySelectorAll<HTMLImageElement>(
        '[data-main-slide-canvas="true"] img',
      ),
    ).filter((img) => !img.complete);
    await Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            }),
        ),
      ),
      new Promise((r) => setTimeout(r, 10_000)),
    ]);
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
  }, MASK_CSS);
  // Autofit measures after paint; give it one more beat.
  await sleep(300);
}

async function openSlide(
  page: Page,
  base: string,
  deckId: string,
  index: number,
  slideId: string,
) {
  for (let attempt = 0; ; attempt++) {
    await page.goto(`${base}/deck/${deckId}?slide=${index + 1}`, {
      waitUntil: "domcontentloaded",
    });
    try {
      await page.waitForSelector(canvasSelector(slideId), { timeout: 45_000 });
      break;
    } catch (error) {
      // A first load can 504 "Outdated Optimize Dep" and full-reload.
      if (attempt >= 2) throw error;
    }
  }
  await page.mouse.move(0, 0);
  await settle(page);
}

async function shot(page: Page, slideId: string): Promise<Buffer> {
  await page.mouse.move(0, 0);
  return page.locator(canvasSelector(slideId)).screenshot({
    animations: "disabled",
    caret: "hide",
  });
}

async function editorState(page: Page, slideId: string): Promise<EditorState> {
  return page.evaluate(
    (sel: string) => window.__editFidelity.editorState(sel),
    canvasSelector(slideId),
  );
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  stepMs = 100,
) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return fn();
}

/** click, click again, double-click — whichever first puts focus in an editor. */
async function enterEdit(
  page: Page,
  slideId: string,
  point: { x: number; y: number },
) {
  const editing = async () => (await editorState(page, slideId)).editing;
  const gestures: Array<[string, () => Promise<void>]> = [
    ["click", () => page.mouse.click(point.x, point.y)],
    ["click-click", () => page.mouse.click(point.x, point.y)],
    ["dblclick", () => page.mouse.dblclick(point.x, point.y)],
  ];
  for (const [name, gesture] of gestures) {
    await gesture();
    if (await waitFor(editing, 900)) return name;
  }
  return null;
}

async function exitEdit(
  page: Page,
  slideId: string,
  how: "escape" | "clickout",
) {
  if (how === "clickout") {
    const point = await page.evaluate(
      (sel: string) => window.__editFidelity.backgroundPoint(sel),
      canvasSelector(slideId),
    );
    if (!point)
      throw new Error("no empty editor background next to the slide to click");
    await page.mouse.click(point.x, point.y);
  } else {
    await page.keyboard.press("Escape");
  }
  return waitFor(async () => !(await editorState(page, slideId)).editing, 5000);
}

/**
 * Polls the stored slide until it stops changing. Saves are debounced, so
 * "no change yet" is only trusted after a minimum wait.
 */
async function settleSaved(page: Page, deckId: string, slideId: string) {
  const start = Date.now();
  let last = await getSlideContent(page, deckId, slideId);
  let lastChange = Date.now();
  while (Date.now() - start < 15_000) {
    await sleep(300);
    const now = await getSlideContent(page, deckId, slideId);
    if (now !== last) {
      last = now;
      lastChange = Date.now();
    }
    if (Date.now() - start >= 2500 && Date.now() - lastChange >= 1200) break;
  }
  return last;
}

async function restoreSlide(
  page: Page,
  deckId: string,
  slideId: string,
  stored: string,
) {
  if ((await getSlideContent(page, deckId, slideId)) === stored) return;
  await action(page, "patch-deck", {
    deckId,
    operations: [{ op: "patch-slide", slideId, fields: { content: stored } }],
  });
  if ((await getSlideContent(page, deckId, slideId)) !== stored) {
    throw new Error(
      "restoring the stored slide through patch-deck did not round-trip",
    );
  }
}

async function snapshot(
  page: Page,
  slideId: string,
  edited: { targetIndex?: number; text?: string },
): Promise<Snapshot> {
  return page.evaluate(
    ({ sel, edited }: any) => window.__editFidelity.snapshot(sel, edited),
    { sel: canvasSelector(slideId), edited },
  );
}

async function listTargets(page: Page, slideId: string): Promise<TextTarget[]> {
  return page.evaluate(
    (sel: string) => window.__editFidelity.listTargets(sel),
    canvasSelector(slideId),
  );
}

async function makeSheet(
  sheetPage: Page,
  dir: string,
  panels: Array<[string, string]>,
) {
  const present = panels.filter(([, file]) => existsSync(path.join(dir, file)));
  if (!present.length) return;
  const width = 360;
  const cells = present
    .map(([label, file]) => {
      const src = `data:image/png;base64,${readFileSync(path.join(dir, file)).toString("base64")}`;
      return `<figure><img src="${src}"><figcaption>${label}</figcaption></figure>`;
    })
    .join("");
  // guard:allow-raw-color — diagnostic artifact, not themed UI
  await sheetPage.setContent(`<!doctype html><body style="margin:0;background:#111;color:#eee;font:12px system-ui">
<div id="sheet" style="display:inline-flex;gap:8px;padding:8px;align-items:flex-start">${cells}</div>
<style>figure{margin:0}img{display:block;width:${width}px;height:auto}figcaption{padding:4px 2px}</style></body>`);
  await sheetPage.waitForFunction(() =>
    Array.from(document.images).every((i) => i.complete),
  );
  writeFileSync(
    path.join(dir, "sheet.png"),
    await sheetPage.locator("#sheet").screenshot(),
  );
}

// -------------------------------------------------------------- scenario ---

interface EnterStep {
  key: number;
  blocks: number;
  editorHeight: number | null;
  sourceHeight: number | null;
  canvasChangedPct: number;
  reflowed: boolean;
  visiblyChanged: boolean;
}

interface ScenarioResult {
  key: string;
  caseId: string;
  slide: number;
  target: number;
  scenario: Scenario;
  status: Status;
  error?: string;
  gesture?: string | null;
  targetInfo: Pick<TextTarget, "tag" | "text" | "className">;
  edited?: { tag: string | null; text: string | null };
  pixels?: Record<string, { whole: PixelDiff; outside: PixelDiff }>;
  style?: {
    editing: StyleSummary;
    after: StyleSummary;
    reload: StyleSummary;
  };
  inventory?: Record<string, Record<string, number>>;
  html?: {
    saved: boolean;
    canonicalEqual: boolean;
    outsideEqual: boolean | null;
    diffLines: number;
    hardFailures: string[];
    idempotent?: boolean;
  };
  enterSteps?: EnterStep[];
  violations: string[];
  /** Set when a transient (dev-server reload) error forced one retry. */
  retriedAfter?: string;
  metrics?: ScenarioMetrics;
}

interface StyleSummary {
  deltas: number;
  deltasOutside: number;
  geometry: number;
  geometryOutside: number;
  missing: number;
  added: number;
  sample: string[];
}

function summarizeStyle(d: StyleDiff): StyleSummary {
  const fmt = (x: { key: string; prop: string; a: string; b: string }) =>
    `${x.key} ${x.prop}: ${x.a} -> ${x.b}`;
  return {
    deltas: d.deltas.length,
    deltasOutside: d.deltas.filter((x) => !x.inside).length,
    geometry: d.geometry.length,
    geometryOutside: d.geometry.filter((x) => !x.inside).length,
    missing: d.missing.length,
    added: d.added.length,
    sample: [
      ...d.deltas.slice(0, 20).map(fmt),
      ...d.missing.slice(0, 8).map((m) => `missing ${m.key}`),
      ...d.added.slice(0, 8).map((m) => `added ${m.key}`),
      ...d.geometry.slice(0, 8).map(fmt),
    ],
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

interface SlideCtx {
  page: Page;
  sheetPage: Page;
  base: string;
  caseId: string;
  deckId: string;
  slideIndex: number;
  slideId: string;
  stored: string;
  noisePct: number;
  dir: string;
}

async function runScenario(
  ctx: SlideCtx,
  target: TextTarget,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const { page, slideId, deckId } = ctx;
  const key = `${ctx.caseId}/s${pad2(ctx.slideIndex + 1)}/t${pad2(target.index)}/${scenario}`;
  const dir = path.join(ctx.dir, `t${pad2(target.index)}-${scenario}`);
  mkdirSync(dir, { recursive: true });
  const result: ScenarioResult = {
    key,
    caseId: ctx.caseId,
    slide: ctx.slideIndex + 1,
    target: target.index,
    scenario,
    status: "error",
    targetInfo: {
      tag: target.tag,
      text: target.text,
      className: target.className,
    },
    violations: [],
  };
  const tol = Math.max(0.02, ctx.noisePct * 2);
  const write = (file: string, data: Buffer | string) =>
    writeFileSync(path.join(dir, file), data);

  try {
    await restoreSlide(page, deckId, slideId, ctx.stored);
    await openSlide(page, ctx.base, deckId, ctx.slideIndex, slideId);
    const current = (await listTargets(page, slideId))[target.index];
    if (!current || current.text !== target.text) {
      throw new Error(
        `target ${target.index} ("${target.text.slice(0, 40)}") is not where it was after a fresh load`,
      );
    }
    const view = await shot(page, slideId);
    write("view.png", view);
    write("stored.html", ctx.stored);
    const snapView = await snapshot(page, slideId, {
      targetIndex: target.index,
    });

    result.gesture = await enterEdit(page, slideId, current.point);
    if (!result.gesture) {
      result.status = "no-edit";
      result.violations.push(
        "could not enter edit mode with click, click-click or double-click",
      );
      return result;
    }
    await settle(page);
    const state0 = await editorState(page, slideId);
    result.edited = { tag: state0.sourceTag, text: state0.sourceText };
    const editing = await shot(page, slideId);
    write("editing.png", editing);
    const snapEditing = await snapshot(page, slideId, {});

    const enterSteps: EnterStep[] = [];
    if (scenario === "typedelete" || scenario === "clickout") {
      await page.keyboard.type("x");
      await page.keyboard.press("Backspace");
    } else if (scenario === "append") {
      await page.keyboard.press("End");
      await page.keyboard.type(" ok");
    } else if (scenario === "enter3") {
      await page.keyboard.press("End");
      let prevPng = editing;
      let prev = state0;
      for (let k = 1; k <= 3; k++) {
        await page.keyboard.press("Enter");
        await settle(page);
        const state = await editorState(page, slideId);
        const png = await shot(page, slideId);
        write(`enter-${k}.png`, png);
        const changed = await diffPngs(prevPng, png);
        const step: EnterStep = {
          key: k,
          blocks: state.blocks,
          editorHeight: state.editorRect?.height ?? null,
          sourceHeight: state.sourceRect?.height ?? null,
          canvasChangedPct: changed.pct,
          reflowed:
            (state.sourceRect?.height ?? 0) >
            (prev.sourceRect?.height ?? 0) + 1,
          visiblyChanged: changed.pct > tol,
        };
        enterSteps.push(step);
        if (!step.reflowed) {
          result.violations.push(
            `enter #${k}: editor ${prev.blocks}->${state.blocks} blocks, ${prev.editorRect?.height}->${state.editorRect?.height}px, but the slide's edited element stayed ${state.sourceRect?.height}px (no reflow until exit)`,
          );
        }
        if (!step.visiblyChanged) {
          result.violations.push(
            `enter #${k}: slide did not visibly change (${changed.pct}% <= ${tol}%)`,
          );
        }
        prevPng = png;
        prev = state;
      }
      await page.keyboard.type("new line");
      result.enterSteps = enterSteps;
    }

    const exited = await exitEdit(
      page,
      slideId,
      scenario === "clickout" ? "clickout" : "escape",
    );
    if (!exited) result.violations.push("edit mode did not exit");
    const saved = await settleSaved(page, deckId, slideId);
    write("saved.html", saved);
    await settle(page);
    const after = await shot(page, slideId);
    write("after.png", after);
    const editedText = state0.sourceText ?? target.text;
    const expectedText =
      scenario === "append"
        ? `${editedText} ok`
        : scenario === "enter3"
          ? `${editedText}new line`
          : editedText;
    const snapAfter = await snapshot(page, slideId, { text: expectedText });

    await openSlide(page, ctx.base, deckId, ctx.slideIndex, slideId);
    const reload = await shot(page, slideId);
    write("reload.png", reload);
    const snapReload = await snapshot(page, slideId, { text: expectedText });

    // ---- pixels
    const rects = (...rs: Array<Rect | null | undefined>) =>
      rs.filter((r): r is Rect => !!r).map((r) => padRect(r));
    const pair = async (
      name: string,
      a: Buffer,
      b: Buffer,
      exclude: Rect[],
    ) => {
      const whole = await diffPngs(a, b);
      const outside = await diffPngs(a, b, exclude);
      write(`diff-${name}.png`, whole.png);
      const strip = ({ png: _png, ...rest }: PixelDiff & { png: Buffer }) =>
        rest;
      return { whole: strip(whole), outside: strip(outside) };
    };
    result.pixels = {
      editing: await pair(
        "editing",
        view,
        editing,
        rects(
          target.rect,
          snapView.editedRect,
          state0.sourceRect,
          state0.editorRect,
        ),
      ),
      after: await pair(
        "after",
        view,
        after,
        rects(target.rect, state0.sourceRect, snapAfter.editedRect),
      ),
      reload: await pair(
        "reload",
        after,
        reload,
        rects(snapAfter.editedRect, snapReload.editedRect),
      ),
    };

    // ---- styles and inventory
    const styleEditing = diffSnapshots(snapView, snapEditing);
    const styleAfter = diffSnapshots(snapView, snapAfter);
    const styleReload = diffSnapshots(snapAfter, snapReload);
    result.style = {
      editing: summarizeStyle(styleEditing),
      after: summarizeStyle(styleAfter),
      reload: summarizeStyle(styleReload),
    };
    const invDelta = (a: Snapshot, b: Snapshot) =>
      Object.fromEntries(
        Object.keys(a.inventory).map((k) => [
          k,
          (b.inventory as any)[k] - (a.inventory as any)[k],
        ]),
      );
    result.inventory = {
      view: { ...snapView.inventory },
      editing: invDelta(snapView, snapEditing),
      after: invDelta(snapView, snapAfter),
      reload: invDelta(snapAfter, snapReload),
    };

    // ---- saved html
    const didSave = saved !== ctx.stored;
    const [storedLines, savedLines] = await page.evaluate(
      ({ a, b }: any) => [
        window.__editFidelity.canonical(a),
        window.__editFidelity.canonical(b),
      ],
      { a: ctx.stored, b: saved },
    );
    const diff = lineDiff(storedLines, savedLines);
    let outsideEqual: boolean | null = null;
    if (!NET_NOOP.has(scenario)) {
      const outside = await page.evaluate(
        ({ a, b, t }: any) => window.__editFidelity.canonicalOutside(a, b, t),
        {
          a: ctx.stored,
          b: saved,
          t: {
            tag: state0.sourceTag ?? target.tag,
            text: editedText,
            occurrence: state0.sourceText
              ? state0.sourceOccurrence
              : target.occurrence,
          },
        },
      );
      outsideEqual =
        outside.found && outside.stored.join("\n") === outside.saved.join("\n");
      if (!outside.found)
        result.violations.push(
          "could not locate the edited element in stored/saved HTML to isolate it",
        );
      else if (!outsideEqual) {
        write(
          "html-outside.diff",
          lineDiff(outside.stored, outside.saved).join("\n"),
        );
      }
    }
    write("html.diff", diff.join("\n"));
    const hard = hardFailures(ctx.stored, saved);
    result.html = {
      saved: didSave,
      canonicalEqual: diff.length === 0,
      outsideEqual,
      diffLines: diff.length,
      hardFailures: hard,
    };

    // ---- idempotence: a second no-op edit must save exactly what the first did
    if (scenario === "typedelete") {
      const again =
        (await listTargets(page, slideId)).find(
          (t) => t.text.replace(/\s+/g, "") === editedText.replace(/\s+/g, ""),
        ) ?? (await listTargets(page, slideId))[target.index];
      if (!again) {
        result.violations.push(
          "idempotence: edited text not found after reload",
        );
      } else if (!(await enterEdit(page, slideId, again.point))) {
        result.violations.push(
          "idempotence: could not re-enter edit after reload",
        );
      } else {
        await page.keyboard.type("x");
        await page.keyboard.press("Backspace");
        await exitEdit(page, slideId, "escape");
        const saved2 = await settleSaved(page, deckId, slideId);
        write("saved2.html", saved2);
        result.html.idempotent = saved2 === saved;
      }
    }

    // ---- invariants
    const v = result.violations;
    const px = result.pixels;
    const netNoop = NET_NOOP.has(scenario);
    if (px.editing.outside.pct > tol)
      v.push(
        `view->editing outside the edited element ${px.editing.outside.pct}% > ${tol}%`,
      );
    if (px.reload.whole.pct > tol)
      v.push(
        `after->reload ${px.reload.whole.pct}% > ${tol}% (persisted render differs from the live one)`,
      );
    if (netNoop) {
      if (px.editing.whole.pct > tol)
        v.push(`view->editing ${px.editing.whole.pct}% > ${tol}%`);
      if (px.after.whole.pct > tol)
        v.push(`view->after ${px.after.whole.pct}% > ${tol}%`);
    } else if (scenario === "append" && px.after.outside.pct > tol) {
      v.push(
        `view->after outside the edited element ${px.after.outside.pct}% > ${tol}%`,
      );
    }
    for (const size of [px.editing, px.after, px.reload]) {
      if (size.whole.sizeMismatch) v.push("screenshot size changed");
    }
    const se = result.style.editing;
    const sa = result.style.after;
    if (se.deltas)
      v.push(
        `view->editing: ${se.deltas} computed-style deltas (${se.sample.slice(0, 3).join("; ")})`,
      );
    if (se.missing)
      v.push(`view->editing: ${se.missing} styled elements disappeared`);
    if (netNoop) {
      if (sa.deltas || sa.geometry)
        v.push(
          `view->after: ${sa.deltas} style + ${sa.geometry} geometry deltas`,
        );
      if (sa.missing || sa.added)
        v.push(
          `view->after: ${sa.missing} elements missing, ${sa.added} added`,
        );
      if (snapView.text !== snapAfter.text)
        v.push("view->after: visible text changed");
      if (didSave && diff.length)
        v.push(
          `saved HTML differs from stored (${diff.length} canonical lines)`,
        );
    } else {
      if (sa.deltasOutside)
        v.push(
          `view->after: ${sa.deltasOutside} style deltas outside the edited element`,
        );
      if (outsideEqual === false)
        v.push("saved HTML changed outside the edited element");
    }
    for (const h of hard) v.push(`hard fail: ${h}`);
    if (result.html.idempotent === false)
      v.push("second no-op edit saved different HTML than the first");
    result.status = v.length ? "fail" : "pass";
  } catch (error) {
    result.status = "error";
    result.error = String((error as Error).stack ?? error).slice(0, 2000);
  } finally {
    result.metrics = metricsOf(result);
    write("result.json", JSON.stringify(result, null, 2));
    await makeSheet(ctx.sheetPage, dir, [
      ["view", "view.png"],
      ["editing", "editing.png"],
      ["enter 1", "enter-1.png"],
      ["enter 2", "enter-2.png"],
      ["enter 3", "enter-3.png"],
      ["after exit", "after.png"],
      ["after reload", "reload.png"],
      ["diff view→after", "diff-after.png"],
    ]).catch((error) =>
      console.error(
        `[edit-fidelity] ${key}: sheet failed: ${(error as Error).message}`,
      ),
    );
  }
  return result;
}

function metricsOf(r: ScenarioResult): ScenarioMetrics {
  return {
    status: r.status,
    editingPct: r.pixels?.editing.whole.pct ?? 0,
    afterPct: r.pixels?.after.whole.pct ?? 0,
    reloadPct: r.pixels?.reload.whole.pct ?? 0,
    outsideEditingPct: r.pixels?.editing.outside.pct ?? 0,
    outsideAfterPct: r.pixels?.after.outside.pct ?? 0,
    styleDeltasEditing: r.style?.editing.deltas ?? 0,
    styleDeltasAfter: r.style?.after.deltas ?? 0,
    missingAfter: r.style?.after.missing ?? 0,
    htmlDiffLines: r.html?.diffLines ?? 0,
    hardFailures: r.html?.hardFailures.length ?? 0,
    violations: r.violations.length,
  };
}

// ------------------------------------------------------------------ main ---

interface SlideReport {
  caseId: string;
  slide: number;
  noisePct: number;
  openMutatesContent: boolean;
  targets: number;
  error?: string;
}

async function runCase(
  c: CorpusCase,
  page: Page,
  sheetPage: Page,
  base: string,
  results: ScenarioResult[],
  slides: SlideReport[],
  envelope: Map<string, Set<string>>,
) {
  const payload = {
    title: `[edit-fidelity] ${c.title}`,
    aspectRatio: c.aspectRatio,
    slides: c.slides.map((s, i) => ({
      id: s.id ?? `slide-${i + 1}`,
      content: s.content,
      layout: s.layout,
      notes: s.notes,
    })),
  };
  const created = await action(page, "create-deck", payload);
  const deckId = String(created.id ?? created.deckId);
  const deck = await action(
    page,
    "get-deck",
    { id: deckId, compact: "false" },
    "GET",
  );
  let indices = c.slides.map((_, i) => i);
  if (slideFilter) indices = indices.filter((i) => slideFilter.includes(i + 1));
  indices = indices.slice(0, maxSlides);

  for (const i of indices) {
    const slideId = String(deck.slides[i].id);
    const stored = String(deck.slides[i].content);
    const dir = path.join(outRoot, c.id, `s${pad2(i + 1)}`);
    mkdirSync(dir, { recursive: true });
    const report: SlideReport = {
      caseId: c.id,
      slide: i + 1,
      noisePct: 0,
      openMutatesContent: false,
      targets: 0,
    };
    slides.push(report);
    try {
      // Noise floor: the same slide rendered twice with no edit.
      const { a, noise } = await retryTransient(async () => {
        await restoreSlide(page, deckId, slideId, stored);
        await openSlide(page, base, deckId, i, slideId);
        const a = await shot(page, slideId);
        await openSlide(page, base, deckId, i, slideId);
        const b = await shot(page, slideId);
        return { a, noise: await diffPngs(a, b) };
      });
      report.noisePct = noise.pct;
      writeFileSync(path.join(dir, "view.png"), a);
      writeFileSync(path.join(dir, "noise-diff.png"), noise.png);
      report.openMutatesContent =
        (await getSlideContent(page, deckId, slideId)) !== stored;

      const limit = c.targets?.[String(i)] ?? maxTargets;
      let targets = await listTargets(page, slideId);
      writeFileSync(
        path.join(dir, "targets.json"),
        JSON.stringify(targets, null, 2),
      );
      if (targetFilter)
        targets = targets.filter((t) => targetFilter.includes(t.index));
      targets = targets.slice(0, limit);
      report.targets = targets.length;
      const ctx: SlideCtx = {
        page,
        sheetPage,
        base,
        caseId: c.id,
        deckId,
        slideIndex: i,
        slideId,
        stored,
        noisePct: noise.pct,
        dir,
      };
      const expected = new Set<string>();
      envelope.set(`${c.id}/s${pad2(i + 1)}`, expected);
      for (let t = 0; t < limit; t++) expected.add(`t${pad2(t)}`);
      for (const target of targets) {
        for (const scenario of scenarios) {
          let r = await runScenario(ctx, target, scenario);
          if (r.status === "error" && TRANSIENT.test(r.error ?? "")) {
            const first = r.error;
            r = await runScenario(ctx, target, scenario);
            r.retriedAfter = first;
          }
          results.push(r);
          console.log(formatRow(r));
        }
      }
    } catch (error) {
      report.error = String((error as Error).message ?? error).slice(0, 500);
      console.error(`[edit-fidelity] ${c.id} slide ${i + 1}: ${report.error}`);
    }
  }
}

/**
 * Vite's dep optimizer full-reloads every open page when a slide pulls in a
 * dependency it has not seen yet; that kills whatever step was running.
 * Retried once, and the first error is kept on the result.
 */
const TRANSIENT =
  /Execution context was destroyed|canvas not found|frame was detached|Target page, context or browser has been closed|net::ERR_ABORTED/;

async function retryTransient<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!TRANSIENT.test(String((error as Error).message ?? error))) throw error;
    return fn();
  }
}

function formatRow(r: ScenarioResult): string {
  const p = r.pixels;
  const cols = [
    r.caseId.slice(0, 28).padEnd(28),
    `s${pad2(r.slide)}`,
    `t${pad2(r.target)}`,
    r.scenario.padEnd(10),
    r.status.padEnd(7),
    (p ? `${p.editing.whole.pct}` : "-").padStart(7),
    (p ? `${p.after.whole.pct}` : "-").padStart(7),
    (p ? `${p.reload.whole.pct}` : "-").padStart(7),
    (r.style
      ? `${r.style.editing.deltas}/${r.style.after.deltas}`
      : "-"
    ).padStart(7),
    (r.html
      ? r.html.canonicalEqual
        ? "equal"
        : `${r.html.diffLines}L${r.html.hardFailures.length ? "!" : ""}`
      : "-"
    ).padStart(7),
    String(r.violations.length).padStart(4),
    r.error
      ? r.error.split("\n")[0].slice(0, 60)
      : (r.violations[0] ?? "").slice(0, 60),
  ];
  return cols.join(" ");
}

const HEADER = [
  "case".padEnd(28),
  "sl ",
  "tg ",
  "scenario".padEnd(10),
  "status ",
  "edit%".padStart(7),
  "after%".padStart(7),
  "reload%".padStart(7),
  "styleΔ".padStart(7),
  "html".padStart(7),
  "viol".padStart(4),
  "first problem",
].join(" ");

async function main() {
  const cases = loadCorpus();
  mkdirSync(outRoot, { recursive: true });

  let base = process.env.SLIDES_BASE_URL;
  let stopServer: (() => Promise<void>) | null = null;
  if (base) {
    let host: string;
    try {
      host = new URL(base).hostname;
    } catch {
      fatal(`SLIDES_BASE_URL is not a URL: ${base}`);
    }
    if (!LOCAL_HOSTS.has(host)) {
      fatal(
        `SLIDES_BASE_URL must be localhost; refusing ${base} (this harness writes decks)`,
      );
    }
    base = base.replace(/\/$/, "");
  } else {
    console.log("[edit-fidelity] starting a scratch dev server …");
    const server = await startServer();
    base = server.base;
    stopServer = server.stop;
  }
  const cleanup = async () => {
    if (stopServer) await stopServer();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void cleanup().then(() => process.exit(2)));
  }

  const playwright: any = await import(resolvePnpmEntry("playwright", "1.63"));
  const chromium = pick<any>(playwright, "chromium");
  const browser = await chromium.launch({ headless: !headed });
  const results: ScenarioResult[] = [];
  const slides: SlideReport[] = [];
  const envelope = new Map<string, Set<string>>();
  let exitCode = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    // tsx compiles with keepNames; the page has no __name helper.
    await context.addInitScript("globalThis.__name ||= (fn) => fn;");
    await context.addInitScript(installInPageHelpers, CHROME_SELECTOR);

    const warm = await context.newPage();
    await warm.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await ensureSignedIn(warm);
    await warmUp(warm, base);
    await warm.close();

    console.log(
      `[edit-fidelity] ${base} · ${cases.length} case(s) · scenarios ${scenarios.join(",")} · out ${outRoot}`,
    );
    console.log(HEADER);
    const queue = [...cases];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
        const page = await context.newPage();
        const sheetPage = await browser.newPage();
        await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
        for (let c = queue.shift(); c; c = queue.shift()) {
          try {
            await runCase(c, page, sheetPage, base!, results, slides, envelope);
          } catch (error) {
            slides.push({
              caseId: c.id,
              slide: 0,
              noisePct: 0,
              openMutatesContent: false,
              targets: 0,
              error: String((error as Error).message ?? error),
            });
            console.error(
              `[edit-fidelity] ${c.id}: ${(error as Error).message}`,
            );
          }
        }
        await page.close();
        await sheetPage.close();
      }),
    );
  } finally {
    await browser.close();
    await cleanup();
  }

  // ---- report
  const byKey = new Map(results.map((r) => [r.key, r.metrics!]));
  const baseline: Record<string, BaselineEntry> = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, "utf8"))
    : {};
  const isExpected = (key: string) => {
    const [caseId, slide, target, scenario] = key.split("/");
    return (
      !!envelope.get(`${caseId}/${slide}`)?.has(target) &&
      scenarios.includes(scenario as Scenario) &&
      (!targetFilter || targetFilter.includes(Number(target.slice(1))))
    );
  };
  const problems = findBaselineProblems(byKey, baseline, isExpected);
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\nnoise floor (view vs reload, no edit):");
  for (const s of slides) {
    console.log(
      `  ${s.caseId} s${pad2(s.slide)}: ${s.noisePct}%  targets ${s.targets}${s.openMutatesContent ? "  OPENING THE SLIDE CHANGED ITS STORED CONTENT" : ""}${s.error ? `  ERROR ${s.error}` : ""}`,
    );
  }
  console.log(
    `\n${results.length} scenario(s): ${
      Object.entries(counts)
        .map(([k, n]) => `${n} ${k}`)
        .join(", ") || "none"
    }`,
  );

  if (update && results.length) {
    const next = { ...baseline };
    for (const r of results) next[r.key] = toBaselineEntry(r.metrics!);
    const sorted = Object.fromEntries(
      Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(
      `baseline updated: ${baselinePath} (${results.length} entries written)`,
    );
  } else if (problems.length) {
    console.log(`\n${problems.length} regression(s) against ${baselinePath}:`);
    for (const p of problems) console.log(`  ${p}`);
    exitCode = 1;
  }

  writeFileSync(
    path.join(outRoot, "summary.json"),
    JSON.stringify(
      {
        base,
        corpusDir,
        baselinePath,
        scenarios,
        counts,
        slides,
        problems,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`summary: ${path.join(outRoot, "summary.json")}`);

  const slideErrors = slides.filter((s) => s.error).length;
  if (!results.length) {
    console.error("[edit-fidelity] could not run: no scenario ran");
    return 2;
  }
  if (slideErrors && !update) exitCode = Math.max(exitCode, 1);
  return exitCode;
}

/** Load the editor chunks once so Vite's optimize-dep reload happens here. */
async function warmUp(page: Page, base: string) {
  const created = await action(page, "create-deck", {
    title: "[edit-fidelity] warm-up",
    slides: [
      { id: "warm-1", content: '<div class="fmd-slide"><p>Warm up</p></div>' },
    ],
  });
  const deckId = String(created.id ?? created.deckId);
  await openSlide(page, base, deckId, 0, "warm-1");
  const [target] = await listTargets(page, "warm-1");
  if (target && (await enterEdit(page, "warm-1", target.point))) {
    await exitEdit(page, "warm-1", "escape");
  }
  await openSlide(page, base, deckId, 0, "warm-1");
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(
      `[edit-fidelity] could not run: ${(error as Error).stack ?? error}`,
    );
    process.exit(2);
  },
);
