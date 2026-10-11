import { chromium } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return (
    editorChromeBridgeScript
      .replace("__READ_ONLY__", "false")
      .replace("__TEXT_EDITING_ENABLED__", "false")
      .replace("__EDITOR_CHROME_SCALE_X__", "1")
      .replace("__EDITOR_CHROME_SCALE_Y__", "1")
      .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
      // This suite exercises the board's container-first policy. Screen content
      // intentionally uses direct single-click selection instead.
      .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
      .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
      .replace(/__INITIAL_SOURCE_HEAD__/g, '""')
  );
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
       style="position:absolute;left:40px;top:40px;width:280px;height:200px;background:#111827">
    <div data-agent-native-node-id="kid-a" data-agent-native-layer-name="Kid A"
         style="position:absolute;left:16px;top:16px;width:110px;height:80px;background:#3b82f6"></div>
  </div>
  <div data-agent-native-node-id="solo-a" data-agent-native-layer-name="Solo A"
       style="position:absolute;left:40px;top:300px;width:120px;height:80px;background:#a855f7"></div>
  <div data-agent-native-node-id="solo-b" data-agent-native-layer-name="Solo B"
       style="position:absolute;left:190px;top:300px;width:120px;height:80px;background:#ec4899"></div>
</body></html>`;

const DEEP_SELECTION_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="screen-root" data-agent-native-layer-name="Screen"
       data-an-primitive="frame"
       style="position:absolute;left:0;top:0;width:520px;height:420px;background:#111827">
    <div data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer"
         style="position:absolute;left:40px;top:40px;width:320px;height:280px;background:#1f2937">
      <div data-agent-native-node-id="middle-frame" data-agent-native-layer-name="Middle"
           style="position:absolute;left:20px;top:20px;width:260px;height:220px;background:#374151">
        <div data-agent-native-node-id="grandchild" data-agent-native-layer-name="Grandchild"
             style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#3b82f6"></div>
      </div>
    </div>
  </div>
</body></html>`;

const LAYERED_SELECTION_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="screen-root" data-agent-native-layer-name="Screen"
       data-an-primitive="frame"
       style="position:absolute;left:0;top:0;width:520px;height:420px;background:#111827">
    <div data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer"
         data-an-primitive="frame"
         style="position:absolute;left:40px;top:40px;width:320px;height:280px;background:#1f2937">
      <div data-agent-native-node-id="middle-frame" data-agent-native-layer-name="Middle"
           data-an-primitive="frame"
           style="position:absolute;left:20px;top:20px;width:260px;height:220px;background:#374151">
        <div data-agent-native-node-id="grandchild" data-agent-native-layer-name="Grandchild"
             style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#3b82f6"></div>
        <div data-agent-native-node-id="sibling" data-agent-native-layer-name="Sibling"
             style="position:absolute;left:140px;top:20px;width:100px;height:80px;background:#ec4899"></div>
      </div>
    </div>
  </div>
</body></html>`;

const GENERATED_GROUP_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="screen-root" data-agent-native-layer-name="Screen"
       data-an-primitive="frame"
       style="position:absolute;left:0;top:0;width:520px;height:420px;background:#111827">
    <div data-agent-native-node-id="parent" data-agent-native-layer-name="Parent"
         data-an-primitive="frame"
         style="position:absolute;left:20px;top:20px;width:360px;height:320px;background:#374151">
      <div data-agent-native-node-id="generated-group" data-agent-native-layer-name="Group"
           data-agent-native-group-wrapper="true"
           style="position:absolute;left:20px;top:20px;width:260px;height:220px;background:#1f2937">
        <div data-agent-native-node-id="group-child" data-agent-native-layer-name="Child"
             style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#3b82f6"></div>
      </div>
    </div>
  </div>
</body></html>`;

const DRILL_SCOPE_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="screen-root" data-agent-native-layer-name="Screen"
       data-an-primitive="frame"
       style="position:absolute;left:0;top:0;width:520px;height:420px;background:#111827">
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         data-an-primitive="frame"
         style="position:absolute;left:20px;top:20px;width:300px;height:300px;background:#1f2937">
      <div data-agent-native-node-id="kid" data-agent-native-layer-name="Kid"
           data-an-primitive="frame"
           style="position:absolute;left:20px;top:20px;width:200px;height:200px;background:#374151">
        <div data-agent-native-node-id="leaf" data-agent-native-layer-name="Leaf"
             style="position:absolute;left:20px;top:20px;width:80px;height:60px;background:#3b82f6"></div>
      </div>
    </div>
    <div data-agent-native-node-id="solo" data-agent-native-layer-name="Solo"
         style="position:absolute;left:360px;top:20px;width:120px;height:80px;background:#a855f7"></div>
  </div>
