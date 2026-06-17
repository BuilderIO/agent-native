import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  expectedPlanCommentAuthorEmail,
  planE2eAuthEmailPath,
} from "./auth-state";

/*
 * COMMENTING + REVIEW MODE — deep, adversarial E2E.
 *
 * The reviewer identity used by the authed project is e2e-tester@plan.test
 * (e2e/global-setup.ts). Comments are written through the same action surface
 * the UI uses (`update-visual-plan` with a `comments: [...]` payload — see
 * app/pages/PlansPage.tsx submitInlineComment / replyToCommentThread /
 * setCommentThreadStatus) and read back through `get-plan-feedback` (the agent
 * feedback view) and `get-visual-plan`.
 *
 * These specs are written as ASSERTIONS OF CORRECT behavior. If the app is
 * broken, the assertion fails and that failure IS the reported bug.
 */

const REVIEWER_EMAIL =
  process.env.PLAN_E2E_EMAIL ||
  (() => {
    try {
      // global-setup writes the actual per-run authed identity here.
      return readFileSync(planE2eAuthEmailPath(), "utf8").trim();
    } catch {
      return "e2e-tester@plan.test";
    }
  })();
const EXPECTED_COMMENT_AUTHOR_EMAIL =
  expectedPlanCommentAuthorEmail(REVIEWER_EMAIL);

type ActionResult = Record<string, any>;

async function action(
  req: APIRequestContext,
  name: string,
  data: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; body: ActionResult; raw: string }> {
  const res = await req.post(`/_agent-native/actions/${name}`, { data });
  const raw = await res.text();
  let body: ActionResult = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  return { status: res.status(), ok: res.ok(), body, raw };
}

async function getFeedback(
  req: APIRequestContext,
  planId: string,
): Promise<{ status: number; body: ActionResult }> {
  const res = await req.get(
    `/_agent-native/actions/get-plan-feedback?planId=${encodeURIComponent(planId)}`,
  );
  const body = (await res.json().catch(() => ({}))) as ActionResult;
  return { status: res.status(), body };
}

async function getPlan(
  req: APIRequestContext,
  planId: string,
): Promise<ActionResult> {
  const res = await req.get(
    `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(planId)}`,
  );
  return (await res.json().catch(() => ({}))) as ActionResult;
}

function commentsByMessage(comments: any[], message: string): any | undefined {
  return comments.find((comment) => comment.message === message);
}

/** Create a fixture plan with a rich-text block (text-quote anchor target) and
 *  a wireframe block (region/visual anchor target). Returns the plan id. */
async function createFixturePlan(
  req: APIRequestContext,
  label: string,
): Promise<string> {
  const title = `Commenting QA ${label} ${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const content = {
    version: 2,
    title,
    brief: "Adversarial commenting + review-mode fixture.",
    blocks: [
      {
        id: "rt-1",
        type: "rich-text",
        title: "Overview",
        data: {
          markdown:
            "The quick brown fox jumps over the lazy dog near the checkout flow.",
        },
      },
      {
        id: "wf-1",
        type: "wireframe",
        title: "Checkout screen",
        data: {
          surface: "desktop",
          html: "<main><h1>Checkout</h1><button>Pay now</button></main>",
        },
      },
    ],
  };
  const res = await action(req, "create-visual-plan", {
    title,
    brief: content.brief,
    content,
  });
  expect(
    res.ok,
    `create-visual-plan should succeed (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const planId: string = res.body.planId ?? res.body.plan?.id;
  expect(planId, "create-visual-plan must return a plan id").toBeTruthy();
  return planId;
}

const textAnchor = (quote: string) =>
  JSON.stringify({
    anchorKind: "text",
    sectionId: "rt-1",
    sectionTitle: "Overview",
    textQuote: quote,
    resolutionTarget: "human",
  });

const visualAnchor = (label: string) =>
  JSON.stringify({
    anchorKind: "visual",
    sectionId: "wf-1",
    sectionTitle: "Checkout screen",
    targetKind: "wireframe",
    targetLabel: label,
    visualLabel: label,
    visualX: 40,
    visualY: 60,
    resolutionTarget: "agent",
  });

/* ------------------------------------------------------------------ */
/* 1. Each comment kind persists with correct reviewer identity        */
/* ------------------------------------------------------------------ */
test("each comment kind persists with real reviewer identity and survives reload", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "kinds");

  const kinds = ["comment", "correction", "question", "decision", "annotation"];
  for (const kind of kinds) {
    const res = await action(req, "update-visual-plan", {
      planId,
      comments: [
        {
          kind,
          status: "open",
          message: `A ${kind} pin on the overview text.`,
          anchor: textAnchor("quick brown fox"),
          createdBy: "human",
          // Adversarial: try to spoof identity. Server must IGNORE this for
          // human comments and stamp the real session identity.
          authorEmail: "attacker@spoofed.test",
          authorName: "Totally Not Me",
        },
      ],
    });
    expect(
      res.ok,
      `adding a "${kind}" comment must succeed (status ${res.status}: ${res.raw.slice(0, 200)})`,
    ).toBeTruthy();
  }

  // Read back fresh (simulates reload — get-visual-plan reloads from SQL).
  const plan = await getPlan(req, planId);
  const comments: any[] = plan.comments ?? [];
  const humanComments = comments.filter((c) => c.createdBy === "human");
  expect(
    humanComments.length,
    "all five kinds of human comment must persist",
  ).toBe(5);

  for (const kind of kinds) {
    const found = humanComments.find((c) => c.kind === kind);
    expect(
      found,
      `a persisted comment of kind "${kind}" must exist`,
    ).toBeTruthy();
    // Identity must be the real reviewer, never the spoofed value.
    expect(
      found.authorEmail,
      `comment kind "${kind}" must be stamped with the expected plan author email`,
    ).toBe(EXPECTED_COMMENT_AUTHOR_EMAIL);
    expect(
      String(found.authorEmail).toLowerCase(),
      `comment kind "${kind}" must not accept a spoofed authorEmail`,
    ).not.toContain("spoofed");
    expect(found.status).toBe("open");
  }
});

