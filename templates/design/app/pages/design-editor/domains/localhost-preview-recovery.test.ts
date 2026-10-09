import { describe, expect, it } from "vitest";

import { shouldShowLocalhostPreviewRecovery } from "./localhost-preview-recovery";

const base = {
  sourceType: "localhost",
  connectionId: "local-connection",
  snapshotOnly: false,
  refreshFailed: false,
  hasUsablePreviewCredentials: false,
  connectionUnavailable: false,
  canEdit: true,
  publicUnavailable: false,
  publicVisualEdit: false,
};

describe("shouldShowLocalhostPreviewRecovery", () => {
  it("shows recovery when a legacy localhost screen has no connection id", () => {
    expect(
      shouldShowLocalhostPreviewRecovery({ ...base, connectionId: undefined }),
    ).toBe(true);
  });

  it("shows retry recovery when refreshing localhost credentials fails", () => {
    expect(
      shouldShowLocalhostPreviewRecovery({ ...base, refreshFailed: true }),
    ).toBe(true);
  });

  it("keeps a cached preview running when refreshing credentials fails", () => {
    expect(
      shouldShowLocalhostPreviewRecovery({
        ...base,
        refreshFailed: true,
        hasUsablePreviewCredentials: true,
      }),
    ).toBe(false);
  });

  it("keeps a failed public preview refresh recoverable", () => {
    expect(
      shouldShowLocalhostPreviewRecovery({
        ...base,
        canEdit: false,
        publicVisualEdit: true,
        refreshFailed: true,
      }),
    ).toBe(true);
  });

  it("keeps snapshot-only and non-localhost screens out of the recovery state", () => {
    expect(
      shouldShowLocalhostPreviewRecovery({ ...base, snapshotOnly: true }),
    ).toBe(false);
    expect(
      shouldShowLocalhostPreviewRecovery({ ...base, sourceType: "inline" }),
    ).toBe(false);
  });

  it("preserves the existing access rules for backend unavailable statuses", () => {
    expect(
      shouldShowLocalhostPreviewRecovery({
        ...base,
        canEdit: false,
        connectionUnavailable: true,
      }),
    ).toBe(false);
    expect(
      shouldShowLocalhostPreviewRecovery({
        ...base,
        canEdit: false,
        connectionUnavailable: true,
        publicUnavailable: true,
      }),
    ).toBe(true);
  });
});
