import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { cpus, arch, platform, release } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createGzip } from "node:zlib";

import tailwind from "@tailwindcss/vite";
import {
  chromium,
  webkit,
  type Browser,
  type CDPSession,
  type Page,
} from "playwright";
import { build } from "vite";

import { frameStats, percentile, sweepWidths } from "./frame-cadence.ts";

const toolkit = fileURLToPath(new URL("../", import.meta.url));
const entry = path.join(toolkit, "dev/workspace-benchmark-entry.tsx");
const sweepMs = 2_000;
const sweepCount = 6;
const durationMs = sweepCount * sweepMs;
const { values: options } = parseArgs({
  options: {
    headed: { type: "boolean" },
    "target-hz": { type: "string", default: "60" },
    "docked-divider": { type: "boolean" },
    "divider-only": { type: "boolean" },
    "scrub-only": { type: "boolean" },
    "all-selected": { type: "boolean" },
    "docked-selection": { type: "boolean" },
  },
});
const headless = !options.headed;
const dockedDivider = options["docked-divider"] === true;
const dockedSelection = options["docked-selection"] === true;
const docked = dockedSelection || dockedDivider;
const allSelected = options["all-selected"] === true || dockedSelection;
const scrubOnly = options["scrub-only"] === true;
const dividerOnly = options["divider-only"] === true || dockedDivider;
assert.ok(
  [
    options["all-selected"],
    dockedSelection,
    dockedDivider,
    scrubOnly,
    options["divider-only"],
  ].filter(Boolean).length <= 1,
  "Choose one workload mode.",
);
const targetHz = Number(options["target-hz"]);
assert.ok(
  targetHz === 60 || targetHz === 120,
  "Expected --target-hz=60 or --target-hz=120",
);
const outputRoot = path.resolve(toolkit, "../../.tmp/workspace-benchmark");
const outputDir =
  headless && targetHz === 60
    ? outputRoot
    : path.join(
        outputRoot,
        `${headless ? "headless" : "headed"}-${targetHz}hz`,
      );
await mkdir(outputDir, { recursive: true });
const workloadName = dockedDivider
  ? "docked-divider"
  : dockedSelection
    ? "docked-selection"
    : allSelected
      ? "selection"
      : scrubOnly
        ? "scrub"
        : dividerOnly
          ? "divider"
          : "workspace";
const out = await mkdtemp(path.join(outputDir, workloadName + "-"));
console.log("Benchmark artifacts:", out);
const view = { width: 1440, height: 900 };

async function bundle() {
  const result = await build({
    root: toolkit,
    configFile: false,
    logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      tailwind(),
      {
        name: "production-workspace-benchmark",
        resolveId(id) {
          if (id === entry) return entry;
        },
        load(id) {
          if (id !== entry) return;
          return `
        import React from "react";
        import {createRoot} from "react-dom/client";
        import {EditorWorkspace} from "./stories/patterns/editor-workspace.tsx";
        import {SplitPane} from "../src/ui/base-ui/split-pane.tsx";
        import {PropertyScrubBaseline} from "./visual-regression/property-scrub-baseline.tsx";
        import "../.storybook/storybook.css";
        const params = new URLSearchParams(location.search);
        const root = createRoot(document.getElementById("root"));
        if (location.pathname === "/divider") {
          const geometry = Object.fromEntries([...params].map(([k, v]) => [k, Number(v)]));
          root.render(<SplitPane label="Resize Inspector" snapToStep defaultSize={geometry.size}
            style={{position:"absolute", left:geometry.left, top:geometry.top, width:geometry.width, height:geometry.height}}
            pane={<div/>}><div/></SplitPane>);
        } else root.render(location.pathname === "/control" ? <PropertyScrubBaseline/> : <EditorWorkspace initialSelection="hundred" dockable={location.pathname === "/docked"}/>);
      `;
        },
      },
    ],
    build: {
      write: false,
      lib: { entry, name: "WorkspaceBenchmark", formats: ["iife"] },
      minify: true,
    },
  });
  const files = (Array.isArray(result) ? result : [result]).flatMap((r) => {
    if (!("output" in r))
      throw new Error("Expected the production build output.");
    return r.output;
  });
  const css = files.find(
    (f) => f.type === "asset" && f.fileName.endsWith(".css"),
  );
  const js = files.find((f) => f.type === "chunk");
  if (css?.type !== "asset" || js?.type !== "chunk")
    throw new Error("Missing benchmark JavaScript or stylesheet.");
  return { css: String(css.source), js: js.code };
}

