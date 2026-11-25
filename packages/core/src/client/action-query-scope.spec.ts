import { describe, expect, it } from "vitest";

import {
  ACTION_RESOURCES_META_KEY,
  ACTION_SELF_REFRESHING_META_KEY,
  actionQueryAffectedByResources,
} from "./action-query-scope.js";

const changed = new Set(["tables"]);

describe("actionQueryAffectedByResources", () => {
  it("never reaches a query that is not an action read", () => {
    expect(
      actionQueryAffectedByResources({ queryKey: ["other", "x"] }, changed),
    ).toBe(false);
  });

  it("reaches an action read that names no resources", () => {
    expect(
      actionQueryAffectedByResources({ queryKey: ["action", "x"] }, changed),
    ).toBe(true);
    expect(
      actionQueryAffectedByResources(
        {
          queryKey: ["action", "x"],
          meta: { [ACTION_RESOURCES_META_KEY]: [] },
        },
        changed,
      ),
    ).toBe(true);
  });

  it("reaches a read only when it names a changed resource", () => {
    const named = (tags: string[]) => ({
      queryKey: ["action", "x"],
      meta: { [ACTION_RESOURCES_META_KEY]: tags },
    });
    expect(actionQueryAffectedByResources(named(["tables"]), changed)).toBe(
      true,
    );
    expect(actionQueryAffectedByResources(named(["views"]), changed)).toBe(
      false,
    );
  });

  it("skips a self-refreshing read even when it names a changed resource", () => {
    expect(
      actionQueryAffectedByResources(
        {
          queryKey: ["action", "x"],
          meta: {
            [ACTION_SELF_REFRESHING_META_KEY]: true,
            [ACTION_RESOURCES_META_KEY]: ["tables"],
          },
        },
        changed,
      ),
    ).toBe(false);
    expect(
      actionQueryAffectedByResources(
        { queryKey: ["action", "x"], meta: { actionSelfRefreshing: true } },
        changed,
      ),
    ).toBe(false);
    expect(
      actionQueryAffectedByResources(
        {
          queryKey: ["action", "x"],
          meta: { [ACTION_SELF_REFRESHING_META_KEY]: false },
        },
        changed,
      ),
    ).toBe(true);
  });
});
