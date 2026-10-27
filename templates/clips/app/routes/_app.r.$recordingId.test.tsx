// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  buildRecordingBreadcrumbItems,
  mergeRecordingReactions,
  recordingAccessView,
  removePendingReaction,
} from "./_app.r.$recordingId";

describe("buildRecordingBreadcrumbItems", () => {
  const labels = {
    libraryLabel: "Library",
    trashLabel: "Trash",
    spacesLabel: "Spaces",
  };

  it("links trashed recordings back to Trash", () => {
    expect(
      buildRecordingBreadcrumbItems({
        ...labels,
        title: "Retired demo",
        trashedAt: "2026-09-22T12:00:00.000Z",
        space: { id: "space-1", name: "Research" },
        folder: { id: "folder-1", name: "Old demos", spaceId: "space-1" },
      }),
    ).toEqual([{ label: "Trash", to: "/trash" }, { label: "Retired demo" }]);
  });

  it("preserves the normal space and folder breadcrumbs", () => {
    expect(
      buildRecordingBreadcrumbItems({
        ...labels,
        title: "Current demo",
        trashedAt: null,
        space: { id: "space-1", name: "Research" },
        folder: { id: "folder-1", name: "Demos", spaceId: "space-1" },
      }),
    ).toEqual([
      { label: "Spaces", to: "/spaces" },
      { label: "Research", to: "/spaces/space-1" },
      { label: "Demos", to: "/spaces/space-1/folder/folder-1" },
      { label: "Current demo" },
    ]);
  });
});

describe("mergeRecordingReactions", () => {
  it("keeps optimistic reactions visible until the server copy arrives", () => {
    const merged = mergeRecordingReactions(
      [{ id: "reaction-1", emoji: "🔥", videoTimestampMs: 42_000 }],
      [
        {
          id: "pending-1",
          emoji: "🔥",
          videoTimestampMs: 42_000,
          recordingId: "recording-1",
        },
      ],
      "recording-1",
    );

    expect(merged).toEqual([
      { id: "reaction-1", emoji: "🔥", videoTimestampMs: 42_000 },
      {
        id: "pending-1",
        emoji: "🔥",
        videoTimestampMs: 42_000,
        recordingId: "recording-1",
      },
    ]);
  });

  it("does not show pending reactions from another recording", () => {
    expect(
      mergeRecordingReactions(
        [],
        [
          {
            id: "pending-a",
            emoji: "🔥",
            videoTimestampMs: 42_000,
            recordingId: "recording-a",
          },
          {
            id: "pending-b",
            emoji: "👏",
            videoTimestampMs: 5_000,
            recordingId: "recording-b",
          },
        ],
        "recording-b",
      ),
    ).toEqual([
      {
        id: "pending-b",
        emoji: "👏",
        videoTimestampMs: 5_000,
        recordingId: "recording-b",
      },
    ]);
  });
});

describe("removePendingReaction", () => {
  it("removes the client-only entry after the server write succeeds", () => {
    expect(
      removePendingReaction(
        [
          {
            id: "pending-1",
            emoji: "🔥",
            videoTimestampMs: 42_000,
            recordingId: "recording-1",
          },
          {
            id: "pending-2",
            emoji: "👏",
            videoTimestampMs: 42_000,
            recordingId: "recording-1",
          },
        ],
        "pending-1",
      ),
    ).toEqual([
      {
        id: "pending-2",
        emoji: "👏",
        videoTimestampMs: 42_000,
        recordingId: "recording-1",
      },
    ]);
  });
});

describe("recordingAccessView", () => {
  it.each([
    [401, false, "share"],
    [403, false, "share"],
    [403, true, "share"],
    [401, true, "retry"],
    [404, false, "page"],
    [500, true, "page"],
    [undefined, false, "page"],
  ] as const)(
    "a %s read with signedIn=%s shows %s",
    (accessStatus, signedIn, view) => {
      expect(
        recordingAccessView({ isPending: false, accessStatus, signedIn }),
      ).toBe(view);
    },
  );

  it("waits on the read before deciding", () => {
    expect(
      recordingAccessView({
        isPending: true,
        accessStatus: undefined,
        signedIn: false,
      }),
    ).toBe("pending");
  });
});
