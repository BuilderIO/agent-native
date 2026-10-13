import { type Locator, type Page } from "@playwright/test";

import { appPath } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Layers panel interaction</title></head>
  <body style="margin:0;min-height:1200px;background:#fff;color:#111;font-family:system-ui,sans-serif">
    <header data-agent-native-node-id="header" data-agent-native-layer-name="Site Header" style="height:80px;background:#1d4ed8;color:#fff">Site Header</header>
    <nav data-agent-native-node-id="nav" data-agent-native-layer-name="Nav" style="height:48px;background:#f3f4f6;display:flex;gap:16px">
      <a data-agent-native-node-id="nav-shop" data-agent-native-layer-name="Shop" href="#">Shop</a>
      <a data-agent-native-node-id="nav-about" data-agent-native-layer-name="About" href="#">About</a>
      <a data-agent-native-node-id="nav-contact" data-agent-native-layer-name="Contact" href="#">Contact</a>
    </nav>
    <main data-agent-native-node-id="main" data-agent-native-layer-name="Main" style="min-height:600px;padding:24px">
      <div data-agent-native-node-id="panel" data-agent-native-layer-name="Panel" style="position:relative;width:300px;height:200px;background:#e5e7eb">
        <div data-agent-native-node-id="panel-child" data-agent-native-layer-name="Panel Child" style="width:100px;height:60px;background:#93c5fd"></div>
      </div>
      <div data-agent-native-node-id="loose" data-agent-native-layer-name="Loose Card" style="width:120px;height:60px;background:#fca5a5;margin-top:16px"></div>
      <div data-agent-native-node-id="loose2" style="width:120px;height:60px;background:#86efac;margin-top:16px">Untitled</div>
    </main>
    <div data-agent-native-node-id="sticker" data-agent-native-layer-name="Sticker" style="position:absolute;left:500px;top:1000px;width:60px;height:40px;background:#fb923c"></div>
    <footer data-agent-native-node-id="footer" data-agent-native-layer-name="Footer" style="height:80px;background:#111827;color:#fff">Footer</footer>
  </body>
</html>`;

/** Moving a layer to the top level stamps a generated id on an unnamed body; naming it keeps the parent literal. */
const FIXTURE_WITH_BODY_ID = FIXTURE.replace(
  "<body ",
  '<body data-agent-native-node-id="page" ',
);

const LOOSE_CARD = { x: 24, y: 368, width: 120, height: 60 };
const STICKER = { x: 500, y: 1000, width: 60, height: 40 };

const BOARD_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Board</title></head>
  <body style="margin:0;position:relative;background:transparent;overflow:visible">
    <div data-agent-native-node-id="board-a" data-agent-native-layer-name="Board Sticker" style="position:absolute;left:300px;top:450px;width:120px;height:80px;background:#f59e0b"></div>
  </body>
</html>`;

const HOME_FRAME = { x: 100, y: 50, width: 1440, height: 1200, z: 0 };

const SIBLING_REORDER_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sibling reorder interaction</title></head>
  <body style="margin:0;min-height:300px;background:#fff">
    <div data-agent-native-node-id="wrap" data-agent-native-layer-name="Wrap" style="position:relative;width:300px;height:150px">
      <div data-agent-native-node-id="node-b" data-agent-native-layer-name="B" style="position:absolute;left:140px;top:20px;width:80px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="node-a" data-agent-native-layer-name="A" style="position:absolute;left:20px;top:20px;width:80px;height:80px;background:#ef4444"></div>
    </div>
    <div data-agent-native-node-id="other" data-agent-native-layer-name="Other" style="position:absolute;left:20px;top:200px;width:80px;height:40px;background:#10b981"></div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

const FIXTURE_CONTAINERS = ["Home", "Main", "Frame", "Panel", "Nav"];

async function openSeeded(
  app: App,
  html = FIXTURE,
  containers = FIXTURE_CONTAINERS,
) {
  const id = await app.seed(html);
  await app.open(id);
  await expandLayers(app.page, containers);
  return id;
}

/** Expands each named row, retrying while the tree is still mounting. */
async function expandLayers(page: Page, names: string[]) {
  for (const name of names) {
    const row = layerRow(page, name);
    await expect(async () => {
      const expand = row.getByRole("button", { name: "Expand layer" });
      if (await expand.count()) await expand.click();
      await expect(row).toHaveAttribute("aria-expanded", "true", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 15_000 });
  }
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string) {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) });
}

