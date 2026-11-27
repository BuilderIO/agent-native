import { nfmToDoc } from "@shared/nfm";
import {
  checkPageCheckPlace,
  pageCheckAnswers,
  pageCheckPlaces,
  pageCheckWordingHash,
  readPageCheckSentence,
  type PageCheckCountPart,
  type PageCheckResult,
  type PageCheckScope,
  type PageCheckView,
} from "@shared/page-checks";
import { getSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import {
  pageCheckMarkShape,
  pageCheckScopeAt,
  readLivePageChecks,
} from "./page-check-body";

const schema = getSchema([StarterKit]);

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const words = (count: number) =>
  Array.from({ length: count }, () => "word").join(" ");

function countParts(sentence: string): PageCheckCountPart[] {
  return readPageCheckSentence(sentence).parts.map((part) => {
    if (part.kind !== "count") throw new Error(`Not a count: ${part.text}`);
    return part;
  });
}

function editorDoc(markdown: string): ProseMirrorNode {
  return schema.nodeFromJSON(nfmToDoc(markdown));
}

function listed(
  sentence: string,
  scope: PageCheckScope,
  checkedMarkdown: string,
): PageCheckView {
  const parts = countParts(sentence);
  const wordingHash = pageCheckWordingHash({ parts, scope });
  const places = pageCheckPlaces(checkedMarkdown, scope);
  const results: PageCheckResult[] =
    places.status === "ok"
      ? places.places.map((place) => ({
          placeKey: place.key,
          wordingHash,
          textHash: place.textHash,
          ...checkPageCheckPlace(parts, place),
          checkedBy: "editor@example.com",
          checkedAt: "2026-11-25T00:00:00.000Z",
        }))
      : [];
  const check = {
    id: `check:${sentence}`,
    documentId: "draft",
    sentence,
    parts,
    scope,
    wordingHash,
    sure: "balanced" as const,
    paused: false,
    createdBy: "editor@example.com",
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
    skips: [],
  };
  return {
    ...check,
    answers: pageCheckAnswers(check, places, results, []),
  };
}

describe("checks in the editor's text", () => {
  const markdown = `${words(183)}\n\nSecond intro paragraph.\n\n## Details\n\n${words(12)}\n\n### Deeper\n\nInside.\n\n## Later\n\nEnd.`;

  it("puts the intro's dot on its first paragraph and quotes up to the first heading", () => {
    const doc = editorDoc(markdown);
    const check = listed("Under 120 words", { kind: "intro" }, markdown);
    const live = readLivePageChecks(doc, [check]);

    expect(live.marks).toHaveLength(1);
    const mark = required(live.marks[0]);
    expect(mark.answer.answer).toBe("not_fine");
    expect(mark.from).toBe(0);
    const heading = doc.child(2);
    expect(heading.type.name).toBe("heading");
    expect(mark.to).toBe(doc.child(0).nodeSize + doc.child(1).nodeSize);
    expect(pageCheckMarkShape(mark.answer.answer)).toBe("filled");
  });

  it("ends a section at the next heading at its level, past deeper ones", () => {
    const doc = editorDoc(markdown);
    const scope: PageCheckScope = {
      kind: "section",
      headingId: null,
      heading: "Details",
      level: 2,
    };
    const check = listed("At least 50 words", scope, markdown);
    const mark = required(readLivePageChecks(doc, [check]).marks[0]);

    let detailsAt = -1;
    let laterAt = -1;
    doc.forEach((child, offset) => {
      if (child.textContent === "Details") detailsAt = offset;
      if (child.textContent === "Later") laterAt = offset;
    });
    expect(mark.from).toBe(detailsAt);
    expect(mark.to).toBe(laterAt);
  });

  it("marks each section that doesn't pass across its whole range", () => {
    const doc = editorDoc(markdown);
    const check = listed(
      "At least 5 words",
      { kind: "each_section" },
      markdown,
    );
    const marks = readLivePageChecks(doc, [check]).marks;

    const offsets = new Map<string, number>();
    doc.forEach((child, offset) => offsets.set(child.textContent, offset));
    expect(marks.map((mark) => [mark.from, mark.to])).toEqual([
      [offsets.get("Deeper"), offsets.get("Later")],
      [offsets.get("Later"), doc.content.size],
    ]);
  });

  it("marks each paragraph that doesn't pass, and only those", () => {
    const doc = editorDoc(markdown);
    const check = listed(
      "Under 20 words",
      { kind: "each_paragraph" },
      markdown,
    );
    const marks = readLivePageChecks(doc, [check]).marks;

    expect(marks).toHaveLength(1);
    expect(required(marks[0]).from).toBe(0);
    expect(required(marks[0]).to).toBe(doc.child(0).nodeSize);
  });

  it("leaves no dot where the check passes", () => {
    const short = `${words(80)}\n\n## Details\n\nMore.`;
    const check = listed("Under 120 words", { kind: "intro" }, short);
    const live = readLivePageChecks(editorDoc(short), [check]);

    expect(live.marks).toHaveLength(0);
    expect(live.answers.get(check.id)?.[0]?.answer).toBe("fine");
  });

  it("keeps the dot while the text is being cut, until the next check", () => {
    const check = listed("Under 120 words", { kind: "intro" }, markdown);
    const cut = markdown.replace(words(183), words(118));
    const live = readLivePageChecks(editorDoc(cut), [check]);

    expect(live.marks).toHaveLength(1);
    expect(required(live.marks[0]).answer).toMatchObject({
      answer: "not_fine",
      writing: true,
    });
  });

  it("finds the section the cursor is in, or the intro above the first heading", () => {
    const doc = editorDoc(markdown);
    const live = readLivePageChecks(doc, []);

    expect(pageCheckScopeAt(doc, 1, live)).toEqual({ kind: "intro" });
    let insideDeeper = -1;
    doc.forEach((child, offset) => {
      if (child.textContent === "Inside.") insideDeeper = offset + 1;
    });
    expect(pageCheckScopeAt(doc, insideDeeper, live)).toMatchObject({
      kind: "section",
      heading: "Deeper",
      level: 3,
    });
  });

  it("finds the cursor's section on a page with no checks yet", () => {
    const doc = editorDoc(markdown);
    let insideDeeper = -1;
    doc.forEach((child, offset) => {
      if (child.textContent === "Inside.") insideDeeper = offset + 1;
    });

    expect(pageCheckScopeAt(doc, insideDeeper, null)).toMatchObject({
      kind: "section",
      heading: "Deeper",
      level: 3,
    });
  });
});
