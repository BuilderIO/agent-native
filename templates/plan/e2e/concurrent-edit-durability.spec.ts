import {
  test,
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

import { planE2eAuthStatePath } from "./auth-state";

// Two distinct signed-in users edit one shared plan at the same time. Every
// edit either user makes must reach SQL and survive a reload for both of them.

const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const GET_ACTION = "/_agent-native/actions/get-visual-plan";
const STATE_FILE = planE2eAuthStatePath();

const ALPHA = "alpha";
const BRAVO = "bravo";

// Adjacent rich-text blocks fuse into one document run, so fixtures separate
// them with a structured block, as real plans do.
type SeedBlock = { id: string; markdown: string; type?: "callout" };

function uniqueTitle(label: string): string {
  return `Durable ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function readJson(res: APIResponse): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function createPlan(page: Page, blocks: SeedBlock[]): Promise<string> {
  const title = uniqueTitle("plan");
  const content = {
    version: 2,
    title,
    brief: "Concurrent edit durability fixture.",
    blocks: blocks.map((block) =>
      block.type === "callout"
        ? {
            id: block.id,
            type: "callout",
            data: { tone: "info", body: block.markdown },
          }
        : {
            id: block.id,
            type: "rich-text",
            editable: true,
            data: { markdown: block.markdown },
          },
    ),
  };
  const res = await page.request.post(CREATE_ACTION, {
    data: { title, brief: content.brief, content },
  });
  expect(res.ok(), `create-visual-plan: ${await res.text()}`).toBeTruthy();
  const body = await readJson(res);
  const planId =
    (body.planId as string | undefined) ??
    (body.plan as { id?: string } | undefined)?.id;
  expect(planId).toBeTruthy();
  return planId as string;
}

async function persistedBlocks(
  page: Page,
  planId: string,
): Promise<Array<{ id: string; markdown: string }>> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan: ${res.status()}`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as {
    content?: {
      blocks?: Array<{
        id: string;
        data?: { markdown?: string; body?: string };
      }>;
    };
  };
  return (plan.content?.blocks ?? []).map((block) => ({
    id: block.id,
    markdown: block.data?.markdown ?? block.data?.body ?? "",
  }));
}

async function persistedText(page: Page, planId: string): Promise<string> {
  return (await persistedBlocks(page, planId))
    .map((block) => block.markdown)
    .join("\n");
}

function surface(page: Page) {
  return page.locator(".plan-document-editor-surface").first();
}

async function editorText(page: Page): Promise<string> {
  return (await surface(page).innerText()).replace(/\s+/g, " ").trim();
}

async function openEditable(page: Page, planId: string, seedText: string) {
  await page.goto(`/plans/${planId}`);
  const ed = surface(page);
  await expect(ed).toBeVisible({ timeout: 25_000 });
  await expect(ed).toContainText(seedText, { timeout: 20_000 });
  await expect(ed.locator('[contenteditable="true"]').first()).toBeVisible({
    timeout: 15_000,
  });
  return ed;
}

async function typeAtEndOf(page: Page, anchorText: string, text: string) {
  const line = surface(page).getByText(anchorText, { exact: false }).first();
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: 14 });
}

async function registerUser(
  page: Page,
  label: string,
): Promise<{ email: string }> {
  const email = `plan-${label}+autoz-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@plan.test`;
  const password = ["example", label, Date.now().toString(36), "pw"].join("-");
  await page.goto("/");
  await page.waitForTimeout(800);
  const sessionEmail = await page.evaluate(
    async ({ email, password }) => {
      const post = (path: string, body: unknown) =>
        fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      await post("/_agent-native/auth/register", {
        email,
        password,
        name: "Collab Two",
        callbackURL: "/plans",
      });
      await post("/_agent-native/auth/login", { email, password });
      const session = await fetch("/_agent-native/auth/session", {
        headers: { Accept: "application/json" },
      })
        .then((r) => r.json())
        .catch(() => ({}));
      return (session as { email?: string }).email;
    },
    { email, password },
  );
  expect(sessionEmail, "second user should be signed in").toBe(email);
  return { email };
}

