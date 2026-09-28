import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

function hydratedBridgeWithCssomCacheFactory(): string {
  const script = hydratedBridge();
  const marker = '    var shieldOverlay = document.createElement("div");';
  const withFactory = script.replace(
    marker,
    `    window.__testCreatePortableStyleComputedStylesCache = createPortableStyleComputedStylesCache;
${marker}`,
  );
  if (withFactory === script) {
    throw new Error("CSSOM cache factory test hook insertion point changed");
  }
  return withFactory;
}

const CARDS = 60;
const LARGE_CANDIDATES = 849;
const LARGE_DOM_ELEMENTS = 883;

function fixture(): string {
  const cols = 6;
  let html = `<!doctype html><html><body style="margin:0;width:800px;height:${
    Math.ceil(CARDS / cols) * 120 + 80
  }px">`;
  for (let i = 0; i < CARDS; i += 1) {
    const x = 20 + (i % cols) * 120;
    const y = 20 + Math.floor(i / cols) * 120;
    html += `<div data-agent-native-node-id="card-${i}" data-agent-native-layer-name="Card ${i}" style="position:absolute;left:${x}px;top:${y}px;width:100px;height:100px;background:#111827">
      <div data-agent-native-node-id="title-${i}" data-agent-native-layer-name="Title ${i}" style="position:absolute;left:8px;top:8px;width:80px;height:16px;background:#3b82f6"></div>
      <div data-agent-native-node-id="body-${i}" data-agent-native-layer-name="Body ${i}" style="position:absolute;left:8px;top:32px;width:80px;height:40px;background:#6b7280"></div>
      <div data-agent-native-node-id="action-${i}" data-agent-native-layer-name="Action ${i}" style="position:absolute;left:8px;top:78px;width:40px;height:14px;background:#a855f7"></div>
    </div>`;
  }
  return `${html}</body></html>`;
}

function largeFixture(): string {
  const columns = 13;
  let html =
    '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f8fafc;font-family:system-ui}main{position:relative;width:1200px;height:1800px}</style></head><body><main data-agent-native-node-id="large-root">';
  for (let index = 0; index < 169; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    html += `<article data-agent-native-node-id="card-${index}" style="position:absolute;left:${column * 92}px;top:${row * 136}px;width:84px;height:124px;box-sizing:border-box;padding:5px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;display:flex;flex-direction:column;gap:4px"><div data-agent-native-node-id="card-head-${index}" style="display:flex;align-items:center;justify-content:space-between;width:100%;height:22px;overflow:hidden"><strong data-agent-native-node-id="card-title-${index}" style="display:block;width:42px;overflow:hidden;white-space:nowrap">Card ${index}</strong><span data-agent-native-node-id="card-badge-${index}" style="display:block;width:28px;overflow:hidden;white-space:nowrap">Ready</span></div><p data-agent-native-node-id="card-copy-${index}" style="margin:0;width:100%;height:58px;overflow:hidden;color:#475569">Nested auto-layout content for performance profiling.</p></article>`;
  }
  for (let index = 0; index < 3; index += 1) {
    html += `<div data-agent-native-node-id="extra-${index}" style="position:absolute;left:${index * 24}px;top:1760px;width:18px;height:18px;background:#94a3b8"></div>`;
  }
  for (let index = 0; index < 34; index += 1) {
    html += `<script type="application/json" data-perf-inert="${index}"></script>`;
  }
  return `${html}</main></body></html>`;
}

type CollectedInfo = {
  [key: string]: unknown;
  sourceId?: string;
  computedStyles?: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
  portableStyleSnapshot?: {
    nodes?: Array<{
      sourceId?: string;
      path: number[];
      styles?: Record<string, string>;
    }>;
  };
};

function stablePayloadValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stablePayloadValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, stablePayloadValue(entry)]),
  );
}

async function openBridgePage(page: Page) {
  await page.setContent(fixture());
  await page.evaluate(`
    window.__styleReads = 0;
    var rawGetComputedStyle = window.getComputedStyle.bind(window);
    window.getComputedStyle = function (el, pseudo) {
      window.__styleReads += 1;
      return rawGetComputedStyle(el, pseudo);
    };
    window.__subtreeQueries = 0;
    window.__subtreeNodes = 0;
    var rawQuerySelectorAll = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function (selector) {
      var result = rawQuerySelectorAll.call(this, selector);
      if (selector === "*" && this !== document.body) {
        window.__subtreeQueries += 1;
        window.__subtreeNodes += result.length;
      }
      return result;
    };
    window.__marqueeMessages = [];
    window.addEventListener("message", function (event) {
      if (event.data && event.data.type === "agent-native:layer-marquee-selection") {
        window.__marqueeMessages.push(event.data);
      }
    });
  `);
  await page.addScriptTag({ content: hydratedBridge() });
  await page.waitForTimeout(150);
}

async function collectSelectableRects(
  page: Page,
  options: {
    deep: boolean;
    atPoint?: { x: number; y: number };
    includePortableStyleSnapshot?: boolean;
  },
): Promise<CollectedInfo[]> {
  return page.evaluate(
    ([deep, atPoint, includePortableStyleSnapshot]) =>
      new Promise<CollectedInfo[]>((resolve) => {
        const id = `spec-${Math.random().toString(36).slice(2)}`;
        const onMessage = (event: MessageEvent) => {
          const data = event.data as {
            type?: string;
            correlationId?: string;
            payload?: CollectedInfo[];
          };
          if (
            data?.type !== "agent-native:selectable-rects-result" ||
            data.correlationId !== id
          ) {
            return;
          }
          window.removeEventListener("message", onMessage);
          resolve(data.payload ?? []);
        };
        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            type: "agent-native:collect-selectable-rects",
            correlationId: id,
            deep,
            includePortableStyleSnapshot,
            ...(atPoint ? { atPoint } : {}),
          },
          "*",
        );
      }),
    [
      options.deep,
      options.atPoint ?? null,
      options.includePortableStyleSnapshot ?? true,
    ] as const,
  );
}

