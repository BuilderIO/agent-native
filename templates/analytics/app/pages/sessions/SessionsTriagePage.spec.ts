import { describe, expect, it } from "vitest";

import {
  readHideEmptyFilter,
  withCustomDate,
  withSessionFilter,
} from "./SessionsTriagePage";

describe("Sessions filter links", () => {
  it("keeps the default and both generations of explicit empty-session choices", () => {
    expect(readHideEmptyFilter(new URLSearchParams())).toBe(true);
    expect(
      readHideEmptyFilter(
        new URLSearchParams("triage=1&includeZeroMinuteSessions=true"),
      ),
    ).toBe(false);
    expect(
      readHideEmptyFilter(
        new URLSearchParams("includeZeroMinuteSessions=true&hideEmpty=true"),
      ),
    ).toBe(true);
    expect(
      readHideEmptyFilter(
        new URLSearchParams("includeZeroMinuteSessions=false&hideEmpty=false"),
      ),
    ).toBe(false);
  });

  it("clears either custom bound without dropping the other or app filter", () => {
    const initial = new URLSearchParams("app=clips&page=3");
    const both = withCustomDate(
      withCustomDate(initial, "fromDate", "2026-09-01"),
      "toDate",
      "2026-09-25",
    );
    const openEnd = withCustomDate(both, "toDate", "");
    expect(openEnd.get("range")).toBe("custom");
    expect(openEnd.get("fromDate")).toBe("2026-09-01");
    expect(openEnd.get("from")).toBeTruthy();
    expect(openEnd.has("toDate")).toBe(false);
    expect(openEnd.has("to")).toBe(false);
    expect(openEnd.get("app")).toBe("clips");
    expect(openEnd.has("page")).toBe(false);

    const openStart = withCustomDate(both, "fromDate", "");
    expect(openStart.has("fromDate")).toBe(false);
    expect(openStart.has("from")).toBe(false);
    expect(openStart.get("toDate")).toBe("2026-09-25");
    expect(openStart.get("to")).toBeTruthy();

    const preset = withSessionFilter(openStart, "range", "7d");
    expect(preset.get("range")).toBe("7d");
    expect(preset.has("fromDate")).toBe(false);
    expect(preset.has("toDate")).toBe(false);
    expect(preset.has("from")).toBe(false);
    expect(preset.has("to")).toBe(false);
    expect(preset.get("app")).toBe("clips");
    expect(preset.has("triage")).toBe(false);
  });
});
