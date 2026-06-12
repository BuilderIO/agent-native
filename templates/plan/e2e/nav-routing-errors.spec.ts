import { test, expect, type Page } from "@playwright/test";

function makeE2ePassword(label: string): string {
  return ["example", label, Date.now().toString(36), "pw"].join("-");
}

/*
 * NAVIGATION / ROUTING / ERROR + LOADING STATES (authed).
 *
 * Adversarial coverage of the Plan app shell routing:
 *  - home lists plans in the LEFT sidebar and in the grid
 *  - clicking a sidebar item and a grid card navigates to /plans/<id> as an SPA
 *    nav (the app shell must NOT do a full document reload)
 *  - deep-linking directly to /plans/<id> works
 *  - a non-existent /plans/<id> shows a GRACEFUL not-found (no crash, no infinite
 *    skeleton, no raw "Internal server error")
 *  - the plan-detail loading skeleton appears then resolves and does not loop
 *  - no "Internal server error" toast/message on a real plan
 *  - /extensions and /team routes load
 *  - rapid back/forward, navigating mid-load, and a plan you don't own
 *
 * Resilience: a SHARED dev server is under test and other agents may trigger
 * Vite HMR full reloads at any time. We detect main-frame navigations and only
 * treat a wiped window marker as a "remount" bug when NO full reload occurred
 * during the action. Web-first assertions absorb transient reloads (retries:2).
 *
 * All specs are ASSERTIONS OF CORRECT behavior. A failure is a reported bug.
 */

type Fixture = { id: string; title: string; url: string };

/**
 * Escape a fixture title before embedding it in a RegExp. Titles include
 * random hex suffixes and human-readable prefixes that contain regex
 * metacharacters (e.g. "Sidebar+Grid"). Without escaping, `new RegExp(title)`
 * silently fails to match the literal accessible name.
 */
function titleRegExp(title: string): RegExp {
  return new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

async function createPlan(
  page: Page,
  title: string,
  brief = "Adversarial nav/routing fixture brief.",
): Promise<Fixture> {
  const res = await page.request.post(
    "/_agent-native/actions/create-visual-plan",
    {
      data: {
        title,
        brief,
        sections: [
          {
            type: "summary",
            title: "What we are planning",
            body: brief,
            order: 0,
            createdBy: "agent",
          },
        ],
      },
    },
  );
  expect(
    res.ok(),
    `create-visual-plan should succeed (got ${res.status()})`,
  ).toBeTruthy();
  const json = (await res.json()) as {
    planId?: string;
    plan?: { id?: string };
    url?: string;
  };
  const id = json.planId ?? json.plan?.id;
  expect(id, "create-visual-plan must return a plan id").toBeTruthy();
  return { id: id as string, title, url: `/plans/${id}` };
}

/** Track full-document reloads (HMR or hard nav) so SPA assertions can tolerate them. */
function trackReloads(page: Page): { count: () => number } {
  let n = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) n++;
  });
  return { count: () => n };
}

/** Stamp a window marker; a full document reload wipes it, an SPA nav preserves it. */
async function stampShell(page: Page, token: string) {
  await page.evaluate((t) => {
    (window as unknown as Record<string, unknown>).__navShellToken = t;
  }, token);
}
async function shellSurvived(page: Page, token: string): Promise<boolean> {
  return page.evaluate(
    (t) => (window as unknown as Record<string, unknown>).__navShellToken === t,
    token,
  );
}

/**
 * Wait until the client-rendered app shell has hydrated.
 *
 * Post-refactor, the plan reader is IMMERSIVE by default (planFullscreen), which
 * intentionally hides the global left `aside` on `/plans/<id>` routes. So we
 * can't key off `aside` alone. The `.plans-workspace` root is rendered by
 * PlansPage in every state (overview, skeleton, reader, and the load-error
 * card), so it is the reliable "shell is alive, not a blank crash boundary"
 * anchor across both the overview and detail routes.
 */
async function waitForShell(page: Page) {
  await expect(page.locator(".plans-workspace")).toBeVisible({
    timeout: 25_000,
  });
}

/** Wait until the global left navigation sidebar is present (overview routes only). */
async function waitForNavSidebar(page: Page) {
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 25_000 });
}

