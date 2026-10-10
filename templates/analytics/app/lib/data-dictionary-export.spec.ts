import { describe, expect, it } from "vitest";

import {
  collectDictionaryEntries,
  DictionaryExportError,
  dictionaryEntriesToCsv,
} from "./data-dictionary-export";

describe("collectDictionaryEntries", () => {
  it("follows cursors until the final page", async () => {
    const seen: Array<string | undefined> = [];
    const entries = await collectDictionaryEntries(async (cursor) => {
      seen.push(cursor);
      if (!cursor) return { results: [{ metric: "First" }], nextPage: "p2" };
      return { results: [{ metric: "Second" }], nextPage: null };
    });

    expect(seen).toEqual([undefined, "p2"]);
    expect(entries).toEqual([{ metric: "First" }, { metric: "Second" }]);
  });

  it("fails visibly on a malformed or repeating page cursor", async () => {
    await expect(
      collectDictionaryEntries(async () => ({ results: [] })),
    ).rejects.toMatchObject({ kind: "invalid_page" });

    await expect(
      collectDictionaryEntries(async (cursor) => ({
        results: [],
        nextPage: cursor ? "p1" : "p1",
      })),
    ).rejects.toBeInstanceOf(DictionaryExportError);
    await expect(
      collectDictionaryEntries(async (cursor) => ({
        results: [],
        nextPage: cursor ? "p1" : "p1",
      })),
    ).rejects.toMatchObject({ kind: "cursor_loop" });
  });

  it("stops after the configured page bound", async () => {
    await expect(
      collectDictionaryEntries(
        async () => ({ results: [], nextPage: "next" }),
        1,
      ),
    ).rejects.toMatchObject({ kind: "page_limit" });
  });
});

describe("dictionaryEntriesToCsv", () => {
  it("quotes fields and neutralizes spreadsheet formulas", () => {
    const csv = dictionaryEntriesToCsv([
      { metric: '=HYPERLINK("https://example.com")', definition: 'a "quote"' },
    ]);

    expect(csv).toContain('"metric"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"a ""quote"""');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
