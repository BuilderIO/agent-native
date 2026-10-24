import { randomUUID } from "node:crypto";

import { expect, test, type Page, type Route } from "@playwright/test";

import {
  EDITOR,
  TabSet,
  createPage,
  getActionResponse,
  getDocument,
  gotoEditor,
  postAction,
  typeAtParagraphEnd,
} from "../helpers";
import { GATE_ARM, enterGateArm } from "../live-body-gate";

// A pull, a History restore or a space move of a page whose body is its live
// copy asks each open editor that advertises `canFlushTitle` to save its title
// alone. The body's live-copy update can take longer to be acknowledged than
// the server waits, so the editor has to answer while it is still held.

test.describe.configure({ retries: 0, timeout: 120_000 });

const PARAGRAPHS = [
  "Alpha paragraph before the title save.",
  "Bravo paragraph before the title save.",
];

type PullBody = {
  title?: string;
  content?: string;
  editorFlush?: {
    status: string;
    titleFlush?: {
      pages: Array<{
        documentId: string;
        confirmedTitle?: string;
        editors: Array<{ flush: string }>;
      }>;
    };
  };
  errorCode?: string;
};

/**
 * Pulls the page as an agent does, waking the editor for each request the
 * server publishes through the focus handler that reads its mailbox.
 */
async function pull(page: Page, id: string) {
  let finished = false;
  const pulling = getActionResponse(page, "pull-document", { id }).finally(
    () => {
      finished = true;
    },
  );
  while (!finished) {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const response = await pulling;
  return {
    status: response.status(),
    body: (await response.json()) as PullBody,
  };
}

/** Holds the page's live-copy updates until the returned release runs. */
async function holdLiveCopy(page: Page, id: string) {
  const held: Route[] = [];
  const path = (url: URL) =>
    url.pathname === `/_agent-native/collab/${id}/update`;
  await page.route(path, (route) => {
    held.push(route);
  });
  return {
    held,
    release: async () => {
      await page.unroute(path);
      for (const route of held.splice(0))
        await route.continue().catch(() => {});
    },
  };
}

async function openSwitchedPage(page: Page, title: string) {
  const tabs = await TabSet.create(page.context(), { refuseRealtime: false });
  const id = await createPage(page, title, PARAGRAPHS.join("\n"));
  await enterGateArm(page, id);
  await gotoEditor(page, id, { tabs });
  return { tabs, id };
}

test.describe("an open editor's title save on a switched page", () => {
  test.skip(
    GATE_ARM !== "on",
    "Only a page whose body is its live copy asks its editors for the title alone; this runs in the gate-on arm (CONTENT_LIVE_BODY_GATE=on).",
  );

  test("saves the title for a pull while the body's live-copy update is held", async ({
    page,
  }) => {
    const { tabs, id } = await openSwitchedPage(
      page,
      "Title save while the body is held",
    );
    const liveCopy = await holdLiveCopy(page, id);
    const word = `zq${randomUUID().slice(0, 6)}x`;
    try {
      await typeAtParagraphEnd(page, PARAGRAPHS[1]!, ` ${word}`);
      await expect
        .poll(() => liveCopy.held.length, {
          message: "the body's live-copy update is on its way",
        })
        .toBeGreaterThan(0);
      const title = `Pulled ${word}`;
      await page.getByLabel("Document title").fill(title);

      const pulled = await pull(page, id);
      expect(pulled.status, JSON.stringify(pulled.body)).toBe(200);
      expect(pulled.body).toMatchObject({
        title,
        editorFlush: {
          status: "live_copy",
          titleFlush: {
            pages: [
              {
                documentId: id,
                confirmedTitle: title,
                editors: [{ flush: "answered" }],
              },
            ],
          },
        },
      });
      expect(
        pulled.body.content ?? "",
        "the pull waited for the body",
      ).not.toContain(word);
      expect((await getDocument(page, id)).title).toBe(title);

      await liveCopy.release();
      await expect
        .poll(async () => (await getDocument(page, id)).content ?? "", {
          message: "the body lands once its live-copy update goes through",
          timeout: 30_000,
        })
        .toContain(word);
      await expect(page.locator(EDITOR)).toContainText(word);
      expect((await getDocument(page, id)).title).toBe(title);
    } finally {
      await liveCopy.release();
      await tabs.quiet();
      await page.goto("about:blank");
      await postAction(page, "delete-document", { id });
    }
  });

  test("keeps the title it saved when an older title save was still on its way", async ({
    page,
  }) => {
    const { tabs, id } = await openSwitchedPage(
      page,
      "Title save past an older one",
    );
    const committed: string[] = [];
    page.on("requestfinished", async (request) => {
      if (!request.url().includes("/_agent-native/actions/update-document"))
        return;
      const response = await request.response();
      if (!response?.ok()) return;
      const body = (await response.json().catch(() => null)) as {
        title?: unknown;
      } | null;
      if (typeof body?.title === "string") committed.push(body.title);
    });
    const liveCopy = await holdLiveCopy(page, id);
    const word = `zq${randomUUID().slice(0, 6)}x`;
    try {
      await typeAtParagraphEnd(page, PARAGRAPHS[1]!, ` ${word}`);
      await expect.poll(() => liveCopy.held.length).toBeGreaterThan(0);
      const titleInput = page.getByLabel("Document title");
      const older = `Older ${word}`;
      await titleInput.fill(older);
      await titleInput.press("Tab");
      // This save waits on the held body before it sends, so the pull's
      // title save is asked while it is still queued.
      const latest = `Latest ${word}`;
      await titleInput.fill(latest);

      const pulled = await pull(page, id);
      expect(pulled.status, JSON.stringify(pulled.body)).toBe(200);
      expect(
        pulled.body.editorFlush?.titleFlush?.pages[0]?.confirmedTitle,
      ).toBe(latest);
      const committedAtPull = committed.length;

      await liveCopy.release();
      await expect
        .poll(async () => (await getDocument(page, id)).content ?? "", {
          timeout: 30_000,
        })
        .toContain(word);
      await tabs.quiet();
      expect(
        committed.slice(committedAtPull),
        "a title save older than the one the pull confirmed landed after it",
      ).not.toContain(older);
      expect((await getDocument(page, id)).title).toBe(latest);
      await expect(titleInput).toHaveValue(latest);
    } finally {
      await liveCopy.release();
      await tabs.quiet();
      await page.goto("about:blank");
      await postAction(page, "delete-document", { id });
    }
  });
});
