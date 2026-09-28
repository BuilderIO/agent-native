import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  designFrame,
  gotoEditor,
  selectByText,
} from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

type DesignFile = {
  id: string;
  filename?: string;
  content?: string;
};

type DesignRecord = {
  files?: DesignFile[];
};

function typographySection(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Typography" }) })
    .first();
}

async function postAction(
  page: Page,
  action: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${action}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${action} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function readDesignFile(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(await response.text());
  const design = (await response.json()) as DesignRecord;
  const file = design.files?.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file?.content) throw new Error("design is missing index.html content");
  return { file, source: file.content };
}

function addLegacyLineHeightValues(source: string): string {
  const heading = source.match(/<h1\b[^>]*>E2E Hero Heading<\/h1>/i)?.[0];
  if (!heading) throw new Error("fixture heading was not found");
  const headingStyle = heading.match(/\sstyle="([^"]*)"/i)?.[1];
  if (!headingStyle) throw new Error("fixture heading has no style attribute");
  if (/\bline-height\s*:/i.test(headingStyle)) {
    throw new Error("fixture heading already has a line-height declaration");
  }
  const withNormal = heading.replace(
    `style="${headingStyle}"`,
    `style="${headingStyle};line-height:normal"`,
  );
  let next = source.replace(heading, withNormal);

  const paragraph = next.match(
    /<p\b[^>]*>First fixture paragraph for selection tests\.<\/p>/i,
  )?.[0];
  if (!paragraph || !paragraph.includes("line-height:1.6")) {
    throw new Error("fixture paragraph no longer has its expected 1.6 value");
  }
  next = next.replace(
    paragraph,
    paragraph.replace("line-height:1.6", "line-height:1.5"),
  );
  return next;
}

async function prepareLineHeightDesign(page: Page, title: string) {
  const designId = await createFixtureDesign(page, title);
  try {
    const { file, source } = await readDesignFile(page, designId);
    const content = addLegacyLineHeightValues(source);
    await postAction(page, "update-file", { id: file.id, content });
    return designId;
  } catch (error) {
    await postAction(page, "delete-design", { id: designId });
    throw error;
  }
}

function lineHeightInput(page: Page) {
  return typographySection(page).locator('input[aria-label="Line height" i]');
}

async function setLineHeight(page: Page, value: string) {
  const input = lineHeightInput(page);
  await input.fill(value);
  await input.press("Enter");
}

async function selectedNodeId(page: Page, selector: string): Promise<string> {
  const node = designFrame(page).locator(selector).first();
  await expect(node).toHaveCount(1);
  await expect(node).toBeAttached();
  const id = await node.getAttribute("data-agent-native-node-id");
  if (!id) throw new Error(`${selector} has no durable node id`);
  return id;
}

async function selectLayerByName(page: Page, name: string) {
  const button = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(
    button.locator("xpath=ancestor::*[@role='treeitem']"),
  ).toHaveAttribute("aria-selected", "true");
}

function sourceStyleValue(source: string, nodeId: string, property: string) {
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = source.match(
    new RegExp(`<[^>]*data-agent-native-node-id=["']${escaped}["'][^>]*>`),
  )?.[0];
  if (!tag) throw new Error(`source is missing node ${nodeId}`);
  const style = tag.match(/\sstyle=(["'])(.*?)\1/i)?.[2] ?? "";
  const declaration = style
    .split(";")
    .reverse()
    .map((part) => part.trim())
    .find((part) =>
      part.toLowerCase().startsWith(`${property.toLowerCase()}:`),
    );
  return declaration?.slice(declaration.indexOf(":") + 1).trim() ?? "";
}

async function readLiveNode(page: Page, selector: string) {
  return designFrame(page)
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        height: rect.height,
      };
    });
}

async function expectSourceAndRender(
  page: Page,
  designId: string,
  selector: string,
  expectedSource: string,
  expectedComputed: string,
  expectedHeight?: number,
) {
  const nodeId = await selectedNodeId(page, selector);
  await expect
    .poll(async () => {
      const { source } = await readDesignFile(page, designId);
      return sourceStyleValue(source, nodeId, "line-height");
    })
    .toBe(expectedSource);
  await expect
    .poll(async () => (await readLiveNode(page, selector)).lineHeight)
    .toBe(expectedComputed);
  if (expectedHeight !== undefined) {
    await expect
      .poll(async () => (await readLiveNode(page, selector)).height)
      .toBeCloseTo(expectedHeight, 0);
  }
}

