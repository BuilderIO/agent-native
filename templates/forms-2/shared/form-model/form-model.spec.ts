import { describe, expect, it } from "vitest";

import {
  draftSurveyBlocks,
  eventFeedbackBlocks,
  pagesSurveyBlocks,
} from "./fixtures.js";
import {
  answerToText,
  blankFormBlocks,
  blockListSchema,
  buttonFor,
  createBlock,
  currentPage,
  deriveQuestions,
  evaluateCondition,
  formTitleOf,
  initialStack,
  isFormEmpty,
  popPage,
  pushPage,
  questionBlocks,
  resolveNextStep,
  splitPages,
  validatePage,
  validateSubmission,
  walkPages,
  type Answers,
  type Block,
  type ValidationCode,
} from "./index.js";
import { evaluatePage } from "./logic.js";

const YES = "pages-reply:option-0";
const NO = "pages-reply:option-1";
const yes: Answers = {
  "pages-name": "Ada",
  "pages-reply": { selected: [YES] },
};
const no: Answers = {
  "pages-name": "Ada",
  "pages-reply": { selected: [NO] },
};

function codesFor(blocks: Block[], answers: Answers): ValidationCode[] {
  return validateSubmission(blocks, answers).errors.map((e) => e.code);
}

function firstError(
  spec: Parameters<typeof questionBlocks>[0],
  value: unknown,
) {
  const blocks = [...blankFormBlocks(), ...questionBlocks(spec)];
  const { errors } = validateSubmission(blocks, {
    [spec.id ?? ""]: value as never,
  });
  return errors[0]?.code;
}

describe("blocks and questions", () => {
  it("derives questions in form order with titles, options and pages", () => {
    const questions = deriveQuestions(pagesSurveyBlocks());
    expect(questions.map((q) => [q.title, q.type, q.pageNumber])).toEqual([
      ["Your name", "INPUT_TEXT", 1],
      ["Need a reply?", "MULTIPLE_CHOICE", 1],
      ["Email", "INPUT_EMAIL", 1],
      ["Feedback", "TEXTAREA", 2],
      ["Extra comments", "TEXTAREA", 3],
    ]);
    expect(questions[1]!.options.map((o) => o.text)).toEqual(["Yes", "No"]);
    expect(questions[0]!.isRequired).toBe(true);
    expect(questions[4]!.isRequired).toBe(false);
  });

  it("ignores questions after a thank-you page", () => {
    const blocks = [
      ...draftSurveyBlocks(),
      createBlock("THANK_YOU_PAGE", {}),
      ...questionBlocks({ type: "INPUT_TEXT", title: "Never asked" }),
    ];
    expect(deriveQuestions(blocks).map((q) => q.title)).toEqual(["Your name"]);
  });

  it("detects empty forms and reads the title", () => {
    expect(isFormEmpty(blankFormBlocks())).toBe(true);
    expect(isFormEmpty(draftSurveyBlocks())).toBe(false);
    expect(formTitleOf(draftSurveyBlocks())).toBe("Draft survey");
  });

  it("rejects malformed payloads and duplicate uuids", () => {
    const block = createBlock("TEXT", { text: "hi" }, { uuid: "a" });
    expect(blockListSchema.safeParse([block]).success).toBe(true);
    expect(blockListSchema.safeParse([block, block]).success).toBe(false);
    expect(
      blockListSchema.safeParse([{ ...block, payload: { text: 5 } }]).success,
    ).toBe(false);
    expect(
      blockListSchema.safeParse([{ ...block, type: "NOPE" }]).success,
    ).toBe(false);
  });

  it("keeps unknown payload keys so later areas can extend a block", () => {
    const block = createBlock("TEXT", { text: "hi", later: 1 } as never);
    const parsed = blockListSchema.parse([block]);
    expect((parsed[0]!.payload as Record<string, unknown>).later).toBe(1);
  });

  it("renders choice answers as option labels", () => {
    const [question] = deriveQuestions(pagesSurveyBlocks()).slice(1, 2);
    expect(answerToText(question!, { selected: [YES] })).toBe("Yes");
    expect(answerToText(question!, undefined)).toBe("");
  });
});

describe("pages", () => {
  it("splits at page breaks and marks the thank-you page", () => {
    const pages = splitPages([
      ...pagesSurveyBlocks(),
      createBlock("THANK_YOU_PAGE", {}),
      createBlock("PAGE_BREAK", {}),
      createBlock("TEXT", { text: "Bye" }),
    ]);
    expect(pages.map((p) => [p.number, p.isThankYou])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ]);
    expect(pages[3]!.blocks.map((b) => b.type)).toEqual(["PAGE_BREAK", "TEXT"]);
  });
});

