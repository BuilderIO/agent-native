import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("line-endpoints"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

// The markup the Line and Arrow tools write: a box stretched over one M…L
// segment, with arrowhead markers in <defs>.
const FIXTURE = `<!doctype html><html><body style="margin:0;width:900px;height:700px">
  <svg data-agent-native-node-id="line" data-an-primitive="line" viewBox="0 0 200 100" preserveAspectRatio="none"
       style="position:absolute;left:100px;top:100px;width:200px;height:100px;overflow:visible">
    <path d="M 0 0 L 200 100" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"></path>
  </svg>
  <svg data-agent-native-node-id="turned" data-an-primitive="arrow" viewBox="0 0 200 1" preserveAspectRatio="none"
       style="position:absolute;left:500px;top:300px;width:200px;height:1px;overflow:visible;transform:rotate(90deg)">
    <defs data-an-vector-endpoints="true"><marker id="turned-end" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
    <path d="M 0 0 L 200 0" fill="none" stroke="#111" stroke-width="2" marker-end="url(#turned-end)"></path>
  </svg>
</body></html>`;

type StyleMessage = {
  phase?: string;
  selector: string;
  styles: Record<string, string>;
};

async function withPage(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    await page.setContent(FIXTURE);
    await page.evaluate(() => {
      (window as any).__styleMessages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.source !== window) return;
        if (event.data?.type === "visual-style-change") {
          (window as any).__styleMessages.push({
            phase: event.data.phase,
            selector: event.data.selector,
            styles: event.data.styles,
          });
        }
      });
    });
    await page.addScriptTag({ content: hydratedBridge() });
    await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
    await run(page);
  } finally {
    await browser.close();
  }
}

async function commits(page: Page): Promise<StyleMessage[]> {
  return page.evaluate(() =>
    ((window as any).__styleMessages as StyleMessage[]).filter(
      (message) => message.phase !== "preview",
    ),
  );
}

async function visibleHandleKinds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-agent-native-edit-handle],[data-agent-native-edge-handle],[data-agent-native-rotate-handle],[data-agent-native-line-endpoint-handle]",
      ),
    ]
      .filter((handle) => {
        const style = window.getComputedStyle(handle);
        const rect = handle.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map(
        (handle) =>
          handle.getAttribute("data-agent-native-line-endpoint-handle") ??
          "box",
      ),
  );
}

async function handleCenter(page: Page, end: "start" | "end") {
  const box = await page
    .locator(`[data-agent-native-line-endpoint-handle="${end}"]`)
    .boundingBox({ timeout: 2_000 });
  if (!box) throw new Error(`no ${end} endpoint handle`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function lineState(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const svg = document.querySelector(
      `[data-agent-native-node-id="${id}"]`,
    ) as SVGSVGElement;
    const path = svg.querySelector(":scope > path")!;
    return {
      left: svg.style.left,
      top: svg.style.top,
      width: svg.style.width,
      height: svg.style.height,
      viewBox: svg.getAttribute("viewBox"),
      d: path.getAttribute("d"),
    };
  }, nodeId);
}

async function readout(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-agent-native-transform-badge],[data-agent-native-edit-overlay="size-badge"]',
      ),
    ]
      .filter((badge) => window.getComputedStyle(badge).display !== "none")
      .map((badge) => badge.textContent ?? ""),
  );
}

