import { readFileSync } from "node:fs";

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Locator,
} from "@playwright/test";

import {
  expectedPlanCommentAuthorEmail,
  planE2eAuthEmailPath,
} from "./auth-state";

/*
 * PROTOTYPE PLAN — deep, adversarial E2E for the prototype-first plan feature
 * (content.prototype = functional screens + transitions rendered ABOVE the
 * document by the PrototypeViewer).
 *
 * What we cover:
 *  - create-prototype-plan via the authed action surface: persistence of
 *    screens + transitions + an auto-derived static-mock canvas, SQL round-trip.
 *  - The functional PrototypeViewer rendering on top: data-goto hotspots
 *    advance true screens/routes, and local prototype directives drive basic
 *    inputs, toggles, filtering, and list mutation without scripts.
 *  - The shared review toolbar: comment mode, sketchy<->clean (the rendered
 *    frame's data-style flips), dark<->light, and POPOUT (a real new browser
 *    page opens to ?prototype=1) without stacking a second prototype toolbar.
 *  - TABS: a prototype plan always derives a canvas, so the surface shows
 *    Prototype / Wireframes tabs ([data-plan-visual-tabs]); flipping the tab
 *    swaps the top surface (viewer <-> canvas board) and back.
 *  - The standalone popout (?prototype=1): viewer only, no tabs, no document
 *    header, "Open full plan" control, navigation still works.
 *  - COMMENTS on the prototype: a UI-dropped comment pin persists with the
 *    real reviewer identity; an API-dropped prototype pin keeps its prototype
 *    anchor, survives reload, and routes to the agent (actionableThreads) vs a
 *    human (humanReviewThreads) per resolutionTarget — the "send to agent" path.
 *  - convert-visual-plan-to-prototype: an HTML-canvas plan becomes a live
 *    prototype (keeps static mocks by default; removeCanvas drops them).
 *  - Adversarial edges: single-screen prototype; cyclic A->B->A; a dead data-goto
 *    (missing screen id) is a guarded no-op; a transition to a non-existent screen
 *    is a 4xx client error (NOT a 500); converting a document-only plan with no
 *    canvas is a 4xx client error (NOT a 500).
 *
 * Reviewer identity for the authed project is e2e-tester@plan.test
 * (e2e/global-setup.ts). Every assertion encodes CORRECT behavior; a genuine
 * failure of correct behavior is a reported app bug, not a flaky spec. Specs use
 * web-first auto-retrying assertions (no fixed sleeps) so concurrent-agent HMR
 * reloads are absorbed by config retries.
 *
 * Renderer facts grounded in the running app (PrototypeViewer.tsx /
 * PlanVisualSurface.tsx / PlanContentRenderer.tsx / PlansPage.tsx):
 *  - The viewer is [data-plan-prototype-viewer]; the active screen container is
 *    [data-prototype-screen="<id>"]; screen ids are slugs of titles.
 *  - The rendered HTML frame carries data-style="sketchy|clean" (Wireframe.tsx),
 *    which the rough/clean toggle flips for every wireframe in the viewer.
 *  - create-prototype-plan derives a static-mock canvas, so the surface shows
 *    Prototype/Wireframes tabs (role=tab "Prototype"/"Wireframes").
 *  - ?prototype=1 renders only the standalone viewer (no tabs, no document).
 *  - Popout = window.open(url+?prototype=1, "_blank") — a real new page.
 *  - goToScreen() guards unknown ids, so dead hotspots are no-ops, never crashes.
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

async function getPlan(
  req: APIRequestContext,
  planId: string,
): Promise<ActionResult> {
  const res = await req.get(
    `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(planId)}`,
  );
  return (await res.json().catch(() => ({}))) as ActionResult;
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

function planIdFrom(body: ActionResult): string | undefined {
  return body.planId ?? body.plan?.id;
}

/** Add a comment server-side with an explicit prototype anchor + resolution
 *  target. Mirrors what the UI sends when a reviewer pins a prototype dot and
 *  chooses to route it to the agent or to a human. */
async function addPrototypeComment(
  req: APIRequestContext,
  planId: string,
  opts: {
    message: string;
    screenId: string;
    resolutionTarget: "agent" | "human";
  },
) {
  const anchor = JSON.stringify({
    type: "point",
    targetKind: "prototype",
    sectionId: opts.screenId,
    resolutionTarget: opts.resolutionTarget,
    x: 0.32,
    y: 0.41,
  });
  return action(req, "update-visual-plan", {
    planId,
    comments: [
      {
        message: opts.message,
        createdBy: "human",
        anchor,
        resolutionTarget: opts.resolutionTarget,
      },
    ],
  });
}

/** Create a standard 3-screen onboarding prototype with explicit hotspots and
 *  transitions. Screen ids end up as slugs: welcome / setup / done. */
