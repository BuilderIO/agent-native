import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * DEV-DOC BLOCKS — render + persist E2E for the 7 developer-documentation blocks.
 *
 * Area under test: the seven "dev-doc" plan block types — `mermaid`,
 * `api-endpoint`, `data-model`, `diff`, `file-tree`, `json-explorer`, and
 * `annotated-code` —
 * rendered inside the single-document plan editor (PlanDocumentEditor /
 * SharedRichEditor). Each
 * registered block is an inline `planBlock` NodeView wrapped in
 * `.plan-block-node[data-block-id=<id>]`; the block's own `Read` component then
 * renders a `section.plan-block[data-block-id=<id>]` with the block-specific UI.
 *
 * What each test proves, per block type:
 *   1. RENDER — opening a plan whose `content.blocks` carries ONE valid block of
 *      that type mounts a `.plan-block-node[data-block-id=<id>]` NodeView, and the
 *      block's recognizable rendered content is visible (e.g. api-endpoint → the
 *      "GET" method pill + path; data-model → the "User" entity name; diff → an
 *      added/removed code token; json-explorer → a JSON key; file-tree → a path
 *      segment; annotated-code → a filename/code token/annotation label;
 *      mermaid → an <svg> OR the graceful
 *      source / parse-error fallback — never a thrown render).
 *   2. PERSIST (no wipe) — the persisted block list still contains exactly the
 *      blocks the fixture created (rich-text seed + the one dev-doc block), i.e.
 *      simply OPENING the plan does not wipe or drop the structured block.
 *
 * Plus ONE slash-insert test: typing "/api" in a one-rich-text-block plan filters
 * the shared "/" menu (`.an-rich-md-slash-menu`) to the "API endpoint" registry
 * command (its description is the block `type`, "api-endpoint", so "/api" matches),
 * clicking it inserts a `planBlock`, the `update-visual-plan` autosave returns 200,
 * and an `api-endpoint` block now persists where none did before.
 *
 * Data shapes mirror each block's `empty()` in `planBlocks.tsx` (the same data the
 * registry seeds), tweaked only to carry a recognizable token. Asserts CORRECT
 * behavior — a failing assertion IS the bug it reports. retries:2 + web-first
 * auto-retrying expects absorb transient HMR reloads on the shared dev server.
 */

const UPDATE_ACTION = "/_agent-native/actions/update-visual-plan";
const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const GET_ACTION = "/_agent-native/actions/get-visual-plan";

type PlanBlock = {
  id: string;
  type: string;
  title?: string;
  editable?: boolean;
  data?: Record<string, unknown>;
};

type PlanContentInput = {
  version: number;
  title?: string;
  brief?: string;
  blocks: PlanBlock[];
};

