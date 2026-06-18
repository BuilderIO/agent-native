import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { planE2eAuthStatePath } from "./auth-state";

function makeE2ePassword(label: string): string {
  return ["example", label, Date.now().toString(36), "pw"].join("-");
}

/*
 * SHARING + PUBLISH + ACCESS CONTROL (security-critical) — adversarial E2E.
 *
 * Runs in the "authed" project: the storageState session is the OWNER
 * (e2e-tester@plan.test). We register a fresh REVIEWER (shared as viewer) and a
 * fresh OUTSIDER (no access) in their own browser contexts and prove the access
 * matrix end to end through the real action surface + the real UI:
 *
 *   (a) a viewer can READ but the owner-only write surface (inline editor write,
 *       title/status/Publish/Share-admin controls) must not actually mutate;
 *   (b) a non-owner cannot edit via update-visual-plan (403) and cannot
 *       publish/poison the share link (publish-visual-plan as a viewer/public
 *       reader — KNOWN authz hole, proven here);
 *   (c) a totally unrelated account cannot open a private plan by id;
 *   (d) flipping public->private immediately revokes a previously-allowed
 *       public reader.
 *
 * Specs assert CORRECT behavior. Where the app is insecure, the assertion FAILS
 * and that failure IS the reported bug.
 */

const ACTIONS = "/_agent-native/actions";
const PLAN_CONTENT_MIN_VERSION = 1;

type RegisteredUser = {
  context: BrowserContext;
  request: APIRequestContext;
  email: string;
  password: string;
};

function uniqueEmail(tag: string) {
  return `plan-e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@plan.test`;
}

/**
 * Register a brand-new account in its OWN browser context. Better Auth enforces
 * an origin check, so we register via a same-origin fetch from a loaded app
 * page (mirrors e2e/global-setup.ts). The returned request context shares that
 * context's cookies, so page.request calls are authenticated as this user.
 */
async function registerUser(
  browser: import("@playwright/test").Browser,
  baseURL: string,
  tag: string,
): Promise<RegisteredUser> {
  const email = uniqueEmail(tag);
  const password = makeE2ePassword(tag);
  const context = await browser.newContext();
  const page = await context.newPage();

  // The dev server is shared with other agents and may HMR/reload mid-request,
  // making the same-origin register/login fetch transiently "Failed to fetch".
  // Retry a few times (reloading the page each attempt) before giving up.
  let sessionEmail: unknown;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4 && sessionEmail !== email; attempt++) {
    try {
      await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
      const result = await page.evaluate(
        async ({ email, password }) => {
          const post = (path: string, body: unknown) =>
            fetch(path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }).then(async (r) => ({
              ok: r.ok,
              status: r.status,
              data: (await r.json().catch(() => ({}))) as Record<
                string,
                unknown
              >,
            }));
          // Idempotent: register may 4xx if the email already exists from a
          // prior attempt; the subsequent login still establishes the session.
          await post("/_agent-native/auth/register", {
            email,
            password,
            name: `Plan E2E ${email}`,
            callbackURL: "/plans",
          }).catch(() => undefined);
          await post("/_agent-native/auth/login", { email, password }).catch(
            () => undefined,
          );
          const sess = await fetch("/_agent-native/auth/session", {
            headers: { Accept: "application/json" },
          })
            .then((r) => r.json())
            .catch(() => ({}));
          return {
            sessionEmail: (sess as Record<string, unknown>)?.email,
          };
        },
        { email, password },
      );
      sessionEmail = result.sessionEmail;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(1200);
    }
  }
  await page.close();
  expect(
    sessionEmail,
    `registered ${tag} account should have a live session (lastErr=${String(
      lastErr,
    )})`,
  ).toBe(email);
  return { context, request: context.request, email, password };
}

/** Minimal valid structured plan content with one editable rich-text block. */
function planContent(title: string) {
  return {
    version: PLAN_CONTENT_MIN_VERSION,
    title,
    brief: "Secret brief — must not leak to outsiders.",
    blocks: [
      {
        id: "rt_secret",
        type: "rich-text" as const,
        title: "Confidential section",
        data: {
          markdown:
            "TOP_SECRET_PLAN_BODY: the owner's private implementation notes.",
        },
      },
    ],
  };
}

