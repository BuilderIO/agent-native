import { describe, expect, it, vi } from "vitest";

import type { OtherPresence } from "./presence.js";
import {
  RECENT_EDITS_MAX,
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

describe("appendRecentEdit", () => {
  it("appends to an empty ring", () => {
    const edit: RecentEdit = { descriptor: { kind: "doc" }, at: 1 };
    expect(appendRecentEdit(undefined, edit)).toEqual([edit]);
  });

  it("keeps only the newest RECENT_EDITS_MAX entries", () => {
    let ring: RecentEdit[] | undefined;
    for (let i = 0; i < RECENT_EDITS_MAX + 4; i++) {
      ring = appendRecentEdit(ring, {
        descriptor: { kind: "text", quote: `q${i}` },
        at: i,
      });
    }
    expect(ring).toHaveLength(RECENT_EDITS_MAX);
    expect(ring![0].at).toBe(4);
    expect(ring![RECENT_EDITS_MAX - 1].at).toBe(RECENT_EDITS_MAX + 3);
  });

  it("does not mutate the input array", () => {
    const original: RecentEdit[] = [{ descriptor: { kind: "doc" }, at: 1 }];
    appendRecentEdit(original, { descriptor: { kind: "doc" }, at: 2 });
    expect(original).toHaveLength(1);
  });

  it("truncates an oversized quote so a caller forgetting to trim can't blow up the awareness payload", () => {
    const hugeQuote = "x".repeat(50_000);
    const [entry] = appendRecentEdit(undefined, {
      descriptor: { kind: "text", quote: hugeQuote },
      at: 1,
    });
    expect(
      (entry.descriptor as { kind: "text"; quote: string }).quote.length,
    ).toBe(500);
  });

  it("truncates an oversized selector and each oversized path entry", () => {
    const huge = "a".repeat(10_000);
    const [selectorEntry] = appendRecentEdit(undefined, {
      descriptor: { kind: "selector", selector: huge },
      at: 1,
    });
    expect(
      (selectorEntry.descriptor as { kind: "selector"; selector: string })
        .selector.length,
    ).toBe(500);

    const [pathsEntry] = appendRecentEdit(undefined, {
      descriptor: { kind: "paths", paths: [huge, "short.path"] },
      at: 1,
    });
    const paths = (pathsEntry.descriptor as { kind: "paths"; paths: string[] })
      .paths;
    expect(paths[0]!.length).toBe(500);
    expect(paths[1]).toBe("short.path");
  });

  it("truncates an oversized label", () => {
    const [entry] = appendRecentEdit(undefined, {
      descriptor: { kind: "doc" },
      label: "y".repeat(2_000),
      at: 1,
    });
    expect(entry.label!.length).toBe(500);
  });

  it("leaves short descriptors and labels untouched", () => {
    const [entry] = appendRecentEdit(undefined, {
      descriptor: { kind: "text", quote: "hello world" },
      label: "Edited",
      at: 1,
    });
    expect(entry.descriptor).toEqual({ kind: "text", quote: "hello world" });
    expect(entry.label).toBe("Edited");
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
