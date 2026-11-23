import { describe, expect, it } from "vitest";

import { resolvePendingScrubCommit } from "./ScrubInput";

// oracle-change: removed local re-simulations of scrub gestures and arrow-key deltas; scrub-input-utils.test.ts owns updateScrubDrag, roundScrubDragValue and step modifiers
// oracle-change(templates/design/app/components/design/inspector/design-icons.test.tsx): restated Tabler svg attributes of static icons, no behaviour

describe("ScrubInput — pending-commit resolution", () => {
  it("keeps holding only while the incoming prop is the exact pre-commit baseline", () => {
    expect(
      resolvePendingScrubCommit({ value: 24, baseline: 16 }, 16, {
        unit: "px",
        precision: 1,
      }),
    ).toBe("hold");
  });

  it("accepts a different authoritative host value instead of staying stuck forever", () => {
    expect(
      resolvePendingScrubCommit({ value: 24, baseline: 16 }, 20, {
        unit: "px",
        precision: 1,
      }),
    ).toBe("superseded");
  });

  it("recognizes a normalized echo as confirmation", () => {
    expect(
      resolvePendingScrubCommit({ value: 24, baseline: 16 }, 24.04, {
        precision: 1,
      }),
    ).toBe("confirmed");
  });
});
