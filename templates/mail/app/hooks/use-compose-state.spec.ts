import type { ComposeState } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterRemovedDrafts,
  newestUnseenPopoutDraftId,
  saveDraftToEmailsBestEffort,
} from "./use-compose-state";

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => path,
  appApiPath: (path: string) => path,
}));

function draft(id: string, inline = false): ComposeState {
  return {
    id,
    to: "",
    subject: "",
    body: "",
    mode: "compose",
    inline,
  };
}

describe("newestUnseenPopoutDraftId", () => {
  it("focuses the newest server-added popout draft", () => {
    expect(
      newestUnseenPopoutDraftId(new Set(["old"]), [
        draft("old"),
        draft("newer"),
      ]),
    ).toBe("newer");
  });

  it("ignores inline reply drafts and keeps focus unchanged", () => {
    expect(
      newestUnseenPopoutDraftId(new Set(["old"]), [
        draft("old"),
        draft("inline-reply", true),
      ]),
    ).toBeNull();
  });
});

describe("filterRemovedDrafts", () => {
  it("keeps a just-discarded draft from reappearing in stale server results", () => {
    expect(
      filterRemovedDrafts([draft("kept"), draft("sent-reply", true)], {
        "sent-reply": Date.now(),
      }).map((item) => item.id),
    ).toEqual(["kept"]);
  });
});

describe("saveDraftToEmailsBestEffort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the saved draft id on success", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ draftId: "gmail-draft-1" }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        to: "person@example.com",
        body: "Hello",
      }),
    ).resolves.toBe("gmail-draft-1");
  });

  it("swallows background draft save failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Gmail failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        body: "Still worth saving",
      }),
    ).resolves.toBeUndefined();
  });
});
