// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

// A page's boot imports this entry; the collab client and Yjs must stay out
// of that import.
vi.mock("../../collab/client.js", () => {
  throw new Error("the boot entry loaded the collab client");
});
vi.mock("yjs", () => {
  throw new Error("the boot entry loaded Yjs");
});

import {
  dropCollabStatePrefetches,
  takeCollabStatePrefetch,
} from "../../collab/state-prefetch.js";
import {
  announceSessionInvalidated,
  recordSessionIdentity,
} from "../session-identity.js";
import { prefetchCollabState } from "./prefetch.js";

afterEach(() => {
  dropCollabStatePrefetches();
  recordSessionIdentity(undefined);
  vi.unstubAllGlobals();
});

it("starts one state read per doc at boot, without the collab client or Yjs", async () => {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response("{}")),
  );
  vi.stubGlobal("fetch", fetchMock);

  prefetchCollabState("doc-1", { baseUrl: "/collab" });
  prefetchCollabState("doc-1", { baseUrl: "/collab" });
  // The session read that runs beside it names whose answer it is.
  recordSessionIdentity("ada@example.com");
  const taken = takeCollabStatePrefetch("/collab", "doc-1");
  const request = await taken?.request;

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/collab/doc-1/state");
  // No saved copy here, so the read asks for the whole state.
  expect(request).toMatchObject({
    account: null,
    localState: null,
    withStateVector: false,
  });
});

it("reports no failure of a read until someone takes it", async () => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  // Not a vi.fn: it handles the rejections of the promises it returns.
  let asked = false;
  vi.stubGlobal("fetch", () => {
    asked = true;
    return Promise.reject(new TypeError("offline"));
  });

  prefetchCollabState("doc-1", { baseUrl: "/collab" });
  await vi.waitFor(() => expect(asked).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", unhandled);

  expect(unhandled).not.toHaveBeenCalled();
  recordSessionIdentity("ada@example.com");
  const taken = takeCollabStatePrefetch("/collab", "doc-1");
  const request = await taken?.request;
  await expect(request?.response).rejects.toThrow("offline");
});

it("makes no boot read for a tab known to be signed out", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  recordSessionIdentity(null);

  prefetchCollabState("doc-1", { baseUrl: "/collab" });

  expect(fetchMock).not.toHaveBeenCalled();
  expect(takeCollabStatePrefetch("/collab", "doc-1")).toBeUndefined();
});

it("gives a boot read up once the tab's session changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response("{}"))),
  );
  recordSessionIdentity("ada@example.com");
  prefetchCollabState("doc-1", { baseUrl: "/collab" });
  const taken = takeCollabStatePrefetch("/collab", "doc-1");
  expect(taken?.isCurrent()).toBe(true);

  recordSessionIdentity("bob@example.com");
  expect(taken?.isCurrent()).toBe(false);
  // Any change gives it up for good, even back to the session it was made under.
  recordSessionIdentity("ada@example.com");
  expect(taken?.isCurrent()).toBe(false);
});

it("gives a taken read up on an organization switch, however long it has been out", () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    recordSessionIdentity("ada@example.com");
    prefetchCollabState("doc-1", { baseUrl: "/collab" });
    const taken = takeCollabStatePrefetch("/collab", "doc-1");

    vi.advanceTimersByTime(60_000);
    expect(taken?.isCurrent()).toBe(true);

    // The account stays the same, so only the invalidation can tell.
    announceSessionInvalidated();
    expect(taken?.isCurrent()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
