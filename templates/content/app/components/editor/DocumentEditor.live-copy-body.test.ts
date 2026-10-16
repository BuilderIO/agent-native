import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import {
  confirmLiveCopyWritePath,
  liveCopyAcknowledgmentAction,
  liveCopyBodySaveResult,
  liveCopyTitleSave,
} from "./DocumentEditor";

describe("a save on a page whose body is written through its live copy", () => {
  it("reads as saved only once the server has every live-copy update", () => {
    expect(
      liveCopyBodySaveResult({
        titleSaved: true,
        bodyAcknowledged: false,
        stillWritesThroughLiveCopy: true,
      }),
    ).toEqual({
      contentPersisted: false,
      outcome: "pending_collaboration_flush",
    });
    expect(
      liveCopyBodySaveResult({
        titleSaved: true,
        bodyAcknowledged: true,
        stillWritesThroughLiveCopy: true,
      }),
    ).toEqual({ contentPersisted: true });
  });

  it("does not read as saved when its title was not", () => {
    expect(
      liveCopyBodySaveResult({
        titleSaved: false,
        bodyAcknowledged: true,
        stillWritesThroughLiveCopy: true,
      }),
    ).toEqual({ contentPersisted: false });
  });

  it("hands the body to the legacy save queued when the page left its live copy", () => {
    // Even an acknowledged update did not reach the stored body.
    expect(
      liveCopyBodySaveResult({
        titleSaved: true,
        bodyAcknowledged: true,
        stillWritesThroughLiveCopy: false,
      }),
    ).toEqual({ contentPersisted: false, outcome: "superseded" });
  });
});

describe("an acknowledgment on a page whose body is written through its live copy", () => {
  it("leaves the live copy when the server no longer writes the body from it", () => {
    expect(
      liveCopyAcknowledgmentAction({
        liveCopy: "not_derived",
        liveCopyReason: "flag_off",
      }),
    ).toBe("leave");
  });

  it("checks where the body goes when an update changed nothing", async () => {
    // A resend the server already applied cannot report not_derived.
    expect(liveCopyAcknowledgmentAction({ liveCopy: "unchanged" })).toBe(
      "confirm",
    );
    await expect(
      confirmLiveCopyWritePath(async () => ({ writePath: "legacy" })),
    ).resolves.toBe(false);
    await expect(
      confirmLiveCopyWritePath(async () => ({ writePath: "live_copy" })),
    ).resolves.toBe(true);
  });

  it("fails a check on a page that does not say how its body is written", async () => {
    await expect(confirmLiveCopyWritePath(async () => ({}))).rejects.toThrow(
      "The page did not say how its body is written.",
    );
    await expect(confirmLiveCopyWritePath(async () => null)).rejects.toThrow(
      "The page did not say how its body is written.",
    );
  });

  it("keeps the live copy after a derived or unreported outcome", () => {
    expect(liveCopyAcknowledgmentAction({ liveCopy: "derived" })).toBe("keep");
    expect(liveCopyAcknowledgmentAction({ liveCopy: null })).toBe("keep");
  });
});

describe("a title save on a page whose body is written through its live copy", () => {
  it("sends an edited title against the title it last saved", () => {
    // The page's body commits moved its updatedAt; the title did not move.
    expect(
      liveCopyTitleSave({
        title: "Renamed",
        lastSavedTitle: "Plan",
        documentTitle: "Plan",
        titleBase: undefined,
      }),
    ).toEqual({ send: true, titleBase: "Plan" });
  });

  it("does not send over a title another writer renamed, and says so", () => {
    expect(
      liveCopyTitleSave({
        title: "Mine",
        lastSavedTitle: "Plan",
        documentTitle: "Theirs",
        titleBase: undefined,
      }),
    ).toEqual({ send: false, renamedElsewhere: true });
    expect(
      liveCopyTitleSave({
        title: "Mine",
        lastSavedTitle: "Plan",
        documentTitle: "Plan",
        titleBase: "Draft",
      }),
    ).toEqual({ send: false, renamedElsewhere: true });
  });

  it("sends nothing for a title it already saved", () => {
    expect(
      liveCopyTitleSave({
        title: "Plan",
        lastSavedTitle: "Plan",
        documentTitle: "Theirs",
        titleBase: undefined,
      }),
    ).toEqual({ send: false, renamedElsewhere: false });
  });
});
