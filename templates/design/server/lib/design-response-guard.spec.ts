import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DESIGN_MUTATION_REQUIRED_DIRECTIVE } from "../../shared/mutation-turn.js";
import {
  designFinalResponseGuard,
  looksLikeDesignMutationRequest,
} from "./design-response-guard.js";

const settings = vi.hoisted(() => ({
  email: null as string | null,
  value: undefined as unknown,
  read: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => settings.email,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: settings.read,
}));

beforeEach(() => {
  settings.email = null;
  settings.read.mockReset();
  settings.read.mockImplementation(async () => settings.value);
  settings.value = undefined;
});

function guardContext(
  requestText: string,
  overrides: Partial<AgentLoopFinalResponseGuardContext> = {},
): AgentLoopFinalResponseGuardContext {
  return {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: requestText }],
      },
    ],
    requestText,
    assistantContent: [],
    text: "Done.",
    toolCalls: [],
    toolResults: [],
    retryCount: 0,
    executionMode: "act",
    ...overrides,
  };
}

function toolResult(
  name: string,
  value: Record<string, unknown>,
  isError = false,
): AgentLoopFinalResponseGuardContext["toolResults"][number] {
  return { name, content: JSON.stringify(value), isError };
}

function thrownToolResult(
  name: string,
  message: string,
  errorCode?: string,
): AgentLoopFinalResponseGuardContext["toolResults"][number] {
  return {
    name,
    content: `Error running ${name}: ${message}${errorCode ? ` (errorCode: ${errorCode})` : ""}`,
    isError: true,
  };
}

const MUTATION_REQUEST = "make the hero darker";

