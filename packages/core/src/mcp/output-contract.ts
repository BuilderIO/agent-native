import type { ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

import {
  describeOutputContractIssue,
  outputContractPropertyNames,
  type ActionMcpOutputContract,
} from "../action-output-contract.js";
import {
  ActionOutputContractError,
  type ActionOutputEffect,
} from "../action.js";

export type McpResponseOutputCheck = (
  structuredContent: Record<string, unknown>,
  failure: { actionName: string; effect: ActionOutputEffect },
) => void;

let ajv: Ajv2020 | undefined;
const checks = new WeakMap<ActionMcpOutputContract, McpResponseOutputCheck>();

/**
 * Compile the check for an opted-in action's MCP response contract. Call it
 * before `run`: a contract that cannot compile must fail while nothing has
 * been applied, not after a write.
 */
export function mcpResponseOutputCheck(
  contract: ActionMcpOutputContract,
): McpResponseOutputCheck {
  const cached = checks.get(contract);
  if (cached) return cached;
  ajv ??= new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false,
    logger: false,
  });
  const validate: ValidateFunction = ajv.compile(contract.response);
  const declaredNames = outputContractPropertyNames(contract.response);
  const check: McpResponseOutputCheck = (structuredContent, failure) => {
    // Validate what the client receives: `structuredContent` is serialized,
    // so a Date or an undefined field reaches the client as JSON, not as is.
    if (validate(JSON.parse(JSON.stringify(structuredContent)))) return;
    throw new ActionOutputContractError({
      actionName: failure.actionName,
      effect: failure.effect,
      contract: "mcp",
      issues: (validate.errors ?? []).map((error) => {
        const path = error.instancePath
          .split("/")
          .slice(1)
          .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
        const missing = (error.params as { missingProperty?: unknown })
          .missingProperty;
        if (error.keyword === "required" && typeof missing === "string") {
          path.push(missing);
        }
        return describeOutputContractIssue(path, error.keyword, declaredNames);
      }),
    });
  };
  checks.set(contract, check);
  return check;
}
