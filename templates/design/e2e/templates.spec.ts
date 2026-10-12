import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

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

async function getAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = e2eBaseURL();
  const params = new URLSearchParams(
    Object.entries(input).map(([key, value]) => [key, String(value)]),
  );
  const response = await request.get(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}?${params}`,
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

function watchBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    );
  });

  return { consoleErrors, pageErrors, failedResponses, failedRequests };
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

test("built-in template preserves its dimensions and locks and can be saved again", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const browserErrors = watchBrowserErrors(page);
  let createdDesignId: string | undefined;
  let savedTemplateId: string | undefined;
  const savedTitle = `E2E saved social template ${Date.now()}`;

  try {
    await page.goto(appPath("/templates"), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");

    const createResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/_agent-native/actions/create-design-from-template") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Event story — vertical", exact: true })
      .click();
    const createResponseResult = await createResponse;
    expect(createResponseResult.ok()).toBe(true);
    expect(createResponseResult.request().postDataJSON()).toMatchObject({
      templateId: "preset-social-story",
    });

    const created = await createResponseResult.json();
    createdDesignId = created.id ?? created.data?.id ?? created.design?.id;
    expect(createdDesignId).toBeTruthy();
    await page.waitForURL(/\/design\/[^/?#]+(?:[?#].*)?$/, {
      timeout: 30_000,
    });
    expect(page.url()).toContain(`/design/${createdDesignId}`);
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const copiedDesign = await getAction(request, "get-design", {
      id: createdDesignId!,
    });
    const designData = JSON.parse(copiedDesign.data || "{}");
    expect(designData.templateSource).toMatchObject({
      templateId: "preset-social-story",
      title: "Event story — vertical",
      category: "social",
    });
    expect(designData.templateSource.files).toContainEqual(
      expect.objectContaining({
        filename: "event-story.html",
        width: 1080,
        height: 1920,
      }),
    );
    const copiedScreen = copiedDesign.files.find(
      (file: { filename?: string }) => file.filename === "event-story.html",
    );
    expect(copiedScreen).toBeTruthy();
    expect(copiedScreen.content).toContain(
      'data-agent-native-layer-name="Background"',
    );
    expect(copiedScreen.content).toContain(
      'data-agent-native-layer-name="Logo"',
    );
    expect(
      copiedScreen.content.match(/data-agent-native-locked="true"/g),
    ).toHaveLength(2);

    const savedTemplate = await postAction(request, "save-design-as-template", {
      designId: createdDesignId,
      title: savedTitle,
      category: "social",
    });
    savedTemplateId = savedTemplate.id ?? savedTemplate.data?.id;
    expect(savedTemplateId).toBeTruthy();
    expect(savedTemplate).toMatchObject({
      width: 1080,
      height: 1920,
      lockedLayerCount: 2,
    });
    expect(savedTemplate.fileCount).toBeGreaterThanOrEqual(1);

    await page.goto(
      appPath(`/templates?search=${encodeURIComponent(savedTitle)}`),
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: savedTitle, exact: true }),
    ).toBeVisible();

    expect(browserErrors.consoleErrors).toEqual([]);
    expect(browserErrors.pageErrors).toEqual([]);
    expect(browserErrors.failedResponses).toEqual([]);
    expect(browserErrors.failedRequests).toEqual([]);
  } finally {
    if (savedTemplateId) {
      await postAction(request, "delete-design-template", {
        id: savedTemplateId,
      }).catch(() => {});
    }
    if (createdDesignId) {
      await postAction(request, "delete-design", { id: createdDesignId }).catch(
        () => {},
      );
    }
  }
});

test("home Templates tab opens a built-in template design", async ({
  page,
  request,
}) => {
  let createdDesignId: string | undefined;

  try {
    await page.goto(appPath("/home"), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await page.getByRole("tab", { name: "Templates", exact: true }).click();
    const templateCard = page.getByRole("button", {
      name: "Event story — vertical",
      exact: true,
    });
    await expect(templateCard).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/_agent-native/actions/create-design-from-template") &&
        response.request().method() === "POST",
    );
    await templateCard.click();
    const response = await createResponse;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({
      templateId: "preset-social-story",
    });

    const created = await response.json();
    createdDesignId = created.id ?? created.data?.id ?? created.design?.id;
    expect(createdDesignId).toBeTruthy();
    await page.waitForURL(/\/design\/[^/?#]+(?:[?#].*)?$/, {
      timeout: 30_000,
    });
    expect(page.url()).toContain(`/design/${createdDesignId}`);
    const design = await getAction(request, "get-design", {
      id: createdDesignId!,
    });
    expect(JSON.parse(design.data || "{}").templateSource).toMatchObject({
      templateId: "preset-social-story",
      title: "Event story — vertical",
    });
    expect(
      design.files.map((file: { filename: string }) => file.filename),
    ).toContain("event-story.html");
  } finally {
    if (createdDesignId) {
      await postAction(request, "delete-design", { id: createdDesignId }).catch(
        () => {},
      );
    }
  }
});

test("home composer persists a selected design system on a blank design", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
    "requires E2E_AI_SIDEBAR_LOOPBACK=1",
  );
  test.setTimeout(120_000);
  await configureHomeComposerLoopback(page);
  let restoreDesignSystemWorkflows: (() => Promise<void>) | undefined;
  let designSystemId: string | undefined;
  let designId: string | undefined;
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
    await page.waitForLoadState("load");
    await expect(
      page.getByRole("button", { name: "Skip prompt", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const picker = await openHomeDesignSystemPicker(page);
    await picker.getByRole("radio", { name: systemTitle, exact: true }).click();
    await expect(picker).toBeHidden();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/_agent-native/actions/create-design") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Skip prompt", exact: true })
      .click();
    const response = await createResponse;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toHaveProperty(
      "designSystemId",
      designSystemId,
    );

    const created = await response.json();
    designId = created.id ?? created.data?.id ?? created.design?.id;
    expect(designId).toBeTruthy();
    const editorUrl = new RegExp(`/design/${designId}(?:[?#].*)?$`);
    await expect(page).toHaveURL(editorUrl, { timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    expect(
      (await getAction(request, "get-design", { id: designId! }))
        .designSystemId,
    ).toBe(designSystemId);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(editorUrl);
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    expect(
      (await getAction(request, "get-design", { id: designId! }))
        .designSystemId,
    ).toBe(designSystemId);
  } finally {
    if (designId) {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
    if (designSystemId) {
      await postAction(request, "delete-design-system", {
        id: designSystemId,
      }).catch(() => {});
    }
    await restoreDesignSystemWorkflows?.();
  }
});

test("home composer persists a cleared design system on a blank design", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
    "requires E2E_AI_SIDEBAR_LOOPBACK=1",
  );
  test.setTimeout(120_000);
  await configureHomeComposerLoopback(page);
  let restoreDesignSystemWorkflows: (() => Promise<void>) | undefined;
  let designSystemId: string | undefined;
  let designId: string | undefined;
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
    await page.waitForLoadState("load");
    await expect(
      page.getByRole("button", { name: "Skip prompt", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    let picker = await openHomeDesignSystemPicker(page);
    await picker.getByRole("radio", { name: systemTitle, exact: true }).click();
    await expect(picker).toBeHidden();

    picker = await openHomeDesignSystemPicker(page);
    await expect(
      picker.getByRole("button", { name: "None", exact: true }),
    ).toBeVisible();
    await picker.getByRole("button", { name: "None", exact: true }).click();
    await expect(picker).toBeHidden();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/_agent-native/actions/create-design") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Skip prompt", exact: true })
      .click();
    const response = await createResponse;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toHaveProperty(
      "designSystemId",
      null,
    );

    const created = await response.json();
    designId = created.id ?? created.data?.id ?? created.design?.id;
    expect(designId).toBeTruthy();
    const editorUrl = new RegExp(`/design/${designId}(?:[?#].*)?$`);
    await expect(page).toHaveURL(editorUrl, { timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    expect(
      (await getAction(request, "get-design", { id: designId! }))
        .designSystemId ?? null,
    ).toBeNull();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(editorUrl);
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    expect(
      (await getAction(request, "get-design", { id: designId! }))
        .designSystemId ?? null,
    ).toBeNull();
  } finally {
    if (designId) {
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    }
    if (designSystemId) {
      await postAction(request, "delete-design-system", {
        id: designSystemId,
      }).catch(() => {});
    }
    await restoreDesignSystemWorkflows?.();
  }
});

test("template copy clears a linked design system when explicitly requested", async ({
  page,
  request,
}) => {
  let restoreDesignSystemWorkflows: (() => Promise<void>) | undefined;
  let designSystemId: string | undefined;
  let sourceDesignId: string | undefined;
  let sourceTemplateId: string | undefined;
  let createdDesignId: string | undefined;

  try {
    restoreDesignSystemWorkflows =
      await enableDesignSystemWorkflowsAndRestore(page);
    const designSystem = await postAction(request, "create-design-system", {
      templateId: "material-3",
      title: `E2E system for template override ${Date.now()}`,
    });
    designSystemId = designSystem.id;
    expect(designSystemId).toBeTruthy();

    const sourceDesign = await postAction(request, "create-design", {
      title: `E2E linked template source ${Date.now()}`,
      projectType: "prototype",
      designSystemId,
    });
    sourceDesignId = sourceDesign.id;
    expect(sourceDesign).toHaveProperty("designSystemId", designSystemId);
    await postAction(request, "create-file", {
      designId: sourceDesignId,
      filename: "index.html",
      content: "<html><body><main>Template source</main></body></html>",
      fileType: "html",
    });

    const sourceTemplate = await postAction(
      request,
      "save-design-as-template",
      {
        designId: sourceDesignId,
        title: `E2E linked template ${Date.now()}`,
        category: "other",
      },
    );
    sourceTemplateId = sourceTemplate.id;
    expect(sourceTemplateId).toBeTruthy();

    const created = await postAction(request, "create-design-from-template", {
      templateId: sourceTemplateId,
      title: `E2E no-system copy ${Date.now()}`,
      designSystemId: null,
    });
    createdDesignId = created.id ?? created.data?.id;
    expect(createdDesignId).toBeTruthy();
    expect(created).toMatchObject({
      designSystemId: null,
      designSystemOverridden: true,
    });

    const persisted = await getAction(request, "get-design", {
      id: createdDesignId!,
    });
    expect(persisted.designSystemId ?? null).toBeNull();
  } finally {
    if (createdDesignId) {
      await postAction(request, "delete-design", { id: createdDesignId }).catch(
        () => {},
      );
    }
    if (sourceTemplateId) {
      await postAction(request, "delete-design-template", {
        id: sourceTemplateId,
      }).catch(() => {});
    }
    if (sourceDesignId) {
      await postAction(request, "delete-design", { id: sourceDesignId }).catch(
        () => {},
      );
    }
    if (designSystemId) {
      await postAction(request, "delete-design-system", {
        id: designSystemId,
      }).catch(() => {});
    }
    await restoreDesignSystemWorkflows?.();
  }
});
