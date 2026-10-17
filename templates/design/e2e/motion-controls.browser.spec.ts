import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { MOTION_BUILT_IN_RECIPES } from "../shared/motion-built-in-recipes";
import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import { designFrame, enableLab, gotoEditor, selectByText } from "./helpers";

let designId: string;
let fileId: string;
let baseURLForActions: string;
let restoreMotionLab: (() => Promise<void>) | null = null;

const REFERENCE_FIXTURE_HTML = FIXTURE_HTML.replace(
  '      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>',
  `      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>
      <div data-agent-native-node-id="e2e-motion-reference-rectangle" data-agent-native-layer-name="Rectangle" style="width:100px;height:100px;padding:0;border:0;background:#7F0EFF;color:transparent;font-size:0;line-height:0">Reference Rectangle</div>
      <div data-agent-native-node-id="e2e-motion-reference-rectangle-2" data-agent-native-layer-name="Rectangle 2" style="width:100px;height:100px;padding:0;border:0;background:#FF7A00;color:transparent;font-size:0;line-height:0">Reference Rectangle Two</div>`,
);

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURLForActions}/_agent-native/actions/${actionName}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const params = new URLSearchParams(
    Object.entries(input).flatMap(([key, value]) =>
      value === undefined || value === null ? [] : [[key, String(value)]],
    ),
  );
  const response = await request.get(
    `${baseURLForActions}/_agent-native/actions/${actionName}?${params}`,
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function captureReferenceState(
  page: Page,
  stepId: string,
): Promise<void> {
  const artifactDirectory = path.resolve(
    import.meta.dirname,
    "../../../.tmp/design-motion-parity",
  );
  await mkdir(artifactDirectory, { recursive: true });
  const state = await page.evaluate(() => {
    const inspector = document.querySelector<HTMLElement>(
      '[data-design-inspector-section][aria-label="Animations"]',
    );
    const dock = document.querySelector<HTMLElement>(
      '[role="region"][aria-label="Motion dock"]',
    );
    const bounds = (element: HTMLElement | null) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      inspector: {
        text: inspector?.innerText ?? null,
        rect: bounds(inspector),
      },
      inspectorSections: Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-design-inspector-section]",
        ),
      )
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element) => ({
          label: element.getAttribute("aria-label"),
          text: element.innerText,
          rect: bounds(element),
        })),
      dock: { text: dock?.innerText ?? null, rect: bounds(dock) },
      visibleMenus: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]',
        ),
      )
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element) => ({ text: element.innerText, rect: bounds(element) })),
      buttons: Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      )
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map((button) => ({
          label:
            button.getAttribute("aria-label") ?? button.textContent?.trim(),
          title: button.title,
          rect: bounds(button),
        }))
        .filter((button) => button.label || button.title),
    };
  });
  await writeFile(
    path.join(artifactDirectory, `${stepId}.json`),
    `${JSON.stringify({ step_id: stepId, state }, null, 2)}\n`,
    "utf8",
  );
  await page.screenshot({
    path: path.join(artifactDirectory, `${stepId}.png`),
    animations: "disabled",
  });
}

async function zoomCanvasTo100(page: Page): Promise<void> {
  const canvasZoom = page
    .getByRole("button")
    .filter({ hasText: /^\s*\d+%\s*$/ })
    .first();
  await expect(canvasZoom).toBeVisible();
  if ((await canvasZoom.innerText()).trim() !== "100%") {
    await canvasZoom.click();
    await page.getByRole("menuitem", { name: "Zoom to 100%" }).click();
  }
  await expect(canvasZoom).toHaveText(/100%/);
}

