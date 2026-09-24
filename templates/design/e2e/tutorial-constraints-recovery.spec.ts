import { writeFile } from "node:fs/promises";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, cdpScreenshot, designFrame, gotoEditor } from "./helpers";

const PLAY_ID = "tutorial-constraint-play";

const CARD_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Constraint recovery</title></head>
  <body style="margin:0;min-height:100vh;background:#fff">
    <div data-agent-native-node-id="tutorial-card" data-agent-native-layer-name="Card"
         style="position:absolute;left:24px;top:24px;width:384px;height:339px;padding:12px;box-sizing:border-box;background:#f3f4f6">
      <div data-agent-native-node-id="tutorial-album-art" data-agent-native-layer-name="Album art"
           style="position:relative;width:360px;height:240px;background:#e6a26b">
        <div data-agent-native-node-id="${PLAY_ID}" data-agent-native-layer-name="Play button"
             style="position:absolute;left:308px;top:188px;width:40px;height:40px;border-radius:50%;background:#fff;color:#111">Play</div>
      </div>
    </div>
  </body>
</html>`;

type PersistedNode = {
  position: string;
  left: string;
  right: string;
  top: string;
  bottom: string;
  width: string;
  height: string;
};

type UiSample = {
  at: string;
  url: string;
  moveButton: boolean;
  skeletonBlocks: number;
  screenShells: number;
  skeleton: boolean;
  captureWindow: boolean;
};

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createCardDesign(page: Page): Promise<string> {
  const created = await action(page.request, "create-design", {
    title: `Tutorial constraints recovery ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");

  const file = await action(page.request, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content: CARD_HTML,
  });
  const fileId = file.id ?? file.data?.id;
  if (typeof fileId !== "string") throw new Error("missing screen id");

  await action(page.request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 100, y: 100, width: 480, height: 420 },
      },
    ],
  });
  return designId;
}

async function readPlayStyle(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const file = design.files?.find(
    (candidate: { filename?: string }) => candidate.filename === "screen.html",
  );
  if (typeof file?.content !== "string") {
    throw new Error("screen.html source is missing from get-design");
  }
  const styles = await page.evaluate(
    ({ html, nodeId }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const node = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${nodeId}"]`,
      );
      if (!node) throw new Error("Play button missing from saved source");
      const style = node.style;
      return {
        position: style.position,
        left: style.left,
        right: style.right,
        top: style.top,
        bottom: style.bottom,
        width: style.width,
        height: style.height,
      };
    },
    { html: file.content, nodeId: PLAY_ID },
  );
  return { source: file.content as string, styles: styles as PersistedNode };
}

async function selectPlayLayer(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const play = designFrame(page).locator(
    `[data-agent-native-node-id="${PLAY_ID}"]`,
  );
  await expect(play).toBeVisible();
  await play.click({ force: true });
  const layer = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem", { name: /Play button/ });
  await expect(layer).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Constraints", exact: true }),
  ).toBeVisible();
}

