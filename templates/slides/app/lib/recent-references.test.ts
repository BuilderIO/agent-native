import { describe, expect, it } from "vitest";

import {
  RECENT_REFERENCES_STORAGE_KEY,
  readRecentReferences,
  rememberRecentReference,
} from "./recent-references";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(RECENT_REFERENCES_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("recent references", () => {
  it("keeps valid references newest-first and deduplicated", () => {
    const store = storage(
      JSON.stringify([
        { id: "deck-old", kind: "deck", lastUsedAt: 1 },
        { id: "system", kind: "design-system", lastUsedAt: 2 },
      ]),
    );

    const result = rememberRecentReference(
      { id: "deck-old", kind: "deck" },
      store,
    );

    expect(result.readable).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: "deck-old", kind: "deck" });
  });

  it("distinguishes an unreadable stored value from an empty history", () => {
    const result = readRecentReferences(storage("not-json"));

    expect(result).toEqual({ items: [], readable: false });
  });
});
