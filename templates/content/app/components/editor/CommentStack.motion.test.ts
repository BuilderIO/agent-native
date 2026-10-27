import { describe, expect, it } from "vitest";

import {
  changeStackFront,
  settleStackFront,
  startStackFront,
} from "./CommentStack";

describe("a folded stack's front change", () => {
  it("starts still, or with the card it last showed leaving", () => {
    expect(startStackFront("a", undefined, true)).toEqual({
      front: "a",
      leaving: null,
      turn: 0,
    });
    expect(startStackFront("a", "a", true)).toEqual({
      front: "a",
      leaving: null,
      turn: 0,
    });
    expect(startStackFront("b", "a", true)).toEqual({
      front: "b",
      leaving: "a",
      turn: 1,
    });
  });

  it("holds on to the card it last showed until every thread is placed", () => {
    expect(startStackFront("b", "a", false)).toEqual({
      front: "a",
      leaving: null,
      turn: 0,
    });
    expect(startStackFront("b", undefined, false)).toEqual({
      front: "b",
      leaving: null,
      turn: 0,
    });
  });

  it("sends the card in front out as the next one comes in", () => {
    const still = startStackFront("a", undefined, true);
    expect(changeStackFront(still, "a")).toBe(still);
    expect(changeStackFront(still, "b")).toEqual({
      front: "b",
      leaving: "a",
      turn: 1,
    });
  });

  it("lets the latest front win, with at most one card leaving", () => {
    let motion = startStackFront("a", undefined, true);
    for (const front of ["b", "c", "d", "b"]) {
      motion = changeStackFront(motion, front);
    }
    expect(motion).toEqual({ front: "b", leaving: "d", turn: 4 });
  });

  it("clears the leaving card once its own change settles, not an earlier one's", () => {
    const first = changeStackFront(startStackFront("a", undefined, true), "b");
    const second = changeStackFront(first, "c");
    expect(settleStackFront(second, first.turn)).toBe(second);
    expect(settleStackFront(second, second.turn)).toEqual({
      front: "c",
      leaving: null,
      turn: 2,
    });
  });
});