test.beforeAll(async ({ request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  const created = await postAction(request, "create-design", {
    title: "Motion Controls",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design did not return an id");
  const file = await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: REFERENCE_FIXTURE_HTML,
    fileType: "html",
  });
  fileId = file.id;
  if (!fileId) throw new Error("create-file did not return an id");
  await postAction(request, "index-components", { designId });
});

test.beforeEach(async ({ page }) => {
  restoreMotionLab = await enableLab(page, DESIGN_MOTION_LAB.key);
});

test.afterEach(async () => {
  await restoreMotionLab?.();
  restoreMotionLab = null;
});

test.afterAll(async ({ request }) => {
  if (designId) await postAction(request, "delete-design", { id: designId });
});

test("Motion inspector states match the editable timeline", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1728, height: 941 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await gotoEditor(page, designId);
  const canvasZoom = page
    .getByRole("button")
    .filter({ hasText: /^\s*\d+%\s*$/ })
    .first();
  await expect(canvasZoom).toBeVisible();
  await canvasZoom.click();
  await page.getByRole("menuitem", { name: "Zoom to fit" }).click();
  await selectByText(page, "Reference Rectangle", {
    screenId: fileId,
    deep: false,
  });
  if ((await canvasZoom.innerText()).trim() !== "100%") {
    await canvasZoom.click();
    await page.getByRole("menuitem", { name: "Zoom to 100%" }).click();
  }
  await expect(canvasZoom).toHaveText(/100%/);
  await captureReferenceState(page, "motion-controls-before-selection");

  const launchMotion = page.getByRole("button", {
    name: "Motion dock",
    exact: true,
  });
  await expect(launchMotion).toBeVisible();
  await launchMotion.click();
  const dock = page.getByRole("region", { name: "Motion dock" }).first();
  await expect(dock).toBeVisible();
  const emptyState = dock.locator("[data-motion-empty-state]");
  await expect(emptyState).toHaveClass("sr-only");
  await expect(emptyState).toContainText(
    "Animate Rectangle. Pick a property to add the first track.",
  );

  const emptyTimelineAutoKeyframe = dock.getByRole("checkbox", {
    name: "Toggle auto-keyframing",
  });
  await expect(emptyTimelineAutoKeyframe).not.toBeChecked();
  await emptyTimelineAutoKeyframe.click();
  await expect(emptyTimelineAutoKeyframe).toBeChecked();
  await expect(dock.locator("[data-motion-track-row]")).toHaveCount(0);
  await expect(dock.locator("[data-motion-keyframe]")).toHaveCount(0);
  await expect(
    dock.locator("[data-motion-playhead][data-motion-auto-keyframe]"),
  ).toHaveCount(2);
  await captureReferenceState(page, "motion-controls-empty-auto-keyframe");
  await emptyTimelineAutoKeyframe.click();
  await expect(emptyTimelineAutoKeyframe).not.toBeChecked();

  await page.mouse.click(1380, 600);
  await expect(dock).toBeVisible();
  await expect(dock.locator("[data-motion-track-row]")).toHaveCount(0);
  await expect(dock.locator("[data-motion-keyframe]")).toHaveCount(0);
  await expect(
    dock.getByText(
      "Select an element on the canvas, then add a track to animate it.",
      { exact: true },
    ),
  ).toBeVisible();
  await captureReferenceState(page, "motion-controls-deselected-empty");
  await selectByText(page, "Reference Rectangle", {
    screenId: fileId,
    clearPreviousSelection: true,
    deep: false,
  });
  await expect(
    page.getByRole("button", { name: "Add animation", exact: true }).first(),
  ).toBeVisible();

  await page.setViewportSize({ width: 1728, height: 997 });
  const animationCatalogTrigger = page.getByRole("button", {
    name: "Animations",
    exact: true,
  });
  await animationCatalogTrigger.click();
  const animationCatalog = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({
      has: page.getByRole("button", { name: "Close", exact: true }),
    });
  await expect(animationCatalog).toBeVisible();
  const gallerySearch = animationCatalog.getByRole("textbox").first();
  const galleryCategoryFilter = animationCatalog.getByRole("combobox").first();
  const firstBasicAction = animationCatalog.getByRole("button", {
    name: "Position",
    exact: true,
  });
  await expect(gallerySearch).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(galleryCategoryFilter).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstBasicAction).toBeFocused();
  for (const action of ["Position", "Scale", "Rotation", "Size", "Opacity"]) {
    await expect(
      animationCatalog.getByRole("button", { name: action, exact: true }),
    ).toBeVisible();
  }
  await expect(
    animationCatalog.getByRole("button", { name: "Path", exact: true }),
  ).toHaveCount(0);
  await animationCatalog.evaluate(async (popover) => {
    const finiteAnimations = popover
      .getAnimations()
      .filter(
        (animation) => animation.effect?.getTiming().iterations !== Infinity,
      );
    await Promise.all(finiteAnimations.map((animation) => animation.finished));
  });
  await captureReferenceState(
    page,
    "motion-controls-animation-library-2026-10-15",
  );
  const catalogGeometry = await animationCatalog.evaluate((popover) => {
    const rect = popover.getBoundingClientRect();
    const inspectorHeading = document.querySelector<HTMLElement>(
      'h3[aria-label="Animations"]',
    );
    const inspectorSection = inspectorHeading?.closest<HTMLElement>(
      "[data-design-inspector-section]",
    );
    const rightPanel = document.querySelector<HTMLElement>(
      '[data-design-chrome-region="right-panel"]',
    );
    const trigger = inspectorSection?.querySelector<HTMLElement>(
      'button[aria-label="Animations"]',
    );
    if (!inspectorSection || !rightPanel || !trigger) {
      throw new Error("Animation catalog anchor geometry is unavailable");
    }
    return {
      popover: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      rightPanel: rightPanel.getBoundingClientRect().toJSON(),
      trigger: trigger.getBoundingClientRect().toJSON(),
    };
  });
  expect(catalogGeometry.popover.width).toBe(240);
  expect(catalogGeometry.popover.height).toBe(485);
  expect(catalogGeometry.rightPanel.width).toBe(240);
  expect(catalogGeometry.trigger.width).toBe(24);
  expect(
    catalogGeometry.rightPanel.x -
      (catalogGeometry.popover.x + catalogGeometry.popover.width),
    JSON.stringify(catalogGeometry),
  ).toBe(1);
  expect(
    Math.abs(catalogGeometry.popover.y - catalogGeometry.trigger.y),
  ).toBeLessThanOrEqual(1);
  await animationCatalog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.setViewportSize({ width: 1728, height: 941 });

  const addAnimation = page
    .getByRole("button", { name: "Add animation", exact: true })
    .first();
  const applied = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await addAnimation.click();
  await expect(page.getByRole("menuitem", { name: "Position" })).toBeVisible();
  const addAnimationMenu = page.getByRole("menu");
  await addAnimationMenu.evaluate(async (menu) => {
    const finiteAnimations = menu
      .getAnimations()
      .filter(
        (animation) => animation.effect?.getTiming().iterations !== Infinity,
      );
    await Promise.all(finiteAnimations.map((animation) => animation.finished));
  });
  await captureReferenceState(page, "motion-controls-add-menu");
  const menuGeometry = await page.evaluate(() => {
    const bounds = (element: Element | null) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Add animation"]',
      ),
    ).find((button) => button.getBoundingClientRect().width > 0);
    const inspectorHeader = trigger
      ?.closest<HTMLElement>("[data-design-inspector-section]")
      ?.querySelector<HTMLElement>(
        '[data-design-inspector-section-header] [data-inspector-layout="header-actions"]',
      );
    if (!inspectorHeader) {
      throw new Error("Animation inspector geometry is unavailable");
    }
    return {
      inspectorHeaderRight: inspectorHeader.getBoundingClientRect().right,
      menu: bounds(document.querySelector('[role="menu"]')),
      trigger: bounds(trigger ?? null),
    };
  });
  if (!menuGeometry.menu || !menuGeometry.trigger) {
    throw new Error("Motion menu geometry is unavailable");
  }
  expect(menuGeometry.menu.width).toBe(120);
  expect(menuGeometry.menu.height).toBe(136);
  expect(menuGeometry.trigger.width).toBe(24);
  expect(
    Math.abs(
      menuGeometry.trigger.x +
        menuGeometry.trigger.width -
        menuGeometry.inspectorHeaderRight +
        1,
    ),
    JSON.stringify(menuGeometry),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      menuGeometry.menu.x +
        menuGeometry.menu.width -
        (menuGeometry.trigger.x + menuGeometry.trigger.width),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      menuGeometry.menu.y -
        (menuGeometry.trigger.y + menuGeometry.trigger.height + 4),
    ),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("menuitem", { name: "Position", exact: true }).click();
  const appliedResponse = await applied;
  expect(appliedResponse.ok(), await appliedResponse.text()).toBe(true);
  expect(await appliedResponse.json()).toMatchObject({ persisted: true });

  const nativeStyleInspector = page.locator(
    '[data-design-inspector-section][aria-label="Animations"]',
  );
  await expect(
    nativeStyleInspector.getByRole("button", { name: "Position", exact: true }),
  ).toBeVisible();
  await nativeStyleInspector
    .getByRole("button", { name: "Position", exact: true })
    .click();
  const positionEditorPopup = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ has: page.getByRole("combobox", { name: "Type" }) });
  const positionEditorRect = await positionEditorPopup.boundingBox();
  const positionStyleTriggerRect = await nativeStyleInspector
    .getByRole("button", { name: "Position", exact: true })
    .boundingBox();
  const rightPanelLeft = await page
    .locator('[data-design-chrome-region="right-panel"]')
    .evaluate((element) => element.getBoundingClientRect().x);
  expect(positionEditorRect).not.toBeNull();
  expect(positionStyleTriggerRect).not.toBeNull();
  expect(positionEditorRect!.y - positionStyleTriggerRect!.y).toBeCloseTo(
    -4,
    0,
  );
  expect(
    positionEditorRect!.x + positionEditorRect!.width - (rightPanelLeft - 1),
  ).toBeCloseTo(0, 0);
  expect(positionEditorRect!.height).toBeCloseTo(270, 0);
  await expect(page.getByRole("combobox", { name: "Type" })).toHaveText(
    "Slide in",
  );
  await expect(page.getByRole("combobox", { name: "Direction" })).toHaveText(
    "From left",
  );
  await expect(page.getByRole("spinbutton", { name: "Distance" })).toHaveValue(
    "200",
  );
  await expect(page.getByRole("spinbutton", { name: "Delay" })).toHaveValue(
    "0",
  );
  await expect(page.getByRole("spinbutton", { name: "Duration" })).toHaveValue(
    "500",
  );
  await expect(page.getByRole("button", { name: "Ease out" })).toBeVisible();
  await captureReferenceState(page, "motion-controls-position");
  const typeControl = page.getByRole("combobox", { name: "Type" });
  await typeControl.click();
  await expect(page.getByRole("option")).toHaveText([
    "Slide in",
    "Slide out",
    "Custom",
  ]);
  await captureReferenceState(page, "motion-controls-position-type-menu");
  await page.keyboard.press("Escape");
  const easingTrigger = page.getByRole("button", {
    name: "Ease out",
    exact: true,
  });
  const easingTriggerRect = await easingTrigger.boundingBox();
  await easingTrigger.click();
  const easingPresetPanel = page.getByRole("tabpanel", {
    name: "Presets",
  });
  const easingPopup = easingPresetPanel.locator(
    "xpath=ancestor::*[@data-side][1]",
  );
  const easingPopupRect = await easingPopup.boundingBox();
  expect(easingPopupRect).not.toBeNull();
  expect(easingTriggerRect).not.toBeNull();
  await expect(easingPopup).toHaveAttribute("data-side", "bottom");
  await expect(easingPopup).toHaveAttribute("data-align", "start");
  await expect(easingPopup.locator('input[type="search"]')).toHaveCount(0);
  await expect(
    easingPopup.getByRole("button", { name: "New variable", exact: true }),
  ).toBeVisible();
  await expect(
    easingPopup.getByRole("button", { name: "Close", exact: true }),
  ).toBeVisible();
  expect(easingPopupRect!.x).toBeCloseTo(easingTriggerRect!.x, 0);
  expect(easingPopupRect!.y).toBeGreaterThan(easingTriggerRect!.y);
  for (const easing of [
    "Hold",
    "Linear",
    "Ease in",
    "Ease out",
    "Ease in and out",
    "Ease in back",
    "Ease out back",
    "Ease in and out back",
    "Custom bezier",
    "Gentle",
    "Quick",
    "Bouncy",
    "Slow",
    "Custom spring",
  ]) {
    await expect(
      easingPresetPanel.getByRole("button", { name: easing, exact: true }),
    ).toBeVisible();
  }
  await captureReferenceState(page, "motion-controls-easing-menu");
  await easingPopup.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    dock.locator(
      '[data-motion-native-style-row="Position"] [data-motion-select-native-style]',
    ),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2000",
  );
  const durationHandle = dock.getByRole("slider", { name: "Duration" });
  await expect(durationHandle).toBeVisible();
  await expect(durationHandle).toHaveAttribute("aria-valuenow", "2000");
  await durationHandle.focus();
  await durationHandle.press("ArrowRight");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2001",
  );
  await durationHandle.press("Shift+ArrowRight");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2011",
  );
  await durationHandle.press("Shift+ArrowLeft");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2001",
  );
  await durationHandle.press("ArrowLeft");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2000",
  );
  await durationHandle.press("Shift+ArrowRight");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2010",
  );
  await durationHandle.press("Shift+ArrowLeft");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2000",
  );
  const durationInput = dock.getByRole("textbox", { name: "Duration" });
  await durationInput.focus();
  await durationInput.press("ArrowUp");
  await expect(durationInput).toHaveValue("2001");
  await durationInput.press("Shift+ArrowUp");
  await expect(durationInput).toHaveValue("2011");
  await durationInput.press("Shift+ArrowDown");
  await expect(durationInput).toHaveValue("2001");
  await durationInput.press("ArrowDown");
  await expect(durationInput).toHaveValue("2000");
  await dock.getByRole("button", { name: "Change time format" }).click();
  await expect(durationInput).toHaveValue("2");
  await durationInput.press("ArrowUp");
  await expect(durationInput).toHaveValue("2.1");
  await durationInput.press("Shift+ArrowUp");
  await expect(durationInput).toHaveValue("3.1");
  await durationInput.press("Shift+ArrowDown");
  await expect(durationInput).toHaveValue("2.1");
  await durationInput.press("ArrowDown");
  await expect(durationInput).toHaveValue("2");
  await dock.getByRole("button", { name: "Change time format" }).click();
  await expect(durationInput).toHaveValue("2000");
  await durationInput.press("Home");
  await expect(durationInput).toHaveValue("2000");
  await durationInput.press("End");
  await expect(durationInput).toHaveValue("2000");
  await expect(
    dock.getByRole("slider", { name: "Position animation span" }),
  ).toHaveAttribute("aria-valuetext", "0ms – 500ms");

  const autoKeyframe = dock.getByRole("checkbox", {
    name: "Toggle auto-keyframing",
  });
  await autoKeyframe.click();
  await expect(
    dock.locator("[data-motion-playhead][data-motion-auto-keyframe]"),
  ).toHaveCount(2);
  await captureReferenceState(page, "motion-controls-auto-keyframe");
  await autoKeyframe.click();
  await expect(
    dock.locator("[data-motion-playhead][data-motion-auto-keyframe]"),
  ).toHaveCount(0);

  const saved = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  expect(saved.timelines?.[0]).toMatchObject({ durationMs: 2000 });
  expect(saved.timelines?.[0]?.nativeStyles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        styleKey: "Position",
        targetNodeId: "e2e-motion-reference-rectangle",
      }),
    ]),
  );

  await addAnimation.click();
  for (const label of ["Position", "Scale", "Rotation", "Size", "Opacity"]) {
    await expect(
      page.getByRole("menuitem", { name: label, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("menuitem", { name: "Text Stagger", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("menuitem")).toHaveCount(5);
  await captureReferenceState(page, "motion-controls-add-menu");
  await page.keyboard.press("Escape");

  for (const style of [
    { name: "Scale", type: "Scale in", amount: "120" },
    {
      name: "Rotation",
      type: "Rotate in",
      amount: "180",
      direction: "Clockwise",
    },
    { name: "Size", type: "Resize in", amount: "50" },
    { name: "Opacity", type: "Fade In", amount: "0" },
  ]) {
    const appliedStyle = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await addAnimation.click();
    await page.getByRole("menuitem", { name: style.name, exact: true }).click();
    const appliedStyleResponse = await appliedStyle;
    expect(appliedStyleResponse.ok(), await appliedStyleResponse.text()).toBe(
      true,
    );
    expect(await appliedStyleResponse.json()).toMatchObject({
      persisted: true,
    });

    await nativeStyleInspector
      .getByRole("button", { name: style.name, exact: true })
      .click();
    await expect(page.getByRole("combobox", { name: "Type" })).toHaveText(
      style.type,
    );
    if (style.direction) {
      await expect(
        page.getByRole("combobox", { name: "Direction" }),
      ).toHaveText(style.direction);
    }
    await expect(page.getByRole("spinbutton", { name: "Amount" })).toHaveValue(
      style.amount,
    );
    if (style.name === "Size") {
      const sizeEditorPopup = page
        .locator("[data-radix-popper-content-wrapper]")
        .filter({
          has: page.getByRole("spinbutton", { name: "Amount" }),
        });
      await expect(
        sizeEditorPopup.getByText("px", { exact: true }),
      ).toHaveCount(0);
    }
    await expect(page.getByRole("spinbutton", { name: "Delay" })).toHaveValue(
      "0",
    );
    await expect(
      page.getByRole("spinbutton", { name: "Duration" }),
    ).toHaveValue("500");
    await expect(page.getByRole("button", { name: "Ease out" })).toBeVisible();
  }

  const origin = page.getByRole("button", { name: "Origin", exact: true });
  await expect(origin).toBeVisible();
  await page.keyboard.press("Alt+r");
  await expect(page.getByRole("radiogroup", { name: "Anchor" })).toBeVisible();
  await page.keyboard.press("Escape");
  await origin.click();
  await expect(page.getByRole("radiogroup", { name: "Anchor" })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(9);
  await expect(page.getByRole("textbox", { name: "Origin X" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Origin Y" })).toBeVisible();
  const originPopover = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("textbox", { name: "Origin X" }) });
  await originPopover.evaluate(async (popover) => {
    const finiteAnimations = popover
      .getAnimations()
      .filter(
        (animation) => animation.effect?.getTiming().iterations !== Infinity,
      );
    await Promise.all(finiteAnimations.map((animation) => animation.finished));
  });
  const originGeometry = await origin.evaluate((trigger) => {
    const popover = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!popover) return null;
    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    return {
      trigger: {
        right: triggerRect.right,
        bottom: triggerRect.bottom,
      },
      popover: {
        x: popoverRect.x,
        y: popoverRect.y,
        width: popoverRect.width,
        height: popoverRect.height,
        right: popoverRect.right,
      },
    };
  });
  expect(originGeometry?.popover.width).toBe(212);
  expect(originGeometry?.popover.height).toBe(109);
  expect(
    Math.abs(originGeometry!.popover.right - originGeometry!.trigger.right),
  ).toBeLessThanOrEqual(1);
  expect(originGeometry!.popover.y - originGeometry!.trigger.bottom).toBe(6);
  const originMarker = designFrame(page, fileId).locator(
    "[data-motion-origin-marker]",
  );
  await expect(originMarker).toBeVisible();
  const originProxy = page.locator("[data-motion-origin-proxy]");
  await expect(originProxy).toBeVisible();
  await captureReferenceState(page, "motion-controls-origin");

  const referenceRectangle = designFrame(page, fileId).locator(
    '[data-agent-native-node-id="e2e-motion-reference-rectangle"]',
  );
  const initialTransformOrigin = await referenceRectangle.evaluate(
    (element) => getComputedStyle(element).transformOrigin,
  );
  const sourceBeforeOriginDrag = await getAction(request, "read-source-file", {
    designId,
    path: "index.html",
  });
  const markerBox = await originProxy.boundingBox();
  if (!markerBox)
    throw new Error("The Motion origin marker is not measurable.");
  const markerX = markerBox.x + markerBox.width / 2;
  const markerY = markerBox.y + markerBox.height / 2;
  await page.mouse.move(markerX, markerY);
  await page.mouse.down();
  await page.mouse.move(markerX + 12, markerY + 8, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const source = await getAction(request, "read-source-file", {
        designId,
        path: "index.html",
      });
      return source.content;
    })
    .not.toBe(sourceBeforeOriginDrag.content);
  const sourceAfterOriginDrag = await getAction(request, "read-source-file", {
    designId,
    path: "index.html",
  });
  expect(sourceAfterOriginDrag.content).toContain("transform-origin");
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator('[data-agent-native-node-id="e2e-motion-reference-rectangle"]')
        .evaluate((element) => getComputedStyle(element).transformOrigin),
    )
    .not.toBe(initialTransformOrigin);

  await page.keyboard.press("Escape");
  await selectByText(page, "Second fixture paragraph for selection tests.", {
    screenId: fileId,
    clearPreviousSelection: true,
  });
  await addAnimation.click();
  for (const label of [
    "Text",
    "Position",
    "Scale",
    "Rotation",
    "Size",
    "Opacity",
  ]) {
    await expect(
      page.getByRole("menuitem", { name: label, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole("menuitem")).toHaveCount(6);
  await captureReferenceState(page, "motion-controls-text-add-menu");

  await page.keyboard.press("Escape");
  await selectByText(page, "Reference Rectangle", {
    screenId: fileId,
    clearPreviousSelection: true,
    deep: false,
  });
  const currentTime = dock.getByRole("textbox", { name: "Current time" });
  const appearance = page
    .getByRole("heading", { name: "Appearance", exact: true })
    .locator("xpath=ancestor::section");
  const opacity = appearance.locator('input[aria-label="Opacity" i]');
  await expect(opacity).toBeVisible();
  await currentTime.fill("0");
  await currentTime.press("Tab");
  await autoKeyframe.check();

  const startOpacitySave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await opacity.fill("70");
  await opacity.press("Enter");
  const savedStartOpacity = await startOpacitySave;
  expect(savedStartOpacity.ok(), await savedStartOpacity.text()).toBe(true);
  const opacityTimelineRow = dock.locator(
    '[data-motion-property-row="opacity"][data-motion-target-node-id="e2e-motion-reference-rectangle"]',
  );
  await expect(opacityTimelineRow).toBeVisible();
  await expect(
    opacityTimelineRow.getByRole("button", { name: "Add or remove keyframe" }),
  ).toBeVisible();
  const startTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const opacityTrack = startTimeline.timelines?.[0]?.tracks?.find(
    (track: { property: string; targetNodeId: string }) =>
      track.property === "opacity" &&
      track.targetNodeId === "e2e-motion-reference-rectangle",
  );
  expect(
    opacityTrack?.keyframes?.map((keyframe: { t: number }) => keyframe.t),
  ).toEqual([0]);
  expect(
    opacityTrack?.keyframes?.map(
      (keyframe: { value: string }) => keyframe.value,
    ),
  ).toEqual(["0.7"]);
  await captureReferenceState(
    page,
    "motion-controls-auto-key-new-track-at-start",
  );

  await currentTime.fill("1000");
  await currentTime.press("Tab");
  await selectByText(page, "Reference Rectangle Two", {
    screenId: fileId,
    clearPreviousSelection: true,
    deep: false,
  });
  const middleOpacitySave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await opacity.fill("70");
  await opacity.press("Enter");
  const savedMiddleOpacity = await middleOpacitySave;
  expect(savedMiddleOpacity.ok(), await savedMiddleOpacity.text()).toBe(true);
  const middleTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const middleOpacityTrack = middleTimeline.timelines?.[0]?.tracks?.find(
    (track: { property: string; targetNodeId: string }) =>
      track.property === "opacity" &&
      track.targetNodeId === "e2e-motion-reference-rectangle-2",
  );
  expect(
    middleOpacityTrack?.keyframes?.map((keyframe: { t: number }) => keyframe.t),
  ).toEqual([0, 0.5]);
  expect(
    middleOpacityTrack?.keyframes?.map(
      (keyframe: { value: string }) => keyframe.value,
    ),
  ).toEqual(["1", "0.7"]);
  const middleOpacityTimelineRow = dock.locator(
    '[data-motion-property-row="opacity"][data-motion-target-node-id="e2e-motion-reference-rectangle-2"]',
  );
  await expect(
    middleOpacityTimelineRow.getByRole("button", {
      name: "Add or remove keyframe",
    }),
  ).toBeVisible();
  await captureReferenceState(
    page,
    "motion-controls-auto-key-new-track-midpoint",
  );
  await autoKeyframe.uncheck();
});

test("Motion gallery searches visible names, not hidden categories or tempo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1728, height: 941 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await gotoEditor(page, designId);
  await selectByText(page, "Reference Rectangle", {
    screenId: fileId,
    clearPreviousSelection: true,
    deep: false,
  });
  await page.getByRole("button", { name: "Animations", exact: true }).click();

  const gallery = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ has: page.getByRole("button", { name: "Close", exact: true }) });
  const search = gallery.getByRole("textbox", {
    name: "Search animation styles",
    exact: true,
  });
  const recipes = gallery.locator("[data-motion-recipe-id]");

  await search.fill("Position");
  await expect(recipes).toHaveCount(0);
  await expect(
    gallery.getByRole("button", { name: "Position", exact: true }),
  ).toBeVisible();

  await search.fill("Enter");
  await expect(recipes).toHaveCount(0);
  await expect(gallery.getByText("No matching styles")).toBeVisible();

  await search.fill("Slow");
  await expect(recipes).toHaveCount(0);
  await expect(gallery.getByText("No matching styles")).toBeVisible();

  await search.fill("Builder Arrival 03");
  await expect(
    gallery.locator('[data-motion-recipe-id="enter.recipe-03"]'),
  ).toBeVisible();
  await expect(recipes).toHaveCount(1);
  await captureReferenceState(page, "motion-controls-recipe-name-search");
});

test("a new motion preset applies to every selected target", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1728, height: 941 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await gotoEditor(page, designId);
  await selectByText(page, "Reference Rectangle", {
    screenId: fileId,
    clearPreviousSelection: true,
    deep: false,
  });
  await selectByText(page, "Reference Rectangle Two", {
    screenId: fileId,
    additive: true,
  });
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  const dock = page.getByRole("region", { name: "Motion dock" }).first();
  await expect(dock).toBeVisible();
  const addAnimation = page
    .getByRole("button", { name: "Add animation", exact: true })
    .first();
  const multiTargetApplied = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await addAnimation.click();
  await page.getByRole("menuitem", { name: "Scale", exact: true }).click();
  const multiTargetResponse = await multiTargetApplied;
  expect(multiTargetResponse.ok(), await multiTargetResponse.text()).toBe(true);

  const multiTargetTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const scaleTargetIds = multiTargetTimeline.timelines?.[0]?.nativeStyles
    ?.filter((style: { styleKey: string }) => style.styleKey === "Scale")
    .map((style: { targetNodeId: string }) => style.targetNodeId)
    .sort();
  expect(scaleTargetIds).toEqual([
    "e2e-motion-reference-rectangle",
    "e2e-motion-reference-rectangle-2",
  ]);
});

for (const recipeId of ["enter.recipe-10", "cycle.recipe-03"] as const) {
  test(`applies ${recipeId} as ordered source-backed motion tracks`, async ({
    page,
    request,
  }) => {
    let recipeDesignId: string | undefined;
    try {
      const created = await postAction(request, "create-design", {
        title: `Composite Motion recipe ${recipeId}`,
        projectType: "prototype",
      });
      recipeDesignId = created?.id ?? created?.data?.id ?? created?.design?.id;
      if (!recipeDesignId) {
        throw new Error("create-design did not return an id");
      }
      const file = await postAction(request, "create-file", {
        designId: recipeDesignId,
        filename: "index.html",
        content: REFERENCE_FIXTURE_HTML,
        fileType: "html",
      });
      if (!file.id) throw new Error("create-file did not return a file id");
      await postAction(request, "index-components", {
        designId: recipeDesignId,
      });

      await page.setViewportSize({ width: 1728, height: 941 });
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));
      await gotoEditor(page, recipeDesignId);
      await selectByText(page, "Reference Rectangle", {
        screenId: file.id,
        clearPreviousSelection: true,
        deep: false,
      });
      await zoomCanvasTo100(page);

      const recipe = MOTION_BUILT_IN_RECIPES.find(
        (entry) => entry.id === recipeId,
      );
      if (!recipe) throw new Error("The sampled composite recipe is missing");
      await page
        .getByRole("button", { name: "Animations", exact: true })
        .click();
      const recipeRow = page.locator(`[data-motion-recipe-id="${recipe.id}"]`);
      await expect(recipeRow).toBeVisible();
      const applied = page.waitForResponse(
        (response) =>
          response.url().includes("/_agent-native/actions/apply-motion-edit") &&
          response.request().method() === "POST",
        { timeout: 20_000 },
      );
      await recipeRow.click();
      const appliedResponse = await applied;
      expect(appliedResponse.ok(), await appliedResponse.text()).toBe(true);
      expect(await appliedResponse.json()).toMatchObject({ persisted: true });

      const timeline = await getAction(request, "get-motion-timeline", {
        designId: recipeDesignId,
        sourceRef: file.id,
      });
      const tracks = timeline.timelines?.[0]?.tracks?.filter(
        (track: { targetNodeId: string }) =>
          track.targetNodeId === "e2e-motion-reference-rectangle",
      );
      expect(tracks).toHaveLength(recipe.tracks.length);
      expect(
        tracks?.map(
          (track: {
            property: string;
            delayMs?: number;
            durationMs: number;
            keyframes: Array<{ t: number; value: string; ease?: string }>;
          }) => ({
            property: track.property,
            delayMs: track.delayMs ?? 0,
            durationMs: track.durationMs,
            keyframes: track.keyframes.map((keyframe) => ({
              t: keyframe.t,
              value: keyframe.value,
              ease: keyframe.ease ?? "linear",
            })),
          }),
        ),
      ).toEqual(
        recipe.tracks.map((track) => ({
          property: track.property,
          delayMs: track.delayMs,
          durationMs: track.durationMs,
          keyframes: track.keyframes.map((keyframe, index) => ({
            t: keyframe.t,
            value: keyframe.value,
            ease: index === 0 ? track.easing : "ease",
          })),
        })),
      );
      expect(
        new Set(tracks?.map((track: { id: string }) => track.id)).size,
      ).toBe(recipe.tracks.length);
      expect(
        tracks?.filter(
          (track: { property: string }) => track.property === "translate",
        ),
      ).toHaveLength(recipeId === "enter.recipe-10" ? 2 : 0);
      expect(
        tracks?.filter(
          (track: { property: string }) => track.property === "scale",
        ),
      ).toHaveLength(recipeId === "cycle.recipe-03" ? 2 : 1);
    } finally {
      if (recipeDesignId) {
        await postAction(request, "delete-design", { id: recipeDesignId });
      }
    }
  });
}

