// @vitest-environment happy-dom

import { createRequire } from "node:module";

import type { BrowserType } from "@playwright/test";
import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";
const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(require.resolve("@playwright/test"));
const { chromium } = playwrightRequire("playwright") as {
  chromium: BrowserType;
};
import { describe, expect, it } from "vitest";

import { runCrossScreenElementDrop } from "@/pages/design-editor/commands/cross-screen-element-drop";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

const sourceHtml = `<!doctype html><html><body>
  <button data-agent-native-node-id="moving">Moving layer</button>
</body></html>`;

const destinationHtml = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;flex-direction:column;gap:0;width:320px;margin:20px">
    <section style="width:280px;height:100px;flex:none"><span>First anchor</span></section>
    <section style="width:280px;height:100px;flex:none"><span>Second anchor</span></section>
  </main>
</body></html>`;
const duplicateIdDestinationHtml = `<!doctype html><html><body style="margin:0">
  <main style="display:flex;flex-direction:column;gap:0;width:320px;margin:20px">
    <section data-agent-native-node-id="shared-anchor" style="width:280px;height:100px;flex:none"><span>First anchor</span></section>
    <section data-agent-native-node-id="shared-anchor" style="width:280px;height:100px;flex:none"><span>Second anchor</span></section>
  </main>
</body></html>`;
const executableDuplicateIdDestinationHtml = `<!doctype html><html><body style="margin:0">
  <script>window.__authoredTargetScript = true;</script>
  <main style="display:flex;flex-direction:column;gap:0;width:320px;margin:20px">
    <section data-agent-native-node-id="shared-anchor" style="width:280px;height:100px;flex:none"><span>First anchor</span></section>
    <section data-agent-native-node-id="shared-anchor" style="width:280px;height:100px;flex:none"><span>Second anchor</span></section>
  </main>
