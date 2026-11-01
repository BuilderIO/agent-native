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
import { recordSessionIdentity } from "../session-identity.js";
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
