import { test, expect } from "@playwright/test";

import {
  readSeedDesignId,
  gotoEditor,
  designFrame,
  selectByText,
  inspectorInputCount,
  dragCanvasByText,
  cdpScreenshot,
} from "./helpers";

let designId: string;

test.beforeAll(async () => {
  designId = await readSeedDesignId();
});

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, designId);
});

test("editor renders the toolbar and the design iframe content", async ({
  page,
}) => {
  for (const tool of ["Move", "Frame", "Text", "Pen", "Edit", "Interact"]) {
    // exact:true keeps "Move" from matching the "Move options" split button.
    await expect(
      page.getByRole("button", { name: tool, exact: true }),
    ).toBeVisible();
  }
  // Frame-locator reaches inside the sandboxed iframe (contentDocument would be null).
  await expect(designFrame(page).getByText("E2E Hero Heading")).toBeVisible();
  const nodeCount = await designFrame(page)
    .locator("h1, h2, p, button")
    .count();
  expect(nodeCount).toBeGreaterThanOrEqual(5);
});

test("clicking an element selects it and populates the inspector", async ({
  page,
}) => {
  const before = await inspectorInputCount(page);
  const payload = await selectByText(page, "E2E Hero Heading");

  expect(payload).toBeTruthy();
  expect((payload.tagName ?? "").toUpperCase()).toBe("H1");
  expect(payload.textContent ?? "").toContain("E2E Hero Heading");
  // The element-select payload resolves to a runtime-stamped, stable node id.
  expect(payload.selector ?? "").toMatch(/data-agent-native-node-id/);

  await expect.poll(() => inspectorInputCount(page)).toBeGreaterThan(before);
});

test("selecting a different element changes the selection", async ({
  page,
}) => {
  const first = await selectByText(page, "E2E Hero Heading");
  const second = await selectByText(page, "Fixture Card Title");

  expect(first.selector).toBeTruthy();
  expect(second.selector).toBeTruthy();
  expect(second.selector).not.toBe(first.selector);
  expect((second.tagName ?? "").toUpperCase()).toBe("H2");
});

test("the layers panel lists layers and a layer row selects on the canvas", async ({
  page,
}) => {
  const rows = page.locator('[role="treeitem"][aria-selected]');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  expect(await rows.count()).toBeGreaterThan(0);

  // Clicking a selectable layer row should make it the active selected row.
  const target = rows.last();
  await target.click();
  await expect(target).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]').first(),
  ).toBeVisible();
});

test("dragging an element on the canvas drives the bridge (move/reorder)", async ({
  page,
}) => {
  // Best-effort: real pointer drag through the editor. We assert the drag
  // produced bridge activity (and capture which messages fired). A committed
  // reorder emits `visual-structure-change`; if the gesture only re-selects we
  // still prove pointer events reach the in-iframe bridge.
  const fired = await dragCanvasByText(page, "Alpha Button", 0, 90);
  expect(fired.length).toBeGreaterThan(0);
  expect(fired.some((t) => /^(element-|visual-)/.test(t))).toBe(true);
});

test("can capture a screenshot of the editor via CDP", async ({
  page,
}, info) => {
  // page.screenshot() hangs (the page never reaches an idle frame), so use CDP.
  const out = info.outputPath("editor.png");
  await cdpScreenshot(page, out);
  await info.attach("editor", { path: out, contentType: "image/png" });
});
