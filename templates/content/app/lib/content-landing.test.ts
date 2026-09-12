import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeClientAppState } = vi.hoisted(() => ({
  writeClientAppState: vi.fn(),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState,
}));

import {
  contentLandingRecoveryTarget,
  readContentLandingRecovery,
  rememberContentLandingDocument,
} from "./content-landing";

describe("rememberContentLandingDocument", () => {
  beforeEach(() => {
    writeClientAppState.mockReset();
  });

  it("stores the successfully loaded page separately from agent navigation", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument("doc-1");

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v1",
      { documentId: "doc-1" },
      { requestSource: "content-landing" },
    );
  });

  it("records the title so the next landing can paint it optimistically", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument("doc-1", "Quarterly planning notes");

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v1",
      { documentId: "doc-1", title: "Quarterly planning notes" },
      { requestSource: "content-landing" },
    );
  });

  it("omits blank titles instead of recording an unusable hint", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument("doc-1", "   ");

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v1",
      { documentId: "doc-1" },
      { requestSource: "content-landing" },
    );
  });

  it("preserves navigation order when an earlier write is slower", async () => {
    let finishFirst!: (value: { documentId: string }) => void;
    writeClientAppState
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ documentId: "doc-2" });

    const first = rememberContentLandingDocument("doc-1");
    const second = rememberContentLandingDocument("doc-2");
    await vi.waitFor(() =>
      expect(writeClientAppState).toHaveBeenCalledTimes(1),
    );

    finishFirst({ documentId: "doc-1" });
    await Promise.all([first, second]);

    expect(writeClientAppState.mock.calls.map(([, value]) => value)).toEqual([
      { documentId: "doc-1" },
      { documentId: "doc-2" },
    ]);
  });

  it("leaves write failures observable to the caller", async () => {
    writeClientAppState.mockRejectedValue(new Error("state unavailable"));

    await expect(rememberContentLandingDocument("doc-1")).rejects.toThrow(
      "state unavailable",
    );
  });
});

describe("contentLandingRecoveryTarget", () => {
  it("sends an unavailable full-page deep link to the landing resolver", () => {
    expect(
      contentLandingRecoveryTarget({ host: "page", documentId: "inbox" }),
    ).toEqual({
      pathname: "/home",
      state: { unavailableDocumentId: "inbox" },
    });
  });

  it("leaves an embedded preview on its inline unavailable state", () => {
    expect(
      contentLandingRecoveryTarget({ host: "preview", documentId: "inbox" }),
    ).toBeNull();
  });

  it("does not redirect without a requested document", () => {
    expect(
      contentLandingRecoveryTarget({ host: "page", documentId: "" }),
    ).toBeNull();
  });
});

describe("readContentLandingRecovery", () => {
  it("reads the handoff written by the redirect", () => {
    expect(
      readContentLandingRecovery({ unavailableDocumentId: "inbox" }),
    ).toEqual({ unavailableDocumentId: "inbox" });
  });

  it("keeps a plain landing visit distinguishable from a recovery", () => {
    for (const state of [
      null,
      undefined,
      "inbox",
      {},
      { unavailableDocumentId: "" },
      { unavailableDocumentId: 7 },
    ]) {
      expect(readContentLandingRecovery(state)).toBeNull();
    }
  });
});
