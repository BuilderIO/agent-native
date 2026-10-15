import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";
import { mixedElementFromSelection } from "../edit-panel/selection-helpers";
import type { ElementInfo } from "../types";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("selection-chrome"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div id="auto-layout" style="display:flex;width:600px;height:400px;padding:20px;gap:20px">
    <div id="frame" data-agent-native-node-id="frame" data-an-primitive="frame" style="display:flex;width:300px;height:300px;background:#fff">
      <div id="child" data-agent-native-node-id="child" data-an-primitive="rectangle" style="width:80px;height:80px;background:#d4d4d8"></div>
    </div>
  </div>
</body></html>`;

const MEASUREMENT_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div id="selected-parent" style="position:relative;width:1000px;height:800px">
    <div id="selected" data-agent-native-node-id="selected" style="position:absolute;left:200px;top:200px;width:200px;height:120px;background:#d4d4d8"></div>
  </div>
  <div id="hover-parent" style="position:absolute;left:519px;top:400px;width:200px;height:120px">
    <div id="hovered" data-agent-native-node-id="hovered" style="width:200px;height:120px;background:#ccc"></div>
  </div>
  <div id="unrelated-region" style="position:absolute;left:800px;top:20px;width:100px;height:100px">
    <div id="unrelated-descendant">Unrelated</div>
  </div>
</body></html>`;

const SELECTED_SVG_MEASUREMENT_FIXTURE = `<!doctype html><html><body style="margin:0">
  <svg id="selected" data-agent-native-node-id="selected" data-an-primitive="pasted-svg" width="200" height="120" viewBox="0 0 200 120"
       style="position:absolute;left:200px;top:200px;display:block">
    <defs><linearGradient id="paint"><stop offset="0" stop-color="#000" /></linearGradient></defs>
    <title>Selected vector</title>
    <desc>A vector with editable paint.</desc>
    <path id="shape" d="M0 0h200v120H0z" fill="url(#paint)" />
  </svg>
  <svg id="external-paint-definitions" width="0" height="0" style="position:absolute">
    <defs><linearGradient id="replacement"><stop offset="0" stop-color="#f00" /></linearGradient></defs>
  </svg>
  <div id="hovered" data-agent-native-node-id="hovered"
       style="position:absolute;left:519px;top:400px;width:200px;height:120px;background:#ccc"></div>
</body></html>`;

const STYLESHEET_VECTOR_GRADIENT_FIXTURE = `<!doctype html><html><head><style>
  #gradient-a {
    --an-vector-fill-gradient: linear-gradient(90deg, rgb(255 0 0), rgb(0 0 255));
    --an-vector-stroke-gradient: linear-gradient(90deg, rgb(0 0 0), rgb(255 255 255));
  }
  #gradient-b {
    --an-vector-fill-gradient: linear-gradient(90deg, rgb(0 128 0), rgb(255 255 0));
    --an-vector-stroke-gradient: linear-gradient(90deg, rgb(255 0 0), rgb(0 0 255));
  }
</style></head><body style="margin:0">
  <svg id="gradient-a" data-agent-native-node-id="gradient-a" data-an-primitive="pasted-svg" width="120" height="80" viewBox="0 0 120 80">
    <path d="M0 0h120v80H0z" fill="#f00" stroke="#111" stroke-width="4" />
  </svg>
  <svg id="gradient-b" data-agent-native-node-id="gradient-b" data-an-primitive="pasted-svg" width="120" height="80" viewBox="0 0 120 80">
    <path d="M0 0h120v80H0z" fill="#0f0" stroke="#111" stroke-width="4" />
  </svg>
</body></html>`;

type GradientSelectionWindow = Window & {
  __gradientSelections?: { payload: ElementInfo }[];
  __gradientMeasurements?: { payload: ElementInfo; correlationId: string }[];
};

type MeasurementTestWindow = Window & {
  __measurementBoundsReads?: { selected: number; hovered: number };
  __measurementOverlayMutations?: { selection: number; measurements: number };
  __svgDescendantScanQueries?: number;
};

type PositionMeasurementWindow = Window & {
  __positionMeasurements?: {
    correlationId: string;
    payload: ElementInfo | null;
  }[];
};

async function startAltMeasurement(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.setContent(MEASUREMENT_FIXTURE);
  await page.evaluate(() => {
    const reads = { selected: 0, hovered: 0 };
    const elements = {
      selected: document.querySelector("#selected")!,
      hovered: document.querySelector("#hovered")!,
    };
    (Object.keys(elements) as (keyof typeof elements)[]).forEach((key) => {
      const element = elements[key];
      const getBoundingClientRect = element.getBoundingClientRect.bind(element);
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => {
          reads[key] += 1;
          return getBoundingClientRect();
        },
      });
    });
    (window as MeasurementTestWindow).__measurementBoundsReads = reads;
  });
  await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
  await select(page, "#selected");
  await page.keyboard.down("Alt");
  await page.mouse.move(520, 410, { steps: 3 });
  await page.waitForFunction(() => {
    const overlay = document.querySelector(
      "[data-agent-native-measurement-overlay]",
    );
    return (
      overlay?.getAttribute("style")?.includes("display: block") &&
      Boolean(overlay.children.length)
    );
  });
}

