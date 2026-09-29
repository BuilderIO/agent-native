// @vitest-environment happy-dom

import { getEmbedAuthToken } from "@agent-native/core/client/host";
import { EMBED_TOKEN_QUERY_PARAM } from "@agent-native/core/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LABELS_QUERY_KEY } from "@/hooks/use-emails";
import { INBOX_THREADS_QUERY_KEY } from "@/hooks/use-inbox-threads";
import { shouldInvalidateMailQueryForActionEvent } from "@/lib/sync-invalidation";

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  getEmbedAuthToken: vi.fn(() => null),
}));

import {
  computeSessionBypass,
  createMailSyncEventHandler,
  isPrivateInboxPath,
} from "./root";

describe("computeSessionBypass", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.mocked(getEmbedAuthToken).mockReturnValue(null);
  });

  it("does not bypass for the bare embedded=1 flag with no token", () => {
    window.history.replaceState(null, "", "/inbox?embedded=1&chatFirst=1");
    expect(computeSessionBypass()).toBe(false);
  });

  it("bypasses when a real embed token is present", () => {
    vi.mocked(getEmbedAuthToken).mockReturnValue("signed-token");
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
    );
    expect(computeSessionBypass()).toBe(true);
  });
});

describe("isPrivateInboxPath", () => {
  it.each([
    "/inbox",
    "/inbox/thread-1",
    "/all",
    "/all/thread-1",
    "/unread/thread-1",
  ])("opts in for %s", (pathname) => {
    expect(isPrivateInboxPath(pathname)).toBe(true);
  });

  it.each(["/email", "/settings", "/home", "/unknown/thread-1"])(
    "keeps %s out of background sync",
    (pathname) => {
      expect(isPrivateInboxPath(pathname)).toBe(false);
    },
  );
});

describe("createMailSyncEventHandler", () => {
  it("refreshes Mail's raw queries after an agent action mutation", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const handleEvent = createMailSyncEventHandler(queryClient);

    handleEvent({
      source: "action",
      type: "action-change",
      key: "archive-email",
    });
    await Promise.resolve();

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([["emails"], ["email"], LABELS_QUERY_KEY]),
    );
    queryClient.clear();
  });
});

describe("shouldInvalidateMailQueryForActionEvent", () => {
  it("matches list-inbox-threads and list-labels action queries", () => {
    expect(
      shouldInvalidateMailQueryForActionEvent({
        queryKey: INBOX_THREADS_QUERY_KEY,
      }),
    ).toBe(true);
    expect(
      shouldInvalidateMailQueryForActionEvent({ queryKey: LABELS_QUERY_KEY }),
    ).toBe(true);
  });

  it("ignores non-action query keys", () => {
    expect(
      shouldInvalidateMailQueryForActionEvent({ queryKey: ["emails"] }),
    ).toBe(false);
  });
});
