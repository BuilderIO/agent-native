import type { Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, test, type App } from "./rails";

type CollectionRequestProbe = {
  frameId: string;
  correlationId: string;
  deep: boolean;
  includePortableStyleSnapshot: boolean;
  hasAtPoint: boolean;
};

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
  collectionRequests: CollectionRequestProbe[];
};

function fixtureHtml(screenIndex: number, cardCount = 160): string {
  const cards = Array.from({ length: cardCount }, (_, index) => {
    const id = `${screenIndex}-${index}`;
    return `<article data-agent-native-node-id="card-${id}" class="card" style="min-height:96px;padding:12px;border:1px solid #d7dce5;border-radius:12px;background:#fff;display:flex;flex-direction:column;gap:8px"><div data-agent-native-node-id="card-head-${id}" style="display:flex;justify-content:space-between;gap:8px"><strong data-agent-native-node-id="card-title-${id}">Card ${index + 1}</strong><span data-agent-native-node-id="card-badge-${id}" class="badge">Ready</span></div><p data-agent-native-node-id="card-copy-${id}" style="margin:0;color:#475569">Nested auto-layout content for performance profiling.</p></article>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f8fafc;font-family:system-ui}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:32px;min-height:1200px}</style></head><body><main data-agent-native-node-id="main-${screenIndex}">${cards}</main></body></html>`;
}

/** Home (160 nested cards, about 800 nodes) beside a 12-card screen. */
async function seedLargeScreens(app: App) {
  const designId = await app.seed(fixtureHtml(0, 160), {
    files: { "screen-2.html": fixtureHtml(1, 12) },
  });
  const { files } = await app.savedRecord(designId);
  const fileIds = ["index.html", "screen-2.html"].map(
    (filename) => files.find((file) => file.filename === filename)!.id,
  );
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id: designId,
        dataOperations: [
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
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  return { designId, fileIds };
}

async function installCollectionRequestRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Request = {
      frameId: string;
      correlationId: string;
      deep: boolean;
      includePortableStyleSnapshot: boolean;
      hasAtPoint: boolean;
    };
    type RequestWindow = typeof window & {
      __marqueeCollectionRequests?: Request[];
    };
    if (window === window.top) {
      (window as RequestWindow).__marqueeCollectionRequests = [];
      return;
    }

    window.addEventListener(
      "message",
      (event) => {
        const data = event.data as {
          type?: string;
          correlationId?: unknown;
          deep?: unknown;
          includePortableStyleSnapshot?: unknown;
          atPoint?: unknown;
        } | null;
        if (
          event.source !== window.parent ||
          data?.type !== "agent-native:collect-selectable-rects"
        ) {
          return;
        }
        const parent = window.parent as RequestWindow;
        parent.__marqueeCollectionRequests?.push({
          frameId:
            (window.frameElement as HTMLIFrameElement | null)?.getAttribute(
              "data-screen-iframe-id",
            ) ?? "unknown-frame",
          correlationId:
            typeof data.correlationId === "string" ? data.correlationId : "",
          deep: data.deep === true,
          includePortableStyleSnapshot:
            data.includePortableStyleSnapshot !== false,
          hasAtPoint: data.atPoint !== undefined && data.atPoint !== null,
        });
      },
      true,
    );
  });
}