describe("logic", () => {
  const blocks = pagesSurveyBlocks();
  const pages = splitPages(blocks);

  it("hides a show-blocks target until its rule matches", () => {
    const hidden = evaluatePage(pages[0]!, no);
    expect(hidden.hiddenIds.has("pages-email")).toBe(true);
    const shown = evaluatePage(pages[0]!, yes);
    expect(shown.hiddenIds.has("pages-email")).toBe(false);
    expect(shown.visibleBlocks.some((b) => b.groupUuid === "pages-email")).toBe(
      true,
    );
  });

  it("jumps on a matched rule and otherwise steps to the next page", () => {
    expect(resolveNextStep(pages, 1, no)).toEqual({ kind: "page", page: 3 });
    expect(resolveNextStep(pages, 1, yes)).toEqual({ kind: "page", page: 2 });
    expect(resolveNextStep(pages, 3, no)).toEqual({ kind: "end" });
  });

  it("ignores a jump to a block that no longer exists", () => {
    const dangling = createBlock("CONDITIONAL_LOGIC", {
      condition: {
        type: "single",
        questionId: "pages-name",
        comparison: "is_not_empty",
      },
      actions: [{ type: "jump_to_page", target: "gone" }],
    });
    const edited = splitPages([
      dangling,
      ...blocks.slice(0, 5),
      ...blocks.slice(7),
    ]);
    expect(resolveNextStep(edited, 1, yes).kind).toBe("page");
  });

  it("skips a page whose blocks are all hidden", () => {
    const skipping = splitPages([
      ...draftSurveyBlocks(),
      createBlock("PAGE_BREAK", {}, { uuid: "b2" }),
      ...questionBlocks({ id: "later", type: "INPUT_TEXT", title: "Later" }),
      createBlock("PAGE_BREAK", {}, { uuid: "b3" }),
      ...questionBlocks({ id: "last", type: "INPUT_TEXT", title: "Last" }),
      createBlock("CONDITIONAL_LOGIC", {
        condition: {
          type: "single",
          questionId: "draft-name",
          comparison: "is",
          value: "skip",
        },
        actions: [{ type: "hide_blocks", targets: ["later"] }],
      }),
    ]);
    // The rule sits on page 3, so it cannot hide page 2.
    expect(resolveNextStep(skipping, 1, { "draft-name": "skip" })).toEqual({
      kind: "page",
      page: 2,
    });
  });

  it("labels the button Submit only when nothing follows", () => {
    const stateOf = (n: number, a: Answers) => evaluatePage(pages[n - 1]!, a);
    expect(buttonFor(pages, 1, yes, stateOf(1, yes))).toBe("next");
    expect(buttonFor(pages, 3, yes, stateOf(3, yes))).toBe("submit");
    expect(buttonFor(pages, 1, no, stateOf(1, no))).toBe("next");
  });

  it("hides the button when a rule asks to disable completion", () => {
    const page = splitPages([
      createBlock("CONDITIONAL_LOGIC", {
        condition: {
          type: "single",
          questionId: "q",
          comparison: "is_empty",
        },
        actions: [{ type: "hide_button_to_disable_completion" }],
      }),
    ])[0]!;
    expect(evaluatePage(page, {}).hideButton).toBe(true);
    expect(evaluatePage(page, { q: "x" }).hideButton).toBe(false);
  });

  it("makes a question required through a rule", () => {
    const page = splitPages([
      ...questionBlocks({ id: "a", type: "INPUT_TEXT", title: "A" }),
      ...questionBlocks({ id: "b", type: "INPUT_TEXT", title: "B" }),
      createBlock("CONDITIONAL_LOGIC", {
        condition: {
          type: "single",
          questionId: "a",
          comparison: "is_not_empty",
        },
        actions: [{ type: "require_answer", targets: ["b"] }],
      }),
    ]);
    const state = evaluatePage(page[0]!, { a: "x" });
    expect([...state.requiredIds]).toEqual(["b"]);
  });

  describe("comparisons", () => {
    const single = (
      comparison: Parameters<typeof evaluateCondition>[0] extends infer C
        ? C extends { comparison: infer K }
          ? K
          : never
        : never,
      answer: Answers[string],
      value?: string | number | string[],
    ) =>
      evaluateCondition(
        { type: "single", questionId: "q", comparison, value },
        { q: answer },
      );

    it("compares text case-insensitively", () => {
      expect(single("is", "Hello", "hello")).toBe(true);
      expect(single("is_not", "Hello", "world")).toBe(true);
      expect(single("contains", "Hello there", "THERE")).toBe(true);
      expect(single("does_not_contain", "Hello", "xyz")).toBe(true);
      expect(single("starts_with", "Hello", "he")).toBe(true);
      expect(single("does_not_start_with", "Hello", "lo")).toBe(true);
      expect(single("ends_with", "Hello", "LO")).toBe(true);
      expect(single("does_not_end_with", "Hello", "he")).toBe(true);
    });

    it("compares choices by option id", () => {
      const picked = { selected: ["a", "b"] };
      expect(single("is", { selected: ["a"] }, "a")).toBe(true);
      expect(single("is", picked, "a")).toBe(false);
      expect(single("is_any_of", picked, ["b", "z"])).toBe(true);
      expect(single("is_not_any_of", picked, ["z"])).toBe(true);
      expect(single("is_every_of", picked, ["a", "b"])).toBe(true);
      expect(single("is_every_of", picked, ["a", "z"])).toBe(false);
      expect(single("contains", picked, "b")).toBe(true);
      expect(single("does_not_contain", picked, "z")).toBe(true);
    });

    it("compares numbers and dates", () => {
      expect(single("equal", 3, 3)).toBe(true);
      expect(single("not_equal", 3, 4)).toBe(true);
      expect(single("greater_than", 5, 3)).toBe(true);
      expect(single("less_than", 2, 3)).toBe(true);
      expect(single("greater_or_equal", 3, 3)).toBe(true);
      expect(single("less_or_equal", 3, 3)).toBe(true);
      expect(single("is_before", "2026-01-01", "2026-02-01")).toBe(true);
      expect(single("is_after", "2026-03-01", "2026-02-01")).toBe(true);
      expect(single("greater_than", "abc", 1)).toBe(false);
    });

    it("treats an unanswered question as empty", () => {
      expect(single("is_empty", undefined)).toBe(true);
      expect(single("is_empty", { selected: [] })).toBe(true);
      expect(single("is_not_empty", "x")).toBe(true);
      expect(single("is", undefined, "x")).toBe(false);
      expect(single("is_not", undefined, "x")).toBe(true);
    });

    it("joins grouped conditions with and/or", () => {
      const a = {
        type: "single",
        questionId: "q",
        comparison: "is",
        value: "1",
      } as const;
      const b = {
        type: "single",
        questionId: "q",
        comparison: "is",
        value: "2",
      } as const;
      const answers = { q: "1" };
      expect(
        evaluateCondition(
          { type: "group", operator: "or", conditions: [a, b] },
          answers,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          { type: "group", operator: "and", conditions: [a, b] },
          answers,
        ),
      ).toBe(false);
      expect(
        evaluateCondition(
          { type: "group", operator: "and", conditions: [] },
          answers,
        ),
      ).toBe(false);
    });
  });
});