async function measurementBoundsReads(
  page: import("@playwright/test").Page,
): Promise<{ selected: number; hovered: number }> {
  return page.evaluate(
    () => (window as MeasurementTestWindow).__measurementBoundsReads!,
  );
}

async function select(page: import("@playwright/test").Page, selector: string) {
  await page.evaluate((value) => {
    window.postMessage(
      { type: "select-element", selector: value, selectorCandidates: [value] },
      "*",
    );
  }, selector);
  await page.waitForTimeout(50);
}

async function measurePositionContext(
  page: import("@playwright/test").Page,
  correlationId: string,
): Promise<ElementInfo | null> {
  await page.evaluate((id) => {
    window.postMessage(
      {
        type: "agent-native:measure-selection",
        screenId: "selection-chrome",
        correlationId: id,
        selector: "#offset-root",
      },
      "*",
    );
  }, correlationId);
  await page.waitForFunction(
    (id) =>
      (window as PositionMeasurementWindow).__positionMeasurements?.some(
        (measurement) => measurement.correlationId === id,
      ),
    correlationId,
  );
  return page.evaluate((id) => {
    const measurements = (window as PositionMeasurementWindow)
      .__positionMeasurements;
    return (
      measurements?.find((measurement) => measurement.correlationId === id)
        ?.payload ?? null
    );
  }, correlationId);
}

