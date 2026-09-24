import { describe, expect, it } from "vitest";

import { mergeDocumentBodyIntents } from "./document-intent-merge.js";

const base = "Paragraph one\nParagraph two\nParagraph three";
const browser = "Browser edit\nParagraph two\nParagraph three";
const agent = "Agent edit\nParagraph two\nParagraph three";

describe("document body intent merge", () => {
  it("converges to one concurrent winner in opposite delivery orders", () => {
    const browserIntent = {
      writerId: "browser:a",
      operationId: "a:1",
      generation: 1,
      authoredBaseRevision: 2,
    };
    const agentIntent = {
      writerId: "mcp:z",
      operationId: "z:1",
      authoredBaseRevision: 2,
    };
    const afterBrowser = mergeDocumentBodyIntents({
      authoredBaseContent: base,
      authoredCandidateContent: agent,
      currentContent: browser,
      currentRevision: 3,
      incoming: agentIntent,
      priorIntents: [
        {
          ...browserIntent,
          committedRevision: 3,
          affectedBlockIndexes: [0],
          canonicalChanged: true,
        },
      ],
    });
    const afterAgent = mergeDocumentBodyIntents({
      authoredBaseContent: base,
      authoredCandidateContent: browser,
      currentContent: agent,
      currentRevision: 3,
      incoming: browserIntent,
      priorIntents: [
        {
          ...agentIntent,
          committedRevision: 3,
          affectedBlockIndexes: [0],
          canonicalChanged: true,
        },
      ],
    });
    expect(afterBrowser).toMatchObject({ content: agent, displaced: false });
    expect(afterAgent).toMatchObject({ content: agent, displaced: true });
  });

  it("retains independent edits when an overlap loses", () => {
    const result = mergeDocumentBodyIntents({
      authoredBaseContent: base,
      authoredCandidateContent: "Browser edit\nParagraph two\nIndependent edit",
      currentContent: agent,
      currentRevision: 3,
      incoming: {
        writerId: "browser:a",
        operationId: "a:1",
        authoredBaseRevision: 2,
      },
      priorIntents: [
        {
          writerId: "mcp:z",
          operationId: "z:1",
          authoredBaseRevision: 2,
          committedRevision: 3,
          affectedBlockIndexes: [0],
          canonicalChanged: true,
        },
      ],
    });
    expect(result).toMatchObject({
      status: "resolved",
      content: agent.replace("Paragraph three", "Independent edit"),
      displaced: true,
      changedBlockIndexes: [2],
    });
  });

  it("preserves uncertain duplicate block identity", () => {
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: "same\nsame",
        authoredCandidateContent: "mine\nsame",
        currentContent: "theirs\nsame",
        currentRevision: 2,
        incoming: {
          writerId: "browser:a",
          operationId: "a:1",
          authoredBaseRevision: 1,
        },
        priorIntents: [
          {
            writerId: "mcp:z",
            operationId: "z:1",
            authoredBaseRevision: 1,
            committedRevision: 2,
            affectedBlockIndexes: [0],
            canonicalChanged: true,
          },
        ],
      }),
    ).toEqual({ status: "preservation-required", reason: "structure" });
  });
});