/** Wait until the plans overview (list view) has rendered its content. */
async function waitForOverview(page: Page) {
  // The overview route is never the immersive reader, so the global nav sidebar
  // must be present here.
  await waitForNavSidebar(page);
  // The overview heading "Plan" plus the New Plan button; tolerate empty state.
  await expect
    .poll(async () => (await page.locator("body").innerText()).length, {
      timeout: 25_000,
    })
    .toBeGreaterThan(10);
}

test.describe("nav / routing / error+loading", () => {
  test("home lists plans in the left sidebar and grid", async ({ page }) => {
    const fixture = await createPlan(
      page,
      `Sidebar+Grid ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForOverview(page);

    // Grid card on the overview (main content area, not the aside).
    const main = page.locator("main");
    await expect(
      main.getByRole("link", { name: titleRegExp(fixture.title) }).first(),
      "the new plan should appear as a grid card on the home overview",
    ).toBeVisible({ timeout: 20_000 });

    // Left sidebar plan list (rendered when /plans is active, >= md viewport).
    const sidebar = page.locator("aside").first();
    await expect(
      sidebar.getByRole("link", { name: titleRegExp(fixture.title) }),
      "the new plan should appear in the left sidebar plan list",
    ).toBeVisible({ timeout: 20_000 });
  });

  test("clicking a grid card is an SPA nav (no full document reload)", async ({
    page,
  }) => {
    const fixture = await createPlan(
      page,
      `GridNav ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForOverview(page);

    const reloads = trackReloads(page);
    const reloadsBefore = reloads.count();
    const token = `grid-${Date.now()}`;
    await stampShell(page, token);

    await page
      .locator("main")
      .getByRole("link", { name: titleRegExp(fixture.title) })
      .first()
      .click();

    await expect(page).toHaveURL(new RegExp(`/plans/${fixture.id}$`));

    // Only assert "no remount" if no HMR reload happened during the click.
    if (reloads.count() === reloadsBefore) {
      expect(
        await shellSurvived(page, token),
        "clicking a grid card must be an SPA navigation (no full reload — window marker should survive)",
      ).toBeTruthy();
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "An HMR/full reload occurred during the click; SPA-remount assertion skipped (shared server).",
      });
    }
  });

  test("clicking a sidebar item is an SPA nav (app shell persists)", async ({
    page,
  }) => {
    const a = await createPlan(
      page,
      `SideA ${Date.now()}-${Math.random().toString(16).slice(2, 5)}`,
    );
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForOverview(page);

    const reloads = trackReloads(page);
    const reloadsBefore = reloads.count();
    const token = `side-${Date.now()}`;
    await stampShell(page, token);

    const sidebar = page.locator("aside").first();
    const sideLink = sidebar.getByRole("link", { name: titleRegExp(a.title) });
    await expect(sideLink).toBeVisible({ timeout: 20_000 });
    await sideLink.click();
    await expect(page).toHaveURL(new RegExp(`/plans/${a.id}$`));

    if (reloads.count() === reloadsBefore) {
      expect(
        await shellSurvived(page, token),
        "sidebar nav must be SPA (no full reload — window marker should survive)",
      ).toBeTruthy();
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "An HMR/full reload occurred during the click; SPA-remount assertion skipped (shared server).",
      });
    }
  });

  test("deep-linking directly to /plans/<id> renders the plan, not a crash", async ({
    page,
  }) => {
    const fixture = await createPlan(
      page,
      `DeepLink ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });

    // The plan reader resolves to actual plan content (the brief we created),
    // and never settles on the not-found / load-error card.
    await expect(async () => {
      const text = await page.locator("body").innerText();
      expect(
        /Plan (did not load|not found)/i.test(text),
        "deep-linked real plan must not show the load-error card",
      ).toBeFalsy();
      expect(
        text.includes("fixture brief") || text.includes("What we are planning"),
        "deep-linked plan content should render",
      ).toBeTruthy();
    }).toPass({ timeout: 25_000 });
  });

  test("non-existent /plans/<id> shows a graceful not-found, not a raw 500", async ({
    page,
  }) => {
    const bogus = "plan_doesnotexist_zzz";
    const reloads = trackReloads(page);
    const planReadStatuses: number[] = [];
    page.on("response", (resp) => {
      const url = resp.url();
      if (
        url.includes("/_agent-native/actions/get-visual-plan") &&
        url.includes(bogus)
      ) {
        planReadStatuses.push(resp.status());
      }
    });
    await page.goto(`/plans/${bogus}`, { waitUntil: "domcontentloaded" });

    // It must resolve to a graceful error card within a bounded time — not crash
    // to a blank boundary and not spin on a skeleton forever.
    await expect(
      page.getByText(/Plan not found/i),
      "a non-existent plan must resolve to a graceful not-found card (no infinite skeleton, no crash)",
    ).toBeVisible({ timeout: 25_000 });

    const body = await page.locator("body").innerText();

    // BUG ASSERTION: a missing plan is a 404/not-found, not a server fault. The
    // user-facing message must communicate "not found", NOT the generic
    // "Internal server error" leaked from a masked 500 (loadPlanBundle throws a
    // plain Error → action route returns HTTP 500 {error:"Internal server error"}
    // → PlanLoadError renders that string).
    expect(
      /internal server error/i.test(body),
      'non-existent plan should NOT surface a raw "Internal server error" message — it is a not-found, not a 500',
    ).toBeFalsy();
    expect(
      /not found|does not exist|couldn'?t find|no longer available|can'?t be found|isn'?t available/i.test(
        body,
      ),
      "non-existent plan should communicate a not-found state to the user",
    ).toBeTruthy();

    const reloadsAtNotFound = reloads.count();
    const readsAtNotFound = planReadStatuses.length;
    let skeletonAfterNotFound = false;
    for (let i = 0; i < 7; i++) {
      const loadingPlanCount = await page
        .locator("[aria-label='Loading plan']")
        .count();
      if (loadingPlanCount > 0 && reloads.count() === reloadsAtNotFound) {
        skeletonAfterNotFound = true;
      }
      await page.waitForTimeout(700);
    }

    expect(
      skeletonAfterNotFound,
      "a settled not-found plan must not flash back to the skeleton during background refreshes",
    ).toBeFalsy();
    if (reloads.count() === reloadsAtNotFound) {
      expect(
        planReadStatuses.length,
        "a settled not-found plan should stop the 3s get-visual-plan poll; Retry remains manual",
      ).toBe(readsAtNotFound);
    }
  });

  test("plan-detail skeleton resolves and does not flip-flop to skeleton without a reload", async ({
    page,
  }) => {
    const fixture = await createPlan(
      page,
      `Skeleton ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    const reloads = trackReloads(page);
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });

    // Wait for content to first resolve (no error card for a real plan).
    await expect(async () => {
      const t = await page.locator("body").innerText();
      expect(/Plan (did not load|not found)/i.test(t)).toBeFalsy();
      expect(
        /flip brief|fixture brief|What we are planning/i.test(t),
        "real plan content should render",
      ).toBeTruthy();
    }).toPass({ timeout: 25_000 });

    // Now sample repeatedly. The reader must never show the load-error card for a
    // real plan, and must not regress to a skeleton AFTER content has rendered
    // unless a full document reload happened (HMR on the shared server).
    let reloadsAtContent = reloads.count();
    let regressedWithoutReload = false;
    let errorEverShown = false;
    for (let i = 0; i < 14; i++) {
      const state = await page.evaluate(() => {
        const errorShown =
          document.body.innerText.includes("Plan did not load") ||
          document.body.innerText.includes("Plan not found");
        const skeleton = document.querySelectorAll(
          "[aria-label='Loading plan']",
        ).length;
        const blocks = document.querySelectorAll("[data-block-id]").length;
        return { errorShown, skeleton, blocks };
      });
      if (state.errorShown) errorEverShown = true;
      const isSkeletonOnly = state.skeleton > 0 && state.blocks === 0;
      if (isSkeletonOnly && reloads.count() === reloadsAtContent) {
        // Content was up, no reload happened, yet we are back to a skeleton.
        regressedWithoutReload = true;
      }
      if (state.blocks > 0) reloadsAtContent = reloads.count();
      await page.waitForTimeout(700);
    }

    expect(
      errorEverShown,
      "a real plan must never show the load-error card during polling",
    ).toBeFalsy();
    expect(
      regressedWithoutReload,
      "the plan view must not flip back to a skeleton after content rendered without a full reload (no polling-driven skeleton loop)",
    ).toBeFalsy();
  });

  test("no 'Internal server error' surfaces on a normal plan", async ({
    page,
  }) => {
    const action500s: string[] = [];
    page.on("response", (resp) => {
      const url = resp.url();
      if (url.includes("/_agent-native/actions/") && resp.status() >= 500) {
        action500s.push(`${resp.status()} ${url.split("?")[0]}`);
      }
    });
    const fixture = await createPlan(
      page,
      `NoToast ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await expect(async () => {
      const t = await page.locator("body").innerText();
      expect(
        /What we are planning|fixture brief/i.test(t),
        "real plan content should render",
      ).toBeTruthy();
    }).toPass({ timeout: 25_000 });

    // Let polling run a couple of cycles.
    await page.waitForTimeout(4_000);
    await expect(
      page.getByText(/internal server error/i),
      "a real plan must never show an 'Internal server error' message",
    ).toHaveCount(0);
    expect(
      action500s,
      `no action endpoint should 500 while viewing a real plan (saw: ${action500s.join(", ")})`,
    ).toEqual([]);
  });

  test("/extensions route loads", async ({ page }) => {
    await page.goto("/extensions", { waitUntil: "domcontentloaded" });
    // Non-plan shell route: the global nav sidebar is present (not the immersive
    // reader, and not the PlansPage `.plans-workspace` root).
    await waitForNavSidebar(page);
    await expect(async () => {
      const body = await page.locator("body").innerText();
      expect(
        /extension/i.test(body),
        "/extensions should render an extensions surface",
      ).toBeTruthy();
    }).toPass({ timeout: 20_000 });
    const body = await page.locator("body").innerText();
    expect(
      /internal server error/i.test(body),
      "/extensions must not show an internal server error",
    ).toBeFalsy();
  });

  test("/team route loads", async ({ page }) => {
    await page.goto("/team", { waitUntil: "domcontentloaded" });
    // Non-plan shell route: the global nav sidebar is present (not the immersive
    // reader, and not the PlansPage `.plans-workspace` root).
    await waitForNavSidebar(page);
    await expect(async () => {
      const body = await page.locator("body").innerText();
      expect(
        /team|organization|organisation|members|colleagues|workspace/i.test(
          body,
        ),
        "/team should render the team/org surface",
      ).toBeTruthy();
    }).toPass({ timeout: 20_000 });
    const body = await page.locator("body").innerText();
    expect(
      /internal server error/i.test(body),
      "/team must not show an internal server error",
    ).toBeFalsy();
  });

  test("rapid back/forward between list and plan stays consistent (no stuck skeleton/error)", async ({
    page,
  }) => {
    const fixture = await createPlan(
      page,
      `BackFwd ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForOverview(page);
    await page
      .locator("main")
      .getByRole("link", { name: titleRegExp(fixture.title) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/plans/${fixture.id}$`));

    for (let i = 0; i < 4; i++) {
      await page.goBack().catch(() => {});
      await page.goForward().catch(() => {});
    }
    // Land on the plan and confirm it resolves (not a stuck error card).
    await expect(page).toHaveURL(/\/plans(\/|$)/);
    await expect(
      page.getByText(/Plan (did not load|not found)/i),
      "rapid back/forward must not corrupt routing into a load-error for a real plan",
    ).toHaveCount(0, { timeout: 20_000 });
    // App shell still alive.
    await waitForShell(page);
  });

  test("navigating away mid-load does not strand a skeleton or error the shell", async ({
    page,
  }) => {
    const fixture = await createPlan(
      page,
      `MidLoad ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForOverview(page);
    // Click into the plan, then bounce back before the reader settles. We wait
    // for the SPA push to COMMIT (URL is now /plans/<id>) so goBack pops the
    // overview entry instead of racing it and landing on about:blank — but we do
    // NOT wait for the plan content/skeleton to resolve, so the back nav still
    // interrupts mid-load.
    await page
      .locator("main")
      .getByRole("link", { name: titleRegExp(fixture.title) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/plans/${fixture.id}$`));
    await page.goBack().catch(() => {});
    await expect(page).toHaveURL(/\/plans\/?$/);
    // The overview should render again (sidebar present, list resolves), not a
    // stranded skeleton or an errored shell.
    await waitForNavSidebar(page);
    await expect(
      page
        .locator("main")
        .getByRole("link", { name: titleRegExp(fixture.title) })
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("nav / routing — plan you don't own", () => {
  test("a private plan owned by another user is not leaked to an unauthorized viewer", async ({
    page,
    browser,
  }) => {
    const otherCtx = await browser.newContext();
    const otherPage = await otherCtx.newPage();
    const email = `other-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2, 8)}@plan.test`;
    const password = makeE2ePassword("other-user");
    let otherPlanId = "";
    let provisioned = false;
    try {
      await otherPage.goto("/", { waitUntil: "domcontentloaded" });
      await otherPage.waitForTimeout(1200);
      const reg = await otherPage.evaluate(
        async ({ e, p }) => {
          const post = (path: string, body: unknown) =>
            fetch(path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }).then((r) => ({ ok: r.ok, status: r.status }));
          let login = await post("/_agent-native/auth/login", {
            email: e,
            password: p,
          });
          if (!login.ok) {
            await post("/_agent-native/auth/register", {
              email: e,
              password: p,
              name: "Other User",
              callbackURL: "/plans",
            });
            login = await post("/_agent-native/auth/login", {
              email: e,
              password: p,
            });
          }
          return login;
        },
        { e: email, p: password },
      );
      provisioned = reg.ok;
      if (provisioned) {
        const created = await otherPage.request.post(
          "/_agent-native/actions/create-visual-plan",
          {
            data: {
              title: `OtherOwned ${Date.now()}`,
              brief:
                "PRIVATE-PLAN-SECRET owned by a different user. Should be hidden.",
              sections: [
                {
                  type: "summary",
                  title: "Private",
                  body: "PRIVATE-PLAN-SECRET",
                  order: 0,
                  createdBy: "agent",
                },
              ],
            },
          },
        );
        if (created.ok()) {
          const json = (await created.json()) as {
            planId?: string;
            plan?: { id?: string };
          };
          otherPlanId = (json.planId ?? json.plan?.id) as string;
        }
      }
    } finally {
      await otherCtx.close();
    }

    test.skip(
      !provisioned || !otherPlanId,
      "could not provision a second user/plan in this env — skipping cross-owner check",
    );

    // Capture the get-visual-plan response statuses for the foreign plan. A
    // missing-or-private plan must come back as a clean 4xx (403, per the
    // server's ForbiddenError that conflates not-found and no-permission to
    // avoid leaking existence) — NOT a 5xx that would leak an internal stack.
    const foreignPlanStatuses: number[] = [];
    page.on("response", (resp) => {
      const url = resp.url();
      if (
        url.includes("/_agent-native/actions/get-visual-plan") &&
        url.includes(otherPlanId)
      ) {
        foreignPlanStatuses.push(resp.status());
      }
    });

    // As the DEFAULT authed user, try to deep-link the other user's private plan.
    await page.goto(`/plans/${otherPlanId}`, { waitUntil: "domcontentloaded" });

    // SECURITY/UX: the foreign private plan must NOT render its secret content
    // for an unauthorized viewer. It should resolve to the graceful not-found
    // card instead of the plan body.
    await expect(async () => {
      const body = await page.locator("body").innerText();
      // A graceful not-found / no-access card is acceptable; leaking the secret
      // is not.
      expect(
        /PRIVATE-PLAN-SECRET/.test(body),
        "a plan owned by another user must not leak its private content to an unauthorized viewer",
      ).toBeFalsy();
    }).toPass({ timeout: 20_000 });

    await expect(
      page.getByText(/Plan not found/i),
      "an inaccessible foreign plan must resolve to the graceful not-found card",
    ).toBeVisible({ timeout: 20_000 });

    // And it should not crash the shell.
    await waitForShell(page);

    // The action surface must have answered with a 4xx, never a 5xx. (It is fine
    // for the polling query to have produced no captured response yet on a
    // transient HMR reload; but anything we DID capture must be a 4xx.)
    expect(
      foreignPlanStatuses.every((status) => status >= 400 && status < 500),
      `get-visual-plan for a foreign plan must return a 4xx, not a 5xx (saw: ${foreignPlanStatuses.join(", ") || "none"})`,
    ).toBeTruthy();
  });
});
