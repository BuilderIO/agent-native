import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { collectAppPageErrors } from "../../lib/app";
import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";

const SITE = siteById("design");
const ORIGIN = originFor(SITE);
const PRIMARY_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";
const PREVIEW = "iframe[data-design-preview-iframe]";
const SHAPE_ID = "beta-layered-shape";
const HEADING_ID = "beta-heading";
const BODY_ID = "beta-body";
const SHAPE_NAME = "Layered Shape";
const HEADING_NAME = "Beta Heading";
const BODY_NAME = "Beta Body";
const FINAL_TEXT_SIZE = "28";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Beta Design interactions</title></head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="beta-root" data-agent-native-layer-name="Beta Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="${SHAPE_ID}" data-agent-native-layer-name="${SHAPE_NAME}" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#123456;background-image:url(&quot;https://fills.invalid/beta-layer-one.png&quot;),radial-gradient(circle at center,#00ff00 0%,#ff00ff 100%);background-size:cover,24px 24px;background-repeat:no-repeat,repeat-x;background-position:center,30% 40%"></div>
      <h1 data-agent-native-node-id="${HEADING_ID}" data-agent-native-layer-name="${HEADING_NAME}" style="position:absolute;left:64px;top:300px;margin:0;font-size:32px;font-weight:700;color:#0f172a">Beta Heading</h1>
      <p data-agent-native-node-id="${BODY_ID}" data-agent-native-layer-name="${BODY_NAME}" style="position:absolute;left:64px;top:360px;margin:0;font-size:18px;font-weight:400;line-height:1.5;color:#475569">Beta Body</p>
    </main>
  </body>
</html>`;

interface StyleSnapshot {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  backgroundSize: string;
  fontSize: string;
  fontWeight: string;
}

interface AuthedPage {
  context: BrowserContext;
  page: Page;
  appErrors: string[];
}

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await page.request.post(
    `${ORIGIN}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok())
    throw new Error(`${name} failed: HTTP ${response.status()}`);
  return response.json();
}

async function readSource(page: Page, designId: string): Promise<string> {
  const url = new URL("/_agent-native/actions/read-source-file", ORIGIN);
  url.searchParams.set("designId", designId);
  url.searchParams.set("path", "index.html");
  const response = await page.request.get(url.href);
  if (!response.ok()) {
    throw new Error(`read-source-file failed: HTTP ${response.status()}`);
  }
  const result = (await response.json()) as { content?: unknown };
  if (typeof result.content !== "string") {
    throw new Error("read-source-file returned no source content");
  }
  return result.content;
}

async function parseSource(
  page: Page,
  source: string,
  nodeIds: readonly string[],
): Promise<Record<string, StyleSnapshot>> {
  return page.evaluate(
    ({ html, ids }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const result: Record<string, StyleSnapshot> = {};
      for (const id of ids) {
        const node = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-agent-native-node-id]",
          ),
        ].find((candidate) => candidate.dataset.agentNativeNodeId === id);
        if (!node) throw new Error(`saved source is missing ${id}`);
        result[id] = {
          backgroundColor: node.style.backgroundColor,
          backgroundImage: node.style.backgroundImage,
          backgroundPosition: node.style.backgroundPosition,
          backgroundRepeat: node.style.backgroundRepeat,
          backgroundSize: node.style.backgroundSize,
          fontSize: node.style.fontSize,
          fontWeight: node.style.fontWeight,
        };
      }
      return result;
    },
    { html: source, ids: nodeIds },
  );
}

async function readSourceStyles(
  page: Page,
  designId: string,
  nodeIds: readonly string[],
): Promise<Record<string, StyleSnapshot>> {
  return parseSource(page, await readSource(page, designId), nodeIds);
}

