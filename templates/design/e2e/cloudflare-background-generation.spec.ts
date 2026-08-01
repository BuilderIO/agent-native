import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Product-level proof that a full design generation on a Cloudflare Worker runs
 * on the durable background budget instead of the foreground clamp.
 *
 * READ THIS BEFORE WEAKENING ANY ASSERTION. The circuit breaker recovers an
 * unclaimed background run by executing it inline, so a completely unimplemented
 * Cloudflare adapter still finishes a design and still renders it on the canvas.
 * The canvas assertion on its own is therefore forgeable and passes on the
 * inline fallback. Only the conjunction of the three assertions in this one test
 * means anything:
 *
 *   1. dispatch mode — `background-processing` is written by the atomic claim in
 *      `run-store.ts` and by nothing else, so it proves a queue consumer
 *      invocation actually took the run.
 *   2. wall time — the turn outlives the foreground soft-timeout clamp, which is
 *      impossible for an inline run.
 *   3. canvas — the generated design is really there, so 1 and 2 are not
 *      measuring a run that produced nothing.
 *
 * Splitting these into separate tests, or dropping one, restores the exact
 * silent-degradation this suite exists to catch.
 *
 * The target is an externally-managed `wrangler dev` session (see
 * `Local Worker bring-up` in the framework deployment docs) plus an
 * Anthropic-compatible endpoint the Worker can reach. Opt in with:
 *
 *   E2E_CLOUDFLARE_WORKER=1 \
 *   E2E_BASE_URL=http://127.0.0.1:8788 \
 *   E2E_NO_DIRECT_DB=1 \
 *     pnpm e2e cloudflare-background-generation
 */

/**
 * `HOSTED_SOFT_TIMEOUT_CEILING_MS` in `packages/core/src/agent/run-manager.ts`.
 * A foreground hosted run is clamped to this, so a turn that runs longer cannot
 * have been a foreground run. Duplicated rather than imported because the
 * constant sits behind no public package export; if run-manager's value changes,
 * change it here in the same commit or this assertion silently gets weaker.
 */
const FOREGROUND_SOFT_TIMEOUT_CLAMP_MS = 40_000;

/** A full generation is many sequential tool calls against a real model. */
const GENERATION_BUDGET_MS = 20 * 60_000;

/** No active run for this long after the turn started means the turn is over. */
const RUN_SETTLE_MS = 20_000;

/**
 * QUALIFIED PROOF — read before removing the second sentence.
 *
 * `contextModeOverride: "off"` is a supported `generate-design` parameter, not a
 * test hack, but it is load-bearing here: creative context resolution reaches
 * `@agent-native/creative-context`, whose stores use interactive transactions
 * that D1 cannot run (`Failed query: begin`), so with context on, generation
 * fails on a Worker no matter how healthy the background path is. Filed as #14.
 * Until that lands, this proof covers the background path with creative context
 * disabled, and says so.
 */
const PROMPT =
  "Generate a complete landing page for Northwind Ferries, a coastal " +
  "passenger ferry service. Include a hero with a booking call to action, a " +
  "routes section, a fares table, and a footer. Make it visually polished. " +
  'Pass contextModeOverride: "off" when you call generate-design.';

