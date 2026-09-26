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

async function persistedMarkdown(
  page: Page,
  planId: string,
): Promise<string | null> {
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

function surface(page: Page) {
  return page.locator(".plan-document-editor-surface").first();
}

function collabUrl(docId: string, action: string): string {
  return `/_agent-native/collab/${docId}/${action}`;
}

async function openEditable(page: Page, planId: string, seedText: string) {
  await page.goto(`/plans/${planId}`);
  const ed = surface(page);
  await expect(
    ed,
    "the single-document plan editor surface should render",
  ).toBeVisible({ timeout: 25_000 });
  await expect(
    ed,
    "the editor should seed with the plan's existing content",
  ).toContainText(seedText, { timeout: 20_000 });
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

async function settle(page: Page) {
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
}

async function registerSecondUser(
  page: Page,
): Promise<{ email: string; password: string }> {
  const email = `plan-collab+autoz-${Date.now()}-${Math.floor(
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


test("collab transport: owner can reach state/users/awareness for both docId shapes", async ({
  page,
}) => {
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


test("edit fidelity: a single client's typed text round-trips byte-perfect to the editor AND to SQL", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ storageState: STATE_FILE });
  const page = await ctx.newPage();
  try {
    const planId = await createPlan(
      page,
      richTextContent(uniqueTitle("Edit Fidelity"), "Seed."),
    );
    const ed = await openEditable(page, planId, "Seed.");
    await page.waitForTimeout(2_000);

    const failures: string[] = [];
    for (let i = 0; i < 4; i++) {
      const phrase = `FIDELITY-${i}-${Date.now() % 1_000_000}-END`;
      await typeAtEnd(page, ed, ` ${phrase}`);
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

    await pageA.waitForTimeout(2_000);

    const marker = `SYNC${Date.now() % 1_000_000}`;
    await typeTokenAtEnd(pageA, edA, marker);
    await expect(
      edA,
      "A should reflect its own keystrokes immediately",
    ).toContainText(marker, { timeout: 8_000 });
    await settle(pageA);

    await expect
      .poll(async () => persistedMarkdown(pageA, planId), {
        timeout: 20_000,
        message: "A's edit must persist via the replace-blocks autosave path",
      })
      .toEqual(expect.stringContaining(marker));

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

    await Promise.all([
      typeTokenAtEnd(pageA, edA, tokenA),
      typeTokenAtEnd(pageB, edB, tokenB),
    ]);
    await settle(pageA);
    await settle(pageB);

    await pageA.waitForTimeout(10_000);

    const textA = (await edA.innerText()).replace(/\s+/g, " ").trim();
    const textB = (await edB.innerText()).replace(/\s+/g, " ").trim();

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
    for (const token of [tokenA, tokenB]) {
      const count = (converged.match(new RegExp(token, "g")) || []).length;
      expect(
        count,
        `token ${token} must not be duplicated by the reconcile: "${converged}"`,
      ).toBeLessThanOrEqual(1);
    }

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


test("presence: awareness transport is reachable and a remote editor's live cursor renders in the single-doc surface", async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ storageState: STATE_FILE });
  const pageA = await ctxA.newPage();
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
    await pageB.keyboard.type(" here");
    await pageA.waitForTimeout(5_000);

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

    await expect(
      pageA.locator(".collaboration-carets__caret").first(),
      "the remote editor's live collaboration cursor must render for a peer " +
        "editing the same single-doc plan",
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await ctxA.close();
    await ctxB.close().catch(() => {});
  }
});


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

    await guestPage.goto(`/plans/${planId}`);
    await expect(
      guestPage.getByText("PUBLIC_CONTENT_TOKEN", { exact: false }).first(),
      "a signed-out viewer of a public plan must be able to read its content",
    ).toBeVisible({ timeout: 25_000 });

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

    await edB.click();
    await pageB.keyboard.press("Control+End");
    await pageB.keyboard.type(" BHEAD", { delay: 20 });
    await typeAtEnd(pageA, edA, ` AHEAD${TAIL_SENTINEL}`);
    await pageB.keyboard.type(`_BTAIL${TAIL_SENTINEL}`, { delay: 20 });
    await settle(pageA);
    await settle(pageB);

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
    for (const token of ["AHEAD", "BHEAD", "BTAIL"]) {
      const count = (converged.match(new RegExp(token, "g")) || []).length;
      expect(
        count,
        `token ${token} must not be duplicated: "${converged}"`,
      ).toBeLessThanOrEqual(1);
    }
    expect(
      /AHEAD|BHEAD|BTAIL/.test(converged),
      `at least one interleaved edit must survive: "${converged}"`,
    ).toBeTruthy();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});


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

    await expect
      .poll(async () => persistedMarkdown(pageA, planId), {
        timeout: 20_000,
        message: "A's edit must persist while B is backgrounded",
      })
      .toEqual(expect.stringContaining(marker));

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

    await expect(
      edB,
      "after a backgrounded tab refocuses, it must catch up to edits made meanwhile",
    ).toContainText(marker, { timeout: 30_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
