import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * SINGLE-DOCUMENT RICH-TEXT EDITING + AUTOSAVE — adversarial E2E.
 *
 * Area under test: the SINGLE-DOCUMENT plan editor (PlanDocumentEditor /
 * SINGLE_DOC_EDITOR_ENABLED=true). The whole plan body is ONE ProseMirror/Tiptap
 * document rendered by `SharedRichEditor`, mounted with wrapper/surface class
 * `plan-document-editor-surface` and an inner contenteditable ProseMirror surface
 * `.an-rich-md-prose`. The OLD per-block selector
 * `section[data-block-id] .an-rich-md-prose` is now only the READ/display path
 * (DocumentArea / PlanMarkdownReader), NOT the live editor.
 *
 * How edits flow (verified against PlanDocumentEditor.tsx + plan-doc.ts):
 *   - The first prose node of each rich-text block is stamped `data-run-id` =
 *     the block id, so a block's text is addressable as `p[data-run-id="<id>"]`
 *     and its id stays STABLE across edits (`proseJSONToBlocks` re-derives it).
 *   - Every keystroke serializes the WHOLE doc back to `blocks[]` and autosaves
 *     through `update-visual-plan` with `contentPatches: [{ op: "replace-blocks",
 *     blocks }]` — the new op (NOT the legacy `update-rich-text`). There is NO
 *     client debounce in the single-doc editor: one POST fires per keystroke.
 *   - Structured-block `data` lives only in `blocks[]`; a rich-text block's data
 *     is exactly `{ markdown }` (no stray Tiptap/ProseMirror `doc`).
 *
 * Asserts CORRECT behavior. A failing assertion IS the bug it reports. The core
 * save contract is: a `replace-blocks` autosave MUST return 200 (NOT 500).
 *
 * Resilience: the shared dev server may HMR/reload while other agents edit the
 * app. Specs use web-first auto-retrying expects, tolerate a stray reload, and
 * avoid fixed sleeps where a wait-for is possible. retries:2 is configured
 * globally in playwright.config.ts.
 */

const UPDATE_ACTION = "/_agent-native/actions/update-visual-plan";
const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";

type PlanContentInput = {
  version: number;
  title?: string;
  brief?: string;
  blocks: Array<{
    id: string;
    type: string;
    title?: string;
    editable?: boolean;
    data: Record<string, unknown>;
  }>;
};

const RICH_BLOCK_ID = "rt-intro";

function uniqueTitle(label: string): string {
  return `Inline Edit ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function richTextContent(opts: {
  title: string;
  markdown?: string;
}): PlanContentInput {
  return {
    version: 2,
    title: opts.title,
    brief: "Adversarial single-doc editing autosave fixture.",
    blocks: [
      {
        id: RICH_BLOCK_ID,
        type: "rich-text",
        title: "Overview",
        editable: true,
        data: {
          markdown: opts.markdown ?? "Seed paragraph that we will edit.",
        },
      },
    ],
  };
}

async function readJson(res: APIResponse): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Create a fresh plan fixture via the authed action surface; return its id.
 *
 * `create-visual-plan` succeeds reliably, but the shared dev server can HMR/reload
 * mid-request while other agents edit the app, producing a transient 500. Retry a
 * few times so a fixture hiccup never masquerades as the autosave bug under test.
 */
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
  // The action returns the bundle merged with planId/plan.
  const planId =
    (body.planId as string | undefined) ??
    (body.plan as { id?: string } | undefined)?.id ??
    undefined;
  expect(
    planId,
    `create-visual-plan returned a plan id: ${JSON.stringify(body).slice(0, 400)}`,
  ).toBeTruthy();
  return planId as string;
}

/**
 * Fetch the current stored bundle for assertions about persisted markdown.
 *
 * `get-visual-plan` is a GET action, so its single `id` arg travels in the query
 * string. The rich-text block id stays stable across single-doc edits (the prose
 * run is stamped with `data-run-id = block id` and `proseJSONToBlocks` re-derives
 * it), so the seed block is still addressable by `RICH_BLOCK_ID` after editing.
 */
async function getPlanMarkdown(
  page: Page,
  planId: string,
  blockId = RICH_BLOCK_ID,
) {
  const res = await page.request.get(
    `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as {
    content?: {
      blocks?: Array<{
        id: string;
        type: string;
        data?: { markdown?: string };
      }>;
    };
  };
  const block = plan.content?.blocks?.find((b) => b.id === blockId);
  return block?.data?.markdown ?? null;
}