async function shareAsEditor(page: Page, planId: string, email: string) {
  // Sharing outside the organization needs approval, which over HTTP only the
  // signed-in app UI gives: a frontend call holding the UI capability.
  const origin = new URL(test.info().project.use.baseURL ?? page.url()).origin;
  await page.request.get("/_agent-native/ui-capability", {
    headers: { Origin: origin },
  });
  const res = await page.request.post("/_agent-native/actions/share-resource", {
    data: {
      resourceType: "plan",
      resourceId: planId,
      principalType: "user",
      principalId: email,
      role: "editor",
    },
    headers: { "X-Agent-Native-Frontend": "1", Origin: origin },
  });
  expect(res.ok(), `share-resource: ${await res.text()}`).toBeTruthy();
}

type Pair = {
  ctxA: BrowserContext;
  ctxB: BrowserContext;
  pageA: Page;
  pageB: Page;
  planId: string;
};

async function openPair(
  browser: Browser,
  blocks: SeedBlock[],
  seedText: string,
  { concurrentOpen = false }: { concurrentOpen?: boolean } = {},
): Promise<Pair> {
  const ctxA = await browser.newContext({ storageState: STATE_FILE });
  const ctxB = await browser.newContext();
  if (process.env.PLAN_E2E_REFUSE_EVENTS === "1") {
    // Serverless hosts answer the realtime stream with 204, leaving /poll as
    // the only channel between the two editors.
    for (const ctx of [ctxA, ctxB]) {
      await ctx.route("**/_agent-native/events**", (route) =>
        route.fulfill({ status: 204, body: "" }),
      );
    }
  }
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const planId = await createPlan(pageA, blocks);
  const second = await registerUser(pageB, "second");
  await shareAsEditor(pageA, planId, second.email);
  if (concurrentOpen) {
    // Hold both editors' first read of the live document until each has asked,
    // so both see it empty and both try to seed it, as two people opening the
    // plan in the same moment do. The plan's callouts have live documents of
    // their own, held the same way.
    const asked = new Map<string, { count: number; release: () => void }>();
    const bothAsked = new Map<string, Promise<void>>();
    const liveDocState = new RegExp(
      `/collab/plan(:|%3A)${planId}((:|%3A)[^/]+)?/state`,
    );
    for (const page of [pageA, pageB]) {
      await page.route(liveDocState, async (route) => {
        const doc = new URL(route.request().url()).pathname;
        let entry = asked.get(doc);
        if (!entry) {
          let release: () => void = () => {};
          bothAsked.set(
            doc,
            new Promise<void>((resolve) => {
              release = resolve;
            }),
          );
          entry = { count: 0, release };
          asked.set(doc, entry);
        }
        entry.count += 1;
        if (entry.count >= 2) entry.release();
        await Promise.race([
          bothAsked.get(doc),
          new Promise((resolve) => setTimeout(resolve, 15_000)),
        ]);
        await route.continue();
      });
    }
    await Promise.all([
      pageA.goto(`/plans/${planId}`),
      pageB.goto(`/plans/${planId}`),
    ]);
    for (const page of [pageA, pageB]) {
      await expect(surface(page)).toContainText(seedText, { timeout: 25_000 });
    }
  } else {
    await openEditable(pageA, planId, seedText);
    await openEditable(pageB, planId, seedText);
  }
  // Let both editors finish their initial collab handshake.
  await pageA.waitForTimeout(2_000); // e2e-harness-ignore: no signal marks both editors' collab handshake finished
  return { ctxA, ctxB, pageA, pageB, planId };
}

async function closePair(pair: Pair | undefined) {
  await pair?.ctxA.close().catch(() => {});
  await pair?.ctxB.close().catch(() => {});
}

