import { appPath, expandAllLayers } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const BOARD = "__board__.html";

const MOBILE_HOME_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;position:relative;min-height:900px;background:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="header" data-agent-native-layer-name="Header"
         style="position:absolute;left:0;top:0;width:390px;height:80px">
      <div data-agent-native-node-id="greeting" data-agent-native-layer-name="Good Morning"
           style="position:absolute;left:16px;top:16px;font-size:24px;font-weight:700">Good Morning</div>
    </div>
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:16px;top:100px;width:358px;height:100px;background:#f2f2f2">
      <div data-agent-native-node-id="cardtitle" data-agent-native-layer-name="Sunrise Cafe"
           style="position:absolute;left:12px;top:12px;font-size:16px;font-weight:600">Sunrise Cafe</div>
    </div>
  </body>
</html>`;

const LANDING_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Landing Page</title></head>
  <body style="margin:0;position:relative;min-height:2400px;background:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="navbar" data-agent-native-layer-name="Navbar"
         style="position:absolute;left:0;top:0;width:1440px;height:80px;background:#fff">
      <div data-agent-native-node-id="brand" data-agent-native-layer-name="Brand"
           style="position:absolute;left:32px;top:28px;font-size:20px;font-weight:700">Brand</div>
    </div>
    <div data-agent-native-node-id="hero" data-agent-native-layer-name="Hero"
         style="position:absolute;left:0;top:80px;width:1440px;height:640px;background:#fff">
      <div data-agent-native-node-id="heroimage" data-agent-native-layer-name="HeroImage"
           style="position:absolute;left:800px;top:80px;width:560px;height:480px;background:#e5e7eb"></div>
    </div>
  </body>
</html>`;

const BLANK_SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;min-height:900px;background:#fff"></body>
</html>`;

type Nodes = Map<string, SavedNode>;
type DesignRecord = {
  files: { id: string; filename: string; content: string }[];
  data: unknown;
};

function childrenOf(nodes: Nodes, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

function bodyId(nodes: Nodes) {
  return [...nodes.values()].find((node) => node.tag === "body")!.id;
}

function idsNamed(nodes: Nodes, layerName: string) {
  return [...nodes.values()]
    .filter((node) => node.attrs["data-agent-native-layer-name"] === layerName)
    .map((node) => node.id);
}

async function designRecord(app: App, id: string): Promise<DesignRecord> {
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${id}`),
  );
  const record = await response.json();
  return {
    files: record.files ?? [],
    data:
      typeof record.data === "string" ? JSON.parse(record.data) : record.data,
  };
}

function canvasFrame(record: DesignRecord, fileId: string) {
  return (
    record.data as {
      canvasFrames?: Record<
        string,
        { x: number; y: number; width: number; height: number }
      >;
    }
  )?.canvasFrames?.[fileId];
}

async function openSeeded(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function clickDesign(app: App, x: number, y: number) {
  const point = await app.pagePoint(x, y);
  await app.page.mouse.click(point.x, point.y);
  return point;
}

/** Indexes of the selected rows among the Layers rows named `name`, top row first (the frontmost layer). */
async function selectedRowsNamed(app: App, name: string) {
  return app.page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"]')
    .filter({
      has: app.page.locator(`[data-layer-row-button] span[title="${name}"]`),
    })
    .evaluateAll((rows) =>
      rows.flatMap((row, index) =>
        row.getAttribute("aria-selected") === "true" ? [index] : [],
      ),
    );
}

/** The canvas area the user can see: the container runs under the side panels, which overlay it. */
async function visibleCanvas(app: App) {
  const container = (await app.page
    .locator("[data-design-canvas-container]")
    .boundingBox())!;
  const layers = (await app.page.locator("aside").first().boundingBox())!;
  const inspector = (await app.page
    .locator('[data-design-chrome-region="right-panel"]')
    .first()
    .boundingBox())!;
  const x = layers.x + layers.width;
  return {
    x,
    y: container.y,
    width: inspector.x - x,
    height: container.height,
  };
}

async function emptyBoardPoint(app: App) {
  const point = await app.page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    for (let y = r.top + 60; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60; x < r.right - 60; x += 40) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
          )
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found at this viewport");
  return point;
}

async function pickScreenTool(app: App) {
  await app.page
    .locator(
      '[data-design-bottom-toolbar] button[aria-label="Frame options"], [data-design-bottom-toolbar] button[aria-label="Screen options"]',
    )
    .first()
    .click();
  await app.page
    .getByRole("menuitem")
    .filter({ hasText: "Screen" })
    .first()
    .click();
  await expect(
    app.page.locator(
      '[data-design-bottom-toolbar] button[aria-label="Screen"][aria-pressed="true"]',
    ),
  ).toHaveCount(1);
}

