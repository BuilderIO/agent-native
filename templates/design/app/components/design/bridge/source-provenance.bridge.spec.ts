import { readFileSync } from "node:fs";

import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

const ALPINE_CDN = readFileSync(
  new URL("../../../../node_modules/alpinejs/dist/cdn.min.js", import.meta.url),
  "utf8",
);

function editorScript(textEditing = false): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", textEditing ? "true" : "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("provenance-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace("__LIVE_REFLOW_ENABLED__", "false")
    .replace("__SELECTED_LAYER_DRAG_PRIORITY__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

function measuredEditorScript(): string {
  const source = editorScript();
  const measured = source
    .replace(
      'if (typeof html !== "string") return;',
      'if (typeof html !== "string") return; var __morphMeasureId = window.__sourceMorphMeasureId; var __morphMeasureStart = performance.now();',
    )
    .replace(
      "publishSourceDocumentProvenance(void 0, true);\n          return;",
      "publishSourceDocumentProvenance(void 0, true); window.__sourceMorphTimes.push({id: __morphMeasureId, milliseconds: performance.now() - __morphMeasureStart});\n          return;",
    )
    .replace(
      "morphRuntimeBody(nextDoc.body);\n      publishSourceDocumentProvenance(sourceProvenance);",
      "morphRuntimeBody(nextDoc.body); window.__sourceMorphTimes.push({id: __morphMeasureId, milliseconds: performance.now() - __morphMeasureStart});\n      publishSourceDocumentProvenance(sourceProvenance);",
    );
  if (measured === source || !measured.includes("__sourceMorphTimes.push")) {
    throw new Error("Could not instrument the generated bridge morph timings");
  }
  return measured;
}

async function openEditorPage(
  html: string,
  textEditing = false,
  sourceProvenance?: { versionHash: string; uniqueNodeIds: string[] },
) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setContent(html);
  if (sourceProvenance) {
    await page.evaluate((provenance) => {
      (window as any).__agentNativeSourceProvenance = provenance;
    }, sourceProvenance);
  }
  await page.addScriptTag({ content: editorScript(textEditing) });
  return { browser, page, pageErrors };
}

async function sendReplace(
  page: Page,
  content: string,
  options: {
    selector?: string;
    forceFullDocument?: boolean;
    preserveTextEditingSession?: boolean;
    sourceProvenance?: { versionHash: string; uniqueNodeIds: string[] };
  } = {},
): Promise<void> {
  await page.evaluate(
    ({ html, opts }) => {
      window.postMessage(
        {
          type: "replace-document-content",
          content: html,
          selectedSelector: opts.selector ?? "",
          selectorCandidates: opts.selector ? [opts.selector] : [],
          forceFullDocument: opts.forceFullDocument ?? false,
          preserveTextEditingSession: opts.preserveTextEditingSession ?? false,
          sourceProvenance: opts.sourceProvenance,
        },
        "*",
      );
    },
    { html: content, opts: options },
  );
}

const sourceDocument = (body: string, label = "source") =>
  `<!doctype html><html><head><style id="theme">#target{color:rgb(15, 80, 160)}</style></head><body data-source-label="${label}">${body}</body></html>`;

const LARGE_NODE_IDS = Array.from(
  { length: 750 },
  (_, index) => `node-${index}`,
);

function largeAutoLayoutRepeatDocument(targetText: string): string {
  const groups = Array.from({ length: 15 }, (_, groupIndex) => {
    const nodes = Array.from({ length: 50 }, (_, itemIndex) => {
      const index = groupIndex * 50 + itemIndex;
      const label = index === 0 ? targetText : `Item ${index}`;
      return `<article id="node-${index}" data-agent-native-node-id="node-${index}" class="item">${label}<small>${groupIndex}:${itemIndex}</small></article>`;
    }).join("");
    return `<section id="group-${groupIndex}" class="auto-layout" x-data="{items:[{id:'repeat-${groupIndex}-a',name:'Repeat ${groupIndex} A'},{id:'repeat-${groupIndex}-b',name:'Repeat ${groupIndex} B'}],counter:${groupIndex}}" style="display:flex;gap:4px"><strong class="runtime-counter" x-text="counter"></strong><template x-for="item in items" :key="item.id"><article class="repeat-instance" :data-repeat-id="item.id"><span x-text="item.name"></span></article></template>${nodes}</section>`;
  }).join("");
  return `<!doctype html><html><head><style id="theme">.board{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.item{min-width:20px}</style></head><body><main id="board" class="board">${groups}</main></body></html>`;
}

describe("rendered-source provenance in the iframe bridges", () => {
  it("matches a line-break source id in a quoted hit-test attribute selector", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 400 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(
        '<!doctype html><html><body style="margin:0"><div data-agent-native-node-id="line&#10;break" style="position:absolute;left:100px;top:80px;width:240px;height:160px"></div></body></html>',
      );
      const sourceId = "line\nbreak";
      await page.evaluate((nodeId) => {
        Object.defineProperty(window.CSS, "escape", {
          configurable: true,
          value: undefined,
        });
        (window as any).__agentNativeSourceProvenance = {
          versionHash: "source-line-break",
          uniqueNodeIds: [nodeId],
        };
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(data);
          }
        });
      }, sourceId);
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "line-break-id",
            x: 150,
            y: 110,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );
      const result = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );

      expect(result).toMatchObject({
        anchorNodeId: sourceId,
        targetAnchorProvenance: {
          versionHash: "source-line-break",
          uniqueNodeId: sourceId,
        },
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("preserves a legacy layer-name in hit-test metadata", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 400 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(
        '<!doctype html><html><body style="margin:0"><div data-agent-native-node-id="legacy-card" layer-name="Imported card" style="position:absolute;left:100px;top:80px;width:240px;height:160px"></div></body></html>',
      );
      await page.evaluate(() => {
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(data);
          }
        });
      });
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "legacy-layer-name",
            x: 150,
            y: 110,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );
      const result = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );

      expect(result).toMatchObject({
        anchorNodeId: "legacy-card",
        layerName: "Imported card",
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("preserves line breaks in a unique authored id used for drag provenance", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const sourceId = "line\nbreak";
      await page.setContent(
        sourceDocument(
          '<div class="line-break-target" data-agent-native-node-id="line&#10;break" style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>',
        ),
      );
      await page.evaluate((nodeId) => {
        Object.defineProperty(window.CSS, "escape", {
          configurable: true,
          value: undefined,
        });
        (window as any).__agentNativeSourceProvenance = {
          versionHash: "source-line-break",
          uniqueNodeIds: [nodeId],
        };
        (window as any).__crossScreenMessages = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (data?.type !== "agent-native:cross-screen-drag") return;
          (window as any).__crossScreenMessages.push(data);
          if (data.phase === "move" && !(window as any).__claimSent) {
            (window as any).__claimSent = true;
            setTimeout(() => {
              window.postMessage(
                { type: "agent-native:cross-screen-claim", claimed: true },
                "*",
              );
            }, 4);
          }
        });
      }, sourceId);
      await page.addScriptTag({ content: editorScript() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: ".line-break-target",
          },
          "*",
        );
      });
      await page.waitForTimeout(30);
      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(150, 350);
      await page.waitForFunction(() =>
        (window as any).__crossScreenMessages.some(
          (message: any) => message.phase === "start",
        ),
      );
      const start = await page.evaluate(() =>
        (window as any).__crossScreenMessages.find(
          (message: any) => message.phase === "start",
        ),
      );
      await page.mouse.up();

      expect(start).toMatchObject({
        sourceId,
        sourceProvenance: {
          versionHash: "source-line-break",
          uniqueNodeId: sourceId,
        },
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("does not publish a deferred revision until the full body morph runs after text editing", async () => {
    const { browser, page, pageErrors } = await openEditorPage(
      sourceDocument(
        '<div id="target" data-agent-native-node-id="target" style="position:absolute;left:80px;top:80px;width:260px;height:60px">Original text</div><div id="keep" data-agent-native-node-id="keep">Keep me</div>',
      ),
      true,
      { versionHash: "source-v1", uniqueNodeIds: ["target", "keep"] },
    );
    try {
      await page.evaluate(() => {
        (window as any).__bridgeLifetime = { token: "same-window" };
      });
      const keptNode = await page.locator("#keep").elementHandle();
      await keptNode?.evaluate((node) => {
        (node as HTMLElement & { __retainedToken?: string }).__retainedToken =
          "same-node";
      });
      await page.evaluate(() => {
        window.postMessage(
          { type: "begin-text-edit", nodeId: "target", force: true },
          "*",
        );
      });
      await page.waitForSelector("[data-agent-native-text-editing]");

      const next = sourceDocument(
        '<div id="target" data-agent-native-node-id="target" style="position:absolute;left:80px;top:80px;width:260px;height:60px">Updated text</div><div id="keep" data-agent-native-node-id="keep">Keep me</div><div id="new-node" data-agent-native-node-id="new-node">Inserted</div>',
        "updated",
      );
      await sendReplace(page, next, {
        preserveTextEditingSession: true,
        sourceProvenance: {
          versionHash: "source-v2",
          uniqueNodeIds: ["target", "keep", "new-node"],
        },
      });
      await page.waitForTimeout(30);

      expect(
        await page.evaluate(
          () => (window as any).__agentNativeSourceProvenance.versionHash,
        ),
      ).toBe("source-v1");
      expect(await page.locator("#new-node").count()).toBe(0);

      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          (window as any).__agentNativeSourceProvenance?.versionHash ===
            "source-v2" && document.querySelector("#new-node"),
      );

      const lifetimeState = await page.evaluate(() => ({
        sameWindow: (window as any).__bridgeLifetime?.token === "same-window",
        themeColor: getComputedStyle(document.querySelector("#target")!).color,
        sourceLabel: document.body.getAttribute("data-source-label"),
        overlayPresent: !!document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        ),
        provenance: (window as any).__agentNativeSourceProvenance,
      }));
      expect(lifetimeState).toEqual({
        sameWindow: true,
        themeColor: "rgb(15, 80, 160)",
        sourceLabel: "updated",
        overlayPresent: true,
        provenance: {
          versionHash: "source-v2",
          uniqueNodeIds: ["target", "keep", "new-node"],
        },
      });
      expect(
        await page
          .locator("#keep")
          .evaluate(
            (node) =>
              (node as HTMLElement & { __retainedToken?: string })
                .__retainedToken,
          ),
      ).toBe("same-node");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("invalidates only the revision on a legacy partial morph and retains its known ids", async () => {
    const { browser, page, pageErrors } = await openEditorPage(
      sourceDocument(
        '<div id="target" data-agent-native-node-id="target">Original</div><div id="keep" data-agent-native-node-id="keep">Keep</div>',
      ),
      false,
      {
        versionHash: "source-v1",
        uniqueNodeIds: ["target", "keep", "deleted-later"],
      },
    );
    try {
      await sendReplace(
        page,
        sourceDocument(
          '<div id="target" data-agent-native-node-id="target">Partially updated</div><div id="keep" data-agent-native-node-id="keep">Keep</div>',
        ),
        { selector: "#target" },
      );
      await page.waitForFunction(
        () =>
          document.querySelector("#target")?.textContent ===
          "Partially updated",
      );

      expect(
        await page.evaluate(
          () => (window as any).__agentNativeSourceProvenance,
        ),
      ).toEqual({
        versionHash: undefined,
        uniqueNodeIds: ["target", "keep", "deleted-later"],
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("invalidates the source revision on a host-driven structural deletion", async () => {
    const { browser, page, pageErrors } = await openEditorPage(
      `<!doctype html><html><body><div id="remove-me" data-agent-native-node-id="remove-me">Remove</div><div id="keep-me" data-agent-native-node-id="keep-me">Keep</div></body></html>`,
      false,
      { versionHash: "source-v1", uniqueNodeIds: ["remove-me", "keep-me"] },
    );
    try {
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "delete-element",
            selector: "#remove-me",
            selectorCandidates: ["#remove-me"],
            requestId: "delete-test",
          },
          "*",
        );
      });
      await page.waitForFunction(() => !document.querySelector("#remove-me"));
      expect(
        await page.evaluate(
          () => (window as any).__agentNativeSourceProvenance,
        ),
      ).toEqual({ uniqueNodeIds: ["remove-me", "keep-me"] });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("captures drag provenance with its start selector and source id", async () => {
    const { browser, page, pageErrors } = await openEditorPage(
      `<!doctype html><html><body style="margin:0"><div data-agent-native-node-id="widget" style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div></body></html>`,
      false,
      { versionHash: "source-v1", uniqueNodeIds: ["widget"] },
    );
    try {
      await page.evaluate(() => {
        (window as any).__crossScreenMessages = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (data?.type === "agent-native:cross-screen-drag") {
            (window as any).__crossScreenMessages.push(data);
            if (data.phase === "move" && !(window as any).__claimSent) {
              (window as any).__claimSent = true;
              setTimeout(() => {
                window.postMessage(
                  { type: "agent-native:cross-screen-claim", claimed: true },
                  "*",
                );
              }, 4);
            }
          }
        });
      });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="widget"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);
      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(150, 350);
      await page.waitForFunction(() =>
        (window as any).__crossScreenMessages.some(
          (message: any) => message.phase === "start",
        ),
      );
      await page.evaluate(() => {
        (window as any).__agentNativeSourceProvenance = {
          versionHash: "source-v2",
          uniqueNodeIds: [],
        };
      });
      await page.mouse.move(190, 370);
      await page.waitForTimeout(20);
      await page.mouse.up();
      await page.waitForTimeout(30);

      const dragMessages = await page.evaluate(
        () => (window as any).__crossScreenMessages,
      );
      const start = dragMessages.find(
        (message: any) => message.phase === "start",
      );
      const move = dragMessages.find(
        (message: any) => message.phase === "move",
      );
      const end = dragMessages.find((message: any) => message.phase === "end");
      expect(start).toMatchObject({
        selector: '[data-agent-native-node-id="widget"]',
        sourceId: "widget",
        sourceProvenance: {
          versionHash: "source-v1",
          uniqueNodeId: "widget",
        },
      });
      expect(move).toMatchObject({
        selector: start.selector,
        sourceId: start.sourceId,
        sourceProvenance: start.sourceProvenance,
      });
      expect(
        end,
        JSON.stringify(
          dragMessages.map((message: any) => ({
            phase: message.phase,
            selector: message.selector,
            sourceId: message.sourceId,
          })),
        ),
      ).toMatchObject({
        selector: start.selector,
        sourceId: start.sourceId,
        sourceProvenance: start.sourceProvenance,
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("counts a matching secondary ID alias beside a preferred source ID", async () => {
    const { browser, page, pageErrors } = await openEditorPage(
      sourceDocument(
        '<div data-agent-native-node-id="widget" style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div><aside id="widget" data-agent-native-node-id="preferred-widget" style="position:absolute;left:500px;top:280px;width:40px;height:30px"></aside>',
      ),
      false,
      { versionHash: "source-v1", uniqueNodeIds: ["widget"] },
    );
    try {
      await page.evaluate(() => {
        (window as any).__crossScreenMessages = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (data?.type === "agent-native:cross-screen-drag") {
            (window as any).__crossScreenMessages.push(data);
            if (data.phase === "move" && !(window as any).__claimSent) {
              (window as any).__claimSent = true;
              setTimeout(() => {
                window.postMessage(
                  { type: "agent-native:cross-screen-claim", claimed: true },
                  "*",
                );
              }, 4);
            }
          }
        });
        window.postMessage(
          {
            type: "select-element",
            selector: '[data-agent-native-node-id="widget"]',
          },
          "*",
        );
      });
      await page.waitForTimeout(30);
      await page.mouse.move(90, 320);
      await page.mouse.down();
      await page.mouse.move(150, 350);
      await page.waitForFunction(() =>
        (window as any).__crossScreenMessages.some(
          (message: any) => message.phase === "start",
        ),
      );
      const start = await page.evaluate(() =>
        (window as any).__crossScreenMessages.find(
          (message: any) => message.phase === "start",
        ),
      );
      expect(start).toMatchObject({
        sourceId: "widget",
        sourceProvenance: { versionHash: "source-v1" },
      });
      expect(start.sourceProvenance).not.toHaveProperty("uniqueNodeId");
      await page.mouse.up();
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("invalidates a committed optimistic reorder before the next drag", async () => {
    const { browser, page, pageErrors } = await openEditorPage(
      `<!doctype html><html><body style="margin:0"><div id="container" data-agent-native-node-id="container" style="position:absolute;left:300px;top:180px;width:360px;height:300px;border:1px solid #999"></div><div id="widget" data-agent-native-node-id="widget" style="position:absolute;left:30px;top:280px;width:100px;height:80px;background:#3b82f6"></div></body></html>`,
      false,
      { versionHash: "source-v1", uniqueNodeIds: ["widget", "container"] },
    );
    try {
      await page.evaluate(() => {
        (window as any).__bridgeEvents = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (
            data?.type === "agent-native:cross-screen-drag" ||
            data?.type === "visual-structure-change"
          ) {
            (window as any).__bridgeEvents.push(data);
          }
        });
        window.postMessage(
          { type: "select-element", selector: "#widget" },
          "*",
        );
      });
      await page.waitForTimeout(30);
      const firstStart = await page.locator("#widget").boundingBox();
      expect(firstStart).not.toBeNull();
      await page.mouse.move(
        firstStart!.x + firstStart!.width / 2,
        firstStart!.y + firstStart!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(420, 300, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          document.querySelector("#container #widget") &&
          (window as any).__bridgeEvents.some(
            (event: any) => event.type === "visual-structure-change",
          ),
        undefined,
        { timeout: 2500 },
      );

      expect(
        await page.evaluate(
          () => (window as any).__agentNativeSourceProvenance,
        ),
      ).toEqual({ uniqueNodeIds: ["widget", "container"] });

      const countBeforeSecondDrag = await page.evaluate(
        () => (window as any).__bridgeEvents.length,
      );
      await page.evaluate(() => {
        window.postMessage(
          { type: "select-element", selector: "#widget" },
          "*",
        );
      });
      await page.waitForTimeout(20);
      const secondStart = await page.locator("#widget").boundingBox();
      expect(secondStart).not.toBeNull();
      await page.mouse.move(
        secondStart!.x + secondStart!.width / 2,
        secondStart!.y + secondStart!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        secondStart!.x + secondStart!.width / 2 + 18,
        secondStart!.y + secondStart!.height / 2 + 12,
        { steps: 2 },
      );
      await page.waitForFunction(
        (startIndex) =>
          (window as any).__bridgeEvents
            .slice(startIndex)
            .some(
              (event: any) =>
                event.type === "agent-native:cross-screen-drag" &&
                event.phase === "start",
            ),
        countBeforeSecondDrag,
      );
      const secondStartProof = await page.evaluate((startIndex) => {
        const event = (window as any).__bridgeEvents
          .slice(startIndex)
          .find(
            (item: any) =>
              item.type === "agent-native:cross-screen-drag" &&
              item.phase === "start",
          );
        return event?.sourceProvenance;
      }, countBeforeSecondDrag);
      expect(secondStartProof).toEqual({ uniqueNodeId: "widget" });
      await page.keyboard.press("Escape");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("preserves live runtime state through a measured 750-node full source morph", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(largeAutoLayoutRepeatDocument("Item 0"));
      await page.addScriptTag({ content: ALPINE_CDN });
      await page.waitForFunction(
        () => document.querySelectorAll(".repeat-instance").length === 30,
      );
      await page.evaluate((uniqueNodeIds) => {
        (window as any).__agentNativeSourceProvenance = {
          versionHash: "large-source-v1",
          uniqueNodeIds,
        };
        (window as any).__sourceMorphTimes = [];
        (window as any).__runtimeState = { openPanel: "inspector", count: 17 };
        const retained = document.querySelector("#node-749") as any;
        retained.__retainedToken = "node-state-survives";
        const group = document.querySelector("#group-0") as any;
        group._x_dataStack[0].counter = 17;
        group._x_dataStack[0].items.push({
          id: "runtime-added",
          name: "Runtime Added",
        });
      }, LARGE_NODE_IDS);
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#group-0 .repeat-instance").length === 3,
      );
      await page.addScriptTag({ content: measuredEditorScript() });

      const measureReplace = async (
        id: string,
        content: string,
        sourceProvenance?: { versionHash: string; uniqueNodeIds: string[] },
      ) => {
        await page.evaluate(
          ({ measureId, html, provenance }) => {
            (window as any).__sourceMorphMeasureId = measureId;
            window.postMessage(
              {
                type: "replace-document-content",
                content: html,
                selectedSelector: "#node-0",
                selectorCandidates: ["#node-0"],
                forceFullDocument: false,
                sourceProvenance: provenance,
              },
              "*",
            );
          },
          { measureId: id, html: content, provenance: sourceProvenance },
        );
        await page.waitForFunction(
          (measureId) =>
            (window as any).__sourceMorphTimes.some(
              (entry: any) => entry.id === measureId,
            ),
          id,
        );
        return page.evaluate(
          (measureId) =>
            (window as any).__sourceMorphTimes.find(
              (entry: any) => entry.id === measureId,
            ).milliseconds as number,
          id,
        );
      };

      const partialMs = await measureReplace(
        "partial",
        largeAutoLayoutRepeatDocument("Inspector edit"),
      );
      const fullMs = await measureReplace(
        "provenance-full",
        largeAutoLayoutRepeatDocument("Authored source edit"),
        { versionHash: "large-source-v2", uniqueNodeIds: LARGE_NODE_IDS },
      );
      const state = await page.evaluate(() => ({
        windowState: (window as any).__runtimeState,
        bridgeStillInstalled: (window as any).__anEditorChromeBridge === true,
        sourceHash: (window as any).__agentNativeSourceProvenance?.versionHash,
        retainedNodeToken: (document.querySelector("#node-749") as any)
          .__retainedToken,
        themeStylePresent: !!document.querySelector("style#theme"),
        nodeCount: document.querySelectorAll(".item").length,
        repeatCount: document.querySelectorAll(".repeat-instance").length,
        runtimeRepeatText: Array.from(
          document.querySelectorAll("#group-0 .repeat-instance span"),
        ).map((node) => node.textContent),
        runtimeCounter: document.querySelector("#group-0 .runtime-counter")
          ?.textContent,
        editedText: document.querySelector("#node-0")?.textContent,
      }));
      console.log(
        `[source-provenance morph timing] 750-node nested flex/grid + repeat fixture: partial=${partialMs.toFixed(3)}ms, provenance-full=${fullMs.toFixed(3)}ms (Chromium Playwright synchronous morph interval)`,
      );
      expect(Number.isFinite(partialMs)).toBe(true);
      expect(Number.isFinite(fullMs)).toBe(true);
      expect(state).toEqual({
        windowState: { openPanel: "inspector", count: 17 },
        bridgeStillInstalled: true,
        sourceHash: "large-source-v2",
        retainedNodeToken: "node-state-survives",
        themeStylePresent: true,
        nodeCount: 750,
        repeatCount: 31,
        runtimeRepeatText: ["Repeat 0 A", "Repeat 0 B", "Runtime Added"],
        runtimeCounter: "17",
        editedText: "Authored source edit0:0",
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("returns revision-scoped hit-test provenance and never promotes a pending id", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 400 },
      });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setContent(
        '<!doctype html><html><body style="margin:0"><div data-agent-native-node-id="anchor" style="position:absolute;left:100px;top:80px;width:240px;height:160px"></div></body></html>',
      );
      await page.evaluate(() => {
        (window as any).__agentNativeSourceProvenance = {
          versionHash: "source-v3",
          uniqueNodeIds: ["anchor"],
        };
        (window as any).__hitTestResults = [];
        window.addEventListener("message", (event) => {
          const data = (event as MessageEvent).data;
          if (data?.type === "agent-native:hit-test-result") {
            (window as any).__hitTestResults.push(data);
          }
        });
      });
      await page.addScriptTag({ content: hitTestBridgeScript });
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "known",
            x: 150,
            y: 110,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 1,
      );
      const knownAnchor = await page.evaluate(
        () => (window as any).__hitTestResults[0],
      );
      expect(knownAnchor).toMatchObject({
        anchorNodeId: "anchor",
        targetAnchorProvenance: {
          versionHash: "source-v3",
          uniqueNodeId: "anchor",
        },
      });

      await page.evaluate(() => {
        const secondaryAlias = document.createElement("aside");
        secondaryAlias.id = "anchor";
        secondaryAlias.setAttribute(
          "data-agent-native-node-id",
          "preferred-id",
        );
        document.body.appendChild(secondaryAlias);
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "secondary-alias-collision",
            x: 150,
            y: 110,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 2,
      );
      const secondaryAliasCollision = await page.evaluate(
        () => (window as any).__hitTestResults[1],
      );
      expect(secondaryAliasCollision).toMatchObject({
        anchorNodeId: "anchor",
        targetAnchorProvenance: { versionHash: "source-v3" },
      });
      expect(secondaryAliasCollision.targetAnchorProvenance).not.toHaveProperty(
        "uniqueNodeId",
      );

      await page.evaluate(() => {
        const duplicate = document
          .querySelector("[data-agent-native-node-id]")!
          .cloneNode(true) as HTMLElement;
        duplicate.style.left = "400px";
        document.body.appendChild(duplicate);
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "duplicate",
            x: 150,
            y: 110,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 3,
      );
      const duplicateAnchor = await page.evaluate(
        () => (window as any).__hitTestResults[2],
      );
      expect(duplicateAnchor.targetAnchorProvenance).toEqual({
        versionHash: "source-v3",
      });

      await page.evaluate(() => {
        document
          .querySelectorAll("[data-agent-native-node-id]")
          .forEach((anchor) =>
            anchor.removeAttribute("data-agent-native-node-id"),
          );
        (window as any).__agentNativeSourceProvenance = {
          versionHash: "source-v4",
          uniqueNodeIds: [],
        };
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "pending",
            x: 150,
            y: 110,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 4,
      );
      const pendingAnchor = await page.evaluate(
        () => (window as any).__hitTestResults[3],
      );
      expect(pendingAnchor).toMatchObject({
        correlationId: "pending",
        targetAnchorProvenance: { versionHash: "source-v4" },
      });
      expect(pendingAnchor.targetAnchorProvenance).not.toHaveProperty(
        "uniqueNodeId",
      );
      expect(pendingAnchor.pendingNodeId).toBeTruthy();

      await page.evaluate(() => {
        const anchor = document.querySelector("[data-an-pending-node-id]")!;
        anchor.setAttribute("data-loc", "loc-anchor");
        (window as any).__agentNativeSourceProvenance = {
          versionHash: "source-v5",
          uniqueNodeIds: ["loc-anchor"],
        };
        window.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId: "data-loc",
            x: 150,
            y: 110,
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__hitTestResults.length === 5,
      );
      const dataLocAnchor = await page.evaluate(
        () => (window as any).__hitTestResults[4],
      );
      expect(dataLocAnchor).toMatchObject({
        anchorNodeId: "loc-anchor",
        targetAnchorProvenance: {
          versionHash: "source-v5",
          uniqueNodeId: "loc-anchor",
        },
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