function layerRow(page: Page, name: string) {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

function renameInput(page: Page) {
  return layerTree(page).locator('input[aria-label="Rename layer"]');
}

/** The Layers tree as indented names, top row first. */
async function layerOutline(page: Page) {
  return layerTree(page)
    .getByRole("treeitem")
    .evaluateAll((items) =>
      items.map(
        (item) =>
          "  ".repeat(Number(item.getAttribute("aria-level")) - 1) +
          (item
            .querySelector("[data-layer-row-button] span[title]")
            ?.getAttribute("title") ?? ""),
      ),
    );
}

/** Names of the rows directly under `parent`, in panel order. */
async function rowsUnder(page: Page, parent: string) {
  return layerTree(page)
    .getByRole("treeitem")
    .evaluateAll((items, parentName) => {
      const rows = items.map((item) => ({
        level: Number(item.getAttribute("aria-level")),
        name:
          item
            .querySelector("[data-layer-row-button] span[title]")
            ?.getAttribute("title") ?? "",
      }));
      const start = rows.findIndex((row) => row.name === parentName);
      const names: string[] = [];
      for (const row of rows.slice(start + 1)) {
        if (row.level <= rows[start].level) break;
        if (row.level === rows[start].level + 1) names.push(row.name);
      }
      return names;
    }, parent);
}

async function dragRowOnto(
  page: Page,
  source: Locator,
  target: Locator,
  where: "top" | "middle",
) {
  const box = (await target.boundingBox())!;
  await source.dragTo(target, {
    targetPosition: { x: 96, y: where === "top" ? 2 : box.height / 2 },
  });
}

/** The saved style properties that decide where a node renders. */
function placement(node: SavedNode | undefined) {
  const {
    position,
    left,
    top,
    width,
    height,
    "margin-top": marginTop,
  } = styleOf(node);
  return { position, left, top, "margin-top": marginTop, width, height };
}

async function liveChildIds(app: App, parentId: string) {
  return app
    .node(parentId)
    .locator(":scope > [data-agent-native-node-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
    );
}

test.describe("interaction: layers panel", () => {
  test("top row is topmost-rendered, matching DOM order (Steve's footer-above-header report)", async ({
    app,
  }) => {
    await openSeeded(app);

    await expect
      .poll(() => layerOutline(app.page))
      .toStrictEqual([
        "Home",
        "  Footer",
        "  Sticker",
        "  Main",
        "    Frame",
        "      Untitled",
        "    Loose Card",
        "    Panel",
        "      Panel Child",
        "  Nav",
        "    Shop",
        "    About",
        "    Contact",
        "  Site Header",
      ]);
  });

  test('dragging a nav link row inserts exactly "above Shop"', async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);
    expect(childrenOf(before, "nav")).toStrictEqual([
      "nav-shop",
      "nav-about",
      "nav-contact",
    ]);

    await dragRowOnto(
      page,
      layerRowButton(page, "Contact"),
      layerRow(page, "Shop"),
      "top",
    );
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "nav")).toStrictEqual([
      "nav-contact",
      "nav-shop",
      "nav-about",
    ]);
    expectOnlyChanged(before, after, []);
    await expect
      .poll(() => rowsUnder(page, "Nav"))
      .toStrictEqual(["Contact", "Shop", "About"]);
    await expect
      .poll(() => liveChildIds(app, "nav"))
      .toStrictEqual(["nav-contact", "nav-shop", "nav-about"]);
  });

  test("dropping a row onto a container row reparents it as the topmost child", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);
    expect(await app.designRect("loose")).toEqual(LOOSE_CARD);

    await dragRowOnto(
      page,
      layerRowButton(page, "Loose Card"),
      layerRow(page, "Panel"),
      "middle",
    );
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "panel")).toStrictEqual(["panel-child", "loose"]);
    expect(childrenOf(after, "main")).toStrictEqual(["panel", "loose2"]);
    expect(
      placement(after.get("loose")),
      "Panel's box starts at 24,152, so 16px margin plus 200px top keeps the card at y 368",
    ).toEqual({
      position: "absolute",
      left: "0px",
      top: "200px",
      "margin-top": "16px",
      width: "120px",
      height: "60px",
    });
    expectOnlyChanged(before, after, ["loose"]);
    await expect
      .poll(() => rowsUnder(page, "Panel"))
      .toStrictEqual(["Loose Card", "Panel Child"]);
    expect(
      await app.designRect("loose"),
      "a Layers reparent changes the hierarchy, not where the card sits on the canvas",
    ).toEqual(LOOSE_CARD);
  });

  test("dropping an absolutely positioned layer row onto a Frame row keeps its on-screen position", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);
    expect(await app.designRect("sticker")).toEqual(STICKER);

    await dragRowOnto(
      page,
      layerRowButton(page, "Sticker"),
      layerRow(page, "Panel"),
      "middle",
    );
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "panel")).toStrictEqual([
      "panel-child",
      "sticker",
    ]);
    expect(
      placement(after.get("sticker")),
      "Panel's box starts at 24,152, so the offsets inside it are 476,848",
    ).toEqual({
      position: "absolute",
      left: "476px",
      top: "848px",
      width: "60px",
      height: "40px",
    });
    expectOnlyChanged(before, after, ["sticker"]);
    expect(await app.designRect("sticker")).toEqual(STICKER);
  });

  test("dragging an unnamed layer's row reorders it like a named one", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);
    await expect
      .poll(() => rowsUnder(page, "Main"))
      .toStrictEqual(["Frame", "Loose Card", "Panel"]);

    await dragRowOnto(
      page,
      layerRowButton(page, "Frame"),
      layerRow(page, "Panel"),
      "top",
    );
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "main")).toStrictEqual([
      "panel",
      "loose2",
      "loose",
    ]);
    expectOnlyChanged(before, after, []);
    await expect
      .poll(() => rowsUnder(page, "Main"))
      .toStrictEqual(["Loose Card", "Frame", "Panel"]);
    expect(await app.designRect("loose2")).toEqual(LOOSE_CARD);
    expect(await app.designRect("loose")).toEqual({ ...LOOSE_CARD, y: 444 });
  });

  test("rename via double-click commits on Enter and cancels on Escape", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);

    await layerRowButton(page, "Loose Card").dblclick();
    await expect(renameInput(page)).toBeFocused();
    await expect(renameInput(page)).toHaveValue("Loose Card");
    await renameInput(page).fill("Renamed Via Escape");
    await renameInput(page).press("Escape");
    await expect(renameInput(page)).toHaveCount(0);
    await expect
      .poll(() => rowsUnder(page, "Main"))
      .toStrictEqual(["Frame", "Loose Card", "Panel"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);

    await layerRowButton(page, "Loose Card").dblclick();
    await renameInput(page).fill("Committed Card");
    await renameInput(page).press("Enter");
    await expect(renameInput(page)).toHaveCount(0);
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.get("loose")?.attrs).toEqual({
      ...before.get("loose")?.attrs,
      "data-agent-native-layer-name": "Committed Card",
    });
    expectOnlyChanged(before, after, ["loose"]);
    await expect
      .poll(() => rowsUnder(page, "Main"))
      .toStrictEqual(["Frame", "Committed Card", "Panel"]);

    await app.open(id);
    await expandLayers(page, ["Home", "Main"]);
    await expect
      .poll(() => rowsUnder(page, "Main"))
      .toStrictEqual(["Frame", "Committed Card", "Panel"]);
  });

  test("Cmd+R opens the rename editor for the selection", async ({ app }) => {
    const page = app.page;
    const id = await openSeeded(app);
    await app.zoomToFit();
    const before = await app.savedNodes(id);
    const center = await app.pagePoint(
      LOOSE_CARD.x + LOOSE_CARD.width / 2,
      LOOSE_CARD.y + LOOSE_CARD.height / 2,
    );
    await page.mouse.click(center.x, center.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Loose Card"]);

    await page.keyboard.press(`${MOD}+r`);

    const input = layerTree(page)
      .getByRole("treeitem", { selected: true })
      .locator('input[aria-label="Rename layer"]');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Loose Card");
    await input.fill("Shortcut Card");
    await input.press("Enter");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.get("loose")?.attrs["data-agent-native-layer-name"]).toBe(
      "Shortcut Card",
    );
    expectOnlyChanged(before, after, ["loose"]);
  });

  test("one undo fully restores parent and position after a panel-drag reparent", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app);
    const before = await app.savedNodes(id);

    await dragRowOnto(
      page,
      layerRowButton(page, "Loose Card"),
      layerRow(page, "Panel"),
      "middle",
    );
    await app.settled();
    expect(
      (await app.savedNodes(id)).get("loose")?.parent,
      "the panel drag must reparent the card before undo is meaningful",
    ).toBe("panel");

    await page.keyboard.press(`${MOD}+z`);
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "main")).toStrictEqual([
      "panel",
      "loose",
      "loose2",
    ]);
    expect(childrenOf(after, "panel")).toStrictEqual(["panel-child"]);
    expectOnlyChanged(before, after, []);
    await expect
      .poll(() => rowsUnder(page, "Main"))
      .toStrictEqual(["Frame", "Loose Card", "Panel"]);
    expect(await app.designRect("loose")).toEqual(LOOSE_CARD);
  });

  // fixme: product bug: Board-to-screen move through Layers ignores the screen's canvas offset: with Home at 100,50, board-a (board 300,450) is saved at left
  test.fixme("dragging a board-object row onto a screen's file row moves it into the screen (board -> in)", async ({
    app,
  }) => {
    const page = app.page;
    const id = await app.seed(FIXTURE_WITH_BODY_ID, {
      files: { "__board__.html": BOARD_FIXTURE },
    });
    const seeded = await app.savedRecord(id);
    const fileId = (filename: string) =>
      seeded.files.find((file) => file.filename === filename)!.id;
    const setup = await page.request.post(
      appPath("/_agent-native/actions/update-design"),
      {
        data: {
          id,
          dataOperations: [
            {
              op: "set",
              path: ["boardFileId"],
              value: fileId("__board__.html"),
            },
            {
              op: "set",
              path: ["canvasFrames", fileId("index.html")],
              value: HOME_FRAME,
            },
          ],
        },
      },
    );
    expect(setup.ok()).toBe(true);
    await app.open(id);
    await expandLayers(page, ["Home"]);
    const frames = (await app.savedRecord(id)).data?.canvasFrames as Record<
      string,
      unknown
    >;
    expect(
      frames[fileId("index.html")],
      "Home must open where it was placed for the expected offsets to hold",
    ).toEqual(HOME_FRAME);
    const before = await app.savedNodes(id);
    expect((await app.savedNodes(id, "__board__.html")).has("board-a")).toBe(
      true,
    );

    await dragRowOnto(
      page,
      layerRowButton(page, "Board Sticker"),
      layerRow(page, "Home"),
      "middle",
    );
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "page")).toStrictEqual([
      "header",
      "nav",
      "main",
      "sticker",
      "footer",
      "board-a",
    ]);
    expect(
      styleOf(after.get("board-a")),
      "Home sits at 100,50 on the canvas, so the board's 300,450 is 200,400 inside it",
    ).toEqual({
      position: "absolute",
      left: "200px",
      top: "400px",
      width: "120px",
      height: "80px",
      background: "#f59e0b",
    });
    expectOnlyChanged(before, after, ["board-a"]);
    expect((await app.savedNodes(id, "__board__.html")).has("board-a")).toBe(
      false,
    );
    await expect
      .poll(() => rowsUnder(page, "Home"))
      .toStrictEqual([
        "Board Sticker",
        "Footer",
        "Sticker",
        "Main",
        "Nav",
        "Site Header",
      ]);
    expect(await app.designRect("board-a")).toEqual({
      x: 200,
      y: 400,
      width: 120,
      height: 80,
    });
  });
});