/**
 * Locate the editable ProseMirror surface for the single plan document. The whole
 * plan body is one editor; the contenteditable surface is `.an-rich-md-prose`
 * inside the `.plan-document-editor-surface` wrapper.
 */
function proseFor(page: Page) {
  return page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
}

/** Open the plan and wait for the editable single-document surface to be ready. */
async function openPlanForEditing(page: Page, planId: string) {
  await page.goto(`/plans/${planId}`);
  const prose = proseFor(page);
  await expect(prose).toBeVisible({ timeout: 25_000 });
  // The editor must actually be editable (contenteditable). If review mode or a
  // read-only path were active, this would fail and surface that as a bug. The
  // single-doc editor is client-only (no Tiptap on SSR), so it swaps in after
  // hydration — the web-first retry below absorbs that mount delay.
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
  return prose;
}

/** Place the caret at the end of the prose and type literal text. */
async function typeAtEnd(
  page: Page,
  prose: ReturnType<typeof proseFor>,
  text: string,
) {
  await prose.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text, { delay: 12 });
}

/**
 * Live record of every `update-visual-plan` autosave POST status. Attach BEFORE
 * editing. Used to detect the autosave self-race precisely: a healthy editor must
 * never emit a 5xx while a single user types a sentence.
 */
type SaveWatch = { statuses: number[] };
function watchSaves(page: Page): SaveWatch {
  const watch: SaveWatch = { statuses: [] };
  page.on("response", (r) => {
    if (r.url().includes(UPDATE_ACTION) && r.request().method() === "POST") {
      watch.statuses.push(r.status());
    }
  });
  return watch;
}

/**
 * Pin the REAL APP BUG precisely. The single-document editor (PlanDocumentEditor)
 * fires ONE un-debounced, un-serialized `replace-blocks` POST per keystroke.
 * Server-side, each `update-visual-plan` content-patch request loads the plan's
 * current `updatedAt` (`versionAtLoad`) then writes guarded by
 * `WHERE updatedAt = versionAtLoad` — an optimistic lock
 * (actions/update-visual-plan.ts ~L446). When a later keystroke's POST is in
 * flight while an earlier one commits and bumps `updatedAt`, the later request
 * matches 0 rows and throws "Plan changed while content patches were being
 * applied." → HTTP 500 (see /tmp/plandev6.log). At any realistic typing speed the
 * saves overlap (each save takes ~0.4–1.4s; verified char-by-char-with-wait stays
 * 200, but a typed word/sentence reliably 5xx's and LOSES the tail of the edit).
 * The old per-block editor debounced 700ms so saves rarely overlapped; the new
 * single-doc editor races itself. Fix belongs in APP CODE (debounce / serialize /
 * retry the single-doc autosave, or relax the lock for same-author sequential
 * saves) — NOT in this spec.
 */
function assertNoSaveRace(watch: SaveWatch) {
  const fiveXX = watch.statuses.filter((s) => s >= 500);
  expect(
    fiveXX,
    `autosave self-race: ${fiveXX.length}/${watch.statuses.length} replace-blocks POSTs returned 5xx while typing a single edit (un-debounced single-doc editor overlaps its own saves against the optimistic lock; this also LOSES the trailing edit). statuses=[${watch.statuses.join(",")}]. REAL APP BUG — see actions/update-visual-plan.ts L446 + /tmp/plandev6.log.`,
  ).toEqual([]);
}

