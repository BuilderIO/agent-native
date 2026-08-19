import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { declaredEnvKeys, describeConfigFields } from "./describe.js";
import { collectEnvAliases, readEnvConfigLayer } from "./env-layer.js";
import { appConfigSchema } from "./schema.js";
import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
  setAppConfigLayer,
} from "./store.js";

const originalEnv = { ...process.env };

describe("app config store", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK;
    delete process.env.AGENT_NATIVE_DISABLE_DESKTOP_SSO_FALLBACK;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("applies declared defaults when nothing is configured", () => {
    expect(getAppConfig().privateBlob.publicUploadFallback).toBe(true);
    expect(getAppConfig().privateBlob.provider).toBeUndefined();
  });

  it("reads a declared environment alias", () => {
    process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK = "0";
    expect(getAppConfig().privateBlob.publicUploadFallback).toBe(false);
  });

  it("declares the development Desktop SSO fallback control", () => {
    expect(getAppConfig().auth.disableDesktopSsoFallbackInDevelopment).toBe(
      false,
    );

    process.env.AGENT_NATIVE_DISABLE_DESKTOP_SSO_FALLBACK = "1";
    resetAppConfigForTests();

    expect(getAppConfig().auth.disableDesktopSsoFallbackInDevelopment).toBe(
      true,
    );
  });

  it("lets an explicit value win over the environment alias", () => {
    process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK = "0";
    defineAppConfig({ privateBlob: { publicUploadFallback: true } });
    expect(getAppConfig().privateBlob.publicUploadFallback).toBe(true);
  });

  it("ranks the deprecated setter layer above env and below the app layer", () => {
    process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK = "1";
    setAppConfigLayer("legacy", {
      privateBlob: { publicUploadFallback: false },
    });
    expect(getAppConfig().privateBlob.publicUploadFallback).toBe(false);

    defineAppConfig({ privateBlob: { publicUploadFallback: true } });
    expect(getAppConfig().privateBlob.publicUploadFallback).toBe(true);
  });

  it("merges repeated calls instead of replacing the previous one", () => {
    defineAppConfig({ privateBlob: { provider: "memory" } });
    defineAppConfig({ privateBlob: { publicUploadFallback: false } });

    const config = getAppConfig();
    expect(config.privateBlob.provider).toBe("memory");
    expect(config.privateBlob.publicUploadFallback).toBe(false);
  });

  it("rejects a bad value where it is set, not where it is read", () => {
    expect(() =>
      defineAppConfig({
        privateBlob: { provider: "" },
      }),
    ).toThrow();
  });

  it("treats an empty environment value as unset", () => {
    process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK = "";
    expect(getAppConfig().privateBlob.publicUploadFallback).toBe(true);
  });

  it("fails loudly on an unparseable boolean rather than picking a branch", () => {
    process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK = "maybe";
    expect(() => getAppConfig()).toThrow(
      /AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK must be one of/,
    );
  });
});

describe("app identity", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    for (const key of [
      "AGENT_NATIVE_APP_ID",
      "APP_ID",
      "AGENT_NATIVE_WORKSPACE_APP_ID",
      "VITE_AGENT_NATIVE_WORKSPACE_APP_ID",
      "APP_NAME",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("keeps id, workspaceId, and name as separate values", () => {
    process.env.AGENT_NATIVE_APP_ID = "generic";
    process.env.AGENT_NATIVE_WORKSPACE_APP_ID = "workspace";
    process.env.APP_NAME = "Display Name";

    const app = getAppConfig().app;
    expect(app.id).toBe("generic");
    expect(app.workspaceId).toBe("workspace");
    expect(app.name).toBe("Display Name");
  });

  it("falls back to the VITE spelling for the workspace id", () => {
    process.env.VITE_AGENT_NATIVE_WORKSPACE_APP_ID = "vite-workspace";
    expect(getAppConfig().app.workspaceId).toBe("vite-workspace");
  });

  it("leaves every field absent when nothing is configured", () => {
    const app = getAppConfig().app;
    expect(app.id).toBeUndefined();
    expect(app.workspaceId).toBeUndefined();
    expect(app.name).toBeUndefined();
  });

  it("has no default, so credential scoping can still deny", () => {
    // A default of "app" here would turn "no identity configured" into a grant
    // lookup scoped to an app literally named `app`.
    expect(appConfigSchema.parse({}).app.id).toBeUndefined();
  });

  it("lets app code set identity without an environment variable", () => {
    defineAppConfig({ app: { id: "from-code" } });
    expect(getAppConfig().app.id).toBe("from-code");
  });
});

describe("agent engine and model", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    for (const key of [
      "AGENT_ENGINE",
      "AGENT_MODEL",
      "AGENT_MODE",
      "AGENT_ENGINE_PREFER_BYO_KEY",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("reads engine and model from the environment", () => {
    process.env.AGENT_ENGINE = "anthropic";
    process.env.AGENT_MODEL = "claude-opus-5";

    expect(getAppConfig().agent.engine).toBe("anthropic");
    expect(getAppConfig().agent.model).toBe("claude-opus-5");
  });

  it("lets app code select an engine with no environment variable", () => {
    defineAppConfig({ agent: { engine: "openai" } });
    expect(getAppConfig().agent.engine).toBe("openai");
  });

  it("defaults preferBringYourOwnKey to false", () => {
    expect(getAppConfig().agent.preferBringYourOwnKey).toBe(false);
  });

  it("still accepts the spellings the hand-rolled parser accepted", () => {
    for (const raw of ["1", "true", "TRUE"]) {
      resetAppConfigForTests();
      process.env.AGENT_ENGINE_PREFER_BYO_KEY = raw;
      expect(getAppConfig().agent.preferBringYourOwnKey).toBe(true);
    }
  });

  it("rejects a malformed toggle instead of silently reading it as false", () => {
    // Behavior change: `/^(1|true)$/i.test(...)` treated "maybe" as false, so a
    // typo silently selected the opposite policy. It is now a startup error
    // naming the key.
    process.env.AGENT_ENGINE_PREFER_BYO_KEY = "maybe";
    expect(() => getAppConfig()).toThrow(
      /AGENT_ENGINE_PREFER_BYO_KEY must be one of/,
    );
  });
});

describe("security toggles", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.A2A_ALLOW_UNSIGNED_INTERNAL;
    delete process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("defaults to the restrictive value", () => {
    const config = getAppConfig();
    expect(config.a2a.allowUnsignedInternal).toBe(false);
    expect(config.integrations.allowUnverifiedWebhooks).toBe(false);
  });

  it('still opts in with the historical "1" spelling', () => {
    process.env.A2A_ALLOW_UNSIGNED_INTERNAL = "1";
    process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS = "1";

    const config = getAppConfig();
    expect(config.a2a.allowUnsignedInternal).toBe(true);
    expect(config.integrations.allowUnverifiedWebhooks).toBe(true);
  });

  it("refuses a malformed toggle rather than guessing a security policy", () => {
    process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS = "yes-please";
    expect(() => getAppConfig()).toThrow(
      /AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS must be one of/,
    );
  });
});

describe("list-valued fields", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.AGENT_NATIVE_A2A_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("defaults to an empty list rather than undefined", () => {
    expect(getAppConfig().a2a.allowedOrigins).toEqual([]);
  });

  it("splits, trims, and drops blanks so consumers do not have to", () => {
    process.env.AGENT_NATIVE_A2A_ALLOWED_ORIGINS =
      " http://127.0.0.1:3001 , http://127.0.0.1:3002 ,, ";

    expect(getAppConfig().a2a.allowedOrigins).toEqual([
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3002",
    ]);
  });

  it("accepts an explicit list from app code", () => {
    defineAppConfig({ a2a: { allowedOrigins: ["http://127.0.0.1:4000"] } });
    expect(getAppConfig().a2a.allowedOrigins).toEqual([
      "http://127.0.0.1:4000",
    ]);
  });

  it("rejects an empty entry set in app code", () => {
    expect(() => defineAppConfig({ a2a: { allowedOrigins: [""] } })).toThrow();
  });
});

