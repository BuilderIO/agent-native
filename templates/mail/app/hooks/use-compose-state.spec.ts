import { describe, expect, it } from "vitest";
import type { ComposeState } from "@shared/types";
import {
  filterRemovedDrafts,
  newestUnseenPopoutDraftId,
} from "./use-compose-state";

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
