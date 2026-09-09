import type { DocumentProperty } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  canonicalRelationOptions,
  contentRelationshipOperationId,
  createRelationshipMutationRetry,
  relationshipMutationErrorMessage,
} from "./use-content-relationships";

function property(relation: unknown): Pick<DocumentProperty, "definition"> {
  return {
    definition: {
      options: { relation },
    } as DocumentProperty["definition"],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("content relationship hooks", () => {
  it("recognizes only canonical relation projection metadata", () => {
    expect(
      canonicalRelationOptions(
        property({
          databaseId: "people",
          relationshipTypeId: "contributors",
          direction: "forward",
          editable: true,
        }),
      ),
    ).toEqual({
      databaseId: "people",
      relationshipTypeId: "contributors",
      direction: "forward",
      editable: true,
    });
    expect(canonicalRelationOptions(property({ databaseId: "people" }))).toBe(
      null,
    );
  });

  it("creates a distinct operation id for each committed intent", () => {
    expect(contentRelationshipOperationId()).not.toBe(
      contentRelationshipOperationId(),
    );
  });

  it("replays the exact failed request while a new intent replaces it", async () => {
    type Request = {
      operationId: string;
      changes: Array<{ observationToken: string }>;
    };
    const requests: Request[] = [];
    let fail = true;
    const retry = createRelationshipMutationRetry<
      { revisionId: string },
      Request
    >(async (request) => {
      requests.push(request);
      if (fail) {
        fail = false;
        throw new TypeError("Failed to fetch");
      }
      return { revisionId: request.operationId };
    });
    const interrupted = {
      operationId: "same-operation",
      changes: [{ observationToken: "frozen-observation" }],
    };

    await expect(retry.run(interrupted)).rejects.toThrow("Failed to fetch");
    await expect(retry.retry()).resolves.toEqual({
      revisionId: "same-operation",
    });
    expect(requests[1]).toBe(requests[0]);

    const newIntent = {
      operationId: "new-operation",
      changes: [{ observationToken: "new-observation" }],
    };
    await retry.run(newIntent);
    expect(requests[2]).toBe(newIntent);
    expect(requests[2].operationId).not.toBe(requests[0].operationId);
  });

  it("keeps authored Action failures and replaces transport framing", () => {
    const denied = Object.assign(new Error("Action mutate failed: denied"), {
      actionMessage: "You cannot edit this relationship.",
    });
    expect(
      relationshipMutationErrorMessage(
        denied,
        "Request interrupted.",
        "Update failed.",
      ),
    ).toBe("You cannot edit this relationship.");
    expect(
      relationshipMutationErrorMessage(
        new TypeError(
          "Action mutate-content-relationships failed: Failed to fetch",
        ),
        "Request interrupted.",
        "Update failed.",
      ),
    ).toBe("Request interrupted.");
  });

  it("does not resurrect a cleared request when an older write fails", async () => {
    const pending = deferred<string>();
    const retry = createRelationshipMutationRetry(() => pending.promise);
    const oldRequest = retry.run({ operationId: "old" });

    retry.clear();
    pending.reject(new TypeError("Failed to fetch"));

    await expect(oldRequest).rejects.toMatchObject({
      name: "SupersededRelationshipMutationError",
    });
    expect(retry.failedVariables()).toBeNull();
    expect(() => retry.retry()).toThrow(
      "No failed relationship request is available.",
    );
  });

  it("keeps the newer failure when an older write settles afterward", async () => {
    const oldPending = deferred<string>();
    const newPending = deferred<string>();
    const retry = createRelationshipMutationRetry(
      (request: { operationId: string }) =>
        request.operationId === "old" ? oldPending.promise : newPending.promise,
    );
    const oldRequest = retry.run({ operationId: "old" });
    const newRequest = retry.run({ operationId: "new" });

    newPending.reject(new TypeError("Failed to fetch"));
    await expect(newRequest).rejects.toThrow("Failed to fetch");
    oldPending.resolve("old receipt");
    await expect(oldRequest).rejects.toMatchObject({
      name: "SupersededRelationshipMutationError",
    });

    expect(retry.failedVariables()).toEqual({ operationId: "new" });
  });

  it("rejects an obsolete success after clear without restoring retry state", async () => {
    const pending = deferred<string>();
    const retry = createRelationshipMutationRetry(() => pending.promise);
    const oldRequest = retry.run({ operationId: "old" });

    retry.clear();
    pending.resolve("old receipt");

    await expect(oldRequest).rejects.toMatchObject({
      name: "SupersededRelationshipMutationError",
    });
    expect(retry.failedVariables()).toBeNull();
  });
});
