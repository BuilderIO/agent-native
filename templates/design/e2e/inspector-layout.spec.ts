import { expect, test, type Locator, type Page } from "@playwright/test";

import { appPath, gotoEditor, readSeedDesignId, selectByText } from "./helpers";

test.use({ viewport: { width: 1440, height: 1000 } });

let designId: string;

test.beforeAll(async () => {
  designId = await readSeedDesignId();
});

function inspector(page: Page): Locator {
  return page.locator('[data-design-chrome-region="right-panel"]').first();
}

function tabRow(page: Page): Locator {
  return inspector(page).getByRole("tab", {
    name: /^(Design|Comments|Tweaks|Code)$/,
  });
}

async function sectionTitles(page: Page): Promise<string[]> {
  return inspector(page)
    .locator("[data-design-inspector-section-header] h3")
    .allTextContents();
}

// A text layer's sections, top to bottom. Layout is left out: it only shows
// for containers.
const TEXT_LAYER_SECTIONS = [
  "Position",
  "Appearance",
  "Typography",
  "Fill",
  "Stroke",
  "Effects",
  "Responsive",
  "Export",
];

async function expectHeaderThenSections(page: Page): Promise<void> {
  await expect(
    inspector(page).locator("[data-design-inspector-header]"),
  ).toBeVisible();
  await expect(tabRow(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const titles = await sectionTitles(page);
      const positions = TEXT_LAYER_SECTIONS.map((title) =>
        titles.indexOf(title),
      );
      return positions.every(
        (position, index) =>
          position > -1 && (index === 0 || position > positions[index - 1]!),
      );
    })
    .toBe(true);
}

// oracle: none — structural: the tab row is gone and the sections run in the ticket's order.
test("opens on the element header, then the sections in order, with no tab row", async ({
  page,
}) => {
  await gotoEditor(page, designId);
  await selectByText(page, "E2E Hero Heading");

  await expectHeaderThenSections(page);
});

for (const tab of ["comments", "tweaks", "code"]) {
  // oracle: none — a URL that asks for a removed tab lands on the one inspector.
  test(`ignores ?inspector=${tab} and stays on the design inspector`, async ({
    page,
  }) => {
    await page.goto(appPath(`/design/${designId}?inspector=${tab}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await selectByText(page, "E2E Hero Heading");

    await expectHeaderThenSections(page);
  });
}

// oracle: none — the inspector belongs to Design; Interact has none.
test("hides the inspector in Interact and brings it back in Design", async ({
  page,
}) => {
  await gotoEditor(page, designId);
  await expect(inspector(page)).toBeVisible();

  await page.locator('[data-design-mode="interact"]').click();
  await expect(
    page.locator('[data-design-chrome-region="right-panel"]'),
  ).toHaveCount(0);

  await page.locator('[data-design-mode="edit"]').click();
  await expect(inspector(page)).toBeVisible();
});

// oracle: none — structural: header and section headers share one grid box.
test("puts the header and every section header on one shared grid box", async ({
  page,
}) => {
  await gotoEditor(page, designId);
  await selectByText(page, "E2E Hero Heading");
  await expectHeaderThenSections(page);

  const grids = await inspector(page)
    .locator(
      "[data-design-inspector-header] [data-inspector-grid], [data-design-inspector-section-header] [data-inspector-grid]",
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, width: rect.width };
      }),
    );
  expect(grids.length).toBeGreaterThan(TEXT_LAYER_SECTIONS.length);
  for (const grid of grids) {
    expect(grid.x).toBeCloseTo(grids[0]!.x, 0);
    expect(grid.width).toBeCloseTo(grids[0]!.width, 0);
  }
});
