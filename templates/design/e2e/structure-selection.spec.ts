import { expect, test, type Locator, type Page } from "@playwright/test";

import { DEFAULT_BIG_NUDGE_PX } from "../shared/canvas-math";
import { e2eBaseURL } from "./base-url";
import { expandAllLayers } from "./helpers";


const PAGE_W = 1440;
const PAGE_H = 900;
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const GROUP_FILL_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Group Fill</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
  <div data-agent-native-node-id="fill-a" data-agent-native-layer-name="Fill A" style="box-sizing:border-box;position:absolute;left:20px;top:100px;width:120px;height:80px;background:#f97316;border:8px solid #f97316"></div>
  <div data-agent-native-node-id="fill-b" data-agent-native-layer-name="Fill B" style="box-sizing:border-box;position:absolute;left:160px;top:100px;width:120px;height:80px;background:#f97316;border:8px solid #111827"></div>
  <div data-agent-native-node-id="fill-text" data-agent-native-layer-name="Fill Text" style="position:absolute;left:20px;top:196px;width:220px;height:48px;color:#f97316;font-size:24px;line-height:48px">Paint</div>
</body></html>`;
const SELECTION_COLOR_ALPHA_COLLISION_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Selection Color Alpha Collision</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff">
  <div data-agent-native-node-id="blue-opaque" data-agent-native-layer-name="Blue 100" style="box-sizing:border-box;position:absolute;left:20px;top:100px;width:120px;height:80px;background:#3b82f6"></div>
  <div data-agent-native-node-id="blue-alpha" data-agent-native-layer-name="Blue 50" style="box-sizing:border-box;position:absolute;left:160px;top:100px;width:120px;height:80px;background:rgba(59,130,246,0.5)"></div>
</body></html>`;
const GROUP_RICH_TEXT_FIXTURE = GROUP_FILL_FIXTURE.replace(
  ">Paint</div>",
  '>Paint <strong style="color:#c026d3">this</strong></div>',
);
const GROUP_VECTOR_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Group SVG fill</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff">
  <div data-agent-native-node-id="fill-a" data-agent-native-layer-name="Fill A" data-an-primitive="rectangle" style="position:absolute;left:20px;top:100px;width:120px;height:80px;background:#f97316"></div>
  <svg data-agent-native-node-id="icon" data-agent-native-layer-name="Icon" style="position:absolute;left:160px;top:100px;width:120px;height:80px" viewBox="0 0 120 80"><circle cx="60" cy="40" r="30" fill="#f97316" stroke="#111827" stroke-width="4"/></svg>
</body></html>`;

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

const BOARD_FIXTURE = FIXTURE.replace("loose-a", "board-a")
  .replace("Loose A", "Board A")
  .replace("loose-b", "board-b")
  .replace("Loose B", "Board B");
const IDLESS_MOVE_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Source identity</title></head>
<body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff">
  <main class="identity-frame" style="position:absolute;left:20px;top:80px;width:360px;height:220px">
    <button class="move-target" data-agent-native-layer-name="Move target" style="position:absolute;left:12px;top:16px;width:140px;height:44px;background:#3b82f6">Move me</button>
    <span class="move-sibling" style="position:absolute;left:172px;top:16px">Sibling</span>
  </main>
</body></html>`;

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

async function newDesign(page: Page, content = FIXTURE): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "structure and selection",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content,
    fileType: "html",
  });
  return id;
}

async function newBoardDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "group fill board surface",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  const board = await postAction(page, "create-file", {
    designId: id,
    filename: "__board__.html",
    content: BOARD_FIXTURE,
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
  await expandAllLayers(page);
  await page.waitForTimeout(500);
}

async function scale(page: Page): Promise<number> {
  const card = await page.locator("[data-screen-card]").first().boundingBox();
  if (!card) throw new Error("no screen card");
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

async function openGroupedSelectionColors(page: Page): Promise<Locator> {
  await multiSelect(page, ["Blue 100", "Blue 50"]);
  await page.keyboard.press(`${MOD}+g`);
  await expect(layerRow(page, "Group")).toBeVisible();
  await layerRow(page, "Group").click();
  const section = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Selection colors",
        exact: true,
      }),
    })
    .first();
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: "Show selection colors" }).click();
  return section;
}

