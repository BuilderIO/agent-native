import { describe, expect, it } from "vitest";

import { creationSaveBarrierIsSettled } from "./creation-save-barrier";

const settled = {
  saveQueueUnchanged: true,
  editGenerationUnchanged: true,
  hasPendingSave: false,
  hasDebounceTimer: false,
  hasRetry: false,
  hasCollaborationSeedBody: true,
  activeContentSaveCount: 0,
  pendingPersistenceCount: 0,
  localTitle: "Title",
  savedTitle: "Title",
  documentTitle: "Title",
  localContent: "Body",
  savedContent: "Body",
  documentContent: "Body",
};

describe("creationSaveBarrierIsSettled", () => {
  it("releases collaboration after the latest edit and save queue settle", () => {
    expect(creationSaveBarrierIsSettled(settled)).toBe(true);
  });

  it.each([
    { saveQueueUnchanged: false },
    { editGenerationUnchanged: false },
    { hasPendingSave: true },
    { hasDebounceTimer: true },
    { hasRetry: true },
    { hasCollaborationSeedBody: false },
    { activeContentSaveCount: 1 },
    { pendingPersistenceCount: 1 },
    { localTitle: "New title" },
    { documentTitle: "Stale title" },
    { localContent: "New body" },
    { documentContent: "Stale body" },
  ])("keeps the hold while save state is unsettled: %o", (change) => {
    expect(creationSaveBarrierIsSettled({ ...settled, ...change })).toBe(false);
  });
});
