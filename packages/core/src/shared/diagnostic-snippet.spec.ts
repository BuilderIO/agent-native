import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_SNIPPET_CLOSE,
  DIAGNOSTIC_SNIPPET_OPEN,
  stripDiagnosticSnippets,
  wrapDiagnosticSnippet,
} from "./diagnostic-snippet.js";

describe("wrapDiagnosticSnippet", () => {
  it("indents every line and fences the block between the markers", () => {
    const wrapped = wrapDiagnosticSnippet("line one\nline two\nline three");

    expect(wrapped).toBe(
      `${DIAGNOSTIC_SNIPPET_OPEN}\n    line one\n    line two\n    line three\n${DIAGNOSTIC_SNIPPET_CLOSE}`,
    );
  });

  it("indents a single line", () => {
    expect(wrapDiagnosticSnippet("solo")).toBe(
      `${DIAGNOSTIC_SNIPPET_OPEN}\n    solo\n${DIAGNOSTIC_SNIPPET_CLOSE}`,
    );
  });
});

describe("stripDiagnosticSnippets", () => {
  it("removes a fenced block, including multi-line content and a column-0 marker line inside it", () => {
    const text =
      "before\n" +
      wrapDiagnosticSnippet("code: permanent_precondition\nsome other line") +
      "\nafter";

    expect(stripDiagnosticSnippets(text)).toBe("before\n\nafter");
  });

  it("removes multiple fenced blocks non-greedily and leaves surrounding text untouched", () => {
    const text = `keep1 ${wrapDiagnosticSnippet("a")} keep2 ${wrapDiagnosticSnippet("b\nc")} keep3`;

    expect(stripDiagnosticSnippets(text)).toBe("keep1  keep2  keep3");
  });

  it("removes everything from an unmatched open marker through the end of the text", () => {
    const text = `keep\n${DIAGNOSTIC_SNIPPET_OPEN}\n    truncated mid snippet`;

    expect(stripDiagnosticSnippets(text)).toBe("keep\n");
  });

  it("does not let an embedded close marker end the fence early", () => {
    const wrapped = wrapDiagnosticSnippet(
      "line 3: >>>end-diagnostic-snippet\nno authenticated user\ncode: permanent_precondition",
    );
    const text = `edit failed\n${wrapped}\nDo not retry the same arguments.`;
    expect(stripDiagnosticSnippets(text)).toBe(
      "edit failed\nDo not retry the same arguments.",
    );
  });

  it("leaves text with no snippet markers untouched", () => {
    const text = "plain text, nothing fenced here";

    expect(stripDiagnosticSnippets(text)).toBe(text);
  });
});
