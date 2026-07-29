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
import {
  formatPendingVisualStylePrompt,
  mergePendingLiveNonStyleEdits,
  pendingLiveStructureEditsMatch,
  pendingStructureEditSourcePaths,
  pendingStructureRedoCommand,
  reactSourceAnchorForPendingEdit,
  type PendingLiveNonStyleEdit,
  type PendingLiveStructureEdit,
  type PendingLiveStructureUndoEntry,
} from "./pending-edits";

const SCREEN_ID = "live-screen";
const ANCHOR_SELECTOR = '[data-agent-native-node-id="card"]';
const PRIMITIVE_SELECTOR = '[data-agent-native-node-id="primitive-1"]';
const PRIMITIVE_CHILD_SELECTOR =
  '[data-agent-native-node-id="primitive-child"]';
const PRIMITIVE_HTML =
  '<div data-agent-native-node-id="primitive-1" style="width:40px;height:40px;background:#111">Primitive<div data-agent-native-node-id="primitive-child">Nested child</div></div>';

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", JSON.stringify(SCREEN_ID))
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false");
}

const FIXTURE = `<!doctype html><html><body>
  <main>
    <div id="card" data-agent-native-node-id="card" style="display:flex;width:300px;height:200px">
      <p data-agent-native-node-id="copy">Copy</p>
    </div>
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

/** Mirrors recordPendingLiveStructureEdit's mapping of a bridge echo. */
function pendingEditFromEcho(
  message: StructureChangeMessage,
): PendingLiveStructureEdit {
  if (message.replaced) {
    return {
      kind: "structure",
      screenId: SCREEN_ID,
      filename: "home",
      screenName: "Home",
      selector: message.anchorSelector,
      sourceId: message.anchorSourceId ?? null,
      sourceAnchor: reactSourceAnchorForPendingEdit({
        info: message.anchorPayload as never,
        id: message.anchorSourceId,
      }),
      anchorSelector: "",
      anchorSourceId: null,
      placement: message.placement,
      insertedHtml: message.insertedHtml,
      replaced: true,
      replacementSelector: message.selector,
      replacementSourceId: message.sourceId ?? null,
      requestId: message.requestId,
      updatedAt: Date.now(),
    };
  }
  return {
    kind: "structure",
    screenId: SCREEN_ID,
    filename: "home",
    screenName: "Home",
    selector: message.selector,
    sourceId: message.sourceId ?? null,
    sourceAnchor: reactSourceAnchorForPendingEdit({
      info: message.payload as never,
      id: message.sourceId,
    }),
    anchorSelector: message.anchorSelector,
    anchorSourceId: message.anchorSourceId ?? null,
    anchorSourceAnchor: reactSourceAnchorForPendingEdit({
      info: message.anchorPayload as never,
      id: message.anchorSourceId,
    }),
    placement: message.placement,
    dropMode: message.dropMode,
    insertedHtml: message.insertedHtml,
    requestId: message.requestId,
    updatedAt: Date.now(),
  };
}

describe("live insert lifecycle", () => {
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
        await page.setContent(FIXTURE);
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
        expect(await page.locator(ANCHOR_SELECTOR).count()).toBe(0);
        expect(
          await page
            .locator('[data-agent-native-node-id="replacement"]')
            .count(),
        ).toBe(1);

        const replaceEdit = pendingEditFromEcho(replaceEcho);
        expect(replaceEdit.replaced).toBe(true);
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
        await nextStructureChange(page, 1);
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
