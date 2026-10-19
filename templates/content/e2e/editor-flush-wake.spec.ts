import { expect, test, type Page } from "@playwright/test";

import {
  ACTION_HEADERS,
  createPage,
  delay,
  gotoEditor,
  SaveGate,
  typeAtParagraphEnd,
} from "./helpers";

const FIRST_PARAGRAPH = "Flush wake paragraph.";

// A serverless host refuses the event stream, so sync rides the poll path.
// Refusing the editor's flush mailbox read as well leaves the save state the
// editor publishes as the only way an agent read can get past it.
async function forcePollPathWithoutMailbox(page: Page) {
  await page.route(
    (url) => url.pathname === "/_agent-native/events",
    (route) => route.fulfill({ status: 204 }),
  );
  await page.route(
    (url) =>
      url.pathname.startsWith(
        "/_agent-native/application-state/flush-request-",
      ),
    (route) =>
      route.request().method() === "GET"
        ? route.abort("failed")
        : route.continue(),
  );
}

type PublishedSaveState = { unsavedEdits: unknown; savedRevision: unknown };

function watchPublishedSaveState(page: Page): PublishedSaveState[] {
  const published: PublishedSaveState[] = [];
  page.on("requestfinished", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/awareness"))
      return;
    const body = request.postDataJSON() as { state?: string | null } | null;
    if (!body?.state) return;
    const state = JSON.parse(body.state) as Record<string, unknown>;
    if (!("unsavedEdits" in state)) return;
    published.push({
      unsavedEdits: state.unsavedEdits,
      savedRevision: state.savedRevision,
    });
  });
  return published;
}

async function waitForPublished(
  published: PublishedSaveState[],
  unsavedEdits: boolean,
) {
  await expect
    .poll(() => published.at(-1)?.unsavedEdits, {
      message: `the editor should publish unsavedEdits: ${unsavedEdits}`,
      timeout: 30_000,
    })
    .toBe(unsavedEdits);
}

async function pullDocument(page: Page, id: string) {
  const response = await page.request.get(
    `/_agent-native/actions/pull-document?id=${encodeURIComponent(id)}`,
    { headers: ACTION_HEADERS },
  );
  return {
    status: response.status(),
    body: (await response.json()) as {
      content?: string;
      editorFlush?: unknown;
      errorCode?: string;
    },
  };
}

test.describe("agent reads of a page open in an editor", () => {
  test.beforeEach(async ({ page }) => {
    await forcePollPathWithoutMailbox(page);
  });

  test("proceed past an editor whose save is already in SQL", async ({
    page,
  }) => {
    const published = watchPublishedSaveState(page);
    const id = await createPage(page, "Flush wake saved", FIRST_PARAGRAPH);
    await gotoEditor(page, id);
    await waitForPublished(published, false);

    const pulled = await pullDocument(page, id);

    expect(pulled.status).toBe(200);
    expect(pulled.body.content).toContain(FIRST_PARAGRAPH);
    expect(pulled.body.editorFlush).toEqual({
      status: "flushed",
      editors: [{ clientId: expect.any(Number), flush: "skipped_saved" }],
    });
  });

  test("wait for an editor that is still saving, then read its text", async ({
    page,
  }) => {
    const published = watchPublishedSaveState(page);
    const id = await createPage(page, "Flush wake saving", FIRST_PARAGRAPH);
    await gotoEditor(page, id);
    await waitForPublished(published, false);
    const gate = await SaveGate.install(page);
    gate.holdArrivals();

    await typeAtParagraphEnd(page, FIRST_PARAGRAPH, " zqwakeword");
    await gate.waitForHeld();
    await waitForPublished(published, true);
    const pulling = pullDocument(page, id);
    await delay(1_000);
    gate.pass();
    await gate.release();
    const pulled = await pulling;

    expect(pulled.status).toBe(200);
    expect(pulled.body.content).toContain("zqwakeword");
    expect(pulled.body.editorFlush).toEqual({
      status: "flushed",
      editors: [{ clientId: expect.any(Number), flush: "reported_saved" }],
    });
  });

  test("refuse with a typed timeout while the editor cannot save", async ({
    page,
  }) => {
    const published = watchPublishedSaveState(page);
    const id = await createPage(page, "Flush wake stuck", FIRST_PARAGRAPH);
    await gotoEditor(page, id);
    await waitForPublished(published, false);
    const gate = await SaveGate.install(page);
    gate.holdArrivals();

    await typeAtParagraphEnd(page, FIRST_PARAGRAPH, " zqstuckword");
    await gate.waitForHeld();
    await waitForPublished(published, true);
    const pulled = await pullDocument(page, id);
    gate.pass();
    await gate.release();

    expect(pulled.status).toBe(409);
    expect(pulled.body.errorCode).toBe("open_editor_flush_timeout");
  });
});
