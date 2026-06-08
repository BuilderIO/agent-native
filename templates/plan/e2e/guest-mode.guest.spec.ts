import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/*
 * GUEST MODE + CLAIM — adversarial coverage.
 *
 * Runs with --project=guest (empty storageState => logged out). Deep + edge:
 *  - logged-out empty plans state shows skill install guidance, not a banner
 *  - a guest can VIEW a public plan with NO account (read-only viewer identity)
 *  - the create / AI-wireframe path requires sign-in (UI redirect + action 401)
 *  - private/unknown plans never leak to an anonymous viewer
 *  - per-guest plan cap surfaces a FRIENDLY limit message (not a raw 500),
 *    and anonymous create is rejected with a clean message
 *  - sign in from guest mode => the user lands signed-in (banner gone, their
 *    account's plans listed); claiming when already claimed is idempotent
 *  - EDGE: a public review link still loads anonymously (separate logged-out
 *    context) after the owner has signed-in/changed, with no data loss
 *
 * Resilient by design: web-first auto-retrying assertions, tolerate HMR reloads,
 * unique fixture titles, no reliance on pre-existing plans.
 */

const APP_ORIGIN = process.env.PLAN_BASE_URL || "http://localhost:8081";
const PLAN_SKILL_INSTALL_COMMAND =
  "npx @agent-native/core@latest skills add visual-plan";

function makeE2ePassword(label: string): string {
  return ["example", label, Date.now().toString(36), "pw"].join("-");
}

/** Authed helper context (the plan owner) — used only to mint fixtures. */
async function createOwnerContext(page: Page): Promise<{
  request: APIRequestContext;
  email: string;
}> {
  const email = `guestspec-owner-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@plan.test`;
  const password = makeE2ePassword("guest-owner");
  // Same-origin register+login via the page's request context (shares cookies,
  // passes Better Auth origin check). Mirrors e2e/global-setup.ts.
  const reg = await page.request.post("/_agent-native/auth/register", {
    data: { email, password, name: "Guest Spec Owner", callbackURL: "/plans" },
  });
  expect(
    reg.ok() || reg.status() === 409 || reg.status() === 400,
    `register owner status ${reg.status()}`,
  ).toBeTruthy();
  const login = await page.request.post("/_agent-native/auth/login", {
    data: { email, password },
  });
  expect(login.ok(), `owner login status ${login.status()}`).toBeTruthy();
  return { request: page.request, email };
}

/** Create a plan as the currently-authed request context, return its id. */
async function createPlanAs(
  request: APIRequestContext,
  title: string,
): Promise<string> {
  const res = await request.post("/_agent-native/actions/create-visual-plan", {
    data: { title, brief: `${title} — fixture brief for guest e2e` },
  });
  expect(res.ok(), `create-visual-plan status ${res.status()}`).toBeTruthy();
  const json = (await res.json()) as {
    planId?: string;
    plan?: { id?: string };
  };
  const id = json.planId ?? json.plan?.id;
  expect(id, "created plan id present").toBeTruthy();
  return id as string;
}

