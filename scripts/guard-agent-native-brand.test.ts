import { describe, expect, it } from "vitest";

import { findBrandViolations } from "./guard-agent-native-brand.js";

describe("agent-native brand guard", () => {
  it("rejects spaced and incorrectly cased brand copy", () => {
    const spaced = ["Agent", "Native"].join(" ");
    const wrongTitleCase = ["Agent", "native"].join("-");

    expect(
      findBrandViolations([
        {
          path: "fixture.ts",
          text: `${spaced} and ${wrongTitleCase}`,
        },
      ]),
    ).toEqual(["fixture.ts:1"]);
  });

  it("allows canonical copy, technical identifiers, and legacy asset aliases", () => {
    const legacyAsset = ["Agent", "Native"].join(" ") + " Nightly-arm64.dmg";

    expect(
      findBrandViolations([
        {
          path: "fixture.ts",
          text: [
            "Agent-Native",
            "AgentNative",
            "AGENT_NATIVE",
            "agentnative://oauth-complete",
            legacyAsset,
          ].join("\n"),
        },
      ]),
    ).toEqual([]);
  });

  it("allows reviewed non-brand fixture exceptions", () => {
    const malformedOcr = ["agent", "native"].join(" ") + " conlent";

    expect(
      findBrandViolations([
        {
          path: "fixture.rs",
          text: `// agent-native-brand-ok: intentional OCR near miss\n${malformedOcr}`,
        },
      ]),
    ).toEqual([]);
  });
});