test.describe("single-document rich-text editing + autosave", () => {
  // Deterministic API-level proof of the autosave contract, independent of the
  // editor's per-keystroke timing. This is the EXACT request the single-doc editor
  // fires on every change (op: replace-blocks). A single, non-overlapping save MUST
  // return 200 — proving the write itself is sound (it is NOT the old better-sqlite3
  // async-transaction 500; that path now runs sequentially with a leading
  // optimistic-lock UPDATE).
  test("autosave save (replace-blocks patch) returns 200, not 500", async ({
    page,
  }) => {
    const title = uniqueTitle("api-save");
    const planId = await createPlanFixture(page, richTextContent({ title }));

    const res = await page.request.post(UPDATE_ACTION, {
      data: {
        planId,
        contentPatches: [
          {
            op: "replace-blocks",
            blocks: [
              {
                id: RICH_BLOCK_ID,
                type: "rich-text",
                data: {
                  markdown: "Seed paragraph that we will edit. EDITED-via-api",
                },
              },
            ],
          },
        ],
      },
    });
    const status = res.status();
    const bodyText = await res.text().catch(() => "");
    expect(
      status,
      `update-visual-plan replace-blocks autosave returned ${status}. A 500 here is a broken save contract. Body: ${bodyText.slice(0, 600)}`,
    ).toBe(200);

    // And the edit actually persisted (block id is preserved across the patch).
    await expect
      .poll(async () => await getPlanMarkdown(page, planId), {
        timeout: 15_000,
      })
      .toContain("EDITED-via-api");
  });

  test("happy path: type → optimistic render → autosave 200 → persists after reload", async ({
    page,
  }) => {
    const title = uniqueTitle("happy");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);
    const saves = watchSaves(page);

    const typed = ` EDITED-${Date.now()}`;

    await typeAtEnd(page, prose, typed);

    // (1) Optimistic render: the typed text appears in the prose immediately,
    // without waiting for the network round-trip.
    await expect(prose).toContainText(typed.trim(), { timeout: 5_000 });

    // Let the per-keystroke autosaves settle.
    await page.waitForTimeout(2500);

    // (2) Autosave must not 5xx while typing one short edit. (Currently fails —
    // pins the autosave self-race; see assertNoSaveRace.)
    expect(
      saves.statuses.length,
      "at least one autosave fired",
    ).toBeGreaterThan(0);
    assertNoSaveRace(saves);

    // (3) After a hard reload, the typed text persists exactly. After reload the
    // editor re-mounts; assert on the editable surface.
    await page.reload();
    const proseAfter = proseFor(page);
    await expect(proseAfter).toBeVisible({ timeout: 25_000 });
    await expect(proseAfter).toContainText(typed.trim(), { timeout: 15_000 });

    // And the server-of-record agrees: the stored markdown contains the edit.
    await expect
      .poll(async () => await getPlanMarkdown(page, planId), {
        timeout: 15_000,
      })
      .toContain(typed.trim());
  });

  test("autosave POST never 500s while typing several words", async ({
    page,
  }) => {
    const title = uniqueTitle("no500");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);
    const saves = watchSaves(page);

    // Type a few words at a realistic human cadence — exactly what a reviewer does
    // editing a plan. A correct editor must autosave this without ever 5xx'ing.
    for (let i = 0; i < 3; i += 1) {
      await typeAtEnd(page, prose, ` chunk${i}`);
    }
    // Let the per-keystroke autosaves settle.
    await page.waitForTimeout(3000);

    expect(
      saves.statuses.length,
      "at least one autosave fired",
    ).toBeGreaterThan(0);
    // CORE CONTRACT (currently fails — pins the autosave self-race).
    assertNoSaveRace(saves);
  });

  test("rapid successive edits autosave without 5xx and the final text wins", async ({
    page,
  }) => {
    const title = uniqueTitle("rapid");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);
    const saves = watchSaves(page);

    // Type many characters fast. The single-doc editor has NO client debounce, so
    // this fires roughly one POST per keystroke (verified: ~13 POSTs for a ~17-char
    // burst). A correct editor must still autosave without 5xx and persist the
    // final coalesced text.
    await prose.click();
    await page.keyboard.press("Control+End");
    const burst = " RAPIDoneTWOthreeFOURfiveSIX";
    await page.keyboard.type(burst, { delay: 8 });

    // Let the trailing keystroke saves flush.
    await page.waitForTimeout(3000);

    expect(
      saves.statuses.length,
      "at least one autosave fired",
    ).toBeGreaterThan(0);

    // CORE CONTRACT — a rapid burst must not produce 5xx autosaves. Currently FAILS
    // and pins the REAL APP BUG (see assertNoSaveRace): observed e.g. 16/24 saves
    // 5xx'ing, which also drops the trailing text so the persistence check below
    // can fail too.
    assertNoSaveRace(saves);

    // The final text must be the one persisted (last-writer-wins on the surviving
    // save). Asserted after the race check so the failure points at the root cause.
    await expect
      .poll(async () => await getPlanMarkdown(page, planId), {
        timeout: 15_000,
      })
      .toContain("RAPIDoneTWOthreeFOURfiveSIX");
  });

  test("markdown shortcuts: **bold**, # heading, and - list serialize back to markdown", async ({
    page,
  }) => {
    const title = uniqueTitle("md-shortcuts");
    const planId = await createPlanFixture(
      page,
      richTextContent({ title, markdown: "intro line" }),
    );
    const prose = await openPlanForEditing(page, planId);
    const saves = watchSaves(page);

    await prose.click();
    await page.keyboard.press("Control+End");

    // New line, then a heading shortcut: "# " at line start → H1.
    await page.keyboard.press("Enter");
    await page.keyboard.type("# Heading Shortcut", { delay: 10 });
    await page.keyboard.press("Enter");

    // Bold shortcut via **...**.
    await page.keyboard.type("This is **boldword** here", { delay: 10 });
    await page.keyboard.press("Enter");

    // Bullet list shortcut: "- " at line start.
    await page.keyboard.type("- first bullet", { delay: 10 });

    // The shortcuts convert client-side (verified: # → H1, **x** → strong, - →
    // list all apply), so the DOM proof holds immediately. Assert it first — it is
    // independent of the buggy autosave.
    await expect(
      proseFor(page).locator("h1, h2").filter({ hasText: "Heading Shortcut" }),
    ).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(3000);
    // The autosave that should persist these shortcuts must not 5xx. Currently
    // FAILS (autosave self-race) — and because every keystroke's save races, the
    // shortcuts frequently never reach SQL (the persistence assertions below then
    // fail too). Lead with the race check so the failure names the root cause.
    assertNoSaveRace(saves);

    // The persisted markdown must reflect the shortcuts as real markdown syntax,
    // not literal asterisks/hashes left inline. The whole contiguous prose run is
    // ONE rich-text block (id preserved), so its markdown carries all three.
    await expect
      .poll(async () => await getPlanMarkdown(page, planId), {
        timeout: 15_000,
      })
      .toMatch(/(^|\n)#\s+Heading Shortcut/);
    const md = (await getPlanMarkdown(page, planId)) ?? "";
    expect(md, `markdown was: ${md}`).toMatch(/\*\*boldword\*\*/);
    expect(md, `markdown was: ${md}`).toMatch(/(^|\n)[-*]\s+first bullet/);
  });

  test("special chars, emoji, and unicode round-trip exactly", async ({
    page,
  }) => {
    const title = uniqueTitle("unicode");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);
    const saves = watchSaves(page);

    // Mix of emoji, accents, CJK, RTL, and markdown-significant punctuation that
    // should be preserved verbatim (escaping is fine as long as it round-trips
    // to the same visible text).
    const exotic = " café 日本語 🚀✅ — naïve <not-a-tag> 50% & more";

    await typeAtEnd(page, prose, exotic);
    // Optimistic render confirms the editor accepted the unicode verbatim.
    await expect(prose).toContainText("café 日本語 🚀✅", { timeout: 5_000 });

    await page.waitForTimeout(3000);
    // The autosave persisting this must not 5xx. Currently FAILS (autosave
    // self-race) — and the race also truncates the saved text mid-edit, so the
    // round-trip assertions below fail too. Lead with the race check.
    expect(
      saves.statuses.length,
      "at least one autosave fired",
    ).toBeGreaterThan(0);
    assertNoSaveRace(saves);

    await page.reload();
    const proseAfter = proseFor(page);
    await expect(proseAfter).toBeVisible({ timeout: 25_000 });
    // Emoji + CJK + accents survive the round-trip and re-render.
    await expect(proseAfter).toContainText("café 日本語 🚀✅", {
      timeout: 15_000,
    });
    await expect(proseAfter).toContainText("naïve", { timeout: 10_000 });
    await expect(proseAfter).toContainText("50% & more", { timeout: 10_000 });
  });

  test("very large paragraph autosaves with a 200 and persists", async ({
    page,
  }) => {
    const title = uniqueTitle("large");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);

    // ~8KB of text. Insert via clipboard paste so we do not spend minutes typing,
    // while still exercising the same onChange → replace-blocks autosave path.
    const marker = `BIGPARA-${Date.now()}`;
    const big = `${marker} ` + "lorem ipsum dolor sit amet ".repeat(300);
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text).catch(() => {});
    }, big);

    const okSavePromise = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 25_000 },
    );
    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    // Paste via keyboard shortcut; fall back to direct typing of the marker if
    // clipboard is unavailable in the runner.
    await page.keyboard.press("ControlOrMeta+V");
    // Ensure at least the marker is present even if paste was blocked.
    await expect(async () => {
      const text = await prose.innerText();
      expect(text).toContain(marker);
    })
      .toPass({ timeout: 8_000 })
      .catch(async () => {
        await page.keyboard.type(`${marker} fallback large body`, { delay: 4 });
      });

    const saveRes = await okSavePromise;
    expect(
      saveRes.status(),
      `large-paragraph autosave status ${saveRes.status()} — at least one save must be 200`,
    ).toBe(200);

    await expect
      .poll(async () => await getPlanMarkdown(page, planId), {
        timeout: 20_000,
      })
      .toContain(marker);
  });

  test("edit then immediately navigate away → the in-flight edit still persists (unmount flush)", async ({
    page,
  }) => {
    const title = uniqueTitle("nav-away");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);

    const marker = ` FLUSH-${Date.now()}`;
    await typeAtEnd(page, prose, marker);
    // Optimistic render confirms the edit registered locally.
    await expect(prose).toContainText(marker.trim(), { timeout: 5_000 });

    // Navigate away to the plan list almost immediately — the single-doc editor's
    // per-keystroke save (in flight or just-committed) must still land.
    //
    // This must be a CLIENT-SIDE (soft) route change, exactly like the real app:
    // the plan reader is immersive (Layout hides the sidebar on /plans/:id), so a
    // user leaves via an in-app React Router navigation, not a full reload. A hard
    // `page.goto('/plans')` would tear the whole document down and abort an
    // in-flight save fetch — a browser-teardown artifact, not the editor's
    // behavior. We drive React Router's browser history (pushState + popstate) so
    // the page/network context stays alive while the PlanDocumentEditor for this
    // plan unmounts.
    await page.evaluate(() => {
      window.history.pushState({}, "", "/plans");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    // The editor for this plan must have unmounted (we are now on the list).
    await expect(page.locator(".plan-document-editor-surface")).toHaveCount(0, {
      timeout: 15_000,
    });

    // The edit should have persisted. Poll the server-of-record.
    await expect
      .poll(async () => await getPlanMarkdown(page, planId), {
        timeout: 20_000,
      })
      .toContain(marker.trim());

    // And re-opening the plan shows the persisted text.
    await page.goto(`/plans/${planId}`);
    const proseAfter = proseFor(page);
    await expect(proseAfter).toBeVisible({ timeout: 25_000 });
    await expect(proseAfter).toContainText(marker.trim(), { timeout: 15_000 });
  });

  test("no stray legacy `doc` field is written alongside markdown", async ({
    page,
  }) => {
    const title = uniqueTitle("no-doc");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);

    const okSavePromise = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await typeAtEnd(page, prose, " legacy-doc-check");
    await okSavePromise;

    const res = await page.request.get(
      `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(planId)}`,
    );
    expect(
      res.ok(),
      `get-visual-plan ok (status ${res.status()})`,
    ).toBeTruthy();
    const body = await readJson(res);
    const plan = (body.plan ?? body) as {
      content?: {
        blocks?: Array<{
          id: string;
          type: string;
          data?: Record<string, unknown>;
        }>;
      };
    };
    // The block id is preserved across single-doc edits, so the seed block is
    // still found by id. (Even if a re-derived id appeared, we assert on the rich
    // text block.)
    const block =
      plan.content?.blocks?.find((b) => b.id === RICH_BLOCK_ID) ??
      plan.content?.blocks?.find((b) => b.type === "rich-text");
    expect(block, "rich-text block present after save").toBeTruthy();
    // markdown is the single source of truth. The serializer NEVER stores a
    // ProseMirror/Tiptap `doc` in block data — only `{ markdown }`.
    expect(
      Object.keys(block?.data ?? {}),
      `rich-text data keys: ${JSON.stringify(block?.data)}`,
    ).toEqual(["markdown"]);
    expect((block?.data as { doc?: unknown }).doc).toBeUndefined();
  });
});
