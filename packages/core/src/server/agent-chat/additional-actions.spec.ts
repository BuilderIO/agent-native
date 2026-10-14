import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEngine, EngineEvent } from "../../agent/engine/types.js";
import {
  type ActionEntry,
  runAgentLoop,
} from "../../agent/production-agent.js";
import { filterActionsForAgentDiscovery } from "../../agent/tool-search.js";
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

  it("never asks the app for anonymous callers on any surface", async () => {
    const resolver = vi.fn(() => ({ extra: entry("extra") }));
    const external = config({ resolver, externalSurfaces: ["a2a", "mcp"] });

    for (const surface of ["chat", "a2a", "mcp"] as const) {
      await expect(
        resolveAppAdditionalActions(
          external,
          {
            surface,
            ownerEmail: "anon-123@agent-native.com",
            orgId: null,
          },
          {},
        ),
      ).resolves.toEqual({});
      await expect(
        runWithRequestContext(
          {
            userEmail: "alice@example.com",
            orgId: "acme",
            agentRunAnonymous: true,
          },
          () =>
            resolveAppAdditionalActions(external, { ...alice, surface }, {}),
        ),
      ).resolves.toEqual({});
    }
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

    it("checks each schema against its meta-schema", async () => {
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "zero-multiple": entry("x", {
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  properties: { n: { type: "number", multipleOf: 0 } },
                } as never,
              },
            }),
            "negative-length": entry("x", {
              tool: {
                description: "x",
                parameters: {
                  $schema: "https://json-schema.org/draft/2020-12/schema",
                  type: "object",
                  properties: { s: { type: "string", minLength: -1 } },
                } as never,
              },
            }),
          }),
        }),
        alice,
        {},
      );

      expect(added).toEqual({});
      const warnings = vi
        .mocked(console.warn)
        .mock.calls.map(([message]) => String(message));
      for (const name of ["zero-multiple", "negative-length"]) {
        expect(
          warnings.some(
            (message) =>
              message.includes(`"${name}"`) &&
              message.includes("schema is invalid"),
          ),
          name,
        ).toBe(true);
      }
    });

    it("refuses __proto__ as a name instead of dropping it silently", async () => {
      const added = await resolveAppAdditionalActions(
        config({ resolver: () => ({ ["__proto__"]: entry("x") }) }),
        alice,
        {},
      );

      expect(Object.getPrototypeOf(added)).toBe(Object.prototype);
      expect(Object.keys(added)).toEqual([]);
      expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toMatch(
        /"__proto__".*is not a valid action name/,
      );
    });

    it("refuses schema keywords and shapes outside the allowlist, each for its own reason", async () => {
      const regex = { type: "string", pattern: "^(a+)+$" };
      const cases: Array<[string, unknown, string]> = [
        [
          "schema-pattern",
          { type: "object", properties: { a: regex } },
          'uses "pattern"',
        ],
        [
          "schema-nested-pattern",
          {
            type: "object",
            properties: {
              a: { type: "array", items: { anyOf: [{ pattern: "x" }] } },
            },
          },
          'uses "pattern"',
        ],
        [
          "schema-pattern-properties",
          { type: "object", patternProperties: { "^x": { type: "string" } } },
          'uses "patternProperties"',
        ],
        [
          "schema-unique-items",
          {
            type: "object",
            properties: { xs: { type: "array", uniqueItems: true } },
          },
          'uses "uniqueItems"',
        ],
        [
          "schema-async",
          {
            type: "object",
            $async: true,
            properties: { n: { type: "number" } },
          },
          'uses "$async"',
        ],
        [
          "schema-id",
          { $id: "https://example.com/tool", type: "object" },
          'uses "$id"',
        ],
        [
          // Ajv registers a `$id` under any key it does not know, which
          // rebases the inner `$ref` from the root `y` onto `x.y`.
          "schema-hidden-id",
          {
            type: "object",
            properties: { a: { $ref: "#/x/a" } },
            y: { type: "string" },
            x: {
              $id: "https://example.com/scoped/",
              a: { $ref: "#/y" },
              y: regex,
            },
          },
          'uses "y"',
        ],
        [
          "schema-ref-into-default",
          {
            type: "object",
            properties: { a: { $ref: "#/default" } },
            default: regex,
          },
          'uses "pattern"',
        ],
        [
          "schema-remote-ref",
          {
            type: "object",
            properties: { a: { $ref: "https://example.com/a.json" } },
          },
          "unencoded JSON pointer",
        ],
        [
          "schema-anchor-ref",
          { type: "object", properties: { a: { $ref: "#a" } } },
          "unencoded JSON pointer",
        ],
        [
          "schema-encoded-ref",
          {
            type: "object",
            properties: { a: { $ref: "#/$defs/a%2Fb" } },
            $defs: { "a/b": { type: "string" } },
          },
          "unencoded JSON pointer",
        ],
        [
          "schema-ref-fanout",
          {
            type: "object",
            properties: { a: { $ref: "#/$defs/d0" } },
            $defs: Object.fromEntries(
              Array.from({ length: 20 }, (_, i) => [
                `d${i}`,
                i === 19
                  ? { type: "string" }
                  : {
                      anyOf: [
                        { $ref: `#/$defs/d${i + 1}` },
                        { $ref: `#/$defs/d${i + 1}` },
                      ],
                    },
              ]),
            ),
          },
          "expands to more than",
        ],
        [
          "schema-same-location-cycle",
          { type: "object", allOf: [{ $ref: "#" }] },
          "recursive $ref",
        ],
        [
          "schema-recursive-ref",
          {
            type: "object",
            properties: { tree: { $ref: "#/$defs/node" } },
            $defs: {
              node: {
                type: "object",
                properties: {
                  children: { type: "array", items: { $ref: "#/$defs/node" } },
                },
              },
            },
          },
          "recursive $ref",
        ],
        [
          "schema-inherited-keyword",
          {
            type: "object",
            properties: {
              s: Object.assign(Object.create({ pattern: "^(a+)+$" }), {
                type: "string",
              }),
            },
          },
          "custom prototype",
        ],
        [
          "schema-accessor",
          {
            type: "object",
            properties: {
              s: {
                get type() {
                  return "string";
                },
              },
            },
          },
          "getter or setter",
        ],
        [
          "schema-proto-key",
          JSON.parse(
            '{"type":"object","properties":{"s":{"__proto__":{"pattern":"x"},"type":"string"}}}',
          ),
          "__proto__ key",
        ],
        [
          "schema-sparse",
          { type: "object", anyOf: new Array(200_000) },
          "holes",
        ],
      ];
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            ...Object.fromEntries(
              cases.map(([name, parameters]) => [
                name,
                entry("x", {
                  tool: { description: "x", parameters: parameters as never },
                }),
              ]),
            ),
            "schema-property-names": entry("x", {
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  properties: {
                    pattern: { type: "string" },
                    $id: { type: "string" },
                    b: { $ref: "#/$defs/b" },
                  },
                  $defs: { b: { type: "number" } },
                } as never,
              },
            }),
          }),
        }),
        alice,
        {},
      );

      expect(Object.keys(added)).toEqual(["schema-property-names"]);
      const warnings = vi
        .mocked(console.warn)
        .mock.calls.map(([message]) => String(message));
      for (const [name, , reason] of cases) {
        const warning = warnings.find((message) =>
          message.includes(`"${name}"`),
        );
        expect(warning, name).toContain(reason);
      }
    });

    it("counts required and dependency names toward the expansion limit", async () => {
      // Ajv looks up every listed name in every validated object.
      const names = Array.from({ length: 5_100 }, (_, i) => `n${i}`);
      const resolver = () => ({
        "required-names": entry("x", {
          tool: {
            description: "x",
            parameters: { type: "object", required: names },
          },
        }),
      });
      const dependencyResolver = () => ({
        "dependency-names": entry("x", {
          tool: {
            description: "x",
            parameters: {
              type: "object",
              dependencies: { a: names },
            } as never,
          },
        }),
      });

      for (const [name, r] of [
        ["required-names", resolver],
        ["dependency-names", dependencyResolver],
      ] as const) {
        const added = await resolveAppAdditionalActions(
          config({ resolver: r }),
          alice,
          {},
        );
        expect(added, name).toEqual({});
        expect(
          vi
            .mocked(console.warn)
            .mock.calls.some(
              ([message]) =>
                String(message).includes(`"${name}"`) &&
                String(message).includes("expands to more than"),
            ),
          name,
        ).toBe(true);
      }
    });

    it("accepts dialect-specific array keywords only where they are enforced", async () => {
      const tuple = {
        type: "object" as const,
        properties: {
          xs: {
            type: "array",
            prefixItems: [{ type: "number" }],
            contains: { type: "number" },
            maxContains: 1,
          },
        },
      };
      const run = vi.fn(async () => "ran");
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "draft-07-tuple": entry("x", {
              tool: { description: "x", parameters: tuple as never },
            }),
            "draft-2020-additional-items": entry("x", {
              tool: {
                description: "x",
                parameters: {
                  $schema: "https://json-schema.org/draft/2020-12/schema",
                  type: "object",
                  properties: {
                    xs: {
                      type: "array",
                      prefixItems: [{ type: "number" }],
                      additionalItems: false,
                    },
                  },
                } as never,
              },
            }),
            "draft-2020-tuple": entry("x", {
              run,
              tool: {
                description: "x",
                parameters: {
                  $schema: "https://json-schema.org/draft/2020-12/schema",
                  ...tuple,
                } as never,
              },
            }),
          }),
        }),
        alice,
        {},
      );

      expect(Object.keys(added)).toEqual(["draft-2020-tuple"]);
      const warnings = vi
        .mocked(console.warn)
        .mock.calls.map(([message]) => String(message));
      expect(warnings[0]).toMatch(
        /"draft-07-tuple".*"prefixItems".*would not be enforced/,
      );
      expect(warnings[1]).toMatch(
        /"draft-2020-additional-items".*"additionalItems".*draft 2020-12 does not enforce/,
      );
      const tool = added["draft-2020-tuple"]!;
      await expect(asAlice(() => tool.run({ xs: ["x"] }))).rejects.toThrow(
        /Invalid arguments/,
      );
      await expect(asAlice(() => tool.run({ xs: [1, 2] }))).rejects.toThrow(
        /Invalid arguments/,
      );
      expect(run).not.toHaveBeenCalled();
      await expect(asAlice(() => tool.run({ xs: [1, "a"] }))).resolves.toBe(
        "ran",
      );
    });

    it("reads each tool field once, so a getter cannot swap in an unchecked schema", async () => {
      let reads = 0;
      const tool = {
        description: "x",
        get parameters() {
          reads += 1;
          return reads === 1
            ? undefined
            : {
                type: "object",
                properties: { s: { type: "string", pattern: "^(a+)+$" } },
              };
        },
      };
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "changing-schema": entry("x", { tool: tool as never }),
          }),
        }),
        alice,
        {},
      );

      expect(added["changing-schema"].tool.parameters).toBeUndefined();
      expect(reads).toBe(1);
    });

    it("reuses a validator for an unchanged schema from a bounded cache, one Ajv instance each", async () => {
      const { default: Ajv } = await import("ajv");
      const instances: unknown[] = [];
      const compile = Ajv.prototype.compile;
      vi.spyOn(Ajv.prototype, "compile").mockImplementation(function (
        this: InstanceType<typeof Ajv>,
        ...args: Parameters<typeof compile>
      ) {
        instances.push(this);
        return compile.apply(this, args);
      } as typeof compile);
      const schemaFor = (name: string) => ({
        type: "object" as const,
        properties: { [name]: { type: "string" as const } },
      });
      const resolveSchemas = (names: string[]) =>
        resolveAppAdditionalActions(
          config({
            resolver: () =>
              Object.fromEntries(
                names.map((name) => [
                  name,
                  entry("x", {
                    tool: { description: "x", parameters: schemaFor(name) },
                  }),
                ]),
              ),
          }),
          alice,
          {},
        );

      for (let i = 0; i < 3; i += 1) await resolveSchemas(["cached-tool"]);
      expect(instances).toHaveLength(1);

      // Fill the cache past its entry bound, which evicts the oldest schema.
      for (let batch = 0; batch < 3; batch += 1) {
        await resolveSchemas(
          Array.from({ length: 100 }, (_, i) => `filler-${batch}-${i}`),
        );
      }
      await resolveSchemas(["cached-tool"]);

      expect(instances).toHaveLength(302);
      // Ajv keeps every compiled schema in instance-wide state, so a shared
      // instance would grow with every new schema.
      expect(new Set(instances).size).toBe(302);
      // Per-validator instances skip the meta-schemas, which would cost about
      // 30 ms each to set up; schemas are checked against them elsewhere.
      expect(
        instances.every(
          (instance) =>
            (instance as { opts: { meta?: unknown } }).opts.meta === false,
        ),
      ).toBe(true);
    });

    it("shows the model the checked copy of the schema, not the app's object", async () => {
      const parameters = {
        type: "object" as const,
        properties: { a: { type: "string" as const } },
      };
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "copied-schema": entry("x", {
              tool: { description: "x", parameters },
            }),
          }),
        }),
        alice,
        {},
      );

      expect(added["copied-schema"].tool.parameters).toEqual(parameters);
      expect(added["copied-schema"].tool.parameters).not.toBe(parameters);
    });

    it("bounds the whole registry, not just each schema", async () => {
      const many = Object.fromEntries(
        Array.from({ length: 130 }, (_, i) => [`many-${i}`, entry("x")]),
      );
      const counted = await resolveAppAdditionalActions(
        config({ resolver: () => many }),
        alice,
        {},
      );
      expect(Object.keys(counted)).toHaveLength(128);
      expect(counted["many-128"]).toBeUndefined();
      expect(
        vi
          .mocked(console.warn)
          .mock.calls.filter(([message]) => String(message).includes("many-")),
      ).toHaveLength(1);

      const large = (i: number) =>
        entry("x", {
          tool: {
            description: "x",
            parameters: {
              type: "object",
              properties: {
                [`p${i}`]: { type: "string", description: "y".repeat(60_000) },
              },
            },
          },
        });
      const budgeted = await resolveAppAdditionalActions(
        config({
          resolver: () =>
            Object.fromEntries(
              Array.from({ length: 10 }, (_, i) => [`large-${i}`, large(i)]),
            ),
        }),
        alice,
        {},
      );
      expect(Object.keys(budgeted)).toHaveLength(8);

      // Each schema expands to about 4,300 subschemas through one shared $ref.
      const fanned = entry("x", {
        tool: {
          description: "x",
          parameters: {
            type: "object",
            properties: Object.fromEntries(
              Array.from({ length: 70 }, (_, i) => [
                `p${i}`,
                { $ref: "#/$defs/d" },
              ]),
            ),
            $defs: {
              d: {
                type: "object",
                properties: Object.fromEntries(
                  Array.from({ length: 60 }, (_, i) => [
                    `q${i}`,
                    { type: "string" },
                  ]),
                ),
              },
            },
          },
        },
      });
      const expanded = await resolveAppAdditionalActions(
        config({
          resolver: () =>
            Object.fromEntries(
              Array.from({ length: 5 }, (_, i) => [`fanned-${i}`, fanned]),
            ),
        }),
        alice,
        {},
      );
      expect(Object.keys(expanded)).toHaveLength(4);

      const booleans = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "boolean-branches": entry("x", {
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  anyOf: Array.from({ length: 6_000 }, () => true),
                },
              },
            }),
          }),
        }),
        alice,
        {},
      );
      expect(booleans).toEqual({});

      // Each $ref to a boolean schema counts twice: the $ref and its target.
      const booleanRefs = entry("x", {
        tool: {
          description: "x",
          parameters: {
            type: "object",
            properties: Object.fromEntries(
              Array.from({ length: 2_000 }, (_, i) => [
                `p${i}`,
                { $ref: "#/$defs/t" },
              ]),
            ),
            $defs: { t: true },
          },
        },
      });
      const refBudgeted = await resolveAppAdditionalActions(
        config({
          resolver: () =>
            Object.fromEntries(
              Array.from({ length: 5 }, (_, i) => [
                `bool-ref-${i}`,
                booleanRefs,
              ]),
            ),
        }),
        alice,
        {},
      );
      expect(Object.keys(refBudgeted)).toHaveLength(4);

      // Rejected schemas draw from the same budget as accepted ones.
      const rejectedLate = (i: number) =>
        entry("x", {
          tool: {
            description: "x",
            parameters: {
              type: "object",
              properties: {
                [`p${i}`]: { type: "string", description: "y".repeat(60_000) },
                last: { type: "string", pattern: "x" },
              },
            },
          },
        });
      const drained = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            ...Object.fromEntries(
              Array.from({ length: 9 }, (_, i) => [
                `rejected-${i}`,
                rejectedLate(i),
              ]),
            ),
            "after-rejected": entry("x"),
          }),
        }),
        alice,
        {},
      );
      expect(drained).toEqual({});
    });

    it("keeps a bounded record of reported skips", async () => {
      const warn = vi.mocked(console.warn);
      const resolve = (names: string[]) =>
        resolveAppAdditionalActions(
          config({
            resolver: () =>
              Object.fromEntries(names.map((name) => [name, null])),
          }),
          alice,
          {},
        );
      const first = "evicted skip";
      await resolve([first]);
      for (let batch = 0; batch < 8; batch += 1) {
        await resolve(
          Array.from({ length: 128 }, (_, i) => `skip ${batch} ${i}`),
        );
      }
      warn.mockClear();
      await resolve([first]);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("compiles a freshly built schema on every request", async () => {
      const resolver = () => ({
        "fresh-schema": entry("x", {
          tool: {
            description: "x",
            parameters: {
              type: "object",
              properties: { a: { $ref: "#/$defs/a" } },
              $defs: { a: { type: "string" } },
            },
          },
        }),
      });

      for (let i = 0; i < 3; i += 1) {
        const added = await resolveAppAdditionalActions(
          config({ resolver }),
          alice,
          {},
        );
        expect(Object.keys(added)).toEqual(["fresh-schema"]);
      }
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

    it("reports only the first validation errors", async () => {
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "closed-tool": entry("x", {
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  properties: {},
                  additionalProperties: false,
                } as never,
              },
            }),
          }),
        }),
        alice,
        {},
      );
      const input = Object.fromEntries(
        Array.from({ length: 500 }, (_, i) => [`k${i}`, i]),
      );

      const error = await asAlice(() => added["closed-tool"]!.run(input)).catch(
        (caught: unknown) => caught as Error,
      );

      expect(error.message).toContain("and 490 more");
      expect(error.message.length).toBeLessThan(2_000);
    });

    it("charges long strings for every length check a schema runs on them", async () => {
      const run = vi.fn(async () => "ran");
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "many-length-checks": entry("x", {
              run,
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  properties: {
                    s: {
                      allOf: Array.from({ length: 1_000 }, () => ({
                        minLength: 1,
                      })),
                    },
                  },
                } as never,
              },
            }),
          }),
        }),
        alice,
        {},
      );
      const tool = added["many-length-checks"]!;

      // Each of the 1,000 checks scans the whole string.
      await expect(
        asAlice(() => tool.run({ s: "x".repeat(600_000) })),
      ).rejects.toThrow(/too large to validate/);
      expect(run).not.toHaveBeenCalled();
      await expect(
        asAlice(() => tool.run({ s: "x".repeat(1_000) })),
      ).resolves.toBe("ran");
    });

    it("charges object keys, which propertyNames checks like strings", async () => {
      const run = vi.fn(async () => "ran");
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "key-length-checks": entry("x", {
              run,
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  propertyNames: {
                    allOf: Array.from({ length: 1_000 }, () => ({
                      minLength: 1,
                    })),
                  },
                } as never,
              },
            }),
          }),
        }),
        alice,
        {},
      );
      const tool = added["key-length-checks"]!;

      await expect(
        asAlice(() => tool.run({ ["k".repeat(600_000)]: 1 })),
      ).rejects.toThrow(/too large to validate/);
      expect(run).not.toHaveBeenCalled();
      await expect(asAlice(() => tool.run({ short: 1 }))).resolves.toBe("ran");
    });

    it("refuses arguments too large to validate against a large schema", async () => {
      const run = vi.fn(async () => "ran");
      // About 4,300 subschemas once the shared $ref is expanded.
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "large-schema": entry("x", {
              run,
              tool: {
                description: "x",
                parameters: {
                  type: "object",
                  properties: {
                    xs: { type: "array", items: { type: "number" } },
                    ...Object.fromEntries(
                      Array.from({ length: 70 }, (_, i) => [
                        `p${i}`,
                        { $ref: "#/$defs/d" },
                      ]),
                    ),
                  },
                  $defs: {
                    d: {
                      type: "object",
                      properties: Object.fromEntries(
                        Array.from({ length: 60 }, (_, i) => [
                          `q${i}`,
                          { type: "string" },
                        ]),
                      ),
                    },
                  },
                } as never,
              },
            }),
          }),
        }),
        alice,
        {},
      );
      const large = added["large-schema"]!;

      await expect(
        asAlice(() =>
          large.run({ xs: Array.from({ length: 6_000 }, () => 1) }),
        ),
      ).rejects.toThrow(/too large to validate/);
      expect(run).not.toHaveBeenCalled();
      await expect(
        asAlice(() => large.run({ xs: Array.from({ length: 100 }, () => 1) })),
      ).resolves.toBe("ran");
      // The walk stops once the queue is over budget, before reading the rest.
      const unread = Array.from({ length: 6_000 }, () => 1);
      Object.defineProperty(unread, 5_500, {
        get() {
          throw new Error("read past the budget");
        },
      });
      await expect(asAlice(() => large.run({ xs: unread }))).rejects.toThrow(
        /too large to validate/,
      );
    });

    it("keeps the agent loop from coercing arguments before the strict check", async () => {
      const run = vi.fn(async (args: unknown) => JSON.stringify(args));
      const added = await resolveAppAdditionalActions(
        config({
          resolver: () => ({
            "strict-loop-tool": entry("x", {
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
      let streamCalls = 0;
      const engine: AgentEngine = {
        name: "test",
        label: "Test",
        defaultModel: "test-model",
        supportedModels: ["test-model"],
        capabilities: {
          thinking: false,
          promptCaching: false,
          vision: false,
          computerUse: false,
          parallelToolCalls: false,
        },
        async *stream(): AsyncIterable<EngineEvent> {
          streamCalls += 1;
          if (streamCalls <= 2) {
            yield {
              type: "assistant-content",
              parts: [
                {
                  type: "tool-call" as const,
                  id: `call-${streamCalls}`,
                  name: "strict-loop-tool",
                  input: { count: streamCalls === 1 ? "3" : 3 },
                },
              ],
            };
            yield { type: "stop", reason: "tool_use" };
            return;
          }
          yield {
            type: "assistant-content",
            parts: [{ type: "text", text: "done" }],
          };
          yield { type: "stop", reason: "end_turn" };
        },
      };
      const events: any[] = [];
      // Chat filters the registry for discovery, copying every entry.
      const discoverable = await filterActionsForAgentDiscovery(added);

      await asAlice(() =>
        runAgentLoop({
          engine,
          model: "test-model",
          systemPrompt: "system",
          tools: [],
          messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
          actions: discoverable,
          ownerEmail: "alice@example.com",
          orgId: "acme",
          send: (event) => events.push(event),
          signal: new AbortController().signal,
        }),
      );

      const results = events.filter((event) => event.type === "tool_done");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ isError: true });
      expect(String(results[0].result)).toContain("must be number");
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith({ count: 3 }, expect.anything());
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
