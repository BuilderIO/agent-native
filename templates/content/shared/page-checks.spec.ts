import { describe, expect, it } from "vitest";

import {
  combinePageCheckFindings,
  countPageCheckUnit,
  checkPageCheckPlace,
  evaluatePageCheckPart,
  livePageCheckAnswers,
  pageCheckAnswers,
  pageCheckCountDistance,
  pageCheckHeadings,
  pageCheckPlaces,
  pageCheckWordingHash,
  readPageCheckPart,
  readPageCheckSentence,
  type PageCheckCountPart,
  type PageCheckPlace,
  type PageCheckResult,
  type PageCheckView,
} from "./page-checks.js";
import { countWords } from "./properties.js";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const words = (count: number, word = "word") =>
  Array.from({ length: count }, () => word).join(" ");

/** A sentence's parts, all counts, as the server would save them. */
function countParts(sentence: string): PageCheckCountPart[] {
  return readPageCheckSentence(sentence).parts.map((part) => {
    if (part.kind !== "count") throw new Error(`Not a count: ${part.text}`);
    return part;
  });
}

function placesOf(
  markdown: string,
  scope: Parameters<typeof pageCheckPlaces>[1],
  ids: Record<string, string> = {},
): PageCheckPlace[] {
  const result = pageCheckPlaces(markdown, scope, ids);
  if (result.status !== "ok") throw new Error(result.status);
  return result.places;
}

function placeOf(...args: Parameters<typeof placesOf>): PageCheckPlace {
  return required(placesOf(...args)[0]);
}

describe("reading a check's sentence", () => {
  it.each([
    ["Under 120 words", "words", null, 120],
    ["Keep it under 120 words.", "words", null, 120],
    ["at most 4 sentences", "sentences", null, 4],
    ["No more than 1,000 words", "words", null, 1000],
    ["At least 3 paragraphs", "paragraphs", 3, null],
    ["Over 300 words", "words", 300, null],
    ["Between 2 and 4 paragraphs", "paragraphs", 2, 4],
    ["4-2 sentences", "sentences", 2, 4],
    ["Exactly three paragraphs", "paragraphs", 3, 3],
    ["120 words or fewer", "words", null, 120],
    ["Five sentences or more", "sentences", 5, null],
  ] as const)("reads %j as a count", (text, unit, min, max) => {
    expect(readPageCheckPart(text)).toEqual({
      kind: "count",
      text,
      unit,
      min,
      max,
    });
  });

  it("reads the longest bound, so 'no more than' isn't 'more than'", () => {
    expect(readPageCheckPart("no more than 5 sentences")).toMatchObject({
      min: null,
      max: 5,
    });
    expect(readPageCheckPart("no fewer than 5 sentences")).toMatchObject({
      min: 5,
      max: null,
    });
  });

  it.each([
    ["de", "Unter 120 Wörter", "words", null, 120],
    ["de", "Mindestens 3 Absätze", "paragraphs", 3, null],
    ["es", "Menos de 120 palabras", "words", null, 120],
    ["es", "Al menos 2 párrafos", "paragraphs", 2, null],
    ["fr", "Moins de 120 mots", "words", null, 120],
    ["fr", "Au moins 4 phrases", "sentences", 4, null],
    ["pt", "No máximo 120 palavras", "words", null, 120],
    ["ar", "أقل من 120 كلمة", "words", null, 120],
    ["hi", "120 शब्दों से कम", "words", null, 120],
    ["hi", "कम से कम 3 अनुच्छेद", "paragraphs", 3, null],
    ["ja", "120語以内", "words", null, 120],
    ["ja", "３段落以上", "paragraphs", 3, null],
    ["ko", "120단어 이하", "words", null, 120],
    ["zh-CN", "不超过4句", "sentences", null, 4],
    ["zh-TW", "至少3段落", "paragraphs", 3, null],
  ] as const)("reads %s %j", (_locale, text, unit, min, max) => {
    expect(readPageCheckPart(text)).toEqual({
      kind: "count",
      text,
      unit,
      min,
      max,
    });
  });

  it.each([
    "Opens with something that happened to a developer",
    "make it good",
    "120 words",
    "Under 3 sentences per paragraph",
    "120文字以内",
    "Menos de 120 palabras para la intro y 3 frases",
  ])("leaves %j unread", (text) => {
    expect(readPageCheckPart(text)).toEqual({ kind: "unread", text });
  });

  it("splits a sentence into at most three parts", () => {
    const reading = readPageCheckSentence(
      "Under 120 words. Opens with something that happened to a developer this week.",
    );
    expect(reading.tooManyParts).toBe(false);
    expect(reading.parts.map((part) => part.kind)).toEqual(["count", "unread"]);

    expect(
      readPageCheckSentence("Under 9 words. At least 1 sentence. A. B.")
        .tooManyParts,
    ).toBe(true);
  });

  it("keeps numbers with separators whole", () => {
    expect(
      readPageCheckSentence("Under 1,200 words, at least 2 paragraphs").parts,
    ).toMatchObject([
      { kind: "count", unit: "words", max: 1200 },
      { kind: "count", unit: "paragraphs", min: 2 },
    ]);
  });

  it("reads a part that isn't a count as one to ask", () => {
    expect(
      readPageCheckSentence("Under 120 words. Be funny.").parts.map(
        (part) => part.kind,
      ),
    ).toEqual(["count", "unread"]);
    expect(readPageCheckSentence("   ").parts).toEqual([]);
  });
});

