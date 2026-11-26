import { expect, styleOf, test, type App } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Tokens</title>
<style>:root{--container-sm:640px;--space-14:56px;--space-page:var(--space-14);--leading-tight:1.2;--space-rem:1rem;--radius-rem:0.5rem;--opacity-muted:0.6;--font-size-lg:24px;}</style>
</head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
  <div data-agent-native-node-id="card" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#dadada;border-radius:var(--radius-rem)"></div>
  <img data-agent-native-node-id="photo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="position:absolute;left:240px;top:40px;width:120px;height:80px" />
  <p data-agent-native-node-id="copy" style="position:absolute;left:40px;top:200px;margin:0;font-size:20px;line-height:1.25em">Token copy</p>
</main></body></html>`;

async function selectLayer(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.keyboard.down("ControlOrMeta");
  await app.page.mouse.click(point.x, point.y);
  await app.page.keyboard.up("ControlOrMeta");
}

async function openScreen(app: App) {
  const designId = await app.seed(SCREEN_HTML, { title: "Inspector tokens" });
  await app.open(designId);
  await app.zoomToFit();
  return designId;
}

test("W binds to a token from its list, keeps it through reload, and Detach keeps the value", async ({
  app,
  page,
}) => {
  const designId = await openScreen(app);
  await selectLayer(app, "card");
  const width = page.getByRole("combobox", { name: "W size in pixels" });
  await expect(width).toHaveValue("120");

  await width.focus();
  await page.keyboard.press("ArrowDown");
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option").first()).toBeVisible();
  expect(
    (await list.getByRole("option").allInnerTexts())
      .slice(0, 3)
      .map((text) => text.replace(/\s+/g, " ").trim()),
  ).toEqual(["container-sm 640", "space-page 56", "space-14 56"]);
  await list
    .locator('[data-token-field-option="container-sm"]')
    .dispatchEvent("pointerdown");
  await app.settled();

  expect(styleOf((await app.savedNodes(designId)).get("card")).width).toBe(
    "var(--container-sm)",
  );
  await expect(width).toHaveValue("container-sm");

  await page.reload();
  await app.zoomToFit();
  await expect(width).toHaveValue("container-sm");

  await width.focus();
  await page.keyboard.press("Backspace");
  await app.settled();
  expect(styleOf((await app.savedNodes(designId)).get("card")).width).toBe(
    "640px",
  );
  await expect(width).toHaveValue("640");
});

test("an em line height shows as its percentage and a typed bare number is px", async ({
  app,
  page,
}) => {
  const designId = await openScreen(app);
  await selectLayer(app, "copy");
  const lineHeight = page.getByRole("combobox", { name: "Line Height" });
  await expect(lineHeight).toHaveValue("125%");

  await lineHeight.fill("30");
  await lineHeight.press("Enter");
  await app.settled();
  expect(
    styleOf((await app.savedNodes(designId)).get("copy"))["line-height"],
  ).toBe("30px");
});

test("H binds to a rem spacing token and a rem radius detaches to its rem value", async ({
  app,
  page,
}) => {
  const designId = await openScreen(app);
  await selectLayer(app, "card");
  const height = page.getByRole("combobox", { name: "H size in pixels" });
  await height.focus();
  await page.keyboard.press("ArrowDown");
  await page
    .getByRole("listbox")
    .locator('[data-token-field-option="space-rem"]')
    .dispatchEvent("pointerdown");
  await app.settled();
  expect(styleOf((await app.savedNodes(designId)).get("card")).height).toBe(
    "var(--space-rem)",
  );
  await expect(height).toHaveValue("space-rem");
  await expect(height).toBeFocused();
  await page.keyboard.press("Backspace");
  await app.settled();
  expect(styleOf((await app.savedNodes(designId)).get("card")).height).toBe(
    "1rem",
  );

  const radius = page.getByRole("combobox", { name: "Corner radius" });
  await expect(radius).toHaveValue("radius-rem");
  await radius.focus();
  await page.keyboard.press("Backspace");
  await app.settled();
  expect(
    styleOf((await app.savedNodes(designId)).get("card"))["border-radius"],
  ).toBe("0.5rem");
});

test("binding W with proportions locked scales H to match", async ({
  app,
  page,
}) => {
  const designId = await openScreen(app);
  await selectLayer(app, "photo");
  const lock = page.getByRole("button", { name: "Lock aspect ratio" });
  await lock.click();
  await expect(
    page.getByRole("button", { name: "Unlock aspect ratio" }),
  ).toHaveAttribute("aria-pressed", "true");
  const width = page.getByRole("combobox", { name: "W size in pixels" });
  await width.focus();
  await page.keyboard.press("ArrowDown");
  await page
    .getByRole("listbox")
    .locator('[data-token-field-option="container-sm"]')
    .dispatchEvent("pointerdown");
  await app.settled();

  const photo = styleOf((await app.savedNodes(designId)).get("photo"));
  expect(photo.width).toBe("var(--container-sm)");
  expect(photo.height).toBe("427px");

  const height = page.getByRole("combobox", { name: "H size in pixels" });
  await height.focus();
  await page.keyboard.press("ArrowDown");
  await page
    .getByRole("listbox")
    .locator('[data-token-field-option="space-rem"]')
    .dispatchEvent("pointerdown");
  await app.settled();
  const relative = styleOf((await app.savedNodes(designId)).get("photo"));
  expect(relative.height).toBe("var(--space-rem)");
  expect(relative.width).toBe("var(--container-sm)");
});

test("opacity and font size keep their token names through reload and detach to the value", async ({
  app,
  page,
}) => {
  const designId = await openScreen(app);
  await selectLayer(app, "copy");
  const pickToken = async (
    field: ReturnType<typeof page.getByRole>,
    name: string,
  ) => {
    await field.focus();
    await page.keyboard.press("ArrowDown");
    await page
      .getByRole("listbox")
      .locator(`[data-token-field-option="${name}"]`)
      .dispatchEvent("pointerdown");
    await app.settled();
  };
  const opacity = page
    .getByRole("combobox", { name: "Opacity", exact: true })
    .first();
  const size = page.getByRole("combobox", { name: "Size", exact: true });
  await pickToken(opacity, "opacity-muted");
  await pickToken(size, "font-size-lg");
  const bound = styleOf((await app.savedNodes(designId)).get("copy"));
  expect(bound.opacity).toBe("var(--opacity-muted)");
  expect(bound["font-size"]).toBe("var(--font-size-lg)");

  await page.reload();
  await app.zoomToFit();
  await expect(opacity).toHaveValue("opacity-muted");
  await expect(size).toHaveValue("font-size-lg");

  await size.focus();
  await page.keyboard.press("Backspace");
  await app.settled();
  expect(
    styleOf((await app.savedNodes(designId)).get("copy"))["font-size"],
  ).toBe("24px");
});
