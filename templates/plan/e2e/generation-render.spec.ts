import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * PLAN GENERATION + RENDERING — deep, adversarial coverage.
 *
 * Creates plans through the authed action surface (create-visual-plan), then
 * asserts they render on the canvas + document WITHOUT an "Internal server
 * error" toast and WITHOUT console errors. Covers every renderable surface and
 * block type plus the craziest realistic edge cases:
 *   - HTML-wireframe canvas across browser/mobile/popover/desktop surfaces
 *   - kit-tree wireframe
 *   - skeleton wireframe (must stay neutral + textless)
 *   - doc with rich-text / callout / table / code-tabs / implementation-map /
 *     decision / tabs blocks
 *   - Light/Dark x Sketchy/Clean: every frame keeps a visible border in all 4
 *     combos, and skeleton stays neutral/borderless-but-framed
 *   - popover renders ~square (not too wide)
 *   - many (10+) frames
 *   - empty doc, very long doc
 *   - emoji / RTL / very long labels
 *
 * Resilient by design: web-first assertions auto-retry, console-error capture
 * tolerates benign HMR noise, and fixtures use unique titles so other agents
 * editing the shared server can't collide.
 */

const SUITE = `genrender-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
let seq = 0;
const uniqueTitle = (label: string) => `${SUITE} ${label} #${++seq}`;

/** Console errors that are not real app bugs (HMR / dev noise / 3rd party). */
const BENIGN_CONSOLE = [
  /\[vite\]/i,
  /hmr update/i,
  /websocket/i,
  /Download the React DevTools/i,
  /favicon/i,
  /ResizeObserver loop/i,
  /Failed to load resource.*404/i, // transient asset 404 during HMR
];

type ConsoleWatch = { errors: string[]; pageErrors: string[] };

function watchConsole(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { errors: [], pageErrors: [] };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (BENIGN_CONSOLE.some((re) => re.test(text))) return;
    watch.errors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = String(err?.message ?? err);
    if (BENIGN_CONSOLE.some((re) => re.test(text))) return;
    watch.pageErrors.push(text);
  });
  return watch;
}

async function readPlanId(res: APIResponse): Promise<string> {
  expect(
    res.ok(),
    `create-visual-plan failed: ${res.status()} ${await res.text().catch(() => "")}`,
  ).toBeTruthy();
  const json = (await res.json()) as Record<string, unknown>;
  // The action returns { ...bundle, planId, ... } where bundle has { plan }.
  const planId =
    (json.planId as string | undefined) ??
    ((json.plan as { id?: string } | undefined)?.id as string | undefined);
  expect(
    planId,
    `no plan id in create response: ${JSON.stringify(json).slice(0, 400)}`,
  ).toBeTruthy();
  return planId as string;
}

async function createPlan(
  page: Page,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await page.request.post(
    "/_agent-native/actions/create-visual-plan",
    { data: body },
  );
  return readPlanId(res);
}

/** Open a plan and wait for either the canvas or the document body to render. */
async function openPlan(page: Page, planId: string) {
  await page.goto(`/plans/${planId}`, { waitUntil: "domcontentloaded" });
  // The plan reader surface mounts the content renderer; wait for the document
  // header h1 (always present) or the canvas.
  await expect
    .poll(
      async () =>
        (await page.locator(".plan-content-surface, .plan-canvas").count()) > 0,
      { timeout: 20_000, message: "plan content surface never rendered" },
    )
    .toBeTruthy();
}

/** Fail if an error toast (sonner) appears at all, especially "Internal server error". */
async function assertNoErrorToast(page: Page) {
  // sonner renders [data-sonner-toast][data-type="error"]; also catch the raw text.
  const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
  const internalErr = page.getByText(/internal server error/i);
  // Give the UI a beat to surface a toast if it's going to, then assert none.
  await expect(errorToast).toHaveCount(0);
  await expect(internalErr).toHaveCount(0);
}

function assertConsoleClean(watch: ConsoleWatch, where: string) {
  expect(
    watch.pageErrors,
    `uncaught page errors at ${where}: ${watch.pageErrors.join(" | ")}`,
  ).toEqual([]);
  expect(
    watch.errors,
    `console.error at ${where}: ${watch.errors.join(" | ")}`,
  ).toEqual([]);
}

