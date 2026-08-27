import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { designFrame, gotoEditor } from "./helpers";

/**
 * Grid parity: picking the Grid flow must reflow the frame's children into
 * cells (they are drawn absolutely positioned, so container styles alone
 * render no layout), and every outermost frame carries its name on canvas.
 */
const GRID_FRAME_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Grid Frame</title>
  </head>
  <body style="margin:0;background:#ffffff">
    <div data-agent-native-node-id="gf-frame" data-agent-native-layer-name="Hero Frame" data-an-primitive="frame" style="position:absolute;left:80px;top:140px;width:480px;height:320px;background:#f4f4f5">
      <div data-agent-native-node-id="gf-a" data-agent-native-layer-name="Rect A" data-an-primitive="rectangle" style="position:absolute;left:16px;top:12px;width:120px;height:80px;background:#d4d4d8"></div>
      <div data-agent-native-node-id="gf-b" data-agent-native-layer-name="Rect B" data-an-primitive="rectangle" style="position:absolute;left:210px;top:26px;width:120px;height:80px;background:#d4d4d8"></div>
      <div data-agent-native-node-id="gf-c" data-agent-native-layer-name="Rect C" data-an-primitive="rectangle" style="position:absolute;left:28px;top:190px;width:120px;height:80px;background:#d4d4d8"></div>
      <div data-agent-native-node-id="gf-nested" data-agent-native-layer-name="Nested Frame" data-an-primitive="frame" style="position:absolute;left:260px;top:176px;width:140px;height:100px;background:#e4e4e7"></div>
    </div>
  </body>
</html>`;

test.describe("grid layout and frame labels", () => {
  let designId = "";

  test.afterEach(async ({ request, baseURL }) => {
    if (!designId) return;
    await postAction(request, baseURL, "delete-design", { id: designId }).catch(
      () => {},
    );
    designId = "";
  });

  test("picking Grid reflows the frame's children and paints its cells", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createGridFrameDesign(request, baseURL, "E2E Grid Flow");
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Hero Frame");
    await page.getByRole("button", { name: "Grid", exact: true }).click();

    await expectFileContent(request, baseURL, designId, (html) => {
      const frameTag = openTagOf(html, "gf-frame");
      expect(frameTag).toContain("display: grid");
      expect(frameTag).toMatch(/grid-template-columns:\s*repeat\(2,/);
      for (const nodeId of ["gf-a", "gf-b", "gf-c"]) {
        expect(openTagOf(html, nodeId)).not.toMatch(/position:\s*absolute/);
        expect(openTagOf(html, nodeId)).not.toMatch(/left:\s*\d/);
      }
    });

    await expect
      .poll(
        async () =>
          designFrame(page).locator("[data-agent-native-grid-cell]").count(),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(2);
  });

  test("only the outermost frame shows its name, and the name selects it", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createGridFrameDesign(request, baseURL, "E2E Frame Label");
    await gotoEditor(page, designId);

    const labels = designFrame(page).locator(
      "[data-agent-native-frame-label]",
    );
    await expect(labels).toHaveCount(1);
    await expect(labels.first()).toHaveText("Hero Frame");

    await labels.first().click({ force: true });
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-selected="true"]')
        .first(),
    ).toContainText("Hero Frame");
  });
});

/** Open tag of one node, where its inline style lives. */
function openTagOf(html: string, nodeId: string): string {
  const index = html.indexOf(`data-agent-native-node-id="${nodeId}"`);
  if (index < 0) throw new Error(`node ${nodeId} not found`);
  const start = html.lastIndexOf("<", index);
  return html.slice(start, html.indexOf(">", index) + 1);
}

async function createGridFrameDesign(
  request: APIRequestContext,
  baseURL: string | undefined,
  title: string,
): Promise<string> {
  const created = await postAction(request, baseURL, "create-design", {
    title,
    projectType: "prototype",
  });
  const id: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!id) throw new Error(`create-design did not return id: ${created}`);
  await postAction(request, baseURL, "create-file", {
    designId: id,
    filename: "layout.html",
    fileType: "html",
    content: GRID_FRAME_HTML,
  });
  return id;
}

async function postAction(
  request: APIRequestContext,
  baseURL: string | undefined,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await request.post(
    `${actionBaseUrl(baseURL)}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(
      `action ${name} failed: ${res.status()} ${await res.text()}`,
    );
  }
  return res.json();
}

function actionBaseUrl(baseURL: string | undefined): string {
  return (
    baseURL ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`
  ).replace(/\/$/, "");
}

async function expectFileContent(
  request: APIRequestContext,
  baseURL: string | undefined,
  id: string,
  assertContent: (html: string) => void,
) {
  await expect
    .poll(
      async () => {
        const params = new URLSearchParams({ id });
        const res = await request.get(
          `${actionBaseUrl(baseURL)}/_agent-native/actions/get-design?${params}`,
          { headers: { "Content-Type": "application/json" } },
        );
        if (!res.ok()) return `get-design ${res.status()}`;
        const payload = await res.json();
        const design = [
          payload,
          payload?.result,
          payload?.design,
          payload?.data,
        ].find((candidate) => Array.isArray(candidate?.files));
        const file = design?.files?.find(
          (candidate: { filename?: string }) =>
            candidate.filename === "layout.html",
        );
        if (typeof file?.content !== "string") {
          return "layout.html has no content";
        }
        try {
          assertContent(file.content);
          return "ok";
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return `${reason}\n--- layout.html ---\n${file.content}`;
        }
      },
      { timeout: 20_000 },
    )
    .toBe("ok");
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

async function selectLayerRow(page: Page, name: string): Promise<void> {
  const input = page.getByPlaceholder("Search layers...");
  if (!(await input.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
    await expect(input).toBeVisible();
  }
  await input.fill(name);
  const button = layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
  await expect(button).toBeVisible();
  await button.click({ force: true });
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}