test.describe("interaction: layers panel sibling reorder and preview sync", () => {
  test("dragging B above A in the panel reaches the persisted file, the live iframe, and the panel alike; one undo restores B,A", async ({
    app,
  }) => {
    const page = app.page;
    const id = await openSeeded(app, SIBLING_REORDER_FIXTURE, ["Home", "Wrap"]);
    const before = await app.savedNodes(id);
    expect(childrenOf(before, "wrap")).toStrictEqual(["node-b", "node-a"]);
    await expect.poll(() => rowsUnder(page, "Wrap")).toStrictEqual(["A", "B"]);

    await layerRowButton(page, "Other").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Other"]);
    const liveWindow = page.locator(LIVE_SCREEN).contentFrame().locator("html");
    await liveWindow.evaluate((el) => {
      (el.ownerDocument.defaultView as any).__previewReorderMarker = "alive";
    });

    await dragRowOnto(
      page,
      layerRowButton(page, "B"),
      layerRow(page, "A"),
      "top",
    );
    await app.settled();

    const reordered = await app.savedNodes(id);
    expect(childrenOf(reordered, "wrap")).toStrictEqual(["node-a", "node-b"]);
    expectOnlyChanged(before, reordered, []);
    await expect
      .poll(() => liveChildIds(app, "wrap"))
      .toStrictEqual(["node-a", "node-b"]);
    await expect.poll(() => rowsUnder(page, "Wrap")).toStrictEqual(["B", "A"]);
    expect(
      await liveWindow.evaluate(
        (el) => (el.ownerDocument.defaultView as any).__previewReorderMarker,
      ),
      "a reorder must patch the live screen, not remount its iframe",
    ).toBe("alive");

    await page.keyboard.press(`${MOD}+z`);
    await app.settled();

    const undone = await app.savedNodes(id);
    expect(childrenOf(undone, "wrap")).toStrictEqual(["node-b", "node-a"]);
    expectOnlyChanged(before, undone, []);
    await expect
      .poll(() => liveChildIds(app, "wrap"))
      .toStrictEqual(["node-b", "node-a"]);
    await expect.poll(() => rowsUnder(page, "Wrap")).toStrictEqual(["A", "B"]);
  });
});
