import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  bridgeMessages,
  gotoEditor,
  installBridge,
  inspectorInputCount,
} from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  "../../../.tmp/interaction-parity/closeout-20260915/performance",
);

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

function fixtureHtml(screenIndex: number): string {
  const cards = Array.from({ length: 160 }, (_, index) => {
    const id = `${screenIndex}-${index}`;
    return `<article data-agent-native-node-id="card-${id}" class="card" style="min-height:96px;padding:12px;border:1px solid #d7dce5;border-radius:12px;background:#fff;display:flex;flex-direction:column;gap:8px"><div data-agent-native-node-id="card-head-${id}" style="display:flex;justify-content:space-between;gap:8px"><strong data-agent-native-node-id="card-title-${id}">Card ${index + 1}</strong><span data-agent-native-node-id="card-badge-${id}" class="badge">Ready</span></div><p data-agent-native-node-id="card-copy-${id}" style="margin:0;color:#475569">Nested auto-layout content for performance profiling.</p></article>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f8fafc;font-family:system-ui}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:32px;min-height:1200px}</style></head><body><main data-agent-native-node-id="main-${screenIndex}">${cards}</main></body></html>`;
}

async function createFixture(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Performance bridge baseline ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  const fileIds: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: index === 0 ? "index.html" : `screen-${index + 1}.html`,
      content: fixtureHtml(index),
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error("create-file returned no id");
    fileIds.push(fileId);
  }

  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["breakpointSet"],
        value: {
          id: "perf-breakpoints",
          breakpoints: [
            { id: "mobile", label: "Mobile", widthPx: 390 },
            { id: "tablet", label: "Tablet", widthPx: 768 },
          ],
        },
      },
      ...fileIds.flatMap((fileId, index) => [
        {
          op: "set",
          path: ["screenMetadata", fileId],
          value: { sourceType: "inline", width: 1280, height: 1250 },
        },
        {
          op: "set",
          path: ["canvasFrames", fileId],
          value: {
            x: index * 1376,
            y: 0,
            width: 1280,
            height: 1250,
            z: index,
          },
        },
      ]),
    ],
  });
  return { designId, fileIds };
}

type RectsSample = {
  deep: boolean;
  elapsedMs: number;
  count: number;
  payloadBytes: number;
  sampleKeys: string[];
  timedOut?: boolean;
};

function summarize(samples: RectsSample[]) {
  const values = samples
    .map((sample) => sample.elapsedMs)
    .sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    minMs: values[0] ?? null,
    maxMs: values[values.length - 1] ?? null,
    meanMs: values.length > 0 ? total / values.length : null,
    medianMs: values.length > 0 ? values[Math.floor(values.length / 2)] : null,
    spreadMs:
      values.length > 0 ? values[values.length - 1]! - values[0]! : null,
  };
}

async function collectRects(
  page: Page,
  iframeIndex: number,
  deep: boolean,
): Promise<RectsSample> {
  return page.evaluate(
    async ({ deep: requestedDeep, iframeIndex: requestedIndex }) => {
      const iframe = document.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      )[requestedIndex];
      const contentWindow = iframe?.contentWindow;
      if (!contentWindow) {
        throw new Error(`missing preview iframe ${requestedIndex}`);
      }
      const correlationId = `perf-${Date.now()}-${Math.random()}`;
      const started = performance.now();
      return new Promise<RectsSample>((resolve) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", listener);
          resolve({
            deep: requestedDeep,
            elapsedMs: performance.now() - started,
            count: 0,
            payloadBytes: 0,
            sampleKeys: [],
            timedOut: true,
          });
        }, 10_000);
        const listener = (event: MessageEvent) => {
          if (
            event.source !== contentWindow ||
            event.data?.type !== "agent-native:selectable-rects-result" ||
            event.data?.correlationId !== correlationId
          ) {
            return;
          }
          window.clearTimeout(timer);
          window.removeEventListener("message", listener);
          const payload = Array.isArray(event.data.payload)
            ? event.data.payload
            : [];
          resolve({
            deep: requestedDeep,
            elapsedMs: performance.now() - started,
            count: payload.length,
            payloadBytes: JSON.stringify(payload).length,
            sampleKeys:
              payload.length > 0 && payload[0] && typeof payload[0] === "object"
                ? Object.keys(payload[0]).sort()
                : [],
          });
        };
        window.addEventListener("message", listener);
        contentWindow.postMessage(
          {
            type: "agent-native:collect-selectable-rects",
            correlationId,
            deep: requestedDeep,
          },
          "*",
        );
      });
    },
    { deep, iframeIndex },
  );
}

