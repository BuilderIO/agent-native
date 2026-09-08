import { test, expect, type APIRequestContext } from "@playwright/test";

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

function planIdFrom(body: ActionResult): string | undefined {
  return body.planId ?? body.plan?.id;
}

test.describe("plan-design full-fidelity review surface", () => {
  test("renders scoped design CSS, selection inspector, and matching prototype tab", async ({
    page,
    request,
  }) => {
    const res = await action(request, "create-plan-design", {
      title: `Plan Design E2E ${Date.now()}`,
      brief:
        "Verify full-fidelity CSS, selected design-element editing, and prototype tab rendering.",
      designMd:
        "Use a compact billing settings surface with a teal primary action.",
      codebaseStyles: {
        cssVars: {
          "--color-primary": "#0f766e",
          "--radius-card": "12px",
        },
      },
      screens: [
        {
          id: "billing-overview",
          title: "Billing Overview",
          summary: "Full-fidelity billing settings review.",
          surface: "browser",
          html: [
            '<main class="billing-shell" data-design-id="billing-shell">',
            '<section class="billing-main" data-design-id="billing-main">',
            '<p class="eyebrow">Workspace billing</p>',
            "<h1>Plan and usage</h1>",
            '<button class="primary-action" data-design-id="primary-action">Update plan</button>',
            "</section>",
            "</main>",
          ].join(""),
          css: [
            ".billing-shell { min-height: 100%; display: grid; background: #f8fafc; color: #111827; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }",
            ".billing-main { display: grid; align-content: start; gap: 18px; padding: 36px; }",
            ".eyebrow { margin: 0; color: #0f766e; font-size: 12px; font-weight: 800; text-transform: uppercase; }",
            ".billing-main h1 { margin: 0; font-size: 38px; line-height: 1.05; }",
            ".primary-action { justify-self: start; border: 0; border-radius: 12px; padding: 12px 16px; background: #0f766e; color: white; font-weight: 800; }",
            "@media (max-width: 640px) { .billing-main { padding: 20px; } }",
          ].join("\n"),
        },
        {
          id: "billing-mobile",
          title: "Billing Mobile",
          summary: "Mobile billing confirmation state.",
          surface: "mobile",
          html: [
            '<main class="mobile-billing-shell" data-design-id="mobile-shell">',
            "<h1>Mobile billing</h1>",
            '<button class="primary-action" data-design-id="mobile-action">Confirm plan</button>',
            "</main>",
          ].join(""),
          css: [
            ".mobile-billing-shell { min-height: 100%; display: grid; align-content: start; gap: 16px; padding: 24px; background: #ffffff; color: #111827; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }",
            ".mobile-billing-shell h1 { margin: 0; font-size: 28px; line-height: 1.1; }",
            ".primary-action { border: 0; border-radius: 12px; padding: 12px 16px; background: #0f766e; color: white; font-weight: 800; }",
          ].join("\n"),
        },
      ],
      transitions: [
        {
          from: "billing-overview",
          to: "billing-mobile",
          label: "Review mobile flow",
          trigger: "Open mobile review",
        },
      ],
    });

    expect(
      res.ok,
      `create-plan-design should succeed (${res.status}: ${res.raw.slice(0, 240)})`,
    ).toBeTruthy();
    const planId = planIdFrom(res.body);
    expect(planId, "create-plan-design must return a plan id").toBeTruthy();

    await page.goto(`/plans/${planId}`);
    await page.waitForLoadState("domcontentloaded");
    const tabs = page.locator("[data-plan-visual-tabs]");
    await expect(tabs).toContainText("Design");
    await expect(tabs).toContainText("Prototype");

    const primary = page.locator('[data-design-id="primary-action"]').first();
    await expect(primary).toBeVisible();
    await expect(primary).toHaveCSS("background-color", "rgb(15, 118, 110)");
    await expect(primary).toHaveCSS("border-radius", "12px");
    await expect(primary).toHaveCSS("padding", "12px 16px");

    await primary.click();
    await expect(page.getByText("Design element")).toBeVisible();
    await expect(page.getByText("primary-action")).toBeVisible();
    await expect(page.getByText("Review mobile flow")).toBeVisible();

    await page.getByLabel("Fill").fill("#ff0055");
    await page.getByLabel("Fill").press("Enter");
    await expect(primary).toHaveCSS("background-color", "rgb(255, 0, 85)");

    await page.getByRole("tab", { name: /Prototype/i }).click();
    await expect(page.getByText("Update plan").first()).toBeVisible();
    const prototypePrimary = page.locator(
      '[data-plan-prototype-viewer] [data-design-id="primary-action"]',
    );
    await expect(prototypePrimary).toHaveCSS(
      "background-color",
      "rgb(255, 0, 85)",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/plans/${planId}`);
    await page.waitForLoadState("domcontentloaded");
    const mobilePrimary = page
      .locator('[data-plan-canvas-world] [data-design-id="primary-action"]')
      .first();
    await expect(mobilePrimary).toBeVisible();
    const box = await mobilePrimary.boundingBox();
    expect(
      box,
      "primary action should have a visible mobile bounding box",
    ).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 999) + (box?.width ?? 999)).toBeLessThanOrEqual(390);
  });
});