async function installMarqueeProfiler(
  page: Page,
  delayedFileId: string,
): Promise<void> {
  await page.evaluate((targetFileId) => {
    const win = window as typeof window & {
      __designPerformanceProbe?: Record<string, number>;
      __marqueeCollectionRequests?: CollectionRequestProbe[];
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
    win.__marqueeCollectionRequests = [];
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
) {
  const frame = page
    .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
    .contentFrame();
  const firstCard = frame.locator('[data-agent-native-node-id="card-0-0"]');
  const secondFrame = page
    .locator(`iframe[data-screen-iframe-id="${secondaryFileId}"]`)
    .contentFrame();
  const secondLastCard = secondFrame.locator(
    '[data-agent-native-node-id="card-1-11"]',
  );
  const firstBox = await firstCard.boundingBox();
  const secondLastBox = await secondLastCard.boundingBox();
  const iframeBox = await page
    .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
    .boundingBox();
  if (!firstBox || !secondLastBox)
    throw new Error("marquee fixture cards are hidden");
  if (!iframeBox) throw new Error("marquee fixture iframe is hidden");
  // Empty canvas left of Home, away from its corner rotate zone, title label and the top bar.
  const startPoint = { x: iframeBox.x - 60, y: iframeBox.y + 4 };
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  try {
    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.mouse.move(
      secondLastBox.x + secondLastBox.width + 12,
      secondLastBox.y + secondLastBox.height + 12,
      { steps: 2 },
    );
    await page.mouse.up();
  } finally {
    await page.keyboard.up(modifier);
  }
  return { firstBox, secondLastBox, iframeBox, startPoint };
}

async function readMarqueeProfiler(
  page: Page,
): Promise<MarqueeProfilerReceipt> {
  const hostSnapshot = await page.evaluate(() => {
    const win = window as typeof window & {
      __designPerformanceProbe?: Record<string, number>;
      __marqueeCollectionRequests?: CollectionRequestProbe[];
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
      collectionRequests: win.__marqueeCollectionRequests ?? [],
    };
  });
  const { collectionRequests, ...host } = hostSnapshot;
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
  return { ...host, bridge, collectionRequests };
}

test.use({ viewport: { width: 1500, height: 1000 } });

// The budget: a deep marquee over a large screen costs one full-DOM scan per screen it crosses, plus one
// style-snapshot pass per screen whose layers end up selected, however many pointer moves the drag has.
// fixme: product bug: Every budget assertion passes. The Cmd-marquee started on empty canvas selects each screen's main container plus every descendant (262
test.fixme("a Cmd-marquee across a large screen and a small one scans each crossed screen once and commits the selection once", async ({
  app,
  page,
}) => {
  const fixture = await seedLargeScreens(app);
  await installCollectionRequestRecorder(page);
  await app.open(fixture.designId);
  for (const fileId of fixture.fileIds) {
    await expect(
      page
        .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
        .contentFrame()
        .locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached({ timeout: 30_000 });
  }
  await app.zoomToFit();
  await expect.poll(() => app.selectedLayers()).toStrictEqual([]);
  const savedBefore = await app.savedRecord(fixture.designId);

  await installMarqueeProfiler(page, fixture.fileIds[1]!);
  await performProfiledMarquee(page, fixture.fileIds[0]!, fixture.fileIds[1]!);
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
  const profiler = await readMarqueeProfiler(page);

  // Screen 2's replies are held until mouseup, so the final selection must have waited for them.
  expect(profiler.bridgeReplyCountAtMouseup).toBeLessThan(2);
  expect(profiler.bridgeReplyCount).toBeGreaterThanOrEqual(2);
  expect(profiler.finalSelectionChangeCount).toBe(1);
  expect(
    profiler.finalSelectionIds.length,
    "precondition: the marquee selected the cards it crossed",
  ).toBeGreaterThanOrEqual(24);
  expect(
    profiler.collectionRequests
      .map((request) => ({
        frameId: request.frameId,
        styles: request.includePortableStyleSnapshot,
        deep: request.deep,
        atPoint: request.hasAtPoint,
      }))
      .sort((a, b) =>
        `${a.frameId}${a.styles}`.localeCompare(`${b.frameId}${b.styles}`),
      ),
  ).toStrictEqual(
    [...fixture.fileIds].sort().flatMap((frameId) => [
      { frameId, styles: false, deep: true, atPoint: false },
      { frameId, styles: true, deep: true, atPoint: false },
    ]),
  );
  expect(profiler.bridge.domScans).toBe(4);
  expect(profiler.host.captureCurrentSelection).toBeLessThanOrEqual(2);
  expect(profiler.host.buildCodeLayerProjection).toBeLessThanOrEqual(4);
  await app.settled();
  expect(await app.savedRecord(fixture.designId)).toStrictEqual(savedBefore);

  // The Layers tree is a flat list of rows with aria-level, so ancestry is read from row order.
  const selectedUnderSelectedAncestor = await page
    .getByRole("tree", { name: "Layers" })
    .evaluate((tree) => {
      const ancestors: Array<{ level: number; selected: boolean }> = [];
      const nested: string[] = [];
      for (const row of tree.querySelectorAll('[role="treeitem"]')) {
        const level = Number(row.getAttribute("aria-level"));
        const selected = row.getAttribute("aria-selected") === "true";
        while (
          ancestors.length &&
          ancestors[ancestors.length - 1]!.level >= level
        )
          ancestors.pop();
        if (selected && ancestors.some((ancestor) => ancestor.selected)) {
          nested.push(
            `${level}:${(row.textContent ?? "").trim().slice(0, 40)}`,
          );
        }
        ancestors.push({ level, selected });
      }
      return nested;
    });
  expect(
    selectedUnderSelectedAncestor,
    "a marquee never selects a layer together with one of its ancestors",
  ).toStrictEqual([]);
});
