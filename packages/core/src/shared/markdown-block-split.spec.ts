import { describe, expect, it } from "vitest";
import {
  joinMarkdownBlocks,
  splitMarkdownBlocks,
} from "./markdown-block-split.js";

describe("splitMarkdownBlocks", () => {
  it("returns empty completed blocks and empty tail for empty string", () => {
    expect(splitMarkdownBlocks("")).toEqual({ completedBlocks: [], tail: "" });
  });

  it("puts a single paragraph in the tail when no blank line follows", () => {
    const result = splitMarkdownBlocks("Hello world");
    expect(result.completedBlocks).toEqual([]);
    expect(result.tail).toBe("Hello world");
  });

  it("splits two paragraphs separated by a blank line", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["First paragraph."]);
    expect(result.tail).toBe("Second paragraph.");
  });

  it("splits three paragraphs", () => {
    const text = "Para A.\n\nPara B.\n\nPara C.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Para A.", "Para B."]);
    expect(result.tail).toBe("Para C.");
  });

  it("does not split on blank lines inside a fenced code block", () => {
    const text =
      "Before fence.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter fence.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Before fence.",
      "```js\nconst a = 1;\n\nconst b = 2;\n```",
    ]);
    expect(result.tail).toBe("After fence.");
  });

  it("treats an unterminated fence as part of the tail", () => {
    const text = "Before.\n\n```ts\nconst x = ";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Before."]);
    expect(result.tail).toBe("```ts\nconst x = ");
  });

  it("handles tilde fences", () => {
    const text = "Intro.\n\n~~~python\nprint('hi')\n~~~\n\nOutro.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Intro.",
      "~~~python\nprint('hi')\n~~~",
    ]);
    expect(result.tail).toBe("Outro.");
  });

  it("requires closing fence to be same type as opening fence", () => {
    // ~~~ does not close a ``` fence
    const text = "Start.\n\n```js\ncode\n~~~\nstill inside\n```\n\nEnd.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Start.",
      "```js\ncode\n~~~\nstill inside\n```",
    ]);
    expect(result.tail).toBe("End.");
  });

  it("handles multiple blank lines as a single block separator", () => {
    const text = "Block A.\n\n\n\nBlock B.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Block A."]);
    expect(result.tail).toBe("Block B.");
  });

  it("keeps list items within the same block", () => {
    const text =
      "# Heading\n\n- Item 1\n- Item 2\n- Item 3\n\nFinal paragraph.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "# Heading",
      "- Item 1\n- Item 2\n- Item 3",
    ]);
    expect(result.tail).toBe("Final paragraph.");
  });

  it("handles a table block", () => {
    const text = "Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nConclusion.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Intro.",
      "| A | B |\n|---|---|\n| 1 | 2 |",
    ]);
    expect(result.tail).toBe("Conclusion.");
  });

  it("handles a partial fence at end of stream (no closing marker)", () => {
    const text = "Text.\n\n```\npartial code";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual(["Text."]);
    expect(result.tail).toBe("```\npartial code");
  });

  it("handles text ending with a newline", () => {
    const text = "Block A.\n\nBlock B.\n";
    const result = splitMarkdownBlocks(text);
    // "Block B.\n" → trailing newline → last line is "" which is blank
    // so Block B is a completed block, tail is ""
    expect(result.completedBlocks).toEqual(["Block A.", "Block B."]);
    expect(result.tail).toBe("");
  });

  it("handles fence with extended opening marker (4+ backticks)", () => {
    const text = "Before.\n\n````ts\nsome code\n````\n\nAfter.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Before.",
      "````ts\nsome code\n````",
    ]);
    expect(result.tail).toBe("After.");
  });

  it("closing fence with fewer backticks than opening does not close", () => {
    // Opening is ```` (4), closing is ``` (3): does NOT close
    const text = "Intro.\n\n````ts\ncode\n```\nmore code\n````\n\nEnd.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toEqual([
      "Intro.",
      "````ts\ncode\n```\nmore code\n````",
    ]);
    expect(result.tail).toBe("End.");
  });
});

// ─── CRLF line endings ───────────────────────────────────────────────────────

describe("CRLF line endings", () => {
  it("splits two CRLF paragraphs separated by a blank CRLF line", () => {
    const text = "First.\r\n\r\nSecond.";
    const result = splitMarkdownBlocks(text);
    // The blank line "\r\n" splits on "\n" → "\r" which trimStart() reduces
    // to "" — so splitting is detected correctly.
    expect(result.completedBlocks).toHaveLength(1);
    expect(result.tail).toBe("Second.");
  });

  it("does not split on blank lines inside a CRLF fenced code block", () => {
    const text =
      "Before.\r\n\r\n```js\r\nconst a = 1;\r\n\r\nconst b = 2;\r\n```\r\n\r\nAfter.";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toHaveLength(2);
    expect(result.tail).toBe("After.");
  });

  it("treats an unterminated CRLF fence as part of the tail", () => {
    const text = "Before.\r\n\r\n```ts\r\nconst x = ";
    const result = splitMarkdownBlocks(text);
    expect(result.completedBlocks).toHaveLength(1);
    expect(result.tail).toContain("```ts");
  });
});

describe("joinMarkdownBlocks", () => {
  it("rejoins with double newlines to recover original structure", () => {
    const original = "First.\n\nSecond.\n\nThird.";
    const split = splitMarkdownBlocks(original);
    // joining gives "First.\n\nSecond.\n\nThird." — same structure
    expect(joinMarkdownBlocks(split)).toBe(original);
  });

  it("rejoins a single-block message", () => {
    const original = "Hello.";
    const split = splitMarkdownBlocks(original);
    expect(joinMarkdownBlocks(split)).toBe(original);
  });

  it("rejoins an empty split", () => {
    expect(joinMarkdownBlocks({ completedBlocks: [], tail: "" })).toBe("");
  });
});