async function createOnboardingPrototype(
  req: APIRequestContext,
  label: string,
): Promise<{ planId: string; body: ActionResult }> {
  const title = `Prototype QA ${label} ${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const res = await action(req, "create-prototype-plan", {
    title,
    brief: "Does this onboarding flow feel short enough?",
    screens: [
      {
        title: "Welcome",
        summary: "Landing screen",
        surface: "browser",
        html: `<div><h1>Welcome aboard</h1><p class="wf-muted">Two quick steps.</p><button class="primary" data-goto="setup">Get started</button></div>`,
        state: [{ label: "Step", value: "1 of 2" }],
      },
      {
        title: "Setup",
        summary: "Configure workspace",
        surface: "browser",
        html: `<div><h1>Set up your workspace</h1><button class="primary" data-goto="done">Finish</button><button data-goto="welcome">Back</button></div>`,
        state: [{ label: "Step", value: "2 of 2" }],
      },
      {
        title: "Done",
        summary: "All set",
        surface: "browser",
        html: `<div><h1>You're all set</h1><p>Welcome to the product.</p></div>`,
      },
    ],
    transitions: [
      {
        from: "welcome",
        to: "setup",
        label: "Start",
        trigger: "click Get started",
      },
      { from: "setup", to: "done", label: "Finish", trigger: "click Finish" },
      { from: "setup", to: "welcome", label: "Back" },
    ],
  });
  expect(
    res.ok,
    `create-prototype-plan should succeed (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const planId = planIdFrom(res.body);
  expect(planId, "create-prototype-plan must return a plan id").toBeTruthy();
  return { planId: planId as string, body: res.body };
}

/** Open a plan and wait for the prototype viewer to mount. */
async function openPrototype(page: Page, planId: string): Promise<Locator> {
  await page.goto(`/plans/${planId}`);
  await page.waitForLoadState("domcontentloaded");
  const viewer = page.locator("[data-plan-prototype-viewer]");
  await expect(viewer, "the prototype viewer must mount").toBeVisible({
    timeout: 20000,
  });
  return viewer;
}

function waitForPrototypeRender(viewer: Locator) {
  return viewer.evaluate(
    (node) =>
      new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 250);
        const done = () => {
          window.clearTimeout(timeout);
          window.requestAnimationFrame(() => resolve());
        };
        node.addEventListener("plan-prototype-runtime:rendered", done, {
          once: true,
        });
      }),
  );
}

const activeScreenId = (viewer: Locator) =>
  viewer
    .locator("[data-prototype-screen]")
    .getAttribute("data-prototype-screen");

/* ------------------------------------------------------------------ */
/* 1. create-prototype-plan persists a functional prototype + canvas   */
/* ------------------------------------------------------------------ */
test("create-prototype-plan persists prototype screens, transitions, and derived static mocks", async ({
  page,
}) => {
  const req = page.request;
  const { planId, body } = await createOnboardingPrototype(req, "persist");

  // Returned content carries the prototype + an auto-derived static-mock canvas.
  const content = body.plan?.content;
  expect(
    content?.prototype,
    "created plan must carry a prototype",
  ).toBeTruthy();
  expect(
    content.prototype.screens.map((s: any) => s.id),
    "screen ids are slugged from titles",
  ).toEqual(["welcome", "setup", "done"]);
  expect(
    content.prototype.transitions.length,
    "all three transitions persist",
  ).toBe(3);
  expect(
    content.prototype.initialScreenId,
    "the initial screen defaults to the first screen",
  ).toBe("welcome");
  expect(
    content.canvas?.frames?.length,
    "a static-mock canvas is derived from the screens",
  ).toBeGreaterThanOrEqual(3);

  // Reload from SQL (get-visual-plan) — prototype must survive the round-trip.
  const reloaded = await getPlan(req, planId);
  expect(
    reloaded.plan?.content?.prototype?.screens?.length,
    "prototype must persist in SQL and reload intact",
  ).toBe(3);
  expect(
    reloaded.plan?.content?.prototype?.transitions?.length,
    "transitions persist in SQL",
  ).toBe(3);
});

/* ------------------------------------------------------------------ */
/* 2. The functional viewer renders on top and navigates via hotspots  */
/* ------------------------------------------------------------------ */
test("prototype viewer renders the first screen and navigates a multi-step flow via data-goto hotspots", async ({
  page,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "click");
  const viewer = await openPrototype(page, planId);

  // The viewer renders ABOVE the document, but without the old badge/state
  // chip/screen-counter chrome. The prototype content itself is the review UI.
  expect(
    await activeScreenId(viewer),
    "initial screen is the first screen",
  ).toBe("welcome");
  await expect(
    page.getByRole("button", { name: "Next prototype screen" }),
    "the global bottom pager is intentionally gone",
  ).toHaveCount(0);

  // Multi-step flow: Welcome -> Setup via in-screen hotspots.
  await viewer.locator('[data-prototype-screen] [data-goto="setup"]').click();
  expect(await activeScreenId(viewer), "hotspot navigates to Setup").toBe(
    "setup",
  );

  // A "Back" hotspot navigates against the flow.
  await viewer.locator('[data-prototype-screen] [data-goto="welcome"]').click();
  expect(
    await activeScreenId(viewer),
    "a Back hotspot navigates to the welcome screen",
  ).toBe("welcome");

  await viewer.locator('[data-prototype-screen] [data-goto="setup"]').click();
  await viewer.locator('[data-prototype-screen] [data-goto="done"]').click();
  expect(await activeScreenId(viewer), "hotspot navigates to Done").toBe(
    "done",
  );
});

/* ------------------------------------------------------------------ */
/* 3. Functional local prototype behavior                              */
/* ------------------------------------------------------------------ */
test("prototype viewer runs local controls for a todo-style prototype", async ({
  page,
}) => {
  const req = page.request;
  const res = await action(req, "create-prototype-plan", {
    title: `Functional Todo ${Date.now()}`,
    brief: "A working todo prototype.",
    screens: [
      {
        title: "Todo",
        html: `
          <div x-data="{ draft: '', filter: 'all', todos: [{ text: 'Review prototype', done: false }] }" style="display:flex;flex-direction:column;gap:12px;padding:16px;height:100%">
            <h1>Today</h1>
            <div style="display:flex;gap:8px">
              <input aria-label="Add task" x-model="draft" @keydown.enter="draft && todos.push({ text: draft, done: false }); draft = ''" placeholder="Add task">
              <button class="primary" @click="draft && todos.push({ text: draft, done: false }); draft = ''">Add</button>
            </div>
            <div style="display:flex;gap:8px">
              <button data-filter="all" @click="filter = 'all'" :class="{ primary: filter === 'all' }">All</button>
              <button data-filter="done" @click="filter = 'done'" :class="{ primary: filter === 'done' }">Done</button>
            </div>
            <div class="wf-box" x-for="todo in todos" x-show="filter === 'all' || (filter === 'done' && todo.done)" :class="{ 'is-done': todo.done }" :data-done="todo.done" style="display:flex;justify-content:space-between;gap:10px">
              <label><input type="checkbox" x-model="todo.done"><span x-text="todo.text"></span></label>
              <button data-remove @click="remove(todos, todo)">Remove</button>
            </div>
          </div>
        `,
      },
    ],
  });
  expect(
    res.ok,
    `functional prototype must be accepted (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const planId = planIdFrom(res.body) as string;
  const viewer = await openPrototype(page, planId);

  const input = viewer.getByLabel("Add task");
  await input.fill("Ship live prototype");
  const addedRender = waitForPrototypeRender(viewer);
  await input.press("Enter");
  await addedRender;
  await expect(viewer.getByText("Ship live prototype")).toBeVisible();
  await expect(input).toHaveValue("");

  const shipRow = viewer
    .locator("[data-plan-prototype-clone-for]")
    .filter({ hasText: "Ship live prototype" });
  const checkedRender = waitForPrototypeRender(viewer);
  await shipRow.locator("label").click();
  await checkedRender;
  const completedShipRow = viewer
    .locator("[data-plan-prototype-clone-for]")
    .filter({ hasText: "Ship live prototype" });
  await expect(completedShipRow).toHaveAttribute("data-done", "true");

  await viewer.locator('button[data-filter="done"]').click();
  await expect(
    viewer
      .locator("[data-plan-prototype-clone-for]")
      .filter({ hasText: "Review prototype" }),
  ).toBeHidden();
  await expect(completedShipRow).toBeVisible();

  await completedShipRow.locator("button[data-remove]").click();
  await expect(viewer.getByText("Ship live prototype")).toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* 4. Toolbar: sketchy/clean flips the rendered frame; dark/light flips */
/* ------------------------------------------------------------------ */
test("prototype toolbar: sketchy<->clean flips the rendered frame style and dark<->light flips theme", async ({
  page,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "toggles");
  const viewer = await openPrototype(page, planId);

  // The rendered HTML frame exposes data-style="sketchy|clean". Assert the
  // actual rendered frame flips, not just the toolbar label.
  const frame = viewer.locator("[data-prototype-screen] .plan-html-frame");
  await expect(frame.first()).toBeVisible();
  const originalStyle = await frame.first().getAttribute("data-style");
  expect(["sketchy", "clean"]).toContain(originalStyle);

  // The sketchy/clean + dark/light toggles now live in the ⋮ "Plan actions"
  // menu (DropdownMenu items "Clean/Sketchy wireframes", "Light/Dark mode"),
  // not a prototype-specific toolbar button.
  const openPlanMenu = async () => {
    await page.getByRole("button", { name: "Plan actions" }).first().click();
  };
  const ensureStyle = async (target: "sketchy" | "clean") => {
    await openPlanMenu();
    const itemName =
      target === "sketchy" ? /sketchy wireframes/i : /clean wireframes/i;
    const item = page.getByRole("menuitem", { name: itemName });
    if ((await item.count()) > 0) {
      await item.click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      return;
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  };

  await ensureStyle("sketchy");
  await expect(frame.first()).toHaveAttribute("data-style", "sketchy");
  await expect(
    viewer.locator("[data-prototype-screen] svg.plan-rough-overlay"),
    "live prototype sketchy mode avoids jello-prone rough overlays",
  ).toHaveCount(0);
  await expect(
    frame.first(),
    "live prototype sketchy mode must keep real scrolling borders visible",
  ).not.toHaveAttribute("data-rough-ready", "true");
  const styleBefore = "sketchy";

  await openPlanMenu();
  await page.getByRole("menuitem", { name: /wireframes/i }).click();
  await expect(async () => {
    const styleAfter = await viewer
      .locator("[data-prototype-screen] .plan-html-frame")
      .first()
      .getAttribute("data-style");
    expect(styleAfter, "the rendered prototype frame style must flip").not.toBe(
      styleBefore,
    );
  }).toPass({ timeout: 6000 });

  // Flip it back to the known sketchy baseline used by the overlay regression.
  await openPlanMenu();
  await page.getByRole("menuitem", { name: /wireframes/i }).click();
  await expect(async () => {
    const restored = await viewer
      .locator("[data-prototype-screen] .plan-html-frame")
      .first()
      .getAttribute("data-style");
    expect(restored).toBe(styleBefore);
  }).toPass({ timeout: 6000 });

  // Dark/light theme toggle (also in the ⋮ menu) flips the documentElement class.
  const wasDark = await page
    .locator("html")
    .evaluate((el) => el.classList.contains("dark"));
  await openPlanMenu();
  await page.getByRole("menuitem", { name: /mode/i }).click();
  await expect(async () => {
    const isDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    expect(isDark, "the dark/light toggle must flip the theme class").not.toBe(
      wasDark,
    );
  }).toPass({ timeout: 6000 });

  // Viewer is still mounted and showing a screen after toggling.
  await expect(viewer.locator("[data-prototype-screen]")).toBeVisible();
  if (originalStyle === "clean") {
    await ensureStyle("clean");
  }
});

/* ------------------------------------------------------------------ */
/* 5. Popout: the shared toolbar opens a real new ?prototype=1 window   */
/* ------------------------------------------------------------------ */
test("prototype popout: the shared toolbar opens a new browser page to the standalone prototype", async ({
  page,
  context,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "popout-toolbar");
  const viewer = await openPrototype(page, planId);

  await expect(
    viewer.locator(":scope > [data-plan-interactive]"),
    "prototype viewer must not add a second top-right toolbar over the shared page toolbar",
  ).toHaveCount(0);

  // The shared page toolbar popout button opens window.open(_blank).
  const popout = page.getByRole("button", {
    name: "Open prototype window",
    exact: true,
  });
  await expect(popout.first()).toBeVisible();

  const [popoutPage] = await Promise.all([
    context.waitForEvent("page"),
    popout.first().click(),
  ]);
  await popoutPage.waitForLoadState("domcontentloaded");

  expect(
    popoutPage.url(),
    "the popout window points at the standalone prototype",
  ).toContain("prototype=1");
  expect(popoutPage.url(), "the popout window is the same plan").toContain(
    planId,
  );

  // The popout is a working standalone viewer.
  const popoutViewer = popoutPage.locator("[data-plan-prototype-viewer]");
  await expect(popoutViewer).toBeVisible({ timeout: 20000 });
  expect(await activeScreenId(popoutViewer)).toBe("welcome");
  await popoutPage.close();
});

/* ------------------------------------------------------------------ */
/* 5b. Popout: the plan actions menu item also opens the popout window  */
/* ------------------------------------------------------------------ */
test("prototype popout: the plan actions menu 'Open prototype window' opens a standalone page", async ({
  page,
  context,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "popout-menu");
  await openPrototype(page, planId);

  const trigger = page.getByRole("button", { name: "Plan actions" });
  await trigger.click({ timeout: 6000 });
  const menuItem = page.getByRole("menuitem", {
    name: "Open prototype window",
  });
  await expect(menuItem).toBeVisible({ timeout: 5000 });

  const [popoutPage] = await Promise.all([
    context.waitForEvent("page"),
    menuItem.click(),
  ]);
  await popoutPage.waitForLoadState("domcontentloaded");
  expect(popoutPage.url()).toContain("prototype=1");
  await expect(
    popoutPage.locator("[data-plan-prototype-viewer]"),
    "the menu popout renders a standalone viewer",
  ).toBeVisible({ timeout: 20000 });
  await popoutPage.close();
});

/* ------------------------------------------------------------------ */
/* 6. Tabs: prototype + derived canvas => Prototype/Wireframes tabs     */
/* ------------------------------------------------------------------ */
test("a prototype plan exposes Prototype/Wireframes tabs that flip the top surface", async ({
  page,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "tabs");
  const viewer = await openPrototype(page, planId);

  // create-prototype-plan derives a canvas, so the tab chrome renders.
  const tabs = page.locator("[data-plan-visual-tabs]");
  await expect(tabs, "prototype + canvas => visual tabs render").toBeVisible();
  const prototypeTab = page.getByRole("tab", { name: "Prototype" });
  const wireframesTab = page.getByRole("tab", { name: "Wireframes" });
  await expect(prototypeTab).toBeVisible();
  await expect(wireframesTab).toBeVisible();

  // Prototype tab is active by default: the live functional viewer is shown.
  await expect(prototypeTab).toHaveAttribute("aria-selected", "true");
  await expect(viewer).toBeVisible();
  const textNoteTool = page.getByRole("radio", { name: "Text note" });
  const arrowCalloutTool = page.getByRole("radio", { name: "Arrow callout" });
  await expect(
    textNoteTool,
    "drawing tools stay available beside Comment when a canvas exists",
  ).toBeVisible();
  await expect(arrowCalloutTool).toBeVisible();

  // Choosing a drawing tool from Prototype switches back to the wireframe canvas,
  // because freeform notes and arrow callouts are authored on the canvas layer.
  await textNoteTool.click();
  await expect(wireframesTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Click the canvas to place a note"),
  ).toBeVisible();
  await expect(
    page.locator("[data-prototype-screen]"),
    "activating a draw tool hides the live prototype screen",
  ).toHaveCount(0);
  const viewportBox = await page.locator(".plan-canvas-viewport").boundingBox();
  expect(
    viewportBox,
    "wireframe canvas viewport must be measurable",
  ).toBeTruthy();
  await page.mouse.click(
    viewportBox!.x + viewportBox!.width * 0.55,
    viewportBox!.y + viewportBox!.height * 0.45,
  );
  const markupText = "Canvas note from prototype toolbar for the agent.";
  const markupInput = page.getByPlaceholder("Add a text note...");
  await expect(markupInput).toBeVisible();
  await markupInput.fill(markupText);
  const markupComposer = page
    .locator("form[data-plan-interactive]")
    .filter({ has: markupInput });
  await markupComposer.getByRole("button", { name: "Save" }).click();
  await expect(
    page.locator(".plan-canvas-markup-note", { hasText: markupText }),
    "saved canvas markup should render on the wireframe canvas",
  ).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    const fb = await getFeedback(req, planId);
    const commentText = JSON.stringify(fb.body.comments ?? []);
    const actionableText = JSON.stringify(fb.body.actionableThreads ?? []);
    expect(commentText).toContain(`Canvas note: ${markupText}`);
    expect(actionableText).toContain(markupText);
  }).toPass({ timeout: 15000 });

  // Flip to Wireframes: the live viewer's screen container goes away and the
  // canvas board shows instead, with drawing tools available in the one shared
  // top-right toolbar.
  await wireframesTab.click();
  await expect(wireframesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radio", { name: "Text note" })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Arrow callout" }),
  ).toBeVisible();
  await expect(
    page.locator("[data-prototype-screen]"),
    "switching to Wireframes hides the live prototype screen",
  ).toHaveCount(0);

  // Flip back to Prototype: the live viewer returns and route hotspots work.
  await prototypeTab.click();
  await expect(prototypeTab).toHaveAttribute("aria-selected", "true");
  await expect(viewer.locator("[data-prototype-screen]")).toBeVisible();
  await viewer.locator('[data-prototype-screen] [data-goto="setup"]').click();
  expect(
    await activeScreenId(viewer),
    "the live prototype still navigates after a tab round-trip",
  ).toBe("setup");
});

