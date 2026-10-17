import { randomUUID } from "node:crypto";

import { expect, test, type Page, type Route } from "@playwright/test";

import {
  ACTION_HEADERS,
  EDITOR,
  createPage,
  delay,
  getDocument,
  gotoEditor,
  postAction,
  typeAtParagraphEnd,
} from "../helpers";

// An agent that moves or restores a switched page asks its open editor for
// the title alone. The body goes through the live copy, whose server
// acknowledgment can take longer than the agent waits, so a title flush has
// to answer while the body is still unacknowledged.
const GATE = process.env.CONTENT_LIVE_BODY_GATE ?? "off";
const FLAGS = ["content.live-body-shadow", "content.live-body-writer"];
const PARAGRAPHS = [
  "Alpha paragraph before the title flush.",
  "Bravo paragraph before the title flush.",
];
const STATE_HEADERS = {
  ...ACTION_HEADERS,
  "X-Agent-Native-CSRF": "1",
  "X-Request-Source": "agent",
};

async function switchToLiveCopy(page: Page, id: string): Promise<void> {
  for (const key of FLAGS)
    await postAction(page, "set-feature-flag", {
      operation: "enable-for-current-user",
      key,
    });
  const capability = await page.request.get("/_agent-native/ui-capability", {
    headers: ACTION_HEADERS,
  });
  expect(
    capability.ok(),
    `ui-capability (${capability.status()}): ${await capability.text()}`,
  ).toBe(true);
  const response = await page.request.post(
    "/_agent-native/actions/set-live-body-switch",
    {
      data: { id, switched: true },
      headers: { ...ACTION_HEADERS, Origin: new URL(capability.url()).origin },
    },
  );
  const text = await response.text();
  expect(
    response.ok(),
    `set-live-body-switch (${response.status()}): ${text}`,
  ).toBe(true);
  expect((JSON.parse(text) as { writePath?: string }).writePath).toBe(
    "live_copy",
  );
}

/**
 * Asks the open editor to flush, as the server does, and returns its answer,
 * or null when none comes in the time the server waits.
 */
async function requestFlush(
  page: Page,
  id: string,
  request: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const path = `/_agent-native/application-state/flush-request-${id}`;
  const requestId = randomUUID();
  const written = await page.request.put(path, {
    data: { id, ts: Date.now(), requestId, status: "pending", ...request },
    headers: STATE_HEADERS,
  });
  expect(
    written.ok(),
    `flush request (${written.status()}): ${await written.text()}`,
  ).toBe(true);
  // The server waits this long for an answer.
  const deadline = Date.now() + 4_000;
  let answer: Record<string, unknown> | null = null;
  while (!answer && Date.now() < deadline) {
    await delay(200);
    const read = await page.request.get(path, { headers: STATE_HEADERS });
    const value = (await read.json()) as Record<string, unknown> | null;
    if (value?.requestId === requestId && value.status !== "pending")
      answer = value;
  }
  await page.request.delete(path, { headers: STATE_HEADERS });
  return answer;
}

test.describe("a title flush on a switched page", () => {
  test.skip(
    GATE !== "on",
    "Only a switched page writes through its live copy; this runs in the gate-on arm (CONTENT_LIVE_BODY_GATE=on).",
  );

  // No flush request reaches the open editor, so every requestFlush here gets
  // no answer: the editor reads its mailbox when useDbSync reports a change to
  // it, and since #6272 a useDbSync with no realtime opt-in gets no server
  // events. With that wake simulated, this passes.
  test.fixme("saves the title while the body's acknowledgment is held, and refuses a scope it does not know", async ({
    page,
  }) => {
    const id = await createPage(
      page,
      "Title flush on a switched page",
      PARAGRAPHS.join("\n"),
    );
    await switchToLiveCopy(page, id);
    await gotoEditor(page, id);

    const held: Route[] = [];
    const collabUpdate = (url: URL) =>
      url.pathname === `/_agent-native/collab/${id}/update`;
    await page.route(collabUpdate, (route) => {
      held.push(route);
    });

    const word = `zq${randomUUID().slice(0, 6)}x`;
    await typeAtParagraphEnd(page, PARAGRAPHS[1], ` ${word}`);
    await expect
      .poll(() => held.length, {
        message: "the body's live-copy update is on its way",
      })
      .toBeGreaterThan(0);

    const titleInput = page.getByLabel("Document title");
    const firstTitle = `First ${word}`;
    await titleInput.fill(firstTitle);
    await titleInput.press("Tab");
    // The editor sends a title before it waits on the body, so this one lands.
    await expect
      .poll(async () => (await getDocument(page, id)).title)
      .toBe(firstTitle);
    // The editor's next title save queues behind that wait, which lasts up to
    // COLLAB_FLUSH_BEFORE_SAVE_MS, so the flush has to arrive inside it to be
    // the one that saves.
    const title = `Second ${word}`;
    await titleInput.fill(title);

    expect(await requestFlush(page, id, { scope: "title" })).toEqual(
      expect.objectContaining({
        scope: "title",
        status: "success",
        saved: true,
      }),
    );
    expect((await getDocument(page, id)).title).toBe(title);
    expect(
      (await getDocument(page, id)).content ?? "",
      "the body is still unacknowledged",
    ).not.toContain(word);

    const saves: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/_agent-native/actions/update-document"))
        saves.push(request.postData());
    });
    expect(await requestFlush(page, id, { scope: "body" })).toEqual(
      expect.objectContaining({
        scope: "body",
        status: "error",
        code: "unsupported_scope",
      }),
    );
    expect(saves, "an unknown scope sent a save").toEqual([]);
    // What a title flush exists for: a whole flush waits on the body.
    expect(
      await requestFlush(page, id, {}),
      "a whole flush answered while the body was held",
    ).toBeNull();

    await page.unroute(collabUpdate);
    for (const route of held) await route.continue().catch(() => {});
    await expect
      .poll(async () => (await getDocument(page, id)).content ?? "", {
        message: "the body lands once the live copy is acknowledged",
        timeout: 30_000,
      })
      .toContain(word);
    await expect(page.locator(EDITOR)).toContainText(word);
  });
});
