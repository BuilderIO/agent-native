/**
 * Pure derivations for Settings › Model and the provider dialog, from the
 * `list-model-providers` and `get-provider-models` reads. Components render
 * these; every write goes through the actions and helpers they name.
 */

import type {
  ModelProviderEntry,
  ModelProviderKey,
  ModelProviderKeyScope,
  ModelProvidersListing,
} from "../../../agent/actions/list-model-providers.js";
import {
  AGENT_PROVIDER_CATALOG,
  getAgentProviderOption,
  providerIdForEngine,
  type AgentProviderId,
} from "../../agent-provider-catalog.js";

export type {
  ModelProviderEntry,
  ModelProviderKey,
  ModelProviderKeyScope,
  ModelProvidersListing,
};

export const BUILDER_ENGINE = "builder";

/** The `get-provider-models` fields the Model page reads. */
export interface ProviderModelsRead {
  providers: Array<{
    provider: string;
    recommendedModels: string[];
    rows: Partial<
      Record<ModelProviderKeyScope, { models: string[] | null } | undefined>
    >;
  }>;
}

/** Checked models at `scope`, or the provider's recommended ones when none are. */
export function selectedModelsAt(
  read: ProviderModelsRead | undefined,
  provider: string,
  scope: ModelProviderKeyScope,
): string[] | null {
  const entry = read?.providers.find((item) => item.provider === provider);
  if (!entry) return null;
  return entry.rows[scope]?.models ?? entry.recommendedModels;
}

/** The models checked at `scope`, or null when nothing is chosen there. */
export function explicitSelectionAt(
  read: ProviderModelsRead | undefined,
  provider: string,
  scope: ModelProviderKeyScope,
): string[] | null {
  const entry = read?.providers.find((item) => item.provider === provider);
  return entry?.rows[scope]?.models ?? null;
}

export function recommendedModels(
  read: ProviderModelsRead | undefined,
  provider: string,
): string[] {
  const entry = read?.providers.find((item) => item.provider === provider);
  return entry?.recommendedModels ?? [];
}

export interface ProviderKeyRow {
  provider: AgentProviderId;
  label: string;
  key: ModelProviderKey;
  /** Null until `get-provider-models` answers. */
  modelCount: number | null;
  /** A member's personal key while personal API keys are restricted. */
  restricted: boolean;
}

export interface ProviderRows {
  org: ProviderKeyRow[];
  personal: ProviderKeyRow[];
}

export function providerRows(
  listing: ModelProvidersListing,
  models: ProviderModelsRead | undefined,
): ProviderRows {
  const rows: ProviderRows = { org: [], personal: [] };
  for (const entry of listing.providers) {
    if (entry.org) {
      rows.org.push({
        provider: entry.provider,
        label: entry.label,
        key: entry.org,
        modelCount:
          selectedModelsAt(models, entry.provider, "org")?.length ?? null,
        restricted: false,
      });
    }
    if (entry.personal) {
      rows.personal.push({
        provider: entry.provider,
        label: entry.label,
        key: entry.personal,
        modelCount:
          selectedModelsAt(models, entry.provider, "user")?.length ?? null,
        restricted: listing.personalKeysRestricted,
      });
    }
  }
  return rows;
}

/**
 * Providers the Add dialog offers: ones the viewer hasn't added yet. Owners
 * and admins add at either scope, so a provider with a key at either one is
 * managed from its row instead. Members add personal keys, alongside the
 * organization's, unless personal API keys are restricted.
 */
export function addableProviders(
  listing: ModelProvidersListing,
): AgentProviderId[] {
  if (listing.personalKeysRestricted) return [];
  return listing.providers
    .filter((entry) =>
      listing.canManageOrg ? !entry.org && !entry.personal : !entry.personal,
    )
    .map((entry) => entry.provider);
}

/**
 * The saved key of `provider` the viewer may overwrite, or null. A rejected
 * key wins, then the personal one, which chats use before the
 * organization's.
 */
export function replaceableKey(
  listing: ModelProvidersListing,
  provider: AgentProviderId,
  options: { rejectedOnly?: boolean } = {},
): ModelProviderKey | null {
  const entry = listing.providers.find((item) => item.provider === provider);
  if (!entry) return null;
  const keys = [
    listing.personalKeysRestricted ? null : entry.personal,
    listing.canManageOrg ? entry.org : null,
  ].filter((key): key is ModelProviderKey => key !== null);
  return (
    keys.find((key) => key.rejectedAt) ??
    (options.rejectedOnly ? null : (keys[0] ?? null))
  );
}

