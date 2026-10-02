import {
  test,
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
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
  const res = await page.request.post("/_agent-native/actions/share-resource", {
    data: {
      resourceType: "plan",
      resourceId: planId,
      principalType: "user",
      principalId: email,
      role: "editor",
    },
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
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const planId = await createPlan(pageA, blocks);
  const second = await registerUser(pageB, "second");
  await shareAsEditor(pageA, planId, second.email);
  if (concurrentOpen) {
    // Hold both editors' first read of the live document until each has asked,
    // so both see it empty and both try to seed it, as two people opening the
    // plan in the same moment do.
    let arrived = 0;
    let release: () => void = () => {};
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const liveDocState = new RegExp(`/collab/plan(:|%3A)${planId}/state`);
    for (const page of [pageA, pageB]) {
      await page.route(liveDocState, async (route) => {
        arrived += 1;
        if (arrived >= 2) release();
        await Promise.race([
          bothArrived,
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
  await pageA.waitForTimeout(2_000);
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
  await pageA.waitForTimeout(4_000);
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
    await pageA.waitForTimeout(3_000);
    await ctxB.setOffline(false);
    await expectEveryViewHas(pair, [tokenA.trim(), tokenB.trim()]);
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

test("opening a plan in two editors at once seeds it exactly once", async ({
  browser,
}) => {
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
    await pageA.waitForTimeout(3_000);
    for (const page of [pageA, pageB]) {
      expect(
        occurrences(await editorText(page), "Single seed marker line."),
        "the seed must appear once in each open editor",
      ).toBe(1);
    }
    // Duplicated seeds only reach SQL when someone edits, so type once.
    const token = ` SEEDCHECK${Date.now() % 100000}`;
    await typeAtEndOf(pageA, "Second block marker.", token);
    await expect
      .poll(async () => persistedText(pageA, planId), { timeout: 20_000 })
      .toContain(token.trim());
    const text = await persistedText(pageA, planId);
    expect(occurrences(text, "Single seed marker line.")).toBe(1);
    expect(occurrences(text, "Second block marker.")).toBe(1);
    for (const page of [pageA, pageB]) {
      await page.reload();
      await expect(surface(page)).toContainText(token.trim(), {
        timeout: 20_000,
      });
      expect(
        occurrences(await editorText(page), "Single seed marker line."),
      ).toBe(1);
    }
  } finally {
    await closePair(pair);
  }
});