async function expectEveryViewHas(pair: Pair, tokens: string[]) {
  const { pageA, pageB, planId } = pair;
  await expect
    .poll(
      async () => {
        const text = await persistedText(pageA, planId);
        return tokens.filter((token) => text.includes(token));
      },
      {
        timeout: 30_000,
        message: `SQL must hold every edit (${tokens.join(", ")})`,
      },
    )
    .toEqual(tokens);
  // Give a late, stale write the chance to overwrite what was just merged.
  await pageA.waitForTimeout(4_000); // e2e-harness-ignore: proving a late stale write never lands means waiting for one
  const persisted = await persistedText(pageA, planId);
  for (const token of tokens) {
    expect(occurrences(persisted, token), `${token} in SQL`).toBe(1);
  }
  for (const page of [pageA, pageB]) {
    await page.reload();
    await expect(surface(page)).toBeVisible({ timeout: 25_000 });
    for (const token of tokens) {
      await expect(
        surface(page),
        `after reload the editor must still show ${token}`,
      ).toContainText(token, { timeout: 20_000 });
      expect(
        occurrences(await editorText(page), token),
        `${token} in the reloaded editor`,
      ).toBe(1);
    }
  }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const TWO_BLOCKS: SeedBlock[] = [
  { id: ALPHA, markdown: "Alpha block seed." },
  { id: "divider", markdown: "Separator callout.", type: "callout" },
  { id: BRAVO, markdown: "Bravo block seed." },
];

test("concurrent edits to different blocks both reach SQL and survive reload", async ({
  browser,
}) => {
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, pageB } = pair;
    const tokenA = ` ALPHAEDIT${Date.now() % 100000}`;
    const tokenB = ` BRAVOEDIT${Date.now() % 100000}`;
    await Promise.all([
      typeAtEndOf(pageA, "Alpha block seed.", tokenA),
      typeAtEndOf(pageB, "Bravo block seed.", tokenB),
    ]);
    await expectEveryViewHas(pair, [tokenA.trim(), tokenB.trim()]);
  } finally {
    await closePair(pair);
  }
});

// Typing together in one block is what the live document is for, so saves that
// race there never ask anyone anything.
async function expectNoPrompt(pair: Pair) {
  await expect(pair.pageA.getByRole("alertdialog")).toHaveCount(0);
  await expect(pair.pageB.getByRole("alertdialog")).toHaveCount(0);
}

test("concurrent edits to the same block keep both users' text", async ({
  browser,
}) => {
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, pageB } = pair;
    const tokenA = ` SAMEA${Date.now() % 100000}`;
    const tokenB = ` SAMEB${Date.now() % 100000}`;
    await Promise.all([
      typeAtEndOf(pageA, "Alpha block seed.", tokenA),
      typeAtEndOf(pageB, "Alpha block seed.", tokenB),
    ]);
    await expectEveryViewHas(pair, [tokenA.trim(), tokenB.trim()]);
    await expectNoPrompt(pair);
  } finally {
    await closePair(pair);
  }
});

test("edits made offline by one user merge after reconnect", async ({
  browser,
}) => {
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, pageB, ctxB } = pair;
    const tokenA = ` ONLINEA${Date.now() % 100000}`;
    const tokenB = ` OFFLINEB${Date.now() % 100000}`;
    await ctxB.setOffline(true);
    await typeAtEndOf(pageB, "Bravo block seed.", tokenB);
    await typeAtEndOf(pageA, "Alpha block seed.", tokenA);
    await pageA.waitForTimeout(3_000); // e2e-harness-ignore: the offline window is the thing under test
    await ctxB.setOffline(false);
    await expectEveryViewHas(pair, [tokenA.trim(), tokenB.trim()]);
  } finally {
    await closePair(pair);
  }
});

test("an edit typed while the live document is unreachable for longer than the retries last is still saved", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, pageB, planId } = pair;
    let reachable = false;
    await pageB.route("**/_agent-native/collab/**/update", (route) =>
      reachable
        ? route.continue()
        : route.fulfill({ status: 503, body: "unavailable" }),
    );
    const token = `STALLED${Date.now() % 100000}`;
    await typeAtEndOf(pageB, "Bravo block seed.", ` ${token}`);
    // Five failed attempts take about 15 s, after which the autosave used to
    // stop and leave the edit unsaved until the next keystroke.
    await pageB.waitForTimeout(20_000); // e2e-harness-ignore: the outage must outlast the retries to prove they continue
    reachable = true;
    await expect
      .poll(() => persistedText(pageA, planId), { timeout: 60_000 })
      .toContain(token);
  } finally {
    await closePair(pair);
  }
});

