import { expect, test, type Locator, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  canvasZoom,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
  installBridge,
  waitForBridge,
} from "./helpers";


const MOD = process.platform === "darwin" ? "Meta" : "Control";

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

async function newBoardDesign(
  page: Page,
  content: string = BOARD_FIXTURE,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "selection parity board",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  const board = await postAction(page, "create-file", {
    designId: id,
    filename: "__board__.html",
    content,
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

async function openEditorAndExpandLayers(
  page: Page,
  designId: string,
): Promise<void> {
  await gotoEditor(page, designId);
  await expandAllLayers(page);
}

async function click(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  modifiers?: ("Meta" | "Shift" | "Control")[],
) {
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
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
});

// PR #5644 ("Use direct selection inside design screens") made a plain click
test.describe("click selects the container on the board surface, not the deep child", () => {
  test("clicking a child inside Card selects Card, not Kid A", async ({
    page,
  }) => {
    const id = await newBoardDesign(page, FIXTURE);
    await openEditorAndExpandLayers(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);

    let names: string[] = [];
    await expect
      .poll(
        async () => {
          names = await selectedLayerNames(page);
          return names.join("|");
        },
        {
          timeout: 10_000,
          message:
            'Figma spec §1: "clicking an object that lives inside a frame/group ' +
            'selects the outermost/top-level container ... not the deep child." ' +
            "(board surface only — screens deliberately select the deep child, see PR #5644)",
        },
      )
      .toContain("Card");
    expect(
      names.join("|"),
      "the deep child must not be the selection on a plain first click",
    ).not.toContain("Kid A");
  });

  test("double-click after selecting Card drills into the clicked child", async ({
    page,
  }) => {
    const id = await newBoardDesign(page, FIXTURE);
    await openEditorAndExpandLayers(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: the first click must select Card",
      })
      .toContain("Card");
    await page.mouse.dblclick(
      kidA.x + kidA.width / 2,
      kidA.y + kidA.height / 2,
    );

    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "double-click must drill one level in",
      })
      .toContain("Kid A");
  });

  test("cmd+click deep-selects Kid B directly with no prior selection", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    const kidB = (await node(page, "kid-b").boundingBox())!;
    await click(page, kidB, ["Meta"]);

    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message:
          'Figma spec §1: cmd/ctrl+click "deep-selects whatever object is ' +
          'directly under the cursor ... skipping the select-container step."',
      })
      .toContain("Kid B");
  });

  test("cmd+click a child of an already-selected Card replaces the selection with the child, not the Card", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    const card = (await node(page, "card").boundingBox())!;
    await page.mouse.click(card.x + card.width / 2, card.y + card.height - 20);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: the plain click must select Card",
      })
      .toContain("Card");

    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA, ["Meta"]);

    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message:
          "cmd/ctrl+click always REPLACES the selection (spec Part 3) even " +
          "when it deep-selects a child of the currently-selected container — " +
          "it must not union the child onto the container's selection.",
      })
      .toBe("Kid A");
  });
});

test.describe("shift+click toggles membership", () => {
  test("shift+click adds an unselected object, then removes it on a second shift+click", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    const soloA = (await node(page, "solo-a").boundingBox())!;
    const soloB = (await node(page, "solo-b").boundingBox())!;

    await click(page, soloA);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: the first click must select Solo A",
      })
      .toContain("Solo A");
    await click(page, soloB, ["Shift"]);
    let names: string[] = [];
    await expect
      .poll(
        async () => {
          names = await selectedLayerNames(page);
          return names.length;
        },
        {
          timeout: 10_000,
          message: "after shift+click, both objects should be selected",
        },
      )
      .toBe(2);
    expect(names).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Solo A"),
        expect.stringContaining("Solo B"),
      ]),
    );

    await click(page, soloB, ["Shift"]);
    let namesAfterToggle = "";
    await expect
      .poll(
        async () => {
          namesAfterToggle = (await selectedLayerNames(page)).join("|");
          return namesAfterToggle;
        },
        {
          timeout: 10_000,
          message:
            "Figma spec §1: shift+click on an already-selected object removes it.",
        },
      )
      .not.toContain("Solo B");
    expect(namesAfterToggle).toContain("Solo A");
  });
});

