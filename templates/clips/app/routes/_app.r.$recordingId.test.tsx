// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  mergeRecordingReactions,
  removePendingReaction,
} from "./_app.r.$recordingId";

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
