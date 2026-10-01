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

import { parse, type DefaultTreeAdapterTypes as P5 } from "parse5";

import { IN_PLACE_TEXT_UNDO_LIMIT } from "../../app/components/editor/in-place-text-session.ts";
import {
  pick,
  resolvePnpmEntry,
  WORKTREE_ROOT,
} from "../export-fidelity/resolve-pkg.ts";
import {
  assertAuthoringPersistence,
  canonicalizeAuthoringFuzzPersistence,
  runAuthoringFuzz,
  type AuthoringFuzzPersistence,
} from "./authoring-fuzz.ts";
import {
  CHROME_SELECTOR,
  installInPageHelpers,
  MASK_CSS,
  type EditorState,
  type KeepaliveWrite,
  type Rect,
  type Snapshot,
  type TextTarget,
} from "./lib/in-page.ts";
import {
  diffPngs,
  diffSnapshots,
  followsCenteredFlexReflow,
  findBaselineProblems,
  hardFailures,
  isDraftRevert,
  isSplicedOnce,
  keepaliveMismatches,
  lineDiff,
  orphanedBaselineKeys,
  padRect,
  ratchetBaselineEntry,
  resized,
  restyledAddedText,
  slideContentsOf,
  stripSpace,
  visibleTextOf,
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
  "--browser",
  "--resume",
  "--cpu-throttle",
  "--seed",
  "--steps",
  "--seeds",
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
const resumeRun = opt("--resume");
const resume = resumeRun !== undefined;
const runName =
  opt("--run") ?? resumeRun ?? new Date().toISOString().replace(/[:.]/g, "-");
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
const cpuThrottle = numOpt("--cpu-throttle", 1);
const update = argv.includes("--update");
const acceptFailing = argv.includes("--accept-failing");
const headed = argv.includes("--headed");
const typingChatOnly = argv.includes("--typing-chat");
const imeEscapeOnly = argv.includes("--ime-escape");
const textSurfaceQaOnly = argv.includes("--text-surface-qa");
const lineStartKey = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";
const lineEndKey = process.platform === "darwin" ? "Meta+ArrowRight" : "End";
const authoringOnly = argv.includes("--authoring");
const authoringCorpusOnly = argv.includes("--authoring-corpus");
const authoringFuzzOnly = argv.includes("--authoring-fuzz");
const fuzzSeed = Number(opt("--seed") ?? 1);
if (!Number.isSafeInteger(fuzzSeed) || fuzzSeed < 0) {
  fatal(`--seed expects a non-negative safe integer, got ${opt("--seed")}`);
}
const fuzzSteps = numOpt("--steps", 500);
const fuzzSeeds = numOpt("--seeds", 1);
if (fuzzSeed + fuzzSeeds - 1 > Number.MAX_SAFE_INTEGER) {
  fatal("--seed plus --seeds exceeds the safe integer range");
}
const browserName = opt("--browser") ?? "chromium";
if (!["chromium", "webkit", "firefox"].includes(browserName)) {
  fatal(`--browser expects chromium, webkit, or firefox, got ${browserName}`);
}
if (
  browserName !== "chromium" &&
  !textSurfaceQaOnly &&
  !authoringOnly &&
  !authoringCorpusOnly &&
  !authoringFuzzOnly
) {
  fatal(
    "--browser webkit|firefox is supported with --authoring, --authoring-corpus, --authoring-fuzz, or --text-surface-qa",
  );
}
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
interface ExpectedStyle {
  /** 0-based slide index. */
  slide: number;
  selector: string;
  property: string;
  value: string;
}
interface CorpusCase {
  id: string;
  title: string;
  notes?: string;
  aspectRatio?: string;
  slides: CorpusSlide[];
  targets?: Record<string, number>;
  /** Computed styles that must hold on a fresh load and after reload. */
  expectStyles?: ExpectedStyle[];
}

interface CorpusAuthoringSource {
  id: string;
  kind:
    | "absolute"
    | "flex-grid"
    | "styled-list"
    | "styled-flex-bullet-row"
    | "styled-paragraph-bullet-row"
    | "scaled"
    | "largest";
  testTarget: "absolute" | "flex-grid" | "list" | "bullet-row" | "any";
  corpusCase: CorpusCase;
  slide: CorpusSlide;
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

function corpusAuthoringSources(cases: CorpusCase[]): CorpusAuthoringSource[] {
  const allSlides = cases.flatMap((corpusCase) =>
    corpusCase.slides.map((slide) => ({ corpusCase, slide })),
  );
  const eligible = allSlides.filter(
    ({ slide }) =>
      // Keep blob-bearing imports out of authoring decks in the scratch database.
      !/data:/i.test(slide.content) &&
      Buffer.byteLength(slide.content, "utf8") <= 512_000,
  );
  const orderedEligible = [...eligible].sort(
    (a, b) =>
      Number(a.slide.content.toLowerCase().includes("<style")) -
        Number(b.slide.content.toLowerCase().includes("<style")) ||
      Buffer.byteLength(a.slide.content, "utf8") -
        Buffer.byteLength(b.slide.content, "utf8"),
  );
  const find = (predicate: (content: string) => boolean) =>
    orderedEligible.find(({ slide }) => predicate(slide.content));
  const inlineStyles = (content: string) =>
    Array.from(
      content.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi),
      (match) => match[1] ?? match[2] ?? "",
    );
  const hasAbsoluteTextBox = (content: string, expectedClass: string) => {
    const visit = (node: P5.Node): boolean => {
      if (!("childNodes" in node)) return false;
      if ("tagName" in node) {
        const element = node as P5.Element;
        const className =
          element.attrs.find((attribute) => attribute.name === "class")
            ?.value ?? "";
        const style =
          element.attrs.find((attribute) => attribute.name === "style")
            ?.value ?? "";
        if (
          className.split(/\s+/).includes(expectedClass) &&
          /position\s*:\s*absolute\b/i.test(style) &&
          visibleTextOf(element).trim()
        ) {
          return true;
        }
      }
      return (node as P5.ParentNode).childNodes.some(visit);
    };
    return parse(content).childNodes.some(visit);
  };
  const absolute =
    find((content) => hasAbsoluteTextBox(content, "fmd-pptx-text")) ??
    find((content) => hasAbsoluteTextBox(content, "fmd-text-box"));
  const flexGrid = find((content) => {
    if (/text-transform\s*:\s*uppercase\b/i.test(content)) return false;
    const styles = inlineStyles(content);
    return (
      styles.some((style) => /display\s*:\s*flex\b/i.test(style)) &&
      styles.some(
        (style) =>
          /display\s*:\s*grid\b/i.test(style) &&
          /grid-template-(?:columns|rows)\s*:/i.test(style),
      )
    );
  });
  const styledList = find(
    (content) =>
      /<(?:ul|ol)\b[^>]*\bstyle\s*=/i.test(content) &&
      /<li\b[\s\S]*?(?:<span\b[^>]*\bstyle\s*=|<li\b[^>]*\bstyle\s*=)/i.test(
        content,
      ),
  );
  const styledBulletRows = (content: string) => {
    const rows: { tag: string; flex: boolean; glyph: boolean }[] = [];
    const visit = (node: P5.Node): void => {
      if (!("childNodes" in node)) return;
      if ("tagName" in node) {
        const element = node as P5.Element;
        if (/^(?:div|li|p)$/i.test(element.tagName)) {
          const marker = element.childNodes.find(
            (child) => "tagName" in child,
          ) as P5.Element | undefined;
          if (marker?.tagName === "span") {
            const markerText = visibleTextOf(marker).trim();
            const style =
              marker.attrs.find((attribute) => attribute.name === "style")
                ?.value ?? "";
            const glyphMarker = /^[-*•●◦▪‣·⁃–—]+$/u.test(markerText);
            const width = Number(
              /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)(?:px)?/i.exec(style)?.[1],
            );
            const height = Number(
              /(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)(?:px)?/i.exec(style)?.[1],
            );
            const shapeMarker =
              !markerText &&
              width > 0 &&
              width <= 48 &&
              height > 0 &&
              height <= 48 &&
              width / height >= 0.5 &&
              width / height <= 2 &&
              /(?:border|background|border-radius)\s*:/i.test(style);
            const rowText = visibleTextOf(element).trim();
            if (
              (glyphMarker && rowText.slice(markerText.length).trim()) ||
              (shapeMarker && rowText)
            ) {
              rows.push({
                tag: element.tagName.toLowerCase(),
                glyph: glyphMarker || shapeMarker,
                flex: /display\s*:\s*flex\b/i.test(
                  element.attrs.find((attribute) => attribute.name === "style")
                    ?.value ?? "",
                ),
              });
            }
          }
        }
      }
      (node as P5.ParentNode).childNodes.forEach(visit);
    };
    parse(content).childNodes.forEach(visit);
    return rows;
  };
  const styledFlexBulletRow = find((content) =>
    styledBulletRows(content).some(
      (row) => row.tag === "div" && row.flex && row.glyph,
    ),
  );
  const styledParagraphBulletRow = find((content) =>
    styledBulletRows(content).some((row) => row.tag === "p" && row.glyph),
  );
  const selected = [
    absolute,
    flexGrid,
    styledList,
    styledFlexBulletRow,
    styledParagraphBulletRow,
  ].filter(Boolean);
  const scaled =
    orderedEligible.find(
      (entry) =>
        !selected.some((candidate) => candidate === entry) &&
        entry.slide.content.length > 200 &&
        /<(?:div|p|h[1-4]|li)\b/i.test(entry.slide.content),
    ) ?? selected[0];
  const largestEntry = [...allSlides].sort(
    (a, b) =>
      Buffer.byteLength(b.slide.content, "utf8") -
      Buffer.byteLength(a.slide.content, "utf8"),
  )[0];
  const largest = largestEntry
    ? {
        ...largestEntry,
        slide: {
          ...largestEntry.slide,
          // Preserve source geometry but never store embedded image bytes in SQL.
          content: largestEntry.slide.content.replace(
            /data:[^"'\s)<>]+/gi,
            "about:blank",
          ),
        },
      }
    : undefined;
  const required: Array<
    [
      CorpusAuthoringSource["kind"],
      CorpusAuthoringSource["testTarget"],
      { corpusCase: CorpusCase; slide: CorpusSlide } | undefined,
    ]
  > = [
    ["absolute", "absolute", absolute],
    ["flex-grid", "flex-grid", flexGrid],
    ["styled-list", "list", styledList],
    ["styled-flex-bullet-row", "bullet-row", styledFlexBulletRow],
    ["styled-paragraph-bullet-row", "bullet-row", styledParagraphBulletRow],
    ["scaled", "any", scaled],
    ["largest", "any", largest],
  ];
  const missing = required
    .filter(([, , source]) => !source)
    .map(([kind]) => kind);
  if (missing.length) {
    throw new CouldNotRun(
      `authoring corpus lacks safe source slides for: ${missing.join(", ")}`,
    );
  }
  return required.map(([kind, testTarget, source]) => ({
    id: kind,
    kind,
    testTarget,
    corpusCase: source!.corpusCase,
    slide: source!.slide,
  }));
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
  method: "DELETE" | "GET" | "POST" = "POST",
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
  if (!res.ok) throw new Error(`${name} returned HTTP ${res.status}`);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(`${name} returned a non-JSON response`);
  }
}

async function getSlideState(page: Page, deckId: string, slideId: string) {
  const deck = await action(
    page,
    "get-deck",
    { id: deckId, slideId, compact: "false" },
    "GET",
  );
  const slide = deck.slides?.find((s: any) => s.id === slideId);
  if (!slide || typeof slide.contentHash !== "string") {
    throw new Error(`get-deck returned no hashed slide ${slideId}`);
  }
  return { content: String(slide.content), contentHash: slide.contentHash };
}

