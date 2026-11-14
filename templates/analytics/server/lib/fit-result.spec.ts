import { describe, expect, it } from "vitest";

import { fitResult, serializedResultChars } from "./fit-result";

const build = (text: string) => ({ total: 3, text });
const trim = (keep: number) => (text: string) => text.slice(0, keep);

describe("fitResult", () => {
  it("returns the result untouched when it fits", () => {
    const result = fitResult({
      initial: "short",
      build,
      steps: [trim(1)],
      summarize: () => ({}),
      guidance: "unused",
      cap: 1_000,
    });
    expect(result).toEqual({ total: 3, text: "short" });
  });

  it("applies steps in order until the complete result fits", () => {
    const order: string[] = [];
    const result = fitResult({
      initial: "x".repeat(500),
      build,
      steps: [
        (text) => (order.push("a"), text.slice(0, 300)),
        (text) => (order.push("b"), text.slice(0, 100)),
        (text) => (order.push("c"), text.slice(0, 10)),
      ],
      summarize: () => ({}),
      guidance: "unused",
      cap: 200,
    });
    expect(order).toEqual(["a", "b"]);
    expect(serializedResultChars(result)).toBeLessThanOrEqual(200);
  });

  it("gives steps the overage and a fits probe", () => {
    const result = fitResult({
      initial: "x".repeat(500),
      build,
      steps: [
        (text, { overage, fits }) => {
          expect(overage).toBeGreaterThan(0);
          expect(fits(text)).toBe(false);
          return text.slice(0, 50);
        },
      ],
      summarize: () => ({}),
      guidance: "unused",
      cap: 200,
    });
    expect(result).toEqual({ total: 3, text: "x".repeat(50) });
  });

  it("returns a typed error with a summary when the steps cannot fit it", () => {
    const result = fitResult({
      initial: "x".repeat(500),
      build: (text) => ({ ...build(text), fixed: "y".repeat(400) }),
      steps: [trim(0)],
      summarize: (text) => ({ total: 3, remainingText: text.length }),
      guidance: "Narrow the date range or lower the limit.",
      cap: 200,
    });
    expect(result).toMatchObject({
      error: "result_too_large",
      capChars: 200,
      total: 3,
      remainingText: 0,
      guidance: "Narrow the date range or lower the limit.",
    });
    expect(serializedResultChars(result)).toBeLessThanOrEqual(400);
  });
});
