import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

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
  <section id="detached-parent"><div data-agent-native-node-id="orphan">Orphan</div></section>
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
          (window as Window & { __subjectProbes?: number }).__subjectProbes = 0;
          (
            window as Window & { __originalSubject?: Element }
          ).__originalSubject =
            document.querySelector('[data-agent-native-node-id="subject"]') ??
            undefined;
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

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "pending-delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
              transactionId: "move-1",
            },
            "*",
          );
          window.postMessage(
            {
              type: "delete-element",
              selector: '[data-agent-native-node-id="subject"]',
              selectorCandidates: ['[data-agent-native-node-id="subject"]'],
              requestId: "delete-1",
              transactionId: "move-1",
            },
            "*",
          );
        });
        expect(
          await page.locator('[data-agent-native-node-id="subject"]').count(),
        ).toBe(0);

        const cancellation = await page.evaluate(
          () =>
            new Promise<{ sourcePresent: boolean }>((resolve) => {
              const onMessage = (event: MessageEvent) => {
                if (
                  event.data?.type !== "runtime-structure-delete-cancelled" ||
                  event.data?.requestId !== "delete-1"
                ) {
                  return;
                }
                window.removeEventListener("message", onMessage);
                resolve({ sourcePresent: event.data.sourcePresent === true });
              };
              window.addEventListener("message", onMessage);
              window.postMessage(
                {
                  type: "cancel-pending-delete-element",
                  selector: '[data-agent-native-node-id="subject"]',
                  selectorCandidates: ['[data-agent-native-node-id="subject"]'],
                  requestId: "delete-1",
                  transactionId: "move-1",
                },
                "*",
              );
              window.postMessage(
                {
                  type: "visual-structure-ack",
                  requestId: "delete-1",
                  applied: false,
                  cancelRuntimeStructureDelete: {
                    transactionId: "move-1",
                    selector: '[data-agent-native-node-id="subject"]',
                    selectorCandidates: [
                      '[data-agent-native-node-id="subject"]',
                    ],
                  },
                },
                "*",
              );
            }),
        );
        expect(cancellation).toEqual({ sourcePresent: true });

        const restored = page.locator('[data-agent-native-node-id="subject"]');
        expect(await restored.count()).toBe(1);
        expect(
          await restored.evaluate(
            (element) =>
              element ===
              (window as Window & { __originalSubject?: Element })
                .__originalSubject,
          ),
        ).toBe(true);
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

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "delete-element",
              selector: '[data-agent-native-node-id="orphan"]',
              selectorCandidates: ['[data-agent-native-node-id="orphan"]'],
              requestId: "delete-detached-parent",
              transactionId: "move-detached-parent",
            },
            "*",
          );
          document.querySelector("#detached-parent")?.remove();
        });
        const unresolvedCancellation = await page.evaluate(
          () =>
            new Promise<{ sourcePresent: boolean }>((resolve) => {
              const onMessage = (event: MessageEvent) => {
                if (
                  event.data?.type !== "runtime-structure-delete-cancelled" ||
                  event.data?.requestId !== "delete-detached-parent"
                ) {
                  return;
                }
                window.removeEventListener("message", onMessage);
                resolve({ sourcePresent: event.data.sourcePresent === true });
              };
              window.addEventListener("message", onMessage);
              window.postMessage(
                {
                  type: "visual-structure-ack",
                  requestId: "delete-detached-parent",
                  applied: false,
                  cancelRuntimeStructureDelete: {
                    transactionId: "move-detached-parent",
                    selector: '[data-agent-native-node-id="orphan"]',
                    selectorCandidates: [
                      '[data-agent-native-node-id="orphan"]',
                    ],
                  },
                },
                "*",
              );
            }),
        );
        expect(unresolvedCancellation).toEqual({ sourcePresent: false });
        expect(
          await page.locator('[data-agent-native-node-id="orphan"]').count(),
        ).toBe(0);

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