async function readRenderedStyles(
  page: Page,
  nodeIds: readonly string[],
): Promise<Record<string, StyleSnapshot>> {
  return page
    .locator(PREVIEW)
    .last()
    .contentFrame()
    .locator("body")
    .evaluate((body, ids) => {
      const result: Record<string, StyleSnapshot> = {};
      for (const id of ids) {
        const node = [
          ...body.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
        ].find((candidate) => candidate.dataset.agentNativeNodeId === id);
        if (!node) throw new Error(`rendered frame is missing ${id}`);
        const style = getComputedStyle(node);
        result[id] = {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          backgroundPosition: style.backgroundPosition,
          backgroundRepeat: style.backgroundRepeat,
          backgroundSize: style.backgroundSize,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      }
      return result;
    }, nodeIds);
}

function splitCssList(value: string): string[] {
  const layers: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers.filter(Boolean);
}

async function openAuthedPage(browser: Browser): Promise<AuthedPage> {
  const context = await signedInContext(browser, SITE, { seedModel: false });
  try {
    await assertSignedInOnBeta(context, SITE);
    const page = await context.newPage();
    const { errors } = collectAppPageErrors(page, ORIGIN);
    return { context, page, appErrors: errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function createFixture(
  page: Page,
  onCreated: (designId: string) => void,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: runMarker(`Design interactions ${Date.now()}`),
    projectType: "prototype",
  });
  const designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design returned no id");
  onCreated(designId);
  try {
    await postAction(page, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });
  } catch (error) {
    try {
      await postAction(page, "delete-design", { id: designId });
      onCreated("");
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `create-file failed for ${designId}; cleanup also failed`,
      );
    }
    throw error;
  }
  return designId;
}

async function cleanupTest(options: {
  context: BrowserContext;
  page: Page;
  designId: string;
  appErrors: string[];
  primaryFailure: boolean;
}): Promise<void> {
  const failures: string[] = [];
  try {
    if (options.designId) {
      await postAction(options.page, "delete-design", { id: options.designId });
    }
  } catch (error) {
    failures.push(
      `delete-design failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    expect(
      options.appErrors,
      `${ORIGIN} emitted app-owned page errors`,
    ).toEqual([]);
  } catch (error) {
    failures.push(
      `app-owned page errors: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await options.context.close();
  } catch (error) {
    failures.push(
      `context.close failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (failures.length === 0) return;

  const message = `[beta-e2e] Design test teardown failures:\n${failures.join("\n")}`;
  console.error(message);
  if (options.primaryFailure) {
    test.info().annotations.push({
      type: "cleanup-failure",
      description: message,
    });
    return;
  }
  throw new Error(message);
}

function frame(page: Page) {
  return page.locator(PREVIEW).last().contentFrame();
}

async function waitForEditor(page: Page, readyNodeId: string): Promise<void> {
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(PREVIEW).last()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        frame(page)
          .locator(`[data-agent-native-node-id="${readyNodeId}"]`)
          .count(),
      { timeout: 30_000 },
    )
    .toBe(1);
  await expect(
    frame(page).locator('[data-agent-native-edit-overlay="shield"]'),
  ).toBeAttached({ timeout: 30_000 });
}

async function enterDirectMode(page: Page): Promise<void> {
  const allScreens = page
    .locator("aside")
    .first()
    .getByRole("button", { name: "All screens", exact: true });
  if (
    (await allScreens.count()) > 0 &&
    (await allScreens.getAttribute("aria-current")) !== "page"
  ) {
    await allScreens.click();
    await expect(allScreens).toHaveAttribute("aria-current", "page");
  }
  await expect(
    frame(page).locator('[data-agent-native-edit-overlay="shield"]'),
  ).toBeAttached({ timeout: 15_000 });
}

async function openEditor(
  page: Page,
  designId: string,
  readyNodeId: string,
): Promise<void> {
  await page.goto(`${ORIGIN}/design/${designId}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForEditor(page, readyNodeId);
  await enterDirectMode(page);
}

async function expandLayers(page: Page): Promise<void> {
  const tree = page.getByRole("tree", { name: "Layers" });
  await expect(tree.getByRole("treeitem").first()).toBeVisible({
    timeout: 30_000,
  });
  for (let index = 0; index < 128; index += 1) {
    const expand = page.getByRole("button", { name: "Expand layer" }).first();
    if ((await expand.count()) === 0) return;
    const row = expand.locator('xpath=ancestor::*[@role="treeitem"][1]');
    await expand.click();
    await expect(
      row.getByRole("button", { name: "Collapse layer" }),
    ).toHaveCount(1);
  }
  throw new Error("Layers tree still has collapsed rows after 128 expansions");
}

function layerButton(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .first();
}

async function selectLayer(
  page: Page,
  name: string,
  withPrimaryModifier = false,
): Promise<void> {
  const button = layerButton(page, name);
  await expect(button).toBeVisible({ timeout: 15_000 });
  if (withPrimaryModifier) {
    await button.click({ force: true, modifiers: [PRIMARY_MODIFIER] });
  } else {
    await button.click({ force: true });
  }
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}

function fillSection(page: Page): Locator {
  return page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Fill", exact: true }),
    })
    .first();
}

function typographySection(page: Page): Locator {
  return page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Typography", exact: true }),
    })
    .first();
}

