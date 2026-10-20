import { expect, test, type Page, type Route } from "@playwright/test";

import {
  ACTION_HEADERS,
  createPage,
  EDITOR,
  getDocument,
  gotoEditor,
  postAction,
  SaveGate,
  TabSet,
  typeAtParagraphEnd,
} from "./helpers";

const FIRST_PARAGRAPH = "Flush wake paragraph.";
type PublishedSaveState = {
  unsavedEdits: unknown;
  savedRevision: unknown;
  clientId: number;
  editorSessionId: unknown;
  email: unknown;
};

function watchPublishedSaveState(page: Page): PublishedSaveState[] {
  const published: PublishedSaveState[] = [];
  page.on("requestfinished", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/awareness"))
      return;
    const body = request.postDataJSON() as {
      clientId: number;
      state?: string | null;
    } | null;
    if (!body?.state) return;
    const state = JSON.parse(body.state) as Record<string, any>;
    if (!("unsavedEdits" in state)) return;
    published.push({
      unsavedEdits: state.unsavedEdits,
      savedRevision: state.savedRevision,
      clientId: body.clientId,
      editorSessionId: state.editorSessionId,
      email: state.user?.email,
    });
  });
  return published;
}
async function waitForPublished(
  published: PublishedSaveState[],
  unsavedEdits: boolean,
) {
  await expect
    .poll(() => published.at(-1)?.unsavedEdits, { timeout: 30_000 })
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
      editorFlush?: {
        status: string;
        editors: Array<{
          clientId: number;
          editorSessionId: string;
          flush: string;
          prepareToken: string;
          verifyToken: string;
        }>;
      };
      errorCode?: string;
    },
  };
}

// The correctness lane controls delivery via the existing focus handler. It makes
// no assertion about idle transport latency or any pending delivery setting.
async function wakePhase(
  reader: Page,
  id: string,
  phase: "prepare" | "verify",
  editors: Page[],
) {
  await expect
    .poll(
      async () => {
        const response = await reader.request.get(
          `/_agent-native/application-state/flush-request-${id}`,
        );
        expect(response.ok()).toBe(true);
        return (await response.json())?.phase;
      },
      { timeout: 2500, intervals: [0, 10, 20, 50] },
    )
    .toBe(phase);
  await Promise.all(
    editors.map((editor) =>
      editor.evaluate(() => window.dispatchEvent(new Event("focus"))),
    ),
  );
}

