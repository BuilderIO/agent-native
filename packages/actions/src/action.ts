import type { StandardSchemaV1 } from "@standard-schema/spec";

import { ActionError, ActionPostCommitError } from "./errors.js";
import {
  normalizeLlmToolInput,
  schemaToJsonSchema,
  validateInputSchema,
  validateOutputSchema,
} from "./schema.js";
import type {
  ActionAfterMutateInfo,
  ActionApprovalVerifier,
  ActionCaller,
  ActionDefinition,
  ActionErrorInfo,
  ActionHttpMethod,
  ActionMapEntry,
  ActionMiddleware,
  DefaultActionContext,
  DefinedAction,
} from "./types.js";

export function defineAction<
  TSchema extends StandardSchemaV1 | undefined = undefined,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
  TReturn = unknown,
  TCtx = DefaultActionContext,
>(
  definition: ActionDefinition<TSchema, TOutputSchema, TReturn, TCtx>,
): DefinedAction<TSchema, TOutputSchema, TReturn, TCtx> {
  return {
    ...definition,
    __agentNativeAction: true,
  };
}

/**
 * Create an app-local `defineAction` helper pre-bound to your app's context type
 * (e.g. `{ user: SessionUser | null; orgId: string | null }`), so `ctx` is
 * strongly typed inside every `actions/*.ts` file.
 */
export function createActionBuilder<TCtx>() {
  return function defineTypedAction<
    TSchema extends StandardSchemaV1 | undefined = undefined,
    TOutputSchema extends StandardSchemaV1 | undefined = undefined,
    TReturn = unknown,
  >(
    definition: ActionDefinition<TSchema, TOutputSchema, TReturn, TCtx>,
  ): DefinedAction<TSchema, TOutputSchema, TReturn, TCtx> {
    return {
      ...definition,
      __agentNativeAction: true,
    };
  };
}

export function isDefinedAction(value: unknown): value is DefinedAction {
  return (
    typeof value === "object" &&
    value !== null &&
    "__agentNativeAction" in value &&
    (value as { __agentNativeAction?: unknown }).__agentNativeAction === true &&
    typeof (value as { run?: unknown }).run === "function"
  );
}

export function resolveActionHttpMethod(
  action: Pick<ActionMapEntry<never>, "http">,
): ActionHttpMethod | null {
  if (action.http === false) return null;
  if (action.http && action.http.method) return action.http.method;
  return "POST";
}

export function resolveActionHttpPath(
  name: string,
  action: Pick<ActionMapEntry<never>, "http">,
): string | null {
  if (action.http === false) return null;
  if (action.http && action.http.path) {
    return action.http.path.replace(/^\/+/, "");
  }
  return name;
}

export function isActionReadOnly(
  action: Pick<ActionMapEntry<never>, "readOnly" | "http">,
): boolean {
  if (typeof action.readOnly === "boolean") return action.readOnly;
  return resolveActionHttpMethod(action) === "GET";
}

export interface ExecuteActionOptions<TCtx> {
  name: string;
  action: ActionMapEntry<TCtx>;
  rawInput: unknown;
  ctx: TCtx;
  caller: ActionCaller;
  approvalToken?: string;
  approved?: boolean;
  verifyApproval?: ActionApprovalVerifier<TCtx>;
  middleware?: readonly ActionMiddleware<TCtx>[];
  onAfterMutate?: (info: ActionAfterMutateInfo<TCtx>) => void | Promise<void>;
  onError?: (error: unknown, info: ActionErrorInfo<TCtx>) => void;
}

/**
 * Single checked execution pipeline shared by HTTP, direct `.call()`, CLI,
 * MCP, and AI SDK tools:
 *
 * 1. Normalize LLM input quirks (for `mcp` and `agent` callers only)
 * 2. Validate input once through Standard Schema
 * 3. Run `authorize(input, ctx)` -> 403 `forbidden` before approval or `run`
 * 4. Evaluate `needsApproval(input, ctx)` -> 403 `approval_required` unless verified
 * 5. Run middleware chain + `run(input, ctx)`
 * 6. Validate `outputSchema` and fire `onAfterMutate` (failures raise `ActionPostCommitError`)
 */
export async function executeAction<TCtx>(
  options: ExecuteActionOptions<TCtx>,
): Promise<unknown> {
  const {
    name,
    action,
    ctx,
    caller,
    approvalToken,
    approved,
    verifyApproval,
    middleware = [],
    onAfterMutate,
    onError,
  } = options;

  let committed = false;

  try {
    let candidateInput = options.rawInput;
    if (caller === "mcp" || caller === "agent") {
      const jsonSchema = schemaToJsonSchema(
        action.schema,
        "input",
        action.toolSchema,
      );
      candidateInput = normalizeLlmToolInput(candidateInput, jsonSchema);
    }

    const inputToValidate = candidateInput ?? {};
    const validatedInput = action.schema
      ? await validateInputSchema(action.schema, inputToValidate, name)
      : inputToValidate;

    if (action.authorize) {
      const allowed = await action.authorize(validatedInput as never, ctx);
      if (!allowed) {
        throw new ActionError(`Not authorized to run action "${name}".`, {
          statusCode: 403,
          errorCode: "forbidden",
        });
      }
    }

    if (action.needsApproval !== undefined) {
      const required =
        typeof action.needsApproval === "function"
          ? await action.needsApproval(validatedInput as never, ctx)
          : Boolean(action.needsApproval);

      if (required) {
        let isApproved = false;
        if (verifyApproval) {
          isApproved = Boolean(
            await verifyApproval({
              actionName: name,
              input: validatedInput,
              ctx,
              caller,
              ...(approvalToken !== undefined ? { approvalToken } : {}),
            }),
          );
        } else if (approved === true) {
          isApproved = true;
        }

        if (!isApproved) {
          throw new ActionError(
            `Action "${name}" requires explicit human approval before executing.`,
            {
              statusCode: 403,
              errorCode: "approval_required",
              details: {
                action: name,
                input: validatedInput,
              },
            },
          );
        }
      }
    }

    const runCore = async (): Promise<unknown> =>
      action.run(validatedInput as never, ctx);

    const dispatch = middleware.reduceRight<() => Promise<unknown>>(
      (next, mw) => () =>
        mw({ name, input: validatedInput, ctx, caller, next }),
      runCore,
    );

    const rawResult = await dispatch();
    committed = true;

    const validatedResult = action.outputSchema
      ? await validateOutputSchema(action.outputSchema, rawResult, name)
      : rawResult;

    if (onAfterMutate && !isActionReadOnly(action)) {
      try {
        await onAfterMutate({
          name,
          input: validatedInput,
          result: validatedResult,
          ctx,
          caller,
        });
      } catch (hookError) {
        throw new ActionPostCommitError(
          `Action "${name}" succeeded, but post-mutation hook failed.`,
          hookError,
        );
      }
    }

    return validatedResult;
  } catch (error) {
    onError?.(error, { name, caller, ctx, committed });
    throw error;
  }
}
