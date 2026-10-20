import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";

import { createItemsStrings } from "../items-strings";
import {
  isSlackSource,
  itemPhase as phaseOf,
  needsYouText as needsYouTextOf,
  sourceLabel as sourceLabelOf,
  statusLabel as statusLabelOf,
  whereText as whereTextOf,
  type PhaseInput,
} from "./item-status";
import type { ItemParking, NeedsYouReason } from "./read-types";

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const s = createItemsStrings(createEnglishTranslator());
const itemPhase = (input: PhaseInput) => phaseOf(input, s);
const needsYouText = (reasons: readonly NeedsYouReason[]) =>
  needsYouTextOf(reasons, s);
const sourceLabel = (source: string | null) => sourceLabelOf(source, s);
const statusLabel = (status: string) => statusLabelOf(status, s);
const whereText = (row: Parameters<typeof whereTextOf>[0], nowMs: number) =>
  whereTextOf(row, nowMs, s, "en-US");

function parking(over: Partial<ItemParking> = {}): ItemParking {
  return {
    nodeId: "wait1",
    nodeName: "Wait for reply",
    nodeMissingFromGraph: false,
    wait: "reply",
    dueAt: new Date(2026, 9, 18, 14, 40).toISOString(),
    nextCheckAt: null,
    watching: null,
    ...over,
  };
}

describe("itemPhase", () => {
  it("puts a person's attention above waiting and above the inbox status", () => {
    expect(
      itemPhase({
        status: "resolved",
        parked: parking(),
        needsYouReasons: ["handed_off"],
      }).key,
    ).toBe("needs_you");
    expect(
      itemPhase({ status: "needs_manual", parked: null, needsYouReasons: [] })
        .key,
    ).toBe("needs_you");
  });

  it("shows waiting for a parked item", () => {
    const phase = itemPhase({
      status: "classified",
      parked: parking(),
      needsYouReasons: [],
    });
    expect(phase).toMatchObject({
      key: "waiting",
      tone: "waiting",
      label: "Waiting",
    });
  });

  it("labels dismissed, which is a status of its own", () => {
    expect(
      itemPhase({ status: "dismissed", parked: null, needsYouReasons: [] }),
    ).toEqual({
      key: "dismissed",
      label: "Dismissed",
      tone: "neutral",
    });
  });

  it("treats failures as attention and finished work as quiet", () => {
    expect(
      itemPhase({ status: "failed", parked: null, needsYouReasons: [] }).tone,
    ).toBe("attention");
    expect(
      itemPhase({ status: "merged", parked: null, needsYouReasons: [] }).key,
    ).toBe("done");
  });

  it("calls an item with no inbox row in the workflow, not by an invented status", () => {
    expect(
      itemPhase({ status: null, parked: null, needsYouReasons: [] }).key,
    ).toBe("in_flow");
  });

  it("shows a status it has no word for exactly as stored", () => {
    expect(
      itemPhase({ status: "quarantined", parked: null, needsYouReasons: [] }),
    ).toEqual({ key: "other", label: "quarantined", tone: "neutral" });
    expect(statusLabel("quarantined")).toBe("quarantined");
  });
});

describe("whereText", () => {
  it("says what a parked item waits for and until when", () => {
    expect(whereText({ parked: parking(), lastNode: null }, NOW)).toMatch(
      /^Waiting for a reply until /,
    );
    expect(
      whereText({ parked: parking({ wait: "time" }), lastNode: null }, NOW),
    ).toMatch(/^Waiting until /);
    expect(
      whereText(
        { parked: parking({ wait: "condition" }), lastNode: null },
        NOW,
      ),
    ).toMatch(/^Waiting for a check to pass until /);
  });

  it("falls back to the step of the last event, then to nothing", () => {
    expect(
      whereText(
        { parked: null, lastNode: { nodeId: "n1", nodeName: "Assess" } },
        NOW,
      ),
    ).toBe("At Assess");
    expect(
      whereText(
        { parked: null, lastNode: { nodeId: "n1", nodeName: null } },
        NOW,
      ),
    ).toBe("At n1");
    expect(whereText({ parked: null, lastNode: null }, NOW)).toBeNull();
  });
});

describe("needsYouText", () => {
  it("names each reason and keeps one it does not know", () => {
    expect(needsYouText([])).toBeNull();
    expect(needsYouText(["attempts_exhausted", "effect_needs_check"])).toBe(
      "Out of attempts, A write may have happened: check it",
    );
  });
});

describe("sourceLabel", () => {
  it("uses the known names and makes a provider id readable", () => {
    expect(sourceLabel("github_issue")).toBe("GitHub issue");
    expect(sourceLabel("my_crm")).toBe("My crm");
    expect(sourceLabel(null)).toBeNull();
  });

  it("recognizes a Slack source by name", () => {
    expect(isSlackSource("slack")).toBe(true);
    expect(isSlackSource("github")).toBe(false);
    expect(isSlackSource(null)).toBe(false);
  });
});
