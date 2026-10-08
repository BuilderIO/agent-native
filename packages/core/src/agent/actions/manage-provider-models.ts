import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { orgAdminAuditTarget } from "../../audit/org-admin.js";
import {
  MAX_SELECTED_MODELS,
  PROVIDER_MODEL_SELECTION_AUDIT_TARGET_TYPE,
  PROVIDER_MODEL_SELECTION_PROVIDERS,
  ProviderModelSelectionError,
  recommendedProviderModels,
  resetProviderModelSelection,
  resolveProviderModelSelectionScope,
  writeProviderModelSelection,
  type ProviderModelSelectionProvider,
  type ProviderModelSelectionScope,
} from "../provider-model-selection.js";

type ManageResult = { scope?: ProviderModelSelectionScope } | undefined;

function auditScope(
  args: { scope?: ProviderModelSelectionScope },
  result: unknown,
): ProviderModelSelectionScope | undefined {
  return (result as ManageResult)?.scope ?? args.scope;
}

export default defineAction({
  description:
    'Choose which models a model provider shows in the chat model picker and the default-model select. action "set" stores the checked models (an empty list hides the provider\'s chat models, for a key used only by services); "reset" goes back to the provider\'s recommended models. scope "user" is the caller\'s personal selection, "org" the organization\'s (owners and admins only); omit it to change the selection in effect, which follows the key in effect. Chats already on an unchecked model keep running. Read the current selection and the recommended models with get-provider-models.',
  schema: z.object({
    action: z.enum(["set", "reset"]),
    provider: z
      .enum(PROVIDER_MODEL_SELECTION_PROVIDERS as [string, ...string[]])
      .describe("Provider id, e.g. builder, openai, anthropic, ollama."),
    scope: z
      .enum(["user", "org"])
      .optional()
      .describe(
        'Which selection to change: "user" (personal) or "org" (organization; owners and admins only). Defaults to the scope of the key in effect.',
      ),
    models: z
      .array(z.string())
      .max(MAX_SELECTED_MODELS)
      .optional()
      .describe(
        'Model ids to show, for action "set". Builder.io accepts only its own catalog; other providers accept any id their key reaches.',
      ),
  }),
  audit: {
    target: (args, result, meta) => {
      const scope = auditScope(args, result);
      return scope === "org"
        ? orgAdminAuditTarget(
            PROVIDER_MODEL_SELECTION_AUDIT_TARGET_TYPE,
            args.provider,
            meta.orgId,
          )
        : {
            type: PROVIDER_MODEL_SELECTION_AUDIT_TARGET_TYPE,
            id: args.provider,
            visibility: "private",
          };
    },
    summary: (args, result) => {
      const scope =
        auditScope(args, result) === "org" ? "organization" : "personal";
      return args.action === "reset"
        ? `Reset ${scope} ${args.provider} models to the recommended list`
        : `Set ${scope} ${args.provider} models (${args.models?.length ?? 0})`;
    },
  },
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    const provider = args.provider as ProviderModelSelectionProvider;
    const selectionCtx = { userEmail: ctx.userEmail, orgId: ctx.orgId ?? null };
    try {
      const scope =
        args.scope ??
        (await resolveProviderModelSelectionScope(provider, selectionCtx));
      if (args.action === "set" && !args.models) {
        fail('models is required for action "set".', { statusCode: 400 });
      }
      const row =
        args.action === "set"
          ? await writeProviderModelSelection(
              selectionCtx,
              provider,
              scope,
              args.models ?? [],
            )
          : await resetProviderModelSelection(selectionCtx, provider, scope);
      return {
        ...row,
        recommendedModels: [...recommendedProviderModels(provider)],
      };
    } catch (err) {
      if (err instanceof ProviderModelSelectionError) {
        fail(err.message, { statusCode: err.statusCode });
      }
      throw err;
    }
  },
});
