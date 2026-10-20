import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedBridge(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("gesture-test"))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

describe("pointer gesture behavior", () => {
  it("omits portable snapshots during resize previews and cancel, and keeps them on commit", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="target" data-agent-native-node-id="target" style="position:absolute;left:100px;top:100px;width:120px;height:90px;background:#334155"></div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        (window as any).__bridgeMessages = [];
        window.addEventListener("message", (event) => {
          (window as any).__bridgeMessages.push(event.data);
        });
      });

      await page.mouse.click(150, 140);
      await page.waitForSelector('[data-agent-native-edit-handle="se"]');

      const resize = page.locator('[data-agent-native-edit-handle="se"]');
      const dragToPreview = async () => {
        const handle = (await resize.boundingBox())!;
        const x = handle.x + handle.width / 2;
        const y = handle.y + handle.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 40, y + 20, { steps: 4 });
      };

      await dragToPreview();
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "visual-style-change" &&
            message.phase === "preview",
        ),
      );
      const previewSnapshots = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? [])
          .filter(
            (message: any) =>
              message.type === "visual-style-change" &&
              message.phase === "preview",
          )
          .map((message: any) => message.payload?.portableStyleSnapshot),
      );
      expect(previewSnapshots.length).toBeGreaterThan(0);
      expect(
        previewSnapshots.every((snapshot: unknown) => snapshot === undefined),
      ).toBe(true);

      await page.keyboard.press("Escape");
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "visual-style-change" &&
            message.phase === "preview" &&
            message.payload?.portableStyleSnapshot === undefined,
        ),
      );
      await page.mouse.up();

      await dragToPreview();
      await page.mouse.up();
      await page.waitForFunction(() =>
        ((window as any).__bridgeMessages ?? []).some(
          (message: any) =>
            message.type === "visual-style-change" &&
            message.phase === "commit",
        ),
      );
      const commit = await page.evaluate(() =>
        ((window as any).__bridgeMessages ?? []).find(
          (message: any) =>
            message.type === "visual-style-change" &&
            message.phase === "commit",
        ),
      );
      expect(
        commit.payload?.portableStyleSnapshot?.nodes?.length,
      ).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("handles one physical pointer move once and only rewrites a changed hover box", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 500, height: 400 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="target" data-agent-native-node-id="target" style="position:absolute;left:100px;top:100px;width:100px;height:80px;background:#334155"></div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');

      const counts = await page.evaluate(async () => {
        const win = window as typeof window & {
          __hitTests?: number;
          __overlayWrites?: number;
        };
        const hitTest = document.elementsFromPoint.bind(document);
        win.__hitTests = 0;
        document.elementsFromPoint = ((x: number, y: number) => {
          win.__hitTests = (win.__hitTests ?? 0) + 1;
          return hitTest(x, y);
        }) as typeof document.elementsFromPoint;
        const shield = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        )!;
        const highlight = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="highlight"]',
        )!;
        const observer = new MutationObserver((records) => {
          win.__overlayWrites = (win.__overlayWrites ?? 0) + records.length;
        });
        win.__overlayWrites = 0;
        observer.observe(highlight, {
          attributes: true,
          attributeFilter: ["style"],
        });
        const dispatch = (type: "pointermove" | "mousemove", x: number) => {
          const EventType = type === "pointermove" ? PointerEvent : MouseEvent;
          shield.dispatchEvent(
            new EventType(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: 120,
            }),
          );
        };
        const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

        dispatch("pointermove", 120);
        await settle();
        const first = {
          hits: win.__hitTests ?? 0,
          writes: win.__overlayWrites ?? 0,
        };
        dispatch("mousemove", 120);
        await settle();
        const duplicate = {
          hits: win.__hitTests ?? 0,
          writes: win.__overlayWrites ?? 0,
        };
        dispatch("pointermove", 121);
        await settle();
        const sameRect = {
          hits: win.__hitTests ?? 0,
          writes: win.__overlayWrites ?? 0,
        };
        (document.querySelector("#target") as HTMLElement).style.left = "110px";
        dispatch("pointermove", 122);
        await settle();
        const changedRect = {
          hits: win.__hitTests ?? 0,
          writes: win.__overlayWrites ?? 0,
        };
        observer.disconnect();
        return { first, duplicate, sameRect, changedRect };
      });

      expect(counts.duplicate.hits).toBe(counts.first.hits);
      expect(counts.duplicate.writes).toBe(counts.first.writes);
      expect(counts.sameRect.hits).toBeGreaterThan(counts.duplicate.hits);
      expect(counts.sameRect.writes).toBe(counts.duplicate.writes);
      expect(counts.changedRect.writes).toBeGreaterThan(counts.sameRect.writes);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("moves a selected group from one rounded union origin while preserving fractional guide edges", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 700, height: 400 },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="first" data-agent-native-node-id="first" style="position:absolute;left:100.4px;top:100.4px;width:40px;height:40px;background:#334155"></div>
        <div id="second" data-agent-native-node-id="second" style="position:absolute;left:40.9px;top:100.8px;width:40px;height:40px;background:#475569"></div>
        <div id="guide" data-agent-native-node-id="guide" style="position:absolute;left:144.5px;top:100.4px;width:40px;height:40px;background:#64748b"></div>
      </body></html>`);
      await page.addScriptTag({ content: hydratedBridge() });
      await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "select-element",
            selector: "#first",
            selectorCandidates: ["#first"],
          },
          "*",
        );
      });
      await page.waitForSelector(
        '[data-agent-native-edit-overlay="selection"]',
      );
      await page.evaluate(() => {
        window.postMessage(
          { type: "select-elements", selectorGroups: [["#second"]] },
          "*",
        );
      });
      await page.waitForSelector(
        '[data-agent-native-edit-overlay="multi-selection"]',
      );

      const first = page.locator("#first");
      const box = (await first.boundingBox())!;
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.evaluate(({ x, y }) => {
        const selection = document.querySelector<HTMLElement>(
          '[data-agent-native-edit-overlay="selection"]',
        )!;
        selection.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: x,
            clientY: y,
          }),
        );
        document.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            buttons: 1,
            clientX: x + 4,
            clientY: y,
          }),
        );
        document.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: x + 4,
            clientY: y,
          }),
        );
      }, start);

      const finalGeometry = await page.evaluate(() => {
        const first = document.querySelector<HTMLElement>("#first")!;
        const second = document.querySelector<HTMLElement>("#second")!;
        const guide = document.querySelector<HTMLElement>("#guide")!;
        return {
          firstLeft: Number.parseFloat(first.style.left),
          secondLeft: Number.parseFloat(second.style.left),
          guideLeft: Number.parseFloat(guide.style.left),
          firstRight: first.getBoundingClientRect().right,
        };
      });

      expect(finalGeometry.firstLeft - finalGeometry.secondLeft).toBeCloseTo(
        59.5,
      );
      expect(finalGeometry.firstRight).toBeCloseTo(finalGeometry.guideLeft);
      expect(finalGeometry.secondLeft).toBeCloseTo(45, 1);
      expect(finalGeometry.firstLeft).toBeCloseTo(104.5, 1);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it.each([1, 8])(
    "moves a dragged layer by the full pointer delta from pointerdown when the drag takes %i pointer move(s)",
    async (steps) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 800, height: 600 },
        });
        await page.setContent(`<!doctype html><html><body style="margin:0">
        <div id="target" data-agent-native-node-id="target" style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#334155"></div>
      </body></html>`);
        await page.addScriptTag({ content: hydratedBridge() });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await page.evaluate(() => {
          (window as any).__commits = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "visual-style-change") {
              (window as any).__commits.push(event.data.styles);
            }
          });
        });

        await page.mouse.move(90, 320);
        await page.mouse.down();
        await page.mouse.move(290, 420, { steps });
        await page.mouse.up();
        await page.waitForFunction(() => (window as any).__commits.length > 0);

        const commits = await page.evaluate(() => (window as any).__commits);
        expect(commits).toEqual([
          { position: "absolute", left: "230px", top: "380px" },
        ]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
});