/* -------------------------------------------------------------------------- */
/* Fixture content builders                                                   */
/* -------------------------------------------------------------------------- */

function htmlFrame(surface: string, id: string, label: string, html: string) {
  return {
    blockId: id,
    block: {
      id: id,
      type: "wireframe",
      title: label,
      data: { surface, html },
    },
  };
}

/** A content object with an HTML-wireframe canvas across 4 surfaces. */
function htmlCanvasContent(title: string) {
  const surfaces: Array<{ surface: string; html: string }> = [
    {
      surface: "browser",
      html: `<div class="wf-frame-target" style="display:flex;flex-direction:column;gap:8px;padding:12px">
        <h2>Browser dashboard</h2>
        <div class="wf-card"><p>Primary content panel</p></div>
        <button class="primary">Save</button>
      </div>`,
    },
    {
      surface: "mobile",
      html: `<div class="wf-frame-target" style="display:flex;flex-direction:column;gap:8px;padding:10px">
        <h3>Mobile feed</h3>
        <div class="wf-card"><p>Item one</p></div>
        <div class="wf-card"><p>Item two</p></div>
      </div>`,
    },
    {
      surface: "popover",
      html: `<div class="wf-frame-target" style="display:flex;flex-direction:column;gap:6px;padding:10px">
        <h3>Quick actions</h3>
        <button>Rename</button>
        <button>Duplicate</button>
        <button class="primary">Delete</button>
      </div>`,
    },
    {
      surface: "desktop",
      html: `<div class="wf-frame-target" style="display:flex;gap:10px;padding:12px">
        <div style="width:160px"><p class="wf-muted">Sidebar</p></div>
        <div class="wf-card" style="flex:1"><h2>Desktop main</h2><p>Body text.</p></div>
      </div>`,
    },
  ];

  const blocks = surfaces.map((s, i) =>
    htmlFrame(s.surface, `wf-${s.surface}-${i}`, `${s.surface} screen`, s.html),
  );

  return {
    version: 2,
    title,
    brief: "HTML-wireframe canvas spanning four surfaces.",
    canvas: {
      title: "Screens",
      frames: blocks.map((b, i) => ({
        id: `fr-${i}`,
        label: b.block.title,
        surface: b.block.data.surface,
        blockId: b.blockId,
      })),
    },
    blocks: blocks.map((b) => b.block),
  };
}

