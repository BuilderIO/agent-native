import { expect, test, type APIRequestContext } from "@playwright/test";

import { appPath, cdpScreenshot, gotoEditor } from "./helpers";

const FRAME = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Selection colors</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--color-bg, #ffffff); color: var(--color-text, #111827); }
</style></head>
<body data-agent-native-layer-name="Frame" style="background:#101010"></body></html>`;

const TARGET_FRAME = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Selection color target</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--color-bg, #ffffff); color: var(--color-text, #111827); }
</style></head>
<body data-agent-native-layer-name="Frame" style="background:#101010">
  <div data-agent-native-node-id="matching" data-agent-native-layer-name="Matching" style="width:120px;height:80px;background:#101010"></div>
  <div data-agent-native-node-id="other" data-agent-native-layer-name="Other" style="width:120px;height:80px;background:#ffffff"></div>
</body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

test("a selected frame exposes only its authored Selection color", async ({
  page,
  request,
}, testInfo) => {
  const created = await action(request, "create-design", {
    title: `Selection colors reporter ${Date.now()}`,
    projectType: "prototype",
  });
  if (typeof created.id !== "string") throw new Error("Missing design id");

  try {
    await action(request, "create-file", {
      designId: created.id,
      filename: "index.html",
      content: FRAME,
      fileType: "html",
    });
    await gotoEditor(page, created.id);

    const layers = page.getByRole("tree", { name: "Layers" });
    const frame = layers.locator('[role="treeitem"][aria-level="1"]').first();
    await frame.locator("[data-layer-row-button]").click();

    const selectionColors = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    await selectionColors
      .getByRole("button", { name: "Show selection colors" })
      .click();

    await expect(
      selectionColors
        .locator('button[aria-label^="#"]')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("aria-label")),
        ),
    ).resolves.toEqual(["#101010"]);
    await selectionColors
      .locator('button[aria-label="Find layers: #101010"]')
      .click();
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(1);
    await cdpScreenshot(
      page,
      testInfo.outputPath("selection-colors-inline.png"),
    );
  } finally {
    await action(request, "delete-design", { id: created.id });
  }
});

test("a Selection color target selects matching layers and reveals them", async ({
  page,
  request,
}, testInfo) => {
  const created = await action(request, "create-design", {
    title: `Selection color target ${Date.now()}`,
    projectType: "prototype",
  });
  if (typeof created.id !== "string") throw new Error("Missing design id");

  try {
    await action(request, "create-file", {
      designId: created.id,
      filename: "index.html",
      content: TARGET_FRAME,
      fileType: "html",
    });
    await gotoEditor(page, created.id);

    const tree = page.getByRole("tree", { name: "Layers" });
    await tree
      .locator('[role="treeitem"][aria-level="1"]')
      .first()
      .locator("[data-layer-row-button]")
      .click();
    await page.getByRole("button", { name: "Show selection colors" }).click();
    await page.locator('button[aria-label="Find layers: #101010"]').click();

    await expect(
      tree.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);
    await expect(
      tree.getByRole("button", { name: "Matching", exact: true }),
    ).toBeVisible();
    await cdpScreenshot(
      page,
      testInfo.outputPath("selection-colors-target.png"),
    );
  } finally {
    await action(request, "delete-design", { id: created.id });
  }
});

test("URL-backed screens do not expose source Selection colors", async ({
  page,
  request,
}) => {
  const created = await action(request, "create-design", {
    title: `Selection colors URL guard ${Date.now()}`,
    projectType: "prototype",
  });
  if (typeof created.id !== "string") throw new Error("Missing design id");
  const liveUrl = "https://example.test/selection-colors";
  await page.route(liveUrl, (route) => route.abort("failed"));

  try {
    await action(request, "create-file", {
      designId: created.id,
      filename: "index.html",
      content: FRAME,
      fileType: "html",
    });
    const file = await action(request, "create-file", {
      designId: created.id,
      filename: "live.html",
      content: liveUrl,
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (typeof fileId !== "string") throw new Error("Missing URL screen id");
    await action(request, "update-design", {
      id: created.id,
      dataOperations: [
        {
          op: "set",
          path: ["screenMetadata", fileId],
          value: { sourceType: "localhost", url: liveUrl },
        },
      ],
    });
    await gotoEditor(page, created.id);

    const tree = page.getByRole("tree", { name: "Layers" });
    await tree
      .locator(`[data-layer-row-button][data-layer-node-id="${fileId}"]`)
      .click();
    await expect(
      page.getByRole("heading", { name: "Selection colors", exact: true }),
    ).toHaveCount(0);
  } finally {
    await action(request, "delete-design", { id: created.id });
  }
});
