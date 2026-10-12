import "./action-query-cache.test-fixtures.js";
import { act } from "react";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ActionQueryCacheGate,
  setActionQueryCacheStorage,
} from "./action-query-cache.js";
import {
  ALICE,
  BOB,
  designsResponse,
  memoryStorage,
  mountProbe,
  sessionResponse,
  settle,
  stubFetch,
  unmountAll,
  waitUntil,
  QueryClient,
} from "./action-query-cache.session-test-fixture.js";
import {
  isSessionFromFirstRead,
  notifySessionInvalidated,
} from "./use-session.js";

describe("session cache lifecycle", () => {
  afterEach(async () => {
    await unmountAll();
    setActionQueryCacheStorage(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps same-scope results through a reread and clears them on an A-to-B switch", async () => {
    const { storage } = memoryStorage();
    setActionQueryCacheStorage(storage);
    let releaseInitialSession!: (response: Response) => void;
    let activeUser = ALICE.userId;
    const fetch = stubFetch({
      onSession: (request) => {
        if (request === 1) {
          return new Promise<Response>((resolve) => {
            releaseInitialSession = resolve;
          });
        }
        activeUser = request === 3 ? BOB.userId! : ALICE.userId!;
        return sessionResponse(request === 3 ? BOB : ALICE);
      },
      onAction: (request) =>
        designsResponse(
          activeUser === BOB.userId
            ? `bob-result-${request}`
            : `alice-result-${request}`,
        ),
    });
    const renders: Array<{
      title: string | undefined;
      userId: string | undefined;
      firstRead: boolean;
    }> = [];
    const statuses: Array<{ status: string; userId: string | undefined }> = [];
    const container = await mountProbe(
      ActionQueryCacheGate,
      new QueryClient(),
      ({ title, userId, firstRead }) =>
        renders.push({ title, userId, firstRead }),
      (state) => statuses.push(state),
    );

    expect(
      await waitUntil(
        () => fetch.sessionCount() === 1 && fetch.actionCount() >= 1,
      ),
    ).toBe(true);
    expect(
      await waitUntil(
        () =>
          container.querySelector("[data-result]")?.textContent !== "pending",
      ),
    ).toBe(true);
    await waitUntil(() => typeof releaseInitialSession === "function");
    releaseInitialSession(sessionResponse(ALICE));
    expect(
      await waitUntil(
        () =>
          isSessionFromFirstRead() &&
          statuses.some((state) => state.userId === ALICE.userId),
      ),
    ).toBe(true);
    await settle(100);

    const initialActionCount = fetch.actionCount();
    const aliceNode = container.querySelector("[data-result]");
    expect(aliceNode?.textContent).toBe(`alice-result-${initialActionCount}`);

    await act(async () => {
      await notifySessionInvalidated();
    });
    expect(isSessionFromFirstRead()).toBe(false);
    await settle(100);
    expect(fetch.sessionCount()).toBe(2);
    expect(fetch.actionCount()).toBe(initialActionCount);
    expect(container.querySelector("[data-result]")).toBe(aliceNode);
    const sameUserActionCount = fetch.actionCount();
    const sameScopeNodePreserved =
      container.querySelector("[data-result]") === aliceNode;

    await act(async () => {
      await notifySessionInvalidated();
    });
    expect(
      await waitUntil(
        () =>
          fetch.sessionCount() === 3 &&
          statuses.some((state) => state.userId === BOB.userId),
      ),
    ).toBe(true);
    expect(
      await waitUntil(
        () =>
          container
            .querySelector("[data-result]")
            ?.textContent.startsWith("bob-result-") === true,
      ),
    ).toBe(true);
    expect(fetch.actionCount()).toBe(initialActionCount + 1);
    expect(container.querySelector("[data-result]")).not.toBe(aliceNode);
    expect(
      renders
        .filter((render) => render.userId === BOB.userId)
        .every(
          (render) => render.title !== `alice-result-${initialActionCount}`,
        ),
    ).toBe(true);
    expect(statuses.some((state) => state.userId === ALICE.userId)).toBe(true);
    expect(statuses.some((state) => state.userId === BOB.userId)).toBe(true);
    console.log(
      "CANDIDATE_GATE_TRACE " +
        JSON.stringify({
          actionCountAtInitialSameScope: initialActionCount,
          actionCountAfterSameUserReread: sameUserActionCount,
          actionCountAfterAccountSwitch: fetch.actionCount(),
          sameScopeResultNodePreserved: sameScopeNodePreserved,
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