describe("Design final response guard", () => {
  it("recognizes design mutations while excluding how-to and preview requests", () => {
    expect(
      looksLikeDesignMutationRequest("can you create another version of this"),
    ).toBe(true);
    expect(looksLikeDesignMutationRequest("create a LinkedIn visual")).toBe(
      true,
    );
    expect(
      looksLikeDesignMutationRequest("create a hero visual regression test"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("add a button visual regression test"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("create a card visual snapshot"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "give me tips to create a LinkedIn visual",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("create a visual regression test"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("create a visual snapshot test"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("create a visual-regression test"),
    ).toBe(false);
    expect(looksLikeDesignMutationRequest("add a visual test")).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "add a visual regression test for the hero layout",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "add a visual regression test for the hero and footer",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test for the hero, footer and nav",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("create visual snapshots for this design"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("create a visual snapshot of the hero"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a dark-mode visual regression test",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test, then update the color palette",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test for the hero layout and after that update the color palette",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test, then run it",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test, for the hero layout",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test — for the hero layout",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "update the color palette, then run a visual regression test",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "fix the hero layout after creating visual snapshots",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "fix the hero layout for visual regression tests",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test and a card",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test and a visual snapshot test",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a hero visual regression test and a card visual snapshot",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a hero and footer visual regression test",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test and buttons",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest("add visual snapshots and cards"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test for the hero layout and a card",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test and a new card",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test and some cards",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test and a primary button",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test for the hero after we update the color palette",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test, add buttons",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test; create cards",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test for the hero or update the color palette",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test for the hero or a card",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "update the color palette — create a visual regression test",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test before improving the hero layout",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test after improving the hero layout",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test for the hero — then update the color palette",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create visual regression and snapshot tests",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "add visual regression and snapshot tests for the hero",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create visual snapshot and regression tests",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create visual regression or snapshot tests",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "create visual regression and snapshot tests for the hero, then update the color palette",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "update the color palette followed by run a visual regression test",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "create a visual regression test, — for the hero layout",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "give me a tutorial to create a LinkedIn visual",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("teach me to create a LinkedIn visual"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "teach me to improve this visual, then fix the hero layout",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "fix the visual regression in the hero layout",
      ),
    ).toBe(true);
    expect(looksLikeDesignMutationRequest("how do I create a design?")).toBe(
      false,
    );
    expect(
      looksLikeDesignMutationRequest(
        "[Reprompt selection] make the card darker",
      ),
    ).toBe(false);
    expect(looksLikeDesignMutationRequest("delete this screen")).toBe(true);
    expect(looksLikeDesignMutationRequest("remove this button")).toBe(true);
    expect(looksLikeDesignMutationRequest("move this card")).toBe(true);
    expect(looksLikeDesignMutationRequest("replace the hero image")).toBe(true);
    expect(looksLikeDesignMutationRequest("make it darker")).toBe(true);
    expect(looksLikeDesignMutationRequest("fix the broken button")).toBe(true);
    expect(looksLikeDesignMutationRequest("improve the spacing")).toBe(true);
    expect(looksLikeDesignMutationRequest("polish this screen")).toBe(true);
    expect(
      looksLikeDesignMutationRequest("change the background to blue"),
    ).toBe(true);
    expect(looksLikeDesignMutationRequest("increase the padding")).toBe(true);
    expect(looksLikeDesignMutationRequest("update the color palette")).toBe(
      true,
    );
    expect(looksLikeDesignMutationRequest("add an animation to the hero")).toBe(
      true,
    );
    expect(looksLikeDesignMutationRequest("change the interaction state")).toBe(
      true,
    );
    expect(
      looksLikeDesignMutationRequest("I want to improve my design skills"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("improve my product design skills"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("improve my interaction design skills"),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "improve my web and mobile UI design skills",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "improve my design skills and improve my interaction design skills",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        `improve my ${"web ".repeat(2_000)}design skills`,
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        `improve my ${"web ".repeat(2_000)}portfolio`,
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "improve my design skills and update the color palette",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "can you review this card and recommend changes?",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("review this card and fix the button"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "please give me advice to improve this design",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "please provide suggestions for this design",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("improve your design skills card layout"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest("improve your Design Skills section"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest("improve my Design Skills hero section"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "I want to improve my design skills in card layout and improve my portfolio",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "please give feedback to improve this design",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest(
        "please share your thoughts on this design",
      ),
    ).toBe(false);
    expect(
      looksLikeDesignMutationRequest("review this card. fix the button"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest("review this card; fix the button"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "review this card, then polish the button",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "review this card and then fix the button",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest("review this card. Please fix the button"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "review this card, could you fix the button?",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "review this card and recommend changes, then improve the design",
      ),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest(
        "review this card; suggest changes; fix the button",
      ),
    ).toBe(true);
  });

  it.each([
    "Please finish checking the existing welcome-email.html for HubSpot, including missing, normal and long first names and the button's fallback and populated destination. Check desktop and phone previews, including a narrow phone, then give me a concise, accurate handoff. Keep the real personalization tokens and Brand reference unchanged, and keep working on this email rather than creating another one.",
    "Review this card; do not create another design.",
    "Check the screen without changing its layout.",
    "Inspect this email instead of editing the design.",
    "Review the layout and fix it only if needed.",
    "If the preview reveals an issue, fix the layout.",
    "Check the screen and adjust its layout as needed.",
    "Make sure this email aligns with HubSpot email requirements.",
  ])(
    "allows verification without an unconditional mutation: %s",
    async (request) => {
      expect(await designFinalResponseGuard(guardContext(request))).toBeNull();
    },
  );

  it.each([
    "Do not create another frame; edit the existing screen.",
    "Never remove the footer, but update the button.",
    "Check this screen, then fix the footer.",
    "If needed, fix the footer; create a new design.",
    "Make sure to add the required tokens to this design.",
  ])(
    "still requires independent affirmative mutations: %s",
    async (request) => {
      const result = await designFinalResponseGuard(guardContext(request));
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("expandToolSurface");
    },
  );

  it("retries prose-only completion for a design mutation", async () => {
    const result = await designFinalResponseGuard(
      guardContext("can you create another version of this"),
    );

    expect(result).toMatchObject({
      maxRetries: 1,
      retryMessage: expect.stringContaining("generate-design"),
    });
    expect(result).not.toHaveProperty("expandToolSurface");
  });

  it("accepts a Design output action whose verified receipt shows a change", async () => {
    const placed = {
      tool: "place-figma-frames",
      verified: true as const,
      summary: "Design output: 24 files saved.",
      subject: "design-1",
    };
    const request = "Make this Figma design. Skip questions.";

    expect(
      await designFinalResponseGuard(
        guardContext(request, {
          toolResults: [toolResult("place-figma-frames", { placedFrames: 24 })],
          receipts: [{ ...placed, changed: true }],
        }),
      ),
    ).toBeNull();
    expect(
      await designFinalResponseGuard(
        guardContext(request, { receipts: [{ ...placed, changed: false }] }),
      ),
    ).not.toBeNull();
    // A verified write by something other than a Design output action is not
    // proof that the design was made.
    expect(
      await designFinalResponseGuard(
        guardContext(request, {
          receipts: [{ ...placed, tool: "save-memory", changed: true }],
        }),
      ),
    ).not.toBeNull();
  });

  it("does not accept the empty project shell as a completed design", async () => {
    const result = await designFinalResponseGuard(
      guardContext("create a new design", {
        toolResults: [
          toolResult("create-design", {
            id: "design-1",
            renderable: false,
          }),
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("accepts persisted generation, edit, and asset placement proof", async () => {
    for (const toolResults of [
      [
        toolResult("generate-design", {
          designId: "design-1",
          renderable: true,
          savedFiles: [{ id: "file-1", filename: "index.html" }],
        }),
      ],
      [toolResult("edit-design", { fileId: "file-1", changed: true })],
      [toolResult("insert-asset", { fileId: "file-1", inserted: true })],
      [
        toolResult("apply-component-prop-edit", {
          designId: "design-1",
          persisted: true,
        }),
      ],
      [
        toolResult("apply-source-edit", {
          designId: "design-1",
          changed: true,
        }),
      ],
      [
        toolResult("apply-visual-edit", {
          designId: "design-1",
          persisted: true,
        }),
      ],
      [
        toolResult("apply-tweaks", {
          designId: "design-1",
          applied: true,
          appliedTweaks: { "theme-accent": "#0EA5E9" },
        }),
      ],
      [toolResult("update-file", { id: "file-1", updated: true })],
      [
        toolResult("update-design", {
          id: "design-1",
          updated: true,
          changed: true,
        }),
      ],
      [
        toolResult("import-figma-clipboard", {
          designId: "design-1",
          strategy: "htmlFallback",
          files: [{ id: "file-1", filename: "screen.html" }],
        }),
      ],
      [
        toolResult("import-figma-frame", {
          designId: "design-1",
          files: [{ id: "file-1", filename: "screen.html" }],
        }),
      ],
      [
        toolResult("create-component", {
          designId: "design-1",
          persisted: true,
        }),
      ],
    ]) {
      expect(
        await designFinalResponseGuard(
          guardContext("create another version of this", { toolResults }),
        ),
      ).toBeNull();
    }
  });

  it("counts a Builder delegation only once Builder finished it", async () => {
    const delegated = async (value: Record<string, unknown>) =>
      designFinalResponseGuard(
        guardContext("make the header sticky", {
          toolResults: [toolResult("send-builder-message", value)],
        }),
      );

    expect(await delegated({ sent: true, completed: true })).toBeNull();
    expect(
      await delegated({
        sent: true,
        completed: false,
        unconfirmed: true,
        error: "Timed out waiting for the app agent to finish",
      }),
    ).not.toBeNull();
    expect(await delegated({ sent: true, completed: false })).not.toBeNull();
  });

  it("does not accept a partial generation", async () => {
    const result = await designFinalResponseGuard(
      guardContext("create another version of this", {
        toolResults: [
          toolResult("generate-design", {
            designId: "design-1",
            renderable: true,
            savedFiles: [{ id: "file-1", filename: "index.html" }],
            fileErrors: [{ filename: "styles.css", error: "conflict" }],
          }),
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("does not accept empty tweaks or a stale mirrored file update", async () => {
    for (const toolResults of [
      [
        toolResult("apply-tweaks", {
          designId: "design-1",
          applied: false,
          appliedTweaks: {},
        }),
      ],
      [
        toolResult("update-file", {
          id: "file-1",
          updated: true,
          skippedStaleMirror: true,
        }),
      ],
      [
        toolResult("update-design", {
          id: "design-1",
          updated: true,
          stale: true,
        }),
      ],
      [toolResult("update-design", { id: "design-1", updated: true })],
    ]) {
      expect(
        await designFinalResponseGuard(
          guardContext("make it darker", { toolResults }),
        ),
      ).not.toBeNull();
    }
  });

  it("does not accept a failed mutation result", async () => {
    const result = await designFinalResponseGuard(
      guardContext("create another version of this", {
        toolResults: [
          toolResult("generate-design", { renderable: true }, true),
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("accepts a moved element only when the move was persisted", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext("move the card to the second screen", {
          toolResults: [
            toolResult("move-design-element", {
              designId: "design-1",
              moved: true,
              movedNodeId: "node-1",
            }),
          ],
        }),
      ),
    ).toBeNull();

    for (const toolResults of [
      [
        toolResult("move-design-element", {
          designId: "design-1",
          moved: false,
        }),
      ],
      [
        toolResult(
          "move-design-element",
          { designId: "design-1", moved: true },
          true,
        ),
      ],
    ]) {
      expect(
        await designFinalResponseGuard(
          guardContext("move the card to the second screen", { toolResults }),
        ),
      ).not.toBeNull();
    }
  });

  it("judges the user's words, not the context the app attached to them", async () => {
    const intakeContext = [
      "The user just created a new empty design.",
      'Design id: "design-1"',
      'User request: "hi"',
      'This is a new UI-started design for design id "design-1". The design shell already exists - DO NOT call create-design.',
      "First, call `show-design-questions` with 4-6 tailored questions and then stop. Do NOT call generate-design or present-design-variants until the user submits or skips the questions.",
    ].join("\n");

    expect(
      await designFinalResponseGuard(
        guardContext(`hi\n\n<context>\n${intakeContext}\n</context>`),
      ),
    ).toBeNull();
    expect(
      await designFinalResponseGuard(
        guardContext(
          `make it darker\n\n<context>\nDesign "Portfolio" is open.\n</context>`,
        ),
      ),
    ).not.toBeNull();
  });

  it("leaves a preview or question turn alone when only its context says so", async () => {
    const repromptContext = [
      "[Reprompt selection]",
      "repromptId: reprompt-1",
      "designId: design-1",
      "baseVersionHash: hash-1",
    ].join("\n");
    const questionContext = [
      "[Selection question]",
      "designId: design-1",
      "fileId: file-1",
    ].join("\n");

    expect(
      await designFinalResponseGuard(
        guardContext(
          `make the card darker\n\n<context>\n${repromptContext}\n</context>`,
        ),
      ),
    ).toBeNull();
    expect(
      await designFinalResponseGuard(
        guardContext(
          `make the card darker\n\n<context>\n${questionContext}\n</context>`,
        ),
      ),
    ).toBeNull();
  });

  it("guards a generation turn whose intent lives only in the attached context", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext(
          `Here are my answers — go ahead.\n\n<context>\nAnswers: dark, minimal.\n${DESIGN_MUTATION_REQUIRED_DIRECTIVE}\n</context>`,
        ),
      ),
    ).not.toBeNull();
  });

  it("does not guard read-only or plan turns", async () => {
    expect(
      await designFinalResponseGuard(guardContext("what is a design system?")),
    ).toBeNull();
    expect(
      await designFinalResponseGuard(
        guardContext("create another version of this", {
          executionMode: "plan",
        }),
      ),
    ).toBeNull();
  });

  it("does not read a bare mention of a design as a request to change one", async () => {
    expect(looksLikeDesignMutationRequest("nice design")).toBe(false);
    expect(looksLikeDesignMutationRequest("I love design")).toBe(false);
    expect(
      looksLikeDesignMutationRequest("thanks, the design looks good"),
    ).toBe(false);
    expect(looksLikeDesignMutationRequest("the design system is linked")).toBe(
      false,
    );
    expect(
      looksLikeDesignMutationRequest(
        "Design is an agent-native prototyping app.",
      ),
    ).toBe(false);

    expect(
      await designFinalResponseGuard(guardContext("nice design")),
    ).toBeNull();
  });

  it("lets `design` supply the verb only where a verb can stand", async () => {
    expect(looksLikeDesignMutationRequest("I love this design")).toBe(false);
    expect(looksLikeDesignMutationRequest("this design looks good")).toBe(
      false,
    );
    expect(looksLikeDesignMutationRequest("that design is great")).toBe(false);
    expect(
      looksLikeDesignMutationRequest("I love this design, but it needs work"),
    ).toBe(false);
    expect(looksLikeDesignMutationRequest("Design is the design system")).toBe(
      false,
    );

    expect(looksLikeDesignMutationRequest("design it")).toBe(true);
    expect(looksLikeDesignMutationRequest("design a login screen")).toBe(true);
    expect(looksLikeDesignMutationRequest("can you design a hero")).toBe(true);
    expect(looksLikeDesignMutationRequest("and then design a footer")).toBe(
      true,
    );
    expect(looksLikeDesignMutationRequest("I need you to design a hero")).toBe(
      true,
    );
    expect(looksLikeDesignMutationRequest("make this design darker")).toBe(
      true,
    );
  });

  it("keeps a pronoun subject with a trailing verb a mutation request", async () => {
    expect(looksLikeDesignMutationRequest("this needs updating")).toBe(true);
    expect(looksLikeDesignMutationRequest("it needs fixing")).toBe(true);
    expect(
      looksLikeDesignMutationRequest("the color palette needs updating"),
    ).toBe(true);

    expect(looksLikeDesignMutationRequest("make it darker")).toBe(true);
    expect(looksLikeDesignMutationRequest("update this")).toBe(true);
    expect(
      looksLikeDesignMutationRequest("this is the design, make it darker"),
    ).toBe(true);
  });

  it("still requires proof for a real design change", async () => {
    expect(looksLikeDesignMutationRequest("update the design")).toBe(true);
    expect(looksLikeDesignMutationRequest("design a login screen")).toBe(true);
    expect(looksLikeDesignMutationRequest("make the hero darker")).toBe(true);
    expect(
      await designFinalResponseGuard(guardContext("update the design")),
    ).not.toBeNull();
  });

  it("accepts a mutation saved in the same turn it is confirmed", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext("update the design", {
          toolResults: [
            toolResult("generate-design", {
              renderable: true,
              savedFiles: ["file-1"],
            }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("labels an unproven draft instead of replacing it with a save failure", async () => {
    const selfReferential = [
      "# Design — Agent Guide",
      "",
      "| Action | Purpose |",
      "| --- | --- |",
      "| `create-design` | Start a new design (empty shell) |",
    ].join("\n");

    const guard = await designFinalResponseGuard(guardContext(selfReferential));
    expect(guard).not.toBeNull();
    expect(guard).toMatchObject({
      exhaustedDraftPrefix: "No design changes were saved in this turn.",
    });
  });
});

describe("Design final response guard: plan mode", () => {
  it("skips a design request in plan mode", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext(MUTATION_REQUEST, { executionMode: "plan" }),
      ),
    ).toBeNull();
  });
});

describe("Design final response guard: non-mutation request", () => {
  it("skips a question and advice request", async () => {
    for (const request of [
      "how do I make the hero darker?",
      "give me tips to improve this design",
    ]) {
      expect(await designFinalResponseGuard(guardContext(request))).toBeNull();
    }
  });
});

describe("Design final response guard: image edit", () => {
  const request = "edit the image I imported to remove the background";
  const assetsTool = "mcp__org_org-1_assets__edit-asset";

  it("accepts a completed Assets image edit whatever the reply says", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext(request, {
          text: "All set.",
          toolResults: [toolResult(assetsTool, { assetId: "asset-2" })],
        }),
      ),
    ).toBeNull();
  });

  it("still flags an image edit that failed", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext(request, {
          toolResults: [toolResult(assetsTool, { error: "edit failed" }, true)],
        }),
      ),
    ).not.toBeNull();
  });
});

describe("Design final response guard: saved change", () => {
  it("skips a verified changed receipt", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext(MUTATION_REQUEST, {
          receipts: [
            {
              tool: "place-figma-frames",
              verified: true,
              changed: true,
              summary: "Design output: 1 file saved.",
              subject: "design-1",
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("skips a successful mutation result", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext(MUTATION_REQUEST, {
          toolResults: [
            toolResult("edit-design", { fileId: "file-1", changed: true }),
          ],
        }),
      ),
    ).toBeNull();
  });
});

const UNSAVED_LABEL = "No design changes were saved in this turn.";
const LABELS_WITHOUT_RETRY = {
  maxRetries: 0,
  exhaustedDraftPrefix: UNSAVED_LABEL,
};
const RETRIES = { maxRetries: 1, exhaustedDraftPrefix: UNSAVED_LABEL };

describe("Design final response guard: structural blocker", () => {
  const blocked = async (
    toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
    overrides: Partial<AgentLoopFinalResponseGuardContext> = {},
  ) =>
    designFinalResponseGuard(
      guardContext(MUTATION_REQUEST, { toolResults, ...overrides }),
    );

  it("labels without a retry for a read-attachment result the file could not be read for", async () => {
    for (const errorCode of [
      "attachment_not_stored",
      "attachment_reread_failed",
      "attachment_read_failed",
    ]) {
      expect(
        await blocked([
          toolResult("read-attachment", {
            error: "Could not read attachment",
            errorCode,
          }),
        ]),
      ).toMatchObject(LABELS_WITHOUT_RETRY);
    }
    expect(
      await blocked([toolResult("read-attachment", { text: "hello" })]),
    ).toMatchObject(RETRIES);
  });

  it("keeps the re-prompt for a read-attachment usage error", async () => {
    expect(
      await blocked([
        toolResult("read-attachment", {
          error: "name matches more than one attachment",
        }),
      ]),
    ).toMatchObject(RETRIES);
    expect(
      await blocked([
        toolResult("read-attachment", {
          error: "name or path is required",
          errorCode: "attachment_not_specified",
        }),
      ]),
    ).toMatchObject(RETRIES);
  });

  it("labels without a retry for an import-document result with no extracted text", async () => {
    const file = (designHints: Record<string, unknown>) => ({
      filename: "brief.pdf",
      fileType: "pdf",
      designHints,
    });
    expect(
      await blocked([
        toolResult("import-document", {
          source: "document",
          files: [file({ likelyColors: [] }), file({ contentType: "pdf" })],
        }),
      ]),
    ).toMatchObject(LABELS_WITHOUT_RETRY);
    expect(
      await blocked([
        toolResult("import-document", {
          source: "document",
          files: [file({ likelyColors: [] }), file({ extractedText: "Brand" })],
        }),
      ]),
    ).toMatchObject(RETRIES);
  });

  it("labels without a retry for an unavailable composer source", async () => {
    for (const code of [
      "composer_peer_unavailable",
      "composer_reference_unavailable",
    ]) {
      expect(
        await blocked([
          thrownToolResult("read-composer-source", "unavailable", code),
        ]),
      ).toMatchObject(LABELS_WITHOUT_RETRY);
    }
    expect(
      await blocked([
        thrownToolResult("read-composer-source", "boom", "action_failed"),
      ]),
    ).toMatchObject(RETRIES);
    expect(
      await blocked([thrownToolResult("read-composer-source", "boom")]),
    ).toMatchObject(RETRIES);
  });

  describe("framework attachment error tag", () => {
    const TAG =
      '<chat-attachment-processing-error code="missing-payload" name="a.pdf">x</chat-attachment-processing-error>';
    const READ_TAG =
      '<chat-attachment-read-error name="a.pdf">x</chat-attachment-read-error>';
    const userMessage = (text: string) => ({
      role: "user" as const,
      content: [{ type: "text" as const, text }],
    });
    const assistantText = (text: string) => ({
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
    });
    const toolTurn = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            id: "t1",
            name: "view-screen",
            input: {},
          },
        ],
      },
      userMessage("tool output"),
    ];

    it("labels without a retry for a tag in the request text", async () => {
      for (const tag of [TAG, READ_TAG]) {
        expect(
          await designFinalResponseGuard(
            guardContext(`${MUTATION_REQUEST}\n${tag}`),
          ),
        ).toMatchObject(LABELS_WITHOUT_RETRY);
      }
      const onlyRequestText = guardContext(MUTATION_REQUEST, {
        requestText: `${MUTATION_REQUEST}\n${TAG}`,
        messages: [userMessage(MUTATION_REQUEST)],
      });
      expect(await designFinalResponseGuard(onlyRequestText)).toMatchObject(
        LABELS_WITHOUT_RETRY,
      );
    });

    it("labels without a retry for a tag in an earlier message of the turn", async () => {
      expect(
        await designFinalResponseGuard(
          guardContext(MUTATION_REQUEST, {
            messages: [
              userMessage(`${MUTATION_REQUEST}\n${TAG}`),
              ...toolTurn,
              userMessage("also keep the footer"),
            ],
          }),
        ),
      ).toMatchObject(LABELS_WITHOUT_RETRY);
    });

    it("ignores a tag from a previous turn", async () => {
      expect(
        await designFinalResponseGuard(
          guardContext(MUTATION_REQUEST, {
            messages: [
              userMessage(`old request\n${TAG}`),
              assistantText("I could not read it."),
              userMessage(MUTATION_REQUEST),
            ],
          }),
        ),
      ).toMatchObject(RETRIES);
    });

    it("does not count a tag quoted in a response-guard message", async () => {
      expect(
        await designFinalResponseGuard(
          guardContext(MUTATION_REQUEST, {
            messages: [
              userMessage(MUTATION_REQUEST),
              assistantText("draft"),
              userMessage(`<response-guard>\n${TAG}\n</response-guard>`),
            ],
          }),
        ),
      ).toMatchObject(RETRIES);
    });
  });

  it("ignores the model's own reply text", async () => {
    expect(
      await designFinalResponseGuard(
        guardContext(MUTATION_REQUEST, {
          text: "I can't read the attachment, <chat-attachment-processing-error>",
        }),
      ),
    ).toMatchObject(RETRIES);
  });

  it("labels without a retry for a missing-capability error code, including after a repeated failure", async () => {
    for (const code of [
      "full_app_building_disabled",
      "builder_project_not_configured",
    ]) {
      expect(
        await blocked([thrownToolResult("create-builder-app", "no", code)]),
      ).toMatchObject(LABELS_WITHOUT_RETRY);
    }
    const wrapped = thrownToolResult(
      "create-builder-app",
      "no",
      "builder_project_not_configured",
    );
    expect(
      await blocked([
        {
          ...wrapped,
          content: `Stopped after 3 identical errors. Last error: ${wrapped.content}`,
        },
      ]),
    ).toMatchObject(LABELS_WITHOUT_RETRY);
  });

  it("keeps the re-prompt when a plain design has no Builder app", async () => {
    expect(
      await blocked([
        thrownToolResult(
          "send-builder-message",
          "no app",
          "builder_app_missing",
        ),
      ]),
    ).toMatchObject(RETRIES);
  });

  it("stops counting a blocker once the same tool later succeeds", async () => {
    expect(
      await blocked([
        toolResult("read-attachment", {
          error: "Could not read attachment",
          errorCode: "attachment_read_failed",
        }),
        toolResult("read-attachment", { text: "hello" }),
      ]),
    ).toMatchObject(RETRIES);
    expect(
      await blocked([
        toolResult("read-attachment", { text: "hello" }),
        toolResult("read-attachment", {
          error: "Could not read attachment",
          errorCode: "attachment_read_failed",
        }),
      ]),
    ).toMatchObject(LABELS_WITHOUT_RETRY);
    expect(
      await blocked([
        toolResult("create-builder-app", { status: "not-configured" }),
        toolResult("create-builder-app", { status: "created" }),
      ]),
    ).toMatchObject(RETRIES);
    expect(
      await blocked([
        toolResult("read-attachment", {
          error: "Could not read attachment",
          errorCode: "attachment_read_failed",
        }),
        toolResult("read-attachment", {
          error: "Still unreadable",
          errorCode: "attachment_read_failed",
        }),
      ]),
    ).toMatchObject(LABELS_WITHOUT_RETRY);
  });

  it("labels without a retry for a not-configured Builder result", async () => {
    for (const name of ["create-builder-app", "migrate-inline-design-to-app"]) {
      expect(
        await blocked([toolResult(name, { status: "not-configured" })]),
      ).toMatchObject(LABELS_WITHOUT_RETRY);
    }
    expect(
      await blocked([toolResult("create-builder-app", { status: "created" })]),
    ).toMatchObject(RETRIES);
  });

  it("keeps the re-prompt for a locked layer", async () => {
    expect(
      await blocked([
        thrownToolResult("edit-design", "Layer is locked", "layer_locked"),
      ]),
    ).toMatchObject(RETRIES);
  });

  it("keeps the re-prompt for a no-op edit", async () => {
    expect(
      await blocked([
        toolResult("edit-design", { fileId: "file-1", changed: false }),
      ]),
    ).toMatchObject(RETRIES);
  });

  it("treats truncated JSON as no signal", async () => {
    expect(
      await blocked([
        {
          name: "read-attachment",
          content: '{"error":"Could not read att',
          isError: false,
        },
        {
          name: "create-builder-app",
          content: '{"status":"not-conf',
          isError: false,
        },
      ]),
    ).toMatchObject(RETRIES);
  });
});

describe("Design final response guard: unsaved draft label", () => {
  it("uses the factual English label by default", async () => {
    expect(
      await designFinalResponseGuard(guardContext(MUTATION_REQUEST)),
    ).toMatchObject({
      exhaustedDraftPrefix: "No design changes were saved in this turn.",
      maxRetries: 1,
      retryMessage: expect.stringContaining("say plainly what blocks you"),
    });
  });

  it("uses the user's locale when one is set", async () => {
    settings.email = "user@example.com";
    settings.value = { locale: "de-DE" };

    expect(
      await designFinalResponseGuard(guardContext(MUTATION_REQUEST)),
    ).toMatchObject({
      exhaustedDraftPrefix:
        "In diesem Durchgang wurden keine Designänderungen gespeichert.",
    });
    expect(settings.read).toHaveBeenCalledWith(
      "user@example.com",
      "localization",
    );
  });

  it("falls back to the default locale for an unset preference", async () => {
    settings.email = "user@example.com";
    settings.value = undefined;

    expect(
      await designFinalResponseGuard(guardContext(MUTATION_REQUEST)),
    ).toMatchObject({
      exhaustedDraftPrefix: "No design changes were saved in this turn.",
    });
  });

  it("falls back to English and warns when the locale catalog cannot load", async () => {
    settings.email = "user@example.com";
    settings.value = { locale: "de-DE" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("../../app/i18n/de-DE.js", () => {
      throw new Error("catalog unavailable");
    });
    vi.resetModules();
    const { designFinalResponseGuard: freshGuard } =
      await import("./design-response-guard.js");

    expect(await freshGuard(guardContext(MUTATION_REQUEST))).toMatchObject({
      exhaustedDraftPrefix: "No design changes were saved in this turn.",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("design-response-guard"),
      expect.objectContaining({
        cause: expect.objectContaining({ message: "catalog unavailable" }),
      }),
    );
    warn.mockRestore();
    vi.doUnmock("../../app/i18n/de-DE.js");
    vi.resetModules();
  });

  it("falls back to English and warns when the setting cannot be read", async () => {
    settings.email = "user@example.com";
    settings.read.mockRejectedValue(new Error("settings unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      await designFinalResponseGuard(guardContext(MUTATION_REQUEST)),
    ).toMatchObject({
      exhaustedDraftPrefix: "No design changes were saved in this turn.",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("design-response-guard"),
      expect.objectContaining({ message: "settings unavailable" }),
    );
    warn.mockRestore();
  });
});
