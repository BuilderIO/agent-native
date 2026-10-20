import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { MOTION_NATIVE_STYLE_INSTANCE_TYPE } from "../shared/motion-native-style";
import { injectMotionTextRuntime } from "../shared/motion-text-code";
import type { MotionTextDocument } from "../shared/motion-text-code";
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
    title: "Motion Native Style",
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

test("native style states persist with the Motion inspector and timeline", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1728, height: 941 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await gotoEditor(page, designId);
  await selectByText(page, "Motion Rectangle", {
    screenId: fileId,
    deep: false,
  });
  await captureMotionState(page, "motion-native-style-before-selection");

  const launchMotion = page.getByRole("button", {
    name: "Motion dock",
    exact: true,
  });
  await expect(launchMotion).toBeVisible();
  await launchMotion.click();
  const dock = page.getByRole("region", { name: "Motion dock" }).first();
  await expect(dock).toBeVisible();

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
  await captureMotionState(page, "motion-native-style-add-menu");
  await page.getByRole("menuitem", { name: "Position", exact: true }).click();
  const appliedResponse = await applied;
  expect(appliedResponse.ok(), await appliedResponse.text()).toBe(true);
  expect(await appliedResponse.json()).toMatchObject({ persisted: true });

  await page.getByRole("tab", { name: "List", exact: true }).click();
  const nativeStyleInspector = page.locator(
    '[data-design-inspector-section][aria-label="Animations"]',
  );
  await expect(
    nativeStyleInspector.getByRole("button", { name: "Position", exact: true }),
  ).toBeVisible();
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
  await captureMotionState(page, "motion-native-style-auto-keyframe");
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
        type: MOTION_NATIVE_STYLE_INSTANCE_TYPE,
        styleKey: "Position",
        targetNodeId: "e2e-motion-style-rectangle",
      }),
    ]),
  );

  await captureMotionState(page, "motion-native-style-position");

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
  await captureMotionState(page, "motion-native-style-add-menu");
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
  const originMarker = designFrame(page, fileId).locator(
    "[data-motion-origin-marker]",
  );
  await expect(originMarker).toBeVisible();
  const originProxy = page.locator("[data-motion-origin-proxy]");
  await expect(originProxy).toBeVisible();
  await captureMotionState(page, "motion-native-style-origin");

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
  const overlap = page.getByRole("spinbutton", { name: "Overlap" });
  const decimalOverlapSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await overlap.fill("50.5");
  const decimalOverlapResponse = await decimalOverlapSave;
  expect(decimalOverlapResponse.ok(), await decimalOverlapResponse.text()).toBe(
    true,
  );
  await expect(overlap).toHaveValue("50.5");
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
              props: expect.objectContaining({ presetStaggerOverlap: 50.5 }),
            }),
          ]),
        },
      ],
    });
  await captureMotionState(page, "motion-text-stagger-overlap-decimal");

  const steppedOverlapSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await overlap.press("ArrowUp");
  const steppedOverlapResponse = await steppedOverlapSave;
  expect(steppedOverlapResponse.ok(), await steppedOverlapResponse.text()).toBe(
    true,
  );
  await expect(overlap).toHaveValue("51.5");
  await captureMotionState(page, "motion-text-stagger-overlap-keyboard-step");

  const restoredOverlapSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await overlap.fill("50");
  const restoredOverlapResponse = await restoredOverlapSave;
  expect(
    restoredOverlapResponse.ok(),
    await restoredOverlapResponse.text(),
  ).toBe(true);
  await expect(overlap).toHaveValue("50");
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

  const grouping = page.getByRole("combobox", {
    name: "Each",
    exact: true,
  });
  await grouping.click();
  const wordGrouping = page.getByRole("option", {
    name: "Word",
    exact: true,
  });
  await expect(wordGrouping).toBeVisible();
  const selectWordSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await wordGrouping.click();
  const selectWordResponse = await selectWordSave;
  expect(selectWordResponse.ok(), await selectWordResponse.text()).toBe(true);
  await expect(ignoreSpaces).toHaveCount(0);
  await captureMotionState(
    page,
    "motion-text-stagger-word-ignore-spaces-reset",
  );
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
                textDelayGrouping: "WORD",
                ignoreSpaces: false,
                textDelayTimingMode: "duration-fitted",
              }),
            }),
          ]),
        },
      ],
    });
  const sourceAfterWordGrouping = await getAction(request, "read-source-file", {
    designId,
    path: "index.html",
  });
  const encodedMotionSource = sourceAfterWordGrouping.content.match(
    /agent-native-motion-source:v6:([^\s*]+)/,
  )?.[1];
  expect(encodedMotionSource).toBeDefined();
  const decodedMotionSource = decodeURIComponent(encodedMotionSource!);
  expect(decodedMotionSource).toContain('"textDelayGrouping":"WORD"');
  expect(decodedMotionSource).toContain('"ignoreSpaces":false');

  await grouping.click();
  const characterGrouping = page.getByRole("option", {
    name: "Character",
    exact: true,
  });
  await expect(characterGrouping).toBeVisible();
  const selectCharacterSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await characterGrouping.click();
  const selectCharacterResponse = await selectCharacterSave;
  expect(
    selectCharacterResponse.ok(),
    await selectCharacterResponse.text(),
  ).toBe(true);
  await expect(ignoreSpaces).not.toBeChecked();
  await captureMotionState(
    page,
    "motion-text-stagger-character-ignore-spaces-reset",
  );
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
                textDelayGrouping: "CHARACTER",
                ignoreSpaces: false,
                textDelayTimingMode: "duration-fitted",
              }),
            }),
          ]),
        },
      ],
    });

  const expectedOrderOptions = [
    "Left to right",
    "Right to left",
    "Center out",
    "Random",
  ];
  for (const name of ["Character", "Word", "Line", "Paragraph"] as const) {
    const currentGrouping = await grouping.innerText();
    if (currentGrouping !== name) {
      await grouping.click();
      const option = page.getByRole("option", { name, exact: true });
      await expect(option).toBeVisible();
      const save = page.waitForResponse(
        (response) =>
          response.url().includes("/_agent-native/actions/apply-motion-edit") &&
          response.request().method() === "POST",
        { timeout: 20_000 },
      );
      await option.click();
      const response = await save;
      expect(response.ok(), await response.text()).toBe(true);
    }

    await expect(grouping).toHaveText(name);
    const ignoreSpacesControl = page.getByRole("checkbox", {
      name: "Ignore spaces",
    });
    if (name === "Character") {
      await expect(ignoreSpacesControl).toBeVisible();
    } else {
      await expect(ignoreSpacesControl).toHaveCount(0);
    }

    const order = page.getByRole("combobox", { name: "Order", exact: true });
    await order.click();
    await expect(page.getByRole("option")).toHaveText(expectedOrderOptions);
    await captureMotionState(
      page,
      `motion-text-stagger-order-menu-${name.toLowerCase()}`,
    );
    await page.keyboard.press("Escape");
  }

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
                textDelayGrouping: "PARAGRAPH",
                textDelayOrder: "LEFT_RIGHT",
              }),
            }),
          ]),
        },
      ],
    });

  await grouping.click();
  const restoreCharacter = page.getByRole("option", {
    name: "Character",
    exact: true,
  });
  await expect(restoreCharacter).toBeVisible();
  const restoreCharacterSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await restoreCharacter.click();
  const restoreCharacterResponse = await restoreCharacterSave;
  expect(
    restoreCharacterResponse.ok(),
    await restoreCharacterResponse.text(),
  ).toBe(true);

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
  const document: MotionTextDocument = {
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
  await expect(units).toHaveCount(3);
  await expect
    .poll(() =>
      units.evaluateAll(
        (elements) =>
          elements.filter((element) => element.getAnimations().length > 0)
            .length,
      ),
    )
    .toBe(3);
});