describe("navigation stack", () => {
  it("pops the visited pages, not the previous number", () => {
    let stack = initialStack;
    stack = pushPage(stack, 3);
    expect(currentPage(stack)).toBe(3);
    expect(currentPage(popPage(stack))).toBe(1);
    expect(popPage(initialStack)).toEqual([1]);
  });
});

describe("validation", () => {
  const blocks = pagesSurveyBlocks();

  it("requires visible required questions only", () => {
    const requiredIds = (answers: Answers) =>
      validateSubmission(blocks, answers).errors.map((e) => e.questionId);
    expect(requiredIds({})).toEqual(["pages-name", "pages-feedback"]);
    expect(requiredIds(yes)).toEqual(["pages-email", "pages-feedback"]);
  });

  it("does not validate pages the answers skip", () => {
    expect(codesFor(blocks, no)).toEqual([]);
    const { answers } = validateSubmission(blocks, {
      ...no,
      "pages-feedback": "never seen",
    });
    expect(answers["pages-feedback"]).toBeUndefined();
    expect(answers["pages-name"]).toBe("Ada");
  });

  it("walks pages in order", () => {
    const visited = walkPages(splitPages(blocks), yes).map(
      (v) => v.page.number,
    );
    expect(visited).toEqual([1, 2, 3]);
    expect(walkPages(splitPages(blocks), no).map((v) => v.page.number)).toEqual(
      [1, 3],
    );
  });

  it("validates one page at a time", () => {
    const pages = splitPages(blocks);
    const questions = deriveQuestions(blocks);
    const state = evaluatePage(pages[1]!, {});
    expect(
      validatePage(pages[1]!, state, questions, {}).map((e) => e.code),
    ).toEqual(["required"]);
  });

  it.each<
    [
      string,
      Parameters<typeof questionBlocks>[0],
      unknown,
      ValidationCode | undefined,
    ]
  >([
    ["email", { id: "q", type: "INPUT_EMAIL", title: "E" }, "nope", "email"],
    [
      "email ok",
      { id: "q", type: "INPUT_EMAIL", title: "E" },
      "a@example.test",
      undefined,
    ],
    [
      "phone",
      { id: "q", type: "INPUT_PHONE_NUMBER", title: "P" },
      "12",
      "phone",
    ],
    [
      "phone ok",
      { id: "q", type: "INPUT_PHONE_NUMBER", title: "P" },
      "+1 (555) 010-9999",
      undefined,
    ],
    ["url", { id: "q", type: "INPUT_LINK", title: "L" }, "ftp://x", "url"],
    [
      "url ok",
      { id: "q", type: "INPUT_LINK", title: "L" },
      "https://example.test",
      undefined,
    ],
    [
      "min chars",
      {
        id: "q",
        type: "INPUT_TEXT",
        title: "T",
        settings: { hasMinCharacters: true, minCharacters: 3 },
      },
      "ab",
      "min_chars",
    ],
    [
      "max chars",
      {
        id: "q",
        type: "TEXTAREA",
        title: "T",
        settings: { hasMaxCharacters: true, maxCharacters: 3 },
      },
      "abcd",
      "max_chars",
    ],
    [
      "min number",
      {
        id: "q",
        type: "INPUT_NUMBER",
        title: "N",
        settings: { hasMinNumber: true, minNumber: 5 },
      },
      4,
      "min_number",
    ],
    [
      "max number",
      {
        id: "q",
        type: "INPUT_NUMBER",
        title: "N",
        settings: { hasMaxNumber: true, maxNumber: 5 },
      },
      6,
      "max_number",
    ],
    [
      "number text",
      { id: "q", type: "INPUT_NUMBER", title: "N" },
      "abc",
      "invalid_value",
    ],
    [
      "date before min",
      {
        id: "q",
        type: "INPUT_DATE",
        title: "D",
        settings: { hasMinDate: true, minDate: "2026-01-10" },
      },
      "2026-01-01",
      "date_range",
    ],
    [
      "date after max",
      {
        id: "q",
        type: "INPUT_DATE",
        title: "D",
        settings: { hasMaxDate: true, maxDate: "2026-01-10" },
      },
      "2026-02-01",
      "date_range",
    ],
    [
      "date shape",
      { id: "q", type: "INPUT_DATE", title: "D" },
      "2026-02-31",
      "invalid_value",
    ],
    [
      "time",
      { id: "q", type: "INPUT_TIME", title: "T" },
      "25:00",
      "invalid_value",
    ],
    ["rating", { id: "q", type: "RATING", title: "R" }, 6, "invalid_value"],
    ["rating ok", { id: "q", type: "RATING", title: "R" }, 5, undefined],
    [
      "scale",
      {
        id: "q",
        type: "LINEAR_SCALE",
        title: "S",
        settings: { start: 1, end: 5 },
      },
      0,
      "invalid_value",
    ],
  ])("%s", (_name, spec, value, expected) => {
    expect(firstError(spec, value)).toBe(expected);
  });

  it("checks choice selections", () => {
    const base = { id: "q", title: "C", options: ["a", "b", "c"] };
    const ids = (n: number) => `q:option-${n}`;
    expect(
      firstError(
        {
          ...base,
          type: "CHECKBOXES",
          settings: { hasMinChoices: true, minChoices: 2 },
        },
        { selected: [ids(0)] },
      ),
    ).toBe("min_selections");
    expect(
      firstError(
        {
          ...base,
          type: "MULTI_SELECT",
          settings: { hasMaxChoices: true, maxChoices: 1 },
        },
        { selected: [ids(0), ids(1)] },
      ),
    ).toBe("max_selections");
    expect(
      firstError(
        { ...base, type: "MULTIPLE_CHOICE" },
        { selected: [ids(0), ids(1)] },
      ),
    ).toBe("max_selections");
    expect(
      firstError({ ...base, type: "DROPDOWN" }, { selected: ["ghost"] }),
    ).toBe("invalid_value");
    expect(
      firstError({ ...base, type: "DROPDOWN" }, { selected: [ids(2)] }),
    ).toBe(undefined);
  });

  it("flags an empty other option", () => {
    const [title, ...options] = questionBlocks({
      id: "q",
      type: "MULTIPLE_CHOICE",
      title: "C",
      options: ["a", "Other"],
    });
    const other = options[1]!;
    (other.payload as Record<string, unknown>).isOtherOption = true;
    const form = [...blankFormBlocks(), title!, ...options];
    const empty = validateSubmission(form, { q: { selected: [other.uuid] } });
    expect(empty.errors[0]?.code).toBe("other_empty");
    const filled = validateSubmission(form, {
      q: { selected: [other.uuid], other: "Tea" },
    });
    expect(filled.errors).toEqual([]);
  });

  it("validates only the published questions of an edited form", () => {
    const published = eventFeedbackBlocks({ withSnack: false });
    expect(
      codesFor(published, { "feedback-snack": "x", "feedback-comments": "ok" }),
    ).toEqual([]);
  });
});
