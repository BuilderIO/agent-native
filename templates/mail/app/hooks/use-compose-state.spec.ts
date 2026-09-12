import type { ComposeState } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDraftSaveResult,
  filterRemovedDrafts,
  newestUnseenPopoutDraftId,
  saveDraftToEmailsBestEffort,
} from "./use-compose-state";

vi.mock("@agent-native/core/client/api-path", () => ({
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
        new Response(
          JSON.stringify({
            draftId: "gmail-draft-1",
            backend: "gmail",
            accountEmail: "secondary@example.com",
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        to: "person@example.com",
        body: "Hello",
      }),
    ).resolves.toEqual({
      status: "saved",
      draftId: "gmail-draft-1",
      backend: "gmail",
      accountEmail: "secondary@example.com",
    });
  });

  it("does not accept a save response without backend/account metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ draftId: "gmail-draft-1" }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        body: "Still worth saving",
      }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("reports background draft save failures distinctly", async () => {
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
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("distinguishes an unavailable draft endpoint from a failed save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    await expect(
      saveDraftToEmailsBestEffort({
        ...draft("draft-1"),
        body: "Local-only draft",
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});

describe("applyDraftSaveResult", () => {
  it("retains the saved backend and exact connected account for later deletion", () => {
    expect(
      applyDraftSaveResult(draft("draft-1"), {
        status: "saved",
        draftId: "gmail-draft-1",
        backend: "gmail",
        accountEmail: "secondary@example.com",
      }),
    ).toMatchObject({
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "secondary@example.com",
    });
  });
});
