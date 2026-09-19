import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const BLANK_SCREEN = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Arrow parity</title></head>
<body style="margin:0;min-width:900px;min-height:700px;background:#ffffff"></body></html>`;

let baseURL = "";
let designId = "";

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function sourceHtml(page: Page): Promise<string> {
  const response = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const design = await response.json();
  return (
    (design.files ?? []).find((file: any) => file.filename === "index.html")
      ?.content ?? ""
  );
}

async function screenPoint(page: Page, x: number, y: number) {
  const card = await page.locator("[data-screen-card]").first().boundingBox();
  if (!card) throw new Error("no screen card");
  const frame = page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame();
  const size = await frame.locator("body").evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  return {
    x: card.x + (x / size.width) * card.width,
    y: card.y + (y / size.height) * card.height,
  };
}

async function chooseTool(page: Page, name: string): Promise<void> {
  const toolbar = page.locator("[data-design-bottom-toolbar]");
  const direct = toolbar.locator(`button[aria-label="${name}"]`).first();
  const button =
    (await direct.count()) > 0
      ? direct
      : toolbar
          .locator(
            'button[aria-label="Rectangle options"],button[aria-label="Line options"],button[aria-label="Arrow options"],button[aria-label="Ellipse options"],button[aria-label="Polygon options"],button[aria-label="Star options"]',
          )
          .first();
  if ((await direct.count()) === 0) {
    await button.click();
    await page
      .getByRole("menuitem", { name: new RegExp(`^${name}\\b`) })
      .click();
  }
  await expect(
    toolbar.locator(`button[aria-label="${name}"]`).first(),
  ).toHaveAttribute("aria-pressed", "true");
}

test.use({ viewport: { width: 1440, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  const created = await action(page, "create-design", {
    title: "Arrow marker parity",
    projectType: "prototype",
  });
  designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design returned no id");
  await action(page, "create-file", {
    designId,
    filename: "index.html",
    content: BLANK_SCREEN,
    fileType: "html",
  });
});

test.afterEach(async ({ page }) => {
  if (designId)
    await action(page, "delete-design", { id: designId }).catch(() => {});
  designId = "";
});

test("creates, edits, duplicates, undoes, and reloads a Figma-style arrow", async ({
  page,
}) => {
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  await chooseTool(page, "Arrow");

  const start = await screenPoint(page, 120, 140);
  const end = await screenPoint(page, 360, 300);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(page.locator("[data-draft-id]")).toHaveCount(1);
  await page.mouse.up();

  await expect
    .poll(
      async () =>
        (await sourceHtml(page)).match(/data-an-primitive="arrow"/g)?.length ??
        0,
    )
    .toBe(1);
  let html = await sourceHtml(page);
  expect(html).toContain('data-an-marker-start="none"');
  expect(html).toContain('data-an-marker-end="line-arrow"');
  expect(html).toContain('marker-end="url(#');

  const stroke = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Stroke", exact: true }) })
    .first();
  await expect(stroke.getByRole("combobox", { name: "Start" })).toBeVisible();
  await expect(stroke.getByRole("combobox", { name: "End" })).toBeVisible();

  const startSelect = stroke.getByRole("combobox", { name: "Start" });
  const endSelect = stroke.getByRole("combobox", { name: "End" });
  const startListboxId = await startSelect.getAttribute("aria-controls");
  if (!startListboxId) throw new Error("Start marker listbox is not mounted");
  await startSelect.click();
  const startListbox = page.locator(`[id="${startListboxId}"][role="listbox"]`);
  await expect(startListbox).toBeVisible();
  await startListbox
    .getByRole("option", { name: "Round", exact: true })
    .click();
  await expect(startSelect).toContainText("Round");
  const endListboxId = await endSelect.getAttribute("aria-controls");
  if (!endListboxId) throw new Error("End marker listbox is not mounted");
  await endSelect.click();
  const endListbox = page.locator(`[id="${endListboxId}"][role="listbox"]`);
  await expect(endListbox).toBeVisible();
  await endListbox
    .getByRole("option", { name: "Triangle arrow", exact: true })
    .click();
  await expect(endSelect).toContainText("Triangle arrow");
  await expect
    .poll(async () => sourceHtml(page))
    .toMatch(/data-an-marker-start="round"/);
  await expect
    .poll(async () => sourceHtml(page), { timeout: 20_000 })
    .toMatch(/data-an-marker-end="triangle-arrow"/);
  html = await sourceHtml(page);
  expect(html).toContain('data-an-marker-end="triangle-arrow"');
  expect(html).toContain("marker-start: url(#");
  expect(html).toContain("marker-end: url(#");

  await page.keyboard.press(`${MOD}+d`);
  await expect
    .poll(
      async () =>
        (await sourceHtml(page)).match(/data-an-primitive="arrow"/g)?.length ??
        0,
    )
    .toBe(2);
  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(
      async () =>
        (await sourceHtml(page)).match(/data-an-primitive="arrow"/g)?.length ??
        0,
    )
    .toBe(1);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect
    .poll(
      async () =>
        (await sourceHtml(page)).match(/data-an-primitive="arrow"/g)?.length ??
        0,
    )
    .toBe(2);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
    .waitFor({ state: "visible", timeout: 45_000 });
  html = await sourceHtml(page);
  expect(html).toContain('data-an-marker-start="round"');
  expect(html).toContain('data-an-marker-end="triangle-arrow"');
});
