import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Rotation direction</title></head>
  <body style="margin:0">
    <main data-agent-native-node-id="rotation-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="rotation-asymmetric" data-agent-native-layer-name="Asymmetric marker" style="position:absolute;left:120px;top:120px;width:140px;height:60px;background:#d94645;transform:translateX(12px) scale(1.2) rotate(0deg);transform-origin:top left">
        <span data-agent-native-node-id="rotation-marker" data-agent-native-layer-name="Corner marker" style="position:absolute;left:0;top:0;width:12px;height:12px;background:#2563eb"></span>
      </div>
      <div data-agent-native-node-id="rotation-first" data-agent-native-layer-name="First angle" style="position:absolute;left:340px;top:120px;width:100px;height:44px;background:#16a34a;transform:translateX(10px) rotate(-10deg) scale(2)"></div>
      <div data-agent-native-node-id="rotation-second" data-agent-native-layer-name="Second angle" style="position:absolute;left:540px;top:120px;width:100px;height:44px;background:#9333ea;transform:translateY(20px) rotate(-30deg) scale(0.5)"></div>
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
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(
  request: APIRequestContext,
  baseURL: string,
  title: string,
): Promise<string> {
  const created = await postAction(request, baseURL, "create-design", {
    title,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await postAction(request, baseURL, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return designId;
}

async function selectLayer(page: Page, name: string): Promise<void> {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .first();
  await expect(row).toBeVisible();
  await row.click();
}

async function readCssRotation(page: Page, nodeId: string): Promise<number> {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
    });
}

test("positive inspector rotation turns counter-clockwise and survives reload", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const designId = await createDesign(
    request,
    baseURL,
    `Rotation direction ${Date.now()}`,
  );

  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectLayer(page, "Asymmetric marker");

    const rotation = page.locator('input[aria-label="Rotation" i]');
    await expect(rotation).toBeVisible();
    await rotation.fill("45");
    await rotation.press("Enter");

    const asymmetric = designFrame(page).locator(
      '[data-agent-native-node-id="rotation-asymmetric"]',
    );
    await expect
      .poll(() => readCssRotation(page, "rotation-asymmetric"))
      .toBe(-45);
    await expect(asymmetric).toHaveAttribute(
      "style",
      /translateX\(12px\).*scale\(1\.2\).*rotate\(-45deg\)/,
    );
    await expect(
      designFrame(page).locator(
        '[data-agent-native-node-id="rotation-marker"]',
      ),
    ).toBeVisible();

    await page.reload();
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectLayer(page, "Asymmetric marker");
    await expect(page.locator('input[aria-label="Rotation" i]')).toHaveValue(
      "45deg",
    );
    await expect
      .poll(() => readCssRotation(page, "rotation-asymmetric"))
      .toBe(-45);
    await expect(asymmetric).toHaveAttribute(
      "style",
      /translateX\(12px\).*scale\(1\.2\).*rotate\(-45deg\)/,
    );
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});

test("relative rotation math applies in each selected layer's Figma degree domain", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const hmrEvents: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (/"type":"(?:update|full-reload)"/.test(String(payload))) {
        hmrEvents.push(String(payload));
      }
    });
  });
  const designId = await createDesign(
    request,
    baseURL,
    `Mixed rotation ${Date.now()}`,
  );

  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const tree = page.getByRole("tree", { name: "Layers" });
    const first = tree.getByRole("button", {
      name: "First angle",
      exact: true,
    });
    const second = tree.getByRole("button", {
      name: "Second angle",
      exact: true,
    });
    await expect(first).toBeVisible();
    await first.click();
    await second.click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });
    await expect(
      tree.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);

    const rotation = page.locator('input[aria-label="Rotation" i]');
    await expect(rotation).toHaveValue("Mixed");
    await rotation.fill("Mixed+15");
    await rotation.press("Enter");

    const firstLayer = designFrame(page).locator(
      '[data-agent-native-node-id="rotation-first"]',
    );
    const secondLayer = designFrame(page).locator(
      '[data-agent-native-node-id="rotation-second"]',
    );
    await expect(firstLayer).toHaveAttribute(
      "style",
      /translateX\(10px\).*rotate\(-25deg\).*scale\(2\)/,
    );
    await expect(secondLayer).toHaveAttribute(
      "style",
      /translateY\(20px\).*rotate\(-45deg\).*scale\(0\.5\)/,
    );
    await expect.poll(() => readCssRotation(page, "rotation-first")).toBe(-25);
    await expect.poll(() => readCssRotation(page, "rotation-second")).toBe(-45);
    expect(hmrEvents).toEqual([]);
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});

test("absolute rotation preserves each selected layer's translation and scale", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const designId = await createDesign(
    request,
    baseURL,
    `Absolute mixed rotation ${Date.now()}`,
  );

  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const tree = page.getByRole("tree", { name: "Layers" });
    const first = tree.getByRole("button", {
      name: "First angle",
      exact: true,
    });
    const second = tree.getByRole("button", {
      name: "Second angle",
      exact: true,
    });
    await first.click();
    await second.click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });

    const rotation = page.locator('input[aria-label="Rotation" i]');
    await expect(rotation).toHaveValue("Mixed");
    await rotation.fill("45");
    await rotation.press("Enter");

    await expect(
      designFrame(page).locator('[data-agent-native-node-id="rotation-first"]'),
    ).toHaveAttribute(
      "style",
      /translateX\(10px\).*rotate\(-45deg\).*scale\(2\)/,
    );
    await expect(
      designFrame(page).locator(
        '[data-agent-native-node-id="rotation-second"]',
      ),
    ).toHaveAttribute(
      "style",
      /translateY\(20px\).*rotate\(-45deg\).*scale\(0\.5\)/,
    );
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});