type LargeBenchmarkReceipt = {
  elapsedMs: number;
  payload: CollectedInfo[];
};

async function openLargeBridgePage(page: Page): Promise<void> {
  await page.setContent(
    '<iframe data-large-perf-frame="0" style="width:1200px;height:1800px;border:0"></iframe><iframe data-large-perf-frame="1" style="width:1200px;height:1800px;border:0"></iframe>',
  );
  await page.evaluate((source) => {
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-large-perf-frame]")
      .forEach((iframe) => {
        iframe.srcdoc = source;
      });
  }, largeFixture());

  const iframes = await page
    .locator("iframe[data-large-perf-frame]")
    .elementHandles();
  for (const iframe of iframes) {
    const frame = await iframe.contentFrame();
    if (!frame) throw new Error("large performance iframe did not attach");
    const elementCount = await frame.evaluate(() => {
      const root = document.querySelector("main");
      return root ? root.querySelectorAll("*").length + 1 : 0;
    });
    if (elementCount !== LARGE_DOM_ELEMENTS) {
      throw new Error(
        `large performance fixture has ${elementCount} elements, expected ${LARGE_DOM_ELEMENTS}`,
      );
    }
    await frame.evaluate(() => {
      const win = window as typeof window & {
        __largeStyleReads?: number;
        __largeElementCount?: number;
      };
      win.__largeStyleReads = 0;
      const root = document.querySelector("main");
      win.__largeElementCount = root
        ? root.querySelectorAll("*").length + 1
        : 0;
      const rawGetComputedStyle = window.getComputedStyle.bind(window);
      window.getComputedStyle = function (element, pseudoElement) {
        win.__largeStyleReads = (win.__largeStyleReads ?? 0) + 1;
        return rawGetComputedStyle(element, pseudoElement);
      };
    });
    await frame.addScriptTag({ content: hydratedBridge() });
  }
  await page.waitForTimeout(100);
}

async function collectLargeFrame(
  page: Page,
  frameIndex: number,
): Promise<LargeBenchmarkReceipt> {
  return page.evaluate(
    (requestedIndex) =>
      new Promise<LargeBenchmarkReceipt>((resolve, reject) => {
        const iframe = document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-large-perf-frame]",
        )[requestedIndex];
        const contentWindow = iframe?.contentWindow;
        if (!contentWindow) {
          reject(
            new Error(`missing large performance iframe ${requestedIndex}`),
          );
          return;
        }
        const correlationId = `large-${requestedIndex}-${Math.random()}`;
        const started = performance.now();
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", listener);
          reject(
            new Error(`large performance request ${requestedIndex} timed out`),
          );
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
          resolve({
            elapsedMs: performance.now() - started,
            payload: Array.isArray(event.data.payload)
              ? event.data.payload
              : [],
          });
        };
        window.addEventListener("message", listener);
        contentWindow.postMessage(
          {
            type: "agent-native:collect-selectable-rects",
            correlationId,
            deep: true,
          },
          "*",
        );
      }),
    frameIndex,
  );
}

async function collectLargeFramesConcurrently(
  page: Page,
): Promise<[LargeBenchmarkReceipt, LargeBenchmarkReceipt]> {
  return page.evaluate(
    () =>
      new Promise<[LargeBenchmarkReceipt, LargeBenchmarkReceipt]>(
        (resolve, reject) => {
          const iframes = [
            ...document.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-large-perf-frame]",
            ),
          ];
          const contentWindows = iframes.map((iframe) => iframe.contentWindow);
          if (contentWindows.some((contentWindow) => !contentWindow)) {
            reject(new Error("large performance iframe is unavailable"));
            return;
          }
          const started = performance.now();
          const correlations = contentWindows.map(
            (_, index) => `large-concurrent-${index}-${Math.random()}`,
          );
          const receipts: Array<LargeBenchmarkReceipt | undefined> = new Array(
            contentWindows.length,
          ).fill(undefined);
          const timer = window.setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(
              new Error("concurrent large performance requests timed out"),
            );
          }, 10_000);
          const listener = (event: MessageEvent) => {
            const index = contentWindows.indexOf(event.source as WindowProxy);
            if (
              index === -1 ||
              event.data?.type !== "agent-native:selectable-rects-result" ||
              event.data?.correlationId !== correlations[index]
            ) {
              return;
            }
            receipts[index] = {
              elapsedMs: performance.now() - started,
              payload: Array.isArray(event.data.payload)
                ? event.data.payload
                : [],
            };
            if (receipts.every(Boolean)) {
              window.clearTimeout(timer);
              window.removeEventListener("message", listener);
              resolve(
                receipts as [LargeBenchmarkReceipt, LargeBenchmarkReceipt],
              );
            }
          };
          window.addEventListener("message", listener);
          contentWindows.forEach((contentWindow, index) => {
            contentWindow!.postMessage(
              {
                type: "agent-native:collect-selectable-rects",
                correlationId: correlations[index],
                deep: true,
              },
              "*",
            );
          });
        },
      ),
  );
}

function comparablePayload(payload: CollectedInfo[]) {
  return payload.map((info) => stablePayloadValue(info));
}

async function readLargeStyleReads(page: Page): Promise<number[]> {
  const iframes = await page
    .locator("iframe[data-large-perf-frame]")
    .elementHandles();
  return Promise.all(
    iframes.map(async (iframe) => {
      const frame = await iframe.contentFrame();
      if (!frame) throw new Error("large performance iframe detached");
      return frame.evaluate(
        () =>
          (window as typeof window & { __largeStyleReads?: number })
            .__largeStyleReads ?? 0,
      );
    }),
  );
}

function rectContainsPoint(
  info: CollectedInfo,
  point: { x: number; y: number },
): boolean {
  const { x, y, width, height } = info.boundingRect;
  return (
    point.x >= x &&
    point.x <= x + width &&
    point.y >= y &&
    point.y <= y + height
  );
}

