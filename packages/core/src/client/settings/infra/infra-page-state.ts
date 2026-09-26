import type {
  ServiceProviderKeyState,
  ServiceProviderServiceStatus,
  ServiceProvidersStatus,
} from "../../../agent/actions/manage-service-providers.js";
import type { FileStorageStatus } from "../../../file-upload/storage-settings.js";
import type { DeployPlatform } from "../../../server/deploy-environment.js";
import type {
  InfrastructureApp,
  InfrastructureDatabaseProvider,
  InfrastructureVariable,
} from "../../../server/infrastructure-status.js";
import type { AgentProviderId } from "../../agent-provider-catalog.js";
import type { ModelProvidersListing } from "../model/model-page-state.js";

export type ServiceId = ServiceProviderServiceStatus["service"];
export type ServiceProviderId =
  ServiceProviderServiceStatus["options"][number]["provider"];

/** Brand names, never translated. */
export const BUILDER_LABEL = "Builder.io"; // i18n-ignore -- brand name

export const SERVICE_PROVIDER_LABELS: Record<ServiceProviderId, string> = {
  builder: BUILDER_LABEL,
  gemini: "Google Gemini", // i18n-ignore -- provider brand name
  groq: "Groq", // i18n-ignore -- provider brand name
  openai: "OpenAI", // i18n-ignore -- provider brand name
  cohere: "Cohere", // i18n-ignore -- provider brand name
  voyage: "Voyage AI", // i18n-ignore -- provider brand name
};

/** Logo ids in `mcp-integration-logos`; Voyage has none. */
export const SERVICE_PROVIDER_LOGOS: Record<ServiceProviderId, string | null> =
  {
    builder: "builder-cms",
    gemini: "google-gemini",
    groq: "groq",
    openai: "openai",
    cohere: "cohere",
    voyage: null,
  };

/**
 * The provider dialog that adds each service provider's organization key.
 * Voyage isn't a chat provider, so its key is an ordinary API key
 * (`SERVICE_PROVIDER_API_KEY_NAMES`).
 */
export const SERVICE_PROVIDER_AGENT_IDS: Record<
  ServiceProviderId,
  AgentProviderId | null
> = {
  builder: null,
  gemini: "google",
  groq: "groq",
  openai: "openai",
  cohere: "cohere",
  voyage: null,
};

/** The API key a provider with no chat provider reads, e.g. Voyage's. */
export const SERVICE_PROVIDER_API_KEY_NAMES: Partial<
  Record<ServiceProviderId, string>
> = {
  voyage: "VOYAGE_API_KEY",
};

export const AGENT_PROVIDER_LOGOS: Partial<Record<AgentProviderId, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
  google: "google-gemini",
  groq: "groq",
  mistral: "mistral",
  cohere: "cohere",
};

export const DATABASE_PROVIDER_LABELS: Record<
  InfrastructureDatabaseProvider,
  string
> = {
  neon: "Neon Postgres", // i18n-ignore -- provider brand name
  supabase: "Supabase Postgres", // i18n-ignore -- provider brand name
  "aws-rds": "Amazon RDS Postgres", // i18n-ignore -- provider brand name
  postgres: "Postgres", // i18n-ignore -- product name
  pglite: "PGlite", // i18n-ignore -- product name
};

export const DATABASE_PROVIDER_LOGOS: Partial<
  Record<InfrastructureDatabaseProvider, string>
> = { neon: "neon", supabase: "supabase" };

/** Hosts by brand; `node` and `local` are described, so they're translated. */
export const HOSTING_PLATFORM_LABELS: Partial<Record<DeployPlatform, string>> =
  {
    netlify: "Netlify", // i18n-ignore -- provider brand name
    vercel: "Vercel", // i18n-ignore -- provider brand name
    cloudflare: "Cloudflare", // i18n-ignore -- provider brand name
    render: "Render", // i18n-ignore -- provider brand name
    fly: "Fly.io", // i18n-ignore -- provider brand name
    "cloud-run": "Google Cloud Run", // i18n-ignore -- provider brand name
    "aws-lambda": "AWS Lambda", // i18n-ignore -- provider brand name
  };

export const HOSTING_PLATFORM_LOGOS: Partial<Record<DeployPlatform, string>> = {
  netlify: "netlify",
  vercel: "vercel",
  cloudflare: "cloudflare",
};

const usable = (state: ServiceProviderKeyState | undefined) =>
  state === "org" || state === "personal";

export function keyStateOf(
  service: ServiceProviderServiceStatus,
  provider: ServiceProviderId,
): ServiceProviderKeyState {
  return (
    service.options.find((option) => option.provider === provider)?.keyState ??
    "unavailable"
  );
}

