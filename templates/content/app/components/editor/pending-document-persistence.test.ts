import { describe, expect, it } from "vitest";

import {
  settleAcceptedDocumentPersistence,
  settleRevertedDocumentPersistence,
  trackPendingDocumentPersistence,
  type DocumentPersistenceFailure,
} from "./pending-document-persistence";

describe("pending document persistence", () => {
  it("retires only failed fields covered by a final accepted attempt and preserves newer or foreign failures", () => {
    const identity = {
      editorSessionId: "own-session",
      editGeneration: 2,
      saveAttemptId: "accepted",
      persistenceSequence: 3,
    };
    const error = new Error("conflict");
    const covered = { ...identity, error };
    const newer = {
      ...identity,
      error,
      editGeneration: 3,
      persistenceSequence: 4,
    };
    const foreign = { ...identity, error, editorSessionId: "other-session" };
    const failures = new Map<string, DocumentPersistenceFailure>([
      ["title", covered],
      ["content", newer],
      ["icon", foreign],
      ["description", covered],
    ]);
    settleAcceptedDocumentPersistence(
      failures,
      ["title", "content", "icon"],
      identity,
    );
    expect([...failures]).toEqual([
      ["content", newer],
      ["icon", foreign],
      ["description", covered],
    ]);
    const laterSameGeneration = {
      ...covered,
      saveAttemptId: "later",
      persistenceSequence: 5,
    };
    for (const retained of [newer, foreign, laterSameGeneration]) {
      failures.set("title", retained);
      settleAcceptedDocumentPersistence(failures, ["title"], identity);
      expect(failures.get("title")).toBe(retained);
    }
  });
  it("retires saved-value field failures without an ACK while retaining newer, foreign and still-edited failures", () => {
    const current = {
      editorSessionId: "own-session",
      editGeneration: 3,
      persistenceSequence: 5,
    };
    const failure = {
      ...current,
      editGeneration: 2,
      persistenceSequence: 4,
      error: new Error("failed edit"),
    };
    const newer = { ...failure, editGeneration: 4 };
    const later = { ...failure, persistenceSequence: 6 };
    const foreign = { ...failure, editorSessionId: "other-session" };
    const unknown = { error: failure.error };
    const failures = new Map<string, DocumentPersistenceFailure>([
      ["title", failure],
      ["content", failure],
      ["icon", failure],
    ]);
    settleRevertedDocumentPersistence(failures, ["title", "content"], current);
    expect([...failures]).toEqual([["icon", failure]]);
    for (const retained of [newer, later, foreign, unknown]) {
      failures.set("title", retained);
      settleRevertedDocumentPersistence(failures, ["title"], current);
      expect(failures.get("title")).toBe(retained);
    }
  });

  it("removes a superseded result after the observer returns early", async () => {
    const pending = new Set<Promise<unknown>>();
    let resolveRequest: ((result: "superseded") => void) | undefined;
    const request = new Promise<"superseded">((resolve) => {
      resolveRequest = resolve;
    });

    trackPendingDocumentPersistence(
      pending,
      request,
      (result) => {
        if (result === "superseded") return;
      },
      () => undefined,
    );
    const wait = Promise.allSettled([...pending]);

    resolveRequest?.("superseded");
    await expect(wait).resolves.toEqual([
      { status: "fulfilled", value: undefined },
    ]);
    expect(pending.size).toBe(0);
  });

  it("removes rejected requests after recording their error", async () => {
    const pending = new Set<Promise<unknown>>();
    const request = Promise.reject(new Error("save failed"));
    const errors: unknown[] = [];

    trackPendingDocumentPersistence(
      pending,
      request,
      () => undefined,
      (error) => {
        errors.push(error);
      },
    );
    const wait = Promise.allSettled([...pending]);

    await expect(wait).resolves.toEqual([
      { status: "fulfilled", value: undefined },
    ]);
    expect(errors).toEqual([new Error("save failed")]);
    expect(pending.size).toBe(0);
  });
});
