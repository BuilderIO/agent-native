import { describe, expect, it } from "vitest";
import {
  loadActionsFromStaticRegistry,
  mergeCoreSharingActions,
} from "./action-discovery.js";

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

  it("preserves publicAgent metadata from static defineAction entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "public-search": {
        default: {
          tool: { description: "Public search", parameters: {} },
          publicAgent: {
            expose: true,
            readOnly: true,
            requiresAuth: false,
            isConsequential: false,
          },
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["public-search"].publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: false,
      isConsequential: false,
    });
  });

  it("preserves MCP Apps metadata from static defineAction entries", () => {
    const mcpApp = {
      resource: {
        title: "Preview",
        html: "<!doctype html><p>Preview</p>",
        csp: { connectDomains: ["https://example.com"] },
      },
      visibility: ["model", "app"],
    };
    const registry = loadActionsFromStaticRegistry({
      "preview-thing": {
        default: {
          tool: { description: "Preview thing", parameters: {} },
          mcpApp,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["preview-thing"].mcpApp).toBe(mcpApp);
  });

  it("preserves toolCallable:false on merged core sharing actions (audit-H5)", async () => {
    // Regression guard: mergeCoreSharingActions must carry the security-relevant
    // toolCallable:false flag from the action defs into the registry, otherwise
    // the tools-iframe bridge 403 in action-routes.ts never fires and a
    // sandboxed extension could change resource visibility / revoke shares.
    const registry: Record<string, any> = {};
    await mergeCoreSharingActions(registry);

    for (const name of [
      "share-resource",
      "unshare-resource",
      "set-resource-visibility",
    ]) {
      expect(registry[name], `${name} should be merged`).toBeDefined();
      expect(
        registry[name].toolCallable,
        `${name} must keep toolCallable:false`,
      ).toBe(false);
    }
  });
});
