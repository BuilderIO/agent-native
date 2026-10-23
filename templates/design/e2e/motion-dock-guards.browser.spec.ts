import { expect, test, type APIRequestContext } from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import { enableLab, gotoEditor, selectByText } from "./helpers";

let baseURLForActions: string;
let restoreMotionLab: (() => Promise<void>) | null = null;
let cleanupDesignId: string | undefined;

const REFERENCE_FIXTURE_HTML = FIXTURE_HTML.replace(
  '      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>',
  `      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>
      <div data-agent-native-node-id="e2e-motion-reference-rectangle" data-agent-native-layer-name="Rectangle" style="width:100px;height:100px;padding:0;border:0;background:#7F0EFF;color:transparent;font-size:0;line-height:0">Reference Rectangle</div>`,
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

async function createReferenceDesign(
  request: APIRequestContext,
): Promise<{ designId: string; fileId: string }> {
  const created = await postAction(request, "create-design", {
    title: "Motion dock guards",
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design did not return an id");
  const file = await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: REFERENCE_FIXTURE_HTML,
    fileType: "html",
  });
  if (!file.id) throw new Error("create-file did not return a file id");
  return { designId, fileId: file.id };
}

test.beforeEach(async ({ page }, testInfo) => {
  baseURLForActions =
    (testInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  restoreMotionLab = await enableLab(page, DESIGN_MOTION_LAB.key);
});

test.afterEach(async ({ request }) => {
  await restoreMotionLab?.();
  restoreMotionLab = null;
  if (cleanupDesignId) {
    await postAction(request, "delete-design", { id: cleanupDesignId });
    cleanupDesignId = undefined;
  }
});

test("reopening the Motion dock as its collapse finishes keeps it open", async ({
  page,
  request,
}) => {
  const { designId, fileId } = await createReferenceDesign(request);
  cleanupDesignId = designId;
  await page.setViewportSize({ width: 1728, height: 941 });
  await gotoEditor(page, designId);
  await selectByText(page, "Reference Rectangle", {
    screenId: fileId,
    clearPreviousSelection: true,
    deep: false,
  });
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  const dockRegion = page.locator('[role="region"][aria-label="Motion dock"]');
  await expect(dockRegion).toBeVisible();
  await expect(dockRegion).not.toHaveAttribute("aria-hidden", "true");

  // A slow collapse lets the reopen click land mid-transition, and holding
  // frames keeps that reopen pending until the collapse transition ends.
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    const originalCancel = window.cancelAnimationFrame.bind(window);
    const held = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    window.requestAnimationFrame = (callback) => {
      held.set(nextId, callback);
      return nextId++;
    };
    window.cancelAnimationFrame = (id) => {
      held.delete(id);
    };
    const space = document.querySelector<HTMLElement>(
      ".design-motion-dock-space",
    );
    space?.style.setProperty("--design-motion-dock-duration", "1500ms");
    space?.addEventListener("transitionend", (event) => {
      if (event.target === space && event.propertyName === "height") {
        document.body.dataset.e2eDockCollapsed = "true";
      }
    });
    Object.assign(window, {
      e2eReleaseFrames: () => {
        window.requestAnimationFrame = original;
        window.cancelAnimationFrame = originalCancel;
        for (const callback of held.values()) original(callback);
        held.clear();
      },
    });
  });
  await page
    .getByRole("region", { name: "Motion dock" })
    .getByRole("button", { name: "Collapse motion dock" })
    .click();
  await expect(dockRegion).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Motion dock", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-e2e-dock-collapsed",
    "true",
  );
  // Past the exit settle delay that used to unmount the reopening dock.
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    (window as unknown as { e2eReleaseFrames(): void }).e2eReleaseFrames(),
  );

  await expect(dockRegion).toBeVisible();
  await expect(dockRegion).not.toHaveAttribute("aria-hidden", "true");
});

test("adding a Position style beside a curved path is refused instead of left unsaveable", async ({
  page,
  request,
}) => {
  const { designId, fileId } = await createReferenceDesign(request);
  cleanupDesignId = designId;
  const seeded = await postAction(request, "apply-motion-edit", {
    designId,
    fileId,
    sourceRef: fileId,
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
  await gotoEditor(page, designId);
  await selectByText(page, "Reference Rectangle", {
    screenId: fileId,
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
});