for (const { recipeId, manualPosition } of [
  { recipeId: "enter.recipe-01", manualPosition: false },
  { recipeId: "enter.recipe-01", manualPosition: true },
  { recipeId: "enter.recipe-04", manualPosition: false },
] as const) {
  test(`reapplying ${recipeId} appends source-backed tracks at the playhead${manualPosition ? " with a manual Position style" : ""}`, async ({
    page,
    request,
  }) => {
    let recipeDesignId: string | undefined;
    try {
      const created = await postAction(request, "create-design", {
        title: "Repeated Motion recipe tracks",
        projectType: "prototype",
      });
      recipeDesignId = created?.id ?? created?.data?.id ?? created?.design?.id;
      if (!recipeDesignId) {
        throw new Error("create-design did not return an id");
      }
      const file = await postAction(request, "create-file", {
        designId: recipeDesignId,
        filename: "index.html",
        content: REFERENCE_FIXTURE_HTML,
        fileType: "html",
      });
      if (!file.id) throw new Error("create-file did not return a file id");
      await postAction(request, "index-components", {
        designId: recipeDesignId,
      });

      await page.setViewportSize({ width: 1728, height: 941 });
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));
      await gotoEditor(page, recipeDesignId);
      await selectByText(page, "Reference Rectangle", {
        screenId: file.id,
        clearPreviousSelection: true,
        deep: false,
      });
      await zoomCanvasTo100(page);

      const recipe = MOTION_BUILT_IN_RECIPES.find(
        (entry) => entry.id === recipeId,
      );
      if (!recipe) throw new Error("The repeated recipe is missing");
      const expectedTrackCount = recipe.tracks.length * 2;
      const recipeRow = page.locator(`[data-motion-recipe-id="${recipe.id}"]`);
      const applyRecipe = async () => {
        await page
          .getByRole("button", { name: "Animations", exact: true })
          .click();
        await expect(recipeRow).toBeVisible();
        const applied = page.waitForResponse(
          (response) =>
            response
              .url()
              .includes("/_agent-native/actions/apply-motion-edit") &&
            response.request().method() === "POST",
          { timeout: 20_000 },
        );
        await recipeRow.click();
        const response = await applied;
        expect(response.ok(), await response.text()).toBe(true);
        expect(await response.json()).toMatchObject({ persisted: true });
      };

      await applyRecipe();
      const dock = page.getByRole("region", { name: "Motion dock" }).first();
      await expect(dock).toBeVisible();
      await expect(dock.locator("[data-motion-track-row]")).toHaveCount(
        recipe.tracks.length,
      );
      if (manualPosition) {
        const addAnimation = page
          .getByRole("button", { name: "Add animation", exact: true })
          .first();
        const applied = page.waitForResponse(
          (response) =>
            response
              .url()
              .includes("/_agent-native/actions/apply-motion-edit") &&
            response.request().method() === "POST",
          { timeout: 20_000 },
        );
        await addAnimation.click();
        await page
          .getByRole("menuitem", { name: "Position", exact: true })
          .click();
        const response = await applied;
        expect(response.ok(), await response.text()).toBe(true);
        expect(await response.json()).toMatchObject({ persisted: true });
        await expect(
          dock.locator('[data-motion-native-style-row="Position"]'),
        ).toHaveCount(1);
      }
      const currentTime = dock.getByRole("textbox", { name: "Current time" });
      const secondApplyTimeMs = manualPosition ? 0 : 250;
      if (secondApplyTimeMs > 0) {
        await currentTime.click();
        await currentTime.fill(String(secondApplyTimeMs));
        await currentTime.press("Tab");
      }
      expect(Number(await currentTime.inputValue())).toBe(secondApplyTimeMs);
      await applyRecipe();

      const targetId = "e2e-motion-reference-rectangle";
      const timeline = await getAction(request, "get-motion-timeline", {
        designId: recipeDesignId,
        sourceRef: file.id,
      });
      const tracks = timeline.timelines?.[0]?.tracks?.filter(
        (track: { targetNodeId: string }) => track.targetNodeId === targetId,
      );
      expect(tracks).toHaveLength(expectedTrackCount);
      expect(
        tracks?.map((track: { property: string }) => track.property),
      ).toEqual([
        ...recipe.tracks.map((track) => track.property),
        ...recipe.tracks.map((track) => track.property),
      ]);
      expect(
        tracks
          ?.slice(recipe.tracks.length)
          .map((track: { delayMs?: number }) => track.delayMs ?? 0),
      ).toEqual(
        recipe.tracks.map((track) => secondApplyTimeMs + track.delayMs),
      );
      expect(
        new Set(tracks?.map((track: { id: string }) => track.id)).size,
      ).toBe(expectedTrackCount);
      if (manualPosition) {
        const positionStyle = timeline.timelines?.[0]?.nativeStyles?.find(
          (style: { styleKey: string; targetNodeId: string }) =>
            style.styleKey === "Position" && style.targetNodeId === targetId,
        );
        expect(positionStyle).toMatchObject({
          duration: 0.5,
          timelineOffset: 0,
          props: {
            type: "slide_in",
            direction: "left",
            distance: 200,
            delay: 0,
            easing: { type: "EASE_OUT" },
          },
        });
      }
      const expectedTrackSpanMs = manualPosition
        ? 300
        : recipeId === "enter.recipe-04"
          ? 1460
          : 550;
      expect(
        Math.max(
          ...(tracks ?? []).map(
            (track: { delayMs?: number; durationMs: number }) =>
              (track.delayMs ?? 0) + track.durationMs,
          ),
        ),
      ).toBe(expectedTrackSpanMs);
      if (manualPosition) {
        expect(
          Math.max(
            expectedTrackSpanMs,
            ...(timeline.timelines?.[0]?.nativeStyles ?? []).map(
              (style: { duration: number; timelineOffset: number }) =>
                (style.timelineOffset + style.duration) * 1000,
            ),
          ),
        ).toBe(500);
      }

      let sourceContent = "";
      await expect
        .poll(async () => {
          const source = await getAction(request, "read-source-file", {
            designId: recipeDesignId,
            path: "index.html",
          });
          sourceContent = source.content;
          return sourceContent.match(/@keyframes\s+an-motion-/g)?.length ?? 0;
        })
        .toBe(expectedTrackCount + Number(manualPosition));
      expect(sourceContent).toContain("<style data-agent-native-motion>");
      for (const track of tracks ?? []) {
        expect(sourceContent).toContain(`--track-${track.id}`);
      }
      if (manualPosition) {
        expect(sourceContent).toContain("--track-native-style-0-0");
      }

      await currentTime.fill("300");
      await currentTime.press("Tab");
      const renderedOpacity = await designFrame(page, file.id)
        .locator(`[data-agent-native-node-id="${targetId}"]`)
        .evaluate((element) => getComputedStyle(element).opacity);
      if (recipeId === "enter.recipe-01") {
        expect(Number(renderedOpacity)).toBe(1);
      } else {
        expect(Number(renderedOpacity)).toBeGreaterThan(0.5);
        expect(Number(renderedOpacity)).toBeLessThan(1);
      }
      await captureReferenceState(
        page,
        `motion-recipe-repeat-${recipeId.replace(".", "-")}${manualPosition ? "-with-manual-position" : ""}-at-300ms`,
      );

      const firstTrack = tracks?.[0];
      if (!firstTrack) throw new Error("The repeated recipe has no tracks");
      await dock
        .locator(
          `[data-motion-property-row][data-motion-track-id="${firstTrack.id}"]`,
        )
        .click();
      await dock
        .getByRole("button", { name: "Edit animation", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Start time in ms" }),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Duration in ms" }),
      ).toBeVisible();
      await captureReferenceState(
        page,
        `motion-track-editor-${recipeId.replace(".", "-")}${manualPosition ? "-with-manual-position" : ""}`,
      );

      await gotoEditor(page, recipeDesignId);
      await selectByText(page, "Reference Rectangle", {
        screenId: file.id,
        clearPreviousSelection: true,
        deep: false,
      });
      await page
        .getByRole("button", { name: "Motion dock", exact: true })
        .click();
      const restoredDock = page
        .getByRole("region", { name: "Motion dock" })
        .first();
      await expect(restoredDock.locator("[data-motion-track-row]")).toHaveCount(
        expectedTrackCount,
      );
      if (manualPosition) {
        await expect(
          restoredDock.locator('[data-motion-native-style-row="Position"]'),
        ).toHaveCount(1);
      }
      const restoredTimeline = await getAction(request, "get-motion-timeline", {
        designId: recipeDesignId,
        sourceRef: file.id,
      });
      expect(
        restoredTimeline.timelines?.[0]?.tracks?.filter(
          (track: { targetNodeId: string }) => track.targetNodeId === targetId,
        ),
      ).toHaveLength(expectedTrackCount);
    } finally {
      if (recipeDesignId) {
        await postAction(request, "delete-design", { id: recipeDesignId });
      }
    }
  });
}