</body></html>`;

const DRILL_SCOPE_SIBLING_FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="screen-root" data-agent-native-layer-name="Screen"
       data-an-primitive="frame"
       style="position:absolute;left:0;top:0;width:520px;height:420px;background:#111827">
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         data-an-primitive="frame"
         style="position:absolute;left:20px;top:20px;width:300px;height:300px;background:#1f2937">
      <div data-agent-native-node-id="kid" data-agent-native-layer-name="Kid"
           data-an-primitive="frame"
           style="position:absolute;left:20px;top:20px;width:200px;height:200px;background:#374151">
        <div data-agent-native-node-id="leaf" data-agent-native-layer-name="Leaf"
             style="position:absolute;left:20px;top:20px;width:80px;height:60px;background:#3b82f6"></div>
      </div>
    </div>
    <div data-agent-native-node-id="panel" data-agent-native-layer-name="Panel"
         data-an-primitive="frame"
         style="position:absolute;left:360px;top:20px;width:120px;height:80px;background:#a855f7">
      <div data-agent-native-node-id="panel-child" data-agent-native-layer-name="Panel child"
           style="position:absolute;left:20px;top:20px;width:40px;height:40px;background:#fde68a"></div>
    </div>
  </div>
</body></html>`;

describe("container-first click selection", () => {
  it("clicking a child nested inside Card selects Card, not the child", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const selected: string[] = [];
      await page.exposeFunction("__pushSelected", (id: string) =>
        selected.push(id),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as {
            type?: string;
            payload?: { sourceId?: string };
          };
          if (data?.type === "element-select") {
            (window as any).__pushSelected(data.payload?.sourceId ?? "");
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.mouse.click(111, 96);
      await vi.waitFor(() => expect(selected.length).toBeGreaterThan(0));

      expect(selected[selected.length - 1]).toBe("card");
      expect(selected).not.toContain("kid-a");
    } finally {
      await browser.close();
    }
  });

  it("clicking a grandchild selects its direct child under the screen root", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(DEEP_SELECTION_FIXTURE);
      expect(
        await page.evaluate(() =>
          document
            .elementFromPoint(100, 100)
            ?.getAttribute("data-agent-native-node-id"),
        ),
      ).toBe("grandchild");
      const selected: string[] = [];
      await page.exposeFunction("__pushSelected", (id: string) =>
        selected.push(id),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (e: MessageEvent) => {
          const data = e.data as {
            type?: string;
            payload?: { sourceId?: string };
          };
          if (data?.type === "element-select") {
            (window as any).__pushSelected(data.payload?.sourceId ?? "");
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.mouse.click(100, 100);
      await vi.waitFor(() => expect(selected.length).toBeGreaterThan(0));

      expect(selected[selected.length - 1]).toBe("outer-frame");
      expect(selected).not.toContain("middle-frame");
      expect(selected).not.toContain("grandchild");
    } finally {
      await browser.close();
    }
  });

  it("keeps a host-selected nested leaf's sibling directly reachable", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(LAYERED_SELECTION_FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__selectionIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectionIds.push(
              event.data.payload?.sourceId ?? "",
            );
          }
        });
      });

      await page.evaluate(() => {
        const selector = '[data-agent-native-node-id="grandchild"]';
        window.postMessage(
          {
            type: "select-element",
            selector,
            selectorCandidates: [selector],
          },
          "*",
        );
      });
      await page.waitForFunction(() =>
        (window as any).__selectionIds.includes("grandchild"),
      );
      await page.mouse.click(220, 100);
      await page.waitForFunction(
        () => (window as any).__selectionIds.length > 1,
      );

      const selectedIds = await page.evaluate(
        () => (window as any).__selectionIds as string[],
      );
      expect(selectedIds[selectedIds.length - 1]).toBe("sibling");
    } finally {
      await browser.close();
    }
  });

  it("enters a host-selected container until Escape clears the selection", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(LAYERED_SELECTION_FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__selectionIds = [];
        (window as any).__hoverIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectionIds.push(
              event.data.payload?.sourceId ?? "",
            );
          }
          if (event.data?.type === "element-hover") {
            (window as any).__hoverIds.push(event.data.payload?.sourceId ?? "");
          }
        });
      });

      await page.evaluate(() => {
        const selector = '[data-agent-native-node-id="middle-frame"]';
        window.postMessage(
          {
            type: "select-element",
            selector,
            selectorCandidates: [selector],
          },
          "*",
        );
      });
      await page.waitForFunction(() =>
        (window as any).__selectionIds.includes("middle-frame"),
      );
      await page.mouse.move(100, 100);
      await page.waitForFunction(() => (window as any).__hoverIds.length > 0);
      const hoveredIds = await page.evaluate(
        () => (window as any).__hoverIds as string[],
      );
      expect(hoveredIds[hoveredIds.length - 1]).toBe("grandchild");

      await page.mouse.click(100, 100);
      await page.waitForFunction(
        () => (window as any).__selectionIds.length > 1,
      );
      await page.keyboard.press("Escape");
      await page.mouse.click(100, 100);
      await page.waitForFunction(
        () => (window as any).__selectionIds.length > 2,
      );

      const selectedIds = await page.evaluate(
        () => (window as any).__selectionIds as string[],
      );
      expect(selectedIds.slice(0, 3)).toEqual([
        "middle-frame",
        "grandchild",
        "outer-frame",
      ]);
    } finally {
      await browser.close();
    }
  });

  it("keeps a selected generated group closed to its children", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(GENERATED_GROUP_FIXTURE);
      await page.evaluate(() => {
        (window as any).__selectionIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectionIds.push(
              event.data.payload?.sourceId ?? "",
            );
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await page.evaluate(() => {
        const selector = '[data-agent-native-node-id="generated-group"]';
        window.postMessage(
          {
            type: "select-element",
            selector,
            selectorCandidates: [selector],
          },
          "*",
        );
      });
      await page.waitForFunction(
        () => (window as any).__selectionIds.length > 0,
      );
      await page.mouse.click(80, 80);
      await page.waitForFunction(
        () => (window as any).__selectionIds.length > 1,
      );

      const selectedIds = await page.evaluate(
        () => (window as any).__selectionIds as string[],
      );
      expect(selectedIds[selectedIds.length - 1]).toBe("generated-group");
    } finally {
      await browser.close();
    }
  });

  it("shift+click toggles an already-selected object off", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const overlayCount = () =>
        page.evaluate(
          () =>
            document.querySelectorAll(
              "[data-agent-native-edit-overlay='multi-selection']:not([data-agent-native-multi-selection-bounds])",
            ).length,
        );

      await page.mouse.click(100, 340);
      await page.waitForTimeout(50);
      await page.keyboard.down("Shift");
      await page.mouse.click(250, 340);
      await page.waitForTimeout(50);

      expect(await overlayCount()).toBe(1);

      await page.mouse.click(250, 340);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(50);

      expect(await overlayCount()).toBe(0);
      const finalPrimary = await page.evaluate(() => {
        const overlay = document.querySelector(
          "[data-agent-native-edit-overlay='selection']",
        ) as HTMLElement | null;
        if (!overlay || overlay.style.display === "none") return null;
        return { left: overlay.style.left, top: overlay.style.top };
      });
      expect(finalPrimary?.left).toBe("40px");
    } finally {
      await browser.close();
    }
  });

  it("keeps the host-mirrored selection when Shift-click removes one member", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      const selections: string[][] = [];
      await page.exposeFunction("__pushMarqueeSelection", (ids: string[]) =>
        selections.push(ids),
      );
      await page.evaluate(() => {
        window.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as {
            type?: string;
            payload?: Array<{ sourceId?: string }>;
          };
          if (data?.type === "agent-native:layer-marquee-selection") {
            (window as any).__pushMarqueeSelection(
              (data.payload ?? []).map((element) => element.sourceId ?? ""),
            );
          }
        });
      });
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const mirrorHostSelection = (primary: string, selected: string[]) =>
        page.evaluate(
          ({ primary, selected }) => {
            const selectorFor = (id: string) =>
              `[data-agent-native-node-id="${id}"]`;
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  type: "select-element",
                  selector: selectorFor(primary),
                  selectorCandidates: [selectorFor(primary)],
                },
                source: window,
              }),
            );
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  type: "select-elements",
                  selectorGroups: selected.map((id) => [selectorFor(id)]),
                },
                source: window,
              }),
            );
          },
          { primary, selected },
        );

      await page.mouse.click(100, 340);
      await mirrorHostSelection("solo-a", ["solo-a"]);
      await page.keyboard.down("Shift");
      await page.mouse.click(250, 340);
      await page.keyboard.up("Shift");

      // The host mirrors its canonical A+B state back into the iframe before
      // the user toggles B off again.
      await mirrorHostSelection("solo-b", ["solo-a", "solo-b"]);
      await page.keyboard.down("Shift");
      await page.mouse.click(250, 340);
      await page.keyboard.up("Shift");
      await vi.waitFor(() => expect(selections.length).toBeGreaterThan(0));

      expect(selections[selections.length - 1]).toEqual(["solo-a"]);
    } finally {
      await browser.close();
    }
  });

  it("re-enters a drilled container at its outer level after a click outside it", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(DRILL_SCOPE_FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__selectionIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectionIds.push(
              event.data.payload?.sourceId ?? "",
            );
          }
        });
      });

      const selectionCount = () =>
        page.evaluate(() => (window as any).__selectionIds.length as number);
      const clickAndAwaitSelection = async (x: number, y: number) => {
        const before = await selectionCount();
        await page.mouse.click(x, y);
        await page.waitForFunction(
          (before) => (window as any).__selectionIds.length > before,
          before,
        );
      };

      await clickAndAwaitSelection(100, 90);
      const beforeDrill = await selectionCount();
      await page.mouse.dblclick(100, 90);
      await page.waitForFunction(
        (before) => (window as any).__selectionIds.length > before,
        beforeDrill,
      );
      await page.waitForTimeout(50);
      await clickAndAwaitSelection(420, 60);
      await clickAndAwaitSelection(100, 90);

      const selectedIds = await page.evaluate(
        () => (window as any).__selectionIds as string[],
      );
      expect(selectedIds[selectedIds.length - 1]).toBe("card");
    } finally {
      await browser.close();
    }
  });

  it("keeps a click inside a drilled container at the child level", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(DRILL_SCOPE_FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__selectionIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectionIds.push(
              event.data.payload?.sourceId ?? "",
            );
          }
        });
      });

      const selectionCount = () =>
        page.evaluate(() => (window as any).__selectionIds.length as number);
      const clickAndAwaitSelection = async (x: number, y: number) => {
        const before = await selectionCount();
        await page.mouse.click(x, y);
        await page.waitForFunction(
          (before) => (window as any).__selectionIds.length > before,
          before,
        );
      };

      await clickAndAwaitSelection(100, 90);
      const beforeDrill = await selectionCount();
      await page.mouse.dblclick(100, 90);
      await page.waitForFunction(
        (before) => (window as any).__selectionIds.length > before,
        beforeDrill,
      );
      await page.waitForTimeout(50);
      await clickAndAwaitSelection(100, 90);

      const selectedIds = await page.evaluate(
        () => (window as any).__selectionIds as string[],
      );
      expect(selectedIds[selectedIds.length - 1]).toBe("leaf");
    } finally {
      await browser.close();
    }
  });

  it("exits a drilled container when a plain click selects a sibling container background", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(DRILL_SCOPE_SIBLING_FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      await page.evaluate(() => {
        (window as any).__selectionIds = [];
        window.addEventListener("message", (event: MessageEvent) => {
          if (event.data?.type === "element-select") {
            (window as any).__selectionIds.push(
              event.data.payload?.sourceId ?? "",
            );
          }
        });
      });

      const selectionCount = () =>
        page.evaluate(() => (window as any).__selectionIds.length as number);
      const clickAndAwaitSelection = async (x: number, y: number) => {
        const before = await selectionCount();
        await page.mouse.click(x, y);
        await page.waitForFunction(
          (before) => (window as any).__selectionIds.length > before,
          before,
        );
      };

      await clickAndAwaitSelection(100, 90);
      const beforeDrill = await selectionCount();
      await page.mouse.dblclick(100, 90);
      await page.waitForFunction(
        (before) => (window as any).__selectionIds.length > before,
        beforeDrill,
      );
      await page.waitForTimeout(50);
      // (470, 90) is Panel's background, outside the drilled Kid. This click
      // commits through selectElementAtEvent, not selectTarget, so it needs
      // its own scope check.
      await clickAndAwaitSelection(470, 90);
      await clickAndAwaitSelection(100, 90);

      const selectedIds = await page.evaluate(
        () => (window as any).__selectionIds as string[],
      );
      expect(selectedIds[selectedIds.length - 1]).toBe("card");
    } finally {
      await browser.close();
    }
  });
});