/* ------------------------------------------------------------------ */
/* 7. Standalone popout (?prototype=1) renders the viewer only          */
/* ------------------------------------------------------------------ */
test("?prototype=1 renders a standalone prototype viewer without the tabs or document chrome", async ({
  page,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "standalone");

  await page.goto(`/plans/${planId}?prototype=1`);
  await page.waitForLoadState("domcontentloaded");
  const viewer = page.locator("[data-plan-prototype-viewer]");
  await expect(viewer, "standalone prototype viewer must mount").toBeVisible({
    timeout: 20000,
  });

  // Standalone mode hides the Prototype/Wireframes tab chrome and the document.
  await expect(
    page.locator("[data-plan-visual-tabs]"),
    "popout suppresses the visual tab chrome",
  ).toHaveCount(0);
  await expect(
    page.locator("article header h1"),
    "popout suppresses the plan document header",
  ).toHaveCount(0);

  // In standalone mode the popout control flips to "Open full plan".
  await expect(
    page.getByRole("button", { name: "Open full plan", exact: true }),
    "standalone viewer offers a way back to the full plan",
  ).toBeVisible();

  // Navigation still works in the popout.
  expect(await activeScreenId(viewer)).toBe("welcome");
  await viewer.locator('[data-prototype-screen] [data-goto="setup"]').click();
  expect(await activeScreenId(viewer)).toBe("setup");
  await viewer.locator('[data-prototype-screen] [data-goto="done"]').click();
  expect(await activeScreenId(viewer)).toBe("done");
});