test("an edit another writer saves to a different block while someone types is kept", async ({
  browser,
}) => {
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, pageB, planId } = pair;
    const typed = ` TYPED${Date.now() % 100000}`;
    const saved = `CALLOUTEDIT${Date.now() % 100000}`;
    // A write that does not go through the live document, as an agent's does.
    const otherWrite = pageB.request.post(
      "/_agent-native/actions/update-visual-plan",
      {
        data: {
          planId,
          contentPatches: [
            {
              op: "update-block",
              blockId: "divider",
              patch: { data: { tone: "info", body: saved } },
            },
          ],
        },
      },
    );
    await Promise.all([
      typeAtEndOf(pageA, "Alpha block seed.", typed),
      otherWrite.then(async (res) => {
        expect(res.ok(), `update-block: ${await res.text()}`).toBeTruthy();
      }),
    ]);
    await expectEveryViewHas(pair, [typed.trim(), saved]);
  } finally {
    await closePair(pair);
  }
});

// Types in a block while a write that doesn't go through the live document, as an
// agent's doesn't, changes the same block, so the prompt comes up.
async function overlapOnFirstBlock(
  page: Page,
  planId: string,
  {
    mine = ` MINE${Date.now() % 100000}`,
    theirs = `THEIRS${Date.now() % 100000}`,
  }: { mine?: string; theirs?: string } = {},
) {
  const seed = "Alpha block seed.";
  const otherWrite = page.request.post(
    "/_agent-native/actions/update-visual-plan",
    {
      data: {
        planId,
        contentPatches: [
          {
            op: "update-rich-text",
            blockId: TWO_BLOCKS[0].id,
            markdown: `${seed} ${theirs}`,
          },
        ],
      },
    },
  );
  await Promise.all([
    typeAtEndOf(page, seed, mine),
    otherWrite.then(async (res) => {
      expect(res.ok(), `update-rich-text: ${await res.text()}`).toBeTruthy();
    }),
  ]);
  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toContainText("Someone else changed this too", {
    timeout: 20_000,
  });
  return { mine: mine.trim(), theirs, prompt };
}

async function expectPersisted(
  page: Page,
  planId: string,
  { has, lacks }: { has: string; lacks: string },
) {
  await expect
    .poll(() => persistedText(page, planId), { timeout: 20_000 })
    .toContain(has);
  // The editor must not bring the version given up back with a later save.
  await page.waitForTimeout(2_500); // e2e-harness-ignore: it's a save that never comes that this rules out
  const text = await persistedText(page, planId);
  expect(text).toContain(has);
  expect(text).not.toContain(lacks);
  await expect(surface(page)).toContainText(has);
  await expect(surface(page)).not.toContainText(lacks);
}

test("choosing their version of a block both writers changed replaces mine, and stays", async ({
  page,
}) => {
  const planId = await createPlan(page, TWO_BLOCKS);
  await openEditable(page, planId, "Alpha block seed.");
  const { mine, theirs, prompt } = await overlapOnFirstBlock(page, planId);
  await prompt.getByRole("button", { name: "Use theirs" }).click();
  await expectPersisted(page, planId, { has: theirs, lacks: mine });
  await page.reload();
  await expect(surface(page)).toContainText(theirs, { timeout: 25_000 });
  await expect(surface(page)).not.toContainText(mine);
});

test("keeping my version of a block both writers changed saves it, and the other comes back on request", async ({
  page,
}) => {
  const planId = await createPlan(page, TWO_BLOCKS);
  await openEditable(page, planId, "Alpha block seed.");
  const { mine, theirs, prompt } = await overlapOnFirstBlock(page, planId);
  await prompt.getByRole("button", { name: "Keep mine" }).click();
  await expectPersisted(page, planId, { has: mine, lacks: theirs });
  await page
    .getByRole("button", { name: "Get the other version back" })
    .click();
  await expectPersisted(page, planId, { has: theirs, lacks: mine });
});