async function installLongTaskObserver(page: Page) {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __perfLongTasks?: Array<{ startTime: number; duration: number }>;
      __perfLongTaskObserver?: PerformanceObserver;
    };
    win.__perfLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        win.__perfLongTasks?.push(
          ...list.getEntries().map((entry) => ({
            startTime: entry.startTime,
            duration: entry.duration,
          })),
        );
      });
      observer.observe({ type: "longtask", buffered: true });
      win.__perfLongTaskObserver = observer;
    } catch {
      win.__perfLongTaskObserver = undefined;
    }
  });
}

async function readLongTasks(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __perfLongTasks?: Array<{ startTime: number; duration: number }>;
      __perfLongTaskObserver?: PerformanceObserver;
    };
    win.__perfLongTaskObserver?.disconnect();
    return win.__perfLongTasks ?? [];
  });
}

async function selectFixtureNode(page: Page, fileId: string, nodeId: string) {
  await installBridge(page);
  const frame = page
    .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
    .contentFrame();
  const target = frame.locator(`[data-agent-native-node-id="${nodeId}"]`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bounding box for ${nodeId}`);
  const expected = await target.evaluate((node) => ({
    tagName: node.tagName.toLowerCase(),
    sourceId: node.getAttribute("data-agent-native-node-id"),
    textContent: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
  }));
  await page.evaluate(() => ((window as any).__bridge = []));
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  try {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } finally {
    await page.keyboard.up(modifier);
  }
  const selectionHandle = await page.waitForFunction(
    () =>
      [...((window as any).__bridge ?? [])]
        .reverse()
        .find((message: any) => message.type === "element-select") ?? null,
    undefined,
    { timeout: 15_000 },
  );
  const selection = await selectionHandle.jsonValue();
  const payload = selection?.payload ?? selection;
  expect(payload?.sourceId).toBe(expected.sourceId);
  expect(payload?.tagName).toBe(expected.tagName);
  expect(
    String(payload?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  ).toBe(expected.textContent);
  return { payload, selectionMode: "pointer" as const };
}

async function replayFixtureNode(page: Page, fileId: string, nodeId: string) {
  await page.evaluate(() => ((window as any).__bridge = []));
  await page.evaluate(
    ({ fileId: targetFileId, nodeId: targetNodeId }) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-screen-iframe-id="${targetFileId}"]`,
      );
      iframe?.contentWindow?.postMessage(
        {
          type: "select-element",
          selector: `[data-agent-native-node-id="${targetNodeId}"]`,
        },
        "*",
      );
    },
    { fileId, nodeId },
  );
  const selectionHandle = await page.waitForFunction(
    ({ sourceId }) =>
      [...((window as any).__bridge ?? [])]
        .reverse()
        .find(
          (message: any) =>
            message.type === "element-select" &&
            (message.payload ?? message).sourceId === sourceId,
        ) ?? null,
    { sourceId: nodeId },
    { timeout: 15_000 },
  );
  const selection = await selectionHandle.jsonValue();
  const payload = selection?.payload ?? selection;
  expect(payload?.sourceId).toBe(nodeId);
  return payload;
}

test.use({ viewport: { width: 1500, height: 1000 } });

