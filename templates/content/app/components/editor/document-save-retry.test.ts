import { describe, expect, it } from "vitest";

import {
  authoredCandidateMatchesContent,
  pendingSaveRetrySnapshot,
} from "./document-save-retry";

const pending = {
  contentEditVersion: 4,
  editGeneration: 7,
  contentObservationEpoch: 2,
};
const live = {
  ...pending,
  canEdit: true,
  title: "Page",
  content: "Local edit and peer edit",
  contentBase: {
    content: "Peer edit",
    updatedAt: "2026-09-23T00:00:01.000Z",
    revision: "peer-2",
  },
  titleBase: "Page",
};

describe("pending save retry", () => {
  it("retries a superseded authored generation from the latest live observation", () => {
    const observed = {
      ...live,
      contentObservationEpoch: 3,
    };
    expect(
      pendingSaveRetrySnapshot(
        { contentPersisted: false, outcome: "superseded" },
        pending,
        observed,
      ),
    ).toEqual({
      title: observed.title,
      content: observed.content,
      contentBase: observed.contentBase,
      titleBase: observed.titleBase,
      contentObservationEpoch: 3,
    });
    expect(
      authoredCandidateMatchesContent(observed.content, "Local edit"),
    ).toBe(false);
    expect(authoredCandidateMatchesContent("Local edit", "Local edit")).toBe(
      true,
    );
  });

  it("uses a later peer observation when it arrives during the retry delay", () => {
    const failed = {
      contentPersisted: false,
      recoveryDraft: {
        title: "Page",
        content: "Local edit",
        baseContent: "Original",
        baseRevision: "original-1",
      },
    };
    expect(pendingSaveRetrySnapshot(failed, pending, live)?.content).toBe(
      "Local edit",
    );
    expect(
      pendingSaveRetrySnapshot(failed, pending, {
        ...live,
        contentObservationEpoch: 4,
      })?.content,
    ).toBe("Local edit and peer edit");
  });

  it.each(["before old result", "after old result"])(
    "keeps a remote-only observation and its matching base %s",
    (order) => {
      const failed = {
        contentPersisted: false,
        recoveryDraft: {
          title: "Page",
          content: "Local B",
          baseContent: "Old A",
          baseRevision: "old-1",
        },
      };
      const current = {
        ...live,
        content: "Remote A and local B",
        contentBase: {
          content: "Remote A",
          updatedAt: "2026-09-23T00:00:02.000Z",
          revision: "remote-3",
        },
        contentObservationEpoch: pending.contentObservationEpoch + 1,
      };
      if (order === "after old result") {
        expect(
          pendingSaveRetrySnapshot(failed, pending, {
            ...current,
            contentObservationEpoch: pending.contentObservationEpoch,
          }),
        ).toMatchObject({
          content: "Local B",
          contentBase: { content: "Old A", revision: "old-1" },
        });
      }
      expect(pendingSaveRetrySnapshot(failed, pending, current)).toEqual({
        title: "Page",
        content: "Remote A and local B",
        contentBase: current.contentBase,
        titleBase: "Page",
        contentObservationEpoch: current.contentObservationEpoch,
      });
    },
  );

  it("leaves a newer local generation and preservation-required result alone", () => {
    const superseded = {
      contentPersisted: false,
      outcome: "superseded" as const,
    };
    expect(
      pendingSaveRetrySnapshot(superseded, pending, {
        ...live,
        contentObservationEpoch: 3,
        editGeneration: 8,
      }),
    ).toBeNull();
    expect(
      pendingSaveRetrySnapshot(
        { ...superseded, outcome: "pending_preservation" },
        pending,
        { ...live, contentObservationEpoch: 3 },
      ),
    ).toBeNull();
    expect(
      pendingSaveRetrySnapshot({ contentPersisted: true }, pending, {
        ...live,
        contentObservationEpoch: 3,
      }),
    ).toBeNull();
  });
});