/**
 * The providers the service dialog offers: Builder.io while it can answer
 * (or is the saved choice), then every provider whose key can power it.
 */
export function serviceDialogChoices(
  service: ServiceProviderServiceStatus,
): ServiceProviderId[] {
  return service.options
    .filter(
      (option) =>
        option.provider !== "builder" ||
        usable(option.keyState) ||
        service.provider === "builder",
    )
    .map((option) => option.provider);
}

/** Opens on what answers now, else the first provider with an organization key. */
export function initialServiceChoice(
  service: ServiceProviderServiceStatus,
): ServiceProviderId {
  const choices = serviceDialogChoices(service);
  const current = service.provider ?? service.effectiveProvider;
  if (current && choices.includes(current)) return current;
  const withKey = service.options.find(
    (option) => option.provider !== "builder" && option.keyState === "org",
  );
  return (
    withKey?.provider ??
    choices.find((provider) => provider !== "builder") ??
    choices[0]!
  );
}

export type ServiceDialogStep =
  /** Builder.io is selected: return the service to it. */
  | { kind: "use-builder" }
  /** An organization key (or an unreadable one) is there: save the choice. */
  | { kind: "save" }
  /** No organization key yet: add one first, then use it. */
  | { kind: "add"; agentProvider: AgentProviderId | null };

/** The dialog's primary button is always the next step for the selection. */
export function serviceDialogStep(
  service: ServiceProviderServiceStatus,
  provider: ServiceProviderId,
): ServiceDialogStep {
  if (provider === "builder") return { kind: "use-builder" };
  const state = keyStateOf(service, provider);
  if (state === "org" || state === "unavailable") return { kind: "save" };
  return { kind: "add", agentProvider: SERVICE_PROVIDER_AGENT_IDS[provider] };
}

/**
 * The status as it will read once `provider` is saved for `service`, so the
 * row changes before the round trip. The server's answer replaces it.
 */
export function optimisticServiceStatus(
  status: ServiceProvidersStatus,
  service: ServiceId,
  provider: ServiceProviderId,
): ServiceProvidersStatus {
  return {
    ...status,
    services: status.services.map((entry) =>
      entry.service === service
        ? {
            ...entry,
            provider,
            effectiveProvider: usable(keyStateOf(entry, provider))
              ? provider
              : entry.effectiveProvider,
          }
        : entry,
    ),
  };
}

/**
 * Who answers for the AI model: Builder.io while it's connected, then each
 * provider with a working key at the page's scope (the organization's, or the
 * only user's without one).
 */
export function aiModelSources(
  listing: ModelProvidersListing,
  builderConnected: boolean,
): { labels: string[]; lead: AgentProviderId | "builder" | null } {
  const providers = listing.providers.filter((entry) => {
    const key = listing.hasOrganization ? entry.org : entry.personal;
    return !!key && !key.rejectedAt;
  });
  const labels = [
    ...(builderConnected ? [BUILDER_LABEL] : []),
    ...providers.map((entry) => entry.label),
  ];
  return {
    labels,
    lead: builderConnected ? "builder" : (providers[0]?.provider ?? null),
  };
}

export type StorageSource =
  | {
      kind: "bucket";
      provider: NonNullable<FileStorageStatus["provider"]>;
      bucket: string;
    }
  | { kind: "builder" }
  | { kind: "none" };

export function storageSource(status: FileStorageStatus): StorageSource {
  if (status.configured && status.bucket) {
    return {
      kind: "bucket",
      provider: status.provider ?? "other",
      bucket: status.bucket,
    };
  }
  return status.activeProvider?.id === "builder"
    ? { kind: "builder" }
    : { kind: "none" };
}

/**
 * Each app's address: the manifest's own URL, else its mount path under the
 * gateway (or this page's origin, which serves every workspace app).
 */
export function appAddress(
  app: InfrastructureApp,
  gatewayUrl: string | null,
  origin: string,
): string {
  if (app.url) return app.url;
  const base = gatewayUrl ?? origin;
  if (!app.path) return base;
  try {
    return new URL(app.path, `${base.replace(/\/+$/, "")}/`).toString();
  } catch {
    // coercion-ok: a malformed gateway URL still shows the app's path rather than hiding the row.
    return `${base}${app.path}`;
  }
}

export function variablesSummary(
  variables: readonly InfrastructureVariable[],
): {
  required: InfrastructureVariable[];
  optional: InfrastructureVariable[];
  missing: string[];
} {
  const required = variables.filter((variable) => variable.required);
  return {
    required,
    optional: variables.filter((variable) => !variable.required),
    missing: required
      .filter((variable) => !variable.set)
      .map((variable) => variable.key),
  };
}