describe("schema reflection", () => {
  it("describes every declared leaf field", () => {
    const engine = describeConfigFields().find(
      (field) => field.path === "agent.engine",
    );
    expect(engine).toMatchObject({
      env: ["AGENT_ENGINE"],
      type: "string",
      required: false,
    });
    expect(engine?.doc).toBeTruthy();
  });

  it("resolves a declared default so generated docs can show it", () => {
    expect(
      describeConfigFields().find(
        (field) => field.path === "privateBlob.publicUploadFallback",
      )?.defaultValue,
    ).toBe(true);
  });

  it("includes fields that have no environment alias", () => {
    expect(
      describeConfigFields().find(
        (field) => field.path === "privateBlob.provider",
      )?.env,
    ).toEqual([]);
  });

  it("lists declared env keys sorted and deduplicated", () => {
    const keys = declaredEnvKeys();
    expect(keys).toContain("AGENT_NATIVE_APP_ID");
    expect(keys).toContain("APP_ID");
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("env layer", () => {
  it("collects declared aliases with their field path", () => {
    expect(collectEnvAliases(appConfigSchema)).toContainEqual({
      path: ["privateBlob", "publicUploadFallback"],
      env: ["AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK"],
      type: "boolean",
    });
  });

  it("takes the first alias that is set, in declared order", () => {
    expect(
      readEnvConfigLayer(appConfigSchema, {
        AGENT_NATIVE_APP_ID: "explicit",
        APP_ID: "fallback",
      }).app,
    ).toEqual({ id: "explicit" });

    expect(
      readEnvConfigLayer(appConfigSchema, { APP_ID: "fallback" }).app,
    ).toEqual({ id: "fallback" });
  });

  it("treats a blank alias as absent and falls through to the next", () => {
    expect(
      readEnvConfigLayer(appConfigSchema, {
        AGENT_NATIVE_APP_ID: "   ",
        APP_ID: "fallback",
      }).app,
    ).toEqual({ id: "fallback" });
  });

  it("trims a string value the way every reader it replaces did", () => {
    expect(
      readEnvConfigLayer(appConfigSchema, { AGENT_NATIVE_APP_ID: " padded " })
        .app,
    ).toEqual({ id: "padded" });
  });

  it("accepts the documented truthy and falsy spellings", () => {
    for (const raw of ["1", "true", "YES", " on "]) {
      expect(
        readEnvConfigLayer(appConfigSchema, {
          AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK: raw,
        }),
      ).toEqual({ privateBlob: { publicUploadFallback: true } });
    }
    for (const raw of ["0", "false", "NO", " off "]) {
      expect(
        readEnvConfigLayer(appConfigSchema, {
          AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK: raw,
        }),
      ).toEqual({ privateBlob: { publicUploadFallback: false } });
    }
  });

  it("ignores keys the schema does not declare", () => {
    expect(
      readEnvConfigLayer(appConfigSchema, { SOMETHING_UNDECLARED: "1" }),
    ).toEqual({});
  });
});
