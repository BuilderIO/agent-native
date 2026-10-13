import { type APIRequestContext, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";
import { expect, test, type App } from "./rails";

async function setFeatureFlagRules(
  page: Page,
  key: string,
  rules: Record<string, unknown>,
) {
  const response = await page.request.post(
    `${e2eBaseURL()}/_agent-native/actions/set-feature-flag`,
    { data: { operation: "replace-rules", key, rules } },
  );
  if (!response.ok()) {
    throw new Error(
      `set-feature-flag failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function enableDesignSystemWorkflowsAndRestore(
  page: Page,
): Promise<() => Promise<void>> {
  const response = await page.request.get(
    `${e2eBaseURL()}/_agent-native/actions/list-feature-flags`,
  );
  if (!response.ok()) {
    throw new Error(
      `list-feature-flags failed: ${response.status()} ${await response.text()}`,
    );
  }
  const listed = await response.json();
  const key = "design-system-workflows";
  const currentRules = listed.flags?.find(
    (flag: { key: string }) => flag.key === key,
  )?.rules;
  if (!currentRules || !["off", "on", "rules"].includes(currentRules.mode)) {
    throw new Error(`list-feature-flags did not return rules for ${key}`);
  }
  const previousRules = {
    mode: currentRules.mode,
    ...(currentRules.emails !== undefined && {
      emails: currentRules.emails,
    }),
    ...(currentRules.orgIds !== undefined && {
      orgIds: currentRules.orgIds,
    }),
    ...(currentRules.percentage !== undefined && {
      percentage: currentRules.percentage,
    }),
  };

  await setFeatureFlagRules(page, key, { mode: "on" });
  return async () => {
    const restored = await setFeatureFlagRules(page, key, previousRules);
    expect(restored.rules).toMatchObject(previousRules);
  };
}

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = e2eBaseURL();
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function savedDesignSystemId(app: App, designId: string) {
  const record = (await app.savedRecord(designId)) as unknown as {
    designSystemId?: string | null;
  };
  return record.designSystemId ?? null;
}

function composerContextChip(page: Page, title: string) {
  return page
    .locator("[data-design-home-composer]")
    .getByText(title, { exact: true });
}

async function openHomeDesignSystemPicker(page: Page) {
  await page
    .locator("[data-design-home-composer]")
    .getByRole("button", { name: "Add context", exact: true })
    .click();
  const addContext = page.getByRole("menuitem", {
    name: "Add context",
    exact: true,
  });
  await expect(addContext).toBeVisible();
  await addContext.press("ArrowRight");
  const design = page.getByRole("menuitem", { name: "Design", exact: true });
  await expect(design).toBeVisible();
  await design.press("ArrowRight");
  const useDesignSystem = page.getByRole("menuitem", {
    name: "Use a design system",
    exact: true,
  });
  await expect(useDesignSystem).toBeVisible({ timeout: 30_000 });
  await useDesignSystem.click();

  const dialog = page.getByRole("dialog", {
    name: "Use a design system",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function skipPromptToNewDesign(app: App, page: Page) {
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/_agent-native/actions/create-design") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Skip prompt", exact: true }).click();
  const created = await (await createResponse).json();
  const designId: string = created.id ?? created.data?.id ?? created.design?.id;
  expect(designId).toBeTruthy();
  app.adopt(designId);
  await expect(page).toHaveURL(new RegExp(`/design/${designId}(?:[?#].*)?$`), {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  return designId;
}

async function configureHomeComposerLoopback(page: Page) {
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });
}

// fixme: needs a different environment: Its assertions pass. The loopback model's canned reply isn't valid home-suggestions JSON, so generate-home-suggestions
test.fixme("home context actions wait for the organization draft scope", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await configureHomeComposerLoopback(page);
  let releaseOrganization!: () => void;
  const organizationGate = new Promise<void>((resolve) => {
    releaseOrganization = resolve;
  });
  let organizationRequested!: () => void;
  const organizationRequest = new Promise<void>((resolve) => {
    organizationRequested = resolve;
  });
  await page.route(/\/_agent-native\/org\/me(?:\?|$)/, async (route) => {
    organizationRequested();
    await organizationGate;
    await route.continue();
  });
  try {
    await page.goto(appPath("/home"), { waitUntil: "domcontentloaded" });
    await organizationRequest;
    const addContext = page
      .locator("[data-design-home-composer]")
      .getByRole("button", { name: "Add context", exact: true });
    await expect(addContext).toBeVisible({ timeout: 30_000 });
    await expect(addContext).toBeDisabled();
    releaseOrganization();
    await expect(addContext).toBeEnabled({ timeout: 30_000 });
    await addContext.click();
    await expect(
      page.getByRole("menuitem", { name: "Add context", exact: true }),
    ).toBeVisible();
  } finally {
    releaseOrganization();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("home composer persists a selected design system on a blank design", async ({
  app,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await configureHomeComposerLoopback(page);
  let restoreDesignSystemWorkflows: (() => Promise<void>) | undefined;
  let designSystemId: string | undefined;
  const systemTitle = `E2E selected home system ${Date.now()}`;

  try {
    restoreDesignSystemWorkflows =
      await enableDesignSystemWorkflowsAndRestore(page);
    const system = await postAction(request, "create-design-system", {
      templateId: "material-3",
      title: systemTitle,
    });
    designSystemId = system.id ?? system.data?.id;
    expect(designSystemId).toBeTruthy();

    await page.goto(appPath("/home"), { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Skip prompt", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(composerContextChip(page, systemTitle)).toHaveCount(0);

    const picker = await openHomeDesignSystemPicker(page);
    await picker.getByRole("radio", { name: systemTitle, exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(
      composerContextChip(page, systemTitle),
      "precondition: the chosen system shows as composer context",
    ).toBeVisible();

    const designId = await skipPromptToNewDesign(app, page);

    await app.settled();
    expect(await savedDesignSystemId(app, designId)).toBe(designSystemId);
  } finally {
    if (designSystemId) {
      await postAction(request, "delete-design-system", {
        id: designSystemId,
      }).catch(() => {});
    }
    await restoreDesignSystemWorkflows?.();
  }
});

test("home composer persists a cleared design system on a blank design", async ({
  app,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await configureHomeComposerLoopback(page);
  let restoreDesignSystemWorkflows: (() => Promise<void>) | undefined;
  let designSystemId: string | undefined;
  const systemTitle = `E2E cleared home system ${Date.now()}`;

  try {
    restoreDesignSystemWorkflows =
      await enableDesignSystemWorkflowsAndRestore(page);
    const system = await postAction(request, "create-design-system", {
      templateId: "material-3",
      title: systemTitle,
    });
    designSystemId = system.id ?? system.data?.id;
    expect(designSystemId).toBeTruthy();

    await page.goto(appPath("/home"), { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Skip prompt", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    let picker = await openHomeDesignSystemPicker(page);
    await picker.getByRole("radio", { name: systemTitle, exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(
      composerContextChip(page, systemTitle),
      "precondition: the chosen system shows as composer context",
    ).toBeVisible();

    picker = await openHomeDesignSystemPicker(page);
    await picker.getByRole("button", { name: "None", exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(composerContextChip(page, systemTitle)).toHaveCount(0);

    const designId = await skipPromptToNewDesign(app, page);

    await app.settled();
    expect(await savedDesignSystemId(app, designId)).toBeNull();
  } finally {
    if (designSystemId) {
      await postAction(request, "delete-design-system", {
        id: designSystemId,
      }).catch(() => {});
    }
    await restoreDesignSystemWorkflows?.();
  }
});
