import { describe, expect, it } from "vitest";

import golden from "./__fixtures__/radix-golden.json" with { type: "json" };
import {
  formatHex,
  generateRadixColors,
  type RadixColorsInput,
  type RadixColorsOutput,
} from "./radix-generator.js";

interface GoldenCase {
  input: RadixColorsInput;
  output: Record<keyof RadixColorsOutput, string | string[]>;
}

const cases = golden as GoldenCase[];

function normalize(value: string): string {
  return formatHex(value);
}

describe("generateRadixColors", () => {
  it("covers every Radix scale and the edge cases", () => {
    expect(cases.length).toBe(100);
  });

  it.each(cases.map((testCase) => [describeCase(testCase), testCase]))(
    "matches upstream for %s",
    (_label, testCase) => {
      const output = generateRadixColors(testCase.input);
      const keys = Object.keys(testCase.output) as Array<
        keyof RadixColorsOutput
      >;
      expect(Object.fromEntries(keys.map((key) => [key, output[key]]))).toEqual(
        Object.fromEntries(
          keys.map((key) => {
            const expected = testCase.output[key];
            return [
              key,
              Array.isArray(expected)
                ? expected.map(normalize)
                : normalize(expected),
            ];
          }),
        ),
      );
    },
  );

  it("rejects an unparseable brand color instead of guessing", () => {
    expect(() =>
      generateRadixColors({
        appearance: "light",
        accent: "brand-blue",
        gray: "#8B8D98",
        background: "#ffffff",
      }),
    ).toThrow(/Unsupported accent color: brand-blue/);
  });
});

function describeCase({ input }: GoldenCase): string {
  return `${input.accent} on ${input.background} (${input.appearance}, gray ${input.gray})`;
}
