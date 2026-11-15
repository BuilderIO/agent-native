// @vitest-environment happy-dom

// The shared fix for the "browser format ignores the reader's locale" class. These checks pin the
// two halves that make the class real:
//   1. a passed locale actually reaches Intl, so two readers see different output for the same value;
//   2. a surface with no i18n provider formats in the catalog default, never the machine's locale.
// A mutant that drops the locale argument (the old `.toLocaleString()`) makes the first check fail.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FALLBACK_READER_LOCALE,
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleNumber,
  formatLocaleTime,
  useReaderLocale,
} from "./reader-locale.js";

function Probe() {
  return <span>{useReaderLocale()}</span>;
}

describe("reader locale formatting", () => {
  it("formats numbers in the reader's locale, not a fixed one", () => {
    expect(formatLocaleNumber(1234.5, "en-US")).toBe(
      (1234.5).toLocaleString("en-US"),
    );
    expect(formatLocaleNumber(1234.5, "de-DE")).toBe(
      (1234.5).toLocaleString("de-DE"),
    );
    // The two must actually differ, or the locale never reached Intl.
    expect(formatLocaleNumber(1234.5, "en-US")).not.toBe(
      formatLocaleNumber(1234.5, "de-DE"),
    );
  });

  it("formats dates in the reader's locale", () => {
    const value = "2026-11-09T18:00:00Z";
    expect(formatLocaleDate(value, "en-GB")).toBe(
      new Date(value).toLocaleDateString("en-GB"),
    );
    expect(formatLocaleDate(value, "en-GB")).not.toBe(
      formatLocaleDate(value, "en-US"),
    );
  });

  it("formats date-times and times with the given locale", () => {
    const value = "2026-11-09T18:00:00Z";
    expect(formatLocaleDateTime(value, "de-DE")).toBe(
      new Date(value).toLocaleString("de-DE"),
    );
    expect(formatLocaleTime(value, "en-GB")).toBe(
      new Date(value).toLocaleTimeString("en-GB"),
    );
  });

  it("falls back to the catalog default, never the machine locale, without a provider", () => {
    const markup = renderToString(<Probe />);
    expect(markup).toContain(`>${FALLBACK_READER_LOCALE}<`);
    expect(FALLBACK_READER_LOCALE).toBe("en-US");
  });
});