test("applies recipe content past the timeline duration at its limit", async ({
  page,
  request,
}) => {
  let recipeDesignId: string | undefined;
  try {
    const created = await postAction(request, "create-design", {
      title: "Motion recipe content past timeline duration",
      projectType: "prototype",
    });
    recipeDesignId = created?.id ?? created?.data?.id ?? created?.design?.id;
    if (!recipeDesignId) {
      throw new Error("create-design did not return an id");
    }
    const file = await postAction(request, "create-file", {
      designId: recipeDesignId,
      filename: "index.html",
      content: REFERENCE_FIXTURE_HTML,
      fileType: "html",
    });
    if (!file.id) throw new Error("create-file did not return a file id");
    await postAction(request, "index-components", { designId: recipeDesignId });

    await page.setViewportSize({ width: 1728, height: 941 });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await gotoEditor(page, recipeDesignId);
    await selectByText(page, "Reference Rectangle", {
      screenId: file.id,
      clearPreviousSelection: true,
      deep: false,
    });
    await zoomCanvasTo100(page);
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();

    const dock = page.getByRole("region", { name: "Motion dock" }).first();
    const duration = dock.getByRole("textbox", {
      name: "Duration",
      exact: true,
    });
    await duration.fill("120000");
    await duration.press("Tab");
    await expect(duration).toHaveValue("120000");

    const currentTime = dock.getByRole("textbox", {
      name: "Current time",
      exact: true,
    });
    await currentTime.fill("120000");
    await currentTime.press("Tab");
    await expect(currentTime).toHaveValue("120000");

    const recipe = MOTION_BUILT_IN_RECIPES.find(
      (entry) => entry.id === "enter.recipe-01",
    );
    if (!recipe) throw new Error("The Burst Fast recipe is missing");
    await page.getByRole("button", { name: "Animations", exact: true }).click();
    const recipeRow = page.locator(`[data-motion-recipe-id="${recipe.id}"]`);
    await expect(recipeRow).toBeVisible();
    await recipeRow.click();
    await expect(dock.locator("[data-motion-track-row]")).toHaveCount(4);
    await expect(duration).toHaveValue("120000");
    await expect(currentTime).toHaveValue("120000");
    await expect(
      dock.locator("[data-motion-timeline-duration-handle]"),
    ).toHaveAttribute("aria-valuenow", "120000");
    const motionSpans = await dock
      .locator('[role="slider"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-valuetext")),
      );
    expect(motionSpans).toContain("120000ms – 120300ms");

    await expect
      .poll(async () => {
        const timeline = await getAction(request, "get-motion-timeline", {
          designId: recipeDesignId,
          sourceRef: file.id,
        });
        return timeline.timelines?.[0]?.tracks?.length ?? 0;
      })
      .toBe(4);
    const timeline = await getAction(request, "get-motion-timeline", {
      designId: recipeDesignId,
      sourceRef: file.id,
    });
    expect(timeline.timelines?.[0]?.durationMs).toBe(120_000);
    expect(timeline.timelines?.[0]?.tracks).toHaveLength(4);
    expect(
      timeline.timelines?.[0]?.tracks?.map(
        (track: { delayMs?: number; durationMs?: number }) => [
          track.delayMs,
          track.durationMs,
        ],
      ),
    ).toEqual([
      [120_000, 300],
      [120_000, 300],
      [120_000, 300],
      [120_000, 30],
    ]);

    const source = await getAction(request, "read-source-file", {
      designId: recipeDesignId,
      path: "index.html",
    });
    expect(source.content).toContain("<style data-agent-native-motion>");
    expect(source.content).toContain("agent-native-motion-source:v6:");
    expect(source.content).toContain("animation-delay: 120s");
    expect(source.content).toContain(
      "animation-duration: 0.03s, 0.3s, 0.3s, 0.3s",
    );
    await captureReferenceState(page, "motion-recipe-content-overrun");

    await gotoEditor(page, recipeDesignId);
    await selectByText(page, "Reference Rectangle", {
      screenId: file.id,
      clearPreviousSelection: true,
      deep: false,
    });
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();
    const restoredDock = page
      .getByRole("region", { name: "Motion dock" })
      .first();
    await expect(restoredDock.locator("[data-motion-track-row]")).toHaveCount(
      4,
    );
    await expect(
      restoredDock.getByRole("textbox", { name: "Duration", exact: true }),
    ).toHaveValue("120000");

    const restoredCurrentTime = restoredDock.getByRole("textbox", {
      name: "Current time",
      exact: true,
    });
    await restoredCurrentTime.fill("120000");
    await restoredCurrentTime.press("Tab");
    await page.getByRole("button", { name: "Animations", exact: true }).click();
    const partiallyFittingRecipe = page.locator(
      '[data-motion-recipe-id="enter.recipe-04"]',
    );
    await expect(partiallyFittingRecipe).toBeVisible();
    await partiallyFittingRecipe.click();
    await expect(restoredDock.locator("[data-motion-track-row]")).toHaveCount(
      4,
    );
    await expect(
      page.getByText(
        "There isn't enough room to add this animation at the current time.",
      ),
    ).toBeVisible();
  } finally {
    if (recipeDesignId) {
      await postAction(request, "delete-design", { id: recipeDesignId });
    }
  }
});

