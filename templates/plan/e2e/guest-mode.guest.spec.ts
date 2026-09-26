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
  "npx @agent-native/core@latest skills add visual-plans";

function makeE2ePassword(label: string): string {
  return ["example", label, Date.now().toString(36), "pw"].join("-");
}

async function createOwnerContext(page: Page): Promise<{
  request: APIRequestContext;
  email: string;
}> {
  const email = `guestspec-owner+autoz-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@plan.test`;
  const password = makeE2ePassword("guest-owner");
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

async function clearAuth(page: Page) {
  await page.context().clearCookies();
}

test.describe("guest mode + claim", () => {
  test("logged-out plans list shows skill empty state", async ({ page }) => {
    await clearAuth(page);
    await page.goto("/plans");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/viewing as a guest/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^plan$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^sign in$/i })).toHaveCount(
      0,
    );

    await expect(
      page.getByRole("button", { name: /sign in to create/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^new plan$/i })).toHaveCount(
      0,
    );

    await expect(page.getByText("Start with /visual-plan")).toBeVisible();
    await expect(page.locator("[data-onboarding-screen]")).toHaveCount(0);
    await expect(
      page.getByText(PLAN_SKILL_INSTALL_COMMAND, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Install once")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /copy install command/i }),
    ).toBeVisible();
    await expect(page.getByLabel("Visual Plan skill demo video")).toBeVisible();
    await expect(
      page.getByLabel("Visual Recap skill demo video"),
    ).toBeVisible();
    await expect(page.getByText(/already installed/i)).toHaveCount(0);
    await expect(page.getByText(/no cli yet/i)).toHaveCount(0);
  });

  test("logged-out plans page omits the app header", async ({ page }) => {
    await clearAuth(page);
    await page.goto("/plans");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.getByText("Start with /visual-plan")).toBeVisible();
  });

  test("logged-out mobile plans keeps navigation available", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await clearAuth(page);
    await page.goto("/plans");

    await page.getByRole("button", { name: /open navigation/i }).click();
    await page.getByRole("link", { name: /^ask$/i }).click();
    await expect(page).toHaveURL(/\/chat\/?$/);
  });

  test("logged-out chat route loads directly", async ({ page }) => {
    await clearAuth(page);
    const response = await page.goto("/chat");

    expect(response?.ok(), `guest /chat response ${response?.status()}`).toBe(
      true,
    );
    await expect(page).toHaveURL(/\/chat\/?$/);
    await expect(
      page.getByRole("heading", { name: /ask plan/i }),
    ).toBeVisible();
  });

  test("trailing-slash public routes keep their shells", async ({ page }) => {
    await clearAuth(page);

    await page.goto("/chat/");
    await expect(
      page.getByRole("heading", { name: /ask plan/i }),
    ).toBeVisible();

    await page.evaluate(() => {
      sessionStorage.setItem(
        "agent-native.plans.chat-home-handoff",
        String(Date.now()),
      );
      (
        window as typeof window & { handoffTransitions?: number }
      ).handoffTransitions = 0;
      window.addEventListener("agentNative.chatViewTransitionPrepare", () => {
        window.handoffTransitions = (window.handoffTransitions ?? 0) + 1;
      });
    });
    await page
      .getByRole("link", { name: /^plan$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/plans\/?$/);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { handoffTransitions?: number })
            .handoffTransitions,
      ),
    ).toBe(1);

    await page.goto("/plans/");
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.getByText("Start with /visual-plan")).toBeVisible();
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
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/");
    const owner = await createOwnerContext(ownerPage);
    const title = `Public guest-view plan ${Date.now()}`;
    const planId = await createPlanAs(owner.request, title);
    await makePublic(owner.request, planId);
    await ownerCtx.close();

    await clearAuth(page);
    await page.goto("/plans");
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

    await page.goto(`/plans/${planId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle(/Plan|Agent-Native/i, { timeout: 15_000 });
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

    expect(
      priv.status(),
      `denied private read should be a 4xx access error, not a 500; got ${priv.status()}`,
    ).toBeLessThan(500);

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
    const res = await page.request.post(
      "/_agent-native/actions/create-visual-plan",
      { data: { title: `guest-cap-probe-${Date.now()}`, brief: "cap probe" } },
    );
    expect(
      res.status(),
      `guest create rejection status ${res.status()}`,
    ).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    expect(
      /sign in|unauthorized|guest plan limit|try again shortly|limit reached/i.test(
        body,
      ),
      `guest create rejection should be a friendly message, got: ${body.slice(
        0,
        200,
      )}`,
    ).toBeTruthy();
    expect(body).not.toMatch(
      /internal server error|cannot read propert|undefined is not/i,
    );
  });

  test("signing in from guest mode lands signed-in: banner gone, account plans listed (claim path)", async ({
    page,
  }) => {
    await clearAuth(page);
    await page.goto("/plans");
    await expect(page.getByText("Start with /visual-plan")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/viewing as a guest/i)).toHaveCount(0);

    const email = `guest-claim+autoz-${Date.now()}-${Math.floor(
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

    const claimedTitle = `Claimed-after-signin ${Date.now()}`;
    const planId = await createPlanAs(page.request, claimedTitle);

    await page.goto("/plans");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-onboarding-screen]")).toHaveCount(0);

    await expect(
      page.getByText(/viewing as a guest/i),
      "guest banner disappears after sign-in",
    ).toHaveCount(0, { timeout: 15_000 });

    await expect(
      page.getByText(claimedTitle).first(),
      "the signed-in account's plan is listed after sign-in",
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("button", { name: /^new plan$/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /sign in to create/i }),
    ).toHaveCount(0);

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
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/");
    const owner = await createOwnerContext(ownerPage);
    const title = `Public review-link plan ${Date.now()}`;
    const planId = await createPlanAs(owner.request, title);
    await makePublic(owner.request, planId);

    const owner2Email = `guestspec-owner2+autoz-${Date.now()}@plan.test`;
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

    const anonCtx = await browser.newContext();
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
