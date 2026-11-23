import { isActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The validation action owns the private POST boundary: canonical manager
 * authorization, the 64 KiB bound, the split between an ordinary invalid
 * config (a failed validation result) and a runtime/deadline failure (a typed
 * action failure), and the safe verdict record the browser reads back.
 *
 * The actual SQLFluff WASM runtime belongs to the formatter worker; the helper
 * is the boundary here. The verdict store has its own real-SQL test.
 */
const state = vi.hoisted(() => ({
  manager: vi.fn(),
  validate: vi.fn(),
  record: vi.fn(),
}));
vi.mock("../server/model/data-connections.js", () => ({
  manager: state.manager,
}));
vi.mock("../server/formatter/sqlfluff.js", () => ({
  MAX_SQLFLUFF_CONFIG_BYTES: 64 * 1024,
  validateSqlFluffConfig: state.validate,
}));
vi.mock("../server/model/sqlfluff-verdicts.js", () => ({
  recordSqlFluffVerdict: state.record,
}));

import action from "./validate-data-sql-formatting.js";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const input = {
  connectionType: "bigquery",
  config: "dialect = bigquery\n",
  requestId,
};
const uiCaller = { caller: "frontend" } as const;
const encodeConfig = (value: string | Uint8Array) =>
  Buffer.from(value).toString("base64");
const encodedConfig = (configBase64: string) => ({
  connectionType: "bigquery",
  requestId,
  configBase64,
});

beforeEach(() => {
  vi.resetAllMocks();
  state.manager.mockResolvedValue({
    userEmail: "qa-owner@example.invalid",
    orgId: "qa-workspace",
  });
  state.record.mockResolvedValue(undefined);
});

async function schemaRejects(value: unknown): Promise<boolean> {
  const schema = action.schema;
  if (!schema) throw new Error("the action has no input schema");
  const result = await schema["~standard"].validate(value);
  return "issues" in result && result.issues.length > 0;
}

async function typedFailure(promise: Promise<unknown>) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isActionContractError(caught)).toBe(true);
  if (!isActionContractError(caught))
    throw new Error("expected a typed action failure");
  return caught;
}

