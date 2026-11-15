import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { describe, expect, it } from "vitest";

import { partitionReuseLabels } from "./generation-reuse-labels.js";

const base = {
  kind: "figma-frame",
  label: "Pricing hero",
  dataRole: "untrusted-reference" as const,
};

const evidence: CreativeContextReuseLabel = {
  ...base,
  itemId: "item-1",
  itemVersionId: "version-1",
};

describe("partitionReuseLabels", () => {
  it("keeps a label tied to an item version", () => {
    expect(partitionReuseLabels([evidence], { contextOff: false })).toEqual({
      recordable: [evidence],
      ignored: [],
    });
  });

  it("keeps a generated label that has no item ids, with Creative Context on or off", () => {
    const generated: CreativeContextReuseLabel = {
      ...base,
      influence: "generated",
    };
    for (const contextOff of [false, true]) {
      expect(partitionReuseLabels([generated], { contextOff })).toEqual({
        recordable: [generated],
        ignored: [],
      });
    }
  });

  it("ignores a reference label without item ids, which is the default influence", () => {
    expect(partitionReuseLabels([base], { contextOff: false })).toEqual({
      recordable: [],
      ignored: [
        {
          kind: "figma-frame",
          label: "Pricing hero",
          reason: "missing-item-ids",
        },
      ],
    });
    expect(
      partitionReuseLabels([{ ...base, influence: "reused" }], {
        contextOff: false,
      }).ignored,
    ).toHaveLength(1);
  });

  it("ignores a label with only one of the two ids, even when generated", () => {
    const labels: CreativeContextReuseLabel[] = [
      { ...base, itemId: "item-1" },
      { ...base, itemVersionId: "version-1", influence: "generated" },
    ];
    const { recordable, ignored } = partitionReuseLabels(labels, {
      contextOff: false,
    });
    expect(recordable).toEqual([]);
    expect(ignored.map((entry) => entry.reason)).toEqual([
      "partial-item-ids",
      "partial-item-ids",
    ]);
  });

  it("ignores a label that has ids when Creative Context is off", () => {
    expect(partitionReuseLabels([evidence], { contextOff: true })).toEqual({
      recordable: [],
      ignored: [
        { kind: "figma-frame", label: "Pricing hero", reason: "context-off" },
      ],
    });
  });

  it("keeps the order of the labels it keeps", () => {
    const second: CreativeContextReuseLabel = {
      ...evidence,
      itemId: "item-2",
      label: "Second",
    };
    expect(
      partitionReuseLabels([evidence, base, second], { contextOff: false })
        .recordable,
    ).toEqual([evidence, second]);
  });
});
