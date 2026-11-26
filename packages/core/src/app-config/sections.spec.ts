import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import { z } from "zod";

import { declaredEnvKeys, describeConfigFields } from "./describe.js";
import {
  clearAppConfigSectionsForTests,
  getAppConfigSchema,
} from "./sections.js";
import {
  defineAppConfig,
  defineAppConfigSection,
  getAppConfig,
  resetAppConfigForTests,
} from "./store.js";

const originalEnv = { ...process.env };

const locationsSection = () =>
  z.object({
    suggestionsKey: z.string().min(1).optional().meta({
      env: "EXAMPLE_LOCATIONS_SUGGESTIONS_KEY",
      doc: "Key for location suggestions.",
    }),
    maxSuggestions: z.number().int().positive().default(5).meta({
      env: "EXAMPLE_LOCATIONS_MAX_SUGGESTIONS",
    }),
  });

const providerSection = () =>
  z.object({
    paused: z
      .boolean()
      .default(false)
      .meta({
        env: ["EXAMPLE_PROVIDER_PAUSED", "LEGACY_EXAMPLE_PROVIDER_PAUSED"],
      }),
  });

function sectionOf(key: string): unknown {
  return (getAppConfig() as unknown as Record<string, unknown>)[key];
}

describe("app config sections", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    clearAppConfigSectionsForTests();
    process.env = { ...originalEnv };
    delete process.env.EXAMPLE_LOCATIONS_SUGGESTIONS_KEY;
    delete process.env.EXAMPLE_LOCATIONS_MAX_SUGGESTIONS;
    delete process.env.EXAMPLE_PROVIDER_PAUSED;
    delete process.env.LEGACY_EXAMPLE_PROVIDER_PAUSED;
  });

  afterEach(() => {
    resetAppConfigForTests();
    clearAppConfigSectionsForTests();
    process.env = { ...originalEnv };
  });

  it("materializes a registered section's declared defaults", () => {
    const section = defineAppConfigSection("locations", locationsSection());

    expect(section.read()).toEqual({ maxSuggestions: 5 });
    expect(sectionOf("locations")).toEqual({ maxSuggestions: 5 });
  });

  it("reads a section field from its declared environment alias", () => {
    process.env.EXAMPLE_LOCATIONS_SUGGESTIONS_KEY = "  fake-key  ";
    process.env.EXAMPLE_LOCATIONS_MAX_SUGGESTIONS = "8";
    const section = defineAppConfigSection("locations", locationsSection());

    expect(section.read()).toEqual({
      suggestionsKey: "fake-key",
      maxSuggestions: 8,
    });
  });

  it("uses the first set spelling of an alias list", () => {
    process.env.LEGACY_EXAMPLE_PROVIDER_PAUSED = "true";
    const section = defineAppConfigSection(
      "exampleProvider",
      providerSection(),
    );

    expect(section.read().paused).toBe(true);

    process.env.EXAMPLE_PROVIDER_PAUSED = "off";
    expect(section.read().paused).toBe(false);
  });

  it("lets defineAppConfig set a section, before or after registration", () => {
    defineAppConfig({ exampleProvider: { paused: true } } as never);
    const section = defineAppConfigSection(
      "exampleProvider",
      providerSection(),
    );

    expect(section.read().paused).toBe(true);

    defineAppConfig({ locations: { maxSuggestions: 3 } } as never);
    const locations = defineAppConfigSection("locations", locationsSection());
    expect(locations.read().maxSuggestions).toBe(3);
  });

  it("drops a resolved config that predates the registration", () => {
    expect(sectionOf("locations")).toBeUndefined();

    defineAppConfigSection("locations", locationsSection());

    expect(sectionOf("locations")).toEqual({ maxSuggestions: 5 });
  });

  it("rejects an invalid value already set for a newly registered section", () => {
    defineAppConfig({ locations: { maxSuggestions: -1 } } as never);

    expect(() =>
      defineAppConfigSection("locations", locationsSection()),
    ).toThrow();
  });

  it("rejects an invalid environment value loudly instead of dropping it", () => {
    process.env.EXAMPLE_PROVIDER_PAUSED = "maybe";
    const section = defineAppConfigSection(
      "exampleProvider",
      providerSection(),
    );

    expect(() => section.read()).toThrow(/EXAMPLE_PROVIDER_PAUSED/);
  });

  it("fails loudly when a section is read after its registration is gone", () => {
    const section = defineAppConfigSection("locations", locationsSection());
    clearAppConfigSectionsForTests();

    expect(() => section.read()).toThrow(/not registered/);
  });

  it("refuses a key the framework already owns", () => {
    expect(() => defineAppConfigSection("agent", providerSection())).toThrow(
      /collides with the framework/,
    );
  });

  it("refuses a key that is not a lower-camel-case identifier", () => {
    expect(() =>
      defineAppConfigSection("Example-Provider", providerSection()),
    ).toThrow(/lower-camel-case/);
  });

  it("refuses an env alias that another field already reads", () => {
    defineAppConfigSection("exampleProvider", providerSection());

    expect(() =>
      defineAppConfigSection(
        "otherProvider",
        z.object({
          paused: z
            .boolean()
            .optional()
            .meta({ env: "EXAMPLE_PROVIDER_PAUSED" }),
        }),
      ),
    ).toThrow(/exampleProvider\.paused/);
    expect(() =>
      defineAppConfigSection(
        "otherProvider",
        z.object({
          appId: z.string().optional().meta({ env: "AGENT_NATIVE_APP_ID" }),
        }),
      ),
    ).toThrow(/already reads it/);
  });

  it("accepts the same shape again but refuses a different one under one key", () => {
    defineAppConfigSection("exampleProvider", providerSection());

    expect(() =>
      defineAppConfigSection("exampleProvider", providerSection()),
    ).not.toThrow();
    expect(() =>
      defineAppConfigSection("exampleProvider", locationsSection()),
    ).toThrow(/different shape/);
  });

  it("refuses a second schema with the same keys and aliases but different defaults", () => {
    defineAppConfigSection("exampleProvider", providerSection());

    expect(() =>
      defineAppConfigSection(
        "exampleProvider",
        z.object({
          paused: z
            .boolean()
            .default(true)
            .meta({
              env: [
                "EXAMPLE_PROVIDER_PAUSED",
                "LEGACY_EXAMPLE_PROVIDER_PAUSED",
              ],
            }),
        }),
      ),
    ).toThrow(/different shape/);
  });

  it("describes section fields and env keys through the effective schema", () => {
    defineAppConfigSection("locations", locationsSection());

    const fields = describeConfigFields(getAppConfigSchema());
    expect(fields).toContainEqual(
      expect.objectContaining({
        path: "locations.suggestionsKey",
        env: ["EXAMPLE_LOCATIONS_SUGGESTIONS_KEY"],
        doc: "Key for location suggestions.",
        required: false,
      }),
    );
    expect(declaredEnvKeys(getAppConfigSchema())).toContain(
      "EXAMPLE_LOCATIONS_MAX_SUGGESTIONS",
    );
    expect(declaredEnvKeys()).not.toContain(
      "EXAMPLE_LOCATIONS_MAX_SUGGESTIONS",
    );
  });

  it("hands a field's own env parser every set value, blank included", () => {
    type Mode = boolean | "foreground-only";
    const parseMode = (value: unknown): Mode => {
      if (value === false) return false;
      const normalized = typeof value === "string" ? value.trim() : "";
      if (normalized === "foreground-only") return "foreground-only";
      return normalized === "false" ? false : true;
    };
    const section = defineAppConfigSection(
      "gatedProvider",
      z.object({
        mode: z
          .unknown()
          .transform(parseMode)
          .catch(true)
          .default(false)
          .meta({
            env: "EXAMPLE_GATED_PROVIDER_MODE",
            envParse: (raw: string) => raw,
          }),
      }),
    );

    delete process.env.EXAMPLE_GATED_PROVIDER_MODE;
    resetAppConfigForTests();
    expect(section.read().mode).toBe(false);

    for (const [raw, expected] of [
      ["foreground-only", "foreground-only"],
      [" false ", false],
      ["typo", true],
      // A blank override is still an override: the parser decides, and this
      // one fails closed, where a built-in parser would skip the value.
      ["", true],
      ["  ", true],
    ] as const) {
      process.env.EXAMPLE_GATED_PROVIDER_MODE = raw;
      resetAppConfigForTests();
      expect(section.read().mode, JSON.stringify(raw)).toBe(expected);
    }
    delete process.env.EXAMPLE_GATED_PROVIDER_MODE;
  });

  it("keeps skipping blank values for fields without their own parser", () => {
    defineAppConfigSection("provider", providerSection());
    process.env.EXAMPLE_PROVIDER_PAUSED = "  ";
    resetAppConfigForTests();
    expect(sectionOf("provider")).toEqual({ paused: false });
  });

  it("refuses an env parser that is not a function", () => {
    expect(() =>
      defineAppConfigSection(
        "brokenParser",
        z.object({
          mode: z.string().optional().meta({
            env: "EXAMPLE_BROKEN_PARSER",
            envParse: "raw",
          }),
        }),
      ),
    ).toThrow(/envParse/);
  });

  it("types the section reader from its schema", () => {
    const section = defineAppConfigSection("locations", locationsSection());

    expectTypeOf(section.key).toEqualTypeOf<"locations">();
    expectTypeOf(section.read()).toEqualTypeOf<{
      suggestionsKey?: string | undefined;
      maxSuggestions: number;
    }>();
  });
});
