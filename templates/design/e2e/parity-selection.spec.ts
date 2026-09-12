import { expect, test, type Locator, type Page } from "@playwright/test";

import { canvasZoom, expandAllLayers } from "./helpers";

/**
 * Figma parity — Selection (spec §1 + Part 3 resolutions).
 *
 * Covers: click selects the outermost child of the current container (not the
 * deep child — Logan's report), double-click drills in, cmd+click deep-selects,
 * shift+click toggles, Esc backs out a level, Enter descends, empty-canvas
 * click deselects, marquee selects everything it INTERSECTS (not full
 * enclosure), cmd+marquee reaches nested children, Tab/Shift+Tab cycles
 * siblings — across elements inside a screen and board objects on the
 * overview canvas.
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control";

// A container with two children, plus two loose top-level siblings, mirrors
// the shape a real Figma file uses to test "click hits the container, not
// the child": Card is the current container; Kid A / Kid B are its children.
const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Selection parity</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:40px;top:40px;width:280px;height:200px;background:#111827">
      <div data-agent-native-node-id="kid-a" data-agent-native-layer-name="Kid A"
           style="position:absolute;left:16px;top:16px;width:110px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="kid-b" data-agent-native-layer-name="Kid B"
           style="position:absolute;left:150px;top:16px;width:110px;height:80px;background:#22c55e"></div>
    </div>
    <div data-agent-native-node-id="solo-a" data-agent-native-layer-name="Solo A"
         style="position:absolute;left:40px;top:300px;width:120px;height:80px;background:#a855f7"></div>
    <div data-agent-native-node-id="solo-b" data-agent-native-layer-name="Solo B"
         style="position:absolute;left:190px;top:300px;width:120px;height:80px;background:#ec4899"></div>
  </body>
</html>`;

// A dedicated board-surface file. Set as `boardFileId`, this renders as the
// overview canvas's board layer that screens sit on top of — the real
// mechanism behind "board objects", per MultiScreenCanvas.tsx boardFileId
// wiring (shared/board-objects.ts's JSON boardObjects array is unused by the
// renderer).
const BOARD_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Board</title></head>
  <body style="margin:0;min-height:900px;background:#e5e5e5">
    <div data-agent-native-node-id="board-a" data-agent-native-layer-name="Board A"
         style="position:absolute;left:20px;top:520px;width:120px;height:80px;background:#f59e0b"></div>
    <div data-agent-native-node-id="board-b" data-agent-native-layer-name="Board B"
         style="position:absolute;left:170px;top:520px;width:120px;height:80px;background:#0ea5e9"></div>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok())
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "selection parity",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return id;
}

async function newBoardDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "selection parity board",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  const board = await postAction(page, "create-file", {
    designId: id,
    filename: "__board__.html",
    content: BOARD_FIXTURE,
    fileType: "html",
  });
  const boardFileId = board?.id ?? board?.data?.id;
  if (!boardFileId) throw new Error("create-file returned no board id");
  await postAction(page, "update-design", {
    id,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: boardFileId }],
  });
  return id;
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function selectedRows(page: Page): Locator {
  return layersTree(page).locator('[role="treeitem"][aria-selected="true"]');
}

async function selectedLayerNames(page: Page): Promise<string[]> {
  return (await selectedRows(page).allTextContents()).map((t) => t.trim());
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`${baseURL}/design/${designId}`, {
    waitUntil: "domcontentloaded",
  });
  await toolbar(page)
    .locator('button[aria-label="Move"]')
    .waitFor({ timeout: 45_000 });
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .waitFor({ timeout: 30_000 });
  await expandAllLayers(page);
  await page.waitForTimeout(500);
}

async function click(page: Page, box: { x: number; y: number; width: number; height: number }, modifiers?: ("Meta" | "Shift" | "Control")[]) {
  // page.mouse.click's `modifiers` option is unreliable against this canvas
  // (see reference_browser_modifier_keys_not_delivered) — hold the keys with
  // keyboard.down/up around a plain click instead, matching what a real user
  // does with their hand on the modifier key.
  if (modifiers?.length) for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (modifiers?.length) for (const m of modifiers) await page.keyboard.up(m);
}

async function sweep(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers?: ("Meta" | "Control")[],
): Promise<void> {
  if (modifiers?.length) {
    for (const m of modifiers) await page.keyboard.down(m);
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  if (modifiers?.length) {
    for (const m of modifiers) await page.keyboard.up(m);
  }
  await page.waitForTimeout(1500);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9360}`;
});

test.describe("click selects the container, not the deep child", () => {
  test("clicking a child inside Card selects Card, not Kid A", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await page.waitForTimeout(1500);

    const names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `Figma spec §1: "clicking an object that lives inside a frame/group ` +
        `selects the outermost/top-level container ... not the deep child." ` +
        `Selection was [${names.join(", ")}] instead of "Card".`,
    ).toContain("Card");
    expect(
      names.join("|"),
      "the deep child must not be the selection on a plain first click",
    ).not.toContain("Kid A");
  });

  test("double-click after selecting Card drills into the clicked child", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await page.waitForTimeout(1200);
    await page.mouse.dblclick(
      kidA.x + kidA.width / 2,
      kidA.y + kidA.height / 2,
    );
    await page.waitForTimeout(1500);

    const names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `double-click must drill one level in; selection is [${names.join(", ")}]`,
    ).toContain("Kid A");
  });

  test("cmd+click deep-selects Kid B directly with no prior selection", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const kidB = (await node(page, "kid-b").boundingBox())!;
    await click(page, kidB, ["Meta"]);
    await page.waitForTimeout(1500);

    const names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `Figma spec §1: cmd/ctrl+click "deep-selects whatever object is ` +
        `directly under the cursor ... skipping the select-container step." ` +
        `Selection was [${names.join(", ")}].`,
    ).toContain("Kid B");
  });
});

test.describe("shift+click toggles membership", () => {
  test("shift+click adds an unselected object, then removes it on a second shift+click", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const soloA = (await node(page, "solo-a").boundingBox())!;
    const soloB = (await node(page, "solo-b").boundingBox())!;

    await click(page, soloA);
    await page.waitForTimeout(1000);
    await click(page, soloB, ["Shift"]);
    await page.waitForTimeout(1200);
    let names = await selectedLayerNames(page);
    expect(
      names,
      `after shift+click, both objects should be selected: [${names.join(", ")}]`,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Solo A"),
        expect.stringContaining("Solo B"),
      ]),
    );
    expect(names).toHaveLength(2);

    await click(page, soloB, ["Shift"]);
    await page.waitForTimeout(1200);
    names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `Figma spec §1: shift+click on an already-selected object removes it. ` +
        `Selection is [${names.join(", ")}].`,
    ).not.toContain("Solo B");
    expect(names.join("|")).toContain("Solo A");
  });
});

test.describe("Esc / Enter traversal from a real drill-in", () => {
  test("Escape backs out of a drilled-in child to the parent container", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await page.waitForTimeout(1000);
    await page.mouse.dblclick(
      kidA.x + kidA.width / 2,
      kidA.y + kidA.height / 2,
    );
    await page.waitForTimeout(1200);
    let names = await selectedLayerNames(page);
    expect(names.join("|"), "precondition: drilled into Kid A").toContain(
      "Kid A",
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `Figma spec (task): "Esc goes up a level" from a drilled-in child. ` +
        `Selection is [${names.join(", ")}].`,
    ).toContain("Card");
  });

  test("Enter descends from Card to its first child", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await page.waitForTimeout(1000);
    let names = await selectedLayerNames(page);
    expect(names.join("|"), "precondition: Card is selected").toContain(
      "Card",
    );

    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `Figma spec §1: Enter "selects one level down (child)". Selection is [${names.join(", ")}].`,
    ).toMatch(/Kid/);
  });
});

test("clicking empty canvas inside the screen deselects everything", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const soloA = (await node(page, "solo-a").boundingBox())!;
  await click(page, soloA);
  await page.waitForTimeout(1000);
  expect(await selectedLayerNames(page)).toHaveLength(1);

  // A point with no data-agent-native-node-id under it at all: below every
  // fixture element but still inside the screen's own body background.
  const px = await canvasZoom(page);
  const empty = { x: soloA.x, y: soloA.y + 260 * px, width: 0, height: 0 };
  await click(page, empty);
  await page.waitForTimeout(1200);
  await expect(
    selectedRows(page),
    "clicking empty canvas must clear the selection",
  ).toHaveCount(0);
});

test.describe("marquee semantics", () => {
  test("a marquee selects every top-level object it merely INTERSECTS, not just fully-enclosed ones", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const soloA = (await node(page, "solo-a").boundingBox())!;
    const soloB = (await node(page, "solo-b").boundingBox())!;
    // Start the band mid-way through Solo A and end it mid-way through
    // Solo B: neither box is ever fully enclosed.
    await sweep(
      page,
      { x: soloA.x + soloA.width / 2, y: soloA.y - 20 },
      { x: soloB.x + soloB.width / 2, y: soloB.y + soloB.height / 2 },
    );

    const names = await selectedLayerNames(page);
    expect(
      names,
      `Figma spec Part 3: marquee selects every top-level object it ` +
        `INTERSECTS (touching counts), not only fully-enclosed ones. ` +
        `Selection is [${names.join(", ")}].`,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Solo A"),
        expect.stringContaining("Solo B"),
      ]),
    );
  });

  test("a marquee over Card selects Card only, not its children", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const card = (await node(page, "card").boundingBox())!;
    await sweep(
      page,
      { x: card.x - 20, y: card.y - 20 },
      { x: card.x + card.width + 20, y: card.y + card.height + 20 },
    );

    const names = await selectedLayerNames(page);
    expect(names.join("|"), `selection is [${names.join(", ")}]`).toContain(
      "Card",
    );
    expect(
      names,
      "a plain marquee must not reach past the top-level container into its children",
    ).not.toEqual(expect.arrayContaining([expect.stringContaining("Kid")]));
  });

  test("cmd+marquee over Card reaches into Kid A and Kid B", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const card = (await node(page, "card").boundingBox())!;
    await sweep(
      page,
      { x: card.x - 20, y: card.y - 20 },
      { x: card.x + card.width + 20, y: card.y + card.height + 20 },
      ["Meta"],
    );

    const names = await selectedLayerNames(page);
    expect(
      names,
      `Figma spec §1: "Holding Cmd/Ctrl while dragging the marquee reaches ` +
        `into nested layers rather than stopping at top-level containers." ` +
        `Selection is [${names.join(", ")}].`,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Kid A"),
        expect.stringContaining("Kid B"),
      ]),
    );
  });
});

test.describe("board objects on the overview canvas", () => {
  test("clicking a board object selects it directly (no screen wraps it)", async ({
    page,
  }) => {
    const id = await newBoardDesign(page);
    await openEditor(page, id);
    const boardA = (await node(page, "board-a").boundingBox())!;
    await click(page, boardA);
    await page.waitForTimeout(1200);

    const names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `board objects are already top-level; a click must select "Board A" ` +
        `directly. Selection is [${names.join(", ")}].`,
    ).toContain("Board A");
  });

  test("Tab cycles from Board A to Board B on the overview canvas", async ({
    page,
  }) => {
    const id = await newBoardDesign(page);
    await openEditor(page, id);
    const boardA = (await node(page, "board-a").boundingBox())!;
    await click(page, boardA);
    await page.waitForTimeout(1000);
    expect(await selectedLayerNames(page)).toEqual(
      expect.arrayContaining([expect.stringContaining("Board A")]),
    );

    await page.keyboard.press("Tab");
    await page.waitForTimeout(1200);
    const names = await selectedLayerNames(page);
    expect(
      names.join("|"),
      `Figma spec §1: "Tab cycles to the next sibling". Selection is [${names.join(", ")}].`,
    ).toContain("Board B");
  });

  test("a marquee drawn on the board surface selects the board objects it intersects", async ({
    page,
  }) => {
    const id = await newBoardDesign(page);
    await openEditor(page, id);
    const boardA = (await node(page, "board-a").boundingBox())!;
    const boardB = (await node(page, "board-b").boundingBox())!;
    await sweep(
      page,
      { x: boardA.x + boardA.width / 2, y: boardA.y - 20 },
      { x: boardB.x + boardB.width / 2, y: boardB.y + boardB.height / 2 },
    );

    const names = await selectedLayerNames(page);
    expect(
      names,
      `a marquee on the board surface must sweep the objects it intersects. ` +
        `Selection is [${names.join(", ")}].`,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Board A"),
        expect.stringContaining("Board B"),
      ]),
    );
  });
});
