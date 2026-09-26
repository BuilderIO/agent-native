import { expect, test, type Page } from "@playwright/test";

import {
  setBaseURL,
  newDesign,
  indexHtml,
  node,
  openEditor,
  postAction,
  selectViaTree,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test.describe("reparenting rules", () => {
  test("dragging a flow child out of a frame stacks it above that frame and persists after reload", async ({
    page,
  }) => {
    const designId = await newDesign(
      page,
      `<!doctype html><html><body style="margin:0;min-height:700px">
        <main data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:40px;top:40px;width:700px;height:400px;display:flex;flex-direction:row;align-items:flex-start;gap:16px;background:#eee">
          <section data-an-primitive="frame" data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" style="display:flex;flex-direction:row;width:180px;height:140px;background:#ccc">
            <div data-agent-native-node-id="dragme" data-agent-native-layer-name="Dragged layer" style="width:80px;height:60px;background:#6366f1">Dragged layer</div>
          </section>
          <div data-agent-native-node-id="candidate" data-agent-native-layer-name="Candidate" style="width:100px;height:100px;background:#9ca3af">Candidate</div>
          <div data-agent-native-node-id="overlap" data-agent-native-layer-name="Later layer" style="width:120px;height:100px;background:#ef4444">Later layer</div>
        </main>
      </body></html>`,
    );

    const persistedStructure = async () => {
      const html = await indexHtml(page, designId);
      return page.evaluate((source) => {
        const document = new DOMParser().parseFromString(source, "text/html");
        const element = (id: string) =>
          document.querySelector<HTMLElement>(
            `[data-agent-native-node-id="${id}"]`,
          );
        const outer = element("outer");
        const dragged = element("dragme");
        return {
          parent: dragged?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          order: Array.from(outer?.children ?? []).map((child) =>
            child.getAttribute("data-agent-native-node-id"),
          ),
        };
      }, html);
    };

    try {
      await openEditor(page, designId);
      await page.evaluate(() => {
        const host = window as Window & {
          __g4DragStates?: Array<{
            active?: boolean;
            preview?: {
              phase?: string;
              sourceId?: string;
              anchorId?: string;
              placement?: string;
              insert?: boolean;
            };
          }>;
        };
        host.__g4DragStates = [];
        window.addEventListener(
          "message",
          (event: MessageEvent) => {
            if (event.data?.type !== "agent-native:editor-drag-state") return;
            host.__g4DragStates?.push(event.data);
          },
          true,
        );
      });
      await expect.poll(persistedStructure).toEqual({
        parent: "nested",
        order: ["nested", "candidate", "overlap"],
      });

      const dragged = node(page, "dragme");
      const nested = node(page, "nested");
      const candidate = node(page, "candidate");
      const outer = node(page, "outer");
      const [draggedBox, nestedBox, candidateBox, outerBox] = await Promise.all(
        [
          dragged.boundingBox(),
          nested.boundingBox(),
          candidate.boundingBox(),
          outer.boundingBox(),
        ],
      );
      if (!draggedBox || !nestedBox || !candidateBox || !outerBox) {
        throw new Error("G4 fixture nodes need rendered bounds before drag");
      }

      const start = {
        x: draggedBox.x + draggedBox.width / 2,
        y: draggedBox.y + draggedBox.height / 2,
      };
      const release = {
        x: outerBox.x + outerBox.width - 20,
        y: outerBox.y + outerBox.height / 2,
      };
      const crossedPath = {
        x: candidateBox.x + candidateBox.width / 2,
        y: candidateBox.y + candidateBox.height / 2,
      };
      expect(
        crossedPath.x < nestedBox.x ||
          crossedPath.x > nestedBox.x + nestedBox.width,
      ).toBe(true);

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(crossedPath.x, crossedPath.y, { steps: 8 });
      await page.mouse.move(start.x, start.y, { steps: 8 });
      await page.mouse.move(release.x, release.y, { steps: 12 });

      // Figma places a child dropped in the receiving parent's empty area
      // immediately after the frame it left, before later overlapping siblings.
      // Assert that live insertion target before mouseup commits it.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const host = window as Window & {
              __g4DragStates?: Array<{
                active?: boolean;
                preview?: {
                  phase?: string;
                  sourceId?: string;
                  anchorId?: string;
                  placement?: string;
                  insert?: boolean;
                };
              }>;
            };
            const previews = host.__g4DragStates?.filter(
              (state) => state.preview?.phase === "preview",
            );
            return previews?.[previews.length - 1] ?? null;
          }),
        )
        .toMatchObject({
          active: true,
          preview: {
            phase: "preview",
            sourceId: "dragme",
            anchorId: "nested",
            placement: "after",
            insert: true,
          },
        });
      // Reparenting commits on mouseup; the source tree remains stable while
      // the pointer leaves and re-enters the frame during the held gesture.
      await expect.poll(persistedStructure).toEqual({
        parent: "nested",
        order: ["nested", "candidate", "overlap"],
      });
      await page.mouse.up();

      await expect.poll(persistedStructure).toEqual({
        parent: "outer",
        order: ["nested", "dragme", "candidate", "overlap"],
      });

      await openEditor(page, designId);
      await expect.poll(persistedStructure).toEqual({
        parent: "outer",
        order: ["nested", "dragme", "candidate", "overlap"],
      });
    } finally {
      await postAction(page, "delete-design", { id: designId }).catch(
        () => undefined,
      );
    }
  });

  test("an object smaller than a frame becomes its child when dropped in", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Box A");
    const box = (await node(page, "box-a").boundingBox())!;
    const target = (await node(page, "frame-a").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await page.waitForTimeout(2500); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    // Scope to the authored screen iframe, not `.first()`: a canvas Move
    // drag always posts cross-screen claim messages (even within one
    // screen) and that mounts a board-surface iframe ahead of it — same
    // `[data-design-preview-iframe]` attribute, no `data-screen-iframe-id`,
    // and none of this screen's own content. See `node()` in
    // e2e/drag-and-drop.shared.ts, which guards against the same trap.
    const nested = await page
      .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const parent = document.querySelector(
          '[data-agent-native-node-id="frame-a"]',
        );
        const child = document.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        return !!parent && !!child && parent.contains(child);
      });
    expect(
      nested,
      'Figma: "If an object is smaller than a frame, we will make it a child of the frame."',
    ).toBe(true);
  });

  test("holding Space while dragging keeps the object in its current parent", async ({
    page,
  }) => {
    const inRow = (target: Page) =>
      target
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const row = document.querySelector(
            '[data-agent-native-node-id="row"]',
          );
          const chip = document.querySelector(
            '[data-agent-native-node-id="chip-1"]',
          );
          return !!row && !!chip && row.contains(chip);
        });

    // The control drag mutates the document, so the Space drag needs its own
    // pristine design rather than the one the control already reparented.
    const controlId = await newDesign(page);
    await openEditor(page, controlId);
    await selectViaTree(page, "Chip 1");
    let chip = (await node(page, "chip-1").boundingBox())!;
    let outside = (await node(page, "frame-a").boundingBox())!;
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
      { steps: 18 },
    );
    await page.mouse.up();
    await page.waitForTimeout(2200); // e2e-harness-ignore moved verbatim by the drag-and-drop split
    // peer PR (hotkeys) owns the Space-modifier retain-parent behavior; if an
    // unmodified drag also fails to reparent, the assertion below fails for
    // that real reason instead of silently skipping.

    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Chip 1");
    chip = (await node(page, "chip-1").boundingBox())!;
    outside = (await node(page, "frame-a").boundingBox())!;

    // The retain-parent flag is set by a keydown listener on the IFRAME
    // document; page.keyboard sends to the host, where it only pans.
    const previewBody = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body");
    const spaceKey = (type: "keydown" | "keyup") =>
      previewBody.evaluate((_b, t) => {
        document.dispatchEvent(
          new KeyboardEvent(t, {
            key: " ",
            code: "Space",
            bubbles: true,
            cancelable: true,
          }),
        );
      }, type);

    await spaceKey("keydown");
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await spaceKey("keyup");
    await page.waitForTimeout(2500); // e2e-harness-ignore moved verbatim by the drag-and-drop split

    expect(
      await inRow(page),
      "Figma: \"When moving an object out of a frame's bounds, hold the Space bar to keep " +
        'an object within the current parent."',
    ).toBe(true);
  });
});
