import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it } from "vitest";

import {
  hasPendingGenerationOutput,
  isPendingGenerationStale,
  PENDING_GENERATION_STALE_MS,
} from "./pending-generation";

describe("pending generation freshness", () => {
  it("keeps multi-minute design generations active", () => {
    const startedAt = 10_000;

    expect(
      isPendingGenerationStale({ startedAt }, startedAt + 5 * 60_000),
    ).toBe(false);
  });

  it("expires abandoned generation state after the orphan timeout", () => {
    const startedAt = 10_000;

    expect(
      isPendingGenerationStale(
        { startedAt },
        startedAt + PENDING_GENERATION_STALE_MS + 1,
      ),
    ).toBe(true);
  });
});

describe("generation output", () => {
  // The editor creates this for every design the first time it opens, so it can
  // never count as generation output — otherwise a queued prompt is discarded
  // (and never submitted) moments after a brand-new design is opened.
  const board = {
    id: "board-file",
    filename: "__board__.html",
    content: "<body></body>",
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  };

  it("does not treat the reserved board file as output", () => {
    expect(
      hasPendingGenerationOutput({ prompt: "Build a page" }, [board]),
    ).toBe(false);
  });

  it("recognizes a generated screen as output", () => {
    expect(
      hasPendingGenerationOutput({ prompt: "Build a page" }, [
        board,
        {
          id: "file-1",
          filename: "index.html",
          content: "<main>Generated</main>",
          createdAt: "2026-07-10T12:00:00.000Z",
          updatedAt: "2026-07-10T12:00:00.000Z",
        },
      ]),
    ).toBe(true);
  });

  it("ignores the board file while judging template refinement", () => {
    const copiedFile = {
      id: "file-1",
      filename: "index.html",
      content: "<main>Copied template</main>",
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:00:00.000Z",
    };
    expect(
      hasPendingGenerationOutput(
        {
          templateId: "template-1",
          templateBaselineFiles: [
            {
              id: copiedFile.id,
              contentHash: sourceContentHash(copiedFile.content),
            },
          ],
        },
        [board, copiedFile],
      ),
    ).toBe(false);
  });
});

describe("template refinement output", () => {
  const copied = {
    id: "file-1",
    filename: "index.html",
    content: "<main>Copied template</main>",
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  };

  it("does not treat preexisting copied files as completed refinement", () => {
    expect(
      hasPendingGenerationOutput(
        {
          templateId: "template-1",
          templateBaselineFiles: [
            { id: copied.id, contentHash: sourceContentHash(copied.content) },
          ],
        },
        [copied],
      ),
    ).toBe(false);
  });

  it("recognizes changed or newly created files as refinement output", () => {
    const pending = {
      templateId: "template-1",
      templateBaselineFiles: [
        { id: copied.id, contentHash: sourceContentHash(copied.content) },
      ],
    };

    expect(
      hasPendingGenerationOutput(pending, [
        { ...copied, content: "<main>Refined template</main>" },
      ]),
    ).toBe(true);
    expect(
      hasPendingGenerationOutput(pending, [
        copied,
        { ...copied, id: "file-2" },
      ]),
    ).toBe(true);
  });

  it("uses file revisions to recover older pending template runs", () => {
    expect(
      hasPendingGenerationOutput({ templateId: "template-1" }, [copied]),
    ).toBe(false);
    expect(
      hasPendingGenerationOutput({ templateId: "template-1" }, [
        { ...copied, updatedAt: "2026-07-10T12:01:00.000Z" },
      ]),
    ).toBe(true);
  });
});
