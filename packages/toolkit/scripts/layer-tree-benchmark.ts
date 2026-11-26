import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium, webkit, type Page } from "playwright";
import { build } from "vite";

import { frameStats, percentile } from "./frame-cadence.ts";

const {
  values: { browser: engine },
} = parseArgs({
  options: { browser: { type: "string", default: "chromium" } },
});
assert.ok(
  engine === "chromium" || engine === "webkit",
  "Expected chromium or webkit.",
);
const toolkit = fileURLToPath(new URL("../", import.meta.url));
const entry = toolkit + "dev/layer-tree-benchmark-entry.tsx";
const bundle = await build({
  root: toolkit,
  configFile: false,
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    {
      name: "layer-tree-benchmark",
      resolveId(id) {
        if (id === entry) return entry;
      },
      load(id) {
        if (id !== entry) return;
        return `
        import React from "react";
        import {createRoot} from "react-dom/client";
        import {LargeDocumentPanel} from "./stories/patterns/layer-tree-document.tsx";
        import "@agent-native/design-system/tokens.css";
        import "@agent-native/design-system/styles.css";
        import "@agent-native/design-system/themes/design.css";
        import "@agent-native/design-system/appearances.css";
        createRoot(document.body.firstElementChild).render(<LargeDocumentPanel windowed={document.body.hasAttribute("data-windowed")}/>);
      `;
      },
    },
  ],
  build: {
    write: false,
    lib: { entry, name: "LayerTreeBenchmark", formats: ["iife"] },
    minify: true,
  },
});
const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((result) => {
  if (!("output" in result))
    throw new Error("Expected a completed benchmark build.");
  return result.output;
});
async function measureWindowedScroll(page: Page) {
  const sample = await page.getByRole("tree").evaluate(async (tree) => {
    const frame = () =>
      new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const first = tree.querySelector('[role="treeitem"]');
    if (!first) throw new Error("Missing a mounted layer");
    const rowHeight = first.getBoundingClientRect().height;
    const bounds = tree.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const edges = [
      Math.max(0, bounds.top) + 1,
      Math.min(innerHeight, bounds.bottom) - 1,
    ];
    tree.scrollTop = 0;
    let last = await frame();
    const idle: number[] = [];
    for (let i = 0; i < 30; i++) {
      const next = await frame();
      idle.push(next - last);
      last = next;
    }
    const start = last;
    const frameTimes: number[] = [];
    let uncovered = 0;
    let furthest = 0;
    let peakRows = 0;
    do {
      const elapsed = last - start;
      tree.scrollTop =
        Math.max(0, Math.min(elapsed, 6000 - elapsed)) * 0.12 * rowHeight;
      last = await frame();
      frameTimes.push(last - start);
      furthest = Math.max(furthest, tree.scrollTop);
      peakRows = Math.max(
        peakRows,
        tree.querySelectorAll('[role="treeitem"]').length,
      );
      if (
        !edges.every((y) =>
          tree.contains(
            document.elementFromPoint(x, y)?.closest('[role="treeitem"]') ??
              null,
          ),
        )
      )
        uncovered++;
    } while (last - start < 6000);
    tree.scrollTop = 0;
    return {
      frameTimes,
      duration: last - start,
      idle,
      uncovered,
      peakRows,
      rowsTraversed: furthest / rowHeight,
    };
  });
  assert.ok(
    sample.rowsTraversed > 300,
    "Scroll workload did not leave the initial window.",
  );
  const period = percentile(sample.idle, 0.5);
  return {
    idleHz: 1000 / period,
    ...frameStats(sample, period),
    uncoveredFrames: sample.uncovered,
    peakRows: sample.peakRows,
    rowsTraversed: sample.rowsTraversed,
  };
}

