/**
 * The live-insert LIFECYCLE: insert -> undo -> redo -> delete -> apply.
 *
 * Each of the three bugs this pins passes a point assertion and only shows up
 * in sequence:
 *   - Apply's source-path preflight demanded a SUBJECT path for every
 *     non-removal edit. An inserted node is new, so it has no subject source
 *     anchor by definition and Apply always died on "anchors still loading".
 *   - Redo re-issued `runtime-structure-move` for an insert whose undo had
 *     already removed the node, so the bridge silently found no subject.
 *   - Deleting a newly inserted node left its pending insertion queued, so a
 *     later Apply could resurrect exactly what the user just deleted.
 *
 * The live DOM half runs the real generated bridge in a real browser (the
 * insert/ack/delete round-trips are DOM identity, not string manipulation);
 * the queue and history half calls the real host functions the editor calls.
 */
import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";
import type { ElementInfo } from "../../components/design/types";
import {
  runRecordPendingLiveStructureEdit,
  type RecordPendingLiveStructureEditArgs,
} from "./commands/record-pending-live-structure-edit";
import type { OverviewScreen } from "./derive/overview-screens";
import {
  formatPendingVisualStylePrompt,
  mergePendingLiveNonStyleEdits,
  pendingLiveStructureEditsMatch,
  pendingStructureEditSourcePaths,
  pendingStructureRedoCommand,
  type PendingLiveNonStyleEdit,
  type PendingLiveStructureEdit,
  type PendingLiveStructureUndoEntry,
} from "./pending-edits";
import {
  runtimeStructureSnapshotSignature,
  verifyPendingStructureRuntime,
} from "./pending-structure-verification";

const SCREEN_ID = "live-screen";
const ANCHOR_SELECTOR = '[data-agent-native-node-id="card"]';
const PRIMITIVE_SELECTOR = '[data-agent-native-node-id="primitive-1"]';
const PRIMITIVE_CHILD_SELECTOR =
  '[data-agent-native-node-id="primitive-child"]';
const PRIMITIVE_HTML =
  '<div data-agent-native-node-id="primitive-1" style="width:40px;height:40px;background:#111">Primitive<div data-agent-native-node-id="primitive-child">Nested child</div></div>';

function hydratedEditorChromeBridgeScript(runtimeSnapshots = false): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify(SCREEN_ID))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", String(runtimeSnapshots))
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const FIXTURE = `<!doctype html><html><body>
  <main>
    <div id="card" data-agent-native-node-id="card" style="display:flex;width:300px;height:200px">
      <p data-agent-native-node-id="copy">Copy</p>
    </div>
  </main>
</body></html>`;

const REORDER_FIXTURE = `<!doctype html><html><body>
  <main>
    <div id="card" data-agent-native-node-id="card" style="display:flex;flex-direction:column;width:300px;height:200px">
      <p data-agent-native-node-id="v1">V1</p>
      <p data-agent-native-node-id="v2">V2</p>
      <p data-agent-native-node-id="v3">V3</p>
    </div>
  </main>
</body></html>`;

const REPEATED_RUNTIME_INSERT_FIXTURE = `<!doctype html><html><body>
  <main data-agent-native-node-id="card">
    <p data-agent-native-node-id="v1" data-agent-native-runtime-instance-id="instance-v1">V1</p>
    <p data-agent-native-node-id="v2" data-agent-native-runtime-instance-id="instance-v2">V2</p>
  </main>
</body></html>`;

interface StructureChangeMessage {
  type: string;
  requestId: string;
  selector: string;
  sourceId?: string;
  anchorSelector: string;
  anchorSourceId?: string;
  placement: "before" | "after" | "inside";
  dropMode?: "flow-insert" | "absolute-container";
  insertedHtml?: string;
  replaced?: boolean;
  replacementSnapshotHtml?: string;
  payload?: { provenance?: unknown };
  anchorPayload?: { provenance?: unknown };
}

async function collectBridgeMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __messages?: unknown[] }).__messages = [];
    window.addEventListener("message", (event) => {
      (window as Window & { __messages?: unknown[] }).__messages?.push(
        event.data,
      );
      if (
        event.source === window &&
        (event.data as { type?: string } | null)?.type ===
          "agent-native:runtime-layer-snapshot-reservation-request"
      ) {
        const request = event.data as {
          requestId?: number;
          documentId?: string;
        };
        window.postMessage(
          {
            type: "grant-runtime-layer-snapshot-reservation",
            requestId: request.requestId,
            documentId: request.documentId,
            reservationToken: `test-reservation-${request.requestId}`,
          },
          "*",
        );
      }
    });
  });
}

