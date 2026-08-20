import { describe, expect, it } from "vitest";

import { classifyLocalSourceRead } from "./local-source-write-state";
import {
  localSourceRevisionForQueuedEdit,
  localSourceRevisionForSave,
} from "./local-source-write-state";

const baseline = {
  diskTitle: "Round-trip acceptance",
  diskContent: "The lantern is blue.",
  localContent: "The lantern is blue.",
  lastSavedTitle: "Round-trip acceptance",
  lastSavedContent: "The lantern is blue.",
  pendingWrite: null,
};

describe("classifyLocalSourceRead", () => {
  it("recognizes the exact in-flight Content write", () => {
    expect(
      classifyLocalSourceRead({
        ...baseline,
        diskContent: "The lantern glows amber.",
        localContent: "The lantern glows amber.",
        pendingWrite: {
          title: baseline.diskTitle,
          content: "The lantern glows amber.",
        },
      }),
    ).toBe("pending-self-write");
  });

  it("does not suppress a different external write during an in-flight save", () => {
    expect(
      classifyLocalSourceRead({
        ...baseline,
        diskContent: "An external editor changed this.",
        localContent: "The lantern glows amber.",
        pendingWrite: {
          title: baseline.diskTitle,
          content: "The lantern glows amber.",
        },
      }),
    ).toBe("conflict");
  });

  it("treats a queued debounce as unsaved even before refs reconcile", () => {
    expect(
      classifyLocalSourceRead({
        ...baseline,
        diskContent: "An external editor changed this.",
        hasPendingSave: true,
      }),
    ).toBe("conflict");
  });

  it("adopts an external change when the editor has no unsaved work", () => {
    expect(
      classifyLocalSourceRead({
        ...baseline,
        diskContent: "An external editor changed this.",
      }),
    ).toBe("external-change");
  });

  it("leaves an unchanged disk snapshot alone", () => {
    expect(classifyLocalSourceRead(baseline)).toBe("unchanged");
  });
});

describe("localSourceRevisionForSave", () => {
  it("keeps the revision captured when an edit was queued", () => {
    expect(localSourceRevisionForSave("old-revision", "new-revision")).toBe(
      "old-revision",
    );
  });

  it("uses the current revision for an immediate save", () => {
    expect(localSourceRevisionForSave(undefined, "current-revision")).toBe(
      "current-revision",
    );
  });

  it("preserves a queued missing baseline", () => {
    expect(localSourceRevisionForSave(null, "new-revision")).toBeNull();
  });
});

describe("localSourceRevisionForQueuedEdit", () => {
  it("keeps the first revision across a continuing debounced edit", () => {
    expect(
      localSourceRevisionForQueuedEdit("first-revision", "new-revision"),
    ).toBe("first-revision");
    expect(localSourceRevisionForQueuedEdit(null, "new-revision")).toBeNull();
  });

  it("captures the current revision for the first edit", () => {
    expect(
      localSourceRevisionForQueuedEdit(undefined, "current-revision"),
    ).toBe("current-revision");
  });
});
