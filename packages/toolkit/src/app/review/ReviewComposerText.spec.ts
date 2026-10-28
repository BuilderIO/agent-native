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

describe("review composer text", () => {
  it("round-trips lines, blank lines and mentions byte for byte", () => {
    for (const text of [
      "",
      "plain",
      "two\nlines",
      "a\n\nb\n",
      "Hey @Sam, can you check?\n@Sam Lee too",
      "  leading and trailing  ",
    ]) {
      expect(roundTrip(text).text).toBe(text);
    }
  });

  it("turns only whole-token mentions into chips, longest name first", () => {
    expect(chipLabels(roundTrip("@Sam Lee and @Sam").doc)).toEqual([
      "Sam Lee",
      "Sam",
    ]);
    expect(chipLabels(roundTrip("@Samantha mail@Sam").doc)).toEqual([]);
  });
});