export interface AddDialogChoice {
  provider: AgentProviderId;
  /** The saved key choosing this provider overwrites, or null for a new one. */
  replaces: ModelProviderKey | null;
}

/**
 * What the Add dialog's provider select offers: providers the viewer hasn't
 * added, plus any with a rejected key they may replace, since chat recovery
 * opens this dialog when a provider rejects a key. With nothing new to add,
 * it offers the saved keys the viewer manages, each as a replace. `limit`
 * narrows the choice to the providers a caller names.
 */
export function addDialogChoices(
  listing: ModelProvidersListing,
  limit?: readonly AgentProviderId[],
): AddDialogChoice[] {
  if (listing.personalKeysRestricted) return [];
  const addable = new Set(addableProviders(listing));
  const choice = (provider: AgentProviderId): AddDialogChoice => ({
    provider,
    replaces: addable.has(provider) ? null : replaceableKey(listing, provider),
  });
  const all = listing.providers.map((entry) => entry.provider);
  const allowed = (provider: AgentProviderId) =>
    !limit || limit.includes(provider);
  const offered = all.filter(
    (provider) =>
      allowed(provider) &&
      (addable.has(provider) ||
        replaceableKey(listing, provider, { rejectedOnly: true }) !== null),
  );
  if (offered.length > 0) return offered.map(choice);
  return all
    .filter(
      (provider) =>
        allowed(provider) && replaceableKey(listing, provider) !== null,
    )
    .map(choice);
}

export function engineForProvider(provider: AgentProviderId | "builder") {
  return provider === "builder"
    ? BUILDER_ENGINE
    : getAgentProviderOption(provider).engine;
}

export function providerForEngine(
  engine: string,
): AgentProviderId | "builder" | null {
  if (engine === BUILDER_ENGINE) return "builder";
  return providerIdForEngine(engine);
}

export interface DefaultModelGroup {
  engine: string;
  provider: AgentProviderId | "builder";
  label: string;
  models: string[];
}

/**
 * What the Default model select offers. It sets the organization's default,
 * so only organization providers are listed (Builder.io first when the
 * organization is connected), each with its organization-checked models. A
 * rejected key offers nothing until it's replaced. Without an organization
 * the default is the user's own, so their personal keys fill it instead.
 */
export function defaultModelGroups(input: {
  listing: ModelProvidersListing;
  models: ProviderModelsRead | undefined;
  builderConnected: boolean;
  builderLabel: string;
}): DefaultModelGroup[] {
  const { listing, models } = input;
  const scope: ModelProviderKeyScope = listing.hasOrganization ? "org" : "user";
  const groups: DefaultModelGroup[] = [];
  if (input.builderConnected) {
    const builderModels = selectedModelsAt(models, "builder", scope) ?? [];
    if (builderModels.length > 0) {
      groups.push({
        engine: BUILDER_ENGINE,
        provider: "builder",
        label: input.builderLabel,
        models: builderModels,
      });
    }
  }
  for (const entry of listing.providers) {
    const key = scope === "org" ? entry.org : entry.personal;
    if (!key || key.rejectedAt) continue;
    const checked = selectedModelsAt(models, entry.provider, scope) ?? [];
    if (checked.length === 0) continue;
    groups.push({
      engine: engineForProvider(entry.provider),
      provider: entry.provider,
      label: entry.label,
      models: checked,
    });
  }
  return groups;
}

/** The select's value for one engine and model. */
export function defaultModelValue(engine: string, model: string): string {
  return JSON.stringify([engine, model]);
}

export function parseDefaultModelValue(
  value: string,
): { engine: string; model: string } | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { engine: parsed[0], model: parsed[1] };
    }
    // coercion-ok: null means "not a value this select produced"; callers ignore it.
  } catch {
    // Unparseable, so not one of this select's values either.
  }
  return null;
}

/** "gateway.example" from "https://gateway.example/v1". */
export function hostOf(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? url;
}

/** The mask and endpoint host a key row shows, in order (Ollama has no mask). */
export function keyDetailParts(key: ModelProviderKey): string[] {
  const parts: string[] = [];
  if (key.masked) parts.push(key.masked);
  if (key.endpoint) parts.push(hostOf(key.endpoint));
  return parts;
}

/** The host a provider's keys are created at, e.g. "console.anthropic.com". */
export function keyConsoleHost(provider: AgentProviderId): string | null {
  const docsUrl = getAgentProviderOption(provider).docsUrl;
  return docsUrl ? hostOf(docsUrl) : null;
}

export function providerLabel(provider: AgentProviderId): string {
  return (
    AGENT_PROVIDER_CATALOG.find((option) => option.id === provider)?.label ??
    provider
  );
}
