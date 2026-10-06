import { describe, expect, it } from "vitest";

import { toolkitMessagesForLocale, TOOLKIT_LOCALES } from "./catalog.js";

function flatten(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out[path] = child;
    else flatten(child, path, out);
  }
  return out;
}

function placeholders(value: string) {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1]!)
    .sort();
}

describe("Toolkit app messages", () => {
  const english = flatten(toolkitMessagesForLocale("en-US"));

  it("provides translated UI copy with matching placeholders in every locale", () => {
    for (const locale of TOOLKIT_LOCALES) {
      const messages = flatten(toolkitMessagesForLocale(locale));
      const required = Object.keys(english).filter(
        (key) => !/_(zero|one|two|few|many|other)$/.test(key),
      );

      for (const key of required) {
        expect(messages[key], `${locale}:${key}`).toEqual(expect.any(String));
        expect(placeholders(messages[key]!), `${locale}:${key}`).toEqual(
          placeholders(english[key]!),
        );
      }

      if (locale !== "en-US") {
        const translated = required.filter(
          (key) => messages[key] !== english[key],
        );
        expect(translated.length / required.length, locale).toBeGreaterThan(
          0.9,
        );
      }
    }
  });

  it("keeps legacy UI keys alongside the agentChat namespace", () => {
    const spanish = flatten(toolkitMessagesForLocale("es-ES"));
    expect(spanish["agentPanel.chat"]).toBe("Chat");
    expect(spanish["agentChat.shell.chat"]).toBe("Chat");
    expect(spanish["observability.summaryQueued"]).toBe(
      spanish["agentChat.observability.summaryQueued"],
    );
  });
});
