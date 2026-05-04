import { describe, it, expect } from "vitest";
import { defineAction } from "./action.js";

// Uses the legacy `parameters` mode so we don't need to pull in zod as a test
// dep — the readOnly inference logic is independent of the schema path.
describe("defineAction — readOnly inference", () => {
  it("infers readOnly=true for GET actions", () => {
    const action = defineAction({
      description: "read things",
      parameters: { id: { type: "string" } },
      http: { method: "GET" },
      run: async () => ({ ok: true }),
    });
    expect(action.readOnly).toBe(true);
  });

  it("leaves readOnly undefined for default POST actions", () => {
    const action = defineAction({
      description: "write things",
      parameters: { value: { type: "string" } },
      run: async () => ({ ok: true }),
    });
    expect(action.readOnly).toBeUndefined();
  });

  it("leaves readOnly undefined when http is false (agent-only)", () => {
    const action = defineAction({
      description: "agent-only",
      parameters: { x: { type: "string" } },
      http: false,
      run: async () => "ok",
    });
    expect(action.readOnly).toBeUndefined();
  });

  it("leaves readOnly undefined for explicit POST", () => {
    const action = defineAction({
      description: "post",
      parameters: { x: { type: "string" } },
      http: { method: "POST" },
      run: async () => "ok",
    });
    expect(action.readOnly).toBeUndefined();
  });

  it("honors explicit readOnly=true even on POST", () => {
    const action = defineAction({
      description: "read-only post",
      parameters: { x: { type: "string" } },
      http: { method: "POST" },
      readOnly: true,
      run: async () => "ok",
    });
    expect(action.readOnly).toBe(true);
  });

  it("honors explicit readOnly=false even on GET (overrides method inference)", () => {
    const action = defineAction({
      description: "mutating get",
      parameters: { x: { type: "string" } },
      http: { method: "GET" },
      readOnly: false,
      run: async () => "ok",
    });
    // Stored as explicit false so the HTTP router / agent dispatcher emit a
    // refresh event even though the method is GET.
    expect(action.readOnly).toBe(false);
  });

  it("preserves explicit parallelSafe metadata", () => {
    const action = defineAction({
      description: "safe same-turn write",
      parameters: { x: { type: "string" } },
      parallelSafe: true,
      run: async () => "ok",
    });
    expect(action.parallelSafe).toBe(true);
  });
});
