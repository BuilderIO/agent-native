import { beforeEach, describe, expect, it, vi } from "vitest";

const { readClientAppState } = vi.hoisted(() => ({
  readClientAppState: vi.fn(),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState,
}));

import {
  fetchLandingTitleHint,
  landingOptimisticTitle,
  landingTitleHintFromState,
  peekLandingTitleHint,
  resolveOptimisticDocumentTitle,
  stashLandingTitleHint,
  updateLandingTitleHintCache,
} from "./document-title-hint";

describe("landingTitleHintFromState", () => {
  beforeEach(() => {
    readClientAppState.mockReset();
  });

  it("accepts a last-location write that carries a title", () => {
    expect(
      landingTitleHintFromState({
        documentId: "doc-1",
        title: "Quarterly planning notes",
      }),
    ).toEqual({ documentId: "doc-1", title: "Quarterly planning notes" });
  });

  it("rejects older writes and blank or malformed payloads", () => {
    expect(landingTitleHintFromState({ documentId: "doc-1" })).toBeNull();
    expect(
      landingTitleHintFromState({ documentId: "doc-1", title: "  " }),
    ).toBeNull();
    expect(landingTitleHintFromState(null)).toBeNull();
    expect(landingTitleHintFromState(undefined)).toBeNull();
  });

  it("fetches and normalizes the persisted last location", async () => {
    readClientAppState.mockResolvedValue({
      documentId: "doc-1",
      title: "Plan",
    });
    await expect(fetchLandingTitleHint()).resolves.toEqual({
      documentId: "doc-1",
      title: "Plan",
    });
    readClientAppState.mockRejectedValue(new Error("state unavailable"));
    // Failures are not coerced into a fake hint; the caller keeps the skeleton.
    await expect(fetchLandingTitleHint()).rejects.toThrow("state unavailable");
  });
});

describe("landing title stash", () => {
  beforeEach(() => {
    stashLandingTitleHint(null);
  });

  it("hands the title to the exact document the resolver confirmed", () => {
    stashLandingTitleHint({ documentId: "doc-1", title: "Plan" });
    expect(peekLandingTitleHint("doc-1")).toEqual({
      documentId: "doc-1",
      title: "Plan",
    });
    expect(peekLandingTitleHint("doc-2")).toBeNull();
  });

  it("can be cleared between landings", () => {
    stashLandingTitleHint({ documentId: "doc-1", title: "Plan" });
    stashLandingTitleHint(null);
    expect(peekLandingTitleHint("doc-1")).toBeNull();
  });
});

describe("resolveOptimisticDocumentTitle", () => {
  it("prefers the confirmed landing stash over the persisted hint", () => {
    expect(
      resolveOptimisticDocumentTitle({
        documentId: "doc-1",
        stashed: { documentId: "doc-1", title: "Fresh" },
        lastLocation: { documentId: "doc-1", title: "Stale" },
      }),
    ).toBe("Fresh");
  });

  it("falls back to the persisted hint on an exact documentId match", () => {
    expect(
      resolveOptimisticDocumentTitle({
        documentId: "doc-2",
        stashed: { documentId: "doc-1", title: "Other" },
        lastLocation: { documentId: "doc-2", title: "Known" },
      }),
    ).toBe("Known");
  });

  it("never guesses for a document no source matches", () => {
    expect(
      resolveOptimisticDocumentTitle({
        documentId: "doc-3",
        stashed: { documentId: "doc-1", title: "Other" },
        lastLocation: { documentId: "doc-2", title: "Known" },
        cachedTitle: null,
      }),
    ).toBeNull();
  });

  it("uses a seeded cache snapshot only as the last resort", () => {
    expect(
      resolveOptimisticDocumentTitle({
        documentId: "doc-3",
        stashed: null,
        lastLocation: { documentId: "doc-2", title: "Other" },
        cachedTitle: "Seeded",
      }),
    ).toBe("Seeded");
    expect(
      resolveOptimisticDocumentTitle({
        documentId: "doc-3",
        stashed: null,
        lastLocation: { documentId: "doc-3", title: "Known" },
        cachedTitle: "Seeded",
      }),
    ).toBe("Known");
  });

  it("treats blank titles as unknown", () => {
    expect(
      resolveOptimisticDocumentTitle({
        documentId: "doc-1",
        stashed: null,
        lastLocation: { documentId: "doc-1", title: "   " },
        cachedTitle: "  ",
      }),
    ).toBeNull();
  });
});

describe("landingOptimisticTitle", () => {
  it("shows the persisted hint before the resolver returns a documentId", () => {
    expect(
      landingOptimisticTitle(null, {
        documentId: "doc-1",
        title: "Quarterly planning notes",
      }),
    ).toBe("Quarterly planning notes");
    expect(landingOptimisticTitle(null, null)).toBeNull();
    expect(
      landingOptimisticTitle(
        { documentId: "doc-1", title: "Stash" },
        { documentId: "doc-2", title: "Persisted" },
      ),
    ).toBe("Stash");
  });
});

describe("updateLandingTitleHintCache", () => {
  it("refreshes the cached hint only for the matching document", () => {
    const getQueryData = vi.fn(() => ({ documentId: "doc-1", title: "Old" }));
    const setQueryData = vi.fn();
    updateLandingTitleHintCache(
      { getQueryData, setQueryData },
      "doc-1",
      "Renamed",
    );
    expect(setQueryData).toHaveBeenCalledWith(expect.anything(), {
      documentId: "doc-1",
      title: "Renamed",
    });

    setQueryData.mockClear();
    updateLandingTitleHintCache(
      { getQueryData, setQueryData },
      "doc-2",
      "Unrelated",
    );
    expect(setQueryData).not.toHaveBeenCalled();

    updateLandingTitleHintCache({ getQueryData, setQueryData }, "doc-1", " ");
    expect(setQueryData).not.toHaveBeenCalled();
  });
});
