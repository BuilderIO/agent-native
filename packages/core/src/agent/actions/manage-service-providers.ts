import { z } from "zod";

import { defineAction, fail, type ActionRunContext } from "../../action.js";
import { auditAttribution } from "../../audit/attribution.js";
import { recordOrgAdminAuditEvent } from "../../audit/org-admin.js";
import { canManageOrg } from "../../org/permissions.js";
import {
  readSemanticSearchSetting,
  writeSemanticSearchSetting,
  type SemanticSearchSetting,
} from "../../search/semantic-setting.js";
import {
  forgetSemanticSearchForOrg,
  requeueSemanticSearchForOrg,
} from "../../search/semantic.js";
import {
  prefetchSecrets,
  resolveBuilderCredentialsDetailed,
} from "../../server/credential-provider.js";
import { readOrgMemberRole } from "../../server/personal-provider-key-policy.js";
import { runWithRequestContext } from "../../server/request-context.js";
import {
  resolveSecretWithAliasesDetailed,
  secretKeyNames,
} from "../../server/secret-key-aliases.js";
import {
  SERVICE_IDS,
  SERVICE_PROVIDER_KEYS,
  SERVICE_PROVIDER_OPTIONS,
  isServiceProviderOption,
  readServiceProviderSettings,
  serviceProviderOrder,
  writeServiceProviderChoice,
  type ServiceId,
  type ServiceProviderId,
  type ServiceProviderSettings,
} from "../../server/service-providers.js";

export const SERVICE_PROVIDERS_ADMIN_REQUIRED_ERROR_CODE =
  "service_providers_admin_required";

/**
 * What can power a provider for the caller:
 * - `org`: an organization key (or the organization's Builder.io connection).
 * - `personal`: only the caller's own key or connection.
 * - `none`: nothing yet.
 * - `unavailable`: the credential store could not be read. Retry; it is not "none".
 */
export type ServiceProviderKeyState =
  | "org"
  | "personal"
  | "none"
  | "unavailable";

export interface ServiceProviderOptionStatus {
  provider: ServiceProviderId;
  /** The secret this provider reads. Absent for Builder.io. */
  keyName?: string;
  keyState: ServiceProviderKeyState;
}

export interface ServiceProviderServiceStatus {
  service: ServiceId;
  /** The organization's choice, or null for the default order. */
  provider: ServiceProviderId | null;
  /**
   * The provider that would answer next, from the choice and the key states.
   * Null when nothing can.
   */
  effectiveProvider: ServiceProviderId | null;
  /** Every provider that can power this service, in default order. */
  options: ServiceProviderOptionStatus[];
}

export interface ServiceProvidersStatus {
  /** The caller is an owner or admin and may change the choices. */
  canManage: boolean;
  services: ServiceProviderServiceStatus[];
  /**
   * Whether apps search the organization's pages by meaning as well as by
   * words, sending page text and search queries to the Embeddings provider.
   * Null when the setting could not be read.
   */
  semanticSearch: SemanticSearchSetting | null;
  updatedAt: number | null;
  updatedBy: string | null;
  /** Set calls only: whether the choice actually changed. */
  changed?: boolean;
  /**
   * Set calls only: the provider that answers for Embeddings changed, so
   * existing vectors no longer match. Brain re-embeds through
   * `backfill-search-embeddings`; core search re-embeds on its own.
   */
  reindexRequired?: boolean;
}

