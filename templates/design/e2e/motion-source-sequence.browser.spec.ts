import { expect, test, type APIRequestContext } from "@playwright/test";

import { DESIGN_MOTION_LAB } from "../shared/labs";
import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import { enableLab, gotoEditor, selectByText } from "./helpers";

let baseURLForActions: string;
let restoreMotionLab: (() => Promise<void>) | null = null;

const MOTION_SEQUENCE_HTML = FIXTURE_HTML.replace(
  '      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>',
  `      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>
      <p data-agent-native-node-id="e2e-motion-source-sequence-text" data-agent-native-layer-name="Motion source sequence">Motion source sequence</p>`,
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

test.beforeAll(async ({}, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
});

test.beforeEach(async ({ page }) => {
  restoreMotionLab = await enableLab(page, DESIGN_MOTION_LAB.key);
});

test.afterEach(async () => {
  await restoreMotionLab?.();
  restoreMotionLab = null;
});

test("Text, Position, and Scale edits round-trip through saved HTML source", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const created = await postAction(request, "create-design", {
    title: "Motion Source Sequence",
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design did not return an id");

  try {
    const file = await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: MOTION_SEQUENCE_HTML,
      fileType: "html",
    });
    if (!file.id) throw new Error("create-file did not return an id");
    await postAction(request, "index-components", { designId });

    await page.setViewportSize({ width: 1728, height: 941 });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await gotoEditor(page, designId);
    await selectByText(page, "Motion source sequence", {
      screenId: file.id,
      clearPreviousSelection: true,
    });
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();
    const dock = page.getByRole("region", { name: "Motion dock" }).first();
    await expect(dock).toBeVisible();

    const readSource = () =>
      getAction(request, "read-source-file", { designId, path: "index.html" });
    const readTimeline = () =>
      getAction(request, "get-motion-timeline", {
        designId,
        sourceRef: file.id,
      });
    const sourceBefore = await readSource();

    const addStyle = async (label: string) => {
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/_agent-native/actions/apply-motion-edit") &&
          response.request().method() === "POST",
        { timeout: 20_000 },
      );
      await page
        .getByRole("button", { name: "Add animation", exact: true })
        .first()
        .click();
      await page.getByRole("menuitem", { name: label, exact: true }).click();
      const response = await saved;
      expect(response.ok(), await response.text()).toBe(true);
      expect(await response.json()).toMatchObject({ persisted: true });
      const [source, timeline] = await Promise.all([
        readSource(),
        readTimeline(),
      ]);
      return { source, timeline };
    };

    const text = await addStyle("Text");
    expect(text.source.content).not.toBe(sourceBefore.content);
    expect(text.source.content).toContain("agent-native-motion-source:v6:");
    expect(text.timeline.timelines).toHaveLength(1);
    expect(text.timeline.timelines[0].nativeStyles).toHaveLength(1);
    expect(text.timeline.timelines[0].nativeStyles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          styleKey: "TextStagger",
          targetNodeId: "e2e-motion-source-sequence-text",
          props: expect.objectContaining({
            animationDirection: "in",
            textDelayGrouping: "CHARACTER",
            textDelayOrder: "LEFT_RIGHT",
          }),
        }),
      ]),
    );

    const position = await addStyle("Position");
    expect(position.source.content).not.toBe(text.source.content);
    expect(position.timeline.timelines).toHaveLength(1);
    expect(position.timeline.timelines[0].nativeStyles).toHaveLength(2);
    expect(position.timeline.timelines[0].nativeStyles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          styleKey: "TextStagger",
          targetNodeId: "e2e-motion-source-sequence-text",
        }),
        expect.objectContaining({
          styleKey: "Position",
          targetNodeId: "e2e-motion-source-sequence-text",
          props: expect.objectContaining({ type: "slide_in", distance: 200 }),
        }),
      ]),
    );

    const scale = await addStyle("Scale");
    expect(scale.source.content).not.toBe(position.source.content);
    expect(scale.timeline.timelines).toHaveLength(1);
    expect(scale.timeline.timelines[0].nativeStyles).toHaveLength(3);
    expect(scale.timeline.timelines[0].nativeStyles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          styleKey: "TextStagger",
          targetNodeId: "e2e-motion-source-sequence-text",
        }),
        expect.objectContaining({
          styleKey: "Position",
          targetNodeId: "e2e-motion-source-sequence-text",
          props: expect.objectContaining({ distance: 200 }),
        }),
        expect.objectContaining({
          styleKey: "Scale",
          targetNodeId: "e2e-motion-source-sequence-text",
          props: expect.objectContaining({ type: "scaleIn", amount: 120 }),
        }),
      ]),
    );

    await page.screenshot({
      path: testInfo.outputPath("motion-source-sequence-before-reload.png"),
      animations: "disabled",
    });
    await gotoEditor(page, designId);
    await selectByText(page, "Motion source sequence", {
      screenId: file.id,
      clearPreviousSelection: true,
    });
    await page
      .getByRole("button", { name: "Motion dock", exact: true })
      .click();
    await expect(dock.locator("[data-motion-native-style-row]")).toHaveCount(3);

    const [sourceAfterReload, timelineAfterReload] = await Promise.all([
      readSource(),
      readTimeline(),
    ]);
    expect(sourceAfterReload.content).toBe(scale.source.content);
    expect(timelineAfterReload.timelines).toHaveLength(1);
    expect(timelineAfterReload.timelines[0].nativeStyles).toHaveLength(3);
    expect(timelineAfterReload.timelines[0].nativeStyles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          styleKey: "TextStagger",
          targetNodeId: "e2e-motion-source-sequence-text",
        }),
        expect.objectContaining({
          styleKey: "Position",
          targetNodeId: "e2e-motion-source-sequence-text",
          props: expect.objectContaining({ distance: 200 }),
        }),
        expect.objectContaining({
          styleKey: "Scale",
          targetNodeId: "e2e-motion-source-sequence-text",
          props: expect.objectContaining({ type: "scaleIn", amount: 120 }),
        }),
      ]),
    );
  } finally {
    try {
      await page.goto("about:blank");
    } finally {
      await postAction(request, "delete-design", { id: designId });
    }
  }
});
