import { describe, expect, it, vi } from "vitest";

import type { OtherPresence } from "./presence.js";
import { appendRecentEdit as appendToRing } from "./recent-edit-ring.js";
import {
  appendRecentEdit,
  collectRecentEdits,
  publishRecentEdit,
  type RecentEdit,
} from "./recent-edits.js";

function other(
  clientId: number,
  presence: Record<string, unknown>,
  isAgent = false,
): OtherPresence {
  return {
    clientId,
    user: {
      name: isAgent ? "AI Assistant" : `User ${clientId}`,
      email: isAgent ? "agent@system" : `u${clientId}@example.com`,
      color: "#123456",
    },
    presence,
    isAgent,
  };
}

// oracle-change: the ring's tests moved to recent-edit-ring.spec.ts with the ring.
describe("appendRecentEdit", () => {
  it("is the ring's own function, re-exported", () => {
    expect(appendRecentEdit).toBe(appendToRing);
  });
});

describe("collectRecentEdits", () => {
  it("flattens edits from multiple participants, oldest first", () => {
    const others = [
      other(1, {
        recentEdits: [
          { descriptor: { kind: "text", quote: "b" }, at: 200 },
        ] satisfies RecentEdit[],
      }),
      other(
        2,
        {
          recentEdits: [
            { descriptor: { kind: "text", quote: "a" }, at: 100 },
          ] satisfies RecentEdit[],
        },
        true,
      ),
    ];

    const result = collectRecentEdits(others, 10_000, 300);
    expect(result.map((e) => e.at)).toEqual([100, 200]);
    expect(result[0].isAgent).toBe(true);
    expect(result[1].user.name).toBe("User 1");
  });

  it("filters out expired edits", () => {
    const others = [
      other(1, {
        recentEdits: [
          { descriptor: { kind: "doc" }, at: 0 },
          { descriptor: { kind: "doc" }, at: 9000 },
        ] satisfies RecentEdit[],
      }),
    ];
    const result = collectRecentEdits(others, 6000, 10_000);
    expect(result).toHaveLength(1);
    expect(result[0].at).toBe(9000);
  });

  it("ignores malformed rings and entries", () => {
    const others = [
      other(1, { recentEdits: "nope" }),
      other(2, { recentEdits: [{ at: "soon" }, null, { descriptor: null }] }),
      other(3, {}),
    ];
    expect(collectRecentEdits(others, 6000, 0)).toEqual([]);
  });
});

describe("publishRecentEdit", () => {
  it("appends to the local awareness ring with a timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);

    let localState: Record<string, unknown> = {
      recentEdits: [{ descriptor: { kind: "doc" }, at: 1 }],
    };
    const awareness = {
      getLocalState: () => localState,
      setLocalStateField: (field: string, value: unknown) => {
        localState = { ...localState, [field]: value };
      },
    };

    publishRecentEdit(awareness, {
      descriptor: { kind: "selector", selector: "#hero" },
      label: "Hero",
    });

    expect(localState.recentEdits).toEqual([
      { descriptor: { kind: "doc" }, at: 1 },
      {
        descriptor: { kind: "selector", selector: "#hero" },
        label: "Hero",
        at: 5000,
      },
    ]);
    vi.useRealTimers();
  });
});
