import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

import {
  designFinalResponseGuard,
  looksLikeDesignMutationRequest,
} from "./design-response-guard.js";

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

describe("Design final response guard", () => {
  it("recognizes design mutations while excluding how-to and preview requests", () => {
    expect(
      looksLikeDesignMutationRequest("can you create another version of this"),
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
      looksLikeDesignMutationRequest("review this card. fix the button"),
    ).toBe(true);
    expect(
      looksLikeDesignMutationRequest("review this card; fix the button"),
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

  it("retries prose-only completion for a design mutation", () => {
    const result = designFinalResponseGuard(
      guardContext("can you create another version of this"),
    );

    expect(result).toMatchObject({
      maxRetries: 1,
      expandToolSurface: true,
      retryMessage: expect.stringContaining("generate-design"),
    });
  });

  it("does not accept the empty project shell as a completed design", () => {
    const result = designFinalResponseGuard(
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

  it("accepts persisted generation, edit, and asset placement proof", () => {
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
      [toolResult("apply-a11y-fix", { designId: "design-1", applied: true })],
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
      [toolResult("create-design-system", { id: "design-system-1" })],
      [toolResult("update-file", { id: "file-1", updated: true })],
      [toolResult("update-design", { id: "design-1", updated: true })],
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
        designFinalResponseGuard(
          guardContext("create another version of this", { toolResults }),
        ),
      ).toBeNull();
    }
  });

  it("does not accept a partial generation", () => {
    const result = designFinalResponseGuard(
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

  it("does not accept empty tweaks or a stale mirrored file update", () => {
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
    ]) {
      expect(
        designFinalResponseGuard(
          guardContext("make it darker", { toolResults }),
        ),
      ).not.toBeNull();
    }
  });

  it("does not accept a failed mutation result", () => {
    const result = designFinalResponseGuard(
      guardContext("create another version of this", {
        toolResults: [
          toolResult("generate-design", { renderable: true }, true),
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("does not guard read-only or plan turns", () => {
    expect(
      designFinalResponseGuard(guardContext("what is a design system?")),
    ).toBeNull();
    expect(
      designFinalResponseGuard(
        guardContext("create another version of this", {
          executionMode: "plan",
        }),
      ),
    ).toBeNull();
  });
});