/* ------------------------------------------------------------------ */
/* 2. Text-quote and wireframe-region anchors render correct labels   */
/*    and surface in the agent feedback view                           */
/* ------------------------------------------------------------------ */
test("text and wireframe anchored comments expose correct anchor labels to the agent", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "anchors");

  const textRes = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "question",
        status: "open",
        message: "Is this copy final?",
        anchor: textAnchor("quick brown fox"),
        createdBy: "human",
      },
    ],
  });
  expect(
    textRes.ok,
    `text-anchored comment must succeed (status ${textRes.status}: ${textRes.raw.slice(0, 200)})`,
  ).toBeTruthy();

  const visualRes = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "correction",
        status: "open",
        message: "Move the Pay button to the right.",
        anchor: visualAnchor("Pay now button"),
        createdBy: "human",
      },
    ],
  });
  expect(
    visualRes.ok,
    `wireframe-anchored comment must succeed (status ${visualRes.status}: ${visualRes.raw.slice(0, 200)})`,
  ).toBeTruthy();

  // get-plan-feedback is the "Send to agent" / "Copy for your agent" payload.
  const fb = await getFeedback(req, planId);
  expect(fb.status, "get-plan-feedback must return 200").toBe(200);
  const fbComments: any[] = fb.body.comments ?? [];
  expect(
    fbComments.length,
    "both unconsumed human comments must appear in the agent feedback view",
  ).toBe(2);

  const textFb = fbComments.find((c) => c.kind === "question");
  const visualFb = fbComments.find((c) => c.kind === "correction");
  expect(textFb, "text question must be in feedback").toBeTruthy();
  expect(visualFb, "wireframe correction must be in feedback").toBeTruthy();

  // Anchor labels the agent reads.
  expect(
    String(textFb.anchorContext ?? ""),
    "text comment anchorContext should quote the anchored text",
  ).toContain("quick brown fox");
  expect(
    String(visualFb.anchorContext ?? ""),
    "wireframe comment anchorContext should name the visual target",
  ).toMatch(/Pay now button|wireframe/i);

  // Resolver intent must round-trip into anchorDetails.
  const textDetails = (textFb.anchorDetails ?? []).join(" ");
  expect(textDetails, "human-resolver intent must reach the agent").toContain(
    "human reviewer",
  );
  const visualDetails = (visualFb.anchorDetails ?? []).join(" ");
  expect(visualDetails, "agent-resolver intent must reach the agent").toContain(
    "agent",
  );

  // Threads view groups them too.
  const threads: any[] = fb.body.threads ?? [];
  expect(threads.length, "two distinct threads expected in feedback").toBe(2);
});

