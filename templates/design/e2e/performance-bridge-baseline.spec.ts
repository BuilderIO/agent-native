import { mkdir, writeFile } from "node:fs/promises";
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
  "../../../.tmp/interaction-parity/closeout-20260916/performance",
);

type MarqueeProfilerReceipt = {
  elapsedMs: number | null;
  bridgeMessageCount: number;
  bridgeReplyCount: number;
  bridgeReplyCountAtMouseup: number | null;
  finalSelectionChangeCount: number;
  finalSelectionIds: string[];
  firstBridgeMessageAt: number | null;
  finalSelectionAt: number | null;
  host: Record<string, number>;
  bridge: Record<string, number>;
};

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

function fixtureHtml(screenIndex: number, cardCount = 160): string {
  const cards = Array.from({ length: cardCount }, (_, index) => {
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
      content: fixtureHtml(index, index === 0 ? 160 : 12),
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

async function installReactCommitProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
        renderers?: Map<number, unknown>;
        supportsFiber?: boolean;
        inject?: (renderer: unknown) => number;
        onScheduleFiberRoot?: (...args: unknown[]) => unknown;
        onCommitFiberRoot?: (...args: unknown[]) => unknown;
        onCommitFiberUnmount?: (...args: unknown[]) => unknown;
      };
      __designPerformanceProbe?: Record<string, number>;
    };
    const hook = win.__REACT_DEVTOOLS_GLOBAL_HOOK__ ?? {
      renderers: new Map<number, unknown>(),
      inject: (() => {
        let nextId = 0;
        return () => nextId++;
      })(),
      onScheduleFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
    };
    const originalOnCommit = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = (...args: unknown[]) => {
      const probe = win.__designPerformanceProbe;
      if (probe) probe.reactCommits = (probe.reactCommits ?? 0) + 1;
      return originalOnCommit?.apply(hook, args);
    };
    hook.supportsFiber = true;
    win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  });
}

async function installMarqueeProfiler(
  page: Page,
  delayedFileId: string,
): Promise<void> {
  await page.evaluate((targetFileId) => {
    const win = window as typeof window & {
      __designPerformanceProbe?: Record<string, number>;
      __marqueePerformance?: {
        startedAt: number;
        firstMessageAt: number | null;
        finalMessageAt: number | null;
        messageCount: number;
        bridgeReplyCount: number;
        bridgeReplyCountAtMouseup: number | null;
        finalMessageCount: number;
        finalSelectionIds: string[];
      };
    };
    win.__designPerformanceProbe = Object.create(null);
    const startedAt = performance.now();
    win.__marqueePerformance = {
      startedAt,
      firstMessageAt: null,
      finalMessageAt: null,
      messageCount: 0,
      bridgeReplyCount: 0,
      bridgeReplyCountAtMouseup: null,
      finalMessageCount: 0,
      finalSelectionIds: [],
    };
    const delayedBridgeReplies = new WeakSet<object>();
    const delayedSource = document.querySelector<HTMLIFrameElement>(
      `iframe[data-screen-iframe-id="${CSS.escape(targetFileId)}"]`,
    )?.contentWindow;
    if (!delayedSource)
      throw new Error("delayed marquee iframe is unavailable");
    const pendingBridgeReplies: Array<{
      data: object;
      origin: string;
      source: MessageEventSource | null;
    }> = [];
    let marqueeReleased = false;
    let releaseScheduled = false;
    const releasePendingBridgeReplies = () => {
      if (
        !marqueeReleased ||
        releaseScheduled ||
        pendingBridgeReplies.length === 0
      ) {
        return;
      }
      releaseScheduled = true;
      queueMicrotask(() => {
        releaseScheduled = false;
        const replies = pendingBridgeReplies.splice(0);
        replies.forEach(({ data, origin, source }) => {
          window.dispatchEvent(
            new MessageEvent("message", { data, origin, source }),
          );
        });
        releasePendingBridgeReplies();
      });
    };
    window.addEventListener(
      "message",
      (event) => {
        const data = event.data as { type?: string } | null;
        if (!data || data.type !== "agent-native:selectable-rects-result") {
          return;
        }
        if (delayedBridgeReplies.has(data)) {
          delayedBridgeReplies.delete(data);
          return;
        }
        if (event.source !== delayedSource) return;
        event.stopImmediatePropagation();
        delayedBridgeReplies.add(data);
        pendingBridgeReplies.push({
          data,
          origin: event.origin,
          source: event.source,
        });
        releasePendingBridgeReplies();
      },
      true,
    );
    window.addEventListener(
      "mouseup",
      () => {
        marqueeReleased = true;
        const performance = win.__marqueePerformance;
        if (performance && performance.bridgeReplyCountAtMouseup === null) {
          performance.bridgeReplyCountAtMouseup = performance.bridgeReplyCount;
        }
        releasePendingBridgeReplies();
      },
      true,
    );
    window.addEventListener("message", (event) => {
      const data = event.data as {
        type?: string;
        payload?: Array<{ sourceId?: string }>;
        intent?: { final?: boolean };
      };
      const performance = win.__marqueePerformance;
      const isBridgeReply =
        data?.type === "agent-native:selectable-rects-result";
      const isDirectMarquee =
        data?.type === "agent-native:layer-marquee-selection";
      const isPreviewSource = [
        ...document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-screen-iframe-id]",
        ),
      ].some((frame) => frame.contentWindow === event.source);
      if (
        !performance ||
        !isPreviewSource ||
        (!isBridgeReply && !isDirectMarquee)
      ) {
        return;
      }
      const at = window.performance.now() - performance.startedAt;
      performance.messageCount += 1;
      performance.firstMessageAt ??= at;
      if (isBridgeReply) performance.bridgeReplyCount += 1;
      if (data.intent?.final !== true) return;
      performance.finalMessageCount += 1;
      performance.finalMessageAt = at;
      performance.finalSelectionIds = Array.isArray(data.payload)
        ? data.payload
            .map((item) => item.sourceId)
            .filter((sourceId): sourceId is string => Boolean(sourceId))
        : [];
    });
  }, delayedFileId);

  const iframes = await page
    .locator("iframe[data-screen-iframe-id]")
    .elementHandles();
  for (const iframe of iframes) {
    const frame = await iframe.contentFrame();
    if (!frame) continue;
    await frame.evaluate(() => {
      const win = window as typeof window & {
        __designBridgePerformance?: Record<string, number>;
      };
      const probe = {
        domScans: 0,
        computedStyleReads: 0,
        subtreeNodes: 0,
        subtreeQueries: 0,
        layoutReads: 0,
      };
      win.__designBridgePerformance = probe;

      const rawQuerySelectorAll = Element.prototype.querySelectorAll;
      Element.prototype.querySelectorAll = function (
        this: Element,
        selectors: string,
      ) {
        const result = rawQuerySelectorAll.call(this, selectors);
        if (selectors === "*") {
          if (this === document.body) {
            probe.domScans += 1;
          } else {
            probe.subtreeQueries += 1;
            probe.subtreeNodes += result.length;
          }
        }
        return result;
      } as typeof Element.prototype.querySelectorAll;

      const rawGetComputedStyle = window.getComputedStyle.bind(window);
      window.getComputedStyle = function (element, pseudoElement) {
        probe.computedStyleReads += 1;
        return rawGetComputedStyle(element, pseudoElement);
      };

      const rawGetBoundingClientRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        probe.layoutReads += 1;
        return rawGetBoundingClientRect.call(this);
      };
    });
  }
}

