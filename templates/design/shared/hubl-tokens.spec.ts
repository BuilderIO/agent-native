import { describe, expect, it } from "vitest";

import { scanHubLInterpolations } from "./hubl-tokens.js";

describe("HubL interpolation scanning", () => {
  it.each([
    "{{ site_settings.company_name }}",
    "{{ personalization_token('contact.firstname', 'hello }} there') }}",
    '{{ personalization_token("contact.firstname", "hello }} there") }}',
    String.raw`{{ personalization_token('contact.firstname', 'it\'s }} here') }}`,
    String.raw`{{ personalization_token("contact.firstname", "a \"quote\" }} here") }}`,
    String.raw`{{ personalization_token('contact.firstname', 'backslash \\') }}`,
    "{{ '{{' }}",
  ])("preserves the complete token %s and exclusive offsets", (raw) => {
    expect(scanHubLInterpolations(`Hi ${raw}!`)).toEqual({
      tokens: [{ start: 3, end: 3 + raw.length, raw }],
    });
  });

  it("finds adjacent interpolations without consuming surrounding text", () => {
    expect(scanHubLInterpolations("a{{ x }}{{ y }}z")).toEqual({
      tokens: [
        { start: 1, end: 8, raw: "{{ x }}" },
        { start: 8, end: 15, raw: "{{ y }}" },
      ],
    });
  });

  it.each(["{{", "{{ '{{'", "{{ 'trailing escape \\"])(
    "reports the first unclosed opener in %s",
    (raw) => {
      expect(scanHubLInterpolations(`a{{ x }}b${raw}{{ another`)).toEqual({
        tokens: [{ start: 1, end: 8, raw: "{{ x }}" }],
        unclosedAt: 9,
      });
    },
  );

  it("does not interpret lone braces as interpolation delimiters", () => {
    expect(scanHubLInterpolations("a { b } }} c")).toEqual({ tokens: [] });
  });
});