test("deleting what a merged save brought in stays deleted", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const planId = await createPlan(page, TWO_BLOCKS);
  await openEditable(page, planId, "Alpha block seed.");
  const stamp = Date.now() % 100000;
  const mine = `MINE${stamp}`;
  const theirs = `THEIRS${stamp}`;
  let heldSaves = 0;
  let releaseMySave = () => {};
  const mySaveReleased = new Promise<void>((resolve) => {
    releaseMySave = resolve;
  });
  // My save waits for the other write, so it merges with what that brought in.
  await page.route(
    "**/_agent-native/actions/update-visual-plan",
    async (route) => {
      heldSaves += 1;
      await mySaveReleased;
      await route.continue().catch(() => {});
    },
  );
  await typeAtEndOf(page, "Alpha block seed.", ` ${mine}`);
  await expect.poll(() => heldSaves, { timeout: 20_000 }).toBeGreaterThan(0);
  const otherWrite = await page.request.post(
    "/_agent-native/actions/update-visual-plan",
    {
      data: {
        planId,
        contentPatches: [
          {
            op: "update-rich-text",
            blockId: BRAVO,
            markdown: `Bravo block seed. ${theirs}`,
          },
        ],
      },
    },
  );
  expect(otherWrite.ok(), await otherWrite.text()).toBeTruthy();
  releaseMySave();
  await expect
    .poll(() => persistedText(page, planId), { timeout: 20_000 })
    .toContain(mine);
  await expect(surface(page)).toContainText(theirs, { timeout: 20_000 });
  await page.waitForTimeout(2_000); // e2e-harness-ignore: nothing marks the document taking the merged save in
  await surface(page).getByText(theirs).click();
  await page.keyboard.press("End");
  for (let i = 0; i <= theirs.length; i += 1) {
    await page.keyboard.press("Backspace");
  }
  await expectPersisted(page, planId, { has: mine, lacks: theirs });
});

