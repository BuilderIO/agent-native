import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath } from "./helpers";

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9333";
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
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9333";
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

test("starter template preserves its dimensions and locks and can be saved again", async ({
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

    await expect(
      page.getByRole("link", { name: "Templates", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Starter templates", exact: true }),
    ).toBeVisible();
    await expect(page.locator("article")).toHaveCount(4);

    const starterCard = page.locator("article").filter({
      has: page.getByRole("heading", {
        name: "Social ad — square",
        exact: true,
      }),
    });
    await expect(starterCard).toContainText("1080 × 1080");
    await expect(starterCard).toContainText("2 locked");

    await starterCard
      .getByRole("button", { name: "Use template", exact: true })
      .click();

    const promptPopover = page.locator("[data-agent-native-prompt-popover]");
    await expect(promptPopover).toBeVisible();
    await expect(promptPopover).toContainText("Social ad — square");
    await expect(
      promptPopover.getByText("Use template as-is", { exact: true }),
    ).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/_agent-native/actions/create-design-from-template") &&
        response.request().method() === "POST",
    );
    await promptPopover
      .getByText("Use template as-is", { exact: true })
      .click();
    expect((await createResponse).ok()).toBe(true);

    await page.waitForURL(/\/design\/[^/?#]+(?:[?#].*)?$/, {
      timeout: 30_000,
    });
    createdDesignId = page.url().split("/design/").pop()?.split(/[?#]/)[0];
    expect(createdDesignId).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const copiedDesign = await getAction(request, "get-design", {
      id: createdDesignId!,
    });
    const designData = JSON.parse(copiedDesign.data || "{}");
    expect(designData.templateSource).toMatchObject({
      templateId: "preset-social-square",
      title: "Social ad — square",
      category: "social",
    });
    expect(Object.values(designData.canvasFrames ?? {})).toContainEqual(
      expect.objectContaining({ width: 1080, height: 1080 }),
    );
    expect(copiedDesign.files).toHaveLength(2);
    const copiedScreen = copiedDesign.files.find(
      (file: { filename?: string }) => file.filename === "social-square.html",
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

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Save as template…", exact: true })
      .click();

    const saveDialog = page.getByRole("dialog", {
      name: "Save as template…",
    });
    await expect(saveDialog).toBeVisible();
    await expect(saveDialog).toContainText(
      "1 screen(s) · 2 locked layer(s) will be preserved",
    );
    await saveDialog.getByLabel("Template name").fill(savedTitle);
    await saveDialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Social", exact: true }).click();

    const saveResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/_agent-native/actions/save-design-as-template") &&
        response.request().method() === "POST",
    );
    await saveDialog
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    const savedResponse = await saveResponse;
    expect(savedResponse.ok()).toBe(true);
    const savedPayload = await savedResponse.json();
    savedTemplateId = savedPayload.id ?? savedPayload.data?.id;
    expect(savedTemplateId).toBeTruthy();
    await expect(
      page
        .getByText("Template saved with 2 locked layer(s)", { exact: true })
        .first(),
    ).toBeVisible();

    await page.goto(appPath(`/templates?templateId=${savedTemplateId}`), {
      waitUntil: "domcontentloaded",
    });
    const savedCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: savedTitle, exact: true }),
    });
    await expect(savedCard).toBeVisible();
    await expect(savedCard).toContainText("1080 × 1080");
    await expect(savedCard).toContainText("2 locked");

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