/* ------------------------------------------------------------------ */
/* 3. Reply nests under the parent thread                              */
/* ------------------------------------------------------------------ */
test("replying to a comment thread nests correctly under the root", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "reply");

  const root = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "question",
        status: "open",
        message: "Root question on the fox text.",
        anchor: textAnchor("quick brown fox"),
        createdBy: "human",
      },
    ],
  });
  expect(
    root.ok,
    `root comment must succeed (status ${root.status}: ${root.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const rootComments: any[] = (root.body.comments ?? []).filter(
    (c: any) => c.createdBy === "human",
  );
  expect(rootComments.length, "exactly one root human comment").toBe(1);
  const rootId = rootComments[0].id;

  const reply = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        parentCommentId: rootId,
        kind: "question",
        status: "open",
        message: "Reply: yes, ship it.",
        createdBy: "human",
      },
    ],
  });
  expect(
    reply.ok,
    `reply must succeed (status ${reply.status}: ${reply.raw.slice(0, 200)})`,
  ).toBeTruthy();

  const fb = await getFeedback(req, planId);
  const threads: any[] = fb.body.threads ?? [];
  expect(threads.length, "reply must NOT create a new top-level thread").toBe(
    1,
  );
  const thread = threads[0];
  expect(thread.root.id, "thread root must be the original comment").toBe(
    rootId,
  );
  expect(
    (thread.replies ?? []).length,
    "the reply must nest under the root as one reply",
  ).toBe(1);
  expect(thread.replies[0].parentCommentId).toBe(rootId);
  expect(thread.commentCount, "thread should count root + reply").toBe(2);
});

/* ------------------------------------------------------------------ */
/* 4. resolve-plan-comment handles replies and resolution notes        */
/* ------------------------------------------------------------------ */
test("resolve-plan-comment resolves a replied-to thread and posts its resolution note", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "resolve-action");
  const rootMessage = "Root agent-action comment to resolve.";
  const replyMessage = "Reviewer reply before resolution.";
  const resolutionNote = "Fixed the checkout copy and verified the thread.";

  const root = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "correction",
        status: "open",
        message: rootMessage,
        anchor: visualAnchor("Pay now button"),
        createdBy: "human",
      },
    ],
  });
  expect(
    root.ok,
    `root comment must succeed (status ${root.status}: ${root.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const rootComment = commentsByMessage(root.body.comments ?? [], rootMessage);
  expect(rootComment?.id, "root comment id").toBeTruthy();
  const rootId = rootComment.id;

  const reply = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        parentCommentId: rootId,
        kind: "correction",
        status: "open",
        message: replyMessage,
        createdBy: "human",
      },
    ],
  });
  expect(
    reply.ok,
    `reply must succeed (status ${reply.status}: ${reply.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const replyComment = commentsByMessage(
    reply.body.comments ?? [],
    replyMessage,
  );
  expect(replyComment?.id, "reply comment id").toBeTruthy();

  const resolved = await action(req, "resolve-plan-comment", {
    planId,
    // Exercise the server action's root-walking path: callers can pass a reply
    // id from get-plan-feedback and still resolve the whole thread.
    commentId: replyComment.id,
    status: "resolved",
    resolutionNote,
  });
  expect(
    resolved.ok,
    `resolve-plan-comment must succeed (status ${resolved.status}: ${resolved.raw.slice(0, 200)})`,
  ).toBeTruthy();
  expect(
    resolved.body.resolutionNoteId,
    "resolve-plan-comment should return the inserted resolution note id",
  ).toBeTruthy();

  const plan = await getPlan(req, planId);
  const comments: any[] = plan.comments ?? [];
  const note = comments.find(
    (comment) => comment.id === resolved.body.resolutionNoteId,
  );
  expect(note, "resolution note reply must persist").toBeTruthy();
  expect(note.message).toBe(resolutionNote);
  expect(note.parentCommentId, "resolution note should reply to the root").toBe(
    rootId,
  );
  expect(note.createdBy, "resolution note should be an agent reply").toBe(
    "agent",
  );

  for (const id of [rootId, replyComment.id, note.id]) {
    const comment = comments.find((item) => item.id === id);
    expect(comment?.status, `comment ${id} should be resolved`).toBe(
      "resolved",
    );
    expect(
      comment?.resolvedAt,
      `comment ${id} should have resolvedAt`,
    ).toBeTruthy();
    expect(
      comment?.resolvedBy,
      `comment ${id} should have resolvedBy`,
    ).toBeTruthy();
  }

  const fb = await getFeedback(req, planId);
  expect(fb.status, "get-plan-feedback after resolving should return 200").toBe(
    200,
  );
  const thread = (fb.body.threads ?? []).find(
    (item: any) => item.id === rootId,
  );
  expect(
    thread,
    "resolved thread should remain visible until consumed",
  ).toBeTruthy();
  expect(thread.status, "thread should no longer be open").toBe("resolved");
  expect(
    thread.commentCount,
    "thread should include root, reply, and note",
  ).toBe(3);
  const threadMessages = (thread.comments ?? []).map(
    (comment: any) => comment.message,
  );
  expect(threadMessages).toEqual(
    expect.arrayContaining([rootMessage, replyMessage, resolutionNote]),
  );
  expect(
    fb.body.feedbackSummary?.openThreadCount,
    "resolved thread should not count as open feedback",
  ).toBe(0);
  expect(
    fb.body.feedbackSummary?.resolvedThreadCount,
    "resolved thread should count as resolved feedback",
  ).toBe(1);
  expect(
    fb.body.actionableThreads ?? [],
    "resolved agent-targeted feedback should leave no actionable open threads",
  ).toHaveLength(0);
});

/* ------------------------------------------------------------------ */
/* 5. Resolving a thread removes it from open agent feedback           */
/* ------------------------------------------------------------------ */
test("resolving a thread stops it appearing as open feedback", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "resolve");

  const root = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "comment",
        status: "open",
        message: "Please resolve me.",
        anchor: textAnchor("lazy dog"),
        createdBy: "human",
      },
    ],
  });
  expect(
    root.ok,
    `open comment must succeed (status ${root.status}: ${root.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const rootId = (root.body.comments ?? []).find(
    (c: any) => c.createdBy === "human",
  )?.id;
  expect(rootId, "open comment id").toBeTruthy();

  // Before resolve: shows in open feedback.
  const before = await getFeedback(req, planId);
  expect(
    (before.body.comments ?? []).length,
    "open comment appears in feedback before resolution",
  ).toBe(1);

  // Resolve (mirrors setCommentThreadStatus — updates the comment with status
  // resolved by id).
  const resolved = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        id: rootId,
        kind: "comment",
        status: "resolved",
        message: "Please resolve me.",
        anchor: textAnchor("lazy dog"),
        createdBy: "human",
      },
    ],
  });
  expect(
    resolved.ok,
    `resolving must succeed (status ${resolved.status}: ${resolved.raw.slice(0, 200)})`,
  ).toBeTruthy();

  const plan = await getPlan(req, planId);
  const persisted = (plan.comments ?? []).find((c: any) => c.id === rootId);
  expect(persisted?.status, "comment must persist as resolved").toBe(
    "resolved",
  );

  const after = await getFeedback(req, planId);
  const stillOpen = (after.body.threads ?? []).filter(
    (t: any) => t.status === "open",
  );
  expect(
    stillOpen.length,
    "resolved thread must not be an open feedback thread",
  ).toBe(0);
});