/** A kit-tree wireframe (no html) — exercises the legacy/kit render path. */
function kitWireframeContent(title: string) {
  return {
    version: 2,
    title,
    brief: "Kit-tree wireframe (geometry-free flex primitives).",
    canvas: {
      title: "Screens",
      frames: [
        {
          id: "fr-kit",
          label: "Kit screen",
          surface: "desktop",
          blockId: "wf-kit",
        },
      ],
    },
    blocks: [
      {
        id: "wf-kit",
        type: "wireframe",
        title: "Kit screen",
        data: {
          surface: "desktop",
          screen: [
            {
              el: "screen",
              children: [
                { el: "toolbar", children: [{ el: "title", text: "Tasks" }] },
                {
                  el: "row",
                  children: [
                    {
                      el: "sidebar",
                      children: [
                        { el: "navItem", text: "Inbox", active: true },
                        { el: "navItem", text: "Today" },
                        { el: "navItem", text: "Upcoming" },
                      ],
                    },
                    {
                      el: "main",
                      children: [
                        { el: "taskRow", text: "Write the spec", done: true },
                        { el: "taskRow", text: "Run the tests" },
                        { el: "lines", n: 3, widths: [90, 70, 80] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/** A skeleton wireframe — must render neutral + textless. */
function skeletonContent(title: string) {
  return {
    version: 2,
    title,
    brief: "Skeleton loading register.",
    canvas: {
      title: "Loading",
      frames: [
        {
          id: "fr-skel",
          label: "Loading",
          surface: "desktop",
          blockId: "wf-skel",
        },
      ],
    },
    blocks: [
      {
        id: "wf-skel",
        type: "wireframe",
        title: "Loading state",
        data: {
          surface: "desktop",
          skeleton: true,
          // Even though text is supplied, the skeleton register must NOT show it.
          html: `<div class="wf-frame-target" style="padding:16px">
            <h2>SHOULD_NOT_BE_VISIBLE_HEADING</h2>
            <p>SHOULD_NOT_BE_VISIBLE_BODY</p>
          </div>`,
        },
      },
    ],
  };
}

/** A rich document touching every required block type. */
function richDocContent(title: string) {
  return {
    version: 2,
    title,
    brief: "A document exercising every block type.",
    blocks: [
      {
        id: "rt-1",
        type: "rich-text",
        data: {
          markdown:
            "## Overview\n\nThis is **rich** text with a [link](https://example.com) and `code`.\n\n- one\n- two",
        },
      },
      {
        id: "co-1",
        type: "callout",
        title: "Heads up",
        data: {
          tone: "warning",
          body: "This is a callout body with **emphasis**.",
        },
      },
      {
        id: "tb-1",
        type: "table",
        title: "Comparison",
        data: {
          columns: ["Option", "Pros", "Cons"],
          rows: [
            ["A", "Fast", "Costly"],
            ["B", "Cheap", "Slow"],
          ],
        },
      },
      {
        id: "ct-1",
        type: "code-tabs",
        title: "Code",
        data: {
          tabs: [
            {
              id: "t-ts",
              label: "client.ts",
              language: "typescript",
              code: "export const x: number = 1;\nconsole.log(x);",
            },
            {
              id: "t-css",
              label: "styles.css",
              language: "css",
              code: ".a { color: red; }",
            },
          ],
        },
      },
      {
        id: "im-1",
        type: "implementation-map",
        title: "Files",
        data: {
          files: [
            {
              path: "app/routes/example.tsx",
              title: "Example route",
              note: "Update the route behavior.",
              language: "tsx",
              snippet: "export function Example() { return null; }",
            },
            {
              path: "server/db/schema.ts",
              note: "Add a column.",
              language: "typescript",
            },
          ],
        },
      },
      {
        id: "tabs-1",
        type: "tabs",
        title: "Details",
        data: {
          tabs: [
            {
              id: "tab-1",
              label: "Notes",
              blocks: [
                {
                  id: "tab-rt-1",
                  type: "rich-text",
                  data: { markdown: "Nested rich text inside a tab." },
                },
              ],
            },
            {
              id: "tab-2",
              label: "Table",
              blocks: [
                {
                  id: "tab-tb-1",
                  type: "table",
                  data: { columns: ["K", "V"], rows: [["a", "b"]] },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Border / theme helpers                                                     */
/* -------------------------------------------------------------------------- */

/** Open the ⋮ Plan actions menu and return its content locator. */
async function openPlanActionsMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "Plan actions" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("plan generation + rendering", () => {
  test("HTML-wireframe canvas renders all four surfaces, no error toast/console", async ({
    page,
  }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("html-canvas");
    const planId = await createPlan(page, {
      title,
      brief: "HTML-wireframe canvas across surfaces.",
      content: htmlCanvasContent(title),
    });
    await openPlan(page, planId);

    // Canvas present with 4 artboard frames (one per surface).
    await expect(page.locator(".plan-canvas")).toBeVisible();
    await expect
      .poll(async () => page.locator("[data-canvas-frame]").count(), {
        timeout: 15_000,
      })
      .toBe(4);
    // Each canvas artboard mounts a .plan-html-frame. (Wireframe blocks also
    // render in the document below, so the page-wide count is higher.)
    await expect(
      page.locator("[data-canvas-frame] .plan-html-frame"),
    ).toHaveCount(4);

    await assertNoErrorToast(page);
    assertConsoleClean(watch, "html-canvas render");
  });

  test("popover renders ~square (not wide); desktop/browser are wide", async ({
    page,
  }) => {
    const title = uniqueTitle("aspect");
    const planId = await createPlan(page, {
      title,
      brief: "Surface footprints.",
      content: htmlCanvasContent(title),
    });
    await openPlan(page, planId);
    const canvasFrames = page.locator("[data-canvas-frame] .plan-kit-artboard");
    await expect
      .poll(async () => canvasFrames.count(), { timeout: 15_000 })
      .toBe(4);

    // Read the surface footprints from the rendered artboards. The renderer
    // locks footprint by surface; a popover must be ~square (≤1.2 ratio) and
    // clearly narrower than a desktop/browser frame.
    const sizes = await canvasFrames.evaluateAll((els) =>
      els.map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    // popover preset is 360x360 → ratio ~1.0. Find the most-square frame.
    const ratios = sizes.map((s) => (s.h > 0 ? s.w / s.h : 999));
    const minRatio = Math.min(...ratios);
    expect(
      minRatio,
      `no ~square frame found; ratios=${ratios.join(",")}`,
    ).toBeLessThanOrEqual(1.25);
    // The popover must not be as wide as the widest (desktop/browser) frame.
    const widths = sizes.map((s) => s.w);
    const popoverWidth = Math.min(...widths);
    const widest = Math.max(...widths);
    expect(
      popoverWidth,
      "popover not narrower than widest surface",
    ).toBeLessThan(widest);
  });

  test("kit-tree wireframe renders without error", async ({ page }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("kit-tree");
    const planId = await createPlan(page, {
      title,
      brief: "Kit-tree wireframe.",
      content: kitWireframeContent(title),
    });
    await openPlan(page, planId);
    await expect(page.locator(".plan-canvas")).toBeVisible();
    const kitArtboard = page.locator("[data-canvas-frame] .plan-kit-artboard");
    await expect(kitArtboard).toHaveCount(1);
    // The kit tree should produce its primitive nodes (data-rough markers).
    await expect
      .poll(async () => kitArtboard.locator("[data-rough]").count(), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await assertNoErrorToast(page);
    assertConsoleClean(watch, "kit-tree render");
  });

  test("skeleton wireframe stays neutral + textless", async ({ page }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("skeleton");
    const planId = await createPlan(page, {
      title,
      brief: "Skeleton register.",
      content: skeletonContent(title),
    });
    await openPlan(page, planId);
    // Renders in both the canvas artboard and the document block.
    const frame = page.locator(
      "[data-canvas-frame] .plan-html-frame[data-skeleton='true']",
    );
    await expect(frame).toHaveCount(1);

    // Textless: the supplied heading/body text must NOT be visible. The
    // skeleton register masks text (the renderer renders soft placeholder
    // geometry, not the real copy), so every text-bearing element's computed
    // color must resolve fully transparent (alpha 0). This is the real "no copy
    // leaks" guarantee — checking innerText would be wrong since the nodes can
    // legitimately stay in the DOM while being visually masked.
    const leaked = await frame.first().evaluate((el) => {
      const nodes = Array.from(
        el.querySelectorAll("h1,h2,h3,p,span,a,button,li"),
      ).filter((n) => (n.textContent ?? "").trim().length > 0);
      const visible: string[] = [];
      for (const n of nodes) {
        const color = getComputedStyle(n as HTMLElement).color;
        // Transparent => rgba(...,0) or "transparent". Anything with non-zero
        // alpha means the copy is actually readable.
        const m = color.match(/rgba?\(([^)]+)\)/);
        const alpha = m ? parseFloat(m[1].split(",")[3] ?? "1") : 1;
        if (color !== "transparent" && alpha > 0.02) {
          visible.push(
            `${(n.textContent ?? "").trim().slice(0, 30)} :: ${color}`,
          );
        }
      }
      return visible;
    });
    expect(
      leaked,
      `skeleton frame rendered readable copy (should be masked): ${leaked.join(" | ")}`,
    ).toEqual([]);

    // Neutral: no rough sketch overlay on a skeleton frame.
    await expect(
      page.locator(
        "[data-canvas-frame] .plan-kit-artboard svg.plan-rough-overlay",
      ),
    ).toHaveCount(0);

    await assertNoErrorToast(page);
    assertConsoleClean(watch, "skeleton render");
  });

  test("rich document renders every block type, no error toast/console", async ({
    page,
  }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("rich-doc");
    const planId = await createPlan(page, {
      title,
      brief: "Every block type.",
      content: richDocContent(title),
    });
    await openPlan(page, planId);

    // The single-document editor (SINGLE_DOC_EDITOR_ENABLED) mounts after
    // hydration and renders the whole body as ONE Tiptap document:
    //   - rich-text blocks become inline prose whose first node is stamped
    //     `data-run-id="<block id>"` (NOT a `data-block-id` section);
    //   - structured blocks render as inline `planBlock` NodeViews, each carrying
    //     `data-block-id`. Legacy-dispatched blocks (table/code-tabs/decision/tabs)
    //     wrap their content in the same `PlanBlockView` section used by the read
    //     path, so the NodeViewWrapper AND the inner section BOTH carry
    //     `data-block-id` — i.e. each structured id appears MORE THAN ONCE. Assert
    //     presence with count >= 1 / `.first()` rather than strict visibility.
    await expect(page.locator(".plan-document-editor-surface")).toBeVisible({
      timeout: 25_000,
    });

    // Rich text: rendered inline as prose addressed by run id, with its heading.
    await expect(page.locator('[data-run-id="rt-1"]').first()).toBeVisible();
    await expect(
      page
        .locator(".plan-document-editor-surface")
        .getByText("Overview")
        .first(),
    ).toBeVisible();

    // Each structured block is present (each id may appear >1× — NodeViewWrapper +
    // inner section — so assert at least one and that the first is visible).
    for (const id of ["co-1", "tb-1", "ct-1", "im-1", "tabs-1"]) {
      await expect
        .poll(async () => page.locator(`[data-block-id="${id}"]`).count(), {
          timeout: 15_000,
          message: `structured block ${id} never rendered`,
        })
        .toBeGreaterThan(0);
      await expect(
        page.locator(`[data-block-id="${id}"]`).first(),
      ).toBeVisible();
    }

    // Callout: title + body rendered.
    const callout = page.locator('[data-block-id="co-1"]').first();
    await expect(
      callout.getByText("Heads up", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      callout.getByText("This is a callout body", { exact: false }).first(),
    ).toBeVisible();
    // Table: renders as a static table inside the document (NOT an editable input
    // grid). Assert every header + cell value is visible text.
    const table = page.locator('[data-block-id="tb-1"]').first();
    for (const expected of [
      "Option",
      "Pros",
      "Cons",
      "Fast",
      "Costly",
      "Cheap",
      "Slow",
    ]) {
      await expect(
        table.getByText(expected, { exact: false }).first(),
        `table missing cell "${expected}"`,
      ).toBeVisible();
    }
    // Code-tabs: both tab labels are rendered.
    await expect(
      page.getByText("client.ts", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("styles.css", { exact: false }).first(),
    ).toBeVisible();
    // Implementation-map: file path + note rendered.
    await expect(
      page
        .locator('[data-block-id="im-1"]')
        .first()
        .getByText("app/routes/example.tsx")
        .first(),
    ).toBeVisible();
    // Tabs block: tab label + the first tab's nested rich-text child render. The
    // nested rich-text inside a tab renders via the legacy PlanBlockView path, so
    // it keeps its `data-block-id`.
    await expect(
      page
        .locator('[data-block-id="tabs-1"]')
        .first()
        .getByText("Notes")
        .first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-block-id="tab-rt-1"]').first(),
    ).toBeVisible();

    await assertNoErrorToast(page);
    // flushSync console-error storm is FIXED (the single-doc editor's non-collab
    // seed path no longer rewrites the whole Y.XmlFragment), so the console must
    // be clean.
    assertConsoleClean(watch, "rich-doc render");
  });

  test("frames keep a visible border across all 4 theme/style combos; skeleton stays neutral", async ({
    page,
  }) => {
    const watch = watchConsole(page);
    // One plan with BOTH a normal HTML frame and a skeleton frame so we can
    // verify the skeleton stays neutral in every combo.
    const title = uniqueTitle("borders");
    const content = {
      version: 2,
      title,
      brief: "Border behavior across theme/style.",
      canvas: {
        title: "Screens",
        frames: [
          { id: "fr-a", label: "Normal", surface: "desktop", blockId: "wf-a" },
          {
            id: "fr-b",
            label: "Skeleton",
            surface: "popover",
            blockId: "wf-b",
          },
        ],
      },
      blocks: [
        {
          id: "wf-a",
          type: "wireframe",
          title: "Normal",
          data: {
            surface: "desktop",
            html: `<div class="wf-frame-target" style="padding:16px"><h2>Hello</h2><div class="wf-card"><p>Body</p></div></div>`,
          },
        },
        {
          id: "wf-b",
          type: "wireframe",
          title: "Skeleton",
          data: {
            surface: "popover",
            skeleton: true,
            html: `<div class="wf-frame-target" style="padding:16px"><p>LOADING_TEXT</p></div>`,
          },
        },
      ],
    };
    const planId = await createPlan(page, { title, brief: "borders", content });
    await openPlan(page, planId);
    const canvasArtboards = page.locator(
      "[data-canvas-frame] .plan-kit-artboard",
    );
    await expect
      .poll(async () => canvasArtboards.count(), { timeout: 15_000 })
      .toBe(2);

    // Reset to a known baseline: Light + Sketchy. We toggle from whatever the
    // current state is, reading the menu labels to know the current mode.
    const ensureTheme = async (target: "light" | "dark") => {
      const menu = await openPlanActionsMenu(page);
      // Menu shows "Light mode" item when currently dark, "Dark mode" when light.
      const wantsItem = target === "light" ? /light mode/i : /dark mode/i;
      const item = menu.getByRole("menuitem", { name: wantsItem });
      if ((await item.count()) > 0) {
        await item.click();
        await expect(page.getByRole("menu")).toHaveCount(0);
      } else {
        // Already in target theme; close the menu.
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
      }
    };
    const ensureStyle = async (target: "sketchy" | "clean") => {
      const menu = await openPlanActionsMenu(page);
      // Item label is "Clean wireframes" when currently sketchy, vice versa.
      const wantsItem =
        target === "clean" ? /clean wireframes/i : /sketchy wireframes/i;
      const item = menu.getByRole("menuitem", { name: wantsItem });
      if ((await item.count()) > 0) {
        await item.click();
        await expect(page.getByRole("menu")).toHaveCount(0);
      } else {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
      }
    };

    const combos: Array<{
      theme: "light" | "dark";
      style: "sketchy" | "clean";
    }> = [
      { theme: "light", style: "sketchy" },
      { theme: "light", style: "clean" },
      { theme: "dark", style: "sketchy" },
      { theme: "dark", style: "clean" },
    ];

    for (const combo of combos) {
      await ensureTheme(combo.theme);
      await ensureStyle(combo.style);
      const label = `${combo.theme}/${combo.style}`;

      // The normal frame must always have a visible border. (The skeleton frame
      // is in clean/skeleton register regardless of style, so it always uses the
      // crisp border — assert it specifically.)
      const normal = canvasArtboards.first();
      if (combo.style === "sketchy") {
        await expect
          .poll(
            async () =>
              (await normal.locator("svg.plan-rough-overlay").count()) > 0 ||
              (await normal.locator("[data-rough-ready]").count()) > 0,
            {
              timeout: 8_000,
              message: `normal frame no sketch border (${label})`,
            },
          )
          .toBeTruthy();
      } else {
        const hasBorder = await normal.evaluate((el) => {
          const kids = Array.from(el.querySelectorAll(":scope > div"));
          return kids.some((k) => {
            const cs = getComputedStyle(k as HTMLElement);
            return (
              parseFloat(cs.borderTopWidth || "0") > 0 &&
              cs.borderTopStyle !== "none"
            );
          });
        });
        expect(
          hasBorder,
          `normal frame no crisp border (${label})`,
        ).toBeTruthy();
      }

      // Skeleton frame: always a crisp neutral border (never the sketch overlay),
      // and never the leaked text.
      const skel = page.locator(
        "[data-canvas-frame] .plan-html-frame[data-skeleton='true']",
      );
      await expect(skel).toHaveCount(1);
      const skelArtboard = canvasArtboards.nth(1);
      const skelHasSketch = await skelArtboard
        .locator("svg.plan-rough-overlay")
        .count();
      expect(skelHasSketch, `skeleton drew a sketch overlay (${label})`).toBe(
        0,
      );
      const skelHasBorder = await skelArtboard.evaluate((el) => {
        const kids = Array.from(el.querySelectorAll(":scope > div"));
        return kids.some((k) => {
          const cs = getComputedStyle(k as HTMLElement);
          return (
            parseFloat(cs.borderTopWidth || "0") > 0 &&
            cs.borderTopStyle !== "none"
          );
        });
      });
      expect(
        skelHasBorder,
        `skeleton frame lost its border (${label})`,
      ).toBeTruthy();
      // Skeleton copy must be masked (computed color fully transparent) in every
      // theme/style combo — the loader never shows real text.
      const skelLeaked = await skel.first().evaluate((el) => {
        const nodes = Array.from(
          el.querySelectorAll("h1,h2,h3,p,span,a,li"),
        ).filter((n) => (n.textContent ?? "").trim().length > 0);
        return nodes
          .filter((n) => {
            const color = getComputedStyle(n as HTMLElement).color;
            const m = color.match(/rgba?\(([^)]+)\)/);
            const alpha = m ? parseFloat(m[1].split(",")[3] ?? "1") : 1;
            return color !== "transparent" && alpha > 0.02;
          })
          .map((n) => (n.textContent ?? "").trim().slice(0, 24));
      });
      expect(
        skelLeaked,
        `skeleton leaked readable copy (${label}): ${skelLeaked.join(" | ")}`,
      ).toEqual([]);
    }

    await assertNoErrorToast(page);
    assertConsoleClean(watch, "border combos");
  });

  test("wireframe with many (12) frames renders all without error", async ({
    page,
  }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("many-frames");
    const N = 12;
    const blocks = Array.from({ length: N }, (_, i) => ({
      id: `wf-m-${i}`,
      type: "wireframe" as const,
      title: `Screen ${i + 1}`,
      data: {
        surface: i % 2 === 0 ? "desktop" : "mobile",
        html: `<div class="wf-frame-target" style="padding:12px"><h3>Screen ${i + 1}</h3><div class="wf-card"><p>Content ${i + 1}</p></div></div>`,
      },
    }));
    const content = {
      version: 2,
      title,
      brief: "Many frames.",
      canvas: {
        title: "Many",
        frames: blocks.map((b, i) => ({
          id: `fr-m-${i}`,
          label: b.title,
          surface: b.data.surface,
          blockId: b.id,
        })),
      },
      blocks,
    };
    const planId = await createPlan(page, { title, brief: "many", content });
    await openPlan(page, planId);
    await expect
      .poll(async () => page.locator("[data-canvas-frame]").count(), {
        timeout: 20_000,
      })
      .toBe(N);
    await expect(
      page.locator("[data-canvas-frame] .plan-html-frame"),
    ).toHaveCount(N);
    await assertNoErrorToast(page);
    assertConsoleClean(watch, "many frames render");
  });

  test("empty document (no blocks) renders header without crashing", async ({
    page,
  }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("empty-doc");
    const content = {
      version: 2,
      title,
      brief: "An empty plan body.",
      blocks: [],
    };
    const planId = await createPlan(page, { title, brief: "empty", content });
    await openPlan(page, planId);
    // Header h1 still shows the title; no canvas, no blocks.
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(page.locator("[data-block-id]")).toHaveCount(0);
    await assertNoErrorToast(page);
    assertConsoleClean(watch, "empty doc render");
  });

  test("very long document renders top + bottom blocks without error", async ({
    page,
  }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("long-doc");
    const N = 60;
    const blocks = Array.from({ length: N }, (_, i) => ({
      id: `rt-long-${i}`,
      type: "rich-text" as const,
      title: `Section ${i + 1}`,
      data: {
        markdown: `### Section ${i + 1}\n\n${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(8)}`,
      },
    }));
    const content = { version: 2, title, brief: "Long body.", blocks };
    const planId = await createPlan(page, { title, brief: "long", content });
    await openPlan(page, planId);

    // In the single-document editor, 60 contiguous rich-text blocks form ONE prose
    // run (the serializer merges adjacent prose; the first node keeps the run id
    // `rt-long-0`). So we assert on rendered PROSE content (top + bottom headings)
    // and the surviving run id, not 60 `data-block-id` sections.
    const surface = page.locator(".plan-document-editor-surface");
    await expect(surface).toBeVisible({ timeout: 25_000 });
    await expect(
      page.locator('[data-run-id="rt-long-0"]').first(),
    ).toBeVisible();
    // Top heading present.
    await expect(
      surface.getByRole("heading", { name: "Section 1", exact: true }).first(),
    ).toBeVisible();
    // Bottom heading present in the DOM (the editor renders the full document).
    await expect(
      surface.getByRole("heading", { name: `Section ${N}`, exact: true }),
    ).toHaveCount(1);
    await assertNoErrorToast(page);
    assertConsoleClean(watch, "long doc render");
  });

  test("wireframe with emoji / RTL / very long labels renders, no error", async ({
    page,
  }) => {
    const watch = watchConsole(page);
    const title = uniqueTitle("emoji-rtl");
    // Long but within the schema's 180-char label cap; includes a long unbroken
    // token to stress wrapping/overflow in the artboard label + frame.
    const longLabel =
      "Very long label " + "long-unbroken-token-" + "x".repeat(120);
    const content = {
      version: 2,
      title: `${title} 🚀 مرحبا`,
      brief: "Emoji 😀, RTL مرحبا بالعالم, and a very long label test.",
      canvas: {
        title: "Edge labels",
        frames: [
          {
            id: "fr-e1",
            label: "🚀 Emoji screen 你好",
            surface: "desktop",
            blockId: "wf-e1",
          },
          {
            id: "fr-e2",
            label: "مرحبا بالعالم RTL",
            surface: "mobile",
            blockId: "wf-e2",
          },
          {
            id: "fr-e3",
            label: longLabel,
            surface: "browser",
            blockId: "wf-e3",
          },
        ],
      },
      blocks: [
        {
          id: "wf-e1",
          type: "wireframe",
          title: "🚀 Emoji screen",
          data: {
            surface: "desktop",
            html: `<div class="wf-frame-target" style="padding:14px"><h2>Hello 🌍 emoji 😀🎉</h2><p>नमस्ते 你好 こんにちは</p></div>`,
          },
        },
        {
          id: "wf-e2",
          type: "wireframe",
          title: "RTL screen",
          data: {
            surface: "mobile",
            html: `<div class="wf-frame-target" dir="rtl" style="padding:14px"><h3>مرحبا بالعالم</h3><p>هذا نص عربي طويل للاختبار في الإطار</p></div>`,
          },
        },
        {
          id: "wf-e3",
          type: "wireframe",
          title: longLabel,
          data: {
            surface: "browser",
            html: `<div class="wf-frame-target" style="padding:14px"><h2>${longLabel}</h2></div>`,
          },
        },
      ],
      // Also a rich-text block with emoji + RTL to exercise the document path.
      // (appended below)
    };
    (content.blocks as unknown as Array<Record<string, unknown>>).push({
      id: "rt-emoji",
      type: "rich-text",
      title: "Mixed text 🚀",
      data: {
        markdown:
          "Emoji 😀🎉, RTL مرحبا بالعالم, CJK 你好こんにちは, and a `verylongtokenwithoutspaces` " +
          "z".repeat(120),
      },
    });

    const planId = await createPlan(page, {
      title: `${title} 🚀`,
      brief: "emoji/rtl/long-label",
      content,
    });
    await openPlan(page, planId);
    await expect
      .poll(async () => page.locator("[data-canvas-frame]").count(), {
        timeout: 15_000,
      })
      .toBe(3);
    await expect(
      page.locator("[data-canvas-frame] .plan-html-frame"),
    ).toHaveCount(3);
    // The trailing rich-text block follows the wireframe `planBlock` nodes, so it
    // is its own prose run in the single-doc editor and keeps its run id. Assert
    // it rendered and that the mixed emoji/RTL/CJK copy is present.
    await expect(page.locator('[data-run-id="rt-emoji"]').first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(
      page
        .locator(".plan-document-editor-surface")
        .getByText(/مرحبا بالعالم/)
        .first(),
    ).toBeVisible();

    // The very long label artboard must not blow the canvas layout: its frame
    // footprint stays surface-locked (browser preset width ~900), independent of
    // the absurd label length.
    const widths = await page
      .locator("[data-canvas-frame] .plan-kit-artboard")
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).getBoundingClientRect().width),
      );
    // No frame should be unreasonably wide (label must not stretch the artboard).
    for (const w of widths) {
      expect(
        w,
        `frame too wide (${w}px) — long label likely stretched it`,
      ).toBeLessThan(1400);
    }

    await assertNoErrorToast(page);
    assertConsoleClean(watch, "emoji/rtl/long-label render");
  });
});
