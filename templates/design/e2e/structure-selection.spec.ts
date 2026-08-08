import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Grouping and selection traversal, asserted against Figma's documented
 * behaviour. Doc facts are quoted in each failure message so a reviewer can
 * check the claim without trusting the test author.
 */

const PAGE_W = 1440;
const PAGE_H = 900;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Structure</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="wrap" data-agent-native-layer-name="Wrap"
         style="position:absolute;left:16px;top:60px;width:288px;height:220px;background:#111827">
      <div data-agent-native-node-id="kid-1" data-agent-native-layer-name="Kid One"
           style="position:absolute;left:16px;top:20px;width:80px;height:50px;background:#3b82f6"></div>
      <div data-agent-native-node-id="kid-2" data-agent-native-layer-name="Kid Two"
           style="position:absolute;left:106px;top:20px;width:80px;height:50px;background:#22c55e"></div>
      <div data-agent-native-node-id="kid-3" data-agent-native-layer-name="Kid Three"
           style="position:absolute;left:196px;top:20px;width:80px;height:50px;background:#f59e0b"></div>
    </div>
    <div data-agent-native-node-id="loose-a" data-agent-native-layer-name="Loose A"
         style="position:absolute;left:20px;top:520px;width:120px;height:80px;background:#a855f7"></div>
    <div data-agent-native-node-id="loose-b" data-agent-native-layer-name="Loose B"
         style="position:absolute;left:170px;top:520px;width:120px;height:80px;background:#ec4899"></div>
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
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok())
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "structure and selection",
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

async function indexHtml(page: Page, designId: string): Promise<string> {
  const result = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
  return (
    (result.files ?? []).find((f: any) => f.filename === "index.html")
      ?.content ?? ""
  );
}

function styleOf(html: string, id: string): string {
  return (
    new RegExp(
      `data-agent-native-node-id="${id}"[^>]*?style="([^"]*)"`,
      "i",
    ).exec(html)?.[1] ?? ""
  );
}

function styleNum(style: string, prop: string): number {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(
    style,
  );
  return m ? Number(m[1]) : NaN;
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRow(page: Page, name: string): Locator {
  return layersTree(page)
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first();
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

async function selectedLayerName(page: Page): Promise<string | null> {
  const text = await page
    .locator('[role="treeitem"][aria-selected="true"]')
    .first()
    .textContent()
    .catch(() => null);
  return text?.trim() ?? null;
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
  await page.waitForTimeout(2500);
  for (let i = 0; i < 5; i += 1) {
    await page
      .getByRole("button", { name: "Expand layer" })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
}

async function scale(page: Page): Promise<number> {
  const card = await page.locator("[data-screen-card]").first().boundingBox();
  if (!card) throw new Error("no screen card");
  // Never assume the page size — the screen's own viewport is the truth.
  const inner = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("body")
    .evaluate(() => document.documentElement.clientWidth);
  return card.width / inner;
}

async function selectViaTree(page: Page, name: string): Promise<void> {
  await layerRow(page, name).click();
  await page.waitForTimeout(1500);
}

async function multiSelect(page: Page, names: string[]): Promise<void> {
  await layerRow(page, names[0]).click();
  await page.waitForTimeout(700);
  for (const name of names.slice(1)) {
    await layerRow(page, name).click({ modifiers: ["Shift"] });
    await page.waitForTimeout(700);
  }
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9333}`;
});

test.describe("keyboard selection traversal", () => {
  test("Enter selects a child of the current selection", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Wrap");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `Figma: "You can double-click on the object or press the enter key to select one ` +
        `level of nesting down." Selection stayed on "${name}".`,
    ).toMatch(/Kid/);
  });

  test("Escape selects the parent of the current selection", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Kid One");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `Escape should walk up to the parent; selection is "${name}".`,
    ).toBe("Wrap");
  });

  test("Tab selects the next sibling", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Kid One");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `Figma: "Press the Tab key to select the next sibling". Selection is "${name}".`,
    ).toBe("Kid Two");
  });

  test("Shift+Tab selects the previous sibling", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Kid Two");
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `Figma: "Shift + Tab to select the previous sibling". Selection is "${name}".`,
    ).toBe("Kid One");
  });

  test("double-clicking an object drills one level down", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const box = (await node(page, "kid-1").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `double-click should drill into the child; selection is "${name}".`,
    ).toMatch(/Kid One/);
  });
});

