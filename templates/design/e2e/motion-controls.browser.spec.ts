import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { MOTION_NATIVE_STYLE_INSTANCE_TYPE } from "../shared/motion-native-style";
import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import { designFrame, enableLab, gotoEditor, selectByText } from "./helpers";

let designId: string;
let fileId: string;
let baseURLForActions: string;
let restoreMotionLab: (() => Promise<void>) | null = null;

const MOTION_FIXTURE_HTML = FIXTURE_HTML.replace(
  '      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>',
  `      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>
      <script src="./alpinejs.js" defer></script>
      <main id="e2e-motion-text-alpine-root" x-data="{ visible: true }">
        <h2 id="e2e-motion-text-alpine" data-agent-native-node-id="e2e-motion-text-alpine">Alpine Motion Text</h2>
      </main>
      <div data-agent-native-node-id="e2e-motion-style-rectangle" data-agent-native-layer-name="Rectangle" style="width:100px;height:100px;padding:0;border:0;background:#7F0EFF;color:transparent;font-size:0;line-height:0">Motion Rectangle</div>
      <div data-agent-native-node-id="e2e-motion-style-rectangle-2" data-agent-native-layer-name="Rectangle 2" style="width:100px;height:100px;padding:0;border:0;background:#FF7A00;color:transparent;font-size:0;line-height:0">Motion Rectangle Two</div>`,
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

async function captureMotionState(
  page: import("@playwright/test").Page,
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

test.beforeAll(async ({ request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  const created = await postAction(request, "create-design", {
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
    title: "Motion Native Style",
========
    title: "Motion Controls",
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design did not return an id");
  const file = await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: MOTION_FIXTURE_HTML,
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

<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
test("native style states persist with the Motion inspector and timeline", async ({
========
test("Motion inspector states match the editable timeline", async ({
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
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
  await selectByText(page, "Motion Rectangle", {
    screenId: fileId,
    deep: false,
  });
  if ((await canvasZoom.innerText()).trim() !== "100%") {
    await canvasZoom.click();
    await page.getByRole("menuitem", { name: "Zoom to 100%" }).click();
  }
  await expect(canvasZoom).toHaveText(/100%/);
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
  await captureMotionState(page, "motion-native-style-before-selection");
========
  await captureReferenceState(page, "motion-controls-before-selection");
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts

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
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
  await captureMotionState(page, "motion-native-style-add-menu");
========
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
    return {
      menu: bounds(document.querySelector('[role="menu"]')),
      trigger: bounds(trigger ?? null),
    };
  });
  if (!menuGeometry.menu || !menuGeometry.trigger) {
    throw new Error("Motion menu geometry is unavailable");
  }
  expect(menuGeometry.menu.width).toBe(120);
  expect(menuGeometry.menu.height).toBe(136);
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
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
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
  await page.getByRole("button", { name: "Ease out", exact: true }).click();
  const easingPresetPanel = page.getByRole("tabpanel", {
    name: "Presets",
  });
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
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close", exact: true }).click();
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
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
  await captureMotionState(page, "motion-native-style-auto-keyframe");
========
  await captureReferenceState(page, "motion-controls-auto-keyframe");
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
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
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
        type: MOTION_NATIVE_STYLE_INSTANCE_TYPE,
========
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
        styleKey: "Position",
        targetNodeId: "e2e-motion-style-rectangle",
      }),
    ]),
  );

<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
  await captureMotionState(page, "motion-native-style-position");

========
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
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
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
  await captureMotionState(page, "motion-native-style-add-menu");
========
  await captureReferenceState(page, "motion-controls-add-menu");
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
  await page.keyboard.press("Escape");

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
  const originPopover = page.getByRole("dialog");
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
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
  await captureMotionState(page, "motion-native-style-origin");
========
  await captureReferenceState(page, "motion-controls-origin");
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts

  const motionRectangle = designFrame(page, fileId).locator(
    '[data-agent-native-node-id="e2e-motion-style-rectangle"]',
  );
  const initialTransformOrigin = await motionRectangle.evaluate(
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
        .locator('[data-agent-native-node-id="e2e-motion-style-rectangle"]')
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
<<<<<<<< HEAD:templates/design/e2e/motion-native-style.browser.spec.ts
  await expect(
    page.getByRole("menuitem", { name: "Text animation", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("menuitem")).toHaveCount(6);
  await captureMotionState(page, "motion-native-style-text-add-menu");
  const textStyleSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("menuitem", { name: "Text", exact: true }).click();
  const textStyleResponse = await textStyleSave;
  expect(textStyleResponse.ok(), await textStyleResponse.text()).toBe(true);
  const textStyleTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  expect(textStyleTimeline.timelines?.[0]?.nativeStyles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        styleKey: "TextStagger",
        targetNodeId: expect.any(String),
        duration: 0.5,
        props: expect.objectContaining({
          animationDirection: "in",
          textDelayGrouping: "CHARACTER",
          presetStaggerOverlap: 50,
          textDelayOrder: "LEFT_RIGHT",
          ignoreSpaces: false,
          delay: 0,
          easing: { type: "EASE_OUT" },
        }),
      }),
    ]),
  );
  const textStyleDetails = page.locator(
    '[aria-label="Animations"] li > button[aria-pressed="true"]',
  );
  await expect(textStyleDetails).toBeVisible();
  await textStyleDetails.click();
  await expect(
    page.getByRole("combobox", { name: "Direction", exact: true }),
  ).toHaveText("In");
  await expect(
    page.getByRole("combobox", { name: "Each", exact: true }),
  ).toHaveText("Character");
  await expect(page.getByRole("combobox", { name: "Order" })).toHaveText(
    "Left to right",
  );
  await expect(page.getByRole("spinbutton", { name: "Overlap" })).toHaveValue(
    "50",
  );
  await expect(
    page.getByRole("checkbox", { name: "Ignore spaces" }),
  ).not.toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "Delay" })).toHaveValue(
    "0",
  );
  await expect(page.getByRole("spinbutton", { name: "Duration" })).toHaveValue(
    "500",
  );
  const ignoreSpaces = page.getByRole("checkbox", { name: "Ignore spaces" });
  await expect(ignoreSpaces).not.toBeChecked();
  await captureMotionState(page, "motion-text-preset-defaults");

  const ignoreSpacesSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await ignoreSpaces.check();
  const ignoreSpacesResponse = await ignoreSpacesSave;
  expect(ignoreSpacesResponse.ok(), await ignoreSpacesResponse.text()).toBe(
    true,
  );
  await expect(ignoreSpaces).toBeChecked();
  await expect
    .poll(() =>
      getAction(request, "get-motion-timeline", {
        designId,
        sourceRef: fileId,
      }),
    )
    .toMatchObject({
      timelines: [
        {
          nativeStyles: expect.arrayContaining([
            expect.objectContaining({
              styleKey: "TextStagger",
              props: expect.objectContaining({
                ignoreSpaces: true,
                textDelayTimingMode: "duration-fitted",
              }),
            }),
          ]),
        },
      ],
    });
  const sourceWithIgnoreSpaces = await getAction(request, "read-source-file", {
    designId,
    path: "index.html",
  });
  expect(sourceWithIgnoreSpaces.content).toContain('"ignoreSpaces":true');

  const timelineBeforeLegacyEdit = await getAction(
    request,
    "get-motion-timeline",
    { designId, sourceRef: fileId },
  );
  const currentTimeline = timelineBeforeLegacyEdit.timelines?.[0];
  if (!currentTimeline) throw new Error("The Motion timeline was not saved.");
  let matchedTextStyle = false;
  const legacyNativeStyles = currentTimeline.nativeStyles.map(
    (style: Record<string, any>) => {
      if (style.styleKey !== "TextStagger" || matchedTextStyle) return style;
      matchedTextStyle = true;
      return {
        ...style,
        props: Object.fromEntries(
          Object.entries(style.props).filter(
            ([key]) => key !== "ignoreSpaces" && key !== "textDelayTimingMode",
          ),
        ),
      };
    },
  );
  expect(matchedTextStyle).toBe(true);
  const legacySave = await postAction(request, "apply-motion-edit", {
    designId,
    fileId,
    sourceRef: fileId,
    tracks: currentTimeline.tracks,
    nativeStyles: legacyNativeStyles,
    durationMs: currentTimeline.durationMs,
    playbackMode: currentTimeline.playbackMode,
    defaultEase: currentTimeline.defaultEase,
  });
  expect(legacySave.persisted).toBe(true);
  const persistedLegacyTimeline = await getAction(
    request,
    "get-motion-timeline",
    { designId, sourceRef: fileId },
  );
  const persistedLegacyStyle =
    persistedLegacyTimeline.timelines?.[0]?.nativeStyles?.find(
      (style: Record<string, any>) => style.styleKey === "TextStagger",
    );
  expect(persistedLegacyStyle).toBeDefined();
  expect(
    Object.prototype.hasOwnProperty.call(
      persistedLegacyStyle.props,
      "ignoreSpaces",
    ),
  ).toBe(false);
  expect(
    Object.prototype.hasOwnProperty.call(
      persistedLegacyStyle.props,
      "textDelayTimingMode",
    ),
  ).toBe(false);

  await gotoEditor(page, designId);
  await selectByText(page, "Second fixture paragraph for selection tests.", {
    screenId: fileId,
    clearPreviousSelection: true,
  });
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  await page.locator('[aria-label="Animations"] li > button').first().click();
  const legacyIgnoreSpaces = page.getByRole("checkbox", {
    name: "Ignore spaces",
  });
  await expect(legacyIgnoreSpaces).toBeChecked();
  await captureMotionState(page, "motion-native-style-legacy-ignore-spaces");

  const legacyIgnoreSpacesSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await legacyIgnoreSpaces.uncheck();
  const legacyIgnoreSpacesResponse = await legacyIgnoreSpacesSave;
  expect(
    legacyIgnoreSpacesResponse.ok(),
    await legacyIgnoreSpacesResponse.text(),
  ).toBe(true);
  await expect(legacyIgnoreSpaces).not.toBeChecked();
  await expect
    .poll(() =>
      getAction(request, "get-motion-timeline", {
        designId,
        sourceRef: fileId,
      }),
    )
    .toMatchObject({
      timelines: [
        {
          nativeStyles: expect.arrayContaining([
            expect.objectContaining({
              styleKey: "TextStagger",
              props: expect.objectContaining({
                ignoreSpaces: false,
                textDelayTimingMode: "fixed-stagger",
              }),
            }),
          ]),
        },
      ],
    });
});