const PAGE = [
  "Intro one two three.",
  "",
  "Intro four five. Six seven.",
  "",
  "## The review queue",
  "",
  "Queue para one.",
  "",
  "### Deeper",
  "",
  "Deeper para.",
  "",
  "## Next",
  "",
  "Next para.",
  "",
  "- a list item",
  "- another",
].join("\n");

describe("places on a page", () => {
  it("counts the whole page the way Info does", () => {
    const page = placeOf(PAGE, { kind: "page" });
    expect(page.markdown).toBe(PAGE);
    expect(
      evaluatePageCheckPart(
        { kind: "count", text: "", unit: "words", min: null, max: 1 },
        page,
      ).count,
    ).toBe(countWords(PAGE));
  });

  it("takes the intro as the text before the first heading", () => {
    const intro = placeOf(PAGE, { kind: "intro" });
    expect(intro.path).toBe("0");
    expect(countPageCheckUnit("words", intro.markdown)).toBe(9);
    expect(countPageCheckUnit("sentences", intro.markdown)).toBe(3);
    expect(countPageCheckUnit("paragraphs", intro.markdown)).toBe(2);
  });

  it("takes a section as its heading and everything under it", () => {
    const section = placeOf(PAGE, {
      kind: "section",
      headingId: null,
      heading: "The review queue",
      level: 2,
    });
    expect(section.path).toBe("2");
    expect(section.markdown).toContain("Deeper para.");
    expect(section.markdown).not.toContain("Next para.");
    expect(countPageCheckUnit("sentences", section.markdown)).toBe(2);
  });

  it("follows a section by its heading's block ID through a rename and a move", () => {
    const ids = { "2": "heading-a" };
    const scope = {
      kind: "section",
      headingId: "heading-a",
      heading: "The review queue",
      level: 2,
    } as const;
    const renamed = PAGE.replace("## The review queue", "## Reviews");
    expect(placesOf(renamed, scope, ids)[0]?.markdown).toContain("## Reviews");

    const moved = PAGE.replace(
      "## The review queue",
      "Moved down.\n\n## The review queue",
    );
    expect(placesOf(moved, scope, { "3": "heading-a" })[0]?.path).toBe("3");
  });

  it("says a deleted section is gone and never takes another", () => {
    const withoutIds = {
      kind: "section",
      headingId: null,
      heading: "The review queue",
      level: 2,
    } as const;
    const renamed = PAGE.replace("## The review queue", "## Reviews");
    expect(pageCheckPlaces(renamed, withoutIds)).toEqual({
      status: "section_deleted",
    });
    expect(
      pageCheckPlaces(PAGE, { ...withoutIds, headingId: "gone" }, { "2": "x" }),
    ).toEqual({ status: "section_deleted" });
  });

  it("takes each paragraph outside lists, keyed by block ID or text", () => {
    const places = placesOf(PAGE, { kind: "each_paragraph" }, { "0": "p0" });
    expect(places.map((place) => place.key)).toEqual([
      "block:p0",
      expect.stringMatching(/^text:[0-9a-f]{16}:0$/),
      expect.stringMatching(/^text:/),
      expect.stringMatching(/^text:/),
      expect.stringMatching(/^text:/),
    ]);
    expect(places.map((place) => place.excerpt)).toEqual([
      "Intro one two three.",
      "Intro four five. Six seven.",
      "Queue para one.",
      "Deeper para.",
      "Next para.",
    ]);
  });

  it("keeps a paragraph's key while its text stays, wherever it moves", () => {
    const before = placesOf(PAGE, { kind: "each_paragraph" });
    const after = placesOf(`New first.\n\n${PAGE}`, { kind: "each_paragraph" });
    expect(after.slice(1).map((place) => place.key)).toEqual(
      before.map((place) => place.key),
    );
    expect(after.slice(1).map((place) => place.path)).not.toEqual(
      before.map((place) => place.path),
    );
  });

  it("changes a place's text hash only when its text changes", () => {
    const intro = placeOf(PAGE, { kind: "intro" });
    const same = placeOf(PAGE.replace("Next para.", "Other."), {
      kind: "intro",
    });
    const edited = placeOf(PAGE.replace("Intro one", "Intro uno"), {
      kind: "intro",
    });
    expect(same.textHash).toBe(intro.textHash);
    expect(edited.textHash).not.toBe(intro.textHash);
  });

  it("lists headings to choose a section from", () => {
    expect(pageCheckHeadings(PAGE, { "6": "h-next" })).toEqual([
      { path: "2", headingId: null, heading: "The review queue", level: 2 },
      { path: "4", headingId: null, heading: "Deeper", level: 3 },
      { path: "6", headingId: "h-next", heading: "Next", level: 2 },
    ]);
  });

  it("gives an empty page one empty place", () => {
    const intro = placeOf("", { kind: "intro" });
    expect(countPageCheckUnit("words", intro.markdown)).toBe(0);
    expect(placesOf("", { kind: "each_paragraph" })).toEqual([]);
  });
});

