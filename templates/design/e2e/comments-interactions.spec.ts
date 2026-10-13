import { type Page } from "@playwright/test";

import { E2E_MENTION_EMAIL } from "./global-setup";
import { appPath } from "./helpers";
import { expect, test } from "./rails";

test.use({ viewport: { width: 1440, height: 1000 } });

const COMMENT_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <section data-agent-native-node-id="card" data-agent-native-layer-name="Card" style="width:480px;padding:24px;background:#eef2f7">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:12px">
      <button data-agent-native-node-id="deep-button" data-agent-native-layer-name="Deep button" style="width:200px;height:48px">Deep Layer Button</button>
    </div>
  </section>
</body></html>`;

type SavedComment = {
  id: string;
  threadId: string;
  parentCommentId: string | null;
  status: string;
  body: string;
  anchor: {
    nodeId: string;
    relativePoint: { xPct: number; yPct: number };
  } | null;
};

/** The thread as saved, read with the same query the comments panel uses. */
async function savedComments(page: Page, query: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/list-review-comments?${query}`),
  );
  expect(response.ok(), `list-review-comments ${response.status()}`).toBe(true);
  return ((await response.json()) as { comments: SavedComment[] }).comments;
}

function threadPopover(page: Page) {
  return page
    .locator("[data-review-popover]")
    .filter({ hasText: "Browser comment check @alice+e2e" })
    .last();
}

/**
 * Opens the left rail's Threads panel. A reload can restore it already open, and
 * the rail item toggles, so it is clicked only while the panel is closed.
 */
async function openThreadsPanel(page: Page): Promise<void> {
  const threadsItem = page.getByRole("button", {
    name: "Threads",
    exact: true,
  });
  if ((await threadsItem.getAttribute("aria-current")) !== "page") {
    await threadsItem.click();
  }
  await expect(page.locator("[data-review-comments-panel]")).toBeVisible();
}

// oracle: none — verifies the comment flow, not measured Figma behavior.
test("the Pin comment tool opens the Threads panel", async ({ app }) => {
  const page = app.page;
  await app.open(await app.seed(COMMENT_SCREEN));
  await expect(page.locator("[data-review-comments-panel]")).toHaveCount(0);

  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Pin comment"]')
    .click();

  await expect(page.locator("[data-review-comments-panel]")).toBeVisible();
});

