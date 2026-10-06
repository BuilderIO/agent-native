import { describe, expect, it } from "vitest";

import {
  bodyHoldsChanges,
  mergeDocumentBodyIntents,
} from "./document-intent-merge.js";

const base = "Paragraph one\nParagraph two\nParagraph three";
const browser = "Browser edit\nParagraph two\nParagraph three";
const agent = "Agent edit\nParagraph two\nParagraph three";

describe("document body intent merge", () => {
  it.each([
    ["abc", "aXc", "aYbc", "aYXc"],
    ["abc", "aXc", "abYc", "aXYc"],
  ])(
    "keeps an insertion at a replacement boundary in either order (%s)",
    (paragraphBase, replacement, insertion, expected) => {
      const replacementIntent = {
        writerId: "browser:a",
        operationId: "a:1",
        authoredBaseRevision: 2,
      };
      const insertionIntent = {
        writerId: "mcp:z",
        operationId: "z:1",
        authoredBaseRevision: 2,
      };
      for (const [
        incoming,
        prior,
        authoredCandidateContent,
        currentContent,
      ] of [
        [replacementIntent, insertionIntent, replacement, insertion],
        [insertionIntent, replacementIntent, insertion, replacement],
      ] as const) {
        expect(
          mergeDocumentBodyIntents({
            authoredBaseContent: paragraphBase,
            authoredCandidateContent,
            currentContent,
            currentRevision: 3,
            incoming,
            priorIntents: [
              {
                ...prior,
                committedRevision: 3,
                affectedBlockIndexes: [0],
                canonicalChanged: true,
              },
            ],
          }),
        ).toMatchObject({
          status: "resolved",
          content: expected,
          displaced: false,
        });
      }
    },
  );

  it("still treats an insertion inside replaced text as overlapping", () => {
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: "abcd",
        authoredCandidateContent: "abYcd",
        currentContent: "aXd",
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
      }),
    ).toMatchObject({ content: "aXd", displaced: true });
  });

  it("still orders competing insertions at the same position", () => {
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: "abc",
        authoredCandidateContent: "aYbc",
        currentContent: "aZbc",
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
      }),
    ).toMatchObject({ content: "aZbc", displaced: true });
  });

  it.each([
    ["holds the start of", "Alpha.", "Alpha. ", "Alpha. tab one"],
    ["finished", "Alpha.", "Alpha. tab one", "Alpha. "],
  ])(
    "keeps a peer's whole insertion when the incoming body %s it",
    (_case, paragraphBase, authoredCandidateContent, currentContent) => {
      for (const incomingWriter of ["browser:a", "browser:z"]) {
        expect(
          mergeDocumentBodyIntents({
            authoredBaseContent: `${paragraphBase}\nCharlie`,
            authoredCandidateContent: `${authoredCandidateContent}\nCharlie two`,
            currentContent: `${currentContent}\nCharlie`,
            currentRevision: 3,
            incoming: {
              writerId: incomingWriter,
              operationId: `${incomingWriter}:1`,
              authoredBaseRevision: 2,
            },
            priorIntents: [
              {
                writerId: "browser:m",
                operationId: "m:1",
                authoredBaseRevision: 2,
                committedRevision: 3,
                affectedBlockIndexes: [0],
                canonicalChanged: true,
              },
            ],
          }),
        ).toMatchObject({
          status: "resolved",
          content: "Alpha. tab one\nCharlie two",
          displaced: false,
        });
      }
    },
  );

  it("merges a block that several of a peer's saves touched", () => {
    const peerSave = (generation: number, committedRevision: number) => ({
      writerId: "browser:a",
      operationId: `a:${generation}`,
      generation,
      authoredBaseRevision: 1,
      committedRevision,
      affectedBlockIndexes: [0],
      canonicalChanged: true,
    });
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: "Alpha. one\nCharlie. two",
        // Tab B's copy of tab A's typing arrived mid-word.
        authoredCandidateContent: "Alpha. one thr\nCharlie. two four",
        currentContent: "Alpha. one three five\nCharlie. two",
        currentRevision: 4,
        incoming: {
          writerId: "browser:b",
          operationId: "b:30",
          generation: 30,
          authoredBaseRevision: 2,
        },
        priorIntents: [peerSave(20, 3), peerSave(30, 4)],
      }),
    ).toMatchObject({
      status: "resolved",
      content: "Alpha. one three five\nCharlie. two four",
      displaced: false,
    });
  });

  it("lets a writer's later save replace the blocks its own earlier saves wrote", () => {
    const ownSave = (generation: number, committedRevision: number) => ({
      writerId: "browser:a",
      operationId: `a:${generation}`,
      generation,
      authoredBaseRevision: 0,
      committedRevision,
      affectedBlockIndexes: [0],
      canonicalChanged: true,
    });
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: "Alpha.\nCharlie.",
        authoredCandidateContent: "Alpha. one three five\nCharlie.",
        currentContent: "Alpha. one three\nCharlie. two",
        currentRevision: 3,
        incoming: {
          writerId: "browser:a",
          operationId: "a:30",
          generation: 30,
          authoredBaseRevision: 0,
        },
        priorIntents: [
          ownSave(10, 1),
          {
            writerId: "browser:b",
            operationId: "b:10",
            generation: 10,
            authoredBaseRevision: 0,
            committedRevision: 2,
            affectedBlockIndexes: [1],
            canonicalChanged: true,
          },
          ownSave(20, 3),
        ],
      }),
    ).toMatchObject({
      status: "resolved",
      content: "Alpha. one three five\nCharlie. two",
      displaced: false,
    });
  });

  it.each([
    ["Original passage", "Browser passage"],
    ["Base passage", "Browser passage"],
  ])(
    "treats competing word replacements as one overlap (%s)",
    (baseWord, browserWord) => {
      expect(
        mergeDocumentBodyIntents({
          authoredBaseContent: baseWord,
          authoredCandidateContent: browserWord,
          currentContent: "Agent passage",
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
        }),
      ).toMatchObject({ content: "Agent passage", displaced: true });
    },
  );

  it("keeps independent edits inside one plain paragraph in both delivery orders", () => {
    const paragraphBase = "Alpha beta gamma";
    const browserParagraph = "Alpha browser beta gamma";
    const agentParagraph = "Alpha beta agent gamma";
    const browserIntent = {
      writerId: "browser:a",
      operationId: "a:1",
      authoredBaseRevision: 2,
    };
    const agentIntent = {
      writerId: "mcp:z",
      operationId: "z:1",
      authoredBaseRevision: 2,
    };
    for (const [incoming, prior, authoredCandidateContent, currentContent] of [
      [browserIntent, agentIntent, browserParagraph, agentParagraph],
      [agentIntent, browserIntent, agentParagraph, browserParagraph],
    ] as const) {
      expect(
        mergeDocumentBodyIntents({
          authoredBaseContent: paragraphBase,
          authoredCandidateContent,
          currentContent,
          currentRevision: 3,
          incoming,
          priorIntents: [
            {
              ...prior,
              committedRevision: 3,
              affectedBlockIndexes: [0],
              canonicalChanged: true,
            },
          ],
        }),
      ).toMatchObject({
        status: "resolved",
        content: "Alpha browser beta agent gamma",
        displaced: false,
      });
    }
  });

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

  describe("a body that already holds the other body's changes", () => {
    const merge = (args: {
      base: string;
      candidate: string;
      current: string;
    }) =>
      mergeDocumentBodyIntents({
        authoredBaseContent: args.base,
        authoredCandidateContent: args.candidate,
        currentContent: args.current,
        currentRevision: 21,
        incoming: {
          writerId: "browser:a",
          operationId: "a:40",
          generation: 40,
          authoredBaseRevision: 20,
        },
        priorIntents: [],
      });

    it.each([
      [
        "a peer's edit to a line",
        "Seed one\nSeed two\nLine one",
        "Seed one\nSeed two peer\nLine one",
        "Seed one\nSeed two peer\nLine one\nLine two\nLine three",
      ],
      [
        "a peer's new line",
        "Seed one\nSeed two\nLine one",
        "Seed one\nPeer line\nSeed two\nLine one",
        "Seed one\nPeer line\nSeed two\nLine one\nLine two",
      ],
      [
        "a partly typed line the other tab saved first",
        "Seed one\n<empty-block/>",
        "Seed one\nTab one li",
        "Seed one\nTab one line seven.\n<empty-block/>",
      ],
      [
        "an empty line the other tab saved before this tab typed into it",
        "Seed one\nLine one.",
        "Seed one\nLine one.\n<empty-block/>",
        "Seed one\nLine one.\nLine two",
      ],
      [
        "text it typed into the middle of",
        "Seed one\nLine one",
        "Seed one peer line\nLine one",
        "Seed one peer new line\nLine one\nLine two",
      ],
      [
        "a line ending in the same character as its new line",
        "Seed one\nLine seven.\n<empty-block/>",
        "Seed one\nLine seven.\nLine eight.",
        "Seed one\nLine seven.\nLine eight.\nLine nine.",
      ],
    ])(
      "writes a candidate that holds %s",
      (_case, base, current, candidate) => {
        expect(merge({ base, current, candidate })).toMatchObject({
          status: "resolved",
          content: candidate,
          displaced: false,
        });
      },
    );

    it("writes a same-shape candidate that types on after the current body", () => {
      expect(
        merge({
          base: "Seed one\nAlpha",
          current: "Seed one\nAlpha be",
          candidate: "Seed one\nAlpha beta",
        }),
      ).toEqual({
        status: "resolved",
        content: "Seed one\nAlpha beta",
        changedBlockIndexes: [1],
        displaced: false,
      });
    });

    it("keeps the current body when it holds an older queued candidate", () => {
      const current = "Seed one\nTab one line seven.\n<empty-block/>";
      expect(
        merge({
          base: "Seed one\n<empty-block/>",
          current,
          candidate: "Seed one\nTab one li",
        }),
      ).toEqual({
        status: "resolved",
        content: current,
        changedBlockIndexes: [],
        displaced: false,
      });
    });

    it.each([
      [
        "lacks a change that never reached the editor",
        "Seed one\nSeed two\nLine one",
        "Seed one agent\nSeed two\nLine one",
        "Seed one\nSeed two\nLine one\nLine two",
      ],
      [
        "keeps a line the current body removed",
        "Seed one\nSeed two\nLine one",
        "Seed one\nSeed two",
        "Seed one\nSeed two\nLine one\nLine two",
      ],
      [
        "reverses a move",
        "Seed one\nSeed two\nLine one",
        "Seed two\nSeed one\nLine one",
        "Seed one\nSeed two\nLine one\nLine two",
      ],
      [
        "rewrites text the current body added",
        "Seed one\nSeed two\nLine one",
        "Seed one peer\nSeed two\nLine one",
        "Seed one pear\nSeed two\nLine one\nLine two",
      ],
      [
        "has its own copy of a line elsewhere",
        "Seed one\nLine one",
        "Seed one\nPeer line\nLine one",
        "Seed one\nLine one\nPeer line\nLine two",
      ],
      [
        "drops a repeat the current body added",
        "Seed one\nLine one",
        "Seed one\nSeed one\nLine one",
        "Seed one\nLine one\nLine two",
      ],
      [
        "lacks literal empty-block text the current body added to code",
        "```\nconst a = '';\n```\nLine one",
        "```\nconst a = '<empty-block/>';\n```\nLine one",
        "```\nconst a = '';\n```\nLine one\nLine two",
      ],
    ])("preserves a candidate that %s", (_case, base, current, candidate) => {
      expect(merge({ base, current, candidate })).toEqual({
        status: "preservation-required",
        reason: "structure",
      });
    });

    it("does not guess which repeated word each body changed", () => {
      // The current body inserted "foo " and the candidate replaced "bar"
      // with "foo". Either body alone reads as holding the other's change.
      expect(
        merge({
          base: "foo bar",
          current: "foo foo bar",
          candidate: "foo foo",
        }),
      ).toMatchObject({ status: "preservation-required" });
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

  it("merges a save authored on the blank-line body an agent stored", () => {
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: "Alpha.\n\nBravo.\n\nCharlie.",
        authoredCandidateContent: "Alpha.\nBravo.\nCharlie. two",
        currentContent: "Alpha. one\nBravo.\nCharlie.",
        currentRevision: 2,
        incoming: {
          writerId: "browser:b",
          operationId: "b:1",
          authoredBaseRevision: 1,
        },
        priorIntents: [
          {
            writerId: "browser:a",
            operationId: "a:1",
            authoredBaseRevision: 1,
            committedRevision: 2,
            affectedBlockIndexes: [0],
            canonicalChanged: true,
          },
        ],
      }),
    ).toMatchObject({
      status: "resolved",
      content: "Alpha. one\nBravo.\nCharlie. two",
      displaced: false,
    });
  });

  it("still preserves a save onto a body that does not serialize as stored", () => {
    expect(
      mergeDocumentBodyIntents({
        authoredBaseContent: "Alpha.\n\nBravo.\n\nCharlie.",
        authoredCandidateContent: "Alpha.\nBravo.\nCharlie. two",
        currentContent: "Alpha. one\n\nBravo.\n\nCharlie.",
        currentRevision: 2,
        incoming: {
          writerId: "browser:b",
          operationId: "b:1",
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

  it("compares a held body against the blank-line body an agent stored", () => {
    expect(
      bodyHoldsChanges(
        "Alpha.\n\nBravo.",
        "Alpha. peer\nBravo. mine more",
        "Alpha. peer\nBravo. mine",
      ),
    ).toBe(true);
  });
});
