import { expect, test, type APIRequestContext } from "@playwright/test";

import { enterDirectMode, expandAllLayers, gotoEditor } from "./helpers";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Add solid fill</title></head>
  <body style="margin:0">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-shape" data-agent-native-layer-name="Shape" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#123456;background-image:linear-gradient(90deg,rgba(204,51,102,.2) 0%,rgba(51,102,204,.2) 100%),radial-gradient(circle at center,#00ff00 0%,#ff00ff 100%);background-size:24px 24px,cover;background-repeat:no-repeat,repeat-x;background-position:10% 20%,30% 40%"></div>
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
