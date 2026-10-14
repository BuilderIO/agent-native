import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
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
    title: "Motion Figma Reference",
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

test("Figma reference states match Motion inspector and timeline structure", async ({
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
  await captureReferenceState(page, "motion-figma-reference-before-selection");

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
  await captureReferenceState(page, "motion-figma-reference-add-menu");
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
    "2010",
  );
  await durationHandle.press("ArrowLeft");
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2000",
  );
  await expect(
    dock.getByRole("slider", { name: "Position animation span" }),
  ).toHaveAttribute("aria-valuetext", "0ms – 1000ms");

  const autoKeyframe = dock.getByRole("checkbox", {
    name: "Toggle auto-keyframing",
  });
  await autoKeyframe.click();
  await expect(
    dock.locator("[data-motion-playhead][data-motion-auto-keyframe]"),
  ).toHaveCount(2);
  await captureReferenceState(page, "motion-figma-reference-auto-keyframe");
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
        type: "FIGMA",
        styleKey: "Position",
        targetNodeId: "e2e-motion-reference-rectangle",
      }),
    ]),
  );

  await captureReferenceState(page, "motion-figma-reference-position");

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
  await captureReferenceState(page, "motion-figma-reference-add-menu");
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
  await captureReferenceState(page, "motion-figma-reference-origin");

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
  for (const label of ["Position", "Scale", "Rotation", "Size", "Opacity"]) {
    await expect(
      page.getByRole("menuitem", { name: label, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole("menuitem")).toHaveCount(5);
  await captureReferenceState(page, "motion-figma-reference-text-add-menu");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More Motion", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Text Stagger", exact: true }),
  ).toBeVisible();
  await captureReferenceState(page, "motion-figma-reference-text-menu");
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