</body></html>`;

async function captureFirstAnchorHitTest(
  targetContent = destinationHtml,
  y = 42,
) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setContent(targetContent);
  await page.evaluate((provenance) => {
    (window as any).__agentNativeSourceProvenance = provenance;
    (window as any).__hitTestResults = [];
    window.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      if (data?.type === "agent-native:hit-test-result") {
        (window as any).__hitTestResults.push(data);
      }
    });
  }, createSourceDocumentProvenance(targetContent));
  await page.addScriptTag({ content: hitTestBridgeScript });
  await page.evaluate((hitY) => {
    window.postMessage(
      {
        type: "agent-native:hit-test",
        correlationId: "first-section",
        x: 80,
        y: hitY,
      },
      "*",
    );
  }, y);
  await page.waitForFunction(
    () => (window as any).__hitTestResults.length === 1,
  );
  const packet = await page.evaluate(() => (window as any).__hitTestResults[0]);
  return { browser, pageErrors, packet };
}

function runCommandFromHitTest(
  packet: any,
  options: { duplicate: boolean; includePendingNodeId: boolean },
  targetContent = destinationHtml,
) {
  const writes = new Map<string, string>();
  const currentContentByScreenId = new Map([
    ["source", sourceHtml],
    ["target", targetContent],
  ]);
  const historyEntries: unknown[] = [];
  runCrossScreenElementDrop(
    {
      applyFileContentUpdate: (fileId, content) => {
        const prepared = prepareCanonicalSourceContent(content, { fileId });
        writes.set(fileId, prepared.content);
        currentContentByScreenId.set(fileId, prepared.content);
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
        currentContentByScreenId.get(screenId) ?? "",
      id: undefined,
      overviewScreens: [
        {
          id: "target",
          filename: "target.html",
          content: targetContent,
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
      sourceSelector: '[data-agent-native-node-id="moving"]',
      sourceNodeId: "moving",
      sourceProvenance: { uniqueNodeId: "moving" },
      sourceScreenId: "source",
      targetScreenId: "target",
      targetAnchorNodeId: packet.anchorNodeId || undefined,
      targetAnchorPendingNodeId: options.includePendingNodeId
        ? packet.pendingNodeId
        : undefined,
      targetAnchorSelector: packet.anchorSelector,
      targetAnchorProvenance: packet.targetAnchorProvenance,
      targetAnchorPlacement: packet.placement,
      targetDropMode: packet.dropMode,
      duplicate: options.duplicate,
      sourceCloneHtml: options.duplicate
        ? '<button data-agent-native-node-id="moving">Moving layer</button>'
        : undefined,
    },
  );
  return { writes, historyEntries };
}

describe("hit-test target provenance through the cross-screen command", () => {
  it.each([
    { includePendingNodeId: true, label: "with the pending ID" },
    { includePendingNodeId: false, label: "without the pending ID" },
  ])(
    "moves before the first idless auto-layout anchor $label",
    async ({ includePendingNodeId }) => {
      const { browser, pageErrors, packet } = await captureFirstAnchorHitTest();
      try {
        expect(packet).toMatchObject({
          anchorNodeId: "",
          targetAnchorProvenance: {
            versionHash:
              createSourceDocumentProvenance(destinationHtml).versionHash,
          },
          pendingNodeId: expect.any(String),
          anchorSelector: expect.stringContaining(":nth-of-type(1)"),
          placement: "before",
        });

        const { writes, historyEntries } = runCommandFromHitTest(packet, {
          duplicate: false,
          includePendingNodeId,
        });
        const nextDestination = writes.get("target");
        expect(
          writes.get("source"),
          JSON.stringify({
            packet,
            writes: [...writes.keys()],
            historyEntries,
          }),
        ).toBeDefined();
        expect(nextDestination).toBeDefined();
        const moved = new DOMParser()
          .parseFromString(nextDestination!, "text/html")
          .querySelector('[data-agent-native-node-id="moving"]');
        const mainChildren = Array.from(moved?.parentElement?.children ?? []);
        const firstAnchor = mainChildren.findIndex((node) =>
          node.textContent?.includes("First anchor"),
        );
        const secondAnchor = mainChildren.findIndex((node) =>
          node.textContent?.includes("Second anchor"),
        );
        expect(moved?.parentElement?.tagName).toBe("MAIN");
        expect(moved ? mainChildren.indexOf(moved) : -1).toBeLessThan(
          firstAnchor,
        );
        expect(firstAnchor).toBeLessThan(secondAnchor);
        expect(
          nextDestination!.indexOf("Moving layer"),
          JSON.stringify({ packet, destination: nextDestination }),
        ).toBeLessThan(nextDestination!.indexOf("First anchor"));
        expect(nextDestination!.indexOf("First anchor")).toBeLessThan(
          nextDestination!.indexOf("Second anchor"),
        );
        expect(historyEntries).toHaveLength(1);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it.each([
    { includePendingNodeId: true, label: "with the pending ID" },
    { includePendingNodeId: false, label: "without the pending ID" },
  ])(
    "duplicates before the first idless auto-layout anchor $label",
    async ({ includePendingNodeId }) => {
      const { browser, pageErrors, packet } = await captureFirstAnchorHitTest();
      try {
        expect(packet).toMatchObject({
          anchorNodeId: "",
          targetAnchorProvenance: {
            versionHash:
              createSourceDocumentProvenance(destinationHtml).versionHash,
          },
          pendingNodeId: expect.any(String),
          anchorSelector: expect.stringContaining(":nth-of-type(1)"),
          placement: "before",
        });

        const { writes, historyEntries } = runCommandFromHitTest(packet, {
          duplicate: true,
          includePendingNodeId,
        });
        const nextDestination = writes.get("target");
        expect(nextDestination).toBeDefined();
        const parsed = new DOMParser().parseFromString(
          nextDestination!,
          "text/html",
        );
        const copies = parsed.querySelectorAll("button");
        expect(copies).toHaveLength(1);
        const moved = copies[0];
        expect(moved.textContent).toBe("Moving layer");
        expect(moved.getAttribute("data-agent-native-node-id")).toBeTruthy();
        expect(moved.getAttribute("data-agent-native-node-id")).not.toBe(
          "moving",
        );
        const mainChildren = Array.from(moved?.parentElement?.children ?? []);
        const firstAnchor = mainChildren.findIndex((node) =>
          node.textContent?.includes("First anchor"),
        );
        const secondAnchor = mainChildren.findIndex((node) =>
          node.textContent?.includes("Second anchor"),
        );
        expect(moved?.parentElement?.tagName).toBe("MAIN");
        expect(moved ? mainChildren.indexOf(moved) : -1).toBeLessThan(
          firstAnchor,
        );
        expect(firstAnchor).toBeLessThan(secondAnchor);
        expect(writes.has("source")).toBe(false);
        expect(historyEntries).toHaveLength(1);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it.each([
    { duplicate: false, anchorIndex: 0, y: 42, label: "move before first" },
    { duplicate: false, anchorIndex: 1, y: 142, label: "move before second" },
    { duplicate: true, anchorIndex: 0, y: 42, label: "duplicate before first" },
    {
      duplicate: true,
      anchorIndex: 1,
      y: 142,
      label: "duplicate before second",
    },
  ])(
    "uses the captured selector to $label duplicate-ID authored anchors",
    async ({ duplicate, anchorIndex, y }) => {
      const { browser, pageErrors, packet } = await captureFirstAnchorHitTest(
        duplicateIdDestinationHtml,
        y,
      );
      try {
        expect(packet).toMatchObject({
          anchorNodeId: "shared-anchor",
          targetAnchorProvenance: {
            versionHash: createSourceDocumentProvenance(
              duplicateIdDestinationHtml,
            ).versionHash,
          },
          placement: "before",
        });
        expect(packet.targetAnchorProvenance).not.toHaveProperty(
          "uniqueNodeId",
        );
        expect(packet.anchorSelector).toEqual(expect.any(String));
        expect(packet.anchorSelector).toContain(
          `nth-of-type(${anchorIndex + 1})`,
        );

        const { writes, historyEntries } = runCommandFromHitTest(
          packet,
          { duplicate, includePendingNodeId: false },
          duplicateIdDestinationHtml,
        );
        const nextDestination = writes.get("target");
        expect(
          nextDestination,
          JSON.stringify({
            packet,
            writes: [...writes.keys()],
            historyEntries,
          }),
        ).toBeDefined();
        const parsed = new DOMParser().parseFromString(
          nextDestination!,
          "text/html",
        );
        const movingLayers = parsed.querySelectorAll("button");
        expect(movingLayers).toHaveLength(1);
        const moving = movingLayers[0];
        expect(moving.textContent).toBe("Moving layer");
        const movingId = moving.getAttribute("data-agent-native-node-id");
        if (duplicate) {
          expect(movingId).toBeTruthy();
          expect(movingId).not.toBe("moving");
        } else {
          expect(movingId).toBe("moving");
        }
        const anchors = Array.from(parsed.querySelectorAll("main > section"));
        const mainChildren = Array.from(moving?.parentElement?.children ?? []);
        expect(moving?.parentElement?.tagName).toBe("MAIN");
        expect(anchors).toHaveLength(2);
        expect(anchors[0]?.textContent).toContain("First anchor");
        expect(anchors[1]?.textContent).toContain("Second anchor");
        expect(mainChildren.indexOf(moving!)).toBeLessThan(
          mainChildren.indexOf(anchors[anchorIndex]),
        );
        if (anchorIndex === 1) {
          expect(mainChildren.indexOf(anchors[0])).toBeLessThan(
            mainChildren.indexOf(moving!),
          );
        }
        expect(writes.has("source")).toBe(!duplicate);
        expect(historyEntries).toHaveLength(1);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it("omits duplicate-ID positional proof for a script-bearing target", async () => {
    const { browser, pageErrors, packet } = await captureFirstAnchorHitTest(
      executableDuplicateIdDestinationHtml,
    );
    try {
      expect(packet.anchorNodeId).toBe("shared-anchor");
      expect(packet.anchorSelector).toBeUndefined();
      expect(packet.targetAnchorProvenance).toBeUndefined();

      const { writes, historyEntries } = runCommandFromHitTest(
        packet,
        { duplicate: false, includePendingNodeId: false },
        executableDuplicateIdDestinationHtml,
      );
      expect(writes.size).toBe(0);
      expect(historyEntries).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("refuses a static duplicate-ID packet after destination bytes change", async () => {
    const { browser, pageErrors, packet } = await captureFirstAnchorHitTest(
      duplicateIdDestinationHtml,
    );
    try {
      expect(packet.anchorSelector).toEqual(expect.any(String));
      const changedDestination = duplicateIdDestinationHtml.replace(
        "First anchor",
        "Edited first anchor",
      );
      const { writes, historyEntries } = runCommandFromHitTest(
        packet,
        { duplicate: false, includePendingNodeId: false },
        changedDestination,
      );
      expect(writes.size).toBe(0);
      expect(historyEntries).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);
});
