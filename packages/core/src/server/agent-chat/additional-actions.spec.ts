import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../../agent/production-agent.js";
import { resolveAppAdditionalActions } from "./additional-actions.js";

function entry(description: string): ActionEntry {
  return {
    tool: {
      description,
      parameters: { type: "object", properties: {} },
    },
    run: async () => description,
  };
}

describe("resolveAppAdditionalActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns nothing without a resolver or a signed-in caller", async () => {
    const resolver = vi.fn(() => ({ extra: entry("extra") }));

    await expect(
      resolveAppAdditionalActions(
        undefined,
        { surface: "chat", ownerEmail: "alice@example.com", orgId: null },
        {},
      ),
    ).resolves.toEqual({});
    await expect(
      resolveAppAdditionalActions(
        resolver,
        { surface: "a2a", ownerEmail: null, orgId: "acme" },
        {},
      ),
    ).resolves.toEqual({});
    expect(resolver).not.toHaveBeenCalled();
  });

  it("passes the surface, caller, and event to the app resolver", async () => {
    const event = { path: "/_agent-native/agent-chat" };
    const resolver = vi.fn(async () => ({ extra: entry("extra") }));

    const added = await resolveAppAdditionalActions(
      resolver,
      {
        surface: "chat",
        event,
        ownerEmail: "alice@example.com",
        orgId: "acme",
      },
      {},
    );

    expect(Object.keys(added)).toEqual(["extra"]);
    expect(resolver).toHaveBeenCalledWith({
      surface: "chat",
      event,
      ownerEmail: "alice@example.com",
      orgId: "acme",
    });
  });

  it("normalizes a missing org to null for ask_app runs", async () => {
    const resolver = vi.fn(() => ({}));

    await resolveAppAdditionalActions(
      resolver,
      { surface: "mcp", ownerEmail: "alice@example.com", orgId: undefined },
      {},
    );

    expect(resolver).toHaveBeenCalledWith({
      surface: "mcp",
      event: undefined,
      ownerEmail: "alice@example.com",
      orgId: null,
    });
  });

  it("keeps registered actions and reports each collision once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registered = {
      "collision-template-action": entry("template"),
      mcp__collision_server__tool: entry("mcp"),
    };
    const resolver = () => ({
      "collision-template-action": entry("app"),
      mcp__collision_server__tool: entry("app"),
      "collision-new-action": entry("app"),
    });
    const details = {
      surface: "chat" as const,
      ownerEmail: "alice@example.com",
      orgId: null,
    };

    const first = await resolveAppAdditionalActions(
      resolver,
      details,
      registered,
    );
    const second = await resolveAppAdditionalActions(
      resolver,
      details,
      registered,
    );

    expect(Object.keys(first)).toEqual(["collision-new-action"]);
    expect(Object.keys(second)).toEqual(["collision-new-action"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([message]) => message).join("\n")).toContain(
      '"collision-template-action"',
    );
  });

  it("surfaces a failing app resolver instead of dropping its tools", async () => {
    await expect(
      resolveAppAdditionalActions(
        async () => {
          throw new Error("tool registry unreachable");
        },
        { surface: "chat", ownerEmail: "alice@example.com", orgId: null },
        {},
      ),
    ).rejects.toThrow("tool registry unreachable");
  });
});
