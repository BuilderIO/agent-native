import { isActionReadOnly } from "./action.js";
import { ActionError } from "./errors.js";
import type { ActionsRegistry } from "./registry.js";
import type {
  ActionMap,
  InferActionInputFromDef,
  InferActionReturn,
} from "./types.js";

async function readNextRequestHeaders(): Promise<Headers> {
  try {
    const nextHeaders = await import("next/headers");
    if (typeof nextHeaders.headers === "function") {
      const incoming = await nextHeaders.headers();
      const result = new Headers();
      incoming.forEach((value: string, key: string) => {
        result.append(key, value);
      });
      return result;
    }
  } catch {
    return new Headers();
  }
  return new Headers();
}

/**
 * Decode a `FormData` payload into a plain object suitable for Zod/Standard Schema
 * validation: preserves repeated fields as string arrays and leaves empty strings intact
 * unless `emptyStringAsUndefined` is set.
 */
export function parseFormData(
  formData: FormData,
  options: { emptyStringAsUndefined?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    const normalized =
      options.emptyStringAsUndefined && value === "" ? undefined : value;
    if (normalized === undefined) continue;

    const existing = out[key];
    if (existing !== undefined) {
      out[key] = Array.isArray(existing)
        ? [...existing, normalized]
        : [existing, normalized];
    } else {
      out[key] = normalized;
    }
  }
  return out;
}

/**
 * Call a read-only action directly from a Next.js React Server Component with
 * zero HTTP hop and automatic forwarding of incoming Next.js request headers/cookies.
 */
export async function callNextAction<
  TCtx,
  TActions extends ActionMap<TCtx>,
  TName extends Extract<keyof TActions, string>,
>(
  registry: ActionsRegistry<TCtx, TActions>,
  name: TName,
  input: InferActionInputFromDef<TActions[TName]>,
  options: { allowMutation?: boolean; headers?: HeadersInit } = {},
): Promise<InferActionReturn<TActions[TName]>> {
  const action: ActionMap<TCtx>[string] | undefined = registry.actions[name];
  if (!action) {
    throw new ActionError(`Action "${name}" not found.`, {
      statusCode: 404,
      errorCode: "not_found",
    });
  }
  if (!options.allowMutation && !isActionReadOnly(action)) {
    throw new ActionError(
      `Action "${name}" is a mutation and should not be called directly during Server Component render. Pass \`{ allowMutation: true }\` or invoke it from a Server Action / Route Handler.`,
      {
        statusCode: 405,
        errorCode: "mutation_in_render",
      },
    );
  }

  const headers = options.headers
    ? new Headers(options.headers)
    : await readNextRequestHeaders();

  return registry.call(name, input, {
    caller: "server",
    headers,
  });
}

/**
 * Helper for explicit `"use server"` functions in Next.js App Router:
 *
 * ```ts
 * "use server";
 * import { runFormAction } from "@agent-native/actions/next/server";
 * import { actions } from "@/generated/actions";
 *
 * export async function createTodo(formData: FormData) {
 *   return runFormAction(actions, "create-todo", formData);
 * }
 * ```
 */
export async function runFormAction<
  TCtx,
  TActions extends ActionMap<TCtx>,
  TName extends Extract<keyof TActions, string>,
>(
  registry: ActionsRegistry<TCtx, TActions>,
  name: TName,
  inputOrFormData: FormData | InferActionInputFromDef<TActions[TName]>,
  options: {
    emptyStringAsUndefined?: boolean;
    revalidatePaths?: readonly string[];
    revalidateTags?: readonly string[];
    headers?: HeadersInit;
    approvalToken?: string;
  } = {},
): Promise<InferActionReturn<TActions[TName]>> {
  const headers = options.headers
    ? new Headers(options.headers)
    : await readNextRequestHeaders();

  const rawInput =
    typeof FormData !== "undefined" && inputOrFormData instanceof FormData
      ? parseFormData(inputOrFormData, {
          ...(options.emptyStringAsUndefined !== undefined
            ? { emptyStringAsUndefined: options.emptyStringAsUndefined }
            : {}),
        })
      : inputOrFormData;

  const result = await registry.call(
    name,
    rawInput as InferActionInputFromDef<TActions[TName]>,
    {
      caller: "server",
      headers,
      ...(options.approvalToken !== undefined
        ? { approvalToken: options.approvalToken }
        : {}),
    },
  );

  if (options.revalidatePaths?.length || options.revalidateTags?.length) {
    try {
      const nextCache = await import("next/cache");
      for (const routePath of options.revalidatePaths ?? []) {
        nextCache.revalidatePath(routePath);
      }
      for (const tag of options.revalidateTags ?? []) {
        nextCache.revalidateTag(tag, "max");
      }
    } catch {
      return result;
    }
  }

  return result;
}
