import { describe, expect, it } from "vitest";

import {
  dedupeRecordingsById,
  getLiveRecordingBatch,
  patchRecordingTitleInListData,
  recordingsRefetchInterval,
} from "./use-library";

describe("dedupeRecordingsById", () => {
  it("keeps the first recording when offset pages overlap", () => {
    expect(
      dedupeRecordingsById([
        { id: "rec_1", title: "First page" },
        { id: "rec_2", title: "Second page" },
        { id: "rec_2", title: "Duplicate page" },
      ]),
    ).toEqual([
      { id: "rec_1", title: "First page" },
      { id: "rec_2", title: "Second page" },
    ]);
  });
});

describe("getLiveRecordingBatch", () => {
  it("selects a deduped batch of active recordings for status polling", () => {
    expect(
      getLiveRecordingBatch({
        pages: [
          {
            recordings: [
              { id: "rec_uploading", status: "uploading" } as any,
              { id: "rec_uploading", status: "uploading" } as any,
              { id: "rec_ready", status: "ready" } as any,
            ],
          },
          {
            recordings: [{ id: "rec_processing", status: "processing" } as any],
          },
        ],
        pageParams: [0, 20],
      }).recordingIds,
    ).toEqual(["rec_uploading", "rec_processing"]);
  });
});

describe("patchRecordingTitleInListData", () => {
  it("updates a recording in an infinite query page", () => {
    const data = {
      pages: [
        { recordings: [{ id: "rec_1", title: "Old title" }] },
        { recordings: [{ id: "rec_2", title: "Other title" }] },
      ],
      pageParams: [0, 20],
    };

    expect(
      patchRecordingTitleInListData(data, "rec_2", "New title", "updated"),
    ).toEqual({
      pages: [
        { recordings: [{ id: "rec_1", title: "Old title" }] },
        {
          recordings: [
            { id: "rec_2", title: "New title", updatedAt: "updated" },
          ],
        },
      ],
      pageParams: [0, 20],
    });
  });
});

describe("recordingsRefetchInterval", () => {
  it("does not poll completed recordings while waiting for an AI title", () => {
    expect(
      recordingsRefetchInterval([
        {
          id: "rec_ready",
          title: "Untitled recording",
          titleSource: "default",
          status: "ready",
          transcriptStatus: "ready",
          transcriptHasText: true,
        } as any,
      ]),
    ).toBe(false);
  });

  it("keeps the bounded processing poll for active uploads", () => {
    expect(
      recordingsRefetchInterval([
        {
          id: "rec_uploading",
          title: "Untitled recording",
          status: "uploading",
        } as any,
      ]),
    ).toBe(3000);
  });
});
