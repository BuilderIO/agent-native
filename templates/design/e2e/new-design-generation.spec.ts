import { expect, test, type Page } from "@playwright/test";

import { appPath } from "./helpers";

/**
 * A brand-new design must generate from its queued prompt, in its own chat.
 *
 * Regression cover for "Chat of the previously created Design was displayed for
 * the new Design": the editor creates the reserved __board__.html on open, which
 * counted as generation output — so the queued prompt was discarded before it
 * was ever submitted — while the chat panel restored the previously created
 * design's thread, leaving that design's run to keep editing itself.
 */

const OPEN_TABS_PREFIX = "agent-chat-open-tabs:design";
const ACTIVE_THREAD_PREFIX = "agent-chat-active-thread:design";

interface ReproEvent {
  t: number;
  kind: string;
  detail?: string;
}

declare global {
  interface Window {
    __repro?: ReproEvent[];
  }
}

async function callAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
): Promise<any> {
  const base = `${new URL(page.url()).origin}/_agent-native/actions/${name}`;
  const res =
    method === "GET"
      ? await page.request.get(
          `${base}?${new URLSearchParams(
            Object.entries(input).map(([k, v]) => [k, String(v)]),
          )}`,
        )
      : await page.request.post(base, {
          data: input,
          headers: { "Content-Type": "application/json" },
        });
  expect(
    res.ok(),
    `${name} failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  return res.json();
}

async function createEmptyDesign(page: Page, title: string): Promise<string> {
  const body = await callAction(page, "create-design", {
    title,
    projectType: "prototype",
  });
  const id: string | undefined = body?.id ?? body?.data?.id;
  expect(id, `no design id in ${JSON.stringify(body)}`).toBeTruthy();
  return id!;
}

/** What the design listing page writes before navigating to the editor. */
async function queuePendingGeneration(
  page: Page,
  designId: string,
  prompt: string,
): Promise<void> {
  await page.evaluate(
    ([id, text]) => {
      window.sessionStorage.setItem(
        `design.pending-generation.${id}`,
        JSON.stringify({ prompt: text, createdAt: Date.now() }),
      );
    },
    [designId, prompt],
  );
}

/** Records the events that decide whether a queued generation survives. */
async function installRecorder(page: Page, designId: string): Promise<void> {
  await page.addInitScript((pendingKey) => {
    const log: ReproEvent[] = [];
    window.__repro = log;
    const record = (kind: string, detail?: string) =>
      log.push({ t: Date.now(), kind, ...(detail ? { detail } : {}) });

    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (key === pendingKey) record("pending-cleared");
      return removeItem.call(this, key);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("agent-chat-active-thread:design")) {
        record("active-chat-thread", value);
      }
      return setItem.call(this, key, value);
    };
    window.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      if (data?.type === "agentNative.submitChat") {
        record("submitChat", String(data.data?.tabId));
      }
    });
  }, `design.pending-generation.${designId}`);
}

async function timeline(page: Page): Promise<ReproEvent[]> {
  return (await page.evaluate(() => window.__repro ?? [])) as ReproEvent[];
}

function formatTimeline(events: ReproEvent[]): string {
  const start = events[0]?.t ?? 0;
  return events
    .map(
      (e) => `  +${e.t - start}ms ${e.kind}${e.detail ? ` ${e.detail}` : ""}`,
    )
    .join("\n");
}

async function waitForSubmit(page: Page, message: string): Promise<ReproEvent> {
  await expect
    .poll(
      async () => (await timeline(page)).some((e) => e.kind === "submitChat"),
      { timeout: 60_000, message },
    )
    .toBe(true);
  const events = await timeline(page);
  return events.find((e) => e.kind === "submitChat")!;
}

test("submits the queued prompt even after the board file lands", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.goto(appPath("/"), { waitUntil: "domcontentloaded" });
  const designId = await createEmptyDesign(page, "Board Race Design");

  // The editor creates __board__.html on open; here that write has already
  // landed, so it cannot be mistaken for "this design already has content".
  await callAction(page, "migrate-board-objects-to-file", { designId });
  const beforeOpen = await callAction(
    page,
    "get-design",
    { id: designId },
    "GET",
  );
  expect(
    (beforeOpen.files ?? []).map((f: { filename: string }) => f.filename),
  ).toEqual(["__board__.html"]);

  await installRecorder(page, designId);
  await queuePendingGeneration(page, designId, "Create a pricing page");
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });

  const submit = await waitForSubmit(
    page,
    "the queued prompt was never submitted to the agent",
  );
  const events = await timeline(page);
  console.log(`\nboard-race timeline:\n${formatTimeline(events)}\n`);

  // The prompt must reach the agent, and must not be dropped before it does.
  const cleared = events.findIndex((e) => e.kind === "pending-cleared");
  const submitted = events.indexOf(submit);
  expect(cleared === -1 || cleared > submitted).toBe(true);
});

test("a new design's editor opens on its own chat, not the previous design's", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.goto(appPath("/"), { waitUntil: "domcontentloaded" });
  const designA = await createEmptyDesign(page, "Thread Design A");
  const designB = await createEmptyDesign(page, "Thread Design B");

  // Design A generates, which opens A's own chat tab.
  await installRecorder(page, designA);
  await queuePendingGeneration(page, designA, "Create a pricing page for A");
  await page.goto(appPath(`/design/${designA}`), {
    waitUntil: "domcontentloaded",
  });
  const submitA = await waitForSubmit(
    page,
    "design A's queued prompt was never submitted",
  );
  const tabA = submitA.detail!;

  // The thread is remembered against design A, not globally.
  await expect
    .poll(
      () =>
        page.evaluate(
          ([prefix, designId]) =>
            window.localStorage.getItem(`${prefix}:scope:design:${designId}`),
          [ACTIVE_THREAD_PREFIX, designA],
        ),
      { timeout: 15_000, message: "design A's thread was never scoped to it" },
    )
    .toBe(tabA);
  const scopedActiveThread = await page.evaluate(
    ([prefix, designId]) =>
      window.localStorage.getItem(`${prefix}:scope:design:${designId}`),
    [ACTIVE_THREAD_PREFIX, designA],
  );
  expect(scopedActiveThread).toBe(tabA);
  expect(
    await page.evaluate(
      (k) => window.localStorage.getItem(k),
      ACTIVE_THREAD_PREFIX,
    ),
  ).toBeNull();

  // Open the brand-new design B.
  await installRecorder(page, designB);
  await queuePendingGeneration(page, designB, "Create a pricing page for B");
  await page.goto(appPath(`/design/${designB}`), {
    waitUntil: "domcontentloaded",
  });

  const submitB = await waitForSubmit(
    page,
    "design B's queued prompt was never submitted",
  );
  // Let the panel settle so the thread it actually keeps is what we assert on.
  await expect
    .poll(
      () =>
        page.evaluate(
          ([prefix, designId]) =>
            window.localStorage.getItem(`${prefix}:scope:design:${designId}`),
          [ACTIVE_THREAD_PREFIX, designB],
        ),
      { timeout: 30_000, message: "design B never recorded its own thread" },
    )
    .toBe(submitB.detail);

  const events = await timeline(page);
  console.log(`\ndesign B editor timeline:\n${formatTimeline(events)}\n`);

  // Design B generates in its own thread, and design A's thread is never
  // activated or typed into here.
  expect(submitB.detail).not.toBe(tabA);
  expect(
    events
      .filter((event) => event.kind === "active-chat-thread")
      .map((event) => event.detail),
  ).not.toContain(tabA);
  expect(
    JSON.parse(
      (await page.evaluate(
        ([prefix, designId]) =>
          window.localStorage.getItem(`${prefix}:scope:design:${designId}`),
        [OPEN_TABS_PREFIX, designB],
      )) ?? "[]",
    ),
  ).not.toContain(tabA);
});