test("typing over what a merged save brought in asks instead of overwriting it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const planId = await createPlan(page, TWO_BLOCKS);
  await openEditable(page, planId, "Alpha block seed.");
  const stamp = Date.now() % 100000;
  const mine = `MINE${stamp}`;
  const theirs = `THEIRS${stamp}`;
  const more = `MORE${stamp}`;
  let releaseReads = () => {};
  const readsReleased = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  let heldSaves = 0;
  let releaseSaves = () => {};
  const savesReleased = new Promise<void>((resolve) => {
    releaseSaves = resolve;
  });
  // The document can't see the other write until my save has merged with it.
  await page.route(`**${GET_ACTION}*`, async (route) => {
    const response = await route.fetch();
    await readsReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.route(
    "**/_agent-native/actions/update-visual-plan",
    async (route) => {
      heldSaves += 1;
      await savesReleased;
      await route.continue().catch(() => {});
    },
  );
  await typeAtEndOf(page, "Alpha block seed.", ` ${mine}`);
  await expect.poll(() => heldSaves, { timeout: 20_000 }).toBeGreaterThan(0);
  const otherWrite = await page.request.post(
    "/_agent-native/actions/update-visual-plan",
    {
      data: {
        planId,
        contentPatches: [
          {
            op: "update-rich-text",
            blockId: BRAVO,
            markdown: `Bravo block seed. ${theirs}`,
          },
        ],
      },
    },
  );
  expect(otherWrite.ok(), await otherWrite.text()).toBeTruthy();
  await typeAtEndOf(page, "Bravo block seed.", ` ${more}`);
  releaseSaves();
  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toContainText("Someone else changed this too", {
    timeout: 20_000,
  });
  releaseReads();
  await prompt.getByRole("button", { name: "Use theirs" }).click();
  await expectPersisted(page, planId, { has: theirs, lacks: more });
  expect(await persistedText(page, planId)).toContain(mine);
});

test("saving twice more before the document has what a merged save brought in keeps it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const planId = await createPlan(page, TWO_BLOCKS);
  await openEditable(page, planId, "Alpha block seed.");
  const stamp = Date.now() % 100000;
  const mine = `MINE${stamp}`;
  const theirs = `THEIRS${stamp}`;
  const second = `SECOND${stamp}`;
  const third = `THIRD${stamp}`;
  let releaseReads = () => {};
  const readsReleased = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  let heldSaves = 0;
  let releaseSaves = () => {};
  const savesReleased = new Promise<void>((resolve) => {
    releaseSaves = resolve;
  });
  // The document can't see the other write through any of these saves.
  await page.route(`**${GET_ACTION}*`, async (route) => {
    const response = await route.fetch();
    await readsReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.route(
    "**/_agent-native/actions/update-visual-plan",
    async (route) => {
      heldSaves += 1;
      await savesReleased;
      await route.continue().catch(() => {});
    },
  );
  await typeAtEndOf(page, "Alpha block seed.", ` ${mine}`);
  await expect.poll(() => heldSaves, { timeout: 20_000 }).toBeGreaterThan(0);
  const otherWrite = await page.request.post(
    "/_agent-native/actions/update-visual-plan",
    {
      data: {
        planId,
        contentPatches: [
          {
            op: "update-rich-text",
            blockId: BRAVO,
            markdown: `Bravo block seed. ${theirs}`,
          },
        ],
      },
    },
  );
  expect(otherWrite.ok(), await otherWrite.text()).toBeTruthy();
  releaseSaves();
  await expect
    .poll(() => persistedText(page, planId), { timeout: 20_000 })
    .toContain(mine);
  await typeAtEndOf(page, mine, ` ${second}`);
  await expect
    .poll(() => persistedText(page, planId), { timeout: 20_000 })
    .toContain(second);
  await typeAtEndOf(page, second, ` ${third}`);
  await expect
    .poll(() => persistedText(page, planId), { timeout: 20_000 })
    .toContain(third);
  expect(await persistedText(page, planId)).toContain(theirs);
  releaseReads();
  await expect(surface(page)).toContainText(theirs, { timeout: 20_000 });
  await expect(surface(page)).toContainText(third);
  // A read can still be on its way when the test ends.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the other version arriving just after I keep mine doesn't replace my choice", async ({
  page,
}) => {
  const planId = await createPlan(page, TWO_BLOCKS);
  await openEditable(page, planId, "Alpha block seed.");
  let releaseReads = () => {};
  const readsReleased = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  let releaseSaves = () => {};
  const savesReleased = new Promise<void>((resolve) => {
    releaseSaves = resolve;
  });
  let holdSaves = false;
  // A read that left before the choice answers after it, with the other version.
  await page.route(`**${GET_ACTION}*`, async (route) => {
    const response = await route.fetch();
    await readsReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.route(
    "**/_agent-native/actions/update-visual-plan",
    async (route) => {
      if (holdSaves) await savesReleased;
      await route.continue().catch(() => {});
    },
  );
  const { mine, theirs, prompt } = await overlapOnFirstBlock(page, planId);
  holdSaves = true;
  await prompt.getByRole("button", { name: "Keep mine" }).click();
  await expect(prompt).toHaveCount(0);
  releaseReads();
  await page.waitForTimeout(3_000); // e2e-harness-ignore: nothing marks a read that changes nothing as taken in
  await expect(surface(page)).toContainText(mine);
  await expect(surface(page)).not.toContainText(theirs);
  releaseSaves();
  await expectPersisted(page, planId, { has: mine, lacks: theirs });
});

test("getting my version back after choosing theirs saves mine", async ({
  page,
}) => {
  const planId = await createPlan(page, TWO_BLOCKS);
  await openEditable(page, planId, "Alpha block seed.");
  const { mine, theirs, prompt } = await overlapOnFirstBlock(page, planId);
  await prompt.getByRole("button", { name: "Use theirs" }).click();
  await expectPersisted(page, planId, { has: theirs, lacks: mine });
  await page
    .getByRole("button", { name: "Get the other version back" })
    .click();
  await expectPersisted(page, planId, { has: mine, lacks: theirs });
});

test("someone idle in the plan doesn't silence another writer's change to the same block", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, planId } = pair;
    const { mine, theirs, prompt } = await overlapOnFirstBlock(pageA, planId);
    await prompt.getByRole("button", { name: "Use theirs" }).click();
    await expectPersisted(pageA, planId, { has: theirs, lacks: mine });
  } finally {
    await closePair(pair);
  }
});

test("someone idle in the plan doesn't silence an edit that what I typed happens to contain", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, planId } = pair;
    const stamp = Date.now() % 100000;
    const { mine, theirs, prompt } = await overlapOnFirstBlock(pageA, planId, {
      mine: ` notebook${stamp}`,
      theirs: `note${stamp}`,
    });
    await prompt.getByRole("button", { name: "Use theirs" }).click();
    await expectPersisted(pageA, planId, { has: theirs, lacks: mine });
  } finally {
    await closePair(pair);
  }
});