test.describe("fresh confirmation of open editors", () => {
  test("refuses an old saved claim when fresh challenge delivery is withheld", async ({
    page,
  }) => {
    const tabs = await TabSet.create(page.context());
    const published = watchPublishedSaveState(page);
    const id = await createPage(
      page,
      "Flush wake unavailable delivery",
      FIRST_PARAGRAPH,
    );
    await page.route(
      (url) =>
        url.pathname === "/_agent-native/application-state" &&
        (url.searchParams.get("keys") ?? "").includes(`flush-request-${id}`),
      async (route) => {
        const response = await route.fetch();
        const batch = await response.json();
        delete batch.values[`flush-request-${id}`];
        batch.missing.push(`flush-request-${id}`);
        await route.fulfill({ response, json: batch });
      },
    );
    try {
      await gotoEditor(page, id, { tabs });
      await waitForPublished(published, false);
      const pulled = await pullDocument(page, id);
      expect(pulled.status).toBe(409);
      expect(pulled.body.errorCode).toBe("open_editor_flush_timeout");
      expect((await getDocument(page, id)).content).toBe(FIRST_PARAGRAPH);
    } finally {
      await page.goto("about:blank");
      await postAction(page, "delete-document", { id });
    }
  });

  test("does not omit fresh UI input while dirty awareness and canonical saving are held", async ({
    page,
  }, testInfo) => {
    const tabs = await TabSet.create(page.context());
    const published = watchPublishedSaveState(page);
    const id = await createPage(
      page,
      "Flush wake unpublished input",
      FIRST_PARAGRAPH,
    );
    const heldAwareness: Route[] = [];
    const dirtyPayloads: unknown[] = [];
    let holdAwareness = false;
    await page.route(
      (url) => url.pathname === `/_agent-native/collab/${id}/awareness`,
      (route) => {
        if (holdAwareness && route.request().method() === "POST") {
          heldAwareness.push(route);
          dirtyPayloads.push(route.request().postDataJSON());
          return;
        }
        return route.continue();
      },
    );
    await gotoEditor(page, id, { tabs });
    await waitForPublished(published, false);
    const gate = await SaveGate.install(page);
    gate.holdArrivals();
    holdAwareness = true;
    const expected = `${FIRST_PARAGRAPH} zqfreshinputbeforeawarenessx`;
    try {
      await typeAtParagraphEnd(
        page,
        FIRST_PARAGRAPH,
        " zqfreshinputbeforeawarenessx",
        0,
      );
      // No dirty-publication or persistence wait may be inserted before this pull.
      const started = Date.now();
      const pulled = await pullDocument(page, id);
      const persisted = await getDocument(page, id);
      await gate.waitForHeld();
      await testInfo.attach("freshness-evidence", {
        body: JSON.stringify(
          {
            pulled,
            persisted,
            pullMs: Date.now() - started,
            dirtyPayloads,
            heldBodySaves: gate.queued,
            localText: await page.locator(EDITOR).innerText(),
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect((await page.locator(EDITOR).innerText()).trim()).toBe(expected);
      expect(persisted.content).toBe(FIRST_PARAGRAPH);
      expect(published.at(-1)?.unsavedEdits).toBe(false);
      expect(
        dirtyPayloads.some(
          (value) =>
            JSON.parse((value as { state: string }).state)?.unsavedEdits ===
            true,
        ),
      ).toBe(true);
      expect(pulled.status).toBe(409);
      expect(pulled.body.errorCode).toBe("open_editor_flush_timeout");
    } finally {
      holdAwareness = false;
      for (const route of heldAwareness) await route.continue();
      gate.pass();
      await gate.release();
      await expect
        .poll(async () => (await getDocument(page, id)).content, {
          timeout: 30_000,
        })
        .toBe(expected);
      await tabs.quiet();
      await page.goto("about:blank");
      await postAction(page, "delete-document", { id });
    }
  });

  test("requires the dirty same-user tab even after the clean tab prepares", async ({
    page,
  }, testInfo) => {
    const tabs = await TabSet.create(page.context());
    const cleanPublished = watchPublishedSaveState(page);
    const id = await createPage(
      page,
      "Flush wake same user tabs",
      FIRST_PARAGRAPH,
    );
    await gotoEditor(page, id, { tabs, label: "clean" });
    const dirty = await page.context().newPage();
    const dirtyPublished = watchPublishedSaveState(dirty);
    await gotoEditor(dirty, id, { tabs, label: "dirty" });
    await waitForPublished(cleanPublished, false);
    await waitForPublished(dirtyPublished, false);
    expect(cleanPublished.at(-1)!.email).toBe(dirtyPublished.at(-1)!.email);
    expect(cleanPublished.at(-1)!.clientId).not.toBe(
      dirtyPublished.at(-1)!.clientId,
    );
    expect(cleanPublished.at(-1)!.editorSessionId).not.toBe(
      dirtyPublished.at(-1)!.editorSessionId,
    );
    const preparedClients: number[] = [];
    page.on("requestfinished", (request) => {
      if (
        request.method() === "PATCH" &&
        new URL(request.url()).pathname.includes(
          "/application-state/flush-ack-",
        )
      ) {
        const next = request.postDataJSON()?.next;
        if (next?.status === "prepared") preparedClients.push(next.clientId);
      }
    });
    const gate = await SaveGate.install(dirty);
    gate.holdAnswers();
    const expected = `${FIRST_PARAGRAPH} zqsameuserheldresponse`;
    try {
      await typeAtParagraphEnd(
        dirty,
        FIRST_PARAGRAPH,
        " zqsameuserheldresponse",
        0,
      );
      await gate.waitForHeld();
      await waitForPublished(dirtyPublished, true);
      expect(cleanPublished.at(-1)?.unsavedEdits).toBe(false);
      const pulling = pullDocument(page, id);
      await wakePhase(page, id, "prepare", [page, dirty]);
      const pulled = await pulling;
      await testInfo.attach("same-user-freshness", {
        body: JSON.stringify(
          {
            clean: cleanPublished.at(-1),
            dirty: dirtyPublished.at(-1),
            heldSaveResponses: gate.queued,
            preparedClients,
            pulled,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(preparedClients).toContain(cleanPublished.at(-1)!.clientId);
      expect(preparedClients).not.toContain(dirtyPublished.at(-1)!.clientId);
      expect(pulled.status).toBe(409);
      expect(pulled.body.errorCode).toBe("open_editor_flush_timeout");
      expect((await dirty.locator(EDITOR).innerText()).trim()).toBe(expected);
    } finally {
      gate.pass();
      await gate.release();
      await tabs.quiet();
      await dirty.close();
      await page.goto("about:blank");
      await postAction(page, "delete-document", { id });
    }
  });

  test("returns the captured body with fresh per-client prepare and verify receipts", async ({
    page,
  }) => {
    const tabs = await TabSet.create(page.context());
    const published = watchPublishedSaveState(page);
    const id = await createPage(page, "Flush wake two phase", FIRST_PARAGRAPH);
    try {
      await gotoEditor(page, id, { tabs });
      await waitForPublished(published, false);
      await typeAtParagraphEnd(
        page,
        FIRST_PARAGRAPH,
        " zqsettledbeforepull",
        0,
      );
      await expect
        .poll(async () => (await getDocument(page, id)).content)
        .toBe(`${FIRST_PARAGRAPH} zqsettledbeforepull`);
      await tabs.quiet();
      await waitForPublished(published, false);
      const pulling = pullDocument(page, id);
      await wakePhase(page, id, "prepare", [page]);
      await wakePhase(page, id, "verify", [page]);
      const pulled = await pulling;
      expect(pulled.status).toBe(200);
      expect(pulled.body.content).toBe(
        `${FIRST_PARAGRAPH} zqsettledbeforepull`,
      );
      expect(pulled.body.editorFlush).toMatchObject({
        status: "flushed",
        editors: [
          {
            clientId: published.at(-1)!.clientId,
            editorSessionId: published.at(-1)!.editorSessionId,
            flush: "answered",
            prepareToken: expect.any(String),
            verifyToken: expect.any(String),
          },
        ],
      });
      const receipt = pulled.body.editorFlush!.editors[0]!;
      expect(receipt.prepareToken).not.toBe(receipt.verifyToken);
    } finally {
      await tabs.quiet();
      await page.goto("about:blank");
      await postAction(page, "delete-document", { id });
    }
  });

  test("refuses stale success after a second body and title edit across a held save", async ({
    page,
  }, testInfo) => {
    const tabs = await TabSet.create(page.context());
    const published = watchPublishedSaveState(page);
    const id = await createPage(
      page,
      "Flush wake edits across save",
      FIRST_PARAGRAPH,
    );
    await gotoEditor(page, id, { tabs });
    await waitForPublished(published, false);
    const gate = await SaveGate.install(page);
    gate.holdAnswers();
    const first = `${FIRST_PARAGRAPH} zqfirstheldsave`;
    const expected = `${first} zqsecondheldsave`;
    const title = "Title edited during the first save";
    try {
      await typeAtParagraphEnd(page, FIRST_PARAGRAPH, " zqfirstheldsave", 0);
      await gate.waitForHeld();
      const pulling = pullDocument(page, id);
      const delivered = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          response.url().includes(`flush-request-${id}`),
      );
      await wakePhase(page, id, "prepare", [page]);
      await delivered;
      await typeAtParagraphEnd(page, first, " zqsecondheldsave", 0);
      await page.getByLabel("Document title", { exact: true }).fill(title);
      await gate.release();
      await gate.waitForHeld();
      const pulled = await pulling;
      await testInfo.attach("save-await-body-title", {
        body: JSON.stringify(
          {
            pulled,
            saved: await getDocument(page, id),
            heldResponses: gate.queued,
            localBody: await page.locator(EDITOR).innerText(),
            localTitle: await page
              .getByLabel("Document title", { exact: true })
              .inputValue(),
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(pulled.status).toBe(409);
      expect(pulled.body.errorCode).toBe("open_editor_flush_timeout");
      expect((await page.locator(EDITOR).innerText()).trim()).toBe(expected);
      await expect(
        page.getByLabel("Document title", { exact: true }),
      ).toHaveValue(title);
    } finally {
      gate.pass();
      await gate.release();
      await expect
        .poll(
          async () => {
            const saved = await getDocument(page, id);
            return { content: saved.content, title: saved.title };
          },
          { timeout: 30_000 },
        )
        .toEqual({ content: expected, title });
      await tabs.quiet();
      await page.goto("about:blank");
      await postAction(page, "delete-document", { id });
    }
  });
});
