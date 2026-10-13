import { sourceContentHash } from "@shared/source-workspace";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MissingVisualImagePayloadError } from "@/lib/chat-image-attachments";

import {
  failPendingGenerationForMissingImagePayload,
  generationOutputFiles,
  hasPendingGenerationOutput,
  isPendingGenerationStale,
  PENDING_GENERATION_STALE_MS,
  readPendingGeneration,
  shouldSkipPendingGenerationResume,
  writePendingGeneration,
} from "./pending-generation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("missing image payload cleanup", () => {
  it("clears persisted and in-memory pending state while surfacing the issue", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    writePendingGeneration("design-1", { prompt: "Create from screenshot" });
    const setGenerationIssue = vi.fn();
    const setHasPendingGeneration = vi.fn();

    expect(
      failPendingGenerationForMissingImagePayload(
        "design-1",
        new MissingVisualImagePayloadError(),
        "Attach the image again.",
        setGenerationIssue,
        setHasPendingGeneration,
      ),
    ).toBe(true);

    expect(
      readPendingGeneration("design-1", { allowUntimestamped: true }),
    ).toBeNull();
    expect(setGenerationIssue).toHaveBeenCalledWith("Attach the image again.");
    expect(setHasPendingGeneration).toHaveBeenCalledWith(false);
  });

  it("leaves pending state intact for unexpected errors", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    writePendingGeneration("design-1", { prompt: "Create from screenshot" });
    const setGenerationIssue = vi.fn();
    const setHasPendingGeneration = vi.fn();

    expect(
      failPendingGenerationForMissingImagePayload(
        "design-1",
        new Error("Unexpected failure"),
        "Attach the image again.",
        setGenerationIssue,
        setHasPendingGeneration,
      ),
    ).toBe(false);

    expect(
      readPendingGeneration("design-1", { allowUntimestamped: true }),
    ).toMatchObject({ prompt: "Create from screenshot" });
    expect(setGenerationIssue).not.toHaveBeenCalled();
    expect(setHasPendingGeneration).not.toHaveBeenCalled();
  });
});

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

describe("template refinement output", () => {
  const copied = {
    id: "file-1",
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

  it("treats a changed tracked support file as completed template refinement", () => {
    const stylesheet = {
      id: "file-css",
      filename: "styles.css",
      fileType: "css",
      content: "body { margin: 0 }",
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:00:00.000Z",
    };
    const pending = {
      templateId: "template-1",
      templateBaselineFiles: [
        { id: copied.id, contentHash: sourceContentHash(copied.content) },
        {
          id: stylesheet.id,
          contentHash: sourceContentHash(stylesheet.content),
        },
      ],
    };

    expect(hasPendingGenerationOutput(pending, [copied, stylesheet])).toBe(
      false,
    );
    expect(
      hasPendingGenerationOutput(pending, [
        copied,
        { ...stylesheet, content: "body { margin: 16px }" },
      ]),
    ).toBe(true);
    expect(
      hasPendingGenerationOutput({ templateId: "template-1" }, [
        copied,
        { ...stylesheet, updatedAt: "2026-07-10T12:01:00.000Z" },
      ]),
    ).toBe(true);
  });
});

describe("board file is not generation output", () => {
  const board = {
    id: "board-1",
    filename: "__board__.html",
    content: "<body></body>",
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  };

  it("ignores the reserved board file when deciding that generation finished", () => {
    expect(generationOutputFiles([board])).toEqual([]);
    expect(
      hasPendingGenerationOutput({ prompt: "login screen" }, [board]),
    ).toBe(false);
  });

  it("still recognizes a real screen alongside the board file", () => {
    const screen = {
      id: "file-1",
      filename: "index.html",
      content: "<main>Login</main>",
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
    };
    expect(
      hasPendingGenerationOutput({ prompt: "login screen" }, [board, screen]),
    ).toBe(true);
  });

  it("does not treat CSS/JSX/asset support files as a generated screen", () => {
    const stylesheet = {
      id: "file-css",
      filename: "styles.css",
      fileType: "css",
      content: "body { margin: 0 }",
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
    };
    expect(generationOutputFiles([board, stylesheet])).toEqual([]);
    expect(
      hasPendingGenerationOutput({ prompt: "login screen" }, [
        board,
        stylesheet,
      ]),
    ).toBe(false);
    expect(
      shouldSkipPendingGenerationResume({ prompt: "login screen" }, [
        board,
        stylesheet,
      ]),
    ).toBe(false);
    expect(
      shouldSkipPendingGenerationResume({ prompt: "login screen" }, [
        board,
        {
          id: "file-1",
          filename: "index.html",
          content: "<main>Login</main>",
        },
      ]),
    ).toBe(true);
    expect(
      shouldSkipPendingGenerationResume({ templateId: "template-1" }, [
        board,
        {
          id: "file-1",
          filename: "index.html",
          content: "<main>Login</main>",
        },
      ]),
    ).toBe(false);
  });
});
