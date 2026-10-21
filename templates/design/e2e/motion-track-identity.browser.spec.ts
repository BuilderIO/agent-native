import { expect, test, type APIRequestContext } from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { compileMotionCode } from "../shared/motion-code";
import type { MotionTimeline } from "../shared/motion-timeline";
import { appPath, enableLab, gotoEditor, selectByText } from "./helpers";

const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Motion track identity</title></head>
  <body style="margin:0;width:800px;height:600px">
    <main style="position:relative;min-height:600px">
      <button id="motion-target" data-agent-native-node-id="motion-target" style="position:absolute;left:40px;top:40px;width:160px;height:48px">Motion target</button>
    </main>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getTimeline(
  request: APIRequestContext,
  designId: string,
  sourceRef: string,
) {
  const query = new URLSearchParams({ designId, sourceRef });
  const response = await request.get(
    appPath(`/_agent-native/actions/get-motion-timeline?${query}`),
  );
  if (!response.ok()) {
    throw new Error(
      `get-motion-timeline failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

function duplicateTrackCss(designId: string): string {
  const timeline: MotionTimeline = {
    id: "",
    designId,
    sourceRef: null,
    filePath: null,
    durationMs: 1000,
    defaultEase: "linear",
    compiledHash: null,
    createdAt: "",
    updatedAt: "",
    tracks: [
      {
        id: "opacity-first",
        targetNodeId: "motion-target",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "0.5" },
        ],
      },
      {
        id: "opacity-second",
        targetNodeId: "motion-target",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0.5" },
          { t: 1, value: "1" },
        ],
      },
      {
        id: "position-x",
        targetNodeId: "motion-target",
        property: "translate",
        composition: "add",
        keyframes: [
          { t: 0, value: "0px 0px" },
          { t: 1, value: "100px 0px" },
        ],
      },
      {
        id: "position-y",
        targetNodeId: "motion-target",
        property: "translate",
        composition: "add",
        keyframes: [
          { t: 0, value: "0px 0px" },
          { t: 1, value: "0px 60px" },
        ],
      },
    ],
  };
  return compileMotionCode(timeline).css;
}

test.describe("repeated motion track identity", () => {
  let restoreMotionLab: (() => Promise<void>) | null = null;
  let designId: string | null = null;

  test.beforeEach(async ({ page }) => {
    restoreMotionLab = await enableLab(page, DESIGN_MOTION_LAB.key);
  });

  test.afterEach(async ({ page }) => {
    await restoreMotionLab?.();
    restoreMotionLab = null;
    if (designId) {
      await postAction(page.request, "delete-design", { id: designId });
      designId = null;
    }
  });

  test("loads and selects the requested same-property track by ID", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const created = await postAction(request, "create-design", {
      title: "Motion track identity",
      projectType: "prototype",
    });
    designId = created?.id ?? created?.data?.id ?? created?.design?.id;
    expect(designId).toBeTruthy();
    if (typeof designId !== "string") {
      throw new Error("create-design did not return a design id");
    }
    const activeDesignId = designId;
    const file = await postAction(request, "create-file", {
      designId: activeDesignId,
      filename: "index.html",
      content: html.replace(
        "</head>",
        `<style data-agent-native-motion>\n${duplicateTrackCss(activeDesignId)}\n</style>\n</head>`,
      ),
      fileType: "html",
    });
    const fileId = file?.id;
    expect(fileId).toBeTruthy();
    await postAction(request, "index-components", { designId: activeDesignId });

    const timeline = await getTimeline(request, activeDesignId, fileId);
    const tracks = timeline.timelines?.[0]?.tracks ?? [];
    expect(tracks.map((track: { id: string }) => track.id)).toEqual([
      "opacity-first",
      "opacity-second",
      "position-x",
      "position-y",
    ]);

    await gotoEditor(page, activeDesignId);
    await selectByText(page, "Motion target", {
      screenId: fileId,
      deep: false,
    });
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();

    const dock = page.getByRole("region", { name: "Motion dock" }).first();
    const firstRow = dock.locator(
      '[data-motion-property-row="opacity"][data-motion-track-id="opacity-first"]',
    );
    const secondRow = dock.locator(
      '[data-motion-property-row="opacity"][data-motion-track-id="opacity-second"]',
    );
    const positionXRow = dock.locator(
      '[data-motion-property-row="translate"][data-motion-track-id="position-x"]',
    );
    const positionYRow = dock.locator(
      '[data-motion-property-row="translate"][data-motion-track-id="position-y"]',
    );
    await expect(firstRow).toHaveCount(1);
    await expect(secondRow).toHaveCount(1);
    await expect(positionXRow).toHaveCount(1);
    await expect(positionYRow).toHaveCount(1);

    await secondRow.click({ position: { x: 55, y: 12 } });
    await expect(secondRow).toHaveAttribute("aria-pressed", "true");
    await expect(firstRow).toHaveAttribute("aria-pressed", "false");

    await positionYRow.click({ position: { x: 55, y: 12 } });
    await expect(positionYRow).toHaveAttribute("aria-pressed", "true");
    await expect(positionXRow).toHaveAttribute("aria-pressed", "false");
  });
});
