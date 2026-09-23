import { describe, expect, it } from "vitest";

import { messagesByLocale } from "@/i18n-data";

import { contentAgentPromptValues } from "./content-agent-prompt";

describe("Content agent copy request", () => {
  it("uses the chosen instance, base path, and exact document id", () => {
    const values = contentAgentPromptValues({
      documentId: "page / one",
      origin: "https://beta.content.agent-native.com",
      basePath: "/workspace/",
    });

    expect(values).toEqual({
      documentUrl:
        "https://beta.content.agent-native.com/workspace/p/page%20%2F%20one",
      mcpUrl: "https://beta.content.agent-native.com/workspace/mcp",
      documentId: "page / one",
      connectUrl: "https://beta.content.agent-native.com/workspace/mcp/connect",
      docsUrl:
        "https://www.agent-native.com/docs/external-agents/#private-content-links",
    });
    expect(Object.keys(values).sort()).toEqual(
      Array.from(
        messagesByLocale["en-US"].editor.toolbar.agentPrompt.matchAll(
          /{{(\w+)}}/g,
        ),
        (match) => match[1],
      ).sort(),
    );
  });
});
