import { describe, expect, it, vi } from "vitest";

import {
  applyBoardMove,
  BOARD_UNGROUPED,
  boardCardSla,
  boardColumns,
  boardColumnTotals,
  boardOverruns,
  moveBoardCard,
  moveValueForColumn,
  pickCurrencyAttribute,
  type BoardCard,
  type BoardOption,
} from "./board-model";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function option(value: string, extra: Partial<BoardOption> = {}): BoardOption {
  return {
    id: `opt-${value}`,
    value,
    title: value,
    position: 0,
    archived: false,
    targetDays: null,
    celebrate: false,
    ...extra,
  };
}

function card(id: string, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    recordId: `rec-${id}`,
    title: id,
    subtitle: null,
    owner: null,
    groupValue: BOARD_UNGROUPED,
    groupSince: null,
    amount: null,
    currencyCode: null,
    attributes: [],
    actorType: null,
    ...extra,
  };
}

describe("boardColumns", () => {
  const options = [
    option("new", { position: 0 }),
    option("in-progress", { position: 1 }),
    option("won", { position: 2 }),
  ];

  it("puts every card in exactly one column, including an unset column", () => {
    const cards = [
      card("a", { groupValue: "new" }),
      card("b", { groupValue: "won" }),
      card("c"),
      card("d", { groupValue: "" }),
    ];
    const columns = boardColumns(cards, options);

    expect(columns.map((column) => column.key)).toEqual([
      "new",
      "in-progress",
      "won",
      BOARD_UNGROUPED,
    ]);
    const placed = columns.flatMap((column) =>
      column.cards.map((entry) => entry.id),
    );
    expect(placed.sort()).toEqual(["a", "b", "c", "d"]);
    expect(new Set(placed).size).toBe(placed.length);
    expect(columns.at(-1)?.cards.map((entry) => entry.id)).toEqual(["c", "d"]);
  });

  it("keeps live option order and drops empty archived options", () => {
    const columns = boardColumns(
      [card("a", { groupValue: "new" })],
      [...options, option("retired", { archived: true, position: 3 })],
    );
    expect(columns.map((column) => column.key)).not.toContain("retired");
  });

  it("gives an archived or unrecognized value its own column, never the unset one", () => {
    const columns = boardColumns(
      [
        card("a", { groupValue: "retired" }),
        card("b", { groupValue: "ghost" }),
        card("c"),
      ],
      [...options, option("retired", { archived: true, position: 3 })],
    );
    const retired = columns.find((column) => column.key === "retired");
    const ghost = columns.find((column) => column.key === "ghost");
    expect(retired?.kind).toBe("archived");
    expect(ghost?.kind).toBe("unknown");
    expect(
      columns.find((column) => column.key === BOARD_UNGROUPED)?.cards,
    ).toHaveLength(1);
  });
});

describe("boardColumnTotals", () => {
  it("sums amounts and reports how many cards it does not cover", () => {
    const totals = boardColumnTotals([
      card("a", { amount: 100, currencyCode: "USD" }),
      card("b", { amount: 250, currencyCode: "USD" }),
      card("c"),
    ]);
    expect(totals).toMatchObject({
      count: 3,
      sum: 350,
      currencyCode: "USD",
      withoutAmount: 1,
      mixedCurrency: false,
    });
  });

  it("reports no total for a mixed-currency column", () => {
    const totals = boardColumnTotals([
      card("a", { amount: 100, currencyCode: "USD" }),
      card("b", { amount: 100, currencyCode: "EUR" }),
    ]);
    expect(totals.sum).toBeNull();
    expect(totals.mixedCurrency).toBe(true);
  });
});