async function dragEndpoint(
  page: Page,
  end: "start" | "end",
  to: { x: number; y: number },
  options: { release?: boolean } = {},
) {
  const from = await handleCenter(page, end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.waitForTimeout(60);
  if (options.release !== false) {
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
}

async function selectLine(page: Page) {
  // On the stroke, halfway along the segment.
  await page.mouse.click(200, 150);
  await page.waitForTimeout(200);
}

describe("line and arrow endpoint handles", () => {
  it("a selected line shows its two endpoint handles and no box handles", async () => {
    await withPage(async (page) => {
      await selectLine(page);
      expect((await visibleHandleKinds(page)).sort()).toEqual(["end", "start"]);
      const start = await handleCenter(page, "start");
      const end = await handleCenter(page, "end");
      expect(start.x).toBeCloseTo(100, 0);
      expect(start.y).toBeCloseTo(100, 0);
      expect(end.x).toBeCloseTo(300, 0);
      expect(end.y).toBeCloseTo(200, 0);
    });
  });

  it("dragging the end moves only that end and commits box and path as one change", async () => {
    await withPage(async (page) => {
      await selectLine(page);
      await dragEndpoint(page, "end", { x: 340, y: 140 }, { release: false });
      expect(await readout(page)).toEqual(["243 · -9.5°"]);
      await page.mouse.up();
      await page.waitForTimeout(120);

      expect(await lineState(page, "line")).toEqual({
        left: "100px",
        top: "100px",
        width: "240px",
        height: "40px",
        viewBox: "0 0 240 40",
        d: "M 0 0 L 240 40",
      });
      const committed = await commits(page);
      expect(committed).toHaveLength(1);
      expect(committed[0]!.styles).toEqual({
        left: "100px",
        top: "100px",
        width: "240px",
        height: "40px",
        "--an-line-segment": "0 0 240 40",
      });
      const start = await handleCenter(page, "start");
      expect(start.x).toBeCloseTo(100, 0);
      expect(start.y).toBeCloseTo(100, 0);
    });
  });

  it("dragging the start past the end rewrites the path direction and the box", async () => {
    await withPage(async (page) => {
      await selectLine(page);
      await dragEndpoint(page, "start", { x: 400, y: 250 });
      expect(await lineState(page, "line")).toEqual({
        left: "300px",
        top: "200px",
        width: "100px",
        height: "50px",
        viewBox: "0 0 100 50",
        d: "M 100 50 L 0 0",
      });
      const committed = await commits(page);
      expect(committed).toHaveLength(1);
      expect(committed[0]!.styles["--an-line-segment"]).toBe("100 50 0 0");
      const end = await handleCenter(page, "end");
      expect(end.x).toBeCloseTo(300, 0);
      expect(end.y).toBeCloseTo(200, 0);
    });
  });

  it("Shift snaps the segment to the nearest 45 degrees", async () => {
    await withPage(async (page) => {
      await selectLine(page);
      await page.keyboard.down("Shift");
      await dragEndpoint(page, "end", { x: 310, y: 120 });
      await page.keyboard.up("Shift");
      // (210, 20) from the start is 5.4 degrees, so it lands flat at its length.
      expect(await lineState(page, "line")).toEqual({
        left: "100px",
        top: "100px",
        width: "211px",
        height: "1px",
        viewBox: "0 0 211 1",
        d: "M 0 0 L 211 0",
      });
    });
  });

  it("Escape restores the line and commits nothing", async () => {
    await withPage(async (page) => {
      await selectLine(page);
      const before = await lineState(page, "line");
      await dragEndpoint(page, "end", { x: 420, y: 300 }, { release: false });
      expect(await lineState(page, "line")).not.toEqual(before);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.waitForTimeout(120);
      expect(await lineState(page, "line")).toEqual(before);
      expect(await commits(page)).toEqual([]);
    });
  });

  it("the fixed end of a rotated arrow stays where it is on screen", async () => {
    await withPage(async (page) => {
      // Rotated 90 degrees about its centre (600, 300.5): the segment runs
      // straight down from (600.5, 200.5) to (600.5, 400.5).
      await page.mouse.click(600, 300);
      await page.waitForTimeout(200);
      expect((await visibleHandleKinds(page)).sort()).toEqual(["end", "start"]);
      const start = await handleCenter(page, "start");
      expect(start.x).toBeCloseTo(600.5, 0);
      expect(start.y).toBeCloseTo(200.5, 0);
      await dragEndpoint(page, "end", { x: 650.5, y: 400.5 });
      const movedStart = await handleCenter(page, "start");
      const movedEnd = await handleCenter(page, "end");
      expect(Math.abs(movedStart.x - 600.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(movedStart.y - 200.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(movedEnd.x - 650.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(movedEnd.y - 400.5)).toBeLessThanOrEqual(1);
      const state = await lineState(page, "turned");
      for (const value of [state.left, state.top, state.width, state.height]) {
        expect(value).toMatch(/^-?\d+px$/);
      }
    });
  });
});
