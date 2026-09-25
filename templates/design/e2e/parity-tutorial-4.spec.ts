import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { gotoEditor } from "./helpers";

/**
 * Figma tutorial parity — "Design a search icon"
 * https://help.figma.com/hc/en-us/articles/18886645808023-Design-a-search-icon
 * (figma-interaction-spec.md Part 2 §4)
 *
 * Recreates the 8-step tutorial as real editor gestures (tool hotkeys,
 * shift-drag, pen clicks, typed inspector values, shift-select + group,
 * align, layer rename), asserting after every step. Also covers 2-3 board
 * (overview-canvas, outside-any-screen) steps and one element crossing the
 * screen boundary, per the finder preamble.
 *
 * Figma has no boolean "Union selection" operation in this app (§6) — that
 * step is recorded as a finding and the closest equivalent (Group, ⌘G) is
 * used to continue the tutorial.
 */

let designId: string;
let baseURLForActions: string;

const ICON_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Search icon</title></head>
  <body style="margin:0;min-width:900px;min-height:700px;background:#ffffff">
    <div
      data-agent-native-node-id="icon-grid"
      data-agent-native-layer-name="icon grid"
      style="position:absolute;left:600px;top:40px;width:24px;height:24px;outline:1px dashed #d4d4d8"
    ></div>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await request.post(
    `${baseURLForActions}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(`${name} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function getAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value != null) params.append(key, String(value));
  }
  const res = await request.get(
    `${baseURLForActions}/_agent-native/actions/${name}?${params}`,
  );
  if (!res.ok()) {
    throw new Error(`${name} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

test.beforeEach(async ({ page }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  const created = await postAction(page.request, "create-design", {
    title: "E2E Search Icon Tutorial",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error(`create-design returned no id: ${created}`);
  await postAction(page.request, "create-file", {
    designId,
    filename: "index.html",
    content: ICON_SCREEN,
    fileType: "html",
  });
  await gotoEditor(page, designId);
});

test.use({ viewport: { width: 1440, height: 1000 } });

test.afterEach(async ({ page }) => {
  if (!designId) return;
  await postAction(page.request, "delete-design", { id: designId }).catch(
    () => {},
  );
  designId = "";
});

// ── Shared helpers (copied/trimmed from canvas-tools.spec.ts patterns) ────

function toolButton(page: Page, name: string): Locator {
  return page.locator(`button[aria-label="${name}"]`).first();
}

function screenShell(page: Page, name = "Home"): Locator {
  return page.locator("[data-screen-shell]").filter({ hasText: name }).first();
}

function homeScreenCard(page: Page): Locator {
  return screenShell(page).locator("[data-screen-card]");
}

function selectedLayerRow(page: Page): Locator {
  return page.locator('[role="treeitem"][aria-selected="true"]').first();
}

interface DesignFileRecord {
  id: string;
  filename: string;
  content: string;
  fileType?: string;
}

async function designFiles(page: Page): Promise<DesignFileRecord[]> {
  const result = await getAction(page.request, "get-design", { id: designId });
  return (result.files ?? []).map((file: any) => ({
    id: String(file.id ?? ""),
    filename: String(file.filename ?? ""),
    content: String(file.content ?? ""),
    fileType: typeof file.fileType === "string" ? file.fileType : undefined,
  }));
}

async function fileContent(page: Page, filename: string): Promise<string> {
  const file = (await designFiles(page)).find(
    (candidate) => candidate.filename === filename,
  );
  if (!file) throw new Error(`File not found: ${filename}`);
  return file.content;
}

async function primitiveCount(
  page: Page,
  filename: string,
  kind: string,
): Promise<number> {
  const content = await fileContent(page, filename);
  return page.evaluate(
    ({ html, primitiveKind }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return doc.querySelectorAll(`[data-an-primitive="${primitiveKind}"]`)
        .length;
    },
    { html: content, primitiveKind: kind },
  );
}

async function primitiveStyle(
  page: Page,
  filename: string,
  kind: string,
): Promise<{
  left: number;
  top: number;
  width: number;
  height: number;
  style: string;
} | null> {
  const content = await fileContent(page, filename);
  return page.evaluate(
    ({ html, primitiveKind }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const el = doc.querySelector<HTMLElement>(
        `[data-an-primitive="${primitiveKind}"]`,
      );
      if (!el) return null;
      return {
        left: Number.parseFloat(el.style.left),
        top: Number.parseFloat(el.style.top),
        width: Number.parseFloat(el.style.width),
        height: Number.parseFloat(el.style.height),
        style: el.getAttribute("style") ?? "",
      };
    },
    { html: content, primitiveKind: kind },
  );
}

async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options?: { shift?: boolean },
): Promise<void> {
  await page.waitForTimeout(200);
  if (options?.shift) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  if (options?.shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(200);
}

function inspectorSection(page: Page, title: RegExp | string): Locator {
  const heading =
    typeof title === "string"
      ? page.getByRole("heading", { name: title, exact: true })
      : page.getByRole("heading", { name: title });
  return page.locator("section").filter({ has: heading }).first();
}

// While the Stroke section is empty, its clickable title and its "+" both
// carry aria-label "Add stroke", so a role/name query matches two buttons.
function addStrokeButton(section: Locator): Locator {
  return section
    .locator('[data-inspector-action-rail] button[aria-label="Add stroke"]')
    .first();
}

function layerTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string): Locator {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

function renameInput(page: Page): Locator {
  return page.getByRole("textbox", { name: /rename/i });
}

const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
const groupShortcut = process.platform === "darwin" ? "Meta+g" : "Control+g";

// ── Steps 1-8: build the icon inside the "Search icon" screen ─────────────

test("tutorial 4 — design a search icon, step by step", async ({ page }) => {
  const card = await homeScreenCard(page).boundingBox();
  if (!card) throw new Error("no screen card box");

  // Step 1: Press O, Shift-drag a lens near the top-right of the icon grid.
  await test.step("O selects the Ellipse tool; Shift-drag draws an aspect-locked ellipse", async () => {
    await page.keyboard.press("o");
    await expect(toolButton(page, "Ellipse")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const start = {
      x: card.x + card.width * 0.6,
      y: card.y + card.height * 0.08,
    };
    await dragBetween(
      page,
      start,
      { x: start.x + 34, y: start.y + 61 }, // deliberately non-square input
      { shift: true },
    );
    await expect
      .poll(() => primitiveCount(page, "index.html", "ellipse"), {
        timeout: 20_000,
      })
      .toBe(1);
    const ellipse = await primitiveStyle(page, "index.html", "ellipse");
    expect(
      ellipse,
      "ellipse primitive must exist after the drag",
    ).not.toBeNull();
    // Shift constrains the drag to a 1:1 aspect ratio — this is the concrete
    // property that must change; a click-only drag (no shift) would also
    // create a shape, but not necessarily a square one.
    expect(
      Math.abs((ellipse!.width ?? 0) - (ellipse!.height ?? 0)),
      `shift-drag must lock width==height, got ${ellipse!.width}x${ellipse!.height}`,
    ).toBeLessThan(1);
    await expect(selectedLayerRow(page)).toContainText(/Ellipse/i);
  });

  // Typed inspector values: pin the lens to the tutorial's exact 16x16.
  await test.step("typed W/H inspector fields resize the lens to 16x16", async () => {
    const wField = page.getByLabel("W size in pixels");
    const hField = page.getByLabel("H size in pixels");
    await expect(wField).toBeVisible({ timeout: 10_000 });
    await wField.fill("16");
    await wField.press("Enter");
    await hField.fill("16");
    await hField.press("Enter");
    await expect
      .poll(async () => primitiveStyle(page, "index.html", "ellipse"))
      .toEqual(expect.objectContaining({ width: 16, height: 16 }));
  });

  // Step 2: Add stroke weight 2, remove fill.
  await test.step("Add stroke sets weight 2; Remove layer on Fill clears the fill", async () => {
    const strokeSection = inspectorSection(page, /^Stroke$/i);
    await addStrokeButton(strokeSection).click();
    const weightField = strokeSection.getByLabel("Weight").first();
    await expect(weightField).toBeVisible({ timeout: 10_000 });
    await weightField.fill("2");
    await weightField.press("Enter");

    // search-icon-2 (fixed): a freshly drawn shape's committed `background`
    // shorthand wasn't recognized as `backgroundColor` once the inspector's
    // selection was refreshed from source (cssStyleAliases only aliased
    // hyphenated longhands, never expanded a shorthand) — see
    // code-layer-state.ts's cssStyleAliases. The inspector read no fill at
    // all, so there was no removable row to match Figma's always-present
    // solid fill layer on a new shape.
    const fillSection = inspectorSection(page, /^Fill$/i);
    await expect(
      fillSection.locator('button[aria-label="Remove layer"]'),
      "a freshly drawn shape must start with one removable Fill layer row, matching Figma",
    ).toHaveCount(1);
    await fillSection.locator('button[aria-label="Remove layer"]').click();

    await expect
      .poll(async () => {
        const ellipse = await primitiveStyle(page, "index.html", "ellipse");
        return ellipse?.style ?? "";
      })
      .toMatch(/border-width:\s*2px/);
    await expect
      .poll(async () => {
        const ellipse = await primitiveStyle(page, "index.html", "ellipse");
        return ellipse?.style ?? "";
      })
      .not.toMatch(/background-color:\s*rgb/);
  });

  // Step 4: Press P, click two points 4px apart (a straight handle), Enter.
  await test.step("P selects the Pen tool; two clicks + Enter commit a Vector handle", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("p");
    await expect(toolButton(page, "Pen")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.waitForTimeout(150);
    const anchor = {
      x: card.x + card.width * 0.58,
      y: card.y + card.height * 0.1,
    };
    await page.mouse.click(anchor.x, anchor.y);
    await page.mouse.click(anchor.x, anchor.y + 4);
    await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-pen-path-overlay]")).toHaveCount(0);
    await expect(selectedLayerRow(page)).toContainText(/Vector/i);
  });

  // Step 5: stroke weight 2 on the handle; Figma's "endpoints: Round" cap.
  await test.step("stroke weight 2 applies to the handle; Round line-cap has no control (finding)", async () => {
    const strokeSection = inspectorSection(page, /^Stroke$/i);
    await addStrokeButton(strokeSection).click();
    const weightField = strokeSection.getByLabel("Weight").first();
    await expect(weightField).toBeVisible({ timeout: 10_000 });
    await weightField.fill("2");
    await weightField.press("Enter");
    await expect
      .poll(async () => {
        const content = await fileContent(page, "index.html");
        return page.evaluate((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          const svg = doc.querySelector(
            'svg[data-agent-native-layer-name="Vector"]',
          );
          if (!svg) throw new Error("no Vector svg in index.html");
          // Vector paint (stroke, stroke-width) lives on the painted element
          // inside the svg, not on the svg's own geometry style.
          return [svg, ...Array.from(svg.querySelectorAll("*"))]
            .map(
              (element) =>
                `${element.getAttribute("style") ?? ""};stroke-width:${element.getAttribute("stroke-width") ?? ""}`,
            )
            .join(";");
        }, content);
      })
      // Adding a stroke writes 1px; only the typed weight produces 2px. A bare
      // /2px/ also matched geometry such as top:102px.
      .toMatch(/(?:^|;)\s*stroke-width:\s*2(?:px)?(?:;|$)/);
    // No cap/endpoint control exists anywhere in the Stroke section.
    const capControl = strokeSection.getByRole("button", { name: /round/i });
    await expect(capControl).toHaveCount(0);
  });

  // Step 6: Shift-select lens + handle, "Union selection" — no equivalent.
  // Continue with the closest equivalent: Group (Cmd/Ctrl+G).
  await test.step("Union selection does not exist (finding); Cmd+G groups instead, one undo restores both layers", async () => {
    await layerRowButton(page, "Ellipse").click();
    await layerRowButton(page, "Vector").click({ modifiers: ["Shift"] });
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);

    const preGroupEllipseId = await layerRowButton(
      page,
      "Ellipse",
    ).getAttribute("data-layer-node-id");
    const preGroupVectorId = await layerRowButton(page, "Vector").getAttribute(
      "data-layer-node-id",
    );
    if (!preGroupEllipseId || !preGroupVectorId) {
      throw new Error(
        `expected Ellipse/Vector layer rows to carry data-layer-node-id, got ${preGroupEllipseId}/${preGroupVectorId}`,
      );
    }

    const preGroupNodeIds = await page.evaluate(
      (html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return ["Ellipse", "Vector"].map((name) => {
          const node = doc.querySelector(
            `[data-agent-native-layer-name="${name}"]`,
          );
          const id = node?.getAttribute("data-agent-native-node-id");
          if (!id) throw new Error(`${name} has no data-agent-native-node-id`);
          return { id, name };
        });
      },
      await fileContent(page, "index.html"),
    );

    const unionButton = page.getByRole("button", { name: /union/i });
    await expect(
      unionButton,
      "no 'Union selection' affordance exists anywhere in the editor chrome",
    ).toHaveCount(0);

    await page.keyboard.press(groupShortcut);
    await expect
      .poll(async () => {
        const content = await fileContent(page, "index.html");
        return page.evaluate((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return doc.querySelectorAll('[data-agent-native-layer-name="Group"]')
            .length;
        }, content);
      })
      .toBe(1);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(1);
    await expect(selectedLayerRow(page)).toContainText(/Group/i);
    const groupChildren = async () => {
      const html = await fileContent(page, "index.html");
      return page.evaluate((source) => {
        const doc = new DOMParser().parseFromString(source, "text/html");
        const group = doc.querySelector(
          '[data-agent-native-layer-name="Group"]',
        );
        if (!group) throw new Error("no Group in index.html");
        return Array.from(group.children)
          .map((child) => ({
            id: child.getAttribute("data-agent-native-node-id"),
            name: child.getAttribute("data-agent-native-layer-name"),
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      }, html);
    };
    expect(
      await groupChildren(),
      "Cmd+G must wrap the two original nodes, not re-minted copies",
    ).toEqual(preGroupNodeIds);

    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => primitiveCount(page, "index.html", "ellipse"))
      .toBe(1);
    await expect
      .poll(async () => {
        const c = await fileContent(page, "index.html");
        return page.evaluate((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return doc.querySelectorAll('[data-agent-native-layer-name="Group"]')
            .length;
        }, c);
      })
      .toBe(0);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);
    const selectedLayerNames = await page
      .locator(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button] span[title]',
      )
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute("title"))
          .filter((name): name is string => Boolean(name))
          .sort(),
      );
    expect(selectedLayerNames).toEqual(["Ellipse", "Vector"]);
    const selectedLayerIdsAfterUndo = await page
      .locator(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
      )
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute("data-layer-node-id"))
          .filter((id): id is string => Boolean(id))
          .sort(),
      );
    expect(selectedLayerIdsAfterUndo).toEqual(
      [preGroupEllipseId, preGroupVectorId].sort(),
    );
    await expect(layerRowButton(page, "Vector")).toHaveAttribute(
      "data-layer-node-id",
      preGroupVectorId,
    );
    await expect(layerRowButton(page, "Ellipse")).toHaveAttribute(
      "data-layer-node-id",
      preGroupEllipseId,
    );

    // Group again straight from the selection undo restored, so later steps
    // have it; it must wrap the same two original nodes.
    await page.keyboard.press(groupShortcut);
    await expect
      .poll(async () => {
        const c = await fileContent(page, "index.html");
        return page.evaluate((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return doc.querySelectorAll('[data-agent-native-layer-name="Group"]')
            .length;
        }, c);
      })
      .toBe(1);
    expect(await groupChildren()).toEqual(preGroupNodeIds);
  });

  // Step 7: align the merged shape centered "within equal padding". A
  // single top-level object whose parent is the document root correctly
  // disables Align (verified below) — matches Figma, where a lone
  // root-level object with no parent frame has nothing to align against.
  // The layers-panel drag needed to reparent the group into a real frame
  // first is covered by the dedicated layers-panel parity spec, so here we
  // exercise the other branch `align-selection.ts` actually offers a
  // multi-object selection: two-or-more objects align to their own combined
  // bounding box and never need a parent, which is exactly the shape of
  // this tutorial step before the group existed (lens + handle).
  await test.step("Align disables for a lone root-level group (no parent frame); a 2-object selection aligns to its own bbox instead", async () => {
    await layerRowButton(page, "Group").click();
    await expect(
      page.getByRole("button", { name: "Align horizontal centers" }),
    ).toBeDisabled({ timeout: 5_000 });

    // Ungroup back to the two layers to exercise the working alignment path.
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+g" : "Control+Shift+g",
    );
    await expect
      .poll(async () => primitiveCount(page, "index.html", "ellipse"))
      .toBe(1);

    await layerRowButton(page, "Ellipse").click();
    await layerRowButton(page, "Vector").click({ modifiers: ["Shift"] });
    const alignV = page.getByRole("button", { name: "Align vertical centers" });
    await expect(alignV).toBeEnabled({ timeout: 5_000 });
    const beforeEllipse = await primitiveStyle(page, "index.html", "ellipse");
    const beforeVector = await primitiveStyle(page, "index.html", "path");
    await alignV.click();
    await page.waitForTimeout(400);
    const afterEllipse = await primitiveStyle(page, "index.html", "ellipse");
    const afterVector = await primitiveStyle(page, "index.html", "path");
    expect(afterEllipse, "ellipse must still exist after align").not.toBeNull();
    expect(afterVector, "vector must still exist after align").not.toBeNull();
    // The concrete property that must change: both members' vertical
    // centers now coincide (Figma's "align vertical centers" on a
    // multi-selection). Before the click they generally do not.
    const beforeCenterDelta = Math.abs(
      beforeEllipse!.top +
        beforeEllipse!.height / 2 -
        (beforeVector!.top + beforeVector!.height / 2),
    );
    const afterCenterDelta = Math.abs(
      afterEllipse!.top +
        afterEllipse!.height / 2 -
        (afterVector!.top + afterVector!.height / 2),
    );
    expect(
      afterCenterDelta,
      `vertical centers must coincide after align (was ${beforeCenterDelta}px apart, now ${afterCenterDelta}px apart)`,
    ).toBeLessThan(1);

    // Re-group so step 8 (rename) has the expected "Group" layer again.
    await layerRowButton(page, "Ellipse").click();
    await layerRowButton(page, "Vector").click({ modifiers: ["Shift"] });
    await page.keyboard.press(groupShortcut);
    await expect
      .poll(async () => {
        const c = await fileContent(page, "index.html");
        return page.evaluate((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return doc.querySelectorAll('[data-agent-native-layer-name="Group"]')
            .length;
        }, c);
      })
      .toBe(1);
  });

  // Step 8: rename the frame/group "search-icon".
  await test.step("double-click rename in the layers panel renames the group to search-icon", async () => {
    await layerRowButton(page, "Group").dblclick({ force: true });
    const input = renameInput(page);
    await expect(input).toBeVisible();
    await input.fill("search-icon");
    await input.press("Enter");
    await expect(renameInput(page)).toHaveCount(0);
    await expect(layerRowButton(page, "search-icon")).toBeVisible();
    await expect
      .poll(
        async () => {
          const content = await fileContent(page, "index.html");
          return page.evaluate((html) => {
            const doc = new DOMParser().parseFromString(html, "text/html");
            return Boolean(
              doc.querySelector('[data-agent-native-layer-name="search-icon"]'),
            );
          }, content);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});

// ── Overview canvas, outside any screen (2 steps) + one boundary crossing ──

test("tutorial 4 (overview) — a board rectangle drawn, renamed, and dragged into the screen", async ({
  page,
}) => {
  const cardBox = await homeScreenCard(page).boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  const boardStart = { x: cardBox.x + cardBox.width + 120, y: cardBox.y + 60 };

  // Overview step 1: draw a board rectangle to the right of the screen with
  // the Rectangle tool, shift-locked to a square (outside any screen).
  await test.step("R + shift-drag on the empty overview canvas creates a square board object, not a screen element", async () => {
    await page.keyboard.press("r");
    await expect(toolButton(page, "Rectangle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await dragBetween(
      page,
      boardStart,
      {
        x: boardStart.x + 70,
        y: boardStart.x - boardStart.x + boardStart.y + 111,
      },
      { shift: true },
    );
    await expect
      .poll(() => primitiveCount(page, "__board__.html", "rectangle"), {
        timeout: 20_000,
      })
      .toBe(1);
    // It must NOT have landed inside the screen's own file.
    expect(await primitiveCount(page, "index.html", "rectangle")).toBe(0);
    const boardRect = await primitiveStyle(page, "__board__.html", "rectangle");
    expect(boardRect).not.toBeNull();
    expect(
      Math.abs((boardRect!.width ?? 0) - (boardRect!.height ?? 0)),
    ).toBeLessThan(1);
  });

  // Overview step 2: rename the board rectangle from the layers panel.
  await test.step("double-click rename retitles the board rectangle", async () => {
    await layerRowButton(page, "Rectangle").dblclick({ force: true });
    const input = renameInput(page);
    await expect(input).toBeVisible();
    await input.fill("board-sticker");
    await input.press("Enter");
    await expect(layerRowButton(page, "board-sticker")).toBeVisible();
  });

  // Boundary crossing: drag the board object INTO the screen.
  await test.step("dragging the board object into the screen reparents it into the screen's HTML, off the board", async () => {
    // Read the rectangle's real on-canvas box straight from the board
    // iframe's own content frame (its coordinate space already accounts for
    // overview zoom), rather than recomputing it from inline style + zoom.
    const rectLocator = page
      .locator("[data-board-surface-layer] iframe")
      .first()
      .contentFrame()
      .locator('[data-an-primitive="rectangle"]')
      .first();
    const rectBox = await rectLocator.boundingBox();
    if (!rectBox) throw new Error("no board rectangle box");

    await toolButton(page, "Move").click();
    await page.waitForTimeout(200);
    const from = {
      x: rectBox.x + rectBox.width / 2,
      y: rectBox.y + rectBox.height / 2,
    };
    const to = {
      x: cardBox.x + cardBox.width * 0.3,
      y: cardBox.y + cardBox.height * 0.3,
    };
    await dragBetween(page, from, to);

    await expect
      .poll(() => primitiveCount(page, "__board__.html", "rectangle"), {
        timeout: 20_000,
      })
      .toBe(0);
    await expect
      .poll(() => primitiveCount(page, "index.html", "rectangle"), {
        timeout: 20_000,
      })
      .toBe(1);
  });
});
