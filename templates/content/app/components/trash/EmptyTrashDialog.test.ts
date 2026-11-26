import type { ContentTrashPurgePlanResponse } from "@shared/content-trash";
import { describe, expect, it } from "vitest";

import {
  trashEmptyRequest,
  type ContentTrashPurgeRequest,
} from "@/hooks/use-content-trash";

import {
  acceptTrashPlanSettlement,
  isEmptyTrashScopeError,
  trashPlansToExecute,
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
    };
    const second: ContentTrashPurgeRequest = {
      kind: "delete",
      targets: [
        {
          spaceId: "a",
          input: { mode: "selection", documentIds: ["second"] },
        },
      ],
    };

    expect(acceptTrashPlanSettlement(null, first)).toBe(false);
    expect(acceptTrashPlanSettlement(second, first)).toBe(false);
    expect(acceptTrashPlanSettlement(second, second)).toBe(true);
  });

  it("plans Empty Trash once per workspace", () => {
    expect(trashEmptyRequest(["a", "b"]).targets).toEqual([
      target("a"),
      target("b"),
    ]);
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
        (entry) => entry.planId,
      ),
    ).toEqual(["plan-a", "plan-d"]);
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
});
