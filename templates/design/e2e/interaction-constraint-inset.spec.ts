import { type Page } from "@playwright/test";

import { expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const PARENT_ID = "constraint-inset-parent";
const CHILD_ID = "constraint-inset-child";
const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Constraint inset</title></head>
<body style="margin:0;min-height:100vh;background:#fff">
  <div data-agent-native-node-id="${PARENT_ID}" data-agent-native-layer-name="Inset parent" style="position:relative;width:120px;height:120px;background:#eee">
    <div data-agent-native-node-id="${CHILD_ID}" data-agent-native-layer-name="Inset child" style="position:absolute;left:88px;top:88px;width:20px;height:20px;background:#2563eb"></div>
  </div>
</body></html>`;

async function savedChildStyle(app: App, designId: string) {
  const style = styleOf((await app.savedNodes(designId)).get(CHILD_ID));
  return {
    position: style.position,
    left: style.left,
    right: style.right,
    top: style.top,
    bottom: style.bottom,
    width: style.width,
    height: style.height,
  };
}

async function readRenderedGaps(app: App) {
  return app.node(CHILD_ID).evaluate((node) => {
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
  app,
  page,
}) => {
  const designId = await app.seed(HTML);
  await app.open(designId);
  await app.settled();
  const before = await app.savedNodes(designId);
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
  await expect.poll(() => savedChildStyle(app, designId)).toEqual(expected);
  await expect
    .poll(() => readRenderedGaps(app))
    .toEqual({
      right: 12,
      bottom: 12,
    });

  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(designId), [CHILD_ID]);

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await selectChildFromLayers(page);
  await page.getByRole("button", { name: "Constraints", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Horizontal" })).toHaveText(
    "Right",
  );
  await expect(page.getByRole("combobox", { name: "Vertical" })).toHaveText(
    "Bottom",
  );
  expect(await savedChildStyle(app, designId)).toEqual(expected);
  await expect
    .poll(() => readRenderedGaps(app))
    .toEqual({
      right: 12,
      bottom: 12,
    });
});
