import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAppState = vi.fn(async () => undefined);
vi.mock("../../application-state/script-helpers.js", () => ({
  writeAppState,
}));

const { createUrlTools } = await import("./context-tools.js");

const askQuestion = createUrlTools()["ask-question"];
if (!askQuestion) throw new Error("ask-question is not registered");
const options = (labels: string[]) =>
  JSON.stringify(labels.map((label) => ({ label })));

describe("ask-question", () => {
  beforeEach(() => writeAppState.mockClear());

  it("asks several questions in one call, in order", async () => {
    await askQuestion.run({
      questions: JSON.stringify([
        { question: "Which cuisine?", options: options(["Italian", "Thai"]) },
        {
          question: "How many guests?",
          header: "Guests",
          options: [{ label: "2-4" }, { label: "5-8", recommended: true }],
          allowFreeText: false,
        },
        {
          question: "Which courses?",
          options: options(["Starter", "Main", "Dessert"]),
          allowMultiple: true,
        },
      ]),
    });

    expect(writeAppState).toHaveBeenCalledTimes(1);
    const [, payload] = writeAppState.mock.calls[0] as unknown as [
      string,
      { questions: Array<Record<string, unknown>> },
    ];
    expect(payload.questions.map((question) => question.id)).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
    expect(payload.questions[1]).toMatchObject({
      question: "How many guests?",
      header: "Guests",
      required: true,
      allowOther: false,
      options: [
        { label: "2-4", value: "2-4" },
        { label: "5-8", value: "5-8", recommended: true },
      ],
    });
    expect(payload.questions[2]).toMatchObject({ multiSelect: true });
  });

  it("still asks one question from question and options", async () => {
    await askQuestion.run({
      question: "Which cuisine?",
      options: options(["Italian", "Thai"]),
    });

    const [, payload] = writeAppState.mock.calls[0] as unknown as [
      string,
      { questions: Array<Record<string, unknown>> },
    ];
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0]).toMatchObject({
      id: "q1",
      question: "Which cuisine?",
    });
  });

  it("rejects more than four questions and an unreadable list", async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      question: `Question ${index + 1}?`,
      options: options(["Yes", "No"]),
    }));
    await expect(
      askQuestion.run({ questions: JSON.stringify(five) }),
    ).rejects.toThrow("1 to 4 questions");
    await expect(askQuestion.run({ questions: "[not json" })).rejects.toThrow(
      "'questions' must be a JSON array",
    );
    expect(writeAppState).not.toHaveBeenCalled();
  });
});