async function getSlideContent(page: Page, deckId: string, slideId: string) {
  return (await getSlideState(page, deckId, slideId)).content;
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
    // The renderer injects a webfont stylesheet per slide font, and a face
    // starts loading only once text using it lays out, so `fonts.ready` can
    // resolve before the slide's font was even requested (display=swap then
    // paints the fallback). Bounded: an offline stylesheet never loads.
    const frame = () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Imported-font stylesheets are appended by a passive effect after render.
    await frame();
    for (let i = 0; i < 20; i++) {
      await document.fonts.ready;
      await frame();
      const sheetPending = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      ).some((link) => !link.sheet);
      if (!sheetPending && document.fonts.status === "loaded") break;
      await new Promise((r) => setTimeout(r, 100));
    }
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
    try {
      await page.goto(`${base}/deck/${deckId}?slide=${index + 1}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await page.waitForSelector(canvasSelector(slideId), { timeout: 45_000 });
      break;
    } catch (error) {
      // A first load can 504 "Outdated Optimize Dep" and full-reload, and a
      // loaded dev server can miss the navigation deadline.
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
  violations: string[],
) {
  const editing = async () => (await editorState(page, slideId)).editing;
  const gestures: Array<[string, () => Promise<void>]> = [
    ["click", () => page.mouse.click(point.x, point.y)],
    ["click-click", () => page.mouse.click(point.x, point.y)],
    ["dblclick", () => page.mouse.dblclick(point.x, point.y)],
  ];
  for (const [name, gesture] of gestures) {
    await gesture();
    if (!(await waitFor(editing, 900))) continue;
    // Checked before a double-click's word selection is collapsed: the
    // editor must open where the user pressed, not wherever it parks a caret.
    const entry = await page.evaluate(
      ([p, how]: readonly [{ x: number; y: number }, string]) =>
        window.__editFidelity.entryCaretProblem(p, how),
      [point, name] as const,
    );
    // Some engines leave a click-aligned caret instead of selecting a word.
    const caretFallback =
      entry && name === "dblclick"
        ? await page.evaluate(
            (p: { x: number; y: number }) =>
              window.__editFidelity.entryCaretProblem(p, "click"),
            point,
          )
        : null;
    if (entry && caretFallback)
      violations.push(
        `entering edit put the caret away from the click (${caretFallback})`,
      );
    // A double-click enters edit with its word selected, and typing would
    // replace that word; every scenario edits at a caret.
    if (name === "dblclick") {
      await page.evaluate(() => window.getSelection()?.collapseToStart());
    }
    return name;
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

async function runChatTypingRegression(page: Page, base: string) {
  const problems: string[] = [];
  const submitRoute = /\/_agent-native\/agent-chat(?:\?.*)?$/;
  let submitRequestSeen = false;
  let resolveSubmitRequested!: () => void;
  let releaseSubmit!: () => void;
  let resolveSubmitRouteFinished!: () => void;
  const submitRequested = new Promise<void>((resolve) => {
    resolveSubmitRequested = resolve;
  });
  const submitGate = new Promise<void>((resolve) => {
    releaseSubmit = resolve;
  });
  const submitRouteFinished = new Promise<void>((resolve) => {
    resolveSubmitRouteFinished = resolve;
  });
  await page.route("**/_agent-native/agent-engine/status", (route: any) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, chatEligible: true }),
    }),
  );
  await page.route(submitRoute, async (route: any) => {
    if (route.request().method() !== "POST") return route.continue();
    submitRequestSeen = true;
    resolveSubmitRequested();
    try {
      await submitGate;
      await route.abort();
    } finally {
      resolveSubmitRouteFinished();
    }
  });
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await ensureSignedIn(page);
  const initialSelection = await page.evaluate(async () => {
    const target = document.createElement("div");
    target.style.cssText =
      "position:fixed;left:-10000px;top:0;pointer-events:none";
    target.textContent = "abc def";
    document.body.append(target);
    const text = target.firstChild as Text;
    const selection = window.getSelection();
    selection?.setBaseAndExtent(text, 6, text, 1);
    const source = "/app/components/editor/in-place-text-session.ts";
    const { startInPlaceTextSession } = await import(source);
    const session = startInPlaceTextSession(target);
    const result = {
      anchor: selection?.anchorOffset,
      focus: selection?.focusOffset,
      text: selection?.toString(),
    };
    session.end();
    selection?.removeAllRanges();
    target.remove();
    return result;
  });
  if (
    initialSelection.text !== "bc de" ||
    initialSelection.anchor !== 6 ||
    initialSelection.focus !== 1
  ) {
    problems.push(
      `entering edit changed an initial backward selection (${JSON.stringify(initialSelection)})`,
    );
  }
  const created = await action(page, "create-deck", {
    title: "[edit-fidelity] chat typing regression",
    slides: [
      {
        id: "chat-typing-slide",
        content:
          '<div class="fmd-slide"><p>Slide text edit stays open</p></div>',
      },
    ],
  });
  const deckId = String(created.id ?? created.deckId);
  try {
    await openSlide(page, base, deckId, 0, "chat-typing-slide");
    const [target] = await listTargets(page, "chat-typing-slide");
    if (!target) throw new Error("synthetic slide has no editable text target");
    if (!(await enterEdit(page, "chat-typing-slide", target.point, []))) {
      throw new Error("could not open the synthetic slide text edit session");
    }

    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("agent-panel:open", { detail: { focus: true } }),
      ),
    );
    const selector =
      '.agent-sidebar-panel[data-agent-sidebar-state="open"] [data-agent-composer-slot="editor-input"]';
    const composer = page.locator(selector);
    await composer.waitFor({ state: "visible", timeout: 45_000 });
    if (!(await editorState(page, "chat-typing-slide")).editing) {
      throw new Error(
        "opening the Agent sidebar ended the slide text edit session",
      );
    }
    await page.waitForFunction(
      (inputSelector: string) =>
        document
          .querySelector<HTMLElement>(inputSelector)
          ?.getAttribute("contenteditable") === "true",
      selector,
      { timeout: 20_000 },
    );
    await composer.focus();

    await composer.evaluate((element: HTMLElement) => {
      (window as any).__typingRegressionComposer = element;
    });

    const first = "Fast typing should keep every character in order.";
    const second = " A pause must not reset the caret either.";
    await composer.pressSequentially(first);
    await sleep(400);
    await composer.pressSequentially(second);

    const expected = first + second;
    const result = await page.evaluate((selector: string) => {
      const editor = document.querySelector<HTMLElement>(selector);
      const selection = window.getSelection();
      const focusNode = selection?.focusNode;
      return {
        text: editor?.innerText ?? null,
        sameNode: editor === (window as any).__typingRegressionComposer,
        focused: document.activeElement === editor,
        caretOffset:
          editor && focusNode && editor.contains(focusNode)
            ? (selection?.focusOffset ?? null)
            : null,
      };
    }, selector);
    const editAfterTyping = await editorState(page, "chat-typing-slide");
    if (result.text !== expected) {
      problems.push(`text mismatch: ${JSON.stringify(result.text)}`);
    }
    if (!result.sameNode) problems.push("composer remounted while typing");
    if (!result.focused) problems.push("composer lost focus while typing");
    if (result.caretOffset !== expected.length) {
      problems.push(
        `caret ended at ${result.caretOffset}, expected ${expected.length}`,
      );
    }
    if (!editAfterTyping.editing) {
      problems.push("slide text edit session ended while typing in chat");
    }

    await composer.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await composer.press("Backspace");
    await composer.pressSequentially(
      "Reply only with: local chat input lock check complete. Do not edit the deck.",
    );
    const sendButton = page.locator('[data-agent-composer-slot="send-button"]');
    if (!(await sendButton.isEnabled())) {
      problems.push("chat send button was disabled before submission");
    } else {
      await sendButton.click();
      const requestStarted = await Promise.race([
        submitRequested.then(() => true),
        sleep(10_000).then(() => false),
      ]);
      if (!requestStarted) {
        problems.push("chat submission did not reach the chat request");
      } else {
        if ((await composer.getAttribute("contenteditable")) !== "true") {
          problems.push(
            "chat editor was disabled while submission was pending",
          );
        }
        const pendingDraft = "Draft typed while the first send is pending.";
        try {
          await composer.pressSequentially(pendingDraft, { delay: 100 });
        } catch {
          problems.push(
            "keyboard input was rejected while submission was pending",
          );
        }
        await sleep(250);
        if ((await composer.getAttribute("contenteditable")) !== "true") {
          problems.push("chat editor became disabled while typing was pending");
        }
        const pendingText = await composer.innerText();
        if (pendingText !== pendingDraft) {
          problems.push(
            `pending draft mismatch: ${JSON.stringify(pendingText)}`,
          );
        }
        if (await sendButton.isEnabled()) {
          problems.push("chat send button stayed enabled during submission");
        }
        await page.screenshot({
          path: path.join(outRoot, "chat-input-lock-pending.png"),
        });
      }
    }
    return problems;
  } finally {
    releaseSubmit();
    if (submitRequestSeen) {
      const routeDrained = await Promise.race([
        submitRouteFinished.then(() => true),
        sleep(5000).then(() => false),
      ]);
      if (routeDrained) await page.unroute(submitRoute);
    }
    // Keep interception installed if preflight timed out; the delayed send must not escape.
    await action(page, "delete-deck", { id: deckId }, "DELETE");
  }
}

async function runImeEscapeRegression(
  page: Page,
  base: string,
  outRoot: string,
) {
  await page.addInitScript(() => {
    const events: any[] = [];
    (window as any).__imeEscapeEvents = events;
    for (const type of [
      "compositionstart",
      "beforeinput",
      "input",
      "compositionend",
      "keydown",
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const input = event as InputEvent;
          const key = event as KeyboardEvent;
          events.push({
            type,
            key: key.key,
            keyCode: key.keyCode,
            data: input.data,
            inputType: input.inputType,
            isComposing: input.isComposing,
            trusted: event.isTrusted,
            targetIsEditingBlock:
              event.target instanceof Element &&
              event.target.matches(
                '[contenteditable="true"][data-editing-block="true"]',
              ),
          });
        },
        true,
      );
    }
  });
  await page.route("**/_agent-native/agent-engine/status", (route: any) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, chatEligible: true }),
    }),
  );
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await ensureSignedIn(page);
  const slideId = "ime-escape-slide";
  const created = await action(page, "create-deck", {
    title: "[edit-fidelity] IME Escape regression",
    slides: [
      {
        id: slideId,
        content: '<div class="fmd-slide"><p>Composition target</p></div>',
      },
    ],
  });
  const deckId = String(created.id ?? created.deckId);
  let detach: (() => Promise<void>) | undefined;
  try {
    await openSlide(page, base, deckId, 0, slideId);
    const [target] = await listTargets(page, slideId);
    if (!target) throw new Error("synthetic slide has no editable text target");
    const entryProblems: string[] = [];
    if (!(await enterEdit(page, slideId, target.point, entryProblems))) {
      throw new Error("could not open the synthetic slide text edit session");
    }
    const selector = `${canvasSelector(slideId)} [contenteditable="true"][data-editing-block="true"]`;
    const editor = page.locator(selector);
    await editor.focus();
    await page.keyboard.press(lineEndKey);
    const cdp = await page.context().newCDPSession(page);
    detach = () => cdp.detach();
    await cdp.send("Input.imeSetComposition", {
      text: "に",
      selectionStart: 1,
      selectionEnd: 1,
    });
    const composingText = await editor.innerText();
    await page.screenshot({
      path: path.join(outRoot, "ime-composition-active.png"),
    });
    await page.keyboard.press("Escape");
    const editingAfterComposingEscape = await editorState(page, slideId);
    if (!editingAfterComposingEscape.editing) {
      throw new Error(
        "Escape during IME composition exited inline text editing",
      );
    }
    // Headless Chromium has no platform IME to consume Escape. Cancel through
    // the same CDP input domain after checking that Escape left editing active.
    await cdp.send("Input.imeSetComposition", {
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    await waitFor(
      () =>
        page.evaluate(() =>
          (window as any).__imeEscapeEvents.some(
            (event: any) =>
              event.type === "compositionend" && event.targetIsEditingBlock,
          ),
        ),
      2000,
    );
    await sleep(100);
    const editState = await editorState(page, slideId);
    const afterEscapeText = await page
      .locator(`${canvasSelector(slideId)} [data-slide-text-block="true"]`)
      .first()
      .innerText();
    const events = await page.evaluate(() => (window as any).__imeEscapeEvents);
    const editorEvents = events.filter(
      (event: any) => event.targetIsEditingBlock,
    );
    const escape = editorEvents.find(
      (event: any) => event.type === "keydown" && event.key === "Escape",
    );
    const problems = [...entryProblems];
    if (
      !editorEvents.some(
        (event: any) => event.type === "compositionstart" && event.trusted,
      )
    ) {
      problems.push(
        "Chromium did not deliver a trusted compositionstart event",
      );
    }
    if (
      !editorEvents.some(
        (event: any) =>
          event.type === "beforeinput" &&
          event.inputType === "insertCompositionText" &&
          event.isComposing &&
          event.trusted,
      )
    ) {
      problems.push("Chromium did not deliver trusted composing beforeinput");
    }
    if (!escape?.isComposing && escape?.keyCode !== 229) {
      problems.push(
        "Escape was not delivered while Chromium reported composition active",
      );
    }
    if (!events.some((event: any) => event.type === "compositionend")) {
      problems.push("composition Escape did not end the active composition");
    }
    if (!composingText.endsWith("に")) {
      problems.push(
        `IME candidate was not visible in the editor: ${JSON.stringify(composingText)}`,
      );
    }
    if (!editState.editing || !editingAfterComposingEscape.editing) {
      problems.push("Escape during IME composition exited inline text editing");
    }
    if (afterEscapeText !== "Composition target") {
      problems.push(
        `composing Escape did not cancel the candidate: ${JSON.stringify(afterEscapeText)}`,
      );
    }
    await page.screenshot({
      path: path.join(outRoot, "ime-composition-after-escape.png"),
    });
    if (editState.editing) {
      await page.keyboard.press("Escape");
      if (
        !(await waitFor(
          async () => !(await editorState(page, slideId)).editing,
          5000,
        ))
      ) {
        problems.push(
          "a non-composing Escape did not exit inline text editing",
        );
      }
    }
    return problems;
  } finally {
    try {
      await detach?.();
    } finally {
      await action(page, "delete-deck", { id: deckId }, "DELETE");
    }
  }
}

async function runTextSurfaceQa(page: Page, base: string, browserName: string) {
  const problems: string[] = [];
  const usesChromiumIme = browserName === "chromium";
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const normalizeText = (text: string) =>
    text
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const slideText = (html: string) =>
    page.evaluate((content: string) => {
      const element = document.createElement("div");
      element.innerHTML = content;
      for (const lineBreak of element.querySelectorAll("br")) {
        lineBreak.replaceWith(" ");
      }
      element.style.cssText = "position:fixed;left:-100000px;top:0";
      document.body.append(element);
      try {
        return element.innerText;
      } finally {
        element.remove();
      }
    }, html);
  const slideOne = "text-surface-slide-one";
  const slideTwo = "text-surface-slide-two";
  if (browserName === "chromium") {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: new URL(base).origin,
      });
  }
  await page.route("**/_agent-native/agent-engine/status", (route: any) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, chatEligible: true }),
    }),
  );
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await ensureSignedIn(page);
  const blockText = await slideText("<p>First<br>line</p><p>Second</p>");
  if (normalizeText(blockText) !== "First line Second") {
    problems.push(
      `slide text: saved block markup produced ${JSON.stringify(blockText)}`,
    );
  }
  const title = `[edit-fidelity] text surface QA ${Date.now()}`;
  const created = await action(page, "create-deck", {
    title,
    slides: [
      {
        id: slideOne,
        content: '<div class="fmd-slide"><p>Rapid typing target</p></div>',
      },
      {
        id: slideTwo,
        content: '<div class="fmd-slide"><p>Second slide target</p></div>',
      },
    ],
  });
  const deckId = String(created.id ?? created.deckId);
  const readDeck = () =>
    action<any>(page, "get-deck", { id: deckId, compact: "false" }, "GET");
  const surfaceText = (locator: any) => locator.inputValue();
  const waitForText = (locator: any, expected: string) =>
    waitFor(async () => (await surfaceText(locator)) === expected, 4000, 50);
  const emitComposition = async (
    locator: any,
    type:
      | "compositionstart"
      | "compositionupdate"
      | "compositionend"
      | "beforeinput",
    data: string,
  ) =>
    locator.evaluate(
      (element: HTMLElement, event: { type: string; data: string }) => {
        const input = new InputEvent(event.type, {
          bubbles: true,
          cancelable: event.type === "beforeinput",
          data: event.data,
          inputType:
            event.type === "beforeinput" ? "insertCompositionText" : "",
          isComposing:
            event.type === "beforeinput" || event.type !== "compositionend",
        });
        if (event.type.startsWith("composition")) {
          element.dispatchEvent(
            new CompositionEvent(event.type, {
              bubbles: true,
              data: event.data,
            }),
          );
        } else {
          element.dispatchEvent(input);
        }
      },
      { type, data },
    );
  const emitComposingEscape = async (locator: any) =>
    locator.evaluate((element: HTMLElement) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
        code: "Escape",
        isComposing: true,
        keyCode: 229,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  const composingEscape = async (locator: any, label: string) => {
    const cdp = usesChromiumIme
      ? await page.context().newCDPSession(page)
      : null;
    const before = await surfaceText(locator);
    await locator.focus();
    await locator.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement) => {
        element.setSelectionRange(element.value.length, element.value.length);
      },
    );
    await locator.evaluate((element: HTMLElement) => {
      (window as any).__textSurfaceCompositionEvents = [];
      for (const type of [
        "compositionstart",
        "beforeinput",
        "compositionend",
        "keydown",
      ]) {
        element.addEventListener(type, (event) => {
          const input = event as InputEvent;
          const key = event as KeyboardEvent;
          (window as any).__textSurfaceCompositionEvents.push({
            type,
            key: key.key,
            keyCode: key.keyCode,
            data: input.data,
            inputType: input.inputType,
            isComposing: input.isComposing,
            trusted: event.isTrusted,
          });
        });
      }
    });
    if (cdp) {
      await cdp.send("Input.imeSetComposition", {
        text: "に",
        selectionStart: 1,
        selectionEnd: 1,
      });
    } else {
      await emitComposition(locator, "compositionstart", "に");
      await locator.fill(`${before}に`);
      await emitComposition(locator, "beforeinput", "に");
    }
    const candidateVisible = await waitForText(locator, `${before}に`);
    if (!candidateVisible) {
      const failedCandidate = await locator.evaluate(
        (element: HTMLInputElement | HTMLTextAreaElement) => ({
          value: element.value,
          caret: element.selectionStart,
          focused: document.activeElement === element,
        }),
      );
      const events = await page.evaluate(
        () => (window as any).__textSurfaceCompositionEvents ?? [],
      );
      problems.push(
        `${label}: Chromium did not show the active IME candidate ${JSON.stringify({ before, failedCandidate, events })}`,
      );
      if (cdp) {
        await cdp.send("Input.imeSetComposition", {
          text: "",
          selectionStart: 0,
          selectionEnd: 0,
        });
      } else {
        await locator.fill(before);
        await emitComposition(locator, "compositionend", "");
      }
      await waitFor(
        () =>
          page.evaluate(() =>
            (window as any).__textSurfaceCompositionEvents?.some(
              (event: any) => event.type === "compositionend",
            ),
          ),
        2000,
      );
      await cdp?.detach();
      return await locator.isVisible();
    }
    if (cdp) await locator.press("Escape");
    else await emitComposingEscape(locator);
    const remainsOpen = await locator.isVisible();
    if (!remainsOpen) {
      problems.push(
        `${label}: Escape closed the editor during IME composition`,
      );
      await cdp?.detach();
      return false;
    }
    const escape = await page.evaluate(() =>
      (window as any).__textSurfaceCompositionEvents?.find(
        (event: any) => event.type === "keydown" && event.key === "Escape",
      ),
    );
    if (!escape?.isComposing && escape?.keyCode !== 229) {
      problems.push(`${label}: Escape was not delivered during composition`);
    }
    // Headless Chromium has no platform IME to consume Escape. Cancel through
    // the same CDP input domain after asserting the app left the field mounted.
    if (cdp) {
      await cdp.send("Input.imeSetComposition", {
        text: "",
        selectionStart: 0,
        selectionEnd: 0,
      });
    } else {
      await locator.fill(before);
      await emitComposition(locator, "compositionend", "");
    }
    await waitFor(
      () =>
        page.evaluate(() =>
          (window as any).__textSurfaceCompositionEvents?.some(
            (event: any) => event.type === "compositionend",
          ),
        ),
      2000,
    );
    const after = await surfaceText(locator);
    if (after !== before) {
      problems.push(`${label}: Escape did not cancel the candidate cleanly`);
    }
    const events = await page.evaluate(
      () => (window as any).__textSurfaceCompositionEvents ?? [],
    );
    if (
      !events.some(
        (event: any) =>
          event.type === "compositionstart" &&
          (usesChromiumIme ? event.trusted : !event.trusted),
      ) ||
      !events.some(
        (event: any) =>
          event.type === "beforeinput" &&
          event.isComposing &&
          (usesChromiumIme ? event.trusted : !event.trusted),
      ) ||
      !events.some((event: any) => event.type === "compositionend")
    ) {
      problems.push(`${label}: Escape did not end the active composition`);
    }
    await cdp?.detach();
    return remainsOpen;
  };
  const exerciseControl = async (
    locator: any,
    label: string,
    multiline: boolean,
  ) => {
    await locator.waitFor({ state: "visible", timeout: 10_000 });
    await locator.focus();
    const key = `text-surface-${label}`;
    await locator.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement, ref: string) => {
        (window as any).__textSurfaceRefs ??= {};
        (window as any).__textSurfaceRefs[ref] = element;
        element.setSelectionRange(element.value.length, element.value.length);
      },
      key,
    );
    const start = await surfaceText(locator);
    await page.evaluate(
      (text: string) => navigator.clipboard.writeText(text),
      " paste",
    );
    await locator.press(`${modifier}+V`);
    let expected = `${start} paste`;
    if (!(await waitForText(locator, expected))) {
      problems.push(
        `${label}: native clipboard paste did not land at the caret`,
      );
    }
    await locator.press(`${modifier}+Z`);
    if (!(await waitForText(locator, start))) {
      problems.push(
        `${label}: undo produced ${JSON.stringify(await surfaceText(locator))}, expected ${JSON.stringify(start)}`,
      );
    }
    await locator.press(`${modifier}+Shift+Z`);
    if (!(await waitForText(locator, expected))) {
      problems.push(`${label}: redo did not restore the paste`);
    }
    await locator.press(`${modifier}+Z`);
    if (!(await waitForText(locator, start))) {
      problems.push(`${label}: undo did not restore the pre-paste text`);
    }

    await locator.evaluate((element: HTMLInputElement | HTMLTextAreaElement) =>
      element.setSelectionRange(element.value.length, element.value.length),
    );
    expected = start;
    await locator.pressSequentially(" fast");
    await sleep(600);
    await locator.pressSequentially(" pause");
    expected = `${start} fast pause`;
    if (!(await waitForText(locator, expected))) {
      problems.push(
        `${label}: rapid typing produced ${JSON.stringify(await surfaceText(locator))}, expected ${JSON.stringify(expected)}`,
      );
    }
    if (multiline) {
      await locator.press("Enter");
      await locator.pressSequentially("lineX");
      await locator.press("Backspace");
      await locator.pressSequentially("2");
      expected += "\nline2";
      if (!(await waitForText(locator, expected))) {
        problems.push(
          `${label}: Enter or Backspace produced ${JSON.stringify(await surfaceText(locator))}, expected ${JSON.stringify(expected)}`,
        );
      }
    } else {
      await locator.press("Backspace");
      expected = expected.slice(0, -1);
      await locator.pressSequentially("e");
      expected += "e";
      if (!(await waitForText(locator, expected))) {
        problems.push(
          `${label}: Backspace sequence produced ${JSON.stringify(await surfaceText(locator))}, expected ${JSON.stringify(expected)}`,
        );
      }
    }

    const cdp = usesChromiumIme
      ? await page.context().newCDPSession(page)
      : null;
    await locator.press(lineEndKey);
    if (cdp) {
      await cdp.send("Input.imeSetComposition", {
        text: "に",
        selectionStart: 1,
        selectionEnd: 1,
      });
    } else {
      await emitComposition(locator, "compositionstart", "に");
      await locator.fill(`${expected}に`);
      await emitComposition(locator, "beforeinput", "に");
    }
    if (!(await waitForText(locator, `${expected}に`))) {
      problems.push(`${label}: IME composition did not update the text`);
    }
    if (cdp) {
      await cdp.send("Input.insertText", { text: "日" });
    } else {
      await locator.fill(`${expected}日`);
      await emitComposition(locator, "compositionend", "日");
    }
    expected += "日";
    if (!(await waitForText(locator, expected))) {
      problems.push(`${label}: IME commit changed the text unexpectedly`);
    }
    const state = await locator.evaluate(
      (element: HTMLInputElement | HTMLTextAreaElement, ref: string) => ({
        value: element.value,
        caret: element.selectionStart,
        focused: document.activeElement === element,
        sameNode: element === (window as any).__textSurfaceRefs?.[ref],
      }),
      key,
    );
    if (state.value !== expected)
      problems.push(`${label}: final value did not match the typed text`);
    if (state.caret !== expected.length)
      problems.push(
        `${label}: caret ended at ${state.caret}, expected ${expected.length}`,
      );
    if (!state.focused) problems.push(`${label}: typing lost focus`);
    if (!state.sameNode)
      problems.push(`${label}: input DOM node was replaced while typing`);
    await cdp?.detach();
    return expected;
  };

  try {
    await openSlide(page, base, deckId, 0, slideOne);
    const [target] = await listTargets(page, slideOne);
    if (!target) throw new Error("synthetic slide has no editable text target");
    if (!(await enterEdit(page, slideOne, target.point, []))) {
      throw new Error("could not open the synthetic slide text edit session");
    }
    const editorSelector = `${canvasSelector(slideOne)} [contenteditable="true"][data-editing-block="true"]`;
    const editor = page.locator(editorSelector);
    const original = await editor.innerText();
    await editor.evaluate((element: HTMLElement) => {
      (window as any).__textSurfaceSlideEditor = element;
    });
    await editor.press(lineEndKey);
    await editor.pressSequentially(" fast");
    await sleep(400);
    await editor.pressSequentially(" pause");
    let expectedSlideText = `${original} fast pause`;
    if ((await editor.innerText()) !== expectedSlideText) {
      problems.push(
        "slide text: rapid typing and debounce pause changed the text",
      );
    }
    const beforeCaretKeys = expectedSlideText;
    await editor.press(lineStartKey);
    await editor.pressSequentially("Caret start ");
    expectedSlideText = `Caret start ${beforeCaretKeys}`;
    if ((await editor.innerText()) !== expectedSlideText) {
      problems.push(
        "slide text: line-start key did not put the caret at the line start",
      );
    }
    await editor.press(lineEndKey);
    await editor.pressSequentially(" caret end");
    expectedSlideText += " caret end";
    if ((await editor.innerText()) !== expectedSlideText) {
      problems.push(
        "slide text: line-end key did not put the caret at the line end",
      );
    }
    const titleInput = page
      .locator('[data-slides-editor-root="true"] input[type="text"]')
      .first();
    await titleInput.focus();
    await editor.focus();
    await editor.pressSequentially(" focus");
    expectedSlideText += " focus";
    const afterRefocus = await editor.innerText();
    if (afterRefocus !== expectedSlideText) {
      problems.push(
        `slide text: focus loss and return changed it to ${JSON.stringify(afterRefocus)}`,
      );
    }
    await page.screenshot({
      path: path.join(outRoot, "slide-text-focus-return.png"),
      fullPage: true,
    });
    const backwardsSelection = await editor.evaluate((element: HTMLElement) => {
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Text);
      }
      const pointAt = (offset: number): [Text, number] | null => {
        let remaining = offset;
        for (const node of nodes) {
          if (remaining <= node.length) return [node, remaining];
          remaining -= node.length;
        }
        return null;
      };
      const length = nodes.reduce((total, node) => total + node.length, 0);
      const end = pointAt(length);
      const start = pointAt(length - 5);
      if (!start || !end) return false;
      const [endNode, endOffset] = end;
      const [startNode, startOffset] = start;
      const selection = window.getSelection();
      selection?.setBaseAndExtent(endNode, endOffset, startNode, startOffset);
      return selection?.toString() === "focus";
    });
    if (!backwardsSelection) {
      problems.push(
        "slide text: could not make the backwards selection target",
      );
    } else {
      await titleInput.focus();
      await editor.focus();
      const restoredSelection = await editor.evaluate(
        (element: HTMLElement) => {
          const selection = window.getSelection();
          if (!selection?.anchorNode || !selection.focusNode) return null;
          const offset = (node: Node, nodeOffset: number) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            range.setEnd(node, nodeOffset);
            return range.toString().length;
          };
          return {
            anchor: offset(selection.anchorNode, selection.anchorOffset),
            focus: offset(selection.focusNode, selection.focusOffset),
            text: selection.toString(),
          };
        },
      );
      if (
        !restoredSelection ||
        restoredSelection.anchor <= restoredSelection.focus ||
        restoredSelection.text !== "focus"
      ) {
        problems.push(
          `slide text: refocus changed backwards selection direction (${JSON.stringify(restoredSelection)})`,
        );
      } else {
        await editor.press("Shift+ArrowLeft");
        const extendedSelection = await editor.evaluate(
          (element: HTMLElement) => {
            const selection = window.getSelection();
            if (!selection?.anchorNode || !selection.focusNode) return null;
            const offset = (node: Node, nodeOffset: number) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              range.setEnd(node, nodeOffset);
              return range.toString().length;
            };
            return {
              anchor: offset(selection.anchorNode, selection.anchorOffset),
              focus: offset(selection.focusNode, selection.focusOffset),
              text: selection.toString(),
            };
          },
        );
        if (
          !extendedSelection ||
          extendedSelection.anchor <= extendedSelection.focus ||
          extendedSelection.text !== " focus"
        ) {
          problems.push(
            `slide text: Shift+ArrowLeft did not extend the backwards selection (${JSON.stringify(extendedSelection)})`,
          );
        }
      }
    }
    const clickPoint = await editor.evaluate((element: HTMLElement) => {
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode() as Text | null;
      if (!text || text.length < 4) return null;
      const range = document.createRange();
      range.setStart(text, 2);
      range.setEnd(text, 3);
      const rect = range.getBoundingClientRect();
      return { x: rect.right - 0.5, y: rect.top + rect.height / 2 };
    });
    await titleInput.focus();
    if (clickPoint) {
      await page.mouse.click(clickPoint.x, clickPoint.y);
      const caretOffset = await editor.evaluate((element: HTMLElement) => {
        const selection = window.getSelection();
        const range =
          selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
        if (!range || !element.contains(range.startContainer)) return null;
        const before = document.createRange();
        before.selectNodeContents(element);
        before.setEnd(range.startContainer, range.startOffset);
        return before.toString().length;
      });
      if (caretOffset === null || caretOffset < 1 || caretOffset > 4) {
        problems.push(
          `slide text: pointer re-entry landed at ${caretOffset}, outside the clicked word`,
        );
      }
      await editor.pressSequentially(" click");
      if (caretOffset !== null) {
        const pointerExpected =
          expectedSlideText.slice(0, caretOffset) +
          " click" +
          expectedSlideText.slice(caretOffset);
        const afterPointerClick = await editor.innerText();
        if (afterPointerClick !== pointerExpected) {
          problems.push(
            `slide text: pointer re-entry inserted at the wrong caret (${JSON.stringify(afterPointerClick)})`,
          );
        }
        expectedSlideText = pointerExpected;
      }
    } else {
      problems.push("slide text: could not locate the pointer re-entry target");
    }
    await editor.press(lineEndKey);
    await page.evaluate(
      (text: string) => navigator.clipboard.writeText(text),
      " paste",
    );
    await editor.press(`${modifier}+V`);
    expectedSlideText += " paste";
    if (
      !(await waitFor(
        async () => (await editor.innerText()) === expectedSlideText,
        3000,
      ))
    ) {
      problems.push(
        `slide text: paste produced ${JSON.stringify(await editor.innerText())}`,
      );
    }
    await editor.press(`${modifier}+Z`);
    expectedSlideText = expectedSlideText.slice(0, -6);
    if (
      !(await waitFor(
        async () => (await editor.innerText()) === expectedSlideText,
        3000,
      ))
    ) {
      problems.push(
        `slide text: undo produced ${JSON.stringify(await editor.innerText())}`,
      );
    }
    await editor.press(`${modifier}+Shift+Z`);
    expectedSlideText += " paste";
    if (
      !(await waitFor(
        async () => (await editor.innerText()) === expectedSlideText,
        3000,
      ))
    ) {
      problems.push(
        `slide text: redo produced ${JSON.stringify(await editor.innerText())}`,
      );
    }
    await editor.press(lineEndKey);
    await editor.press("Enter");
    await editor.pressSequentially("lineX");
    await editor.press("Backspace");
    await editor.pressSequentially("2");
    expectedSlideText += "\nline2";
    if (
      !(await waitFor(
        async () => (await editor.innerText()) === expectedSlideText,
        3000,
      ))
    ) {
      problems.push(
        `slide text: Enter/Backspace produced ${JSON.stringify(await editor.innerText())}`,
      );
    }
    const cdp = usesChromiumIme
      ? await page.context().newCDPSession(page)
      : null;
    await editor.press(lineEndKey);
    if (cdp) {
      await cdp.send("Input.imeSetComposition", {
        text: "に",
        selectionStart: 1,
        selectionEnd: 1,
      });
    } else {
      await emitComposition(editor, "compositionstart", "に");
      await editor.pressSequentially("に");
      await emitComposition(editor, "beforeinput", "に");
    }
    if (
      !(await waitFor(
        async () => (await editor.innerText()) === `${expectedSlideText}に`,
        3000,
      ))
    ) {
      problems.push("slide text: IME composition did not update the text");
    }
    if (cdp) {
      await cdp.send("Input.insertText", { text: "日" });
    } else {
      await editor.pressSequentially("日");
      await emitComposition(editor, "compositionend", "日");
    }
    expectedSlideText += usesChromiumIme ? "日" : "に日";
    if (
      !(await waitFor(
        async () => (await editor.innerText()) === expectedSlideText,
        3000,
      ))
    ) {
      problems.push(
        `slide text: IME commit produced ${JSON.stringify(await editor.innerText())}`,
      );
    }
    await cdp?.detach();
    await editor.pressSequentially(" switch");
    expectedSlideText += " switch";
    await page.locator(`[data-slide-thumbnail-id="${slideTwo}"]`).click();
    if (
      !(await waitFor(
        async () => !(await editorState(page, slideTwo)).editing,
        5000,
      ))
    ) {
      problems.push("slide switching left the old text session active");
    }
    let savedContent: string | undefined;
    const switchedTextSaved = await waitFor(
      async () => {
        const saved = await action<any>(
          page,
          "get-deck",
          {
            id: deckId,
            slideId: slideOne,
            compact: "false",
          },
          "GET",
        );
        savedContent = saved.slides?.find(
          (slide: any) => slide.id === slideOne,
        )?.content;
        if (!savedContent) return false;
        const savedText = await slideText(savedContent);
        return normalizeText(savedText) === normalizeText(expectedSlideText);
      },
      5000,
      100,
    );
    if (!switchedTextSaved) {
      const savedText = savedContent ? await slideText(savedContent) : "";
      problems.push(
        `slide switching saved ${JSON.stringify(savedText)}, expected ${JSON.stringify(expectedSlideText)}`,
      );
    }

    await page.getByRole("button", { name: "Speaker Notes" }).click();
    const notes = page.getByPlaceholder("Add speaker notes...");
    const expectedNotes = await exerciseControl(notes, "speaker notes", true);
    await sleep(900);
    const notesDeck = await action<any>(
      page,
      "get-deck",
      {
        id: deckId,
        slideId: slideTwo,
        compact: "false",
      },
      "GET",
    );
    const notesSlide = notesDeck.slides?.find(
      (slide: any) => slide.id === slideTwo,
    );
    if (
      normalizeText(notesSlide?.notes ?? "") !== normalizeText(expectedNotes)
    ) {
      problems.push(
        `speaker notes: saved ${JSON.stringify(notesSlide?.notes)}, expected ${JSON.stringify(expectedNotes)}`,
      );
    }

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Comments", exact: true }).click();
    const commentsHeading = page.getByText("Comments", { exact: true }).last();
    const addComment = commentsHeading.locator("..").locator("button").first();
    await addComment.click();
    const comment = page.getByPlaceholder("Add a comment...");
    if (!(await composingEscape(comment, "comment composer"))) {
      await addComment.click();
    }
    await exerciseControl(comment, "comment composer", true);
    await comment.press("Escape");
    await addComment.click();
    const rootComposer = page.getByPlaceholder("Add a comment...");
    await rootComposer.fill("Text surface QA root");
    await rootComposer.press(`${modifier}+Enter`);
    const rootComment = page.getByText("Text surface QA root", {
      exact: true,
    });
    await rootComment.waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    const reply = page.getByPlaceholder("Reply...");
    if (!(await composingEscape(reply, "comment reply"))) {
      await page.getByRole("button", { name: "Reply", exact: true }).click();
      await reply.waitFor({ state: "visible", timeout: 5000 });
    }
    await exerciseControl(reply, "comment reply", true);
    await reply.press("Escape");
    await rootComment.hover();
    await page.getByRole("button", { name: "Edit comment" }).click();
    const editComment = page.getByRole("textbox", { name: "Edit comment" });
    if (!(await composingEscape(editComment, "comment edit"))) {
      await rootComment.hover();
      await page.getByRole("button", { name: "Edit comment" }).click();
    }
    await exerciseControl(editComment, "comment edit", true);
    await editComment.press("Escape");
    await page.getByRole("button", { name: "More" }).click();
    await page.locator("[data-toolbar-pin-button]").click();
    const [pinTarget] = await listTargets(page, slideTwo);
    if (!pinTarget)
      throw new Error("second slide has no comment anchor target");
    await page.mouse.click(pinTarget.point.x, pinTarget.point.y);
    const pinComment = page.locator("[data-pin-popover] textarea");
    await pinComment.waitFor({ state: "visible", timeout: 5000 });
    if (!(await composingEscape(pinComment, "pinned comment composer"))) {
      await page.mouse.click(pinTarget.point.x, pinTarget.point.y);
      await pinComment.waitFor({ state: "visible", timeout: 5000 });
    }
    await exerciseControl(pinComment, "pinned comment composer", true);
    await pinComment.press("Escape");
    await page.getByRole("button", { name: "More" }).click();
    await page.locator("[data-toolbar-pin-button]").click();

    const deckTitle = page
      .locator('[data-slides-editor-root="true"] input[type="text"]')
      .first();
    await exerciseControl(deckTitle, "deck title", false);
    const titleAfterTyping = await deckTitle.inputValue();
    await sleep(900);
    const titledDeck = await readDeck();
    if (titledDeck.title !== titleAfterTyping) {
      problems.push("deck title: the debounced title was not saved");
    }

    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Recent" }).click();
    const card = page
      .locator(".agent-template-library-card")
      .filter({ has: page.locator(`a[href="/deck/${deckId}"]`) })
      .first();
    await card.waitFor({ state: "visible", timeout: 20_000 });
    await card.hover();
    await card.locator('button[aria-label="Deck options"]').click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    let rename = card.locator("input");
    await rename.waitFor({ state: "visible", timeout: 5000 });
    if (!(await composingEscape(rename, "deck-card rename"))) {
      await card.hover();
      await card.locator('button[aria-label="Deck options"]').click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      rename = card.locator("input");
      await rename.waitFor({ state: "visible", timeout: 5000 });
    }
    const renameAfterTyping = await exerciseControl(
      rename,
      "deck-card rename",
      false,
    );
    await rename.press("Enter");
    await sleep(900);
    const renamedDeck = await readDeck();
    if (renamedDeck.title !== renameAfterTyping) {
      problems.push("deck-card rename: the committed title was not saved");
    }
  } catch (error) {
    problems.push(`text-surface QA could not finish: ${String(error)}`);
  } finally {
    try {
      await action(page, "delete-deck", { id: deckId }, "DELETE");
    } catch (error) {
      problems.push(
        `text-surface QA could not delete its synthetic deck: ${String(error)}`,
      );
    }
  }
  return problems;
}

async function runAuthoringParityQa(page: Page, base: string, outRoot: string) {
  const problems: string[] = [];
  let firstMarkupMismatch = "";
  const shortcuts = [
    ["- ", "bullet"],
    ["* ", "bullet"],
    ["+ ", "bullet"],
    ["1. ", "ordered"],
    ["# ", "H1"],
    ["## ", "H2"],
    ["### ", "H3"],
    ["#### ", "H4"],
    ["> ", "BLOCKQUOTE"],
    ["--- ", "divider"],
    ["___ ", "divider"],
    ["*** ", "divider"],
    ["**bold**", "bold"],
    ["__bold__", "bold"],
    ["*italic*", "italic"],
    ["_italic_", "italic"],
    ["~~strike~~", "strike"],
    ["`code`", "code"],
  ] as const;
  const slashCommands = [
    ["paragraph", "paragraph", "H2", "P"],
    ["heading1", "heading1", "P", "H1"],
    ["heading2", "heading2", "P", "H2"],
    ["heading3", "heading3", "P", "H3"],
    ["bulletList", "bulletList", "P", "UL"],
    ["orderedList", "orderedList", "P", "OL"],
    ["quote", "quote", "P", "BLOCKQUOTE"],
    ["divider", "divider", "P", "DIV"],
  ] as const;
  const allCases = [
    ...shortcuts.flatMap(([shortcut, result], index) =>
      (["start", "after-enter"] as const).map((position) => ({
        id: `authoring-shortcut-${index}-${position}`,
        kind: "shortcut" as const,
        shortcut,
        result,
        position,
      })),
    ),
    ...slashCommands.map(([kind, command, initialTag, resultTag]) => ({
      id: `authoring-slash-${kind}`,
      kind: "slash" as const,
      command,
      initialTag,
      resultTag,
    })),
    { id: "authoring-list-ul", kind: "ul-flow" as const },
    { id: "authoring-list-ol", kind: "ol-flow" as const },
    { id: "authoring-list-styled", kind: "styled-flow" as const },
    { id: "authoring-soft-break-slash", kind: "soft-break-slash" as const },
  ];
  const cases = allCases;

  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await ensureSignedIn(page);
  const created = await action(page, "create-deck", {
    title: `[edit-fidelity] authoring parity ${Date.now()}`,
    slides: cases.map((test) => {
      if (test.kind === "ul-flow") {
        return {
          id: test.id,
          content:
            '<div class="fmd-slide"><ul style="list-style-type: disc"><li><p>Alpha</p></li></ul></div>',
        };
      }
      if (test.kind === "ol-flow") {
        return {
          id: test.id,
          content:
            '<div class="fmd-slide"><ol style="list-style-type: decimal"><li><p>Alpha</p></li></ol></div>',
        };
      }
      if (test.kind === "soft-break-slash") {
        return {
          id: test.id,
          content:
            '<div class="fmd-slide"><div class="fmd-text-box"><p style="color: red">Before</p></div></div>',
        };
      }
      const tag = "initialTag" in test ? test.initialTag : "div";
      return {
        id: test.id,
        content: `<div class="fmd-slide"><${tag}>Alpha</${tag}></div>`,
      };
    }),
  });
  const deckId = String(created.id ?? created.deckId);
  const initialMarkup = new Map(
    await Promise.all(
      cases.map(
        async ({ id }) =>
          [id, await getSlideContent(page, deckId, id)] as const,
      ),
    ),
  );
  const selectorFor = (slideId: string) =>
    `${canvasSelector(slideId)} [contenteditable="true"][data-editing-block="true"]`;
  const getEditor = (slideId: string) => page.locator(selectorFor(slideId));
  let currentCaseId = "setup";
  const waitForSlashOption = async (editor: any, caseId: string) => {
    const option = page.locator('[role="listbox"] [role="option"]').first();
    try {
      await option.waitFor({ state: "visible", timeout: 3_000 });
    } catch {
      const state = await editor.evaluate((element: HTMLElement) => {
        const selection = window.getSelection();
        const range = selection?.rangeCount
          ? selection.getRangeAt(0)
          : undefined;
        const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
        return {
          html: element.innerHTML,
          focused: document.activeElement === element,
          ariaExpanded: element.getAttribute("aria-expanded"),
          ariaActiveDescendant: element.getAttribute("aria-activedescendant"),
          selection: range
            ? {
                text: range.startContainer.textContent,
                offset: range.startOffset,
                collapsed: range.collapsed,
              }
            : null,
          listbox: listbox?.outerHTML ?? null,
        };
      });
      throw new Error(
        `${caseId}: slash menu did not open: ${JSON.stringify(state)}`,
      );
    }
  };

  async function begin(index: number) {
    const { id } = cases[index];
    await openSlide(page, base, deckId, index, id);
    const [target] = await listTargets(page, id);
    if (!target) throw new Error(`${id}: no editable text target`);
    const entryProblems: string[] = [];
    if (!(await enterEdit(page, id, target.point, entryProblems))) {
      throw new Error(`${id}: could not open in-place text editing`);
    }
    problems.push(...entryProblems.map((problem) => `${id}: ${problem}`));
    return getEditor(id);
  }

  async function finish(index: number, assertion: () => Promise<void>) {
    const { id } = cases[index];
    await assertion();
    if (!(await exitEdit(page, id, "escape"))) {
      throw new Error(`${id}: Escape did not exit in-place text editing`);
    }
    const live = await page
      .locator(`${canvasSelector(id)} .slide-content`)
      .innerHTML();
    const stored = await settleSaved(page, deckId, id, () => 0, 1400);
    const changedFromSource = await page.evaluate(
      ({ original, stored }: { original: string; stored: string }) =>
        JSON.stringify(window.__editFidelity.canonical(original)) !==
        JSON.stringify(window.__editFidelity.canonical(stored)),
      { original: initialMarkup.get(id) ?? "", stored },
    );
    if (!changedFromSource) {
      problems.push(`${id}: authoring changes were not persisted`);
    }
    const matchesLive = await page.evaluate(
      ({ live, stored }: { live: string; stored: string }) =>
        JSON.stringify(window.__editFidelity.canonical(live)) ===
        JSON.stringify(window.__editFidelity.canonical(stored)),
      { live, stored },
    );
    if (!matchesLive) {
      problems.push(`${id}: saved markup differs from the rendered slide`);
      if (!firstMarkupMismatch) {
        const detail = await page.evaluate(
          ({ live, stored }: { live: string; stored: string }) => {
            const left = window.__editFidelity.canonical(live);
            const right = window.__editFidelity.canonical(stored);
            let index = 0;
            while (
              index < left.length &&
              index < right.length &&
              left[index] === right[index]
            ) {
              index += 1;
            }
            const from = Math.max(0, index - 2);
            const to = index + 3;
            return {
              index,
              live: left.slice(from, to),
              saved: right.slice(from, to),
              liveHtml: live.slice(0, 700),
              savedHtml: stored.slice(0, 700),
            };
          },
          { live, stored },
        );
        firstMarkupMismatch = `${id}: first canonical mismatch ${JSON.stringify(detail)}`;
      }
    }
    await openSlide(page, base, deckId, index, id);
    const reloaded = await page
      .locator(`${canvasSelector(id)} .slide-content`)
      .innerHTML();
    const matchesReload = await page.evaluate(
      ({ stored, reloaded }: { stored: string; reloaded: string }) =>
        JSON.stringify(window.__editFidelity.canonical(stored)) ===
        JSON.stringify(window.__editFidelity.canonical(reloaded)),
      { stored, reloaded },
    );
    if (!matchesReload) {
      problems.push(`${id}: reloaded markup differs from the saved slide`);
      if (!firstMarkupMismatch) {
        const detail = await page.evaluate(
          ({ stored, reloaded }: { stored: string; reloaded: string }) => {
            const left = window.__editFidelity.canonical(stored);
            const right = window.__editFidelity.canonical(reloaded);
            let index = 0;
            while (
              index < left.length &&
              index < right.length &&
              left[index] === right[index]
            ) {
              index += 1;
            }
            const from = Math.max(0, index - 2);
            const to = index + 3;
            return {
              index,
              saved: left.slice(from, to),
              reloaded: right.slice(from, to),
              savedHtml: stored.slice(0, 700),
              reloadedHtml: reloaded.slice(0, 700),
            };
          },
          { stored, reloaded },
        );
        firstMarkupMismatch = `${id}: first canonical mismatch ${JSON.stringify(detail)}`;
      }
    }
  }

  const assertTag = async (editor: any, tag: string) => {
    const actual = await editor.evaluate(
      (element: HTMLElement) => element.tagName,
    );
    if (actual !== tag) {
      const html = await editor.evaluate(
        (element: HTMLElement) => element.outerHTML,
      );
      throw new Error(`expected ${tag}, got ${actual} in ${html}`);
    }
  };
  const assertBlock = async (editor: any, selector: string) => {
    const found = await editor.evaluate(
      (element: HTMLElement, query: string) => {
        const rootQuery = query.replace(
          new RegExp(`^${element.tagName.toLowerCase()}(?=\\s|>|$)`),
          ":scope",
        );
        return (
          element.matches(query) ||
          element.querySelector(query) !== null ||
          element.querySelector(rootQuery) !== null
        );
      },
      selector,
    );
    if (!found) {
      const html = await editor.evaluate(
        (element: HTMLElement) => element.outerHTML,
      );
      throw new Error(`expected authoring markup ${selector} in ${html}`);
    }
  };
  const assertPlainLine = async (editor: any) => {
    const found = await editor.evaluate((element: HTMLElement) =>
      Array.from(element.querySelectorAll("p, div")).some(
        (line) =>
          line.textContent?.replaceAll("\u200b", "").trim() === "Plain" &&
          !line.querySelector("span"),
      ),
    );
    if (!found) throw new Error("empty list Enter did not create a plain line");
  };

  try {
    for (let index = 0; index < cases.length; index += 1) {
      const test = cases[index];
      currentCaseId = test.id;
      const editor = await begin(index);
      if (test.kind === "shortcut") {
        if (test.position === "after-enter") {
          await editor.press(lineEndKey);
          await editor.press("Enter");
        } else {
          await editor.press(lineStartKey);
        }
        await editor.pressSequentially(test.shortcut);
        if (
          !(["bold", "italic", "strike", "code"] as string[]).includes(
            test.result,
          )
        )
          await editor.pressSequentially("Tail");
        await finish(index, async () => {
          const result = test.result;
          if (result === "bullet") {
            await assertBlock(editor, 'div[style*="display: flex"] > span');
          } else if (result === "ordered") {
            await assertBlock(editor, "ol > li");
          } else if (result === "bold") {
            await assertBlock(editor, 'span[style*="font-weight"]');
          } else if (result === "italic") {
            await assertBlock(editor, 'span[style*="font-style"]');
          } else if (result === "strike") {
            await assertBlock(editor, 'span[style*="text-decoration"]');
          } else if (result === "code") {
            await assertBlock(editor, "code");
          } else if (result === "divider") {
            await assertBlock(editor, "hr");
          } else if (test.position === "start") {
            await assertTag(editor, result);
          } else {
            await assertBlock(editor, result.toLowerCase());
          }
        });
      } else if (test.kind === "slash") {
        await editor.press(lineStartKey);
        if (test.command === "heading2") {
          await editor.pressSequentially("/");
          await waitForSlashOption(editor, test.id);
          await editor.pressSequentially("heading 2");
          await page
            .locator('[role="listbox"] [role="option"][data-value="heading2"]')
            .waitFor({ state: "visible", timeout: 3_000 });
          const active = await editor.getAttribute("aria-activedescendant");
          const headingOptionId = await page
            .locator('[role="listbox"] [role="option"][data-value="heading2"]')
            .getAttribute("id");
          if (!headingOptionId || active !== headingOptionId) {
            throw new Error(
              `/heading 2 did not select Heading 2 (active: ${active})`,
            );
          }
          await page.screenshot({
            path: path.join(outRoot, "slide-authoring-slash-menu.png"),
            fullPage: true,
          });
        } else {
          await editor.pressSequentially("/");
          const options = page.locator('[role="listbox"] [role="option"]');
          await waitForSlashOption(editor, test.id);
          if ((await options.count()) !== slashCommands.length) {
            throw new Error(
              `slash menu showed ${await options.count()} commands`,
            );
          }
          const commandIndex = slashCommands.findIndex(
            ([, kind]) => kind === test.command,
          );
          for (let step = 0; step < commandIndex; step += 1) {
            await page.keyboard.press("ArrowDown");
          }
        }
        await page.keyboard.press("Enter");
        await finish(index, async () => {
          if (test.command === "divider") await assertBlock(editor, "hr");
          if (test.command === "bulletList")
            await assertBlock(editor, "ul > li");
          else if (test.command === "orderedList")
            await assertBlock(editor, "ol > li");
          else await assertTag(editor, test.resultTag);
          const text = await editor.innerText();
          if (text.includes("/"))
            throw new Error("slash token remained in slide text");
        });
      } else if (test.kind === "soft-break-slash") {
        await editor.press(lineEndKey);
        await editor.press("Shift+Enter");
        await editor.pressSequentially("After /heading 2");
        const option = page.locator(
          '[role="listbox"] [role="option"][data-value="heading2"]',
        );
        await option.waitFor({ state: "visible" });
        await page.keyboard.press("Enter");
        await finish(index, async () => {
          const lines = await editor.evaluate((element: HTMLElement) => ({
            blocks: Array.from(element.children, (child) => ({
              tag: child.tagName,
              text: child.textContent?.replaceAll("\u200b", "").trim(),
              color: (child as HTMLElement).style.color,
            })),
          }));
          if (
            lines.blocks.length !== 2 ||
            lines.blocks[0]?.tag !== "P" ||
            lines.blocks[0]?.text !== "Before" ||
            lines.blocks[0]?.color !== "red" ||
            lines.blocks[1]?.tag !== "H2" ||
            lines.blocks[1]?.text !== "After"
          ) {
            throw new Error(
              `slash heading did not isolate the soft-break line: ${JSON.stringify(lines.blocks)}`,
            );
          }
        });
      } else if (test.kind === "ul-flow" || test.kind === "ol-flow") {
        await editor.press(lineEndKey);
        await editor.press("Enter");
        await editor.pressSequentially("Beta");
        if (test.kind === "ul-flow") {
          await editor.press("Tab");
          await assertBlock(editor, "ul > li ul > li");
          await editor.press("Shift+Tab");
          await editor.press(lineStartKey);
          await editor.press("Backspace");
          await editor.press("Backspace");
          const joined = await editor.innerText();
          if (!joined.includes("AlphaBeta") && !joined.includes("Alpha Beta")) {
            throw new Error(
              `Backspace did not join list text: ${JSON.stringify(joined)}`,
            );
          }
          await editor.press(lineEndKey);
          await editor.press("Enter");
          await editor.press("Enter");
          await editor.pressSequentially("Plain");
          await assertPlainLine(editor);
        } else {
          await assertBlock(editor, "ol > li:nth-child(2)");
          await editor.press("Tab");
          await assertBlock(editor, "ol > li ol > li");
          await editor.press("Shift+Tab");
          await editor.press(lineStartKey);
          await editor.press("Backspace");
          await editor.press("Backspace");
          const text = await editor.innerText();
          if (!text.includes("AlphaBeta") && !text.includes("Alpha Beta")) {
            throw new Error(
              `ordered-list Backspace lost text: ${JSON.stringify(text)}`,
            );
          }
          await editor.press(lineEndKey);
          await editor.press("Enter");
          await editor.press("Enter");
          await editor.pressSequentially("Plain");
          await assertPlainLine(editor);
        }
        await finish(index, async () => {});
      } else {
        await editor.press(lineStartKey);
        await editor.pressSequentially("- ");
        await editor.press(lineEndKey);
        await editor.press("Enter");
        await editor.pressSequentially("Beta");
        await editor.press("Tab");
        await editor.press("Shift+Tab");
        await editor.press(lineStartKey);
        await editor.press("Backspace");
        await editor.press("Backspace");
        const merged = await editor.innerText();
        if (!merged.includes("AlphaBeta") && !merged.includes("Alpha Beta")) {
          throw new Error(
            `styled bullet Backspace lost text: ${JSON.stringify(merged)}`,
          );
        }
        await editor.press(lineEndKey);
        await editor.press("Enter");
        await editor.press("Enter");
        await editor.pressSequentially("Plain");
        await finish(index, async () => {
          await assertBlock(editor, 'div[style*="display: flex"] > span');
          const text = await editor.innerText();
          if (!text.includes("Plain")) {
            throw new Error("styled bullet list exit lost the plain line");
          }
        });
      }
    }
  } catch (error) {
    problems.push(`authoring parity ${currentCaseId}: ${String(error)}`);
  } finally {
    try {
      await action(page, "delete-deck", { id: deckId }, "DELETE");
    } catch (error) {
      problems.push(
        `authoring parity could not delete its synthetic deck: ${String(error)}`,
      );
    }
  }
  if (firstMarkupMismatch) problems.push(firstMarkupMismatch);
  return problems;
}

async function runAuthoringCorpusQa(
  page: Page,
  base: string,
  cases: CorpusCase[],
) {
  const problems: string[] = [];
  const sources = corpusAuthoringSources(cases);
  const slideIdFor = (source: CorpusAuthoringSource) =>
    `authoring-corpus-${source.id}`;
  const selectorFor = (slideId: string) =>
    `${canvasSelector(slideId)} [contenteditable="true"][data-editing-block="true"]`;
  const editorHas = (editor: any, selector: string) =>
    editor.evaluate((element: HTMLElement, query: string) => {
      const rootQuery = query.replace(
        new RegExp(`^${element.tagName.toLowerCase()}(?=\\s|>|$)`),
        ":scope",
      );
      return (
        element.matches(query) ||
        element.querySelector(query) !== null ||
        element.querySelector(rootQuery) !== null
      );
    }, selector);
  const normalized = (value: string) =>
    value.replace(/[\s\u200b\ufeff]+/g, " ").trim();
  const editorDetails = async (editor: any) =>
    editor.evaluate((element: HTMLElement) => ({
      textLength: element.textContent?.length ?? 0,
      renderedTextLength: element.innerText?.length ?? 0,
      htmlLength: element.innerHTML.length,
      tags: Array.from(element.querySelectorAll<HTMLElement>("*"))
        .map((child) => child.tagName.toLowerCase())
        .slice(0, 20),
    }));
  const editorText = async (editor: any) =>
    normalized(
      await editor.evaluate(
        (element: HTMLElement) => element.textContent ?? "",
      ),
    );
  const canonicalMarkup = async (html: string) =>
    page.evaluate(
      (value: string) => JSON.stringify(window.__editFidelity.canonical(value)),
      html,
    );
  const assertSlashPopoverGeometry = async (editor: any) => {
    const geometry = await editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount !== 1) {
        throw new Error("slash menu has no caret selection");
      }
      const caretRange = selection.getRangeAt(0);
      let anchor = caretRange.getBoundingClientRect();
      if (!anchor.width && !anchor.height) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          const slash = text.data.lastIndexOf("/");
          if (slash < 0) continue;
          const slashRange = document.createRange();
          slashRange.setStart(text, slash);
          slashRange.setEnd(text, slash + 1);
          anchor = slashRange.getBoundingClientRect();
        }
      }
      const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
      const popover = listbox?.closest<HTMLElement>(
        "[data-radix-popper-content-wrapper]",
      );
      const content = listbox?.closest<HTMLElement>("[data-side]");
      if (
        !listbox ||
        !popover ||
        !content ||
        (!anchor.width && !anchor.height)
      ) {
        throw new Error("slash menu or its caret geometry is unavailable");
      }
      const caret = {
        left: anchor.left,
        top: anchor.top,
        right: anchor.right,
        bottom: anchor.bottom,
      };
      const rect = popover.getBoundingClientRect();
      return {
        caret,
        popover: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        side: content.getAttribute("data-side"),
        viewport: { width: innerWidth, height: innerHeight },
        focused: document.activeElement === root,
      };
    });
    const { caret, popover, side, viewport } = geometry;
    const viewportContained =
      popover.left >= 0 &&
      popover.top >= 0 &&
      popover.right <= viewport.width &&
      popover.bottom <= viewport.height;
    if (!viewportContained) {
      throw new Error(
        `slash popover escaped the viewport: ${JSON.stringify(geometry)}`,
      );
    }
    if (!geometry.focused) {
      throw new Error("slash popover stole focus from the editing caret");
    }
    const verticalGap =
      side === "top" ? caret.top - popover.bottom : popover.top - caret.bottom;
    if (side !== "top" && side !== "bottom") {
      throw new Error(`slash popover has unknown side ${String(side)}`);
    }
    if (Math.abs(verticalGap - 4) > 2) {
      throw new Error(
        `slash popover is not anchored 4px from the caret: ${JSON.stringify({ ...geometry, verticalGap })}`,
      );
    }
    const alignedAtStart = Math.abs(popover.left - caret.left) <= 2;
    const collisionShifted =
      caret.left >= popover.left - 2 &&
      caret.left <= popover.right + 2 &&
      (Math.abs(popover.left - 8) <= 2 ||
        Math.abs(popover.right - (viewport.width - 8)) <= 2);
    if (!alignedAtStart && !collisionShifted) {
      throw new Error(
        `slash popover is not horizontally anchored to the caret: ${JSON.stringify(geometry)}`,
      );
    }
    return geometry;
  };
  const targetHints = async (slideId: string) =>
    page.evaluate(
      ({ selector, chrome }: { selector: string; chrome: string }) => {
        const root = document.querySelector(selector);
        if (!root) throw new Error(`canvas not found: ${selector}`);
        const normalizeText = (value: string | null) =>
          (value ?? "").replace(/[\s\u200b\ufeff]+/g, " ").trim();
        const isStyledBulletRow = (element: HTMLElement) => {
          if (!/^(DIV|LI|P)$/.test(element.tagName)) return false;
          const marker = element.firstElementChild as HTMLElement | null;
          if (!marker || marker.tagName !== "SPAN") return false;
          const text = marker.textContent?.trim() ?? "";
          if (text) return /^[-*•●◦▪‣·⁃–—]+$/u.test(text);
          const style = getComputedStyle(marker);
          const width = Number.parseFloat(style.width);
          const height = Number.parseFloat(style.height);
          const colorParts = style.backgroundColor
            .replace(/[(),/]/g, " ")
            .trim()
            .split(/\s+/);
          const alpha =
            colorParts.length === 4 ? Number(colorParts[3]) : undefined;
          return (
            width > 0 &&
            height > 0 &&
            width <= 48 &&
            height <= 48 &&
            (Number.parseFloat(style.borderTopWidth) > 0 ||
              Number.parseFloat(style.borderLeftWidth) > 0 ||
              (style.backgroundColor !== "transparent" && alpha !== 0) ||
              Number.parseFloat(style.borderRadius) > 0)
          );
        };
        const textPoint = (
          element: HTMLElement,
          excluded: HTMLElement | null = null,
        ) => {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node as Text;
            if (excluded?.contains(text)) continue;
            const offset = text.data.search(/\S/);
            if (offset < 0) continue;
            const range = document.createRange();
            range.setStart(text, offset);
            range.setEnd(text, offset + 1);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              };
            }
          }
          return null;
        };
        const rowTextPoint = (row: HTMLElement) => {
          const marker = isStyledBulletRow(row)
            ? (row.firstElementChild as HTMLElement)
            : null;
          const content = marker
            ? Array.from(row.children).find(
                (child) =>
                  child !== marker && normalizeText(child.textContent) !== "",
              )
            : null;
          return textPoint(
            (content as HTMLElement | undefined) ?? row,
            content ? null : marker,
          );
        };
        const listItemFor = (element: HTMLElement) =>
          element.closest<HTMLElement>("li") ??
          element.querySelector<HTMLElement>("li");
        const bulletRowFor = (element: HTMLElement) => {
          for (
            let ancestor: HTMLElement | null = element;
            ancestor && root.contains(ancestor);
            ancestor = ancestor.parentElement
          ) {
            if (isStyledBulletRow(ancestor)) return ancestor;
          }
          return (
            Array.from(element.querySelectorAll<HTMLElement>("div,li,p")).find(
              isStyledBulletRow,
            ) ?? null
          );
        };
        return Array.from(
          root.querySelectorAll<HTMLElement>('[data-slide-text-block="true"]'),
        )
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              !/^(STYLE|SCRIPT)$/.test(element.tagName) &&
              !element.closest(chrome) &&
              rect.width > 0 &&
              rect.height > 0 &&
              normalizeText(element.textContent) !== ""
            );
          })
          .map((element, index) => {
            let absolute = false;
            let grid = false;
            const listItem = listItemFor(element);
            const bulletRow = bulletRowFor(element);
            for (
              let ancestor: HTMLElement | null = element;
              ancestor && root.contains(ancestor);
              ancestor = ancestor.parentElement
            ) {
              const style = getComputedStyle(ancestor);
              absolute ||= style.position === "absolute";
              grid ||= style.display === "grid";
            }
            return {
              index,
              textLength: normalizeText(element.textContent).length,
              textTransform: getComputedStyle(element).textTransform,
              absolute,
              grid,
              list: !!listItem,
              bulletRow: !!bulletRow,
              listPoint: listItem ? rowTextPoint(listItem) : null,
              bulletPoint: bulletRow ? rowTextPoint(bulletRow) : null,
            };
          });
      },
      { selector: canvasSelector(slideId), chrome: CHROME_SELECTOR },
    );
  const chooseTarget = async (
    slideId: string,
    requirement: CorpusAuthoringSource["testTarget"],
  ) => {
    const targets: TextTarget[] = await listTargets(page, slideId);
    const hints = await targetHints(slideId);
    const hint = hints.find(
      (candidate: any) =>
        candidate.textLength >= 4 &&
        !(
          requirement === "flex-grid" && candidate.textTransform === "uppercase"
        ) &&
        (requirement === "any" ||
          (requirement === "absolute" && candidate.absolute) ||
          (requirement === "flex-grid" && candidate.grid) ||
          (requirement === "list" && candidate.list && candidate.listPoint) ||
          (requirement === "bullet-row" &&
            candidate.bulletRow &&
            candidate.bulletPoint)),
    );
    const target = hint
      ? targets.find((candidate) => candidate.index === hint.index)
      : undefined;
    if (!target) return undefined;
    const point =
      requirement === "list"
        ? hint.listPoint
        : requirement === "bullet-row"
          ? hint.bulletPoint
          : null;
    return point ? { ...target, point } : target;
  };
  const assertReloadMarkup = async (
    slideId: string,
    stored: string,
  ): Promise<boolean> =>
    page.evaluate(
      ({ selector, source }: { selector: string; source: string }) => {
        const root = document
          .querySelector(selector)
          ?.querySelector(".slide-content") as HTMLElement | null;
        if (!root) return false;
        const clone = root.cloneNode(true) as HTMLElement;
        for (const element of [
          clone,
          ...Array.from(clone.querySelectorAll<HTMLElement>("*")),
        ]) {
          for (const attribute of [
            "data-builder-id",
            "data-slide-text-block",
            "data-editing-block",
            "contenteditable",
            "data-src-i",
            "data-slide-content-scope",
            "spellcheck",
            "aria-expanded",
            "aria-controls",
            "aria-activedescendant",
            "aria-haspopup",
          ]) {
            element.removeAttribute(attribute);
          }
        }
        return (
          JSON.stringify(window.__editFidelity.canonical(source)) ===
          JSON.stringify(window.__editFidelity.canonical(clone.innerHTML))
        );
      },
      { selector: canvasSelector(slideId), source: stored },
    );

  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await ensureSignedIn(page);
  for (const source of sources.filter((source) => source.kind !== "largest")) {
    const slideId = slideIdFor(source);
    let deckId: string | null = null;
    let original = "";
    try {
      const created = await action(page, "create-deck", {
        title: `[edit-fidelity] corpus authoring ${Date.now()}`,
        ...(source.corpusCase.aspectRatio
          ? { aspectRatio: source.corpusCase.aspectRatio }
          : {}),
        slides: [
          {
            id: slideId,
            content: source.slide.content,
            ...(source.slide.layout ? { layout: source.slide.layout } : {}),
          },
        ],
      });
      deckId = String(created.id ?? created.deckId);
      original = await getSlideContent(page, deckId, slideId);
      const originalCanonical = await canonicalMarkup(original);
      for (const flow of ["slash", "shortcut", "list", "paste"] as const) {
        const scaled = source.kind === "scaled";
        await page.setViewportSize(
          scaled ? { width: 850, height: 650 } : { width: 1600, height: 1000 },
        );
        try {
          await restoreSlide(page, deckId, slideId, original);
          await openSlide(page, base, deckId, 0, slideId);
          if (scaled) {
            const scale = await page
              .locator(canvasSelector(slideId))
              .evaluate((element: HTMLElement) => {
                const rect = element.getBoundingClientRect();
                return element.offsetWidth > 0
                  ? rect.width / element.offsetWidth
                  : 1;
              });
            if (!(scale > 0 && scale < 0.99)) {
              throw new Error(
                `scaled fixture did not scale below 1 (scale ${scale.toFixed(3)})`,
              );
            }
          }
          const target = await chooseTarget(slideId, source.testTarget);
          if (!target) {
            throw new Error(`no visible ${source.testTarget} text target`);
          }
          if (!(await enterEdit(page, slideId, target.point, []))) {
            throw new Error("could not enter in-place text editing");
          }
          const editor = page.locator(selectorFor(slideId));
          const editedBuilderId =
            (await editor.getAttribute("data-builder-id")) ??
            target.builderId ??
            undefined;
          const before = await snapshot(page, slideId, {
            targetIndex: target.index,
            targetBuilderId: editedBuilderId,
          });
          if (flow === "shortcut") {
            await editor.press(lineStartKey);
            await editor.pressSequentially("**bold** next");
            const shortcutState = await editor.evaluate(
              (element: HTMLElement) => {
                const marks = Array.from(
                  element.querySelectorAll<HTMLElement>(
                    'strong, b, span[style*="font-weight"]',
                  ),
                ).filter((mark) => mark.textContent === "bold");
                const mark = marks[0];
                const next = mark?.nextSibling;
                const nextText =
                  next?.nodeType === Node.TEXT_NODE
                    ? (next.textContent ?? "")
                    : "";
                return {
                  markCount: marks.length,
                  computedBold:
                    Number.parseInt(
                      mark ? getComputedStyle(mark).fontWeight : "",
                      10,
                    ) >= 600,
                  nextText,
                  nextIsOutside: Boolean(mark && next && !mark.contains(next)),
                };
              },
            );
            if (
              shortcutState.markCount !== 1 ||
              !shortcutState.computedBold ||
              !shortcutState.nextIsOutside ||
              !shortcutState.nextText
                .replaceAll("\u00a0", " ")
                .startsWith(" next")
            ) {
              throw new Error(
                `the strong Markdown shortcut did not bold the inserted run and leave following text outside it: ${JSON.stringify(shortcutState)}`,
              );
            }
          } else if (flow === "slash") {
            await editor.press(lineStartKey);
            await editor.pressSequentially("/heading 2");
            const options = page.locator('[role="listbox"] [role="option"]');
            await options.first().waitFor({ state: "visible" });
            const active = await editor.getAttribute("aria-activedescendant");
            const headingOptionId = await page
              .locator(
                '[role="listbox"] [role="option"][data-value="heading2"]',
              )
              .getAttribute("id");
            if (!headingOptionId || active !== headingOptionId) {
              throw new Error(
                `slash filter selected ${active ?? "no command"}`,
              );
            }
            if (scaled) await assertSlashPopoverGeometry(editor);
            await page.keyboard.press("Enter");
            if (!(await editorHas(editor, "h2"))) {
              throw new Error(
                "the Heading 2 slash command did not create an H2",
              );
            }
          } else if (flow === "paste") {
            await editor.press(lineStartKey);
            const slideContent = page.locator(
              `${canvasSelector(slideId)} .slide-content`,
            );
            const beforePaste = await slideContent.innerHTML();
            await editor.evaluate((element: HTMLElement) => {
              const clipboard = new DataTransfer();
              clipboard.setData(
                "text/html",
                // guard:allow-raw-color — foreign paste styles must be stripped from slide text.
                '<p><strong style="font-weight: normal">Docs paragraph</strong></p><p>Second paragraph</p><ul><li><span style="color: rgb(255, 0, 0); font-size: 48px">Docs list item</span></li></ul>',
              );
              clipboard.setData(
                "text/plain",
                "Docs paragraph\nSecond paragraph\nDocs list item",
              );
              const event = new ClipboardEvent("paste", {
                clipboardData: clipboard,
                bubbles: true,
                cancelable: true,
              });
              element.dispatchEvent(event);
              if (!event.defaultPrevented) {
                throw new Error(
                  "the editor did not handle rich clipboard paste",
                );
              }
            });
            const pasted = await slideContent.innerHTML();
            const pastedText = await slideContent.innerText();
            for (const token of [
              "Docs paragraph",
              "Second paragraph",
              "Docs list item",
            ]) {
              if (!pastedText.includes(token)) {
                throw new Error(
                  `Docs-shaped paste lost ${token}: ${JSON.stringify(await editorDetails(editor))}`,
                );
              }
            }
            const pastedStructure = await slideContent.evaluate(
              (element: HTMLElement) => {
                const walker = document.createTreeWalker(
                  element,
                  NodeFilter.SHOW_TEXT,
                );
                let pastedText: Text | null = null;
                for (
                  let node = walker.nextNode();
                  node;
                  node = walker.nextNode()
                ) {
                  if (node.textContent?.trim() === "Docs list item") {
                    pastedText = node as Text;
                    break;
                  }
                }
                const pastedItem = pastedText?.parentElement?.closest("li");
                const pastedRun = pastedText?.parentElement;
                return {
                  paragraphCount: Array.from([
                    ...(element.tagName === "P" ? [element] : []),
                    ...Array.from(element.querySelectorAll("p")),
                  ]).filter((paragraph) =>
                    /Docs paragraph|Second paragraph/.test(
                      paragraph.textContent ?? "",
                    ),
                  ).length,
                  unorderedListItem:
                    pastedItem?.closest("ul, ol")?.tagName === "UL",
                  foreignStyle:
                    !pastedRun ||
                    Boolean(pastedRun.style.color || pastedRun.style.fontSize),
                };
              },
            );
            if (
              pastedStructure.paragraphCount !== 2 ||
              !pastedStructure.unorderedListItem ||
              pastedStructure.foreignStyle
            ) {
              throw new Error(
                `Docs-shaped paste structure/style mismatch: ${JSON.stringify(pastedStructure)}`,
              );
            }
            if (corpusDir === path.join(HERE, "corpus")) {
              await page.screenshot({
                path: path.join(outRoot, "slide-authoring-docs-paste.png"),
                fullPage: true,
              });
            }
            await page.keyboard.press(
              `${process.platform === "darwin" ? "Meta" : "Control"}+Z`,
            );
            if (
              (await canonicalMarkup(await slideContent.innerHTML())) !==
              (await canonicalMarkup(beforePaste))
            ) {
              throw new Error("undo did not restore the pre-paste markup");
            }
            await page.keyboard.press(
              `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`,
            );
            if (
              (await canonicalMarkup(await slideContent.innerHTML())) !==
              (await canonicalMarkup(pasted))
            ) {
              throw new Error("redo did not restore the Docs-shaped paste");
            }
          } else {
            const listHint = (await targetHints(slideId)).find(
              (candidate: any) => candidate.index === target.index,
            );
            const inList = listHint?.list || listHint?.bulletRow;
            if (inList) {
              await editor.press(lineEndKey);
              await editor.press("Enter");
              await editor.pressSequentially("Corpus row");
            } else {
              await editor.press(lineStartKey);
              await editor.pressSequentially("- ");
              await editor.press(lineEndKey);
              await editor.press("Enter");
              await editor.pressSequentially("Corpus row");
            }
            const hasListStructure = await editor.evaluate(
              (element: HTMLElement) => {
                const normalizeText = (value: string | null) =>
                  (value ?? "").replace(/[\s\u200b\ufeff]+/g, " ").trim();
                const listElements = [
                  ...(element.matches("ul, ol") ? [element] : []),
                  ...Array.from(
                    element.querySelectorAll<HTMLElement>("ul, ol"),
                  ),
                ];
                const isStyledBulletRow = (row: HTMLElement) => {
                  if (!/^(DIV|LI|P)$/.test(row.tagName)) return false;
                  const marker = row.firstElementChild as HTMLElement | null;
                  if (!marker || marker.tagName !== "SPAN") return false;
                  const text = marker.textContent?.trim() ?? "";
                  if (text) return /^[-*•●◦▪‣·⁃–—]+$/u.test(text);
                  const style = getComputedStyle(marker);
                  const width = Number.parseFloat(style.width);
                  const height = Number.parseFloat(style.height);
                  const colorParts = style.backgroundColor
                    .replace(/[(),/]/g, " ")
                    .trim()
                    .split(/\s+/);
                  const alpha =
                    colorParts.length === 4 ? Number(colorParts[3]) : undefined;
                  return (
                    width > 0 &&
                    height > 0 &&
                    width <= 48 &&
                    height <= 48 &&
                    (Number.parseFloat(style.borderTopWidth) > 0 ||
                      Number.parseFloat(style.borderLeftWidth) > 0 ||
                      (style.backgroundColor !== "transparent" &&
                        alpha !== 0) ||
                      Number.parseFloat(style.borderRadius) > 0)
                  );
                };
                const bulletRows = [
                  ...(isStyledBulletRow(element) ? [element] : []),
                  ...Array.from(
                    element.querySelectorAll<HTMLElement>("div,li,p"),
                  ).filter(isStyledBulletRow),
                ];
                const corpusListRow = listElements.some((list) =>
                  Array.from(list.children).some(
                    (row) =>
                      row.tagName === "LI" &&
                      normalizeText(row.textContent).includes("Corpus row"),
                  ),
                );
                const corpusBulletRow = bulletRows.some((row) =>
                  normalizeText(row.textContent).includes("Corpus row"),
                );
                return {
                  hasStructure:
                    listElements.length > 0 || bulletRows.length > 0,
                  hasCorpusRow: corpusListRow || corpusBulletRow,
                  listCount: listElements.length,
                  bulletRowCount: bulletRows.length,
                };
              },
            );
            if (
              !hasListStructure.hasStructure ||
              !hasListStructure.hasCorpusRow
            ) {
              throw new Error(
                `list entry did not create the Corpus row: ${JSON.stringify(hasListStructure)}`,
              );
            }
            await editor.press("Tab");
            await editor.press("Shift+Tab");
            await editor.press(lineStartKey);
            await editor.press("Backspace");
            await editor.press("Backspace");
            const joined = await editorText(editor);
            if (!joined.includes("Corpus row")) {
              throw new Error(
                `Backspace after list indentation lost the new row: ${JSON.stringify(await editorDetails(editor))}`,
              );
            }
            await editor.press(lineEndKey);
            await editor.press("Enter");
            await editor.press("Enter");
            await editor.pressSequentially("Plain");
            if (!(await editorText(editor)).includes("Plain")) {
              throw new Error(
                `empty-list exit lost the plain text row: ${JSON.stringify(await editorDetails(editor))}`,
              );
            }
          }
          const mutationMarker = `authoring-${flow}-${Date.now()}`;
          await editor.press(lineEndKey);
          await editor.pressSequentially(` ${mutationMarker}`);
          if (!(await editorText(editor)).includes(mutationMarker)) {
            throw new Error(
              `${flow} marker did not enter the edited slide: ${JSON.stringify(await editorDetails(editor))}`,
            );
          }
          if (!(await exitEdit(page, slideId, "escape"))) {
            throw new Error("Escape did not leave in-place text editing");
          }
          const live = await page
            .locator(`${canvasSelector(slideId)} .slide-content`)
            .innerHTML();
          const saved = await settleSaved(page, deckId, slideId, () => 0, 1500);
          await openSlide(page, base, deckId, 0, slideId);
          const reloaded = await page
            .locator(`${canvasSelector(slideId)} .slide-content`)
            .innerHTML();
          assertAuthoringPersistence({
            originalHtml: originalCanonical,
            liveHtml: await canonicalMarkup(live),
            savedHtml: await canonicalMarkup(saved),
            reloadedHtml: await canonicalMarkup(reloaded),
          });
          if (!(await assertReloadMarkup(slideId, saved))) {
            throw new Error(
              "saved HTML did not match the reloaded slide markup",
            );
          }
          const after = await snapshot(page, slideId, {
            marker: mutationMarker,
            targetBuilderId: editedBuilderId,
          });
          const outside = diffSnapshots(before, after);
          const targetResized =
            before.editedRect !== null &&
            after.editedRect !== null &&
            (Math.abs(before.editedRect.width - after.editedRect.width) > 1 ||
              Math.abs(before.editedRect.height - after.editedRect.height) > 1);
          const naturalReflow =
            targetResized && before.editedInFlow && after.editedInFlow;
          const beforeRecords = new Map(
            before.records.map((record) => [record.key, record]),
          );
          const afterRecords = new Map(
            after.records.map((record) => [record.key, record]),
          );
          const followsNaturalReflow = (
            change: (typeof outside.geometry)[number],
          ) => {
            if (
              !naturalReflow ||
              (change.prop !== "x" && change.prop !== "y") ||
              !beforeRecords.get(change.key)?.downstreamFlow ||
              !afterRecords.get(change.key)?.downstreamFlow ||
              !before.editedRect ||
              !after.editedRect
            ) {
              return false;
            }
            const position =
              change.prop === "x" ? ("x" as const) : ("y" as const);
            const extent =
              change.prop === "x" ? ("width" as const) : ("height" as const);
            const expectedShift =
              after.editedRect[position] +
              after.editedRect[extent] -
              before.editedRect[position] -
              before.editedRect[extent];
            const actualShift = Number(change.b) - Number(change.a);
            return (
              Math.abs(actualShift - expectedShift) <= 1 ||
              followsCenteredFlexReflow(
                beforeRecords.get(change.key),
                afterRecords.get(change.key),
                change.prop,
                actualShift,
              )
            );
          };
          const outsideChanges = [
            ...outside.deltas,
            ...outside.geometry.filter(
              (change) => !followsNaturalReflow(change),
            ),
            ...outside.missing,
            ...outside.added,
          ].filter((change) => !change.inside);
          if (outsideChanges.length) {
            const records = new Map(
              [...before.records, ...after.records].map((record) => [
                record.key,
                record,
              ]),
            );
            const describe = (key: string) => {
              const record = records.get(key);
              const tag =
                record?.kind === "box"
                  ? /^box:([^.#]+)/.exec(key)?.[1]
                  : undefined;
              const index = /#(\d+)$/.exec(key)?.[1];
              return {
                element: record?.kind ?? "unknown",
                tag,
                index: index === undefined ? undefined : Number(index),
              };
            };
            const outsideSamples = [
              ...outside.geometry
                .filter((change) => !change.inside)
                .slice(0, 4)
                .map(({ key, prop, a, b }) => ({
                  kind: "geometry",
                  ...describe(key),
                  prop,
                  a,
                  b,
                })),
              ...outside.deltas
                .filter((change) => !change.inside)
                .slice(0, 4)
                .map(({ key, prop }) => ({
                  kind: "style",
                  ...describe(key),
                  prop,
                })),
              ...outside.missing
                .filter((change) => !change.inside)
                .slice(0, 4)
                .map(() => ({ kind: "missing" })),
              ...outside.added
                .filter((change) => !change.inside)
                .slice(0, 4)
                .map(() => ({ kind: "added" })),
            ].slice(0, 12);
            throw new Error(
              `${outsideChanges.length} style/geometry records changed outside the edited block (target ${JSON.stringify({ before: before.editedRect, after: after.editedRect })}): ${JSON.stringify(outsideSamples)}`,
            );
          }
          console.log(
            `[edit-fidelity] corpus ${source.id}/${flow}: save-reload markup and outside-block snapshot passed`,
          );
        } catch (error) {
          problems.push(`${source.id}/${flow}: ${String(error)}`);
        } finally {
          try {
            if (deckId && (await editorState(page, slideId)).editing) {
              await exitEdit(page, slideId, "escape");
            }
            if (deckId) await restoreSlide(page, deckId, slideId, original);
          } catch (error) {
            problems.push(
              `${source.id}/${flow}: could not restore source slide (${String(error)})`,
            );
          }
        }
      }
    } catch (error) {
      problems.push(
        `${source.id}: corpus authoring setup failed (${String(error)})`,
      );
    } finally {
      if (deckId) {
        try {
          await action(page, "delete-deck", { id: deckId }, "DELETE");
        } catch (error) {
          problems.push(
            `${source.id}: could not delete scratch deck (${String(error)})`,
          );
        }
      }
    }
  }

  let edgeDeckId: string | null = null;
  const edgeSlideId = "authoring-slash-viewport-edge";
  try {
    await page.setViewportSize({ width: 800, height: 520 });
    const edgeDeck = await action(page, "create-deck", {
      title: `[edit-fidelity] slash viewport edge ${Date.now()}`,
      slides: [
        {
          id: edgeSlideId,
          content:
            '<div class="fmd-slide" style="padding:0"><p style="position:absolute;right:8px;bottom:8px;margin:0;text-align:right;white-space:nowrap">Edge anchor&nbsp;</p></div>',
        },
      ],
    });
    edgeDeckId = String(edgeDeck.id ?? edgeDeck.deckId);
    await openSlide(page, base, edgeDeckId, 0, edgeSlideId);
    const [target] = await listTargets(page, edgeSlideId);
    if (!target) throw new Error("viewport-edge slide has no text target");
    if (!(await enterEdit(page, edgeSlideId, target.point, []))) {
      throw new Error("could not edit the viewport-edge text target");
    }
    const editor = page.locator(selectorFor(edgeSlideId));
    await editor.press(lineEndKey);
    await editor.pressSequentially("/");
    await page
      .locator('[role="listbox"] [role="option"]')
      .first()
      .waitFor({ state: "visible" });
    const geometry = await assertSlashPopoverGeometry(editor);
    const horizontalCollision =
      geometry.caret.left + geometry.popover.width + 8 >
      geometry.viewport.width;
    const verticalCollision =
      geometry.viewport.height - geometry.caret.bottom <
      geometry.popover.height + 12;
    if (!horizontalCollision || !verticalCollision) {
      throw new Error(
        `viewport-edge fixture did not pressure both popover edges: ${JSON.stringify({ geometry, horizontalCollision, verticalCollision })}`,
      );
    }
    if (
      geometry.side !== "top" ||
      geometry.popover.left >= geometry.caret.left ||
      Math.abs(geometry.popover.right - (geometry.viewport.width - 8)) > 2
    ) {
      throw new Error(
        `viewport-edge popover did not shift left and flip above the caret: ${JSON.stringify(geometry)}`,
      );
    }
    await page.keyboard.press("Escape");
    await page.locator('[role="listbox"]').waitFor({ state: "hidden" });
    await exitEdit(page, edgeSlideId, "escape");
  } catch (error) {
    problems.push(`slash viewport-edge geometry: ${String(error)}`);
  } finally {
    if (edgeDeckId) {
      try {
        await action(page, "delete-deck", { id: edgeDeckId }, "DELETE");
      } catch (error) {
        problems.push(`slash viewport-edge cleanup failed: ${String(error)}`);
      }
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
  }

  const largest = sources.find((source) => source.kind === "largest");
  if (!largest) return problems;
  const latencyDeck = await action(page, "create-deck", {
    title: `[edit-fidelity] corpus latency ${Date.now()}`,
    ...(largest.corpusCase.aspectRatio
      ? { aspectRatio: largest.corpusCase.aspectRatio }
      : {}),
    slides: [
      {
        id: "authoring-corpus-largest-latency",
        content: largest.slide.content,
        ...(largest.slide.layout ? { layout: largest.slide.layout } : {}),
      },
    ],
  });
  const latencyDeckId = String(latencyDeck.id ?? latencyDeck.deckId);
  try {
    const latencySlideId = "authoring-corpus-largest-latency";
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openSlide(page, base, latencyDeckId, 0, latencySlideId);
    const target = await chooseTarget(latencySlideId, "any");
    if (!target)
      throw new Error("largest corpus slide has no editable text target");
    if (!(await enterEdit(page, latencySlideId, target.point, []))) {
      throw new Error("could not enter the largest corpus text target");
    }
    const editor = page.locator(selectorFor(latencySlideId));
    await editor.press(lineEndKey);
    await editor.evaluate((element: HTMLElement) => {
      const metrics = {
        mode: "first-rAF-layout-proxy" as
          | "first-rAF-layout-proxy"
          | "event-timing",
        keydowns: 0,
        sampleWindow: null as { start: number; end: number } | null,
        eventSamples: [] as Array<{
          duration: number;
          inputDelay: number;
          handlerDuration: number;
          presentationDelay: number;
        }>,
        frameSamples: [] as number[],
        observer: null as PerformanceObserver | null,
      };
      const supportsEventTiming =
        PerformanceObserver.supportedEntryTypes?.includes("event") ?? false;
      if (supportsEventTiming) {
        try {
          metrics.observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const event = entry as PerformanceEntry & {
                duration: number;
                processingStart: number;
                processingEnd: number;
                target: Node | null;
              };
              const sampleWindow = metrics.sampleWindow;
              if (
                entry.name === "keydown" &&
                event.target &&
                (event.target === element || element.contains(event.target)) &&
                sampleWindow &&
                entry.startTime >= sampleWindow.start &&
                entry.startTime < sampleWindow.end
              ) {
                metrics.eventSamples.push({
                  duration: event.duration,
                  inputDelay: event.processingStart - entry.startTime,
                  handlerDuration: event.processingEnd - event.processingStart,
                  presentationDelay:
                    entry.startTime + event.duration - event.processingEnd,
                });
              }
            }
          });
          metrics.observer.observe({
            type: "event",
            buffered: false,
            durationThreshold: 16,
          } as PerformanceObserverInit);
          metrics.mode = "event-timing";
        } catch {
          metrics.observer?.disconnect();
          metrics.observer = null;
        }
      }
      (window as any).__slideKeyPaintMetrics = metrics;
      element.addEventListener(
        "keydown",
        (event) => {
          if (event.key.length !== 1) return;
          metrics.keydowns += 1;
          const started = performance.now();
          requestAnimationFrame(() => {
            element.getBoundingClientRect();
            metrics.frameSamples.push(performance.now() - started);
          });
        },
        true,
      );
    });
    await page.evaluate(() => {
      const metrics = (window as any).__slideKeyPaintMetrics;
      metrics.sampleWindow = {
        start: performance.now(),
        end: Number.POSITIVE_INFINITY,
      };
    });
    for (let index = 0; index < 64; index += 1) {
      await editor.press("x");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    await page.evaluate(() => {
      const metrics = (window as any).__slideKeyPaintMetrics;
      if (metrics.sampleWindow) metrics.sampleWindow.end = performance.now();
    });
    await page.waitForTimeout(50);
    const metrics = (await page.evaluate(() => {
      const value = (window as any).__slideKeyPaintMetrics;
      value?.observer?.disconnect();
      return value
        ? {
            mode: value.mode as string,
            keydowns: value.keydowns as number,
            eventSamples: value.eventSamples as Array<{
              duration: number;
              inputDelay: number;
              handlerDuration: number;
              presentationDelay: number;
            }>,
            frameSamples: value.frameSamples as number[],
          }
        : null;
    })) as {
      mode: string;
      keydowns: number;
      eventSamples: Array<{
        duration: number;
        inputDelay: number;
        handlerDuration: number;
        presentationDelay: number;
      }>;
      frameSamples: number[];
    } | null;
    if (!metrics || metrics.keydowns < 32) {
      throw new Error(
        `only captured ${metrics?.keydowns ?? 0} keydown samples`,
      );
    }
    if (metrics.mode === "event-timing") {
      const sortedFrames = [...metrics.frameSamples].sort((a, b) => a - b);
      if (sortedFrames.length < 32) {
        throw new Error(
          `only captured ${sortedFrames.length} frame-layout proxy samples`,
        );
      }
      const frameP95 = sortedFrames[Math.ceil(sortedFrames.length * 0.95) - 1];
      const slow = metrics.eventSamples
        .filter((sample) => sample.duration > 16)
        .sort((a, b) => a.duration - b.duration);
      const p95Rank = Math.ceil(metrics.keydowns * 0.95);
      const p95IsOverThreshold = slow.length >= metrics.keydowns - p95Rank + 1;
      const p95Event = p95IsOverThreshold
        ? slow[slow.length - (metrics.keydowns - p95Rank + 1)]
        : null;
      console.log(
        `[edit-fidelity] largest corpus slide Event Timing p95=${p95Event === null ? "<=16" : `${p95Event.duration.toFixed(2)}ms`} (input-to-paint diagnostic, input=${p95Event?.inputDelay.toFixed(2) ?? "n/a"}ms handler=${p95Event?.handlerDuration.toFixed(2) ?? "n/a"}ms presentation=${p95Event?.presentationDelay.toFixed(2) ?? "n/a"}ms, observed=${metrics.eventSamples.length}/${metrics.keydowns})`,
      );
      console.log(
        `[edit-fidelity] largest corpus slide keydown-to-first-rAF-plus-layout p95=${frameP95.toFixed(2)}ms (proxy, not paint; n=${sortedFrames.length}, threshold=16ms)`,
      );
      if (frameP95 > 16) {
        problems.push(
          `largest corpus slide keydown-to-first-rAF-plus-layout p95 ${frameP95.toFixed(2)}ms exceeds 16ms`,
        );
      }
    } else {
      const sorted = [...metrics.frameSamples].sort((a, b) => a - b);
      if (sorted.length < 32) {
        throw new Error(
          `only captured ${sorted.length} frame-layout proxy samples`,
        );
      }
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
      console.log(
        `[edit-fidelity] largest corpus slide keydown-to-first-rAF-plus-layout p95=${p95.toFixed(2)}ms (proxy, not paint; Event Timing unavailable, n=${sorted.length})`,
      );
      if (p95 > 16) {
        problems.push(
          `largest corpus slide keydown-to-first-rAF-plus-layout p95 ${p95.toFixed(2)}ms exceeds 16ms`,
        );
      }
    }
  } catch (error) {
    problems.push(`largest corpus latency sample failed: ${String(error)}`);
  } finally {
    try {
      await action(page, "delete-deck", { id: latencyDeckId }, "DELETE");
    } catch (error) {
      problems.push(
        `largest corpus latency deck cleanup failed: ${String(error)}`,
      );
    }
  }
  return problems;
}

async function runAuthoringFuzzQa(
  page: Page,
  base: string,
  cases: CorpusCase[],
  firstSeed: number,
  steps: number,
  seeds: number,
) {
  const sources = corpusAuthoringSources(cases).filter(
    (source) => source.kind !== "largest",
  );
  const profiles = [
    ...sources.filter((source) => source.kind === "absolute"),
    ...sources.filter((source) => source.kind === "flex-grid"),
    ...sources.filter((source) => source.kind === "styled-list"),
    ...sources.filter((source) => source.kind === "styled-flex-bullet-row"),
    ...sources.filter(
      (source) => source.kind === "styled-paragraph-bullet-row",
    ),
    ...sources.filter((source) => source.kind === "scaled"),
  ];
  if (profiles.length !== 6) {
    throw new CouldNotRun(
      "authoring fuzz requires committed absolute, flex/grid, semantic-list, flex bullet-row, paragraph bullet-row, and scaled slides",
    );
  }

  const selectorFor = (slideId: string) =>
    `${canvasSelector(slideId)} [contenteditable="true"][data-editing-block="true"]`;
  const canonicalMarkup = async (html: string) =>
    JSON.stringify(
      await page.evaluate(
        (value: string) => window.__editFidelity.canonical(value),
        html,
      ),
    );
  const profileFor = (round: number) =>
    round % 2 === 0 ? null : profiles[Math.floor(round / 2) % profiles.length];
  const sourceTarget = async (
    slideId: string,
    source: CorpusAuthoringSource | null,
  ) => {
    const targets = await listTargets(page, slideId);
    if (!source) return targets[0];
    const hints = await page.evaluate(
      ({ selector, chrome }: { selector: string; chrome: string }) => {
        const canvas = document.querySelector(selector);
        if (!canvas) return [];
        const isStyledBulletRow = (element: HTMLElement) => {
          if (!/^(DIV|LI|P)$/.test(element.tagName)) return false;
          const marker = element.firstElementChild as HTMLElement | null;
          if (!marker || marker.tagName !== "SPAN") return false;
          const text = marker.textContent?.trim() ?? "";
          if (text) return /^[-*•●◦▪‣·⁃–—]+$/u.test(text);
          const style = getComputedStyle(marker);
          const width = Number.parseFloat(style.width);
          const height = Number.parseFloat(style.height);
          const colorParts = style.backgroundColor
            .replace(/[(),/]/g, " ")
            .trim()
            .split(/\s+/);
          const alpha =
            colorParts.length === 4 ? Number(colorParts[3]) : undefined;
          return (
            width > 0 &&
            height > 0 &&
            width <= 48 &&
            height <= 48 &&
            (Number.parseFloat(style.borderTopWidth) > 0 ||
              Number.parseFloat(style.borderLeftWidth) > 0 ||
              (style.backgroundColor !== "transparent" && alpha !== 0) ||
              Number.parseFloat(style.borderRadius) > 0)
          );
        };
        const containsStyledBulletRow = (element: HTMLElement) =>
          isStyledBulletRow(element) ||
          Array.from(element.querySelectorAll<HTMLElement>("div,li,p")).some(
            isStyledBulletRow,
          );
        return Array.from(
          canvas.querySelectorAll<HTMLElement>(
            '[data-slide-text-block="true"]',
          ),
        )
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              !/^(STYLE|SCRIPT)$/.test(element.tagName) &&
              !element.closest(chrome) &&
              rect.width > 0 &&
              rect.height > 0 &&
              !!element.textContent?.replace(/[\s\u200b\ufeff]+/g, " ").trim()
            );
          })
          .map((element, index) => {
            let absolute = false;
            let grid = false;
            let list =
              /^(LI|UL|OL)$/.test(element.tagName) ||
              element.querySelector("li,ul,ol") !== null;
            let bulletRow = containsStyledBulletRow(element);
            for (
              let ancestor: HTMLElement | null = element;
              ancestor && canvas.contains(ancestor);
              ancestor = ancestor.parentElement
            ) {
              const style = getComputedStyle(ancestor);
              absolute ||= style.position === "absolute";
              grid ||= style.display === "grid";
              list ||=
                ancestor.tagName === "LI" || /^(UL|OL)$/.test(ancestor.tagName);
              bulletRow ||= isStyledBulletRow(ancestor);
            }
            return { index, absolute, grid, list, bulletRow };
          });
      },
      { selector: canvasSelector(slideId), chrome: CHROME_SELECTOR },
    );
    const hint = hints.find((candidate: any) =>
      source.testTarget === "absolute"
        ? candidate.absolute
        : source.testTarget === "flex-grid"
          ? candidate.grid
          : source.testTarget === "list"
            ? candidate.list
            : source.testTarget === "bullet-row"
              ? candidate.bulletRow
              : true,
    );
    return targets.find((target) => target.index === hint?.index);
  };

  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await ensureSignedIn(page);
  const problems: string[] = [];
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const exercisedProfiles = new Set<string>();

  for (let round = 0; round < seeds; round += 1) {
    const seed = firstSeed + round;
    const profile = profileFor(round);
    exercisedProfiles.add(profile?.kind ?? "synthetic");
    await page.setViewportSize(
      profile?.kind === "scaled"
        ? { width: 850, height: 650 }
        : { width: 1600, height: 1000 },
    );
    const slideId = `authoring-fuzz-${round}`;
    let deckId: string | null = null;
    try {
      const created = await action(page, "create-deck", {
        title: `[edit-fidelity] authoring fuzz ${seed}`,
        ...(profile?.corpusCase.aspectRatio
          ? { aspectRatio: profile.corpusCase.aspectRatio }
          : {}),
        slides: [
          {
            id: slideId,
            content:
              profile?.slide.content ??
              `<div class="fmd-slide"><p>Fuzz seed ${seed} starts here.</p></div>`,
            ...(profile?.slide.layout ? { layout: profile.slide.layout } : {}),
          },
        ],
      });
      deckId = String(created.id ?? created.deckId);
      await openSlide(page, base, deckId, 0, slideId);
      if (profile?.kind === "scaled") {
        const scale = await page
          .locator(canvasSelector(slideId))
          .evaluate((element: HTMLElement) => {
            const rect = element.getBoundingClientRect();
            return element.offsetWidth > 0
              ? rect.width / element.offsetWidth
              : 1;
          });
        if (!(scale > 0 && scale < 0.99)) {
          throw new Error(
            `scaled fuzz fixture did not scale below 1 (scale ${scale.toFixed(3)})`,
          );
        }
      }
      const target = await sourceTarget(slideId, profile);
      if (!target) throw new Error("no target matched the authoring profile");
      const editorSelector = selectorFor(slideId);
      const rootSelector = `${canvasSelector(slideId)} .slide-content`;
      const originalHtml = await page.evaluate(
        ({ selector, index }: { selector: string; index: number }) =>
          window.__editFidelity.targetSourceHtml(selector, index),
        { selector: canvasSelector(slideId), index: target.index },
      );
      const originalSlideHtml = await page.locator(rootSelector).innerHTML();
      if (!(await enterEdit(page, slideId, target.point, []))) {
        throw new Error("could not enter in-place text editing");
      }
      const slideHtml = () => page.locator(rootSelector).innerHTML();
      const result = await runAuthoringFuzz(page, {
        seed,
        steps,
        editorSelector,
        slideSelector: canvasSelector(slideId),
        slideContentSelector: rootSelector,
        originalHtml,
        originalSlideHtml,
        modifier,
        historyLimit: IN_PLACE_TEXT_UNDO_LIMIT,
        expectScaledSlide: profile?.kind === "scaled",
        finishAndReload: async (): Promise<AuthoringFuzzPersistence> => {
          if (!(await exitEdit(page, slideId, "escape"))) {
            throw new Error("Escape did not leave in-place text editing");
          }
          const liveHtml = await slideHtml();
          const stored = await settleSaved(
            page,
            deckId!,
            slideId,
            () => 0,
            2500,
          );
          await openSlide(page, base, deckId!, 0, slideId);
          const reloadedHtml = await slideHtml();
          return canonicalizeAuthoringFuzzPersistence(
            {
              originalHtml: originalSlideHtml,
              liveHtml,
              savedHtml: stored,
              reloadedHtml,
            },
            canonicalMarkup,
          );
        },
      });
      console.log(
        `[edit-fidelity] fuzz seed=${result.seed} passed ${result.stepsRun} steps on ${profile ? `committed-${profile.kind}` : "synthetic"} (${result.undoSteps} undo steps)`,
      );
    } catch (error) {
      problems.push(
        `seed ${seed} ${profile ? `committed-${profile.kind}` : "synthetic"}: ${String(error)}`,
      );
    } finally {
      try {
        if (deckId && (await editorState(page, slideId)).editing) {
          await exitEdit(page, slideId, "escape");
        }
        if (deckId) await action(page, "delete-deck", { id: deckId }, "DELETE");
      } catch (error) {
        problems.push(
          `seed ${seed}: scratch deck cleanup failed (${String(error)})`,
        );
      }
    }
  }
  if (problems.length) {
    return problems;
  }
  console.log(
    `[edit-fidelity] ${seeds} seeded authoring runs of ${steps} steps passed in ${browserName}; profiles: ${Array.from(exercisedProfiles).join(", ")}`,
  );
  return problems;
}

/**
 * Polls the stored slide until it stops changing and no write the page sent
 * is still in flight. Saves are debounced, so "no change yet" is only trusted
 * after a minimum wait; on a loaded machine a sent write can take seconds to
 * land, and reading before it does reports text the save really kept as lost.
 * The cap sits above the client's 60 s action timeout plus its retry, so an
 * aborted and re-sent save is seen instead of cut off.
 */
async function settleSaved(
  page: Page,
  deckId: string,
  slideId: string,
  writesInFlight: () => number,
  minimumObservationMs = 2_500,
) {
  const start = Date.now();
  let last = await getSlideContent(page, deckId, slideId);
  let lastChange = Date.now();
  for (;;) {
    await sleep(300);
    const now = await getSlideContent(page, deckId, slideId);
    if (now !== last || writesInFlight() > 0) {
      last = now;
      lastChange = Date.now();
    }
    if (
      Date.now() - start >= minimumObservationMs &&
      Date.now() - lastChange >= 1200
    )
      return last;
    if (Date.now() - start >= 75_000) {
      throw new Error(
        writesInFlight() > 0
          ? "a save was still in flight after 75 s"
          : "the stored slide was still changing after 75 s",
      );
    }
  }
}

async function restoreSlide(
  page: Page,
  deckId: string,
  slideId: string,
  stored: string,
) {
  const current = await getSlideState(page, deckId, slideId);
  if (current.content === stored) return;
  await action(page, "patch-deck", {
    deckId,
    operations: [
      {
        op: "patch-slide",
        slideId,
        fields: { content: stored },
        baseContentHash: current.contentHash,
      },
    ],
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
  edited: {
    targetIndex?: number;
    text?: string;
    marker?: string;
    targetBuilderId?: string;
  },
): Promise<Snapshot> {
  return page.evaluate(
    ({ sel, edited }: any) => window.__editFidelity.snapshot(sel, edited),
    { sel: canvasSelector(slideId), edited },
  );
}

async function takeWriteStacks(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__editFidelity.takeWriteStacks());
}

async function takeKeepaliveWrites(page: Page): Promise<KeepaliveWrite[]> {
  return page.evaluate(() => window.__editFidelity.takeKeepaliveWrites());
}

async function listTargets(page: Page, slideId: string): Promise<TextTarget[]> {
  return page.evaluate(
    (sel: string) => window.__editFidelity.listTargets(sel),
    canvasSelector(slideId),
  );
}

async function checkExpectedStyles(
  page: Page,
  slideId: string,
  expected: ExpectedStyle[],
  when: string,
): Promise<string[]> {
  const actual: Array<string | null> = await page.evaluate(
    ({ sel, expected }: any) => {
      const root = document.querySelector(sel);
      return expected.map((e: ExpectedStyle) => {
        const el = root?.querySelector(e.selector);
        return el ? getComputedStyle(el).getPropertyValue(e.property) : null;
      });
    },
    { sel: canvasSelector(slideId), expected },
  );
  return expected.flatMap((e, i) =>
    actual[i] === e.value
      ? []
      : [
          `${when}: ${e.selector} ${e.property} is ${actual[i] ?? "missing"}, expected ${e.value}`,
        ],
  );
}

/** Writes the editor sends when it persists slide content. */
const WRITE_ACTION =
  /\/_agent-native\/actions\/(patch-deck|save-deck|update-slide)\b/;

interface WriteDetail {
  action: string;
  /** "rerun" is the typedelete idempotence edit. */
  phase: "edit" | "rerun";
  /** Per slide the write touched: its fields, and whether content is the stored string. */
  slides: Array<{
    slideId: string;
    fields: string[];
    contentEqualsStored: boolean | null;
  }>;
}

function describeWrite(
  action: string,
  body: any,
  stored: string,
  phase: WriteDetail["phase"],
): WriteDetail {
  const slide = (slideId: string, fields: Record<string, unknown>) => ({
    slideId,
    fields: Object.keys(fields).sort(),
    contentEqualsStored:
      typeof fields.content === "string" ? fields.content === stored : null,
  });
  const slides =
    action === "patch-deck"
      ? (body.operations ?? []).map((op: any) =>
          slide(`${op.op}:${op.slideId ?? "?"}`, op.fields ?? {}),
        )
      : action === "update-slide"
        ? [slide(String(body.slideId), body)]
        : (body.deck?.slides ?? []).map((s: any) => slide(String(s.id), s));
  return { action, phase, slides };
}

/**
 * The edited element's byte range in the stored source, found the way the
 * in-page helpers find it: by tag, text and occurrence. Text inside elements
 * the renderer drops (style, svg, script) is not visible, so it is skipped.
 */
function sourceRangeOf(
  stored: string,
  target: { tag: string; text: string; occurrence: number },
): { start: number; end: number } | null {
  const want = stripSpace(target.text);
  const matches: P5.Element[] = [];
  const visit = (parent: P5.ParentNode) => {
    for (const child of parent.childNodes) {
      if (!("tagName" in child)) continue;
      const have = stripSpace(visibleTextOf(child));
      if (
        child.tagName === target.tag.toLowerCase() &&
        child.sourceCodeLocation?.startTag &&
        have === want
      ) {
        matches.push(child);
      }
      visit(child);
    }
  };
  visit(parse(stored, { sourceCodeLocationInfo: true }));
  const el = matches[target.occurrence] ?? null;
  const loc = el?.sourceCodeLocation;
  return loc ? { start: loc.startOffset, end: loc.endOffset } : null;
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
  sourceHeight: number | null;
  caretY: number | null;
  canvasChangedPct: number;
  caretMoved: boolean;
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
    /** Stored bytes before and after the edited element are unchanged. */
    outsideBytesEqual: boolean | null;
    diffLines: number;
    hardFailures: string[];
    idempotent?: boolean;
  };
  /** Content-writing requests the editor sent, from entering edit to the end. */
  writes?: string[];
  writeDetails?: WriteDetail[];
  /** Net no-op phases whose two writes were the editor's draft then revert. */
  draftReverts?: Array<WriteDetail["phase"]>;
  /** Client call stacks of those writes, from the in-page fetch hook. */
  writeStacks?: string[];
  enterSteps?: EnterStep[];
  violations: string[];
  /** Set when a dev-server or browser error forced one retry. */
  retriedAfter?: string;
  /** The error repeated on the retry and is not the editor's. */
  infra?: boolean;
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
  /** Opening the slide rewrites it, so a post-reload read may differ. */
  openMutatesContent: boolean;
  dir: string;
  expectStyles: ExpectedStyle[];
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
  const writes: string[] = [];
  const writeDetails: WriteDetail[] = [];
  /** Per write, its action and parsed body. */
  const writeBodies: Array<{ action: string; body: any }> = [];
  let countingWrites = false;
  let phase: WriteDetail["phase"] = "edit";
  const onRequest = (request: any) => {
    const method = request.method();
    if (!countingWrites || (method !== "POST" && method !== "PUT")) return;
    const match = WRITE_ACTION.exec(request.url());
    if (!match) return;
    const body = JSON.parse(request.postData() ?? "{}");
    const contents = slideContentsOf(match[1], body, slideId);
    writes.push(match[1]);
    writeDetails.push(describeWrite(match[1], body, ctx.stored, phase));
    writeBodies.push({ action: match[1], body });
    contents.forEach((c, k) => {
      if (c !== null && c !== ctx.stored)
        write(
          `write-${writes.length}${contents.length > 1 ? `-${k + 1}` : ""}.html`,
          c,
        );
    });
    inFlight.add(request);
  };
  const inFlight = new Set<unknown>();
  const onWriteDone = (request: unknown) => inFlight.delete(request);
  page.on("request", onRequest);
  page.on("requestfinished", onWriteDone);
  page.on("requestfailed", onWriteDone);

  try {
    await page.goto(`${ctx.base}/home`, { waitUntil: "domcontentloaded" });
    const priorPagehideWrites = await takeKeepaliveWrites(page);
    const priorPagehideMismatches = keepaliveMismatches(
      priorPagehideWrites,
      slideId,
      ctx.stored,
    );
    await restoreSlide(page, deckId, slideId, ctx.stored);
    if (priorPagehideMismatches.length) {
      const restored = await settleSaved(
        page,
        deckId,
        slideId,
        () => inFlight.size,
        15_000,
      );
      if (restored !== ctx.stored) {
        throw new Error(
          `${priorPagehideMismatches.length} prior pagehide write(s) overwrote the restored slide`,
        );
      }
    }
    await openSlide(page, ctx.base, deckId, ctx.slideIndex, slideId);
    // Earlier writes were checked after settling; only new writes can still overwrite the fixture.
    const leftBehind = keepaliveMismatches(
      await takeKeepaliveWrites(page),
      slideId,
      ctx.stored,
    );
    if (leftBehind.length) {
      throw new Error(
        `${leftBehind.length} pagehide keepalive write(s) can overwrite the restored slide`,
      );
    }
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
    const styleProblems = await checkExpectedStyles(
      page,
      slideId,
      ctx.expectStyles,
      "fresh load",
    );

    await takeWriteStacks(page);
    countingWrites = true;
    result.gesture = await enterEdit(
      page,
      slideId,
      current.point,
      result.violations,
    );
    if (!result.gesture) {
      result.status = "no-edit";
      const v = result.violations;
      v.push(
        `could not enter edit mode with click, click-click or double-click${current.covered ? " (another element covers the target's click point)" : ""}`,
      );
      // Without an edit, the clicks themselves must still change nothing.
      const saved = await settleSaved(
        page,
        deckId,
        slideId,
        () => inFlight.size,
      );
      write("saved.html", saved);
      await settle(page);
      const after = await shot(page, slideId);
      write("after.png", after);
      const changed = await diffPngs(view, after);
      write("diff-after.png", changed.png);
      countingWrites = false;
      result.writes = [...writes];
      result.writeDetails = [...writeDetails];
      // Opening such a slide rewrites it, which the slide report names once.
      if (saved !== ctx.stored && !ctx.openMutatesContent)
        v.push("clicking changed the stored slide");
      if (writes.length && !ctx.openMutatesContent)
        v.push(
          `${writes.length} content write(s) without an edit (${writes.join(", ")})`,
        );
      if (changed.pct > tol) v.push(`view->after ${changed.pct}% > ${tol}%`);
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
      await page.keyboard.press(lineEndKey);
      await page.keyboard.type(" ok");
    } else if (scenario === "enter3") {
      await page.keyboard.press(lineEndKey);
      let prevPng = editing;
      // End keeps the caret's line, but at a soft wrap a Range measures the
      // next line; read after End only when entry left no measurable caret.
      let prev = state0.caretRect ? state0 : await editorState(page, slideId);
      for (let k = 1; k <= 3; k++) {
        await page.keyboard.press("Enter");
        await settle(page);
        const state = await editorState(page, slideId);
        const png = await shot(page, slideId);
        write(`enter-${k}.png`, png);
        const changed = await diffPngs(prevPng, png);
        // The canvas can't show an Enter: a split at a soft wrap, a blank
        // last line, and an authored fixed-height box all leave it unchanged.
        // A centred or bottom-anchored box, the edited element's own or an
        // ancestor's, moves the text instead of the caret, and the element's
        // box can stay put. Relative to the top of the element's content, the
        // caret moves a full line per Enter (up when Enter removes an empty
        // last bullet), and a caret left behind reads as unmoved. A list laid
        // out as a grid puts the new row beside the old one, so a caret that
        // moved into another block box has moved too.
        const lineOf = (s: EditorState) =>
          s.caretRect && s.contentTop !== null
            ? s.caretRect.y - s.contentTop
            : null;
        const from = lineOf(prev);
        const to = lineOf(state);
        const step: EnterStep = {
          key: k,
          sourceHeight: state.sourceRect?.height ?? null,
          caretY: to,
          canvasChangedPct: changed.pct,
          caretMoved:
            from !== null &&
            to !== null &&
            (Math.abs(to - from) >= prev.caretRect!.height / 2 ||
              prev.caretBlock !== state.caretBlock),
        };
        enterSteps.push(step);
        if (from === null || to === null) {
          result.violations.push(
            `enter #${k}: the caret could not be measured ${from === null ? "before" : "after"} it (no caret in the edited element, or nothing rendered at it)`,
          );
        } else if (!step.caretMoved) {
          result.violations.push(
            `enter #${k}: the caret stayed on its line (y ${from} -> ${to} below the element's content top)`,
          );
        }
        prevPng = png;
        prev = state;
      }
      await page.keyboard.type("new line");
      result.enterSteps = enterSteps;
    }

    // End lands at the end of the visual line, so read where the typing
    // went instead of assuming it followed the element's text.
    const typed = (await editorState(page, slideId)).editorText;
    await settle(page);
    const typedShot = await shot(page, slideId);
    write("typed.png", typedShot);
    const exited = await exitEdit(
      page,
      slideId,
      scenario === "clickout" ? "clickout" : "escape",
    );
    if (!exited) result.violations.push("edit mode did not exit");
    const saved = await settleSaved(page, deckId, slideId, () => inFlight.size);
    const writeStacks = await takeWriteStacks(page);
    write("saved.html", saved);
    await settle(page);
    const after = await shot(page, slideId);
    write("after.png", after);
    const editedText = state0.sourceText ?? target.text;
    const expectedText = NET_NOOP.has(scenario)
      ? editedText
      : typed ||
        (scenario === "append" ? `${editedText} ok` : `${editedText}new line`);
    const snapAfter = await snapshot(page, slideId, { text: expectedText });

    await takeKeepaliveWrites(page);
    await openSlide(page, ctx.base, deckId, ctx.slideIndex, slideId);
    const reload = await shot(page, slideId);
    write("reload.png", reload);
    const snapReload = await snapshot(page, slideId, { text: expectedText });
    styleProblems.push(
      ...(await checkExpectedStyles(page, slideId, ctx.expectStyles, "reload")),
    );
    // The reload fires pagehide, where Slides flushes pending saves with
    // keepalive fetches that inFlight never sees and that may land well after
    // the page reopens, so their bodies are checked instead of waited for.
    const unloadWrites = await takeKeepaliveWrites(page);
    const unloadMismatches = keepaliveMismatches(unloadWrites, slideId, saved);
    if (unloadMismatches.length) {
      unloadMismatches.forEach(
        (c, i) => c !== null && write(`keepalive-${i + 1}.html`, c),
      );
      result.violations.push(
        `a pagehide write carried different content than the edit saved (${unloadMismatches.length} slide content(s) across ${unloadWrites.length} keepalive write(s)${unloadMismatches.includes(null) ? ", some with no content to compare" : ""})`,
      );
    }
    const reloaded =
      unloadWrites.length || inFlight.size
        ? await settleSaved(
            page,
            deckId,
            slideId,
            () => inFlight.size,
            unloadWrites.length ? 15_000 : 2_500,
          )
        : await getSlideContent(page, deckId, slideId);
    if (reloaded !== saved && !ctx.openMutatesContent) {
      write("reloaded.html", reloaded);
      const hardAfter = hardFailures(saved, reloaded);
      result.violations.push(
        `a write landed after the edit settled (stored content changed across the reload; ${unloadWrites.length} keepalive write(s) on unload${hardAfter.length ? `; ${hardAfter.join(", ")}` : ""})`,
      );
    }

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
        rects(
          target.rect,
          state0.sourceRect,
          snapView.editedRect,
          snapAfter.editedRect,
        ),
      ),
      reload: await pair(
        "reload",
        after,
        reload,
        rects(snapAfter.editedRect, snapReload.editedRect),
      ),
      typed: await pair("typed", typedShot, after, []),
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
    let outsideBytesEqual: boolean | null = null;
    if (!NET_NOOP.has(scenario)) {
      const range = sourceRangeOf(ctx.stored, {
        tag: state0.sourceTag ?? target.tag,
        text: editedText,
        occurrence: state0.sourceText
          ? state0.sourceOccurrence
          : target.occurrence,
      });
      if (!range) {
        result.violations.push(
          "could not locate the edited element in the stored source",
        );
      } else {
        const before = ctx.stored.slice(0, range.start);
        const after = ctx.stored.slice(range.end);
        outsideBytesEqual =
          saved.length >= before.length + after.length &&
          saved.startsWith(before) &&
          saved.endsWith(after);
        if (!outsideBytesEqual) {
          let head = 0;
          while (head < before.length && saved[head] === before[head]) head++;
          write(
            "bytes-outside.txt",
            `stored element range [${range.start}, ${range.end})\nfirst differing byte before it: ${head < before.length ? head : "none"}\nstored: ${JSON.stringify(ctx.stored.slice(Math.max(0, head - 80), head + 160))}\nsaved:  ${JSON.stringify(saved.slice(Math.max(0, head - 80), head + 160))}\n`,
          );
        }
      }
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
      outsideEqual = outside.found
        ? outside.stored.join("\n") === outside.saved.join("\n")
        : null;
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
      outsideBytesEqual,
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
      } else if (
        !(await enterEdit(page, slideId, again.point, result.violations))
      ) {
        result.violations.push(
          "idempotence: could not re-enter edit after reload",
        );
      } else {
        phase = "rerun";
        await page.keyboard.type("x");
        await page.keyboard.press("Backspace");
        await exitEdit(page, slideId, "escape");
        const saved2 = await settleSaved(
          page,
          deckId,
          slideId,
          () => inFlight.size,
        );
        writeStacks.push(...(await takeWriteStacks(page)));
        write("saved2.html", saved2);
        result.html.idempotent = saved2 === saved;
      }
    }

    // ---- invariants
    countingWrites = false;
    result.writes = [...writes];
    result.writeDetails = [...writeDetails];
    result.writeStacks = writeStacks;
    const v = result.violations;
    v.push(...styleProblems);
    const px = result.pixels;
    const netNoop = NET_NOOP.has(scenario);
    if (netNoop) {
      // Keys far enough apart let the product save the typed "x" as a draft
      // and then revert it, per phase; any other write is churn.
      const element = sourceRangeOf(ctx.stored, {
        tag: state0.sourceTag ?? target.tag,
        text: editedText,
        occurrence: state0.sourceText
          ? state0.sourceOccurrence
          : target.occurrence,
      });
      const unexplained = (["edit", "rerun"] as const).flatMap((p) => {
        const sent = writeDetails.flatMap((d, i) => (d.phase === p ? [i] : []));
        if (
          scenario !== "noop" &&
          element &&
          isDraftRevert(
            ctx.stored,
            element,
            "x",
            sent.map((i) => writeBodies[i]),
            slideId,
          )
        ) {
          (result.draftReverts ??= []).push(p);
          return [];
        }
        return sent.map((i) => writes[i]);
      });
      if (unexplained.length)
        v.push(
          `${unexplained.length} content write(s) for a net no-op edit (${unexplained.join(", ")})`,
        );
    }
    if (px.editing.outside.pct > tol)
      v.push(
        `view->editing outside the edited element ${px.editing.outside.pct}% > ${tol}%`,
      );
    if (px.reload.whole.pct > tol)
      v.push(
        `after->reload ${px.reload.whole.pct}% > ${tol}% (persisted render differs from the live one)`,
      );
    // Same page load, so no noise floor: a few px of overflowing text can be
    // an extra saved line.
    if (
      px.typed.whole.diffPixels > 0 &&
      !resized(snapView.editedRect, snapAfter.editedRect)
    )
      v.push(
        `typed->after ${px.typed.whole.diffPixels}px differ (leaving edit mode changed what the editor showed)`,
      );
    if (netNoop) {
      if (px.editing.whole.pct > tol)
        v.push(`view->editing ${px.editing.whole.pct}% > ${tol}%`);
      if (px.after.whole.pct > tol)
        v.push(`view->after ${px.after.whole.pct}% > ${tol}%`);
    } else if (!resized(snapView.editedRect, snapAfter.editedRect)) {
      // An edit that resizes the element legitimately moves the content
      // after it; the outside style and stored-bytes checks below still hold.
      if (px.after.outside.pct > tol)
        v.push(
          `view->after outside the edited element ${px.after.outside.pct}% > ${tol}%`,
        );
    }
    for (const size of [px.editing, px.after, px.reload, px.typed]) {
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
      const token = scenario === "append" ? " ok" : "new line";
      if (!didSave)
        v.push(
          "the edit never reached storage before the reload (saved content equals stored)",
        );
      if (!isSplicedOnce(state0.editorText || editedText, token, typed))
        v.push(
          `typed text is not the element's text with "${token}" inserted once: ${JSON.stringify(typed.slice(0, 160))}`,
        );
      if (
        scenario === "enter3" &&
        !typed
          .split("\n")
          .some((line) =>
            line.replace(/^[^\p{L}\p{N}]+/u, "").startsWith(token),
          )
      )
        v.push(
          `"${token}" does not start a line of the typed text: ${JSON.stringify(typed.slice(0, 160))}`,
        );
      if (snapReload.editedText !== typed)
        v.push(
          `no element on the reloaded slide has the typed text line for line (closest: ${JSON.stringify((snapReload.editedText ?? "none").slice(0, 160))})`,
        );
      // Heading Enter and list exit intentionally create a plain paragraph.
      const restyled = restyledAddedText(
        snapView,
        snapReload,
        scenario === "enter3" ? state0.caretConvertibleTag : null,
      );
      if (restyled.length)
        v.push(
          `typed text on the reloaded slide has a style no text of the element had (${restyled.slice(0, 3).join("; ")})`,
        );
      if (sa.deltasOutside)
        v.push(
          `view->after: ${sa.deltasOutside} style deltas outside the edited element`,
        );
      if (outsideEqual === false)
        v.push("saved HTML changed outside the edited element");
      if (outsideBytesEqual === false)
        v.push("stored bytes changed outside the edited element");
    }
    for (const h of hard) v.push(`hard fail: ${h}`);
    if (result.html.idempotent === false)
      v.push("second no-op edit saved different HTML than the first");
    result.status = v.length ? "fail" : "pass";
  } catch (error) {
    result.status = "error";
    result.error = String((error as Error).stack ?? error).slice(0, 2000);
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onWriteDone);
    page.off("requestfailed", onWriteDone);
    result.metrics = metricsOf(result);
    write("result.json", JSON.stringify(result, null, 2));
    await makeSheet(ctx.sheetPage, dir, [
      ["view", "view.png"],
      ["editing", "editing.png"],
      ["enter 1", "enter-1.png"],
      ["enter 2", "enter-2.png"],
      ["enter 3", "enter-3.png"],
      ["typed", "typed.png"],
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
    typedPct: r.pixels?.typed?.whole.pct ?? 0,
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
  /** The error came from the dev server or browser, not from the editor. */
  infra?: boolean;
}

/** One concurrency slot; `reopen` replaces pages the browser closed. */
interface Worker {
  page: Page;
  sheetPage: Page;
  reopen(): Promise<void>;
}

const slideDir = (caseId: string, i: number) =>
  path.join(outRoot, caseId, `s${pad2(i + 1)}`);

function selectTargets(c: CorpusCase, i: number, all: TextTarget[]) {
  const limit = c.targets?.[String(i)] ?? maxTargets;
  const filtered = targetFilter
    ? all.filter((t) => targetFilter.includes(t.index))
    : all;
  return { limit, targets: filtered.slice(0, limit) };
}

/**
 * Targets a slide should report on: the `--targets` indexes when given (so a
 * filtered run still expects them), otherwise the first `limit` positions. A
 * baselined target that no longer exists then reports as "did not run".
 */
function expectedTargets(limit: number): Set<string> {
  const indexes = targetFilter
    ? [...targetFilter].sort((a, b) => a - b).slice(0, limit)
    : Array.from({ length: limit }, (_, t) => t);
  return new Set(indexes.map((t) => `t${pad2(t)}`));
}

/** A result an earlier run left on disk, kept by --resume unless it errored. */
function priorResult(
  dir: string,
  target: number,
  scenario: Scenario,
): ScenarioResult | null {
  if (!resume) return null;
  const file = path.join(dir, `t${pad2(target)}-${scenario}`, "result.json");
  if (!existsSync(file)) return null;
  const r = JSON.parse(readFileSync(file, "utf8")) as ScenarioResult;
  return r.status === "error" ? null : r;
}

/**
 * With --resume, a slide whose every scenario already has a result is taken
 * from disk without opening it. Returns false when it still has to run.
 */
function keepPriorSlide(
  c: CorpusCase,
  i: number,
  results: ScenarioResult[],
  slides: SlideReport[],
  envelope: Map<string, Set<string>>,
): boolean {
  if (!resume) return false;
  const dir = slideDir(c.id, i);
  const reportFile = path.join(dir, "slide.json");
  const targetsFile = path.join(dir, "targets.json");
  if (!existsSync(reportFile) || !existsSync(targetsFile)) return false;
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as SlideReport;
  if (report.error) return false;
  const { limit, targets } = selectTargets(
    c,
    i,
    JSON.parse(readFileSync(targetsFile, "utf8")),
  );
  const prior = targets.flatMap((t) =>
    scenarios.map((sc) => priorResult(dir, t.index, sc)),
  );
  if (prior.some((r) => !r)) return false;
  results.push(...(prior as ScenarioResult[]));
  slides.push(report);
  envelope.set(`${c.id}/s${pad2(i + 1)}`, expectedTargets(limit));
  return true;
}

async function runCase(
  c: CorpusCase,
  worker: Worker,
  base: string,
  results: ScenarioResult[],
  slides: SlideReport[],
  envelope: Map<string, Set<string>>,
) {
  let indices = c.slides.map((_, i) => i);
  if (slideFilter) indices = indices.filter((i) => slideFilter.includes(i + 1));
  indices = indices
    .slice(0, maxSlides)
    .filter((i) => !keepPriorSlide(c, i, results, slides, envelope));
  if (!indices.length) {
    console.log(
      `[edit-fidelity] ${c.id}: every result kept from the earlier run`,
    );
    return;
  }
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
  const created = await action(worker.page, "create-deck", payload);
  const deckId = String(created.id ?? created.deckId);
  const deck = await action(
    worker.page,
    "get-deck",
    { id: deckId, compact: "false" },
    "GET",
  );

  for (const i of indices) {
    const slideId = String(deck.slides[i].id);
    const stored = String(deck.slides[i].content);
    const dir = slideDir(c.id, i);
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
      const { a, noise } = await retryInfra(worker, async () => {
        await restoreSlide(worker.page, deckId, slideId, stored);
        await openSlide(worker.page, base, deckId, i, slideId);
        const a = await shot(worker.page, slideId);
        await openSlide(worker.page, base, deckId, i, slideId);
        const b = await shot(worker.page, slideId);
        return { a, noise: await diffPngs(a, b) };
      });
      const page = worker.page;
      report.noisePct = noise.pct;
      writeFileSync(path.join(dir, "view.png"), a);
      writeFileSync(path.join(dir, "noise-diff.png"), noise.png);
      report.openMutatesContent =
        (await getSlideContent(page, deckId, slideId)) !== stored;

      const all = await listTargets(page, slideId);
      writeFileSync(
        path.join(dir, "targets.json"),
        JSON.stringify(all, null, 2),
      );
      const { limit, targets } = selectTargets(c, i, all);
      report.targets = targets.length;
      const ctx: SlideCtx = {
        page,
        sheetPage: worker.sheetPage,
        base,
        caseId: c.id,
        deckId,
        slideIndex: i,
        slideId,
        stored,
        noisePct: noise.pct,
        openMutatesContent: report.openMutatesContent,
        dir,
        expectStyles: (c.expectStyles ?? []).filter((e) => e.slide === i),
      };
      envelope.set(`${c.id}/s${pad2(i + 1)}`, expectedTargets(limit));
      for (const target of targets) {
        for (const scenario of scenarios) {
          const prior = priorResult(dir, target.index, scenario);
          if (prior) {
            results.push(prior);
            continue;
          }
          let r = await runScenario(ctx, target, scenario);
          if (r.status === "error" && INFRA.test(r.error ?? "")) {
            const first = r.error;
            await worker.reopen();
            ctx.page = worker.page;
            ctx.sheetPage = worker.sheetPage;
            r = await runScenario(ctx, target, scenario);
            r.retriedAfter = first;
            r.infra = r.status === "error" && INFRA.test(r.error ?? "");
            if (r.infra) rewriteResult(dir, r);
          }
          results.push(r);
          console.log(formatRow(r));
        }
      }
    } catch (error) {
      report.error = String((error as Error).message ?? error).slice(0, 500);
      report.infra = INFRA.test(report.error);
      console.error(`[edit-fidelity] ${c.id} slide ${i + 1}: ${report.error}`);
    }
    writeFileSync(
      path.join(dir, "slide.json"),
      JSON.stringify(report, null, 2),
    );
  }
}

