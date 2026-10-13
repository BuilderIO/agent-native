import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

// A block wrapper, so a hit on a button's own padding asks whether the button
// itself accepts children instead of inserting beside it in a flex parent.
const BUTTONS = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
  <div data-agent-native-node-id="wrap" style="padding:24px;width:400px">
    <button data-agent-native-node-id="card" style="display:flex;flex-direction:column;gap:8px;padding:16px;width:300px">
      <h3 data-agent-native-node-id="card-title" style="margin:0">Pro plan</h3>
      <p data-agent-native-node-id="card-copy" style="margin:0">Unlimited screens</p>
    </button>
    <button data-agent-native-node-id="add" style="display:flex;gap:8px;padding:16px;width:300px;margin-top:24px">
      <i data-agent-native-node-id="add-icon" style="display:block;width:16px;height:16px;background:#111"></i>Add screen
    </button>
  </div>
</body></html>`;

type HitTestPacket = { anchorNodeId: string; placement: string };

async function hitTestLeftPaddingOf(
  page: Page,
  nodeId: string,
): Promise<HitTestPacket> {
  const box = await page
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`no box for ${nodeId}`);
  return page.evaluate(
    ([correlationId, x, y]) =>
      new Promise<HitTestPacket>((resolve) => {
        const onMessage = (event: MessageEvent) => {
          if (
            event.data?.type === "agent-native:hit-test-result" &&
            event.data.correlationId === correlationId
          ) {
            window.removeEventListener("message", onMessage);
            resolve(event.data);
          }
        };
        window.addEventListener("message", onMessage);
        window.postMessage(
          { type: "agent-native:hit-test", correlationId, x, y },
          "*",
        );
      }),
    [nodeId, box.x + 6, box.y + box.height / 2] as const,
  );
}

describe("hit-testing a drop onto a button", () => {
  it("drops into a button that stacks a heading and a paragraph", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(BUTTONS);
      await page.addScriptTag({ content: hitTestBridgeScript });

      const packet = await hitTestLeftPaddingOf(page, "card");
      expect(
        ["card", "card-title", "card-copy"],
        JSON.stringify(packet),
      ).toContain(packet.anchorNodeId);
    } finally {
      await browser.close();
    }
  });

  it("drops beside a button whose only content is an inline icon and label", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 640, height: 480 },
      });
      await page.setContent(BUTTONS);
      await page.addScriptTag({ content: hitTestBridgeScript });

      expect(await hitTestLeftPaddingOf(page, "add")).toMatchObject({
        anchorNodeId: "wrap",
        placement: "inside",
      });
    } finally {
      await browser.close();
    }
  });
});
