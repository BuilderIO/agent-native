import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../../agent/production-agent.js";
import { registerActionAccessChecker } from "../../authorization/action-access-runtime.js";
import { hashEmail } from "../../mcp-client/remote-store.js";
import { runWithRequestContext } from "../request-context.js";
import {
  type AppAdditionalActionsConfig,
  normalizeAdditionalActionSurfaces,
  resolveAppAdditionalActions,
} from "./additional-actions.js";

function entry(
  description: string,
  overrides: Partial<ActionEntry> = {},
): ActionEntry {
  return {
    tool: {
      description,
      parameters: { type: "object", properties: {} },
    },
    run: async () => description,
    ...overrides,
  };
}

function config(
  overrides: Partial<AppAdditionalActionsConfig> = {},
): AppAdditionalActionsConfig {
  return {
    resolver: undefined,
    externalSurfaces: [],
    isReservedName: () => false,
    ...overrides,
  };
}

const alice = {
  surface: "chat" as const,
  ownerEmail: "alice@example.com",
  orgId: "acme",
};

function asAlice<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { userEmail: "alice@example.com", orgId: "acme" },
    fn,
  );
}

describe("resolveAppAdditionalActions", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns nothing without a resolver or a signed-in caller", async () => {
    const resolver = vi.fn(() => ({ extra: entry("extra") }));

    await expect(
      resolveAppAdditionalActions(config(), alice, {}),
    ).resolves.toEqual({});
    await expect(
      resolveAppAdditionalActions(
        config({ resolver }),
        { surface: "chat", ownerEmail: null, orgId: "acme" },
        {},
      ),
    ).resolves.toEqual({});
    expect(resolver).not.toHaveBeenCalled();
  });

  it("passes the surface, caller, and event to the app resolver", async () => {
    const event = { path: "/_agent-native/agent-chat" };
    const resolver = vi.fn(async () => ({ extra: entry("extra") }));

    const added = await asAlice(() =>
      resolveAppAdditionalActions(
        config({ resolver }),
        { ...alice, event },
        {},
      ),
    );

    expect(Object.keys(added)).toEqual(["extra"]);
    expect(resolver).toHaveBeenCalledWith({ ...alice, event });
  });

  describe("surfaces", () => {
    it("serves chat only unless the app opts into A2A or ask_app", async () => {
      const resolver = vi.fn(() => ({ extra: entry("extra") }));

      for (const surface of ["a2a", "mcp"] as const) {
        await expect(
          resolveAppAdditionalActions(
            config({ resolver }),
            { ...alice, surface },
            {},
          ),
        ).resolves.toEqual({});
      }
      expect(resolver).not.toHaveBeenCalled();

      const optedIn = await asAlice(() =>
        resolveAppAdditionalActions(
          config({ resolver, externalSurfaces: ["mcp"] }),
          { ...alice, surface: "mcp", orgId: undefined },
          {},
        ),
      );
      expect(Object.keys(optedIn)).toEqual(["extra"]);
      expect(resolver).toHaveBeenCalledWith({
        surface: "mcp",
        event: undefined,
        ownerEmail: "alice@example.com",
        orgId: null,
      });
    });

    it("rejects an unknown opt-in surface instead of ignoring it", () => {
      expect(normalizeAdditionalActionSurfaces(undefined)).toEqual([]);
      expect(normalizeAdditionalActionSurfaces(["a2a", "a2a", "mcp"])).toEqual([
        "a2a",
        "mcp",
      ]);
      expect(() => normalizeAdditionalActionSurfaces(["chat"])).toThrow(
        /expected "a2a" or "mcp"/,
      );
    });
  });

  describe("reserved names", () => {
    it("keeps registered and reserved names, reporting each collision once", async () => {
      const warn = vi.mocked(console.warn);
      const resolver = () => ({
        "collision-registered": entry("app"),
        "collision-hidden-template": entry("app"),
        "collision-new": entry("app"),
      });
      const reserved = config({
        resolver,
        isReservedName: (name) => name === "collision-hidden-template",
      });
      const registered = { "collision-registered": entry("template") };

      const first = await resolveAppAdditionalActions(
        reserved,
        alice,
        registered,
      );
      const second = await resolveAppAdditionalActions(
        reserved,
        alice,
        registered,
      );

      expect(Object.keys(first)).toEqual(["collision-new"]);
      expect(Object.keys(second)).toEqual(["collision-new"]);
      const messages = warn.mock.calls.map(([message]) => message).join("\n");
      expect(warn).toHaveBeenCalledTimes(2);
      expect(messages).toContain('"collision-registered"');
      expect(messages).toContain('"collision-hidden-template"');
    });
  });

  describe("untrusted entries", () => {
    it("drops malformed names and unusable tool definitions", async () => {
      const deep: Record<string, unknown> = { type: "string" };
      let cursor = deep;
      for (let i = 0; i < 30; i += 1) {
        const next: Record<string, unknown> = { type: "object" };
        cursor.items = next;
        cursor = next;
      }
      const resolver = () => ({
        "bad name with spaces": entry("x"),
        [`long-${"x".repeat(70)}`]: entry("x"),
        "untrusted-no-run": { tool: { description: "x" } },
        "untrusted-blank": entry("​ \u0007"),
        "untrusted-array-root": entry("x", {
          tool: {
            description: "x",
            parameters: { type: "array" } as never,
          },
        }),
        "untrusted-huge": entry("x", {
          tool: {
            description: "x",
            parameters: {
              type: "object",
              properties: {
                a: { type: "string", description: "y".repeat(70_000) },
              },
            },
          },
        }),
        "untrusted-deep": entry("x", {
          tool: {
            description: "x",
            parameters: { type: "object", properties: { a: deep as never } },
          },
        }),
        "untrusted-uncompilable": entry("x", {
          tool: {
            description: "x",
            parameters: {
              type: "object",
              properties: { a: { type: "not-a-type" } as never },
            },
          },
        }),
        "untrusted-ok": entry("ok"),
      });

      const added = await resolveAppAdditionalActions(
        config({ resolver: resolver as never }),
        alice,
        {},
      );

      expect(Object.keys(added)).toEqual(["untrusted-ok"]);
    });

    it("cleans hidden characters and caps tool text", async () => {
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "untrusted-text": entry(`Run‮ it​ ${"d".repeat(3_000)}`, {
              tool: {
                title: "\u0000Title",
                description: `Run‮ it​ ${"d".repeat(3_000)}`,
              },
            }),
          }),
        }),
        alice,
        {},
      );

      const tool = added["untrusted-text"]!.tool;
      expect(tool.title).toBe("Title");
      expect(tool.description.startsWith("Run it ddd")).toBe(true);
      expect(tool.description).toHaveLength(2_000);
    });

    it("fails loudly when the resolver returns something other than entries", async () => {
      await expect(
        resolveAppAdditionalActions(
          config({ resolver: (() => [entry("x")]) as never }),
          alice,
          {},
        ),
      ).rejects.toThrow(/must return an object/);
      await expect(
        resolveAppAdditionalActions(
          config({
            resolver: async () => {
              throw new Error("tool registry unreachable");
            },
          }),
          alice,
          {},
        ),
      ).rejects.toThrow("tool registry unreachable");
    });
  });

  describe("caller-scoped visibility", () => {
    it("hides another principal's mcp__ names and keeps the caller's own", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const own = `mcp__user_${hashEmail("alice@example.com")}_tools__echo`;
      const other = `mcp__user_${hashEmail("bob@example.com")}_tools__echo`;
      const otherOrg = "mcp__org_globex_tools__echo";
      try {
        const added = await asAlice(() =>
          resolveAppAdditionalActions(
            config({
              resolver: () => ({
                [own]: entry("own"),
                [other]: entry("other"),
                [otherOrg]: entry("other org"),
              }),
            }),
            alice,
            {},
          ),
        );
        expect(Object.keys(added)).toEqual([own]);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("refuses a call made for a different caller than the entry was resolved for", async () => {
      const run = vi.fn(async () => "ran");
      const added = await resolveAppAdditionalActions(
        config({ resolver: () => ({ "scoped-tool": entry("x", { run }) }) }),
        alice,
        {},
      );
      const scoped = added["scoped-tool"]!;

      await expect(
        runWithRequestContext(
          { userEmail: "bob@example.com", orgId: "acme" },
          () => scoped.run({}),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        runWithRequestContext(
          { userEmail: "alice@example.com", orgId: "globex" },
          () => scoped.run({}),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        scoped.run(
          {},
          { caller: "tool", userEmail: "bob@example.com", orgId: "acme" },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(run).not.toHaveBeenCalled();

      await expect(asAlice(() => scoped.run({}))).resolves.toBe("ran");
      await expect(
        scoped.run(
          {},
          { caller: "tool", userEmail: "ALICE@example.com", orgId: "acme" },
        ),
      ).resolves.toBe("ran");
    });
  });

  describe("framework checks on every call", () => {
    afterEach(async () => {
      // Restore the real checker for any later test in this worker.
      const { assertActionAccess } =
        await import("../../authorization/check-action.js");
      registerActionAccessChecker(assertActionAccess);
    });

    it("validates arguments strictly against the entry's schema", async () => {
      const run = vi.fn(async (args: unknown) => args);
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "strict-tool": entry("x", {
              run,
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  properties: { count: { type: "number" } },
                  required: ["count"],
                },
              },
            }),
          }),
        }),
        alice,
        {},
      );
      const strict = added["strict-tool"]!;

      await expect(asAlice(() => strict.run({ count: "3" }))).rejects.toThrow(
        /Invalid arguments for strict-tool/,
      );
      await expect(asAlice(() => strict.run(undefined))).rejects.toThrow(
        /must have required property 'count'/,
      );
      expect(run).not.toHaveBeenCalled();
      await expect(asAlice(() => strict.run({ count: 3 }))).resolves.toEqual({
        count: 3,
      });
    });

    it("enforces the entry's access policy for the bound caller", async () => {
      const checker = vi.fn(async (_config: unknown, args: any) => {
        if (args.project !== "allowed") {
          throw Object.assign(new Error("denied"), { statusCode: 403 });
        }
        return { allowed: true, reason: "ok" };
      });
      registerActionAccessChecker(checker);
      const run = vi.fn(async () => "ran");
      const access = { scope: "org" as const, permission: "tools.run" };
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "guarded-tool": entry("x", {
              run,
              access,
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  properties: { project: { type: "string" } },
                },
              },
            }),
          }),
        }),
        alice,
        {},
      );
      const guarded = added["guarded-tool"]!;

      await expect(
        asAlice(() => guarded.run({ project: "other" })),
      ).rejects.toThrow("denied");
      expect(run).not.toHaveBeenCalled();
      await expect(
        asAlice(() => guarded.run({ project: "allowed" })),
      ).resolves.toBe("ran");
      expect(checker).toHaveBeenLastCalledWith(
        access,
        { project: "allowed" },
        expect.objectContaining({
          userEmail: "alice@example.com",
          orgId: "acme",
          caller: "tool",
        }),
      );
    });
  });
});
