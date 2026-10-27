import { describe, expect, it } from "vitest";

import {
  MCP_APPROVAL_MESSAGES,
  mcpApprovalMessagesForLocale,
} from "./mcp-approval-messages.js";
import { SUPPORTED_LOCALES } from "./shared.js";

const PLACEHOLDER = /\{[a-z]+\}/g;

describe("MCP approval translations", () => {
  it("translates every message in every built-in locale, with the same placeholders", () => {
    const english = MCP_APPROVAL_MESSAGES["en-US"];
    for (const locale of SUPPORTED_LOCALES) {
      const messages = MCP_APPROVAL_MESSAGES[locale];
      for (const key of Object.keys(english) as (keyof typeof english)[]) {
        expect(messages[key], `${locale} ${key}`).toEqual(expect.any(String));
        expect(messages[key].trim(), `${locale} ${key}`).not.toBe("");
        expect(
          (messages[key].match(PLACEHOLDER) ?? []).sort(),
          `${locale} ${key}`,
        ).toEqual((english[key].match(PLACEHOLDER) ?? []).sort());
        // A one-word label ("No") can be the same word in another language.
        if (locale !== "en-US" && english[key].includes(" ")) {
          expect(messages[key], `${locale} ${key}`).not.toBe(english[key]);
        }
      }
    }
  });

  it("falls back to English for a locale without its own copy", () => {
    expect(mcpApprovalMessagesForLocale("xx-XX" as never)).toBe(
      MCP_APPROVAL_MESSAGES["en-US"],
    );
  });
});
