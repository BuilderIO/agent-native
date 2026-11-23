import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appLocale } from "@/i18n/locale";

import { formatResultDate, highlightQuery } from "./format";

/**
 * Search result dates come from the app's own locale. The formatter used to be
 * built with `undefined`, so a reader whose browser is set to another language got
 * that language in one column while the rest of the app stayed en-US.
 */
const OLD_DATE = "2026-01-05T12:00:00.000Z";

describe("search result dates follow the app locale", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("builds its DateFormat with the app locale, not the runtime's", () => {
    // Record the constructor argument while still returning a real formatter, so
    // the assertion is about the locale the app passes, not about the output.
    const Real = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      this: unknown,
      locale?: string,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return new Real(locale, options);
    } as unknown as typeof Intl.DateTimeFormat);
    formatResultDate(OLD_DATE);
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(call[0]).toBe(appLocale);
    }
  });

  it("renders the app locale's date shape for an old result", () => {
    // Return an exact shape so the assertion cannot pass on a stand-in value.
    const out = new Intl.DateTimeFormat(appLocale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(Date.parse(OLD_DATE));
    expect(formatResultDate(OLD_DATE)).toBe(out);
  });

  it("keeps relative labels for recent results", () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(formatResultDate(twoMinAgo)).toBe("2 min ago");
    expect(formatResultDate("not-a-date")).toBe("");
  });
  it("report 1794899641.937429: formats search dates like HumanDate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    const now = Date.now();
    const cases: Array<[number, string]> = [
      [0, "1 sec ago"],
      [-44, "44 secs ago"],
      [-45, "1 min ago"],
      [-90, "2 min ago"],
      [-2700, "1 hr ago"],
      [-5400, "2 hrs ago"],
      [-79200, "1 day ago"],
      [-129600, "2 days ago"],
      [90, "in 2 min"],
    ];
    for (const [seconds, expected] of cases) {
      expect(
        formatResultDate(new Date(now + seconds * 1000).toISOString()),
      ).toBe(expected);
    }
    const week = new Date(now - 7 * 24 * 60 * 60 * 1000);
    expect(formatResultDate(week.toISOString())).toBe(
      new Intl.DateTimeFormat(appLocale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(week),
    );
  });
});

function extractMarkedText(node: ReactNode): string[] {
  if (!Array.isArray(node)) return [];
  const marks: string[] = [];
  for (const part of node) {
    if (
      isValidElement<{ children?: ReactNode }>(part) &&
      part.type === "mark"
    ) {
      marks.push(String(part.props.children ?? ""));
    }
  }
  return marks;
}

describe("highlightQuery", () => {
  it("highlights diacritic-folded matches in original text", () => {
    expect(extractMarkedText(highlightQuery("Café Margin", "cafe"))).toEqual([
      "Café",
    ]);
    expect(
      extractMarkedText(highlightQuery("Naïve Résumé", "naive resume")),
    ).toEqual(["Naïve", "Résumé"]);
  });

  it("prefers longer overlapping tokens over shorter prefix tokens", () => {
    expect(
      extractMarkedText(highlightQuery("Revenue Report", "rev revenue")),
    ).toEqual(["Revenue"]);
  });
});