describe("editor chrome selection overlays", () => {
  it("omits position context when the board content offset is unreadable", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(`<!doctype html><html><head></head><body style="margin:0">
        <div id="offset-root" data-agent-native-node-id="offset-root" style="position:absolute;left:0;top:0;width:100px;height:60px"></div>
      </body></html>`);
      await page.evaluate(() => {
        const testWindow = window as PositionMeasurementWindow;
        testWindow.__positionMeasurements = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "agent-native:selection-measured") {
            testWindow.__positionMeasurements?.push({
              correlationId: event.data.correlationId,
              payload: event.data.payload,
            });
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const absentMarker = await measurePositionContext(page, "offset-absent");
      expect(absentMarker).toMatchObject({
        boundingRect: { x: 0, y: 0, width: 100, height: 60 },
        positionReferenceRect: { x: 0, y: 0, width: 800, height: 600 },
        positionContainingBlockOrigin: { x: 0, y: 0 },
        positionContainingBlockTransform: { a: 1, b: 0, c: 0, d: 1 },
      });

      await page.evaluate(() => {
        const offsetStyle = document.createElement("style");
        offsetStyle.setAttribute("data-agent-native-content-offset", "");
        offsetStyle.setAttribute("data-agent-native-content-offset-x", "29");
        offsetStyle.setAttribute("data-agent-native-content-offset-y", "17");
        offsetStyle.textContent =
          "body > [data-agent-native-node-id]{translate:29px 17px;}";
        document.head.appendChild(offsetStyle);
      });
      const validMetadata = await measurePositionContext(page, "offset-valid");
      expect(validMetadata).toMatchObject({
        boundingRect: { x: 29, y: 17, width: 100, height: 60 },
        positionReferenceRect: { x: 29, y: 17, width: 800, height: 600 },
        positionContainingBlockOrigin: { x: 29, y: 17 },
        positionContainingBlockTransform: { a: 1, b: 0, c: 0, d: 1 },
      });

      await page.evaluate(() => {
        const offsetStyle = document.querySelector(
          "style[data-agent-native-content-offset]",
        )!;
        offsetStyle.setAttribute(
          "data-agent-native-content-offset-x",
          "unreadable",
        );
        offsetStyle.textContent =
          "body > [data-agent-native-node-id]{translate:calc(20px + 13px) 17px;}";
      });
      const unreadableMetadata = await measurePositionContext(
        page,
        "offset-unreadable",
      );
      expect(unreadableMetadata?.boundingRect).toEqual({
        x: 33,
        y: 17,
        width: 100,
        height: 60,
      });
      expect(unreadableMetadata).not.toHaveProperty("positionReferenceRect");
      expect(unreadableMetadata).not.toHaveProperty(
        "positionContainingBlockOrigin",
      );
      expect(unreadableMetadata).not.toHaveProperty(
        "positionContainingBlockTransform",
      );
    } finally {
      await browser.close();
    }
  });

  it("publishes stylesheet-backed vector gradients on select and refresh", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(STYLESHEET_VECTOR_GRADIENT_FIXTURE);
      await page.evaluate(() => {
        const testWindow = window as GradientSelectionWindow;
        testWindow.__gradientSelections = [];
        testWindow.__gradientMeasurements = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select" && event.data.payload) {
            testWindow.__gradientSelections?.push(event.data);
          }
          if (
            event.data?.type === "agent-native:selection-measured" &&
            event.data.payload
          ) {
            testWindow.__gradientMeasurements?.push(event.data);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await select(page, "#gradient-a");
      await page.waitForFunction(
        () => (window as GradientSelectionWindow).__gradientSelections?.length,
      );
      const firstSelection = await page.evaluate(() => {
        const testWindow = window as GradientSelectionWindow;
        const payload = testWindow.__gradientSelections?.[0]?.payload;
        const actual = getComputedStyle(
          document.querySelector("#gradient-a path")!,
        )
          .getPropertyValue("--an-vector-fill-gradient")
          .trim();
        const actualStroke = getComputedStyle(
          document.querySelector("#gradient-a path")!,
        )
          .getPropertyValue("--an-vector-stroke-gradient")
          .trim();
        return { payload, actual, actualStroke };
      });

      expect(
        firstSelection.payload?.computedStyles["--an-vector-fill-gradient"],
      ).toBe(firstSelection.actual);
      expect(
        firstSelection.payload?.inlineStyles?.["--an-vector-fill-gradient"],
      ).toBeUndefined();
      expect(
        firstSelection.payload?.computedStyles["--an-vector-stroke-gradient"],
      ).toBe(firstSelection.actualStroke);
      expect(
        firstSelection.payload?.inlineStyles?.["--an-vector-stroke-gradient"],
      ).toBeUndefined();

      await page.evaluate(() => {
        window.postMessage(
          {
            type: "agent-native:measure-selection",
            screenId: "selection-chrome",
            correlationId: "gradient-refresh",
            selector: "#gradient-a",
          },
          "*",
        );
      });
      await page.waitForFunction(
        () =>
          (window as GradientSelectionWindow).__gradientMeasurements?.length,
      );
      const measurement = await page.evaluate(
        () => (window as GradientSelectionWindow).__gradientMeasurements?.[0],
      );
      expect(measurement?.correlationId).toBe("gradient-refresh");
      expect(
        measurement?.payload.computedStyles["--an-vector-fill-gradient"],
      ).toBe(firstSelection.actual);
      expect(
        measurement?.payload.computedStyles["--an-vector-stroke-gradient"],
      ).toBe(firstSelection.actualStroke);

      await select(page, "#gradient-b");
      await page.waitForFunction(
        () =>
          (window as GradientSelectionWindow).__gradientSelections?.length ===
          2,
      );
      const secondSelection = await page.evaluate(() => {
        const testWindow = window as GradientSelectionWindow;
        const payload = testWindow.__gradientSelections?.[1]?.payload;
        const actual = getComputedStyle(
          document.querySelector("#gradient-b path")!,
        )
          .getPropertyValue("--an-vector-fill-gradient")
          .trim();
        const actualStroke = getComputedStyle(
          document.querySelector("#gradient-b path")!,
        )
          .getPropertyValue("--an-vector-stroke-gradient")
          .trim();
        return { payload, actual, actualStroke };
      });
      expect(
        secondSelection.payload?.computedStyles["--an-vector-fill-gradient"],
      ).toBe(secondSelection.actual);
      expect(
        secondSelection.payload?.computedStyles["--an-vector-stroke-gradient"],
      ).toBe(secondSelection.actualStroke);
      expect(
        mixedElementFromSelection([
          firstSelection.payload!,
          secondSelection.payload!,
        ])?.computedStyles["--an-vector-fill-gradient"],
      ).toBe("Mixed");
      expect(
        mixedElementFromSelection([
          firstSelection.payload!,
          secondSelection.payload!,
        ])?.computedStyles["--an-vector-stroke-gradient"],
      ).toBe("Mixed");
    } finally {
      await browser.close();
    }
  });

  it("publishes viewport-relative Position for a fixed node after document scroll", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:3000px;height:1600px">
        <div id="fixed" data-agent-native-node-id="fixed" style="position:fixed;left:35px;top:24px;width:80px;height:40px">Fixed</div>
      </body></html>`);
      await page.evaluate(() => {
        (
          window as Window & {
            __positionSelections?: { payload: Record<string, unknown> }[];
          }
        ).__positionSelections = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select") {
            (
              window as Window & {
                __positionSelections?: { payload: Record<string, unknown> }[];
              }
            ).__positionSelections?.push(event.data);
          }
        });
        window.scrollTo(50, 70);
      });
      await page.waitForFunction(
        () => window.scrollX === 50 && window.scrollY === 70,
      );
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#fixed");
      await page.waitForFunction(
        () =>
          (
            window as Window & {
              __positionSelections?: unknown[];
            }
          ).__positionSelections?.length,
      );

      const selection = await page.evaluate(() => {
        const selections = (
          window as Window & {
            __positionSelections?: {
              payload: {
                boundingRect?: { x: number; y: number };
                positionReferenceRect?: { x: number; y: number };
                positionContainingBlockOrigin?: { x: number; y: number };
              };
            }[];
          }
        ).__positionSelections;
        const message = selections?.[selections.length - 1];
        return message?.payload;
      });

      expect(selection).toMatchObject({
        boundingRect: { x: 85, y: 94 },
        positionReferenceRect: { x: 50, y: 70 },
        positionContainingBlockOrigin: { x: 50, y: 70 },
      });
    } finally {
      await browser.close();
    }
  });

  it("keeps fixed descendants on the document reference when getBoxQuads is available", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;width:3000px;height:1600px">
        <div id="containing-block" style="transform:translate(10px,20px);width:300px;height:200px">
          <div id="fixed" data-agent-native-node-id="fixed" style="position:fixed;left:35px;top:24px;width:80px;height:40px">Fixed</div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        const containingBlock = document.querySelector("#containing-block")!;
        Object.defineProperty(containingBlock, "getBoxQuads", {
          configurable: true,
          value: () => [{ p1: { x: 110, y: 120 } }],
        });
        (
          window as Window & {
            __positionSelections?: { payload: Record<string, unknown> }[];
          }
        ).__positionSelections = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select") {
            (
              window as Window & {
                __positionSelections?: { payload: Record<string, unknown> }[];
              }
            ).__positionSelections?.push(event.data);
          }
        });
        window.scrollTo(50, 70);
      });
      await page.waitForFunction(
        () => window.scrollX === 50 && window.scrollY === 70,
      );
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#fixed");
      await page.waitForFunction(
        () =>
          (
            window as Window & {
              __positionSelections?: unknown[];
            }
          ).__positionSelections?.length,
      );

      const selection = await page.evaluate(() => {
        const selections = (
          window as Window & {
            __positionSelections?: {
              payload: {
                positionReferenceRect?: { x: number; y: number };
                positionContainingBlockOrigin?: { x: number; y: number };
              };
            }[];
          }
        ).__positionSelections;
        return selections?.[selections.length - 1]?.payload;
      });

      expect(selection).toMatchObject({
        positionReferenceRect: { x: 0, y: 0 },
        positionContainingBlockOrigin: { x: 160, y: 190 },
      });
    } finally {
      await browser.close();
    }
  });

  it("does not double-outline a selected frame, but keeps the parent cue for child layers", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await select(page, "#frame");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="parent-auto-layout"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("none");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="selection"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("block");
      expect(
        await page
          .locator('[data-agent-native-edit-handle="nw"]')
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return {
              width: rect.width,
              height: rect.height,
              borderRadius: style.borderRadius,
            };
          }),
      ).toEqual({ width: 7, height: 7, borderRadius: "2px" });

      await select(page, "#child");
      expect(
        await page
          .locator('[data-agent-native-edit-overlay="parent-auto-layout"]')
          .evaluate((element) => (element as HTMLElement).style.display),
      ).toBe("block");
    } finally {
      await browser.close();
    }
  });

  it("marks trusted canvas pointer selections separately from host selections", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.evaluate(() => {
        const target = window as Window & {
          __selectionMessages?: Record<string, unknown>[];
        };
        target.__selectionMessages = [];
        window.addEventListener("message", (event) => {
          if (event.data?.type === "element-select") {
            target.__selectionMessages?.push(event.data);
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const childBox = (await page.locator("#child").boundingBox())!;
      await page.mouse.click(
        childBox.x + childBox.width / 2,
        childBox.y + childBox.height / 2,
      );
      await page.waitForFunction(() =>
        (
          window as Window & {
            __selectionMessages?: { trustedPointer?: boolean }[];
          }
        ).__selectionMessages?.some((message) => message.trustedPointer),
      );
      const pointerSelection = await page.evaluate(() => {
        const messages = (
          window as Window & {
            __selectionMessages?: {
              intent?: { source?: string };
              trustedPointer?: boolean;
              focusSafe?: boolean;
            }[];
          }
        ).__selectionMessages;
        return messages?.find((message) => message.trustedPointer);
      });
      expect(pointerSelection).toMatchObject({
        intent: { source: "pointer" },
        trustedPointer: true,
        focusSafe: true,
      });

      await select(page, "#frame");
      const hostSelection = await page.evaluate(() => {
        const messages = (
          window as Window & {
            __selectionMessages?: Record<string, unknown>[];
          }
        ).__selectionMessages;
        return messages?.[messages.length - 1];
      });
      expect(hostSelection).not.toHaveProperty("trustedPointer");
      expect(hostSelection).not.toHaveProperty("focusSafe");
    } finally {
      await browser.close();
    }
  });

  it("keeps an overview-scale resize alive after the pointer leaves the iframe", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(
        '<div id="viewport" style="width:200px;height:140px;overflow:hidden">' +
          '<iframe id="preview" style="width:1280px;height:900px;border:0;transform:scale(0.15625);transform-origin:0 0"></iframe>' +
          "</div>",
      );
      const iframe = page.locator("#preview");
      const iframeHandle = await iframe.elementHandle();
      if (!iframeHandle) throw new Error("preview iframe did not mount");
      await iframe.evaluate((element) =>
        element.setAttribute(
          "srcdoc",
          '<!doctype html><html><body style="margin:0">' +
            '<div id="child" data-agent-native-node-id="child" style="position:absolute;left:20px;top:20px;width:200px;height:120px;background:#d4d4d8"></div>' +
            "</body></html>",
        ),
      );
      await page.waitForTimeout(50);
      const frame = await iframeHandle.contentFrame();
      if (!frame) throw new Error("preview iframe document was replaced");
      await frame.locator("#child").waitFor();
      await frame.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      const child = frame.locator("#child");
      const childBox = (await child.boundingBox())!;
      await page.mouse.click(
        childBox.x + childBox.width / 2,
        childBox.y + childBox.height / 2,
      );
      await page.waitForTimeout(200);

      const handle = frame.locator('[data-agent-native-edit-handle="se"]');
      const handleBox = (await handle.boundingBox())!;
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 220, handleBox.y + 100, {
        steps: 12,
      });
      await page.mouse.up();

      const resized = await frame.locator("#child").evaluate((element) => ({
        width: (element as HTMLElement).style.width,
        height: (element as HTMLElement).style.height,
      }));
      expect(Number.parseFloat(resized.width)).toBeGreaterThan(200);
      expect(Number.parseFloat(resized.height)).toBeGreaterThan(120);
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements after sibling insertion and class changes", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #hover-parent > .layout-sibling { height:20px; }
        #hover-parent > .layout-sibling.expanded { height:40px; }
      </style></head><body style="margin:0">
        <div id="selected-parent" style="position:relative;width:1000px;height:800px">
          <div id="selected" data-agent-native-node-id="selected" style="position:absolute;left:200px;top:200px;width:200px;height:120px;background:#d4d4d8"></div>
        </div>
        <div id="hover-parent" style="position:absolute;left:519px;top:400px;width:200px;display:flex;flex-direction:column">
          <div id="hovered" data-agent-native-node-id="hovered" style="width:200px;height:120px;background:#ccc"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });

      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.evaluate(() => {
        const parent = document.querySelector("#hover-parent")!;
        const sibling = document.createElement("div");
        sibling.className = "layout-sibling";
        parent.insertBefore(sibling, parent.firstElementChild);
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.evaluate(() => {
        document
          .querySelector("#hover-parent > .layout-sibling")!
          .classList.add("expanded");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,120";
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await readLabels()).toEqual(["119", "120"]);
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements after a distant ancestor class change", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #selected-parent { position:relative; width:1000px; height:800px; }
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #distant-container { position:absolute; left:0; top:0; }
        #distant-container.shifted { left:10px; }
        #hover-parent { position:absolute; left:519px; top:400px; width:200px; }
        #hovered { width:200px; height:120px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="selected-parent">
          <div id="selected" data-agent-native-node-id="selected"></div>
        </div>
        <div id="distant-container">
          <div id="hover-parent">
            <div id="hovered" data-agent-native-node-id="hovered"></div>
          </div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(530, 410, { steps: 3 });

      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.evaluate(() => {
        document.querySelector("#distant-container")!.classList.add("shifted");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "129,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await readLabels()).toEqual(["129", "80"]);
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("tracks measured positions when a nested outer sibling moves their common root", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #outer-content { height:20px; }
        #outer-content.expanded { height:40px; }
        #common-root { position:relative; width:1000px; height:800px; }
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #hovered { position:absolute; left:519px; top:400px; width:200px; height:120px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="outer-sibling"><div id="outer-content"></div></div>
        <div id="common-root">
          <div id="selected" data-agent-native-node-id="selected"></div>
          <div id="hovered" data-agent-native-node-id="hovered"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(530, 430, { steps: 3 });

      await page.waitForFunction(() => {
        const overlay = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        return Boolean(overlay?.children.length);
      });
      const beforeTop = await page
        .locator("[data-agent-native-measurement-overlay]")
        .evaluate(
          (overlay) => overlay.firstElementChild!.getBoundingClientRect().top,
        );

      await page.locator("#outer-content").evaluate((element) => {
        element.classList.add("expanded");
      });
      await page.waitForFunction(
        (top) => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const nextTop =
            overlay?.firstElementChild?.getBoundingClientRect().top;
          return nextTop !== undefined && Math.abs(nextTop - top - 20) < 1;
        },
        beforeTop,
        { timeout: 2_000 },
      );
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("does not redraw selection or measurement overlays for unrelated descendants", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await startAltMeasurement(page);
      await page.evaluate(() => {
        const counts = { selection: 0, measurements: 0 };
        const selection = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        );
        const measurements = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        if (!selection || !measurements) {
          throw new Error("editor overlays were not mounted");
        }
        new MutationObserver((records) => {
          counts.selection += records.length;
        }).observe(selection, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        new MutationObserver((records) => {
          counts.measurements += records.length;
        }).observe(measurements, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        (window as MeasurementTestWindow).__measurementOverlayMutations =
          counts;
      });

      const before = await measurementBoundsReads(page);
      await page.waitForTimeout(80);
      const active = await measurementBoundsReads(page);
      expect(active.selected).toBeGreaterThan(before.selected);
      expect(active.hovered).toBeGreaterThan(before.hovered);
      const mutationsBeforeUnrelatedChange = await page.evaluate(
        () => (window as MeasurementTestWindow).__measurementOverlayMutations!,
      );

      await page.locator("#unrelated-descendant").evaluate((element) => {
        element.classList.add("changed");
        (element as HTMLElement).style.color = "red";
      });
      await page.waitForTimeout(100);
      const mutationsAfterUnrelatedChange = await page.evaluate(
        () => (window as MeasurementTestWindow).__measurementOverlayMutations!,
      );
      expect(mutationsAfterUnrelatedChange).toEqual(
        mutationsBeforeUnrelatedChange,
      );
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("does not rescan selected SVG paint references on pointer movement", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(SELECTED_SVG_MEASUREMENT_FIXTURE);
      await page.evaluate(() => {
        const originalQuerySelectorAll = Element.prototype.querySelectorAll;
        const testWindow = window as MeasurementTestWindow;
        testWindow.__svgDescendantScanQueries = 0;
        Object.defineProperty(Element.prototype, "querySelectorAll", {
          configurable: true,
          value: function (this: Element, selectors: string) {
            if (selectors === "*" && this instanceof SVGElement) {
              testWindow.__svgDescendantScanQueries! += 1;
            }
            return originalQuerySelectorAll.call(this, selectors);
          },
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      const scansAfterSelection = await page.evaluate(
        () => (window as MeasurementTestWindow).__svgDescendantScanQueries!,
      );
      expect(scansAfterSelection).toBeGreaterThan(0);

      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 4 });
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(
            "[data-agent-native-measurement-overlay]",
          )?.style.display === "block",
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      const scansAfterHover = await page.evaluate(
        () => (window as MeasurementTestWindow).__svgDescendantScanQueries!,
      );
      expect(scansAfterHover).toBe(scansAfterSelection);

      await page.evaluate(() => {
        const counts = { selection: 0, measurements: 0 };
        const selection = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        );
        const measurements = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        if (!selection || !measurements) {
          throw new Error("editor overlays were not mounted");
        }
        new MutationObserver((records) => {
          counts.selection += records.length;
        }).observe(selection, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        new MutationObserver((records) => {
          counts.measurements += records.length;
        }).observe(measurements, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        (window as MeasurementTestWindow).__measurementOverlayMutations =
          counts;
      });

      const scansBeforeReferenceChange = scansAfterHover;
      await page.locator("#shape").evaluate((element) => {
        element.setAttribute("fill", "url(#replacement)");
      });
      await page.waitForFunction(
        (before) =>
          (window as MeasurementTestWindow).__svgDescendantScanQueries! >
          before,
        scansBeforeReferenceChange,
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );

      const redrawsBeforeReplacementPaintChange = await page.evaluate(
        () =>
          (window as MeasurementTestWindow).__measurementOverlayMutations!
            .measurements,
      );
      await page.locator("#replacement stop").evaluate((element) => {
        element.setAttribute("stop-color", "#fff");
      });
      await page.waitForFunction(
        (before) =>
          (window as MeasurementTestWindow).__measurementOverlayMutations!
            .measurements > before,
        redrawsBeforeReplacementPaintChange,
        { timeout: 2_000 },
      );
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  }, 10_000);

  it("ignores SVG metadata mutations while keeping geometry, paint, and style updates", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(SELECTED_SVG_MEASUREMENT_FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(
            "[data-agent-native-measurement-overlay]",
          )?.style.display === "block",
      );
      await page.evaluate(() => {
        const counts = { selection: 0, measurements: 0 };
        const selection = document.querySelector(
          '[data-agent-native-edit-overlay="selection"]',
        );
        const measurements = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        if (!selection || !measurements) {
          throw new Error("editor overlays were not mounted");
        }
        new MutationObserver((records) => {
          counts.selection += records.length;
        }).observe(selection, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        new MutationObserver((records) => {
          counts.measurements += records.length;
        }).observe(measurements, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        (window as MeasurementTestWindow).__measurementOverlayMutations =
          counts;
      });
      await page.waitForTimeout(50);

      const readMutations = () =>
        page.evaluate(
          () =>
            (window as MeasurementTestWindow).__measurementOverlayMutations!,
        );
      const metadataBaseline = await readMutations();
      await page.locator("#selected").evaluate((element) => {
        element.querySelector("title")!.textContent = "Updated vector name";
        element.querySelector("desc")!.textContent = "Updated description";
      });
      await page.waitForTimeout(100);
      expect(await readMutations()).toEqual(metadataBaseline);

      const waitForMeasurementRedraw = async (previous: number) => {
        await page.waitForFunction(
          (before) =>
            (window as MeasurementTestWindow).__measurementOverlayMutations!
              .measurements > before,
          previous,
          { timeout: 2_000 },
        );
        return (await readMutations()).measurements;
      };

      const pathWidthBefore = await page
        .locator("#shape")
        .evaluate((element) => {
          if (!(element instanceof SVGGraphicsElement)) {
            throw new Error("selected path is not an SVG graphics element");
          }
          return element.getBBox().width;
        });
      expect(pathWidthBefore).toBe(200);
      const geometryBaseline = (await readMutations()).measurements;
      await page.locator("#shape").evaluate((element) => {
        element.setAttribute("d", "M0 0h100v120H0z");
      });
      let redrawCount = await waitForMeasurementRedraw(geometryBaseline);
      const pathWidthAfter = await page
        .locator("#shape")
        .evaluate((element) => {
          if (!(element instanceof SVGGraphicsElement)) {
            throw new Error("selected path is not an SVG graphics element");
          }
          return element.getBBox().width;
        });
      expect(pathWidthAfter).toBe(100);

      const styleBaseline = redrawCount;
      await page.locator("#shape").evaluate((element) => {
        element.setAttribute("style", "opacity: 0.5");
      });
      redrawCount = await waitForMeasurementRedraw(styleBaseline);
      const shapeOpacity = await page
        .locator("#shape")
        .evaluate((element) => getComputedStyle(element).opacity);
      expect(shapeOpacity).toBe("0.5");

      const paintBaseline = redrawCount;
      await page.locator("#paint stop").evaluate((element) => {
        element.setAttribute("stop-color", "#fff");
      });
      redrawCount = await waitForMeasurementRedraw(paintBaseline);
      const stopColor = await page
        .locator("#paint stop")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("stop-color"),
        );
      expect(stopColor).toBe("rgb(255, 255, 255)");

      const layoutBaseline = redrawCount;
      await page.locator("#selected").evaluate((element) => {
        element.setAttribute("height", "160");
      });
      await page.waitForFunction(
        (before) => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean);
          return (
            (window as MeasurementTestWindow).__measurementOverlayMutations!
              .measurements > before &&
            labels.includes("40") &&
            document.querySelector("#selected")?.getBoundingClientRect()
              .height === 160
          );
        },
        layoutBaseline,
        { timeout: 2_000 },
      );
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  }, 10_000);

  it("stops measuring element geometry when Alt measurement is released", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await startAltMeasurement(page);
      const before = await measurementBoundsReads(page);
      await page.waitForTimeout(80);
      const active = await measurementBoundsReads(page);
      expect(active.selected).toBeGreaterThan(before.selected);
      expect(active.hovered).toBeGreaterThan(before.hovered);

      await page.keyboard.up("Alt");
      await page.waitForFunction(() => {
        const overlay = document.querySelector<HTMLElement>(
          "[data-agent-native-measurement-overlay]",
        );
        return overlay?.style.display === "none";
      });
      const released = await measurementBoundsReads(page);
      await page.waitForTimeout(100);
      expect(await measurementBoundsReads(page)).toEqual(released);
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements after a selected ancestor moves", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #selected-grandparent { position:absolute; left:0; top:0; }
        #selected-grandparent.shifted { left:10px; }
        #selected-parent { position:relative; width:1000px; height:800px; }
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #hover-parent { position:absolute; left:519px; top:400px; width:200px; }
        #hovered { width:200px; height:120px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="selected-grandparent">
          <div id="selected-parent">
            <div id="selected" data-agent-native-node-id="selected"></div>
          </div>
        </div>
        <div id="hover-parent">
          <div id="hovered" data-agent-native-node-id="hovered"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(530, 410, { steps: 3 });
      await page.waitForFunction(() => {
        const overlay = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        const labels = [...(overlay?.children ?? [])]
          .map((node) => node.textContent)
          .filter(Boolean)
          .sort();
        return labels.join(",") === "119,80";
      });

      await page.locator("#selected-grandparent").evaluate((element) => {
        element.classList.add("shifted");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "109,80";
        },
        undefined,
        { timeout: 2_000 },
      );
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements after a nested sibling changes in a distant layout root", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #layout-root { position:relative; box-sizing:border-box; width:1000px; height:800px; padding-top:20px; display:flex; flex-direction:column; align-items:flex-start; }
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #layout-sibling { display:flow-root; }
        #layout-content { height:380px; }
        #layout-content.expanded { height:400px; }
        #hover-branch { display:flow-root; }
        #hovered { width:200px; height:120px; margin-left:519px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="layout-root">
          <div id="selected" data-agent-native-node-id="selected"></div>
          <div id="layout-sibling"><div id="layout-content"></div></div>
          <div id="hover-branch">
            <div id="hovered" data-agent-native-node-id="hovered"></div>
          </div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });
      await page.waitForFunction(() => {
        const overlay = document.querySelector(
          "[data-agent-native-measurement-overlay]",
        );
        const labels = [...(overlay?.children ?? [])]
          .map((node) => node.textContent)
          .filter(Boolean)
          .sort();
        return labels.join(",") === "119,80";
      });

      await page.locator("#layout-content").evaluate((element) => {
        element.classList.add("expanded");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 2_000 },
      );
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements when a nested sibling changes in a shared parent", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #shared-parent { position:relative; box-sizing:border-box; width:1000px; height:800px; padding-top:20px; display:flex; flex-direction:column; align-items:flex-start; }
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #layout-sibling { display:flow-root; }
        #layout-content { height:380px; }
        #layout-content.expanded { height:400px; }
        #hovered { width:200px; height:120px; margin-left:519px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="shared-parent">
          <div id="selected" data-agent-native-node-id="selected"></div>
          <div id="layout-sibling"><div id="layout-content"></div></div>
          <div id="hovered" data-agent-native-node-id="hovered"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });

      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(1_200);

      await page.locator("#layout-content").evaluate((element) => {
        element.classList.add("expanded");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await readLabels()).toEqual(["100", "119"]);
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("refreshes Alt measurements when the hovered target is nested in the selected element", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #selected { position:absolute; left:200px; top:200px; width:200px; height:120px; background:#d4d4d8; }
        #layout-sibling { display:flow-root; }
        #layout-content { height:200px; }
        #layout-content.expanded { height:220px; }
        #hovered { width:200px; height:120px; margin-left:319px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="selected" data-agent-native-node-id="selected">
          <div id="layout-sibling"><div id="layout-content"></div></div>
          <div id="hovered" data-agent-native-node-id="hovered"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });

      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(1_200);

      await page.locator("#layout-content").evaluate((element) => {
        element.classList.add("expanded");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 5_000 },
      );
      expect(await readLabels()).toEqual(["100", "119"]);
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("does not restore measurements after a hide followed by an overlay refresh", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="selected" data-agent-native-node-id="selected" style="position:absolute;left:200px;top:200px;width:200px;height:120px;background:#d4d4d8"></div>
        <div id="hovered" data-agent-native-node-id="hovered" style="position:absolute;left:519px;top:400px;width:200px;height:120px;background:#ccc"></div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(
            "[data-agent-native-measurement-overlay]",
          )?.style.display === "block",
      );

      await page.evaluate(() => {
        window.postMessage(
          { type: "hover-element", selectorCandidates: [] },
          "*",
        );
      });
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>(
            "[data-agent-native-measurement-overlay]",
          )?.style.display === "none",
      );
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await page.waitForTimeout(100);

      const display = await page
        .locator("[data-agent-native-measurement-overlay]")
        .evaluate((overlay) => (overlay as HTMLElement).style.display);
      expect(display).toBe("none");
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  });

  it("preserves SVG descendant observation when the layout root is selected", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 800 },
      });
      await page.setContent(`<!doctype html><html><head><style>
        #selected { position:absolute; left:200px; top:200px; box-sizing:border-box; width:200px; height:120px; display:flex; flex-direction:column; align-items:flex-start; overflow:visible; background:#d4d4d8; }
        #layout-svg { display:block; flex:none; }
        #layout-svg.taller { height:220px; }
        #hovered { flex:none; width:200px; height:120px; margin-left:319px; background:#ccc; }
      </style></head><body style="margin:0">
        <div id="selected" data-agent-native-node-id="selected">
          <svg id="layout-svg" width="200" height="180" aria-hidden="true"></svg>
          <div id="hovered" data-agent-native-node-id="hovered"></div>
        </div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await select(page, "#selected");
      await page.keyboard.down("Alt");
      await page.mouse.move(520, 410, { steps: 3 });
      const readLabels = () =>
        page
          .locator("[data-agent-native-measurement-overlay]")
          .evaluate((overlay) =>
            [...overlay.children]
              .map((node) => node.textContent)
              .filter(Boolean)
              .sort(),
          );
      await page.waitForTimeout(100);
      expect(await readLabels()).toEqual(["119", "60"]);

      await page.locator("#layout-svg").evaluate((element) => {
        element.setAttribute("height", "200");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "119,80";
        },
        undefined,
        { timeout: 2_000 },
      );

      await page.locator("#layout-svg").evaluate((element) => {
        element.classList.add("taller");
      });
      await page.waitForFunction(
        () => {
          const overlay = document.querySelector(
            "[data-agent-native-measurement-overlay]",
          );
          const labels = [...(overlay?.children ?? [])]
            .map((node) => node.textContent)
            .filter(Boolean)
            .sort();
          return labels.join(",") === "100,119";
        },
        undefined,
        { timeout: 2_000 },
      );
      expect(await readLabels()).toEqual(["100", "119"]);
      await page.keyboard.up("Alt");
    } finally {
      await browser.close();
    }
  }, 10_000);
});
