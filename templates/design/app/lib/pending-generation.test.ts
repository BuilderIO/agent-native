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
  resolvePendingGenerationOutputBaseline,
  resolvePreviousRunBaseline,
  snapshotGenerationOutputBaseline,
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

describe("continuation run baseline", () => {
  it("keeps a fresh verified idle baseline ahead of stale stored run ids", () => {
    expect(
      resolvePreviousRunBaseline(
        { runId: null, verified: true },
        {
          currentRunId: "stale-current-run",
          previousRunId: "old-run",
          previousRunBaselineVerified: true,
        },
      ),
    ).toEqual({ runId: null, verified: true });
  });

  it("preserves the known current run and turn when refreshing fails", () => {
    expect(
      resolvePreviousRunBaseline(
        { runId: null, verified: false },
        {
          currentRunId: "stale-current-run",
          currentTurnId: "known-current-turn",
          previousRunId: "old-run",
          previousRunBaselineVerified: true,
        },
      ),
    ).toEqual({
      runId: "stale-current-run",
      verified: true,
      turnId: "known-current-turn",
    });
  });

  it("falls back to the known previous run when no current run is stored", () => {
    expect(
      resolvePreviousRunBaseline(
        { runId: null, verified: false },
        {
          previousRunId: "known-previous-run",
          previousRunBaselineVerified: false,
        },
      ),
    ).toEqual({ runId: "known-previous-run", verified: true });
  });

  it("keeps a known turn when the verified baseline identifies the same run", () => {
    expect(
      resolvePreviousRunBaseline(
        { runId: "current-run", verified: true },
        {
          currentRunId: "current-run",
          currentTurnId: "current-turn",
        },
      ),
    ).toEqual({
      runId: "current-run",
      verified: true,
      turnId: "current-turn",
    });
  });

  it("does not attach a stored turn to a different verified run", () => {
    expect(
      resolvePreviousRunBaseline(
        { runId: "new-run", verified: true, turnId: "new-turn" },
        {
          currentRunId: "old-run",
          currentTurnId: "old-turn",
        },
      ),
    ).toEqual({ runId: "new-run", verified: true, turnId: "new-turn" });
  });

  it("keeps the resolved continuation turn in session storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    const baseline = resolvePreviousRunBaseline(
      { runId: null, verified: false },
      {
        currentRunId: "current-run",
        currentTurnId: "current-turn",
      },
    );
    writePendingGeneration("design-1", {
      runTabId: "thread-1",
      previousRunId: baseline.runId ?? undefined,
      previousRunBaselineVerified: baseline.verified,
      currentTurnId: baseline.turnId,
    });

    expect(
      readPendingGeneration("design-1", { allowUntimestamped: true }),
    ).toMatchObject({
      previousRunId: "current-run",
      previousRunBaselineVerified: true,
      currentTurnId: "current-turn",
    });
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

  it("does not attribute changed or newly created files to a refinement run", () => {
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
    ).toBe(false);
    expect(
      hasPendingGenerationOutput(pending, [
        copied,
        { ...copied, id: "file-2" },
      ]),
    ).toBe(false);
  });

  it("does not infer output from file revisions without a persisted baseline", () => {
    expect(
      hasPendingGenerationOutput({ templateId: "template-1" }, [copied]),
    ).toBe(false);
    expect(
      hasPendingGenerationOutput({ templateId: "template-1" }, [
        { ...copied, updatedAt: "2026-07-10T12:01:00.000Z" },
      ]),
    ).toBe(false);
  });

  it("does not infer template completion from changed support files", () => {
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
    ).toBe(false);
    expect(
      hasPendingGenerationOutput({ templateId: "template-1" }, [
        copied,
        { ...stylesheet, updatedAt: "2026-07-10T12:01:00.000Z" },
      ]),
    ).toBe(false);
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

  it("does not infer run output from a real screen alongside the board file", () => {
    const screen = {
      id: "file-1",
      filename: "index.html",
      content: "<main>Login</main>",
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
    };
    expect(
      hasPendingGenerationOutput(
        {
          prompt: "login screen",
          outputBaselineFiles: snapshotGenerationOutputBaseline([board]),
        },
        [board, screen],
      ),
    ).toBe(false);
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

describe("generation output baseline", () => {
  const existing = {
    id: "file-1",
    filename: "index.html",
    content: "<main>Existing design</main>",
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  };

  it("keeps the persisted output baseline when continuing a question flow", () => {
    const persisted = [{ id: "persisted-file", contentHash: "3:persisted" }];
    const live = [{ id: "live-file", contentHash: "3:live" }];

    expect(resolvePendingGenerationOutputBaseline(persisted, live)).toBe(
      persisted,
    );
    expect(resolvePendingGenerationOutputBaseline(undefined, live)).toBe(live);
    expect(resolvePendingGenerationOutputBaseline(undefined, undefined)).toBe(
      undefined,
    );
  });

  it("does not treat existing HTML as output from a new prompt", () => {
    const pending = {
      prompt: "Add a settings page",
      outputBaselineFiles: snapshotGenerationOutputBaseline([existing]),
    };

    expect(hasPendingGenerationOutput(pending, [existing])).toBe(false);
    expect(shouldSkipPendingGenerationResume(pending, [existing])).toBe(false);
  });

  it("keeps legacy HTML from suppressing a stale generation retry", () => {
    const stalePending = {
      prompt: "Add a settings page",
      createdAt: Date.now() - PENDING_GENERATION_STALE_MS - 1,
    };

    expect(hasPendingGenerationOutput(stalePending, [existing])).toBe(false);
    expect(shouldSkipPendingGenerationResume(stalePending, [existing])).toBe(
      false,
    );
  });

  it("avoids resuming a fresh legacy generation over existing HTML", () => {
    const pending = {
      prompt: "Add a settings page",
      createdAt: Date.now(),
    };

    expect(hasPendingGenerationOutput(pending, [existing])).toBe(false);
    expect(shouldSkipPendingGenerationResume(pending, [existing])).toBe(true);
  });

  it("does not trust existing template output when a legacy baseline is absent", () => {
    expect(
      hasPendingGenerationOutput(
        {
          templateId: "template-1",
          createdAt: Date.now() - PENDING_GENERATION_STALE_MS - 1,
        },
        [existing],
      ),
    ).toBe(false);
  });

  it("does not infer run output from changed or newly created HTML", () => {
    const pending = {
      prompt: "Add a settings page",
      outputBaselineFiles: snapshotGenerationOutputBaseline([existing]),
    };

    expect(
      hasPendingGenerationOutput(pending, [
        { ...existing, content: "<main>Updated settings page</main>" },
      ]),
    ).toBe(false);
    expect(
      hasPendingGenerationOutput(pending, [
        existing,
        { ...existing, id: "file-2", filename: "settings.html" },
      ]),
    ).toBe(false);
  });

  it("keeps retryable state after an unrelated HTML edit", () => {
    const pending = {
      prompt: "Add a settings page",
      outputBaselineFiles: snapshotGenerationOutputBaseline([existing]),
    };
    const manuallyEdited = {
      ...existing,
      content: "<main>Manually adjusted design</main>",
    };

    expect(hasPendingGenerationOutput(pending, [manuallyEdited])).toBe(false);
    expect(shouldSkipPendingGenerationResume(pending, [manuallyEdited])).toBe(
      false,
    );
  });
});
