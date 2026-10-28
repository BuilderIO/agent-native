import { describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";
import { createEnglishTranslator } from "@/lib/__tests__/en-translator";

import { createPickerStrings } from "./picker-strings";

function catalogKeys(): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") keys.add(path);
    else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(enUS.providerPicker, "providerPicker");
  return keys;
}

describe("picker strings", () => {
  // Every key en-US holds under providerPicker is read once, and none read is missing.
  it("read exactly the keys the en-US catalog holds", () => {
    const requested = new Set<string>();
    const s = createPickerStrings(createEnglishTranslator(requested));
    Object.values(s.choose);
    Object.values(s.tag);
    s.search;
    s.useTyped("C0123");
    s.noMatches;
    s.loadMore;
    s.retry;
    s.changeOrganization;
    s.error.notConnected("Slack");
    s.error.refused("Slack");
    s.error.missingScope("Slack", "groups:read");
    s.error.rateLimited("Slack");
    s.error.unreadable("Slack");
    const held = catalogKeys();
    expect([...requested].filter((key) => !held.has(key))).toEqual([]);
    expect([...held].filter((key) => !requested.has(key))).toEqual([]);
  });

  it("puts what the person typed, and the provider and permission, into the sentence", () => {
    const s = createPickerStrings(createEnglishTranslator());
    expect(s.useTyped("C0123")).toBe("Use “C0123”");
    expect(s.error.missingScope("Slack", "groups:read")).toBe(
      "The Slack connection lacks the groups:read permission. You can still type a value.",
    );
  });
});