test("applying a composite recipe preserves an existing unrelated native style", async ({
  page,
  request,
}) => {
  let recipeDesignId: string | undefined;
  try {
    const created = await postAction(request, "create-design", {
      title: "Motion recipe preserves native style",
      projectType: "prototype",
    });
    recipeDesignId = created?.id ?? created?.data?.id ?? created?.design?.id;
    if (!recipeDesignId) {
      throw new Error("create-design did not return an id");
    }
    const file = await postAction(request, "create-file", {
      designId: recipeDesignId,
      filename: "index.html",
      content: REFERENCE_FIXTURE_HTML,
      fileType: "html",
    });
    if (!file.id) throw new Error("create-file did not return a file id");
    await postAction(request, "index-components", { designId: recipeDesignId });

    await page.setViewportSize({ width: 1728, height: 941 });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await gotoEditor(page, recipeDesignId);
    await selectByText(page, "Reference Rectangle", {
      screenId: file.id,
      clearPreviousSelection: true,
      deep: false,
    });

    const addAnimation = page
      .getByRole("button", { name: "Add animation", exact: true })
      .first();
    const sizeApplied = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await addAnimation.click();
    await page.getByRole("menuitem", { name: "Size", exact: true }).click();
    const sizeResponse = await sizeApplied;
    expect(sizeResponse.ok(), await sizeResponse.text()).toBe(true);

    const recipe = MOTION_BUILT_IN_RECIPES.find(
      (entry) => entry.id === "enter.recipe-11",
    );
    if (!recipe) throw new Error("The sampled Rise recipe is missing");
    await page.getByRole("button", { name: "Animations", exact: true }).click();
    const recipeRow = page.locator(`[data-motion-recipe-id="${recipe.id}"]`);
    await expect(recipeRow).toBeVisible();
    const recipeApplied = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await recipeRow.click();
    const recipeResponse = await recipeApplied;
    expect(recipeResponse.ok(), await recipeResponse.text()).toBe(true);
    expect(await recipeResponse.json()).toMatchObject({ persisted: true });
    await captureReferenceState(page, "motion-recipe-preserves-size-style");

    const timeline = await getAction(request, "get-motion-timeline", {
      designId: recipeDesignId,
      sourceRef: file.id,
    });
    const targetId = "e2e-motion-reference-rectangle";
    expect(timeline.timelines?.[0]?.nativeStyles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ styleKey: "Size", targetNodeId: targetId }),
      ]),
    );
    const recipeTracks = timeline.timelines?.[0]?.tracks?.filter(
      (track: { targetNodeId: string }) => track.targetNodeId === targetId,
    );
    expect(recipeTracks).toHaveLength(recipe.tracks.length);
    expect(
      recipeTracks?.map((track: { property: string }) => track.property),
    ).toEqual(recipe.tracks.map((track) => track.property));
  } finally {
    if (recipeDesignId) {
      if (!page.isClosed()) await page.close();
      await postAction(request, "delete-design", { id: recipeDesignId });
    }
  }
});