/* ------------------------------------------------------------------ */
/* 8. Comments: a UI pin on the live prototype persists with identity   */
/* ------------------------------------------------------------------ */
test("comments work in prototype mode: a UI pin on a live screen persists with the reviewer identity", async ({
  page,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "comments");

  // Catch any server error the optimistic UI might hide.
  const updateStatuses: number[] = [];
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

  // Use the standalone prototype popout (?prototype=1): the live prototype is
  // the sole review surface, so commenting targets the prototype screen.
  await page.goto(`/plans/${planId}?prototype=1`);
  await page.waitForLoadState("domcontentloaded");
  const viewer = page.locator("[data-plan-prototype-viewer]");
  await expect(
    viewer,
    "the standalone prototype viewer must mount",
  ).toBeVisible({
    timeout: 20000,
  });

  // Enter comment (review) mode. The ReviewMarkupToolbar exposes a "Comment"
  // ToggleGroupItem (role="radio"); once active its label flips to
  // "Stop commenting".
  const commentToggle = page.getByRole("radio", {
    name: "Comment",
    exact: true,
  });
  await expect(commentToggle).toBeVisible({ timeout: 15000 });
  await commentToggle.click();
  await expect(
    page.getByRole("radio", { name: "Stop commenting", exact: true }),
    "comment review mode must engage",
  ).toBeVisible({ timeout: 5000 });

  // Click directly on the live prototype screen to drop a pin.
  await viewer
    .locator("[data-prototype-screen]")
    .click({ position: { x: 100, y: 100 } });

  // The inline composer should open on the prototype surface.
  await expect(
    page.getByText("Add a comment...", { exact: false }),
    "clicking the live prototype in comment mode opens the inline composer",
  ).toBeVisible({ timeout: 10000 });

  await page.keyboard.type("Pinned on the live prototype welcome screen.");
  await page.getByRole("button", { name: /^Save$|^Saving$/ }).click();

  await expect(async () => {
    expect(updateStatuses.length).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 15000 });
  expect(
    updateStatuses.every((s) => s < 400),
    `saving a prototype comment must not return a server error (statuses: ${updateStatuses.join(", ")})`,
  ).toBeTruthy();

  await expect(
    page.getByText("Couldn't save. Try again."),
    "the composer must not show a save error",
  ).toBeHidden({ timeout: 5000 });

  // It persists server-side with the real reviewer identity. The anchor records
  // the prototype surface so the agent can read where it was pinned.
  await expect(async () => {
    const fb = await getFeedback(req, planId);
    const human = (fb.body.comments ?? []).filter(
      (c: any) => c.createdBy === "human",
    );
    expect(human.length).toBeGreaterThanOrEqual(1);
    expect(human[0].authorEmail).toBe(EXPECTED_COMMENT_AUTHOR_EMAIL);
    expect(
      String(human[0].anchor ?? ""),
      "the persisted pin anchors to the prototype surface",
    ).toContain("prototype");
  }).toPass({ timeout: 15000 });
});

