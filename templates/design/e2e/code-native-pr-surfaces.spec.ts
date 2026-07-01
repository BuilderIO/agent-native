import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Response,
} from "@playwright/test";

import { FIXTURE_HTML, seedComponentVariantMetadata } from "./global-setup";
import { designFrame, gotoEditor, selectByText } from "./helpers";

let designId: string;
let baseURLForActions: string;

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

test.beforeAll(async ({ request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";

  const created = await postAction(request, "create-design", {
    title: "E2E Code-Native Design Studio",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) {
    throw new Error(`create-design did not return an id: ${created}`);
  }

  await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE_HTML,
    fileType: "html",
  });
  await postAction(request, "index-components", { designId });
  await seedComponentVariantMetadata(designId);
});

test.afterAll(async ({ request }) => {
  if (!designId) return;
  await postAction(request, "delete-design", { id: designId }).catch(() => {});
});

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
});

async function selectedElementBackgroundImage(page: Page): Promise<string> {
  return designFrame(page)
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

async function selectedComponentVariant(page: Page): Promise<string | null> {
  return designFrame(page)
    .locator('[data-agent-native-node-id="e2e-component-button"]')
    .getAttribute("data-agent-native-prop-variant");
}

async function tokenSampleBackground(page: Page): Promise<string> {
  return designFrame(page)
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
  const payload = await selectByText(page, "Variant CTA");
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
  await selectByText(page, "Variant CTA");
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
  const reviewToggle = page.getByRole("button", {
    name: "Review",
    exact: true,
  });
  await reviewToggle.scrollIntoViewIfNeeded();
  await expect(reviewToggle).toBeVisible();
  await reviewToggle.click();

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
      designFrame(page)
        .locator('[data-agent-native-node-id="e2e-audit-focus-button"]')
        .getAttribute("class"),
    )
    .toContain("focus-visible:ring-2");

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page)
        .locator('[data-agent-native-node-id="e2e-audit-focus-button"]')
        .getAttribute("class"),
    )
    .toContain("focus-visible:ring-2");
});

test("Motion dock autosaves track edits to CSS and reopens them", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");

  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);
  const motionRailButton = page.getByRole("button", {
    name: "Motion",
    exact: true,
  });
  await expect(motionRailButton).toBeVisible();
  await expect
    .poll(async () => {
      const [triggerBox, railBox] = await Promise.all([
        motionRailButton.boundingBox(),
        page.locator('nav[aria-label="Design workspace"]').boundingBox(),
      ]);
      if (!triggerBox || !railBox) return false;
      return (
        triggerBox.x >= railBox.x &&
        triggerBox.x + triggerBox.width <= railBox.x + railBox.width &&
        railBox.y + railBox.height - (triggerBox.y + triggerBox.height) <= 16
      );
    })
    .toBe(true);
  await motionRailButton.click();
  await expect(page.locator('[aria-label="Motion dock"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse motion dock", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const [dockCount, launcherVisible, dockState] = await Promise.all([
          page.locator('[aria-label="Motion dock"]').count(),
          motionRailButton.isVisible(),
          page
            .locator('[aria-label="Motion dock"]')
            .first()
            .evaluate((node) => {
              const element = node as HTMLElement;
              const style = window.getComputedStyle(element);
              return {
                height: element.style.height,
                opacity: style.opacity,
                position: style.position,
              };
            })
            .catch(() => null),
        ]);
        return (
          dockCount === 1 &&
          launcherVisible &&
          dockState?.height !== "0px" &&
          dockState?.opacity === "1" &&
          dockState?.position === "absolute"
        );
      },
      { timeout: 150, intervals: [20, 20, 20, 20, 20] },
    )
    .toBe(true);
  await expect(page.locator('[aria-label="Motion dock"]')).toHaveCount(0);
  await motionRailButton.click();
  await expect(page.locator('[aria-label="Motion dock"]')).toBeVisible();
  await expect(
    page.getByText("Pick a property to add the first track.", { exact: false }),
  ).toBeVisible();

  const motionDock = page.locator('[aria-label="Motion dock"]').first();
  await motionDock
    .getByRole("button", { name: "Add track", exact: true })
    .last()
    .click();
  const motionResponse = await waitForAction(
    page,
    "apply-motion-edit",
    async () => {
      await page
        .getByRole("menuitem", { name: "Fade (opacity)", exact: true })
        .click();
    },
  );
  const motionRequestBody = JSON.parse(
    motionResponse.request().postData() ?? "{}",
  ) as Record<string, unknown>;
  expect(motionRequestBody.includeContent).toBe(false);
  expect(
    ((await motionResponse.json()) as Record<string, unknown>).patchedContent,
  ).toBeUndefined();
  await expect(
    motionDock.getByRole("button", { name: "Alpha Button" }),
  ).toBeVisible();
  await expect(page.getByText("opacity", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Keyframe at 0%")).toBeVisible();
  await expect(page.getByLabel("Keyframe at 100%")).toBeVisible();

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page).locator("style[data-agent-native-motion]").count(),
    )
    .toBe(1);
  await expect
    .poll(() =>
      designFrame(page)
        .locator("style[data-agent-native-motion]")
        .first()
        .textContent(),
    )
    .toContain("e2e-alpha-button");

  const reopenMotionDockButton = page.getByRole("button", {
    name: "Motion",
    exact: true,
  });
  await expect(reopenMotionDockButton).toBeVisible();
  await reopenMotionDockButton.click();
  await expect(
    motionDock.getByRole("button", { name: "Alpha Button" }),
  ).toBeVisible();
  await expect(page.getByText("opacity", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Keyframe at 0%")).toBeVisible();
  await expect(page.getByLabel("Keyframe at 100%")).toBeVisible();

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page).locator("style[data-agent-native-motion]").count(),
    )
    .toBe(1);
});

test("shader fill preview opens when the paint surface is reachable", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");

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
