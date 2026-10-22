import { describe, expect, it } from "vitest";

import {
  AGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  AGENT_PROFILE_ALIASES_MAX_ITEMS,
  AGENT_PROFILE_ALIAS_MAX_LENGTH,
  AGENT_PROFILE_WHEN_TO_USE_MAX_ITEMS,
  AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH,
  parseAgentProfileMetadataFields,
  parseAgentProfileMetadata,
} from "./agent-profile.js";

describe("parseAgentProfileMetadata", () => {
  it("trims supported profile text", () => {
    expect(
      parseAgentProfileMetadata({
        description: "  Summarize customer feedback.  ",
        whenToUse: ["  Find repeated customer complaints.  "],
      }),
    ).toEqual({
      description: "Summarize customer feedback.",
      whenToUse: ["Find repeated customer complaints."],
    });
  });

  it("rejects descriptions above the shared text bound", () => {
    expect(
      parseAgentProfileMetadata({
        description: "x".repeat(AGENT_PROFILE_DESCRIPTION_MAX_LENGTH + 1),
      }),
    ).toBeNull();
  });

  it("rejects descriptions containing control characters", () => {
    expect(
      parseAgentProfileMetadata({ description: "line\nbreak" }),
    ).toBeNull();
    expect(
      parseAgentProfileMetadata({ description: "tab\tcharacter" }),
    ).toBeNull();
  });

  it("rejects too many or oversized use cases", () => {
    expect(
      parseAgentProfileMetadata({
        whenToUse: Array.from(
          { length: AGENT_PROFILE_WHEN_TO_USE_MAX_ITEMS + 1 },
          () => "Use this app.",
        ),
      }),
    ).toBeNull();
    expect(
      parseAgentProfileMetadata({
        whenToUse: ["x".repeat(AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH + 1)],
      }),
    ).toBeNull();
  });

  it("rejects use cases containing control characters", () => {
    expect(
      parseAgentProfileMetadata({ whenToUse: ["line\nbreak"] }),
    ).toBeNull();
    expect(
      parseAgentProfileMetadata({ whenToUse: ["tab\tcharacter"] }),
    ).toBeNull();
  });

  it("rejects blank, non-string, and malformed profiles", () => {
    expect(parseAgentProfileMetadata({ whenToUse: [" "] })).toBeNull();
    expect(parseAgentProfileMetadata({ description: 42 })).toBeNull();
    expect(
      parseAgentProfileMetadata({ whenToUse: "Use this app." }),
    ).toBeNull();
  });

  it("trims and deduplicates aliases case-insensitively in first-seen order", () => {
    expect(
      parseAgentProfileMetadata({
        aliases: ["  Support  ", "support", "Customer Care", "CUSTOMER CARE"],
      }),
    ).toEqual({ aliases: ["Support", "Customer Care"] });
  });

  it("rejects malformed, overlong, non-plain-text, or excessive aliases", () => {
    for (const aliases of [
      "support",
      [" "],
      [42],
      [`x`.repeat(AGENT_PROFILE_ALIAS_MAX_LENGTH + 1)],
      ["line\nbreak"],
      Array.from(
        { length: AGENT_PROFILE_ALIASES_MAX_ITEMS + 1 },
        () => "alias",
      ),
    ]) {
      expect(parseAgentProfileMetadata({ aliases })).toBeNull();
    }
  });

  it("drops invalid fields while preserving the valid profile fields", () => {
    expect(
      parseAgentProfileMetadataFields({
        description: "A useful app.",
        whenToUse: ["line\nbreak"],
        aliases: ["QR code"],
      }),
    ).toEqual({
      metadata: {
        description: "A useful app.",
        aliases: ["QR code"],
      },
      invalidFields: ["whenToUse"],
    });
  });
});
