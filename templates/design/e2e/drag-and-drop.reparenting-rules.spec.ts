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

async function persistedNodeParent(
  page: Page,
  designId: string,
  nodeId: string,
) {
  const html = await indexHtml(page, designId);
  return page.evaluate(
    ({ html, nodeId }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return document
        .querySelector(`[data-agent-native-node-id="${nodeId}"]`)
        ?.parentElement?.getAttribute("data-agent-native-node-id");
    },
    { html, nodeId },
  );
}

test.describe("reparenting rules", () => {
  test("dragging a flow child out places it directly above the exited frame in visible overlap and persists after reload", async ({
    page,
  }) => {
    const designId = await newDesign(
      page,
      `<!doctype html><html><body style="margin:0;min-height:700px">
        <main data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:40px;top:40px;width:700px;height:400px;background:#eee">
          <section data-an-primitive="frame" data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" style="position:absolute;left:0;top:0;display:flex;flex-direction:row;width:180px;height:140px;background:#ccc">
            <div data-agent-native-node-id="dragme" data-agent-native-layer-name="Dragged layer" style="width:80px;height:60px;background:#6366f1">Dragged layer</div>
          </section>
          <div data-agent-native-node-id="candidate" data-agent-native-layer-name="Candidate" style="position:absolute;left:220px;top:20px;width:100px;height:100px;background:#9ca3af">Candidate</div>
          <div data-agent-native-node-id="overlap" data-agent-native-layer-name="Later layer" style="position:absolute;left:340px;top:20px;width:120px;height:100px;background:#ef4444">Later layer</div>
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
        const parent = dragged?.parentElement;
        return {
          parent: dragged?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          order: Array.from(outer?.children ?? []).map((child) =>
            child.getAttribute("data-agent-native-node-id"),
          ),
          parentOrder: Array.from(parent?.children ?? []).map((child) =>
            child.getAttribute("data-agent-native-node-id"),
          ),
          style: dragged?.getAttribute("style"),
          position: dragged?.style.position ?? "",
          left: dragged?.style.left ?? "",
          top: dragged?.style.top ?? "",
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
        parentOrder: ["dragme"],
        style: expect.any(String),
        position: "",
        left: "",
        top: "",
      });
      const beforeDrop = await persistedStructure();

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

      const grabOffset = {
        x: draggedBox.width * 0.85,
        y: draggedBox.height / 2,
      };
      const start = {
        x: draggedBox.x + grabOffset.x,
        y: draggedBox.y + grabOffset.y,
      };
      const release = {
        x: nestedBox.x + nestedBox.width + 12,
        y: nestedBox.y + nestedBox.height / 2,
      };
      expect(release.x).toBeLessThan(outerBox.x + outerBox.width);
      expect(release.y).toBeLessThan(outerBox.y + outerBox.height);
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
      await expect.poll(persistedStructure).toEqual(beforeDrop);
      await page.mouse.up();

      await expect.poll(persistedStructure).toEqual({
        parent: "outer",
        order: ["nested", "dragme", "candidate", "overlap"],
        parentOrder: ["nested", "dragme", "candidate", "overlap"],
        style: expect.any(String),
        position: expect.any(String),
        left: expect.any(String),
        top: expect.any(String),
      });
      const afterDrop = await persistedStructure();

      const visibleStacking = await node(page, "dragme").evaluate((dragged) => {
        const document = dragged.ownerDocument;
        const nested = document.querySelector<HTMLElement>(
          '[data-agent-native-node-id="nested"]',
        );
        if (!nested) return null;
        const nestedBox = nested.getBoundingClientRect();
        const draggedBox = dragged.getBoundingClientRect();
        const left = Math.max(nestedBox.left, draggedBox.left);
        const top = Math.max(nestedBox.top, draggedBox.top);
        const right = Math.min(nestedBox.right, draggedBox.right);
        const bottom = Math.min(nestedBox.bottom, draggedBox.bottom);
        if (right <= left || bottom <= top) return null;
        const stack = document.elementsFromPoint(
          (left + right) / 2,
          (top + bottom) / 2,
        );
        const hitId = stack
          .map((element) =>
            element
              .closest<HTMLElement>("[data-agent-native-node-id]")
              ?.getAttribute("data-agent-native-node-id"),
          )
          .find((id) => id === "dragme" || id === "nested");
        return {
          overlapWidth: right - left,
          overlapHeight: bottom - top,
          hitId,
        };
      });
      expect(visibleStacking).not.toBeNull();
      expect(visibleStacking!.overlapWidth).toBeGreaterThan(0);
      expect(visibleStacking!.overlapHeight).toBeGreaterThan(0);
      expect(visibleStacking!.hitId).toBe("dragme");

      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(persistedStructure).toEqual(beforeDrop);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(persistedStructure).toEqual(afterDrop);

      await openEditor(page, designId);
      await expect.poll(persistedStructure).toEqual(afterDrop);
    } finally {
      await postAction(page, "delete-design", { id: designId }).catch(
        () => undefined,
      );
    }
  });

  test("an object smaller than a frame becomes its direct child when dropped in", async ({
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
    const directParent = await page
      .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
      .first()
      .contentFrame()
      .locator("body")
      .evaluate(() => {
        const child = document.querySelector(
          '[data-agent-native-node-id="box-a"]',
        );
        return child?.parentElement?.getAttribute("data-agent-native-node-id");
      });
    expect(
      directParent,
      'Figma: "If an object is smaller than a frame, we will make it a child of the frame."',
    ).toBe("frame-a");
  });

  test("holding Space while dragging keeps the object in its current parent", async ({
    page,
  }) => {
    const chipParent = () =>
      node(page, "chip-1").evaluate((chip) =>
        chip.parentElement?.getAttribute("data-agent-native-node-id"),
      );

    const controlId = await newDesign(page);
    let id: string | undefined;
    try {
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
      await expect.poll(chipParent).not.toBe("row");
      // The unmodified control proves this fixture can exercise reparenting.

      const retentionId = await newDesign(page);
      id = retentionId;
      await openEditor(page, retentionId);
      await selectViaTree(page, "Chip 1");
      chip = (await node(page, "chip-1").boundingBox())!;
      outside = (await node(page, "frame-a").boundingBox())!;

      await page.evaluate(() => {
        document.body.dataset.editorDragStarted = "false";
        window.addEventListener(
          "message",
          (event: MessageEvent) => {
            if (
              event.data?.type === "agent-native:editor-drag-state" &&
              event.data.active === true
            ) {
              document.body.dataset.editorDragStarted = "true";
            }
          },
          true,
        );
      });

      await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        chip.x + chip.width / 2 + 8,
        chip.y + chip.height / 2,
        { steps: 2 },
      );
      await expect(page.locator("body")).toHaveAttribute(
        "data-editor-drag-started",
        "true",
      );
      await expect.poll(chipParent).toBe("row");
      await page.keyboard.down("Space");
      await page.mouse.move(
        outside.x + outside.width / 2,
        outside.y + outside.height / 2,
        { steps: 20 },
      );
      await expect.poll(chipParent).toBe("row");
      await page.mouse.up();
      await page.keyboard.up("Space");
      await expect.poll(chipParent).toBe("row");
      await expect
        .poll(() => persistedNodeParent(page, retentionId, "chip-1"))
        .toBe("row");
      await page.reload();
      await expect
        .poll(chipParent, {
          message:
            'Figma: "When moving an object out of a frame\'s bounds, hold the Space bar to keep an object within the current parent."',
        })
        .toBe("row");
    } finally {
      await Promise.all(
        [controlId, id]
          .filter((designId): designId is string => Boolean(designId))
          .map((designId) =>
            postAction(page, "delete-design", { id: designId }).catch(
              () => undefined,
            ),
          ),
      );
    }
  });

  test("holding Space keeps a flow child in its nested auto-layout parent", async ({
    page,
  }) => {
    const nestedFixture = `<!doctype html><html><body style="margin:0;min-height:900px">
      <div data-agent-native-node-id="frame-a" data-agent-native-layer-name="Container" style="position:absolute;left:20px;top:60px;width:280px;height:160px;background:#1f2937"></div>
      <section data-an-primitive="frame" data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:360px;top:360px;width:300px;height:220px;display:flex;flex-direction:column;gap:8px;background:#374151">
        <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;flex-direction:row;gap:8px">
          <div data-agent-native-node-id="chip-1" data-agent-native-layer-name="Chip 1" style="width:80px;height:50px;background:#a855f7"></div>
          <div data-agent-native-node-id="chip-2" data-agent-native-layer-name="Chip 2" style="width:80px;height:50px;background:#ec4899"></div>
          <div data-agent-native-node-id="chip-3" data-agent-native-layer-name="Chip 3" style="width:80px;height:50px;background:#f59e0b"></div>
        </div>
      </section>
    </body></html>`;
    const controlId = await newDesign(page, nestedFixture);
    try {
      await openEditor(page, controlId);
      await selectViaTree(page, "Chip 1");
      const controlChip = (await node(page, "chip-1").boundingBox())!;
      const controlTarget = (await node(page, "frame-a").boundingBox())!;
      await page.mouse.move(
        controlChip.x + controlChip.width / 2,
        controlChip.y + controlChip.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        controlChip.x + controlChip.width / 2 + 8,
        controlChip.y + controlChip.height / 2,
        { steps: 2 },
      );
      await page.mouse.move(
        controlTarget.x + controlTarget.width / 2,
        controlTarget.y + controlTarget.height / 2,
        { steps: 20 },
      );
      await page.mouse.up();
      await expect
        .poll(() => persistedNodeParent(page, controlId, "chip-1"))
        .toBe("frame-a");
    } finally {
      await postAction(page, "delete-design", { id: controlId }).catch(
        () => undefined,
      );
    }

    const id = await newDesign(page, nestedFixture);
    try {
      await openEditor(page, id);
      await selectViaTree(page, "Chip 1");

      const chipParent = () =>
        node(page, "chip-1").evaluate((chip) =>
          chip.parentElement?.getAttribute("data-agent-native-node-id"),
        );

      await page.evaluate(() => {
        document.body.dataset.editorDragStarted = "false";
        window.addEventListener(
          "message",
          (event: MessageEvent) => {
            if (
              event.data?.type === "agent-native:editor-drag-state" &&
              event.data.active === true
            ) {
              document.body.dataset.editorDragStarted = "true";
            }
          },
          true,
        );
      });

      const chip = (await node(page, "chip-1").boundingBox())!;
      const outside = (await node(page, "frame-a").boundingBox())!;
      await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        chip.x + chip.width / 2 + 8,
        chip.y + chip.height / 2,
        { steps: 2 },
      );
      await expect(page.locator("body")).toHaveAttribute(
        "data-editor-drag-started",
        "true",
      );
      await page.keyboard.down("Space");
      await page.mouse.move(
        outside.x + outside.width / 2,
        outside.y + outside.height / 2,
        { steps: 20 },
      );
      await expect.poll(chipParent).toBe("row");
      await page.mouse.up();
      await page.keyboard.up("Space");
      await expect.poll(chipParent).toBe("row");
      await expect
        .poll(() => persistedNodeParent(page, id, "chip-1"))
        .toBe("row");
      await page.reload();
      await expect
        .poll(chipParent, {
          message:
            'Figma: "When moving an object out of a frame\'s bounds, hold the Space bar to keep an object within the current parent."',
        })
        .toBe("row");
    } finally {
      await postAction(page, "delete-design", { id }).catch(() => undefined);
    }
  });

  test("releasing Space before the drop restores normal reparenting", async ({
    page,
  }) => {
    const id = await newDesign(page);
    try {
      await openEditor(page, id);
      await selectViaTree(page, "Chip 1");
      const chipParent = () =>
        node(page, "chip-1").evaluate((chip) =>
          chip.parentElement?.getAttribute("data-agent-native-node-id"),
        );
      const chip = (await node(page, "chip-1").boundingBox())!;
      const outside = (await node(page, "frame-a").boundingBox())!;

      await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        chip.x + chip.width / 2 + 8,
        chip.y + chip.height / 2,
        { steps: 2 },
      );
      await page.keyboard.down("Space");
      await page.mouse.move(
        outside.x + outside.width / 2,
        outside.y + outside.height / 2,
        { steps: 20 },
      );
      await expect.poll(chipParent).toBe("row");
      await page.keyboard.up("Space");
      await page.mouse.up();

      await expect.poll(chipParent).toBe("frame-a");
      await expect
        .poll(() => persistedNodeParent(page, id, "chip-1"))
        .toBe("frame-a");
      await page.reload();
      await expect.poll(chipParent).toBe("frame-a");
    } finally {
      await postAction(page, "delete-design", { id }).catch(() => undefined);
    }
  });
});