function rewriteResult(dir: string, r: ScenarioResult) {
  writeFileSync(
    path.join(dir, `t${pad2(r.target)}-${r.scenario}`, "result.json"),
    JSON.stringify(r, null, 2),
  );
}

/**
 * Errors from the dev server or the browser rather than the editor. Vite's
 * dep optimizer full-reloads every open page when a slide pulls in a
 * dependency it has not seen yet, a loaded dev server can miss a navigation
 * or selector deadline, and a crashed page closes. Each is retried once on a
 * fresh page; one that repeats is reported apart from editor failures.
 */
const INFRA =
  /Execution context was destroyed|canvas not found|frame was detached|Target page, context or browser has been closed|Target crashed|net::ERR_ABORTED|Timeout \d+ms exceeded/;

async function retryInfra<T>(worker: Worker, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!INFRA.test(String((error as Error).message ?? error))) throw error;
    await worker.reopen();
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
  const browserType = pick<any>(playwright, browserName);
  let browser: any;
  try {
    browser = await browserType.launch({ headless: !headed });
  } catch (error) {
    await cleanup();
    fatal(
      `could not launch ${browserName}; install it with pnpm exec playwright install ${browserName}: ${String(error)}`,
    );
  }
  const results: ScenarioResult[] = [];
  const slides: SlideReport[] = [];
  const envelope = new Map<string, Set<string>>();
  let exitCode = 0;
  let browserLost = false;
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    // tsx compiles with keepNames; the page has no __name helper.
    await context.addInitScript("globalThis.__name ||= (fn) => fn;");
    await context.addInitScript(installInPageHelpers, CHROME_SELECTOR);

    const warm = await context.newPage();
    // `/` serves the sign-in shell to a cookieless request and the client,
    // already signed in, keeps replacing it with itself; `/home` is stable.
    await warm.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await ensureSignedIn(warm);
    await warmUp(warm, base);
    await warm.close();

    if (typingChatOnly) {
      const page = await context.newPage();
      const problems = await runChatTypingRegression(page, base);
      await page.close();
      if (problems.length) {
        console.error(
          `[edit-fidelity] chat typing regression: ${problems.join("; ")}`,
        );
        return 1;
      }
      console.log(
        "[edit-fidelity] selection direction and chat typing regressions passed",
      );
      return 0;
    }

    if (imeEscapeOnly) {
      const page = await context.newPage();
      const problems = await runImeEscapeRegression(page, base, outRoot);
      await page.close();
      if (problems.length) {
        console.error(
          `[edit-fidelity] IME Escape regression: ${problems.join("; ")}`,
        );
        return 1;
      }
      console.log(
        "[edit-fidelity] composition Escape kept inline text editing active",
      );
      return 0;
    }

    if (textSurfaceQaOnly) {
      const page = await context.newPage();
      const problems = await runTextSurfaceQa(page, base, browserName);
      await page.close();
      if (problems.length) {
        console.error(
          `[edit-fidelity] text-surface QA: ${problems.join("; ")}`,
        );
        return 1;
      }
      console.log(
        `[edit-fidelity] Slides text surfaces passed typing, composition, paste, undo/redo, and switching checks in ${browserName}`,
      );
      return 0;
    }

    if (authoringCorpusOnly) {
      const page = await context.newPage();
      const problems = await runAuthoringCorpusQa(page, base, cases);
      await page.close();
      if (problems.length) {
        console.error(
          `[edit-fidelity] corpus authoring: ${problems.join("; ")}`,
        );
        return 1;
      }
      console.log(
        `[edit-fidelity] corpus authoring passed in ${browserName}; representative committed/private layouts and save/reload markup were checked`,
      );
      return 0;
    }

    if (authoringFuzzOnly) {
      const page = await context.newPage();
      const problems = await runAuthoringFuzzQa(
        page,
        base,
        cases,
        fuzzSeed,
        fuzzSteps,
        fuzzSeeds,
      );
      await page.close();
      if (problems.length) {
        console.error(`[edit-fidelity] authoring fuzz: ${problems.join("; ")}`);
        return 1;
      }
      return 0;
    }

    if (authoringOnly) {
      const page = await context.newPage();
      const problems = await runAuthoringParityQa(page, base, outRoot);
      await page.close();
      if (problems.length) {
        console.error(
          `[edit-fidelity] authoring parity: ${problems.join("; ")}`,
        );
        return 1;
      }
      console.log(
        `[edit-fidelity] Slides slash commands, Markdown shortcuts, and list authoring passed in ${browserName}`,
      );
      return 0;
    }

    console.log(
      `[edit-fidelity] ${base} · ${cases.length} case(s) · scenarios ${scenarios.join(",")} · out ${outRoot}`,
    );
    console.log(HEADER);
    const queue = [...cases];
    const openWorkerPage = async () => {
      const page = await context.newPage();
      if (cpuThrottle > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
      }
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
      return page;
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
        const worker: Worker = {
          page: await openWorkerPage(),
          sheetPage: await browser.newPage(),
          async reopen() {
            if (worker.page.isClosed()) worker.page = await openWorkerPage();
            if (worker.sheetPage.isClosed())
              worker.sheetPage = await browser.newPage();
          },
        };
        for (let c = queue.shift(); c; c = queue.shift()) {
          if (!browser.isConnected()) {
            browserLost = true;
            break;
          }
          try {
            await worker.reopen();
            await runCase(c, worker, base!, results, slides, envelope);
          } catch (error) {
            const message = String((error as Error).message ?? error);
            slides.push({
              caseId: c.id,
              slide: 0,
              noisePct: 0,
              openMutatesContent: false,
              targets: 0,
              error: message,
              infra: INFRA.test(message),
            });
            console.error(`[edit-fidelity] ${c.id}: ${message}`);
          }
        }
        if (browser.isConnected()) {
          await worker.page.close();
          await worker.sheetPage.close();
        }
      }),
    );
    browserLost ||= !browser.isConnected();
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
  // Only a run over the whole corpus knows a case or slide is really gone.
  const fullRun =
    !caseFilter &&
    !slideFilter &&
    !targetFilter &&
    maxSlides === Infinity &&
    maxTargets >= 4 &&
    SCENARIOS.every((s) => scenarios.includes(s));
  const orphans = fullRun
    ? orphanedBaselineKeys(
        Object.keys(baseline),
        new Map(cases.map((c) => [c.id, c.slides.length])),
      )
    : [];
  problems.push(
    ...orphans.map((key) => `${key}: baselined case/slide no longer in corpus`),
  );
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    const k = r.infra ? "infra-error" : r.status;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\nnoise floor (view vs reload, no edit):");
  for (const s of slides) {
    console.log(
      `  ${s.caseId} s${pad2(s.slide)}: ${s.noisePct}%  targets ${s.targets}${s.openMutatesContent ? "  OPENING THE SLIDE CHANGED ITS STORED CONTENT" : ""}${s.error ? `  ${s.infra ? "INFRA " : ""}ERROR ${s.error}` : ""}`,
    );
  }
  console.log(
    `\n${results.length} scenario(s): ${
      Object.entries(counts)
        .map(([k, n]) => `${n} ${k}`)
        .join(", ") || "none"
    }`,
  );

  const baselineMissing = !existsSync(baselinePath);
  const erroredSlides = slides.filter((s) => s.error);
  const unrun = Object.keys(baseline).filter(
    (key) => !byKey.has(key) && isExpected(key),
  );
  if (
    update &&
    (browserLost || erroredSlides.length || unrun.length || orphans.length)
  ) {
    // Writing now would drop the coverage of what did not run from the
    // ratchet without anything noticing.
    console.error(
      `\n[edit-fidelity] baseline not updated: ${browserLost ? "the browser was lost mid-run; " : ""}${erroredSlides.length} slide(s) errored (${erroredSlides.map((s) => `${s.caseId} s${pad2(s.slide)}`).join(", ") || "none"}), ${unrun.length} baselined scenario(s) did not run (${unrun.slice(0, 10).join(", ") || "none"}), ${orphans.length} baselined scenario(s) are no longer in the corpus (${orphans.slice(0, 10).join(", ") || "none"}). Re-run them (--resume) or prune the orphans first.`,
    );
    exitCode = 1;
  } else if (update && results.length) {
    const next = { ...baseline };
    // A ratchet seeded from a failing run would accept the failure as the
    // ceiling, so only passing results are recorded unless asked.
    // An error has no measurements to hold a ceiling, so it is never recorded.
    const refused = results.filter(
      (r) => r.status === "error" || (r.status !== "pass" && !acceptFailing),
    );
    for (const r of results) {
      if (!refused.includes(r))
        next[r.key] = ratchetBaselineEntry(baseline[r.key], r.metrics!);
    }
    if (refused.length) {
      console.log(
        `\n${refused.length} result(s) not recorded (errors never are; --accept-failing records fail/no-edit as accepted ceilings):`,
      );
      for (const r of refused) console.log(`  ${r.key} (${r.status})`);
      exitCode = 1;
    }
    const sorted = Object.fromEntries(
      Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(
      `baseline updated: ${baselinePath} (${results.length} entries written)`,
    );
  } else if (baselineMissing) {
    console.error(
      `\n[edit-fidelity] could not gate: no baseline at ${baselinePath}. Seed one from a passing run with --update.`,
    );
    exitCode = 2;
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
  if (slideErrors) exitCode = Math.max(exitCode, 1);
  if (browserLost) {
    console.error(
      `[edit-fidelity] could not finish: the browser closed; rerun with --resume ${runName}${opt("--out") ? ` --out ${outRoot}` : ""}`,
    );
    return 2;
  }
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
  if (target && (await enterEdit(page, "warm-1", target.point, []))) {
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