test("paragraph Text runs on a host with static inline markup", async ({
  page,
}) => {
  const document: MotionTextDocument = {
    version: 2,
    animations: [
      {
        targetNodeId: "rich-paragraph",
        unit: "paragraph",
        direction: "forward",
        staggerMs: 0,
        animationDirection: "in",
        order: "left-to-right",
        ignoreSpaces: true,
        property: "opacity",
        durationMs: 320,
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ],
  };
  const html = injectMotionTextRuntime(
    '<!doctype html><html><body><div id="rich-paragraph" data-agent-native-node-id="rich-paragraph"><strong>Title</strong></div></body></html>',
    document,
  );
  await page.setContent(html);

  const target = page.locator("#rich-paragraph");
  await expect(target).toHaveText("Title");
  await expect
    .poll(() => target.evaluate((element) => element.getAnimations().length))
    .toBe(1);
  const midpoint = await target.evaluate(async (element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error("Paragraph animation is missing");
    animation.pause();
    await animation.ready;
    animation.currentTime = 160;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    return {
      text: element.textContent,
      opacity: getComputedStyle(element).opacity,
    };
  });
  expect(midpoint.text).toBe("Title");
  expect(Number(midpoint.opacity)).toBeGreaterThan(0);
  expect(Number(midpoint.opacity)).toBeLessThan(1);
});

test("HTML Text preview extends the shared scrub span through fixed-stagger tails", async ({
  page,
}) => {
  const document: MotionTextDocument = {
    version: 2,
    animations: [
      {
        targetNodeId: "preview-title",
        unit: "character",
        direction: "forward",
        staggerMs: 1500,
        animationDirection: "in",
        order: "left-to-right",
        ignoreSpaces: true,
        delayMs: 250,
        property: "opacity",
        durationMs: 1000,
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ],
  };
  const html = injectMotionTextRuntime(
    '<!doctype html><html><head><script>window.__designMotionPreviewBridge = true;</script></head><body><h1 data-agent-native-node-id="preview-title">ABC</h1></body></html>',
    document,
  );
  await page.setContent(html);
  const units = page.locator("[data-agent-native-motion-text-unit]");
  await expect(units).toHaveCount(3);

  const previewSpan = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== "motion-preview-span") return;
          window.removeEventListener("message", onMessage);
          resolve(event.data.durationMs);
        };
        window.addEventListener("message", onMessage);
        window.postMessage({ type: "motion-preview-duration-request" }, "*");
      }),
  );
  expect(previewSpan).toBe(4250);

  await page.evaluate(
    (durationMs) =>
      new Promise<void>((resolve) => {
        window.postMessage({ type: "motion-preview", t: 1, durationMs }, "*");
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    previewSpan,
  );
  const progress = await units.evaluateAll((elements) =>
    elements.map((element) =>
      element
        .getAnimations()
        .map((animation) => animation.effect?.getComputedTiming().progress),
    ),
  );
  expect(progress).toEqual([[1], [1], [1]]);
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
