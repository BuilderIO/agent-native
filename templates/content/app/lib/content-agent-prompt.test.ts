import { describe, expect, it } from "vitest";

import "@/i18n/ar-SA";
import "@/i18n/de-DE";
import "@/i18n/es-ES";
import "@/i18n/fr-FR";
import "@/i18n/hi-IN";
import "@/i18n/ja-JP";
import "@/i18n/ko-KR";
import "@/i18n/pt-BR";
import "@/i18n/zh-CN";
import "@/i18n/zh-TW";
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

  it("keeps every locale's agent request placeholders aligned", () => {
    const expected = [
      "connectUrl",
      "docsUrl",
      "documentId",
      "documentUrl",
      "mcpUrl",
    ];

    for (const [locale, messages] of Object.entries(messagesByLocale)) {
      const placeholders = Array.from(
        messages.editor.toolbar.agentPrompt.matchAll(/{{(\w+)}}/g),
        (match) => match[1],
      ).sort();
      expect(placeholders, locale).toEqual(expected);
    }
  });
});
