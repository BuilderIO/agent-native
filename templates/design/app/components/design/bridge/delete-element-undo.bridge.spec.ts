import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * GAP-DELETE-LIVE — a host-initiated delete on a live screen is now queued as
 * a pending live edit, so Cmd+Z must be able to take it back. Undo replays
 * through the SAME `visual-structure-ack` channel a drag-move uses, which
 * previously only knew how to revert a reorder or drop an insert: a delete's
 * ack found no pending entry and Cmd+Z silently did nothing.
 *
 * Runs the real generated bridge in a real browser, since the behaviour under
 * test is DOM identity — the restored node must be the ORIGINAL element, with
 * its listeners and children intact, back in its original slot.
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

const FIXTURE = `<!doctype html><html><body>
  <main>
    <div data-agent-native-node-id="first">First</div>
    <div data-agent-native-node-id="subject" style="opacity: .65 !important; pointer-events: auto; transition: opacity 2s"><span>Subject</span></div>
    <div data-agent-native-node-id="last">Last</div>
  </main>
</body></html>`;

describe("delete-element / visual-structure-ack undo", () => {
  it(
    "restores the deleted node in place when the pending live edit is undone",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];
      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(FIXTURE);
        await page.evaluate(() => {
          // Identity probe: a re-parsed clone would not carry this listener.
          (window as Window & { __subjectProbes?: number }).__subjectProbes = 0;
          document
            .querySelector('[data-agent-native-node-id="subject"]')
            ?.addEventListener("agent-native-node-identity-probe", () => {
              (
                window as Window & { __subjectProbes?: number }
              ).__subjectProbes! += 1;
            });
        });
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        const subject = page.locator('[data-agent-native-node-id="subject"]');
        const computedStyle = (property: string) =>
          subject.evaluate(
            (element, name) => getComputedStyle(element).getPropertyValue(name),
            property,
          );
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "pending-delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
            },
            "*",
          );
        });
        expect(await computedStyle("opacity")).toBe("0");
        expect(await computedStyle("pointer-events")).toBe("none");
        expect(await computedStyle("transition")).toBe("none");
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "cancel-pending-delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
            },
            "*",
          );
        });
        expect(await computedStyle("opacity")).toBe("0.65");
        expect(await computedStyle("pointer-events")).toBe("auto");
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
        expect(await computedStyle("transition")).toBe("opacity 2s");

        // The accepted move stays concealed until removal. Undo restores the
        // original inline declaration, not the temporary editor-only mask.
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "pending-delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
            },
            "*",
          );
          window.postMessage(
            {
              type: "delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
            },
            "*",
          );
        });
        expect(
          await page.locator('[data-agent-native-node-id="subject"]').count(),
        ).toBe(0);

        // Cmd+Z on the pending live edit.
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "cancel-pending-delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
            },
            "*",
          );
          window.postMessage(
            {
              type: "visual-structure-ack",
              requestId: "delete-1",
              applied: false,
            },
            "*",
          );
        });

        const restored = page.locator('[data-agent-native-node-id="subject"]');
        expect(await restored.count()).toBe(1);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
        expect(
          await restored.evaluate(
            (element) => getComputedStyle(element).opacity,
          ),
        ).toBe("0.65");
        expect(
          await restored.evaluate(
            (element) => getComputedStyle(element).pointerEvents,
          ),
        ).toBe("auto");
        expect(
          await restored.evaluate(
            (element) => getComputedStyle(element).transition,
          ),
        ).toBe("opacity 2s");
        expect(
          await page.evaluate(() =>
            Array.from(document.querySelector("main")!.children).map((child) =>
              child.getAttribute("data-agent-native-node-id"),
            ),
          ),
        ).toEqual(["first", "subject", "last"]);
        expect(await restored.innerHTML()).toBe("<span>Subject</span>");
        await restored.evaluate((element) => {
          element.dispatchEvent(
            new CustomEvent("agent-native-node-identity-probe", {
              bubbles: true,
            }),
          );
        });
        expect(
          await page.evaluate(
            () =>
              (window as Window & { __subjectProbes?: number }).__subjectProbes,
          ),
        ).toBe(1);

        // Redo re-issues the delete under the same request id.
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
            },
            "*",
          );
        });
        expect(
          await page.locator('[data-agent-native-node-id="subject"]').count(),
        ).toBe(0);

        // Applying the pending edit to source acks applied:true — the node
        // stays deleted and the entry is released, so a later stray ack for
        // the same id cannot resurrect it.
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "visual-structure-ack",
              requestId: "delete-1",
              applied: true,
            },
            "*",
          );
          window.postMessage(
            {
              type: "visual-structure-ack",
              requestId: "delete-1",
              applied: false,
            },
            "*",
          );
        });
        expect(
          await page.locator('[data-agent-native-node-id="subject"]').count(),
        ).toBe(0);

        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "leaves a delete without a request id un-undoable rather than restoring a stale node",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(FIXTURE);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
            },
            "*",
          );
          window.postMessage(
            {
              type: "visual-structure-ack",
              requestId: "delete-1",
              applied: false,
            },
            "*",
          );
        });
        expect(
          await page.locator('[data-agent-native-node-id="subject"]').count(),
        ).toBe(0);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "reports an unresolved requested delete so a cross-screen move can roll back",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(FIXTURE);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.evaluate(() => {
          const messages: Record<string, unknown>[] = [];
          window.addEventListener("message", (event) => {
            if (event.data?.type === "runtime-element-delete-rejected") {
              messages.push(event.data);
            }
          });
          (
            window as Window & {
              __deleteRejections?: Record<string, unknown>[];
            }
          ).__deleteRejections = messages;
          window.postMessage(
            {
              type: "delete-element",
              selector: '[data-agent-native-node-id="missing"]',
              selectorCandidates: ['[data-agent-native-node-id="missing"]'],
              requestId: "delete-missing",
              transactionId: "move-1",
            },
            "*",
          );
        });
        await page.waitForTimeout(100);
        expect(
          await page.evaluate(
            () =>
              (
                window as Window & {
                  __deleteRejections?: Record<string, unknown>[];
                }
              ).__deleteRejections,
          ),
        ).toEqual([
          expect.objectContaining({
            type: "runtime-element-delete-rejected",
            requestId: "delete-missing",
            transactionId: "move-1",
            reason: "target-unresolved",
          }),
        ]);
      } finally {
        await browser.close();
      }
    },
  );
});