async function mount(
  browser: Browser,
  assets: Awaited<ReturnType<typeof bundle>>,
  routePath: string,
) {
  const page = await browser.newPage({ viewport: view, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://workspace.localhost/**", (route) => {
    const name = new URL(route.request().url()).pathname;
    if (name === "/app.js")
      return route.fulfill({
        contentType: "application/javascript; charset=utf-8",
        body: assets.js,
      });
    if (name === "/app.css")
      return route.fulfill({
        contentType: "text/css; charset=utf-8",
        body: assets.css,
      });
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><html lang="en" class="light" data-app-theme="design"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><main id="root"></main><script src="/app.js"></script></html>',
    });
  });
  await page.goto("http://workspace.localhost/" + routePath);
  if (routePath.startsWith("divider?"))
    await page.getByRole("separator", { name: "Resize Inspector" }).waitFor();
  else
    await page.getByRole("textbox", { name: "Width", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}

async function idle(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        let start = 0,
          last = 0;
        function tick(t: number) {
          if (!start) start = t;
          if (last) samples.push(t - last);
          last = t;
          if (t - start >= 2000) resolve(samples);
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
}

interface FrameRun {
  frameTimes: number[];
  moveTimes: number[];
  duration: number;
  panelWidths: number[];
  announcedWidths: (string | null)[];
  mountedRows: number[];
  startWidth: number;
  endWidth: number;
}

async function sweepPointer(
  page: Page,
  x: number,
  y: number,
  distance: number,
) {
  const begin = performance.now();
  const requests: { startMs: number; endMs: number }[] = [];
  const move = async (position: number) => {
    const startMs = performance.now() - begin;
    await page.mouse.move(position, y);
    requests.push({ startMs, endMs: performance.now() - begin });
  };
  let next = begin;
  while (performance.now() - begin < durationMs) {
    const elapsed = performance.now() - begin;
    const travel = (1 - Math.cos((elapsed / sweepMs) * 2 * Math.PI)) / 2;
    await move(x + Math.round(distance * travel));
    next = Math.max(next + 1000 / 120, performance.now());
    const remaining = next - performance.now();
    if (remaining > 0) await delay(remaining);
  }
  await move(x + distance / 2);
  return requests;
}

async function sustained(page: Page, label: string) {
  const separator = page.getByRole("separator", {
    name: dockedDivider ? "Resize Inspector" : "Properties panel width",
  });
  const bounds = await separator.boundingBox();
  if (!bounds) throw new Error("Missing divider geometry.");
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  const startWidth = await separator.getAttribute("aria-valuenow");
  if (startWidth === null) throw new Error("Missing current pane size.");
  const min = Number(await separator.getAttribute("aria-valuemin")),
    max = Number(await separator.getAttribute("aria-valuemax"));
  const amplitude = Math.min(96, Math.floor((max - Number(startWidth)) * 0.8));
  assert.ok(
    amplitude >= 16,
    `Not enough resize range for trace: ${min} / ${startWidth} / ${max}`,
  );
  const sampleStride = 10;
  await separator.evaluate((el, stride) => {
    const run: FrameRun = {
      frameTimes: [],
      moveTimes: [],
      duration: 0,
      panelWidths: [],
      announcedWidths: [],
      mountedRows: [],
      startWidth: 0,
      endWidth: 0,
    };
    let raf = 0;
    el.addEventListener(
      "pointerdown",
      (e) => {
        if (!e.isTrusted) throw new Error("Untrusted resize input");
        const pane = document.getElementById(
          el.getAttribute("aria-controls") ?? "",
        );
        if (!pane) throw new Error("Divider does not reference a panel.");
        const begin = performance.now();
        run.startWidth = Number(el.getAttribute("aria-valuenow"));
        const sample = (t: number) => {
          run.frameTimes.push(t - begin);
          if ((run.frameTimes.length - 1) % stride === 0) {
            run.panelWidths.push(pane.getBoundingClientRect().width);
            run.announcedWidths.push(el.getAttribute("aria-valuenow"));
            run.mountedRows.push(
              document.querySelectorAll('[role="treeitem"]').length,
            );
          }
          raf = requestAnimationFrame(sample);
        };
        const move = (e: PointerEvent) => {
          if (e.isTrusted) run.moveTimes.push(performance.now() - begin);
        };
        document.addEventListener("pointermove", move, true);
        document.addEventListener(
          "pointerup",
          () => {
            cancelAnimationFrame(raf);
            run.duration = performance.now() - begin;
            document.removeEventListener("pointermove", move, true);
            run.endWidth = Number(el.getAttribute("aria-valuenow"));
            el.setAttribute("data-measurement", JSON.stringify(run));
          },
          { capture: true, once: true },
        );
        raf = requestAnimationFrame(sample);
      },
      { once: true, capture: true },
    );
  }, sampleStride);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const requests = await sweepPointer(
    page,
    x,
    y,
    dockedDivider ? amplitude : -amplitude,
  );
  await page.mouse.up();
  const data = await separator.getAttribute("data-measurement");
  if (!data) throw new Error("Resize did not finish.");
  const run: FrameRun = JSON.parse(data);
  const end = await separator.getAttribute("aria-valuenow");
  await writeFile(
    path.join(out, label + "-samples.json"),
    JSON.stringify({
      ...run,
      endWidth: end === null ? null : Number(end),
      requests,
    }),
  );
  assert.ok(run.duration >= 10_000);
  assert.ok(
    run.moveTimes.length > 1,
    "No trusted pointer movement was recorded.",
  );
  assert.deepEqual(
    run.announcedWidths,
    run.panelWidths.map(String),
    "Announced and rendered divider positions diverged during resizing.",
  );
  if (label.endsWith("standalone-divider")) {
    assert.ok(
      run.mountedRows.every((count) => count === 0),
      "Standalone divider mounted document rows.",
    );
  } else if (dockedDivider) {
    assert.ok(
      run.mountedRows.every((count) => count > 0 && count < 200),
      "The virtualized layer tree must stay mounted throughout docking resizes.",
    );
  }
  const increment = 8;
  assert.ok(
    run.panelWidths.every((width) => width % increment === 0),
    "A rendered divider preview landed off the workspace grid.",
  );
  for (const [index, widths] of sweepWidths(
    run.panelWidths,
    run.frameTimes,
    sampleStride,
    sweepCount,
    sweepMs,
  ).entries()) {
    assert.ok(
      Math.max(...widths) - Math.min(...widths) >= amplitude * 0.9,
      `Divider did not cover the expected range during sweep ${index + 1}.`,
    );
  }
  assert.ok(end !== null);
  run.endWidth = Number(end);
  assert.ok(
    run.endWidth ===
      Math.round((Number(startWidth) + amplitude / 2) / increment) * increment,
    `Committed pane size ${end} diverged from the pointer’s last position.`,
  );
  const renderedWidth = await separator.evaluate((el) => {
    const panel = document.getElementById(
      el.getAttribute("aria-controls") ?? "",
    );
    if (!panel) throw new Error("Panel unmounted after its resize.");
    return panel.getBoundingClientRect().width;
  });
  assert.ok(
    Math.abs(renderedWidth - Number(end)) < 3,
    "Rendered panel width differs from aria-valuenow.",
  );
  assert.ok(
    await separator.evaluate((el) => el.ownerDocument.activeElement === el),
    "The divider lost keyboard focus after the pointer resize committed.",
  );
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await separator.getAttribute("aria-valuenow"), end);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await separator.getAttribute("aria-valuenow"), end);
  await separator.evaluate((el) => el.removeAttribute("data-measurement"));
  return { run, requests, renderedWidth };
}

