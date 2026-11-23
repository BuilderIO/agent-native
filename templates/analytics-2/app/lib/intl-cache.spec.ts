import { describe, expect, it } from "vitest";

import {
  getCachedDateTimeFormat,
  getCachedNumberFormat,
  getCachedPluralRules,
} from "./intl-cache";

describe("intl-cache", () => {
  it("reuses Intl.DateTimeFormat instances across identical options regardless of key order", () => {
    const first = getCachedDateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const second = getCachedDateTimeFormat("en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    });
    const other = getCachedDateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });

    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("reuses Intl.NumberFormat and Intl.PluralRules instances for matching locale and options", () => {
    const numberA = getCachedNumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 2,
    });
    const numberB = getCachedNumberFormat("en-US", {
      maximumFractionDigits: 2,
      style: "percent",
    });
    const pluralA = getCachedPluralRules("en-US", { type: "cardinal" });
    const pluralB = getCachedPluralRules("en-US", { type: "cardinal" });

    expect(numberB).toBe(numberA);
    expect(pluralB).toBe(pluralA);
  });
});
