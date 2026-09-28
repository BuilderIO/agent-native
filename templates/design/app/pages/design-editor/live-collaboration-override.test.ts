import { describe, expect, it } from "vitest";

import { reconcileLiveCollaborationOverride } from "./live-collaboration-override";

describe("live collaboration optimistic override", () => {
  it("keeps the mutation result until newer persisted data arrives", () => {
    const override = { enabled: true, observedDataUpdatedAt: 10 };

    expect(reconcileLiveCollaborationOverride(override, false, 10)).toBe(
      override,
    );
    expect(reconcileLiveCollaborationOverride(override, undefined, 11)).toBe(
      override,
    );
    expect(reconcileLiveCollaborationOverride(override, true, 11)).toBeNull();
  });

  it("lets a later remote persisted change replace the override", () => {
    const override = { enabled: true, observedDataUpdatedAt: 10 };

    expect(reconcileLiveCollaborationOverride(override, false, 12)).toBeNull();
  });
});