async function nextStructureChange(
  page: Page,
  seen: number,
): Promise<StructureChangeMessage> {
  await page.waitForFunction(
    (count: number) =>
      (
        (window as Window & { __messages?: StructureChangeMessage[] })
          .__messages ?? []
      ).filter((message) => message?.type === "visual-structure-change")
        .length > count,
    seen,
  );
  const messages = (await page.evaluate(
    () =>
      (window as Window & { __messages?: StructureChangeMessage[] })
        .__messages ?? [],
  )) as StructureChangeMessage[];
  return messages.filter(
    (message) => message.type === "visual-structure-change",
  )[seen]!;
}

function pendingEditFromEcho(
  message: StructureChangeMessage,
): PendingLiveStructureEdit {
  const state: RecordPendingLiveStructureEditArgs = {
    canEditDesign: true,
    cancelPendingStructureVerification: () => {},
    files: [],
    localhostConnectionRootPathByIdRef: { current: new Map() },
    overviewScreens: [],
    pendingLiveNonStyleEditsRef: { current: [] },
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    pendingVisualStyleRedoStackRef: { current: [] },
    runtimeLayerSnapshotsById: {},
    setPendingLiveNonStyleEdits: () => {},
  };
  runRecordPendingLiveStructureEdit(
    state,
    SCREEN_ID,
    message.replaced ? message.anchorSelector : message.selector,
    message.replaced ? "" : message.anchorSelector,
    message.placement,
    (message.replaced ? message.anchorPayload : message.payload) as never,
    {
      sourceId: message.replaced ? message.anchorSourceId : message.sourceId,
      anchorSourceId: message.replaced ? undefined : message.anchorSourceId,
      anchorElementInfo: message.anchorPayload as never,
      requestId: message.requestId,
      dropMode: message.dropMode,
      insertedHtml: message.insertedHtml,
      ...(message.replaced
        ? {
            replaced: true,
            replacementSelector: message.selector,
            replacementSourceId: message.sourceId,
            replacementElementInfo: message.payload as never,
            replacementSnapshotHtml: message.replacementSnapshotHtml,
          }
        : {}),
    },
  );
  expect(state.pendingLiveNonStyleEditsRef.current).toHaveLength(1);
  return state.pendingLiveNonStyleEditsRef
    .current[0] as PendingLiveStructureEdit;
}

const POST_GESTURE_REORDER_SNAPSHOT = `<!doctype html><html><body>
  <div data-agent-native-node-id="flow-root" style="display:flex;flex-direction:column">
    <div data-agent-native-node-id="v2">V2</div>
    <div data-agent-native-node-id="v3">V3</div>
    <div data-agent-native-node-id="v1">V1</div>
  </div>
</body></html>`;

function reorderElementInfo(
  sourceId: string,
  textContent: string,
  column: number,
): ElementInfo {
  return {
    tagName: "div",
    sourceId,
    selector: `[data-agent-native-node-id="${sourceId}"]`,
    textContent,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    isFlexChild: true,
    isFlexContainer: false,
    provenance: {
      framework: "html",
      sourceFile: "index.html",
      line: 1,
      column,
      method: "data-attribute",
    },
  };
}

function recordReorderAgainstRunningSnapshot(
  sourceType: "inline" | "localhost" | "fusion",
) {
  const pendingLiveNonStyleEditsRef = {
    current: [] as PendingLiveNonStyleEdit[],
  };
  const subjectInfo = reorderElementInfo("v1", "V1", 2);
  const anchorInfo = reorderElementInfo("v3", "V3", 4);
  const state: RecordPendingLiveStructureEditArgs = {
    canEditDesign: true,
    cancelPendingStructureVerification: () => {},
    files: [],
    localhostConnectionRootPathByIdRef: { current: new Map() },
    overviewScreens: [
      {
        id: SCREEN_ID,
        filename: "index.html",
        content: "http://127.0.0.1:7331/",
        updatedAt: "1",
        sourceFile: "index.html",
        sourceType,
        heightPinned: false,
      } satisfies OverviewScreen,
    ],
    pendingLiveNonStyleEditsRef,
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    pendingVisualStyleRedoStackRef: { current: [] },
    runtimeLayerSnapshotsById: {
      [SCREEN_ID]: {
        html: POST_GESTURE_REORDER_SNAPSHOT,
        nodeCount: 4,
      },
    },
    setPendingLiveNonStyleEdits: () => {},
  };
  runRecordPendingLiveStructureEdit(
    state,
    SCREEN_ID,
    subjectInfo.selector!,
    anchorInfo.selector!,
    "after",
    subjectInfo,
    {
      sourceId: subjectInfo.sourceId,
      anchorSourceId: anchorInfo.sourceId,
      anchorElementInfo: anchorInfo,
      requestId: "reorder-post-gesture",
      dropMode: "flow-insert",
    },
  );
  return pendingLiveNonStyleEditsRef.current;
}

