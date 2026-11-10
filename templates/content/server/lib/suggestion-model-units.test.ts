import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findReplaceEditPieces,
  markdownSuggestionOperations,
} from "../../shared/suggestion-diff.js";
import { sentenceUnits } from "../../shared/suggestion-units.js";
import { createWithSavedUnits, modelUnits } from "./suggestion-model-units.js";

const decide = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/decisions", () => ({ decide }));
const savedProposal = vi.hoisted(() => vi.fn());
vi.mock(
  "@agent-native/core/review/suggestions/actions/get-resource-suggestion-proposal-by-creation-key",
  () => ({ default: { run: savedProposal } }),
);

const ownerEmail = "writer@example.com";
const answered = (answers: Record<string, unknown>) => ({
  status: "ok",
  provider: "jev",
  model: "jev-latest",
  answers,
});
const predicate = (name: string, probability: number) => ({
  [name]: { type: "predicate", name, probability },
});

// Two typos in one sentence, which sentence units hold together.
const typos = markdownSuggestionOperations(
  "We recieved three invoices and payed two of them yesterday.",
  "We received three invoices and paid two of them yesterday.",
);
// One rename across two sentences, which sentence units hold apart.
const rename = markdownSuggestionOperations(
  "Acme will host the summit. Tickets for the Acme summit go on sale in May.",
  "Apex will host the summit. Tickets for the Apex summit go on sale in May.",
);

describe("createWithSavedUnits", () => {
  const conflict = Object.assign(new Error("key used"), {
    actionContractError: true,
    errorCode: "idempotency_conflict",
  });
  const save = (create: (labels: readonly unknown[]) => Promise<string>) =>
    createWithSavedUnits({
      labels: ["k:0", "k:1"],
      idempotencyKey: "k",
      ctx: { userEmail: ownerEmail } as never,
      create,
    });

  beforeEach(() => savedProposal.mockReset());

  it("saves the labels it was given", async () => {
    const create = vi.fn().mockResolvedValue("saved");
    await expect(save(create)).resolves.toBe("saved");
    expect(create.mock.calls).toEqual([[["k:0", "k:1"]]]);
    expect(savedProposal).not.toHaveBeenCalled();
  });

  it("repeats with the labels saved first after a conflict", async () => {
    savedProposal.mockResolvedValue({
      suggestions: [
        { metadata: { reviewUnit: "k:0" } },
        { metadata: { reviewUnit: "k:0" } },
      ],
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce("replayed");
    await expect(save(create)).resolves.toBe("replayed");
    expect(create).toHaveBeenLastCalledWith(["k:0", "k:0"]);
  });

  it("gives up when the repeat conflicts too, so other differences still fail", async () => {
    savedProposal.mockResolvedValue({
      suggestions: [{ metadata: { reviewUnit: "k:0" } }],
    });
    const create = vi.fn().mockRejectedValue(conflict);
    await expect(save(create)).rejects.toBe(conflict);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("leaves any other failure, or a conflict with no receipt, alone", async () => {
    const other = new Error("database down");
    const create = vi.fn().mockRejectedValue(other);
    await expect(save(create)).rejects.toBe(other);
    expect(savedProposal).not.toHaveBeenCalled();

    savedProposal.mockResolvedValue(null);
    await expect(save(vi.fn().mockRejectedValue(conflict))).rejects.toBe(
      conflict,
    );
  });
});

describe("modelUnits", () => {
  beforeEach(() => {
    decide.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("splits a sentence and joins sentences on a confident answer", async () => {
    decide.mockResolvedValueOnce(answered(predicate("pair_0", 0.05)));
    await expect(
      modelUnits({ ownerEmail, operations: typos }),
    ).resolves.toEqual([0, 1]);
    decide.mockResolvedValueOnce(answered(predicate("pair_0", 0.9)));
    await expect(
      modelUnits({ ownerEmail, operations: rename }),
    ).resolves.toEqual([0, 0]);
  });

  it("asks once per edit, for the owner, within the time budget", async () => {
    decide.mockResolvedValueOnce(answered(predicate("pair_0", 0.5)));
    await modelUnits({ ownerEmail, operations: typos });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]?.[0]).toMatchObject({
      ownerEmail,
      options: { timeoutMs: 4000 },
      questions: [{ type: "predicate", name: "pair_0" }],
    });
  });

  it.each([
    ["no model", { status: "not_configured" }],
    ["a late answer", { status: "failed", reason: "timeout" }],
    ["a refusal", answered({ pair_0: { type: "refusal" } })],
    ["a missing answer", answered({})],
  ])("gives sentence units on %s", async (_name, result) => {
    decide.mockResolvedValue(result);
    await expect(
      modelUnits({ ownerEmail, operations: typos }),
    ).resolves.toEqual(sentenceUnits(typos));
    await expect(
      modelUnits({ ownerEmail, operations: rename }),
    ).resolves.toEqual(sentenceUnits(rename));
  });

  it("gives sentence units when the model call throws", async () => {
    decide.mockRejectedValue(new Error("network"));
    await expect(
      modelUnits({ ownerEmail, operations: rename }),
    ).resolves.toEqual([0, 1]);
  });

  it("skips the model with no owner, or nothing for it to decide", async () => {
    await expect(
      modelUnits({ ownerEmail: null, operations: rename }),
    ).resolves.toEqual([0, 1]);
    await expect(modelUnits({ ownerEmail, operations: [] })).resolves.toEqual(
      [],
    );
    const before = "Open source and Open source again.";
    const edits = [
      { find: "Open source and", replace: "Open-source and", start: 0 },
      {
        find: "Open source again",
        replace: "Open-source again",
        start: before.indexOf("Open source again"),
      },
    ];
    await expect(
      modelUnits({
        ownerEmail,
        ...findReplaceEditPieces({ before, edits }),
      }),
    ).resolves.toEqual([0, 1]);
    expect(decide).not.toHaveBeenCalled();
  });
});