test("keyboard-applies a searched recipe and saves its source-backed tracks", async ({
  page,
  request,
}) => {
  let recipeDesignId: string | undefined;
  try {
    const created = await postAction(request, "create-design", {
      title: "Keyboard Motion recipe application",
      projectType: "prototype",
    });
    recipeDesignId = created?.id ?? created?.data?.id ?? created?.design?.id;
    if (!recipeDesignId) {
      throw new Error("create-design did not return an id");
    }
    const file = await postAction(request, "create-file", {
      designId: recipeDesignId,
      filename: "index.html",
      content: REFERENCE_FIXTURE_HTML,
      fileType: "html",
    });
    if (!file.id) throw new Error("create-file did not return a file id");
    await postAction(request, "index-components", { designId: recipeDesignId });

    await page.setViewportSize({ width: 1728, height: 941 });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await gotoEditor(page, recipeDesignId);
    await selectByText(page, "Reference Rectangle", {
      screenId: file.id,
      clearPreviousSelection: true,
      deep: false,
    });

    const recipe = MOTION_BUILT_IN_RECIPES.find(
      (entry) => entry.id === "enter.recipe-01",
    );
    if (!recipe) throw new Error("The keyboard recipe is missing");
    await page.getByRole("button", { name: "Animations", exact: true }).click();

    const gallery = page.locator("[data-radix-popper-content-wrapper]").filter({
      has: page.getByRole("button", { name: "Close", exact: true }),
    });
    const search = gallery.getByRole("textbox", {
      name: "Search animation styles",
      exact: true,
    });
    const categoryFilter = gallery.getByRole("combobox").first();
    const recipeRow = gallery.locator(
      '[data-motion-recipe-id="enter.recipe-01"]',
    );

    await expect(search).toBeFocused();
    await search.fill("Builder Arrival 01");
    await expect(recipeRow).toBeVisible();
    await expect(gallery.locator("[data-motion-recipe-id]")).toHaveCount(1);

    await page.keyboard.press("Tab");
    await expect(categoryFilter).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(recipeRow).toBeFocused();

    const applied = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.keyboard.press("Enter");
    const appliedResponse = await applied;
    expect(appliedResponse.ok(), await appliedResponse.text()).toBe(true);
    expect(await appliedResponse.json()).toMatchObject({ persisted: true });

    const timeline = await getAction(request, "get-motion-timeline", {
      designId: recipeDesignId,
      sourceRef: file.id,
    });
    const tracks = timeline.timelines?.[0]?.tracks?.filter(
      (track: { targetNodeId: string }) =>
        track.targetNodeId === "e2e-motion-reference-rectangle",
    );
    expect(tracks).toHaveLength(recipe.tracks.length);
    expect(
      tracks?.map(
        (track: {
          property: string;
          delayMs?: number;
          durationMs: number;
          keyframes: Array<{ t: number; value: string; ease?: string }>;
        }) => ({
          property: track.property,
          delayMs: track.delayMs ?? 0,
          durationMs: track.durationMs,
          keyframes: track.keyframes.map((keyframe) => ({
            t: keyframe.t,
            value: keyframe.value,
            ease: keyframe.ease ?? "linear",
          })),
        }),
      ),
    ).toEqual(
      recipe.tracks.map((track) => ({
        property: track.property,
        delayMs: track.delayMs,
        durationMs: track.durationMs,
        keyframes: track.keyframes.map((keyframe, index) => ({
          t: keyframe.t,
          value: keyframe.value,
          ease: index === 0 ? track.easing : "ease",
        })),
      })),
    );
    await captureReferenceState(page, "motion-keyboard-recipe-applied");
  } finally {
    if (recipeDesignId) {
      if (!page.isClosed()) await page.close();
      await postAction(request, "delete-design", { id: recipeDesignId });
    }
  }
});

