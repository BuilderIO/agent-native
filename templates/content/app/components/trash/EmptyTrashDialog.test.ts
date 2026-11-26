import type { ContentTrashPurgePlanResponse } from "@shared/content-trash";
import { describe, expect, it } from "vitest";

import {
  trashEmptyRequest,
  type ContentTrashPurgeRequest,
} from "@/hooks/use-content-trash";

import {
  acceptTrashPlanSettlement,
  isEmptyTrashScopeError,
  trashOperationStatusText,
  trashPlansToExecute,
  trashStartsToRun,
  type TrashPurgePlanState,
} from "./EmptyTrashDialog";

function plan(planId: string, eligibleCount: number) {
  return {
    planId,
    scopeToken: `scope-${planId}`,
    eligibleCount,
    blockedCount: 0,
  } as ContentTrashPurgePlanResponse;
}

const target = (spaceId: string) => ({
  spaceId,
  input: { mode: "scope" as const, spaceId },
});

describe("Trash purge confirmation planning", () => {
  it("ignores a plan that settles after close or a later gesture", () => {
    const first: ContentTrashPurgeRequest = {
      kind: "delete",
      targets: [
        {
          spaceId: "a",
          input: { mode: "selection", documentIds: ["first"] },
        },
      ],
      unavailableSpaceIds: [],
    };
    const second: ContentTrashPurgeRequest = {
      kind: "delete",
      targets: [
        {
          spaceId: "a",
          input: { mode: "selection", documentIds: ["second"] },
        },
      ],
      unavailableSpaceIds: [],
    };

    expect(acceptTrashPlanSettlement(null, first)).toBe(false);
    expect(acceptTrashPlanSettlement(second, first)).toBe(false);
    expect(acceptTrashPlanSettlement(second, second)).toBe(true);
  });

  it("plans Empty Trash once per purgeable workspace", () => {
    const request = trashEmptyRequest([
      { spaceId: "a", name: "A", canPurge: true },
      { spaceId: "viewer", name: "Viewer", canPurge: false },
      { spaceId: "b", name: "B", canPurge: true },
    ]);

    expect(request.targets).toEqual([target("a"), target("b")]);
    expect(request.unavailableSpaceIds).toEqual(["viewer"]);
  });

  it("treats a workspace with nothing to purge as empty, not failed", () => {
    expect(isEmptyTrashScopeError({ errorCode: "empty_scope" })).toBe(true);
    expect(isEmptyTrashScopeError(new Error("offline"))).toBe(false);
    expect(isEmptyTrashScopeError(undefined)).toBe(false);
  });

  it("executes every reviewed workspace plan with pages to delete", () => {
    const plans: TrashPurgePlanState[] = [
      { status: "planned", target: target("a"), plan: plan("plan-a", 2) },
      { status: "empty", target: target("b") },
      { status: "planned", target: target("c"), plan: plan("plan-c", 0) },
      { status: "planned", target: target("d"), plan: plan("plan-d", 4) },
    ];

    expect(
      trashPlansToExecute(plans, new Set(["plan-a", "plan-c", "plan-d"]))?.map(
        (entry) => entry.plan.planId,
      ),
    ).toEqual(["plan-a", "plan-d"]);
  });

  it("retries each unresolved start with its original plan and key, skipping started ones", () => {
    const toExecute = [
      { spaceId: "a", plan: plan("plan-a", 2) },
      { spaceId: "b", plan: plan("plan-b", 1) },
      { spaceId: "c", plan: plan("plan-c", 3) },
    ];
    let keys = 0;
    const first = trashStartsToRun(toExecute, [], () => `key-${++keys}`);

    expect(
      first.map(({ idempotencyKey, status }) => [idempotencyKey, status]),
    ).toEqual([
      ["key-1", "starting"],
      ["key-2", "starting"],
      ["key-3", "starting"],
    ]);

    const outcomes = [
      { status: "started", operationId: "operation-a" },
      { status: "unknown", error: "offline" },
      { status: "failed", error: "refused" },
    ] as const;
    const previous = first.map((start, index) => ({
      ...start,
      ...outcomes[index],
    }));
    const retried = trashStartsToRun(
      toExecute,
      previous,
      () => `key-${++keys}`,
    );

    expect(retried).toEqual([
      previous[0],
      { ...first[1], status: "starting" },
      { ...first[2], status: "starting" },
    ]);
  });

  it("waits while any workspace is planning, unreviewed, or failed", () => {
    const planned: TrashPurgePlanState = {
      status: "planned",
      target: target("a"),
      plan: plan("plan-a", 2),
    };
    const ready = new Set(["plan-a"]);

    expect(
      trashPlansToExecute(
        [planned, { status: "planning", target: target("b") }],
        ready,
      ),
    ).toBeNull();
    expect(
      trashPlansToExecute(
        [planned, { status: "failed", target: target("b"), error: "offline" }],
        ready,
      ),
    ).toBeNull();
    expect(trashPlansToExecute([planned], new Set())).toBeNull();
    expect(
      trashPlansToExecute([{ status: "empty", target: target("b") }], ready),
    ).toBeNull();
  });

  it("says what a partial or conflicted purge kept in Trash", () => {
    const t = ((key: string, values?: Record<string, unknown>) =>
      `${key} ${JSON.stringify(values ?? {})}`) as Parameters<
      typeof trashOperationStatusText
    >[0];
    const progress = { deletedCount: 3, blockedCount: 2, conflictedCount: 1 };

    expect(
      trashOperationStatusText(t, {
        ...progress,
        status: "partially_completed",
      }),
    ).toBe('trash.partiallyCompleted {"deleted":3,"blocked":2}');
    expect(
      trashOperationStatusText(t, { ...progress, status: "conflicted" }),
    ).toBe('trash.conflicted {"deleted":3,"conflicted":1}');
    expect(
      trashOperationStatusText(t, { ...progress, status: "succeeded" }),
    ).toBe('trash.completed {"count":3}');
  });
});