async function exportedLayers(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download layer JSON" }).click();
  const download = await downloadPromise;
  try {
    const file = await download.path();
    assert.ok(file, "The selection export must produce a local file.");
    const records = JSON.parse(await readFile(file, "utf8")) as Record<
      string,
      unknown
    >[];
    assert.deepEqual(
      new Set(records.map((layer) => layer.id)),
      new Set(initialLayers.map((layer) => layer.id)),
    );
    assert.equal(records.length, initialLayers.length);
    return records;
  } finally {
    await download.delete();
  }
}

async function measureHistoryFeedback(page: Page, action: "commit" | "undo") {
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  assert.equal(await undo.isDisabled(), action === "commit");
  const attribute = "data-" + action + "-feedback-ms";
  await undo.evaluate(
    (button, { action, attribute }) => {
      const target = action === "commit" ? document : button;
      target.addEventListener(
        action === "commit" ? "pointerup" : "click",
        (event) => {
          const start = event.timeStamp;
          function sample() {
            if (button.matches(":disabled") === (action === "undo")) {
              document.documentElement.setAttribute(
                attribute,
                String(performance.now() - start),
              );
            } else {
              requestAnimationFrame(sample);
            }
          }
          requestAnimationFrame(sample);
        },
        { capture: true, once: true },
      );
    },
    { action, attribute },
  );
  return async () => {
    const measured = page.locator("html[" + attribute + "]");
    await measured.waitFor({ state: "attached" });
    const value = await measured.getAttribute(attribute);
    assert.ok(value !== null && Number.isFinite(Number(value)));
    return Number(value);
  };
}

