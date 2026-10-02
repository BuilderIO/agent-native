import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeClientAppState } = vi.hoisted(() => ({
  writeClientAppState: vi.fn(),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState,
}));

import { rememberContentLandingDocument } from "./content-landing";

describe("rememberContentLandingDocument", () => {
  beforeEach(() => {
    writeClientAppState.mockReset();
  });

  it("stores the successfully loaded page separately from agent navigation", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument({ documentId: "doc-1" });

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

    const first = rememberContentLandingDocument({ documentId: "doc-1" });
    const second = rememberContentLandingDocument({ documentId: "doc-2" });
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

    await expect(
      rememberContentLandingDocument({ documentId: "doc-1" }),
    ).rejects.toThrow("state unavailable");
  });

  it("records each page open where /home returns as well as in its space", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument(
      { documentId: "doc-1", title: "Plan" },
      "space-1",
    );

    expect(writeClientAppState).toHaveBeenCalledTimes(2);
    for (const key of [
      "content-last-location-v1",
      "content-last-location-v2:space-1",
    ]) {
      expect(writeClientAppState).toHaveBeenCalledWith(
        key,
        { documentId: "doc-1", title: "Plan" },
        { requestSource: "content-landing" },
      );
    }
  });

  it("stores exact destinations separately for each Content space", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument(
      { documentId: "doc-1", databaseId: "db-1", viewId: "view-1" },
      "space-1",
    );

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v2:space-1",
      { documentId: "doc-1", databaseId: "db-1", viewId: "view-1" },
      { requestSource: "content-landing" },
    );
  });
});