/* ------------------------------------------------------------------ */
/* 6. EDGE: empty comment is rejected                                  */
/* ------------------------------------------------------------------ */
test("empty comment body is rejected (validation), not silently stored", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "empty");

  const res = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "comment",
        status: "open",
        message: "",
        anchor: textAnchor("fox"),
        createdBy: "human",
      },
    ],
  });
  expect(
    res.ok,
    `empty comment must be rejected, not accepted (status ${res.status})`,
  ).toBeFalsy();
  expect(
    res.status,
    "empty comment should be a 4xx validation error, not a 5xx",
  ).toBeGreaterThanOrEqual(400);
  expect(
    res.status,
    "empty comment should not be a 5xx server error",
  ).toBeLessThan(500);

  const plan = await getPlan(req, planId);
  const empties = (plan.comments ?? []).filter(
    (c: any) => c.createdBy === "human" && !String(c.message).trim(),
  );
  expect(empties.length, "no empty-bodied comment should persist").toBe(0);
});

/* ------------------------------------------------------------------ */
/* 7. EDGE: huge comment body persists intact                          */
/* ------------------------------------------------------------------ */
test("a huge comment body persists and round-trips intact", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "huge");

  const huge = "X".repeat(20000) + " END_MARKER_HUGE";
  const res = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "comment",
        status: "open",
        message: huge,
        anchor: textAnchor("fox"),
        createdBy: "human",
      },
    ],
  });
  expect(
    res.ok,
    `huge comment must succeed or fail gracefully (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();

  const plan = await getPlan(req, planId);
  const stored = (plan.comments ?? []).find(
    (c: any) => c.createdBy === "human",
  );
  expect(stored, "huge comment must persist").toBeTruthy();
  expect(
    String(stored.message).length,
    "huge comment body must not be truncated",
  ).toBe(huge.length);
  expect(String(stored.message).endsWith("END_MARKER_HUGE")).toBeTruthy();
});

/* ------------------------------------------------------------------ */
/* 8. EDGE: comment anchored to a since-removed block stays readable   */
/* ------------------------------------------------------------------ */
test("a comment anchored to a removed block remains readable feedback", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "orphan");

  // Anchor a comment to the wireframe block.
  const add = await action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        kind: "correction",
        status: "open",
        message: "Fix the Pay button on this screen.",
        anchor: JSON.stringify({
          anchorKind: "visual",
          sectionId: "wf-1",
          sectionTitle: "Checkout screen",
          targetKind: "wireframe",
          targetLabel: "Pay now button",
          resolutionTarget: "agent",
        }),
        createdBy: "human",
      },
    ],
  });
  expect(
    add.ok,
    `anchored comment must succeed (status ${add.status}: ${add.raw.slice(0, 200)})`,
  ).toBeTruthy();

  // Now remove the anchored block via a content patch (agent edits the plan).
  const removed = await action(req, "update-visual-plan", {
    planId,
    contentPatches: [{ op: "remove-block", blockId: "wf-1" }],
    note: "Removed the wireframe the comment was anchored to.",
  });
  expect(
    removed.ok,
    `removing the anchored block must succeed (status ${removed.status}: ${removed.raw.slice(0, 200)})`,
  ).toBeTruthy();

  // The comment must NOT vanish or crash the feedback view; it should still be
  // readable with its preserved anchor context.
  const fb = await getFeedback(req, planId);
  expect(fb.status, "feedback view must not 500 on an orphaned anchor").toBe(
    200,
  );
  const orphan = (fb.body.comments ?? []).find(
    (c: any) => c.kind === "correction",
  );
  expect(
    orphan,
    "comment anchored to a removed block must still be returned",
  ).toBeTruthy();
  expect(orphan.message).toContain("Pay button");
});

/* ------------------------------------------------------------------ */
/* 9. EDGE: many comments persist collision-free (unique ids)          */
/* ------------------------------------------------------------------ */
test("many comments persist with unique ids (collision-free pins)", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "many");

  const N = 25;
  const comments = Array.from({ length: N }, (_, i) => ({
    kind: "comment",
    status: "open",
    message: `Pin number ${i} of ${N}.`,
    anchor: JSON.stringify({
      anchorKind: "visual",
      sectionId: "wf-1",
      targetKind: "wireframe",
      visualX: (i * 3) % 100,
      visualY: (i * 7) % 100,
      resolutionTarget: "agent",
    }),
    createdBy: "human",
  }));

  const res = await action(req, "update-visual-plan", { planId, comments });
  expect(
    res.ok,
    `bulk-adding ${N} comments must succeed (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();

  const plan = await getPlan(req, planId);
  const human = (plan.comments ?? []).filter(
    (c: any) => c.createdBy === "human",
  );
  expect(human.length, `all ${N} comments must persist`).toBe(N);
  const ids = new Set(human.map((c: any) => c.id));
  expect(ids.size, "all comment ids must be unique (no collisions)").toBe(N);
});

