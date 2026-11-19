import { describe, expect, it } from "vitest";

import {
  composeApplyHandoff,
  deliveredLocalRecords,
  getDurableApplyHandoff,
  styleHandoffRecord,
  tweakHandoffRecord,
} from "./apply-handoff";

const gap = (newValue: number) =>
  tweakHandoffRecord({ id: "gap", label: "Gap", oldValue: 1, newValue });

describe("composeApplyHandoff", () => {
  it("orders remote, visuals, and tweak deltas after one leading full-app header", () => {
    const result = composeApplyHandoff({
      remote: {
        revision: 7,
        records: [styleHandoffRecord("remote-1", "Remote instructions")],
      },
      local: [
        styleHandoffRecord("visual-1", "Visual instructions"),
        tweakHandoffRecord({
          id: "spacing",
          label: "Spacing",
          oldValue: 2,
          newValue: 4,
        }),
      ],
      fullApp: { enabled: true, designId: "design-1" },
    });
    expect(result.prompt.startsWith("This is a full-app design")).toBe(true);
    expect(result.prompt.indexOf("send-builder-message")).toBeLessThan(
      result.prompt.indexOf("Remote instructions"),
    );
    expect(result.prompt.indexOf("Remote instructions")).toBeLessThan(
      result.prompt.indexOf("Visual instructions"),
    );
    expect(result.prompt.indexOf("Visual instructions")).toBeLessThan(
      result.prompt.indexOf("Changed tweaks"),
    );
    expect(result.prompt.match(/send-builder-message/g)).toHaveLength(2);
    expect(result.prompt.match(/This is a full-app design/g)).toHaveLength(1);
    expect(result.prompt).toContain("revision: 7,");
    expect(result.records.map((record) => record.key)).toEqual([
      "remote-1",
      "visual-1",
      "spacing",
    ]);
    expect(result.remote).toBe(true);
  });

  it("includes tweak-only deltas and keeps their acknowledgement explicit", () => {
    const result = composeApplyHandoff({
      local: [
        tweakHandoffRecord({
          id: "speed",
          label: "Speed",
          oldValue: 1,
          newValue: 3,
        }),
      ],
      fullApp: { enabled: true, designId: "design-1" },
    });
    expect(result.prompt).toContain("Speed (id: `speed`): 1 → 3");
    expect(result.prompt).toContain("acknowledge-visual-edit-pending");
    expect(result.prompt).toContain("revision: <exact-handoff-revision>");
    expect(result.remote).toBe(false);
    expect(getDurableApplyHandoff(result)).toEqual({
      pendingEditCount: 1,
      prompt: result.prompt,
      records: result.records,
    });
  });

  it("publishes one pending count per record", () => {
    const handoff = composeApplyHandoff({
      local: [
        styleHandoffRecord("visual-1", "Visual instructions"),
        styleHandoffRecord("visual-2", "More visual instructions"),
        gap(2),
      ],
      fullApp: { enabled: false },
    });
    expect(getDurableApplyHandoff(handoff)?.pendingEditCount).toBe(3);
    expect(getDurableApplyHandoff(handoff)?.prompt).toContain("Changed tweaks");
    expect(
      getDurableApplyHandoff(
        composeApplyHandoff({ local: [], fullApp: { enabled: false } }),
      ),
    ).toBeNull();
  });

  it("routes full-app tweaks through Builder without local source instructions", () => {
    const { prompt } = composeApplyHandoff({
      local: [gap(2)],
      fullApp: { enabled: true, designId: "d1" },
    });
    expect(prompt).toContain("send-builder-message");
    expect(prompt).not.toContain("Locate the source files");
    expect(prompt).not.toContain("verify the running page");
  });

  it("does not repeat a local change the durable handoff already carries", () => {
    const visual = styleHandoffRecord("v1", "Same visual instruction");
    const result = composeApplyHandoff({
      remote: { revision: 9, records: [visual, gap(2)] },
      local: [visual, gap(2)],
      fullApp: { enabled: true, designId: "d1" },
    });

    expect(result.prompt.match(/Same visual instruction/g)).toHaveLength(1);
    expect(result.prompt.match(/Gap \(id: `gap`\)/g)).toHaveLength(1);
    expect(result.records).toHaveLength(2);
  });

  it("sends a newer local tweak value instead of the stale published one", () => {
    const result = composeApplyHandoff({
      remote: { revision: 9, records: [gap(2)] },
      local: [gap(5)],
      fullApp: { enabled: false, designId: "d1" },
    });

    expect(result.prompt).toContain("Gap (id: `gap`): 1 → 5");
    expect(result.prompt).not.toContain("1 → 2");
    expect(result.prompt).toContain('appliedTweaks: [{ id: "gap", value: 5 }]');
    expect(result.records).toEqual([gap(5)]);
  });

  it("keeps every uncovered local edit's own instructions when an earlier edit is covered", () => {
    const first = styleHandoffRecord("v1", "First edit instructions");
    const second = styleHandoffRecord("v2", "Second edit instructions");
    const result = composeApplyHandoff({
      remote: { revision: 3, records: [first] },
      local: [first, second],
      fullApp: { enabled: false },
    });

    expect(result.prompt).toContain("First edit instructions");
    expect(result.prompt).toContain("Second edit instructions");
    expect(result.records).toEqual([first, second]);
  });

  it("finalizes local edits the durable handoff already carried", () => {
    const covered = styleHandoffRecord("v1", "Covered instructions");
    const fresh = styleHandoffRecord("v2", "Fresh instructions");
    const handoff = composeApplyHandoff({
      remote: { revision: 3, records: [covered] },
      local: [covered, fresh],
      fullApp: { enabled: false },
    });

    expect(deliveredLocalRecords(handoff, [covered, fresh])).toEqual([
      covered,
      fresh,
    ]);
    expect(
      deliveredLocalRecords(handoff, [
        covered,
        styleHandoffRecord("v1", "Edited after Apply"),
      ]),
    ).toEqual([covered]);
  });

  it("keeps localhost source instructions when a disabled full app has an id", () => {
    const { prompt } = composeApplyHandoff({
      local: [gap(2)],
      fullApp: { enabled: false, designId: "d1" },
    });
    expect(prompt).toContain("Apply the remix board changes to source code");
    expect(prompt).toContain("Locate the source files");
    expect(prompt).not.toContain("send-builder-message");
  });

  it("uses the current design ID in local tweak acknowledgement instructions", () => {
    const handoff = composeApplyHandoff({
      local: [
        tweakHandoffRecord({
          id: "radius",
          label: "Corner radius",
          oldValue: "8px",
          newValue: "12px",
        }),
      ],
      fullApp: { enabled: false, designId: "design-123" },
    });

    expect(handoff.prompt).toContain(
      'acknowledge-visual-edit-pending with { designId: "design-123",',
    );
    expect(handoff.prompt).toContain(
      "Apply the remix board changes to source code and verify the running page.",
    );
    expect(handoff.prompt).not.toContain("send-builder-message");
  });

  it("tells the agent which revision to acknowledge for a remote style-only handoff", () => {
    const { prompt } = composeApplyHandoff({
      remote: {
        revision: 12,
        records: [styleHandoffRecord("v1", "Remote style")],
      },
      local: [],
      fullApp: { enabled: false },
    });
    expect(prompt).toContain("acknowledge only revision 12");
  });
});