test("someone typing in the plan doesn't silence another writer's change to the same block", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, pageB, planId } = pair;
    const peer = `PEER${Date.now() % 100000}`;
    await typeAtEndOf(pageB, "Bravo block seed.", ` ${peer}`);
    await expect(surface(pageA)).toContainText(peer, { timeout: 20_000 });
    const { mine, theirs, prompt } = await overlapOnFirstBlock(pageA, planId);
    await prompt.getByRole("button", { name: "Use theirs" }).click();
    await expectPersisted(pageA, planId, { has: theirs, lacks: mine });
  } finally {
    await closePair(pair);
  }
});

test("typing in another block while someone answers a prompt is kept", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA, pageB, planId } = pair;
    const { mine, theirs, prompt } = await overlapOnFirstBlock(pageA, planId);
    const peer = `PEER${Date.now() % 100000}`;
    await typeAtEndOf(pageB, "Bravo block seed.", ` ${peer}`);
    await expect(surface(pageA)).toContainText(peer, { timeout: 20_000 });
    await prompt.getByRole("button", { name: "Use theirs" }).click();
    await expect
      .poll(
        async () => {
          const text = await persistedText(pageA, planId);
          return [theirs, peer].filter((token) => text.includes(token));
        },
        { timeout: 30_000 },
      )
      .toEqual([theirs, peer]);
    expect(await persistedText(pageA, planId)).not.toContain(mine);
    await expect(surface(pageA)).toContainText(theirs);
    await expect(surface(pageA)).toContainText(peer);
    await expect(surface(pageA)).not.toContainText(mine);
    await expect(surface(pageB)).toContainText(peer);
  } finally {
    await closePair(pair);
  }
});

// Holds my save back until a collaborator's save of the same block has landed,
// so mine is the one that overlaps, with their typing already in my document.
async function collaboratorSavesFirst(pair: Pair) {
  const { pageA, pageB, planId } = pair;
  const stamp = Date.now() % 100000;
  const mine = `MINE${stamp}`;
  const peer = `PEER${stamp}`;
  let heldSaves = 0;
  let releaseMySave = () => {};
  const mySaveReleased = new Promise<void>((resolve) => {
    releaseMySave = resolve;
  });
  await pageA.route(
    "**/_agent-native/actions/update-visual-plan",
    async (route) => {
      heldSaves += 1;
      await mySaveReleased;
      await route.continue().catch(() => {});
    },
  );
  await typeAtEndOf(pageA, "Alpha block seed.", ` ${mine}`);
  await expect.poll(() => heldSaves, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(surface(pageB)).toContainText(mine, { timeout: 20_000 });
  await typeAtEndOf(pageB, "Alpha block seed.", ` ${peer}`);
  await expect(surface(pageA)).toContainText(peer, { timeout: 20_000 });
  await expect
    .poll(() => persistedText(pageB, planId), { timeout: 20_000 })
    .toContain(peer);
  return { mine, peer, releaseMySave };
}

test("a save that overlaps a collaborator's settles itself once the document has both", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { mine, peer, releaseMySave } = await collaboratorSavesFirst(pair);
    const mySave = pair.pageA.waitForResponse(
      (res) => res.url().includes("update-visual-plan") && res.ok(),
      { timeout: 30_000 },
    );
    releaseMySave();
    await mySave;
    await expectNoPrompt(pair);
    await expectEveryViewHas(pair, [mine, peer]);
  } finally {
    await closePair(pair);
  }
});

test("a document that can't catch up asks about an overlap instead of settling it", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageA } = pair;
    const { releaseMySave } = await collaboratorSavesFirst(pair);
    await pageA.route("**/_agent-native/collab/**/state*", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    releaseMySave();
    await expect(pageA.getByRole("alertdialog")).toContainText(
      "Someone else changed this too",
      { timeout: 20_000 },
    );
  } finally {
    await closePair(pair);
  }
});

