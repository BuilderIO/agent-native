import { describe, expect, it } from "vitest";

import { trackPendingDocumentPersistence } from "./pending-document-persistence";

describe("pending document persistence", () => {
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
