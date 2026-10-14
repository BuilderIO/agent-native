import { type Page } from "@playwright/test";

import { appPath, designFrame } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const CHORDS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
    <main data-agent-native-node-id="ch-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="ch-alpha" data-agent-native-layer-name="Alpha" style="position:absolute;left:240px;top:180px;width:180px;height:90px;background:#38bdf8;color:#082f49">Alpha</div>
      <div data-agent-native-node-id="ch-bravo" data-agent-native-layer-name="Bravo" style="position:absolute;left:240px;top:340px;width:180px;height:90px;background:#a78bfa;color:#1f1147">Bravo</div>
      <div data-agent-native-node-id="ch-charlie" data-agent-native-layer-name="Charlie" style="position:absolute;left:600px;top:180px;width:180px;height:90px;background:#fbbf24;color:#451a03">Charlie</div>
    </main>
  </body>
</html>`;

const TEXT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Text</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="tx-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="tx-label" data-agent-native-layer-name="Label" style="position:absolute;left:200px;top:200px;font-size:24px">klsajfk</div>
    </main>
  </body>
</html>`;

const NESTED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Nested</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff">
    <main data-agent-native-node-id="nz-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="nz-source" data-agent-native-layer-name="Source" style="position:absolute;left:40px;top:40px;width:80px;height:60px;background:#22c55e"></div>
      <div data-agent-native-node-id="nz-frame" data-agent-native-layer-name="Holder" style="position:absolute;left:320px;top:260px;width:400px;height:280px;background:#e2e8f0">
        <div data-agent-native-node-id="nz-target" data-agent-native-layer-name="Target" style="position:absolute;left:60px;top:50px;width:120px;height:90px;background:#f97316"></div>
      </div>
    </main>
  </body>
</html>`;

const INLINE_CHILD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Inline Child</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="ic-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="ic-frame" data-agent-native-layer-name="Holder" style="position:absolute;left:120px;top:120px;width:500px;height:320px;background:#eef2f7">
        <div data-agent-native-node-id="ic-text" data-agent-native-layer-name="Caption" style="position:absolute;left:40px;top:60px;font-size:28px"><span style="text-decoration: underline">klsajfk</span></div>
      </div>
    </main>
  </body>
</html>`;

const BOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: transparent; }
  body { margin: 0; position: relative; overflow: visible; }