async function readSemanticSearchState(
  orgId: string,
): Promise<SemanticSearchSetting | null> {
  try {
    return await readSemanticSearchSetting(orgId);
  } catch (error) {
    console.warn(
      "[service-providers] Reading the semantic search setting failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

const ALL_PROVIDERS = Array.from(
  new Set(Object.values(SERVICE_PROVIDER_OPTIONS).flat()),
) as [ServiceProviderId, ...ServiceProviderId[]];

async function readBuilderState(): Promise<ServiceProviderKeyState> {
  try {
    const detailed = await resolveBuilderCredentialsDetailed();
    if (detailed.privateKey && detailed.publicKey && detailed.source) {
      return detailed.source === "user" ? "personal" : "org";
    }
    return detailed.lookupFailed ? "unavailable" : "none";
  } catch {
    return "unavailable";
  }
}

async function readKeyState(key: string): Promise<ServiceProviderKeyState> {
  try {
    const shared = await resolveSecretWithAliasesDetailed(key, {
      skipUserScope: true,
    });
    if (shared.value) return "org";
    const any = await resolveSecretWithAliasesDetailed(key);
    if (any.value) return any.source === "user" ? "personal" : "org";
    return shared.lookupFailed || any.lookupFailed ? "unavailable" : "none";
  } catch {
    return "unavailable";
  }
}

async function readProviderStates(): Promise<
  Map<ServiceProviderId, ServiceProviderKeyState>
> {
  const keys = Object.values(SERVICE_PROVIDER_KEYS);
  // One read per scope for every key below. A failure leaves each lookup to
  // run, and report, on its own.
  await prefetchSecrets(keys.flatMap((key) => secretKeyNames(key))).catch(
    () => undefined,
  );
  const entries = await Promise.all(
    ALL_PROVIDERS.map(
      async (provider) =>
        [
          provider,
          provider === "builder"
            ? await readBuilderState()
            : await readKeyState(SERVICE_PROVIDER_KEYS[provider]),
        ] as const,
    ),
  );
  return new Map(entries);
}

function effectiveProviderFor(
  service: ServiceId,
  choice: ServiceProviderId | null,
  states: Map<ServiceProviderId, ServiceProviderKeyState>,
): ServiceProviderId | null {
  const usable = (provider: ServiceProviderId) => {
    const state = states.get(provider);
    return state === "org" || state === "personal";
  };
  // Embeddings don't fall back past a choice: vectors from another provider
  // don't match the index built for the chosen one.
  if (service === "embeddings" && choice) {
    return usable(choice) ? choice : null;
  }
  return (
    serviceProviderOrder(service, choice as never).find((provider) =>
      usable(provider as ServiceProviderId),
    ) ?? null
  );
}

function buildStatus(
  settings: ServiceProviderSettings,
  states: Map<ServiceProviderId, ServiceProviderKeyState>,
  canManage: boolean,
  semanticSearch: SemanticSearchSetting | null,
): ServiceProvidersStatus {
  return {
    canManage,
    semanticSearch,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
    services: SERVICE_IDS.map((service) => {
      const choice = (settings.choices[service] ??
        null) as ServiceProviderId | null;
      return {
        service,
        provider: choice,
        effectiveProvider: effectiveProviderFor(service, choice, states),
        options: (
          SERVICE_PROVIDER_OPTIONS[service] as readonly ServiceProviderId[]
        ).map((provider) => ({
          provider,
          ...(provider === "builder"
            ? {}
            : { keyName: SERVICE_PROVIDER_KEYS[provider] }),
          keyState: states.get(provider) ?? "unavailable",
        })),
      };
    }),
  };
}

const SERVICE_LABELS: Record<ServiceId, string> = {
  voice: "Voice input",
  images: "Image generation",
  embeddings: "Embeddings",
};

async function recordChoiceAudit(
  ctx: ActionRunContext | undefined,
  input: {
    email: string;
    orgId: string;
    service: ServiceId;
    provider: ServiceProviderId | null;
    status: "success" | "denied";
  },
): Promise<void> {
  const label = SERVICE_LABELS[input.service];
  await recordOrgAdminAuditEvent({
    action: ctx?.actionName ?? "manage-service-providers",
    targetType: "service-providers",
    targetId: input.service,
    summary:
      input.status === "denied"
        ? `Refused a change to the ${label} provider`
        : input.provider
          ? `Set the ${label} provider to ${input.provider}`
          : `Reset the ${label} provider to the default`,
    userEmail: input.email,
    orgId: input.orgId,
    status: input.status,
    attribution: auditAttribution(ctx),
    args: { service: input.service, provider: input.provider },
  });
}

async function recordSemanticSearchAudit(
  ctx: ActionRunContext | undefined,
  input: {
    email: string;
    orgId: string;
    enabled: boolean;
    status: "success" | "denied";
  },
): Promise<void> {
  await recordOrgAdminAuditEvent({
    action: ctx?.actionName ?? "manage-service-providers",
    targetType: "service-providers",
    targetId: "semantic-search",
    summary:
      input.status === "denied"
        ? `Refused to turn semantic search ${input.enabled ? "on" : "off"}`
        : `Turned semantic search ${input.enabled ? "on" : "off"}`,
    userEmail: input.email,
    orgId: input.orgId,
    status: input.status,
    attribution: auditAttribution(ctx),
    args: { semanticSearch: input.enabled },
  });
}

export default defineAction({
  description:
    'Read or change which provider powers each organization service: Voice input (dictation in every app), Image generation (Slides and Design), and Embeddings (semantic search in Brain). Providers: voice builder, gemini, groq, openai; images builder, gemini, openai; embeddings builder, gemini, cohere, voyage. Omit `provider` to read: each service returns the organization\'s choice (null means the default order, Builder.io first), the provider that answers next, and each option\'s key state ("org", "personal", "none", or "unavailable"). Pass `service` and `provider` to change one; owners and admins only. "builder" returns a service to Builder.io, and null resets it to the default order. Voice and images fall back through the other providers when the chosen one has no key; embeddings use only the chosen provider. A non-Builder provider needs its API key saved for the organization (see keyName). Changing embeddings means Brain must re-index (backfill-search-embeddings) before semantic search covers existing items; page search in apps like Content re-embeds on its own. Pass `semanticSearch` (true or false) to turn search by meaning on or off for the organization; owners and admins only. It is on by default; off stops sending page text and search queries to the Embeddings provider and deletes stored page vectors, and searches then match words only. A member\'s own Voice source setting (Mac native, Google realtime, or a specific batch provider) still wins over the organization choice.',
  schema: z.object({
    service: z
      .enum(SERVICE_IDS as [ServiceId, ...ServiceId[]])
      .optional()
      .describe("The service to change. Required with `provider`."),
    provider: z
      .enum(ALL_PROVIDERS)
      .nullable()
      .optional()
      .describe(
        "The provider for `service`, or null to reset it to the default order. Omit to read.",
      ),
    semanticSearch: z
      .boolean()
      .optional()
      .describe(
        "Turn search by meaning on (true) or off (false) for the organization. Omit to leave it.",
      ),
  }),
  http: { method: "POST" },
  // A read must not announce a change, or every query keyed on actions
  // refetches after each read.
  planMode: {
    effect: (args) =>
      args.provider === undefined && args.semanticSearch === undefined
        ? "read"
        : "write",
    omittedProperties: ["provider", "semanticSearch"],
  },
  // Rerouting the organization's dictation audio and documents to another
  // provider is not something a sandboxed extension should be able to do.
  toolCallable: false,
  // Only real changes (and refused ones) are recorded, below.
  audit: { enabled: false },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args, ctx): Promise<ServiceProvidersStatus> => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    const orgId = ctx?.orgId?.trim();
    if (!email) fail("Sign in to manage services.", { statusCode: 401 });
    if (!orgId) {
      fail("Select an organization to manage services.", { statusCode: 400 });
    }

    const role = await readOrgMemberRole(orgId, email);
    if (!role) {
      fail("You aren't a member of this organization.", { statusCode: 403 });
    }
    const canManage = canManageOrg(role);
    const inContext = <T>(fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail: email, orgId }, fn) as Promise<T>;

    if (args.semanticSearch !== undefined) {
      if (args.provider !== undefined) {
        fail("Change `semanticSearch` and a provider in separate calls.", {
          statusCode: 400,
        });
      }
      const enabled = args.semanticSearch;
      if (!canManage) {
        await recordSemanticSearchAudit(ctx, {
          email,
          orgId,
          enabled,
          status: "denied",
        });
        fail("Only organization owners and admins can change services.", {
          statusCode: 403,
          errorCode: SERVICE_PROVIDERS_ADMIN_REQUIRED_ERROR_CODE,
        });
      }
      const { before, after } = await writeSemanticSearchSetting(orgId, {
        enabled,
        updatedBy: email,
      });
      const changed = before.enabled !== after.enabled;
      if (changed) {
        await recordSemanticSearchAudit(ctx, {
          email,
          orgId,
          enabled,
          status: "success",
        });
      }
      // Run on every call, not only on a change, so calling again finishes
      // a call that failed part way.
      try {
        if (enabled) await requeueSemanticSearchForOrg(orgId);
        else await forgetSemanticSearchForOrg(orgId);
      } catch (cause) {
        console.error(
          `[manage-service-providers] Semantic search was turned ${enabled ? "on" : "off"}, but finishing that failed:`,
          cause instanceof Error ? cause.message : String(cause),
        );
        fail(
          enabled
            ? "Semantic search is on, but queuing pages to embed again failed. Try again to finish."
            : "Semantic search is off, so nothing new is embedded or searched, but deleting stored embeddings failed. Try again to finish.",
          { statusCode: 500 },
        );
      }
      const [settings, states] = await Promise.all([
        readServiceProviderSettings(orgId),
        inContext(readProviderStates),
      ]);
      return { ...buildStatus(settings, states, canManage, after), changed };
    }

    if (args.provider === undefined) {
      const [settings, states, semanticSearch] = await Promise.all([
        readServiceProviderSettings(orgId),
        inContext(readProviderStates),
        readSemanticSearchState(orgId),
      ]);
      return buildStatus(settings, states, canManage, semanticSearch);
    }

    const service = args.service;
    if (!service) {
      fail("Pass `service` with `provider`.", { statusCode: 400 });
    }
    const provider = args.provider;
    if (provider !== null && !isServiceProviderOption(service, provider)) {
      fail(
        `${String(provider)} can't power ${SERVICE_LABELS[service]}. Choose one of: ${SERVICE_PROVIDER_OPTIONS[service].join(", ")}.`,
        { statusCode: 400 },
      );
    }
    if (!canManage) {
      await recordChoiceAudit(ctx, {
        email,
        orgId,
        service,
        provider,
        status: "denied",
      });
      fail("Only organization owners and admins can change services.", {
        statusCode: 403,
        errorCode: SERVICE_PROVIDERS_ADMIN_REQUIRED_ERROR_CODE,
      });
    }

    const { settings, previous, changed } = await writeServiceProviderChoice(
      orgId,
      {
        service,
        provider: provider as ServiceProviderId<typeof service> | null,
        updatedBy: email,
      },
    );
    if (changed) {
      await recordChoiceAudit(ctx, {
        email,
        orgId,
        service,
        provider,
        status: "success",
      });
    }
    const [states, semanticSearch] = await Promise.all([
      inContext(readProviderStates),
      readSemanticSearchState(orgId),
    ]);
    const reindexRequired =
      service === "embeddings" &&
      effectiveProviderFor(service, previous, states) !==
        effectiveProviderFor(service, provider, states);
    // Page vectors from the old provider don't match searches with the new one.
    if (reindexRequired) await requeueSemanticSearchForOrg(orgId);
    return {
      ...buildStatus(settings, states, canManage, semanticSearch),
      changed,
      ...(reindexRequired ? { reindexRequired: true } : {}),
    };
  },
});