test("opening a plan in two editors at once seeds it and its callouts exactly once", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  let pair: Pair | undefined;
  try {
    const seed = "Single seed marker line.";
    pair = await openPair(
      browser,
      [
        { id: ALPHA, markdown: seed },
        { id: "divider", markdown: "Separator callout.", type: "callout" },
        { id: BRAVO, markdown: "Second block marker." },
      ],
      "Second block marker.",
      { concurrentOpen: true },
    );
    const { pageA, pageB, planId } = pair;
    await pageA.waitForTimeout(9_000); // e2e-harness-ignore: a duplicate seed shows up late, once polling merges the two copies
    for (const page of [pageA, pageB]) {
      expect(
        occurrences(await editorText(page), "Single seed marker line."),
        "the seed must appear once in each open editor",
      ).toBe(1);
      expect(
        occurrences(await editorText(page), "Separator callout."),
        "the callout's seed must appear once in each open editor",
      ).toBe(1);
    }
    // Duplicated seeds only reach SQL when someone edits, so type once.
    const token = ` SEEDCHECK${Date.now() % 100000}`;
    await typeAtEndOf(pageA, "Second block marker.", token);
    const calloutToken = ` CALLOUTCHECK${Date.now() % 100000}`;
    await typeAtEndOf(pageA, "Separator callout.", calloutToken);
    await expect
      .poll(async () => persistedText(pageA, planId), { timeout: 20_000 })
      .toContain(calloutToken.trim());
    const text = await persistedText(pageA, planId);
    expect(text).toContain(token.trim());
    expect(occurrences(text, "Single seed marker line.")).toBe(1);
    expect(occurrences(text, "Second block marker.")).toBe(1);
    expect(occurrences(text, "Separator callout.")).toBe(1);
    for (const page of [pageA, pageB]) {
      await page.reload();
      await expect(surface(page)).toContainText(token.trim(), {
        timeout: 20_000,
      });
      expect(
        occurrences(await editorText(page), "Single seed marker line."),
      ).toBe(1);
      expect(occurrences(await editorText(page), "Separator callout.")).toBe(1);
    }
  } finally {
    await closePair(pair);
  }
});

test("a callout another writer saved while the editor was still hydrating is not blanked by the next autosave", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  let pair: Pair | undefined;
  try {
    pair = await openPair(browser, TWO_BLOCKS, "Bravo block seed.");
    const { pageB, planId } = pair;
    // A third editor opens the plan with its live document held empty, so the
    // editor is not ready when the other writer's save reaches it by polling.
    const ctxC = await browser.newContext({ storageState: STATE_FILE });
    try {
      const pageC = await ctxC.newPage();
      const autosaveErrors: string[] = [];
      pageC.on("console", (message) => {
        if (message.text().includes("Failed to autosave plan document")) {
          autosaveErrors.push(message.text());
        }
      });
      let releaseHeld: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });
      const holdRoute = async (route: Route) => {
        await held;
        await route.continue();
      };
      await pageC.route("**/_agent-native/actions/seed-plan-collab", holdRoute);
      await pageC.route(
        new RegExp(`/collab/plan(:|%3A)${planId}/state`),
        holdRoute,
      );
      await pageC.goto(`/plans/${planId}`);
      const saved = `CALLOUTHYDRATE${Date.now() % 100000}`;
      const write = await pageB.request.post(
        "/_agent-native/actions/update-visual-plan",
        {
          data: {
            planId,
            contentPatches: [
              {
                op: "update-block",
                blockId: "divider",
                patch: { data: { tone: "info", body: saved } },
              },
            ],
          },
        },
      );
      expect(write.ok(), `update-block: ${await write.text()}`).toBeTruthy();
      await pageC.waitForTimeout(6_000); // e2e-harness-ignore: the editor must stay unhydrated while polling delivers the saved callout
      releaseHeld();
      await expect(surface(pageC)).toContainText("Bravo block seed.", {
        timeout: 25_000,
      });
      await expectEveryViewHas({ ...pair, pageB: pageC }, [saved]);
      expect(
        autosaveErrors,
        "the hydrating editor must not send a save the server refuses",
      ).toEqual([]);
    } finally {
      await ctxC.close().catch(() => {});
    }
  } finally {
    await closePair(pair);
  }
});