test.describe("groups", () => {
  test("Cmd+G wraps the selection in a group layer", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);
    await page.keyboard.press(`${MOD}+g`);
    await page.waitForTimeout(2500);
    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      "Cmd+G produced no Group layer",
    ).toHaveCount(1);
  });

  test("a group's bounds fit its contents", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);
    await page.keyboard.press(`${MOD}+g`);
    await page.waitForTimeout(2500);

    const a = (await node(page, "loose-a").boundingBox())!;
    const b = (await node(page, "loose-b").boundingBox())!;
    const group = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-layer-name="Group"]')
      .first()
      .boundingBox()
      .catch(() => null);
    expect(group, "no Group element rendered in the preview").not.toBeNull();

    const expectedWidth = b.x + b.width - a.x;
    expect(
      group!.width,
      `Figma: "Groups automatically adjust their bounds to fit the layers within." ` +
        `Children span ${Math.round(expectedWidth)}px; the group measures ${Math.round(group!.width)}px.`,
    ).toBeCloseTo(expectedWidth, -1.4);
  });

  test("Cmd+Shift+G ungroups", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);
    await page.keyboard.press(`${MOD}+g`);
    await page.waitForTimeout(2500);
    await layerRow(page, "Group").click();
    await page.waitForTimeout(1200);
    await page.keyboard.press(`${MOD}+Shift+g`);
    await page.waitForTimeout(2500);
    await expect(
      layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      "Cmd+Shift+G left the Group layer in place",
    ).toHaveCount(0);
  });

  test("moving a group moves every child by the same delta", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);
    await page.keyboard.press(`${MOD}+g`);
    await page.waitForTimeout(2500);

    const before = await indexHtml(page, id);
    const aBefore = styleNum(styleOf(before, "loose-a"), "left");
    const bBefore = styleNum(styleOf(before, "loose-b"), "left");
    const renderedBefore = [
      (await node(page, "loose-a").boundingBox())!.x,
      (await node(page, "loose-b").boundingBox())!.x,
    ];

    await layerRow(page, "Group").click();
    await page.waitForTimeout(1200);
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(2000);

    // Figma moves the group container and leaves each child's own offset
    // alone, so the source offsets must not move while the paint does.
    const after = await indexHtml(page, id);
    const sourceDeltas = [
      styleNum(styleOf(after, "loose-a"), "left") - aBefore,
      styleNum(styleOf(after, "loose-b"), "left") - bBefore,
    ];
    const renderedDeltas = [
      (await node(page, "loose-a").boundingBox())!.x - renderedBefore[0],
      (await node(page, "loose-b").boundingBox())!.x - renderedBefore[1],
    ];
    expect(
      sourceDeltas,
      `a group nudge must move the container, not rewrite each child's offset`,
    ).toEqual([0, 0]);
    expect(
      Math.abs(renderedDeltas[0] - renderedDeltas[1]),
      `both children must move together; they moved ${JSON.stringify(renderedDeltas)}`,
    ).toBeLessThan(1);
    expect(
      renderedDeltas[0],
      `5 big nudges must move the group right on screen; moved ${renderedDeltas[0]}`,
    ).toBeGreaterThan(0);
  });
});