function baseUrl(): string {
  const url = process.env.E2E_BASE_URL;
  if (!url) {
    // Silently falling back to the suite's own dev server would run this spec
    // against a Node host that can never reach the Cloudflare queue — and the
    // circuit breaker would then hand it a passing canvas.
    throw new Error(
      "E2E_CLOUDFLARE_WORKER=1 requires E2E_BASE_URL pointing at a running " +
        "wrangler dev session. Without it this spec would assert the " +
        "background path against a host that has none.",
    );
  }
  return url.replace(/\/$/, "");
}

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseUrl()}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getJson(request: APIRequestContext, path: string) {
  const response = await request.get(`${baseUrl()}${path}`);
  if (!response.ok()) {
    throw new Error(
      `GET ${path} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

interface ActiveRun {
  active?: boolean;
  runId?: string;
  status?: string;
  dispatchMode?: string | null;
  terminalReason?: string | null;
  diagStage?: string | null;
  workerStage?: string | null;
}

async function listThreadIds(request: APIRequestContext): Promise<string[]> {
  const body = await getJson(request, "/_agent-native/agent-chat/threads");
  const threads = Array.isArray(body?.threads) ? body.threads : [];
  return threads
    .map((thread: { id?: unknown }) => thread?.id)
    .filter((id: unknown): id is string => typeof id === "string");
}

async function readActiveRun(
  request: APIRequestContext,
  threadId: string,
): Promise<ActiveRun> {
  return getJson(
    request,
    `/_agent-native/agent-chat/runs/active?threadId=${encodeURIComponent(threadId)}`,
  );
}

/** Open the agent sidebar if it is collapsed and return the composer input. */
async function openComposer(page: Page) {
  const composer = page
    .locator('[data-agent-composer-slot="editor-input"]')
    .first();
  if (!(await composer.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Agent", exact: true })
      .first()
      .click();
  }
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  return composer;
}

test.describe("Cloudflare durable background generation", () => {
  test.skip(
    process.env.E2E_CLOUDFLARE_WORKER !== "1",
    "Needs an externally-managed wrangler dev session and a reachable model " +
      "endpoint; set E2E_CLOUDFLARE_WORKER=1 and E2E_BASE_URL to run it.",
  );

  test("a full design generation finishes on canvas via the background path", async ({
    page,
    request,
  }) => {
    test.setTimeout(GENERATION_BUDGET_MS + 5 * 60_000);

    const created = await postAction(request, "create-design", {
      title: `Cloudflare background generation ${Date.now()}`,
      projectType: "prototype",
    });
    const designId: string | undefined =
      created?.id ?? created?.data?.id ?? created?.design?.id;
    expect(designId, "create-design returned no id").toBeTruthy();

    const threadsBefore = new Set(await listThreadIds(request));

    await page.goto(`${baseUrl()}/design/${designId}`, {
      waitUntil: "domcontentloaded",
    });
    const composer = await openComposer(page);
    await composer.click();
    await composer.fill(PROMPT);

    const startedAt = Date.now();
    await composer.press("Enter");

    // ── Watch the turn ────────────────────────────────────────────────────
    // Record every dispatch mode the run reports, and the moment the thread
    // went quiet. Both are read from the server's own run record, not from
    // anything the client could have inferred.
    const dispatchModes = new Set<string>();
    const terminalReasons = new Set<string>();
    let threadId: string | null = null;
    let lastActiveAt = startedAt;
    let finishedAt: number | null = null;

    while (Date.now() - startedAt < GENERATION_BUDGET_MS) {
      if (!threadId) {
        const ids = await listThreadIds(request);
        threadId = ids.find((id) => !threadsBefore.has(id)) ?? ids[0] ?? null;
      }
      if (threadId) {
        const run = await readActiveRun(request, threadId);
        if (run.dispatchMode) dispatchModes.add(run.dispatchMode);
        if (run.terminalReason) terminalReasons.add(run.terminalReason);
        const running =
          run.active === true &&
          run.status !== "completed" &&
          run.status !== "failed" &&
          run.status !== "aborted";
        if (running) {
          lastActiveAt = Date.now();
          finishedAt = null;
        } else if (finishedAt === null) {
          finishedAt = Date.now();
        }
        if (finishedAt !== null && Date.now() - lastActiveAt > RUN_SETTLE_MS) {
          break;
        }
      }
      await page.waitForTimeout(2_000);
    }

    expect(
      threadId,
      "no agent-chat thread was created for the turn",
    ).toBeTruthy();
    expect(
      finishedAt,
      `the turn never went quiet within ${GENERATION_BUDGET_MS}ms ` +
        `(dispatch modes seen: ${[...dispatchModes].join(", ") || "none"})`,
    ).not.toBeNull();
    expect(
      [...terminalReasons].filter((reason) => reason !== "done"),
      "the run ended on a non-'done' terminal reason",
    ).toEqual([]);

    const wallTimeMs = (finishedAt ?? Date.now()) - startedAt;

    // ── Assertion 1: a background worker actually claimed the run ─────────
    // `background-processing` is written only by `claimBackgroundRun`'s atomic
    // UPDATE, which runs inside the queue consumer invocation. An inline
    // circuit-breaker recovery leaves the row on `background`.
    //
    // Deliberately satisfied by ANY run observed for this turn across the whole
    // poll, not by the mode at one instant: a long turn produces more than one
    // run row for the same turn, and `/runs/active` answers with SQL's newest
    // row rather than the claimed one, so a single sample can report
    // `background` while a worker is demonstrably running the turn (issue #13).
    // This widening cannot forge the assertion — the inline path never writes
    // `background-processing` at all — and it should be tightened when #13 lands.
    //
    // KNOWN TO FAIL HERE TODAY, and the failure is #13 rather than the
    // background path. On the 2026-08-02 proof run the turn's executing run
    // (`_debugRuns` on the thread names it) carried
    // `dispatch_mode = background-processing` in the run record for its whole
    // life, while `/runs/active` reported `background` on every poll because a
    // second, never-claimed continuation row for the same turn is newer. No
    // endpoint exposes an arbitrary run's dispatch mode, so this assertion
    // cannot be satisfied from a browser until #13 lands. It is left in place
    // deliberately: dropping it would leave the wall-time and canvas assertions
    // alone, and that pair is exactly the forgeable one this file exists to
    // refuse.
    expect(
      [...dispatchModes],
      "the run never reached the background-processing dispatch mode, so no " +
        "queue consumer claimed it — this is the silent degrade to an inline run",
    ).toContain("background-processing");

    // ── Assertion 2: the foreground clamp did not apply ───────────────────
    expect(
      wallTimeMs,
      `the turn finished in ${wallTimeMs}ms, inside the ` +
        `${FOREGROUND_SOFT_TIMEOUT_CLAMP_MS}ms foreground clamp — a run this ` +
        "short proves nothing about the durable budget",
    ).toBeGreaterThan(FOREGROUND_SOFT_TIMEOUT_CLAMP_MS);

    // ── Assertion 3: a real design landed on the canvas ───────────────────
    const files = await getJson(
      request,
      `/_agent-native/actions/list-files?designId=${encodeURIComponent(String(designId))}`,
    );
    const fileList: Array<{ filename?: string }> = Array.isArray(files)
      ? files
      : (files?.files ?? []);
    expect(
      fileList.length,
      "the generation produced no design files",
    ).toBeGreaterThan(0);

    await page.goto(`${baseUrl()}/design/${designId}`, {
      waitUntil: "domcontentloaded",
    });
    const previewIframe = page
      .locator("iframe[data-design-preview-iframe]")
      .first();
    await expect(previewIframe).toBeVisible({ timeout: 60_000 });

    // The canvas renders the design inside a sandboxed iframe, so assert on the
    // frame's own DOM rather than the parent document.
    await expect
      .poll(
        async () => {
          const frame = await (
            await previewIframe.elementHandle()
          )
            ?.contentFrame()
            .catch(() => null);
          if (!frame) return 0;
          return frame
            .locator("body *")
            .count()
            .catch(() => 0);
        },
        {
          timeout: 60_000,
          message: "the generated design never rendered on the canvas",
        },
      )
      .toBeGreaterThan(20);

    // eslint-disable-next-line no-console
    console.log(
      `[e2e] background generation: wallTimeMs=${wallTimeMs} ` +
        `dispatchModes=${[...dispatchModes].join(",")} ` +
        `files=${fileList.length}`,
    );
  });
});
