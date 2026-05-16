import { describe, expect, it } from "vitest";
import {
  dreamSettingsToDraft,
  dreamSettingsUpdateFromDraft,
  splitSourceIds,
  type DreamSettingsDraft,
} from "./dream-settings.js";

function draft(
  overrides: Partial<DreamSettingsDraft> = {},
): DreamSettingsDraft {
  return {
    enabled: true,
    schedule: "0 9 * * 1",
    sourceId: "all",
    sourceIdsText: "",
    allSources: true,
    query: "",
    limit: "8",
    sourceTimeoutMs: "30000",
    sourceConcurrency: "2",
    sourceStartStaggerMs: "250",
    threadConcurrency: "3",
    threadTimeoutMs: "8000",
    minCandidateCount: "1",
    ...overrides,
  };
}

describe("dream settings payload helpers", () => {
  it("normalizes persisted settings into editable draft text", () => {
    expect(
      dreamSettingsToDraft({
        enabled: true,
        schedule: "0 8 * * 2",
        sourceId: "selected",
        sourceIds: ["mail", "calendar"],
        allSources: false,
        query: "memory",
        limit: 12,
        sourceTimeoutMs: 45000,
        sourceConcurrency: 4,
        sourceStartStaggerMs: 500,
        threadConcurrency: 5,
        threadTimeoutMs: 9000,
        minCandidateCount: 2,
      }),
    ).toMatchObject({
      enabled: true,
      schedule: "0 8 * * 2",
      sourceId: "selected",
      sourceIdsText: "mail\ncalendar",
      allSources: false,
      query: "memory",
      limit: "12",
      sourceTimeoutMs: "45000",
      sourceConcurrency: "4",
      sourceStartStaggerMs: "500",
      threadConcurrency: "5",
      threadTimeoutMs: "9000",
      minCandidateCount: "2",
    });
  });

  it("splits explicit source ids from commas and newlines", () => {
    expect(splitSourceIds(" mail\ncalendar, analytics ,, \nbrain ")).toEqual([
      "mail",
      "calendar",
      "analytics",
      "brain",
    ]);
  });

  it("builds a save payload that clears source ids and query", () => {
    expect(
      dreamSettingsUpdateFromDraft(
        draft({
          enabled: false,
          schedule: " 0 10 * * 3 ",
          sourceId: " current ",
          sourceIdsText: "",
          allSources: false,
          query: "   ",
          minCandidateCount: "0",
        }),
      ),
    ).toMatchObject({
      enabled: false,
      schedule: "0 10 * * 3",
      sourceId: "current",
      sourceIds: [],
      allSources: false,
      query: "",
      limit: 8,
      sourceTimeoutMs: 30000,
      sourceConcurrency: 2,
      sourceStartStaggerMs: 250,
      threadConcurrency: 3,
      threadTimeoutMs: 8000,
      minCandidateCount: 0,
    });
  });

  it("falls back to all source scope and omits invalid numeric edits", () => {
    expect(
      dreamSettingsUpdateFromDraft(
        draft({
          sourceId: "   ",
          sourceIdsText: "mail\ncalendar",
          limit: "not-a-number",
          threadTimeoutMs: "",
        }),
      ),
    ).toMatchObject({
      sourceId: "all",
      sourceIds: ["mail", "calendar"],
      allSources: true,
    });
    expect(
      dreamSettingsUpdateFromDraft(
        draft({ limit: "not-a-number", threadTimeoutMs: "" }),
      ),
    ).not.toHaveProperty("limit");
    expect(
      dreamSettingsUpdateFromDraft(
        draft({ limit: "not-a-number", threadTimeoutMs: "" }),
      ),
    ).not.toHaveProperty("threadTimeoutMs");
  });
});