async function newScreen(app: App, id: string, before: string[]) {
  let created: DesignRecord["files"][number] | undefined;
  let record: DesignRecord | undefined;
  await expect
    .poll(async () => {
      record = await designRecord(app, id);
      created = record.files.find(
        (file) => !before.includes(file.id) && file.filename !== BOARD,
      );
      return Boolean(created && canvasFrame(record, created.id));
    })
    .toBe(true);
  await app.settled();
  record = await designRecord(app, id);
  return {
    record,
    created: record.files.find((file) => file.id === created!.id)!,
  };
}

function expectNear(
  actual: string | number | undefined,
  expected: number,
  label: string,
  tolerance = 2,
) {
  expect(
    Math.abs(parseFloat(String(actual)) - expected),
    `${label} ${actual}`,
  ).toBeLessThanOrEqual(tolerance);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("mobile app build", () => {
  test("Screen tool draws a root screen at the drawn size with white fill and clipped content, as a new sibling screen rather than nested in the first", async ({
    app,
  }) => {
    const id = await openSeeded(app, BLANK_SCREEN_HTML);
    const recordBefore = await designRecord(app, id);
    const home = recordBefore.files.find(
      (file) => file.filename === "index.html",
    )!;
    const homeBefore = await app.savedNodes(id);
    const { scale } = await app.pagePoint(0, 0);
    const empty = await emptyBoardPoint(app);

    await pickScreenTool(app);
    await app.page.mouse.move(empty.x, empty.y);
    await app.page.mouse.down();
    await app.page.mouse.move(empty.x + 390, empty.y + 700, { steps: 16 });
    await app.page.mouse.up();

    const { record, created } = await newScreen(
      app,
      id,
      recordBefore.files.map((file) => file.id),
    );
    expect(record.files.filter((file) => file.filename !== BOARD)).toHaveLength(
      2,
    );
    const frame = canvasFrame(record, created.id)!;
    expectNear(frame.width, 390 / scale, "saved screen width");
    expectNear(frame.height, 700 / scale, "saved screen height");
    expect(canvasFrame(record, home.id), "Home did not move").toEqual(
      canvasFrame(recordBefore, home.id),
    );
    expectOnlyChanged(homeBefore, await app.savedNodes(id), []);
    const body = app.page
      .frameLocator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${created.id}"]`,
      )
      .locator("body");
    await expect(body).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(body).toHaveCSS("overflow", "hidden");
  });

  test("clicking the Screen tool creates the first Desktop preset size", async ({
    app,
  }) => {
    const id = await openSeeded(app, BLANK_SCREEN_HTML);
    const recordBefore = await designRecord(app, id);
    const home = recordBefore.files.find(
      (file) => file.filename === "index.html",
    )!;
    const homeBefore = await app.savedNodes(id);
    const empty = await emptyBoardPoint(app);

    await pickScreenTool(app);
    await app.page.mouse.click(empty.x, empty.y);

    const { record, created } = await newScreen(
      app,
      id,
      recordBefore.files.map((file) => file.id),
    );
    expect(record.files.filter((file) => file.filename !== BOARD)).toHaveLength(
      2,
    );
    expect(canvasFrame(record, created.id)).toMatchObject({
      width: 1440,
      height: 1024,
    });
    expect(canvasFrame(record, home.id), "Home did not move").toEqual(
      canvasFrame(recordBefore, home.id),
    );
    expectOnlyChanged(homeBefore, await app.savedNodes(id), []);
  });

  test("step 18: Cmd+D three times on Card produces 4 identically-named copies, each directly above the previous, ending selection on the newest copy", async ({
    app,
  }) => {
    const id = await openSeeded(app, MOBILE_HOME_HTML);
    await clickDesign(app, 316, 180);
    await expect.poll(() => app.selectedLayers()).toEqual(["Card"]);
    const before = await app.savedNodes(id);

    const copies: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      await app.page.keyboard.press(`${MOD}+d`);
      await expect
        .poll(async () => idsNamed(await app.savedNodes(id), "Card").length, {
          message: `after duplicate #${i}`,
        })
        .toBe(i + 1);
      const now = await app.savedNodes(id);
      copies.push(
        idsNamed(now, "Card").find(
          (cardId) => cardId !== "card" && !copies.includes(cardId),
        )!,
      );
    }
    await app.settled();

    const after = await app.savedNodes(id);
    expect(
      childrenOf(after, bodyId(after)),
      "each copy sits directly above the one it duplicated",
    ).toEqual(["header", "card", ...copies]);
    const original = before.get("card")!;
    const copiedTitles: string[] = [];
    for (const copy of copies) {
      expect(after.get(copy)?.attrs.style).toBe(original.attrs.style);
      const [title] = childrenOf(after, copy);
      copiedTitles.push(title);
      expect(after.get(title)).toMatchObject({
        text: "Sunrise Cafe",
        attrs: { "data-agent-native-layer-name": "Sunrise Cafe" },
      });
    }
    expectOnlyChanged(before, after, [...copies, ...copiedTitles]);
    await expandAllLayers(app.page);
    await expect
      .poll(
        () => selectedRowsNamed(app, "Card"),
        "the newest copy is the top row and the selection",
      )
      .toEqual([0]);
  });

  test("step 20: renaming one duplicate's title in the Layers panel only changes that layer, leaving Header's greeting and the original Card untouched", async ({
    app,
  }) => {
    const id = await openSeeded(app, MOBILE_HOME_HTML);
    await clickDesign(app, 316, 180);
    await expect.poll(() => app.selectedLayers()).toEqual(["Card"]);
    await app.page.keyboard.press(`${MOD}+d`);
    await expect
      .poll(async () => idsNamed(await app.savedNodes(id), "Card").length)
      .toBe(2);
    await app.settled();
    const duplicated = await app.savedNodes(id);
    const copy = idsNamed(duplicated, "Card").find(
      (cardId) => cardId !== "card",
    )!;
    const [copyTitle] = childrenOf(duplicated, copy);

    const tree = app.page.getByRole("tree", { name: "Layers" });
    await expandAllLayers(app.page);
    const titleRows = tree.locator(
      '[data-layer-row-button]:has(span[title="Sunrise Cafe"])',
    );
    await expect(titleRows).toHaveCount(2);
    await titleRows.first().dblclick();
    const renameInput = tree.locator("input").first();
    await renameInput.fill("Green Bowl");
    await renameInput.press("Enter");

    await expect
      .poll(
        async () =>
          (await app.savedNodes(id)).get(copyTitle)?.attrs[
            "data-agent-native-layer-name"
          ],
      )
      .toBe("Green Bowl");
    await app.settled();
    const renamed = await app.savedNodes(id);
    expect(
      renamed.get("cardtitle")?.attrs["data-agent-native-layer-name"],
    ).toBe("Sunrise Cafe");
    expect(
      renamed.get(copyTitle)?.text,
      "renaming a layer leaves its text alone",
    ).toBe("Sunrise Cafe");
    expectOnlyChanged(duplicated, renamed, [copyTitle]);
    await expect(
      tree.locator('[data-layer-row-button] span[title="Green Bowl"]'),
    ).toHaveCount(1);
    await expect(
      tree.locator('[data-layer-row-button] span[title="Sunrise Cafe"]'),
    ).toHaveCount(1);
  });

  // fixme: fails on current main after the merge: Error: saved design has no __board__.html
  test.fixme("dragging Card out of the Home screen onto the board reparents it to the board, and one undo restores it inside Home at the exact original position", async ({
    app,
  }) => {
    const id = await openSeeded(app, MOBILE_HOME_HTML);
    const grab = await clickDesign(app, 195, 150);
    await expect.poll(() => app.selectedLayers()).toEqual(["Card"]);
    const home = await app.savedNodes(id);
    const board = await app.savedNodes(id, BOARD);
    const release = await emptyBoardPoint(app);

    await app.page.mouse.move(grab.x, grab.y);
    await app.page.mouse.down();
    await app.page.mouse.move(grab.x + 20, grab.y, { steps: 5 });
    await app.page.mouse.move(release.x, release.y, { steps: 30 });
    await app.page.mouse.up();

    await expect
      .poll(async () => (await app.savedNodes(id, BOARD)).get("card")?.parent)
      .toBe(bodyId(board));
    await app.settled();
    const homeAfter = await app.savedNodes(id);
    const boardAfter = await app.savedNodes(id, BOARD);
    expect(
      homeAfter.has("card") || homeAfter.has("cardtitle"),
      "Card left Home with its title",
    ).toBe(false);
    expect(childrenOf(boardAfter, "card")).toEqual(["cardtitle"]);
    expect(styleOf(boardAfter.get("card"))).toMatchObject({
      position: "absolute",
      width: "358px",
      height: "100px",
    });
    expectOnlyChanged(home, homeAfter, ["card", "cardtitle"]);
    expectOnlyChanged(board, boardAfter, ["card", "cardtitle"]);
    const dropped = (await app.page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="card"]')
      .boundingBox())!;
    expectNear(dropped.x + dropped.width / 2, release.x, "dropped centre x", 5);
    expectNear(
      dropped.y + dropped.height / 2,
      release.y,
      "dropped centre y",
      5,
    );

    await app.page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => (await app.savedNodes(id)).get("card")?.parent)
      .toBe(bodyId(home));
    await app.settled();
    expectOnlyChanged(home, await app.savedNodes(id), []);
    expectOnlyChanged(board, await app.savedNodes(id, BOARD), []);
    expect(await app.designRect("card")).toEqual({
      x: 16,
      y: 100,
      width: 358,
      height: 100,
    });
  });
});