describe("answers", () => {
  it("finds a count over or under its bounds", () => {
    const intro = { markdown: words(183) };
    const under = {
      kind: "count",
      text: "Under 120 words",
      unit: "words",
      min: null,
      max: 120,
    } as const;
    expect(evaluatePageCheckPart(under, intro)).toEqual({
      finding: "not_fine",
      count: 183,
    });
    expect(pageCheckCountDistance(under, 183)).toBe(63);
    expect(evaluatePageCheckPart(under, { markdown: words(118) })).toEqual({
      finding: "fine",
      count: 118,
    });
    expect(evaluatePageCheckPart(under, { markdown: words(120) }).finding).toBe(
      "fine",
    );
    expect(pageCheckCountDistance({ min: 3, max: null }, 1)).toBe(-2);
  });

  it("answers not fine over couldn't check over fine", () => {
    expect(
      combinePageCheckFindings([{ finding: "fine" }, { finding: "couldnt" }]),
    ).toBe("couldnt");
    expect(
      combinePageCheckFindings([
        { finding: "couldnt" },
        { finding: "not_fine" },
      ]),
    ).toBe("not_fine");
    expect(combinePageCheckFindings([{ finding: "fine" }])).toBe("fine");
  });

  it("changes the wording hash with the parts or the place, not the sentence's spelling", () => {
    const parts = countParts("Under 120 words");
    const same = countParts("Keep it under 120 words.");
    const hash = pageCheckWordingHash({ parts, scope: { kind: "intro" } });
    expect(
      pageCheckWordingHash({ parts: same, scope: { kind: "intro" } }),
    ).toBe(hash);
    expect(pageCheckWordingHash({ parts, scope: { kind: "page" } })).not.toBe(
      hash,
    );
  });
});

describe("answers while someone writes", () => {
  const parts = countParts("Under 120 words");
  const scope = { kind: "intro" } as const;
  const wordingHash = pageCheckWordingHash({ parts, scope });

  function listed(markdown: string, checkedMarkdown: string): PageCheckView {
    const checked = placeOf(checkedMarkdown, scope);
    const result: PageCheckResult = {
      placeKey: "intro",
      wordingHash,
      textHash: checked.textHash,
      ...checkPageCheckPlace(parts, checked),
      checkedBy: "editor@example.com",
      checkedAt: "2026-11-25T00:00:00.000Z",
    };
    const check = {
      id: "check",
      documentId: "draft",
      sentence: "Under 120 words",
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
      answers: pageCheckAnswers(
        check,
        pageCheckPlaces(markdown, scope),
        [result],
        [],
      ),
    };
  }

  it("keeps the last answer while the text changes, so the dot stays put", () => {
    const check = listed(words(183), words(183));
    const [answer] = livePageCheckAnswers(
      check,
      pageCheckPlaces(words(125), scope),
    );
    expect(answer).toMatchObject({ answer: "not_fine", writing: true });
  });

  it("still says changed where the text had changed before the list was read", () => {
    const check = listed(words(150), words(183));
    expect(required(check.answers[0]).answer).toBe("changed");
    const [answer] = livePageCheckAnswers(
      check,
      pageCheckPlaces(words(150), scope),
    );
    expect(answer).toMatchObject({ answer: "changed", writing: false });
  });

  it("shows the checked answer once the text is the text that was checked", () => {
    const check = listed(words(118), words(118));
    const [answer] = livePageCheckAnswers(
      check,
      pageCheckPlaces(words(118), scope),
    );
    expect(answer).toMatchObject({ answer: "fine", writing: false });
  });
});
