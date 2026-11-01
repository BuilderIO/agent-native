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
import { prefetchCollabState } from "./prefetch.js";

afterEach(() => {
  dropCollabStatePrefetches();
  vi.unstubAllGlobals();
});

it("starts one state read per doc at boot, without the collab client or Yjs", async () => {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response("{}")),
  );
  vi.stubGlobal("fetch", fetchMock);

  prefetchCollabState("doc-1", { baseUrl: "/collab" });
  prefetchCollabState("doc-1", { baseUrl: "/collab" });
  const request = await takeCollabStatePrefetch("/collab", "doc-1");

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/collab/doc-1/state");
  // No saved copy here, so the read asks for the whole state.
  expect(request).toMatchObject({
    account: null,
    localState: null,
    withStateVector: false,
  });
});