test.describe.configure({ mode: "serial" });

test.describe("authenticated beta Design interactions", () => {
  test.skip(
    !selectedSites().some((site) => site.id === SITE.id),
    "design is not selected by BETA_E2E_APPS",
  );

  test.beforeEach(() => skipUnlessAuthed());

  test("converting a base solid preserves ordered fill layers through reload", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createFixture(page, (id) => {
        designId = id;
      });
      await openEditor(page, designId, SHAPE_ID);
      await expandLayers(page);
      await selectLayer(page, SHAPE_NAME);

      const beforeRendered = (await readRenderedStyles(page, [SHAPE_ID]))[
        SHAPE_ID
      ];
      const beforeImages = splitCssList(beforeRendered.backgroundImage);
      expect(beforeRendered.backgroundColor).toBe("rgb(18, 52, 86)");
      expect(beforeImages).toHaveLength(2);
      expect(splitCssList(beforeRendered.backgroundSize)).toHaveLength(2);
      expect(splitCssList(beforeRendered.backgroundRepeat)).toHaveLength(2);
      expect(splitCssList(beforeRendered.backgroundPosition)).toHaveLength(2);

      const rows = fillSection(page).locator(
        '[data-inspector-layout="drag-paint-row"]',
      );
      await expect(rows).toHaveCount(2);
      const initialRows = await rows.allTextContents();
      expect(initialRows[0]).toMatch(/Image 1/);
      expect(initialRows[1]).toMatch(/Radial gradient 2/);

      await fillSection(page)
        .locator('[data-inspector-layout="paint-row"]')
        .getByRole("button", { name: "Open color picker" })
        .click();
      await page.getByRole("button", { name: "Linear", exact: true }).click();
      await expect(
        page.getByRole("group", { name: "Gradient stops" }),
      ).toBeVisible();

      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [SHAPE_ID]))[SHAPE_ID]
              .backgroundImage,
        )
        .toContain("linear-gradient");
      const afterRendered = (await readRenderedStyles(page, [SHAPE_ID]))[
        SHAPE_ID
      ];
      const afterImages = splitCssList(afterRendered.backgroundImage);
      expect(afterRendered.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(afterImages.slice(0, 2)).toEqual(beforeImages);
      expect(afterImages.at(-1)).toMatch(/^linear-gradient/i);
      expect(splitCssList(afterRendered.backgroundSize).slice(0, 2)).toEqual(
        splitCssList(beforeRendered.backgroundSize),
      );
      expect(splitCssList(afterRendered.backgroundSize).at(-1)).toBe("auto");
      expect(splitCssList(afterRendered.backgroundRepeat).slice(0, 2)).toEqual(
        splitCssList(beforeRendered.backgroundRepeat),
      );
      expect(splitCssList(afterRendered.backgroundRepeat).at(-1)).toBe(
        "no-repeat",
      );
      expect(
        splitCssList(afterRendered.backgroundPosition).slice(0, 2),
      ).toEqual(splitCssList(beforeRendered.backgroundPosition));
      expect(splitCssList(afterRendered.backgroundPosition).at(-1)).toBe(
        "0% 0%",
      );

      await expect
        .poll(async () => {
          const saved = (await readSourceStyles(page, designId, [SHAPE_ID]))[
            SHAPE_ID
          ];
          return splitCssList(saved.backgroundImage).length;
        })
        .toBe(3);
      const savedBeforeReload = (
        await readSourceStyles(page, designId, [SHAPE_ID])
      )[SHAPE_ID];
      const savedImages = splitCssList(savedBeforeReload.backgroundImage);
      expect(savedImages[0]).toMatch(/^url\(/i);
      expect(savedImages[1]).toMatch(/^radial-gradient/i);
      expect(savedImages[2]).toMatch(/^linear-gradient/i);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForEditor(page, SHAPE_ID);
      await enterDirectMode(page);
      await expandLayers(page);
      await selectLayer(page, SHAPE_NAME);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [SHAPE_ID]))[SHAPE_ID]
              .backgroundImage,
        )
        .toContain("linear-gradient");
      const afterReload = (await readRenderedStyles(page, [SHAPE_ID]))[
        SHAPE_ID
      ];
      expect(splitCssList(afterReload.backgroundImage)).toEqual(afterImages);
      expect(splitCssList(afterReload.backgroundSize)).toEqual(
        splitCssList(afterRendered.backgroundSize),
      );
      expect(splitCssList(afterReload.backgroundRepeat)).toEqual(
        splitCssList(afterRendered.backgroundRepeat),
      );
      expect(splitCssList(afterReload.backgroundPosition)).toEqual(
        splitCssList(afterRendered.backgroundPosition),
      );
      const reloadedRows = fillSection(page).locator(
        '[data-inspector-layout="drag-paint-row"]',
      );
      await expect(reloadedRows).toHaveCount(3);
      const reloadedRowText = await reloadedRows.allTextContents();
      expect(reloadedRowText[0]).toMatch(/Image 1/);
      expect(reloadedRowText[1]).toMatch(/Radial gradient 2/);
      expect(reloadedRowText[2]).toMatch(/Linear gradient 3/);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });

  test("multi-selected text shares size, undoes once, and persists after reload", async ({
    browser,
  }) => {
    const { context, page, appErrors } = await openAuthedPage(browser);
    let designId = "";
    let primaryFailure = false;
    try {
      designId = await createFixture(page, (id) => {
        designId = id;
      });
      await openEditor(page, designId, HEADING_ID);
      await expandLayers(page);
      await selectLayer(page, HEADING_NAME);
      await selectLayer(page, BODY_NAME, true);
      await expect
        .poll(() =>
          page.locator('[role="treeitem"][aria-selected="true"]').count(),
        )
        .toBe(2);

      const before = await readRenderedStyles(page, [HEADING_ID, BODY_ID]);
      expect(before[HEADING_ID].fontWeight).not.toBe(
        before[BODY_ID].fontWeight,
      );
      expect(before[HEADING_ID].fontSize).not.toBe(before[BODY_ID].fontSize);
      const size = typographySection(page).locator(
        'input[aria-label="Size" i]',
      );
      await expect(size).toHaveValue("Mixed");
      await size.fill(FINAL_TEXT_SIZE);
      await size.press("Enter");
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[HEADING_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);

      await page.keyboard.press(`${PRIMARY_MODIFIER}+z`);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[HEADING_ID]
              .fontSize,
        )
        .toBe(before[HEADING_ID].fontSize);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(before[BODY_ID].fontSize);

      await size.fill(FINAL_TEXT_SIZE);
      await size.press("Enter");
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      await expect
        .poll(async () => {
          const saved = await readSourceStyles(page, designId, [
            HEADING_ID,
            BODY_ID,
          ]);
          return [saved[HEADING_ID].fontSize, saved[BODY_ID].fontSize];
        })
        .toEqual([`${FINAL_TEXT_SIZE}px`, `${FINAL_TEXT_SIZE}px`]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForEditor(page, HEADING_ID);
      await enterDirectMode(page);
      await expandLayers(page);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[HEADING_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      await expect
        .poll(
          async () =>
            (await readRenderedStyles(page, [HEADING_ID, BODY_ID]))[BODY_ID]
              .fontSize,
        )
        .toBe(`${FINAL_TEXT_SIZE}px`);
      const savedAfterReload = await readSourceStyles(page, designId, [
        HEADING_ID,
        BODY_ID,
      ]);
      expect(savedAfterReload[HEADING_ID].fontSize).toBe(
        `${FINAL_TEXT_SIZE}px`,
      );
      expect(savedAfterReload[BODY_ID].fontSize).toBe(`${FINAL_TEXT_SIZE}px`);
    } catch (error) {
      primaryFailure = true;
      throw error;
    } finally {
      await cleanupTest({
        context,
        page,
        designId,
        appErrors,
        primaryFailure,
      });
    }
  });
});
