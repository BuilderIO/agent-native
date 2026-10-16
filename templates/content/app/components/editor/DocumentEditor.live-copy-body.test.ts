import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { liveCopyBodySaveResult } from "./DocumentEditor";

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