test("HTML Text source round trips through Alpine markup and runs in a browser", async ({
  page,
  request,
}) => {
  const document = {
    version: 2,
    animations: [
      {
        targetNodeId: "e2e-motion-text-alpine",
        unit: "word",
        direction: "forward",
        staggerMs: 80,
        animationDirection: "in",
        order: "random",
        overlapPercent: 35,
        ignoreSpaces: false,
        property: "opacity",
        durationMs: 600,
        keyframes: [
          { t: 0, value: "0", ease: "ease-out" },
          { t: 1, value: "1" },
        ],
      },
    ],
  };
  const saved = await postAction(request, "apply-motion-edit", {
    designId,
    fileId,
    sourceRef: fileId,
    tracks: [],
    textDocument: document,
    durationMs: 600,
    playbackMode: "once",
    defaultEase: "ease-out",
  });
  expect(saved).toMatchObject({ persisted: true, sourceType: "inline" });

  const timeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  expect(timeline.timelines?.[0]).toMatchObject({ textDocument: document });
  const source = await getAction(request, "read-source-file", {
    designId,
    path: "index.html",
  });
  expect(source.content).toContain('x-data="{ visible: true }"');
  expect(source.content).toContain('data-agent-native-motion-text-source="v2"');
  expect(source.content).toContain(
    'data-agent-native-motion-text-runtime="v2"',
  );

  await page.setContent(source.content);
  const target = page.locator("#e2e-motion-text-alpine");
  await expect(target).toHaveText("Alpine Motion Text");
  await expect(page.locator("#e2e-motion-text-alpine-root")).toHaveAttribute(
    "x-data",
    "{ visible: true }",
  );
  const units = target.locator("[data-agent-native-motion-text-unit]");
  await expect(units).toHaveCount(5);
  await expect
    .poll(() =>
      units.evaluateAll(
        (elements) =>
          elements.filter((element) => element.getAnimations().length > 0)
            .length,
      ),
    )
    .toBe(5);
========
  await expect(page.getByRole("menuitem")).toHaveCount(5);
  await captureReferenceState(page, "motion-controls-text-add-menu");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More Motion", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Text Stagger", exact: true }),
  ).toBeVisible();
  await captureReferenceState(page, "motion-controls-text-menu");
>>>>>>>> origin/main:templates/design/e2e/motion-controls.browser.spec.ts
});

test("a new motion preset applies to every selected target", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1728, height: 941 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await gotoEditor(page, designId);
  await selectByText(page, "Motion Rectangle", {
    screenId: fileId,
    clearPreviousSelection: true,
    deep: false,
  });
  await selectByText(page, "Motion Rectangle Two", {
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
    "e2e-motion-style-rectangle",
    "e2e-motion-style-rectangle-2",
  ]);
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
