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
  liveCopyWritePathConfirmer,
} from "./DocumentEditor";

describe("a save on a page whose body is written through its live copy", () => {
  it("reads as saved only once the server has every live-copy update", () => {
    expect(
      liveCopyBodySaveResult({
        titleSaved: true,
        bodyAcknowledged: false,
        writePathConfirmed: true,
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
        writePathConfirmed: true,
        stillWritesThroughLiveCopy: true,
      }),
    ).toEqual({ contentPersisted: true });
  });

  it("does not read as saved when its title was not", () => {
    expect(
      liveCopyBodySaveResult({
        titleSaved: false,
        bodyAcknowledged: true,
        writePathConfirmed: true,
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
        writePathConfirmed: true,
        stillWritesThroughLiveCopy: false,
      }),
    ).toEqual({ contentPersisted: false, outcome: "superseded" });
  });

  it("does not read as saved while nothing says where the body went", () => {
    expect(
      liveCopyBodySaveResult({
        titleSaved: true,
        bodyAcknowledged: true,
        writePathConfirmed: false,
        stillWritesThroughLiveCopy: true,
      }),
    ).toEqual({
      contentPersisted: false,
      outcome: "pending_collaboration_flush",
    });
  });
});

describe("confirming where a live-copy page's body goes", () => {
  function confirmer(...answers: Array<"live_copy" | "legacy" | Error>) {
    const leave = vi.fn();
    const reads: Array<(value: unknown) => void> = [];
    const readDocument = vi.fn(() => {
      const answer = answers.shift();
      if (answer === undefined)
        return new Promise<{ writePath: "live_copy" }>((resolve) => {
          reads.push(resolve as (value: unknown) => void);
        });
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve({ writePath: answer });
    });
    return {
      leave,
      readDocument,
      reads,
      path: liveCopyWritePathConfirmer({ readDocument, leave }),
    };
  }

  it("does not count a check that failed as confirmed, and asks again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { path, readDocument } = confirmer(
        new Error("offline"),
        new Error("offline"),
        "live_copy",
      );
      path.acknowledge("confirm");
      await expect(path.confirmed()).resolves.toBe(false);
      expect(readDocument).toHaveBeenCalledTimes(2);
      await expect(path.confirmed()).resolves.toBe(true);
      expect(readDocument).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it("checks again for a no-op acknowledgment that arrives during a check", async () => {
    const { path, readDocument, reads, leave } = confirmer();
    path.acknowledge("confirm");
    path.acknowledge("confirm");
    const confirmed = path.confirmed();
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    reads[0]!({ writePath: "live_copy" });
    // The second read finds the server stopped writing the body from the copy.
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    reads[1]!({ writePath: "legacy" });
    await expect(confirmed).resolves.toBe(false);
    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("takes a changed update's acknowledgment as confirmation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { path, readDocument } = confirmer(new Error("offline"));
      path.acknowledge("confirm");
      path.acknowledge("keep");
      await expect(path.confirmed()).resolves.toBe(true);
      expect(readDocument).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
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
