// @vitest-environment happy-dom
import {
  readPageCheckSentence,
  type PageCheckPlaceAnswer,
  type PageCheckScope,
  type PageCheckTry,
  type PageCheckView,
} from "@shared/page-checks";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { messagesByLocale } from "@/i18n-data";
import { byLabel, click, queryByLabel, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, unknown>) => {
    const lookup = (path: string) =>
      path
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          messagesByLocale["en-US"],
        ) as string | undefined;
    const count = values?.count;
    const text =
      (typeof count === "number"
        ? lookup(`${key}_${new Intl.PluralRules("en-US").select(count)}`)
        : undefined) ?? lookup(key);
    if (text === undefined) throw new Error(`No message ${key}`);
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(values?.[name]),
    );
  },
}));

import {
  PageChecksProvider,
  type PageChecksActions,
  type PageChecksState,
} from "./page-checks-context";
import { PageCheckDialog } from "./PageCheckDialog";
import { PageChecksPill, PageChecksSection } from "./PageChecksSection";

const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

const body = `${words(183)}.\n\n## Details\n\nShort.`;

function check(overrides: Partial<PageCheckView> = {}): PageCheckView {
  return {
    id: "check-1",
    documentId: "page-1",
    sentence: "Under 120 words",
    parts: [
      {
        kind: "count",
        text: "Under 120 words",
        unit: "words",
        min: null,
        max: 120,
      },
    ],
    scope: { kind: "intro" },
    wordingHash: "wording-1",
    sure: "balanced",
    paused: false,
    createdBy: "editor@example.com",
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
    answers: [],
    skips: [],
    ...overrides,
  };
}

function answer(
  shown: PageCheckPlaceAnswer["answer"],
  overrides: Partial<PageCheckPlaceAnswer> = {},
): PageCheckPlaceAnswer {
  return {
    key: "intro",
    place: {
      key: "intro",
      path: "0",
      blockId: null,
      textHash: "text-1",
      excerpt: "word0 word1",
    },
    answer: shown,
    result:
      shown === "not_fine"
        ? {
            placeKey: "intro",
            wordingHash: "wording-1",
            textHash: "text-1",
            finding: "not_fine",
            parts: [{ finding: "not_fine", count: 183 }],
            checkedBy: "editor@example.com",
            checkedAt: "2026-11-25T00:00:00.000Z",
          }
        : null,
    ...overrides,
  };
}

function actions(
  overrides: Partial<PageChecksActions> = {},
): PageChecksActions {
  return {
    enabled: true,
    canEdit: true,
    openAdd: vi.fn(),
    openEdit: vi.fn(),
    closeDialog: vi.fn(),
    openList: vi.fn(),
    focusCheck: vi.fn(),
    runNow: vi.fn(),
    tryCheck: vi.fn(async (): Promise<PageCheckTry> => {
      throw new Error("Not tried in this test");
    }),
    save: vi.fn(async () => true),
    setPaused: vi.fn(async () => {}),
    remove: vi.fn(async () => true),
    skip: vi.fn(async () => {}),
    prefillComment: vi.fn(),
    bodyMarkdown: () => body,
    noteLocalEdit: vi.fn(),
    publishLive: vi.fn(),
    registerBody: vi.fn(),
    ...overrides,
  };
}

function state(overrides: Partial<PageChecksState> = {}): PageChecksState {
  const checks = overrides.checks ?? [];
  return {
    list: { documentId: "page-1", canEdit: true, checks },
    checks,
    loading: false,
    loadFailed: false,
    live: null,
    running: false,
    runFailed: false,
    dialog: null,
    ...overrides,
  };
}

function render(value: { actions: PageChecksActions; state: PageChecksState }) {
  return renderUi(
    <PageChecksProvider value={value}>
      <PageChecksPill />
      <PageChecksSection />
      <PageCheckDialog />
    </PageChecksProvider>,
  );
}

function buttonNamed(name: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent.trim() === name,
  );
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

