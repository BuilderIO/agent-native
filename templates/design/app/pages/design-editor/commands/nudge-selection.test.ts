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
      node: { id: "box" },
    } as any;

    expect(
      resolveNudgeTarget(
        stale,
        [target],
        new Map([["screen-a:box", rendered]]),
      ),
    ).toBe(rendered);
  });

  it("uses the focused layer when multiple layers are selected", () => {
    const focused = element("30px");
    focused.sourceLayerIdentity = { screenId: "screen-a", nodeId: "focused" };
    const first = {
      fileId: "screen-a",
      layerId: "first",
      elementInfo: element("10px"),
      node: { id: "first" },
    } as any;
    const second = {
      fileId: "screen-a",
      layerId: "focused",
      elementInfo: focused,
      node: { id: "different-node-id" },
    } as any;
    const rendered = element("230px");

    expect(
      resolveNudgeTarget(
        focused,
        [first, second],
        new Map([["screen-a:focused", rendered]]),
      ),
    ).toBe(rendered);
  });
});
