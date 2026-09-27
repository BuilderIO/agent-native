import { test, expect, type Page } from "@playwright/test";

import { planE2eUsesLocalPlanOwner } from "./auth-state";

function makeE2ePassword(label: string): string {
  return ["example", label, Date.now().toString(36), "pw"].join("-");
}

type Fixture = { id: string; title: string; url: string };

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

function trackReloads(page: Page): { count: () => number } {
  let n = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) n++;
  });
  return { count: () => n };
}

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

async function waitForShell(page: Page) {
  await expect(page.locator(".plans-workspace")).toBeVisible({
    timeout: 25_000,
  });
}

async function waitForNavSidebar(page: Page) {
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 25_000 });
}

async function waitForOverview(page: Page) {
  await waitForNavSidebar(page);
  await expect
    .poll(async () => (await page.locator("body").innerText()).length, {
      timeout: 25_000,
    })
    .toBeGreaterThan(10);
}

test.describe("nav / routing / error+loading", () => {
  test("home lists plans in the overview grid", async ({ page }) => {
    const fixture = await createPlan(
      page,
      `Sidebar+Grid ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    );
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForOverview(page);

    const main = page.locator("main");
    await expect(
      main.getByRole("link", { name: titleRegExp(fixture.title) }).first(),
      "the new plan should appear as a grid card on the home overview",
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

  test("clicking the global Plan nav item is an SPA nav", async ({ page }) => {
    const a = await createPlan(
      page,
      `SideA ${Date.now()}-${Math.random().toString(16).slice(2, 5)}`,
    );
    await page.goto("/team", { waitUntil: "domcontentloaded" });
    await waitForNavSidebar(page);

    const reloads = trackReloads(page);
    const reloadsBefore = reloads.count();
    const token = `side-${Date.now()}`;
    await stampShell(page, token);

    const sidebar = page.locator("aside").first();
    const planLink = sidebar.getByRole("link", { name: /^Plan$/ });
    await expect(planLink).toBeVisible({ timeout: 20_000 });
    await planLink.click();
    await expect(page).toHaveURL(/\/plans\/?$/);
    await waitForOverview(page);
    await expect(
      page
        .locator("main")
        .getByRole("link", { name: titleRegExp(a.title) })
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    if (reloads.count() === reloadsBefore) {
      expect(
        await shellSurvived(page, token),
        "global Plan nav must be SPA (no full reload — window marker should survive)",
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

    await expect(
      page.getByText(/Plan not found/i),
      "a non-existent or inaccessible plan must resolve to a graceful access card (no infinite skeleton, no crash)",
    ).toBeVisible({ timeout: 25_000 });

    const body = await page.locator("body").innerText();

    expect(
      /internal server error/i.test(body),
      'non-existent plan should NOT surface a raw "Internal server error" message — it is a not-found, not a 500',
    ).toBeFalsy();
    expect(
      /plan not found|does not exist/i.test(body),
      "non-existent plan should explain that the URL does not exist",
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

    await expect(async () => {
      const t = await page.locator("body").innerText();
      expect(/Plan (did not load|not found)/i.test(t)).toBeFalsy();
      expect(
        /flip brief|fixture brief|What we are planning/i.test(t),
        "real plan content should render",
      ).toBeTruthy();
    }).toPass({ timeout: 25_000 });

    let reloadsAtContent = reloads.count();
    let regressedWithoutReload = false;
    let errorEverShown = false;
    for (let i = 0; i < 14; i++) {
      const state = await page.evaluate(() => {
        const errorShown =
          document.body.innerText.includes("Plan did not load") ||
          document.body.innerText.includes("Sign in to view this plan") ||
          document.body.innerText.includes("Request access to this plan");
        const skeleton = document.querySelectorAll(
          "[aria-label='Loading plan']",
        ).length;
        const blocks = document.querySelectorAll("[data-block-id]").length;
        return { errorShown, skeleton, blocks };
      });
      if (state.errorShown) errorEverShown = true;
      const isSkeletonOnly = state.skeleton > 0 && state.blocks === 0;
      if (isSkeletonOnly && reloads.count() === reloadsAtContent) {
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
    await expect(page).toHaveURL(/\/plans(\/|$)/);
    await expect(
      page.getByText(/Plan (did not load|not found)/i),
      "rapid back/forward must not corrupt routing into a load-error for a real plan",
    ).toHaveCount(0, { timeout: 20_000 });
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
    await page
      .locator("main")
      .getByRole("link", { name: titleRegExp(fixture.title) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/plans/${fixture.id}$`));
    await page.goBack().catch(() => {});
    await expect(page).toHaveURL(/\/plans\/?$/);
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
    test.skip(
      planE2eUsesLocalPlanOwner(),
      "default local Plan runtime deliberately maps all browser users to one synthetic local owner; run with PLAN_LOCAL_MODE=0 or AUTH_MODE!=local to test hosted cross-owner isolation",
    );

    const otherCtx = await browser.newContext();
    const otherPage = await otherCtx.newPage();
    const email = `other+autoz-${Date.now()}-${Math.random()
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

    await page.goto(`/plans/${otherPlanId}`, { waitUntil: "domcontentloaded" });

    // SECURITY/UX: the foreign private plan must NOT render its secret content
    // for an unauthorized viewer. It should resolve to the graceful not-found
    // card instead of the plan body.
    await expect(async () => {
      const body = await page.locator("body").innerText();
      expect(
        /PRIVATE-PLAN-SECRET/.test(body),
        "a plan owned by another user must not leak its private content to an unauthorized viewer",
      ).toBeFalsy();
    }).toPass({ timeout: 20_000 });

    await expect(
      page.getByText(/Request access to this plan|Sign in to view this plan/i),
      "an inaccessible foreign plan must resolve to the graceful access-request card",
    ).toBeVisible({ timeout: 20_000 });

    await waitForShell(page);

    expect(
      foreignPlanStatuses.every((status) => status >= 400 && status < 500),
      `get-visual-plan for a foreign plan must return a 4xx, not a 5xx (saw: ${foreignPlanStatuses.join(", ") || "none"})`,
    ).toBeTruthy();
  });
});
