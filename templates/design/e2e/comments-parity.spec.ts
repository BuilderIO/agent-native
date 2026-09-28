import { expect, test } from "@playwright/test";

import { E2E_MENTION_EMAIL } from "./global-setup";
import { createFixtureDesign, designFrame, gotoEditor } from "./helpers";

test.use({ viewport: { width: 1440, height: 1000 } });

test("comments toolbar opens an anchored composer", async ({
  page,
}, testInfo) => {
  const designId = await createFixtureDesign(
    page,
    `E2E Comment Parity ${testInfo.workerIndex}-${testInfo.repeatEachIndex}`,
  );
  await gotoEditor(page, designId);

  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await expect(page.locator("[data-review-comments-panel]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();

  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Pin comment"]')
    .click();

  const clickPlane = page.locator(
    '[data-review-click-plane][data-review-click-plane-target]:not([data-review-click-plane-target="board"])',
  );
  await expect(clickPlane).toHaveCount(1);
  await expect(clickPlane).toBeVisible();
  const canvasBox = await clickPlane.boundingBox();
  if (!canvasBox) throw new Error("comment click plane has no layout box");
  const nestedNode = designFrame(page).locator(
    '[data-agent-native-node-id="e2e-deep-layer-button"]',
  );
  await expect(nestedNode).toBeVisible();
  const nestedNodeId = await nestedNode.getAttribute(
    "data-agent-native-node-id",
  );
  if (!nestedNodeId) throw new Error("nested comment target has no node id");
  const nestedBox = await nestedNode.boundingBox();
  if (!nestedBox) throw new Error("nested comment target has no layout box");
  const nestedPoint = {
    x: nestedBox.x + nestedBox.width * 0.9,
    y: nestedBox.y + nestedBox.height / 2,
  };
  await clickPlane.click({
    force: true,
    position: {
      x: nestedPoint.x - canvasBox.x,
      y: nestedPoint.y - canvasBox.y,
    },
  });

  const draftForm = page
    .locator('form:has(textarea[placeholder="Leave feedback…"])')
    .first();
  await expect(draftForm).toBeVisible();
  const composer = draftForm.locator('textarea[placeholder="Leave feedback…"]');
  await expect(composer).toBeVisible();
  const commentButton = draftForm.getByRole("button", {
    name: "Comment",
    exact: true,
  });
  await expect(commentButton).toBeDisabled();
  await composer.fill("Browser parity check ");
  await expect(
    page.getByRole("button", { name: "Mention someone", exact: true }),
  ).toBeVisible();
  await composer.press("@");
  const mentionMenu = page.getByRole("menu", { name: "Mention someone" });
  await expect(mentionMenu).toBeVisible();
  await expect(composer).toHaveValue("Browser parity check @");
  await composer.type("Ali");
  await expect(composer).toHaveValue("Browser parity check @Ali");
  await expect(
    mentionMenu.getByRole("textbox", { name: "Mention someone" }),
  ).toHaveValue("Ali");
  await expect(mentionMenu.getByRole("menuitem").first()).toBeVisible();
  await mentionMenu.getByRole("menuitem").first().click();
  await expect(composer).toHaveValue("Browser parity check @alice+e2e");

  const tools = draftForm.locator("[data-review-comment-tools]");
  const emojiButton = draftForm.getByRole("button", { name: "Add emoji" });
  const mentionButton = draftForm.getByRole("button", {
    name: "Mention someone",
  });
  const attachmentButton = draftForm.getByRole("button", {
    name: "Attach image",
  });
  const commentButtonBox = await commentButton.boundingBox();
  const toolsBox = await tools.boundingBox();
  const emojiBox = await emojiButton.boundingBox();
  const mentionBox = await mentionButton.boundingBox();
  const attachmentBox = await attachmentButton.boundingBox();
  const sendToAgent = draftForm.getByRole("button", { name: "Send to agent" });
  const sendToAgentBox = await sendToAgent.boundingBox();
  for (const [label, box] of [
    ["comment button", commentButtonBox],
    ["comment tools", toolsBox],
    ["emoji button", emojiBox],
    ["mention button", mentionBox],
    ["attachment button", attachmentBox],
    ["send-to-agent button", sendToAgentBox],
  ] as const) {
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(`${label} has no rendered layout box`);
    }
  }
  expect(emojiBox!.x).toBeLessThan(mentionBox!.x);
  expect(mentionBox!.x).toBeLessThan(attachmentBox!.x);
  expect(attachmentBox!.x).toBeGreaterThanOrEqual(toolsBox!.x);
  expect(attachmentBox!.x + attachmentBox!.width).toBeLessThanOrEqual(
    toolsBox!.x + toolsBox!.width,
  );

  await expect(commentButton).toBeEnabled();
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/create-review-comment") &&
      response.request().method() === "POST",
  );
  await commentButton.click();
  const created = await createResponse;
  expect(
    created.ok(),
    `create-review-comment returned ${created.status()}`,
  ).toBe(true);
  const createdComment = (await created.json()) as {
    id?: string;
    threadId?: string;
    anchor?: {
      nodeId?: string;
      relativePoint?: { xPct?: number; yPct?: number };
    };
    body?: string;
    mentions?: Array<{ email?: string; id?: string | null; label?: string }>;
  };
  expect(createdComment.id).toEqual(expect.any(String));
  expect(createdComment.threadId).toEqual(expect.any(String));
  expect(createdComment.anchor).toMatchObject({
    nodeId: nestedNodeId,
    relativePoint: {
      xPct: expect.any(Number),
      yPct: expect.any(Number),
    },
  });
  expect(createdComment.body).toBe("Browser parity check @alice+e2e");
  expect(createdComment.mentions).toEqual([
    { label: "alice+e2e", email: E2E_MENTION_EMAIL, id: null },
  ]);
  await expect(composer).toBeHidden();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("tab", { name: "Comments", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  const persistedPin = page.locator("[data-review-pin]").last();
  await expect(persistedPin).toBeVisible();
  await persistedPin.click();
  const threadPopover = page
    .locator("[data-review-popover]")
    .filter({ hasText: "Browser parity check @alice+e2e" })
    .last();
  await expect(threadPopover).toBeVisible();
  await expect(
    page
      .locator("[data-review-comments-panel] article")
      .getByText("Browser parity check @alice+e2e", { exact: true }),
  ).toBeVisible();

  const replyInput = page.locator("textarea[data-review-reply-input]:visible");
  await expect(replyInput).toHaveCount(1);
  await expect(replyInput).toBeVisible();
  await replyInput.fill("Browser parity reply");
  const replyResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/reply-review-comment") &&
      response.request().method() === "POST",
  );
  await replyInput.press("Enter");
  const replied = await replyResponse;
  expect(
    replied.ok(),
    `reply-review-comment returned ${replied.status()}`,
  ).toBe(true);
  const reply = (await replied.json()) as {
    id?: string;
    threadId?: string;
    parentCommentId?: string | null;
    body?: string;
  };
  expect(reply).toMatchObject({
    id: expect.any(String),
    threadId: createdComment.threadId,
    parentCommentId: createdComment.id,
    body: "Browser parity reply",
  });
  await expect(
    threadPopover.getByText("Browser parity reply", { exact: true }),
  ).toBeVisible();

  const resolveResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/resolve-review-thread") &&
      response.request().method() === "POST",
  );
  await threadPopover
    .getByRole("button", { name: "Resolve", exact: true })
    .click();
  const resolved = await resolveResponse;
  expect(
    resolved.ok(),
    `resolve-review-thread returned ${resolved.status()}`,
  ).toBe(true);
  expect((await resolved.json()) as { status?: string }).toMatchObject({
    status: "resolved",
  });
  await expect(threadPopover).toBeHidden();
  await page.locator("[data-review-pin]").last().click();
  const resolvedPopover = page
    .locator("[data-review-popover]")
    .filter({ hasText: "Browser parity check @alice+e2e" })
    .last();
  await expect(
    resolvedPopover.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();

  const reopenResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/resolve-review-thread") &&
      response.request().method() === "POST",
  );
  await resolvedPopover
    .getByRole("button", { name: "Reopen", exact: true })
    .click();
  const reopened = await reopenResponse;
  expect(
    reopened.ok(),
    `resolve-review-thread reopen returned ${reopened.status()}`,
  ).toBe(true);
  expect((await reopened.json()) as { status?: string }).toMatchObject({
    status: "open",
  });
  await expect(resolvedPopover).toBeHidden();
  await page.locator("[data-review-pin]").last().click();
  const reopenedPopover = page
    .locator("[data-review-popover]")
    .filter({ hasText: "Browser parity check @alice+e2e" })
    .last();
  await expect(
    reopenedPopover.getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
  const reloadedCommentsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/list-review-comments") &&
      response.request().method() === "GET" &&
      response.ok(),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const reloadedResponse = await reloadedCommentsResponse;
  const reloadedComments = (await reloadedResponse.json()) as {
    comments?: Array<{
      id?: string;
      threadId?: string;
      status?: string;
      anchor?: {
        nodeId?: string;
        relativePoint?: { xPct?: number; yPct?: number };
      };
      body?: string;
    }>;
  };
  const reloadedRoot = reloadedComments.comments?.find(
    (comment) => comment.id === createdComment.id,
  );
  const reloadedReply = reloadedComments.comments?.find(
    (comment) => comment.id === reply.id,
  );
  expect(reloadedRoot).toMatchObject({
    id: createdComment.id,
    threadId: createdComment.threadId,
    status: "open",
    anchor: {
      nodeId: nestedNodeId,
      relativePoint: {
        xPct: expect.any(Number),
        yPct: expect.any(Number),
      },
    },
  });
  expect(reloadedReply).toMatchObject({
    id: reply.id,
    threadId: createdComment.threadId,
    body: "Browser parity reply",
  });
  await expect(
    page.getByRole("tab", { name: "Comments", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await page.locator("[data-review-pin]").last().click();
  const reloadedPopover = page
    .locator("[data-review-popover]")
    .filter({ hasText: "Browser parity check @alice+e2e" })
    .last();
  await expect(
    reloadedPopover.getByText("Browser parity reply", { exact: true }),
  ).toBeVisible();
  await expect(
    reloadedPopover.getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
});
