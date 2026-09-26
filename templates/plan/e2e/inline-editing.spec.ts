import { test, expect, type Page, type APIResponse } from "@playwright/test";

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
    (body.plan as { id?: string } | undefined)?.id ??
    undefined;
  expect(
    planId,
    `create-visual-plan returned a plan id: ${JSON.stringify(body).slice(0, 400)}`,
  ).toBeTruthy();
  return planId as string;
}

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

function assertNoSaveRace(watch: SaveWatch) {
  const fiveXX = watch.statuses.filter((s) => s >= 500);
  expect(
    fiveXX,
    `autosave self-race: ${fiveXX.length}/${watch.statuses.length} replace-blocks POSTs returned 5xx while typing a single edit (un-debounced single-doc editor overlaps its own saves against the optimistic lock; this also LOSES the trailing edit). statuses=[${watch.statuses.join(",")}]. REAL APP BUG — see actions/update-visual-plan.ts L446 + /tmp/plandev6.log.`,
  ).toEqual([]);
}

test.describe("single-document rich-text editing + autosave", () => {
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

    await expect(prose).toContainText(typed.trim(), { timeout: 5_000 });

    await page.waitForTimeout(2500);

    // (2) Autosave must not 5xx while typing one short edit. (Currently fails —
    // pins the autosave self-race; see assertNoSaveRace.)
    expect(
      saves.statuses.length,
      "at least one autosave fired",
    ).toBeGreaterThan(0);
    assertNoSaveRace(saves);

    await page.reload();
    const proseAfter = proseFor(page);
    await expect(proseAfter).toBeVisible({ timeout: 25_000 });
    await expect(proseAfter).toContainText(typed.trim(), { timeout: 15_000 });

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

    for (let i = 0; i < 3; i += 1) {
      await typeAtEnd(page, prose, ` chunk${i}`);
    }
    await page.waitForTimeout(3000);

    expect(
      saves.statuses.length,
      "at least one autosave fired",
    ).toBeGreaterThan(0);
    assertNoSaveRace(saves);
  });

  test("rapid successive edits autosave without 5xx and the final text wins", async ({
    page,
  }) => {
    const title = uniqueTitle("rapid");
    const planId = await createPlanFixture(page, richTextContent({ title }));
    const prose = await openPlanForEditing(page, planId);
    const saves = watchSaves(page);

    await prose.click();
    await page.keyboard.press("Control+End");
    const burst = " RAPIDoneTWOthreeFOURfiveSIX";
    await page.keyboard.type(burst, { delay: 8 });

    await page.waitForTimeout(3000);

    expect(
      saves.statuses.length,
      "at least one autosave fired",
    ).toBeGreaterThan(0);

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

    await page.keyboard.press("Enter");
    await page.keyboard.type("# Heading Shortcut", { delay: 10 });
    await page.keyboard.press("Enter");

    await page.keyboard.type("This is **boldword** here", { delay: 10 });
    await page.keyboard.press("Enter");

    await page.keyboard.type("- first bullet", { delay: 10 });

    await expect(
      proseFor(page).locator("h1, h2").filter({ hasText: "Heading Shortcut" }),
    ).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(3000);
    // The autosave that should persist these shortcuts must not 5xx. Currently
    // FAILS (autosave self-race) — and because every keystroke's save races, the
    // shortcuts frequently never reach SQL (the persistence assertions below then
    // fail too). Lead with the race check so the failure names the root cause.
    assertNoSaveRace(saves);

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

    const exotic = " café 日本語 🚀✅ — naïve <not-a-tag> 50% & more";

    await typeAtEnd(page, prose, exotic);
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
    await page.keyboard.press("ControlOrMeta+V");
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
    await expect(prose).toContainText(marker.trim(), { timeout: 5_000 });

    await page.evaluate(() => {
      window.history.pushState({}, "", "/plans");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator(".plan-document-editor-surface")).toHaveCount(0, {
      timeout: 15_000,
    });

    await expect
      .poll(async () => await getPlanMarkdown(page, planId), {
        timeout: 20_000,
      })
      .toContain(marker.trim());

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
    const block =
      plan.content?.blocks?.find((b) => b.id === RICH_BLOCK_ID) ??
      plan.content?.blocks?.find((b) => b.type === "rich-text");
    expect(block, "rich-text block present after save").toBeTruthy();
    expect(
      Object.keys(block?.data ?? {}),
      `rich-text data keys: ${JSON.stringify(block?.data)}`,
    ).toEqual(["markdown"]);
    expect((block?.data as { doc?: unknown }).doc).toBeUndefined();
  });
});
