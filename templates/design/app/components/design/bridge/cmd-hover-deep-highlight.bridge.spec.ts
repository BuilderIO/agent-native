import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Figma parity: holding Cmd/Ctrl while hovering previews Cmd-click's
 * deep-select — the hover outline jumps to the innermost object under the
 * pointer while the key is down, and releasing it restores the normal
 * container-first hover. Modifier state is re-resolved on keydown/keyup too,
 * not just on the next pointermove, so pressing/releasing the key while the
 * pointer sits still still updates the outline.
 */
function hydratedEditorChromeBridgeScript(): string {
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

const FIXTURE = `<!doctype html><html><body style="margin:0;position:relative;z-index:2147483647;width:100vw;height:100vh">
  <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
       style="position:absolute;left:40px;top:40px;width:280px;height:200px;background:#111827">
    <div data-agent-native-node-id="kid-a" data-agent-native-layer-name="Kid A"
         style="position:absolute;left:16px;top:16px;width:110px;height:80px;background:#3b82f6"></div>
  </div>
</body></html>`;

/** Identifies which tracked node the highlight overlay currently frames by
 * matching its rect against each candidate's own rect (avoids elementFromPoint,
 * which would just hit the shield/highlight overlays sitting on top). */
async function highlightOutlinesId(
  page: import("@playwright/test").Page,
  candidateIds: string[],
) {
  return page.evaluate((ids) => {
    const overlay = document.querySelector(
      '[data-agent-native-edit-overlay="highlight"]',
    ) as HTMLElement | null;
    if (!overlay || overlay.style.display === "none") return null;
    const r = overlay.getBoundingClientRect();
    for (const id of ids) {
      const el = document.querySelector(`[data-agent-native-node-id="${id}"]`);
      if (!el) continue;
      const er = el.getBoundingClientRect();
      if (
        Math.abs(er.left - r.left) < 1 &&
        Math.abs(er.top - r.top) < 1 &&
        Math.abs(er.width - r.width) < 1 &&
        Math.abs(er.height - r.height) < 1
      ) {
        return id;
      }
    }
    return null;
  }, candidateIds);
}

describe("Cmd/Ctrl-held hover deep-selects", () => {
  it("outlines Card by default, Kid A while Meta is held, and back to Card on release — even without moving the pointer", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      const kidBox = (await page
        .locator('[data-agent-native-node-id="kid-a"]')
        .boundingBox())!;
      const center = {
        x: kidBox.x + kidBox.width / 2,
        y: kidBox.y + kidBox.height / 2,
      };

      await page.mouse.move(center.x, center.y);
      await page.waitForTimeout(30);
      expect(
        await highlightOutlinesId(page, ["card", "kid-a"]),
        "without a modifier, hovering the nested child must outline its container",
      ).toBe("card");

      // No mouse movement between here and the next assertion — only the
      // modifier key changes.
      await page.keyboard.down("Meta");
      await page.waitForTimeout(30);
      expect(
        await highlightOutlinesId(page, ["card", "kid-a"]),
        "holding Meta while stationary must re-resolve the hover to the deepest object",
      ).toBe("kid-a");

      await page.keyboard.up("Meta");
      await page.waitForTimeout(30);
      expect(
        await highlightOutlinesId(page, ["card", "kid-a"]),
        "releasing Meta while stationary must restore container-first hover",
      ).toBe("card");

      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("Control held behaves the same as Meta (non-Mac parity)", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(FIXTURE);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });
      const kidBox = (await page
        .locator('[data-agent-native-node-id="kid-a"]')
        .boundingBox())!;
      await page.mouse.move(
        kidBox.x + kidBox.width / 2,
        kidBox.y + kidBox.height / 2,
      );
      await page.waitForTimeout(30);
      await page.keyboard.down("Control");
      await page.waitForTimeout(30);
      expect(await highlightOutlinesId(page, ["card", "kid-a"])).toBe("kid-a");
      await page.keyboard.up("Control");
    } finally {
      await browser.close();
    }
  });
});
