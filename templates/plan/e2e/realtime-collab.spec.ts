import {
  test,
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { planE2eAuthStatePath } from "./auth-state";

function makeE2ePassword(label: string): string {
  return ["example", label, Date.now().toString(36), "pw"].join("-");
}

/*
 * REAL-TIME COLLAB — adversarial coverage for the SINGLE-DOCUMENT plan editor.
 *
 * Architecture under test (verified from the code + a live browser, 2026-06):
 *  - The whole plan body is ONE ProseMirror/Tiptap editor — `PlanDocumentEditor`,
 *    rendered as the wrapper `.plan-document-editor-surface` (contenteditable on a
 *    child). Custom blocks are inline `planBlock` NodeViews. Read-only / review /
 *    SSR keeps the per-block reader (`PlanMarkdownReader`) — no Tiptap server-side.
 *    `PlanContentRenderer` gates the editor on `SINGLE_DOC_EDITOR_ENABLED = true`.
 *
 *  - Cross-client propagation is NOT Yjs in this model. Inside
 *    `PlanDocumentEditor`, `SINGLE_DOC_COLLAB_ENABLED = false`, so `docId = null`,
 *    no Y.Doc / awareness is bound, and `SharedRichEditor` mounts a plain
 *    controlled `value`/`onChange` editor. Edits autosave (`update-visual-plan`
 *    `replace-blocks`) → SQL → the peer's `usePlan` poll (`refetchInterval: 3s`)
 *    refetches `get-visual-plan` → the `content.blocks` prop changes →
 *    `useCollabReconcile` applies it (non-collab reconcile). That is how an idle
 *    peer converges to a remote edit. Single-doc multi-user CRDT collab + live
 *    cursors are an intentional, documented fast-follow (full-fragment
 *    Y.XmlFragment rewrites tear down every React NodeView → flushSync storms),
 *    not a regression — see the rationale block in `PlanDocumentEditor.tsx`.
 *
 *  - The collab SERVER transport (`createCollabPlugin` in server/plugins/collab.ts)
 *    is still mounted and healthy. `resolvePlanIdFromCollabDocId` strips everything
 *    after the first `:`, so BOTH a single-doc `plan:<id>` docId and a legacy
 *    per-block `plan:<id>:<block>` docId resolve to the same plan for the access
 *    check. Reads (state/users/awareness) require VIEWER; writes
 *    (update/text/json/patch) require EDITOR; no session → 401. The real client
 *    sends the RAW docId (literal colons — never percent-encoded).
 *
 * These specs assert the CURRENT model's CORRECT behavior. A failing assertion is
 * a real bug. Where the new model deliberately differs from the old per-block Yjs
 * model (no live CRDT merge of simultaneous edits, no live cursors in the editable
 * surface), the spec asserts the new contract (convergence to ONE consistent value
 * with no duplication; the transport substrate stays reachable) and documents the
 * deferred collab — it does NOT assert behavior the model intentionally dropped.
 */

const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const GET_ACTION = "/_agent-native/actions/get-visual-plan";
const UPDATE_ACTION = "/_agent-native/actions/update-visual-plan";
const RICH_BLOCK_ID = "rt-collab";
const STATE_FILE = planE2eAuthStatePath();

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

function uniqueTitle(label: string): string {
  return `Collab ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function richTextContent(
  title: string,
  markdown = "Seed line for collab.",
): PlanContentInput {
  return {
    version: 2,
    title,
    brief: "Adversarial real-time collaboration fixture.",
    blocks: [
      {
        id: RICH_BLOCK_ID,
        type: "rich-text",
        title: "Shared notes",
        editable: true,
        data: { markdown },
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

async function createPlan(
  page: Page,
  content: PlanContentInput,
): Promise<string> {
  const res = await page.request.post(CREATE_ACTION, {
    data: { title: content.title, brief: content.brief, content },
  });
  expect(
    res.ok(),
    `create-visual-plan should succeed (status ${res.status()}): ${await res
      .text()
      .catch(() => "")}`,
  ).toBeTruthy();
  const body = await readJson(res);
  const planId =
    (body.planId as string | undefined) ??
    (body.plan as { id?: string } | undefined)?.id;
  expect(planId, `create-visual-plan returned a plan id`).toBeTruthy();
  return planId as string;
}

/** Fetch persisted markdown for the collab block (separates sync vs autosave). */
async function persistedMarkdown(
  page: Page,
  planId: string,
): Promise<string | null> {
  // get-visual-plan is a GET action — id is a query param, not a POST body.
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  if (!res.ok()) return null;
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
  return (
    plan.content?.blocks?.find((b) => b.id === RICH_BLOCK_ID)?.data?.markdown ??
    null
  );
}

/**
 * The single-document editor surface. `PlanContentRenderer` renders the whole
 * body as ONE editor whose wrapper carries `.plan-document-editor-surface`
 * (the contenteditable element is a child; `.click()`, `.innerText()`, and
 * `toContainText` all operate on the wrapper subtree).
 */
function surface(page: Page) {
  return page.locator(".plan-document-editor-surface").first();
}

/**
 * Build a collab route URL exactly the way the real client does — RAW docId with
 * literal colons. `useCollaborativeDoc` does NOT `encodeURIComponent` the docId;
 * percent-encoding the colons turns `plan:` into `plan%3A`, so
 * `resolvePlanIdFromCollabDocId` returns null and the route 404s (a TEST bug, not
 * an app bug). This helper mirrors the production transport.
 */
function collabUrl(docId: string, action: string): string {
  return `/_agent-native/collab/${docId}/${action}`;
}

/** Open a plan and wait for the single-doc editor to mount + seed. */
async function openEditable(page: Page, planId: string, seedText: string) {
  await page.goto(`/plans/${planId}`);
  const ed = surface(page);
  await expect(
    ed,
    "the single-document plan editor surface should render",
  ).toBeVisible({ timeout: 25_000 });
  // The seed text confirms the editor has materialized real content (not the
  // pre-seed empty doc) before we start typing / asserting.
  await expect(
    ed,
    "the editor should seed with the plan's existing content",
  ).toContainText(seedText, { timeout: 20_000 });
  // The wrapper subtree must contain an editable surface.
  await expect(
    ed.locator('[contenteditable="true"]').first(),
    "the document editor should be editable (not stuck read-only)",
  ).toBeVisible({ timeout: 15_000 });
  return ed;
}

async function typeAtEnd(
  page: Page,
  ed: ReturnType<typeof surface>,
  text: string,
) {
  await ed.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text, { delay: 14 });
}

/**
 * KNOWN BUG WORKAROUND (see the dedicated "edit fidelity" test below). The
 * single-doc autosave/reconcile cycle intermittently drops the LAST 1-2
 * characters of freshly-typed text (the non-byte-identical `blocks[]↔doc`
 * round-trip races the autosave echo). The propagation / convergence tests are
 * about whether an edit reaches the other client AT ALL, not about byte-perfect
 * round-trip — so they type the token followed by a throwaway `ZZZ` sentinel and
 * assert only on the stable token. The sentinel absorbs any tail truncation so a
 * sync test never flakes on the orthogonal char-loss bug. The fidelity test
 * deliberately does NOT do this and pins the truncation directly.
 */
const TAIL_SENTINEL = "ZZZ";
async function typeTokenAtEnd(
  page: Page,
  ed: ReturnType<typeof surface>,
  token: string,
) {
  await typeAtEnd(page, ed, ` ${token}${TAIL_SENTINEL}`);
}

/**
 * Settle a local edit: blur the editor so the focus-guard in `useCollabReconcile`
 * stops deferring external reconciles, and give autosave + the peer's 3s poll
 * cycles room. (External content is dropped/deferred while the editor is focused
 * and a keystroke landed within ~1.5s; an idle/blurred peer converges.)
 */
async function settle(page: Page) {
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
}

/** Register a fresh second user same-origin (passes Better Auth origin check). */
async function registerSecondUser(
  page: Page,
): Promise<{ email: string; password: string }> {
  const email = `plan-collab-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@plan.test`;
  const password = makeE2ePassword("collab");
  await page.goto("/");
  await page.waitForTimeout(800);
  const out = await page.evaluate(
    async ({ email, password }) => {
      const post = (path: string, body: unknown) =>
        fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (r) => ({ ok: r.ok, status: r.status }));
      const reg = await post("/_agent-native/auth/register", {
        email,
        password,
        name: "Collab Two",
        callbackURL: "/plans",
      });
      const login = await post("/_agent-native/auth/login", {
        email,
        password,
      });
      const sess = await fetch("/_agent-native/auth/session", {
        headers: { Accept: "application/json" },
      })
        .then((r) => r.json())
        .catch(() => ({}));
      return { reg, login, sessionEmail: (sess as { email?: string })?.email };
    },
    { email, password },
  );
  expect(
    out.sessionEmail,
    `second user should be authenticated: ${JSON.stringify(out)}`,
  ).toBe(email);
  return { email, password };
}

/** Make a plan public so a guest can read it (best-effort across action names). */
async function makePublic(page: Page, planId: string): Promise<boolean> {
  for (const action of [
    "set-resource-visibility",
    "set-plan-visibility",
    "publish-visual-plan",
    "update-visual-plan",
  ]) {
    const data =
      action === "update-visual-plan" || action === "publish-visual-plan"
        ? { planId, visibility: "public" }
        : {
            resourceType: "plan",
            resourceId: planId,
            planId,
            visibility: "public",
          };
    const res = await page.request.post(`/_agent-native/actions/${action}`, {
      data,
    });
    if (res.ok()) return true;
  }
  return false;
}

/** Share a plan with another user as editor (best-effort across action names). */
async function shareWith(
  page: Page,
  planId: string,
  email: string,
  role: "viewer" | "editor",
): Promise<boolean> {
  for (const action of ["share-resource", "share-visual-plan"]) {
    const res = await page.request.post(`/_agent-native/actions/${action}`, {
      data: {
        resourceType: "plan",
        resourceId: planId,
        planId,
        principalType: "user",
        principalId: email,
        email,
        role,
      },
    });
    if (res.ok()) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 0. Root-cause anchor — the collab transport must be reachable for the OWNER */
/* -------------------------------------------------------------------------- */

test("collab transport: owner can reach state/users/awareness for both docId shapes", async ({
  page,
}) => {
  // The transport substrate must stay healthy even though the editable surface
  // doesn't bind a Y.Doc today: it gates viewer/editor access and is what live
  // cursors will ride once single-doc collab is re-enabled. This isolates a
  // server/access regression away from any editor-binding behavior. Both the
  // single-doc docId (`plan:<id>`) and the legacy per-block docId
  // (`plan:<id>:<block>`) must resolve to the same plan for the owner.
  const planId = await createPlan(
    page,
    richTextContent(uniqueTitle("Owner Transport")),
  );
  await openEditable(page, planId, "Seed line for collab.");

  const singleDoc = `plan:${planId}`;
  const perBlock = `plan:${planId}:${RICH_BLOCK_ID}`;

  const get = (url: string) =>
    page.evaluate(async (u) => (await fetch(u)).status, url);
  const postAwareness = (url: string) =>
    page.evaluate(
      async (u) =>
        (
          await fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: 99,
              state: JSON.stringify({
                user: { name: "Owner", email: "o@x.y", color: "#fff" },
              }),
            }),
          })
        ).status,
      url,
    );

  for (const docId of [singleDoc, perBlock]) {
    expect(
      await get(collabUrl(docId, "state")),
      `GET collab/state for the OWNER must grant viewer access for ${docId} ` +
        `(404/403 means resolveAccess returns null for the resource owner — collab transport dead).`,
    ).toBe(200);
    expect(
      await get(collabUrl(docId, "users")),
      `GET collab/users for the owner must be reachable for ${docId}`,
    ).toBe(200);
    expect(
      await postAwareness(collabUrl(docId, "awareness")),
      `POST collab/awareness for the owner must be allowed for ${docId}`,
    ).toBe(200);
  }
});

/* -------------------------------------------------------------------------- */
/* 0b. Edit fidelity — single client, byte-perfect round-trip of typed text    */
/* -------------------------------------------------------------------------- */

test("edit fidelity: a single client's typed text round-trips byte-perfect to the editor AND to SQL", async ({
  browser,
}) => {
  // REGRESSION GUARD for the prosemirror-collab-serializer single-doc refactor.
  // ONE client, no collaboration involved. After typing a known phrase and
  // pausing (so the autosave→poll→reconcile cycle runs), the editor and the
  // persisted markdown must BOTH contain the full phrase. They currently DO NOT
  // intermittently: the non-byte-identical `blocks[] → doc → blocks[]` round-trip
  // (`PlanDocumentEditor` getMarkdown/setContent) races the autosave echo, and a
  // reconcile re-applies a slightly-stale `value`, truncating the LAST 1-2
  // characters of freshly-typed text — sometimes only in SQL, sometimes rewriting
  // the live editor backwards on screen. Reproduced single-client and in
  // inline-editing.spec.ts (`EDITED-…485` → `EDITED-17`). A failure here is a real
  // data-loss bug in the single-doc editor, NOT a collab/transport issue; fix the
  // reconcile race (or make the blocks↔doc round-trip byte-stable) in app code.
  const ctx = await browser.newContext({ storageState: STATE_FILE });
  const page = await ctx.newPage();
  try {
    const planId = await createPlan(
      page,
      richTextContent(uniqueTitle("Edit Fidelity"), "Seed."),
    );
    const ed = await openEditable(page, planId, "Seed.");
    await page.waitForTimeout(2_000);

    // The truncation is intermittent (~1 in 2-4 typing bursts loses the tail), so
    // a SINGLE burst would flake under `retries: 2`. Run several distinct bursts,
    // each followed by a settle + autosave/reconcile window, and require EVERY
    // burst's full phrase to survive in BOTH the editor and SQL. With multiple
    // bursts a clean pass is improbable unless the round-trip is genuinely fixed,
    // so this stays a dependable regression signal rather than a coin-flip.
    const failures: string[] = [];
    for (let i = 0; i < 4; i++) {
      const phrase = `FIDELITY-${i}-${Date.now() % 1_000_000}-END`;
      await typeAtEnd(page, ed, ` ${phrase}`);
      // Pause WITHOUT typing so autosave + reconcile cycles run over the new text.
      await settle(page);
      await page.waitForTimeout(4_000);

      const editorText = (await ed.innerText()).replace(/\s+/g, " ").trim();
      const persisted = (await persistedMarkdown(page, planId)) ?? "";
      if (!editorText.includes(phrase)) {
        failures.push(
          `editor dropped tail of "${phrase}": got "${editorText}"`,
        );
      }
      if (!persisted.includes(phrase)) {
        failures.push(`SQL dropped tail of "${phrase}": got "${persisted}"`);
      }
    }

    expect(
      failures,
      `freshly-typed text must round-trip byte-perfect to the editor AND SQL. ` +
        `The single-doc autosave/reconcile cycle is dropping trailing characters ` +
        `(non-byte-identical blocks[]↔doc round-trip racing the autosave echo):\n` +
        failures.join("\n"),
    ).toEqual([]);
  } finally {
    await ctx.close();
  }
});

/* -------------------------------------------------------------------------- */
/* 1. Live sync: an edit in A appears in an idle B within a few seconds        */
/* -------------------------------------------------------------------------- */

test("live sync: an edit in context A appears in context B within a few seconds", async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ storageState: STATE_FILE });
  const ctxB = await browser.newContext({ storageState: STATE_FILE });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  try {
    const planId = await createPlan(
      pageA,
      richTextContent(uniqueTitle("Live Sync")),
    );
    const edA = await openEditable(pageA, planId, "Seed line for collab.");
    const edB = await openEditable(pageB, planId, "Seed line for collab.");

    // Let both editors finish their initial mount + seed so this asserts LIVE
    // post-mount propagation, not the initial-state load.
    await pageA.waitForTimeout(2_000);

    const marker = `SYNC${Date.now() % 1_000_000}`;
    await typeTokenAtEnd(pageA, edA, marker);
    await expect(
      edA,
      "A should reflect its own keystrokes immediately",
    ).toContainText(marker, { timeout: 8_000 });
    // Blur A so its edit settles into autosave; keep B idle so its reconcile is
    // never blocked by the focus-guard.
    await settle(pageA);

    // First confirm A's edit actually reached SQL (separates a render-only sync
    // from an autosave 500, AND decouples B's convergence from A's autosave
    // debounce racing the final keystroke — the marker must be fully persisted
    // before we expect B's poll to carry it).
    await expect
      .poll(async () => persistedMarkdown(pageA, planId), {
        timeout: 20_000,
        message: "A's edit must persist via the replace-blocks autosave path",
      })
      .toEqual(expect.stringContaining(marker));

    // The whole point of live propagation: an idle B converges to A's edit. In
    // the single-doc model this rides autosave → SQL → B's 3s poll → non-collab
    // reconcile, so allow a generous window (a few poll cycles).
    await expect(
      edB,
      "context B must converge to context A's edit. If this never lands once the " +
        "edit is persisted, the poll→reconcile path (the single-doc model's sync) " +
        "is broken: B's poll didn't refetch, or useCollabReconcile didn't adopt " +
        "the changed content prop after mount.",
    ).toContainText(marker, { timeout: 30_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

/* -------------------------------------------------------------------------- */
/* 2. Concurrent edits: clients converge to ONE consistent value, no dup       */
/* -------------------------------------------------------------------------- */

test("concurrent edits: near-simultaneous typing converges to one consistent, non-duplicated value", async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ storageState: STATE_FILE });
  const ctxB = await browser.newContext({ storageState: STATE_FILE });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  try {
    const planId = await createPlan(
      pageA,
      richTextContent(uniqueTitle("Concurrent Merge"), "BASE"),
    );
    const edA = await openEditable(pageA, planId, "BASE");
    const edB = await openEditable(pageB, planId, "BASE");
    await pageA.waitForTimeout(2_000);

    const tokenA = `AAA${Date.now() % 100000}`;
    const tokenB = `BBB${Date.now() % 100000}`;

    // Fire both edits as close to simultaneously as the harness allows. The
    // sentinel suffix absorbs the orthogonal tail-truncation bug so this test
    // only judges convergence/duplication, not byte-perfect round-trip.
    await Promise.all([
      typeTokenAtEnd(pageA, edA, tokenA),
      typeTokenAtEnd(pageB, edB, tokenB),
    ]);
    await settle(pageA);
    await settle(pageB);

    // Let the autosave + poll path settle (a few cycles).
    await pageA.waitForTimeout(10_000);

    const textA = (await edA.innerText()).replace(/\s+/g, " ").trim();
    const textB = (await edB.innerText()).replace(/\s+/g, " ").trim();

    // CURRENT-MODEL CONTRACT: both clients must converge to the SAME content.
    // (Single-doc collab is OFF, so cross-client merge is last-write-wins on the
    // whole blocks[] JSON via autosave+poll — NOT a Yjs CRDT merge. We therefore
    // do NOT assert that BOTH tokens survive; near-simultaneous edits to the same
    // block are expected to clobber one writer until single-doc Yjs lands. We DO
    // require eventual convergence to a single consistent value with no
    // duplication — the property the non-collab reconcile must still guarantee.)
    await expect
      .poll(
        async () => {
          const a = (await edA.innerText()).replace(/\s+/g, " ").trim();
          const b = (await edB.innerText()).replace(/\s+/g, " ").trim();
          return a === b;
        },
        {
          timeout: 15_000,
          message: `clients must eventually converge to one consistent value.\nA="${textA}"\nB="${textB}"`,
        },
      )
      .toBe(true);

    const converged = (await edA.innerText()).replace(/\s+/g, " ").trim();

    // At least one writer's token must survive (no total data loss).
    expect(
      converged.includes(tokenA) || converged.includes(tokenB),
      `at least one concurrent edit must survive: "${converged}"`,
    ).toBeTruthy();

    // No DUPLICATION: whichever token(s) survive must appear exactly once each
    // (the reconcile must never insert the same region twice).
    for (const token of [tokenA, tokenB]) {
      const count = (converged.match(new RegExp(token, "g")) || []).length;
      expect(
        count,
        `token ${token} must not be duplicated by the reconcile: "${converged}"`,
      ).toBeLessThanOrEqual(1);
    }

    // The surviving writer's token persists to SQL (separates a live bug from an
    // autosave 500). Whichever token won convergence must be the one stored.
    const survivingToken = converged.includes(tokenA) ? tokenA : tokenB;
    await expect
      .poll(async () => persistedMarkdown(pageA, planId), {
        timeout: 15_000,
        message: "the converged content must persist via autosave",
      })
      .toEqual(expect.stringContaining(survivingToken));
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

/* -------------------------------------------------------------------------- */
/* 3. Presence: transport substrate is reachable; live cursors are deferred    */
/* -------------------------------------------------------------------------- */

test("presence: awareness transport is reachable for both editors; live cursors are deferred in the single-doc surface", async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ storageState: STATE_FILE });
  const pageA = await ctxA.newPage();
  // Second user so any presence would be a DIFFERENT identity (own cursor hidden).
  const ctxB = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const pageB = await ctxB.newPage();
  try {
    const planId = await createPlan(
      pageA,
      richTextContent(uniqueTitle("Presence")),
    );
    const second = await registerSecondUser(pageB);
    expect(
      await shareWith(pageA, planId, second.email, "editor"),
      "sharing the plan with the second user as editor should succeed",
    ).toBeTruthy();

    const edA = await openEditable(pageA, planId, "Seed line for collab.");
    const edB = await openEditable(pageB, planId, "Seed line for collab.");
    await edA.click();
    await pageA.keyboard.press("Control+End");
    await edB.click();
    await pageB.keyboard.press("Control+End");
    await pageA.waitForTimeout(5_000);

    // The awareness SUBSTRATE must be reachable for both an editor and a viewer —
    // this is what live cursors will ride once single-doc collab is re-enabled.
    const docId = `plan:${planId}:${RICH_BLOCK_ID}`;
    const awarenessStatus = await pageA.evaluate(
      async (url) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: 1234,
            state: JSON.stringify({
              user: { name: "A", email: "a@x.y", color: "#fff" },
            }),
          }),
        });
        return r.status;
      },
      collabUrl(docId, "awareness"),
    );
    expect(
      awarenessStatus,
      "the awareness transport must accept a present editor's state",
    ).toBe(200);

    // CURRENT MODEL: the editable single-doc surface binds NO Y.Doc/awareness
    // (SINGLE_DOC_COLLAB_ENABLED = false), so live collaboration cursors are
    // intentionally NOT rendered yet. Assert that contract precisely so this spec
    // tracks the real model; flip to a positive cursor assertion when single-doc
    // multi-user collab lands (the deferred fast-follow).
    const cursorsInA = await pageA
      .locator("[class*='collaboration-cursor']")
      .count();
    expect(
      cursorsInA,
      "live collaboration cursors are deferred in the single-doc editor today; " +
        "if cursors appear here, single-doc collab was re-enabled — update this " +
        "assertion to require the remote cursor to appear and then clear on leave.",
    ).toBe(0);
  } finally {
    await ctxA.close();
    await ctxB.close().catch(() => {});
  }
});

/* -------------------------------------------------------------------------- */
/* 4. Public/signed-out viewer: can SEE content but CANNOT mutate              */
/* -------------------------------------------------------------------------- */

test("guest viewer: a signed-out viewer of a public plan sees content but write routes are blocked", async ({
  browser,
}) => {
  const ownerCtx = await browser.newContext({ storageState: STATE_FILE });
  const ownerPage = await ownerCtx.newPage();
  const guestCtx: BrowserContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const guestPage = await guestCtx.newPage();
  try {
    const planId = await createPlan(
      ownerPage,
      richTextContent(uniqueTitle("Public Guest"), "PUBLIC_CONTENT_TOKEN"),
    );

    expect(
      await makePublic(ownerPage, planId),
      "owner should be able to make the plan public for guest viewing",
    ).toBeTruthy();

    // Guest can SEE the content (public read path renders the read-only block —
    // PlanMarkdownReader, no Tiptap mount).
    await guestPage.goto(`/plans/${planId}`);
    await expect(
      guestPage.getByText("PUBLIC_CONTENT_TOKEN", { exact: false }).first(),
      "a signed-out viewer of a public plan must be able to read its content",
    ).toBeVisible({ timeout: 25_000 });

    // Guest CANNOT mutate via collab write routes — no session → 401 (the auth
    // gate fires before docId resolution). Use the RAW docId (literal colons).
    const docId = `plan:${planId}:${RICH_BLOCK_ID}`;
    const guestUpdate = await guestPage.request.post(
      collabUrl(docId, "update"),
      { data: { update: "AAAA" } },
    );
    expect(
      [401, 403].includes(guestUpdate.status()),
      `guest collab UPDATE must be rejected (got ${guestUpdate.status()})`,
    ).toBeTruthy();

    const guestAwareness = await guestPage.request.post(
      collabUrl(docId, "awareness"),
      {
        data: {
          clientId: 7,
          state: JSON.stringify({
            user: { name: "Hacker", email: "h@x.y", color: "#000" },
          }),
        },
      },
    );
    expect(
      [401, 403].includes(guestAwareness.status()),
      `guest collab AWARENESS write must be rejected (got ${guestAwareness.status()})`,
    ).toBeTruthy();

    // Guest CANNOT mutate via the action surface either.
    const guestPatch = await guestPage.request.post(UPDATE_ACTION, {
      data: {
        planId,
        contentPatches: [
          {
            op: "update-rich-text",
            blockId: RICH_BLOCK_ID,
            markdown: "HACKED",
          },
        ],
      },
    });
    expect(
      [401, 403].includes(guestPatch.status()),
      `guest update-visual-plan must be rejected (got ${guestPatch.status()})`,
    ).toBeTruthy();

    // And the content was NOT mutated.
    const afterGuestWrites = await persistedMarkdown(ownerPage, planId);
    expect(
      afterGuestWrites,
      "owner should still be able to read their plan",
    ).not.toBeNull();
    expect(
      afterGuestWrites ?? "",
      "guest write attempts must not have changed the persisted content",
    ).not.toContain("HACKED");
  } finally {
    await ownerCtx.close();
    await guestCtx.close();
  }
});

/* -------------------------------------------------------------------------- */
/* 5. EDGE: interleaved edits still converge to one consistent value           */
/* -------------------------------------------------------------------------- */

test("edge — interleaved edits: clients converge to one consistent value with no duplication", async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ storageState: STATE_FILE });
  const ctxB = await browser.newContext({ storageState: STATE_FILE });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  try {
    const planId = await createPlan(
      pageA,
      richTextContent(uniqueTitle("Interleaved"), "MID"),
    );
    const edA = await openEditable(pageA, planId, "MID");
    const edB = await openEditable(pageB, planId, "MID");
    await pageA.waitForTimeout(2_000);

    // B starts an edit, A interleaves, B continues — then both settle. Each
    // side's LAST-typed text carries the throwaway sentinel so tail truncation
    // (the orthogonal char-loss bug) can't make this convergence test flake.
    await edB.click();
    await pageB.keyboard.press("Control+End");
    await pageB.keyboard.type(" BHEAD", { delay: 20 });
    await typeAtEnd(pageA, edA, ` AHEAD${TAIL_SENTINEL}`);
    await pageB.keyboard.type(`_BTAIL${TAIL_SENTINEL}`, { delay: 20 });
    await settle(pageA);
    await settle(pageB);

    // Eventual convergence to one consistent value (last-write-wins on the whole
    // blocks[] JSON — single-doc collab is OFF, so we assert convergence + no
    // duplication, NOT Yjs no-loss of all interleaved fragments).
    await expect
      .poll(
        async () => {
          const a = (await edA.innerText()).replace(/\s+/g, " ").trim();
          const b = (await edB.innerText()).replace(/\s+/g, " ").trim();
          return a === b;
        },
        {
          timeout: 20_000,
          message: "clients must converge after interleaved edits",
        },
      )
      .toBe(true);

    const converged = (await edA.innerText()).replace(/\s+/g, " ").trim();
    // No duplication of any surviving token.
    for (const token of ["AHEAD", "BHEAD", "BTAIL"]) {
      const count = (converged.match(new RegExp(token, "g")) || []).length;
      expect(
        count,
        `token ${token} must not be duplicated: "${converged}"`,
      ).toBeLessThanOrEqual(1);
    }
    // At least one writer's contribution survives.
    expect(
      /AHEAD|BHEAD|BTAIL/.test(converged),
      `at least one interleaved edit must survive: "${converged}"`,
    ).toBeTruthy();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

/* -------------------------------------------------------------------------- */
/* 6. EDGE: background one tab, edit from the other, refocus → convergence     */
/* -------------------------------------------------------------------------- */

test("edge — backgrounded tab: edit from the foreground tab converges after the other refocuses", async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ storageState: STATE_FILE });
  const ctxB = await browser.newContext({ storageState: STATE_FILE });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  try {
    const planId = await createPlan(
      pageA,
      richTextContent(uniqueTitle("Background Refocus")),
    );
    const edA = await openEditable(pageA, planId, "Seed line for collab.");
    const edB = await openEditable(pageB, planId, "Seed line for collab.");
    await pageA.waitForTimeout(1_500);

    // Background tab B (the plan query pauses while hidden; reconcile resumes on
    // refocus). Spoof the visibility API the hook reads.
    await pageB.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const marker = `BG${Date.now() % 1_000_000}`;
    await typeTokenAtEnd(pageA, edA, marker);
    await expect(edA).toContainText(marker, { timeout: 8_000 });
    await settle(pageA);

    // Confirm A's edit is fully persisted before relying on B catching up (so the
    // assertion isn't racing A's autosave debounce against the final keystroke).
    await expect
      .poll(async () => persistedMarkdown(pageA, planId), {
        timeout: 20_000,
        message: "A's edit must persist while B is backgrounded",
      })
      .toEqual(expect.stringContaining(marker));

    // While hidden, B may legitimately lag. Bring B back to the foreground.
    await pageB.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await pageB.bringToFront();

    // After refocus, B must catch up and converge with A (eventual convergence).
    await expect(
      edB,
      "after a backgrounded tab refocuses, it must catch up to edits made meanwhile",
    ).toContainText(marker, { timeout: 30_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