test.describe("landing page build", () => {
  test('step 18: alt-dragging HeroImage duplicates it (original stays put, copy moves, copy is selected); one undo ("undo the nudge") removes the copy and restores the original selection', async ({
    app,
  }) => {
    const id = await openSeeded(app, LANDING_HTML);
    const grab = await clickDesign(app, 1080, 400);
    await expect.poll(() => app.selectedLayers()).toEqual(["HeroImage"]);
    const before = await app.savedNodes(id);
    const to = await app.pagePoint(1140, 440);

    await app.page.mouse.move(grab.x, grab.y);
    await app.page.keyboard.down("Alt");
    await app.page.mouse.down();
    await app.page.mouse.move(to.x, to.y, { steps: 12 });
    await app.page.mouse.up();
    await app.page.keyboard.up("Alt");

    await expect
      .poll(async () => idsNamed(await app.savedNodes(id), "HeroImage").length)
      .toBe(2);
    await app.settled();
    const after = await app.savedNodes(id);
    const copy = idsNamed(after, "HeroImage").find(
      (nodeId) => nodeId !== "heroimage",
    )!;
    expect(
      childrenOf(after, "hero"),
      "the copy sits directly above the original",
    ).toEqual(["heroimage", copy]);
    const {
      left,
      top,
      background: _copyBackground,
      ...rest
    } = styleOf(after.get(copy));
    const {
      left: _left,
      top: _top,
      background: _background,
      ...originalRest
    } = styleOf(before.get("heroimage"));
    expect(rest).toEqual(originalRest);
    expectNear(left, 860, "copy left");
    expectNear(top, 120, "copy top");
    await expect(app.node(copy)).toHaveCSS(
      "background-color",
      "rgb(229, 231, 235)",
    );
    expectOnlyChanged(before, after, [copy]);
    await expandAllLayers(app.page);
    await expect
      .poll(
        () => selectedRowsNamed(app, "HeroImage"),
        "the copy (top row) is selected",
      )
      .toEqual([0]);

    await app.page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => idsNamed(await app.savedNodes(id), "HeroImage"))
      .toEqual(["heroimage"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
    await expect.poll(() => app.selectedLayers()).toEqual(["HeroImage"]);
  });

  test("Shift+1 zooms to fit the Landing Page, and Shift+2 zooms in on the selected Navbar", async ({
    app,
  }) => {
    const id = await app.seed(LANDING_HTML);
    await app.open(id);
    const canvas = await visibleCanvas(app);
    const screen = app.page.locator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    );

    await app.zoomToFit();
    const fit = (await screen.boundingBox())!;
    expect(
      fit.x,
      "fit keeps the screen inside the canvas",
    ).toBeGreaterThanOrEqual(canvas.x);
    expect(fit.x + fit.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(fit.y).toBeGreaterThanOrEqual(canvas.y);
    expect(fit.y + fit.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    expect(
      Math.max(fit.width / canvas.width, fit.height / canvas.height),
      "fit fills the canvas on one axis",
    ).toBeGreaterThan(0.8);

    await clickDesign(app, 720, 60);
    await expect.poll(() => app.selectedLayers()).toEqual(["Navbar"]);
    await app.page.keyboard.press("Shift+2");
    let previous = "";
    await expect
      .poll(async () => {
        const now = JSON.stringify(await app.node("navbar").boundingBox());
        const stable = now === previous && now !== JSON.stringify(fit);
        previous = now;
        return stable;
      })
      .toBe(true);
    const navbar = (await app.node("navbar").boundingBox())!;
    expectNear(
      navbar.x + navbar.width / 2,
      canvas.x + canvas.width / 2,
      "Navbar centred horizontally",
      12,
    );
    expectNear(
      navbar.y + navbar.height / 2,
      canvas.y + canvas.height / 2,
      "Navbar centred vertically",
      12,
    );
    expect(
      navbar.width / canvas.width,
      "Navbar fills the canvas width",
    ).toBeGreaterThan(0.8);
    expect(navbar.width).toBeLessThanOrEqual(canvas.width);
  });
});
