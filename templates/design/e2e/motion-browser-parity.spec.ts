import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { MOTION_CODE_METADATA_VERSION } from "../shared/motion-code";
import { motionNativeStylesToTracks } from "../shared/motion-native-style-runtime";
import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import {
  cdpScreenshot,
  designFrame,
  enableLab,
  gotoEditor,
  selectByText,
} from "./helpers";

let designId: string;
let fileId: string;
let baseURLForActions: string;
let restoreMotionLab: (() => Promise<void>) | null = null;

const MOTION_FIXTURE_HTML = FIXTURE_HTML.replace(
  '      <div style="display:flex;flex-direction:row;gap:16px">',
  `      <div data-agent-native-node-id="e2e-motion-layout" data-agent-native-layer-name="Motion Layout Frame" style="display:flex;gap:8px;padding:8px">
        <span>Motion Layout Frame</span>
      </div>
      <div style="display:flex;flex-direction:row;gap:16px">`,
);

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURLForActions}/_agent-native/actions/${actionName}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
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

async function captureMotionStep(
  page: import("@playwright/test").Page,
  stepId: string,
): Promise<void> {
  await page.waitForTimeout(300);
  const artifactDirectory = path.resolve(
    import.meta.dirname,
    "../../../.tmp/design-motion-parity",
  );
  await mkdir(artifactDirectory, { recursive: true });
  const state = await page
    .getByRole("region", { name: "Motion dock" })
    .first()
    .evaluate((dock) => {
      const rect = dock.getBoundingClientRect();
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const measuredShellRegions = Array.from(
        document.querySelectorAll<HTMLElement>(
          "nav, aside, main, [role=navigation], [role=complementary], [role=main], [data-design-chrome-region='left-shell'], [data-design-chrome-region='right-panel'], [data-design-chrome-region='top-bar']",
        ),
      ).map((element) => {
        const regionRect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          label:
            element.getAttribute("aria-label") ??
            element.getAttribute("aria-labelledby"),
          chromeRegion: element.getAttribute("data-design-chrome-region"),
          className:
            typeof element.className === "string" ? element.className : "",
          rect: {
            x: regionRect.x,
            y: regionRect.y,
            width: regionRect.width,
            height: regionRect.height,
          },
        };
      });
      return {
        text: (dock as HTMLElement).innerText,
        viewport,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        shellRegions: measuredShellRegions,
        spans: Array.from(
          dock.querySelectorAll<HTMLElement>('[role="slider"]'),
        ).map((element) => {
          const spanRect = element.getBoundingClientRect();
          const rowRect = element.parentElement?.getBoundingClientRect();
          return {
            label: element.getAttribute("aria-label"),
            startMs: element.getAttribute("aria-valuenow"),
            range: element.getAttribute("aria-valuetext"),
            rect: {
              x: spanRect.x,
              y: spanRect.y,
              width: spanRect.width,
              height: spanRect.height,
            },
            rowRect: rowRect
              ? {
                  x: rowRect.x,
                  y: rowRect.y,
                  width: rowRect.width,
                  height: rowRect.height,
                }
              : null,
          };
        }),
        controls: Array.from(
          dock.querySelectorAll<HTMLElement>(
            "button,input,[role=slider],[role=checkbox]",
          ),
        ).map((element) => ({
          role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
          label:
            element.getAttribute("aria-label") ??
            element.getAttribute("title") ??
            element.textContent?.trim() ??
            "",
          value:
            (element as HTMLInputElement).value ||
            element.getAttribute("aria-valuenow"),
          disabled:
            (element as HTMLButtonElement).disabled ||
            element.getAttribute("aria-disabled") === "true",
        })),
      };
    });
  await writeFile(
    path.join(artifactDirectory, `${stepId}.json`),
    `${JSON.stringify({ step_id: stepId, state }, null, 2)}\n`,
    "utf8",
  );
  await cdpScreenshot(page, path.join(artifactDirectory, `${stepId}.png`));
}