async function dragAcrossDocument(page: Page) {
  const tree = page.getByRole("tree");
  const row = (name: string) =>
    tree.getByRole("treeitem", { name, exact: true });
  const first = row("Section 1");
  await first.press("ArrowRight");
  await first.click({ position: { x: 135, y: 15 } });
  const box = await first.boundingBox();
  assert.ok(box);
  const scrollTo = (index: number) =>
    tree.evaluate((node, offset) => {
      node.scrollTop = offset;
    }, box.height * index);
  await scrollTo(4992);
  const source = row("Layer 99");
  await source.click({ position: { x: 155, y: 15 }, modifiers: ["Shift"] });
  assert.equal(await source.getAttribute("aria-selected"), "true");
  const start = await source.boundingBox();
  assert.ok(start);
  await page.mouse.move(start.x + 155, start.y + 15);
  await page.mouse.down();
  await page.mouse.move(start.x + 165, start.y + 18, { steps: 4 });
  await scrollTo(9900);
  const destination = row("Section 100");
  await destination.waitFor();
  const end = await destination.boundingBox();
  assert.ok(end);
  await page.mouse.move(end.x + 150, end.y + 15, { steps: 4 });
  await page.mouse.move(end.x + 151, end.y + 16);
  await tree
    .locator('[aria-label="Section 100"][data-drop="inside"]')
    .waitFor();
  await page.mouse.up();
  await scrollTo(0);
  assert.equal(await row("Section 51").getAttribute("aria-posinset"), "1");
  assert.equal(await row("Section 51").getAttribute("aria-setsize"), "50");
  for (const [position, name, order] of [
    [5000, "Section 1", "100"],
    [9900, "Section 50", "149"],
  ] as const) {
    await scrollTo(position);
    const moved = row(name);
    assert.equal(await moved.getAttribute("aria-level"), "2");
    assert.equal(await moved.getAttribute("aria-posinset"), order);
    assert.equal(await moved.getAttribute("aria-selected"), "true");
  }
}

const browser = await { chromium, webkit }[engine].launch();
try {
  for (const windowed of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 384 },
    });
    try {
      await page.setContent(
        `<html data-app-theme="design" class="light"><body ${windowed ? "data-windowed" : ""}><main></main></body></html>`,
      );
      for (const file of output) {
        if (file.type === "asset" && file.fileName.endsWith(".css"))
          await page.addStyleTag({ content: String(file.source) });
        if (file.type === "chunk")
          await page.addScriptTag({ content: file.code });
      }
      await page
        .locator('[role="treeitem"]')
        .first()
        .waitFor({ timeout: 120000 });
      const report = await page.evaluate(async () => {
        const tree = document.querySelector('[role="tree"]');
        const first = tree?.querySelector<HTMLElement>('[role="treeitem"]');
        if (!tree || !first) throw new Error("Document tree did not mount");
        first.focus();
        const frame = () =>
          new Promise((resolve) => requestAnimationFrame(resolve));
        const samples: number[] = [];
        const focusedAttribute = (name: string) =>
          document.activeElement?.getAttribute(name);
        for (let i = 0; i < 8; i++) {
          samples.push(await keyFrame("ArrowDown", { shiftKey: true }));
        }
        if (
          focusedAttribute("aria-label") !== "Layer 8" ||
          tree.querySelectorAll('[aria-selected="true"]').length !== 9
        )
          throw new Error("Range selection did not reach Layer 8");
        const mounted = tree.querySelectorAll('[role="treeitem"]').length;
        async function keyFrame(
          key: string,
          modifiers: KeyboardEventInit = {},
        ) {
          await frame();
          const target = document.activeElement;
          if (!target) throw new Error("Tree lost focus");
          const start = performance.now();
          target.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, ...modifiers }),
          );
          await frame();
          return Math.round(performance.now() - start);
        }
        const selectAll = await keyFrame("End", { shiftKey: true });
        if (
          focusedAttribute("aria-label") !== "Layer 99" ||
          focusedAttribute("aria-selected") !== "true"
        )
          throw new Error("Range did not reach the last section");
        await keyFrame("Enter");
        const beginRename = await keyFrame("F2");
        if (!(document.activeElement instanceof HTMLInputElement))
          throw new Error("Rename did not start");
        await keyFrame("Escape");
        const reorder = await keyFrame("ArrowUp", { altKey: true });
        if (focusedAttribute("aria-posinset") !== "98")
          throw new Error("Last layer did not move");
        await keyFrame("Home");
        const collapse = await keyFrame("ArrowLeft");
        if (focusedAttribute("aria-expanded") !== "false")
          throw new Error("Section did not collapse");
        return {
          mounted,
          dispatchToNextFrameMs: samples,
          selectAllMs: selectAll,
          beginRenameMs: beginRename,
          reorderMs: reorder,
          collapseMs: collapse,
        };
      });
      const scroll = windowed ? await measureWindowedScroll(page) : undefined;
      if (windowed) await dragAcrossDocument(page);
      console.log(
        JSON.stringify({
          browser: engine,
          windowed,
          ...report,
          scroll,
          draggedLayers: windowed ? 5000 : 0,
        }),
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
