import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { dictationsRefetchInterval, withoutDictation } from "./_app.dictate";

describe("dictate list refresh", () => {
  it("polls while browser dictation work is active", () => {
    expect(dictationsRefetchInterval(true)).toBe(2_000);
  });

  it("stops polling when history page is idle", () => {
    expect(dictationsRefetchInterval(false)).toBe(false);
  });

  it("drops a deleted dictation from either cached list shape", () => {
    const a = { id: "a" } as any;
    const b = { id: "b" } as any;
    expect(withoutDictation([a, b], "a")).toEqual([b]);
    expect(withoutDictation({ dictations: [a, b] }, "b")).toEqual({
      dictations: [a],
    });
    expect(withoutDictation(undefined, "a")).toBeUndefined();
  });
});

describe("dictate page composition", () => {
  const routeSource = readFileSync(
    new URL("./_app.dictate.tsx", import.meta.url),
    "utf8",
  );

  it("keeps dictionary management available before the first dictation", () => {
    expect(routeSource).toContain("<VocabularyManager disabled={listening} />");
    expect(routeSource).toMatch(
      /<VocabularyManager disabled=\{listening\} \/>\s+\{\(dictations.length > 0 \|\| hasCaptureActivity\) && \(\s+<PageHeaderPrimaryAction/,
    );
    expect(routeSource).not.toContain("<VocabularySection");
  });
});