test.describe("Esc / Enter traversal from a real drill-in", () => {
  test("Escape clears the selection entirely, even from a drilled-in child", async ({
    page,
  }) => {
    const id = await newBoardDesign(page, FIXTURE);
    await openEditorAndExpandLayers(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: the first click must select Card",
      })
      .toContain("Card");
    await page.mouse.dblclick(
      kidA.x + kidA.width / 2,
      kidA.y + kidA.height / 2,
    );
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: drilled into Kid A",
      })
      .toContain("Kid A");

    await page.keyboard.press("Escape");
    await expect
      .poll(async () => selectedLayerNames(page), {
        timeout: 10_000,
        message: "Escape must clear the selection entirely",
      })
      .toEqual([]);
  });

  test("Enter descends from Card to its first child", async ({ page }) => {
    const id = await newBoardDesign(page, FIXTURE);
    await openEditorAndExpandLayers(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: Card is selected",
      })
      .toContain("Card");

    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: 'Figma spec §1: Enter "selects one level down (child)".',
      })
      .toMatch(/Kid/);
  });
});

test("clicking empty canvas inside the screen deselects everything", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditorAndExpandLayers(page, id);
  const soloA = (await node(page, "solo-a").boundingBox())!;
  await click(page, soloA);
  await expect
    .poll(async () => (await selectedLayerNames(page)).length, {
      timeout: 10_000,
      message: "precondition: clicking Solo A must select exactly it",
    })
    .toBe(1);

  const px = await canvasZoom(page);
  const empty = { x: soloA.x, y: soloA.y + 260 * px, width: 0, height: 0 };
  await click(page, empty);
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
    await openEditorAndExpandLayers(page, id);
    const soloA = (await node(page, "solo-a").boundingBox())!;
    const soloB = (await node(page, "solo-b").boundingBox())!;
    await sweep(
      page,
      { x: soloA.x + soloA.width / 2, y: soloA.y - 20 },
      { x: soloB.x + soloB.width / 2, y: soloB.y + soloB.height / 2 },
    );

    await expect
      .poll(() => selectedLayerNames(page), {
        timeout: 10_000,
        message:
          "Figma spec Part 3: marquee selects every top-level object it " +
          "INTERSECTS (touching counts), not only fully-enclosed ones.",
      })
      .toEqual(
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
    await openEditorAndExpandLayers(page, id);
    const card = (await node(page, "card").boundingBox())!;
    await sweep(
      page,
      { x: card.x - 20, y: card.y - 20 },
      { x: card.x + card.width + 20, y: card.y + card.height + 20 },
    );

    let names: string[] = [];
    await expect
      .poll(
        async () => {
          names = await selectedLayerNames(page);
          return names.join("|");
        },
        { timeout: 10_000 },
      )
      .toContain("Card");
    expect(
      names,
      "a plain marquee must not reach past the top-level container into its children",
    ).not.toEqual(expect.arrayContaining([expect.stringContaining("Kid")]));
  });

  test("cmd+marquee over Card reaches into Kid A and Kid B", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditorAndExpandLayers(page, id);
    const card = (await node(page, "card").boundingBox())!;
    await sweep(
      page,
      { x: card.x - 20, y: card.y - 20 },
      { x: card.x + card.width + 20, y: card.y + card.height + 20 },
      ["Meta"],
    );

    await expect
      .poll(() => selectedLayerNames(page), {
        timeout: 10_000,
        message:
          'Figma spec §1: "Holding Cmd/Ctrl while dragging the marquee reaches ' +
          'into nested layers rather than stopping at top-level containers."',
      })
      .toEqual(
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
    await openEditorAndExpandLayers(page, id);
    const boardA = (await node(page, "board-a").boundingBox())!;
    await click(page, boardA);

    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message:
          'board objects are already top-level; a click must select "Board A" directly.',
      })
      .toContain("Board A");
  });

  test("Tab cycles from Board A to Board B on the overview canvas", async ({
    page,
  }) => {
    const id = await newBoardDesign(page);
    await openEditorAndExpandLayers(page, id);
    const boardA = (await node(page, "board-a").boundingBox())!;
    await click(page, boardA);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: clicking Board A must select it",
      })
      .toContain("Board A");

    await page.keyboard.press("Tab");
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: 'Figma spec §1: "Tab cycles to the next sibling".',
      })
      .toContain("Board B");
  });

  test("a marquee drawn on the board surface selects the board objects it intersects", async ({
    page,
  }) => {
    const id = await newBoardDesign(page);
    await openEditorAndExpandLayers(page, id);
    const boardA = (await node(page, "board-a").boundingBox())!;
    const boardB = (await node(page, "board-b").boundingBox())!;
    await sweep(
      page,
      { x: boardA.x + boardA.width / 2, y: boardA.y - 20 },
      { x: boardB.x + boardB.width / 2, y: boardB.y + boardB.height / 2 },
    );

    await expect
      .poll(() => selectedLayerNames(page), {
        timeout: 10_000,
        message:
          "a marquee on the board surface must sweep the objects it intersects.",
      })
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining("Board A"),
          expect.stringContaining("Board B"),
        ]),
      );
  });

  test("cmd+click a child of an already-selected Card on the board surface replaces the selection with the child", async ({
    page,
  }) => {
    const id = await newBoardDesign(page, FIXTURE);
    await openEditorAndExpandLayers(page, id);
    const card = (await node(page, "card").boundingBox())!;
    await page.mouse.click(card.x + card.width / 2, card.y + card.height - 20);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: the plain click must select Card",
      })
      .toContain("Card");

    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA, ["Meta"]);

    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message:
          "cmd/ctrl+click on a board object's child must REPLACE the " +
          "selection with the child, not leave the container selected.",
      })
      .toBe("Kid A");
  });
});