async function sustainedScrub(page: Page, label: string, allSelected: boolean) {
  const width = page.getByRole("textbox", { name: "Width", exact: true });
  const gesture = page.locator("label").filter({ hasText: /^W$/ });
  const layers = page
    .getByRole("region", { name: "Design canvas" })
    .locator('button[data-layer-id][aria-pressed="true"]');
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const geometry = () =>
    layers.evaluateAll((nodes) =>
      nodes.map((e) => ({
        id: e.getAttribute("data-layer-id"),
        width: getComputedStyle(e).width,
        height: getComputedStyle(e).height,
      })),
    );
  const original = await geometry();
  const documentBefore = allSelected ? await exportedLayers(page) : null;
  if (allSelected) {
    const nextPage = initialLayers.findIndex(
      (layer, index) => index > 0 && layer.parentId === null,
    );
    assert.deepEqual(
      new Set(original.map((layer) => layer.id)),
      new Set(initialLayers.slice(0, nextPage).map((layer) => layer.id)),
    );
  } else assert.equal(original.length, 100);
  assert.equal(await width.inputValue(), "");
  await gesture.scrollIntoViewIfNeeded();
  const box = await gesture.boundingBox();
  if (!box) throw new Error("Missing Width scrub target");
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  type ScrubRun = {
    frameTimes: number[];
    moveTimes: number[];
    scrubCaptureMs: number[];
    duration: number;
    previewWidths: number[];
    mismatchedFieldFrames: number;
    comparedFieldFrames: number;
    geometryReads: { frame: number; durationMs: number }[];
    mismatchedLayers: number;
    changes: number;
  };
  await gesture.evaluate((el, expectedLayers) => {
    el.addEventListener(
      "pointerdown",
      () => {
        const nodes = [
          ...document.querySelectorAll<HTMLElement>(
            'button[data-layer-id][aria-pressed="true"]',
          ),
        ];
        if (nodes.length !== expectedLayers)
          throw new Error("Canvas selection changed before scrubbing.");
        const field = el instanceof HTMLLabelElement ? el.control : null;
        if (!(field instanceof HTMLInputElement))
          throw new Error("Scrub label must reference its numeric input.");
        const run: ScrubRun = {
          frameTimes: [],
          moveTimes: [],
          scrubCaptureMs: [],
          duration: 0,
          previewWidths: [],
          mismatchedFieldFrames: 0,
          comparedFieldFrames: 0,
          geometryReads: [],
          mismatchedLayers: 0,
          changes: 0,
        };
        const projectedBox =
          nodes[0].closest<HTMLElement>(".workspace-art-box") ?? nodes[0];
        const initialWidth = parseFloat(projectedBox.style.width);
        const origin = performance.now();
        let raf = 0;
        const sample = (time: number) => {
          run.frameTimes.push(time - origin);
          const value = parseFloat(projectedBox.style.width);
          if (value !== run.previewWidths.at(-1)) run.changes++;
          run.previewWidths.push(value);
          if (
            value !== initialWidth ||
            field.value !== "" ||
            run.comparedFieldFrames > 0
          ) {
            run.comparedFieldFrames++;
            if (
              field.value === "" ||
              Number(field.value.replaceAll(",", "")) !== value
            )
              run.mismatchedFieldFrames++;
          }
          if (run.changes > 1 && run.frameTimes.length % 30 === 0) {
            const start = performance.now();
            for (const node of nodes)
              if (parseFloat(getComputedStyle(node).width) !== value)
                run.mismatchedLayers++;
            run.geometryReads.push({
              frame: run.frameTimes.length - 1,
              durationMs: performance.now() - start,
            });
          }
          raf = requestAnimationFrame(sample);
        };
        let moveStart = 0;
        const beginMove = () => {
          moveStart = performance.now();
        };
        window.addEventListener("pointermove", beginMove, true);
        const move = (event: PointerEvent) => {
          if (!event.isTrusted) return;
          run.moveTimes.push(moveStart - origin);
          run.scrubCaptureMs.push(performance.now() - moveStart);
        };
        document.addEventListener("pointermove", move, true);
        document.addEventListener(
          "pointerup",
          () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", beginMove, true);
            document.removeEventListener("pointermove", move, true);
            run.duration = performance.now() - origin;
            Object.assign(document.documentElement, { scrubMeasurement: run });
          },
          { capture: true, once: true },
        );
        raf = requestAnimationFrame(sample);
      },
      { capture: true, once: true },
    );
  }, original.length);
  const commitFeedback = await measureHistoryFeedback(page, "commit");
  await page.mouse.move(x, y);
  await page.mouse.down();
  const requests = await sweepPointer(page, x, y, 150);
  await page.mouse.up();
  const commitFeedbackMs = await commitFeedback();
  const run = await page.evaluate(() => {
    const root = document.documentElement as HTMLElement & {
      scrubMeasurement?: ScrubRun;
    };
    if (!root.scrubMeasurement)
      throw new Error("Sustained scrub did not finish");
    return root.scrubMeasurement;
  });
  await writeFile(
    path.join(out, label + "-samples.json"),
    JSON.stringify({ ...run, requests }),
  );
  assert.ok(run.duration >= 10_000);
  for (const [index, widths] of sweepWidths(
    run.previewWidths,
    run.frameTimes,
    1,
    sweepCount,
    sweepMs,
  ).entries()) {
    assert.ok(
      new Set(widths).size > 15,
      `Too few visibly distinct preview widths during sweep ${index + 1}.`,
    );
  }
  assert.ok(run.geometryReads.length > 0);
  assert.ok(
    run.moveTimes.length > 1,
    "No trusted scrub movement was recorded.",
  );
  assert.ok(run.comparedFieldFrames > 0, "No inspector preview was observed.");
  assert.equal(
    run.mismatchedFieldFrames,
    0,
    "Inspector and canvas widths diverged during the scrub.",
  );
  assert.equal(run.mismatchedLayers, 0);
  const value = await width.inputValue();
  assert.ok(value !== "");
  assert.deepEqual(
    await geometry(),
    original.map((layer) => ({
      ...layer,
      width: Number(value.replaceAll(",", "")) + "px",
    })),
  );
  if (documentBefore) {
    const nextWidth = Number(value.replaceAll(",", ""));
    assert.deepEqual(
      await exportedLayers(page),
      documentBefore.map((layer) => ({ ...layer, width: nextWidth })),
    );
  }
  const undoFeedback = await measureHistoryFeedback(page, "undo");
  await undo.click();
  const undoFeedbackMs = await undoFeedback();
  assert.ok(await undo.isDisabled());
  assert.equal(await width.inputValue(), "");
  assert.deepEqual(await geometry(), original);
  if (documentBefore)
    assert.deepEqual(await exportedLayers(page), documentBefore);
  return {
    run,
    requests,
    value,
    commitFeedbackMs,
    undoFeedbackMs,
    checkedSelections: run.geometryReads.length,
    previewChanges: run.changes,
    distinctPreviewWidths: new Set(run.previewWidths).size,
    matchedLayers: original.length,
    exportedLayersVerified: documentBefore?.length,
  };
}

