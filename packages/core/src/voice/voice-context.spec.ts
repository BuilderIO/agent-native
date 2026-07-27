import { describe, expect, it } from "vitest";

import {
  applyVoiceContextReplacements,
  buildVoiceGuidanceBlock,
  formatVoiceContextPackForPrompt,
  sanitizeVoiceContextPack,
  voiceContextTermsOnly,
} from "./index.js";

describe("voice context helpers", () => {
  it("sanitizes and formats bounded voice context", () => {
    const pack = sanitizeVoiceContextPack({
      surface: "agent-composer",
      mode: "dictation",
      snippets: [{ label: "Active file", value: "packages/core/src/index.ts" }],
      terms: [
        {
          term: "react router",
          replacement: "React Router",
          source: "workspace",
        },
      ],
      metadata: { route: "/settings", ignored: { nested: true } },
    });

    expect(pack).toMatchObject({
      surface: "agent-composer",
      mode: "dictation",
    });
    expect(pack?.metadata).toEqual({ route: "/settings" });

    const prompt = formatVoiceContextPackForPrompt(pack);
    expect(prompt).toContain("Active file");
    expect(prompt).toContain("react router -> React Router");
  });

  it("builds a guarded guidance block", () => {
    const guidance = buildVoiceGuidanceBlock({
      instructions: "Prefer Builder.io casing.",
      contextPack: {
        terms: [{ term: "builder io", replacement: "Builder.io" }],
      },
    });

    expect(guidance).toContain("Never add facts");
    expect(guidance).toContain("Prefer Builder.io casing");
    expect(guidance).toContain("builder io -> Builder.io");
  });

  it("can strip voice context down to provider-safe vocabulary terms", () => {
    expect(
      voiceContextTermsOnly({
        snippets: [{ label: "Active app context", value: "Private draft" }],
        terms: [{ term: "builder io", replacement: "Builder.io" }],
        metadata: { route: "/private" },
      }),
    ).toEqual({
      terms: [{ term: "builder io", replacement: "Builder.io" }],
    });

    expect(
      voiceContextTermsOnly({
        snippets: [{ label: "Active app context", value: "Private draft" }],
      }),
    ).toBeUndefined();
  });

  it("applies preferred replacements at token boundaries", () => {
    const pack = {
      terms: [
        { term: "kublectl", replacement: "kubectl" },
        { term: "react router", replacement: "React Router" },
      ],
    };

    expect(
      applyVoiceContextReplacements(
        "open kublectl and check react router docs",
        pack,
      ),
    ).toBe("open kubectl and check React Router docs");

    expect(applyVoiceContextReplacements("prefixkublectl", pack)).toBe(
      "prefixkublectl",
    );
  });

  it("does not rewrite terms inside structured email, URL, or identifier tokens", () => {
    const pack = {
      terms: [
        { term: "example", replacement: "Example" },
        { term: "api", replacement: "API" },
        { term: "foo", replacement: "Foo" },
      ],
    };

    expect(
      applyVoiceContextReplacements(
        "email alice@example.com and open api.example.com, then inspect foo-bar",
        pack,
      ),
    ).toBe(
      "email alice@example.com and open api.example.com, then inspect foo-bar",
    );
    expect(applyVoiceContextReplacements("open api, then foo.", pack)).toBe(
      "open API, then Foo.",
    );
  });
});
