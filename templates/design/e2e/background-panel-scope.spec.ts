import { enterInteractView } from "./helpers";
import { expect, test } from "./rails";

const SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#ffffff">
  <h1 data-agent-native-node-id="title" data-agent-native-layer-name="Title" style="margin:40px;font:600 32px system-ui">Scope</h1>
</body></html>`;

const sectionTitle = (name: string) =>
  `h3.design-sidebar-section-title:text-is("${name}")`;

// oracle: none — checks which scope the inspector addresses with nothing selected, not measured Figma behavior.
test("with nothing selected in overview, the inspector shows the Canvas section and no Screen section", async ({
  app,
}) => {
  const id = await app.seed(SCREEN);
  await app.open(id);
  await expect.poll(() => app.selectedLayers()).toEqual([]);

  await expect(app.page.locator(sectionTitle("Canvas"))).toBeVisible();
  await expect(app.page.locator(sectionTitle("Screen"))).toHaveCount(0);
});

// oracle: none — checks where the Interact controls sit against the left panel, not measured Figma geometry.
test("Interact has no inspector, and its device picker and zoom sit fully right of the left panel and inside the viewport", async ({
  app,
}) => {
  await app.page.setViewportSize({ width: 1440, height: 900 });
  const id = await app.seed(SCREEN);
  await app.open(id);
  await enterInteractView(app.page);

  await expect(
    app.page.locator('[data-design-chrome-region="right-panel"]'),
  ).toHaveCount(0);
  const leftShell = (await app.page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox())!;
  for (const [name, selector] of [
    ["device picker", "[data-design-interact-device]"],
    ["zoom", "[data-design-interact-zoom]"],
  ] as const) {
    const control = (await app.page.locator(selector).boundingBox())!;
    expect(
      control.x,
      `${name} starts right of the left panel`,
    ).toBeGreaterThanOrEqual(leftShell.x + leftShell.width);
    expect(
      control.x + control.width,
      `${name} ends inside the viewport`,
    ).toBeLessThanOrEqual(1440);
  }
});