function inputCadence(run: { moveTimes: number[]; duration: number }) {
  const bins = Array.from({ length: Math.ceil(run.duration / 1000) }, () => 0);
  let previous = 0;
  let maxInputGapMs = 0;
  for (const time of run.moveTimes) {
    bins[Math.min(Math.floor(time / 1000), bins.length - 1)]++;
    maxInputGapMs = Math.max(maxInputGapMs, time - previous);
    previous = time;
  }
  maxInputGapMs = Math.max(maxInputGapMs, run.duration - previous);
  return { bins, maxInputGapMs, uninterrupted: maxInputGapMs <= 100 };
}

async function finishTrace(cdp: CDPSession, file: string) {
  const completion = new Promise<string>((resolve, reject) =>
    cdp.once("Tracing.tracingComplete", (event) => {
      if (!event.stream || event.dataLossOccurred)
        reject(new Error("Incomplete Chromium trace."));
      else resolve(event.stream);
    }),
  );
  await cdp.send("Tracing.end");
  const handle = await completion;
  async function* chunks() {
    try {
      let eof: boolean;
      do {
        const chunk = await cdp.send("IO.read", { handle });
        yield Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
        eof = chunk.eof;
      } while (!eof);
    } finally {
      await cdp.send("IO.close", { handle });
    }
  }
  await pipeline(
    Readable.from(chunks()),
    createGzip(),
    createWriteStream(file),
  );
}