test("saving imported inline CSS moves its animation into managed source", async ({
  request,
}) => {
  let importedDesignId: string | undefined;
  try {
    const created = await postAction(request, "create-design", {
      title: "Motion CSS import round trip",
      projectType: "prototype",
    });
    importedDesignId = created?.id ?? created?.data?.id ?? created?.design?.id;
    if (!importedDesignId) {
      throw new Error("create-design did not return an id");
    }

    const authoredSource = `<!doctype html>
<html><head><style>
.hero {
  animation-name: hero-fade;
  animation-duration: 900ms;
  animation-timing-function: ease-in;
  animation-fill-mode: both;
}
@keyframes hero-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style></head>
<body><div id="hero" class="hero" data-agent-native-node-id="motion-css-import-target">Hero</div></body></html>`;
    const file = await postAction(request, "create-file", {
      designId: importedDesignId,
      filename: "index.html",
      content: authoredSource,
      fileType: "html",
    });
    if (!file.id) throw new Error("create-file did not return an id");

    const imported = await getAction(request, "get-motion-timeline", {
      designId: importedDesignId,
      sourceRef: file.id,
    });
    expect(imported.timelines).toHaveLength(1);
    expect(imported.timelines[0]).toMatchObject({
      durationMs: 900,
      tracks: [
        {
          targetNodeId: "motion-css-import-target",
          property: "opacity",
          keyframes: [
            { t: 0, value: "0", ease: "ease-in" },
            { t: 1, value: "1", ease: "ease" },
          ],
        },
      ],
    });

    const saved = await postAction(request, "apply-motion-edit", {
      designId: importedDesignId,
      fileId: file.id,
      sourceRef: file.id,
      tracks: imported.timelines[0].tracks,
      durationMs: imported.timelines[0].durationMs,
      playbackMode: imported.timelines[0].playbackMode,
      defaultEase: imported.timelines[0].defaultEase,
      includeContent: true,
    });
    expect(saved).toMatchObject({ persisted: true, contentPatched: true });
    expect(saved.patchedContent).toContain("data-agent-native-motion");
    expect(saved.patchedContent).not.toContain("animation-name: hero-fade");
    expect(saved.patchedContent).toContain("@keyframes hero-fade");

    const reread = await getAction(request, "get-motion-timeline", {
      designId: importedDesignId,
      sourceRef: file.id,
    });
    expect(reread.timelines).toHaveLength(1);
    expect(reread.timelines[0]).toMatchObject({
      durationMs: 900,
      tracks: imported.timelines[0].tracks,
    });
  } finally {
    if (importedDesignId) {
      await postAction(request, "delete-design", { id: importedDesignId });
    }
  }
});