describe("live insert lifecycle", () => {
  it("skips persisted static no-ops but queues running-app post-gesture snapshots", () => {
    expect(recordReorderAgainstRunningSnapshot("inline")).toEqual([]);
    expect(recordReorderAgainstRunningSnapshot("fusion")).toEqual([]);
    expect(recordReorderAgainstRunningSnapshot("localhost")).toHaveLength(1);
  });

  it(
    "does not emit a pending edit when a runtime move preserves the same slot",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(FIXTURE);
        await page.evaluate(() => {
          (
            window as Window & { __agentNativeSourceProvenance?: unknown }
          ).__agentNativeSourceProvenance = {
            versionHash: "head-before-no-op",
            uniqueNodeIds: ["card", "copy"],
          };
        });
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await collectBridgeMessages(page);

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "runtime-structure-move",
              subjectSelector: '[data-agent-native-node-id="copy"]',
              subjectSourceId: "copy",
              anchorSelector: '[data-agent-native-node-id="card"]',
              anchorSourceId: "card",
              placement: "inside",
            },
            "*",
          );
        });
        await page.waitForTimeout(100);

        const messages = await page.evaluate(
          () =>
            (window as Window & { __messages?: Array<{ type?: string }> })
              .__messages ?? [],
        );
        expect(
          messages.filter(
            (message) => message.type === "visual-structure-change",
          ),
        ).toEqual([]);
        expect(
          await page.evaluate(
            () =>
              (
                window as Window & {
                  __agentNativeSourceProvenance?: unknown;
                }
              ).__agentNativeSourceProvenance,
          ),
        ).toEqual({
          versionHash: "head-before-no-op",
          uniqueNodeIds: ["card", "copy"],
        });
        expect(
          await page
            .locator('[data-agent-native-node-id="card"] > *')
            .allTextContents(),
        ).toEqual(["Copy"]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "emits and acknowledges an actual runtime reorder after a whitespace-separated no-op",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(REORDER_FIXTURE);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await collectBridgeMessages(page);

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "runtime-structure-move",
              subjectSelector: '[data-agent-native-node-id="v1"]',
              subjectSourceId: "v1",
              anchorSelector: '[data-agent-native-node-id="v3"]',
              anchorSourceId: "v3",
              placement: "after",
            },
            "*",
          );
        });

        const structureMessage = await nextStructureChange(page, 0);
        expect(structureMessage).toMatchObject({
          sourceId: "v1",
          anchorSourceId: "v3",
          placement: "after",
          dropMode: "flow-insert",
        });
        expect(
          await page
            .locator('[data-agent-native-node-id="card"] > *')
            .allTextContents(),
        ).toEqual(["V2", "V3", "V1"]);

        await page.evaluate((requestId: string) => {
          window.postMessage(
            {
              type: "visual-structure-ack",
              requestId,
              applied: true,
            },
            "*",
          );
        }, structureMessage.requestId);
        await page.waitForTimeout(100);
        expect(
          await page
            .locator('[data-agent-native-node-id="card"] > *')
            .allTextContents(),
        ).toEqual(["V2", "V3", "V1"]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "remints colliding live insert ids without changing source provenance",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`<!doctype html><html><body>
          <main data-agent-native-node-id="card">
            <div id="email" data-agent-native-node-id="shared" data-source-file="src/Card.tsx" data-source-line="12">Existing</div>
            <div id="email-options">Existing options</div>
          </main>
        </body></html>`);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await collectBridgeMessages(page);

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "runtime-structure-insert",
              requestId: 101,
              html: '<form id="email" data-agent-native-node-id="shared" data-agent-native-runtime-instance-id="shared" data-source-file="src/Card.tsx" data-source-line="12"><label for="email" aria-labelledby="email" aria-label="Email field">Moved</label><input form="email" list="email-options" /><datalist id="email-options"><option value="Moved" /></datalist><span id="email">Duplicate</span></form>',
              anchorSelector: '[data-agent-native-node-id="card"]',
              anchorSourceId: "card",
              placement: "inside",
              remintCollidingNodeIds: true,
            },
            "*",
          );
        });

        await page.waitForFunction(
          () =>
            document.querySelectorAll('[data-source-file="src/Card.tsx"]')
              .length === 2,
        );
        const ids = await page
          .locator('[data-source-file="src/Card.tsx"]')
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
          );
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
        expect(ids).toContain("shared");
        expect(await page.locator("#email").count()).toBe(1);
        const inserted = page
          .locator('[data-source-file="src/Card.tsx"]')
          .nth(1);
        expect(await inserted.locator("label").textContent()).toBe("Moved");
        const insertedId = await inserted.getAttribute("id");
        expect(insertedId).not.toBe("email");
        expect(await inserted.locator("label").getAttribute("for")).toBe(
          insertedId,
        );
        expect(
          await inserted.locator("label").getAttribute("aria-labelledby"),
        ).toBe(insertedId);
        expect(await inserted.locator("label").getAttribute("aria-label")).toBe(
          "Email field",
        );
        expect(await inserted.locator("input").getAttribute("form")).toBe(
          insertedId,
        );
        const optionsId = await inserted.locator("datalist").getAttribute("id");
        expect(optionsId).not.toBe("email-options");
        expect(await inserted.locator("input").getAttribute("list")).toBe(
          optionsId,
        );
        const insertedIds = await inserted
          .locator("[id]")
          .evaluateAll((nodes) => nodes.map((node) => node.id));
        expect(new Set(insertedIds).size).toBe(insertedIds.length);
        expect(
          await inserted.getAttribute("data-agent-native-runtime-instance-id"),
        ).toBe(ids[1]);
        const messages = await page.evaluate(
          () =>
            (window as Window & { __messages?: Record<string, unknown>[] })
              .__messages ?? [],
        );
        expect(messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "runtime-structure-insert-applied",
              requestId: "101",
              sourceId: expect.not.stringMatching(/^shared$/),
            }),
          ]),
        );
        // The host receives the applied notification before it has decided
        // whether the edit will be applied or undone. The bridge must retain
        // its insert origin until that later ack, otherwise Cmd+Z only clears
        // the host ledger and leaves the clone in the running DOM.
        await page.evaluate(() => {
          window.postMessage(
            { type: "visual-structure-ack", requestId: "101", applied: false },
            "*",
          );
        });
        expect(
          await page.locator('[data-source-file="src/Card.tsx"]').count(),
        ).toBe(1);
        expect(await page.locator("#email").count()).toBe(1);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "reorders an existing runtime instance before reminting a colliding id",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(REPEATED_RUNTIME_INSERT_FIXTURE);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await collectBridgeMessages(page);

        await page.evaluate((screenId) => {
          window.postMessage(
            {
              type: "runtime-structure-insert",
              screenId,
              sourceScreenId: screenId,
              requestId: 102,
              html: '<p data-agent-native-node-id="v1" data-agent-native-runtime-instance-id="instance-v1">V1</p>',
              anchorSelector: '[data-agent-native-node-id="v2"]',
              anchorSourceId: "v2",
              placement: "after",
              remintCollidingNodeIds: true,
            },
            "*",
          );
        }, SCREEN_ID);

        await page.waitForFunction(
          () =>
            JSON.stringify(
              Array.from(
                document.querySelectorAll("main > [data-agent-native-node-id]"),
              ).map((node) => node.textContent),
            ) === '["V2","V1"]',
        );
        expect(
          await page.locator('[data-agent-native-node-id="v1"]').count(),
        ).toBe(1);
        expect(
          await page
            .locator(
              '[data-agent-native-node-id="v2"] + [data-agent-native-node-id="v1"]',
            )
            .count(),
        ).toBe(1);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "accepts replacement snapshots at the size cap and rolls back one character above it",
    { timeout: 60_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(
          FIXTURE.replace(
            "</main>",
            '<aside style="display:none">x</aside></main>',
          ),
        );
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(true),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await collectBridgeMessages(page);
        const replace = async (requestId: number): Promise<void> => {
          await page.evaluate(
            ([requestId, anchorSelector]) => {
              window.postMessage(
                {
                  type: "runtime-structure-insert",
                  requestId,
                  html: '<section data-agent-native-node-id="replacement">Replacement</section>',
                  anchorSelector,
                  anchorSourceId: "card",
                  placement: "before",
                  replaceAnchor: true,
                },
                "*",
              );
            },
            [requestId, ANCHOR_SELECTOR] as const,
          );
        };
        const undo = async (echo: StructureChangeMessage): Promise<void> => {
          await page.evaluate((requestId) => {
            window.postMessage(
              { type: "visual-structure-ack", requestId, applied: false },
              "*",
            );
          }, echo.requestId);
          await page.waitForSelector(ANCHOR_SELECTOR);
        };

        await replace(20);
        const baseline = await nextStructureChange(page, 0);
        const baselineLength = baseline.replacementSnapshotHtml!.length;
        expect(baselineLength).toBeGreaterThan(0);
        expect(baselineLength).toBeLessThan(2_000_000);
        await undo(baseline);
        await page.locator("aside").evaluate((element, padding) => {
          element.textContent += "x".repeat(padding);
        }, 2_000_000 - baselineLength);

        await replace(21);
        const atCap = await nextStructureChange(page, 1);
        expect(atCap.replacementSnapshotHtml).toHaveLength(2_000_000);
        expect(
          pendingEditFromEcho(atCap).replacementSnapshotSignature,
        ).toBeTruthy();
        expect(await page.locator(ANCHOR_SELECTOR).count()).toBe(0);
        expect(
          await page
            .locator('[data-agent-native-node-id="replacement"]')
            .count(),
        ).toBe(1);
        await undo(atCap);
        await page.locator("aside").evaluate((element) => {
          element.textContent += "x";
        });

        await replace(22);
        await page.waitForFunction(
          () =>
            (
              window as Window & {
                __messages?: { type: string; requestId?: number }[];
              }
            ).__messages?.some(
              (message) =>
                message.type === "runtime-structure-insert-rejected" &&
                message.requestId === 22,
            ),
          undefined,
          { timeout: 5_000 },
        );
        const messages = await page.evaluate(
          () =>
            (window as Window & { __messages?: Record<string, unknown>[] })
              .__messages ?? [],
        );
        expect(
          messages.filter(
            (message) => message.type === "runtime-structure-insert-rejected",
          ),
        ).toEqual([
          expect.objectContaining({
            requestId: 22,
            reason: "replacement-snapshot-too-large",
          }),
        ]);
        expect(
          messages.filter(
            (message) => message.type === "visual-structure-change",
          ),
        ).toHaveLength(2);
        expect(await page.locator(ANCHOR_SELECTOR).count()).toBe(1);
        expect(await page.locator(ANCHOR_SELECTOR).textContent()).toContain(
          "Copy",
        );
        expect(
          await page
            .locator('[data-agent-native-node-id="replacement"]')
            .count(),
        ).toBe(0);
        await page.waitForFunction(
          () =>
            (
              window as Window & {
                __messages?: { type: string; payload?: { reason?: string } }[];
              }
            ).__messages?.some(
              (message) =>
                message.type === "agent-native:runtime-layer-snapshot-error" &&
                message.payload?.reason === "snapshot-too-large",
            ),
          undefined,
          { timeout: 5_000 },
        );
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "inserts, undoes, redoes, deletes and hands off without resurrecting the deleted node",
    { timeout: 60_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];
      // The editor's pending-live-edit history. Only the push/pop arithmetic
      // lives here; every decision below is the real exported function.
      const undoStack: PendingLiveStructureUndoEntry[] = [];
      const redoStack: PendingLiveStructureUndoEntry[] = [];
      const queue = (): PendingLiveNonStyleEdit[] =>
        mergePendingLiveNonStyleEdits(undoStack.map((entry) => entry.edit));
      const record = (edit: PendingLiveStructureEdit): void => {
        const replayed =
          redoStack.length > 0 &&
          pendingLiveStructureEditsMatch(
            redoStack[redoStack.length - 1]!.edit,
            edit,
          );
        if (replayed) redoStack.pop();
        else redoStack.length = 0;
        undoStack.push({ kind: "structure", edit });
      };

      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(FIXTURE);
        await page.locator("#card").evaluate((element) => {
          Object.defineProperty(element, "__reactFiber$lifecycle", {
            configurable: true,
            enumerable: true,
            value: {
              _debugStack: {
                stack:
                  "Error\n    at Card (http://127.0.0.1:7331/app/routes/home.tsx:12:5)",
              },
              return: null,
            },
          });
        });
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await collectBridgeMessages(page);

        // ── 1. INSERT — board primitive dropped onto the live screen ───────
        await page.evaluate(
          ([html, anchorSelector]) => {
            window.postMessage(
              {
                type: "runtime-structure-insert",
                requestId: 1,
                html,
                anchorSelector,
                anchorSourceId: "card",
                placement: "inside",
              },
              "*",
            );
          },
          [PRIMITIVE_HTML, ANCHOR_SELECTOR] as const,
        );
        const insertEcho = await nextStructureChange(page, 0);
        expect(insertEcho.insertedHtml).toContain("primitive-1");
        expect(insertEcho.insertedHtml).toContain("primitive-child");
        expect(await page.locator(PRIMITIVE_SELECTOR).count()).toBe(1);
        expect(await page.locator(PRIMITIVE_CHILD_SELECTOR).count()).toBe(1);
        expect(
          await page.locator(`#card > ${PRIMITIVE_SELECTOR}`).count(),
        ).toBe(1);
        expect(
          await page
            .locator(`${PRIMITIVE_SELECTOR} > ${PRIMITIVE_CHILD_SELECTOR}`)
            .count(),
        ).toBe(1);

        const insertEdit = pendingEditFromEcho(insertEcho);
        record(insertEdit);
        expect(queue()).toHaveLength(1);
        expect((queue()[0] as PendingLiveStructureEdit).insertedHtml).toContain(
          "primitive-1",
        );
        expect([undoStack.length, redoStack.length]).toEqual([1, 0]);

        // The inserted node exists in NO source file, so it has no subject
        // anchor — and Apply must still accept it on the anchor path alone.
        expect(insertEdit.sourceAnchor).toBeUndefined();
        expect(insertEdit.anchorSourceAnchor?.relPath).toBe(
          "app/routes/home.tsx",
        );
        expect(pendingStructureEditSourcePaths(insertEdit)).toEqual([
          "app/routes/home.tsx",
        ]);

        // ── 2. UNDO — the optimistic node comes back out ───────────────────
        const undoneInsert = undoStack.pop()!;
        redoStack.push(undoneInsert);
        await page.evaluate((requestId: string) => {
          window.postMessage(
            { type: "visual-structure-ack", requestId, applied: false },
            "*",
          );
        }, insertEcho.requestId);
        await page.waitForFunction(
          (selector: string) => !document.querySelector(selector),
          PRIMITIVE_SELECTOR,
        );
        expect(queue()).toHaveLength(0);
        expect([undoStack.length, redoStack.length]).toEqual([0, 1]);

        // ── 3. REDO — must re-issue the INSERT, not a move ─────────────────
        const redoCommand = pendingStructureRedoCommand(undoneInsert.edit);
        expect(redoCommand).toEqual({
          kind: "insert",
          html: insertEdit.insertedHtml,
        });
        if (redoCommand.kind !== "insert") throw new Error("unreachable");
        // What the move command redo used to send: the subject is gone, so the
        // bridge answers nothing and the redo reports success over an empty
        // document. Proves the command choice, not just its label, matters.
        await page.evaluate(
          ([subjectSelector, anchorSelector]) => {
            window.postMessage(
              {
                type: "runtime-structure-move",
                subjectSelector,
                subjectSourceId: "primitive-1",
                anchorSelector,
                anchorSourceId: "card",
                placement: "inside",
              },
              "*",
            );
          },
          [PRIMITIVE_SELECTOR, insertEdit.anchorSelector] as const,
        );
        await page.waitForTimeout(50);
        expect(await page.locator(PRIMITIVE_SELECTOR).count()).toBe(0);

        await page.evaluate(
          ([html, anchorSelector]) => {
            window.postMessage(
              {
                type: "runtime-structure-insert",
                requestId: 2,
                html,
                anchorSelector,
                anchorSourceId: "card",
                placement: "inside",
              },
              "*",
            );
          },
          [redoCommand.html, insertEdit.anchorSelector] as const,
        );
        const redoEcho = await nextStructureChange(page, 1);
        expect(await page.locator(PRIMITIVE_SELECTOR).count()).toBe(1);
        expect(await page.locator(PRIMITIVE_CHILD_SELECTOR).count()).toBe(1);
        record(pendingEditFromEcho(redoEcho));
        expect(queue()).toHaveLength(1);
        expect([undoStack.length, redoStack.length]).toEqual([1, 0]);

        // ── 4. DELETE — the pending insertion must not survive it ──────────
        await page.evaluate((selector: string) => {
          window.postMessage(
            {
              type: "delete-element",
              selector,
              selectorCandidates: [selector],
              requestId: "delete-1",
            },
            "*",
          );
        }, PRIMITIVE_SELECTOR);
        await page.waitForFunction(
          (selector: string) => !document.querySelector(selector),
          PRIMITIVE_SELECTOR,
        );
        const removalEdit: PendingLiveStructureEdit = {
          ...pendingEditFromEcho(redoEcho),
          sourceAnchor: undefined,
          anchorSelector: "",
          anchorSourceId: null,
          anchorSourceAnchor: undefined,
          placement: "after",
          insertedHtml: undefined,
          removed: true,
          requestId: "delete-1",
          updatedAt: Date.now() + 1,
        };
        record(removalEdit);
        // Insert + delete nets to zero in source: nothing to hand off, and
        // nothing that can put the node back.
        expect(queue()).toHaveLength(0);
        expect([undoStack.length, redoStack.length]).toEqual([2, 0]);

        // ── 5. APPLY — the handoff carries no resurrection ────────────────
        const structureEdits = queue().filter(
          (edit): edit is PendingLiveStructureEdit => edit.kind === "structure",
        );
        expect(structureEdits).toHaveLength(0);
        expect(
          formatPendingVisualStylePrompt({
            designId: "design-1",
            edits: [],
            liveEdits: queue(),
          }),
        ).not.toContain("primitive-1");

        // ── 6. UNDO the delete — history survived the supersede ───────────
        const undoneRemoval = undoStack.pop()!;
        redoStack.push(undoneRemoval);
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "visual-structure-ack",
              requestId: "delete-1",
              applied: false,
            },
            "*",
          );
        });
        await page.waitForSelector(PRIMITIVE_SELECTOR);
        await page.waitForSelector(PRIMITIVE_CHILD_SELECTOR);
        const restoredQueue = queue();
        expect(restoredQueue).toHaveLength(1);
        expect(
          (restoredQueue[0] as PendingLiveStructureEdit).insertedHtml,
        ).toContain("primitive-1");
        expect(
          pendingStructureEditSourcePaths(
            restoredQueue[0] as PendingLiveStructureEdit,
          ),
        ).toEqual(["app/routes/home.tsx"]);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "replaces a live element as one pending edit with undo and redo",
    { timeout: 60_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(
          FIXTURE.replace("</main>", "<aside>Unrelated sibling</aside></main>"),
        );
        await page.locator("#card").evaluate((element) => {
          Object.defineProperty(element, "__reactFiber$replace", {
            configurable: true,
            enumerable: true,
            value: {
              _debugStack: {
                stack:
                  "Error\n    at Card (http://127.0.0.1:7331/app/routes/home.tsx:12:5)",
              },
              return: null,
            },
          });
        });
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page.waitForSelector('[data-agent-native-edit-overlay="shield"]');
        await collectBridgeMessages(page);

        const replacementHtml =
          '<section data-agent-native-node-id="replacement" data-agent-native-layer-name="Replacement">Replacement</section>';
        await page.evaluate(
          ([html, anchorSelector]) => {
            window.postMessage(
              {
                type: "runtime-structure-insert",
                requestId: 10,
                html,
                anchorSelector,
                anchorSourceId: "card",
                placement: "before",
                replaceAnchor: true,
              },
              "*",
            );
          },
          [replacementHtml, ANCHOR_SELECTOR] as const,
        );

        const replaceEcho = await nextStructureChange(page, 0);
        expect(replaceEcho.replaced).toBe(true);
        expect(replaceEcho.replacementSnapshotHtml).toContain("Replacement");
        expect(replaceEcho.replacementSnapshotHtml).toContain(
          "Unrelated sibling",
        );
        expect(replaceEcho.replacementSnapshotHtml).not.toContain(
          'node-id="card"',
        );
        expect(replaceEcho.replacementSnapshotHtml).not.toContain("Copy");
        expect(replaceEcho.replacementSnapshotHtml).not.toContain("<script");
        expect(replaceEcho.replacementSnapshotHtml).not.toContain(
          "data-agent-native-edit-overlay",
        );
        expect(await page.locator(ANCHOR_SELECTOR).count()).toBe(0);
        expect(
          await page
            .locator('[data-agent-native-node-id="replacement"]')
            .count(),
        ).toBe(1);

        const replaceEdit = pendingEditFromEcho(replaceEcho);
        expect(replaceEdit.replaced).toBe(true);
        expect(replaceEdit.sourceId).toBe("card");
        expect(replaceEdit.replacementSnapshotSignature).toBe(
          runtimeStructureSnapshotSignature(
            replaceEcho.replacementSnapshotHtml!,
          ),
        );
        const rebuiltHtml = `<body><main>${replacementHtml}<aside>Unrelated sibling</aside></main></body>`;
        expect(verifyPendingStructureRuntime(rebuiltHtml, replaceEdit)).toEqual(
          { ok: true },
        );
        expect(
          verifyPendingStructureRuntime(
            rebuiltHtml.replace(
              "</main>",
              '<div class="changed">Changed original</div></main>',
            ),
            replaceEdit,
          ).ok,
        ).toBe(false);
        expect(
          verifyPendingStructureRuntime(
            rebuiltHtml.replace(
              replacementHtml,
              `<div class="changed">${replacementHtml}</div>`,
            ),
            replaceEdit,
          ).ok,
        ).toBe(false);
        expect(replaceEdit.sourceAnchor?.relPath).toBe("app/routes/home.tsx");
        expect(pendingStructureEditSourcePaths(replaceEdit)).toEqual([
          "app/routes/home.tsx",
        ]);
        expect(pendingStructureRedoCommand(replaceEdit)).toEqual({
          kind: "insert",
          html: replacementHtml,
          replaceAnchor: true,
        });
        const prompt = formatPendingVisualStylePrompt({
          designId: "design-1",
          edits: [],
          liveEdits: [replaceEdit],
        });
        expect(prompt).toContain('"replaced": true');
        expect(prompt).toContain('"operation": "replace"');

        await page.evaluate((requestId: string) => {
          window.postMessage(
            { type: "visual-structure-ack", requestId, applied: false },
            "*",
          );
        }, replaceEcho.requestId);
        await page.waitForSelector(ANCHOR_SELECTOR);
        expect(
          await page
            .locator('[data-agent-native-node-id="replacement"]')
            .count(),
        ).toBe(0);

        await page.locator("aside").evaluate((element) => {
          element.textContent = "Sibling changed before redo";
        });
        const redoCommand = pendingStructureRedoCommand(replaceEdit);
        if (redoCommand.kind !== "insert") throw new Error("unreachable");
        await page.evaluate(
          ([html, anchorSelector, replaceAnchor]) => {
            window.postMessage(
              {
                type: "runtime-structure-insert",
                requestId: 11,
                html,
                anchorSelector,
                anchorSourceId: "card",
                placement: "before",
                replaceAnchor,
              },
              "*",
            );
          },
          [
            redoCommand.html,
            ANCHOR_SELECTOR,
            redoCommand.replaceAnchor,
          ] as const,
        );
        const redoEcho = await nextStructureChange(page, 1);
        const redoEdit = pendingEditFromEcho(redoEcho);
        expect(redoEcho.replacementSnapshotHtml).toContain(
          "Sibling changed before redo",
        );
        expect(redoEcho.replacementSnapshotHtml).not.toContain(
          'node-id="card"',
        );
        expect(redoEdit.replacementSnapshotSignature).not.toBe(
          replaceEdit.replacementSnapshotSignature,
        );
        const redoneHtml = rebuiltHtml.replace(
          "Unrelated sibling",
          "Sibling changed before redo",
        );
        expect(verifyPendingStructureRuntime(redoneHtml, redoEdit)).toEqual({
          ok: true,
        });
        expect(verifyPendingStructureRuntime(rebuiltHtml, redoEdit).ok).toBe(
          false,
        );
        expect(await page.locator(ANCHOR_SELECTOR).count()).toBe(0);
        expect(
          await page
            .locator('[data-agent-native-node-id="replacement"]')
            .count(),
        ).toBe(1);
      } finally {
        await browser.close();
      }
    },
  );
});
