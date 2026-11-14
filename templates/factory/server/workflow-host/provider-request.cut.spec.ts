import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import {
  PROVIDER_OUTPUT_BUDGET_CHARS,
  PROVIDER_PAYLOAD_BUDGET_CHARS,
  boundOutput,
  parseProviderResponse,
} from "./provider-request.js";

/** About what GitHub sends for one pull request: tens of kilobytes of nested data. */
const pull = (number: number, size = 25_000) => ({
  id: number,
  number,
  title: `Pull request ${number}`,
  body: `${number}`.repeat(size),
  user: { login: "octocat" },
});

const github = OPERATION_CATALOG.get("github.apiRequest");
if (!github) throw new Error("github.apiRequest is not in the catalog");

type Cut = Record<string, unknown>;
interface CutList {
  truncated: boolean;
  count: number;
  totalAvailable: number;
  cuts: Cut[];
  cutsOmitted?: number;
  value: Record<string, unknown>[];
}

describe("a list the budget cuts", () => {
  const body = [pull(1), pull(2), pull(3)];
  const bounded = boundOutput(body, PROVIDER_PAYLOAD_BUDGET_CHARS);
  const output = bounded.output as CutList;

  it("says it was cut", () => {
    expect(bounded.truncated).toBe(true);
    expect(output.truncated).toBe(true);
  });

  it("keeps whole entries only, never one cut short that would pass for a whole one", () => {
    expect(output.value.length).toBeGreaterThan(0);
    expect(output.value.length).toBeLessThan(body.length);
    output.value.forEach((kept, index) => expect(kept).toEqual(body[index]));
  });

  it("says how many it kept of how many the provider sent", () => {
    expect(output.count).toBe(output.value.length);
    expect(output.totalAvailable).toBe(3);
    expect(output.cuts).toEqual([
      { path: "value", kept: output.value.length, of: 3 },
    ]);
  });

  it("puts the report before the data, so a clipped summary still shows it", () => {
    expect(Object.keys(output).slice(0, 4)).toEqual([
      "truncated",
      "count",
      "totalAvailable",
      "cuts",
    ]);
    const clipped = JSON.stringify(output).slice(0, 200);
    expect(clipped).toContain('"truncated":true');
    expect(clipped).toContain('"totalAvailable":3');
  });

  it("stays inside the budget", () => {
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      PROVIDER_PAYLOAD_BUDGET_CHARS,
    );
  });

  it("leaves a list that fits as the list itself, with no wrapper", () => {
    const whole = boundOutput([pull(1, 100), pull(2, 100)]);
    expect(whole.truncated).toBe(false);
    expect(Array.isArray(whole.output)).toBe(true);
  });
});

describe("an object the budget cuts", () => {
  it("names the list it shortened", () => {
    const body = {
      object: "list",
      data: Array.from({ length: 6 }, (_, index) => pull(index + 1)),
      has_more: true,
    };
    const output = boundOutput(body).output as Record<string, any>;

    expect(output.truncated).toBe(true);
    expect(output.data.length).toBeLessThan(6);
    expect(output.cuts).toEqual([
      { path: "data", kept: output.data.length, of: 6 },
    ]);
    expect(Object.keys(output)[0]).toBe("truncated");
  });

  it("names the keys it had no room for, which are then absent, not null", () => {
    const output = boundOutput({
      text: "t".repeat(60_000),
      has_more: true,
      next_cursor: "abc",
    }).output as Record<string, any>;

    expect(output.truncated).toBe(true);
    expect(output.cuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "",
          droppedKeys: ["has_more", "next_cursor"],
          droppedCount: 2,
        }),
      ]),
    );
    expect(output).not.toHaveProperty("has_more");
    expect(output).not.toHaveProperty("next_cursor");
  });

  it("names a long text that was clipped, and where", () => {
    const output = boundOutput({
      id: "call-1",
      transcript: { text: "word ".repeat(30_000) },
    }).output as Record<string, any>;
    expect(output.truncated).toBe(true);
    expect(output.cuts).toEqual([
      expect.objectContaining({
        path: "transcript.text",
        keptChars: expect.any(Number),
        ofChars: 150_000,
      }),
    ]);
  });

  it("still cuts one oversized first entry down instead of dropping it, and says where", () => {
    const output = boundOutput({
      callTranscripts: [
        {
          callId: "c1",
          transcript: Array.from({ length: 3_000 }, (_, index) => ({
            text: `sentence ${index} ${"w".repeat(30)}`,
          })),
        },
      ],
    }).output as Record<string, any>;
    expect(output.callTranscripts[0].callId).toBe("c1");
    expect(output.cuts).toEqual([
      expect.objectContaining({
        path: "callTranscripts[0].transcript",
        of: 3_000,
      }),
    ]);
  });

  it("wraps a body that already uses the report's names, and keeps it whole inside", () => {
    const output = boundOutput({
      cuts: "the provider's own",
      pad: "p".repeat(50_000),
    }).output as { value: { cuts: string }; truncated: boolean };
    expect(output.truncated).toBe(true);
    expect(output.value.cuts).toBe("the provider's own");
  });
});

describe("the cut report", () => {
  it("is bounded: many cuts name the shallowest few and count the rest", () => {
    // Ten levels deep, each with a small key after the one that eats the room.
    let body: unknown = { text: "t".repeat(90_000) };
    for (let level = 0; level < 10; level += 1) {
      body = { child: body, tail: `tail ${level}` };
    }
    const output = boundOutput(body).output as Record<string, any>;

    expect(output.truncated).toBe(true);
    expect(output.cuts).toHaveLength(6);
    expect(output.cutsOmitted).toBeGreaterThan(0);
    for (const cut of output.cuts as { path: string }[]) {
      expect(cut.path.length).toBeLessThanOrEqual(60);
    }
    // The cuts nearest the root come first, so a deep one is what gets left out.
    const depth = (path: string) => (path.match(/[.[]/g) ?? []).length;
    const depths = (output.cuts as { path: string }[]).map((cut) =>
      depth(cut.path),
    );
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      PROVIDER_PAYLOAD_BUDGET_CHARS,
    );
  });

  it("holds even when every entry names long keys", () => {
    const longKey = "k".repeat(200);
    const body = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `${longKey}${index}`,
        "v".repeat(5_000),
      ]),
    );
    const output = boundOutput(body).output;
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      PROVIDER_PAYLOAD_BUDGET_CHARS,
    );
  });
});

describe("a status answer the budget cuts", () => {
  it("carries the report first, and the body's own cut beside it", () => {
    const parsed = parseProviderResponse(github, [pull(1), pull(2), pull(3)], {
      includeStatus: {
        status: 200,
        headers: { "x-ratelimit-remaining": "59" },
      },
    });
    const output = parsed.output as Record<string, any>;
    expect(parsed.truncated).toBe(true);
    expect(Object.keys(output).slice(0, 2)).toEqual(["truncated", "cuts"]);
    expect(output.cuts).toEqual([
      expect.objectContaining({ path: "body", of: 3 }),
    ]);
    expect(output.status).toBe(200);
    expect(output.body.length).toBeLessThan(3);
    output.body.forEach((kept: unknown, index: number) =>
      expect(kept).toEqual([pull(1), pull(2), pull(3)][index]),
    );
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      PROVIDER_OUTPUT_BUDGET_CHARS,
    );
  });
});