/**
 * Figma parity — overview screen selection must be the single source of
 * truth for what Cmd+A treats as "the current selection".
 *
 * Repro (from the Cmd+A scope work): select a nested element inside Screen 1
 * (leaves `selectedLayerIdsState` holding a real layer id), then — WITHOUT
 * deselecting — select Screen 2's card on the overview canvas. Figma ground
 * truth: once a Screen card is the selection, Cmd+A must select all Screens,
 * never the stale element's siblings from a different screen.
 *
 * Fixture: "index.html" (Screen 1) nests Alpha/Beta buttons two levels deep
 * (main > row > button), matching FIXTURE_HTML's shape so a real double-click
 * descends to the leaf. "page-two.html" (Screen 2) is a plain second screen.
 */

const SCREEN_ONE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen One</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="s1-main" data-agent-native-layer-name="Main"
          style="padding:40px;display:flex;flex-direction:column;gap:16px">
      <div data-agent-native-node-id="s1-row" data-agent-native-layer-name="Row"
           style="display:flex;flex-direction:row;gap:16px">
        <button data-agent-native-node-id="s1-alpha" data-agent-native-layer-name="Alpha Button"
                style="padding:14px 28px;border-radius:10px;border:0;background:#6366f1;color:#fff">Alpha Button</button>
        <button data-agent-native-node-id="s1-beta" data-agent-native-layer-name="Beta Button"
                style="padding:14px 28px;border-radius:10px;border:0;background:#22c55e;color:#06240f">Beta Button</button>
      </div>
    </main>
  </body>
</html>`;

const SCREEN_TWO = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen Two</title></head>
  <body style="margin:0;min-height:400px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="s2-target" data-agent-native-layer-name="Page2Target"
             style="margin:40px;width:300px;height:200px;background:#312e81"></section>
  </body>
</html>`;

async function newTwoScreenDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "parity selection cmd+a",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: SCREEN_ONE,
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId: id,
    filename: "page-two.html",
    content: SCREEN_TWO,
    fileType: "html",
  });
  return id;
}

async function fileIdFor(
  page: Page,
  id: string,
  filename: string,
): Promise<string> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  const file = (record.files ?? []).find((f: any) => f.filename === filename);
  if (!file) throw new Error(`no file ${filename} in design ${id}`);
  return file.id;
}

