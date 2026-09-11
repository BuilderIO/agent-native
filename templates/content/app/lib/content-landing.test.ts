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

    await rememberContentLandingDocument("doc-1");

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
