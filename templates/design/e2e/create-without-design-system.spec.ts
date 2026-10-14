import { expect, test } from "@playwright/test";

import { appPath } from "./helpers";

test("create-design preserves an explicit no-system choice", async ({
  request,
}) => {
  let designId: string | undefined;

  try {
    const response = await request.post(
      appPath("/_agent-native/actions/create-design"),
      {
        data: {
          title: `QA no-system design ${Date.now()}`,
          designSystemId: null,
        },
      },
    );
    expect(response.ok()).toBe(true);

    const created = await response.json();
    const createdId = created.id;
    if (typeof createdId !== "string" || !createdId) {
      throw new Error("create-design response did not include an id");
    }
    designId = createdId;
    expect(created).toHaveProperty("designSystemId", null);

    const saved = await request.get(
      appPath("/_agent-native/actions/get-design"),
      { params: { id: createdId } },
    );
    expect(saved.ok()).toBe(true);
    expect(await saved.json()).toHaveProperty("designSystemId", null);
  } finally {
    if (designId) {
      await request
        .post(appPath("/_agent-native/actions/delete-design"), {
          data: { id: designId },
        })
        .catch(() => {});
    }
  }
});

test("Home creates a blank design without a system and reloads it", async ({
  page,
  request,
}) => {
  let designId: string | undefined;

  try {
    await page.goto(appPath("/home"), { waitUntil: "domcontentloaded" });

    const skipPrompt = page.getByRole("button", {
      name: "Skip prompt",
      exact: true,
    });
    await expect(skipPrompt).toBeVisible({ timeout: 30_000 });

    const creation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/_agent-native/actions/create-design"),
    );
    await skipPrompt.click();

    const response = await creation;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toHaveProperty(
      "designSystemId",
      null,
    );

    const created = await response.json();
    const createdId = created.id;
    if (typeof createdId !== "string" || !createdId) {
      throw new Error("create-design response did not include an id");
    }
    designId = createdId;

    const editorUrl = new RegExp(`/design/${createdId}$`);
    await expect(page).toHaveURL(editorUrl, { timeout: 30_000 });
    const moveTool = page.getByRole("button", {
      name: "Move",
      exact: true,
    });
    await expect(moveTool).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(editorUrl);
    await expect(moveTool).toBeVisible({ timeout: 30_000 });

    const saved = await request.get(
      appPath("/_agent-native/actions/get-design"),
      { params: { id: createdId } },
    );
    expect(saved.ok()).toBe(true);
    expect(await saved.json()).toHaveProperty("designSystemId", null);
  } finally {
    if (designId) {
      await request
        .post(appPath("/_agent-native/actions/delete-design"), {
          data: { id: designId },
        })
        .catch(() => {});
    }
  }
});