function uniqueTitle(label: string): string {
  return `DevDoc ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function readJson(res: APIResponse): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function createPlanFixture(
  page: Page,
  content: PlanContentInput,
): Promise<string> {
  let res: APIResponse | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    res = await page.request.post(CREATE_ACTION, {
      data: { title: content.title, brief: content.brief, content },
    });
    if (res.ok()) break;
    await page.waitForTimeout(800);
  }
  expect(
    res?.ok(),
    `create-visual-plan should succeed (status ${res?.status()}): ${await (
      res as APIResponse
    )
      .text()
      .catch(() => "")}`,
  ).toBeTruthy();
  const body = await readJson(res as APIResponse);
  const planId =
    (body.planId as string | undefined) ??
    (body.plan as { id?: string } | undefined)?.id;
  expect(
    planId,
    `create-visual-plan returns a plan id: ${JSON.stringify(body).slice(0, 300)}`,
  ).toBeTruthy();
  return planId as string;
}

async function getPlanBlocks(page: Page, planId: string): Promise<PlanBlock[]> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as { content?: { blocks?: PlanBlock[] } };
  return plan.content?.blocks ?? [];
}

function proseFor(page: Page) {
  return page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
}

async function openPlanForEditing(page: Page, planId: string) {
  await page.goto(`/plans/${planId}`);
  const prose = proseFor(page);
  await expect(prose).toBeVisible({ timeout: 25_000 });
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
  return prose;
}

function blockNode(page: Page, blockId: string) {
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
    )
    .first();
}

const RICH_SEED_ID = "rt-seed";

function devDocContent(opts: {
  title: string;
  block: PlanBlock;
}): PlanContentInput {
  return {
    version: 2,
    title: opts.title,
    brief: "Dev-doc block render + persist fixture.",
    blocks: [
      {
        id: RICH_SEED_ID,
        type: "rich-text",
        editable: true,
        data: { markdown: "Seed paragraph above the dev-doc block." },
      },
      opts.block,
    ],
  };
}

async function expectRendersAndPersists(
  page: Page,
  opts: {
    label: string;
    block: PlanBlock;
    assertRendered: (
      node: ReturnType<typeof blockNode>,
      page: Page,
    ) => Promise<void>;
  },
): Promise<void> {
  const planId = await createPlanFixture(
    page,
    devDocContent({ title: uniqueTitle(opts.label), block: opts.block }),
  );

  const beforeTypes = (await getPlanBlocks(page, planId)).map((b) => b.type);
  expect(
    beforeTypes,
    `fixture should persist [rich-text, ${opts.block.type}] (got ${beforeTypes.join(", ")})`,
  ).toEqual(["rich-text", opts.block.type]);

  await openPlanForEditing(page, planId);

  const node = blockNode(page, opts.block.id);
  await expect(
    node,
    `${opts.label}: the planBlock NodeView for "${opts.block.id}" should mount`,
  ).toBeVisible({ timeout: 25_000 });

  await opts.assertRendered(node, page);

  await expect
    .poll(async () => (await getPlanBlocks(page, planId)).map((b) => b.type), {
      timeout: 15_000,
    })
    .toEqual(["rich-text", opts.block.type]);
  const after = await getPlanBlocks(page, planId);
  expect(
    after.find((b) => b.id === opts.block.id),
    `${opts.label}: the dev-doc block id "${opts.block.id}" survives (no wipe)`,
  ).toBeTruthy();
}

test.describe("dev-doc blocks render + persist", () => {
  test("api-endpoint renders the method + path and persists", async ({
    page,
  }) => {
    await expectRendersAndPersists(page, {
      label: "api-endpoint",
      block: {
        id: "blk-api",
        type: "api-endpoint",
        data: {
          method: "GET",
          path: "/api/users/{id}",
          summary: "Fetch a single user",
        },
      },
      assertRendered: async (node) => {
        await expect(node).toContainText("GET", { timeout: 15_000 });
        await expect(node).toContainText("/api/users/{id}");
      },
    });
  });

  test("data-model renders the entity name and persists", async ({ page }) => {
    await expectRendersAndPersists(page, {
      label: "data-model",
      block: {
        id: "blk-datamodel",
        type: "data-model",
        data: {
          entities: [
            {
              id: "e_user",
              name: "User",
              fields: [
                { name: "id", type: "uuid", pk: true },
                { name: "email", type: "text" },
              ],
            },
          ],
        },
      },
      assertRendered: async (node) => {
        await expect(node).toContainText("User", { timeout: 15_000 });
        await expect(node).toContainText("email");
      },
    });
  });

  test("diff renders an added line token and persists", async ({ page }) => {
    await expectRendersAndPersists(page, {
      label: "diff",
      block: {
        id: "blk-diff",
        type: "diff",
        data: {
          filename: "src/add.ts",
          language: "ts",
          before: "function add(a, b) {\n  return a + b;\n}",
          after:
            "function add(a: number, b: number): number {\n  return a + b;\n}",
        },
      },
      assertRendered: async (node) => {
        // Filename header + a token that only exists on the ADDED side (the typed
        await expect(node).toContainText("src/add.ts", { timeout: 15_000 });
        await expect(node).toContainText("a: number");
      },
    });
  });

  test("file-tree renders a path segment and persists", async ({ page }) => {
    await expectRendersAndPersists(page, {
      label: "file-tree",
      block: {
        id: "blk-filetree",
        type: "file-tree",
        data: {
          title: "Files touched",
          entries: [
            {
              path: "src/index.ts",
              change: "modified",
              note: "Wire the new route here.",
            },
            { path: "src/routes/git.ts", change: "added" },
          ],
        },
      },
      assertRendered: async (node) => {
        await expect(node).toContainText("src", { timeout: 15_000 });
        await expect(node).toContainText("index.ts");
        await expect(node).toContainText("git.ts");
      },
    });
  });

  test("json-explorer renders a JSON key and persists", async ({ page }) => {
    await expectRendersAndPersists(page, {
      label: "json-explorer",
      block: {
        id: "blk-json",
        type: "json-explorer",
        data: {
          json: JSON.stringify(
            {
              id: "abc123",
              active: true,
              tags: ["alpha", "beta"],
              meta: { count: 2, owner: null },
            },
            null,
            2,
          ),
        },
      },
      assertRendered: async (node) => {
        await expect(node).toContainText("id", { timeout: 15_000 });
        await expect(node).toContainText("active");
        await expect(node).toContainText("abc123");
      },
    });
  });

  test("annotated-code renders a code token and persists", async ({ page }) => {
    await expectRendersAndPersists(page, {
      label: "annotated-code",
      block: {
        id: "blk-annotated",
        type: "annotated-code",
        data: {
          filename: "src/server/auth.ts",
          language: "ts",
          code: "export function resolveAuth(provider: string) {\n  const cfg = providers[provider];\n  return cfg.token;\n}",
          annotations: [
            {
              lines: "2",
              label: "Lookup",
              note: "Resolves the provider config by key.",
            },
          ],
        },
      },
      assertRendered: async (node) => {
        await expect(node).toContainText("src/server/auth.ts", {
          timeout: 15_000,
        });
        await expect(node).toContainText("resolveAuth");
        await expect(node).toContainText("Lookup");
      },
    });
  });

  test("mermaid renders an <svg> or a graceful fallback, in light AND dark, and persists", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      devDocContent({
        title: uniqueTitle("mermaid"),
        block: {
          id: "blk-mermaid",
          type: "mermaid",
          data: {
            source:
              "flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]",
            caption: "Decision flow",
          },
        },
      }),
    );

    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "mermaid",
    ]);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));

    await openPlanForEditing(page, planId);
    const node = blockNode(page, "blk-mermaid");
    await expect(
      node,
      "mermaid: the planBlock NodeView should mount",
    ).toBeVisible({ timeout: 25_000 });

    const lightState = async () => {
      const svg = await node.locator("svg").count();
      if (svg > 0) return "svg";
      const text = (await node.innerText()).toLowerCase();
      if (text.includes("could not render")) return "fallback-error";
      if (text.includes("flowchart") || text.includes("decision flow"))
        return "fallback-source";
      if (text.includes("loading diagram")) return "loading";
      return "unknown";
    };
    await expect.poll(lightState, { timeout: 25_000 }).not.toBe("loading");
    const lightResult = await lightState();
    expect(
      ["svg", "fallback-error", "fallback-source"].includes(lightResult),
      `mermaid (light): expected an <svg> or a graceful fallback, got "${lightResult}". If this is a mermaid dep/optimize error, see pageErrors: ${pageErrors.join(" | ")}`,
    ).toBeTruthy();
    if (lightResult !== "svg") {
      const depHint = pageErrors.find((e) =>
        /mermaid|optimi|import|chunk|dynamic/i.test(e),
      );
      console.warn(
        `[dev-doc-blocks] mermaid did not produce an <svg> (state="${lightResult}"). ` +
          (depHint
            ? `Likely a mermaid dep/optimize issue: ${depHint}`
            : `No matching pageerror captured; pageErrors=[${pageErrors.join(" | ")}]`),
      );
    }

    await page.evaluate(() => {
      const root = document.documentElement;
      root.classList.remove("light");
      root.classList.add("dark");
      try {
        window.localStorage.setItem("theme", "dark");
      } catch {
        /* ignore */
      }
    });
    await expect.poll(lightState, { timeout: 20_000 }).not.toBe("loading");
    const darkResult = await lightState();
    expect(
      ["svg", "fallback-error", "fallback-source"].includes(darkResult),
      `mermaid (dark): expected an <svg> or graceful fallback, got "${darkResult}". pageErrors: ${pageErrors.join(" | ")}`,
    ).toBeTruthy();

    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 15_000,
        },
      )
      .toEqual(["rich-text", "mermaid"]);
  });
});

test.describe("dev-doc blocks slash-insert", () => {
  test("typing /api inserts an api-endpoint block that persists", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("slash-api"),
      brief: "Slash-insert dev-doc fixture.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Seed paragraph." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    const before = await getPlanBlocks(page, planId);
    expect(before.some((b) => b.type === "api-endpoint")).toBe(false);

    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/api", { delay: 20 });

    const slashMenu = page.locator(".an-rich-md-slash-menu");
    await expect(slashMenu).toBeVisible({ timeout: 8_000 });
    const apiItem = page
      .locator(".an-rich-md-slash-item")
      .filter({ hasText: "API endpoint" });
    await expect(apiItem).toHaveCount(1, { timeout: 8_000 });

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );

    await apiItem.first().click();
    await okSave;

    await expect
      .poll(
        async () =>
          (await getPlanBlocks(page, planId)).filter(
            (b) => b.type === "api-endpoint",
          ).length,
        { timeout: 15_000 },
      )
      .toBe(1);

    const inserted = (await getPlanBlocks(page, planId)).find(
      (b) => b.type === "api-endpoint",
    );
    expect(inserted, "inserted api-endpoint block present").toBeTruthy();
    const node = blockNode(page, inserted!.id);
    await expect(node).toBeVisible({ timeout: 20_000 });
    await expect(node).toContainText("GET", { timeout: 15_000 });
  });
});
