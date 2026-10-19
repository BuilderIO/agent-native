// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  animationOfTarget,
  planElementAnimation,
} from "./slide-animation-quick-pick";

const content = '<div class="fmd-slide"><h1>Title</h1><p>Body</p></div>';
const target = { elementIndex: 0, elementPath: [0], preview: "Title" };

describe("planElementAnimation", () => {
  it("adds an animation for an element that has none", () => {
    const plan = planElementAnimation({
      content,
      animations: [],
      target,
      type: "fade",
    });
    expect(plan.ok && plan.animations).toMatchObject([
      { elementPath: [0], type: "fade" },
    ]);
  });

  it("changes the type of an existing animation in place", () => {
    const added = planElementAnimation({
      content,
      animations: [],
      target,
      type: "fade",
    });
    if (!added.ok) throw new Error("expected ok");
    const changed = planElementAnimation({
      content,
      animations: added.animations,
      target,
      type: "zoom",
    });
    expect(changed.ok && changed.animations).toMatchObject([
      { id: added.animations[0]!.id, type: "zoom" },
    ]);
  });

  it("removes the animation for none", () => {
    const added = planElementAnimation({
      content,
      animations: [],
      target,
      type: "appear",
    });
    if (!added.ok) throw new Error("expected ok");
    expect(animationOfTarget(content, added.animations, target)).not.toBeNull();
    const removed = planElementAnimation({
      content,
      animations: added.animations,
      target,
      type: "none",
    });
    expect(removed).toEqual({ ok: true, animations: [] });
  });

  it("refuses a target that no longer resolves", () => {
    const plan = planElementAnimation({
      content,
      animations: [],
      target: { elementIndex: 9, elementPath: [9], preview: "Gone" },
      type: "fade",
    });
    expect(plan).toEqual({ ok: false, reason: "stale-path" });
  });
});
