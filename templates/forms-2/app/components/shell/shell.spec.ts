import { describe, expect, it } from "vitest";

import type { Translate } from "@/lib/translate";

import {
  formActivity,
  formDisplayName,
  formSearchQuery,
  relativeTime,
} from "./format";
import { formHref } from "./paths";

const english: Record<string, string> = {
  "forms.shell.timeNow": "now",
  "forms.shell.timeMinutes": "{{value}}m",
  "forms.shell.timeHours": "{{value}}h",
  "forms.shell.timeDays": "{{value}}d",
  "forms.shell.timeWeeks": "{{value}}w",
  "forms.shell.timeYears": "{{value}}y",
  "forms.shell.activityDraft": "Draft",
  "forms.shell.activityNoSubmissions": "Nothing submitted yet",
  "forms.shell.submissionCount_one": "{{count}} submission",
  "forms.shell.submissionCount_other": "{{count}} submissions",
  "forms.common.untitled": "Untitled",
};
const t: Translate = (key, options) => {
  const plural = options?.count === 1 ? `${key}_one` : `${key}_other`;
  const template = english[plural] ?? english[key] ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options?.[name]),
  );
};
const now = Date.parse("2026-11-03T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("relativeTime", () => {
  it("compacts ages", () => {
    expect(relativeTime(ago(10_000), t, now)).toBe("now");
    expect(relativeTime(ago(5 * 60_000), t, now)).toBe("5m");
    expect(relativeTime(ago(2 * 3_600_000), t, now)).toBe("2h");
    expect(relativeTime(ago(3 * 86_400_000), t, now)).toBe("3d");
    expect(relativeTime(ago(14 * 86_400_000), t, now)).toBe("2w");
    expect(relativeTime(ago(400 * 86_400_000), t, now)).toBe("1y");
  });
});

describe("formActivity", () => {
  it("describes each status", () => {
    expect(formActivity({ status: "draft", submissionCount: 0 }, t)).toEqual({
      text: "Draft",
      isDraft: true,
    });
    expect(formActivity({ status: "blank", submissionCount: 0 }, t).text).toBe(
      "",
    );
    expect(
      formActivity({ status: "published", submissionCount: 0 }, t).text,
    ).toBe("Nothing submitted yet");
    expect(
      formActivity({ status: "published", submissionCount: 1 }, t).text,
    ).toBe("1 submission");
    expect(
      formActivity({ status: "published", submissionCount: 3 }, t).text,
    ).toBe("3 submissions");
  });
  it("names blank forms Untitled", () => {
    expect(formDisplayName({ name: "  " }, t)).toBe("Untitled");
  });
});

describe("formHref", () => {
  it("routes by status", () => {
    expect(formHref({ id: "a", status: "draft" })).toBe("/forms/a/edit");
    expect(formHref({ id: "a", status: "blank" })).toBe("/forms/a/edit");
    expect(formHref({ id: "a", status: "published", submissionCount: 2 })).toBe(
      "/forms/a",
    );
    expect(formHref({ id: "a", status: "published", submissionCount: 0 })).toBe(
      "/forms/a/share",
    );
  });
});

describe("formSearchQuery", () => {
  it("ignores blank input and trims the rest", () => {
    expect(formSearchQuery("   ")).toBeNull();
    expect(formSearchQuery(" Event ")).toBe("Event");
  });
});
