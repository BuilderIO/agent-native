import { describe, expect, it } from "vitest";

import { WORKFLOW_STORE_LIMITS } from "../adapter.js";
import { jsonByteLength } from "../items.js";
import { boundReceiptOutput } from "./receipt-output.js";

const LIMIT = WORKFLOW_STORE_LIMITS.receiptOutputBytes;

describe("the response a receipt keeps", () => {
  it("keeps what identifies the thing and nothing that says what it was about", () => {
    const response = {
      ok: true,
      channel: "C1",
      ts: "1760000000.000100",
      message: { user: "U1", text: "the customer's words" },
      text: "a short message that would have fit",
      title: "A bug in checkout",
      name: "Ada Lovelace",
      email: "ada@example.test",
      body: "the whole report",
    };

    expect(boundReceiptOutput(response)).toEqual({
      output: { ok: true, channel: "C1", ts: "1760000000.000100" },
      truncated: true,
    });
  });

  it("keeps every name that identifies a thing, and the names that end the way identifiers do", () => {
    const response = {
      id: "r1",
      ids: ["a", "b"],
      ts: "1.1",
      thread_ts: "1.0",
      threadTs: "1.0",
      channel: "C1",
      number: 7,
      sha: "abc123",
      ref: "main",
      url: "https://example.test/r1",
      permalink: "https://example.test/p",
      html_url: "https://example.test/h",
      key: "ENG-1",
      status: "open",
      ok: true,
      channelId: "C1",
      user_id: "U1",
      pull_number: 9,
      next_ts: "2.2",
      self_url: "https://example.test/s",
    };

    expect(boundReceiptOutput(response)).toEqual({
      output: response,
      truncated: false,
    });
  });

  it("does not take a name for an identifier because it merely contains one", () => {
    expect(
      boundReceiptOutput({
        idea: "x",
        identity: "y",
        paid: true,
        tsunami: 1,
        subject: "z",
        reply_text: "w",
      }),
    ).toEqual({ output: {}, truncated: true });
  });

  it("keeps a named field only as a primitive or a list of them", () => {
    expect(
      boundReceiptOutput({
        id: { nested: "no" },
        key: "kept",
        ids: ["a", 1, { id: "b" }, "d"],
        status: null,
        ok: false,
      }),
    ).toEqual({
      output: { key: "kept", ids: ["a", 1], status: null, ok: false },
      truncated: true,
    });
  });

  it("drops a named field that is a long text, which is a body and not an identifier", () => {
    expect(
      boundReceiptOutput({
        channel: "C1",
        url: `https://x.test/${"a".repeat(300)}`,
      }),
    ).toEqual({ output: { channel: "C1" }, truncated: true });
  });

  it("keeps nothing for no response, which is not the same as an empty one", () => {
    expect(boundReceiptOutput(undefined)).toBeUndefined();
    expect(boundReceiptOutput(null)).toBeUndefined();
    expect(boundReceiptOutput({})).toEqual({ output: {}, truncated: false });
  });

  it("has no named field to keep in a response that is not an object", () => {
    expect(boundReceiptOutput(42)).toEqual({ output: {}, truncated: true });
    expect(boundReceiptOutput(["a", 1])).toEqual({
      output: {},
      truncated: true,
    });
    expect(boundReceiptOutput("x")).toEqual({ output: {}, truncated: true });
  });

  it("leaves out a number that has no JSON form instead of turning it into null", () => {
    expect(boundReceiptOutput({ id: "r", number: Number.NaN })).toEqual({
      output: { id: "r" },
      truncated: true,
    });
  });

  it("does not call a response cut when it left out nothing that was in it", () => {
    expect(boundReceiptOutput({ id: "r", missing: undefined })).toEqual({
      output: { id: "r" },
      truncated: false,
    });
  });

  it("keeps the smaller identifiers when the rest does not fit, whole fields only, smallest first", () => {
    const kept = boundReceiptOutput({
      ids: Array.from({ length: 400 }, (_, index) => `id-${index}`),
      channel: "C1",
      ts: "1760000000.000100",
      key: "ENG-1",
    });

    expect(kept?.truncated).toBe(true);
    expect(kept?.output).toMatchObject({
      channel: "C1",
      ts: "1760000000.000100",
      key: "ENG-1",
    });
    expect(kept?.output).not.toHaveProperty("ids");
    expect(jsonByteLength(kept?.output)).toBeLessThanOrEqual(LIMIT);
  });

  it("keeps fields in the order the response had them", () => {
    const kept = boundReceiptOutput({
      status: "last-by-name",
      ids: Array.from({ length: 1000 }, (_, index) => index),
      id: "first-by-name",
      ok: true,
    });

    expect(Object.keys(kept?.output ?? {})).toEqual(["status", "id", "ok"]);
  });

  it("fits exactly the limit and never one byte over, whatever the response", () => {
    for (const size of [LIMIT - 20, LIMIT - 1, LIMIT, LIMIT + 1, LIMIT * 4]) {
      const response = {
        key: "x".repeat(200),
        ids: Array.from({ length: Math.ceil(size / 6) }, () => 1),
        ref: "y".repeat(100),
      };

      const kept = boundReceiptOutput(response);

      expect(jsonByteLength(kept?.output)).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("counts bytes, not characters, so text in another script cannot slip over the limit", () => {
    const response = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `k${index}_id`,
        "é".repeat(100),
      ]),
    );

    const kept = boundReceiptOutput(response);

    expect(jsonByteLength(kept?.output)).toBeLessThanOrEqual(LIMIT);
    expect(kept?.truncated).toBe(true);
  });

  it("keeps a key that is named like an object's own members as a plain field", () => {
    const parsed = JSON.parse('{"__proto__": {"x": 1}, "id": "r"}');

    const kept = boundReceiptOutput(parsed);

    expect(Object.keys(kept?.output ?? {})).toEqual(["id"]);
    expect(kept?.truncated).toBe(true);
    expect(Object.getPrototypeOf(kept?.output)).toBe(Object.prototype);
  });
});
