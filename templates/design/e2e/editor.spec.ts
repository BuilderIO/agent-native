import { test, expect } from "@playwright/test";

import {
  readSeedDesignId,
  gotoEditor,
  designFrame,
  enterDirectMode,
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

test("share dialog uses compact editor panel chrome", async ({
  page,
}, testInfo) => {
  await page
    .getByRole("button", { name: /^share$/i })
    .first()
    .click();

  const shareOptions = page.getByRole("tablist", { name: "Share options" });
  await expect(shareOptions).toBeVisible();

  const tabListBox = await shareOptions.boundingBox();
  expect(tabListBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    340,
  );
  expect(tabListBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    28,
  );

  const sendTab = page.getByRole("tab", { name: "Send to agent" });
  const sendTabBox = await sendTab.boundingBox();
  expect(sendTabBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    26,
  );

  await sendTab.click();
  await expect(page.getByText("Your agent", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy agent prompt" }),
  ).toBeVisible();

  const popover = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ has: shareOptions })
    .first();
  const popoverBox = await popover.boundingBox();
  expect(popoverBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    650,
  );

  await cdpScreenshot(page, testInfo.outputPath("share-dialog-compact.png"));
});

test("screen overview resizes previews from the device selector", async ({
  page,
}) => {
  const firstScreenCard = page.locator("[data-screen-card]").first();
  await expect(firstScreenCard).toBeVisible();

  await page.getByRole("button", { name: "Device preview" }).first().click();
  await page.getByRole("menuitemradio", { name: "Desktop" }).click();
  await expect(page.getByText("1280 x 800").first()).toBeVisible();
  const desktopBox = await firstScreenCard.boundingBox();
  if (!desktopBox) throw new Error("missing desktop screen card bounds");

  await page.getByRole("button", { name: "Device preview" }).first().click();
  await page.getByRole("menuitemradio", { name: "Mobile" }).click();
  await expect(page.getByText("390 x 844").first()).toBeVisible();
  await expect
    .poll(async () => (await firstScreenCard.boundingBox())?.width ?? 0)
    .toBeLessThan(desktopBox.width - 1);

  await page.getByRole("button", { name: "Device preview" }).first().click();
  await page.getByRole("menuitemradio", { name: "Responsive" }).click();
});

test("screen overview keeps the name readable when frame header space is tight", async ({
  page,
}) => {
  const screenShell = page
    .locator("[data-screen-shell]")
    .filter({ has: page.locator("[data-screen-card]") })
    .first();
  await expect(screenShell).toBeVisible();

  const screenCard = screenShell.locator("[data-screen-card]");
  const initialCardBox = await screenCard.boundingBox();
  if (!initialCardBox) throw new Error("no screen card box");

  await page.mouse.move(
    initialCardBox.x + initialCardBox.width / 2,
    initialCardBox.y + initialCardBox.height / 2,
  );
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(250);

  await expect(screenShell.locator("[data-frame-dimensions]")).toHaveCount(0);

  const cardBox = await screenCard.boundingBox();
  const titleBox = await screenShell
    .locator("[data-frame-title]")
    .boundingBox();
  const fullViewBox = await screenShell
    .locator("[data-frame-full-view]")
    .boundingBox();
  if (!cardBox || !titleBox || !fullViewBox) {
    throw new Error("missing frame header boxes");
  }

  expect(titleBox.width).toBeGreaterThan(0);
  expect(titleBox.x).toBeLessThan(cardBox.x + cardBox.width);
  expect(fullViewBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width - 1);
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
  const activeScreenShell = page
    .locator("[data-screen-shell]")
    .filter({ has: activeScreenCard })
    .first();
  const frameTitle = activeScreenShell.locator("[data-frame-title]");
  const fullViewButton = activeScreenShell.locator("[data-frame-full-view]");
  const accentColor = await activeScreenCard.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--design-editor-accent-color)";
    document.body.appendChild(probe);
    const color = window.getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const frameTitleColor = () =>
    frameTitle.evaluate((el) => window.getComputedStyle(el).color);

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await waitForBridge(page, "element-hover");
  await expect.poll(frameTitleColor).not.toBe(accentColor);

  await frameTitle.hover();
  await expect.poll(frameTitleColor).toBe(accentColor);

  await frameTitle.click();
  await expect.poll(frameTitleColor).toBe(accentColor);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const selected = await waitForBridge(page, "element-select");
  const payload = selected?.payload ?? selected;
  expect(payload?.textContent ?? "").toContain("E2E Hero Heading");
  await expect(page.locator("[data-frame-selection-box]")).toHaveCount(0);
  await expect
    .poll(() =>
      fullViewButton.evaluate((el) => window.getComputedStyle(el).opacity),
    )
    .toBe("1");
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

test("spacing handles stay visible at rest and remain draggable", async ({
  page,
}) => {
  await enterDirectMode(page);
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));

  const container = designFrame(page).locator("main").first();
  const box = await container.boundingBox();
  if (!box) throw new Error("missing fixture container bounds");

  await page.mouse.click(box.x + 12, box.y + 12);
  const selected = await waitForBridge(page, "element-select");
  expect(
    (selected?.payload?.tagName ?? selected?.tagName ?? "").toUpperCase(),
  ).toBe("MAIN");

  const topPaddingHandle = designFrame(page).locator(
    '[data-spacing-key="padding:top"]',
  );
  await expect(topPaddingHandle).toBeVisible({ timeout: 5_000 });

  const handleBox = await topPaddingHandle.boundingBox();
  if (!handleBox) throw new Error("missing top padding handle bounds");
  const handleX = handleBox.x + handleBox.width / 2;
  const handleY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(handleX, handleY);
  const regionToken = `spacing-region-${Date.now()}`;
  await topPaddingHandle.evaluate((el, token) => {
    el.setAttribute("data-e2e-spacing-region-token", token);
  }, regionToken);

  await page.mouse.move(handleX, handleY);
  await page.waitForTimeout(500);
  await expect(topPaddingHandle).toBeVisible();
  await expect(topPaddingHandle).toHaveAttribute(
    "data-e2e-spacing-region-token",
    regionToken,
  );

  await page.evaluate(() => ((window as any).__bridge = []));
  await page.mouse.down();
  await page.mouse.move(handleX, handleY + 14, { steps: 4 });
  await page.mouse.up();

  const styleChange = await waitForBridge(page, "visual-style-change");
  const styles = styleChange?.styles ?? {};
  expect(styles.paddingTop ?? "").toMatch(/px$/);
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

  await deepLayer.click();
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Deep Layer Button");
});

test("dragging an element on the canvas drives the bridge (move/reorder)", async ({
  page,
}) => {
  // Real pointer drag through the editor: this must reach the structural
  // move path, not just the hover/select bridge messages.
  const fired = await dragCanvasByText(page, "Alpha Button", 0, 90);
  expect(fired).toContain("visual-structure-change");
});

test("can capture a screenshot of the editor via CDP", async ({
  page,
}, info) => {
  // page.screenshot() hangs (the page never reaches an idle frame), so use CDP.
  const out = info.outputPath("editor.png");
  await cdpScreenshot(page, out);
  await info.attach("editor", { path: out, contentType: "image/png" });
});
