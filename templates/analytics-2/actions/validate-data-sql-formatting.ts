import { Buffer } from "node:buffer";

import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  MAX_SQLFLUFF_CONFIG_BYTES,
  validateSqlFluffConfig,
  type SqlFluffErrorCode,
} from "../server/formatter/sqlfluff.js";
import { manager } from "../server/model/data-connections.js";
import { recordSqlFluffVerdict } from "../server/model/sqlfluff-verdicts.js";

/**
 * Config errors the runtime reports for the uploaded config itself. They are a
 * failed validation result, exactly like the source mutation's `{valid,error}`.
 * Runtime/deadline/unavailability codes are not in this set; they are typed
 * action failures so a broken runtime can never read as "invalid config" or a
 * valid one.
 */
const ordinaryInvalidConfigCodes = new Set<SqlFluffErrorCode>([
  "config_too_large",
  "invalid_config",
  "invalid_dialect",
  "unknown_config_key",
  "unknown_config_section",
  "unknown_rule",
  "unknown_rule_option",
  "unsupported_templater",
  "unsupported_config",
  "template_error",
  "parse_error",
  "invalid_sql",
  "sql_too_large",
]);

const validateDataSqlFormattingErrors = defineActionErrors(
  "data_sqlfluff_runtime_unavailable",
  "data_sqlfluff_validation_timeout",
  "data_sqlfluff_validation_failed",
  "data_sqlfluff_verdict_unreadable",
  "data_sqlfluff_verdict_write_failed",
);

const connectionTypeSchema = z
  .literal("bigquery")
  .describe('The connection\'s warehouse type; only "bigquery" is supported.');
const requestIdSchema = z
  .string()
  .uuid()
  .describe(
    "An opaque browser-generated id correlating this private validation with its safe verdict readback.",
  );

const rawInputSchema = z
  .object({
    connectionType: connectionTypeSchema,
    config: z
      .string()
      .describe(
        "The raw SQLFluff configuration file contents (64 KiB maximum).",
      ),
    requestId: requestIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new TextEncoder().encode(value.config).length > MAX_SQLFLUFF_CONFIG_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["config"],
        message: "The SQLFluff config must be 64 KiB or smaller.",
      });
    }
  });

const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Canonical UTF-8 base64 only; decoded bytes stay under the config bound. */
function decodeConfigBase64(value: string): string | null {
  if (value.length % 4 !== 0 || !base64Pattern.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) return null;
  if (bytes.byteLength > MAX_SQLFLUFF_CONFIG_BYTES) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // coercion-ok: null is the invalid-UTF-8 result rejected by the input schema.
    return null;
  }
}

const encodedInputSchema = z
  .object({
    connectionType: connectionTypeSchema,
    configBase64: z
      .string()
      .describe(
        "The same SQLFluff configuration file contents, UTF-8 base64 encoded so escape-dense files stay inside the private JSON body budget.",
      ),
    requestId: requestIdSchema,
  })
  .strict()
  .transform((value, context) => {
    const config = decodeConfigBase64(value.configBase64);
    if (config === null) {
      context.addIssue({
        code: "custom",
        path: ["configBase64"],
        message:
          "The encoded SQLFluff config must be canonical UTF-8 base64 of at most 64 KiB.",
      });
      return z.NEVER;
    }
    return {
      connectionType: value.connectionType,
      config,
      requestId: value.requestId,
    };
  });

const inputSchema = z.union([rawInputSchema, encodedInputSchema]);

const outputSchema = z
  .object({
    valid: z.boolean(),
    error: z.string().nullable(),
  })
  .strict();

export default defineAction({
  description:
    "Validate an uploaded SQLFluff config for a BigQuery connection. The raw config is private: it is never audited or persisted, and the browser's private POST discards the response body.",
  schema: inputSchema,
  outputSchema,
  errors: validateDataSqlFormattingErrors,
  http: { method: "POST" },
  // CPU-only validation. It writes only the bounded, short-lived verdict
  // record the browser reads back; no connection or user data changes.
  readOnly: false,
  changeEvents: false,
  maxBodyBytes: 128 * 1024,
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInBrowser: false,
  persistInChatHistory: false,
  audit: { recordInputs: false },
  run: async ({ connectionType, config, requestId }) => {
    // The existing canonical manager policy is the authorization boundary:
    // personal scope stays personal and an organization requires its owner or
    // admin. It runs before any runtime work or verdict record.
    const scope = await manager();
    const result = await validateSqlFluffConfig(config, {
      fallbackDialect: connectionType,
    });
    if (result.valid) {
      await recordSqlFluffVerdict(scope, {
        requestId,
        valid: true,
        errorCode: null,
      });
      return { valid: true, error: null };
    }
    if (ordinaryInvalidConfigCodes.has(result.error.code)) {
      await recordSqlFluffVerdict(scope, {
        requestId,
        valid: false,
        errorCode: result.error.code,
      });
      return { valid: false, error: result.error.message };
    }
    return runtimeFailure(result.error, validateDataSqlFormattingErrors);
  },
});

function runtimeFailure(
  error: { code: SqlFluffErrorCode; message: string },
  errors: typeof validateDataSqlFormattingErrors,
): never {
  if (error.code === "deadline") {
    errors.fail(error.message, "data_sqlfluff_validation_timeout", {
      statusCode: 504,
    });
  }
  if (error.code === "runtime_error" || error.code === "engine_error") {
    errors.fail(error.message, "data_sqlfluff_runtime_unavailable", {
      statusCode: 503,
    });
  }
  errors.fail(error.message, "data_sqlfluff_validation_failed", {
    statusCode: 502,
  });
}
