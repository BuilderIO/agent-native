import "./action-query-cache.test-fixtures.js";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { setActionQueryCacheStorage } from "./action-query-cache.js";
import { ActionQueryCacheGate } from "./action-query-cache.js";
import {
  BOB,
  designsResponse,
  memoryStorage,
  mountProbe,
  sessionResponse,
  stubFetch,
  unmountAll,
  waitUntil,
  QueryClient,
} from "./action-query-cache.session-test-fixture.js";
import { isSessionFromFirstRead } from "./use-session.js";

describe("private actual first-read retry guard", () => {
  afterEach(async () => {
    await unmountAll();
    setActionQueryCacheStorage(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("drops a pre-session result when the first readable session arrives on retry", async () => {
    const { storage } = memoryStorage();
    setActionQueryCacheStorage(storage);
    const statuses: Array<{ status: string; userId: string | undefined }> = [];
    const renders: Array<{
      title: string | undefined;
      userId: string | undefined;
      firstRead: boolean;
    }> = [];
    const fetch = stubFetch({
      onSession: (request) =>
        request === 1
          ? new Response("temporarily unavailable", { status: 503 })
          : sessionResponse(BOB),
      onAction: (request) =>
        designsResponse(
          request === 1 ? "unverified-prebind" : "bob-after-retry",
        ),
    });
    const container = await mountProbe(
      ActionQueryCacheGate,
      new QueryClient(),
      ({ title, userId, firstRead }) =>
        renders.push({ title, userId, firstRead }),
      (state) => statuses.push(state),
    );

    expect(
      await waitUntil(
        () => fetch.sessionCount() >= 1 && fetch.actionCount() === 1,
      ),
    ).toBe(true);
    expect(
      await waitUntil(
        () =>
          container.querySelector("[data-result]")?.textContent ===
          "unverified-prebind",
      ),
    ).toBe(true);
    expect(
      await waitUntil(
        () =>
          fetch.sessionCount() === 2 &&
          statuses.some((state) => state.userId === BOB.userId),
        3_000,
      ),
    ).toBe(true);
    expect(
      await waitUntil(
        () =>
          container.querySelector("[data-result]")?.textContent ===
          "bob-after-retry",
      ),
    ).toBe(true);

    expect(isSessionFromFirstRead()).toBe(false);
    expect(fetch.sessionCount()).toBe(2);
    expect(fetch.actionCount()).toBe(2);
    expect(
      renders.some(
        (render) =>
          render.userId === BOB.userId && render.title === "unverified-prebind",
      ),
    ).toBe(false);
    expect(
      renders.some(
        (render) =>
          render.userId === BOB.userId &&
          render.title === "bob-after-retry" &&
          !render.firstRead,
      ),
    ).toBe(true);
    console.log(
      "RETRY_GUARD_TRACE " +
        JSON.stringify({
          sessionRequestCount: fetch.sessionCount(),
          actionRequestCount: fetch.actionCount(),
          renders: renders.map(({ title, userId, firstRead }) => ({
            title,
            userId,
            firstRead,
          })),
          statuses,
        }),
    );
  });
});
