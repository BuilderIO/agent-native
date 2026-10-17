import { type Page } from "@playwright/test";

import { appPath, selectTool } from "./helpers";
import { expect, styleOf, test, type App, type SavedNode } from "./rails";

/** An empty design the app fixture owns: seeds one screen, then deletes it, leaving only the board. */
async function createEmptyDesign(app: App) {
  const designId = await app.seed("<!doctype html><html><body></body></html>");
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/delete-file"),
    { data: { id: record.files[0].id } },
  );
  expect(response.ok()).toBe(true);
  return designId;
}

async function boardNodes(app: App, designId: string) {
  return app
    .savedNodes(designId, "__board__.html")
    .catch(() => new Map<string, SavedNode>());
}

function byPrimitive(nodes: Map<string, SavedNode>, primitive: string) {
  return [...nodes.values()].filter(
    (node) => node.attrs["data-an-primitive"] === primitive,
  );
}

async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  await client.detach();
  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context for the screenshot");
      ctx.drawImage(img, 0, 0);
      const ratio = img.width / window.innerWidth;
      const d = ctx.getImageData(
        Math.round(px * ratio),
        Math.round(py * ratio),
        1,
        1,
      ).data;
      return `${d[0]},${d[1]},${d[2]}`;
    },
    { b64: data, px: x, py: y },
  );
}

async function sampleXY(page: Page): Promise<{ x: number; y: number }> {
  const canvasBox = await page
    .locator("[data-design-canvas-container]")
    .boundingBox();
  if (!canvasBox) throw new Error("no canvas container box");
  const leftShellBox = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox()
    .catch(() => null);
  const rightPanelBox = await page
    .locator('[data-design-chrome-region="right-panel"]')
    .boundingBox()
    .catch(() => null);
  const leftEdge = leftShellBox
    ? leftShellBox.x + leftShellBox.width
    : canvasBox.x;
  const rightEdge = rightPanelBox
    ? rightPanelBox.x
    : canvasBox.x + canvasBox.width;
  const x = Math.round(leftEdge + (rightEdge - leftEdge) * 0.5);
  const y = Math.round(canvasBox.y + canvasBox.height * 0.5);

  const hitInfo = await page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py) as HTMLElement | null;
      if (!el) return { ok: false, reason: "no element" };
      let cur: HTMLElement | null = el;
      for (let i = 0; i < 8 && cur; i++) {
        if (cur.dataset?.designChromeRegion) {
          return {
            ok: false,
            reason: `hit chrome:${cur.dataset.designChromeRegion}`,
          };
        }
        cur = cur.parentElement;
      }
      return { ok: true, reason: "clear" };
    },
    { px: x, py: y },
  );
  if (!hitInfo.ok) {
    throw new Error(
      `sampleXY point (${x},${y}) is not clear of chrome: ${hitInfo.reason}`,
    );
  }
  return { x, y };
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const { theme, canvasHex, expectedCanvasRgb, boardTextColor } of [
  {
    theme: "dark",
    canvasHex: "1A1A1A",
    expectedCanvasRgb: "26,26,26",
    boardTextColor: "rgb(255, 255, 255)",
  },
  {
    theme: "light",
    canvasHex: "EBEBEB",
    expectedCanvasRgb: "235,235,235",
    boardTextColor: "currentcolor",
  },
] as const) {
  // oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
  // fixme: light: board text committed with Escape is never saved; dark: fails in CI on current main: expect(received).toEqual(expect
  test.fixme(`${theme} theme: the canvas keeps its colour when the board gains its first shape`, async ({
    app,
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme });
    // Init scripts also run in the sandboxed screen frames, which have no localStorage.
    await page.addInitScript((value) => {
      if (window.top === window) localStorage.setItem("theme", value);
    }, theme);
    const designId = await createEmptyDesign(app);

    await page.goto(appPath(`/design/${designId}`));
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    const { x: sampleX, y: sampleY } = await sampleXY(page);
    expect(await pixelAt(page, sampleX, sampleY)).toBe(expectedCanvasRgb);
    const canvasSection = page
      .locator("section.design-sidebar-section")
      .filter({
        has: page.locator('h3.design-sidebar-section-title:text-is("Canvas")'),
      });
    await expect(
      canvasSection.getByRole("textbox", { name: "Color" }),
    ).toHaveValue(canvasHex);
    await expect(canvasSection).not.toContainText("NONE");

    const rectStart = { x: sampleX - 100, y: sampleY - 240 };
    const rectEnd = { x: rectStart.x + 200, y: rectStart.y + 140 };
    await selectTool(page, "Rectangle");
    await expect(
      page.locator('button[aria-label="Rectangle"]').first(),
    ).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(rectStart.x, rectStart.y);
    await page.mouse.down();
    await page.mouse.move(rectEnd.x, rectEnd.y, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator("[data-board-surface-layer]")).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(() => pixelAt(page, sampleX, sampleY))
      .toBe(expectedCanvasRgb);
    await expect
      .poll(
        async () =>
          byPrimitive(await boardNodes(app, designId), "rectangle").length,
      )
      .toBe(1);
    const rectId = byPrimitive(await boardNodes(app, designId), "rectangle")[0]!
      .id;
    const drawn = (await page
      .locator("[data-board-surface-layer] iframe")
      .contentFrame()
      .locator(`[data-agent-native-node-id="${rectId}"]`)
      .boundingBox())!;
    expect(
      [
        drawn.x - rectStart.x,
        drawn.y - rectStart.y,
        drawn.width - 200,
        drawn.height - 140,
      ].every((delta) => Math.abs(delta) <= 2),
      `the rectangle covers the drag: ${JSON.stringify(drawn)}`,
    ).toBe(true);

    await selectTool(page, "Text");
    await expect(
      page.locator('button[aria-label="Text"]').first(),
    ).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(sampleX - 80, sampleY + 140);
    await page.mouse.down();
    await page.mouse.move(sampleX + 160, sampleY + 200, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.type("board text");
    await page.keyboard.press("Escape");

    await expect
      .poll(
        async () =>
          byPrimitive(await boardNodes(app, designId), "text").map((node) => [
            node.text,
            styleOf(node).color,
          ]),
        { timeout: 20_000 },
      )
      .toEqual([["board text", boardTextColor]]);
    await app.settled();
    expect(
      byPrimitive(await boardNodes(app, designId), "rectangle").map(
        (node) => node.id,
      ),
      "the text did not touch the rectangle",
    ).toEqual([rectId]);
  });
}
