import { type Page } from "@playwright/test";

import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
} from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const NAME_MISMATCH_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Context menu fixture</title></head>
  <body style="margin:0;min-height:100vh;padding:20px">
    <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage" style="position:relative;width:400px;height:300px;background:#eee">
      <div data-agent-native-node-id="card" style="position:absolute;left:40px;top:40px;width:300px;height:200px;background:#fff"><span>Tiana</span></div>
    </div>
  </body>
</html>`;

const TWO_BOX_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Context menu fixture 2</title></head>
  <body style="margin:0;min-height:100vh;padding:20px">
    <div data-agent-native-node-id="a" data-agent-native-layer-name="Box A" style="position:absolute;left:20px;top:20px;width:120px;height:120px;background:#bfdbfe">A</div>
    <div data-agent-native-node-id="b" data-agent-native-layer-name="Box B" style="position:absolute;left:220px;top:20px;width:120px;height:120px;background:#fecaca">B</div>
  </body>
</html>`;

const ELEMENT_MENU = [
  "Edit with Agent",
  "Send to",
  "Copy link",
  "Copy",
  "Paste to replace",
  "Copy/Paste as",
  "Rename",
  "Frame selection",
  "Add auto layout",
  "Create component",
  "Hide",
  "Lock",
  "Arrange",
  "Transform",
];

const ARRANGE_MENU = ["Bring to front", "Send to back"];

