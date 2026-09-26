import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";

import {
  cdpScreenshot,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Add solid fill</title></head>
  <body style="margin:0">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-shape" data-agent-native-layer-name="Shape" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#123456;background-image:linear-gradient(90deg,rgba(204,51,102,.2) 0%,rgba(51,102,204,.2) 100%),radial-gradient(circle at center,#00ff00 0%,#ff00ff 100%);background-size:24px 24px,cover;background-repeat:no-repeat,repeat-x;background-position:10% 20%,30% 40%"></div>
    </main>
  </body>
</html>`;

const EMPTY_FILL_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Empty fill section</title></head>
  <body style="margin:0">
    <main data-agent-native-node-id="empty-fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="empty-fill-shape" data-agent-native-layer-name="Unfilled shape" style="position:absolute;left:64px;top:64px;width:320px;height:180px"></div>
    </main>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseURL.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test("Add fill creates a Solid row, opens its picker, and keeps existing fill layers aligned", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Add solid fill ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Shape", exact: true })
      .first()
      .click();

    const shape = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="fill-shape"]');
    const before = await shape.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        image: style.backgroundImage,
        size: style.backgroundSize,
        repeat: style.backgroundRepeat,
        position: style.backgroundPosition,
      };
    });
    const fill = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    await fill.getByRole("button", { name: "Add fill" }).click();

    await expect
      .poll(() =>
        shape.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("linear-gradient(rgb(18, 52, 86) 0px, rgb(18, 52, 86) 0px)");
    const after = await shape.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        image: style.backgroundImage,
        size: style.backgroundSize,
        repeat: style.backgroundRepeat,
        position: style.backgroundPosition,
      };
    });
    expect(after.image).toContain("radial-gradient");
    expect(after.image).toContain("rgba(204, 51, 102, 0.2)");
    expect(after.image).toContain("rgb(0, 255, 0)");
    expect(after.size).toBe("auto, 24px 24px, cover");
    expect(after.repeat).toBe("no-repeat, no-repeat, repeat-x");
    expect(after.position).toBe("0% 0%, 10% 20%, 30% 40%");
    expect(after.image.endsWith(before.image)).toBe(true);

    const paintRows = fill.locator('[data-inspector-layout="drag-paint-row"]');
    await expect(paintRows).toHaveCount(3);
    const addedSolid = paintRows.first();
    const addedSolidTrigger = addedSolid
      .getByRole("button")
      .filter({ hasText: "#123456" })
      .first();
    await expect(addedSolidTrigger).toBeVisible();
    await expect(addedSolid).not.toContainText("Linear gradient");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Solid", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});

test("clicking an empty Fill heading adds the first fill", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Empty fill heading ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: EMPTY_FILL_FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Unfilled shape", exact: true })
      .first()
      .click();

    const fill = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    const fillHeading = fill.getByRole("heading", {
      name: "Fill",
      exact: true,
    });
    await expect(fill.getByRole("button", { name: "Add fill" })).toHaveCount(2);
    await fillHeading.getByRole("button", { name: "Add fill" }).click();

    const shape = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="empty-fill-shape"]');
    await expect
      .poll(() =>
        shape.evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe("rgb(217, 217, 217)"); // #d9d9d9 — Figma's new-fill paint, see fill-gradient-helpers.ts NEW_FILL_COLOR
    await expect(
      fill.locator('[data-inspector-layout="paint-row"]'),
    ).toBeVisible();
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});

test("clicking an empty Stroke heading adds the first stroke", async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Stroke heading ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: `<!doctype html><html><body style="margin:0"><main style="position:relative;width:800px;height:600px"><div data-agent-native-node-id="stroke-target" data-agent-native-layer-name="Stroke target" style="position:absolute;left:40px;top:40px;width:200px;height:120px;background:#fff"></div></main></body></html>`,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Stroke target", exact: true })
      .first()
      .click();

    const stroke = page
      .locator("section")
      .filter({
        has: page.locator("h3").filter({ hasText: "Stroke" }),
      })
      .first();
    const headingAction = stroke.locator("h3 button");
    await expect(headingAction).toHaveAccessibleName("Add stroke");
    await headingAction.click();

    const target = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="stroke-target"]');
    await expect
      .poll(() => target.evaluate((node) => getComputedStyle(node).borderWidth))
      .toBe("1px");
    await expect(
      stroke.locator('[data-inspector-layout="paint-row"]'),
    ).toHaveCount(1);
    await expect(stroke.locator("h3 button")).toHaveCount(0);
    await cdpScreenshot(
      page,
      testInfo.outputPath("stroke-added-from-heading.png"),
    );
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});
