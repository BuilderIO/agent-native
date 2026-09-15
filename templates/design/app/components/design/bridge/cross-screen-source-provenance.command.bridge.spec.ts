// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { BrowserType, Page } from "@playwright/test";
import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";
import { normalizeScreenHtml } from "@shared/screen-annotation";
const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(require.resolve("@playwright/test"));
const { chromium } = playwrightRequire("playwright") as {
  chromium: BrowserType;
};
import { describe, expect, it } from "vitest";

import { runCrossScreenElementDrop } from "@/pages/design-editor/commands/cross-screen-element-drop";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

const ALPINE_CDN = readFileSync(
  "node_modules/alpinejs/dist/cdn.min.js",
  "utf8",
);

const sourceHtml = `<!doctype html><html><body>
  <main x-data="{items:['runtime alpha','runtime beta']}">
    <template x-for="item in items">
      <button class="same" x-text="item"></button>
    </template>
    <button>authored selected</button>
    <button>authored decoy</button>
  </main>
</body></html>`;

const destinationHtml =
  "<!doctype html><html><body><section>destination</section></body></html>";
const executableScriptSourceHtml = `<!doctype html><html><body>
  <main>
    <script>
      const inserted = document.createElement("button");
      inserted.textContent = "script inserted";
      document.currentScript.insertAdjacentElement("afterend", inserted);
    </script>
    <button>authored selected</button>
    <button>authored decoy</button>
  </main>
</body></html>`;
const duplicateIdSourceHtml = `<!doctype html><html><body>
  <main>
    <button data-agent-native-node-id="duplicate-source">First source</button>
    <button data-agent-native-node-id="duplicate-source">Second source</button>
  </main>
</body></html>`;
const executableDuplicateIdSourceHtml = `<!doctype html><html><body>
  <script>window.__authoredSourceScript = true;</script>
  <main>
    <button data-agent-native-node-id="duplicate-source">First source</button>
    <button data-agent-native-node-id="duplicate-source">Second source</button>
  </main>
</body></html>`;

function editorScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("source"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

async function captureDragStart(page: Page, locator: string): Promise<any> {
  await page.evaluate(() => {
    (window as any).__dragStarts = [];
  });
  const box = await page.locator(locator).boundingBox();
  if (!box) throw new Error(`No bounding box for ${locator}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForFunction(
    () => (window as any).__dragStarts.length > 0,
    undefined,
    { timeout: 3000 },
  );
  const start = await page.evaluate(() => (window as any).__dragStarts[0]);
  await page.mouse.move(x + 12, y + 4, { steps: 2 });
  await page.mouse.up();
  return start;
}

function runCommandFromStart(start: any, sourceContent = sourceHtml) {
  const writes = new Map<string, string>();
  const historyEntries: unknown[] = [];
  runCrossScreenElementDrop(
    {
      applyFileContentUpdate: (fileId, content) => {
        const prepared = prepareCanonicalSourceContent(content, { fileId });
        writes.set(fileId, prepared.content);
        return {
          status: "accepted",
          content: prepared.content,
          nodeIdMap: prepared.nodeIdMap,
        };
      },
      boardFileId: undefined,
      canEditDesign: true,
      clearPendingOverviewLayerSelectionTimer: () => {},
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      designSourceType: "inline",
      getScreenContent: (screenId) =>
        screenId === "source" ? sourceContent : destinationHtml,
      id: undefined,
      overviewScreens: [
        {
          id: "target",
          filename: "target.html",
          content: destinationHtml,
          updatedAt: "2026-09-13T00:00:00.000Z",
          heightPinned: false,
          sourceType: "inline",
        },
      ],
      pendingOverviewLayerSelectionRef: { current: null },
      pendingOverviewScreenSelectionRef: { current: null },
      recordContentHistoryEntry: (entry) => historyEntries.push(entry),
      runtimeStructureInsertRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: () => false,
      setActiveFileId: () => {},
      setCreatedOverviewLayerSelection: () => {},
      setOverviewSelectedScreenIds: () => {},
      setRuntimeStructureInsertRequest: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      t: (key) => key,
      viewModeRef: { current: "overview" },
    },
    {
      sourceSelector: start.selector,
      sourceNodeId: start.sourceId || undefined,
      sourceProvenance: start.sourceProvenance,
      sourceScreenId: "source",
      targetScreenId: "target",
    },
  );
  return { writes, historyEntries };
}

async function captureWithBridge(
  html: string,
  locator: string,
  sourceProvenance: unknown,
  loadAlpine = false,
) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setContent(html);
  if (loadAlpine) {
    await page.addScriptTag({ content: ALPINE_CDN });
    await page.waitForFunction(
      () => document.querySelectorAll("button.same").length === 1,
    );
  }
  await page.evaluate((provenance) => {
    if (provenance) {
      (window as any).__agentNativeSourceProvenance = provenance;
    }
    (window as any).__dragStarts = [];
    window.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      if (
        data?.type === "agent-native:cross-screen-drag" &&
        data.phase === "start"
      ) {
        (window as any).__dragStarts.push(data);
      }
    });
  }, sourceProvenance);
  await page.addScriptTag({ content: editorScript() });
  const start = await captureDragStart(page, locator);
  return { browser, page, pageErrors, start };
}

describe("bridge provenance through the cross-screen command", () => {
  it.each([
    { index: 0, selected: "First source", other: "Second source" },
    { index: 1, selected: "Second source", other: "First source" },
  ])(
    "moves duplicate-ID source node $selected using its captured positional selector",
    async ({ index, selected, other }) => {
      const proof = createSourceDocumentProvenance(duplicateIdSourceHtml);
      const { browser, pageErrors, start } = await captureWithBridge(
        duplicateIdSourceHtml,
        `button[data-agent-native-node-id="duplicate-source"]:nth-of-type(${index + 1})`,
        proof,
      );
      try {
        expect(start.sourceId).toBe("duplicate-source");
        expect(start.sourceProvenance).toMatchObject({
          versionHash: proof.versionHash,
        });
        expect(start.sourceProvenance).not.toHaveProperty("uniqueNodeId");
        const { writes, historyEntries } = runCommandFromStart(
          start,
          duplicateIdSourceHtml,
        );
        expect(writes.get("source")).toBeDefined();
        expect(writes.get("source")).not.toContain(selected);
        expect(writes.get("source")).toContain(other);
        expect(writes.get("target")).toContain(selected);
        expect(writes.get("target")).not.toContain(other);
        expect(historyEntries).toHaveLength(1);
        expect(start.selector).toContain(`nth-of-type(${index + 1})`);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it("does not emit duplicate-ID positional proof for a script-bearing source", async () => {
    const proof = createSourceDocumentProvenance(
      executableDuplicateIdSourceHtml,
    );
    expect(proof.versionHash).toBe("");
    const { browser, pageErrors, start } = await captureWithBridge(
      executableDuplicateIdSourceHtml,
      'button[data-agent-native-node-id="duplicate-source"]:nth-of-type(2)',
      proof,
    );
    try {
      expect(start.sourceId).toBe("duplicate-source");
      expect(start.sourceProvenance).toBeUndefined();
      expect(start.selector).toBe(
        '[data-agent-native-node-id="duplicate-source"]',
      );
      const { writes, historyEntries } = runCommandFromStart(
        start,
        executableDuplicateIdSourceHtml,
      );
      expect(writes.size).toBe(0);
      expect(historyEntries).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("moves an authored button after idless Alpine repeat siblings to its own source node", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.setContent(sourceHtml);
      await page.addScriptTag({ content: ALPINE_CDN });
      await page.waitForFunction(
        () => document.querySelectorAll("button.same").length === 2,
      );
      await page.evaluate((provenance) => {
        (window as any).__agentNativeSourceProvenance = provenance;
        (window as any).__dragStarts = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (
            data?.type === "agent-native:cross-screen-drag" &&
            data.phase === "start"
          ) {
            (window as any).__dragStarts.push(data);
          }
        });
      }, createSourceDocumentProvenance(sourceHtml));
      await page.addScriptTag({ content: editorScript() });

      const start = await captureDragStart(
        page,
        'button:has-text("authored selected")',
      );
      expect(start.sourceProvenance).toMatchObject({
        versionHash: createSourceDocumentProvenance(sourceHtml).versionHash,
      });
      const { writes, historyEntries } = runCommandFromStart(start);
      expect(
        writes.get("source"),
        JSON.stringify({
          selector: start.selector,
          sourceId: start.sourceId,
          sourceProvenance: start.sourceProvenance,
          writes: [...writes.keys()],
        }),
      ).toBeDefined();
      expect(writes.get("source")).not.toContain("authored selected");
      expect(writes.get("source")).toContain("authored decoy");
      expect(writes.get("target")).toContain("authored selected");
      expect(writes.get("target")).not.toContain("authored decoy");
      expect(historyEntries).toHaveLength(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("refuses an idless runtime clone even when its live selector aliases authored source", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.setContent(sourceHtml);
      await page.addScriptTag({ content: ALPINE_CDN });
      await page.waitForFunction(
        () => document.querySelectorAll("button.same").length === 2,
      );
      await page.evaluate((provenance) => {
        (window as any).__agentNativeSourceProvenance = provenance;
        (window as any).__dragStarts = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (
            data?.type === "agent-native:cross-screen-drag" &&
            data.phase === "start"
          ) {
            (window as any).__dragStarts.push(data);
          }
        });
      }, createSourceDocumentProvenance(sourceHtml));
      await page.addScriptTag({ content: editorScript() });

      const start = await captureDragStart(
        page,
        'button.same:has-text("runtime beta")',
      );
      const { writes, historyEntries } = runCommandFromStart(start);
      expect({
        selector: start.selector,
        sourceId: start.sourceId,
        proof: start.sourceProvenance,
        writes: [...writes.keys()],
      }).toEqual({
        selector: expect.any(String),
        sourceId: "",
        proof: undefined,
        writes: [],
      });
      expect(historyEntries).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("refuses an idless source node after executable script inserts a same-tag sibling", async () => {
    const proof = createSourceDocumentProvenance(executableScriptSourceHtml);
    expect(proof.versionHash).toBe("");
    const { browser, page, pageErrors, start } = await captureWithBridge(
      executableScriptSourceHtml,
      'button:has-text("authored selected")',
      proof,
    );
    try {
      expect(start.selector).toContain("nth-of-type(2)");
      expect(start.sourceId).toBe("");
      expect(start.sourceProvenance).toBeUndefined();

      const { writes, historyEntries } = runCommandFromStart(
        start,
        executableScriptSourceHtml,
      );
      expect(writes.size).toBe(0);
      expect(historyEntries).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("uses normalized stable IDs when scripts make positional proof unavailable", async () => {
    const normalized = normalizeScreenHtml(executableScriptSourceHtml).content;
    const proof = createSourceDocumentProvenance(normalized);
    expect(proof.versionHash).toBe("");
    const { browser, page, pageErrors, start } = await captureWithBridge(
      normalized,
      'button:has-text("authored selected")',
      proof,
    );
    try {
      expect(start.sourceId).toBeTruthy();
      expect(start.sourceProvenance).toEqual({ uniqueNodeId: start.sourceId });

      const { writes, historyEntries } = runCommandFromStart(start, normalized);
      expect(writes.get("source")).toBeDefined();
      expect(writes.get("source")).not.toContain("authored selected");
      expect(writes.get("source")).toContain("authored decoy");
      expect(writes.get("target")).toContain("authored selected");
      expect(writes.get("target")).not.toContain("authored decoy");
      expect(historyEntries).toHaveLength(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("refuses a normalized Alpine template clone despite its unique copied source ID", async () => {
    const oneRowSourceHtml = sourceHtml.replace(
      "items:['runtime alpha','runtime beta']",
      "items:['runtime alpha']",
    );
    const normalized = normalizeScreenHtml(oneRowSourceHtml).content;
    const proof = createSourceDocumentProvenance(normalized);
    const { browser, page, pageErrors, start } = await captureWithBridge(
      normalized,
      'button.same:has-text("runtime alpha")',
      proof,
      true,
    );
    try {
      expect(start.sourceId).toBeTruthy();
      expect(proof.uniqueNodeIds).toContain(start.sourceId);
      expect(
        await page
          .locator(`[data-agent-native-node-id="${start.sourceId}"]`)
          .count(),
      ).toBe(1);
      expect(start.sourceProvenance).toBeUndefined();

      const { writes, historyEntries } = runCommandFromStart(start, normalized);
      expect(writes.size).toBe(0);
      expect(historyEntries).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);
});