async function openFixture(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function centreOf(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  return app.pagePoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

async function rightClick(app: App, nodeId: string) {
  const point = await centreOf(app, nodeId);
  await app.page.mouse.click(point.x, point.y, { button: "right" });
  const menu = app.page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  return menu;
}

async function openArrange(app: App) {
  await app.page
    .getByRole("menu")
    .last()
    .getByRole("menuitem", { name: "Arrange" })
    .hover();
  await expect(app.page.getByRole("menu")).toHaveCount(2);
}

async function clickNode(app: App, nodeId: string) {
  const point = await centreOf(app, nodeId);
  await app.page.mouse.click(point.x, point.y);
}

/** Item labels of the innermost open menu, without their shortcut hints. */
function menuLabels(page: Page) {
  return page
    .getByRole("menu")
    .last()
    .getByRole("menuitem")
    .evaluateAll((items) =>
      items.map((item) =>
        (
          item.querySelector("span.flex-1")?.textContent ??
          item.textContent ??
          ""
        ).trim(),
      ),
    );
}

/** Parses the computed colours Chrome serialises: rgb()/rgba() and color(srgb r g b / a). */
function parseColour(value: string): [number, number, number, number] {
  const rgb = value.match(
    /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/,
  );
  if (rgb)
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  const srgb = value.match(
    /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/,
  );
  if (srgb) {
    return [
      Number(srgb[1]) * 255,
      Number(srgb[2]) * 255,
      Number(srgb[3]) * 255,
      srgb[4] === undefined ? 1 : Number(srgb[4]),
    ];
  }
  throw new Error(`unparsed computed colour: ${value}`);
}

function luminance([r, g, b]: number[]) {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

test.describe("interaction: right-click canvas context menu", () => {
  test("right-click on a single element shows the canvas menu items in order, and Bring to front reorders (one undo restores)", async ({
    app,
  }) => {
    const id = await openFixture(app, TWO_BOX_HTML);
    const before = await app.savedNodes(id);
    const body = before.get("a")!.parent!;
    expect(childrenOf(before, body)).toStrictEqual(["a", "b"]);

    await rightClick(app, "a");

    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    expect(await menuLabels(app.page)).toStrictEqual(ELEMENT_MENU);
    await openArrange(app);
    expect(await menuLabels(app.page)).toStrictEqual(ARRANGE_MENU);
    await app.page
      .getByRole("menu")
      .last()
      .getByText("Bring to front", { exact: true })
      .click();
    await app.settled();
    const fronted = await app.savedNodes(id);
    expect(childrenOf(fronted, body)).toStrictEqual(["b", "a"]);
    expectOnlyChanged(before, fronted, []);

    await app.page.keyboard.press(`${MOD}+z`);
    await app.settled();
    expect(childrenOf(await app.savedNodes(id), body)).toStrictEqual([
      "a",
      "b",
    ]);

    await rightClick(app, "b");
    await openArrange(app);
    await app.page
      .getByRole("menu")
      .last()
      .getByText("Send to back", { exact: true })
      .click();
    await app.settled();
    expect(childrenOf(await app.savedNodes(id), body)).toStrictEqual([
      "b",
      "a",
    ]);

    await app.page.keyboard.press(`${MOD}+z`);
    await app.settled();
    const restored = await app.savedNodes(id);
    expect(childrenOf(restored, body)).toStrictEqual(["a", "b"]);
    expectOnlyChanged(before, restored, []);
  });

  test("Rename is on both the canvas context menu and the layer row's context menu", async ({
    app,
  }) => {
    const id = await openFixture(app, TWO_BOX_HTML);
    await rightClick(app, "a");
    expect(
      (await menuLabels(app.page)).filter((label) => label === "Rename"),
    ).toHaveLength(1);
    await app.page.keyboard.press("Escape");
    await expect(app.page.getByRole("menu")).toHaveCount(0);
    const before = await app.savedNodes(id);

    await app.page
      .getByRole("tree", { name: "Layers" })
      .locator(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
      )
      .click({ button: "right" });
    await app.page
      .getByRole("menu")
      .last()
      .getByRole("menuitem", { name: /^Rename/ })
      .click();
    const renameInput = app.page.getByRole("textbox", { name: /rename/i });
    await expect(renameInput).toHaveValue("Box A");
    await renameInput.fill("Hero box");
    await renameInput.press("Enter");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.get("a")?.attrs["data-agent-native-layer-name"]).toBe(
      "Hero box",
    );
    expectOnlyChanged(before, after, ["a"]);
  });

  test("Select layer submenu label for an unnamed container matches the layers panel name, not the raw text content", async ({
    app,
  }) => {
    await openFixture(app, NAME_MISMATCH_HTML);
    const menu = await rightClick(app, "card");
    await expect.poll(() => app.selectedLayers()).toEqual(["Frame"]);

    await menu.getByText("Select layer", { exact: true }).hover();

    await expect(app.page.getByRole("menu")).toHaveCount(2);
    expect(await menuLabels(app.page)).toStrictEqual(["Frame", "Stage"]);
  });

  test("menu item hover/focus background keeps the item text legible in light mode", async ({
    app,
  }) => {
    await app.page.emulateMedia({ colorScheme: "light" });
    await openFixture(app, TWO_BOX_HTML);
    const menu = await rightClick(app, "a");
    const copy = menu.getByRole("menuitem").filter({ hasText: "Copy" }).first();
    const colours = () =>
      copy.evaluate((element) => {
        const style = getComputedStyle(element);
        return { bg: style.backgroundColor, text: style.color };
      });
    const resting = await colours();

    await copy.hover();

    await expect
      .poll(async () => (await colours()).bg, {
        message: "hovering tints the row",
      })
      .not.toBe(resting.bg);
    const { bg, text } = await colours();
    const [r, g, b, a] = parseColour(bg);
    // The menu surface is white in light mode; composite the translucent tint over it.
    const row = [
      r * a + 255 * (1 - a),
      g * a + 255 * (1 - a),
      b * a + 255 * (1 - a),
    ];
    const [lighter, darker] = [
      luminance(row),
      luminance(parseColour(text)),
    ].sort((x, y) => y - x);
    const contrast = (lighter! + 0.05) / (darker! + 0.05);
    expect(
      contrast,
      `row ${bg} over white vs text ${text}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("clears stale system clipboard paste availability while a new read is pending", async ({
    app,
  }) => {
    await app.page.addInitScript(() => {
      let deferNextRead = false;
      let resolvePendingRead: ((items: unknown[]) => void) | undefined;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          read: () => {
            if (deferNextRead) {
              deferNextRead = false;
              return new Promise((resolve) => {
                resolvePendingRead = resolve;
              });
            }
            return Promise.resolve([
              {
                types: ["image/png"],
                getType: async () => new Blob(["image"], { type: "image/png" }),
              },
            ]);
          },
        },
      });
      Object.defineProperty(window, "__deferClipboardRead", {
        value: () => (deferNextRead = true),
      });
      Object.defineProperty(window, "__resolveClipboardRead", {
        value: () => resolvePendingRead?.([]),
      });
    });
    await openFixture(app, TWO_BOX_HTML);
    const firstMenu = await rightClick(app, "a");
    await expect(
      firstMenu.getByRole("menuitem", { name: /Paste to replace/ }),
    ).toBeEnabled();
    await app.page.keyboard.press("Escape");
    await expect(app.page.getByRole("menu")).toHaveCount(0);
    await app.page.evaluate(() =>
      (
        window as unknown as { __deferClipboardRead: () => void }
      ).__deferClipboardRead(),
    );

    const secondMenu = await rightClick(app, "a");

    await expect(
      secondMenu.getByRole("menuitem", { name: /Paste to replace/ }),
    ).toBeDisabled();
    await app.page.evaluate(() =>
      (
        window as unknown as { __resolveClipboardRead: () => void }
      ).__resolveClipboardRead(),
    );
    await expect(
      secondMenu.getByRole("menuitem", { name: /Paste to replace/ }),
      "an empty clipboard keeps paste off",
    ).toBeDisabled();
  });

  test("right-click on empty canvas (no selection) shows Explore with Agent, Copy link, Paste here and Show/Hide UI/comments", async ({
    app,
  }) => {
    await openFixture(app, TWO_BOX_HTML);
    await expect.poll(() => app.selectedLayers()).toEqual([]);
    const screen = (await app.page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;

    await app.page.mouse.click(screen.x - 60, screen.y + screen.height / 2, {
      button: "right",
    });

    await expect(app.page.getByRole("menu").last()).toBeVisible();
    expect(await menuLabels(app.page)).toStrictEqual([
      "Explore with Agent",
      "Copy link",
      "Paste here",
      "Hide UI",
      "Hide comments",
    ]);
  });

  test("Escape closes the context menu without applying anything", async ({
    app,
  }) => {
    const id = await openFixture(app, TWO_BOX_HTML);
    const before = await app.savedNodes(id);
    const menu = await rightClick(app, "a");
    await menu.getByRole("menuitem", { name: /^Hide/ }).focus();

    await app.page.keyboard.press("Escape");

    await expect(app.page.getByRole("menu")).toHaveCount(0);
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("clicking outside the menu closes it", async ({ app }) => {
    const id = await openFixture(app, TWO_BOX_HTML);
    const before = await app.savedNodes(id);
    await rightClick(app, "a");
    const screen = (await app.page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;

    await app.page.mouse.click(screen.x - 60, screen.y + screen.height / 2);

    await expect(app.page.getByRole("menu")).toHaveCount(0);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("Group selection from the context menu groups two elements and one undo restores the ungrouped selection", async ({
    app,
  }) => {
    const id = await openFixture(app, TWO_BOX_HTML);
    await clickNode(app, "a");
    await app.page.keyboard.down("Shift");
    await clickNode(app, "b");
    await app.page.keyboard.up("Shift");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box B", "Box A"]);
    const before = await app.savedNodes(id);
    const body = before.get("a")!.parent!;

    const menu = await rightClick(app, "b");
    await menu.getByText("Group selection", { exact: true }).click();
    await app.settled();

    const grouped = await app.savedNodes(id);
    const groupId = grouped.get("a")!.parent!;
    expect(childrenOf(grouped, body)).toStrictEqual([groupId]);
    expect(childrenOf(grouped, groupId)).toStrictEqual(["a", "b"]);
    expect(grouped.get(groupId)!.attrs).toEqual({
      "data-agent-native-node-id": groupId,
      "data-agent-native-layer-name": "Group",
      "data-agent-native-group": "true",
      "data-agent-native-group-wrapper": "true",
      "data-agent-native-preserve-styles": "true",
      style:
        "position: absolute; left: 20px; top: 20px; width: 320px; height: 120px;",
    });
    expect(styleOf(grouped.get("a"))).toMatchObject({
      left: "0px",
      top: "0px",
    });
    expect(styleOf(grouped.get("b"))).toMatchObject({
      left: "200px",
      top: "0px",
    });
    expectOnlyChanged(before, grouped, ["a", "b", groupId]);
    await expect.poll(() => app.selectedLayers()).toEqual(["Group"]);

    await app.page.keyboard.press(`${MOD}+z`);
    await app.settled();

    const undone = await app.savedNodes(id);
    expect(childrenOf(undone, body)).toStrictEqual(["a", "b"]);
    expectOnlyChanged(before, undone, []);
    await expect.poll(() => app.selectedLayers()).toEqual(["Box B", "Box A"]);
  });
});