test.beforeAll(async ({ request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();

  const created = await postAction(request, "create-design", {
    title: "Motion Browser Parity",
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
  if (!designId) return;
  await postAction(request, "delete-design", { id: designId });
});

// fixme: fails on current main after the merge: Error: expect(received).toEqual(expected) // deep equality
test.fixme("Motion dock edits, saves, previews, and restores a CSS timeline", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1728, height: 941 });
  await gotoEditor(page, designId);
  await selectByText(page, "Alpha Button", { screenId: fileId });

  const launchMotion = page.getByRole("button", {
    name: "Motion dock",
    exact: true,
  });
  await expect(launchMotion).toBeVisible();
  await launchMotion.click();

  const dock = page.getByRole("region", { name: "Motion dock" }).first();
  const dockRegion = page.locator('[role="region"][aria-label="Motion dock"]');
  await expect(dock).toBeVisible();
  await expect(
    page.locator('[data-design-inspector-section] h3[aria-label="Animations"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Audio", exact: true }),
  ).toBeVisible();
  await expect(page.locator('button[aria-label="Add audio"]')).toBeVisible();
  await expect(page.locator("[data-motion-audio-timeline]")).toHaveCount(0);
  await expect(
    page.getByText("Pick a property to add the first track.", { exact: false }),
  ).toBeVisible();
  await captureMotionStep(page, "motion-01-empty-dock");

  const figmaComparableTimeline = await postAction(
    request,
    "apply-motion-edit",
    {
      designId,
      fileId,
      sourceRef: fileId,
      durationMs: 3601,
      playbackMode: "once",
      defaultEase: "ease",
      tracks: [
        {
          targetNodeId: "e2e-alpha-button",
          property: "translate",
          keyframes: [
            { t: 1200 / 3601, value: "0px 0px", ease: "linear" },
            {
              t: 1603 / 3601,
              value: "0px -20px",
              ease: "cubic-bezier(0, 0.9971093535, 1, 1)",
            },
            {
              t: 1999 / 3601,
              value: "0px 20px",
              ease: "cubic-bezier(1, 0, 1, 1)",
            },
            {
              t: 2398 / 3601,
              value: "0px -20px",
              ease: "cubic-bezier(0, 0.9971093535, 1, 1)",
            },
            {
              t: 2804 / 3601,
              value: "0px -20px",
              ease: "cubic-bezier(1, 0, 1, 1)",
            },
            {
              t: 3202 / 3601,
              value: "0px 20px",
              ease: "cubic-bezier(1, 0, 1, 1)",
            },
            {
              t: 1,
              value: "0px -20px",
              ease: "cubic-bezier(0, 0.9971093535, 1, 1)",
            },
          ],
        },
        {
          targetNodeId: "e2e-alpha-button",
          property: "scale",
          durationMs: 1000,
          keyframes: [
            {
              t: 0,
              value: "0.1",
              ease: "cubic-bezier(0.5, 0, 0.5, 1)",
            },
            { t: 1, value: "1" },
          ],
        },
      ],
    },
  );
  expect(figmaComparableTimeline.persisted).toBe(true);
  const importedFigmaMotion = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const importedTracks = importedFigmaMotion.timelines?.[0]?.tracks ?? [];
  const importedPosition = importedTracks.find(
    (track: { targetNodeId: string; property: string }) =>
      track.targetNodeId === "e2e-alpha-button" &&
      track.property === "translate",
  );
  expect(
    importedPosition?.keyframes.map(
      (keyframe: { t: number; value: string; ease?: string }) => [
        Math.round(keyframe.t * 3601),
        keyframe.value,
        keyframe.ease,
      ],
    ),
  ).toEqual([
    [1200, "0px 0px", "linear"],
    [1603, "0px -20px", "cubic-bezier(0, 0.9971093535, 1, 1)"],
    [1999, "0px 20px", "cubic-bezier(1, 0, 1, 1)"],
    [2398, "0px -20px", "cubic-bezier(0, 0.9971093535, 1, 1)"],
    [2804, "0px -20px", "cubic-bezier(1, 0, 1, 1)"],
    [3202, "0px 20px", "cubic-bezier(1, 0, 1, 1)"],
    [3601, "0px -20px", "cubic-bezier(0, 0.9971093535, 1, 1)"],
  ]);
  const importedScale = importedTracks.find(
    (track: { targetNodeId: string; property: string }) =>
      track.targetNodeId === "e2e-alpha-button" && track.property === "scale",
  );
  expect(
    importedScale?.keyframes.map(
      (keyframe: { t: number; value: string; ease?: string }) => [
        keyframe.t,
        keyframe.value,
        keyframe.ease,
      ],
    ),
  ).toEqual([
    [0, "0.1", "cubic-bezier(0.5, 0, 0.5, 1)"],
    [1, "1", undefined],
  ]);
  await gotoEditor(page, designId);
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  const referenceDock = page
    .getByRole("region", { name: "Motion dock" })
    .first();
  await expect(
    referenceDock.getByRole("textbox", { name: "Duration" }),
  ).toHaveValue("3601");
  const referencePlayhead = referenceDock.getByLabel("Current time");
  await referencePlayhead.fill("3601");
  await referencePlayhead.press("Tab");
  const referenceRows = referenceDock.locator("[data-motion-track-row]");
  await expect(referenceRows).toHaveCount(2);
  for (const timeMs of [1200, 1603, 1999, 2398, 2804, 3202, 3601]) {
    await expect(
      referenceRows.first().getByLabel(`Keyframe at ${timeMs}ms`),
    ).toBeVisible();
  }
  await expect(
    referenceRows.nth(1).getByLabel("Keyframe at 1000ms"),
  ).toBeVisible();
  await captureMotionStep(page, "motion-figma-comparable");

  const animationStyleTrigger = page.getByRole("button", {
    name: "Animations",
    exact: true,
  });
  await expect(animationStyleTrigger).toBeVisible();
  await animationStyleTrigger.click();
  const animationStyleBrowser = page.locator(
    'section[aria-label="Animations"]',
  );
  await expect(animationStyleBrowser).toBeVisible();
  await expect(
    animationStyleBrowser.getByRole("button", { name: "Position" }),
  ).toBeVisible();
  await expect(
    animationStyleBrowser.getByRole("button", { name: "Path" }),
  ).toBeDisabled();
  await captureMotionStep(page, "motion-animation-style-browser");

  const opacityPresetSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await animationStyleBrowser
    .getByRole("button", { name: "Opacity", exact: true })
    .click();
  const savedOpacityPreset = await opacityPresetSave;
  expect(savedOpacityPreset.ok(), await savedOpacityPreset.text()).toBe(true);

  await animationStyleBrowser
    .getByRole("button", { name: "Create style" })
    .click();
  const styleName = page.getByLabel("Name", { exact: true });
  const styleDescription = page.getByLabel("Description", { exact: true });
  await styleName.fill("E2E Opacity");
  await styleDescription.fill("Source-backed opacity motion");
  await page.getByRole("button", { name: "Add animation" }).last().click();
  await page.getByRole("menuitem", { name: "Opacity", exact: true }).click();
  await captureMotionStep(page, "motion-animation-style-create");

  const styleSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: "Save style", exact: true }).click();
  const savedStyleResponse = await styleSave;
  expect(savedStyleResponse.ok(), await savedStyleResponse.text()).toBe(true);
  const savedStyleTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  expect(savedStyleTimeline.timelines?.[0]?.animationStyles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "E2E Opacity",
        category: "basic",
        tracks: [expect.objectContaining({ property: "opacity" })],
      }),
    ]),
  );

  await animationStyleBrowser
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await selectByText(page, "Beta Button", { screenId: fileId });
  await page.getByRole("button", { name: "Animations", exact: true }).click();
  const savedStyleRow = page.getByRole("button", {
    name: /E2E Opacity Source-backed opacity motion/,
  });
  await expect(savedStyleRow).toBeVisible();
  const styleApply = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await savedStyleRow.click();
  const appliedStyleResponse = await styleApply;
  expect(appliedStyleResponse.ok(), await appliedStyleResponse.text()).toBe(
    true,
  );
  const appliedStyleTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  expect(
    appliedStyleTimeline.timelines?.[0]?.tracks?.some(
      (track: { targetNodeId: string; property: string }) =>
        track.targetNodeId === "e2e-beta-button" &&
        track.property === "opacity",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close" }).click();

  const savedReferenceTimeline = await getAction(
    request,
    "get-motion-timeline",
    { designId, sourceRef: fileId },
  );
  const referenceTimelineId = savedReferenceTimeline.timelines?.[0]?.id;
  if (!referenceTimelineId) {
    throw new Error("The Figma-comparable Motion timeline was not persisted.");
  }
  await postAction(request, "remove-motion-timeline", {
    designId,
    timelineId: referenceTimelineId,
    fileId,
  });
  await gotoEditor(page, designId);
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  await expect(
    page.getByText("Pick a property to add the first track.", { exact: false }),
  ).toBeVisible();

  const addMotion = page.getByRole("button", {
    name: "Add animation",
    exact: true,
  });
  const addTrack = async (label: string, addControl = addMotion.last()) => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() !== "OPTIONS",
      { timeout: 20_000 },
    );
    await addControl.click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    const response = await responsePromise;
    const responseText = await response.text();
    expect(response.ok(), responseText).toBe(true);
    const saved = JSON.parse(responseText) as { persisted?: boolean };
    expect(saved.persisted).toBe(true);
  };
  await addTrack(
    "Position",
    page.getByRole("button", { name: "Add animation", exact: true }).first(),
  );
  const nativeStyleInspector = page.locator(
    '[data-design-inspector-section][aria-label="Animations"]',
  );
  const positionStyleControl = nativeStyleInspector.getByRole("button", {
    name: "Position",
    exact: true,
  });
  await expect(positionStyleControl).toBeVisible();
  await positionStyleControl.click();
  const positionType = page.getByRole("combobox", {
    name: "Type",
    exact: true,
  });
  const positionDirection = page.getByRole("combobox", {
    name: "Direction",
    exact: true,
  });
  await expect(positionType).toHaveText("Slide in");
  await expect(positionDirection).toHaveText("To left");
  const positionTypeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST" &&
      /"type"\s*:\s*"slide_out"/.test(response.request().postData() ?? ""),
    { timeout: 20_000 },
  );
  await positionType.click();
  await page.getByRole("option", { name: "Slide out", exact: true }).click();
  const savedPositionType = await positionTypeSave;
  expect(savedPositionType.ok(), await savedPositionType.text()).toBe(true);
  expect(await savedPositionType.json()).toMatchObject({ persisted: true });
  const positionDirectionSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST" &&
      /"direction"\s*:\s*"right"/.test(response.request().postData() ?? ""),
    { timeout: 20_000 },
  );
  await positionDirection.click();
  await page.getByRole("option", { name: "To right", exact: true }).click();
  const savedPositionDirection = await positionDirectionSave;
  expect(savedPositionDirection.ok(), await savedPositionDirection.text()).toBe(
    true,
  );
  expect(await savedPositionDirection.json()).toMatchObject({
    persisted: true,
  });
  const distanceInput = page.getByRole("spinbutton", {
    name: "Distance",
    exact: true,
  });
  await expect(distanceInput).toHaveValue("200");
  const positionDistanceSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST" &&
      /"distance"\s*:\s*500/.test(response.request().postData() ?? ""),
    { timeout: 20_000 },
  );
  await distanceInput.fill("500");
  const savedPositionDistance = await positionDistanceSave;
  expect(savedPositionDistance.ok(), await savedPositionDistance.text()).toBe(
    true,
  );
  expect(await savedPositionDistance.json()).toMatchObject({ persisted: true });
  await expect(
    page.getByRole("button", { name: "Ease out", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dock.getByRole("button", { name: "Play once" })).toBeVisible();
  const loopModeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST" &&
      /"playbackMode"\s*:\s*"loop"/.test(response.request().postData() ?? ""),
    { timeout: 20_000 },
  );
  await dock.getByRole("button", { name: "Play once" }).click();
  const savedLoopMode = await loopModeSave;
  expect(savedLoopMode.ok(), await savedLoopMode.text()).toBe(true);
  const savedLoopModeBody = (await savedLoopMode.json()) as {
    playbackMode?: string;
    persisted?: boolean;
  };
  expect(savedLoopModeBody).toMatchObject({
    playbackMode: "loop",
    persisted: true,
  });
  const savedLoopTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  expect(savedLoopTimeline.timelines?.[0]?.playbackMode).toBe("loop");
  const positionSpan = dock.getByRole("slider", {
    name: "Position animation span",
  });
  const initialPositionSpan = await positionSpan.evaluate((element) => {
    const row = element.parentElement;
    const rowRect = row?.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      endMs: Number(
        element.getAttribute("aria-valuetext")?.match(/– (\d+)ms$/)?.[1],
      ),
      rowLeft: rowRect?.left ?? 0,
      rowWidth: rowRect?.width ?? 0,
      startMs: Number(element.getAttribute("aria-valuenow")),
      timelineDurationMs: Number(element.getAttribute("aria-valuemax")),
      x: rect.x,
      width: rect.width,
    };
  });
  expect(initialPositionSpan.endMs).toBe(1000);
  const targetPositionDurationMs = 901;
  const positionSpanEndHandle = positionSpan.locator(
    '[data-motion-native-style-span-handle="end"]',
  );
  const timelineViewport = dock.locator("[data-motion-timeline-viewport]");
  const durationViewportBounds = await timelineViewport.boundingBox();
  if (!durationViewportBounds)
    throw new Error("The timeline viewport is missing.");
  await timelineViewport.evaluate((element) => {
    element.scrollLeft = Math.min(
      64,
      element.scrollWidth - element.clientWidth,
    );
  });
  await expect
    .poll(() => timelineViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  const positionSpanEndHandleBox = await positionSpanEndHandle.boundingBox();
  if (!positionSpanEndHandleBox) {
    throw new Error("The Position duration handle is not rendered.");
  }
  expect(
    positionSpanEndHandleBox.x + positionSpanEndHandleBox.width / 2,
  ).toBeLessThan(durationViewportBounds.x + durationViewportBounds.width);
  const positionDurationSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST" &&
      /"duration"\s*:\s*0\.901(?:0*)?/.test(
        response.request().postData() ?? "",
      ),
    { timeout: 20_000 },
  );
  const durationDeltaX =
    ((targetPositionDurationMs - initialPositionSpan.endMs) /
      initialPositionSpan.timelineDurationMs) *
    initialPositionSpan.rowWidth;
  const handleCenterX =
    positionSpanEndHandleBox.x + positionSpanEndHandleBox.width / 2;
  const handleCenterY =
    positionSpanEndHandleBox.y + positionSpanEndHandleBox.height / 2;
  await page.mouse.move(handleCenterX, handleCenterY);
  await page.mouse.down();
  await page.mouse.move(handleCenterX + durationDeltaX, handleCenterY, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() => positionSpan.getAttribute("aria-valuetext"))
    .toBe("0ms – 901ms");
  const savedPositionDuration = await positionDurationSave;
  expect(savedPositionDuration.ok(), await savedPositionDuration.text()).toBe(
    true,
  );
  const positionDurationTimeline = await getAction(
    request,
    "get-motion-timeline",
    { designId, sourceRef: fileId },
  );
  expect(
    positionDurationTimeline.timelines?.[0]?.nativeStyles?.[0]?.duration,
  ).toBeCloseTo(0.901, 3);
  await positionStyleControl.click();
  await expect(positionType).toHaveText("Slide out");
  await expect(positionDirection).toHaveText("To right");
  await expect(distanceInput).toHaveValue("500");
  await expect(
    page.getByRole("spinbutton", { name: "Delay", exact: true }),
  ).toHaveValue("0");
  await expect(
    page.getByRole("spinbutton", { name: "Duration", exact: true }),
  ).toHaveValue("901");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect
    .poll(() =>
      dock.locator('button[aria-label^="Play "]').getAttribute("aria-label"),
    )
    .toBe("Play loop");
  const compareViewport = page.viewportSize();
  await page.setViewportSize({ width: 1728, height: 941 });
  await captureMotionStep(page, "motion-figma-reference-equivalent");
  if (compareViewport) await page.setViewportSize(compareViewport);
  const pingPongModeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST" &&
      /"playbackMode"\s*:\s*"ping-pong"/.test(
        response.request().postData() ?? "",
      ),
    { timeout: 20_000 },
  );
  await dock.getByRole("button", { name: "Play loop" }).click();
  const savedPingPongMode = await pingPongModeSave;
  expect(savedPingPongMode.ok(), await savedPingPongMode.text()).toBe(true);
  expect(await savedPingPongMode.json()).toMatchObject({
    playbackMode: "ping-pong",
    persisted: true,
  });
  await expect(
    dock.getByRole("button", { name: "Play ping-pong" }),
  ).toBeVisible();
  const onceModeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST" &&
      /"playbackMode"\s*:\s*"once"/.test(response.request().postData() ?? ""),
    { timeout: 20_000 },
  );
  await dock.getByRole("button", { name: "Play ping-pong" }).click();
  const savedOnceMode = await onceModeSave;
  expect(savedOnceMode.ok(), await savedOnceMode.text()).toBe(true);
  await expect(dock.getByRole("button", { name: "Play once" })).toBeVisible();
  await addTrack("Scale");
  await addTrack("Rotation");
  await addTrack("Size");
  await addTrack("Opacity");

  const primaryTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const primaryNativeStyles =
    primaryTimeline.timelines?.[0]?.nativeStyles ?? [];
  expect(primaryNativeStyles).toHaveLength(5);
  expect(primaryNativeStyles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        styleKey: "Position",
        targetNodeId: "e2e-alpha-button",
      }),
    ]),
  );
  const primaryRuntimeTracks = motionNativeStylesToTracks(primaryNativeStyles);
  expect(primaryRuntimeTracks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        targetNodeId: "e2e-alpha-button",
        property: "translate",
        durationMs: 901,
        keyframes: [
          { t: 0, value: "0px 0px", ease: "ease-out" },
          { t: 1, value: "500px 0px" },
        ],
      }),
    ]),
  );
  const primaryProperties = new Set(
    primaryRuntimeTracks.map((track) => track.property),
  );
  for (const property of [
    "translate",
    "scale",
    "rotate",
    "width",
    "height",
    "opacity",
  ]) {
    expect(primaryProperties.has(property), `missing ${property} track`).toBe(
      true,
    );
  }

  const layoutLayerButton = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name: "Motion Layout Frame", exact: true });
  await expect(layoutLayerButton).toBeVisible();
  await layoutLayerButton.click();
  await expect(layoutLayerButton.locator("xpath=../..")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const gapKeyframe = page.locator('button[data-motion-css-property="gap"]');
  await expect(gapKeyframe).toBeVisible();
  const gapKeyframeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await gapKeyframe.click();
  const savedGapKeyframe = await gapKeyframeSave;
  expect(savedGapKeyframe.ok(), await savedGapKeyframe.text()).toBe(true);

  const horizontalPaddingKeyframe = page.locator(
    'button[data-motion-css-properties="padding-left padding-right"]',
  );
  await expect(horizontalPaddingKeyframe).toBeVisible();
  const paddingKeyframeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await horizontalPaddingKeyframe.click();
  const savedPaddingKeyframe = await paddingKeyframeSave;
  expect(savedPaddingKeyframe.ok(), await savedPaddingKeyframe.text()).toBe(
    true,
  );
  const layoutTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const layoutProperties = new Set(
    layoutTimeline.timelines?.[0]?.tracks
      ?.filter(
        (track: { targetNodeId: string }) =>
          track.targetNodeId === "e2e-motion-layout",
      )
      .map((track: { property: string }) => track.property),
  );
  expect(layoutProperties.has("gap")).toBe(true);
  expect(layoutProperties.has("padding-left")).toBe(true);
  expect(layoutProperties.has("padding-right")).toBe(true);
  await selectByText(page, "Alpha Button", { screenId: fileId });

  const translateKeyframe = page
    .locator('button[data-motion-css-property="translate"]')
    .first();
  await expect(translateKeyframe).toBeVisible();
  const translateKeyframeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await translateKeyframe.click();
  const savedTranslateKeyframe = await translateKeyframeSave;
  expect(savedTranslateKeyframe.ok(), await savedTranslateKeyframe.text()).toBe(
    true,
  );
  const translateTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const alphaTranslateTrack = translateTimeline.timelines?.[0]?.tracks?.find(
    (track: { targetNodeId: string; property: string }) =>
      track.targetNodeId === "e2e-alpha-button" &&
      track.property === "translate",
  );
  expect(
    alphaTranslateTrack?.keyframes.map(
      (keyframe: { t: number; value: string }) => [keyframe.t, keyframe.value],
    ),
  ).toEqual([
    [0, "0px 0px"],
    [1, "0px 0px"],
  ]);

  const timeFormat = dock.getByRole("button", {
    name: "Change time format",
  });
  await expect(timeFormat).toHaveText("ms");
  await timeFormat.click();
  await expect(timeFormat).toHaveText("s");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2",
  );
  await timeFormat.click();
  await expect(timeFormat).toHaveText("ms");

  let previousMode = "once";
  for (const mode of ["loop", "ping-pong", "once"] as const) {
    const modeButton = dock.getByRole("button", {
      name: `Play ${previousMode}`,
    });
    const modeSave = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await modeButton.click();
    const savedMode = await modeSave;
    expect(savedMode.ok(), await savedMode.text()).toBe(true);
    await expect(
      dock.getByRole("button", { name: `Play ${mode}` }),
    ).toBeVisible();
    previousMode = mode;
  }

  await dock.evaluate((element) => (element as HTMLDivElement).focus());
  await page.keyboard.press("Space");
  await expect(
    dock.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect(
    dock.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();

  const collapseTracks = dock.getByRole("button", {
    name: "Collapse all tracks",
  });
  await collapseTracks.click();
  await expect(
    dock.locator('[data-motion-native-style-row="Position"]'),
  ).toHaveCount(0);
  await dock.getByRole("button", { name: "Expand all tracks" }).click();
  await expect(
    dock.locator('[data-motion-native-style-row="Position"]'),
  ).toBeVisible();

  const zoom = dock.getByRole("slider", { name: "Timeline zoom level" });
  const initialZoom = await zoom.getAttribute("aria-valuenow");
  await zoom.press("ArrowRight");
  await expect
    .poll(() => zoom.getAttribute("aria-valuenow"))
    .not.toBe(initialZoom);
  await zoom.press("ArrowLeft");
  await expect(zoom).toHaveAttribute("aria-valuenow", initialZoom ?? "");

  const timelineHeader = dock.locator("[data-motion-timeline-header]");
  const timelineHeaderBox = await timelineHeader.boundingBox();
  if (!timelineHeaderBox)
    throw new Error("The Motion timeline header is missing.");
  await page.mouse.move(
    timelineHeaderBox.x + timelineHeaderBox.width * 0.75,
    timelineHeaderBox.y + timelineHeaderBox.height / 2,
  );
  await page.keyboard.down("Control");
  for (let step = 0; step < 9; step += 1) {
    await page.mouse.wheel(0, -600);
  }
  await page.keyboard.up("Control");
  await expect(zoom).toHaveAttribute("aria-valuenow", "1");

  const beforeArrowPan = await timelineViewport.evaluate(
    (element) => element.scrollLeft,
  );
  await dock
    .getByRole("slider", { name: "Timeline scrubber" })
    .press("ArrowRight");
  await expect
    .poll(() => timelineViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(beforeArrowPan);

  const beforeSpacePan = await timelineViewport.evaluate(
    (element) => element.scrollLeft,
  );
  await dock.evaluate((element) => (element as HTMLDivElement).focus());
  await page.keyboard.down("Space");
  const panX = timelineHeaderBox.x + timelineHeaderBox.width / 2;
  const panY = timelineHeaderBox.y + timelineHeaderBox.height / 2;
  await page.mouse.move(panX, panY);
  await page.mouse.down();
  await page.mouse.move(panX - 32, panY, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect
    .poll(() => timelineViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(beforeSpacePan);

  await page.keyboard.down("Control");
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, 600);
  }
  await page.mouse.wheel(0, 250);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => Number(await zoom.getAttribute("aria-valuenow")))
    .toBeLessThan(1);

  const dockResizeHandle = dock.locator("[data-motion-dock-resize]");
  const dockResizeBox = await dockResizeHandle.boundingBox();
  if (!dockResizeBox)
    throw new Error("The Motion dock resize handle is missing.");
  const initialDockHeight = await dock.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const resizeX = dockResizeBox.x + dockResizeBox.width / 2;
  const resizeY = dockResizeBox.y + dockResizeBox.height / 2;
  await page.mouse.move(resizeX, resizeY);
  await page.mouse.down();
  await page.mouse.move(resizeX, resizeY - 40, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() =>
      dock.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(initialDockHeight + 30);
  const enlargedDockHeight = await dock.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await page.mouse.move(resizeX, resizeY - 40);
  await page.mouse.down();
  await page.mouse.move(resizeX, resizeY, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() =>
      dock.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeLessThan(enlargedDockHeight - 30);

  await dock.getByRole("button", { name: "Collapse motion dock" }).click();
  await expect(dockRegion).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  await expect(dockRegion).not.toHaveAttribute("aria-hidden", "true");

  await expect(
    dock.locator('[data-motion-select-layer][aria-label="Alpha Button"]'),
  ).toBeVisible();
  await expect(
    dock.locator('[data-motion-native-style-row="Position"]'),
  ).toBeVisible();
  await expect(
    dock.locator('[data-motion-native-style-row="Scale"]'),
  ).toBeVisible();
  await expect(dock.getByLabel("Keyframe at 0ms")).toHaveCount(4);
  await expect(dock.getByLabel("Keyframe at 2000ms")).toHaveCount(4);
  const timelineTrackRows = dock.locator("[data-motion-track-row]");
  await expect(timelineTrackRows).toHaveCount(4);
  const positionTimelineRow = timelineTrackRows.nth(3);

  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator("style[data-agent-native-motion]")
        .textContent(),
    )
    .toContain(`agent-native-motion-source:v${MOTION_CODE_METADATA_VERSION}`);

  const duration = dock.getByRole("textbox", { name: "Duration" });
  const durationSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await duration.fill("3601");
  await duration.press("Tab");
  const savedDuration = await durationSave;
  expect(savedDuration.ok(), await savedDuration.text()).toBe(true);

  const currentTime = dock.getByLabel("Current time");
  const positionTrack = dock.locator('[data-motion-property-row="translate"]');
  for (const timeMs of [1200, 1800, 2400, 3000, 3400]) {
    await currentTime.fill(String(timeMs));
    await currentTime.press("Tab");
    const keyframeSave = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/apply-motion-edit") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await positionTrack
      .getByRole("button", { name: "Add or remove keyframe" })
      .click();
    const savedKeyframe = await keyframeSave;
    expect(savedKeyframe.ok(), await savedKeyframe.text()).toBe(true);
    await expect(
      positionTimelineRow.getByLabel(`Keyframe at ${timeMs}ms`),
    ).toBeVisible();
  }

  const zeroKeyframe = positionTimelineRow.getByLabel("Keyframe at 0ms");
  const middleKeyframe = positionTimelineRow.getByLabel("Keyframe at 1200ms");
  await zeroKeyframe.click();
  await middleKeyframe.click({ modifiers: ["Shift"] });
  await expect(zeroKeyframe).toHaveAttribute("aria-pressed", "true");
  await expect(middleKeyframe).toHaveAttribute("aria-pressed", "true");
  await positionTimelineRow.click({ position: { x: 20, y: 5 } });
  await expect(zeroKeyframe).toHaveAttribute("aria-pressed", "false");

  const motionFrame = designFrame(page, fileId);
  const pathOverlay = motionFrame.locator("svg[data-motion-path-overlay]");
  await expect(pathOverlay).toBeVisible();
  await dock
    .locator(
      '[data-motion-native-style-row="Scale"] [data-motion-select-native-style]',
    )
    .click();
  await expect(pathOverlay).toBeVisible();
  await dock
    .locator(
      '[data-motion-native-style-row="Position"] [data-motion-select-native-style]',
    )
    .click();
  await expect(pathOverlay).toBeVisible();
  await expect(pathOverlay.locator("[data-motion-path-keyframe]")).toHaveCount(
    7,
  );
  await expect(
    pathOverlay.locator("[data-motion-path-easing-dot]"),
  ).toHaveCount(42);
  const motionStyle = motionFrame.locator("style[data-agent-native-motion]");
  const initialPathSource = (await motionStyle.textContent()) ?? "";
  expect(initialPathSource).not.toContain("offset-path: path(");

  const endpoint = pathOverlay.locator('[data-motion-path-keyframe="1"]');
  const endpointBox = await endpoint.boundingBox();
  if (!endpointBox)
    throw new Error("The final Position path keyframe is missing.");
  const endpointSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.mouse.move(
    endpointBox.x + endpointBox.width / 2,
    endpointBox.y + endpointBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    endpointBox.x + endpointBox.width / 2 + 18,
    endpointBox.y + endpointBox.height / 2 + 12,
    { steps: 5 },
  );
  await page.mouse.up();
  const savedEndpoint = await endpointSave;
  expect(savedEndpoint.ok(), await savedEndpoint.text()).toBe(true);
  const endpointTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const endpointTranslateTrack = endpointTimeline.timelines?.[0]?.tracks?.find(
    (track: { property: string }) => track.property === "translate",
  );
  expect(
    endpointTranslateTrack?.keyframes?.some(
      (keyframe: { motionPath?: unknown }) => keyframe.motionPath !== undefined,
    ),
  ).toBe(true);
  expect(endpointTranslateTrack?.keyframes?.at(-1)?.motionPath).toBeUndefined();
  await expect
    .poll(() => motionStyle.textContent())
    .not.toBe(initialPathSource);
  await expect
    .poll(() => motionStyle.textContent())
    .toContain("offset-path: path(");

  const control = pathOverlay.locator(
    '[data-motion-path-handle="control1"][data-motion-path-segment-start="0"]',
  );
  const controlBox = await control.boundingBox();
  if (!controlBox)
    throw new Error("The Position path curve handle is missing.");
  const endpointPathSource = (await motionStyle.textContent()) ?? "";
  const curveSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  const pathModifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(pathModifier);
  await page.mouse.move(
    controlBox.x + controlBox.width / 2,
    controlBox.y + controlBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    controlBox.x + controlBox.width / 2 + 16,
    controlBox.y + controlBox.height / 2 - 14,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.keyboard.up(pathModifier);
  const savedCurve = await curveSave;
  expect(savedCurve.ok(), await savedCurve.text()).toBe(true);
  await expect
    .poll(() => motionStyle.textContent())
    .not.toBe(endpointPathSource);

  await currentTime.fill("3601");
  await currentTime.press("Tab");
  await expect(
    positionTrack.getByRole("button", { name: "Previous keyframe" }),
  ).toBeEnabled();
  await positionTrack
    .getByRole("button", { name: "Previous keyframe" })
    .click();
  await expect(currentTime).toHaveValue("3400");
  await currentTime.fill("3601");
  await currentTime.press("Tab");
  await captureMotionStep(page, "motion-02-position-scale-saved");

  const positionKeyframes = positionTimelineRow.locator(
    "[data-motion-keyframe]",
  );
  const originalKeyframeCount = await positionKeyframes.count();
  const originalKeyframeLabels = await positionKeyframes
    .locator('[role="button"]')
    .evaluateAll((keyframes) =>
      keyframes.map((keyframe) => keyframe.getAttribute("aria-label")),
    );
  const positionRowBox = await positionTimelineRow.boundingBox();
  if (!positionRowBox) throw new Error("The Position timeline row is missing.");
  const addDoubleClickSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await positionTimelineRow.dblclick({
    position: { x: positionRowBox.width * 0.75, y: positionRowBox.height / 2 },
  });
  const savedDoubleClick = await addDoubleClickSave;
  expect(savedDoubleClick.ok(), await savedDoubleClick.text()).toBe(true);
  await expect
    .poll(() => positionKeyframes.count())
    .toBe(originalKeyframeCount + 1);

  const keyframeLabelsAfterInsert = await positionKeyframes
    .locator('[role="button"]')
    .evaluateAll((keyframes) =>
      keyframes.map((keyframe) => keyframe.getAttribute("aria-label")),
    );
  const insertedLabel = keyframeLabelsAfterInsert.find(
    (label) => label !== null && !originalKeyframeLabels.includes(label),
  );
  if (!insertedLabel) {
    throw new Error("The newly added Position keyframe is missing.");
  }
  const insertedKeyframe = positionTimelineRow.getByRole("button", {
    name: insertedLabel,
    exact: true,
  });
  await insertedKeyframe.click();
  await expect(insertedKeyframe).toHaveAttribute("aria-pressed", "true");
  const deleteKeyframeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await insertedKeyframe.press("Delete");
  const savedDelete = await deleteKeyframeSave;
  expect(savedDelete.ok(), await savedDelete.text()).toBe(true);
  await expect
    .poll(() => positionKeyframes.count())
    .toBe(originalKeyframeCount);

  const target = designFrame(page, fileId).locator(
    '[data-agent-native-node-id="e2e-alpha-button"]',
  );
  await currentTime.fill("0");
  await currentTime.press("Tab");
  const translateAtStart = await target.evaluate(
    (element) => getComputedStyle(element).translate,
  );
  await dock.getByRole("button", { name: "Play", exact: true }).click();
  await expect(currentTime).toHaveValue("3601", { timeout: 5_000 });
  await expect
    .poll(
      () => target.evaluate((element) => getComputedStyle(element).translate),
      { timeout: 5_000, intervals: [50, 100, 150, 250, 500] },
    )
    .not.toBe(translateAtStart);
  await expect(currentTime).toHaveValue("3601");
  await captureMotionStep(page, "motion-03-playback");

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator("style[data-agent-native-motion]")
        .count(),
    )
    .toBe(1);
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "3601",
  );
  await expect(
    positionTimelineRow.getByLabel("Keyframe at 3601ms"),
  ).toBeVisible();
  await expect(
    dock
      .locator('[data-motion-property-row="translate"]')
      .getByRole("button", { name: "Previous keyframe" }),
  ).toBeDisabled();
  await captureMotionStep(page, "motion-04-reopened");

  const keyframe = positionTimelineRow.getByLabel("Keyframe at 1200ms");
  await keyframe.scrollIntoViewIfNeeded();
  await expect(keyframe).toBeInViewport();
  const keyframeBox = await keyframe.boundingBox();
  const trackBox = await positionTimelineRow.boundingBox();
  if (!keyframeBox || !trackBox) {
    throw new Error("The Position keyframe track is not measurable.");
  }
  const keyframeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  const keyframeStartX = keyframeBox.x + keyframeBox.width / 2;
  const keyframeY = keyframeBox.y + keyframeBox.height / 2;
  await page.mouse.move(keyframeStartX, keyframeY);
  await page.mouse.down();
  await page.mouse.move(
    keyframeStartX + ((1500 - 1200) / 3601) * trackBox.width,
    keyframeY,
    { steps: 5 },
  );
  await page.mouse.up();
  const savedKeyframeMove = await keyframeSave;
  expect(savedKeyframeMove.ok(), await savedKeyframeMove.text()).toBe(true);
  await expect(
    positionTimelineRow.getByLabel("Keyframe at 1500ms"),
  ).toBeVisible();

  const easingSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  const segmentEasing = positionTimelineRow
    .getByRole("button", { name: /Segment easing:/ })
    .first();
  const segmentEasingLabel = await segmentEasing.getAttribute("aria-label");
  if (!segmentEasingLabel) {
    throw new Error("The timeline segment does not expose its easing label.");
  }
  await segmentEasing.click();
  await page
    .getByRole("button", {
      name: segmentEasingLabel.replace(/^Segment easing: /, ""),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Ease in", exact: true }).click();
  const savedEase = await easingSave;
  expect(savedEase.ok(), await savedEase.text()).toBe(true);
  await expect(
    positionTimelineRow
      .getByRole("button", { name: "Segment easing: Ease in" })
      .first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Ease in", exact: true }),
  ).toBeHidden();

  const layerSpan = dock.getByRole("slider", {
    name: "Alpha Button animation span",
  });
  const resizeHandle = layerSpan.locator('[data-motion-span-handle="end"]');
  await resizeHandle.scrollIntoViewIfNeeded();
  await expect(resizeHandle).toBeInViewport();
  const resizeBox = await resizeHandle.boundingBox();
  if (!resizeBox)
    throw new Error("The animation span resize handle is missing.");
  const resizeSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2 - 12,
    resizeBox.y + resizeBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  const savedResize = await resizeSave;
  expect(savedResize.ok(), await savedResize.text()).toBe(true);
  await expect
    .poll(async () => {
      const resizedRange = await layerSpan.getAttribute("aria-valuetext");
      return Number(resizedRange?.split("–")[1]?.replace(/\D/g, ""));
    })
    .toBeLessThan(3601);
  const resizedRange = await layerSpan.getAttribute("aria-valuetext");
  const resizedEnd = Number(resizedRange?.split("–")[1]?.replace(/\D/g, ""));
  expect(resizedEnd).toBeGreaterThan(3000);

  await layerSpan.scrollIntoViewIfNeeded();
  await expect(layerSpan).toBeInViewport();
  const spanBox = await layerSpan.boundingBox();
  if (!spanBox) throw new Error("The animation span is not measurable.");
  const timelineViewportBox = await dock
    .locator("[data-motion-timeline-viewport]")
    .boundingBox();
  if (!timelineViewportBox)
    throw new Error("The timeline viewport is not measurable.");
  const visibleLeft = Math.max(spanBox.x, timelineViewportBox.x);
  const visibleRight = Math.min(
    spanBox.x + spanBox.width,
    timelineViewportBox.x + timelineViewportBox.width,
  );
  if (visibleRight <= visibleLeft)
    throw new Error("The animation span is outside the visible timeline.");
  const spanDragX = (visibleLeft + visibleRight) / 2;
  const spanDragY = spanBox.y + spanBox.height / 2;
  const spanHitTarget = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[role="slider"]')
        ?.getAttribute("aria-label") ?? null,
    { x: spanDragX, y: spanDragY },
  );
  expect(spanHitTarget).toBe("Alpha Button animation span");
  const spanRangeBeforeMove = await layerSpan.getAttribute("aria-valuetext");
  const moveSave = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/apply-motion-edit") &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.mouse.move(spanDragX, spanDragY);
  await page.mouse.down();
  await page.mouse.move(spanDragX + 8, spanDragY, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => layerSpan.getAttribute("aria-valuetext"))
    .not.toBe(spanRangeBeforeMove);
  const savedSpanMove = await moveSave;
  expect(savedSpanMove.ok(), await savedSpanMove.text()).toBe(true);
  await expect
    .poll(async () => {
      const movedRange = await layerSpan.getAttribute("aria-valuetext");
      return Number(movedRange?.split("–")[0]?.replace(/\D/g, ""));
    })
    .toBeGreaterThan(0);
  const movedRange = await layerSpan.getAttribute("aria-valuetext");
  const movedStart = Number(movedRange?.split("–")[0]?.replace(/\D/g, ""));
  expect(movedStart).toBeGreaterThan(0);

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator("style[data-agent-native-motion]")
        .textContent(),
    )
    .toContain("cubic-bezier(0.42, 0, 1, 1)");
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  const restoredSpan = page.getByRole("slider", {
    name: "Alpha Button animation span",
  });
  const restoredRange = await restoredSpan.getAttribute("aria-valuetext");
  const restoredStart = Number(
    restoredRange?.split("–")[0]?.replace(/\D/g, ""),
  );
  expect(restoredStart).toBe(movedStart);
  await expect(
    positionTimelineRow
      .getByRole("button", { name: "Segment easing: Ease in" })
      .first(),
  ).toBeVisible();

  const restoredPath = motionFrame.locator("style[data-agent-native-motion]");
  await expect
    .poll(() => restoredPath.textContent())
    .toContain("offset-path: path(");
  const restoredTimeline = await getAction(request, "get-motion-timeline", {
    designId,
    sourceRef: fileId,
  });
  const translateTrack = restoredTimeline.timelines?.[0]?.tracks?.find(
    (track: { property: string }) => track.property === "translate",
  );
  expect(
    translateTrack?.keyframes?.some(
      (keyframe: { motionPath?: unknown }) => keyframe.motionPath !== undefined,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 700, height: 900 });
  const mobilePropertiesButton = page.getByRole("button", {
    name: "Properties",
    exact: true,
  });
  await expect(mobilePropertiesButton).toBeVisible();
  await mobilePropertiesButton.click();
  const mobileInspector = page.getByRole("dialog");
  await expect(mobileInspector).toBeVisible();
  await expect
    .poll(async () => {
      const box = await mobileInspector.boundingBox();
      return box ? box.x + box.width : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(700);
  await expect
    .poll(async () => {
      const [inspectorBox, dockBox] = await Promise.all([
        mobileInspector.boundingBox(),
        dock.boundingBox(),
      ]);
      return inspectorBox && dockBox
        ? inspectorBox.y + inspectorBox.height - dockBox.y
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(1);
  const [mobileInspectorBox, mobileDockBox] = await Promise.all([
    mobileInspector.boundingBox(),
    dock.boundingBox(),
  ]);
  if (!mobileInspectorBox || !mobileDockBox) {
    throw new Error("The mobile inspector or Motion dock is not measurable.");
  }
  await captureMotionStep(page, "motion-05-mobile-inspector");
  const pageWidths = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.getBoundingClientRect().width,
  }));
  expect(mobileInspectorBox.width).toBeLessThanOrEqual(360);
  expect(
    mobileInspectorBox.x + mobileInspectorBox.width,
    JSON.stringify(pageWidths),
  ).toBeLessThanOrEqual(pageWidths.innerWidth);
  expect(mobileInspectorBox.y + mobileInspectorBox.height).toBeLessThanOrEqual(
    mobileDockBox.y + 1,
  );
});
