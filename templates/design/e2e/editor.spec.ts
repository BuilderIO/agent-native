import { test, expect } from "@playwright/test";

import {
  readSeedDesignId,
  gotoEditor,
  designFrame,
  selectByText,
  inspectorInputCount,
  dragCanvasByText,
  cdpScreenshot,
  installBridge,
  waitForBridge,
} from "./helpers";

let designId: string;

test.beforeAll(async () => {
  designId = await readSeedDesignId();
});

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
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
  // Frame-locator reaches inside the sandboxed iframe and stays stable around overlays.
  await expect(designFrame(page).getByText("E2E Hero Heading")).toBeVisible();
  const nodeCount = await designFrame(page)
    .locator("h1, h2, p, button")
    .count();
  expect(nodeCount).toBeGreaterThanOrEqual(5);
});

test("screen overview resizes previews from the device selector", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Device preview" }).first().click();
  await page.getByRole("menuitemradio", { name: "Desktop" }).click();
  await expect(page.getByText("1280 x 800").first()).toBeVisible();

  await page.getByRole("button", { name: "Device preview" }).first().click();
  await page.getByRole("menuitemradio", { name: "Mobile" }).click();
  await expect(page.getByText("390 x 844").first()).toBeVisible();
});

test("screen overview lets users select elements inside the active screen", async ({
  page,
}) => {
  const before = await inspectorInputCount(page);
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));

  const target = designFrame(page).getByText("E2E Hero Heading").first();
  await target.waitFor({ state: "visible", timeout: 8_000 });
  const box = await target.boundingBox();
  expect(
    box,
    "overview iframe element should have a bounding box",
  ).toBeTruthy();
  const activeScreenCard = page
    .locator("[data-screen-card]")
    .filter({ has: page.locator("iframe[data-design-preview-iframe]") })
    .first();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await waitForBridge(page, "element-hover");
  await expect
    .poll(() =>
      activeScreenCard
        .locator("[data-screen-hover-outline]")
        .evaluate((el) => window.getComputedStyle(el).opacity),
    )
    .toBe("0");
  await expect
    .poll(() =>
      activeScreenCard
        .locator('[data-resize-handle="nw"]')
        .evaluate((el) => window.getComputedStyle(el).opacity),
    )
    .toBe("0");
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const selected = await waitForBridge(page, "element-select");
  const payload = selected?.payload ?? selected;
  expect(payload?.textContent ?? "").toContain("E2E Hero Heading");
  await expect(page.locator("[data-frame-selection-box]")).toHaveCount(0);
  await expect
    .poll(() =>
      designFrame(page)
        .locator('[data-agent-native-edit-overlay="selection"]')
        .evaluate((el) => window.getComputedStyle(el).display),
    )
    .not.toBe("none");
  await expect.poll(() => inspectorInputCount(page)).toBeGreaterThan(before);
});

test("left sidebar switches between all screens and focused screens", async ({
  page,
}) => {
  const sidebar = page.locator("aside").first();
  const allScreens = sidebar.getByRole("button", { name: "All screens" });
  const homeScreen = sidebar
    .getByRole("button", { name: "Home", exact: true })
    .first();

  await expect(allScreens).toBeVisible();
  await expect(allScreens).toHaveAttribute("aria-current", "page");
  await expect(homeScreen).not.toHaveAttribute("aria-current", "page");

  await homeScreen.click();
  await expect(homeScreen).toHaveAttribute("aria-current", "page");
  await expect(allScreens).not.toHaveAttribute("aria-current", "page");
  await expect
    .poll(
      async () =>
        (await page.locator("iframe[data-design-preview-iframe]").boundingBox())
          ?.width ?? 0,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(600);

  await allScreens.click();
  await expect(allScreens).toHaveAttribute("aria-current", "page");
  await expect(homeScreen).not.toHaveAttribute("aria-current", "page");
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

test("selected element handles stay above hover chrome", async ({ page }) => {
  const payload = await selectByText(page, "E2E Hero Heading");
  expect(payload.selector).toBeTruthy();

  await page
    .locator("iframe[data-design-preview-iframe]")
    .evaluate((iframe, selector) => {
      (iframe as HTMLIFrameElement).contentWindow?.postMessage(
        { type: "hover-element", selector },
        "*",
      );
    }, payload.selector);

  await expect
    .poll(() =>
      designFrame(page)
        .locator('[data-agent-native-edit-overlay="highlight"]')
        .evaluate((el) => window.getComputedStyle(el).display),
    )
    .toBe("none");

  const overlayChrome = await designFrame(page)
    .locator("body")
    .evaluate(() => {
      const highlight = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="highlight"]',
      );
      const selection = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="selection"]',
      );
      const handle = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-handle="nw"]',
      );
      if (!highlight || !selection || !handle) {
        throw new Error("missing selection overlay chrome");
      }
      const handleStyles = window.getComputedStyle(handle);
      return {
        highlightZ: Number(window.getComputedStyle(highlight).zIndex),
        selectionZ: Number(window.getComputedStyle(selection).zIndex),
        handleZ: Number(handleStyles.zIndex),
        handleBackground: handleStyles.backgroundColor,
      };
    });

  expect(overlayChrome.selectionZ).toBeGreaterThan(overlayChrome.highlightZ);
  expect(overlayChrome.handleZ).toBeGreaterThan(0);
  expect(overlayChrome.handleBackground).not.toBe("rgba(0, 0, 0, 0)");
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

test("deeply nested layer rows keep a clickable hit target", async ({
  page,
}) => {
  const deepLayer = page.getByRole("button", {
    name: "Deep Layer Button",
    exact: true,
  });

  for (let attempt = 0; attempt < 12 && !(await deepLayer.count()); attempt++) {
    const expand = page.getByRole("button", { name: "Expand layer" }).first();
    if (!(await expand.count())) break;
    await expand.click();
  }

  await expect(deepLayer).toBeVisible();

  const box = await deepLayer.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(44);

  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Deep Layer Button");
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