function setText(control: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("page checks", () => {
  it("lists what each check found, with Check now and Add for editors", async () => {
    const page = actions();
    render({
      actions: page,
      state: state({ checks: [check({ answers: [answer("not_fine")] })] }),
    });

    const row = document.querySelector("[data-page-check-row='check-1']");
    expect(row?.textContent).toContain("Under 120 words");
    expect(row?.textContent).toContain("The intro · 183 words, 63 over");
    expect(
      row?.querySelector(".page-check-dot")?.getAttribute("data-shape"),
    ).toBe("filled");

    await click(required(buttonNamed("Check now")));
    expect(page.runNow).toHaveBeenCalledOnce();
    await click(required(buttonNamed("Add")));
    expect(page.openAdd).toHaveBeenCalledOnce();

    await click(required(required(row).querySelector("button")));
    expect(page.focusCheck).toHaveBeenCalledWith("check-1");
  });

  it("shows commenters the list and the count, but nothing that changes a check", () => {
    render({
      actions: actions({ canEdit: false }),
      state: state({ checks: [check({ answers: [answer("not_fine")] })] }),
    });

    expect(document.querySelector("[data-page-checks]")?.textContent).toContain(
      "183 words, 63 over",
    );
    expect(buttonNamed("Check now")).toBeUndefined();
    expect(buttonNamed("Add")).toBeUndefined();
    expect(queryByLabel("Check actions")).toBeNull();
    expect(queryByLabel("1 to look at")).not.toBeNull();
  });

  it("shows nothing at all where checks are off, as for viewers", () => {
    render({
      actions: actions({ enabled: false, canEdit: false }),
      state: state({ checks: [check({ answers: [answer("not_fine")] })] }),
    });

    expect(document.querySelector("[data-page-checks]")).toBeNull();
    expect(document.querySelector("[data-page-checks-pill]")).toBeNull();
  });

  it("counts only what needs looking at in the header, and opens the list from it", async () => {
    const page = actions();
    render({
      actions: page,
      state: state({
        checks: [
          check({ answers: [answer("not_fine")] }),
          check({ id: "check-2", answers: [answer("couldnt")] }),
          check({ id: "check-3", answers: [answer("fine")] }),
          check({ id: "check-4", paused: true, answers: [answer("not_fine")] }),
        ],
      }),
    });

    const pill = byLabel("2 to look at");
    await click(pill);
    expect(page.openList).toHaveBeenCalledOnce();
    expect(
      document.querySelector("[data-page-check-row='check-4']")?.textContent,
    ).toContain("Paused");
  });

  it("hides the header count when every check passes", () => {
    render({
      actions: actions(),
      state: state({ checks: [check({ answers: [answer("fine")] })] }),
    });

    expect(document.querySelector("[data-page-checks-pill]")).toBeNull();
    expect(
      document.querySelector("[data-page-check-row='check-1']")?.textContent,
    ).toContain("The intro · Fine");
  });

  it("says how many places were skipped, and Undo brings them back", async () => {
    const page = actions();
    render({
      actions: page,
      state: state({ checks: [check({ answers: [answer("skipped")] })] }),
    });

    expect(
      document.querySelector("[data-page-check-row='check-1']")?.textContent,
    ).toContain("1 skipped");
    await click(required(buttonNamed("Undo")));
    expect(page.skip).toHaveBeenCalledWith({
      checkId: "check-1",
      placeKey: "intro",
      textHash: "text-1",
      undo: true,
    });
  });

  it("explains a check before there are any", () => {
    render({ actions: actions(), state: state() });

    expect(document.querySelector("[data-page-checks]")?.textContent).toContain(
      "A check is a sentence",
    );
    expect(buttonNamed("Check now")).toBeUndefined();
  });

  it("stops adding at 20 checks", () => {
    render({
      actions: actions(),
      state: state({
        checks: Array.from({ length: 20 }, (_, index) =>
          check({ id: `check-${index}` }),
        ),
      }),
    });

    expect(buttonNamed("Add")?.disabled).toBe(true);
  });

  it("shows what a new check finds before it's saved, then saves it", async () => {
    const page = actions();
    const intro: PageCheckScope = { kind: "intro" };
    render({
      actions: page,
      state: state({ dialog: { mode: "add", scope: intro } }),
    });

    const dialog = required(
      document.querySelector<HTMLElement>("[data-page-check-dialog]"),
    );
    const submit = () =>
      required(
        Array.from(dialog.querySelectorAll("button")).find(
          (button) => button.textContent === "Add check",
        ),
      );
    expect(submit().disabled).toBe(true);

    setText(required(dialog.querySelector("textarea")), "Under 120 words");
    expect(
      dialog.querySelector("[data-page-check-try]")?.textContent,
    ).toContain("Under 120 words: 183 words, 63 over");
    expect(submit().disabled).toBe(false);

    await click(submit());
    expect(page.save).toHaveBeenCalledWith({
      checkId: undefined,
      sentence: "Under 120 words",
      scope: intro,
      sure: "balanced",
    });
    expect(page.closeDialog).toHaveBeenCalled();
  });

  it("won't save a sentence it can't read", () => {
    render({
      actions: actions(),
      state: state({ dialog: { mode: "add", scope: { kind: "intro" } } }),
    });

    const dialog = required(
      document.querySelector<HTMLElement>("[data-page-check-dialog]"),
    );
    setText(
      required(dialog.querySelector("textarea")),
      "Under 120 words. Opens with a question. Ends with a link. Names a person.",
    );
    expect(dialog.textContent).toContain(
      "A check can have at most three parts.",
    );
    expect(addButton(dialog).disabled).toBe(true);
  });

  it("asks a yes/no part, names its model, and switches How sure without asking again", async () => {
    const tryCheck = vi.fn(async (): Promise<PageCheckTry> => developerTry);
    const page = actions({ tryCheck });
    const each: PageCheckScope = { kind: "each_paragraph" };
    render({
      actions: page,
      state: state({ dialog: { mode: "add", scope: each } }),
    });
    const dialog = required(
      document.querySelector<HTMLElement>("[data-page-check-dialog]"),
    );
    const tryLines = () =>
      dialog.querySelector("[data-page-check-try]")?.textContent;

    setText(required(dialog.querySelector("textarea")), "Mentions a developer");
    expect(tryLines()).toContain("Mentions a developer: Checking…");
    expect(addButton(dialog).disabled).toBe(true);
    await afterTypingPause();

    expect(tryCheck).toHaveBeenCalledOnce();
    expect(tryCheck).toHaveBeenCalledWith({
      sentence: "Mentions a developer",
      scope: each,
      questions: [],
      sure: "balanced",
    });
    expect(tryLines()).toContain("Mentions a developer: 1 of 2");
    expect(tryLines()).toContain(
      "Asks: “Does text mention a developer?” Passes on yes.",
    );
    expect(
      Array.from(
        dialog.querySelectorAll("[data-page-check-sure-count]"),
        (count) => count.textContent,
      ),
    ).toEqual(["0", "1", "1"]);
    expect(dialog.querySelector("[data-page-check-model]")?.textContent).toBe(
      "Jev, from TypeSafe AI, reads the text this check looks at to answer its yes/no parts. No other model is asked.",
    );

    await click(
      required(
        dialog.querySelector(
          "[data-page-check-sure] [role='radio'][value='sure']",
        ),
      ),
    );
    expect(tryLines()).toContain("Mentions a developer: Fine");
    expect(tryCheck).toHaveBeenCalledOnce();

    await click(required(buttonNamed("Edit question")));
    const question = required(
      dialog.querySelector<HTMLTextAreaElement>(
        "[data-page-check-question-edit] textarea",
      ),
    );
    setText(question, "Does text name a developer?");
    act(() => {
      question.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await afterTypingPause();
    const edited = {
      sentence: "Mentions a developer",
      scope: each,
      questions: [
        {
          text: "Mentions a developer",
          question: "Does text name a developer?",
          passes: "yes",
        },
      ],
      sure: "sure",
    };
    expect(tryCheck).toHaveBeenCalledTimes(2);
    expect(tryCheck).toHaveBeenLastCalledWith(edited);

    await click(addButton(dialog));
    expect(page.save).toHaveBeenCalledWith({ checkId: undefined, ...edited });
  });

  it("offers two sharper checks for a vague part, and says when no model can answer", async () => {
    const tryCheck = vi.fn(
      async (input: { sentence: string }): Promise<PageCheckTry> => ({
        reading: readPageCheckSentence(input.sentence),
        parts: null,
        answers: null,
        problem:
          input.sentence === "Make it good"
            ? {
                kind: "vague",
                text: "Make it good",
                examples: ["Opens with a story", "Ends with a question"],
              }
            : { kind: "no_model" },
        decider: null,
      }),
    );
    render({
      actions: actions({ tryCheck }),
      state: state({ dialog: { mode: "add", scope: { kind: "intro" } } }),
    });
    const dialog = required(
      document.querySelector<HTMLElement>("[data-page-check-dialog]"),
    );
    const sentence = required(
      dialog.querySelector<HTMLTextAreaElement>("textarea"),
    );

    setText(sentence, "Make it good");
    await afterTypingPause();
    expect(dialog.textContent).toContain("Make it good: Too vague to check");
    expect(dialog.textContent).toContain(
      "“Make it good” is too vague to answer the same way twice.",
    );
    expect(addButton(dialog).disabled).toBe(true);

    await click(required(buttonNamed("Opens with a story")));
    expect(sentence.value).toBe("Opens with a story");
    await afterTypingPause();
    expect(dialog.textContent).toContain(
      "Opens with a story: Couldn't check: no decision model",
    );
    expect(dialog.textContent).toContain(
      "No decision model is ready to answer yes/no parts.",
    );
    expect(dialog.querySelector("[data-page-check-model]")).toBeNull();
    expect(addButton(dialog).disabled).toBe(true);
  });
});

function addButton(dialog: HTMLElement) {
  return required(
    Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Add check",
    ),
  );
}

async function afterTypingPause() {
  await act(async () => {
    // fixed-sleep-ok: the subject is the dialog's own wait after typing before it asks the model.
    await new Promise((resolve) => setTimeout(resolve, 750));
  });
}

function questionAnswer(key: string, passing: number): PageCheckPlaceAnswer {
  const finding = passing < 0.5 ? "not_fine" : "fine";
  return {
    key,
    place: {
      key,
      path: key,
      blockId: null,
      textHash: `text-${key}`,
      excerpt: `Paragraph ${key}`,
    },
    answer: finding,
    result: {
      placeKey: key,
      wordingHash: "wording-1",
      textHash: `text-${key}`,
      finding,
      parts: [{ finding, passing }],
      checkedBy: "editor@example.com",
      checkedAt: "2026-11-25T00:00:00.000Z",
    },
  };
}

const developerTry: PageCheckTry = {
  reading: readPageCheckSentence("Mentions a developer"),
  parts: [
    {
      kind: "question",
      text: "Mentions a developer",
      question: "Does text mention a developer?",
      passes: "yes",
      decider: "jev",
    },
  ],
  answers: [questionAnswer("0", 0.95), questionAnswer("2", 0.3)],
  problem: null,
  decider: { provider: "jev", model: "Jev", company: "TypeSafe AI" },
};