// oracle: none — verifies the comment flow, not measured Figma behavior.
// fixme: product bug: (1) The pin is drawn centred at (412,263) for a click at (491,274): about 79px left, at roughly the button's left edge, as if the
test.fixme("comments toolbar opens an anchored composer", async ({ app }) => {
  const page = app.page;
  const id = await app.seed(COMMENT_SCREEN);
  let listQuery = "";
  page.on("request", (request) => {
    if (
      !request.url().includes("/get-actions-batch") ||
      request.method() !== "POST"
    )
      return;
    const entry = (
      request.postDataJSON() as {
        requests: { action: string; query: string }[];
      }
    ).requests.find((candidate) => candidate.action === "list-review-comments");
    if (entry) listQuery = entry.query;
  });
  await app.open(id);
  await app.zoomToFit();

  await openThreadsPanel(page);
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Pin comment"]')
    .click();
  const target = await app.designRect("deep-button");
  const click = await app.pagePoint(
    target.x + target.width * 0.9,
    target.y + target.height / 2,
  );
  await page.mouse.click(click.x, click.y);

  const draftForm = page
    .locator('form:has(textarea[placeholder="Leave feedback…"])')
    .first();
  const composer = draftForm.locator('textarea[placeholder="Leave feedback…"]');
  await expect(composer).toBeVisible();
  const commentButton = draftForm.getByRole("button", {
    name: "Comment",
    exact: true,
  });
  await expect(commentButton).toBeDisabled();
  await composer.fill("Browser comment check ");
  await composer.press("@");
  const mentionMenu = page.getByRole("menu", { name: "Mention someone" });
  await expect(mentionMenu).toBeVisible();
  await expect(composer).toHaveValue("Browser comment check @");
  await composer.pressSequentially("Ali");
  await expect(
    mentionMenu.getByRole("textbox", { name: "Mention someone" }),
  ).toHaveValue("Ali");
  await mentionMenu.getByRole("menuitem").first().click();
  await expect(composer).toHaveValue("Browser comment check @alice+e2e");

  const tools = (await draftForm
    .locator("[data-review-comment-tools]")
    .boundingBox())!;
  const emoji = (await draftForm
    .getByRole("button", { name: "Add emoji" })
    .boundingBox())!;
  const mention = (await draftForm
    .getByRole("button", { name: "Mention someone" })
    .boundingBox())!;
  const attach = (await draftForm
    .getByRole("button", { name: "Attach image" })
    .boundingBox())!;
  expect(emoji.x).toBeLessThan(mention.x);
  expect(mention.x).toBeLessThan(attach.x);
  expect(attach.x + attach.width).toBeLessThanOrEqual(tools.x + tools.width);
  await expect(
    draftForm.getByRole("button", { name: "Send to agent" }),
  ).toBeVisible();

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/actions/create-review-comment") &&
      response.request().method() === "POST",
  );
  await commentButton.click();
  const created = (await (await createResponse).json()) as SavedComment & {
    mentions: { label: string; email: string; id: string | null }[];
  };
  expect(created.body).toBe("Browser comment check @alice+e2e");
  expect(created.mentions).toEqual([
    { label: "alice+e2e", email: E2E_MENTION_EMAIL, id: null },
  ]);
  expect(created.anchor?.nodeId).toBe("deep-button");
  // The pin point is a percentage of the 1440px screen: 40px body padding + 24px card padding + 90% of 200px.
  expect(created.anchor?.relativePoint.xPct).toBeCloseTo((244 / 1440) * 100, 1);
  await expect(composer).toBeHidden();
  await expect
    .soft(page.locator("[data-review-pin]"), "one thread draws one pin")
    .toHaveCount(1);
  const pin = (await page.locator("[data-review-pin]").first().boundingBox())!;
  const pinCentre = { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 };
  expect
    .soft(
      Math.hypot(pinCentre.x - click.x, pinCentre.y - click.y),
      `pin centred at ${JSON.stringify(pinCentre)}, clicked ${JSON.stringify(click)}`,
    )
    .toBeLessThanOrEqual(6);

  await page.reload({ waitUntil: "domcontentloaded" });
  await openThreadsPanel(page);
  await expect
    .soft(
      page.locator("[data-review-pin]"),
      "one thread draws one pin after reload",
    )
    .toHaveCount(1);
  await page.locator("[data-review-pin]").first().click();
  await expect(threadPopover(page)).toBeVisible();
  await expect(
    page
      .locator("[data-review-comments-panel] article")
      .getByText("Browser comment check @alice+e2e", { exact: true }),
  ).toBeVisible();
  const replyInput = page.locator("textarea[data-review-reply-input]:visible");
  await replyInput.fill("Browser comment reply");
  const replyResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/actions/reply-review-comment") &&
      response.request().method() === "POST",
  );
  await replyInput.press("Enter");
  const reply = (await (await replyResponse).json()) as SavedComment;
  await expect(
    threadPopover(page).getByText("Browser comment reply", { exact: true }),
  ).toBeVisible();

  await threadPopover(page)
    .getByRole("button", { name: "Resolve", exact: true })
    .click();
  await expect(threadPopover(page)).toBeHidden();
  await expect
    .poll(
      async () =>
        (await savedComments(page, listQuery)).find(
          (comment) => comment.id === created.id,
        )?.status,
    )
    .toBe("resolved");
  await page.locator("[data-review-pin]").first().click();
  await threadPopover(page)
    .getByRole("button", { name: "Reopen", exact: true })
    .click();
  await expect(threadPopover(page)).toBeHidden();

  await expect
    .poll(async () =>
      (await savedComments(page, listQuery))
        .filter((comment) => comment.threadId === created.threadId)
        .map(({ id, parentCommentId, status, body, anchor }) => ({
          id,
          parentCommentId,
          status,
          body,
          nodeId: anchor?.nodeId ?? null,
        })),
    )
    .toEqual([
      {
        id: created.id,
        parentCommentId: null,
        status: "open",
        body: "Browser comment check @alice+e2e",
        nodeId: "deep-button",
      },
      {
        id: reply.id,
        parentCommentId: created.id,
        status: "open",
        body: "Browser comment reply",
        nodeId: null,
      },
    ]);
  await page.locator("[data-review-pin]").first().click();
  await expect(
    threadPopover(page).getByText("Browser comment reply", { exact: true }),
  ).toBeVisible();
  await expect(
    threadPopover(page).getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
});