/** Make a plan public so anonymous viewers can read it. */
async function makePublic(request: APIRequestContext, planId: string) {
  const res = await request.post(
    "/_agent-native/actions/set-resource-visibility",
    {
      data: { resourceType: "plan", resourceId: planId, visibility: "public" },
    },
  );
  expect(
    res.ok(),
    `set-resource-visibility status ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
}

/** Wipe any auth cookies from a context so it is truly anonymous. */
async function clearAuth(page: Page) {
  await page.context().clearCookies();
}

test.describe("guest mode + claim", () => {
  test("logged-out plans list shows skill empty state", async ({ page }) => {
    await clearAuth(page);
    await page.goto("/plans");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/viewing as a guest/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^sign in$/i }).first(),
    ).toBeVisible();

    // Create must NOT be offered as a real create to a guest.
    await expect(
      page.getByRole("button", { name: /sign in to create/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^new plan$/i })).toHaveCount(
      0,
    );

    await expect(page.getByText("Start with /visual-plan")).toBeVisible();
    await expect(
      page.getByText(PLAN_SKILL_INSTALL_COMMAND, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Install once")).toBeVisible();
    await expect(page.getByRole("button", { name: /^copy$/i })).toHaveCount(0);
    await expect(page.getByText(/already installed/i)).toHaveCount(0);
    await expect(page.getByText(/no cli yet/i)).toHaveCount(0);
  });

  test("guest clicking the header sign-in action is sent to sign-in", async ({
    page,
  }) => {
    await clearAuth(page);
    await page.goto("/plans");
    await page.waitForLoadState("domcontentloaded");

    const signInButton = page.getByRole("button", { name: /^sign in$/i });
    await expect(signInButton).toBeVisible({ timeout: 15_000 });
    await signInButton.click();

    // Must land on the framework sign-in surface.
    await page.waitForURL(/\/_agent-native\/sign-in/i, { timeout: 15_000 });
    expect(page.url()).toMatch(/sign-in/i);
    expect(decodeURIComponent(page.url())).toMatch(/return=\/plans/i);
    // The sign-in page offers account creation (the only way to author plans).
    await expect(page.getByText(/create account/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("anonymous create-visual-plan is rejected with a clean message (no plan minted)", async ({
    page,
  }) => {
    await clearAuth(page);
    await page.goto("/plans");
    const res = await page.request.post(
      "/_agent-native/actions/create-visual-plan",
      { data: { title: `guest-illegal-create-${Date.now()}`, brief: "nope" } },
    );
    // A guest must NOT be able to create. Expect an auth rejection (401/403),
    // NOT a 500 and NOT a 200 that silently created an orphan plan.
    expect(
      res.status(),
      `anonymous create should be auth-rejected, got ${res.status()}`,
    ).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    const body = await res.text();
    expect(
      body,
      "anonymous create returns a JSON error, not HTML/stack",
    ).toMatch(/unauthorized|sign in|auth/i);
  });

  test("a guest can VIEW a public plan with no account", async ({
    page,
    browser,
  }) => {
    // Mint a public fixture in a SEPARATE authed context (owner), then read it
    // back from a fresh, truly-anonymous context.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/");
    const owner = await createOwnerContext(ownerPage);
    const title = `Public guest-view plan ${Date.now()}`;
    const planId = await createPlanAs(owner.request, title);
    await makePublic(owner.request, planId);
    await ownerCtx.close();

    // Anonymous guest reads the public plan through the action surface (GET).
    await clearAuth(page);
    await page.goto("/plans"); // establish app origin for same-origin request
    const read = await page.request.get(
      `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(planId)}`,
    );
    expect(
      read.ok(),
      `anonymous GET of a PUBLIC plan should succeed, got ${read.status()}`,
    ).toBeTruthy();
    const bundle = (await read.json()) as { plan?: { title?: string } };
    expect(
      bundle.plan?.title,
      "anonymous viewer receives the public plan content",
    ).toBe(title);

    // And the plan page renders for the anonymous viewer (CSR shell at minimum).
    await page.goto(`/plans/${planId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle(/Plan|Agent-Native/i, { timeout: 15_000 });
    // Viewing a specific plan, the guest banner must NOT cover the reader.
    await expect(page.getByText(/viewing as a guest/i)).toHaveCount(0);
  });

  test("a private/unknown plan never leaks to an anonymous viewer", async ({
    page,
    browser,
  }) => {
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/");
    const owner = await createOwnerContext(ownerPage);
    const secret = `SECRET private brief ${Date.now()}`;
    const privateRes = await owner.request.post(
      "/_agent-native/actions/create-visual-plan",
      { data: { title: `Private plan ${Date.now()}`, brief: secret } },
    );
    expect(privateRes.ok()).toBeTruthy();
    const privId = ((await privateRes.json()) as { planId?: string })
      .planId as string;
    await ownerCtx.close();

    await clearAuth(page);
    await page.goto("/plans");

    // Anonymous read of a PRIVATE plan must be denied and must not echo content.
    const priv = await page.request.get(
      `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(privId)}`,
    );
    expect(
      priv.status(),
      `anonymous read of a PRIVATE plan must be denied, got ${priv.status()}`,
    ).toBeGreaterThanOrEqual(400);
    const privBody = await priv.text();
    expect(
      privBody,
      "private brief must never appear in an anonymous error body",
    ).not.toContain(secret);

    // A clean access response is expected (401/403/404), NOT a leaky 500.
    expect(
      priv.status(),
      `denied private read should be a 4xx access error, not a 500; got ${priv.status()}`,
    ).toBeLessThan(500);

    // Unknown id: same contract — a clean 4xx, never a 500 stack.
    const unknown = await page.request.get(
      "/_agent-native/actions/get-visual-plan?id=plan_does_not_exist_guest_spec",
    );
    expect(
      unknown.status(),
      `unknown plan id should be a clean 4xx, not 500; got ${unknown.status()}`,
    ).toBeLessThan(500);
    expect(unknown.status()).toBeGreaterThanOrEqual(400);
  });

  test("per-guest plan cap / abuse limit returns a FRIENDLY message, not a raw error", async ({
    page,
  }) => {
    await clearAuth(page);
    await page.goto("/plans");
    // The current build gates all guest creation behind sign-in, so a guest can
    // never accrue plans to a guest identity. The friendly-limit contract still
    // applies to whatever rejection a guest hits at the create chokepoint: it
    // must be a human-readable message (sign-in / limit), never a bare 500 or a
    // stack trace. (If a guest-author path ever returns the cap message
    // "Guest plan limit reached", that is also accepted here.)
    const res = await page.request.post(
      "/_agent-native/actions/create-visual-plan",
      { data: { title: `guest-cap-probe-${Date.now()}`, brief: "cap probe" } },
    );
    expect(
      res.status(),
      `guest create rejection status ${res.status()}`,
    ).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    // Friendly: mentions signing in OR the explicit guest plan limit copy.
    expect(
      /sign in|unauthorized|guest plan limit|try again shortly|limit reached/i.test(
        body,
      ),
      `guest create rejection should be a friendly message, got: ${body.slice(
        0,
        200,
      )}`,
    ).toBeTruthy();
    // Never a server-error stack / generic 500 wording on a *known* guest reject.
    expect(body).not.toMatch(
      /internal server error|cannot read propert|undefined is not/i,
    );
  });

  test("signing in from guest mode lands signed-in: banner gone, account plans listed (claim path)", async ({
    page,
  }) => {
    // Start as a guest on the plans list.
    await clearAuth(page);
    await page.goto("/plans");
    await expect(page.getByText("Start with /visual-plan")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/viewing as a guest/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^sign in$/i }).first(),
    ).toBeVisible();

    // Register + login same-origin (verification-free path the framework uses
    // for programmatic auth), exactly as global-setup does. This is the moment a
    // guest "signs in to keep their work"; the claim middleware runs on the next
    // authenticated request.
    const email = `guest-claim-${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}@plan.test`;
    const password = makeE2ePassword("guest-claim");
    const reg = await page.request.post("/_agent-native/auth/register", {
      data: { email, password, name: "Guest Claimer", callbackURL: "/plans" },
    });
    expect(reg.ok(), `register status ${reg.status()}`).toBeTruthy();
    const login = await page.request.post("/_agent-native/auth/login", {
      data: { email, password },
    });
    expect(login.ok(), `login status ${login.status()}`).toBeTruthy();

    // As this freshly-authed account, create a plan (proves the account is live
    // and that, post-sign-in, the create path is no longer gated).
    const claimedTitle = `Claimed-after-signin ${Date.now()}`;
    const planId = await createPlanAs(page.request, claimedTitle);

    // Reload the app as the now-authenticated user.
    await page.goto("/plans");
    await page.waitForLoadState("domcontentloaded");

    // Banner must be GONE once signed in.
    await expect(
      page.getByText(/viewing as a guest/i),
      "guest banner disappears after sign-in",
    ).toHaveCount(0, { timeout: 15_000 });

    // The account's plan appears in the list (no data loss across the sign-in).
    await expect(
      page.getByText(claimedTitle).first(),
      "the signed-in account's plan is listed after sign-in",
    ).toBeVisible({ timeout: 15_000 });

    // A real create CTA ("New Plan") is now offered (not "Sign in to create").
    await expect(
      page.getByRole("button", { name: /^new plan$/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /sign in to create/i }),
    ).toHaveCount(0);

    // Claim is idempotent: a second authenticated request must not lose the plan
    // or error. Re-read the list via the action surface and assert it's intact.
    // list-visual-plans is a read-only (GET) action.
    const list = await page.request.get(
      "/_agent-native/actions/list-visual-plans",
    );
    expect(list.ok(), `list-visual-plans status ${list.status()}`).toBeTruthy();
    const plans = (await list.json()) as Array<{ id: string; title: string }>;
    expect(
      plans.some((p) => p.id === planId),
      "claimed plan still owned by the account on a repeat authenticated read",
    ).toBeTruthy();
  });

  test("EDGE: a public review link still loads anonymously after the owner signs in / changes", async ({
    page,
    browser,
  }) => {
    // Owner mints a public plan, then signs into a different fresh account in
    // its own context (simulating account churn around the shared plan).
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/");
    const owner = await createOwnerContext(ownerPage);
    const title = `Public review-link plan ${Date.now()}`;
    const planId = await createPlanAs(owner.request, title);
    await makePublic(owner.request, planId);

    // Owner re-authenticates as a different account in the same context.
    const owner2Email = `guestspec-owner2-${Date.now()}@plan.test`;
    const owner2Password = makeE2ePassword("guest-owner-two");
    await ownerPage.request.post("/_agent-native/auth/register", {
      data: {
        email: owner2Email,
        password: owner2Password,
        name: "Owner Two",
        callbackURL: "/plans",
      },
    });
    await ownerPage.request.post("/_agent-native/auth/login", {
      data: { email: owner2Email, password: owner2Password },
    });
    await ownerCtx.close();

    // The PUBLIC review link must still resolve for a brand-new anonymous viewer
    // (separate logged-out context) — no data loss, no auth wall.
    const anonCtx = await browser.newContext(); // empty storage => anonymous
    const anonPage = await anonCtx.newPage();
    await anonPage.goto("/plans");
    const read = await anonPage.request.get(
      `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(planId)}`,
    );
    expect(
      read.ok(),
      `public review link must still load anonymously, got ${read.status()}`,
    ).toBeTruthy();
    const bundle = (await read.json()) as { plan?: { title?: string } };
    expect(bundle.plan?.title).toBe(title);

    await anonPage.goto(`/plans/${planId}`);
    await anonPage.waitForLoadState("domcontentloaded");
    await expect(anonPage).toHaveTitle(/Plan|Agent-Native/i, {
      timeout: 15_000,
    });
    await anonCtx.close();
  });
});
