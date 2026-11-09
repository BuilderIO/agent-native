import type { Page } from "@playwright/test";

import { appPath, gotoEditor, selectByText } from "./helpers";
import { expect, savedNodeMap, styleOf, test, type App } from "./rails";

const OUTBOX_DATABASE = "agent-native-design-save-outbox";
const OUTBOX_STORE = "entries";
const UPDATE_FILE = /\/_agent-native\/actions\/update-file(\?|$)/;
const STALE_NOTICE =
  "This screen changed elsewhere. Your last edit was not saved.";
const SAVE_CHIP = '[data-save-status="unsaved"]';
// No padding or background on the card: the editor wraps a painted or padded
// text leaf in `<span data-an-text>` on open and persists that rewrite
// (wrapBareTextLeavesInHtml in shared/code-layer.ts), which would make the
// seeded content differ from the journaled base.
const ORIGINAL_CARD_STYLE = "font-size:16px";

// Each element sits on its own line so a three-way merge sees two separate
// hunks. Every element carries a canonical node id, or the editor re-stamps
// the file on open (see the legacy-outbox-replay spec for the same rule).
function designHtml(options: { cardStyle?: string; heading?: string } = {}) {
  return [
    "<!doctype html>",
    '<html lang="en" data-agent-native-node-id="merge-html">',
    '<head><meta charset="utf-8"></head>',
    '<body style="margin:0" data-agent-native-node-id="merge-body">',
    '<main data-agent-native-node-id="merge-main" style="padding:24px">',
    `<div data-agent-native-node-id="card-a" style="${options.cardStyle ?? ORIGINAL_CARD_STYLE}">Card A</div>`,
    `<h1 data-agent-native-node-id="heading">${options.heading ?? "Heading"}</h1>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

const ORIGINAL_HTML = designHtml();

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  return (await response.json()) as {
    files?: Array<{ content?: string; filename?: string; id?: string }>;
  };
}

async function indexFileId(page: Page, designId: string): Promise<string> {
  const file = (await readDesign(page, designId)).files?.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file?.id) throw new Error("Missing index.html file ID");
  return file.id;
}

async function storedContent(
  page: Page,
  designId: string,
  fileId: string,
): Promise<string> {
  const file = (await readDesign(page, designId)).files?.find(
    (candidate) => candidate.id === fileId,
  );
  if (typeof file?.content !== "string")
    throw new Error("Missing file content");
  return file.content;
}

async function hasOutboxEntry(page: Page, key: string): Promise<boolean> {
  return await page.evaluate(
    async ({ databaseName, storeName, entryKey }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const exists = await new Promise<boolean>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(entryKey);
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return exists;
    },
    { databaseName: OUTBOX_DATABASE, storeName: OUTBOX_STORE, entryKey: key },
  );
}

/** Journaled outbox entries for one file, with the journaled `baseContent` (null when absent). */
async function outboxEntriesFor(page: Page, fileId: string) {
  return await page.evaluate(
    async ({ databaseName, storeName, resourceId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const entries = await new Promise<
        Array<{ key: string; resourceId: string; baseContent?: unknown }>
      >((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return entries
        .filter((entry) => entry.resourceId === resourceId)
        .map((entry) => ({
          key: entry.key,
          baseContent:
            typeof entry.baseContent === "string" ? entry.baseContent : null,
        }));
    },
    {
      databaseName: OUTBOX_DATABASE,
      storeName: OUTBOX_STORE,
      resourceId: fileId,
    },
  );
}

/** Sets the selected card's font size through the canvas and the inspector's Size field. */
async function setCardFontSize(app: App, size: string) {
  // The seeded screen opens in overview at 20%, where the card is too small to click.
  await app.zoomToFit();
  await selectByText(app.page, "Card A");
  const sizeInput = app.page.locator('input[aria-label="Size" i]').first();
  await sizeInput.fill(size);
  await sizeInput.press("Enter");
  await expect(app.node("card-a")).toHaveCSS("font-size", `${size}px`);
}

/** The server accepts a write while the editor's own save requests are blocked. */
async function writeOnServer(page: Page, fileId: string, content: string) {
  const response = await page.request.post(
    appPath("/_agent-native/actions/update-file"),
    { data: { id: fileId, content } },
  );
  expect(response.ok(), `server-side update-file ${response.status()}`).toBe(
    true,
  );
}

async function replayOutbox(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
}

/**
 * The aborted save is logged by Chromium, and the replay's first send is refused
 * as stale (409) before the merge re-sends it. Both are the scenario, not a failure.
 */
function allowOfflineReplayNoise(app: App) {
  app.allowFailure(
    /^console\.error Failed to load resource: net::ERR_CONNECTION_RESET$/,
    "the scenario aborts the save request",
  );
  app.allowFailure(
    /^http 409 POST \/_agent-native\/actions\/update-file$/,
    "the replay's first send is refused as stale before the merge",
  );
  app.allowFailure(
    /^console\.error Failed to load resource: the server responded with a status of 409/,
    "the stale replay is logged by Chromium",
  );
}

/**
 * Journals one card edit whose save never gets an answer, and returns the
 * journaled entry. With `landsOnServer` the server still takes the save, as when
 * a tab closes before the response arrives.
 */
async function journalOfflineCardEdit(
  app: App,
  fileId: string,
  options: { landsOnServer?: boolean } = {},
) {
  const { page } = app;
  await page.route(UPDATE_FILE, async (route) => {
    if (options.landsOnServer) await route.fetch();
    await route.abort("connectionreset");
  });
  await setCardFontSize(app, "28");
  await expect
    .poll(async () => (await outboxEntriesFor(page, fileId)).length, {
      message: "the offline edit was never journaled",
    })
    .toBeGreaterThan(0);
  const entry = (await outboxEntriesFor(page, fileId))[0];
  if (!entry) throw new Error("the journaled outbox entry disappeared");
  expect(entry.baseContent, "the journaled starting point").toBe(ORIGINAL_HTML);
  return entry;
}

test("replay merges an offline card edit with a heading change made elsewhere", async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  allowOfflineReplayNoise(app);
  const designId = await app.seed(ORIGINAL_HTML);
  const fileId = await indexFileId(page, designId);
  await app.open(designId);

  const entry = await journalOfflineCardEdit(app, fileId);
  await writeOnServer(
    page,
    fileId,
    designHtml({ heading: "Heading changed elsewhere" }),
  );

  await page.unroute(UPDATE_FILE);
  await replayOutbox(page);

  await expect
    .poll(
      async () => {
        const nodes = savedNodeMap(await storedContent(page, designId, fileId));
        return {
          heading: nodes.get("heading")?.text,
          cardFontSize: styleOf(nodes.get("card-a"))["font-size"],
        };
      },
      { timeout: 20_000 },
    )
    .toEqual({ heading: "Heading changed elsewhere", cardFontSize: "28px" });
  await expect.poll(() => hasOutboxEntry(page, entry.key)).toBe(false);
  await expect(page.getByText(STALE_NOTICE, { exact: true })).not.toBeVisible();
});

test("a same-spot clash is still dropped loudly", async ({ app, page }) => {
  test.setTimeout(120_000);
  allowOfflineReplayNoise(app);
  app.allowFailure(
    /^error toast This screen changed elsewhere\. Your last edit was not saved\.$/,
    "the scenario's same-spot clash is reported",
  );
  const designId = await app.seed(ORIGINAL_HTML);
  const fileId = await indexFileId(page, designId);
  await app.open(designId);

  const entry = await journalOfflineCardEdit(app, fileId);
  const serverHtml = designHtml({ cardStyle: "font-size:20px" });
  await writeOnServer(page, fileId, serverHtml);

  await page.unroute(UPDATE_FILE);
  await replayOutbox(page);

  await expect(page.getByText(STALE_NOTICE, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect.poll(() => hasOutboxEntry(page, entry.key)).toBe(false);
  expect(await storedContent(page, designId, fileId)).toBe(serverHtml);
});

test("a save the server keeps refusing shows Not saved and recovers", async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  app.allowFailure(
    /^http 500 POST \/_agent-native\/actions\/update-file$/,
    "the scenario makes the server refuse every save",
  );
  app.allowFailure(
    /^console\.error Failed to load resource: the server responded with a status of 500/,
    "the refused save is logged by Chromium",
  );
  app.allowFailure(
    /^error toast Action update-file failed: Internal server error$/,
    "the refused save is reported in the editor",
  );
  const designId = await app.seed(ORIGINAL_HTML);
  const fileId = await indexFileId(page, designId);
  await app.open(designId);

  await page.route(UPDATE_FILE, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Internal server error" }),
    }),
  );
  await setCardFontSize(app, "28");
  // Shorter than the first 5 s retry, so the chip comes from the failed save
  // itself, not from a replay that happens to run later.
  await expect(page.locator(SAVE_CHIP)).toBeVisible({ timeout: 4_000 });

  await page.unroute(UPDATE_FILE);
  await page.locator(SAVE_CHIP).click();
  await expect(page.locator(SAVE_CHIP)).toHaveCount(0, { timeout: 10_000 });

  await expect
    .poll(async () => {
      const nodes = savedNodeMap(await storedContent(page, designId, fileId));
      return styleOf(nodes.get("card-a"))["font-size"];
    })
    .toBe("28px");
  await expect
    .poll(async () => (await outboxEntriesFor(page, fileId)).length)
    .toBe(0);
});

test("a copy that already landed is dropped, not merged back, after another writer undid it", async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  allowOfflineReplayNoise(app);
  const designId = await app.seed(ORIGINAL_HTML);
  const fileId = await indexFileId(page, designId);
  await app.open(designId);

  const entry = await journalOfflineCardEdit(app, fileId, {
    landsOnServer: true,
  });
  await expect
    .poll(
      async () =>
        styleOf(
          savedNodeMap(await storedContent(page, designId, fileId)).get(
            "card-a",
          ),
        )["font-size"],
    )
    .toBe("28px");
  // Another writer undoes the edit and changes the heading.
  const otherWriterHtml = designHtml({ heading: "Heading changed elsewhere" });
  await writeOnServer(page, fileId, otherWriterHtml);

  await page.unroute(UPDATE_FILE);
  await replayOutbox(page);

  await expect
    .poll(() => hasOutboxEntry(page, entry.key), { timeout: 20_000 })
    .toBe(false);
  expect(await storedContent(page, designId, fileId)).toBe(otherWriterHtml);
  await expect(page.getByText(STALE_NOTICE, { exact: true })).not.toBeVisible();
});

test("another open tab leaves an editor's unsent copy to it until that tab closes", async ({
  app,
  page,
}) => {
  test.setTimeout(150_000);
  allowOfflineReplayNoise(app);
  const designId = await app.seed(ORIGINAL_HTML);
  const fileId = await indexFileId(page, designId);
  await app.open(designId);
  const entry = await journalOfflineCardEdit(app, fileId);

  const otherTab = await page.context().newPage();
  try {
    const sentByOtherTab: string[] = [];
    otherTab.on("request", (request) => {
      if (request.method() === "POST" && UPDATE_FILE.test(request.url())) {
        sentByOtherTab.push(request.postData() ?? "");
      }
    });
    // Counts the open-editor checks the other tab's drain makes, so the test
    // waits for the drain to have looked at the copy instead of for a clock.
    await otherTab.addInitScript(() => {
      const counter = window as unknown as { __writerQueries?: number };
      counter.__writerQueries = 0;
      const query = navigator.locks.query.bind(navigator.locks);
      navigator.locks.query = () => {
        counter.__writerQueries = (counter.__writerQueries ?? 0) + 1;
        return query();
      };
    });
    await gotoEditor(otherTab, designId);
    await replayOutbox(otherTab);
    await expect
      .poll(() =>
        otherTab.evaluate(
          () =>
            (window as unknown as { __writerQueries?: number })
              .__writerQueries ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    // The drain holds this lock until it finishes, so the request resolves after it.
    await otherTab.evaluate(
      (id) =>
        navigator.locks.request(
          `agent-native-design-save-outbox:${id}`,
          async () => undefined,
        ),
      designId,
    );

    expect(sentByOtherTab, "the other tab sent the open tab's copy").toEqual(
      [],
    );
    expect(await hasOutboxEntry(otherTab, entry.key)).toBe(true);

    // The first tab goes away, and with it the lock that marked its copy as live.
    await page.goto(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    );
    await expect
      .poll(
        async () => {
          await replayOutbox(otherTab);
          return await hasOutboxEntry(otherTab, entry.key);
        },
        { timeout: 30_000 },
      )
      .toBe(false);
    await expect
      .poll(
        async () =>
          styleOf(
            savedNodeMap(await storedContent(otherTab, designId, fileId)).get(
              "card-a",
            ),
          )["font-size"],
      )
      .toBe("28px");
  } finally {
    await otherTab.close();
  }
});
