import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { enableLab, selectByText } from "./helpers";
import { expect, test } from "./rails";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Motion inspector selection</title></head>
  <body style="margin:0;width:800px;height:600px;background:#ffffff">
    <button data-agent-native-node-id="motion-primary" data-agent-native-layer-name="Primary" style="position:absolute;left:40px;top:40px;width:160px;height:48px">Primary motion target</button>
    <button data-agent-native-node-id="motion-secondary" data-agent-native-layer-name="Secondary" style="position:absolute;left:40px;top:120px;width:160px;height:48px">Secondary motion target</button>
    <div data-agent-native-node-id="motion-unsupported" data-agent-native-layer-name="Unsupported" x-transition.opacity style="position:absolute;left:40px;top:200px;width:160px;height:48px">Unsupported motion target</div>
  </body>
</html>`;

let restoreMotionLab: (() => Promise<void>) | null = null;

test.beforeEach(async ({ page }) => {
  restoreMotionLab = await enableLab(page, DESIGN_MOTION_LAB.key);
});

test.afterEach(async () => {
  await restoreMotionLab?.();
  restoreMotionLab = null;
});

test("deselecting restores the Canvas inspector without closing the Motion timeline", async ({
  app,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1728, height: 941 });
  const designId = await app.seed(FIXTURE, {
    title: "Motion Inspector Selection",
  });
  await app.open(designId);
  await app.zoomToFit();
  await selectByText(page, "Primary motion target", { deep: false });

  const launchMotion = page.getByRole("button", {
    name: "Motion dock",
    exact: true,
  });
  await expect(launchMotion).toBeVisible();
  await launchMotion.click();

  const dock = page.getByRole("region", { name: "Motion dock" }).first();
  await expect(dock).toBeVisible();
  await expect(
    page.locator('[data-design-inspector-section] h3[aria-label="Animations"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add animation", exact: true }).first(),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect.poll(() => app.selectedLayers()).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "Canvas", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-design-inspector-section] h3[aria-label="Animations"]'),
  ).toHaveCount(0);
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("textbox", { name: "Duration" })).toHaveValue(
    "2000",
  );
  await expect(dock.locator("[data-motion-track-row]")).toHaveCount(0);
  await expect(dock.locator("[data-motion-keyframe]")).toHaveCount(0);
  await expect(
    dock.getByRole("checkbox", { name: "Toggle auto-keyframing" }),
  ).not.toBeChecked();

  const state = await page.evaluate(() => {
    const dockElement = document.querySelector<HTMLElement>(
      '[role="region"][aria-label="Motion dock"]',
    );
    const pageSection = Array.from(
      document.querySelectorAll<HTMLElement>("[data-design-inspector-section]"),
    ).find((section) => section.querySelector('h3[aria-label="Canvas"]'));
    const bounds = (element: HTMLElement | null | undefined) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      selectedLayers: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="treeitem"][aria-selected="true"]',
        ),
      ).map((element) => element.innerText.trim()),
      inspectorSections: Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-design-inspector-section]",
        ),
      ).map((section) => ({
        label: section.querySelector("h3")?.getAttribute("aria-label") ?? null,
        text: section.innerText,
        rect: bounds(section),
      })),
      canvasInspector: bounds(pageSection),
      dock: {
        text: dockElement?.innerText ?? null,
        rect: bounds(dockElement),
        trackCount:
          dockElement?.querySelectorAll("[data-motion-track-row]").length ?? 0,
        keyframeCount:
          dockElement?.querySelectorAll("[data-motion-keyframe]").length ?? 0,
        duration:
          dockElement?.querySelector<HTMLInputElement>(
            'input[aria-label="Duration"]',
          )?.value ?? null,
      },
    };
  });
  const artifactDirectory = path.resolve(
    import.meta.dirname,
    "../../../.tmp/design-motion-parity",
  );
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    path.join(artifactDirectory, "motion-inspector-deselected-local.json"),
    `${JSON.stringify({ step_id: "motion-inspector-deselected-local", state }, null, 2)}\n`,
    "utf8",
  );
  const screenshotPath = path.join(
    artifactDirectory,
    "motion-inspector-deselected-local.png",
  );
  const screenshot = await page.screenshot({
    path: screenshotPath,
    animations: "disabled",
  });
  await testInfo.attach("Motion timeline with Canvas inspector restored", {
    body: screenshot,
    contentType: "image/png",
  });

  await selectByText(page, "Primary motion target", {
    clearPreviousSelection: true,
    deep: false,
  });
  await expect(
    page.locator('[data-design-inspector-section] h3[aria-label="Animations"]'),
  ).toBeVisible();
  await expect(dock).toBeVisible();

  await selectByText(page, "Secondary motion target", { additive: true });
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual(["Primary", "Secondary"]);
  await expect(
    page.locator('[data-design-inspector-section] h3[aria-label="Animations"]'),
  ).toBeVisible();
  await expect(dock).toBeVisible();

  await selectByText(page, "Unsupported motion target", {
    clearPreviousSelection: true,
    deep: false,
  });
  await expect.poll(() => app.selectedLayers()).toEqual(["Unsupported"]);
  await expect(
    page.locator('[data-design-inspector-section] h3[aria-label="Animations"]'),
  ).toBeVisible();
  await expect(dock).toBeVisible();
});
