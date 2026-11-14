import { describe, expect, it } from "vitest";

import { parseHubLInterpolation } from "./hubl-interpolation.js";

function expressions(literal: string): string[] {
  return [
    `{{ personalization_token('contact.firstname', '${literal}') }}`,
    `{{ personalization_token("contact.firstname", "${literal}") }}`,
    `{{ contact.firstname|default('${literal}', true) }}`,
    `{{ contact.firstname|default("${literal}", true) }}`,
  ];
}

describe("HubL string literals", () => {
  it.each([
    [String.raw`\'`, "'"],
    [String.raw`\"`, '"'],
    [String.raw`\\`, "\\"],
    [String.raw`\n`, "\n"],
    [String.raw`\t`, "\t"],
    [String.raw`\b`, "\b"],
    [String.raw`\f`, "\f"],
    [String.raw`\r`, "\r"],
    [String.raw`\\n`, String.raw`\n`],
    ["", ""],
  ])("decodes Jinjava's supported escape %j", (literal, fallback) => {
    for (const token of expressions(literal))
      expect(parseHubLInterpolation(token)).toMatchObject({
        name: "contact.firstname",
        fallback,
      });
  });

  it.each([
    String.raw`\u0022`,
    String.raw`\x22`,
    String.raw`\042`,
    String.raw`\v`,
    String.raw`\/`,
  ])("rejects escape %j unsupported by Jinjava", (literal) => {
    for (const token of expressions(literal))
      expect(parseHubLInterpolation(token)).toBeUndefined();
  });
});
