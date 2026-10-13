import { type FrameLocator, type Page } from "@playwright/test";

import { PENDING_TEXT_INTERCEPT_CAP_MS } from "../app/components/design/design-canvas/pending-text-edit";
import { FIXTURE_HTML } from "./global-setup";
import { appPath, gotoEditor } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const BOARD_IFRAME = "[data-board-surface-layer] iframe";

test.use({ viewport: { width: 1440, height: 1000 } });

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok())
    throw new Error(
      `action ${name} failed: ${res.status()} ${await res.text()}`,
    );
  return res.json();
}

async function designFiles(
  page: Page,
  designId: string,
): Promise<Array<{ filename: string; content: string }>> {
  const res = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!res.ok())
    throw new Error(`get-design failed: ${res.status()} ${await res.text()}`);
  const payload = await res.json();
  const design = [
    payload,
    payload?.result,
    payload?.design,
    payload?.data,
  ].find((candidate: any) => Array.isArray(candidate?.files));
  return design?.files ?? [];
}

async function fileContent(
  page: Page,
  designId: string,
  filename: string,
): Promise<string> {
  const files = await designFiles(page, designId);
  return files.find((file) => file.filename === filename)?.content ?? "";
}

async function textPrimitives(
  page: Page,
  html: string,
): Promise<
  Array<{ id: string | null; text: string; layerName: string | null }>
> {
  return page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    return Array.from(doc.querySelectorAll('[data-an-primitive="text"]')).map(
      (element) => {
        const host = element as HTMLElement;
        return {
          id: host.getAttribute("data-agent-native-node-id"),
          text: (host.textContent ?? "").trim(),
          layerName: host.getAttribute("data-agent-native-layer-name"),
        };
      },
    );
  }, html);
}

function boardFrame(page: Page): FrameLocator {
  return page.locator(BOARD_IFRAME).contentFrame();
}

async function seedTwoScreens(app: App) {
  return app.seed(FIXTURE_HTML, {
    files: {
      "about.html": FIXTURE_HTML.replace("E2E Fixture", "E2E Second Fixture"),
    },
  });
}

/** A pending creation keeps retrying until the intercept cap; a negative check has to outlast it. */
async function outlastPendingCreation(app: App) {
  const since = Date.now();
  await expect
    .poll(() => Date.now() - since, {
      timeout: PENDING_TEXT_INTERCEPT_CAP_MS + 10_000,
      intervals: [250],
    })
    .toBeGreaterThan(PENDING_TEXT_INTERCEPT_CAP_MS);
  await app.settled();
}