async function waitForSourceChange(
  page: Page,
  designId: string,
  previous: string,
): Promise<string> {
  let current = previous;
  for (let attempt = 0; attempt < 20 && current === previous; attempt += 1) {
    await page.waitForTimeout(250);
    current = await indexHtml(page, designId);
  }
  return current;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

test.describe("keyboard selection traversal", () => {
  test("Layers-first selection persists source identity for a later move and reload", async ({
    page,
  }) => {
    const id = await newDesign(page, IDLESS_MOVE_FIXTURE);
    try {
      await openEditor(page, id);
      const initial = await indexHtml(page, id);
      expect(initial).not.toMatch(
        /class="move-target"[^>]*data-agent-native-node-id=/,
      );

      await selectViaTree(page, "Move target");
      await expect
        .poll(() => indexHtml(page, id))
        .toMatch(
          /<button[^>]*class="move-target"[^>]*data-agent-native-node-id="an-[^"]+"/,
        );
      const stampedHtml = await indexHtml(page, id);
      const nodeId =
        /class="move-target"[^>]*data-agent-native-node-id="([^"]+)"/.exec(
          stampedHtml,
        )?.[1];
      expect(nodeId).toMatch(/^an-/);

      const styleForTarget = (html: string) => {
        const tag = new RegExp(
          `<button[^>]*class="move-target"[^>]*data-agent-native-node-id="${nodeId}"[^>]*>`,
          "i",
        ).exec(html)?.[0];
        return tag
          ? styleNum(/\bstyle="([^"]*)"/i.exec(tag)?.[1] ?? "", "left")
          : NaN;
      };
      const before = styleForTarget(stampedHtml);
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => indexHtml(page, id).then(styleForTarget))
        .toBe(before + 1);

      await openEditor(page, id);
      await expect
        .poll(() => indexHtml(page, id))
        .toContain(`data-agent-native-node-id="${nodeId}"`);
      await expect
        .poll(() => indexHtml(page, id).then(styleForTarget))
        .toBe(before + 1);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

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

  test("Backslash selects the parent of the current selection", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Kid One");
    await page.keyboard.press("\\");
    await page.waitForTimeout(1500);
    const name = await selectedLayerName(page);
    expect(
      name,
      `Figma: "\\" selects the parent. Selection is "${name}".`,
    ).toBe("Wrap");
  });

  test("Escape deselects rather than walking up to the parent", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Kid One");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
      `Figma: Esc is "select none". Selection is "${await selectedLayerName(page)}".`,
    ).toHaveCount(0);
  });

  test("Escape on a top-level layer does not select the containing screen", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await selectViaTree(page, "Loose A");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
      `Selection is "${await selectedLayerName(page)}".`,
    ).toHaveCount(0);
    await expect(
      page.locator("[data-frame-selection-box]"),
      "Escape promoted the selection to the screen frame instead of clearing it",
    ).toHaveCount(0);
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

  test("Shift+Arrow nudges a collapsed container by the big nudge on the first press", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const row = layerRow(page, "Wrap");
    const collapse = row.getByRole("button", { name: "Collapse layer" });
    if (await collapse.isVisible()) await collapse.click();
    await expect(
      row.getByRole("button", { name: "Expand layer" }),
    ).toBeVisible();
    await row.click();
    const before = styleNum(styleOf(await indexHtml(page, id), "wrap"), "left");

    await page.keyboard.press("Shift+ArrowRight");

    await expect
      .poll(() =>
        indexHtml(page, id).then((html) =>
          styleNum(styleOf(html, "wrap"), "left"),
        ),
      )
      .toBe(before + DEFAULT_BIG_NUDGE_PX);
    await expect(
      row.getByRole("button", { name: "Expand layer" }),
    ).toBeVisible();
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
  test("Group Fill recolors a nested rich-text run without flattening it", async ({
    page,
  }, testInfo) => {
    const viteUpdates: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/^\[vite\] (?:hot updated|page reload)/.test(text)) {
        viteUpdates.push(text);
      }
    });
    const id = await newDesign(page, GROUP_RICH_TEXT_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
      await page.keyboard.press(`${MOD}+g`);
      await expect(layerRow(page, "Group")).toBeVisible();
      await layerRow(page, "Group").click();
      const fillSection = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "Fill", exact: true }),
        })
        .first();
      await fillSection
        .getByRole("button", { name: "Open color picker" })
        .click();
      const hex = page.getByRole("textbox", { name: "Hex", exact: true });
      await hex.fill("3B82F6");
      await hex.press("Enter");
      await page.keyboard.press("Escape");

      const rendered = await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const paragraph = document.querySelector<HTMLElement>(
            '[data-agent-native-node-id="fill-text"]',
          );
          const nested = paragraph?.querySelector<HTMLElement>("strong");
          if (!paragraph || !nested)
            throw new Error("rich text fixture missing");
          const parentStyle = getComputedStyle(paragraph);
          const nestedStyle = getComputedStyle(nested);
          return {
            parentColor: parentStyle.color,
            parentFill: parentStyle.backgroundColor,
            parentClip: parentStyle.backgroundClip,
            nestedColor: nestedStyle.color,
            nestedTextFill: nestedStyle.webkitTextFillColor,
          };
        });
      expect(rendered).toMatchObject({
        parentColor: "rgba(0, 0, 0, 0)",
        parentFill: "rgb(59, 130, 246)",
        parentClip: "text",
        nestedColor: "rgb(192, 38, 211)",
        nestedTextFill: "rgba(0, 0, 0, 0)",
      });
      const readSavedRichText = async () => {
        const saved = await indexHtml(page, id);
        return page.evaluate((html) => {
          const document = new DOMParser().parseFromString(html, "text/html");
          const strong = document.querySelector<HTMLElement>(
            '[data-agent-native-node-id="fill-text"] strong',
          );
          return {
            strong: {
              tagName: strong?.tagName,
              text: strong?.textContent,
              color: strong?.style.color,
            },
            preservesTextPaint: html.includes(
              "-webkit-text-fill-color: transparent",
            ),
          };
        }, saved);
      };
      await expect.poll(readSavedRichText).toEqual({
        strong: {
          tagName: "STRONG",
          text: "this",
          color: "rgb(192, 38, 211)",
        },
        preservesTextPaint: true,
      });
      await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .screenshot({ path: testInfo.outputPath("group-rich-text.png") });
      await page.reload({ waitUntil: "domcontentloaded" });
      await toolbar(page).locator('button[aria-label="Move"]').waitFor();
      await expect
        .poll(async () => (await readSavedRichText()).preservesTextPaint)
        .toBe(true);
      const reloadedText = await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator('[data-agent-native-node-id="fill-text"]')
        .evaluate((paragraph) => {
          const strong = paragraph.querySelector("strong");
          return {
            text: getComputedStyle(paragraph).backgroundColor,
            strongText: strong?.textContent,
            strongColor: strong ? getComputedStyle(strong).color : null,
            strongFill: strong
              ? getComputedStyle(strong).webkitTextFillColor
              : null,
          };
        });
      expect(reloadedText).toEqual({
        text: "rgb(59, 130, 246)",
        strongText: "this",
        strongColor: "rgb(192, 38, 211)",
        strongFill: "rgba(0, 0, 0, 0)",
      });
      expect(viteUpdates).toEqual([]);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Group Fill recolors a simple inline SVG shape without painting its box", async ({
    page,
  }, testInfo) => {
    const id = await newDesign(page, GROUP_VECTOR_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Icon"]);
      await page.keyboard.press(`${MOD}+g`);
      await expect(layerRow(page, "Group")).toBeVisible();
      await layerRow(page, "Group").click();
      const fillSection = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "Fill", exact: true }),
        })
        .first();
      await fillSection
        .getByRole("button", { name: "Open color picker" })
        .click();
      const hex = page.getByRole("textbox", { name: "Hex", exact: true });
      await hex.fill("3B82F6");
      await hex.press("Enter");
      await page.keyboard.press("Escape");

      const rendered = await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const icon = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="icon"]',
          );
          const circle = icon?.querySelector("circle");
          if (!icon || !circle) throw new Error("SVG fixture missing");
          return {
            fill: getComputedStyle(circle).fill,
            stroke: getComputedStyle(circle).stroke,
            boxFill: getComputedStyle(icon).fill,
            background: getComputedStyle(icon).backgroundColor,
          };
        });
      expect(rendered).toEqual({
        fill: "rgb(59, 130, 246)",
        stroke: "rgb(17, 24, 39)",
        boxFill: "rgb(0, 0, 0)",
        background: "rgba(0, 0, 0, 0)",
      });
      const saved = await indexHtml(page, id);
      expect(saved).toMatch(/<circle[^>]*style="[^"]*fill: #3b82f6/);
      expect(saved).not.toMatch(/<svg[^>]*style="[^"]*fill: #3b82f6/);
      await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .screenshot({ path: testInfo.outputPath("group-inline-svg.png") });
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Group Fill commits direct opacity changes from 50% back to 100%", async ({
    page,
  }) => {
    const viteUpdates: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/^\[vite\] (?:hot updated|page reload)/.test(text)) {
        viteUpdates.push(text);
      }
    });
    const id = await newDesign(page, GROUP_FILL_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
      await page.keyboard.press(`${MOD}+g`);
      await expect(layerRow(page, "Group")).toBeVisible();
      await layerRow(page, "Group").click();
      const fillSection = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "Fill", exact: true }),
        })
        .first();
      const fillButton = fillSection.getByRole("button", {
        name: "Open color picker",
      });
      const readFill = () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator('[data-agent-native-node-id="fill-a"]')
          .evaluate((element) => getComputedStyle(element).backgroundColor);
      const setOpacity = async (value: number) => {
        await fillButton.click();
        const input = page.getByRole("spinbutton", {
          name: "Opacity",
          exact: true,
        });
        await input.fill(String(value));
        await input.press("Enter");
        await page.keyboard.press("Escape");
        await expect(
          fillSection.getByRole("textbox", { name: "Paint opacity" }),
        ).toHaveValue(String(value));
      };

      await setOpacity(50);
      await expect.poll(readFill).toBe("rgba(249, 115, 22, 0.5)");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toMatch(/(?:50%|0\.5)/);

      await setOpacity(100);
      await expect.poll(readFill).toBe("rgb(249, 115, 22)");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .not.toMatch(/0\.5|50%/);

      await page.reload({ waitUntil: "domcontentloaded" });
      await toolbar(page).locator('button[aria-label="Move"]').waitFor();
      await expandAllLayers(page);
      await layerRow(page, "Group").click();
      const reloadedFill = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "Fill", exact: true }),
        })
        .first()
        .getByRole("textbox", { name: "Paint opacity" });
      await expect(reloadedFill).toHaveValue("100");
      await expect.poll(readFill).toBe("rgb(249, 115, 22)");

      await setOpacity(50);
      await expect.poll(readFill).toBe("rgba(249, 115, 22, 0.5)");
      await page.keyboard.press(`${MOD}+z`);
      await expect.poll(readFill).toBe("rgb(249, 115, 22)");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .not.toMatch(/0\.5|50%/);
      await expect(reloadedFill).toHaveValue("100");
      expect(viteUpdates).toEqual([]);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Undo cancels a held Group Fill opacity scrub before undoing the committed color", async ({
    page,
  }) => {
    const id = await newDesign(page, GROUP_FILL_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
      await page.keyboard.press(`${MOD}+g`);
      await layerRow(page, "Group").click();
      const fillSection = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "Fill", exact: true }),
        })
        .first();
      const fillButton = fillSection.getByRole("button", {
        name: "Open color picker",
      });
      const readFill = () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator('[data-agent-native-node-id="fill-a"]')
          .evaluate((element) => getComputedStyle(element).backgroundColor);
      await fillButton.click();
      const hex = page.getByRole("textbox", { name: "Hex", exact: true });
      await hex.fill("3B82F6");
      await hex.press("Enter");
      await expect(fillButton).toHaveAttribute("aria-expanded", "true");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toContain("#3b82f6");
      await expect.poll(readFill).toBe("rgb(59, 130, 246)");

      const opacity = page.getByRole("slider", {
        name: "Opacity",
        exact: true,
      });
      await expect(opacity).toBeVisible();
      const box = await opacity.boundingBox();
      if (!box) throw new Error("Group Fill opacity input is missing");
      const startX = box.x + box.width * 0.8;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      const targetIsSlider = await page.evaluate(
        ({ x, y }) => {
          const slider = document.querySelector<HTMLElement>(
            '[role="slider"][aria-label="Opacity"]',
          );
          return Boolean(slider?.contains(document.elementFromPoint(x, y)));
        },
        { x: startX, y: startY },
      );
      expect(targetIsSlider).toBe(true);
      await page.mouse.down();
      await page.mouse.move(startX - 40, startY, { steps: 4 });
      const previewOpacity = await opacity.getAttribute("aria-valuenow");
      expect(previewOpacity).not.toBe("100");
      expect(await readFill()).toMatch(/^rgba\(/);
      await page.keyboard.press(`${MOD}+z`);
      await expect(opacity).toBeHidden();
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toContain("#3b82f6");
      await expect.poll(readFill).toBe("rgb(59, 130, 246)");

      await page.mouse.up();
      await expect.poll(readFill).toBe("rgb(59, 130, 246)");
      await expect(opacity).toHaveAttribute("aria-valuenow", "100");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toContain("#3b82f6");

      const sliderBox = await opacity.boundingBox();
      if (!sliderBox) throw new Error("Group Fill opacity input is missing");
      const middleX = sliderBox.x + sliderBox.width / 2;
      const middleY = sliderBox.y + sliderBox.height / 2;
      const highX = sliderBox.x + sliderBox.width * 0.8;
      await page.mouse.move(highX, middleY);
      await page.mouse.down();
      await page.mouse.move(middleX, middleY, { steps: 4 });
      await page.mouse.up();
      await expect(opacity).toHaveAttribute("aria-valuenow", "50");
      await expect.poll(readFill).toBe("rgba(59, 130, 246, 0.5)");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toMatch(/(?:50%|0\.5)/);

      await fillButton.click();
      await expect(fillButton).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press(`${MOD}+z`);
      await expect.poll(readFill).toBe("rgb(59, 130, 246)");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .not.toMatch(/0\.5|50%/);
      expect(
        (await indexHtml(page, id)).includes('data-agent-native-group="true"'),
      ).toBe(true);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Selection colors records a repeated preview as one undo step", async ({
    page,
  }) => {
    const id = await newDesign(page, GROUP_FILL_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
      await page.keyboard.press(`${MOD}+g`);
      await layerRow(page, "Group").click();
      const selectionColors = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      await selectionColors
        .getByRole("button", { name: "Show selection colors" })
        .click();
      await selectionColors.getByRole("button", { name: /^#f97316$/i }).click();
      const opacity = page.getByRole("slider", {
        name: "Opacity",
        exact: true,
      });
      await opacity.fill("50");
      await opacity.press("Enter");
      await page.keyboard.press("Escape");

      const readPaints = () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator("body")
          .evaluate(() => {
            const style = (id: string) => {
              const element = document.querySelector<HTMLElement>(
                `[data-agent-native-node-id="${id}"]`,
              );
              if (!element) throw new Error(`Missing ${id}`);
              return getComputedStyle(element);
            };
            return {
              fillA: style("fill-a").backgroundColor,
              strokeA: style("fill-a").borderTopColor,
              fillB: style("fill-b").backgroundColor,
              text: style("fill-text").color,
            };
          });
      await expect.poll(readPaints).toEqual({
        fillA: "rgba(249, 115, 22, 0.5)",
        strokeA: "rgba(249, 115, 22, 0.5)",
        fillB: "rgba(249, 115, 22, 0.5)",
        text: "rgba(249, 115, 22, 0.5)",
      });
      const repeatedPreviewCommit = await indexHtml(page, id);
      expect(repeatedPreviewCommit).toContain('data-agent-native-group="true"');
      expect(styleOf(repeatedPreviewCommit, "fill-a")).toMatch(/0\.5|50%/);
      await page.keyboard.press(`${MOD}+z`);
      await expect.poll(readPaints).toEqual({
        fillA: "rgb(249, 115, 22)",
        strokeA: "rgb(249, 115, 22)",
        fillB: "rgb(249, 115, 22)",
        text: "rgb(249, 115, 22)",
      });
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .not.toMatch(/0\.5|50%/);
      const undone = await indexHtml(page, id);
      expect(undone).toContain('data-agent-native-group="true"');
      expect(styleOf(undone, "fill-a")).not.toMatch(/0\.5|50%/);
      expect(styleOf(undone, "fill-b")).not.toMatch(/0\.5|50%/);
      expect(styleOf(undone, "fill-text")).not.toMatch(/0\.5|50%/);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Group Selection colors cancel restores authored paint and keeps gaps transparent", async ({
    page,
  }) => {
    const id = await newDesign(page, GROUP_FILL_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
      await page.keyboard.press(`${MOD}+g`);
      await expect(layerRow(page, "Group")).toBeVisible();
      await layerRow(page, "Group").click();

      const selectionColors = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      await selectionColors
        .getByRole("button", { name: "Show selection colors" })
        .click();
      await selectionColors.getByRole("button", { name: /^#f97316$/i }).click();

      const readPaint = () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator("body")
          .evaluate(() => {
            const style = (id: string) => {
              const element = document.querySelector<HTMLElement>(
                `[data-agent-native-node-id="${id}"]`,
              );
              if (!element) throw new Error(`Missing ${id}`);
              return getComputedStyle(element);
            };
            const group = document.querySelector<HTMLElement>(
              '[data-agent-native-group="true"]',
            );
            if (!group) throw new Error("Missing Group wrapper");
            const groupRect = group.getBoundingClientRect();
            return {
              fillA: style("fill-a").backgroundColor,
              strokeA: style("fill-a").borderTopColor,
              fillB: style("fill-b").backgroundColor,
              strokeB: style("fill-b").borderTopColor,
              text: style("fill-text").color,
              groupBackground: getComputedStyle(group).backgroundColor,
              groupRect: { width: groupRect.width, height: groupRect.height },
              bodyBackground: getComputedStyle(document.body).backgroundColor,
            };
          });

      await expect
        .poll(async () => await indexHtml(page, id))
        .toContain('data-agent-native-group="true"');
      const authoredSource = await indexHtml(page, id);
      const authoredStyles = ["fill-a", "fill-b", "fill-text"].map((nodeId) =>
        styleOf(authoredSource, nodeId),
      );
      const authoredPaint = {
        fillA: "rgb(249, 115, 22)",
        strokeA: "rgb(249, 115, 22)",
        fillB: "rgb(249, 115, 22)",
        strokeB: "rgb(17, 24, 39)",
        text: "rgb(249, 115, 22)",
        groupBackground: "rgba(0, 0, 0, 0)",
        groupRect: { width: 260, height: 144 },
        bodyBackground: "rgb(15, 17, 21)",
      };
      await expect.poll(readPaint).toMatchObject(authoredPaint);

      const opacity = page.getByRole("slider", {
        name: "Opacity",
        exact: true,
      });
      const box = await opacity.boundingBox();
      if (!box) throw new Error("Selection color opacity slider is missing");
      const startX = box.x + box.width - 1;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, startY, { steps: 6 });
      await expect
        .poll(async () => Number(await opacity.getAttribute("aria-valuenow")))
        .toBeLessThan(100);
      await expect.poll(readPaint).toMatchObject({
        fillA: expect.stringMatching(/^rgba\(249, 115, 22, 0\./),
        fillB: expect.stringMatching(/^rgba\(249, 115, 22, 0\./),
        groupBackground: "rgba(0, 0, 0, 0)",
        bodyBackground: "rgb(15, 17, 21)",
      });

      await page.keyboard.press(`${MOD}+z`);
      await expect(opacity).toHaveAttribute("aria-valuenow", "100");
      await expect.poll(readPaint).toMatchObject(authoredPaint);
      await expect
        .poll(async () => {
          const source = await indexHtml(page, id);
          return ["fill-a", "fill-b", "fill-text"].map((nodeId) =>
            styleOf(source, nodeId),
          );
        })
        .toEqual(authoredStyles);
      await page.mouse.up();
      await expect.poll(readPaint).toMatchObject(authoredPaint);
      await expect.poll(async () => indexHtml(page, id)).toBe(authoredSource);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Selection Colors keeps an opacity gesture attached when it collides with another swatch", async ({
    page,
  }) => {
    const id = await newDesign(page, SELECTION_COLOR_ALPHA_COLLISION_FIXTURE);
    try {
      await openEditor(page, id);
      await openGroupedSelectionColors(page);
      const section = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      const laterHalfAlpha = section
        .getByRole("button")
        .filter({ hasText: "50%" });
      await expect(laterHalfAlpha).toHaveCount(1);
      await laterHalfAlpha.click();
      const opacity = page.getByRole("slider", {
        name: "Opacity",
        exact: true,
      });
      await expect(opacity).toHaveAttribute("aria-valuenow", "50");
      const before = await indexHtml(page, id);
      const beforeOpaqueStyle = styleOf(before, "blue-opaque");
      const beforeAlphaStyle = styleOf(before, "blue-alpha");
      const box = await opacity.boundingBox();
      if (!box) throw new Error("Selection color opacity slider is missing");
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width, y, { steps: 6 });
      const readPaints = () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator("body")
          .evaluate(() => {
            const read = (nodeId: string) => {
              const element = document.querySelector<HTMLElement>(
                `[data-agent-native-node-id="${nodeId}"]`,
              );
              if (!element) throw new Error(`Missing ${nodeId}`);
              return getComputedStyle(element).backgroundColor;
            };
            return {
              opaque: read("blue-opaque"),
              edited: read("blue-alpha"),
            };
          });
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgb(59, 130, 246)",
      });
      const pickerStillVisibleBeforeRelease = await opacity
        .isVisible()
        .catch(() => false);
      const rowsBeforeRelease = await section
        .getByRole("button")
        .allInnerTexts()
        .catch(() => [] as string[]);
      await page.mouse.up();
      await expect(opacity).toBeVisible();
      await expect(opacity).toHaveAttribute("aria-valuenow", "100");
      const afterRelease = await waitForSourceChange(page, id, before);
      const afterAlphaStyle = styleOf(afterRelease, "blue-alpha");
      const targetWasSaved =
        afterAlphaStyle !== beforeAlphaStyle &&
        !/(?:0\.5|50%)/i.test(afterAlphaStyle);
      const opaqueLayerStayedUnchanged =
        styleOf(afterRelease, "blue-opaque") === beforeOpaqueStyle;
      const paintsAfterRelease = await readPaints();
      const groupSurvivedRelease = afterRelease.includes(
        'data-agent-native-group="true"',
      );

      expect({
        pickerStillVisibleBeforeRelease,
        rowsBeforeRelease,
        paintsAfterRelease,
        groupSurvivedRelease,
        targetWasSaved,
        opaqueLayerStayedUnchanged,
      }).toMatchObject({
        pickerStillVisibleBeforeRelease: true,
        targetWasSaved: true,
        opaqueLayerStayedUnchanged: true,
      });

      const dragFromFullOpacity = async (target: number) => {
        const rect = await opacity.evaluate(async (element) => {
          let ancestor = element.parentElement;
          while (ancestor) {
            const running = ancestor
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === "running");
            if (running.length) {
              await Promise.all(
                running.map((animation) => animation.finished.catch(() => {})),
              );
              break;
            }
            ancestor = ancestor.parentElement;
          }
          const { left, top, width, height } = element.getBoundingClientRect();
          return { x: left, y: top, width, height };
        });
        const y = rect.y + rect.height / 2;
        const startX = rect.x + rect.width * 0.9;
        const hit = await page.evaluate(
          ({ x, y }) => {
            const slider = document.querySelector<HTMLElement>(
              '[role="slider"][aria-label="Opacity"]',
            );
            const target = document.elementFromPoint(x, y);
            return {
              sliderHit: Boolean(slider && target && slider.contains(target)),
              targetTag: target?.tagName ?? null,
              targetRole: target?.getAttribute("role") ?? null,
              value: slider?.getAttribute("aria-valuenow") ?? null,
              rect: slider?.getBoundingClientRect().toJSON() ?? null,
            };
          },
          { x: startX, y },
        );
        expect(hit.sliderHit).toBe(true);
        await page.mouse.move(startX, y);
        await page.mouse.down();
        await page.mouse.move(rect.x + (rect.width * target) / 100, y, {
          steps: 6,
        });
        await expect
          .poll(async () => Number(await opacity.getAttribute("aria-valuenow")))
          .toBe(target);
        await page.mouse.up();
      };

      const afterFirstRelease = afterRelease;
      await dragFromFullOpacity(80);
      const afterSecondGesture = await waitForSourceChange(
        page,
        id,
        afterFirstRelease,
      );
      await expect(opacity).toBeVisible();
      await expect(opacity).toHaveAttribute("aria-valuenow", "80");
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgba(59, 130, 246, 0.8)",
      });
      expect(styleOf(afterSecondGesture, "blue-opaque")).toBe(
        beforeOpaqueStyle,
      );

      await page.keyboard.press(`${MOD}+z`);
      const afterUndoBetweenGestures = await waitForSourceChange(
        page,
        id,
        afterSecondGesture,
      );
      expect(afterUndoBetweenGestures).not.toBe(afterSecondGesture);
      expect(styleOf(afterUndoBetweenGestures, "blue-alpha")).toBe(
        afterAlphaStyle,
      );
      await expect(opacity).toBeHidden();
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgb(59, 130, 246)",
      });

      await page.keyboard.press(`${MOD}+Shift+z`);
      const afterRedoBetweenGestures = await waitForSourceChange(
        page,
        id,
        afterUndoBetweenGestures,
      );
      expect(styleOf(afterRedoBetweenGestures, "blue-alpha")).toBe(
        styleOf(afterSecondGesture, "blue-alpha"),
      );
      await expect(opacity).toBeHidden();

      await page.keyboard.press(`${MOD}+z`);
      const afterUndoForReopen = await waitForSourceChange(
        page,
        id,
        afterRedoBetweenGestures,
      );
      expect(styleOf(afterUndoForReopen, "blue-alpha")).toBe(afterAlphaStyle);
      await expect(opacity).toBeHidden();
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgb(59, 130, 246)",
      });

      await section.getByRole("button", { name: /^#3b82f6$/i }).click();
      await expect(opacity).toBeVisible();
      await expect(opacity).toHaveAttribute("aria-valuenow", "100");
      await dragFromFullOpacity(70);
      const afterGestureAfterUndo = await waitForSourceChange(
        page,
        id,
        afterUndoForReopen,
      );
      await expect.poll(readPaints).toEqual({
        opaque: "rgba(59, 130, 246, 0.7)",
        edited: "rgba(59, 130, 246, 0.7)",
      });
      expect(styleOf(afterGestureAfterUndo, "blue-opaque")).not.toBe(
        beforeOpaqueStyle,
      );
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Undo and Redo work from the Selection Colors Hex field and close the picker", async ({
    page,
  }) => {
    const id = await newDesign(page, SELECTION_COLOR_ALPHA_COLLISION_FIXTURE);
    try {
      await openEditor(page, id);
      const section = await openGroupedSelectionColors(page);
      const before = await indexHtml(page, id);
      const beforeOpaqueStyle = styleOf(before, "blue-opaque");
      const beforeAlphaStyle = styleOf(before, "blue-alpha");

      await section.getByRole("button", { name: /^#3b82f6$/i }).click();
      const hex = page.getByRole("textbox", { name: "Hex", exact: true });
      await hex.fill("10B981");
      await hex.press("Enter");
      const afterCommit = await waitForSourceChange(page, id, before);
      const committedOpaqueStyle = styleOf(afterCommit, "blue-opaque");
      const committedAlphaStyle = styleOf(afterCommit, "blue-alpha");
      expect(committedOpaqueStyle).not.toBe(beforeOpaqueStyle);
      expect(committedAlphaStyle).toBe(beforeAlphaStyle);

      await hex.focus();
      await page.keyboard.press(`${MOD}+z`);
      const afterUndo = await waitForSourceChange(page, id, afterCommit);
      expect(styleOf(afterUndo, "blue-opaque")).toBe(beforeOpaqueStyle);
      await expect(hex).toBeHidden();

      await page.keyboard.press(`${MOD}+Shift+z`);
      const afterRedo = await waitForSourceChange(page, id, afterUndo);
      expect(styleOf(afterRedo, "blue-opaque")).toBe(committedOpaqueStyle);
      expect(styleOf(afterRedo, "blue-alpha")).toBe(committedAlphaStyle);
      await expect(hex).toBeHidden();
      await expect(
        section.getByRole("button", { name: /^#10b981$/i }),
      ).toBeVisible();
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Selection Colors keeps an opacity-zero preview attached until gesture release", async ({
    page,
  }) => {
    const id = await newDesign(page, SELECTION_COLOR_ALPHA_COLLISION_FIXTURE);
    try {
      await openEditor(page, id);
      await openGroupedSelectionColors(page);
      const section = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      const laterHalfAlpha = section
        .getByRole("button")
        .filter({ hasText: "50%" });
      await expect(laterHalfAlpha).toHaveCount(1);
      await laterHalfAlpha.click();
      const opacity = page.getByRole("slider", {
        name: "Opacity",
        exact: true,
      });
      await expect(opacity).toHaveAttribute("aria-valuenow", "50");
      const before = await indexHtml(page, id);
      const beforeOpaqueStyle = styleOf(before, "blue-opaque");
      const beforeAlphaStyle = styleOf(before, "blue-alpha");
      const box = await opacity.boundingBox();
      if (!box) throw new Error("Selection color opacity slider is missing");
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(box.x, y, { steps: 6 });
      const readPaints = () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator("body")
          .evaluate(() => {
            const read = (nodeId: string) => {
              const element = document.querySelector<HTMLElement>(
                `[data-agent-native-node-id="${nodeId}"]`,
              );
              if (!element) throw new Error(`Missing ${nodeId}`);
              return getComputedStyle(element).backgroundColor;
            };
            return {
              opaque: read("blue-opaque"),
              edited: read("blue-alpha"),
            };
          });
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgba(59, 130, 246, 0)",
      });
      const pickerStillVisibleBeforeRelease = await opacity
        .isVisible()
        .catch(() => false);
      const rowsBeforeRelease = await section
        .getByRole("button")
        .allInnerTexts()
        .catch(() => [] as string[]);
      await page.mouse.up();
      const afterRelease = await waitForSourceChange(page, id, before);
      const afterAlphaStyle = styleOf(afterRelease, "blue-alpha");
      const targetWasSaved =
        afterAlphaStyle !== beforeAlphaStyle &&
        /(?:,\s*0(?:\.0+)?\s*\)|0%|transparent)/i.test(afterAlphaStyle);
      const opaqueLayerStayedUnchanged =
        styleOf(afterRelease, "blue-opaque") === beforeOpaqueStyle;

      await page.keyboard.press(`${MOD}+z`);
      const afterUndo = await waitForSourceChange(page, id, afterRelease);
      const undoRestoredTarget =
        styleOf(afterUndo, "blue-alpha") === beforeAlphaStyle;
      const undoPreservedGroup = afterUndo.includes(
        'data-agent-native-group="true"',
      );
      await page.keyboard.press(`${MOD}+Shift+z`);
      const afterRedo = await waitForSourceChange(page, id, afterUndo);
      const redoRestoredTarget =
        styleOf(afterRedo, "blue-alpha") === afterAlphaStyle;

      expect({
        pickerStillVisibleBeforeRelease,
        rowsBeforeRelease,
        targetWasSaved,
        opaqueLayerStayedUnchanged,
        undoRestoredTarget,
        undoPreservedGroup,
        redoRestoredTarget,
      }).toMatchObject({
        pickerStillVisibleBeforeRelease: true,
        targetWasSaved: true,
        opaqueLayerStayedUnchanged: true,
        undoRestoredTarget: true,
        undoPreservedGroup: true,
        redoRestoredTarget: true,
      });

      await expect(opacity).toBeVisible();
      await expect(opacity).toHaveAttribute("aria-valuenow", "100");

      const dragToOpacity = async (target: number) => {
        const currentBox = await opacity.boundingBox();
        if (!currentBox)
          throw new Error("Selection color opacity slider closed");
        const y = currentBox.y + currentBox.height / 2;
        await page.mouse.move(currentBox.x + currentBox.width - 1, y);
        await page.mouse.down();
        await page.mouse.move(
          currentBox.x + (currentBox.width * target) / 100,
          y,
          { steps: 6 },
        );
        await expect
          .poll(async () => Number(await opacity.getAttribute("aria-valuenow")))
          .toBe(target);
        await page.mouse.up();
      };

      const afterFirstRedo = await indexHtml(page, id);
      await dragToOpacity(80);
      const afterSecondGesture = await waitForSourceChange(
        page,
        id,
        afterFirstRedo,
      );
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgba(59, 130, 246, 0.8)",
      });
      expect(styleOf(afterSecondGesture, "blue-opaque")).toBe(
        beforeOpaqueStyle,
      );

      await page.keyboard.press(`${MOD}+z`);
      const afterUndoBetweenGestures = await waitForSourceChange(
        page,
        id,
        afterSecondGesture,
      );
      await expect(opacity).toBeVisible();
      await expect(opacity).toHaveAttribute("aria-valuenow", "100");
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgb(59, 130, 246)",
      });

      await dragToOpacity(70);
      const afterGestureAfterUndo = await waitForSourceChange(
        page,
        id,
        afterUndoBetweenGestures,
      );
      await expect.poll(readPaints).toEqual({
        opaque: "rgb(59, 130, 246)",
        edited: "rgba(59, 130, 246, 0.7)",
      });
      expect(styleOf(afterGestureAfterUndo, "blue-opaque")).toBe(
        beforeOpaqueStyle,
      );
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Undo cancels a held Selection colors opacity scrub before undoing the committed color", async ({
    page,
  }) => {
    const id = await newDesign(page, GROUP_FILL_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
      await page.keyboard.press(`${MOD}+g`);
      await layerRow(page, "Group").click();
      const selectionColors = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      await selectionColors
        .getByRole("button", { name: "Show selection colors" })
        .click();
      await selectionColors.getByRole("button", { name: /^#f97316$/i }).click();
      const hex = page.getByRole("textbox", { name: "Hex", exact: true });
      await hex.fill("3B82F6");
      await hex.press("Enter");
      await page.keyboard.press("Escape");
      const readPaints = () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator("body")
          .evaluate(() => {
            const style = (id: string) => {
              const element = document.querySelector<HTMLElement>(
                `[data-agent-native-node-id="${id}"]`,
              );
              if (!element) throw new Error(`Missing ${id}`);
              return getComputedStyle(element);
            };
            return {
              fillA: style("fill-a").backgroundColor,
              fillB: style("fill-b").backgroundColor,
              text: style("fill-text").color,
            };
          });
      await expect.poll(readPaints).toEqual({
        fillA: "rgb(59, 130, 246)",
        fillB: "rgb(59, 130, 246)",
        text: "rgb(59, 130, 246)",
      });

      await selectionColors.getByRole("button", { name: /^#3b82f6$/i }).click();
      const opacity = page.getByRole("slider", {
        name: "Opacity",
        exact: true,
      });
      const box = await opacity.boundingBox();
      if (!box) throw new Error("Selection color opacity slider is missing");
      const startX = box.x + box.width - 1;
      const startY = box.y + box.height / 2;
      const startHit = await page.evaluate(
        ({ x, y }) => {
          const slider = document.querySelector<HTMLElement>(
            '[role="slider"][aria-label="Opacity"]',
          );
          const target = document.elementFromPoint(x, y);
          return {
            sliderHit: Boolean(slider && target && slider.contains(target)),
            targetTag: target?.tagName ?? null,
            targetRole: target?.getAttribute("role") ?? null,
            sliderValue: slider?.getAttribute("aria-valuenow") ?? null,
          };
        },
        { x: startX, y: startY },
      );
      console.log("Selection colors opacity slider start hit:", startHit);
      expect(startHit.sliderHit).toBe(true);
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - box.width / 2, startY, { steps: 6 });
      await expect
        .poll(async () => {
          const current = Number(await opacity.getAttribute("aria-valuenow"));
          return current > 0 && current < 100;
        })
        .toBe(true);
      const previewOpacity = Number(
        await opacity.getAttribute("aria-valuenow"),
      );
      await expect.poll(readPaints).toMatchObject({
        fillA: `rgba(59, 130, 246, ${previewOpacity / 100})`,
      });

      await page.keyboard.press(`${MOD}+z`);
      await expect(opacity).toBeVisible();
      await expect(opacity).toHaveAttribute("aria-valuenow", "100");
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toContain("#3b82f6");
      await expect.poll(readPaints).toEqual({
        fillA: "rgb(59, 130, 246)",
        fillB: "rgb(59, 130, 246)",
        text: "rgb(59, 130, 246)",
      });

      await page.mouse.up();
      await expect.poll(readPaints).toEqual({
        fillA: "rgb(59, 130, 246)",
        fillB: "rgb(59, 130, 246)",
        text: "rgb(59, 130, 246)",
      });
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toContain("#3b82f6");
      const afterScrubUndo = await indexHtml(page, id);
      expect(afterScrubUndo).toContain('data-agent-native-group="true"');
      expect(styleOf(afterScrubUndo, "fill-a")).toContain("#3b82f6");
      expect(styleOf(afterScrubUndo, "fill-a")).not.toMatch(/0\.9|90%/);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

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

  test("Group Fill recolors child fills and text, keeps strokes and gaps, and undoes once", async ({
    page,
  }, testInfo) => {
    const viteUpdates: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/^\[vite\] (?:hot updated|page reload)/.test(text)) {
        viteUpdates.push(text);
      }
    });
    const id = await newDesign(page, GROUP_FILL_FIXTURE);
    try {
      await openEditor(page, id);
      await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
      await expect(
        layersTree(page).locator('[role="treeitem"][aria-selected="true"]'),
      ).toHaveCount(3);
      await page.keyboard.press(`${MOD}+g`);
      await expect(
        layersTree(page).getByRole("treeitem").filter({ hasText: "Group" }),
      ).toHaveCount(1);
      await layerRow(page, "Group").click();

      const fillSection = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "Fill", exact: true }),
        })
        .first();
      await expect(fillSection).toBeVisible();
      const fillButton = fillSection.getByRole("button", {
        name: "Open color picker",
      });
      const fillOpacity = fillSection.getByRole("textbox", {
        name: "Paint opacity",
      });
      await expect(fillButton).toBeVisible();
      await expect(fillOpacity).toHaveValue("100");
      const selectionColors = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Selection colors",
            exact: true,
          }),
        })
        .first();
      await expect(
        selectionColors.getByRole("button", { name: "Show selection colors" }),
      ).toBeVisible();
      const readPaint = async () =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator("body")
          .evaluate(() => {
            const byId = (id: string) =>
              document.querySelector<HTMLElement>(
                `[data-agent-native-node-id="${id}"]`,
              )!;
            const groupElement = document.querySelector<HTMLElement>(
              '[data-agent-native-group="true"]',
            )!;
            const textOwner = byId("fill-text");
            const textGlyph =
              textOwner.querySelector<HTMLElement>("[data-an-text]");
            const textPaintTarget = textGlyph ?? textOwner;
            const textPaintStyle = getComputedStyle(textPaintTarget);
            const textUsesClippedPaint =
              textPaintStyle.backgroundClip === "text" ||
              textPaintStyle.webkitBackgroundClip === "text";
            return {
              aFill: getComputedStyle(byId("fill-a")).backgroundColor,
              aStroke: getComputedStyle(byId("fill-a")).borderTopColor,
              bFill: getComputedStyle(byId("fill-b")).backgroundColor,
              bStroke: getComputedStyle(byId("fill-b")).borderTopColor,
              text: textUsesClippedPaint
                ? textPaintStyle.backgroundColor
                : textPaintStyle.color,
              textOwnerBackground: getComputedStyle(textOwner).backgroundColor,
              textGlyphClip: textPaintStyle.backgroundClip,
              textGlyphFill: textPaintStyle.webkitTextFillColor,
              textWrapperCount:
                textOwner.querySelectorAll("[data-an-text]").length,
              groupBackground: getComputedStyle(groupElement).backgroundColor,
              groupRect: groupElement.getBoundingClientRect().toJSON(),
              bodyBackground: getComputedStyle(document.body).backgroundColor,
            };
          });
      await fillButton.click();
      const firstPaintEditViteUpdateIndex = viteUpdates.length;
      const opacity = page.getByRole("spinbutton", {
        name: "Opacity",
        exact: true,
      });
      await opacity.fill("50");
      await opacity.press("Enter");
      await page.keyboard.press("Escape");
      await expect(fillOpacity).toHaveValue("50");
      await expect
        .poll(async () => (await readPaint()).aFill)
        .toBe("rgba(249, 115, 22, 0.5)");

      await page.keyboard.press(`${MOD}+z`);
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .not.toMatch(/0\.5|50%/);
      const afterOpacityUndo = await indexHtml(page, id);
      expect(afterOpacityUndo).toContain('data-agent-native-group="true"');
      expect(afterOpacityUndo).toContain('data-agent-native-node-id="fill-a"');
      const livePaintTargets = await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() =>
          ["fill-a", "fill-b", "fill-text"].map(
            (id) =>
              document.querySelectorAll(`[data-agent-native-node-id="${id}"]`)
                .length,
          ),
        );
      expect(livePaintTargets).toEqual([1, 1, 1]);
      await expect
        .poll(async () => (await readPaint()).aFill)
        .toBe("rgb(249, 115, 22)");
      await expect(fillOpacity).toHaveValue("100");

      await fillButton.click();
      const hex = page.getByRole("textbox", { name: "Hex", exact: true });
      await hex.fill("3B82F6");
      await hex.press("Enter");
      await page.keyboard.press("Escape");
      await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .click({ position: { x: 600, y: 500 } });
      await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .screenshot({
          path: testInfo.outputPath("group-fill-text-rendered.png"),
        });

      const group = page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator('[data-agent-native-layer-name="Group"]')
        .first();
      await expect
        .poll(async () => (await readPaint()).aFill)
        .toBe("rgb(59, 130, 246)");
      await expect
        .poll(async () => (await readPaint()).bFill)
        .toBe("rgb(59, 130, 246)");
      await expect
        .poll(async () => (await readPaint()).text)
        .toBe("rgb(59, 130, 246)");
      expect(await readPaint()).toMatchObject({
        textOwnerBackground: "rgb(59, 130, 246)",
        textGlyphClip: "text",
        textGlyphFill: "rgba(0, 0, 0, 0)",
        textWrapperCount: 0,
        aStroke: "rgb(249, 115, 22)",
        bStroke: "rgb(17, 24, 39)",
        groupBackground: "rgba(0, 0, 0, 0)",
        groupRect: { width: 260, height: 144 },
        bodyBackground: "rgb(15, 17, 21)",
      });
      await expect
        .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
        .toContain("#3b82f6");
      const committed = await indexHtml(page, id);
      expect(styleOf(committed, "fill-a")).toContain("#3b82f6");
      expect(styleOf(committed, "fill-b")).toContain("#3b82f6");
      expect(styleOf(committed, "fill-text")).toContain("#3b82f6");

      await page.keyboard.press(`${MOD}+z`);
      await expect
        .poll(async () => (await readPaint()).aFill)
        .toBe("rgb(249, 115, 22)");
      await expect
        .poll(async () => (await readPaint()).text)
        .toBe("rgb(249, 115, 22)");
      const undone = await indexHtml(page, id);
      expect(styleOf(undone, "fill-a")).toContain("#f97316");
      expect(styleOf(undone, "fill-b")).toContain("#f97316");
      expect(styleOf(undone, "fill-text")).toContain("#f97316");
      expect(undone).toContain('data-agent-native-group="true"');
      const groupRow = layerRow(page, "Group");
      const expandGroup = groupRow.getByRole("button", {
        name: "Expand layer",
        exact: true,
      });
      if ((await expandGroup.count()) > 0) await expandGroup.click();
      const textRow = layerRow(page, "Fill Text");
      await expect(textRow).toHaveCount(1);
      const textBox = (await node(page, "fill-text").boundingBox())!;
      await page.mouse.dblclick(
        textBox.x + textBox.width / 2,
        textBox.y + textBox.height / 2,
      );
      const editableText = page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator('[contenteditable="true"]');
      await expect(editableText).toBeVisible();
      await page.keyboard.press(`${MOD}+Enter`);
      await expect(editableText).toHaveCount(0);
      await expect(textRow).toHaveCount(1);
      expect(
        await node(page, "fill-text").evaluate((element) => element.tagName),
      ).toBe("DIV");
      await page.reload({ waitUntil: "domcontentloaded" });
      await toolbar(page).locator('button[aria-label="Move"]').waitFor();
      await expandAllLayers(page);
      const reloadedGroupRow = layerRow(page, "Group");
      const expandReloadedGroup = reloadedGroupRow.getByRole("button", {
        name: "Expand layer",
        exact: true,
      });
      if ((await expandReloadedGroup.count()) > 0)
        await expandReloadedGroup.click();
      await expect(layerRow(page, "Fill Text")).toHaveCount(1);
      const reloadedSource = await indexHtml(page, id);
      expect(reloadedSource).toContain('data-agent-native-group="true"');
      expect(reloadedSource).toContain('data-agent-native-node-id="fill-text"');
      expect(
        await node(page, "fill-text").evaluate((element) => element.tagName),
      ).toBe("DIV");
      await expect
        .poll(() =>
          node(page, "fill-text").evaluate(
            (element) => getComputedStyle(element).color,
          ),
        )
        .toBe("rgb(249, 115, 22)");
      expect(
        viteUpdates.slice(firstPaintEditViteUpdateIndex),
        "Group Fill history assertions are invalid if Vite updates or reloads the editor between paint edit and Undo.",
      ).toEqual([]);
    } finally {
      await postAction(page, "delete-design", { id });
    }
  });

  test("Group Fill stacks, hides, restores, removes, and replaces shared paints", async ({
    page,
  }) => {
    const viteUpdates: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/^\[vite\] (?:hot updated|page reload)/.test(text)) {
        viteUpdates.push(text);
      }
    });
    const id = await newDesign(page, GROUP_FILL_FIXTURE);
    await openEditor(page, id);
    await multiSelect(page, ["Fill A", "Fill B", "Fill Text"]);
    await page.keyboard.press(`${MOD}+g`);
    await expect(layerRow(page, "Group")).toBeVisible();
    await layerRow(page, "Group").click();

    const fillSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    const addFill = fillSection.getByRole("button", {
      name: "Add fill",
      exact: true,
    });
    await addFill.click();
    await expect(
      page.getByRole("spinbutton", { name: "Opacity", exact: true }),
    ).toHaveValue("20");

    const readRendered = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const style = (id: string) => {
            const node = document.querySelector<HTMLElement>(
              `[data-agent-native-node-id="${id}"]`,
            );
            return node ? getComputedStyle(node) : null;
          };
          const a = style("fill-a");
          const b = style("fill-b");
          const text = style("fill-text");
          const textOwner = document.querySelector<HTMLElement>(
            '[data-agent-native-node-id="fill-text"]',
          );
          const glyph = textOwner?.querySelector<HTMLElement>("[data-an-text]");
          const textPaintTarget = glyph ?? textOwner;
          const textPaintStyle = textPaintTarget
            ? getComputedStyle(textPaintTarget)
            : null;
          return {
            aImage: a?.backgroundImage ?? "",
            bImage: b?.backgroundImage ?? "",
            aFill: a?.backgroundColor ?? "",
            bFill: b?.backgroundColor ?? "",
            aStroke: a?.borderTopColor ?? "",
            bStroke: b?.borderTopColor ?? "",
            textFillColor: textPaintStyle?.backgroundColor ?? "",
            textFillImage: textPaintStyle?.backgroundImage ?? "",
            textFillClip: textPaintStyle?.backgroundClip ?? "",
            textColor: text?.color ?? "",
            body: getComputedStyle(document.body).backgroundColor,
          };
        });
    await expect
      .poll(async () => (await readRendered()).aImage)
      .toContain("rgba(0, 0, 0, 0.2)");
    expect(await readRendered()).toMatchObject({
      aFill: "rgb(249, 115, 22)",
      aStroke: "rgb(249, 115, 22)",
      bStroke: "rgb(17, 24, 39)",
      body: "rgb(15, 17, 21)",
    });
    expect((await readRendered()).textFillImage).toContain(
      "rgba(0, 0, 0, 0.2)",
    );
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
      .toMatch(/background-image:\s*linear-gradient\(rgba\(0, 0, 0, 0\.2\)/);

    await page.keyboard.press("Escape");
    await fillSection
      .getByRole("button", { name: "Hide layer", exact: true })
      .nth(1)
      .click();
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
      .toMatch(/background-size:\s*0px 0px/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await toolbar(page).locator('button[aria-label="Move"]').waitFor();
    await expandAllLayers(page);
    await layerRow(page, "Group").click();
    const reloadedFillSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    await reloadedFillSection
      .getByRole("button", { name: "Show layer", exact: true })
      .click();
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
      .toMatch(/background-size:\s*auto/);
    await reloadedFillSection
      .getByRole("button", { name: "Remove layer", exact: true })
      .nth(1)
      .click();
    await expect
      .poll(async () => styleOf(await indexHtml(page, id), "fill-a"))
      .toMatch(/background-image:\s*none/);

    await layerRow(page, "Fill B").click();
    const childFillSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    await childFillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill("3B82F6");
    await hex.press("Enter");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await indexHtml(page, id)).includes("#3b82f6"))
      .toBe(true);

    await layerRow(page, "Group").click();
    await expect(
      fillSection.getByText("Click + to replace mixed content", {
        exact: true,
      }),
    ).toBeVisible();
    await fillSection
      .getByRole("button", { name: "Add fill", exact: true })
      .click();
    await expect
      .poll(async () => (await readRendered()).aFill)
      .toBe("rgb(59, 130, 246)");
    const mixedAdded = await indexHtml(page, id);
    expect(styleOf(mixedAdded, "fill-a")).toMatch(
      /background-color:\s*(?:#3b82f6|rgb\(59, 130, 246\))/,
    );
    expect(styleOf(mixedAdded, "fill-text")).toMatch(
      /background-color:\s*(?:#3b82f6|rgb\(59, 130, 246\))/,
    );
    expect(await readRendered()).toMatchObject({
      textFillColor: "rgb(59, 130, 246)",
      textFillImage: "none",
      textFillClip: "text",
    });
    expect(styleOf(mixedAdded, "fill-b")).toMatch(
      /border:\s*8px solid #111827/,
    );

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => (await readRendered()).aFill)
      .toBe("rgb(249, 115, 22)");
    await expect
      .poll(async () => (await readRendered()).bFill)
      .toBe("rgb(59, 130, 246)");
    expect(viteUpdates).toEqual([]);
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
    await page.waitForTimeout(1500);

    const before = await indexHtml(page, id);
    const aBefore = styleNum(styleOf(before, "loose-a"), "top");
    const s = await scale(page);
    const box = (await node(page, "loose-a").boundingBox())!;
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
    const tolerance = Math.ceil(6 / s);
    expect(
      Math.abs(100 - aDelta),
      `dragging 100px up landed ${aDelta}; at zoom ${s} the 6px screen snap ` +
        `threshold spans ${tolerance} content px, which cannot account for it`,
    ).toBeLessThanOrEqual(tolerance);
  });

  test("a multi-selection shows one combined bounding box", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await multiSelect(page, ["Loose A", "Loose B"]);
    await page.waitForTimeout(800);

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

  // Aspirational: no [data-smart-selection], [data-spacing-handle] or
  // [data-smart-handle] exists in the app yet, so this specifies Figma
  // smart-selection rather than guarding it.
  test.fixme("Smart selection exposes spacing handles for evenly spaced layers", async ({
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
    const beforeHtml = await indexHtml(page, id);
    const before = styleOf(beforeHtml, "wrap");
    const wBefore = styleNum(before, "width");
    const hBefore = styleNum(before, "height");
    const kidLeftBefore = styleNum(styleOf(beforeHtml, "kid-1"), "left");

    await selectViaTree(page, "Kid One");
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(2000);

    const afterHtml = await indexHtml(page, id);
    expect(
      styleNum(styleOf(afterHtml, "kid-1"), "left"),
      `the child must move for this to test anything (left stayed ${kidLeftBefore})`,
    ).not.toBe(kidLeftBefore);

    const after = styleOf(afterHtml, "wrap");
    expect(
      [styleNum(after, "width"), styleNum(after, "height")],
      `Figma: "frames are layers whose size is explicitly set by you" — moving a child ` +
        `must not resize the frame. It went ${wBefore}x${hBefore} → ` +
        `${styleNum(after, "width")}x${styleNum(after, "height")}.`,
    ).toEqual([wBefore, hBefore]);
  });
});