function screenCard(page: Page, index: number): Locator {
  return page.locator("[data-screen-card]").nth(index);
}

async function selectByTextDeepInScreen(
  page: Page,
  screenId: string,
  text: string,
): Promise<void> {
  await enterDirectMode(page);
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  const frame = designFrame(page, screenId);
  const candidates = frame.locator("[data-agent-native-node-id]", {
    hasText: text,
  });
  const count = await candidates.count();
  let bestIndex = 0;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const tag = await candidate.evaluate((el) => el.tagName);
    if (tag === "SPAN") continue;
    const area = box.width * box.height;
    if (area < bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  if (count === 0) {
    throw new Error(`no element found matching text ${JSON.stringify(text)}`);
  }
  const targetNode = candidates.nth(bestIndex);
  await targetNode.scrollIntoViewIfNeeded();
  const box = (await targetNode.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const message = await waitForBridge(page, "element-select");
  expect(String(message?.payload?.componentName ?? "")).toBe(text);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
}

test.describe
  .serial("overview screen selection vs stale layer selection (Cmd+A)", () => {
  let designId: string;
  let screen1Id: string;

  test.beforeEach(async ({ page }) => {
    designId = await newTwoScreenDesign(page);
    screen1Id = await fileIdFor(page, designId, "index.html");
    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-card]").first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("click-selecting Screen 2 after a nested Screen 1 element replaces the layer selection, so Cmd+A selects all Screens", async ({
    page,
  }) => {
    await selectByTextDeepInScreen(page, screen1Id, "Alpha Button");
    await expandAllLayers(page);
    await expect
      .poll(async () => (await selectedLayerNames(page)).length, {
        message: "precondition: the button click must select one layer row",
      })
      .toBe(1);

    await page
      .locator('[data-frame-title][title="page-two.html"]')
      .click({ force: true });
    await page.waitForTimeout(200);

    await page.keyboard.press(`${MOD}+a`);
    await page.waitForTimeout(300);

    const names = (await selectedLayerNames(page)).slice().sort();
    expect(
      names,
      "Cmd+A after clicking a Screen card must select exactly the two " +
        `Screens ("Home" and "Two"), not the previously-selected element's ` +
        `siblings from a different screen; got ${JSON.stringify(names)}`,
    ).toEqual(["Home", "Two"]);

    await expect(
      page.locator("[data-frame-selection-box]"),
      "Cmd+A after clicking a Screen card must produce a screen-level selection box",
    ).not.toHaveCount(0);
  });

  test("marquee-selecting Screen 2 after a nested Screen 1 element replaces the layer selection, so Cmd+A selects all Screens", async ({
    page,
  }) => {
    const label = page.locator('[data-frame-title][title="page-two.html"]');
    const labelBox = (await label.boundingBox())!;
    await page.mouse.move(
      labelBox.x + labelBox.width / 2,
      labelBox.y + labelBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      labelBox.x + labelBox.width / 2 + 500,
      labelBox.y + labelBox.height / 2 + 50,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(300);

    await selectByTextDeepInScreen(page, screen1Id, "Alpha Button");
    await expandAllLayers(page);
    await expect
      .poll(async () => (await selectedLayerNames(page)).length, {
        message: "precondition: the button click must select one layer row",
      })
      .toBe(1);

    const card2 = (await screenCard(page, 1).boundingBox())!;
    await page.mouse.move(card2.x - 60, card2.y - 60);
    await page.mouse.down();
    await page.mouse.move(
      card2.x + card2.width + 60,
      card2.y + card2.height + 60,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.keyboard.press(`${MOD}+a`);
    await page.waitForTimeout(300);

    const names = (await selectedLayerNames(page)).slice().sort();
    expect(
      names,
      "Cmd+A after marquee-selecting a Screen card must select exactly " +
        `the two Screens ("Home" and "Two"), not the previously-selected ` +
        `element's siblings from a different screen; got ${JSON.stringify(names)}`,
    ).toEqual(["Home", "Two"]);

    await expect(
      page.locator("[data-frame-selection-box]"),
      "Cmd+A after marquee-selecting a Screen card must produce a screen-level selection box",
    ).not.toHaveCount(0);
  });
});