describe("selectable-rects collect is bounded by the point it was asked about", () => {
  it("returns the containment chain, not every selectable node", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openBridgePage(page);

      const point = { x: 60, y: 70 };
      const all = await collectSelectableRects(page, { deep: true });
      const atPoint = await collectSelectableRects(page, {
        deep: true,
        atPoint: point,
      });

      expect(errors, errors.join("\n")).toEqual([]);
      expect(all.length).toBeGreaterThan(200);

      const hostWouldKeep = all
        .filter((info) => rectContainsPoint(info, point))
        .map((info) => info.sourceId)
        .sort();
      const returned = atPoint.map((info) => info.sourceId).sort();
      expect(hostWouldKeep.length).toBeGreaterThan(0);
      expect(returned).toEqual(expect.arrayContaining(hostWouldKeep));

      expect(atPoint.length).toBeLessThan(all.length / 10);
      expect(atPoint.length).toBeLessThanOrEqual(hostWouldKeep.length + 4);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("agrees with the reported boundingRect space when the document is scrolled", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 400 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openBridgePage(page);

      await page.evaluate("window.scrollTo(0, 420);");
      await page.waitForTimeout(50);
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(0);

      const all = await collectSelectableRects(page, { deep: true });
      const target = all.find((info) => info.sourceId?.startsWith("action-"));
      expect(target).toBeDefined();
      const centre = {
        x: target!.boundingRect.x + target!.boundingRect.width / 2,
        y: target!.boundingRect.y + target!.boundingRect.height / 2,
      };

      const atPoint = await collectSelectableRects(page, {
        deep: true,
        atPoint: centre,
      });

      expect(errors, errors.join("\n")).toEqual([]);
      expect(atPoint.map((info) => info.sourceId)).toContain(target!.sourceId);
      expect(atPoint.length).toBeLessThan(all.length / 10);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("builds full element info for the chain it returns", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      await openBridgePage(page);
      const atPoint = await collectSelectableRects(page, {
        deep: true,
        atPoint: { x: 60, y: 70 },
      });
      expect(atPoint.length).toBeGreaterThan(0);
      for (const info of atPoint) {
        expect(Object.keys(info.computedStyles ?? {}).length).toBeGreaterThan(
          0,
        );
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe("overview marquee selectable-rects collection", () => {
  it("keeps computed state without paying for portable subtree snapshots", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openBridgePage(page);

      const full = await collectSelectableRects(page, { deep: false });
      const fullReads = await page.evaluate(
        () =>
          (window as typeof window & { __styleReads?: number }).__styleReads ??
          0,
      );
      const fullSubtreeNodes = await page.evaluate(
        () =>
          (window as typeof window & { __subtreeNodes?: number })
            .__subtreeNodes ?? 0,
      );
      await page.evaluate("window.__styleReads = 0;");
      await page.evaluate(() => {
        const win = window as typeof window & {
          __subtreeQueries?: number;
          __subtreeNodes?: number;
        };
        win.__subtreeQueries = 0;
        win.__subtreeNodes = 0;
      });
      const lightweight = await collectSelectableRects(page, {
        deep: false,
        includePortableStyleSnapshot: false,
      });
      const lightweightReads = await page.evaluate(
        () =>
          (window as typeof window & { __styleReads?: number }).__styleReads ??
          0,
      );
      const lightweightSubtreeNodes = await page.evaluate(
        () =>
          (window as typeof window & { __subtreeNodes?: number })
            .__subtreeNodes ?? 0,
      );

      expect(errors, errors.join("\n")).toEqual([]);
      expect(lightweight).toHaveLength(full.length);
      expect(lightweight.length).toBeGreaterThan(20);
      expect(fullSubtreeNodes).toBeGreaterThan(0);
      expect(lightweightSubtreeNodes).toBe(0);
      expect(lightweightReads).toBeGreaterThan(0);
      expect(lightweightReads).toBeLessThan(fullReads);
      expect(
        lightweight.every(
          (info) =>
            Object.keys(info.computedStyles ?? {}).length > 0 &&
            info.portableStyleSnapshot === undefined,
        ),
      ).toBe(true);
      expect(
        full.every(
          (info) => (info.portableStyleSnapshot?.nodes?.length ?? 0) > 0,
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe("large concurrent selectable-rects requests", () => {
  it("keeps animated selected roots aligned after a mid-request mutation", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
        #parent { position: relative; width: 500px; height: 220px; }
        #transition-child, #animation-child {
          position: absolute; width: 180px; height: 80px;
        }
        #transition-leaf, #animation-leaf {
          width: 90px; height: 40px;
        }
        #transition-child {
          left: 20px; top: 20px; opacity: 1;
          transition: opacity 1s linear;
        }
        #animation-child {
          left: 20px; top: 120px;
          animation: fade 1s linear paused;
          animation-fill-mode: both;
        }
        #transition-leaf {
          opacity: 1;
          transition: opacity 1s linear;
        }
        #animation-leaf {
          animation: fade 1s linear paused;
          animation-fill-mode: both;
        }
      </style></head><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent">
          <div id="transition-child" data-agent-native-node-id="transition-child">
            <div id="transition-leaf" data-agent-native-node-id="transition-leaf"></div>
          </div>
          <div id="animation-child" data-agent-native-node-id="animation-child">
            <div id="animation-leaf" data-agent-native-node-id="animation-leaf"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const transitionChild =
          document.querySelector<HTMLElement>("#transition-child");
        const animationChild =
          document.querySelector<HTMLElement>("#animation-child");
        const transitionLeaf =
          document.querySelector<HTMLElement>("#transition-leaf");
        const animationLeaf =
          document.querySelector<HTMLElement>("#animation-leaf");
        if (
          !transitionChild ||
          !animationChild ||
          !transitionLeaf ||
          !animationLeaf
        ) {
          throw new Error("animation fixture did not attach");
        }
        const animation = animationChild.getAnimations()[0];
        const nestedAnimation = animationLeaf.getAnimations()[0];
        if (!animation || !nestedAnimation) {
          throw new Error("animation fixture did not animate");
        }
        animation.currentTime = 0;
        nestedAnimation.currentTime = 0;

        const rectReads = new Map<HTMLElement, number>([
          [transitionChild, 0],
          [animationChild, 0],
        ]);
        for (const child of [transitionChild, animationChild]) {
          const readRect = child.getBoundingClientRect.bind(child);
          child.getBoundingClientRect = () => {
            const rect = readRect();
            const reads = (rectReads.get(child) ?? 0) + 1;
            rectReads.set(child, reads);
            if (reads !== 2) return rect;
            if (child === transitionChild) {
              child.style.opacity = "0";
              transitionLeaf.style.opacity = "0";
              const transition = child.getAnimations()[0];
              const nestedTransition = transitionLeaf.getAnimations()[0];
              if (!transition || !nestedTransition) {
                throw new Error("transition did not start");
              }
              transition.currentTime = 500;
              transition.playbackRate = 0;
              nestedTransition.currentTime = 500;
              nestedTransition.playbackRate = 0;
            } else {
              animation.play();
              animation.currentTime = 500;
              animation.playbackRate = 0;
              nestedAnimation.play();
              nestedAnimation.currentTime = 500;
              nestedAnimation.playbackRate = 0;
            }
            return rect;
          };
        }
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const liveNestedOpacities = await page.evaluate(() => ({
        transition: getComputedStyle(
          document.querySelector<HTMLElement>("#transition-leaf")!,
        ).opacity,
        animation: getComputedStyle(
          document.querySelector<HTMLElement>("#animation-leaf")!,
        ).opacity,
      }));
      for (const [sourceId, nestedId, liveNestedOpacity] of [
        ["transition-child", "transition-leaf", liveNestedOpacities.transition],
        ["animation-child", "animation-leaf", liveNestedOpacities.animation],
      ] as const) {
        const info = payload.find(
          (candidate) => candidate.sourceId === sourceId,
        );
        expect(info).toBeDefined();
        const portableNodes = info?.portableStyleSnapshot?.nodes ?? [];
        const portableOpacity = portableNodes.find(
          (node) => node.path.length === 0,
        )?.styles?.opacity;
        const nestedPortableOpacity = portableNodes.find(
          (node) => node.sourceId === nestedId,
        )?.styles?.opacity;
        expect(portableOpacity).toBe(info?.computedStyles?.opacity);
        expect(portableOpacity).not.toBe(
          sourceId === "transition-child" ? "1" : "0",
        );
        expect(nestedPortableOpacity).toBe(liveNestedOpacity);
        expect(nestedPortableOpacity).not.toBe(
          sourceId === "transition-child" ? "1" : "0",
        );
        const rootPortableOpacity =
          info?.portableStyleSnapshot?.nodes?.[0]?.styles?.opacity;
        expect(rootPortableOpacity).toBe(portableOpacity);
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  async function collectAncestorMutationCase(
    mode: "animation" | "transition",
  ): Promise<{
    child: string;
    leaf: string;
    state: string | undefined;
    portableLeaf: string | undefined;
  }> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      const childRule =
        mode === "animation"
          ? "color: rgb(255, 0, 0); animation: tint 1s linear paused; animation-fill-mode: both;"
          : "color: rgb(255, 0, 0); transition: color 1s linear;";
      await page.setContent(`<!doctype html><html><head><style>
        @keyframes tint { from { color: rgb(255, 0, 0); } to { color: rgb(0, 0, 255); } }
        #parent { position: relative; width: 500px; height: 220px; }
        #child { position: absolute; left: 20px; top: 20px; width: 180px; height: 80px; ${childRule} }
        #leaf { width: 90px; height: 40px; }
      </style></head><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent">
          <div id="child" data-agent-native-node-id="child">
            <div id="leaf" data-agent-native-node-id="leaf"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate((mutationMode) => {
        const child = document.querySelector<HTMLElement>("#child");
        if (!child)
          throw new Error("ancestor animation fixture did not attach");
        const initialAnimation =
          mutationMode === "animation" ? child.getAnimations()[0] : undefined;
        if (mutationMode === "animation" && !initialAnimation) {
          throw new Error("ancestor animation did not attach");
        }
        if (initialAnimation) initialAnimation.currentTime = 0;
        let reads = 0;
        const nativeRect = child.getBoundingClientRect.bind(child);
        child.getBoundingClientRect = () => {
          const rect = nativeRect();
          reads += 1;
          if (reads !== 2) return rect;
          if (mutationMode === "animation") {
            initialAnimation!.play();
            initialAnimation!.currentTime = 500;
            initialAnimation!.playbackRate = 0;
          } else {
            child.style.color = "rgb(0, 0, 255)";
            const transition = child.getAnimations()[0];
            if (!transition)
              throw new Error("ancestor transition did not attach");
            transition.currentTime = 500;
            transition.playbackRate = 0;
          }
          return rect;
        };
      }, mode);
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const live = await page.evaluate(() => ({
        child: getComputedStyle(document.querySelector<HTMLElement>("#child")!)
          .color,
        leaf: getComputedStyle(document.querySelector<HTMLElement>("#leaf")!)
          .color,
        state: document.querySelector<HTMLElement>("#child")!.getAnimations()[0]
          ?.playState,
      }));
      const childInfo = payload.find((info) => info.sourceId === "child");
      expect(childInfo).toBeDefined();
      const portableLeaf = childInfo?.portableStyleSnapshot?.nodes?.find(
        (node) => node.sourceId === "leaf",
      )?.styles?.color;
      expect(live.child).toBe("rgb(128, 0, 128)");
      expect(live.leaf).toBe("rgb(128, 0, 128)");
      expect(live.state).toBe("running");
      return {
        child: live.child,
        leaf: live.leaf,
        state: live.state,
        portableLeaf,
      };
    } finally {
      await browser.close();
    }
  }

  it("refreshes a descendant when an ancestor animation changes an inherited style", async () => {
    const result = await collectAncestorMutationCase("animation");
    expect(result.portableLeaf).toBe(result.leaf);
  }, 60_000);

  async function collectKeyframeEffectMutationCase(
    mutation: "setKeyframes" | "updateTiming" | "replaceEffect",
  ): Promise<{
    before: [string, number | null, number | null, number];
    after: [string, number | null, number | null, number];
    leaf: string;
    portableLeaf: string | undefined;
  }> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent" style="position:relative;width:500px;height:220px">
          <div id="child" data-agent-native-node-id="child" style="position:absolute;left:20px;top:20px;width:180px;height:80px">
            <div id="leaf" data-agent-native-node-id="leaf" style="width:90px;height:40px"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate((mutationMethod) => {
        const child = document.querySelector<HTMLElement>("#child");
        const leaf = document.querySelector<HTMLElement>("#leaf");
        if (!child || !leaf)
          throw new Error("keyframe effect fixture did not attach");
        const animation = leaf.animate(
          [{ color: "rgb(255, 0, 0)" }, { color: "rgb(0, 0, 255)" }],
          { duration: 1000, fill: "both" },
        );
        animation.pause();
        animation.currentTime = 500;
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect)) {
          throw new Error("keyframe effect fixture did not attach");
        }
        const state = () =>
          [
            animation.playState,
            animation.currentTime,
            animation.startTime,
            animation.playbackRate,
          ] as [string, number | null, number | null, number];
        (
          window as typeof window & {
            __testKeyframeEffectBefore?: ReturnType<typeof state>;
          }
        ).__testKeyframeEffectBefore = state();
        const nativeRect = child.getBoundingClientRect.bind(child);
        let reads = 0;
        child.getBoundingClientRect = () => {
          const rect = nativeRect();
          reads += 1;
          if (reads === 2) {
            if (mutationMethod === "setKeyframes") {
              effect.setKeyframes([
                { color: "rgb(0, 0, 255)" },
                { color: "rgb(0, 0, 255)" },
              ]);
            } else if (mutationMethod === "updateTiming") {
              effect.updateTiming({ duration: 2000 });
            } else {
              animation.effect = new KeyframeEffect(
                leaf,
                [{ color: "rgb(0, 0, 255)" }, { color: "rgb(0, 0, 255)" }],
                { duration: 1000, fill: "both" },
              );
            }
          }
          return rect;
        };
      }, mutation);
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const result = await page.evaluate(() => {
        const leaf = document.querySelector<HTMLElement>("#leaf");
        const animation = leaf?.getAnimations()[0];
        const before = (
          window as typeof window & {
            __testKeyframeEffectBefore?: [
              string,
              number | null,
              number | null,
              number,
            ];
          }
        ).__testKeyframeEffectBefore;
        if (!leaf || !animation || !before) {
          throw new Error("keyframe effect fixture state missing");
        }
        return {
          before,
          after: [
            animation.playState,
            animation.currentTime,
            animation.startTime,
            animation.playbackRate,
          ] as [string, number | null, number | null, number],
          leaf: getComputedStyle(leaf).color,
        };
      });
      const childInfo = payload.find((info) => info.sourceId === "child");
      return {
        ...result,
        portableLeaf: childInfo?.portableStyleSnapshot?.nodes?.find(
          (node) => node.sourceId === "leaf",
        )?.styles?.color,
      };
    } finally {
      await browser.close();
    }
  }

  (["setKeyframes", "updateTiming", "replaceEffect"] as const).forEach(
    (mutation) => {
      it(`invalidates cached styles after KeyframeEffect.${mutation}()`, async () => {
        const result = await collectKeyframeEffectMutationCase(mutation);
        expect(result.after).toEqual(result.before);
        expect(result.portableLeaf).toBe(result.leaf);
      }, 60_000);
    },
  );

  it("refreshes a descendant when an ancestor animation starts mid-request", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent">
          <div id="child" data-agent-native-node-id="child" style="color:rgb(255, 0, 0); width:180px; height:80px">
            <div id="leaf" data-agent-native-node-id="leaf" style="width:90px; height:40px"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const child = document.querySelector<HTMLElement>("#child");
        if (!child)
          throw new Error("mid-request animation fixture missing child");
        const animation = child.animate(
          [{ color: "rgb(255, 0, 0)" }, { color: "rgb(0, 0, 255)" }],
          { duration: 1000, fill: "both" },
        );
        animation.cancel();
        let rectReads = 0;
        const nativeRect = child.getBoundingClientRect.bind(child);
        child.getBoundingClientRect = () => {
          const rect = nativeRect();
          rectReads += 1;
          if (rectReads === 2) {
            animation.play();
            animation.currentTime = 500;
            animation.playbackRate = 0;
          }
          return rect;
        };
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const live = await page.evaluate(() => ({
        child: getComputedStyle(document.querySelector<HTMLElement>("#child")!)
          .color,
        leaf: getComputedStyle(document.querySelector<HTMLElement>("#leaf")!)
          .color,
        state: document.querySelector<HTMLElement>("#child")!.getAnimations()[0]
          ?.playState,
      }));
      const childInfo = payload.find((info) => info.sourceId === "child");
      const portableLeaf = childInfo?.portableStyleSnapshot?.nodes?.find(
        (node) => node.sourceId === "leaf",
      )?.styles?.color;
      expect(live.child).toBe("rgb(128, 0, 128)");
      expect(live.leaf).toBe(live.child);
      expect(live.state).toBe("running");
      expect(portableLeaf).toBe(live.leaf);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("refreshes descendants when paused and finished animations seek mid-request", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 420 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent" style="position:relative;width:500px;height:360px">
          <div id="paused-child" data-agent-native-node-id="paused-child" style="position:absolute;left:20px;top:20px;width:180px;height:80px;color:rgb(255,0,0)">
            <div id="paused-leaf" data-agent-native-node-id="paused-leaf" style="width:90px;height:40px"></div>
          </div>
          <div id="finished-child" data-agent-native-node-id="finished-child" style="position:absolute;left:20px;top:140px;width:180px;height:80px;color:rgb(255,0,0)">
            <div id="finished-leaf" data-agent-native-node-id="finished-leaf" style="width:90px;height:40px"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const pausedChild =
          document.querySelector<HTMLElement>("#paused-child");
        const finishedChild =
          document.querySelector<HTMLElement>("#finished-child");
        if (!pausedChild || !finishedChild) {
          throw new Error("paused animation fixture did not attach");
        }
        const pausedAnimation = pausedChild.animate(
          [{ color: "rgb(255,0,0)" }, { color: "rgb(0,0,255)" }],
          { duration: 1000, fill: "both" },
        );
        const finishedAnimation = finishedChild.animate(
          [{ color: "rgb(255,0,0)" }, { color: "rgb(0,0,255)" }],
          { duration: 1000, fill: "both" },
        );
        pausedAnimation.pause();
        finishedAnimation.pause();
        pausedAnimation.currentTime = 0;
        finishedAnimation.currentTime = 0;
        const mutations = new Map<HTMLElement, number>([
          [pausedChild, 0],
          [finishedChild, 0],
        ]);
        const mutateOnSecondRectRead = (
          child: HTMLElement,
          mutate: () => void,
        ) => {
          const nativeRect = child.getBoundingClientRect.bind(child);
          child.getBoundingClientRect = () => {
            const rect = nativeRect();
            const reads = (mutations.get(child) ?? 0) + 1;
            mutations.set(child, reads);
            if (reads === 2) mutate();
            return rect;
          };
        };
        mutateOnSecondRectRead(pausedChild, () => {
          pausedAnimation.currentTime = 500;
        });
        mutateOnSecondRectRead(finishedChild, () => {
          finishedAnimation.finish();
        });
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const live = await page.evaluate(() =>
        ["paused", "finished"].map((kind) => {
          const child = document.querySelector<HTMLElement>(`#${kind}-child`)!;
          const leaf = document.querySelector<HTMLElement>(`#${kind}-leaf`)!;
          return {
            kind,
            child: getComputedStyle(child).color,
            leaf: getComputedStyle(leaf).color,
            state: child.getAnimations()[0]?.playState,
          };
        }),
      );
      for (const item of live) {
        const childInfo = payload.find(
          (candidate) => candidate.sourceId === `${item.kind}-child`,
        );
        expect(childInfo).toBeDefined();
        const portableLeaf = childInfo?.portableStyleSnapshot?.nodes?.find(
          (node) => node.sourceId === `${item.kind}-leaf`,
        )?.styles?.color;
        expect(item.child).toBe(item.leaf);
        expect(item.state).toBe(item.kind === "paused" ? "paused" : "finished");
        expect(portableLeaf).toBe(item.leaf);
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("refreshes a descendant when an ancestor transition changes an inherited style", async () => {
    const result = await collectAncestorMutationCase("transition");
    expect(result.portableLeaf).toBe(result.leaf);
  }, 60_000);

  it("invalidates cached styles after a mid-request DOM/style mutation", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent" style="position:relative;width:500px;height:220px">
          <div id="child" data-agent-native-node-id="child" style="position:absolute;left:20px;top:20px;width:180px;height:80px">
            <div id="leaf" data-agent-native-node-id="leaf" style="width:90px;height:40px;color:rgb(255, 0, 0)"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const child = document.querySelector<HTMLElement>("#child");
        const leaf = document.querySelector<HTMLElement>("#leaf");
        if (!child || !leaf)
          throw new Error("style mutation fixture did not attach");
        const nativeRect = child.getBoundingClientRect.bind(child);
        let reads = 0;
        child.getBoundingClientRect = () => {
          const rect = nativeRect();
          reads += 1;
          if (reads === 2) leaf.style.color = "rgb(0, 0, 255)";
          return rect;
        };
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const liveLeaf = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector<HTMLElement>("#leaf")!).color,
      );
      const childInfo = payload.find((info) => info.sourceId === "child");
      const portableLeaf = childInfo?.portableStyleSnapshot?.nodes?.find(
        (node) => node.sourceId === "leaf",
      )?.styles?.color;
      expect(liveLeaf).toBe("rgb(0, 0, 255)");
      expect(portableLeaf).toBe(liveLeaf);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("invalidates cached slotted styles after a shadow-root stylesheet mutation", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="host" data-agent-native-node-id="host">
          <div id="parent" data-agent-native-node-id="parent" style="position:relative;width:500px;height:220px">
            <div id="child" data-agent-native-node-id="child" style="width:180px;height:80px">
              <div id="leaf" data-agent-native-node-id="leaf" style="width:90px;height:40px"></div>
            </div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("#host");
        const child = document.querySelector<HTMLElement>("#child");
        const leaf = document.querySelector<HTMLElement>("#leaf");
        if (!host || !child || !leaf)
          throw new Error("shadow style fixture did not attach");
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style id="theme">slot { color: rgb(255, 0, 0); }</style><slot></slot>`;
        const slot = shadow.querySelector("slot");
        if (!slot) throw new Error("shadow style fixture slot did not attach");
        const nativeRect = child.getBoundingClientRect.bind(child);
        let reads = 0;
        child.getBoundingClientRect = () => {
          const rect = nativeRect();
          reads += 1;
          if (reads === 2) {
            const style = shadow.querySelector<HTMLStyleElement>("#theme");
            if (!style)
              throw new Error("shadow style fixture stylesheet missing");
            style.textContent = "slot { color: rgb(0, 0, 255); }";
          }
          return rect;
        };
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const live = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("#host")!;
        const leaf = document.querySelector<HTMLElement>("#leaf")!;
        const slot = host.shadowRoot?.querySelector("slot")!;
        return {
          leaf: getComputedStyle(leaf).color,
          slot: getComputedStyle(slot).color,
        };
      });
      const childInfo = payload.find((info) => info.sourceId === "child");
      const portableLeaf = childInfo?.portableStyleSnapshot?.nodes?.find(
        (node) => node.sourceId === "leaf",
      )?.styles?.color;
      expect(live.leaf).toBe("rgb(0, 0, 255)");
      expect(live.slot).toBe(live.leaf);
      expect(portableLeaf).toBe(live.leaf);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("invalidates cached styles after a stylesheet CSSOM mutation", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><head><style id="theme">
        #leaf { color: rgb(255, 0, 0); }
      </style></head><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent" style="position:relative;width:500px;height:220px">
          <div id="child" data-agent-native-node-id="child" style="position:absolute;left:20px;top:20px;width:180px;height:80px">
            <div id="leaf" data-agent-native-node-id="leaf" style="width:90px;height:40px"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const child = document.querySelector<HTMLElement>("#child");
        const style = document.querySelector<HTMLStyleElement>("#theme");
        const sheet = style?.sheet;
        const rule = sheet?.cssRules[0];
        if (!child || !sheet || !(rule instanceof CSSStyleRule)) {
          throw new Error("CSSOM style fixture did not attach");
        }
        const nativeRect = child.getBoundingClientRect.bind(child);
        let reads = 0;
        child.getBoundingClientRect = () => {
          const rect = nativeRect();
          reads += 1;
          if (reads === 2) {
            rule.style.setProperty("color", "rgb(0, 0, 255)");
          }
          return rect;
        };
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const liveLeaf = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector<HTMLElement>("#leaf")!).color,
      );
      const childInfo = payload.find((info) => info.sourceId === "child");
      const portableLeaf = childInfo?.portableStyleSnapshot?.nodes?.find(
        (node) => node.sourceId === "leaf",
      )?.styles?.color;
      expect(liveLeaf).toBe("rgb(0, 0, 255)");
      expect(portableLeaf).toBe(liveLeaf);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("keeps same-global CSSOM hook ownership through non-LIFO teardown", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><head><style id="theme">
        #leaf { color: rgb(255, 0, 0); }
      </style></head><body style="margin:0">
        <div id="leaf" data-agent-native-node-id="leaf">Leaf</div>
      </body></html>`);
      await page.addScriptTag({
        content: hydratedBridgeWithCssomCacheFactory(),
      });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const result = await page.evaluate(() => {
        const win = window as typeof window & {
          __testCreatePortableStyleComputedStylesCache?: () => {
            mutationGeneration: number;
            mutationObserver: MutationObserver;
            restoreCssomHooks: () => void;
          };
        };
        const createCache = win.__testCreatePortableStyleComputedStylesCache;
        const style = document.querySelector<HTMLStyleElement>("#theme");
        const rule = style?.sheet?.cssRules[0];
        if (!createCache || !(rule instanceof CSSStyleRule)) {
          throw new Error("CSSOM cache factory fixture did not attach");
        }
        let owner: object = CSSStyleDeclaration.prototype;
        while (
          owner &&
          !Object.prototype.hasOwnProperty.call(owner, "setProperty")
        ) {
          owner = Object.getPrototypeOf(owner) as object;
        }
        const original = Object.getOwnPropertyDescriptor(
          owner,
          "setProperty",
        )?.value;
        if (typeof original !== "function") {
          throw new Error("CSSOM setProperty descriptor did not attach");
        }
        const first = createCache();
        const second = createCache();
        if (!first || !second) {
          throw new Error("CSSOM cache factory returned no cache");
        }
        try {
          const before = second.mutationGeneration;
          first.restoreCssomHooks();
          rule.style.setProperty("color", "rgb(0, 0, 255)");
          const after = second.mutationGeneration;
          second.restoreCssomHooks();
          const restored =
            Object.getOwnPropertyDescriptor(owner, "setProperty")?.value ===
            original;
          return { invalidated: after > before, restored };
        } finally {
          first.mutationObserver.disconnect();
          second.mutationObserver.disconnect();
          first.restoreCssomHooks();
          second.restoreCssomHooks();
        }
      });

      expect(result).toEqual({ invalidated: true, restored: true });
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("follows assigned slots when checking inherited animated styles", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="host" data-agent-native-node-id="host">
          <div id="parent" data-agent-native-node-id="parent" style="position:relative;width:500px;height:220px">
            <div id="child" data-agent-native-node-id="child" style="width:180px;height:80px">
              <div id="leaf" data-agent-native-node-id="leaf" style="width:90px;height:40px"></div>
            </div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("#host");
        const child = document.querySelector<HTMLElement>("#child");
        const leaf = document.querySelector<HTMLElement>("#leaf");
        if (!host || !child || !leaf)
          throw new Error("slot fixture did not attach");
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style>
          @keyframes tint { from { color: rgb(255, 0, 0); } to { color: rgb(0, 0, 255); } }
          slot { color: rgb(255, 0, 0); animation: tint 1s linear paused; animation-fill-mode: both; }
        </style><slot></slot>`;
        const slot = shadow.querySelector("slot");
        const animation = slot?.getAnimations()[0];
        if (!slot || !animation)
          throw new Error("slot animation did not attach");
        animation.currentTime = 0;
        const nativeRect = child.getBoundingClientRect.bind(child);
        let reads = 0;
        child.getBoundingClientRect = () => {
          const rect = nativeRect();
          reads += 1;
          if (reads === 2) {
            animation.play();
            animation.currentTime = 500;
            animation.playbackRate = 0;
          }
          return rect;
        };
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const payload = await collectSelectableRects(page, { deep: true });
      const live = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("#host")!;
        const leaf = document.querySelector<HTMLElement>("#leaf")!;
        const slot = host.shadowRoot?.querySelector("slot")!;
        return {
          leaf: getComputedStyle(leaf).color,
          slot: getComputedStyle(slot).color,
          state: slot.getAnimations()[0]?.playState,
        };
      });
      const childInfo = payload.find((info) => info.sourceId === "child");
      const portableLeaf = childInfo?.portableStyleSnapshot?.nodes?.find(
        (node) => node.sourceId === "leaf",
      )?.styles?.color;
      expect(live.leaf).toBe("rgb(128, 0, 128)");
      expect(live.slot).toBe(live.leaf);
      expect(live.state).toBe("running");
      expect(portableLeaf).toBe(live.leaf);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("fails closed when getAnimations cannot be read", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 600, height: 300 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="parent" data-agent-native-node-id="parent" style="position:relative;width:500px;height:220px">
          <div id="child" data-agent-native-node-id="child" style="position:absolute;left:20px;top:20px;width:180px;height:80px">
            <div id="leaf" data-agent-native-node-id="leaf" style="width:90px;height:40px"></div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const leaf = document.querySelector<HTMLElement>("#leaf");
        if (!leaf)
          throw new Error("unreadable animation fixture did not attach");
        Object.defineProperty(leaf, "getAnimations", {
          configurable: true,
          get() {
            throw new Error("animation state blocked");
          },
        });
      });
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const outcome = await Promise.race([
        collectSelectableRects(page, { deep: true }).then((payload) => ({
          posted: true as const,
          payload,
        })),
        new Promise<{ posted: false; payload: CollectedInfo[] }>((resolve) =>
          setTimeout(() => resolve({ posted: false, payload: [] }), 1_000),
        ),
      ]);
      expect(errors, errors.join("\n")).toEqual([]);
      expect(outcome.posted).toBe(true);
      expect(outcome.payload.length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("preserves payload shape while caching portable styles per request", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openLargeBridgePage(page);

      const serial = await collectLargeFrame(page, 0);
      expect(serial.payload).toHaveLength(LARGE_CANDIDATES);
      const expected = comparablePayload(serial.payload);

      const iframes = await page
        .locator("iframe[data-large-perf-frame]")
        .elementHandles();
      for (const iframe of iframes) {
        const frame = await iframe.contentFrame();
        if (!frame) throw new Error("large performance iframe detached");
        await frame.evaluate(() => {
          (
            window as typeof window & { __largeStyleReads?: number }
          ).__largeStyleReads = 0;
        });
      }

      const [first, second] = await collectLargeFramesConcurrently(page);
      expect(errors, errors.join("\n")).toEqual([]);
      expect(first.payload).toHaveLength(LARGE_CANDIDATES);
      expect(second.payload).toHaveLength(LARGE_CANDIDATES);
      expect(comparablePayload(first.payload)).toEqual(expected);
      expect(comparablePayload(second.payload)).toEqual(expected);

      const styleReads = await readLargeStyleReads(page);
      expect(styleReads).toHaveLength(2);
      expect(styleReads[0]).toBeLessThanOrEqual(LARGE_DOM_ELEMENTS * 6);
      expect(styleReads[1]).toBeLessThanOrEqual(LARGE_DOM_ELEMENTS * 6);
      expect(styleReads[0]).toBeGreaterThan(LARGE_DOM_ELEMENTS * 4);
      expect(styleReads[1]).toBeGreaterThan(LARGE_DOM_ELEMENTS * 4);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe("a marquee drag does not rebuild element info every frame", () => {
  it("keeps computed-style reads proportional to elements, not to frames", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openBridgePage(page);

      await page.evaluate("window.__styleReads = 0;");
      await page.mouse.move(8, 8);
      await page.mouse.down();
      await page.mouse.move(780, 700, { steps: 30 });
      await page.waitForTimeout(80);
      const live = await page.evaluate(() => {
        const msgs = (
          window as unknown as {
            __marqueeMessages: Array<{
              payload?: Array<{
                computedStyles?: Record<string, string>;
                portableStyleSnapshot?: unknown;
              }>;
            }>;
          }
        ).__marqueeMessages;
        return {
          styleReads: (window as unknown as { __styleReads: number })
            .__styleReads,
          messages: msgs.length,
          selectedCount: (msgs[msgs.length - 1]?.payload ?? []).length,
          payloads: msgs.flatMap((message) => message.payload ?? []),
        };
      });
      await page.mouse.up();
      await page.waitForTimeout(80);

      expect(errors, errors.join("\n")).toEqual([]);
      expect(live.messages).toBeGreaterThan(5);
      expect(live.selectedCount).toBeGreaterThan(20);

      expect(
        live.payloads.every(
          (info) =>
            Object.keys(info.computedStyles ?? {}).length === 0 &&
            info.portableStyleSnapshot === undefined,
        ),
      ).toBe(true);

      expect(live.styleReads).toBeLessThan(live.selectedCount * 25);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("still reports the swept elements, and tags exactly one final report", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      await openBridgePage(page);
      await page.mouse.move(8, 8);
      await page.mouse.down();
      await page.mouse.move(780, 700, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(80);

      const { finals, lastIsFinal, lastInfos } = await page.evaluate(() => {
        const msgs = (
          window as unknown as {
            __marqueeMessages: Array<{
              intent?: { final?: boolean };
              payload?: Array<{
                sourceId?: string;
                computedStyles?: Record<string, string>;
              }>;
            }>;
          }
        ).__marqueeMessages;
        return {
          finals: msgs.filter((m) => m.intent?.final === true).length,
          lastIsFinal: msgs[msgs.length - 1]?.intent?.final === true,
          lastInfos: msgs[msgs.length - 1]?.payload ?? [],
        };
      });

      expect(finals).toBe(1);
      expect(lastIsFinal).toBe(true);
      expect(lastInfos.map((info) => info.sourceId ?? "")).toEqual(
        expect.arrayContaining(["card-0"]),
      );
      expect(
        lastInfos.every(
          (info) => Object.keys(info.computedStyles ?? {}).length > 0,
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
