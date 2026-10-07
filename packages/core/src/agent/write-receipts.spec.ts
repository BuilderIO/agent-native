import { describe, expect, it } from "vitest";

import {
  mergeFinalResponseGuards,
  readWriteReceipt,
  writeReceiptGuard,
  type ToolWriteReceipt,
} from "./write-receipts.js";

const receipt = (
  overrides: Partial<ToolWriteReceipt> = {},
): ToolWriteReceipt => ({
  tool: "write-thing",
  changed: true,
  verified: true,
  summary: "Saved the thing.",
  ...overrides,
});

describe("readWriteReceipt", () => {
  it("returns undefined when the result carries no _receipt", () => {
    expect(readWriteReceipt({ saved: true })).toBeUndefined();
    expect(readWriteReceipt("plain text")).toBeUndefined();
    expect(readWriteReceipt(null)).toBeUndefined();
    expect(readWriteReceipt([{ _receipt: {} }])).toBeUndefined();
  });

  it("reads a well-formed receipt and bounds its fields", () => {
    const read = readWriteReceipt({
      _receipt: {
        changed: true,
        verified: false,
        summary: "s".repeat(500),
        checks: Array.from({ length: 12 }, (_, i) => ({
          id: `c${i}`,
          ok: i % 2 === 0,
          detail: "d".repeat(400),
        })),
        warnings: Array.from({ length: 9 }, (_, i) => `w${i}`),
      },
    });
    expect(read?.verified).toBe(false);
    expect(read?.summary).toHaveLength(200);
    expect(read?.checks).toHaveLength(8);
    expect(read?.checks?.[0]?.detail).toHaveLength(160);
    expect(read?.warnings).toHaveLength(5);
  });

  it.each([
    ["not an object", "ok"],
    ["null", null],
    ["missing changed", { verified: true, summary: "x" }],
    [
      "verified outside the contract",
      { changed: true, verified: "yes", summary: "x" },
    ],
    ["missing summary", { changed: true, verified: true }],
    [
      "checks not an array",
      { changed: true, verified: true, summary: "x", checks: "no" },
    ],
    [
      "a check missing ok",
      { changed: true, verified: true, summary: "x", checks: [{ id: "a" }] },
    ],
    [
      "non-string warnings",
      { changed: true, verified: true, summary: "x", warnings: [1] },
    ],
  ])(
    "turns a malformed receipt (%s) into unverified, never clean",
    (_, raw) => {
      expect(readWriteReceipt({ _receipt: raw })).toEqual({
        changed: true,
        verified: "unverified",
        summary: "malformed receipt",
      });
    },
  );
});

describe("writeReceiptGuard", () => {
  it("is silent for clean receipts and for no receipts", () => {
    expect(writeReceiptGuard([], false)).toBeNull();
    expect(writeReceiptGuard([receipt()], false)).toBeNull();
  });

  it("forces one retry for verified:false and for changed:false", () => {
    for (const bad of [
      receipt({ verified: false }),
      receipt({ changed: false }),
    ]) {
      const guard = writeReceiptGuard([bad], false);
      expect(guard?.maxRetries).toBe(1);
      expect(guard?.retryMessage).toContain("<write-receipts>");
      expect(guard?.retryMessage).toContain(
        "Do not say a change is visible or working unless verified=true.",
      );
    }
  });

  it("offers no second retry once one was used, but keeps the prefix", () => {
    const guard = writeReceiptGuard([receipt({ verified: false })], true);
    expect(guard?.maxRetries).toBe(0);
    expect(guard?.exhaustedDraftPrefix).toContain("verified=false");
  });

  it("annotates unverified-only turns without a retry", () => {
    const guard = writeReceiptGuard(
      [receipt({ verified: "unverified", summary: "could not check" })],
      false,
    );
    expect(guard?.maxRetries).toBe(0);
    expect(guard?.exhaustedDraftPrefix).toContain("could not check");
  });

  it("names failed checks and bounds each line", () => {
    const guard = writeReceiptGuard(
      [
        receipt({
          verified: false,
          summary: "s".repeat(200),
          checks: [
            { id: "panel-a", ok: false, detail: "d".repeat(160) },
            { id: "panel-b", ok: true },
          ],
        }),
      ],
      false,
    );
    expect(guard?.retryMessage).toContain("Failed checks: panel-a");
    expect(guard?.retryMessage).not.toContain("panel-b");
    const line = guard!.exhaustedDraftPrefix.split("\n")[1]!;
    expect(line.length).toBeLessThanOrEqual(480);
  });

  it("caps how many receipts one block lists", () => {
    const guard = writeReceiptGuard(
      Array.from({ length: 10 }, (_, i) =>
        receipt({ verified: false, tool: `tool-${i}` }),
      ),
      false,
    );
    expect(guard?.exhaustedDraftPrefix).toContain("(+4 more)");
    expect(guard?.exhaustedDraftPrefix).not.toContain("tool-9");
  });
});

describe("mergeFinalResponseGuards", () => {
  const receiptGuard = writeReceiptGuard(
    [receipt({ verified: false })],
    false,
  )!;

  it("joins both messages and keeps the larger retry budget", () => {
    const merged = mergeFinalResponseGuards(receiptGuard, {
      retryMessage: "Ground the number.",
      maxRetries: 2,
    });
    expect(merged).toMatchObject({ maxRetries: 2 });
    expect((merged as { retryMessage: string }).retryMessage).toContain(
      "<write-receipts>",
    );
    expect((merged as { retryMessage: string }).retryMessage).toContain(
      "Ground the number.",
    );
  });

  it("treats a string guard as one retry with its text as the fallback", () => {
    const merged = mergeFinalResponseGuards(receiptGuard, "Query first.") as {
      maxRetries: number;
      fallbackMessage: string;
      exhaustedDraftPrefix?: string;
    };
    expect(merged.maxRetries).toBe(1);
    expect(merged.exhaustedDraftPrefix).toBeUndefined();
    expect(merged.fallbackMessage).toContain("verified=false");
    expect(merged.fallbackMessage).toContain("Query first.");
  });

  it("stacks the app's draft prefix under the receipt prefix", () => {
    const merged = mergeFinalResponseGuards(receiptGuard, {
      retryMessage: "Ground the number.",
      exhaustedDraftPrefix: "Unverified figures:",
    }) as { exhaustedDraftPrefix: string };
    expect(merged.exhaustedDraftPrefix.startsWith("Write check:")).toBe(true);
    expect(merged.exhaustedDraftPrefix.endsWith("Unverified figures:")).toBe(
      true,
    );
  });
});
