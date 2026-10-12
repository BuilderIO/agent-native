import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Response,
} from "@playwright/test";

import { DESIGN_MOTION_LAB, DESIGN_REVIEW_TOOLS_LAB } from "../shared/labs";
import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import { designFrame, enableLab, gotoEditor, selectByText } from "./helpers";

let designId: string;
let fileId: string;
let baseURLForActions: string;
let restoreMotionLabAfterTest: (() => Promise<void>) | null = null;

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

async function setLabEnabled(
  page: Page,
  key: string,
  enabled: boolean,
): Promise<() => Promise<void>> {
  const response = await page.request.get(
    `${baseURLForActions}/_agent-native/actions/get-lab-states`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-lab-states failed: ${response.status()} ${await response.text()}`,
    );
  }
  const states = await response.json();
  const previousEnabled = states[key]?.enabled;
  if (typeof previousEnabled !== "boolean") {
    throw new Error(`get-lab-states did not return a state for ${key}`);
  }
  const updated = await postAction(page.request, "set-lab", { key, enabled });
  expect(updated.enabled).toBe(enabled);
  return async () => {
    const restored = await postAction(page.request, "set-lab", {
      key,
      enabled: previousEnabled,
    });
    expect(restored.enabled).toBe(previousEnabled);
  };
}

async function openMotionDockFromMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Motion", exact: true }).click();
}

async function enterDesignEditMode(page: Page): Promise<void> {
  const modeButton = page.locator('[data-design-mode="edit"]');
  await expect(modeButton).toBeVisible();
  await modeButton.click();
  await expect(modeButton).toHaveAttribute("aria-pressed", "true");
}

test.beforeAll(async ({ request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();

  const created = await postAction(request, "create-design", {
    title: "E2E Code-Native Design Studio",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) {
    throw new Error(`create-design did not return an id: ${created}`);
  }

  const file = await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE_HTML,
    fileType: "html",
  });
  fileId = file.id;
  if (!fileId) throw new Error("create-file did not return an id");
  await postAction(request, "index-components", { designId });
  await postAction(request, "seed-e2e-component-variants", { designId });
});

test.afterAll(async ({ request }) => {
  if (!designId) return;
  await postAction(request, "delete-design", { id: designId }).catch(() => {});
});

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith("Motion ")) return;
  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
});

test.afterEach(async () => {
  if (!restoreMotionLabAfterTest) return;
  await restoreMotionLabAfterTest();
  restoreMotionLabAfterTest = null;
});

async function selectedElementBackgroundImage(page: Page): Promise<string> {
  return designFrame(page, fileId)
    .locator('[data-agent-native-node-id="e2e-alpha-button"]')
    .evaluate((el) => window.getComputedStyle(el).backgroundImage);
}

async function waitForAction(
  page: Page,
  actionName: string,
  trigger: () => Promise<void>,
): Promise<Response> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/_agent-native/actions/${actionName}`) &&
      response.request().method() !== "OPTIONS",
    { timeout: 20_000 },
  );
  await trigger();
  const response = await responsePromise;
  expect(
    response.ok(),
    `${actionName} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return response;
}

async function prepareMotionTest(
  page: Page,
  motionLabEnabled: boolean,
): Promise<void> {
  const timelineUrl = new URL(
    `${baseURLForActions}/_agent-native/actions/get-motion-timeline`,
  );
  timelineUrl.searchParams.set("designId", designId);
  timelineUrl.searchParams.set("sourceRef", fileId);
  const timelineResponse = await page.request.get(timelineUrl.toString());
  if (!timelineResponse.ok()) {
    throw new Error(
      `get-motion-timeline failed: ${timelineResponse.status()} ${await timelineResponse.text()}`,
    );
  }
  const timelineResult = (await timelineResponse.json()) as {
    timelines?: Array<{ id?: unknown }>;
  };
  for (const timeline of timelineResult.timelines ?? []) {
    if (typeof timeline.id !== "string") continue;
    await postAction(page.request, "remove-motion-timeline", {
      designId,
      timelineId: timeline.id,
      fileId,
    });
  }

  await postAction(page.request, "update-file", {
    id: fileId,
    content: FIXTURE_HTML,
  });
  restoreMotionLabAfterTest = await setLabEnabled(
    page,
    DESIGN_MOTION_LAB.key,
    motionLabEnabled,
  );
  await gotoEditor(page, designId);
  await enterDesignEditMode(page);
}

async function addOpacityTrack(page: Page): Promise<Response> {
  await page
    .locator('[aria-label="Motion dock"]')
    .first()
    .getByRole("button", { name: "Add motion", exact: true })
    .last()
    .click();
  return waitForAction(page, "apply-motion-edit", async () => {
    await page.getByRole("menuitem", { name: "Opacity", exact: true }).click();
  });
}

async function expectMotionEditDoesNotSendContent(
  response: Response,
): Promise<void> {
  const requestBody = JSON.parse(
    response.request().postData() ?? "{}",
  ) as Record<string, unknown>;
  expect(requestBody.includeContent).toBe(false);
  expect(
    ((await response.json()) as Record<string, unknown>).patchedContent,
  ).toBeUndefined();
}

async function selectedComponentVariant(page: Page): Promise<string | null> {
  return designFrame(page, fileId)
    .locator('[data-agent-native-node-id="e2e-component-button"]')
    .getAttribute("data-agent-native-prop-variant");
}

async function tokenSampleBackground(page: Page): Promise<string> {
  return designFrame(page, fileId)
    .locator('[data-agent-native-node-id="e2e-token-sample"]')
    .evaluate((el) => window.getComputedStyle(el).backgroundColor);
}

async function openTokensPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Tokens", exact: true }).click();
  await expect(page.getByText("E2e Accent Color", { exact: true })).toBeVisible(
    { timeout: 20_000 },
  );
}

async function editTokenValue(
  page: Page,
  tokenName: string,
  value: string,
): Promise<void> {
  await page
    .getByRole("button", { name: `Edit ${tokenName}`, exact: true })
    .click();
  const input = page.getByLabel(`Token value for ${tokenName}`, {
    exact: true,
  });
  await expect(input).toBeVisible();
  await input.fill(value);
  await waitForAction(page, "apply-design-token-edit", async () => {
    await input.press("Enter");
  });
}

test("inline component prop dropdown persists on the selected component", async ({
  page,
}) => {
  const payload = await selectByText(page, "Variant CTA", {
    screenId: fileId,
  });
  expect(payload?.selector ?? "").toContain("data-agent-native-node-id");

  const componentSection = page.getByTestId("component-section");
  await expect(componentSection).toContainText("E2EButton");

  const variantSelect = componentSection.getByRole("combobox").first();
  await expect(variantSelect).toContainText("primary");

  await variantSelect.click();
  await waitForAction(page, "apply-component-prop-edit", async () => {
    await page.getByRole("option", { name: "secondary", exact: true }).click();
  });

  await expect(variantSelect).toContainText("secondary");
  await expect.poll(() => selectedComponentVariant(page)).toBe("secondary");

  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await selectByText(page, "Variant CTA", { screenId: fileId });
  await expect(
    page.getByTestId("component-section").getByRole("combobox").first(),
  ).toContainText("secondary");
});

test("token CSS-var edits update the iframe live and persist after reload", async ({
  page,
}) => {
  await openTokensPanel(page);
  await expect
    .poll(() => tokenSampleBackground(page))
    .toBe("rgb(99, 102, 241)");

  await editTokenValue(page, "E2e Accent Color", "#ff3366");
  await expect
    .poll(() => tokenSampleBackground(page))
    .toBe("rgb(255, 51, 102)");

  await gotoEditor(page, designId);
  await expect
    .poll(() => tokenSampleBackground(page))
    .toBe("rgb(255, 51, 102)");
});

test("Review panel runs an audit and applies an inline a11y fix", async ({
  page,
}) => {
  const restoreReviewPanel = await enableLab(page, DESIGN_REVIEW_TOOLS_LAB.key);
  try {
    await gotoEditor(page, designId);
    await runReviewPanelAudit(page);
  } finally {
    await restoreReviewPanel();
  }
});

async function runReviewPanelAudit(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  const reviewHeading = page.getByRole("heading", {
    name: "Review",
    exact: true,
  });
  await reviewHeading.scrollIntoViewIfNeeded();
  await expect(reviewHeading).toBeVisible();

  await expect(page.getByTestId("review-panel")).toBeVisible();

  await waitForAction(page, "run-design-audit", async () => {
    await page.getByRole("button", { name: "Run audit", exact: true }).click();
  });

  await expect(
    page.getByText("<img> is missing an alt attribute.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Form control is missing an accessible label.", {
      exact: true,
    }),
  ).toBeVisible();

  const focusFinding = page.getByRole("button", {
    name: "Interactive element uses outline-none without a focus-visible ring.",
    exact: true,
  });
  await expect(focusFinding).toBeVisible();

  await waitForAction(page, "apply-a11y-fix", async () => {
    await focusFinding
      .getByRole("button", { name: "Fix", exact: true })
      .click();
  });

  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator('[data-agent-native-node-id="e2e-audit-focus-button"]')
        .getAttribute("class"),
    )
    .toContain("focus-visible:ring-2");

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator('[data-agent-native-node-id="e2e-audit-focus-button"]')
        .getAttribute("class"),
    )
    .toContain("focus-visible:ring-2");
}

test("Motion lab-off hides the dock and menu entry", async ({ page }) => {
  await prepareMotionTest(page, false);
  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Motion", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Back to designs", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const workspaceRail = page.locator('nav[aria-label="Design workspace"]');
  await expect(
    workspaceRail.getByRole("button", { name: /^(Layers|File)$/ }),
  ).toBeVisible();
  await expect(
    workspaceRail.getByRole("button", { name: "Agents" }),
  ).toBeVisible();
  await expect(
    workspaceRail.getByRole("button", { name: "Tokens" }),
  ).toBeVisible();
});

test("Motion dock autosaves an opacity track to CSS and reopens it", async ({
  page,
}) => {
  await prepareMotionTest(page, true);
  await selectByText(page, "Alpha Button", { screenId: fileId });

  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);
  await openMotionDockFromMenu(page);
  await expect(page.locator('[aria-label="Motion dock"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse motion dock", exact: true })
    .click();
  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);
  await openMotionDockFromMenu(page);
  await expect(page.locator('[aria-label="Motion dock"]')).toBeVisible();
  await expect(
    page.getByText("Pick a property to add the first track.", {
      exact: false,
    }),
  ).toBeVisible();

  const motionResponse = await addOpacityTrack(page);
  await expectMotionEditDoesNotSendContent(motionResponse);
  const motionDock = page.locator('[aria-label="Motion dock"]').first();
  await expect(
    motionDock.getByRole("button", { name: "Alpha Button" }),
  ).toBeVisible();
  await expect(page.getByText("opacity", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Keyframe at 0ms")).toBeVisible();
  await expect(page.getByLabel("Keyframe at 2000ms")).toBeVisible();

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator("style[data-agent-native-motion]")
        .count(),
    )
    .toBe(1);
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator("style[data-agent-native-motion]")
        .first()
        .textContent(),
    )
    .toContain("e2e-alpha-button");

  await openMotionDockFromMenu(page);
  await expect(
    motionDock.getByRole("button", { name: "Alpha Button" }),
  ).toBeVisible();
});

test("Motion duration edits play and persist after reopening", async ({
  page,
}) => {
  await prepareMotionTest(page, true);
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);
  await openMotionDockFromMenu(page);
  await expect(page.locator('[aria-label="Motion dock"]')).toBeVisible();

  const motionResponse = await addOpacityTrack(page);
  await expectMotionEditDoesNotSendContent(motionResponse);
  const motionDock = page.locator('[aria-label="Motion dock"]').first();
  const durationInput = motionDock.getByLabel("Duration in ms");
  await durationInput.fill("4000");
  await durationInput.press("Tab");
  await motionDock.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(
      () =>
        designFrame(page, fileId)
          .locator('[data-agent-native-node-id="e2e-alpha-button"]')
          .evaluate((el) =>
            Number.parseFloat(window.getComputedStyle(el).opacity),
          ),
      { timeout: 2_000, intervals: [50, 100, 150, 250, 500] },
    )
    .toBeLessThan(0.95);
  await motionDock
    .getByRole("button", { name: "Reset playhead", exact: true })
    .click();
  await motionDock
    .getByRole("button", { name: "Collapse motion dock", exact: true })
    .click();
  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);

  await openMotionDockFromMenu(page);
  await expect(
    motionDock.getByRole("button", { name: "Alpha Button" }),
  ).toBeVisible();
  await expect(page.getByText("opacity", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Keyframe at 0ms")).toBeVisible();
  await expect(page.getByLabel("Keyframe at 4000ms")).toBeVisible();

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator("style[data-agent-native-motion]")
        .count(),
    )
    .toBe(1);
});

test("Motion lab-off hides the dock after a saved track", async ({ page }) => {
  await prepareMotionTest(page, true);
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await openMotionDockFromMenu(page);
  const motionResponse = await addOpacityTrack(page);
  await expectMotionEditDoesNotSendContent(motionResponse);
  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page, fileId)
        .locator("style[data-agent-native-motion]")
        .count(),
    )
    .toBe(1);
  await openMotionDockFromMenu(page);
  await expect(page.locator('[aria-label="Motion dock"]')).toBeVisible();

  const disabledAfterSave = await postAction(page.request, "set-lab", {
    key: DESIGN_MOTION_LAB.key,
    enabled: false,
  });
  expect(disabledAfterSave.enabled).toBe(false);
  await gotoEditor(page, designId);
  await enterDesignEditMode(page);
  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Motion", exact: true }),
  ).toHaveCount(0);
});

// Not label drift, not missing WebGL, and not a crash: the transient preview
// exists only in the single-screen DesignCanvas. `shaderFillPreview` has zero
// occurrences in MultiScreenCanvas.tsx and shaderFillPreviewBridgeScript is
// injected only by DesignCanvas, so in the overview the editor actually runs
// there is no code path to reach the element and background-image stays "none".
// `gradientEditTarget` appears 11x in BOTH canvases, so porting is the
// established pattern and this one was simply left behind — a feature port
// into the canvas, not a test fix.
test.fixme("shader fill preview opens when the paint surface is reachable", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button", { screenId: fileId });

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: /Shader Fills/ }).click();
  await expect(
    page.getByRole("button", { name: "Browse Shaders", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Browse Shaders" }).click();
  await expect(page.getByText("Shader fills", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mesh Gradient" }).click();
  await expect(page.getByText("Animate", { exact: false })).toBeVisible();
  await expect
    .poll(() => selectedElementBackgroundImage(page))
    .toContain("linear-gradient");

  const shaderPreview = page
    .locator("canvas, div[style*='aspect-ratio']")
    .first();
  await expect(shaderPreview).toBeVisible();
  const box = await shaderPreview.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(80);
  expect(box?.height ?? 0).toBeGreaterThan(40);
});

test("DesignCanvas preserves source-token literals and installs its bridge", async ({
  page,
}) => {
  const headToken = "__INITIAL_SOURCE_HEAD__";
  const ownershipToken = "__INITIAL_SOURCE_OWNERSHIP__";
  const bodyClass = `${headToken} ${ownershipToken}`;
  const bodyStyle = `--source-head-token: ${headToken}; --source-ownership-token: ${ownershipToken};`;
  const probeClass = ownershipToken;
  const probeStyle = `--source-head-token: ${headToken}; --source-ownership-token: ${ownershipToken};`;
  const authoredHtml = `<!doctype html>
<html>
  <head>
    <meta name="source-token-head-probe" content="${ownershipToken}">
    <meta name="source-token-head-literal" content="${headToken}">
  </head>
  <body class="${bodyClass}" style="${bodyStyle}">
    <button id="source-token-probe" data-agent-native-node-id="source-token-probe" class="${probeClass}" style="${probeStyle}">Bridge ready</button>
  </body>
</html>`;

  await postAction(page.request, "update-file", {
    id: fileId,
    content: authoredHtml,
  });
  await gotoEditor(page, designId);

  const frame = designFrame(page, fileId);
  const body = frame.locator("body");
  const bridgeReady = () =>
    body.evaluate((element) => {
      const frameWindow = element.ownerDocument.defaultView as
        | (Window & { __anEditorChromeBridge?: boolean })
        | null;
      return frameWindow?.__anEditorChromeBridge === true;
    });

  await expect(frame.locator("#source-token-probe")).toHaveText("Bridge ready");
  await expect.poll(bridgeReady).toBe(true);
  await expect(
    frame.locator('meta[name="source-token-head-probe"]'),
  ).toHaveAttribute("content", ownershipToken);
  await expect(
    frame.locator('meta[name="source-token-head-literal"]'),
  ).toHaveAttribute("content", headToken);
  await expect(body).toHaveAttribute("class", bodyClass);
  await expect(body).toHaveAttribute("style", bodyStyle);
  await expect(frame.locator("#source-token-probe")).toHaveAttribute(
    "class",
    probeClass,
  );
  await expect(frame.locator("#source-token-probe")).toHaveAttribute(
    "style",
    probeStyle,
  );
});