/* ------------------------------------------------------------------ */
/* 8b. Comments: prototype pins route to agent vs human; survive reload */
/* ------------------------------------------------------------------ */
test("prototype comments route to the agent or a human by resolutionTarget and survive reload", async ({
  page,
}) => {
  const req = page.request;
  const { planId } = await createOnboardingPrototype(req, "routing");

  // One pin meant for the agent ("send to agent"), one meant for a human.
  const toAgent = await addPrototypeComment(req, planId, {
    message: "Agent: tighten the welcome screen spacing.",
    screenId: "welcome",
    resolutionTarget: "agent",
  });
  expect(
    toAgent.ok,
    `agent-targeted prototype comment must save (status ${toAgent.status}: ${toAgent.raw.slice(0, 160)})`,
  ).toBeTruthy();

  const toHuman = await addPrototypeComment(req, planId, {
    message: "Human: does the finish step feel final enough?",
    screenId: "setup",
    resolutionTarget: "human",
  });
  expect(toHuman.ok, "human-targeted prototype comment must save").toBeTruthy();

  // get-plan-feedback (the "send to agent" surface) sorts them correctly.
  await expect(async () => {
    const fb = await getFeedback(req, planId);
    const comments = (fb.body.comments ?? []).filter(
      (c: any) => c.createdBy === "human",
    );
    expect(
      comments.length,
      "both prototype pins persist",
    ).toBeGreaterThanOrEqual(2);
    // Reviewer identity stamped on every human pin.
    for (const c of comments) {
      expect(c.authorEmail).toBe(EXPECTED_COMMENT_AUTHOR_EMAIL);
      expect(
        String(c.anchor ?? ""),
        "every prototype pin keeps a prototype anchor",
      ).toContain("prototype");
    }
    // Agent-bound pin shows up in actionableThreads; human-bound in humanReview.
    expect(
      (fb.body.actionableThreads ?? []).length,
      "the agent-targeted pin is actionable by the agent",
    ).toBeGreaterThanOrEqual(1);
    expect(
      (fb.body.humanReviewThreads ?? []).length,
      "the human-targeted pin is queued for human review",
    ).toBeGreaterThanOrEqual(1);
    expect(
      fb.body.feedbackSummary?.actionableThreadCount,
      "the feedback summary counts the agent-bound prototype thread",
    ).toBeGreaterThanOrEqual(1);
    expect(
      fb.body.feedbackSummary?.humanReviewThreadCount,
      "the feedback summary counts the human-bound prototype thread",
    ).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 15000 });

  // The pins are visible to a fresh page load of the live prototype too.
  const viewer = await openPrototype(page, planId);
  await expect(viewer).toBeVisible();
  const reloaded = await getFeedback(req, planId);
  expect(
    (reloaded.body.comments ?? []).filter((c: any) => c.createdBy === "human")
      .length,
    "prototype comments persist across a reload",
  ).toBeGreaterThanOrEqual(2);
});

