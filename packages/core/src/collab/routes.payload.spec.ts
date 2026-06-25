/**
 * Unit tests for payload size enforcement in collab route handlers.
 *
 * Verifies that postCollabUpdate, postCollabText, postCollabJson, and
 * postCollabPatch all return 413 when the request body exceeds the configured
 * limit (or the default 2 MB limit).
 */

import { describe, expect, it, vi } from "vitest";

// Stub h3 so we can drive handlers with synthetic events.
vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: (event: any, name: string) => event._params?.[name],
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
  getQuery: (event: any) => event._query ?? {},
}));

const mockReadBody = vi.fn();
vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

vi.mock("./ydoc-manager.js", () => ({
  applyUpdate: vi.fn(),
  applyText: vi.fn().mockResolvedValue(""),
  searchAndReplace: vi.fn().mockResolvedValue({ found: false }),
  applyJson: vi.fn(),
  applyPatchOps: vi.fn(),
  getJson: vi.fn().mockResolvedValue(null),
}));

vi.mock("./storage.js", () => ({
  uint8ArrayToBase64: (v: Uint8Array) => Buffer.from(v).toString("base64"),
  base64ToUint8Array: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
}));

import {
  postCollabUpdate,
  postCollabText,
  postCollabSearchReplace,
} from "./routes.js";
import { postCollabJson, postCollabPatch } from "./struct-routes.js";

function event(params: Record<string, string>, maxPayloadBytes?: number): any {
  return {
    _params: params,
    _status: 200,
    context:
      maxPayloadBytes != null
        ? { _collabMaxPayloadBytes: maxPayloadBytes }
        : {},
  };
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// Generates a string of `len` bytes.
function bigString(len: number): string {
  return "x".repeat(len);
}

describe("postCollabUpdate payload limit", () => {
  it("returns 413 when update body exceeds the limit", async () => {
    const oversized = { update: bigString(DEFAULT_MAX_BYTES + 1) };
    mockReadBody.mockResolvedValue(oversized);
    const ev = event({ docId: "doc-1" });
    const res = await postCollabUpdate(ev);
    expect(ev._status).toBe(413);
    expect(res).toEqual({ error: "Payload too large" });
  });

  it("passes through when body is within the limit", async () => {
    const smallUpdate = Buffer.alloc(4).toString("base64"); // tiny update
    mockReadBody.mockResolvedValue({ update: smallUpdate });
    const ev = event({ docId: "doc-1" });
    const res = await postCollabUpdate(ev);
    expect(ev._status).toBe(200);
  });

  it("respects a custom limit set via event.context", async () => {
    const customLimit = 100;
    const oversized = { update: bigString(customLimit + 1) };
    mockReadBody.mockResolvedValue(oversized);
    const ev = event({ docId: "doc-1" }, customLimit);
    const res = await postCollabUpdate(ev);
    expect(ev._status).toBe(413);
  });
});

describe("postCollabText payload limit", () => {
  it("returns 413 when text body exceeds the limit", async () => {
    const oversized = { text: bigString(DEFAULT_MAX_BYTES + 1) };
    mockReadBody.mockResolvedValue(oversized);
    const ev = event({ docId: "doc-2" });
    const res = await postCollabText(ev);
    expect(ev._status).toBe(413);
    expect(res).toEqual({ error: "Payload too large" });
  });

  it("passes through when text is within the limit", async () => {
    mockReadBody.mockResolvedValue({ text: "hello" });
    const ev = event({ docId: "doc-2" });
    const res = await postCollabText(ev);
    // 200 (handler invokes applyText which is mocked)
    expect(ev._status).toBe(200);
  });
});

describe("postCollabSearchReplace payload limit", () => {
  it("returns 413 when search-replace body exceeds the limit", async () => {
    const oversized = { find: bigString(DEFAULT_MAX_BYTES + 1), replace: "" };
    mockReadBody.mockResolvedValue(oversized);
    const ev = event({ docId: "doc-3" });
    const res = await postCollabSearchReplace(ev);
    expect(ev._status).toBe(413);
  });
});

describe("postCollabJson payload limit", () => {
  it("returns 413 when json body exceeds the limit", async () => {
    const oversized = { json: bigString(DEFAULT_MAX_BYTES + 1) };
    mockReadBody.mockResolvedValue(oversized);
    const ev = event({ docId: "doc-4" });
    const res = await postCollabJson(ev);
    expect(ev._status).toBe(413);
    expect(res).toEqual({ error: "Payload too large" });
  });

  it("passes through when json body is within the limit", async () => {
    mockReadBody.mockResolvedValue({ json: { key: "value" } });
    const ev = event({ docId: "doc-4" });
    const res = await postCollabJson(ev);
    expect(ev._status).toBe(200);
  });
});

describe("postCollabPatch payload limit", () => {
  it("returns 413 when patch ops body exceeds the limit", async () => {
    const oversized = { ops: bigString(DEFAULT_MAX_BYTES + 1) };
    mockReadBody.mockResolvedValue(oversized);
    const ev = event({ docId: "doc-5" });
    const res = await postCollabPatch(ev);
    expect(ev._status).toBe(413);
    expect(res).toEqual({ error: "Payload too large" });
  });

  it("passes through valid ops array within the limit", async () => {
    mockReadBody.mockResolvedValue({
      ops: [{ op: "set", path: "/a", value: 1 }],
    });
    const ev = event({ docId: "doc-5" });
    const res = await postCollabPatch(ev);
    expect(ev._status).toBe(200);
  });
});
