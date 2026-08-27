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
