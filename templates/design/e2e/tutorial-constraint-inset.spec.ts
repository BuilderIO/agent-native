import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, designFrame, expandAllLayers, gotoEditor } from "./helpers";

const PARENT_ID = "constraint-inset-parent";
const CHILD_ID = "constraint-inset-child";
const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Constraint inset</title></head>
<body style="margin:0;min-height:100vh;background:#fff">
  <div data-agent-native-node-id="${PARENT_ID}" data-agent-native-layer-name="Inset parent" style="position:relative;width:120px;height:120px;background:#eee">
    <div data-agent-native-node-id="${CHILD_ID}" data-agent-native-layer-name="Inset child" style="position:absolute;left:88px;top:88px;width:20px;height:20px;background:#2563eb"></div>
  </div>
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

async function createDesign(page: Page): Promise<string> {
  const created = await action(page.request, "create-design", {
    title: `Constraint inset ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");

  const file = await action(page.request, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content: HTML,
  });
  const fileId = file.id ?? file.data?.id;
  if (typeof fileId !== "string") throw new Error("missing screen id");
  await action(page.request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 100, y: 100, width: 360, height: 280 },
      },
    ],
  });
  return designId;
}

async function readSavedStyles(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const file = design.files?.find(
    (candidate: { filename?: string }) => candidate.filename === "screen.html",
  );
  if (typeof file?.content !== "string")
    throw new Error("missing saved screen");
  const styles = await page.evaluate(
    ({ html, childId }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const node = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${childId}"]`,
      );
      if (!node) throw new Error("child missing from saved source");
      return {
        position: node.style.position,
        left: node.style.left,
        right: node.style.right,
        top: node.style.top,
        bottom: node.style.bottom,
        width: node.style.width,
        height: node.style.height,
      };
    },
    { html: file.content as string, childId: CHILD_ID },
  );
  return { source: file.content as string, styles };
}

async function readRenderedGaps(page: Page) {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${CHILD_ID}"]`)
    .evaluate((node) => {
      const parent = node.parentElement;
      if (!parent) throw new Error("child has no rendered parent");
      const childRect = node.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      return {
        right: parentRect.right - childRect.right,
        bottom: parentRect.bottom - childRect.bottom,
      };
    });
}

async function selectChildFromLayers(page: Page) {
  await expandAllLayers(page);
  const row = page
    .getByRole("treeitem")
    .filter({ hasText: "Inset child" })
    .first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Inset child");
}

test("right and bottom constraints retain a 12px inset for a Layers selection", async ({
  page,
}) => {
  const designId = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await selectChildFromLayers(page);

    const constraints = page.getByRole("button", {
      name: "Constraints",
      exact: true,
    });
    await expect(constraints).toBeVisible();
    await constraints.click();
    await page.getByRole("combobox", { name: "Horizontal" }).click();
    await page.getByRole("option", { name: "Right", exact: true }).click();
    await page.getByRole("combobox", { name: "Vertical" }).click();
    await page.getByRole("option", { name: "Bottom", exact: true }).click();

    const expected = {
      position: "absolute",
      left: "auto",
      right: "12px",
      top: "auto",
      bottom: "12px",
      width: "20px",
      height: "20px",
    };
    await expect
      .poll(async () => (await readSavedStyles(page, designId)).styles, {
        timeout: 10_000,
      })
      .toEqual(expected);
    await expect
      .poll(() => readRenderedGaps(page))
      .toEqual({
        right: 12,
        bottom: 12,
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await selectChildFromLayers(page);
    await page
      .getByRole("button", { name: "Constraints", exact: true })
      .click();
    await expect(page.getByRole("combobox", { name: "Horizontal" })).toHaveText(
      "Right",
    );
    await expect(page.getByRole("combobox", { name: "Vertical" })).toHaveText(
      "Bottom",
    );
    await expect(await readSavedStyles(page, designId)).toMatchObject({
      styles: expected,
    });
    await expect
      .poll(() => readRenderedGaps(page))
      .toEqual({
        right: 12,
        bottom: 12,
      });
  } finally {
    await action(page.request, "delete-design", { id: designId });
  }
});