async function waitForBoardFile(page: Page, designId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await designFiles(page, designId)).some(
          (file) => file.filename === "__board__.html",
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function ensureOverviewLeftGutter(
  page: Page,
  requiredGutter: number,
): Promise<Array<{ x: number; right: number }>> {
  const world = page.locator("[data-multi-screen-canvas-world]");
  const surface = world.locator("..");
  const surfaceBox = await surface.boundingBox();
  if (!surfaceBox) throw new Error("no overview canvas surface");

  const readScreenBoxes = () =>
    page.locator("[data-screen-card]").evaluateAll((cards) =>
      cards.map((screen) => {
        const rect = screen.getBoundingClientRect();
        return { x: rect.x, right: rect.right };
      }),
    );
  let screenBoxes = await readScreenBoxes();
  if (screenBoxes.length === 0) throw new Error("no overview screen cards");

  let missing =
    requiredGutter -
    (Math.min(...screenBoxes.map((box) => box.x)) - surfaceBox.x);
  let attempts = 0;
  while (missing > 0 && attempts < 3) {
    attempts += 1;
    const shift = Math.min(missing + 24, surfaceBox.width - 48);
    const start = {
      x: surfaceBox.x + 16,
      y: surfaceBox.y + surfaceBox.height / 2,
    };
    await page.keyboard.down("Space");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + shift, start.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.waitForTimeout(100);
    screenBoxes = await readScreenBoxes();
    missing =
      requiredGutter -
      (Math.min(...screenBoxes.map((box) => box.x)) - surfaceBox.x);
  }
  if (missing > 0) {
    throw new Error(`could not open ${requiredGutter}px of left canvas gutter`);
  }
  return screenBoxes;
}

function textToolButton(page: Page) {
  return page.locator('button[aria-label="Text"]').first();
}

// fixme: fails on current main after the merge: Error: expect(locator).toContainText(expected) failed
test.fixme("board target: text tool click then immediate typing is captured and layer is named", async ({
  app,
  page,
}) => {
  const designId = await seedTwoScreens(app);
  await app.open(designId);
  await waitForBoardFile(page, designId);

  await expect(page.locator(BOARD_IFRAME)).toHaveCount(0);
  const screensBefore = {
    index: await fileContent(page, designId, "index.html"),
    about: await fileContent(page, designId, "about.html"),
  };

  const screenBoxes = await ensureOverviewLeftGutter(page, 280);
  expect(screenBoxes.length).toBeGreaterThanOrEqual(2);
  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");

  const click = {
    x: Math.round(Math.min(...screenBoxes.map((box) => box.x)) - 240),
    y: Math.round(cardBox.y + 120),
  };
  await page.mouse.click(click.x, click.y);
  await page.keyboard.type("Standalone");

  await expect(page.locator(BOARD_IFRAME)).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(boardFrame(page).locator("body")).toContainText("Standalone", {
    timeout: 20_000,
  });
  await page.keyboard.press(`${MOD}+Enter`);

  await expect
    .poll(
      async () =>
        (await fileContent(page, designId, "__board__.html")).includes(
          "Standalone",
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  const boardHtml = await fileContent(page, designId, "__board__.html");
  const created = (await textPrimitives(page, boardHtml)).find((primitive) =>
    primitive.text.includes("Standalone"),
  );
  if (!created) throw new Error("board text primitive not found");
  expect(created.text).toBe("Standalone");
  expect(created.layerName).toBe("Standalone");
  const landed = (await boardFrame(page)
    .locator(`[data-agent-native-node-id="${created.id}"]`)
    .boundingBox())!;
  expect(
    Math.max(Math.abs(landed.x - click.x), Math.abs(landed.y - click.y)),
    `the text starts at the click: ${landed.x},${landed.y} vs ${click.x},${click.y}`,
  ).toBeLessThanOrEqual(3);

  expect(await fileContent(page, designId, "index.html")).toBe(
    screensBefore.index,
  );
  expect(await fileContent(page, designId, "about.html")).toBe(
    screensBefore.about,
  );
});

test("single-screen control: text tool click then immediate typing still works", async ({
  app,
  page,
}) => {
  const designId = await app.seed(FIXTURE_HTML);
  await app.open(designId);
  await app.settled();
  const before = await app.savedNodes(designId);

  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");

  const click = {
    x: Math.round(cardBox.x + cardBox.width * 0.42),
    y: Math.round(cardBox.y + cardBox.height * 0.42),
  };
  const origin = await app.pagePoint(0, 0);
  await page.mouse.click(click.x, click.y);
  await page.keyboard.type("Standalone");

  await expect(
    page
      .locator("[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("body"),
  ).toContainText("Standalone", { timeout: 20_000 });
  await page.keyboard.press(`${MOD}+Enter`);

  await expect
    .poll(
      async () =>
        (await fileContent(page, designId, "index.html")).includes(
          "Standalone",
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  const indexHtml = await fileContent(page, designId, "index.html");
  const created = (await textPrimitives(page, indexHtml)).find((primitive) =>
    primitive.text.includes("Standalone"),
  );
  if (!created) throw new Error("screen text primitive not found");
  expect(created.text).toBe("Standalone");
  expect(created.layerName).toBe("Standalone");
  await app.settled();
  const placed = await app.designRect(created.id!);
  const expected = {
    x: (click.x - origin.x) / origin.scale,
    y: (click.y - origin.y) / origin.scale,
  };
  expect(
    Math.max(Math.abs(placed.x - expected.x), Math.abs(placed.y - expected.y)),
    `the text starts at the click: ${placed.x},${placed.y} vs ${expected.x},${expected.y}`,
  ).toBeLessThanOrEqual(2);
  expectOnlyChanged(before, await app.savedNodes(designId), [created.id!]);
});

// fixme: fails on current main after the merge: Error: expect(locator).toContainText(expected) failed
test.fixme("board target: abandoning a creation by pointing away, then creating another", async ({
  app,
  page,
}) => {
  const designId = await seedTwoScreens(app);
  await app.open(designId);
  await waitForBoardFile(page, designId);
  const screensBefore = {
    index: await fileContent(page, designId, "index.html"),
    about: await fileContent(page, designId, "about.html"),
  };

  const screenBoxes = await ensureOverviewLeftGutter(page, 280);
  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");
  const boardX = Math.min(...screenBoxes.map((box) => box.x)) - 240;

  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(boardX, cardBox.y + 120);
  await page.keyboard.type("A");

  const leftShell = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox();
  if (!leftShell) throw new Error("no left shell box");
  await page.mouse.click(
    leftShell.x + leftShell.width / 2,
    leftShell.y + leftShell.height - 16,
  );

  await expect(
    boardFrame(page).locator("[data-agent-native-text-editing]"),
  ).toHaveCount(0, { timeout: 20_000 });
  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(boardX, cardBox.y + 360);
  await page.keyboard.type("Bee");

  await expect(boardFrame(page).locator("body")).toContainText("Bee", {
    timeout: 20_000,
  });
  await page.keyboard.press(`${MOD}+Enter`);

  await expect
    .poll(
      async () =>
        (await fileContent(page, designId, "__board__.html")).includes("Bee"),
      { timeout: 20_000 },
    )
    .toBe(true);
  await outlastPendingCreation(app);

  const primitives = await textPrimitives(
    page,
    await fileContent(page, designId, "__board__.html"),
  );
  expect(
    primitives.map((primitive) => [primitive.text, primitive.layerName]),
    "the abandoned 'A' is kept as its own layer, and 'Bee' is separate",
  ).toEqual([
    ["A", "A"],
    ["Bee", "Bee"],
  ]);
  expect(await fileContent(page, designId, "index.html")).toBe(
    screensBefore.index,
  );
  expect(await fileContent(page, designId, "about.html")).toBe(
    screensBefore.about,
  );
});

// fixme: fails on current main after the merge: Error: expect(locator).toContainText(expected) failed
test.fixme("board target: two committed text creations in a row keep their own text and names", async ({
  app,
  page,
}) => {
  const designId = await seedTwoScreens(app);
  await app.open(designId);
  await waitForBoardFile(page, designId);

  const screenBoxes = await ensureOverviewLeftGutter(page, 280);
  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");
  const boardX = Math.min(...screenBoxes.map((box) => box.x)) - 240;

  const createBoardText = async (y: number, text: string) => {
    await page.keyboard.press("t");
    await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(boardX, y);
    await page.keyboard.type(text);
    await expect(boardFrame(page).locator("body")).toContainText(text, {
      timeout: 20_000,
    });
    await page.keyboard.press(`${MOD}+Enter`);
    await expect
      .poll(
        async () =>
          (await fileContent(page, designId, "__board__.html")).includes(text),
        { timeout: 20_000 },
      )
      .toBe(true);
  };

  await createBoardText(cardBox.y + 120, "Alpha");
  await expect(
    page.locator('button[aria-label="Move"]').first(),
  ).toHaveAttribute("aria-pressed", "true");
  await createBoardText(cardBox.y + 360, "Beta");

  await outlastPendingCreation(app);
  const primitives = await textPrimitives(
    page,
    await fileContent(page, designId, "__board__.html"),
  );
  expect(
    primitives.map((primitive) => [primitive.text, primitive.layerName]),
  ).toEqual([
    ["Alpha", "Alpha"],
    ["Beta", "Beta"],
  ]);
});

// fixme: fails on current main after the merge: Error: expect(received).toBe(expected) // Object.is equality
test.fixme("board target: Escape right after typing keeps the text, with nothing typed removes the node", async ({
  app,
  page,
}) => {
  const designId = await seedTwoScreens(app);
  await app.open(designId);
  await waitForBoardFile(page, designId);

  const screenBoxes = await ensureOverviewLeftGutter(page, 280);
  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");
  const boardX = Math.min(...screenBoxes.map((box) => box.x)) - 240;

  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(boardX, cardBox.y + 120);
  await page.keyboard.type("Sta");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");

  await expect
    .poll(
      async () =>
        (await fileContent(page, designId, "__board__.html")).includes("Sta"),
      { timeout: 20_000 },
    )
    .toBe(true);

  await expect(
    boardFrame(page).locator("[data-agent-native-text-editing]"),
  ).toHaveCount(0, { timeout: 20_000 });
  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(boardX, cardBox.y + 360);
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");

  await outlastPendingCreation(app);
  const primitives = await textPrimitives(
    page,
    await fileContent(page, designId, "__board__.html"),
  );
  expect(
    primitives.map((primitive) => [primitive.text, primitive.layerName]),
  ).toEqual([["Sta", "Sta"]]);
});

// fixme: fails on current main after the merge: Error: The app reported failures during this test
test.fixme("board target: the FIRST creation on an unmounted board, escaped with nothing typed, leaves no node", async ({
  app,
  page,
}) => {
  const designId = await seedTwoScreens(app);
  await app.open(designId);
  await waitForBoardFile(page, designId);
  await expect(page.locator(BOARD_IFRAME)).toHaveCount(0);

  const screenBoxes = await ensureOverviewLeftGutter(page, 280);
  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(
    Math.min(...screenBoxes.map((box) => box.x)) - 240,
    cardBox.y + 120,
  );
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await outlastPendingCreation(app);

  await expect
    .poll(
      async () =>
        (
          await textPrimitives(
            page,
            await fileContent(page, designId, "__board__.html"),
          )
        ).length,
      { timeout: 20_000 },
    )
    .toBe(0);
});

// fixme: fails on current main after the merge: Error: The app reported failures during this test
test.fixme("board target: undo before the board canvas mounts leaves no node and swallows no shortcut", async ({
  app,
  page,
}) => {
  const designId = await seedTwoScreens(app);
  await app.open(designId);
  await waitForBoardFile(page, designId);
  await expect(page.locator(BOARD_IFRAME)).toHaveCount(0);
  const screensBefore = {
    index: await fileContent(page, designId, "index.html"),
    about: await fileContent(page, designId, "about.html"),
  };

  const screenBoxes = await ensureOverviewLeftGutter(page, 280);
  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(
    Math.min(...screenBoxes.map((box) => box.x)) - 240,
    cardBox.y + 120,
  );
  await page.keyboard.press(`${MOD}+z`);
  await page.keyboard.press("r");

  await expect(
    page.locator('button[aria-label="Rectangle"]').first(),
  ).toHaveAttribute("aria-pressed", "true");

  await outlastPendingCreation(app);
  const boardHtml = await fileContent(page, designId, "__board__.html");
  expect(await textPrimitives(page, boardHtml)).toEqual([]);
  expect(await fileContent(page, designId, "index.html")).toBe(
    screensBefore.index,
  );
  expect(await fileContent(page, designId, "about.html")).toBe(
    screensBefore.about,
  );
});

test("board target: text typed while the board frame loads slower than the interception cap is kept", async ({
  app,
  page,
}) => {
  const designId = await seedTwoScreens(app);
  const slowScript = "/__e2e__/slow-board-frame.js";
  await app.open(designId);
  await waitForBoardFile(page, designId);

  const boardFile = (await designFiles(page, designId)).find(
    (file) => file.filename === "__board__.html",
  ) as { id?: string; content: string } | undefined;
  if (!boardFile?.id) throw new Error("no board file id");
  expect(boardFile.content).toContain("</head>");
  await postAction(page, "update-file", {
    id: boardFile.id,
    content: boardFile.content.replace(
      "</head>",
      `<script src="${slowScript}"></script></head>`,
    ),
  });
  await gotoEditor(page, designId);
  expect(await fileContent(page, designId, "__board__.html")).toContain(
    slowScript,
  );
  await expect(page.locator(BOARD_IFRAME)).toHaveCount(0);
  const screensBefore = {
    index: await fileContent(page, designId, "index.html"),
    about: await fileContent(page, designId, "about.html"),
  };

  let boardFrameHeld = false;
  await page.route(`**${slowScript}`, async (route) => {
    boardFrameHeld = true;
    await new Promise((resolve) =>
      setTimeout(resolve, PENDING_TEXT_INTERCEPT_CAP_MS + 2_000),
    );
    await route
      .fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "",
      })
      .catch(() => {});
  });

  const screenBoxes = await ensureOverviewLeftGutter(page, 280);
  const cardBox = await page
    .locator("[data-screen-card]")
    .first()
    .boundingBox();
  if (!cardBox) throw new Error("no screen card box");

  await page.keyboard.press("t");
  await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(
    Math.min(...screenBoxes.map((box) => box.x)) - 240,
    cardBox.y + 120,
  );
  await page.keyboard.type("Standalone");

  await expect(page.locator(BOARD_IFRAME)).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(boardFrame(page).locator("body")).toContainText("Standalone", {
    timeout: PENDING_TEXT_INTERCEPT_CAP_MS + 30_000,
  });
  expect(boardFrameHeld).toBe(true);
  await page.keyboard.press(`${MOD}+Enter`);

  await expect
    .poll(
      async () =>
        (await fileContent(page, designId, "__board__.html")).includes(
          "Standalone",
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const created = (
    await textPrimitives(
      page,
      await fileContent(page, designId, "__board__.html"),
    )
  ).find((primitive) => primitive.text.includes("Standalone"));
  if (!created) throw new Error("board text primitive not found");
  expect(created.text).toBe("Standalone");
  expect(created.layerName).toBe("Standalone");

  expect(await fileContent(page, designId, "index.html")).toBe(
    screensBefore.index,
  );
  expect(await fileContent(page, designId, "about.html")).toBe(
    screensBefore.about,
  );
});
