import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return (
    editorChromeBridgeScript
      .replace("__READ_ONLY__", "false")
      .replace("__TEXT_EDITING_ENABLED__", "false")
      .replace("__EDITOR_CHROME_SCALE_X__", "1")
      .replace("__EDITOR_CHROME_SCALE_Y__", "1")
      .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify("live-screen"))
      // This suite exercises the board's Figma click-through policy. Screen
      // content intentionally uses direct single-click selection instead.
      .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
      .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
      .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
      .replace(/__INITIAL_SOURCE_HEAD__/g, '""')
  );
}

const FIXTURE = `<!doctype html><html><body style="margin:0">
  <div data-agent-native-node-id="frame-a" data-agent-native-layer-name="Frame A"
       data-agent-native-group-wrapper="true" data-agent-native-preserve-styles="true"
       data-an-primitive="frame"
       style="position:absolute;left:40px;top:40px;width:200px;height:100px;background:#111827">
    <div data-agent-native-node-id="kid-a1" data-agent-native-layer-name="Kid A1"
         style="position:absolute;left:16px;top:16px;width:80px;height:68px;background:#3b82f6"></div>
    <div data-agent-native-node-id="kid-a2" data-agent-native-layer-name="Kid A2"
         style="position:absolute;left:110px;top:16px;width:80px;height:68px;background:#22c55e"></div>
  </div>
  <div data-agent-native-node-id="board-frame" data-agent-native-layer-name="Board Frame"
       data-an-primitive="frame"
       style="position:absolute;left:0px;top:160px;width:300px;height:140px">
    <div data-agent-native-node-id="frame-b" data-agent-native-layer-name="Frame B"
         data-an-primitive="frame"
         style="position:absolute;left:40px;top:20px;width:200px;height:100px;background:#111827">
      <div data-agent-native-node-id="kid-b1" data-agent-native-layer-name="Kid B1"
           style="position:absolute;left:16px;top:16px;width:80px;height:68px;background:#3b82f6"></div>
    </div>
  </div>
  <div data-agent-native-node-id="group-c" data-agent-native-layer-name="Group C"
       data-agent-native-group-wrapper="true" data-agent-native-preserve-styles="true"
       data-agent-native-group="true"
       style="position:absolute;left:40px;top:320px;width:200px;height:100px;background:#111827">
    <div data-agent-native-node-id="kid-c1" data-agent-native-layer-name="Kid C1"
         style="position:absolute;left:16px;top:16px;width:80px;height:68px;background:#3b82f6"></div>
  </div>
  <div data-agent-native-node-id="frame-d" data-agent-native-layer-name="Frame D"
       data-an-primitive="frame"
       style="position:absolute;left:40px;top:460px;width:200px;height:100px;background:#ffffff">
    <div data-agent-native-node-id="text-d1" data-an-primitive="text"
         style="position:absolute;left:16px;top:16px;width:80px;height:40px">Label</div>
  </div>
</body></html>`;

async function clickSequence(points: [number, number][]) {
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

    for (const [x, y] of points) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(50);
    }
    return selected;
  } finally {
    await browser.close();
  }
}

describe("click-through onto a generated Frame's children", () => {
  it("dual-tagged Frame (group-wrapper + data-an-primitive=frame): second click selects the child", async () => {
    const selected = await clickSequence([
      [96, 90],
      [96, 90],
    ]);
    expect(selected).toEqual(["frame-a", "kid-a1"]);
  });

  it("a top-level board Frame's child is selected by the first click, like a Figma artboard", async () => {
    const selected = await clickSequence([[56, 490]]);
    expect(selected).toEqual(["text-d1"]);
  });

  it("plain nested Frame (data-an-primitive=frame only): stays click-through (regression guard)", async () => {
    const selected = await clickSequence([
      [96, 230],
      [96, 230],
    ]);
    expect(selected).toEqual(["frame-b", "kid-b1"]);
  });

  it("Group wrapper (data-agent-native-group=true): now also click-throughs, matching the Frame fix", async () => {
    const selected = await clickSequence([
      [96, 370],
      [96, 370],
    ]);
    expect(selected).toEqual(["group-c", "kid-c1"]);
  });
});