async function verifyControls(page: Page) {
  const divider = page.getByRole("separator", {
    name: "Properties panel width",
  });
  const size = () => divider.getAttribute("aria-valuenow");
  const start = await size();
  await divider.focus();
  await divider.press("ArrowLeft");
  const grown = await size();
  assert.ok(Number(grown) > Number(start));
  await divider.press("ArrowRight");
  assert.equal(await size(), start);
  const outer = page.getByRole("separator", { name: "Layers panel width" });
  const outerBox = await outer.boundingBox();
  if (!outerBox) throw new Error("Missing outer divider.");
  const inspectorWidth = () =>
    divider.evaluate(
      (el) =>
        document
          .getElementById(el.getAttribute("aria-controls") ?? "")
          ?.getBoundingClientRect().width,
    );
  const before = await inspectorWidth();
  await page.mouse.move(
    outerBox.x + outerBox.width / 2,
    outerBox.y + outerBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(outerBox.x + 40, outerBox.y + outerBox.height / 2, {
    steps: 5,
  });
  assert.equal(
    await inspectorWidth(),
    before,
    "Outer drag leaked into inner inspector.",
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await inspectorWidth(), before);
  const tree = page.getByRole("tree", { name: "Layers" });
  const count = await tree.getByRole("treeitem").count();
  assert.ok(
    count > 0 && count < 200,
    `Expected bounded mounted rows, found ${count}`,
  );
  assert.match(await page.getByTestId("selected-count").innerText(), /100/);
  const layers = page
    .getByRole("region", { name: "Design canvas" })
    .locator('button[data-layer-id][aria-pressed="true"]');
  const width = page.getByRole("textbox", { name: "Width", exact: true });
  const height = page.getByRole("textbox", { name: "Height", exact: true });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const geometry = () =>
    layers.evaluateAll((nodes) =>
      nodes.map((e) => ({
        id: e.getAttribute("data-layer-id"),
        width: getComputedStyle(e).width,
        height: getComputedStyle(e).height,
      })),
    );
  const initial = await geometry();
  assert.equal(initial.length, 100);
  assert.equal(await width.inputValue(), "");
  assert.equal(await width.getAttribute("placeholder"), "Mixed");
  const originalHeight = await height.inputValue();
  await width.fill("1");
  await width.press("Enter");
  assert.deepEqual(
    await geometry(),
    initial.map((layer) => ({ ...layer, width: "1px" })),
  );
  assert.equal(await width.inputValue(), "1");
  await undo.click();
  assert.deepEqual(await geometry(), initial);
  assert.equal(await width.inputValue(), "");
  assert.ok(await undo.isDisabled());
  const scrub = page.locator("label").filter({ hasText: /^W$/ });
  const bounds = await scrub.boundingBox();
  if (!bounds) throw new Error("Width scrub target is missing.");
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  async function drag(cancel: boolean) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 44, y, { steps: 8 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const changed = await width.inputValue();
    assert.notEqual(changed, "");
    assert.deepEqual(
      await geometry(),
      initial.map((layer) => ({ ...layer, width: changed + "px" })),
    );
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    return changed;
  }
  await drag(true);
  assert.ok(await undo.isDisabled());
  assert.equal(await width.inputValue(), "");
  assert.deepEqual(await geometry(), initial);
  const changed = await drag(false);
  assert.equal(await height.inputValue(), originalHeight);
  assert.ok(await undo.isEnabled());
  await undo.click();
  assert.deepEqual(await geometry(), initial);
  assert.ok(await undo.isDisabled());
  await width.fill("100");
  await width.press("Enter");
  for (const steps of [30, 120]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y, { steps });
    await page.mouse.up();
    assert.equal(
      await width.inputValue(),
      "220",
      `Width scrub lost pointer deltas at ${120 / steps} pixels per move.`,
    );
    assert.deepEqual(
      await geometry(),
      initial.map((layer) => ({ ...layer, width: "220px" })),
    );
    await undo.click();
    assert.equal(await width.inputValue(), "100");
  }
  await undo.click();
  assert.deepEqual(await geometry(), initial);
  const first = tree.getByRole("treeitem", { name: "Home", exact: true });
  await first.click();
  await first.press("Shift+End");
  assert.equal(
    await page.getByTestId("selected-count").textContent(),
    "10000 selected",
  );
  await page.reload();
  await divider.waitFor();
  return {
    rangeSelection: 10000,
    mountedTreeRows: count,
    selected: 100,
    initialNavSize: initial.find((layer) => layer.id === "nav"),
    scrubbedWidth: changed,
    verifiedScrubDeltaPx: 120,
    verifiedPixelsPerMove: [4, 1],
    keyboardResizePx: Number(grown) - Number(start),
  };
}