test.describe("multi-selection", () => {
  test("dragging a two-element selection moves both by the same delta", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);

    const before = await indexHtml(page, id);
    const aBefore = styleNum(styleOf(before, "loose-a"), "left");
    const bBefore = styleNum(styleOf(before, "loose-b"), "left");

    const s = await scale(page);
    const box = (await node(page, "loose-a").boundingBox())!;
    // Figma snaps to alignment guides unless the primary modifier is held,
    // so an unmodified drag legitimately lands within a few px of the ask.
    await page.keyboard.down(MOD === "Meta" ? "Meta" : "Control");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 100 * s,
      box.y + box.height / 2,
      { steps: 16 },
    );
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.keyboard.up(MOD === "Meta" ? "Meta" : "Control");
    await page.waitForTimeout(2200);

    const after = await indexHtml(page, id);
    const aDelta = styleNum(styleOf(after, "loose-a"), "left") - aBefore;
    const bDelta = styleNum(styleOf(after, "loose-b"), "left") - bBefore;
    expect(
      aDelta,
      `a multi-selection must move as one; A moved ${aDelta}, B moved ${bDelta}`,
    ).toBe(bDelta);
    expect(
      aDelta,
      `a 100px drag must not move the selection backwards or nowhere`,
    ).toBeGreaterThan(0);
  });

  test("a drag lands the object where the cursor landed", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Loose A");
    // Selecting in the tree can pan the canvas; measure after it settles or
    // the drag starts from stale coordinates.
    await page.waitForTimeout(1500);

    const before = await indexHtml(page, id);
    const aBefore = styleNum(styleOf(before, "loose-a"), "top");
    const s = await scale(page);
    const box = (await node(page, "loose-a").boundingBox())!;
    // Drag UP into empty space: moving right would land on Loose B and the
    // drop nests instead of translating.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2,
      box.y + box.height / 2 - 100 * s,
      { steps: 16 },
    );
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(2200);

    const aDelta =
      aBefore - styleNum(styleOf(await indexHtml(page, id), "loose-a"), "top");
    // Snapping is on, so the drop is pulled up to SNAP_THRESHOLD_PX (6) onto
    // an alignment guide. Cmd is Figma's snap bypass but is overloaded with
    // deep-select here, so an exact-delta drag is not expressible.
    expect(
      Math.abs(100 - aDelta),
      `dragging 100px up landed ${aDelta}, which is further than the 6px snap ` +
        `threshold can account for`,
    ).toBeLessThanOrEqual(6);
  });

  test("a multi-selection shows one combined bounding box", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);
    await page.waitForTimeout(800);

    // The element selection chrome is painted INSIDE the preview iframe;
    // [data-resize-handle] in the host is the screen's own board chrome.
    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const measured = await preview.locator("body").evaluate(() => {
      const union = ["loose-a", "loose-b"]
        .map((id) =>
          document
            .querySelector(`[data-agent-native-node-id="${id}"]`)
            ?.getBoundingClientRect(),
        )
        .filter((rect): rect is DOMRect => Boolean(rect));
      if (union.length !== 2) return null;
      const box = document.querySelector(
        "[data-agent-native-multi-selection-bounds]",
      );
      if (!box) return null;
      const chrome = box.getBoundingClientRect();
      return {
        contentWidth:
          Math.max(...union.map((r) => r.right)) -
          Math.min(...union.map((r) => r.left)),
        chromeWidth: chrome.width,
      };
    });

    expect(
      measured,
      "no multi-selection chrome inside the preview",
    ).not.toBeNull();
    expect(
      measured!.chromeWidth,
      `two boxes spanning ${Math.round(measured!.contentWidth)}px are enclosed ` +
        `by ${Math.round(measured!.chromeWidth)}px of chrome`,
    ).toBeCloseTo(measured!.contentWidth, -1);
  });

  test("Smart selection exposes spacing handles for evenly spaced layers", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Kid One", "Kid Two", "Kid Three"]);
    const box = (await node(page, "kid-2").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);

    const handles = await page.evaluate(
      () =>
        document.querySelectorAll(
          "[data-smart-selection],[data-spacing-handle],[data-smart-handle]",
        ).length,
    );
    expect(
      handles,
      `Figma: three evenly spaced layers get "a pink ring in the center" of each plus ` +
        `"additional pink handles ... between each layer" for spacing. None appeared.`,
    ).toBeGreaterThan(0);
  });
});

test.describe("frames versus groups", () => {
  test("a frame keeps its explicit size when a child moves", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const before = styleOf(await indexHtml(page, id), "wrap");
    const wBefore = styleNum(before, "width");
    const hBefore = styleNum(before, "height");

    await selectViaTree(page, "Kid One");
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(2000);

    const after = styleOf(await indexHtml(page, id), "wrap");
    expect(
      [styleNum(after, "width"), styleNum(after, "height")],
      `Figma: "frames are layers whose size is explicitly set by you" — moving a child ` +
        `must not resize the frame. It went ${wBefore}x${hBefore} → ` +
        `${styleNum(after, "width")}x${styleNum(after, "height")}.`,
    ).toEqual([wBefore, hBefore]);
  });
});
