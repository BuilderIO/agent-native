import { describe, expect, it } from "vitest";

import {
  isPublicDesignViewer,
  shouldShowLocalhostPreviewRecovery,
  shouldShowPublicLocalhostPreviewUnavailable,
} from "./localhost-preview-recovery";

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
        canEdit: false,
        publicVisualEdit: true,
        refreshFailed: true,
        hasUsablePreviewCredentials: true,
      }),
    ).toBe(false);
  });

  it.each([
    ["legacy screen without a connection id", undefined],
    ["connected screen", "local-connection"],
  ])("shows public-unavailable recovery for a %s", (_label, connectionId) => {
    const publicUnavailable = shouldShowPublicLocalhostPreviewUnavailable({
      ...base,
      publicViewer: true,
      serverUnavailable: false,
    });

    expect(publicUnavailable).toBe(true);
    expect(
      shouldShowLocalhostPreviewRecovery({
        ...base,
        connectionId,
        canEdit: false,
        hasUsablePreviewCredentials: true,
        publicUnavailable,
        publicVisualEdit: false,
      }),
    ).toBe(true);
  });

  it("scopes public-unavailable recovery and preserves explicit server errors", () => {
    expect(
      shouldShowPublicLocalhostPreviewUnavailable({
        ...base,
        publicViewer: false,
        serverUnavailable: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPublicLocalhostPreviewUnavailable({
        ...base,
        sourceType: "inline",
        publicViewer: true,
        serverUnavailable: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPublicLocalhostPreviewUnavailable({
        ...base,
        snapshotOnly: true,
        publicViewer: true,
        serverUnavailable: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPublicLocalhostPreviewUnavailable({
        ...base,
        publicViewer: false,
        serverUnavailable: true,
      }),
    ).toBe(true);
  });

  it("recognizes only explicit public viewers, not arbitrary read-only users", () => {
    expect(
      isPublicDesignViewer({
        publicVisualEdit: false,
        visibility: "public",
        accessRole: "viewer",
      }),
    ).toBe(true);
    expect(
      isPublicDesignViewer({
        publicVisualEdit: false,
        visibility: "org",
        accessRole: "viewer",
      }),
    ).toBe(false);
    expect(
      isPublicDesignViewer({
        publicVisualEdit: false,
        visibility: "public",
        accessRole: "commenter",
      }),
    ).toBe(true);
    expect(
      isPublicDesignViewer({
        publicVisualEdit: false,
        visibility: "public",
        accessRole: "editor",
      }),
    ).toBe(false);
    expect(
      isPublicDesignViewer({
        publicVisualEdit: true,
        visibility: "private",
        accessRole: "viewer",
      }),
    ).toBe(true);

    const readOnlyButNotPublicViewer = isPublicDesignViewer({
      publicVisualEdit: false,
      visibility: "org",
      accessRole: "viewer",
    });
    expect(
      shouldShowPublicLocalhostPreviewUnavailable({
        sourceType: "localhost",
        snapshotOnly: false,
        publicViewer: readOnlyButNotPublicViewer,
        serverUnavailable: false,
      }),
    ).toBe(false);
    expect(
      shouldShowLocalhostPreviewRecovery({
        ...base,
        connectionId: undefined,
        canEdit: false,
        publicUnavailable: false,
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