describe("boardCardSla", () => {
  const timeboxed = option("in-progress", { targetDays: 7 });

  it("is not tracked when the option has no target_days", () => {
    expect(
      boardCardSla(
        { groupSince: "2026-07-01T00:00:00.000Z" },
        option("new"),
        NOW,
      ),
    ).toEqual({ status: "not-tracked" });
  });

  it("measures days from active_from against the fixed clock", () => {
    expect(
      boardCardSla({ groupSince: "2026-07-21T12:00:00.000Z" }, timeboxed, NOW),
    ).toEqual({ status: "within", days: 5, targetDays: 7 });
  });

  it("flags an overrun with how far past target it is", () => {
    expect(
      boardCardSla({ groupSince: "2026-07-16T12:00:00.000Z" }, timeboxed, NOW),
    ).toEqual({ status: "overrun", days: 10, targetDays: 7, overBy: 3 });
  });

  it("reports unknown rather than zero days when no start is recorded", () => {
    expect(boardCardSla({ groupSince: null }, timeboxed, NOW)).toEqual({
      status: "unknown",
      reason: "no-start-recorded",
    });
    expect(boardCardSla({ groupSince: "not-a-date" }, timeboxed, NOW)).toEqual({
      status: "unknown",
      reason: "unreadable-start",
    });
  });

  it("ranks overruns worst-first across the board", () => {
    const columns = boardColumns(
      [
        card("a", {
          groupValue: "in-progress",
          groupSince: "2026-07-16T12:00:00.000Z",
        }),
        card("b", {
          groupValue: "in-progress",
          groupSince: "2026-07-01T12:00:00.000Z",
        }),
        card("c", {
          groupValue: "in-progress",
          groupSince: "2026-07-25T12:00:00.000Z",
        }),
      ],
      [timeboxed],
    );
    expect(boardOverruns(columns, NOW).map((entry) => entry.card.id)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("applyBoardMove", () => {
  it("moves one card and stamps a new stage start", () => {
    const cards = [card("a", { groupValue: "new" }), card("b")];
    const next = applyBoardMove(cards, "a", "won", "2026-07-26T12:00:00.000Z");
    expect(next[0]).toMatchObject({
      groupValue: "won",
      groupSince: "2026-07-26T12:00:00.000Z",
    });
    expect(next[1]).toBe(cards[1]);
    expect(cards[0]?.groupValue).toBe("new");
  });

  it("throws on an unknown card instead of returning the list untouched", () => {
    expect(() => applyBoardMove([card("a")], "missing", "won", "now")).toThrow(
      /not on this board/,
    );
  });
});

describe("moveBoardCard", () => {
  const cards = [
    card("entry-1", { groupValue: "new" }),
    card("entry-2", { groupValue: "won" }),
  ];

  it("commits the destination option value and keeps the optimistic paint", async () => {
    const apply = vi.fn();
    const commit = vi.fn().mockResolvedValue({ ok: true });

    const result = await moveBoardCard({
      cards,
      cardId: "entry-1",
      toValue: "won",
      now: "2026-07-26T12:00:00.000Z",
      apply,
      commit,
    });

    expect(result).toEqual({ moved: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0]).toMatchObject({ toValue: "won" });
    expect(commit.mock.calls[0]?.[0].card.id).toBe("entry-1");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0][0]).toMatchObject({ groupValue: "won" });
  });

  it("returns the card to its original column when the commit fails", async () => {
    const painted: BoardCard[][] = [];
    const error = new Error("stage is managed upstream");

    const result = await moveBoardCard({
      cards,
      cardId: "entry-1",
      toValue: "won",
      now: "2026-07-26T12:00:00.000Z",
      apply: (next) => painted.push(next),
      commit: () => Promise.reject(error),
    });

    expect(result.moved).toBe(false);
    expect(result.error).toBe(error);
    expect(painted).toHaveLength(2);
    expect(painted[0]?.[0]?.groupValue).toBe("won");
    const rolledBack = boardColumns(painted[1] ?? [], [
      option("new"),
      option("won"),
    ]);
    expect(
      rolledBack.find((column) => column.key === "new")?.cards.map((c) => c.id),
    ).toEqual(["entry-1"]);
    expect(
      rolledBack.find((column) => column.key === "won")?.cards.map((c) => c.id),
    ).toEqual(["entry-2"]);
  });

  it("does not call the action when the card is already in that column", async () => {
    const commit = vi.fn();
    const result = await moveBoardCard({
      cards,
      cardId: "entry-2",
      toValue: "won",
      now: "now",
      apply: () => {},
      commit,
    });
    expect(result).toEqual({ moved: false });
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("column helpers", () => {
  it("clears the field when a card is dropped in the unset column", () => {
    expect(moveValueForColumn(BOARD_UNGROUPED)).toBeNull();
    expect(moveValueForColumn("won")).toBe("won");
  });

  it("prefers a currency attribute the view already shows", () => {
    const attributes = [
      { id: "a1", apiSlug: "arr", attributeType: "currency" },
      { id: "a2", apiSlug: "deal_value", attributeType: "currency" },
      { id: "a3", apiSlug: "stage", attributeType: "status" },
    ];
    expect(pickCurrencyAttribute(attributes, ["a2"])?.id).toBe("a2");
    expect(pickCurrencyAttribute(attributes)?.id).toBe("a1");
    expect(pickCurrencyAttribute([attributes[2]!])).toBeNull();
  });
});