async function performProfiledMarquee(
  page: Page,
  fileId: string,
  secondaryFileId: string,
): Promise<void> {
  const frame = page
    .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
    .contentFrame();
  const firstCard = frame.locator('[data-agent-native-node-id="card-0-0"]');
  const secondFrame = page
    .locator(`iframe[data-screen-iframe-id="${secondaryFileId}"]`)
    .contentFrame();
  const secondLastCard = secondFrame.locator(
    '[data-agent-native-node-id="card-1-3"]',
  );
  const firstBox = await firstCard.boundingBox();
  const secondLastBox = await secondLastCard.boundingBox();
  const iframeBox = await page
    .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
    .boundingBox();
  if (!firstBox || !secondLastBox)
    throw new Error("marquee fixture cards are hidden");
  if (!iframeBox) throw new Error("marquee fixture iframe is hidden");
  const startPoint = {
    x: Math.max(8, iframeBox.x - 32),
    y: Math.max(8, iframeBox.y - 96),
  };
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  try {
    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.mouse.move(
      secondLastBox.x + secondLastBox.width + 12,
      secondLastBox.y + secondLastBox.height + 12,
      { steps: 8 },
    );
    await page.mouse.up();
  } finally {
    await page.keyboard.up(modifier);
  }
}

async function readMarqueeProfiler(
  page: Page,
): Promise<MarqueeProfilerReceipt> {
  const host = await page.evaluate(() => {
    const win = window as typeof window & {
      __designPerformanceProbe?: Record<string, number>;
      __marqueePerformance?: {
        startedAt: number;
        firstMessageAt: number | null;
        finalMessageAt: number | null;
        messageCount: number;
        bridgeReplyCount: number;
        bridgeReplyCountAtMouseup: number | null;
        finalMessageCount: number;
        finalSelectionIds: string[];
      };
    };
    const marquee = win.__marqueePerformance;
    const probe = { ...(win.__designPerformanceProbe ?? {}) };
    const layerRows = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
      ),
    ];
    const finalSelectionIds = layerRows
      .map((row) => row.dataset.layerNodeId ?? "")
      .filter(Boolean);
    const finalSelectionAt =
      marquee && typeof probe.marqueeFinalSelectionAt === "number"
        ? probe.marqueeFinalSelectionAt - marquee.startedAt
        : null;
    return {
      elapsedMs: finalSelectionAt,
      bridgeMessageCount: marquee?.messageCount ?? 0,
      bridgeReplyCount: marquee?.bridgeReplyCount ?? 0,
      bridgeReplyCountAtMouseup: marquee?.bridgeReplyCountAtMouseup ?? null,
      finalSelectionChangeCount: probe.marqueeFinalSelectionChange ?? 0,
      finalSelectionIds:
        finalSelectionIds.length > 0
          ? finalSelectionIds
          : (marquee?.finalSelectionIds ?? []),
      firstBridgeMessageAt: marquee?.firstMessageAt ?? null,
      finalSelectionAt,
      host: probe,
    };
  });
  const bridge = {
    domScans: 0,
    computedStyleReads: 0,
    subtreeNodes: 0,
    subtreeQueries: 0,
    layoutReads: 0,
  };
  const iframes = await page
    .locator("iframe[data-screen-iframe-id]")
    .elementHandles();
  for (const iframe of iframes) {
    const frame = await iframe.contentFrame();
    if (!frame) continue;
    const sample = await frame.evaluate(() => {
      const win = window as typeof window & {
        __designBridgePerformance?: Record<string, number>;
      };
      const probe = win.__designBridgePerformance ?? {};
      return {
        domScans: probe.domScans ?? 0,
        computedStyleReads: probe.computedStyleReads ?? 0,
        subtreeNodes: probe.subtreeNodes ?? 0,
        subtreeQueries: probe.subtreeQueries ?? 0,
        layoutReads: probe.layoutReads ?? 0,
      };
    });
    bridge.domScans += sample.domScans;
    bridge.computedStyleReads += sample.computedStyleReads;
    bridge.subtreeNodes += sample.subtreeNodes;
    bridge.subtreeQueries += sample.subtreeQueries;
    bridge.layoutReads += sample.layoutReads;
  }
  return { ...host, bridge };
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
  await installReactCommitProbe(page);
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
  await mkdir(EVIDENCE_DIR, { recursive: true });
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

  const marqueeSelectionBeforeRows = await page
    .locator('[aria-selected="true"]')
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  await installMarqueeProfiler(page, fixture.fileIds[1]);
  await performProfiledMarquee(page, fixture.fileIds[0], fixture.fileIds[1]);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __designPerformanceProbe?: Record<string, number>;
              }
            ).__designPerformanceProbe?.marqueeFinalSelectionChange ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBe(1);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __marqueePerformance?: { bridgeReplyCount?: number };
              }
            ).__marqueePerformance?.bridgeReplyCount ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(500);
  const marqueeSelectionAfterRows = await page
    .locator('[aria-selected="true"]')
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  const marqueeProfiler = await readMarqueeProfiler(page);
  expect(marqueeProfiler.bridgeMessageCount).toBeGreaterThan(0);
  expect(marqueeProfiler.bridgeReplyCount).toBeGreaterThanOrEqual(2);
  expect(marqueeProfiler.bridgeReplyCountAtMouseup).toBeLessThan(2);
  expect(marqueeProfiler.finalSelectionChangeCount).toBe(1);
  expect(marqueeProfiler.elapsedMs).toBeGreaterThan(0);
  expect(marqueeProfiler.finalSelectionAt).toBe(marqueeProfiler.elapsedMs);
  expect(marqueeProfiler.finalSelectionIds.length).toBeGreaterThanOrEqual(60);
  expect(marqueeProfiler.host.marqueeSelectionChange).toBeGreaterThan(1);
  expect(marqueeProfiler.host.marqueeFinalSelectionChange).toBe(1);
  expect(marqueeProfiler.host.captureCurrentSelection).toBeLessThanOrEqual(2);
  expect(marqueeProfiler.host.buildCodeLayerProjection).toBeLessThanOrEqual(4);
  expect(marqueeProfiler.host.reactCommits).toBeGreaterThan(0);
  expect(marqueeProfiler.bridge.domScans).toBe(2);
  expect(marqueeProfiler.bridge.subtreeQueries).toBe(0);
  expect(marqueeProfiler.bridge.subtreeNodes).toBe(0);
  expect(marqueeSelectionAfterRows).not.toEqual(marqueeSelectionBeforeRows);
  expect(marqueeSelectionAfterRows).toEqual(
    expect.arrayContaining([
      "Card 1",
      "Ready",
      "Nested auto-layout content for performance profiling.",
    ]),
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect
    .poll(async () =>
      page
        .locator('[aria-selected="true"]')
        .evaluateAll((rows) =>
          rows.map((row) => row.textContent?.trim() ?? ""),
        ),
    )
    .toEqual(marqueeSelectionBeforeRows);

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
        marqueeProfiler: {
          ...marqueeProfiler,
          selectionBeforeRows: marqueeSelectionBeforeRows,
          selectionAfterRows: marqueeSelectionAfterRows,
          undoSelectionRows: await page
            .locator('[aria-selected="true"]')
            .evaluateAll((rows) =>
              rows.map((row) => row.textContent?.trim() ?? ""),
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