test("collect selectable rects baseline on nested responsive screens", async ({
  page,
  request,
}) => {
  const fixture = await createFixture(request);
  await gotoEditor(page, fixture.designId);
  const primaryIframe = page.locator(
    `iframe[data-screen-iframe-id="${fixture.fileIds[0]}"]`,
  );
  await expect(primaryIframe).toBeVisible({ timeout: 30_000 });
  const primaryFrame = primaryIframe.contentFrame();
  await expect(
    primaryFrame.locator('[data-agent-native-edit-overlay="shield"]'),
  ).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("[data-screen-shell]").first()).toBeVisible();
  await installLongTaskObserver(page);

  const iframeCount = await page
    .locator("iframe[data-design-preview-iframe]")
    .count();
  if (iframeCount === 0) throw new Error("no design preview iframe mounted");
  const fixtureStats = await primaryFrame.locator("body").evaluate((body) => {
    let maxDepth = 0;
    let elementCount = 0;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
    let current: Node | null = walker.currentNode;
    while (current) {
      elementCount += 1;
      let depth = 0;
      for (let node = current.parentNode; node; node = node.parentNode) {
        depth += 1;
      }
      maxDepth = Math.max(maxDepth, depth);
      current = walker.nextNode();
    }
    return { elementCount, maxDepth };
  });

  await page.context().tracing.start({ screenshots: false, snapshots: false });
  const bridgeSamples: RectsSample[] = [];
  await collectRects(page, 0, true);
  for (const deep of [false, true]) {
    for (let repeat = 0; repeat < 3; repeat += 1) {
      bridgeSamples.push(await collectRects(page, 0, deep));
    }
  }

  await primaryFrame.locator("body").evaluate((body) => {
    const probe = document.createElement("div");
    probe.className = "perf-hover-probe";
    probe.textContent = "Hover probe";
    probe.style.cssText =
      "position:absolute;left:16px;top:16px;width:40px;height:40px;background:#f97316;";
    body.appendChild(probe);
  });
  const hoverProbe = primaryFrame.locator(".perf-hover-probe");
  const hoverProbeBox = await hoverProbe.boundingBox();
  if (!hoverProbeBox) throw new Error("hover probe has no bounding box");
  await page.mouse.move(
    hoverProbeBox.x + hoverProbeBox.width / 2,
    hoverProbeBox.y + hoverProbeBox.height / 2,
  );
  await page.waitForTimeout(100);
  const hoverPendingNodeId = await hoverProbe.getAttribute(
    "data-an-pending-node-id",
  );
  expect(hoverPendingNodeId).toBeNull();

  const card = page.locator("[data-screen-card]").first();
  const cardBox = await card.boundingBox();
  const gesture = cardBox
    ? await page.evaluate(
        ({ x, y }) => {
          const started = performance.now();
          return { started, x, y };
        },
        { x: cardBox.x + 4, y: cardBox.y + 4 },
      )
    : null;
  let overviewBridgeEvents: Array<{
    type: string;
    t: number;
    count?: number;
  }> = [];
  if (gesture) {
    await page.evaluate(() => {
      const win = window as typeof window & {
        __perfOverviewBridgeEvents?: Array<{
          type: string;
          t: number;
          count?: number;
        }>;
      };
      win.__perfOverviewBridgeEvents = [];
      window.addEventListener("message", (event) => {
        const type = event.data?.type;
        if (
          type !== "agent-native:selectable-rects-result" &&
          type !== "element-select"
        ) {
          return;
        }
        win.__perfOverviewBridgeEvents?.push({
          type,
          t: performance.now(),
          count: Array.isArray(event.data?.payload)
            ? event.data.payload.length
            : undefined,
        });
      });
    });
    await page.mouse.dblclick(gesture.x, gesture.y, { delay: 40 });
    await page.waitForTimeout(750);
    overviewBridgeEvents = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __perfOverviewBridgeEvents?: typeof overviewBridgeEvents;
          }
        ).__perfOverviewBridgeEvents ?? [],
    );
  }

  const selectionBeforeRows = await page
    .locator('[aria-selected="true"]')
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  const selectedSelection = await selectFixtureNode(
    page,
    fixture.fileIds[0],
    "card-0-0",
  );
  const selectedPayload = selectedSelection.payload;
  const inspectorInputs = await inspectorInputCount(page);
  await page.waitForTimeout(300);
  const firstSelectionRows = await page
    .locator('[aria-selected="true"]')
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  const protocolPayload = await replayFixtureNode(
    page,
    fixture.fileIds[0],
    "card-badge-0-0",
  );
  await page.waitForTimeout(500);
  const secondSelectionRows = await page
    .locator('[aria-selected="true"]')
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await page.waitForTimeout(300);
  const undoSelectionRows = await page
    .locator('[aria-selected="true"]')
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  expect(undoSelectionRows).toEqual(selectionBeforeRows);

  const longTasks = await readLongTasks(page);
  await page.context().tracing.stop({
    path: path.join(EVIDENCE_DIR, "bridge-baseline-trace.zip"),
  });
  await writeFile(
    path.join(EVIDENCE_DIR, "bridge-after.json"),
    JSON.stringify(
      {
        designId: fixture.designId,
        fileIds: fixture.fileIds,
        iframeCount,
        fixtureStats,
        bridgeSamples,
        bridgeSummary: {
          shallow: summarize(bridgeSamples.filter((sample) => !sample.deep)),
          deep: summarize(bridgeSamples.filter((sample) => sample.deep)),
        },
        overviewGesture: gesture,
        overviewBridgeEvents,
        selectionSmoke: {
          tagName: selectedPayload.tagName,
          selectionMode: selectedSelection.selectionMode,
          protocolPayload: {
            sourceId: protocolPayload.sourceId,
            computedStyleKeys: Object.keys(protocolPayload.computedStyles ?? {})
              .length,
            hasPortableStyleSnapshot: Boolean(
              protocolPayload.portableStyleSnapshot,
            ),
          },
          hoverPendingNodeId,
          sourceId: selectedPayload.sourceId,
          computedStyleKeys: Object.keys(selectedPayload.computedStyles ?? {})
            .length,
          hasPortableStyleSnapshot: Boolean(
            selectedPayload.portableStyleSnapshot,
          ),
          inspectorInputs,
          selectionBeforeRows,
          firstSelectionRows,
          secondSelectionRows,
          undoSelectionRows,
          bridgeMessageTypes: (await bridgeMessages(page)).map(
            (message) => message.type,
          ),
        },
        longTasks,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  expect(bridgeSamples.every((sample) => !sample.timedOut)).toBe(true);
});
