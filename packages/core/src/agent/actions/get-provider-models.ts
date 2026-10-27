import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { AGENT_PROVIDER_CATALOG } from "../../client/agent-provider-catalog.js";
import { getOrgRoleForEmail } from "../../mcp/actions/service-token-access.js";
import { canManageOrg } from "../../org/permissions.js";
import {
  PROVIDER_MODEL_SELECTION_PROVIDERS,
  ProviderModelSelectionError,
  readProviderModelSelection,
  recommendedProviderModels,
  resolveEffectiveProviderModelSelection,
  type ProviderModelSelectionProvider,
  type ProviderModelSelectionRow,
  type ProviderModelSelectionScope,
} from "../provider-model-selection.js";

function providerLabel(provider: ProviderModelSelectionProvider): string {
  if (provider === "builder") return "Builder.io";
  return (
    AGENT_PROVIDER_CATALOG.find((option) => option.id === provider)?.label ??
    provider
  );
}

export default defineAction({
  description:
    'Read which models each model provider shows in the chat model picker and the default-model select. Each provider has a personal ("user") and an organization ("org") selection, stored at the same scope as its key; the one in effect follows the key in effect (a personal key uses the personal selection). models: null in a row means nothing is chosen there, so the provider shows its recommendedModels. state "unreadable" means the selection could not be read, not that it is empty. Change a selection with manage-provider-models.',
  schema: z.object({
    provider: z
      .enum(PROVIDER_MODEL_SELECTION_PROVIDERS as [string, ...string[]])
      .optional()
      .describe(
        "Provider id, e.g. builder, openai, anthropic, ollama. Omit for every provider.",
      ),
    scope: z
      .enum(["user", "org"])
      .optional()
      .describe(
        "Only read this scope's row. Omit to read both (org only when there is an active organization).",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    const selectionCtx = { userEmail: ctx.userEmail, orgId: ctx.orgId ?? null };
    if (args.scope === "org" && !selectionCtx.orgId) {
      fail("Organization scope needs an active organization.", {
        statusCode: 400,
      });
    }
    const scopes: ProviderModelSelectionScope[] = args.scope
      ? [args.scope]
      : selectionCtx.orgId
        ? ["user", "org"]
        : ["user"];
    const providers = (
      args.provider ? [args.provider] : PROVIDER_MODEL_SELECTION_PROVIDERS
    ) as ProviderModelSelectionProvider[];

    try {
      const entries = await Promise.all(
        providers.map(async (provider) => {
          const effective = await resolveEffectiveProviderModelSelection(
            provider,
            selectionCtx,
          );
          const rows: Partial<
            Record<ProviderModelSelectionScope, ProviderModelSelectionRow>
          > = {};
          for (const scope of scopes) {
            rows[scope] = await readProviderModelSelection(
              selectionCtx,
              provider,
              scope,
            );
          }
          return {
            provider,
            label: providerLabel(provider),
            recommendedModels: [...recommendedProviderModels(provider)],
            state: effective.state,
            ...(effective.state === "unreadable"
              ? { error: effective.error }
              : { scope: effective.scope }),
            models:
              effective.state === "selected"
                ? effective.models
                : [...recommendedProviderModels(provider)],
            rows,
          };
        }),
      );
      return {
        providers: entries,
        canManageOrg: selectionCtx.orgId
          ? canManageOrg(
              await getOrgRoleForEmail(selectionCtx.orgId, ctx.userEmail),
            )
          : false,
      };
    } catch (err) {
      if (err instanceof ProviderModelSelectionError) {
        fail(err.message, { statusCode: err.statusCode });
      }
      throw err;
    }
  },
});
