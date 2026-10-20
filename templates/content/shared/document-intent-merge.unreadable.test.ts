import { describe, expect, it, vi } from "vitest";

// Text holding this marker can't be read as Markdown.
const UNREADABLE = "[unreadable]";

vi.mock("./nfm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nfm.js")>();
  return {
    ...actual,
    nfmToDoc: (content: string) => {
      if (content.includes(UNREADABLE)) throw new Error("Unreadable Markdown");
      return actual.nfmToDoc(content);
    },
  };
});

import { mergeBlocksFieldEdits } from "./document-intent-merge.js";

describe("mergeBlocksFieldEdits with text it can't read", () => {
  it("keeps all of mine after their text when theirs can't be read", () => {
    expect(
      mergeBlocksFieldEdits(
        "Intro\nHello world",
        "Intro\nHello friend",
        `Intro ${UNREADABLE}\nHello world`,
      ),
    ).toEqual({
      content: `Intro ${UNREADABLE}\nHello world\nIntro\nHello friend`,
      moved: true,
    });
  });

  it("adds the paragraphs I changed after theirs when the base can't be read", () => {
    expect(
      mergeBlocksFieldEdits(
        `Intro ${UNREADABLE}\nHello world`,
        "Intro\nHello friend",
        "Intro\nHello there",
      ),
    ).toEqual({ content: "Intro\nHello there\nHello friend", moved: true });
  });
});
