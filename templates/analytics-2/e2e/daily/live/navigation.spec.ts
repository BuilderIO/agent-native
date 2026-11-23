import { safeRequest } from "../../safe-request.js";
import { expect, test } from "./fixtures";

test("VIEWS-09 row 125 account Help links", async ({ page, base }) => {
  const { checkAccountMenu } = await import("../../account-menu");
  await checkAccountMenu(page, base);
});

test("report M5-1117-LIVE-DAILY-HARNESS: Home composer accepts a draft and recents load", async ({
  page,
  base,
}) => {
  await page.goto(`${base}/home`);
  await expect(page).toHaveURL(`${base}/home`);
  await expect(
    page.getByText("JUMP BACK IN", { exact: false }).first(),
  ).toBeVisible();
  const editor = page.locator(
    '[data-agent-composer-variant="hero"][data-agent-composer-slot="editor-input"]',
  );
  await expect(editor).toBeEditable();
  await editor.click();
  await expect(editor).toBeFocused({ timeout: 400 });
  await editor.fill("QA draft, do not send");
  await expect(editor).toHaveText("QA draft, do not send", { timeout: 400 });
});

test("report M5-1117-LIVE-DAILY-HARNESS: Archive help and filters render at the registered route", async ({
  page,
  base,
}) => {
  await page.setViewportSize({ width: 945, height: 1000 });
  await page.goto(`${base}/home/archive`);
  await expect(page).toHaveURL(`${base}/home/archive`);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Archive", exact: true }),
  ).toBeVisible();
  const help = main.getByText(
    "Archive projects and components to declutter a workspace, without losing your work.",
    { exact: false },
  );
  await expect(
    help.getByRole("link", { name: "Learn more", exact: true }),
  ).toBeVisible();
  const helpBox = await help.boundingBox();
  const toolbarBox = await main
    .getByRole("button", { name: "Filter", exact: true })
    .boundingBox();
  if (!helpBox || !toolbarBox) throw new Error("Archive layout missing");
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(toolbarBox.y);
});

test("report M5-1117-LIVE-DAILY-HARNESS: Thread opens a fresh composer without submitting", async ({
  page,
  context,
  base,
}) => {
  await page.goto(`${base}/home`);
  const settled = page
    .waitForResponse(
      (response) =>
        response.url().endsWith("/_agent-native/actions/create-thread") &&
        response.request().method() === "POST",
      { timeout: 15_000 },
    )
    .then(async (response) => {
      if (!response.ok())
        throw new Error(`Create thread HTTP ${response.status()}`);
      const result = await response.json();
      if (typeof result.id !== "string" || !result.id)
        throw new Error("Create thread returned no id");
      return result.id as string;
    })
    .then(
      (id) => ({ id, error: null }),
      (error: unknown) => ({ id: null, error }),
    );
  try {
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    const outcome = await settled;
    if (!outcome.id)
      throw new Error("Create thread outcome unreadable", {
        cause: outcome.error,
      });
    await expect(page).toHaveURL(
      `${base}/thread/${encodeURIComponent(outcome.id)}`,
    );
    const editor = page
      .locator(
        '[data-agent-composer-slot="editor-input"][contenteditable="true"]',
      )
      .last();
    await expect(editor).toBeEditable();
    await expect(editor).toHaveText("");
  } finally {
    const outcome = await settled;
    await page.close();
    if (!outcome.id)
      throw new Error(
        "Thread creation outcome unknown; inspect QA workspace before retrying",
        { cause: outcome.error },
      );
    const threadId = outcome.id;
    const deleted = await safeRequest(
      "POST /_agent-native/actions/delete-thread",
      () =>
        context.request.post(`${base}/_agent-native/actions/delete-thread`, {
          data: { threadId },
        }),
    );
    if (!deleted.ok())
      throw new Error(`Delete QA thread ${threadId} HTTP ${deleted.status()}`);
    const receipt = await deleted.json();
    if (receipt.id !== threadId || receipt.deleted !== true)
      throw new Error(`Delete QA thread ${threadId} was not acknowledged`);
    const readback = await safeRequest(
      "GET /_agent-native/actions/get-thread-summary",
      () =>
        context.request.get(
          `${base}/_agent-native/actions/get-thread-summary`,
          { params: { threadId } },
        ),
    );
    if (readback.status() !== 404)
      throw new Error(
        `Deleted QA thread ${threadId} readback HTTP ${readback.status()}`,
      );
  }
});
