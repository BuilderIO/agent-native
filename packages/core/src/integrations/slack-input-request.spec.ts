import { describe, expect, it } from "vitest";

import { slackInputRequestText } from "./slack-input-request.js";

const options = (...labels: string[]) =>
  JSON.stringify(labels.map((label) => ({ label })));

describe("slackInputRequestText", () => {
  it("formats one question with its header, options and descriptions", () => {
    expect(
      slackInputRequestText({
        header: "  Audience  ",
        question: "  Who is the launch page for?  ",
        options: JSON.stringify([
          { label: " Existing customers ", description: " Adoption " },
          { value: "Prospects" },
        ]),
      }),
    ).toBe(
      [
        "*Audience*",
        "Who is the launch page for?",
        "",
        "1. Existing customers — Adoption",
        "2. Prospects",
        "",
        "Reply in this thread with your choice or a short answer.",
      ].join("\n"),
    );
  });

  it("asks only for a choice when free text is off", () => {
    expect(
      slackInputRequestText({
        question: "Ship it?",
        options: options("Yes", "No"),
        allowFreeText: "false",
      }),
    ).toBe(
      "Ship it?\n\n1. Yes\n2. No\n\nReply in this thread with your choice.",
    );
    expect(
      slackInputRequestText({
        question: "Ship it?",
        options: options("Yes"),
        allowFreeText: false,
      }),
    ).toBe("Ship it?\n\n1. Yes\n\nReply in this thread with your choice.");
  });

  it("lists every question of a multi-question ask, from a string or an array", () => {
    const questions = [
      { header: "Audience", question: "Who?", options: [{ label: "Team" }] },
      {
        question: "When?",
        options: options("Today"),
        allowFreeText: "false",
      },
    ];
    const expected = [
      "*Audience*",
      "Who?",
      "",
      "1. Team",
      "",
      "When?",
      "",
      "1. Today",
      "",
      "Reply in this thread with your choices or a short answer.",
    ].join("\n");
    expect(
      slackInputRequestText({ questions: JSON.stringify(questions) }),
    ).toBe(expected);
    expect(slackInputRequestText({ questions })).toBe(expected);
  });

  it("offers a short answer only when some question allows one", () => {
    expect(
      slackInputRequestText({
        questions: [
          { question: "A?", options: options("1"), allowFreeText: "false" },
          { question: "B?", options: options("2"), allowFreeText: "false" },
        ],
      }),
    ).toMatch(/with your choices\.$/);
  });

  it("asks for choices when one question allows several", () => {
    expect(
      slackInputRequestText({
        question: "Which courses?",
        options: options("Starter", "Main"),
        allowMultiple: "true",
        allowFreeText: "false",
      }),
    ).toMatch(/with your choices\.$/);
    expect(
      slackInputRequestText({
        question: "Which course?",
        options: options("Starter"),
        allowMultiple: true,
      }),
    ).toMatch(/with your choices or a short answer\.$/);
  });

  it("caps questions and options at four", () => {
    const text = slackInputRequestText({
      questions: Array.from({ length: 6 }, (_, index) => ({
        question: `Question ${index + 1}?`,
        options: options("A", "B", "C", "D", "E"),
      })),
    });
    expect(text).toContain("Question 4?");
    expect(text).not.toContain("Question 5?");
    expect(text).toContain("4. D");
    expect(text).not.toContain("5. E");
  });

  it("truncates long text to what Slack shows", () => {
    const text = slackInputRequestText({
      header: "h".repeat(100),
      question: "q".repeat(2_000),
      options: JSON.stringify([
        { label: "l".repeat(300), description: "d".repeat(500) },
      ]),
    });
    const [header, question, , option] = String(text).split("\n");
    expect(header).toBe(`*${"h".repeat(80)}*`);
    expect(question).toBe("q".repeat(1_500));
    expect(option).toBe(`1. ${"l".repeat(200)} — ${"d".repeat(400)}`);
  });

  it("skips options with no readable label", () => {
    expect(
      slackInputRequestText({
        question: "Pick one?",
        options: JSON.stringify([
          null,
          { label: "   " },
          { value: 3 },
          { label: "Real" },
        ]),
      }),
    ).toBe(
      "Pick one?\n\n1. Real\n\nReply in this thread with your choice or a short answer.",
    );
  });

  it("gives no message for an ask Slack cannot show", () => {
    expect(slackInputRequestText(undefined)).toBeNull();
    expect(slackInputRequestText({ options: options("A") })).toBeNull();
    expect(
      slackInputRequestText({ question: "   ", options: options("A") }),
    ).toBeNull();
    expect(slackInputRequestText({ question: "Q?" })).toBeNull();
    expect(slackInputRequestText({ question: "Q?", options: "[]" })).toBeNull();
    expect(
      slackInputRequestText({ question: "Q?", options: "{not json" }),
    ).toBeNull();
    expect(
      slackInputRequestText({ question: "Q?", options: options("   ") }),
    ).toBeNull();
    expect(slackInputRequestText({ questions: "{not json" })).toBeNull();
    expect(slackInputRequestText({ questions: '{"a":1}' })).toBeNull();
    expect(slackInputRequestText({ questions: [] })).toBeNull();
    // One unreadable question would leave the others unanswerable.
    expect(
      slackInputRequestText({
        questions: [
          { question: "Fine?", options: options("Yes") },
          { question: "Broken?" },
        ],
      }),
    ).toBeNull();
  });

  it("reads one question when `questions` is empty text", () => {
    expect(
      slackInputRequestText({
        questions: "",
        question: "Only?",
        options: options("Yes"),
      }),
    ).toBe(
      "Only?\n\n1. Yes\n\nReply in this thread with your choice or a short answer.",
    );
  });

  it("reads one question when `questions` is null", () => {
    expect(
      slackInputRequestText({
        questions: null,
        question: "Only?",
        options: options("Yes"),
      }),
    ).toBe(
      "Only?\n\n1. Yes\n\nReply in this thread with your choice or a short answer.",
    );
  });
});
