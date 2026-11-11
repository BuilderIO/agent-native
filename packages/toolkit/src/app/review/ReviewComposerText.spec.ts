import { getSchema } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import {
  parseReviewComposerText,
  serializeReviewComposerDoc,
} from "./ReviewComposerText.js";
import { ReviewMentionNode } from "./ReviewMentionChip.js";

const schema = getSchema([StarterKit, ReviewMentionNode]);
const people = [
  { label: "Sam", email: "sam@example.com" },
  { label: "Sam Lee", email: "sam.lee@example.com" },
];

function roundTrip(text: string, mentions = people) {
  const doc = ProseMirrorNode.fromJSON(
    schema,
    parseReviewComposerText(text, mentions),
  );
  return { doc, text: serializeReviewComposerDoc(doc) };
}

function chipLabels(doc: ProseMirrorNode) {
  const labels: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "reviewMention") labels.push(node.attrs.label);
  });
  return labels;
}

function textOf(doc: ProseMirrorNode) {
  return doc.textBetween(0, doc.content.size, "");
}

describe("review composer text", () => {
  it("round-trips lines, blank lines, formatting and mentions", () => {
    for (const text of [
      "",
      "plain",
      "two\nlines",
      "a\n\nb",
      "Hey @Sam, can you check?\n@Sam Lee too",
      "**bold**, *italic*, ~~gone~~, `code` and [a link](https://example.com)",
      "- one\n- two\n\n1. first\n\n> quoted\n\n```\ncode\n```",
    ]) {
      expect(roundTrip(text).text).toBe(text);
    }
  });

  it("saves the spaces and newline at the ends as Markdown drops them", () => {
    expect(roundTrip("a\n\nb\n").text).toBe("a\n\nb");
    expect(roundTrip("  leading and trailing  ").text).toBe(
      "leading and trailing",
    );
  });

  it("turns only whole-token mentions into chips, longest name first", () => {
    expect(chipLabels(roundTrip("@Sam Lee and @Sam").doc)).toEqual([
      "Sam Lee",
      "Sam",
    ]);
    expect(chipLabels(roundTrip("@Samantha mail@Sam").doc)).toEqual([]);
  });

  it("reads a whole code point on each side of a mention", () => {
    expect(chipLabels(roundTrip("\u{1F600}@Sam").doc)).toEqual(["Sam"]);
    expect(chipLabels(roundTrip("@Sam\u{1F600}").doc)).toEqual(["Sam"]);
    expect(chipLabels(roundTrip("\u{1D400}@Sam").doc)).toEqual([]);
    expect(chipLabels(roundTrip("@Sam\u{1D400}").doc)).toEqual([]);
  });

  it("parses a long line full of @ signs in linear time", () => {
    const unmatched = "x@".repeat(100_000);
    const matched = "@Sam ".repeat(40_000);
    const started = performance.now();
    const unmatchedDoc = parseReviewComposerText(unmatched, people);
    const matchedDoc = parseReviewComposerText(matched, people);
    const elapsedMs = performance.now() - started;

    // Past the Markdown limit the rest opens as plain lines, chips and all.
    expect(textOf(ProseMirrorNode.fromJSON(schema, unmatchedDoc))).toBe(
      unmatched,
    );
    expect(
      chipLabels(ProseMirrorNode.fromJSON(schema, matchedDoc)),
    ).toHaveLength(40_000);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
