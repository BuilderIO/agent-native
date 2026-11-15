// oracle-change: the unchanged framework/skill contract moved to its own guidance spec; action behavior remains here.
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAppState = vi.fn(async () => undefined);
vi.mock("../../application-state/script-helpers.js", () => ({
  writeAppState,
}));

const { createDataWidgetActionEntries, createUrlTools } =
  await import("./context-tools.js");

const askQuestion = createUrlTools()["ask-question"];
if (!askQuestion) throw new Error("ask-question is not registered");
const options = (labels: string[]) =>
  JSON.stringify(labels.map((label) => ({ label })));

describe("data widget action validation", () => {
  it("passes original widget input and action context to an optional validator", async () => {
    const input = {
      widget: "data-table",
      table: {
        columns: [{ key: "category", label: "Category" }],
        rows: [["verified"]],
      },
    };
    const context = { request: "test-context" };
    const validate = vi.fn(async () => {});
    const action =
      createDataWidgetActionEntries(validate)["render-data-widget"]!;

    await expect(action.run(input, context as never)).resolves.toMatchObject({
      table: { rows: [{ category: "verified" }] },
    });
    expect(validate).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledWith(input, context);
  });

  it("preserves public record-row input while validating and rendering it", async () => {
    const input = {
      widget: "data-table",
      table: {
        columns: [{ key: "category", label: "Category" }],
        rows: [{ category: "existing-format" }],
      },
    };
    const validateDataWidget = vi.fn(async () => {});
    const action =
      createDataWidgetActionEntries(validateDataWidget)["render-data-widget"]!;

    const result = await action.run(input);

    expect(result).toMatchObject({
      table: { rows: [{ category: "existing-format" }] },
    });
    expect(validateDataWidget).toHaveBeenCalledWith(input, undefined);
  });

  it("rejects when the app validator refuses otherwise valid widget data", async () => {
    const input = {
      widget: "data-table",
      table: {
        columns: [{ key: "category", label: "Category" }],
        rows: [["unverified"]],
      },
    };
    const rejection = new Error("Widget data is not verified.");
    const validate = vi.fn(() => {
      throw rejection;
    });
    const action =
      createDataWidgetActionEntries(validate)["render-data-widget"]!;

    await expect(action.run(input)).rejects.toBe(rejection);
    expect(validate).toHaveBeenCalledOnce();
  });

  it("normalizes compact chart points before returning renderer data", async () => {
    const input = {
      widget: "data-chart",
      chartSeries: {
        type: "line",
        xKey: "month",
        series: [{ key: "wins", label: "Wins" }],
        points: [
          { xValue: "2026-01", values: [10] },
          { xValue: "2026-02", values: [12] },
        ],
      },
    };
    const validateDataWidget = vi.fn(async () => {});
    const action =
      createDataWidgetActionEntries(validateDataWidget)["render-data-widget"]!;

    await expect(action.run(input)).resolves.toMatchObject({
      chartSeries: {
        data: [
          { month: "2026-01", wins: 10 },
          { month: "2026-02", wins: 12 },
        ],
      },
    });
    expect(validateDataWidget).toHaveBeenCalledWith(input, undefined);
  });
});

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

  it("accepts exactly four questions, as an array or text", async () => {
    const four = Array.from({ length: 4 }, (_, index) => ({
      question: `Question ${index + 1}?`,
      options: [{ label: "Yes" }, { label: "No" }],
    }));
    await askQuestion.run({ questions: four });
    await askQuestion.run({ questions: JSON.stringify(four) });
    for (const [, payload] of writeAppState.mock.calls as unknown as Array<
      [string, { questions: unknown[] }]
    >) {
      expect(payload.questions).toHaveLength(4);
    }
  });

  it("rejects a question list that is not a non-empty array", async () => {
    for (const questions of ['{"question":"Q?"}', "[]", []]) {
      await expect(askQuestion.run({ questions })).rejects.toThrow(
        "1 to 4 questions",
      );
    }
    await expect(askQuestion.run(null)).rejects.toThrow(
      "'question' is required.",
    );
    expect(writeAppState).not.toHaveBeenCalled();
  });
});