/* ------------------------------------------------------------------ */
/* 9. convert-visual-plan-to-prototype: HTML canvas -> live prototype  */
/* ------------------------------------------------------------------ */
test("convert-visual-plan-to-prototype derives a live prototype from canvas wireframes and keeps static mocks", async ({
  page,
}) => {
  const req = page.request;

  // A visual plan whose canvas frames carry real wireframe HTML.
  const content = {
    version: 2,
    title: "Inbox Flow",
    brief: "Review the read flow before we build it.",
    canvas: {
      title: "Inbox Flow",
      frames: [
        {
          id: "ab-inbox",
          label: "Inbox",
          surface: "browser",
          wireframe: {
            surface: "browser",
            html: "<main><h1>Inbox</h1><button>Open first message</button></main>",
          },
        },
        {
          id: "ab-reader",
          label: "Reader",
          surface: "browser",
          wireframe: {
            surface: "browser",
            html: "<main><h1>Reader</h1><p>Message body</p></main>",
          },
        },
      ],
      flow: [{ from: "ab-inbox", to: "ab-reader", label: "Open message" }],
    },
    blocks: [
      {
        id: "rt-1",
        type: "rich-text",
        title: "Notes",
        data: { markdown: "Implementation notes for the inbox read flow." },
      },
    ],
  };

  const created = await action(req, "create-visual-plan", {
    title: "Inbox Flow",
    brief: content.brief,
    content,
  });
  expect(
    created.ok,
    `create-visual-plan (canvas) must succeed (status ${created.status}: ${created.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const planId = planIdFrom(created.body) as string;
  expect(
    created.body.plan?.content?.prototype,
    "the source visual plan starts WITHOUT a prototype",
  ).toBeFalsy();

  // Convert.
  const converted = await action(req, "convert-visual-plan-to-prototype", {
    planId,
  });
  expect(
    converted.ok,
    `convert-visual-plan-to-prototype must succeed (status ${converted.status}: ${converted.raw.slice(0, 200)})`,
  ).toBeTruthy();

  const proto = converted.body.plan?.content?.prototype;
  expect(proto, "conversion must produce a prototype").toBeTruthy();
  expect(
    proto.screens.map((s: any) => s.id),
    "screens derive from the canvas frame ids",
  ).toEqual(["ab-inbox", "ab-reader"]);
  expect(
    proto.transitions?.some(
      (t: any) => t.from === "ab-inbox" && t.to === "ab-reader",
    ),
    "the canvas flow becomes a prototype transition",
  ).toBeTruthy();
  expect(
    converted.body.plan?.content?.canvas,
    "static mocks (canvas) are preserved by default",
  ).toBeTruthy();

  // Open it: the live prototype now renders on top, starting at the first frame.
  const viewer = await openPrototype(page, planId);
  expect(
    await activeScreenId(viewer),
    "converted prototype opens at ab-inbox",
  ).toBe("ab-inbox");

  // The canvas flow becomes an in-prototype route control because there is no
  // global slide navigator anymore.
  await viewer
    .locator('[data-prototype-screen] [data-goto="ab-reader"]')
    .click();
  expect(await activeScreenId(viewer)).toBe("ab-reader");
});

/* ------------------------------------------------------------------ */
/* 9b. convert with removeCanvas drops the static mocks                 */
/* ------------------------------------------------------------------ */
test("convert-visual-plan-to-prototype with removeCanvas=true drops the static mocks", async ({
  page,
}) => {
  const req = page.request;
  const content = {
    version: 2,
    title: "Remove Canvas Flow",
    brief: "Convert and drop the old board.",
    canvas: {
      title: "Remove Canvas Flow",
      frames: [
        {
          id: "rc-a",
          label: "A",
          surface: "browser",
          wireframe: { surface: "browser", html: "<main><h1>A</h1></main>" },
        },
        {
          id: "rc-b",
          label: "B",
          surface: "browser",
          wireframe: { surface: "browser", html: "<main><h1>B</h1></main>" },
        },
      ],
      flow: [{ from: "rc-a", to: "rc-b", label: "Next" }],
    },
    blocks: [],
  };
  const created = await action(req, "create-visual-plan", {
    title: "Remove Canvas Flow",
    brief: content.brief,
    content,
  });
  expect(created.ok, "create-visual-plan (canvas) must succeed").toBeTruthy();
  const planId = planIdFrom(created.body) as string;

  const converted = await action(req, "convert-visual-plan-to-prototype", {
    planId,
    removeCanvas: true,
  });
  expect(
    converted.ok,
    `convert with removeCanvas must succeed (status ${converted.status}: ${converted.raw.slice(0, 160)})`,
  ).toBeTruthy();
  expect(
    converted.body.plan?.content?.prototype,
    "removeCanvas conversion still produces a prototype",
  ).toBeTruthy();
  expect(
    converted.body.plan?.content?.canvas,
    "removeCanvas=true drops the static-mock canvas",
  ).toBeFalsy();

  // With no canvas the surface has no Prototype/Wireframes tabs — just the viewer.
  const viewer = await openPrototype(page, planId);
  await expect(
    page.locator("[data-plan-visual-tabs]"),
    "a prototype-only plan (canvas removed) shows no tab chrome",
  ).toHaveCount(0);
  expect(await activeScreenId(viewer)).toBe("rc-a");
});

/* ------------------------------------------------------------------ */
/* 10. EDGE: a single-screen prototype renders without nav chrome        */
/* ------------------------------------------------------------------ */
test("EDGE: a one-screen prototype renders without global next/prev controls", async ({
  page,
}) => {
  const req = page.request;
  const res = await action(req, "create-prototype-plan", {
    title: `Single Screen ${Date.now()}`,
    brief: "Just one state to review.",
    screens: [
      {
        title: "Only Screen",
        summary: "Nothing to click to.",
        html: `<div><h1>Only screen</h1><p>No transitions here.</p></div>`,
      },
    ],
    transitions: [],
  });
  expect(
    res.ok,
    `single-screen prototype must be accepted (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const planId = planIdFrom(res.body) as string;

  const viewer = await openPrototype(page, planId);
  expect(await activeScreenId(viewer)).toBe("only-screen");
  await expect(
    page.getByRole("button", { name: "Next prototype screen" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Previous prototype screen" }),
  ).toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* 11. EDGE: cyclic transitions never deadlock the viewer               */
/* ------------------------------------------------------------------ */
test("EDGE: cyclic transitions let the viewer loop A -> B -> A safely", async ({
  page,
}) => {
  const req = page.request;
  const res = await action(req, "create-prototype-plan", {
    title: `Cyclic ${Date.now()}`,
    brief: "A two-state cycle.",
    screens: [
      {
        title: "A",
        html: `<div><h1>State A</h1><button data-goto="b">Go to B</button></div>`,
      },
      {
        title: "B",
        html: `<div><h1>State B</h1><button data-goto="a">Go to A</button></div>`,
      },
    ],
    transitions: [
      { from: "a", to: "b", label: "to B" },
      { from: "b", to: "a", label: "to A" },
    ],
  });
  expect(
    res.ok,
    `cyclic prototype must be accepted (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const planId = planIdFrom(res.body) as string;

  const viewer = await openPrototype(page, planId);
  expect(await activeScreenId(viewer)).toBe("a");

  // A -> B -> A -> B via hotspots: a cycle must keep working, not deadlock.
  await viewer.locator('[data-prototype-screen] [data-goto="b"]').click();
  expect(await activeScreenId(viewer)).toBe("b");
  await viewer.locator('[data-prototype-screen] [data-goto="a"]').click();
  expect(await activeScreenId(viewer)).toBe("a");
  await viewer.locator('[data-prototype-screen] [data-goto="b"]').click();
  expect(await activeScreenId(viewer), "cycle loops indefinitely").toBe("b");

  // The in-screen hotspot continues to follow the cycle without deadlock.
  await viewer.locator('[data-prototype-screen] [data-goto="a"]').click();
  expect(await activeScreenId(viewer)).toBe("a");
});

/* ------------------------------------------------------------------ */
/* 12. EDGE: a dead data-goto hotspot is a no-op, never a crash         */
/* ------------------------------------------------------------------ */
test("EDGE: a data-goto pointing at a missing screen is a safe no-op", async ({
  page,
}) => {
  const req = page.request;
  // Only the HTML hotspot is dead; the declared transitions are all valid, so
  // the plan is accepted. The viewer must guard navigation to unknown ids.
  const res = await action(req, "create-prototype-plan", {
    title: `Dead Hotspot ${Date.now()}`,
    brief: "One hotspot points nowhere.",
    screens: [
      {
        title: "Home",
        html: `<div><h1>Home</h1><button data-goto="ghost">Dead link</button><button data-goto="real">Real link</button></div>`,
      },
      { title: "Real", html: `<div><h1>Real</h1></div>` },
    ],
    transitions: [{ from: "home", to: "real" }],
  });
  expect(
    res.ok,
    `prototype with a dead hotspot but valid transitions must be accepted (status ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeTruthy();
  const planId = planIdFrom(res.body) as string;

  const viewer = await openPrototype(page, planId);
  expect(await activeScreenId(viewer)).toBe("home");

  // Click the dead hotspot: must stay put (guarded), not crash.
  await viewer.locator('[data-prototype-screen] [data-goto="ghost"]').click();
  expect(
    await activeScreenId(viewer),
    "navigation to a missing screen id is ignored",
  ).toBe("home");
  await expect(
    viewer.locator("[data-prototype-screen]"),
    "the viewer stays mounted after a dead-hotspot click",
  ).toBeVisible();

  // The valid hotspot still works.
  await viewer.locator('[data-prototype-screen] [data-goto="real"]').click();
  expect(await activeScreenId(viewer)).toBe("real");
});

/* ------------------------------------------------------------------ */
/* 13. EDGE: a transition to a missing screen is a 4xx, not a 500       */
/* ------------------------------------------------------------------ */
test("EDGE: a transition whose target screen does not exist is a 4xx client error", async ({
  page,
}) => {
  const req = page.request;
  const res = await action(req, "create-prototype-plan", {
    title: `Bad Transition ${Date.now()}`,
    brief: "A transition points at a screen that doesn't exist.",
    screens: [
      {
        title: "Home",
        html: `<div><h1>Home</h1><button data-goto="ghost">Go nowhere</button></div>`,
      },
      { title: "Real", html: `<div><h1>Real</h1></div>` },
    ],
    // "ghost" is not a screen id — the prototype schema must reject this.
    transitions: [{ from: "home", to: "ghost" }],
  });

  // Correct behavior: the malformed prototype is rejected and nothing persists.
  expect(
    res.ok,
    `a transition to a non-existent screen must be rejected (status ${res.status})`,
  ).toBeFalsy();
  // It must be a 4xx client-validation error, NOT an opaque 5xx. The action
  // wraps the schema ZodError as statusCode 400 (create-prototype-plan.ts).
  expect(
    res.status,
    `a malformed transition must be a 4xx client error, not a 5xx server error (got ${res.status}: ${res.raw.slice(0, 200)})`,
  ).toBeGreaterThanOrEqual(400);
  expect(
    res.status,
    `a malformed transition must be a 4xx client error, not a 5xx server error (got ${res.status})`,
  ).toBeLessThan(500);
});

/* ------------------------------------------------------------------ */
/* 14. EDGE: converting a plan with no canvas wireframes is a 4xx       */
/* ------------------------------------------------------------------ */
test("EDGE: converting a plan with no canvas wireframes is a 4xx client error, not silently empty", async ({
  page,
}) => {
  const req = page.request;
  const created = await action(req, "create-visual-plan", {
    title: `No Canvas ${Date.now()}`,
    brief: "A document-only plan with no wireframes to convert.",
    content: {
      version: 2,
      title: "No Canvas",
      brief: "document only",
      blocks: [
        {
          id: "rt-1",
          type: "rich-text",
          title: "Notes",
          data: { markdown: "Nothing visual here." },
        },
      ],
    },
  });
  expect(created.ok, "the document-only plan should be created").toBeTruthy();
  const planId = planIdFrom(created.body) as string;

  const conv = await action(req, "convert-visual-plan-to-prototype", {
    planId,
  });

  // Correct behavior: conversion must fail (no wireframes) with a 4xx, and the
  // plan must NOT gain an empty/garbage prototype.
  expect(
    conv.ok,
    `converting a plan with no canvas wireframes must be rejected (status ${conv.status})`,
  ).toBeFalsy();
  expect(
    conv.status,
    `no-canvas conversion must be a 4xx client error, not a 5xx server error (got ${conv.status}: ${conv.raw.slice(0, 200)})`,
  ).toBeGreaterThanOrEqual(400);
  expect(
    conv.status,
    `no-canvas conversion must be a 4xx client error, not a 5xx server error (got ${conv.status})`,
  ).toBeLessThan(500);

  const reloaded = await getPlan(req, planId);
  expect(
    reloaded.plan?.content?.prototype,
    "a failed conversion must not attach a prototype",
  ).toBeFalsy();
});