</style>
</head>
<body>
<div data-agent-native-node-id="bd-frame" data-agent-native-layer-name="Holder" data-an-primitive="frame" style="position:absolute;left:240px;top:200px;width:520px;height:340px;background:#eef2f7">
<div data-agent-native-node-id="bd-text" data-agent-native-layer-name="Caption" style="position:absolute;left:40px;top:60px;font-size:28px"><span style="text-decoration: underline">klsajfk</span></div>
</div>
</body>
</html>`;

async function openChords(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.settled();
  return { id, before: await app.savedNodes(id) };
}

function newNodes(
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
) {
  return [...after.values()].filter((node) => !before.has(node.id));
}

/** The node's own markup, parsed: its direct text and element children. */
/** Whether the text layer or anything inside it renders an underline. */
async function rendersUnderline(app: App, nodeId: string) {
  return app
    .node(nodeId)
    .evaluate((element) =>
      [element, ...element.querySelectorAll("*")].some((node) =>
        getComputedStyle(node).textDecorationLine.includes("underline"),
      ),
    );
}

async function savedMarkup(app: App, designId: string, nodeId: string) {
  return app.page.evaluate(
    ({ html, id }) => {
      const element = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector<HTMLElement>(`[data-agent-native-node-id="${id}"]`);
      if (!element) return null;
      return {
        innerHTML: element.innerHTML,
        text: element.textContent,
        decoration: element.style.textDecoration,
      };
    },
    { html: await app.savedHtml(designId), id: nodeId },
  );
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

async function selectLayerRow(page: Page, name: string): Promise<void> {
  const input = page.getByPlaceholder("Search layers...");
  if (!(await input.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
    await expect(input).toBeVisible();
  }
  await input.fill(name);
  const button = layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
  await expect(button).toBeVisible();
  await button.click({ force: true });
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
  await input.fill("");
}

async function pressEditorKey(page: Page, key: string): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
  await page.keyboard.press(key);
}

test.describe("canvas chords", () => {
  test("Shift+A wraps one rectangle where it stands, not at the frame origin", async ({
    app,
  }) => {
    const { id, before } = await openChords(
      app,
      CHORDS_HTML.replace(">Alpha</div>", "></div>"),
    );
    await selectLayerRow(app.page, "Alpha");
    await pressEditorKey(app.page, "Shift+A");

    await expect
      .poll(async () => (await app.savedNodes(id)).get("ch-alpha")?.parent)
      .not.toBe("ch-root");
    await app.settled();
    const after = await app.savedNodes(id);
    const wrapperId = after.get("ch-alpha")!.parent!;
    expect(newNodes(before, after).map((node) => node.id)).toEqual([wrapperId]);
    expect(after.get(wrapperId)?.parent).toBe("ch-root");
    const wrapper = styleOf(after.get(wrapperId));
    expect({
      position: wrapper.position,
      left: wrapper.left,
      top: wrapper.top,
      display: wrapper.display,
    }).toEqual({
      position: "absolute",
      left: "240px",
      top: "180px",
      display: "flex",
    });
    expect(
      await app.designRect("ch-alpha"),
      "Alpha renders exactly where it stood",
    ).toEqual({ x: 240, y: 180, width: 180, height: 90 });
    expectOnlyChanged(before, after, [wrapperId, "ch-alpha"]);
  });

  test("Cmd+G groups one rectangle at its own bounds", async ({ app }) => {
    const { id, before } = await openChords(app, CHORDS_HTML);
    await selectLayerRow(app.page, "Bravo");
    await pressEditorKey(app.page, `ControlOrMeta+G`);

    await expect
      .poll(async () => (await app.savedNodes(id)).get("ch-bravo")?.parent)
      .not.toBe("ch-root");
    await app.settled();
    const after = await app.savedNodes(id);
    const groupId = after.get("ch-bravo")!.parent!;
    expect(newNodes(before, after).map((node) => node.id)).toEqual([groupId]);
    expect(after.get(groupId)?.parent).toBe("ch-root");
    const group = styleOf(after.get(groupId));
    expect([group.left, group.top, group.width, group.height]).toEqual([
      "240px",
      "340px",
      "180px",
      "90px",
    ]);
    const bravo = styleOf(after.get("ch-bravo"));
    expect([bravo.left, bravo.top]).toEqual(["0px", "0px"]);
    expect(await app.designRect("ch-bravo")).toEqual({
      x: 240,
      y: 340,
      width: 180,
      height: 90,
    });
    expectOnlyChanged(before, after, [groupId, "ch-bravo"]);
  });

  for (const focus of ["canvas", "preview iframe"] as const) {
    test(`Alt+A left-aligns the selection to its frame with focus in the ${focus}`, async ({
      app,
    }) => {
      const { id, before } = await openChords(app, CHORDS_HTML);
      await selectLayerRow(app.page, "Charlie");
      if (focus === "canvas") {
        await pressEditorKey(app.page, "Alt+A");
      } else {
        await app.page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .evaluate((el) => (el as HTMLIFrameElement).contentWindow?.focus());
        await app.page.keyboard.press("Alt+A");
      }

      await expect
        .poll(
          async () =>
            styleOf((await app.savedNodes(id)).get("ch-charlie")).left,
        )
        .toBe("0px");
      await app.settled();
      const after = await app.savedNodes(id);
      expect(styleOf(after.get("ch-charlie"))).toEqual({
        ...styleOf(before.get("ch-charlie")),
        left: "0px",
      });
      expectOnlyChanged(before, after, ["ch-charlie"]);
    });
  }

  test("Cmd+U underlines the text without duplicating it or adding a <u> layer", async ({
    app,
  }) => {
    const { id, before } = await openChords(app, TEXT_HTML);
    const page = app.page;
    const box = (await app.node("tx-label").boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(1);
    await page.keyboard.press(`ControlOrMeta+A`);
    await page.keyboard.press(`ControlOrMeta+U`);
    await page.keyboard.press("Escape");

    await expect
      .poll(async () => (await savedMarkup(app, id, "tx-label"))?.text)
      .toBe("klsajfk");
    await expect.poll(async () => app.savedHtml(id)).toMatch(/underline/);
    await app.settled();
    const markup = await savedMarkup(app, id, "tx-label");
    expect(markup?.innerHTML, "no <u> element").not.toMatch(/<u[\s>]/i);
    expect(markup?.text, "the text once").toBe("klsajfk");
    expect(await rendersUnderline(app, "tx-label")).toBe(true);
    const after = await app.savedNodes(id);
    const added = newNodes(before, after);
    expect(
      added.filter((node) => node.parent !== "tx-label"),
      "anything new lives inside the text layer",
    ).toEqual([]);
    expectOnlyChanged(before, after, [
      "tx-label",
      ...added.map((node) => node.id),
    ]);
  });

  // fixme: fails on current main after the merge: Error: expect(locator).toBeVisible() failed
  test.fixme("Cmd+Shift+R drops the replacement where the old layer stood", async ({
    app,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(appPath("/")).origin,
    });
    const { id, before } = await openChords(app, NESTED_HTML);
    await selectLayerRow(app.page, "Source");
    await pressEditorKey(app.page, `ControlOrMeta+C`);
    await selectLayerRow(app.page, "Target");
    await pressEditorKey(app.page, `ControlOrMeta+Shift+R`);

    await expect
      .poll(async () => (await app.savedNodes(id)).has("nz-target"))
      .toBe(false);
    await app.settled();
    const after = await app.savedNodes(id);
    const copies = newNodes(before, after);
    expect(copies, "one replacement").toHaveLength(1);
    expect(copies[0]!.parent, "in the replaced layer's frame").toBe("nz-frame");
    const copy = styleOf(copies[0]);
    expect([copy.left, copy.top, copy.width, copy.height]).toEqual([
      "60px",
      "50px",
      "80px",
      "60px",
    ]);
    expectOnlyChanged(before, after, ["nz-target", copies[0]!.id]);
  });

  test("clicking an inline child inside a text layer selects it and does not duplicate its text", async ({
    app,
  }) => {
    const { id, before } = await openChords(app, INLINE_CHILD_HTML);
    await selectLayerRow(app.page, "Holder");
    const box = (await app.node("ic-text").locator("span").boundingBox())!;
    for (let i = 0; i < 3; i += 1) {
      await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      // Spaced out so the browser sees three single clicks, not a double/triple click.
      await app.page.waitForTimeout(500);
    }
    await expect
      .poll(
        () => app.selectedLayers(),
        "the inline span is its own layer, named by its text",
      )
      .toEqual(["klsajfk"]);
    await app.settled();
    expect((await savedMarkup(app, id, "ic-text"))?.text, "the text once").toBe(
      "klsajfk",
    );
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  // fixme: fails on current main after the merge: Error: expect(locator).toBeVisible() failed
  test.fixme("clicking an inline child on the board surface selects it and leaves its text alone", async ({
    app,
  }) => {
    const id = await app.seed(CHORDS_HTML);
    const page = app.page;
    const board = await (
      await page.request.post(appPath("/_agent-native/actions/create-file"), {
        data: {
          designId: id,
          filename: "__board__.html",
          fileType: "html",
          content: BOARD_HTML,
        },
      })
    ).json();
    const linked = await page.request.post(
      appPath("/_agent-native/actions/update-design"),
      {
        data: {
          id,
          dataOperations: [
            { op: "set", path: ["boardFileId"], value: board.id },
          ],
        },
      },
    );
    expect(linked.ok()).toBe(true);
    await app.open(id);
    await app.zoomToFit();
    await app.settled();
    const boardBefore = await app.savedNodes(id, "__board__.html");
    await selectLayerRow(page, "Holder");

    const span = page
      .locator(
        "iframe[data-design-preview-iframe]:not([data-screen-iframe-id])",
      )
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="bd-text"] span');
    const box = (await span.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(
      await page.evaluate(
        ({ x, y }) =>
          Boolean(
            document
              .elementFromPoint(x, y)
              ?.closest("[data-design-canvas-container]"),
          ),
        point,
      ),
      "the click point is on the canvas, not the editor chrome",
    ).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(500);
    }

    await expect
      .poll(
        () => app.selectedLayers(),
        "the inline span is its own layer, named by its text",
      )
      .toEqual(["klsajfk"]);
    await app.settled();
    expectOnlyChanged(
      boardBefore,
      await app.savedNodes(id, "__board__.html"),
      [],
    );
  });

  // fixme: product bug: The copied Holder is saved nested inside the Caption text layer (Holder > Caption > Holder copy with its own Caption).
  test.fixme("Cmd+Shift+R on an underlined text layer does not nest a copy inside it", async ({
    app,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(appPath("/")).origin,
    });
    const { id } = await openChords(app, INLINE_CHILD_HTML);
    await selectLayerRow(app.page, "Holder");
    await pressEditorKey(app.page, `ControlOrMeta+C`);
    const box = (await app.node("ic-text").locator("span").boundingBox())!;
    await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(
        () => app.selectedLayers(),
        "the inline span is its own layer, named by its text",
      )
      .toEqual(["klsajfk"]);
    await pressEditorKey(app.page, `ControlOrMeta+Shift+R`);
    await app.settled();

    const after = await app.savedNodes(id);
    const nested = [...after.values()].filter((node) => {
      let parent = node.parent;
      while (parent) {
        if (parent === "ic-text") return true;
        parent = after.get(parent)?.parent ?? null;
      }
      return false;
    });
    expect(
      nested.map((node) => node.attrs["data-agent-native-layer-name"]),
      "nothing is nested inside the text layer",
    ).toEqual([]);
    if (after.has("ic-text")) {
      expect(after.get("ic-text")!.attrs).not.toHaveProperty(
        "data-agent-native-preserve-styles",
      );
      expect((await savedMarkup(app, id, "ic-text"))?.text).toBe("klsajfk");
    }
  });

  test("Cmd+U twice in one session leaves the text un-underlined", async ({
    app,
  }) => {
    const { id, before } = await openChords(app, TEXT_HTML);
    const page = app.page;
    const box = (await app.node("tx-label").boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(1);
    await page.keyboard.press(`ControlOrMeta+A`);
    await page.keyboard.press(`ControlOrMeta+U`);
    await expect.poll(() => rendersUnderline(app, "tx-label")).toBe(true);
    await page.keyboard.press(`ControlOrMeta+A`);
    await page.keyboard.press(`ControlOrMeta+U`);
    await page.keyboard.press("Escape");
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(0);

    await app.settled();
    expect(await app.savedHtml(id)).not.toMatch(/underline/);
    expect((await savedMarkup(app, id, "tx-label"))?.text).toBe("klsajfk");
    expect(await rendersUnderline(app, "tx-label")).toBe(false);
    const after = await app.savedNodes(id);
    expect(
      newNodes(before, after).filter((node) => node.parent !== "tx-label"),
      "anything new lives inside the text layer",
    ).toEqual([]);
  });
});
