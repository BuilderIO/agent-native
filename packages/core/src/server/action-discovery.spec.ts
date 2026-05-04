import { describe, expect, it } from "vitest";
import { loadActionsFromStaticRegistry } from "./action-discovery.js";

describe("action discovery", () => {
  it("preserves explicit readOnly false from static defineAction entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "mutating-read": {
        default: {
          tool: { description: "Mutating read", parameters: {} },
          http: { method: "GET" },
          readOnly: false,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["mutating-read"].readOnly).toBe(false);
  });

  it("preserves explicit readOnly false from named action entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "named-mutating-read": {
        tool: { description: "Named mutating read", parameters: {} },
        http: { method: "GET" },
        readOnly: false,
        run: async () => ({ ok: true }),
      },
    });

    expect(registry["named-mutating-read"].readOnly).toBe(false);
  });

  it("preserves explicit parallelSafe metadata", () => {
    const registry = loadActionsFromStaticRegistry({
      "safe-write": {
        default: {
          tool: { description: "Safe write", parameters: {} },
          parallelSafe: true,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["safe-write"].parallelSafe).toBe(true);
  });
});