/** Create a plan as the owner (storageState session). Returns the plan id. */
async function createOwnerPlan(
  request: APIRequestContext,
  title: string,
): Promise<string> {
  const res = await request.post(`${ACTIONS}/create-visual-plan`, {
    data: {
      title,
      brief: "Secret brief — must not leak to outsiders.",
      source: "manual",
      status: "review",
      repoPath: "/Users/owner/private-repo",
      content: planContent(title),
    },
  });
  expect(
    res.ok(),
    `owner create-visual-plan should succeed (got ${res.status()})`,
  ).toBeTruthy();
  const body = await res.json();
  const planId = body.planId ?? body.plan?.id;
  expect(planId, "create-visual-plan must return a plan id").toBeTruthy();
  return planId as string;
}

async function shareAsViewer(
  ownerReq: APIRequestContext,
  planId: string,
  email: string,
) {
  const res = await ownerReq.post(`${ACTIONS}/share-resource`, {
    data: {
      resourceType: "plan",
      resourceId: planId,
      principalType: "user",
      principalId: email,
      role: "viewer",
      notify: false,
    },
  });
  expect(
    res.ok(),
    `owner share (viewer) should succeed (got ${res.status()})`,
  ).toBeTruthy();
}

async function setVisibility(
  req: APIRequestContext,
  planId: string,
  visibility: "private" | "org" | "public",
) {
  return req.post(`${ACTIONS}/set-resource-visibility`, {
    data: { resourceType: "plan", resourceId: planId, visibility },
  });
}

/** Read a plan by id as the given user; returns { status, body }. */
async function getPlan(req: APIRequestContext, planId: string) {
  const res = await req.get(
    `${ACTIONS}/get-visual-plan?id=${encodeURIComponent(planId)}`,
    { headers: { Accept: "application/json" } },
  );
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status(), ok: res.ok(), text, body };
}

