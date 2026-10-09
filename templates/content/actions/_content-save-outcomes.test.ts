import type { ActionCaller, ActionRunContext } from "@agent-native/core/action";
import { ActionContractError } from "@agent-native/core/action";
import { ForbiddenError } from "@agent-native/core/sharing";
import { afterEach, describe, expect, it, vi } from "vitest";

const { counter } = vi.hoisted(() => ({ counter: vi.fn() }));
vi.mock("@agent-native/core/tracking", () => ({ countOutcome: counter }));

import {
  boundedContentSaveReason,
  contentSaveAuditOutcome,
  contentSaveOutcome,
  observeDocumentUpdateOutcome,
  observeRecoveryDocumentCreate,
  recordContentSaveOutcome,
  scopeContentSaveAudit,
  scopeContentSaveOutcome,
  withContentRecoverySaveContext,
} from "./_content-save-outcomes.js";

afterEach(() => {
  vi.useRealTimers();
  counter.mockReset();
});

describe("Content save outcome delivery", () => {
  it.each(
    [
      "tool",
      "http",
      "frontend",
      "mcp-widget",
      "cli",
      "mcp",
      "webmcp",
      "a2a",
      "automation",
      undefined,
    ].flatMap((caller) =>
      [false, true].map((recoveryHeader) => ({
        caller: caller as ActionCaller | undefined,
        recoveryHeader,
      })),
    ),
  )(
    "classifies caller $caller with recovery header $recoveryHeader",
    async ({ caller, recoveryHeader }) => {
      vi.useFakeTimers();
      const ctx = {
        caller: caller as ActionCaller,
        requestHeaders: new Headers(
          recoveryHeader ? { "X-Content-Save-Origin": "recovery" } : {},
        ),
      };
      const save = observeDocumentUpdateOutcome(
        async (_args, _ctx, measurement) => {
          measurement.outcome = "written";
          return { saved: true };
        },
      );
      expect(await save({}, ctx)).toEqual({ saved: true });
      expect(counter).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(counter).toHaveBeenCalledExactlyOnceWith(
        "content_save_outcome_counts",
        expect.objectContaining({
          origin:
            caller === "frontend"
              ? recoveryHeader
                ? "recovery"
                : "browser"
              : "agent",
        }),
      );
    },
  );

  it.each<ActionCaller>([
    "tool",
    "http",
    "frontend",
    "mcp-widget",
    "cli",
    "mcp",
    "webmcp",
    "a2a",
    "automation",
  ])(
    "marks server recovery for caller %s without changing the caller or request",
    async (caller) => {
      vi.useFakeTimers();
      const original: ActionRunContext = {
        caller,
        userEmail: "owner@example.test",
        requestHeaders: new Headers({ "X-Content-Save-Origin": "ignored" }),
      };
      const recovery = withContentRecoverySaveContext(original);
      expect(recovery).not.toBe(original);
      expect(recovery).toEqual(original);
      expect(recovery.requestHeaders).toBe(original.requestHeaders);
      const save = observeRecoveryDocumentCreate(
        async (_args, ctx, measurement) => {
          expect(ctx?.caller).toBe(caller);
          measurement.outcome = "written";
          return { id: "created" };
        },
      );
      const result = await save({}, recovery);
      expect(JSON.stringify(result)).toBe('{"id":"created"}');
      await vi.runAllTimersAsync();
      expect(counter).toHaveBeenCalledExactlyOnceWith(
        "content_save_outcome_counts",
        expect.objectContaining({
          operation: "create_document",
          origin: "recovery",
          outcome: "written",
        }),
      );
    },
  );

  it("isolates nested recovery from concurrent and subsequent saves using the original context", async () => {
    vi.useFakeTimers();
    const ctx: ActionRunContext = {
      caller: "tool",
      requestHeaders: new Headers({ "X-Content-Save-Origin": "recovery" }),
    };
    const nested = observeDocumentUpdateOutcome(
      async (_args, _ctx, measurement) => {
        measurement.outcome = "written";
        return { saved: true };
      },
    );
    const outer = observeDocumentUpdateOutcome(
      async (_args, outerCtx, measurement) => {
        await nested({}, withContentRecoverySaveContext(outerCtx!));
        measurement.outcome = "unchanged";
        return { saved: false };
      },
    );
    expect(await Promise.all([outer({}, ctx), nested({}, ctx)])).toEqual([
      { saved: false },
      { saved: true },
    ]);
    await nested({}, ctx);
    await vi.runAllTimersAsync();
    expect(
      counter.mock.calls.map(([, dimensions]) => [
        dimensions.origin,
        dimensions.outcome,
      ]),
    ).toEqual([
      ["recovery", "written"],
      ["agent", "written"],
      ["agent", "unchanged"],
      ["agent", "written"],
    ]);
    expect(ctx.requestHeaders?.get("X-Content-Save-Origin")).toBe("recovery");
  });

  it("does not count an agent-created document whose request claims recovery", async () => {
    vi.useFakeTimers();
    const create = observeRecoveryDocumentCreate(
      async (_args, _ctx, measurement) => {
        measurement.outcome = "written";
        return { id: "created" };
      },
    );
    const result = await create(
      {},
      {
        caller: "tool",
        requestHeaders: new Headers({ "X-Content-Save-Origin": "recovery" }),
      },
    );
    expect(result).toEqual({ id: "created" });
    await vi.runAllTimersAsync();
    expect(counter).not.toHaveBeenCalled();
  });

  it("counts a recovery create ID conflict once with its known reason and preserves the refusal", async () => {
    vi.useFakeTimers();
    const error = new ActionContractError(
      "This document ID is already in use.",
      {
        errorCode: "DOCUMENT_ID_CONFLICT",
        statusCode: 409,
      },
    );
    const create = observeRecoveryDocumentCreate(async () => {
      throw error;
    });
    const recovery = withContentRecoverySaveContext({ caller: "tool" });

    await expect(create({}, recovery)).rejects.toBe(error);
    expect(error).toMatchObject({
      errorCode: "DOCUMENT_ID_CONFLICT",
      statusCode: 409,
    });
    expect(counter).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(counter).toHaveBeenCalledExactlyOnceWith(
      "content_save_outcome_counts",
      {
        operation: "create_document",
        origin: "recovery",
        outcome: "refused",
        stale_base: "unknown",
        history_effect: "none",
        reason_code: "DOCUMENT_ID_CONFLICT",
      },
    );
  });

  it("retains the audit outcome and response without counting excluded saves", async () => {
    vi.useFakeTimers();
    const result = { content: "existing body" };
    const save = observeDocumentUpdateOutcome(
      async (_args, _ctx, measurement) => {
        measurement.record = false;
        measurement.outcome = "written";
        return result;
      },
    );
    const audited = scopeContentSaveAudit(async () => {
      const saved = await save({});
      expect(contentSaveAuditOutcome()).toBe("written");
      return saved;
    });
    expect(await audited({})).toBe(result);
    expect(contentSaveOutcome(result)).toBe("written");
    expect(JSON.stringify(result)).toBe('{"content":"existing body"}');
    expect(Object.keys(result)).toEqual(["content"]);
    await vi.runAllTimersAsync();
    expect(counter).not.toHaveBeenCalled();
  });

  it("keeps committed audit outcomes separate across overlapping invocations", async () => {
    vi.useFakeTimers();
    let finishWritten!: () => void;
    let finishUnchanged!: () => void;
    const writtenGate = new Promise<void>((resolve) => {
      finishWritten = resolve;
    });
    const unchangedGate = new Promise<void>((resolve) => {
      finishUnchanged = resolve;
    });
    const error = new Error("post-save failure");
    const save = observeDocumentUpdateOutcome(
      async (
        args: { outcome: "written" | "unchanged"; gate: Promise<void> },
        _ctx,
        measurement,
      ) => {
        measurement.outcome = args.outcome;
        measurement.settled = true;
        await args.gate;
        throw error;
      },
    );
    const audited = scopeContentSaveAudit(
      async (args: Parameters<typeof save>[0]) => {
        await expect(save(args)).rejects.toBe(error);
        return contentSaveAuditOutcome();
      },
    );
    const written = audited({ outcome: "written", gate: writtenGate });
    const unchanged = audited({ outcome: "unchanged", gate: unchangedGate });
    expect(contentSaveAuditOutcome()).toBeUndefined();
    finishWritten();
    expect(await written).toBe("written");
    finishUnchanged();
    expect(await unchanged).toBe("unchanged");
    expect(contentSaveAuditOutcome()).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(
      counter.mock.calls.map(([, dimensions]) => dimensions.outcome),
    ).toEqual(["written", "unchanged"]);
  });

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
