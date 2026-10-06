import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
  installBridge,
  waitForBridge,
} from "./helpers";

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

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = e2eBaseURL();
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createFixture(request: APIRequestContext, html: string) {
  const created = await postAction(request, "create-design", {
    title: `Context menu ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: html,
    fileType: "html",
  });
  return designId as string;
}

async function rightClickNode(page: Page, nodeId: string) {
  const frame = designFrame(page);
  const node = frame.locator(`[data-agent-native-node-id="${nodeId}"]`);
  const point = await node.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await node.evaluate((_element, pt) => {
    document.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: pt.x,
        clientY: pt.y,
      }),
    );
  }, point);
  await waitForBridge(page, "element-contextmenu");
  await expect(page.getByRole("menu").last()).toBeVisible();
}

test.describe("parity: right-click canvas context menu (§17)", () => {
  test("right-click on a single element shows the Figma-standard items in the documented order, and Bring to front actually reorders (one undo restores)", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      await rightClickNode(page, "a");
      const menu = page.getByRole("menu").last();

      const expectedOrder = [
        "Copy",
        "Paste here",
        "Paste to replace",
        "Bring to front",
        "Send to back",
        "Group selection",
        "Frame selection",
        "Add auto layout",
        "Create component",
        "Hide",
        "Lock",
        "Flip horizontal",
        "Flip vertical",
      ];
      const items = menu.getByRole("menuitem");
      const itemCount = await items.count();
      const texts: string[] = [];
      for (let index = 0; index < itemCount; index += 1) {
        const label = await items.nth(index).evaluate((element) => {
          const primary = element.querySelector("span.flex-1");
          return (primary?.textContent ?? element.textContent ?? "").trim();
        });
        texts.push(label);
      }
      const seenInOrder = texts.filter((label) =>
        expectedOrder.includes(label),
      );
      expect(seenInOrder, `menu items were: ${JSON.stringify(texts)}`).toEqual(
        expectedOrder,
      );

      const frame = designFrame(page);
      const beforeOrder = await frame.locator("body").evaluate((body) =>
        Array.from(body.children)
          .map((el) => el.getAttribute("data-agent-native-node-id"))
          .filter(Boolean),
      );
      expect(beforeOrder.indexOf("a")).toBeLessThan(beforeOrder.indexOf("b"));

      await menu.getByText("Bring to front", { exact: true }).click();
      await expect
        .poll(async () =>
          frame.locator("body").evaluate((body) =>
            Array.from(body.children)
              .map((el) => el.getAttribute("data-agent-native-node-id"))
              .filter(Boolean),
          ),
        )
        .toEqual(expect.arrayContaining(["a", "b"]));
      const afterOrder = await frame.locator("body").evaluate((body) =>
        Array.from(body.children)
          .map((el) => el.getAttribute("data-agent-native-node-id"))
          .filter(Boolean),
      );
      expect(afterOrder.indexOf("a")).toBeGreaterThan(afterOrder.indexOf("b"));

      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      await expect
        .poll(async () =>
          frame.locator("body").evaluate((body) =>
            Array.from(body.children)
              .map((el) => el.getAttribute("data-agent-native-node-id"))
              .filter(Boolean)
              .indexOf("a"),
          ),
        )
        .toBeLessThan(
          await frame.locator("body").evaluate((body) =>
            Array.from(body.children)
              .map((el) => el.getAttribute("data-agent-native-node-id"))
              .filter(Boolean)
              .indexOf("b"),
          ),
        );

      await rightClickNode(page, "b");
      await page
        .getByRole("menu")
        .last()
        .getByText("Send to back", { exact: true })
        .click();
      await expect
        .poll(async () =>
          frame.locator("body").evaluate((body) =>
            Array.from(body.children)
              .map((el) => el.getAttribute("data-agent-native-node-id"))
              .filter(Boolean)
              .indexOf("b"),
          ),
        )
        .toBeLessThan(
          await frame.locator("body").evaluate((body) =>
            Array.from(body.children)
              .map((el) => el.getAttribute("data-agent-native-node-id"))
              .filter(Boolean)
              .indexOf("a"),
          ),
        );

      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      await expect
        .poll(async () =>
          frame.locator("body").evaluate((body) =>
            Array.from(body.children)
              .map((el) => el.getAttribute("data-agent-native-node-id"))
              .filter(Boolean)
              .indexOf("b"),
          ),
        )
        .toBeGreaterThan(
          await frame.locator("body").evaluate((body) =>
            Array.from(body.children)
              .map((el) => el.getAttribute("data-agent-native-node-id"))
              .filter(Boolean)
              .indexOf("a"),
          ),
        );
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("Rename is not offered on the canvas context menu (Figma parity) but is offered on the layer row's context menu", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      await rightClickNode(page, "a");
      const canvasMenu = page.getByRole("menu").last();
      await expect(canvasMenu).toBeVisible();
      await expect(
        canvasMenu.getByRole("menuitem", { name: /rename/i }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(canvasMenu).toBeHidden();

      await expandAllLayers(page);
      const rowButton = page
        .locator("[data-layer-row-button]")
        .filter({ has: page.locator('span[title="Box A"]') })
        .first();
      await rowButton.click({ button: "right" });
      const rowMenu = page.getByRole("menu").last();
      const rename = rowMenu.getByRole("menuitem", { name: /^Rename layer/ });
      await expect(rename).toBeVisible();
      await rename.click();
      const renameInput = page.getByRole("textbox", { name: /rename/i });
      await expect(renameInput).toBeVisible();
      await expect(renameInput).toHaveValue("Box A");
      await page.keyboard.press("Escape");
      await expect(renameInput).toBeHidden();
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("Select layer submenu label for an unnamed container matches the layers panel name, not the raw text content", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, NAME_MISMATCH_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);
      await expandAllLayers(page);

      await rightClickNode(page, "card");
      const menu = page.getByRole("menu").last();
      const trigger = menu.getByText("Select layer", { exact: true });
      await expect(trigger).toBeVisible();
      await trigger.hover();
      const submenu = page.getByRole("menu").last();

      const panelLabel = (
        (await page
          .locator(
            '[data-layer-row-content][data-layer-selection="primary"] [data-layer-row-button] span.flex-1',
          )
          .first()
          .textContent()) ?? ""
      ).trim();
      expect(panelLabel.length).toBeGreaterThan(0);

      await expect(
        submenu.getByText(panelLabel, { exact: true }),
      ).toBeVisible();
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("Edit with AI submenu label for the same unnamed container also matches the layers panel name", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, NAME_MISMATCH_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);
      await expandAllLayers(page);

      await rightClickNode(page, "card");
      const menu = page.getByRole("menu").last();
      const repromptTrigger = menu.getByText("Edit with AI…", {
        exact: true,
      });
      await expect(repromptTrigger).toBeVisible();
      await repromptTrigger.hover();
      const submenu = page.getByRole("menu").last();

      const panelLabel = (
        (await page
          .locator(
            '[data-layer-row-content][data-layer-selection="primary"] [data-layer-row-button] span.flex-1',
          )
          .first()
          .textContent()) ?? ""
      ).trim();
      expect(panelLabel.length).toBeGreaterThan(0);

      await expect(
        submenu.getByText(panelLabel, { exact: true }),
      ).toBeVisible();
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("menu item hover/focus background keeps the item text legible in light mode", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await page.emulateMedia({ colorScheme: "light" });
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      await rightClickNode(page, "a");
      const menu = page.getByRole("menu").last();
      const copyItem = menu.getByText("Copy", { exact: true });
      await copyItem.hover();

      const rowLocator = menu.getByRole("menuitem").filter({ hasText: "Copy" });
      const { bg, color } = await rowLocator.first().evaluate((element) => {
        const style = getComputedStyle(element);
        return { bg: style.backgroundColor, color: style.color };
      });

      function parseRgb(value: string): [number, number, number, number] {
        const match = value.match(
          /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/,
        );
        if (!match) return [255, 255, 255, 1];
        return [
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
          match[4] === undefined ? 1 : Number(match[4]),
        ];
      }
      function relativeLuminance([r, g, b]: [number, number, number]) {
        const channel = (c: number) => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      }

      // The focused row uses the shared panel hover token (a translucent tint)
      // with the regular foreground text. Composite the tint over an assumed
      // white menu surface to get the effective row color, then require
      // WCAG AA contrast (>= 4.5:1) between that and the computed text color.
      const [r, g, b, a] = parseRgb(bg);
      const surface: [number, number, number] = [255, 255, 255];
      const effective: [number, number, number] = [
        r * a + surface[0] * (1 - a),
        g * a + surface[1] * (1 - a),
        b * a + surface[2] * (1 - a),
      ];
      const [tr, tg, tb] = parseRgb(color);
      const bgLuminance = relativeLuminance(effective);
      const textLuminance = relativeLuminance([tr, tg, tb]);
      const lighter = Math.max(bgLuminance, textLuminance);
      const darker = Math.min(bgLuminance, textLuminance);
      const contrast = (lighter + 0.05) / (darker + 0.05);
      expect(
        contrast,
        `focus background ${bg} composited over white surface -> effective rgb(${effective.map((v) => Math.round(v)).join(",")}), contrast against item text ${color} was ${contrast.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("clears stale system clipboard paste availability while a new read is pending", async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      let deferNextRead = false;
      let resolvePendingRead:
        | ((
            items: Array<{
              types: string[];
              getType(type: string): Promise<Blob>;
            }>,
          ) => void)
        | undefined;
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
        value: () => {
          deferNextRead = true;
        },
      });
      Object.defineProperty(window, "__resolveClipboardRead", {
        value: () => resolvePendingRead?.([]),
      });
    });

    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      await rightClickNode(page, "a");
      const firstMenu = page.getByRole("menu").last();
      const firstPaste = firstMenu.getByRole("menuitem", {
        name: /Paste here/,
      });
      const firstReplace = firstMenu.getByRole("menuitem", {
        name: /Paste to replace/,
      });
      await expect(firstPaste).toBeEnabled();
      await expect(firstReplace).toBeEnabled();

      await page.keyboard.press("Escape");
      await expect(firstMenu).toBeHidden();
      await page.evaluate(() => {
        (
          window as unknown as { __deferClipboardRead: () => void }
        ).__deferClipboardRead();
      });

      await rightClickNode(page, "a");
      const secondMenu = page.getByRole("menu").last();
      await expect(
        secondMenu.getByRole("menuitem", { name: /Paste here/ }),
      ).toBeDisabled();
      await expect(
        secondMenu.getByRole("menuitem", { name: /Paste to replace/ }),
      ).toBeDisabled();
      await page.evaluate(() => {
        (
          window as unknown as { __resolveClipboardRead: () => void }
        ).__resolveClipboardRead();
      });
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("right-click on empty canvas (no selection) shows only Paste here and Show/Hide UI/comments", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      const frame = designFrame(page);
      const body = frame.locator("body");
      const point = await body.evaluate(() => ({
        x: window.innerWidth - 5,
        y: window.innerHeight - 5,
      }));
      await body.evaluate((_element, pt) => {
        document.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: pt.x,
            clientY: pt.y,
          }),
        );
      }, point);
      await waitForBridge(page, "element-contextmenu");
      const menu = page.getByRole("menu").last();
      await expect(menu.getByText("Paste here", { exact: true })).toBeVisible();
      const texts = (await menu.getByRole("menuitem").allTextContents()).map(
        (t) => t.trim(),
      );
      for (const forbidden of [
        "Select all",
        "Duplicate",
        "Delete",
        "Zoom to fit",
        "Copy",
      ]) {
        expect(texts).not.toContain(forbidden);
      }
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("Escape closes the context menu without applying anything", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      await rightClickNode(page, "a");
      const menu = page.getByRole("menu").last();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("clicking outside the menu closes it", async ({ page, request }) => {
    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      await rightClickNode(page, "a");
      const menu = page.getByRole("menu").last();
      await expect(menu).toBeVisible();
      await page.mouse.click(10, 10);
      await expect(page.getByRole("menu")).toHaveCount(0);
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });

  test("Group selection from the context menu groups two elements and one undo restores the ungrouped selection", async ({
    page,
    request,
  }) => {
    const designId = await createFixture(request, TWO_BOX_HTML);
    try {
      await gotoEditor(page, designId);
      await enterDirectMode(page);
      await installBridge(page);

      const frame = designFrame(page);
      const boxA = frame.locator('[data-agent-native-node-id="a"]');
      const boxB = frame.locator('[data-agent-native-node-id="b"]');
      await boxA.click({ force: true });
      await boxB.click({ force: true, modifiers: ["Shift"] });

      await rightClickNode(page, "b");
      const menu = page.getByRole("menu").last();
      const groupItem = menu.getByText("Group selection", { exact: true });
      await expect(groupItem).toBeEnabled();
      await groupItem.click({ force: true });

      await expect
        .poll(() =>
          frame.locator('body > [data-agent-native-node-id="a"]').count(),
        )
        .toBe(0);

      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );

      await expect
        .poll(() =>
          frame
            .locator(
              'body > [data-agent-native-node-id="a"], body > [data-agent-native-node-id="b"]',
            )
            .count(),
        )
        .toBe(2);

      const lastSelection = await page.evaluate(() => {
        const entries = (window as any).__designTrace?.entries?.() ?? [];
        const selects = entries.filter(
          (entry: { area: string }) => entry.area === "select",
        );
        return selects[selects.length - 1]?.data ?? null;
      });
      expect(lastSelection?.layers?.length).toBe(2);
    } finally {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
  });
});
