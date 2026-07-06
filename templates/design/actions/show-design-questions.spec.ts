import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppState: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: (args: {
    app: string;
    view: string;
    params?: Record<string, string>;
    to?: string;
  }) =>
    `/_agent-native/open?app=${args.app}&view=${args.view}&designId=${args.params?.designId ?? ""}`,
}));

import action from "./show-design-questions.js";

describe("show-design-questions", () => {
  it("writes a question payload to the main design question state", async () => {
    const result = await action.run({
      designId: "design_123",
      title: "Quick questions about your todo app",
      questions: [
        {
          id: "form_factor",
          type: "text-options",
          question: "What form factor?",
          options: [
            { label: "Desktop web app", value: "desktop" },
            { label: "Mobile app", value: "mobile" },
          ],
        },
        {
          id: "features",
          type: "text-options",
          question: "Which features matter?",
          multiSelect: true,
          options: [
            { label: "Due dates", value: "due_dates" },
            { label: "Tags", value: "tags" },
          ],
        },
      ],
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
    expect(mocks.writeAppState).toHaveBeenNthCalledWith(
      1,
      "show-questions:design_123",
      {
        designId: "design_123",
        title: "Quick questions about your todo app",
        description:
          "Pick what matters. Use Other for specifics, or let the agent decide.",
        skipLabel: "Decide for me",
        submitLabel: "Continue",
        questions: [
          expect.objectContaining({
            id: "form_factor",
            includeExplore: false,
            includeDecide: false,
          }),
          expect.objectContaining({
            id: "features",
            includeExplore: false,
            includeDecide: false,
          }),
        ],
      },
    );
    expect(mocks.writeAppState).toHaveBeenNthCalledWith(2, "navigate", {
      view: "editor",
      designId: "design_123",
      editorView: "overview",
      path: "/design/design_123?view=overview",
    });
    expect(result).toMatchObject({
      designId: "design_123",
      count: 2,
      path: "/design/design_123",
      embed: true,
      nextRequiredAction:
        "Wait for the user's answers before generating design files or variants.",
    });
  });

  it("limits question payloads to focused design-intake forms", () => {
    const question = (n: number) => ({
      id: `q${n}`,
      type: "freeform" as const,
      question: `Question ${n}?`,
    });

    expect(
      action.schema.safeParse({
        designId: "design_123",
        questions: [question(1)],
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        designId: "design_123",
        questions: Array.from({ length: 8 }, (_, i) => question(i + 1)),
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        designId: "design_123",
        questions: [],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        designId: "design_123",
        questions: Array.from({ length: 9 }, (_, i) => question(i + 1)),
      }).success,
    ).toBe(false);
  });

  it("returns an editor deep link for external hosts", () => {
    const link = action.link?.({
      args: {},
      result: { designId: "design_123" },
    });

    expect(link).toEqual({
      url: "/_agent-native/open?app=design&view=editor&designId=design_123",
      label: "Open design questions",
      view: "editor",
    });
  });
});
