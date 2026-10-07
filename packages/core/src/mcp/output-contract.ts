import type { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

import {
  describeOutputContractIssue,
  type ActionMcpOutputContract,
} from "../action-output-contract.js";
import {
  ActionOutputContractError,
  type ActionOutputEffect,
} from "../action.js";

/**
 * Build an opted-in action's `structuredContent` and enforce its MCP response
 * contract on it. Returns the JSON form the client receives. Every failure
 * after the action ran — the transform throwing, a value JSON cannot carry, the
 * validator throwing, or a mismatch — is an `ActionOutputContractError` that
 * keeps the call's effect.
 */
export type McpResponseOutputCheck = (
  build: () => Record<string, unknown>,
  failure: { actionName: string; effect: ActionOutputEffect },
) => Record<string, unknown>;

let ajv: Ajv2020 | undefined;
const checks = new WeakMap<ActionMcpOutputContract, McpResponseOutputCheck>();

function contractValidator(): Ajv2020 {
  if (!ajv) {
    // strictSchema makes an unknown keyword or format a compile error rather
    // than an assertion that silently passes.
    ajv = new Ajv2020({
      strict: true,
      strictTypes: false,
      strictTuples: false,
      strictRequired: false,
      allowUnionTypes: true,
      allErrors: true,
      logger: false,
    });
    addFormats(ajv);
  }
  return ajv;
}

/**
 * Compile the check for an opted-in action's MCP response contract. Call it
 * before `run`: a contract that cannot be enforced must fail while nothing has
 * been applied, not after a write.
 */
export function mcpResponseOutputCheck(
  contract: ActionMcpOutputContract,
): McpResponseOutputCheck {
  const cached = checks.get(contract);
  if (cached) return cached;
  const validate: ValidateFunction = contractValidator().compile(
    contract.response,
  );
  if ((validate as { $async?: unknown }).$async) {
    throw new TypeError(
      "An MCP output contract cannot be asynchronous; the response must be checked before it is returned.",
    );
  }
  const response = contract.response;
  const contractError = (
    failure: { actionName: string; effect: ActionOutputEffect },
    issues: string[],
  ) =>
    new ActionOutputContractError({
      actionName: failure.actionName,
      effect: failure.effect,
      contract: "mcp",
      issues: issues.length > 0 ? issues : ["(root): invalid"],
    });
  const check: McpResponseOutputCheck = (build, failure) => {
    let built: unknown;
    try {
      built = build();
    } catch {
      throw contractError(failure, ["(root): transform_failed"]);
    }
    // Validate what the client receives: `structuredContent` is serialized,
    // so a Date or an undefined field reaches the client as JSON, not as is.
    let serialized: unknown;
    try {
      serialized = JSON.parse(JSON.stringify(built));
    } catch {
      throw contractError(failure, ["(root): not_serializable"]);
    }
    let valid: unknown;
    try {
      valid = validate(serialized);
    } catch {
      throw contractError(failure, ["(root): validator_threw"]);
    }
    if (valid === true) return serialized as Record<string, unknown>;
    if (valid && typeof (valid as PromiseLike<unknown>).then === "function") {
      // coercion-ok: a pending verdict already failed this check below; its
      // later rejection must not surface as an unhandled one.
      (valid as Promise<unknown>).catch(() => undefined);
    }
    throw contractError(
      failure,
      (validate.errors ?? []).map((error) => {
        const path = error.instancePath
          .split("/")
          .slice(1)
          .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
        const missing = (error.params as { missingProperty?: unknown })
          .missingProperty;
        if (error.keyword === "required" && typeof missing === "string") {
          path.push(missing);
        }
        return describeOutputContractIssue(path, error.keyword, response);
      }),
    );
  };
  checks.set(contract, check);
  return check;
}