test("adding a Position style beside a curved path is refused instead of left unsaveable", async ({
  page,
  request,
}) => {
  let curvedDesignId: string | undefined;
  try {
    const created = await postAction(request, "create-design", {
      title: "Curved Position path",
      projectType: "prototype",
    });
    curvedDesignId = created?.id ?? created?.data?.id ?? created?.design?.id;
    if (!curvedDesignId) throw new Error("create-design did not return an id");
    const file = await postAction(request, "create-file", {
      designId: curvedDesignId,
      filename: "index.html",
      content: REFERENCE_FIXTURE_HTML,
      fileType: "html",
    });
    if (!file.id) throw new Error("create-file did not return a file id");
    const seeded = await postAction(request, "apply-motion-edit", {
      designId: curvedDesignId,
      fileId: file.id,
      sourceRef: file.id,
      durationMs: 1000,
      tracks: [
        {
          targetNodeId: "e2e-motion-reference-rectangle",
          property: "translate",
          keyframes: [
            {
              t: 0,
              value: "0px 0px",
              motionPath: {
                version: 1,
                type: "cubic",
                control1: { x: 40, y: -60 },
                control2: { x: -40, y: -60 },
              },
            },
            { t: 1, value: "200px 0px" },
          ],
        },
      ],
    });
    expect(seeded).toMatchObject({ persisted: true });

    await page.setViewportSize({ width: 1728, height: 941 });
    await gotoEditor(page, curvedDesignId);
    await selectByText(page, "Reference Rectangle", {
      screenId: file.id,
      clearPreviousSelection: true,
      deep: false,
    });
    await page
      .getByRole("button", { name: "Add animation", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Position", exact: true }).click();

    await expect(
      page.getByText(
        "This layer already has a Position animation that can't be combined with another one.",
      ),
    ).toBeVisible();
    await expect(
      page.locator('[data-motion-native-style-row="Position"]'),
    ).toHaveCount(0);
  } finally {
    if (curvedDesignId) {
      await postAction(request, "delete-design", { id: curvedDesignId });
    }
  }
});
