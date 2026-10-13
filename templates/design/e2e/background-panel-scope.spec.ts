import { enterInteractView } from "./helpers";
import { expect, test } from "./rails";

const SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#ffffff">
  <h1 data-agent-native-node-id="title" data-agent-native-layer-name="Title" style="margin:40px;font:600 32px system-ui">Scope</h1>
</body></html>`;

const sectionTitle = (name: string) =>
  `h3.design-sidebar-section-title:text-is("${name}")`;

test("with nothing selected in overview, the inspector shows the Canvas section and no Screen section", async ({
  app,
}) => {
  const id = await app.seed(SCREEN);
  await app.open(id);
  await expect.poll(() => app.selectedLayers()).toEqual([]);

  await expect(app.page.locator(sectionTitle("Canvas"))).toBeVisible();
  await expect(app.page.locator(sectionTitle("Screen"))).toHaveCount(0);
});

test("Interact's Width and Height inputs sit fully right of the left panel and inside the viewport", async ({
  app,
}) => {
  await app.page.setViewportSize({ width: 1440, height: 900 });
  const id = await app.seed(SCREEN);
  await app.open(id);
  await enterInteractView(app.page);

  const leftShell = (await app.page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox())!;
  for (const name of ["Width", "Height"]) {
    const input = (await app.page
      .getByRole("spinbutton", { name })
      .boundingBox())!;
    expect(
      input.x,
      `${name} starts right of the left panel`,
    ).toBeGreaterThanOrEqual(leftShell.x + leftShell.width);
    expect(
      input.x + input.width,
      `${name} ends inside the viewport`,
    ).toBeLessThanOrEqual(1440);
  }
});
