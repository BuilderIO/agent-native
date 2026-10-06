/**
 * Which provider powers each organization service: Voice input, Image
 * generation, and Embeddings. Owners and admins pick one per service in
 * Settings › Infrastructure (the `manage-service-providers` action); the voice,
 * image, and embedding resolvers read it here. Unset means each service's
 * default order, which is also the order the options are listed in.
 *
 * Stored as the org setting `service-providers`:
 * `{ voice?, images?, embeddings?, updatedAt, updatedBy }`.
 */

import { getOrgSetting, mutateOrgSetting } from "../settings/org-settings.js";
import { getRequestOrgId } from "./request-context.js";

export const SERVICE_PROVIDERS_SETTING_KEY = "service-providers";

/**
 * Each service's providers in its default order: the one used when the
 * organization hasn't chosen, then the fallbacks.
 */
export const SERVICE_PROVIDER_OPTIONS = {
  voice: ["builder", "gemini", "groq", "openai"],
  images: ["builder", "gemini", "openai"],
  embeddings: ["builder", "gemini", "cohere", "voyage"],
} as const;

export type ServiceId = keyof typeof SERVICE_PROVIDER_OPTIONS;

export const SERVICE_IDS = Object.keys(SERVICE_PROVIDER_OPTIONS) as ServiceId[];

export type ServiceProviderId<S extends ServiceId = ServiceId> =
  (typeof SERVICE_PROVIDER_OPTIONS)[S][number];

export type ServiceProviderChoices = {
  [S in ServiceId]?: ServiceProviderId<S>;
};

export interface ServiceProviderSettings {
  choices: ServiceProviderChoices;
  updatedAt: number | null;
  updatedBy: string | null;
}

/**
 * The secret each non-Builder provider reads. Gemini is the one key chat and
 * services share (`GOOGLE_GENERATIVE_AI_API_KEY`; older `GEMINI_API_KEY` rows
 * still resolve).
 */
export const SERVICE_PROVIDER_KEYS: Record<
  Exclude<ServiceProviderId, "builder">,
  string
> = {
  gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  cohere: "COHERE_API_KEY",
  voyage: "VOYAGE_API_KEY",
};

export function isServiceId(value: unknown): value is ServiceId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SERVICE_PROVIDER_OPTIONS, value)
  );
}

export function isServiceProviderOption<S extends ServiceId>(
  service: S,
  provider: unknown,
): provider is ServiceProviderId<S> {
  return (
    typeof provider === "string" &&
    (SERVICE_PROVIDER_OPTIONS[service] as readonly string[]).includes(provider)
  );
}

/** The providers to try for `service`: the choice first, then the default order. */
export function serviceProviderOrder<S extends ServiceId>(
  service: S,
  choice?: ServiceProviderId<S> | null,
): ServiceProviderId<S>[] {
  const defaults = SERVICE_PROVIDER_OPTIONS[
    service
  ] as readonly ServiceProviderId<S>[];
  return choice
    ? [choice, ...defaults.filter((provider) => provider !== choice)]
    : [...defaults];
}

function parseSettings(
  row: Record<string, unknown> | null,
): ServiceProviderSettings {
  const choices: ServiceProviderChoices = {};
  for (const service of SERVICE_IDS) {
    const value = row?.[service];
    // A value this version doesn't offer is dropped, so resolution falls
    // back to the default order instead of trying a provider it can't call.
    if (isServiceProviderOption(service, value)) {
      (choices as Record<string, string>)[service] = value;
    }
  }
  return {
    choices,
    updatedAt: typeof row?.updatedAt === "number" ? row.updatedAt : null,
    updatedBy: typeof row?.updatedBy === "string" ? row.updatedBy : null,
  };
}

/** Throws when the settings store cannot be read; never reports "unset" instead. */
export async function readServiceProviderSettings(
  orgId: string,
): Promise<ServiceProviderSettings> {
  return parseSettings(
    await getOrgSetting(orgId, SERVICE_PROVIDERS_SETTING_KEY),
  );
}

/** Set (or with `provider: null`, clear) one service's choice. */
export async function writeServiceProviderChoice<S extends ServiceId>(
  orgId: string,
  input: {
    service: S;
    provider: ServiceProviderId<S> | null;
    updatedBy: string;
  },
): Promise<{
  settings: ServiceProviderSettings;
  previous: ServiceProviderId<S> | null;
  changed: boolean;
}> {
  if (!isServiceId(input.service)) {
    throw new Error(`Unknown service: ${String(input.service)}`);
  }
  if (
    input.provider !== null &&
    !isServiceProviderOption(input.service, input.provider)
  ) {
    throw new Error(
      `${String(input.provider)} can't power ${input.service}. Choose one of: ${SERVICE_PROVIDER_OPTIONS[input.service].join(", ")}.`,
    );
  }
  let previous: ServiceProviderId<S> | null = null;
  const row = await mutateOrgSetting(
    orgId,
    SERVICE_PROVIDERS_SETTING_KEY,
    (current) => {
      const parsed = parseSettings(current);
      previous =
        (parsed.choices[input.service] as ServiceProviderId<S> | undefined) ??
        null;
      const next: Record<string, unknown> = { ...parsed.choices };
      if (input.provider === null) delete next[input.service];
      else next[input.service] = input.provider;
      return { ...next, updatedAt: Date.now(), updatedBy: input.updatedBy };
    },
  );
  return {
    settings: parseSettings(row),
    previous,
    changed: previous !== input.provider,
  };
}

/**
 * The organization's choice for `service`, or null when it hasn't chosen or
 * there is no organization. `orgId` undefined means the request's org.
 * Throws when the setting cannot be read, so callers can report a failed
 * lookup instead of quietly using the default order.
 */
export async function readServiceProviderChoice<S extends ServiceId>(
  service: S,
  options: { orgId?: string | null } = {},
): Promise<ServiceProviderId<S> | null> {
  const orgId = options.orgId !== undefined ? options.orgId : getRequestOrgId();
  if (!orgId) return null;
  const settings = await readServiceProviderSettings(orgId);
  return (
    (settings.choices[service] as ServiceProviderId<S> | undefined) ?? null
  );
}