/* ------------------------------------------------------------------ */
/* 10. UI: review mode pin → comment composer → persisted thread       */
/*    Drives the real browser flow a reviewer would use.               */
/* ------------------------------------------------------------------ */
test("UI: enter review mode, pin a comment on the document, and see it persist", async ({
  page,
}) => {
  const req = page.request;
  const planId = await createFixturePlan(req, "ui");

  // Capture the status of the UI's own update-visual-plan call so the test
  // catches a server error even if the optimistic UI hides it.
  const updateStatuses: number[] = [];
  const planReadStatuses: number[] = [];
  page.on("requestfinished", async (r) => {
    if (
      r.url().includes("update-visual-plan") &&
      r.method().toUpperCase() === "POST"
    ) {
      const resp = await r.response();
      const status = resp?.status();
      if (typeof status === "number") updateStatuses.push(status);
    }
  });
  page.on("response", (resp) => {
    const url = resp.url();
    if (
      url.includes("/_agent-native/actions/get-visual-plan") &&
      url.includes(planId)
    ) {
      planReadStatuses.push(resp.status());
    }
  });

  await page.goto(`/plans/${planId}`);
  await page.waitForLoadState("domcontentloaded");

  // The document text should render.
  await expect(
    page.getByText("quick brown fox", { exact: false }).first(),
  ).toBeVisible({ timeout: 15000 });

  // Enter comment (review) mode via the toolbar toggle. The ReviewMarkupToolbar
  // renders the toggle as a ToggleGroupItem (role="radio", name "Comment").
  const commentToggle = page.getByRole("radio", {
    name: "Comment",
    exact: true,
  });
  await expect(commentToggle).toBeVisible({ timeout: 15000 });
  await commentToggle.click();

  // Click the document body to drop a pin and open the inline composer.
  await page
    .getByText("quick brown fox", { exact: false })
    .first()
    .click({ force: true });

  // The inline comment composer should appear. Its placeholder is a visible
  // span "Add a comment..." next to a role=textbox contenteditable.
  await expect(
    page.getByText("Add a comment...", { exact: false }),
    "clicking the document in comment mode should open the inline composer",
  ).toBeVisible({ timeout: 10000 });

  // The composer auto-focuses; type the comment body, then Save.
  await page.keyboard.type("UI-pinned review comment.");
  await page.getByRole("button", { name: /^Save$|^Saving$/ }).click();

  // Wait for the UI's update-visual-plan POST to land.
  await expect(async () => {
    expect(updateStatuses.length).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 15000 });

  // The save must succeed at the HTTP level. A 500 here is the bug — the
  // optimistic UI can hide it (the comment may even partially persist), but the
  // reviewer's save genuinely failed server-side.
  expect(
    updateStatuses.every((s) => s < 400),
    `saving a pinned comment must not return a server error (statuses seen: ${updateStatuses.join(", ")})`,
  ).toBeTruthy();

  // The save must NOT surface the failure state in the UI.
  await expect(
    page.getByText("Couldn't save. Try again."),
    "the inline composer must not show a save error after submitting a comment",
  ).toBeHidden({ timeout: 5000 });

  // It should persist server-side: get-plan-feedback shows one open comment
  // stamped with the real reviewer identity.
  await expect(async () => {
    const fb = await getFeedback(req, planId);
    const human = (fb.body.comments ?? []).filter(
      (c: any) => c.createdBy === "human",
    );
    expect(human.length).toBeGreaterThanOrEqual(1);
    expect(human[0].authorEmail).toBe(EXPECTED_COMMENT_AUTHOR_EMAIL);
  }).toPass({ timeout: 15000 });

  // And the "Send to agent" feedback control should surface once an open
  // comment exists.
  await expect(
    page.getByRole("button", { name: /Send to agent/i }),
    "Send to agent control should appear once an open comment exists",
  ).toBeVisible({ timeout: 15000 });

  // A hard browser refresh after adding comments should reload the same plan
  // cleanly, not flash into an error state or lose the freshly saved thread.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("quick brown fox", { exact: false }).first(),
    "plan content should render after hard refresh",
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: /Send to agent/i }),
    "open comment feedback should still be visible after hard refresh",
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText(/Plan (did not load|not found)|Internal server error/i),
    "hard refresh after adding a comment must not surface a plan load error",
  ).toHaveCount(0);
  expect(
    planReadStatuses.every((status) => status < 400),
    `hard refresh should not make get-visual-plan fail (statuses seen: ${planReadStatuses.join(", ")})`,
  ).toBeTruthy();

  const reloadedPlan = await getPlan(req, planId);
  const persisted = commentsByMessage(
    reloadedPlan.comments ?? [],
    "UI-pinned review comment.",
  );
  expect(
    persisted,
    "UI-pinned comment should still exist after a hard browser refresh",
  ).toBeTruthy();
  expect(persisted.status, "reloaded UI comment should remain open").toBe(
    "open",
  );
  expect(
    persisted.authorEmail,
    "reloaded UI comment keeps the expected plan author identity",
  ).toBe(EXPECTED_COMMENT_AUTHOR_EMAIL);
});