describe("validate-data-sql-formatting action", () => {
  it("does not invoke the runtime or record a verdict when authorization refuses", async () => {
    state.manager.mockRejectedValue(
      new Error("Only workspace admins can view or edit this configuration."),
    );
    await expect(action.run(input, uiCaller)).rejects.toThrow(
      "Only workspace admins can view or edit this configuration.",
    );
    expect(state.validate).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("bounds the config before invoking authorization or the runtime", async () => {
    const oversize = "a".repeat(64 * 1024 + 1);
    await expect(
      action.run({ ...input, config: oversize }, uiCaller),
    ).rejects.toThrow(/Invalid action parameters/);
    expect(state.manager).not.toHaveBeenCalled();
    expect(state.validate).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("applies a strict, byte-bounded input schema", async () => {
    expect(await schemaRejects(input)).toBe(false);
    expect(
      await schemaRejects({ ...input, config: "a".repeat(64 * 1024 + 1) }),
    ).toBe(true);
    // 40k code units are 80k UTF-8 bytes, so the character-count ceiling alone
    // would let this through.
    expect(await schemaRejects({ ...input, config: "é".repeat(40_000) })).toBe(
      true,
    );
    expect(await schemaRejects({ ...input, connectionType: "snowflake" })).toBe(
      true,
    );
    expect(await schemaRejects({ ...input, extra: true })).toBe(true);
    expect(await schemaRejects({ ...input, requestId: "not-a-uuid" })).toBe(
      true,
    );
    const withoutRequestId = {
      connectionType: input.connectionType,
      config: input.config,
    };
    expect(await schemaRejects(withoutRequestId)).toBe(true);
  });

  it("decodes a bounded UTF-8 base64 config through the actual wire", async () => {
    const heavy = "\n".repeat(64 * 1024);
    const inputBase64 = encodedConfig(encodeConfig(heavy));
    expect(await schemaRejects(inputBase64)).toBe(false);
    state.validate.mockResolvedValue({
      valid: true,
      error: null,
      dialect: "bigquery",
      templater: "jinja",
    });
    await expect(action.run(inputBase64, uiCaller)).resolves.toEqual({
      valid: true,
      error: null,
    });
    expect(state.validate).toHaveBeenCalledWith(heavy, {
      fallbackDialect: "bigquery",
    });
    expect(state.record).toHaveBeenCalledWith(
      {
        userEmail: "qa-owner@example.invalid",
        orgId: "qa-workspace",
      },
      { requestId, valid: true, errorCode: null },
    );
  });

  it("rejects overbound, non-canonical, invalid-UTF-8, and ambiguous encodings", async () => {
    const overbound = "\n".repeat(64 * 1024 + 1);
    expect(await schemaRejects(encodedConfig(encodeConfig(overbound)))).toBe(
      true,
    );
    const canonical = encodeConfig("x");
    expect(await schemaRejects(encodedConfig(canonical.replace("=", "")))).toBe(
      true,
    );
    expect(
      await schemaRejects(
        encodedConfig(`${canonical.slice(0, 2)}\n${canonical.slice(2)}`),
      ),
    ).toBe(true);
    expect(
      await schemaRejects(
        encodedConfig(Buffer.from([0xff, 0xfe]).toString("base64")),
      ),
    ).toBe(true);
    expect(await schemaRejects(encodedConfig(""))).toBe(false);
    expect(
      await schemaRejects({ connectionType: input.connectionType, requestId }),
    ).toBe(true);
    expect(
      await schemaRejects({ ...input, configBase64: encodeConfig("x") }),
    ).toBe(true);
  });

  it("returns the source {valid,error} contract and records a safe valid verdict", async () => {
    state.validate.mockResolvedValue({
      valid: true,
      error: null,
      dialect: "bigquery",
      templater: "jinja",
    });
    await expect(action.run(input, uiCaller)).resolves.toEqual({
      valid: true,
      error: null,
    });
    expect(state.manager).toHaveBeenCalledTimes(1);
    expect(state.validate).toHaveBeenCalledWith(input.config, {
      fallbackDialect: "bigquery",
    });
    expect(state.record).toHaveBeenCalledWith(
      {
        userEmail: "qa-owner@example.invalid",
        orgId: "qa-workspace",
      },
      { requestId, valid: true, errorCode: null },
    );
  });

  it.each([
    ["invalid_config", "The SQLFluff config is not valid INI: ParsingError."],
    ["invalid_dialect", "Unknown SQLFluff dialect: nope."],
    ["unknown_config_key", "Unsupported SQLFluff core option: nope"],
    ["unknown_config_section", "Unsupported SQLFluff section: nope"],
    ["unknown_rule", "Unsupported SQLFluff rule section: nope"],
    ["unknown_rule_option", "Unsupported option for LT01: nope"],
    ["unsupported_templater", "Templater python is not supported."],
    ["unsupported_config", "File/path templater options are not supported."],
    ["config_too_large", "The SQLFluff config must be 64 KiB or smaller."],
  ])(
    "returns an ordinary %s as a failed validation and records only its code",
    async (code, message) => {
      state.validate.mockResolvedValue({
        valid: false,
        error: { code, message },
      });
      await expect(action.run(input, uiCaller)).resolves.toEqual({
        valid: false,
        error: message,
      });
      expect(state.record).toHaveBeenCalledWith(
        {
          userEmail: "qa-owner@example.invalid",
          orgId: "qa-workspace",
        },
        { requestId, valid: false, errorCode: code },
      );
    },
  );

  it.each([
    ["runtime_error", "data_sqlfluff_runtime_unavailable", 503],
    ["engine_error", "data_sqlfluff_runtime_unavailable", 503],
    ["invalid_request", "data_sqlfluff_validation_failed", 502],
    ["deadline", "data_sqlfluff_validation_timeout", 504],
  ])(
    "maps %s to a typed action failure and records no verdict",
    async (code, errorCode, statusCode) => {
      state.validate.mockResolvedValue({
        valid: false,
        error: { code, message: "SQLFluff runtime failure." },
      });
      const failure = await typedFailure(action.run(input, uiCaller));
      expect(failure.errorCode).toBe(errorCode);
      expect(failure.statusCode).toBe(statusCode);
      expect(failure.message).toBe("SQLFluff runtime failure.");
      expect(state.record).not.toHaveBeenCalled();
    },
  );

  it("does not resolve as valid when the safe verdict cannot be recorded", async () => {
    state.validate.mockResolvedValue({
      valid: true,
      error: null,
      dialect: "bigquery",
      templater: "jinja",
    });
    state.record.mockRejectedValue(new Error("settings write failed"));
    await expect(action.run(input, uiCaller)).rejects.toThrow(
      "settings write failed",
    );
  });
});
