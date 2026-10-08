import { ForbiddenError } from "@agent-native/core/sharing";
import { afterEach, describe, expect, it, vi } from "vitest";

const { counter } = vi.hoisted(() => ({ counter: vi.fn() }));
vi.mock("@agent-native/core/tracking", () => ({ countOutcome: counter }));

import {
  boundedContentSaveReason,
  contentSaveOutcome,
  recordContentSaveOutcome,
  scopeContentSaveOutcome,
} from "./_content-save-outcomes.js";

afterEach(() => {
  vi.useRealTimers();
  counter.mockReset();
});

describe("Content save outcome delivery", () => {
  it("classifies the shared typed access refusal without retaining its message", () => {
    expect(
      boundedContentSaveReason(new ForbiddenError("private document name")),
    ).toBe("FORBIDDEN");
  });
  it.each(["DOCUMENT_ACTOR_REQUIRED", "FORBIDDEN", "SPACE_TARGET_CONFLICT"])(
    "retains the bounded known reason %s",
    (errorCode) => {
      expect(boundedContentSaveReason({ errorCode })).toBe(errorCode);
    },
  );
  it.each(["sync throw", "rejected promise", "pending promise"])(
    "defers %s telemetry until after results and ordering",
    async (failure) => {
      vi.useFakeTimers();
      const order: string[] = [];
      let complete: (() => void) | undefined;
      counter.mockImplementation(() => {
        order.push("provider");
        if (failure === "sync throw") throw new Error("telemetry unavailable");
        if (failure === "rejected promise")
          return Promise.reject(new Error("telemetry unavailable"));
        return new Promise<void>((resolve) => {
          complete = resolve;
        });
      });
      const saved = { revision: "existing-result" };
      const save = async () => {
        order.push("settled");
        recordContentSaveOutcome("update_document", {
          outcome: "written",
          origin: "browser",
          stale_base: "false",
          history_effect: "transition",
        });
        return saved;
      };
      expect(await save()).toBe(saved);
      order.push("returned");
      expect(order).toEqual(["settled", "returned"]);
      expect(counter).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      expect(order).toEqual(["settled", "returned", "provider"]);
      expect(counter).toHaveBeenCalledTimes(1);
      complete?.();
    },
  );

  it("attaches the audit outcome without changing serialized or enumerable response fields", () => {
    const result = scopeContentSaveOutcome(
      { content: "existing body" },
      "replayed",
    );
    expect(contentSaveOutcome(result)).toBe("replayed");
    expect(JSON.stringify(result)).toBe('{"content":"existing body"}');
    expect(Object.keys(result)).toEqual(["content"]);
  });

  it("drops unbounded reason strings rather than retaining error messages or unknown codes", () => {
    expect(boundedContentSaveReason({ errorCode: "EDIT_MATCH_MISSING" })).toBe(
      "EDIT_MATCH_MISSING",
    );
    expect(boundedContentSaveReason({ errorCode: "private-document-id" })).toBe(
      "untyped",
    );
    expect(boundedContentSaveReason(new Error("private text"))).toBe("untyped");
  });
});