test("line-height Auto, px, percent, and legacy unitless values round-trip", async ({
  page,
}) => {
  const designId = await prepareLineHeightDesign(
    page,
    "Line-height units proof",
  );
  const headingText = "E2E Hero Heading";
  const headingSelector = "h1";
  const paragraphText = "First fixture paragraph for selection tests.";
  const paragraphSelector = "main p";

  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await selectByText(page, headingText);

    const typography = typographySection(page);
    const fontButton = typography.getByRole("button", {
      name: "Font",
      exact: true,
    });
    await fontButton.click();
    const fontSearch = page.getByRole("combobox", { name: "Search" });
    await fontSearch.fill("Lato");
    await page.getByRole("option", { name: "Lato", exact: true }).click();

    const weight = typography.getByRole("combobox").first();
    await weight.click();
    await page.getByRole("option", { name: "Bold", exact: true }).click();

    const size = typography.locator('input[aria-label="Size" i]');
    await size.fill("16");
    await size.press("Enter");

    const loadedLatoFaces = await designFrame(page)
      .locator("body")
      .evaluate(async (body) => {
        const faces = await body.ownerDocument.fonts.load(
          '700 16px "Lato"',
          "Tasty Bites: Exploring Culinary Delights",
        );
        return faces.map((face) => ({
          family: face.family,
          weight: face.weight,
          status: face.status,
        }));
      });
    expect(loadedLatoFaces).toContainEqual({
      family: "Lato",
      weight: "700",
      status: "loaded",
    });
    await expect
      .poll(async () => (await readLiveNode(page, headingSelector)).fontWeight)
      .toBe("700");

    const headingId = await selectedNodeId(page, headingSelector);
    const { source: initialSource } = await readDesignFile(page, designId);
    expect(sourceStyleValue(initialSource, headingId, "line-height")).toBe(
      "normal",
    );
    await expect(lineHeightInput(page)).toHaveValue("Auto");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "normal",
      "normal",
      19,
    );

    await lineHeightInput(page).press("ArrowUp");
    await expect(lineHeightInput(page)).toHaveValue("20px");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "20px",
      "20px",
      20,
    );

    await setLineHeight(page, "30");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "30px",
      "30px",
      30,
    );
    await lineHeightInput(page).press("ArrowUp");
    await expect(lineHeightInput(page)).toHaveValue("31px");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "31px",
      "31px",
      31,
    );

    await page.getByRole("heading", { name: "Typography" }).click();
    await page.keyboard.press(`${MOD}+z`);
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "30px",
      "30px",
      30,
    );
    await expect(lineHeightInput(page)).toHaveValue("30px");

    await setLineHeight(page, "150%");
    await expect(lineHeightInput(page)).toHaveValue("150%");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "150%",
      "24px",
      24,
    );

    await setLineHeight(page, "30");
    await expect(lineHeightInput(page)).toHaveValue("30px");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "30px",
      "30px",
      30,
    );

    await page.reload();
    await selectLayerByName(page, headingText);
    await expect(lineHeightInput(page)).toHaveValue("30px");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "30px",
      "30px",
      30,
    );

    await setLineHeight(page, "+5");
    await expect(lineHeightInput(page)).toHaveValue("5px");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "5px",
      "5px",
      5,
    );

    await setLineHeight(page, "150%");
    await lineHeightInput(page).press("ArrowUp");
    await expect(lineHeightInput(page)).toHaveValue("151%");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "151%",
      "24.16px",
    );

    await setLineHeight(page, "0");
    await expect(lineHeightInput(page)).toHaveValue("0px");
    await expectSourceAndRender(
      page,
      designId,
      headingSelector,
      "0px",
      "0px",
      0,
    );

    const paragraphId = await selectedNodeId(page, paragraphSelector);
    await selectByText(page, paragraphText);
    await expect(lineHeightInput(page)).toHaveValue("150%");
    await expectSourceAndRender(
      page,
      designId,
      paragraphSelector,
      "1.5",
      "27px",
    );

    await page.reload();
    await selectLayerByName(page, paragraphText);
    await expect(lineHeightInput(page)).toHaveValue("150%");
    const { source: reloadedSource } = await readDesignFile(page, designId);
    expect(sourceStyleValue(reloadedSource, paragraphId, "line-height")).toBe(
      "1.5",
    );
    await expectSourceAndRender(
      page,
      designId,
      paragraphSelector,
      "1.5",
      "27px",
    );
  } finally {
    await postAction(page, "delete-design", { id: designId });
  }
});