test("absolute-position constraint controls survive close, reopen, and reload", async ({
  page,
}, testInfo) => {
  const diagnostics = {
    mainFrameNavigations: [] as Array<{ at: string; url: string }>,
    console: [] as Array<{
      at: string;
      level: string;
      text: string;
      url?: string;
    }>,
    pageErrors: [] as Array<{ at: string; text: string }>,
    uiSamples: [] as UiSample[],
    screenshots: [] as string[],
    sourceStages: {} as Record<string, unknown>,
    inspectorAfterReload: {} as Record<string, string>,
    toastTexts: [] as string[],
  };
  let designId: string | undefined;
  let skeletonScreenshotCaptured = false;

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      diagnostics.mainFrameNavigations.push({
        at: new Date().toISOString(),
        url: frame.url(),
      });
    }
  });
  page.on("console", (message) => {
    diagnostics.console.push({
      at: new Date().toISOString(),
      level: message.type(),
      text: message.text(),
      url: message.location().url || undefined,
    });
  });
  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push({
      at: new Date().toISOString(),
      text: error.message,
    });
  });

  await page.exposeFunction(
    "__reportTutorialConstraintUiSample",
    async (sample: UiSample) => {
      diagnostics.uiSamples.push(sample);
      if (
        sample.skeleton &&
        sample.captureWindow &&
        !skeletonScreenshotCaptured
      ) {
        skeletonScreenshotCaptured = true;
        const screenshotPath = testInfo.outputPath(
          "transient-editor-skeleton.png",
        );
        await cdpScreenshot(page, screenshotPath);
        diagnostics.screenshots.push(screenshotPath);
      }
    },
  );
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __reportTutorialConstraintUiSample?: (sample: UiSample) => Promise<void>;
      __lastTutorialConstraintUiState?: string;
      __captureTutorialConstraintSkeleton?: boolean;
    };
    const sample = () => {
      const moveButton = Boolean(
        document.querySelector('button[aria-label="Move"]'),
      );
      const skeletonBlocks = document.querySelectorAll(
        "main .animate-pulse",
      ).length;
      const screenShells = document.querySelectorAll(
        "[data-screen-shell]",
      ).length;
      const skeleton =
        /\/design\//.test(location.pathname) &&
        !moveButton &&
        skeletonBlocks > 0;
      const captureWindow = Boolean(target.__captureTutorialConstraintSkeleton);
      const state = `${moveButton}:${skeletonBlocks}:${screenShells}:${skeleton}`;
      if (state === target.__lastTutorialConstraintUiState) return;
      target.__lastTutorialConstraintUiState = state;
      void target.__reportTutorialConstraintUiSample?.({
        at: new Date().toISOString(),
        url: location.href,
        moveButton,
        skeletonBlocks,
        screenShells,
        skeleton,
        captureWindow,
      });
    };
    new MutationObserver(sample).observe(document, {
      childList: true,
      subtree: true,
    });
    document.addEventListener("readystatechange", sample);
    sample();
  });

  try {
    designId = await createCardDesign(page);
    const before = await readPlayStyle(page, designId);
    diagnostics.sourceStages.before = before;
    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
    await selectPlayLayer(page);
    await page.evaluate(() => {
      (
        window as typeof window & {
          __captureTutorialConstraintSkeleton?: boolean;
        }
      ).__captureTutorialConstraintSkeleton = true;
    });

    const constraintSequenceStartedAt = new Date().toISOString();
    diagnostics.sourceStages.constraintSequenceStartedAt =
      constraintSequenceStartedAt;
    const positionToggle = page.getByRole("button", {
      name: "Absolute position",
    });
    await expect(positionToggle).toHaveAttribute("aria-pressed", "true");

    const constraints = page.getByRole("button", {
      name: "Constraints",
      exact: true,
    });
    await expect(constraints).toBeVisible();
    await constraints.click();
    await page.getByRole("combobox", { name: "Horizontal" }).click();
    await page.getByRole("option", { name: "Right", exact: true }).click();
    await page.getByRole("combobox", { name: "Vertical" }).click();
    await page.getByRole("option", { name: "Bottom", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Horizontal" })).toHaveText(
      "Right",
    );
    await expect(page.getByRole("combobox", { name: "Vertical" })).toHaveText(
      "Bottom",
    );

    const expectedAnchoredStyles = {
      position: "absolute",
      left: "auto",
      right: "12px",
      top: "auto",
      bottom: "12px",
      width: "40px",
      height: "40px",
    };
    await expect
      .poll(async () => (await readPlayStyle(page, designId!)).styles, {
        timeout: 10_000,
      })
      .toEqual(expectedAnchoredStyles);

    await constraints.click();
    await expect(
      page.getByRole("combobox", { name: "Horizontal" }),
    ).toBeHidden();
    await constraints.click();
    await expect(page.getByRole("combobox", { name: "Horizontal" })).toHaveText(
      "Right",
    );
    await expect(page.getByRole("combobox", { name: "Vertical" })).toHaveText(
      "Bottom",
    );

    diagnostics.sourceStages.afterControls = await readPlayStyle(
      page,
      designId,
    );

    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    const afterControls = await readPlayStyle(page, designId);
    const beforeReloadScreenshot = testInfo.outputPath(
      "constraint-anchors-before-reload.png",
    );
    await cdpScreenshot(page, beforeReloadScreenshot);
    await testInfo.attach("constraint-anchors-before-reload.png", {
      path: beforeReloadScreenshot,
      contentType: "image/png",
    });
    const beforeReloadAt = new Date().toISOString();
    diagnostics.sourceStages.explicitReloadAt = beforeReloadAt;
    await page.evaluate(() => {
      (
        window as typeof window & {
          __captureTutorialConstraintSkeleton?: boolean;
        }
      ).__captureTutorialConstraintSkeleton = false;
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
    const afterReload = await readPlayStyle(page, designId);
    diagnostics.sourceStages.afterReload = afterReload;
    const afterReloadScreenshot = testInfo.outputPath(
      "constraint-anchors-after-reload.png",
    );
    await cdpScreenshot(page, afterReloadScreenshot);
    await testInfo.attach("constraint-anchors-after-reload.png", {
      path: afterReloadScreenshot,
      contentType: "image/png",
    });
    await selectPlayLayer(page);
    await constraints.click();
    diagnostics.inspectorAfterReload = {
      horizontal: await page
        .getByRole("combobox", { name: "Horizontal" })
        .innerText(),
      vertical: await page
        .getByRole("combobox", { name: "Vertical" })
        .innerText(),
    };
    const afterReloadInspectorScreenshot = testInfo.outputPath(
      "constraint-controls-after-reload.png",
    );
    await cdpScreenshot(page, afterReloadInspectorScreenshot);
    await testInfo.attach("constraint-controls-after-reload.png", {
      path: afterReloadInspectorScreenshot,
      contentType: "image/png",
    });
    await expect(page.getByRole("combobox", { name: "Horizontal" })).toHaveText(
      "Right",
    );
    await expect(page.getByRole("combobox", { name: "Vertical" })).toHaveText(
      "Bottom",
    );

    const finalToasts = await page
      .locator("[data-sonner-toast], [role='alert']")
      .allTextContents();
    diagnostics.toastTexts = finalToasts;

    diagnostics.sourceStages.beforeReload = afterControls;

    expect(afterControls.styles).toEqual(afterReload.styles);
    expect(afterReload.styles.position).toBe("absolute");
    expect(diagnostics.pageErrors).toEqual([]);
    expect(finalToasts.join("\n")).not.toMatch(
      /changed elsewhere|last edit was not saved/i,
    );
  } finally {
    const evidencePath = testInfo.outputPath(
      "constraint-recovery-evidence.json",
    );
    await writeFile(
      evidencePath,
      JSON.stringify({ designId, ...diagnostics }, null, 2),
      "utf8",
    );
    await testInfo.attach("constraint-recovery-evidence.json", {
      path: evidencePath,
      contentType: "application/json",
    });
    if (designId)
      await action(page.request, "delete-design", { id: designId }).catch(
        () => {},
      );
    if (diagnostics.screenshots[0]) {
      await testInfo.attach("transient-editor-skeleton.png", {
        path: diagnostics.screenshots[0],
        contentType: "image/png",
      });
    }
  }
});