test.describe("sharing + publish + access control", () => {
  // NOTE: not `serial` — each test asserts an independent slice of the access
  // matrix, so one failing assertion (a real bug) must not skip the rest.
  let reviewer: RegisteredUser;
  let outsider: RegisteredUser;

  test.beforeAll(async ({ browser, baseURL }) => {
    const url = baseURL || "http://localhost:8081";
    reviewer = await registerUser(browser, url, "viewer");
    outsider = await registerUser(browser, url, "outsider");
  });

  test.afterAll(async () => {
    await reviewer?.context.close();
    await outsider?.context.close();
  });

  // (c) A totally unrelated account must NOT be able to open a PRIVATE plan by
  // id. Either an explicit not-found / 403, or any non-2xx — but never the plan
  // content. CRITICAL if the secret body leaks.
  test("outsider cannot read a private plan by id", async ({ page }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Private plan (read deny)",
    );

    // Owner can read it (sanity).
    const ownerRead = await getPlan(page.request, planId);
    expect(ownerRead.ok, "owner should read own private plan").toBeTruthy();

    const outsiderRead = await getPlan(outsider.request, planId);
    expect(
      outsiderRead.ok,
      `outsider must NOT successfully read a private plan (got ${outsiderRead.status})`,
    ).toBeFalsy();
    // The secret body must never appear in the response, regardless of status.
    expect(
      outsiderRead.text.includes("TOP_SECRET_PLAN_BODY"),
      "private plan body must not leak to an outsider",
    ).toBeFalsy();
    expect(
      outsiderRead.text.includes("private-repo"),
      "private repoPath must not leak to an outsider",
    ).toBeFalsy();
  });

  // (b1) A non-owner with NO access cannot edit via update-visual-plan.
  test("outsider cannot edit a private plan via update-visual-plan (denied)", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Private plan (edit deny)",
    );

    const res = await outsider.request.post(`${ACTIONS}/update-visual-plan`, {
      data: {
        planId,
        title: "HACKED BY OUTSIDER",
        note: "outsider edit attempt",
      },
    });
    expect(
      res.ok(),
      `outsider edit must be rejected (got ${res.status()})`,
    ).toBeFalsy();

    // The owner's plan title must be unchanged.
    const after = await getPlan(page.request, planId);
    expect(after.body?.plan?.title).toBe("Private plan (edit deny)");
  });

  // (b2) A VIEWER (explicit viewer share) can READ but cannot WRITE via
  // update-visual-plan. Expected: 403 ForbiddenError. CRITICAL if the write
  // succeeds.
  test("viewer can read but CANNOT edit via update-visual-plan (403)", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Shared plan (viewer RW)",
    );
    await shareAsViewer(page.request, planId, reviewer.email);

    // Viewer can read (the whole point of a viewer share).
    const viewerRead = await getPlan(reviewer.request, planId);
    expect(
      viewerRead.ok,
      `viewer should be able to read the shared plan (got ${viewerRead.status})`,
    ).toBeTruthy();
    expect(viewerRead.body?.plan?.title).toBe("Shared plan (viewer RW)");

    // Viewer attempts a content edit -> must be denied.
    const editRes = await reviewer.request.post(
      `${ACTIONS}/update-visual-plan`,
      {
        data: {
          planId,
          title: "VIEWER OVERWROTE TITLE",
          contentPatches: [
            {
              op: "update-rich-text",
              blockId: "rt_secret",
              markdown: "VIEWER TAMPERED WITH THE PLAN BODY",
            },
          ],
          note: "viewer edit attempt",
        },
      },
    );
    expect(
      editRes.status(),
      `viewer content edit must be 403 Forbidden (got ${editRes.status()})`,
    ).toBe(403);

    // The plan must be untouched.
    const after = await getPlan(page.request, planId);
    expect(after.body?.plan?.title).toBe("Shared plan (viewer RW)");
    const block = (after.body?.plan?.content?.blocks ?? []).find(
      (b: any) => b.id === "rt_secret",
    );
    expect(block?.data?.markdown).toContain("TOP_SECRET_PLAN_BODY");
    expect(JSON.stringify(after.body)).not.toContain("VIEWER TAMPERED");
  });

  // (b3) KNOWN AUTHZ HOLE: publish-visual-plan only requires viewer-level read
  // (loadPlanBundle), not editor/owner. A VIEWER can therefore exfiltrate the
  // full plan content to their own connected hosted instance and stamp a hosted
  // URL onto the owner's row. We assert the SECURE expectation (viewer publish
  // is rejected). This is expected to FAIL until publish is gated to owner.
  test("viewer must NOT be able to publish (exfiltrate) the plan", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Shared plan (viewer publish)",
    );
    await shareAsViewer(page.request, planId, reviewer.email);

    const res = await reviewer.request.post(`${ACTIONS}/publish-visual-plan`, {
      data: { planId },
    });
    // A correctly gated publish must DENY a viewer: either a 403, or (if no
    // hosted account is connected in this dev env) a needsAuth signal is NOT a
    // pass — a viewer must never reach the publish path at all. We treat any
    // 2xx with hostedPlanId OR a needsAuth:true (meaning the viewer was allowed
    // INTO the publish flow) as the security failure.
    const status = res.status();
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const reachedPublishFlow =
      res.ok() && (Boolean(body?.hostedPlanId) || body?.needsAuth === true);
    expect(
      status === 403 && !reachedPublishFlow,
      `viewer must be REJECTED from publish-visual-plan, but got status=${status} body=${JSON.stringify(
        body,
      )}`,
    ).toBeTruthy();
  });

  // (b4) KNOWN AUTHZ HOLE: a non-owner reader of a PUBLIC plan can publish it
  // too (publish only gates on read). Assert the secure expectation.
  test("non-owner reader of a PUBLIC plan must NOT be able to publish it", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Public plan (publish deny)",
    );
    const vis = await setVisibility(page.request, planId, "public");
    expect(
      vis.ok(),
      `owner set public should succeed (got ${vis.status()})`,
    ).toBeTruthy();

    // Outsider (no share) reads the public plan...
    const outsiderRead = await getPlan(outsider.request, planId);
    expect(
      outsiderRead.ok,
      "a public plan should be readable by any authenticated user",
    ).toBeTruthy();

    // ...and tries to publish it.
    const res = await outsider.request.post(`${ACTIONS}/publish-visual-plan`, {
      data: { planId },
    });
    const status = res.status();
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const reachedPublishFlow =
      res.ok() && (Boolean(body?.hostedPlanId) || body?.needsAuth === true);
    expect(
      status === 403 && !reachedPublishFlow,
      `a non-owner public reader must be REJECTED from publish, but got status=${status} body=${JSON.stringify(
        body,
      )}`,
    ).toBeTruthy();
  });

  // (b5) A non-owner reader of a PUBLIC plan must NOT be able to flip its
  // visibility (set-resource-visibility requires admin). CRITICAL if allowed.
  test("non-owner reader of a PUBLIC plan cannot change its visibility", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Public plan (visibility deny)",
    );
    expect(
      (await setVisibility(page.request, planId, "public")).ok(),
    ).toBeTruthy();

    const res = await setVisibility(outsider.request, planId, "private");
    expect(
      res.status(),
      `non-owner must be 403 when changing visibility (got ${res.status()})`,
    ).toBe(403);

    // Confirm still public from the owner's perspective.
    const list = await page.request.get(
      `${ACTIONS}/list-resource-shares?resourceType=plan&resourceId=${encodeURIComponent(
        planId,
      )}`,
      { headers: { Accept: "application/json" } },
    );
    const listBody = await list.json();
    expect(listBody.visibility).toBe("public");
  });

  // (b6) A VIEWER must NOT be able to re-share the plan to a third party
  // (share-resource requires admin). CRITICAL if a viewer can grant access.
  test("viewer cannot re-share the plan (share-resource requires admin)", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Shared plan (reshare deny)",
    );
    await shareAsViewer(page.request, planId, reviewer.email);

    const res = await reviewer.request.post(`${ACTIONS}/share-resource`, {
      data: {
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: outsider.email,
        role: "editor",
        notify: false,
      },
    });
    expect(
      res.status(),
      `viewer re-share must be 403 (got ${res.status()})`,
    ).toBe(403);

    // Outsider still must not have access.
    const outsiderRead = await getPlan(outsider.request, planId);
    expect(
      outsiderRead.ok,
      "outsider must still be denied after a viewer's failed re-share",
    ).toBeFalsy();
  });

  // (d) Flipping public -> private must IMMEDIATELY revoke a reader who only had
  // access via public visibility (no explicit share row). CRITICAL if a stale
  // public reader keeps reading after the owner makes it private.
  test("public -> private immediately revokes a public-only reader", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(
      page.request,
      "Plan (public->private revoke)",
    );
    expect(
      (await setVisibility(page.request, planId, "public")).ok(),
    ).toBeTruthy();

    // Outsider can read while public.
    const whilePublic = await getPlan(outsider.request, planId);
    expect(
      whilePublic.ok,
      "outsider should read while plan is public",
    ).toBeTruthy();

    // Owner flips back to private.
    expect(
      (await setVisibility(page.request, planId, "private")).ok(),
    ).toBeTruthy();

    // Outsider must now be denied, and the body must not leak.
    const afterPrivate = await getPlan(outsider.request, planId);
    expect(
      afterPrivate.ok,
      `public->private must revoke the public-only reader (got ${afterPrivate.status})`,
    ).toBeFalsy();
    expect(
      afterPrivate.text.includes("TOP_SECRET_PLAN_BODY"),
      "plan body must not leak after revoking public access",
    ).toBeFalsy();
  });

  // (d2) Unsharing a viewer (unshare-resource) immediately revokes their read.
  test("removing a viewer share revokes their read access", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(page.request, "Plan (unshare revoke)");
    await shareAsViewer(page.request, planId, reviewer.email);

    expect(
      (await getPlan(reviewer.request, planId)).ok,
      "viewer reads while shared",
    ).toBeTruthy();

    const unshare = await page.request.post(`${ACTIONS}/unshare-resource`, {
      data: {
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: reviewer.email,
      },
    });
    expect(
      unshare.ok(),
      `owner unshare should succeed (got ${unshare.status()})`,
    ).toBeTruthy();

    const afterUnshare = await getPlan(reviewer.request, planId);
    expect(
      afterUnshare.ok,
      `unshared viewer must lose read access (got ${afterUnshare.status})`,
    ).toBeFalsy();
  });

  // ---- UI-LAYER access matrix (the read-only experience) ----------------

  // (a) OWNER UI: the owner sees the full Share popover (visibility + invite)
  // and the inline rich-text editor is editable (contentEditable). Baseline so
  // the viewer comparison below is meaningful.
  test("owner UI exposes the Share control and an editable document", async ({
    page,
  }) => {
    const planId = await createOwnerPlan(page.request, "Owner UI plan");
    await page.goto(`/plans/${planId}`);

    // The confidential rich-text body renders.
    await expect(page.getByText("TOP_SECRET_PLAN_BODY")).toBeVisible({
      timeout: 20_000,
    });

    // Owner has the Share affordance (core ShareButton renders a "Share" label).
    const shareBtn = page.getByRole("button", { name: /share/i });
    await expect(shareBtn.first()).toBeVisible();

    // Owner's document exposes a contentEditable surface (the inline editor).
    const editable = page.locator('[contenteditable="true"]');
    await expect(editable.first()).toBeVisible({ timeout: 20_000 });
  });

  // (a) VIEWER UI: a viewer should be able to READ the plan, but the inline
  // editor must be read-only and owner-only controls (Publish/Share-admin)
  // must not be exposed. The page gates content editing on the access role
  // returned by list-resource-shares (role: "viewer" => canEditPlanContent
  // false). We assert that the viewer's rendered DOCUMENT BODY is NOT an
  // editable surface.
  //
  // POST-REFACTOR UI: the plan document renders inside `.plan-content-surface`.
  // A read-only rich-text block renders via `PlanMarkdownReader` (react-markdown,
  // Tiptap-free, wrapped in `.an-rich-md-wrapper--readonly`); an editable block
  // mounts the shared Tiptap `RichMarkdownEditor`, whose ProseMirror node carries
  // `contenteditable="true"`. So inside the document surface, ANY
  // `[contenteditable="true"]` means an edit affordance was leaked to the viewer.
  // We scope the check to `.plan-content-surface` so the legitimate comment
  // composer (`CommentMentionEditor`, a contentEditable textbox a viewer IS
  // allowed to use, and which lives OUTSIDE the document surface) is not counted.
  // If a contentEditable surface appears inside the document for a viewer, that
  // is a real bug — the read-only experience leaks an inline edit affordance.
  test("viewer UI is read-only (no editable inline editor)", async ({
    baseURL,
  }) => {
    // Owner (storageState) creates + shares; do it via a throwaway authed page.
    // We can't use the per-test `page` here because we need the VIEWER's
    // browser context to drive the UI, so create the fixture with a fresh
    // owner context built from the saved storageState.
    const ownerCtx = await reviewer.context.browser()!.newContext({
      storageState: planE2eAuthStatePath(),
    });
    const ownerPage = await ownerCtx.newPage();
    const planId = await createOwnerPlan(
      ownerPage.request,
      "Viewer UI read-only plan",
    );
    await shareAsViewer(ownerPage.request, planId, reviewer.email);
    await ownerPage.close();
    await ownerCtx.close();

    const viewerPage = await reviewer.context.newPage();
    try {
      await viewerPage.goto(`${baseURL}/plans/${planId}`, {
        waitUntil: "domcontentloaded",
      });

      // Viewer can READ the plan content.
      await expect(viewerPage.getByText("TOP_SECRET_PLAN_BODY")).toBeVisible({
        timeout: 20_000,
      });

      // The document body must render through the read-only reader path
      // (`.an-rich-md-wrapper--readonly`), not a live editor.
      const docSurface = viewerPage.locator(".plan-content-surface");
      await expect(docSurface.first()).toBeVisible({ timeout: 20_000 });

      // Give the access-role query (list-resource-shares) + renderer time to
      // settle; canEditPlanContent flips false only after the role resolves.
      await viewerPage.waitForTimeout(2_500);

      // A viewer must NOT be presented with an editable document surface. Scope
      // the contentEditable probe to the plan document body so the legitimate
      // comment composer (outside `.plan-content-surface`) is not counted.
      const editableCount = await docSurface
        .locator('[contenteditable="true"]')
        .count();
      expect(
        editableCount,
        "viewer must see a READ-ONLY document — no contentEditable inline editor should be exposed inside .plan-content-surface",
      ).toBe(0);

      // And the read-only reader wrapper must be present for the prose block,
      // confirming the viewer is on the Tiptap-free read path.
      await expect(
        docSurface.locator(".an-rich-md-wrapper--readonly").first(),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await viewerPage.close();
    }
  });
});