const { initialLayers, homeSelection } = (await import(
  new URL(
    "../dev/stories/patterns/editor-workspace-fixture.ts",
    import.meta.url,
  ).href
)) as typeof import("../dev/stories/patterns/editor-workspace-fixture");
assert.equal(initialLayers.length, 10_000);
assert.equal(homeSelection.length, 100);
const assets = await bundle();
const browser = await chromium.launch({ headless });
try {
  const deviceSession = await browser.newBrowserCDPSession();
  const { gpu } = await deviceSession.send("SystemInfo.getInfo");
  await deviceSession.detach();
  const result: Record<string, unknown> = {
    browserVersion: browser.version(),
    targetHz,
    docked,
    documentLayers: initialLayers.length,
    selectedDocumentLayers: allSelected
      ? initialLayers.length
      : homeSelection.length,
    scrubMethod:
      "One 12-second trusted drag of the Width scrub area. The sample reads projected DOM geometry on every animation frame, then measures every visible selected layer’s computed width every 30 frames. Undo must restore all original widths and heights in one step.",
    scrubBaseline:
      "The control-scrub workload uses LayoutDimensions with 100 visible plain rectangles. The property-scrub workload edits 100 layers. The selection-scrub workload edits the entire document and verifies exported records after commit and undo.",
    baseline:
      "Same production workspace, document and pointer path, with side panel children hidden by CSS. Panel/canvas layout and the divider remain mounted.",
    missedFrameMethod:
      "Estimate skipped opportunities as max(0, round(gap/median idle interval)-1), including the partial intervals from pointerdown to first frame and last frame to release. Report them against complete intervals plus estimated misses. Two or more estimated misses across consecutive degraded intervals fail qualification.",
    device: {
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      os: platform(),
      release: release(),
      arch: arch(),
      gpu: gpu.devices.map((d) => ({
        vendor: d.vendorString,
        device: d.deviceString,
      })),
      renderer: gpu.auxAttributes?.glRenderer,
      graphicsMode: `Playwright ${headless ? "headless" : "headed"} browsers, default launch flags. rAF estimates do not measure physical display scan-out.`,
    },
    viewport: view,
  };
  type Status = "passed" | "unverified" | "failed";
  const outcomes = new Set<Status>();
  async function runBrowser(browser: Browser) {
    const workloads = allSelected
      ? ["selection-scrub"]
      : scrubOnly
        ? ["property-scrub", "control-scrub"]
        : dividerOnly
          ? dockedDivider
            ? ["workspace", "canvas-baseline", "standalone-divider"]
            : ["workspace"]
          : ["workspace", "canvas-baseline", "property-scrub", "control-scrub"];
    let dividerRoute: string | undefined;
    for (const scenario of workloads) {
      const chromiumRun = browser.browserType().name() === "chromium";
      const label = chromiumRun ? scenario : "webkit-" + scenario;
      const standaloneDivider = scenario === "standalone-divider";
      const routePath = standaloneDivider
        ? dividerRoute
        : scenario === "control-scrub"
          ? "control"
          : docked
            ? "docked"
            : "";
      assert.ok(routePath !== undefined, "Missing benchmark route");
      const { page, errors } = await mount(browser, assets, routePath);
      try {
        if (docked && !standaloneDivider) {
          const tab = page.getByRole("tab", { name: "Inspector", exact: true });
          const surface = page.locator(".dock-workspace-surface");
          const viewport = surface.getByRole("region", {
            name: "Design canvas",
          });
          const scrollTop = await viewport.evaluate((el) => {
            el.scrollTop = 60;
            return el.scrollTop;
          });
          assert.ok(scrollTop > 0, "Expected a scrollable canvas");
          const from = await tab.boundingBox(),
            to = await surface.boundingBox();
          assert.ok(from && to, "Expected a docked inspector and fixed canvas");
          await page.mouse.move(
            from.x + from.width / 2,
            from.y + from.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 8 });
          await page.mouse.up();
          await page.waitForFunction(() => {
            const source = document.querySelector(
              '[data-dock-tab="inspector"]',
            );
            const canvas = document.querySelector(".dock-workspace-surface");
            return (
              source &&
              canvas &&
              source.getBoundingClientRect().right <=
                canvas.getBoundingClientRect().left
            );
          });
          assert.equal(
            await viewport.evaluate((el) => el.scrollTop),
            scrollTop,
            "Docking Inspector moved the canvas viewport",
          );
          await viewport.evaluate((el) => {
            el.scrollTop = 0;
          });
        }
        if (dockedDivider && scenario === "workspace") {
          const geometry = await page
            .getByRole("separator", { name: "Resize Inspector" })
            .evaluate((el) => {
              const panel = el.closest(".split-pane"),
                size = el.getAttribute("aria-valuenow");
              if (!panel || size === null)
                throw new Error("Missing splitter geometry");
              const { left, top, width, height } =
                panel.getBoundingClientRect();
              return new URLSearchParams({
                left: String(left),
                top: String(top),
                width: String(width),
                height: String(height),
                size,
              }).toString();
            });
          dividerRoute = "divider?" + geometry;
        }
        if (allSelected) {
          const first = page.getByRole("treeitem", {
            name: "Home",
            exact: true,
          });
          await first.click();
          await first.press("Shift+End");
          await page.keyboard.press("Home");
          await first.press("Control+Space");
          await first.press("Control+Space");
          assert.equal(
            await page.getByTestId("selected-count").textContent(),
            "10000 selected",
          );
        } else if (
          !dockedDivider &&
          (scenario === "workspace" || scenario === "property-scrub")
        )
          result[label + "Interactions"] = await verifyControls(page);
        else if (scenario === "canvas-baseline") {
          await page.addStyleTag({
            content: dockedDivider
              ? ".dock-workspace-group [data-dock-slot] > * { display: none !important }"
              : ".split-pane-panel > * { display:none!important }",
          });
          assert.equal(
            await page.getByRole("tree", { name: "Layers" }).count(),
            0,
          );
          assert.ok(
            await page
              .getByRole("region", { name: "Design canvas" })
              .isVisible(),
          );
        }
        const samples = await idle(page),
          period = percentile(samples, 0.5);
        await writeFile(
          path.join(out, label + "-idle.json"),
          JSON.stringify(samples),
        );
        const cdp = chromiumRun
          ? await page.context().newCDPSession(page)
          : null;
        await cdp?.send("Tracing.start", {
          categories:
            "devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,input,latencyInfo,benchmark,cc",
          transferMode: "ReturnAsStream",
        });
        const workload = scenario.endsWith("-scrub")
          ? await sustainedScrub(page, label, allSelected)
          : await sustained(page, label);
        const { run } = workload;
        const { bins, uninterrupted, maxInputGapMs } = inputCadence(run);
        if (cdp)
          await finishTrace(cdp, path.join(out, label + "-trace.json.gz"));
        await cdp?.detach();
        if (scenario === "workspace")
          await page.screenshot({ path: path.join(out, label + ".png") });
        assert.deepEqual(errors, []);
        const frames = frameStats(run, period);
        const withinMissBudget = frames.estimatedMissedPercent < 1;
        const idleHz =
          (samples.length * 1000) / samples.reduce((a, b) => a + b, 0);
        const minimumHz = targetHz * 0.99;
        const inputHz = (run.moveTimes.length * 1000) / run.duration;
        let status: Status = "passed";
        let qualification = "passed at target cadence";
        if (idleHz < minimumHz) {
          status = "unverified";
          qualification = "idle browser cadence below target";
        } else if (inputHz < minimumHz || !uninterrupted) {
          status = "unverified";
          qualification = "pointer input below target cadence";
        } else if (frames.missedDuringLongestDegradedStreak >= 2) {
          status = "failed";
          qualification =
            "multiple frame opportunities lost before cadence recovered";
        } else if (frames.averageHz < minimumHz || !withinMissBudget) {
          status = "failed";
          qualification = "failed at target cadence";
        }
        result[label] = {
          status,
          qualification,
          withinOnePercentMissBudget: withinMissBudget,
          idle: {
            intervalMs: period,
            estimatedHz: idleHz,
            p95Ms: percentile(samples, 0.95),
            p99Ms: percentile(samples, 0.99),
          },
          dragMs: run.duration,
          uninterruptedInput: uninterrupted,
          browser: browser.version(),
          inputsPerSecond: bins,
          meanTrustedInputsPerSecond: inputHz,
          pointerDriver: {
            requests: workload.requests.length,
            maxMoveRoundTripMs: Math.max(
              ...workload.requests.map(({ startMs, endMs }) => endMs - startMs),
            ),
            maxBetweenRequestsMs: Math.max(
              ...workload.requests
                .slice(1)
                .map(({ startMs }, i) => startMs - workload.requests[i].endMs),
            ),
          },
          maxInputGapMs,
          ...("renderedWidth" in workload
            ? {
                endSize: workload.run.endWidth,
                startSize: workload.run.startWidth,
                renderedWidth: workload.renderedWidth,
                measuredSizeRange: [
                  Math.min(...workload.run.panelWidths),
                  Math.max(...workload.run.panelWidths),
                ],
                mountedRows: [
                  Math.min(...workload.run.mountedRows),
                  Math.max(...workload.run.mountedRows),
                ],
              }
            : {
                scrubCaptureMs: {
                  p50: percentile(workload.run.scrubCaptureMs, 0.5),
                  p95: percentile(workload.run.scrubCaptureMs, 0.95),
                  max: Math.max(...workload.run.scrubCaptureMs),
                },
                committedWidth: workload.value,
                commitFeedbackMs: workload.commitFeedbackMs,
                undoFeedbackMs: workload.undoFeedbackMs,
                previewChanges: workload.previewChanges,
                distinctPreviewWidths: workload.distinctPreviewWidths,
                comparedFieldFrames: workload.run.comparedFieldFrames,
                mismatchedFieldFrames: workload.run.mismatchedFieldFrames,
                allLayerSamples: workload.checkedSelections,
                geometryReadMaxMs: Math.max(
                  ...workload.run.geometryReads.map((read) => read.durationMs),
                ),
                longIntervalsFollowingGeometryRead:
                  workload.run.geometryReads.filter(
                    ({ frame }) =>
                      frame + 1 < workload.run.frameTimes.length &&
                      Math.round(
                        (workload.run.frameTimes[frame + 1] -
                          workload.run.frameTimes[frame]) /
                          period,
                      ) > 1,
                  ).length,
                matchedLayers: workload.matchedLayers,
                exportedLayersVerified: workload.exportedLayersVerified,
                undoSteps: 1,
              }),
          ...frames,
        };
        console.log(label, JSON.stringify(result[label]));
        outcomes.add(status);
      } finally {
        await page.close();
      }
    }
  }
  const wk = await webkit.launch({ headless });
  try {
    await runBrowser(wk);
  } finally {
    await wk.close();
  }
  await runBrowser(browser);
  const status: Status = outcomes.has("failed")
    ? "failed"
    : outcomes.has("unverified")
      ? "unverified"
      : "passed";
  result.status = status;
  await writeFile(
    path.join(
      out,
      allSelected
        ? "selection-results.json"
        : scrubOnly
          ? "scrub-results.json"
          : "results.json",
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  process.exitCode = { passed: 0, failed: 1, unverified: 2 }[status];
} finally {
  await browser.close();
}
