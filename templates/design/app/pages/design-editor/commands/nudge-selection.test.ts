import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { resolveNudgeTarget } from "./nudge-selection";

const element = (left: string): ElementInfo =>
  ({
    selector: "[data-agent-native-node-id=box]",
    computedStyles: { left },
  }) as unknown as ElementInfo;

describe("resolveNudgeTarget", () => {
  it("prefers the post-drag rendered measurement over stale selection", () => {
    const stale = element("30px");
    const rendered = element("230px");
    const target = {
      fileId: "screen-a",
      layerId: "box",
      elementInfo: stale,
    } as any;

    expect(
      resolveNudgeTarget(stale, target, new Map([["screen-a:box", rendered]])),
    ).toBe(rendered);
  });
});
