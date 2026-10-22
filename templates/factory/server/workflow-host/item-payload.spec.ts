import { describe, expect, it } from "vitest";

import { WorkflowStoreError } from "../workflow/adapter.js";
import { WorkflowError } from "../workflow/contract.js";
import {
  MAX_ITEM_PAYLOAD_BYTES,
  serializeItemPayload,
  serializeTextRef,
} from "./item-payload.js";

describe("serializeItemPayload", () => {
  it("defaults to an empty object", () => {
    expect(serializeItemPayload(undefined)).toBe("{}");
  });

  it("keeps a payload that fits, exactly at the cap", () => {
    const overhead = JSON.stringify({ note: "" }).length;
    const payload = { note: "n".repeat(MAX_ITEM_PAYLOAD_BYTES - overhead) };
    expect(serializeItemPayload(payload)).toBe(JSON.stringify(payload));
  });

  it("rejects a payload one byte over the cap instead of cutting it", () => {
    const overhead = JSON.stringify({ note: "" }).length;
    const payload = { note: "n".repeat(MAX_ITEM_PAYLOAD_BYTES - overhead + 1) };
    expect(() => serializeItemPayload(payload)).toThrow(WorkflowError);
    try {
      serializeItemPayload(payload);
    } catch (error) {
      expect((error as WorkflowError).code).toBe("output_over_cap");
    }
  });

  it("counts bytes, not characters", () => {
    const payload = { note: "é".repeat(MAX_ITEM_PAYLOAD_BYTES / 2) };
    expect(() => serializeItemPayload(payload)).toThrow(WorkflowError);
  });

  it("rejects what is not an object or has no JSON form", () => {
    expect(() =>
      serializeItemPayload([1] as unknown as Record<string, unknown>),
    ).toThrow(WorkflowStoreError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeItemPayload(circular)).toThrow(WorkflowStoreError);
  });
});

describe("serializeTextRef", () => {
  it("accepts a blob handle", () => {
    expect(serializeTextRef("blob://factory/org-1/call-1.txt")).toBe(
      "blob://factory/org-1/call-1.txt",
    );
  });

  it("refuses an empty, over-long, or data: reference", () => {
    expect(() => serializeTextRef("")).toThrow(WorkflowStoreError);
    expect(() => serializeTextRef("x".repeat(501))).toThrow(WorkflowStoreError);
    expect(() => serializeTextRef("data:text/plain;base64,QUJD")).toThrow(
      WorkflowStoreError,
    );
  });
});
