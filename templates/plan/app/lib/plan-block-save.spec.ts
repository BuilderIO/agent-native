import type { PlanBlock } from "@shared/plan-content";
import { describe, expect, it, vi } from "vitest";

import {
  PlanBlocksOverlapError,
  saveBlocksMergingConflicts,
  type PlanBlocksRevision,
} from "./plan-block-save";

const prose = (id: string, markdown: string) =>
  ({ id, type: "rich-text", data: { markdown } }) as PlanBlock;

const conflict = () =>
  Object.assign(new Error("outdated revision"), {
    errorCode: "plan_revision_conflict",
    status: 409,
  });

const base: PlanBlocksRevision = {
  updatedAt: "2026-10-01T00:00:01.000Z",
  blocks: [prose("a", "Alpha."), prose("b", "Bravo.")],
};

describe("saveBlocksMergingConflicts", () => {
  it("saves straight away when nobody else wrote", async () => {
    const save = vi.fn(async (blocks: PlanBlock[], expected: string) => ({
      updatedAt: `${expected}+1`,
      blocks,
    }));
    const readLatest = vi.fn();
    const saved = await saveBlocksMergingConflicts({
      base,
      blocks: [prose("a", "Alpha. mine"), base.blocks[1]],
      save,
      readLatest,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe(base.updatedAt);
    expect(readLatest).not.toHaveBeenCalled();
    expect(saved.updatedAt).toBe(`${base.updatedAt}+1`);
  });

  it("merges the pending edit onto what the other writer saved instead of dropping it", async () => {
    const theirs: PlanBlocksRevision = {
      updatedAt: "2026-10-01T00:00:05.000Z",
      blocks: [base.blocks[0], prose("b", "Bravo. theirs")],
    };
    const save = vi
      .fn<
        (blocks: PlanBlock[], expected: string) => Promise<PlanBlocksRevision>
      >()
      .mockRejectedValueOnce(conflict())
      .mockImplementation(async (blocks, expected) => ({
        updatedAt: `${expected}+1`,
        blocks,
      }));
    const saved = await saveBlocksMergingConflicts({
      base,
      blocks: [prose("a", "Alpha. mine"), base.blocks[1]],
      save,
      readLatest: async () => theirs,
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toBe(theirs.updatedAt);
    expect(save.mock.calls[1][0]).toEqual([
      prose("a", "Alpha. mine"),
      prose("b", "Bravo. theirs"),
    ]);
    expect(saved.blocks).toEqual(save.mock.calls[1][0]);
  });

  it("rebases onto each newer revision when writers keep colliding", async () => {
    const revisions = [
      {
        updatedAt: "2026-10-01T00:00:05.000Z",
        blocks: [base.blocks[0], prose("b", "Bravo. one")],
      },
      {
        updatedAt: "2026-10-01T00:00:06.000Z",
        blocks: [base.blocks[0], prose("b", "Bravo. one two")],
      },
    ];
    const save = vi
      .fn<
        (blocks: PlanBlock[], expected: string) => Promise<PlanBlocksRevision>
      >()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockImplementation(async (blocks, expected) => ({
        updatedAt: `${expected}+1`,
        blocks,
      }));
    const saved = await saveBlocksMergingConflicts({
      base,
      blocks: [prose("a", "Alpha. mine"), base.blocks[1]],
      save,
      readLatest: async () => revisions.shift()!,
    });
    expect(saved.blocks).toEqual([
      prose("a", "Alpha. mine"),
      prose("b", "Bravo. one two"),
    ]);
  });

  it("reports an overlap, without saving over the other writer", async () => {
    const callout = (body: string) =>
      ({ id: "c", type: "callout", data: { tone: "info", body } }) as PlanBlock;
    const calloutBase: PlanBlocksRevision = {
      updatedAt: base.updatedAt,
      blocks: [callout("Note.")],
    };
    const error = conflict();
    const save = vi.fn().mockRejectedValue(error);
    const failure = await saveBlocksMergingConflicts({
      base: calloutBase,
      blocks: [callout("Mine.")],
      save,
      readLatest: async () => ({
        updatedAt: "2026-10-01T00:00:05.000Z",
        blocks: [callout("Theirs.")],
      }),
    }).catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(PlanBlocksOverlapError);
    expect((failure as PlanBlocksOverlapError).conflict).toBe(error);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of merges", async () => {
    const error = conflict();
    const save = vi.fn().mockRejectedValue(error);
    let tick = 5;
    await expect(
      saveBlocksMergingConflicts({
        base,
        blocks: [prose("a", "Alpha. mine"), base.blocks[1]],
        save,
        readLatest: async () => ({
          updatedAt: `2026-10-01T00:00:0${tick++}.000Z`,
          blocks: base.blocks,
        }),
      }),
    ).rejects.toBe(error);
    expect(save).toHaveBeenCalledTimes(4);
  });

  it("does not retry other failures", async () => {
    const offline = new TypeError("Failed to fetch");
    const save = vi.fn().mockRejectedValue(offline);
    const readLatest = vi.fn();
    await expect(
      saveBlocksMergingConflicts({
        base,
        blocks: base.blocks,
        save,
        readLatest,
      }),
    ).rejects.toBe(offline);
    expect(readLatest).not.toHaveBeenCalled();
  });
});
