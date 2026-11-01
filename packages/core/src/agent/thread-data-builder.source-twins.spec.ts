import { readFileSync } from "node:fs";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

describe("live-client source twins", () => {
  // Ignore formatting while retaining literal whitespace in the replay/live
  // architecture check. This spec runs against uninstrumented source.
  const functionBody = (source: string, name: string): string => {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      true,
      ts.LanguageVariant.Standard,
      source.slice(source.indexOf("{", start)),
    );
    const tokens: string[] = [];
    let depth = 0;
    for (
      let kind = scanner.scan();
      kind !== ts.SyntaxKind.EndOfFileToken;
      kind = scanner.scan()
    ) {
      if (kind === ts.SyntaxKind.OpenBraceToken) depth++;
      else if (kind === ts.SyntaxKind.CloseBraceToken && --depth === 0) {
        return tokens
          .slice(1)
          .filter((token, index, all) => {
            const next = all[index + 1];
            return !(
              token === "," &&
              next !== undefined &&
              ")]}".includes(next)
            );
          })
          .join(" ");
      }
      tokens.push(scanner.getTokenText());
    }
    throw new Error(`unterminated body for ${name}`);
  };

  it("tells apart twins whose string literals differ only in whitespace", () => {
    const layout = `function f() {\n  return [\n    "draft message",\n  ];\n}`;
    expect(functionBody(layout, "f")).toBe(
      functionBody(`function f() { return ["draft message"]; }`, "f"),
    );
    expect(functionBody(layout, "f")).not.toBe(
      functionBody(`function f() { return ["draftmessage"]; }`, "f"),
    );
  });

  it("keeps clearAssistantDraftContent identical to the live client copy", () => {
    // source-read-ok: the replay/live source-twin architecture contract is checked outside instrumented mutation runs.
    const replaySource = readFileSync(
      new URL("./thread-data-builder.ts", import.meta.url),
      "utf8",
    );
    // source-read-ok: the same source-twin contract prevents replay and live draft-clearing semantics from diverging.
    const liveSource = readFileSync(
      new URL("../client/sse-event-processor.ts", import.meta.url),
      "utf8",
    );
    expect(functionBody(replaySource, "clearAssistantDraftContent")).toBe(
      functionBody(liveSource, "clearAssistantDraftContent"),
    );
  });
});
