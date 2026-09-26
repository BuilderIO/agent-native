import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { PENDING_TEXT_INTERCEPT_CAP_MS } from "../app/components/design/design-canvas/pending-text-edit";
import { FIXTURE_HTML } from "./global-setup";
import { appPath, createFixtureDesign, gotoEditor } from "./helpers";


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
): Promise<Array<{ text: string; layerName: string | null }>> {
  return page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    return Array.from(doc.querySelectorAll('[data-an-primitive="text"]')).map(
      (element) => {
        const host = element as HTMLElement;
        return {
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

async function addSecondScreen(page: Page, designId: string): Promise<void> {
  await postAction(page, "create-file", {
    designId,
    filename: "about.html",
    content: FIXTURE_HTML.replace("E2E Fixture", "E2E Second Fixture"),
    fileType: "html",
  });
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

test("board target: text tool click then immediate typing is captured and layer is named", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Text tool board creation");
  try {
    await addSecondScreen(page, designId);
    await gotoEditor(page, designId);
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

    await page.mouse.click(
      Math.min(...screenBoxes.map((box) => box.x)) - 240,
      cardBox.y + 120,
    );
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

    expect(await fileContent(page, designId, "index.html")).toBe(
      screensBefore.index,
    );
    expect(await fileContent(page, designId, "about.html")).toBe(
      screensBefore.about,
    );
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("single-screen control: text tool click then immediate typing still works", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    "Text tool single screen creation",
  );
  try {
    await gotoEditor(page, designId);

    const cardBox = await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox();
    if (!cardBox) throw new Error("no screen card box");

    await page.keyboard.press("t");
    await expect(textToolButton(page)).toHaveAttribute("aria-pressed", "true");

    await page.mouse.click(
      cardBox.x + cardBox.width * 0.42,
      cardBox.y + cardBox.height * 0.42,
    );
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
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("board target: abandoning a creation by pointing away, then creating another", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Text tool board abandon");
  try {
    await addSecondScreen(page, designId);
    await gotoEditor(page, designId);
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
    await page.waitForTimeout(6_000); // e2e-harness-ignore negative assertion: the abandoned creation must leave nothing behind, so its ladder has to actually exhaust

    const primitives = await textPrimitives(
      page,
      await fileContent(page, designId, "__board__.html"),
    );
    const second = primitives.filter((primitive) => primitive.text === "Bee");
    expect(second).toHaveLength(1);
    expect(second[0].layerName).toBe("Bee");
    for (const primitive of primitives) {
      expect(primitive.text.length).toBeGreaterThan(0);
      expect(primitive.text).not.toContain("ABee");
    }
    expect(await fileContent(page, designId, "index.html")).toBe(
      screensBefore.index,
    );
    expect(await fileContent(page, designId, "about.html")).toBe(
      screensBefore.about,
    );
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("board target: two committed text creations in a row keep their own text and names", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Text tool board sequence");
  try {
    await addSecondScreen(page, designId);
    await gotoEditor(page, designId);
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
      await expect(textToolButton(page)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await page.mouse.click(boardX, y);
      await page.keyboard.type(text);
      await expect(boardFrame(page).locator("body")).toContainText(text, {
        timeout: 20_000,
      });
      await expect
        .poll(
          async () => {
            await page.keyboard.press(`${MOD}+Enter`);
            return (
              await fileContent(page, designId, "__board__.html")
            ).includes(text);
          },
          { timeout: 30_000, intervals: [250, 1000, 2000, 3000, 5000] },
        )
        .toBe(true);
    };

    await createBoardText(cardBox.y + 120, "Alpha");
    await expect(
      page.locator('button[aria-label="Move"]').first(),
    ).toHaveAttribute("aria-pressed", "true");
    await createBoardText(cardBox.y + 360, "Beta");

    await page.waitForTimeout(6_000); // e2e-harness-ignore negative assertion: no third primitive may appear after both ladders and the cleanup retry
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
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("board target: Escape right after typing keeps the text, with nothing typed removes the node", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Text tool board escape");
  try {
    await addSecondScreen(page, designId);
    await gotoEditor(page, designId);
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

    await page.waitForTimeout(8_000); // e2e-harness-ignore negative assertion: an Escaped empty creation must persist nothing once the ladder and cleanup are done
    const primitives = await textPrimitives(
      page,
      await fileContent(page, designId, "__board__.html"),
    );
    expect(
      primitives.map((primitive) => [primitive.text, primitive.layerName]),
    ).toEqual([["Sta", "Sta"]]);
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("board target: the FIRST creation on an unmounted board, escaped with nothing typed, leaves no node", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Text tool cold escape");
  try {
    await addSecondScreen(page, designId);
    await gotoEditor(page, designId);
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
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("board target: undo before the board canvas mounts leaves no node and swallows no shortcut", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Text tool board undo");
  try {
    await addSecondScreen(page, designId);
    await gotoEditor(page, designId);
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
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press("r");

    await expect(
      page.locator('button[aria-label="Rectangle"]').first(),
    ).toHaveAttribute("aria-pressed", "true");

    await page.waitForTimeout(6_000); // e2e-harness-ignore negative assertion: the undone node must never be persisted, so the ladder must exhaust first
    const boardHtml = await fileContent(page, designId, "__board__.html");
    expect(await textPrimitives(page, boardHtml)).toEqual([]);
  } finally {
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("board target: text typed while the board frame loads slower than the interception cap is kept", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    "Text tool board slow frame",
  );
  const slowScript = "/__e2e__/slow-board-frame.js";
  try {
    await addSecondScreen(page, designId);
    await gotoEditor(page, designId);
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
  } finally {
    await page.unroute(`**${slowScript}`).catch(() => {});
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
  }
});
