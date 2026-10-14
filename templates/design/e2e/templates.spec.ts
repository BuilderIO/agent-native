import type { APIRequestContext, Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, openAppMenuSubmenu } from "./helpers";
import { expect, test } from "./rails";

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

    await openAppMenuSubmenu(page, "File");
    await page
      .getByRole("menuitem", { name: "Save as template…", exact: true })
      .click();

    const saveDialog = page.getByRole("dialog", {
      name: "Save as template…",
      exact: true,
    });
    await saveDialog
      .getByRole("textbox", { name: "Template name" })
      .fill(savedTitle);
    await saveDialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Social", exact: true }).click();

    const saveTemplateResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith("/_agent-native/actions/save-design-as-template") &&
        response.request().method() === "POST",
    );
    await saveDialog
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    const saveTemplateResponseResult = await saveTemplateResponse;
    expect(saveTemplateResponseResult.ok()).toBe(true);
    expect(saveTemplateResponseResult.request().postDataJSON()).toMatchObject({
      designId: createdDesignId,
      title: savedTitle,
      category: "social",
    });

    const savedTemplate = await saveTemplateResponseResult.json();
    savedTemplateId = savedTemplate.id ?? savedTemplate.data?.id;
    expect(savedTemplateId).toBeTruthy();
    expect(savedTemplate).toMatchObject({
      width: 1080,
      height: 1920,
      lockedLayerCount: 2,
    });
    expect(savedTemplate.fileCount).toBeGreaterThanOrEqual(1);

    const persistedDesign = await getAction(request, "get-design", {
      id: createdDesignId!,
    });
    const persistedScreen = persistedDesign.files.find(
      (file: { filename?: string }) => file.filename === "event-story.html",
    );
    expect(persistedScreen).toBeTruthy();
    expect(persistedScreen.content).toContain(
      'data-agent-native-layer-name="Background"',
    );
    expect(persistedScreen.content).toContain(
      'data-agent-native-layer-name="Logo"',
    );
    expect(
      persistedScreen.content.match(/data-agent-native-locked="true"/g),
    ).toHaveLength(2);

    const persistedTemplate = await getAction(request, "get-design-template", {
      templateId: savedTemplateId!,
    });
    expect(persistedTemplate).toMatchObject({
      templateId: savedTemplateId,
      title: savedTitle,
      category: "social",
      fileCount: savedTemplate.fileCount,
    });
    const persistedTemplateScreen = persistedTemplate.files.find(
      (file: { filename?: string }) => file.filename === "event-story.html",
    );
    expect(persistedTemplateScreen).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(persistedTemplateScreen.lockedLayers).toHaveLength(2);

    await page.goto(appPath(`/templates?templateId=${savedTemplateId}`), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("load");
    await expect(page).toHaveURL(/\/templates\?templateId=/);
    const selectedTemplatePreview = page.getByRole("dialog", {
      name: savedTitle,
      exact: true,
    });
    await expect(selectedTemplatePreview).toBeVisible({ timeout: 15_000 });
    await expect(selectedTemplatePreview).toContainText(savedTitle);
    await page.keyboard.press("Escape");
    await expect(selectedTemplatePreview).toBeHidden({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/(?:\?|&)templateId=/);
    await page
      .getByRole("textbox", { name: "Search templates...", exact: true })
      .fill(savedTitle);
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

test("the Home Templates tab opens a fresh copy of a built-in template in the editor with its screen rendered", async ({
  app,
  page,
}) => {
  await page.goto(appPath("/home"), { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Templates", exact: true }).click();
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
  const response = await createResponse;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({
    templateId: "preset-social-story",
  });
  const designId: string = (await response.json()).id;
  app.adopt(designId);

  await expect(page).toHaveURL(new RegExp(`/design/${designId}(?:[?#].*)?$`));
  await expect(app.node("headline")).toBeVisible();
  await expect(app.node("template-logo")).toHaveAttribute(
    "data-agent-native-locked",
    "true",
  );
  await expect(app.node("template-background")).toHaveAttribute(
    "data-agent-native-locked",
    "true",
  );
  const saved = await app.savedRecord(designId);
  expect(saved.data?.templateSource).toMatchObject({
    templateId: "preset-social-story",
    title: "Event story — vertical",
    category: "social",
  });
  expect(
    saved.files
      .map((file) => file.filename)
      .filter((name) => name !== "__board__.html"),
  ).toStrictEqual(["event-story.html"]);
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
    expect(persisted.designSystemId).toBeNull();
    expect(JSON.parse(persisted.data).templateSource).toMatchObject({
      templateId: sourceTemplateId,
      templateDesignSystemId: designSystemId,
      appliedDesignSystemId: null,
      designSystemOverridden: true,
    });
    expect(
      persisted.files.map((file: { filename: string; content: string }) => [
        file.filename,
        file.content.replace(/ data-agent-native-node-id="[^"]*"/g, ""),
      ]),
      "the template's screen is still copied, apart from the node ids the copy mints",
    ).toStrictEqual([
      ["index.html", "<html><body><main>Template source</main></body></html>"],
    ]);

    const template = await getAction(request, "get-design-template", {
      templateId: sourceTemplateId!,
    });
    expect(
      template.designSystemId,
      "the template keeps its design system",
    ).toBe(designSystemId);
    const source = await getAction(request, "get-design", {
      id: sourceDesignId!,
    });
    expect(
      source.designSystemId,
      "the source design keeps its design system",
    ).toBe(designSystemId);
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
