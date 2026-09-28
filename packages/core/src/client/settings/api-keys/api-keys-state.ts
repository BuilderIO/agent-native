/**
 * Pure derivations for Settings › API keys from the `list-api-keys` read.
 * Components render these; nothing here fetches.
 */

import type {
  AddableApiKey,
  ApiKeyEntry,
  ApiKeysListing,
} from "../../../secrets/api-keys.js";
import { secretKeyNames } from "../../../secrets/key-aliases.js";
import {
  AGENT_PROVIDER_CATALOG,
  type AgentProviderId,
} from "../../agent-provider-catalog.js";
import { normalizeKeyName } from "../NewKeyMenu.js";

export type { AddableApiKey, ApiKeyEntry, ApiKeysListing };

/** Calendar tokens exist only once someone connects a calendar in Meetings. */
export const MEETINGS_LAB_KEY = "clips.meetings";
const MEETINGS_MANAGER_ID = "meetings";

export interface ApiKeyGroups {
  personal: ApiKeyEntry[];
  org: ApiKeyEntry[];
  managed: ApiKeyEntry[];
}

export function groupApiKeys(
  listing: ApiKeysListing,
  labs: Readonly<Record<string, boolean>>,
): ApiKeyGroups {
  return {
    personal: listing.keys.filter((entry) => entry.scope === "user"),
    org: listing.keys.filter((entry) => entry.scope === "org"),
    managed: listing.managed.filter(
      (entry) =>
        entry.managedBy?.id !== MEETINGS_MANAGER_ID || !!labs[MEETINGS_LAB_KEY],
    ),
  };
}

/** A managed key's owner page, from its `page` or `page/sub` route. */
export function settingsRouteParts(route: string): {
  page: string;
  sub?: string;
} {
  const [page = "", sub] = route.split("/").filter(Boolean);
  return sub ? { page, sub } : { page };
}

/**
 * Row anchor. Legacy `secrets:KEY` links land on the caller's own row; other
 * rows carry their scope so a name saved twice gets two ids.
 */
export function apiKeyRowId(entry: ApiKeyEntry): string {
  return entry.scope === "user" && entry.storedScope === "user"
    ? `secrets:${entry.name}`
    : `secrets:${entry.scope}-${entry.storedScope}:${entry.name}`;
}

export function apiKeyEntryId(entry: ApiKeyEntry): string {
  return `${entry.scope}:${entry.storedScope}:${entry.name}`;
}

/** Features other than the agent's models, which read as "Model" instead. */
export function usedByFeatures(entry: ApiKeyEntry): string[] {
  const features = entry.usedFor
    .filter((usage) => !(entry.provider && usage.feature === "Agent"))
    .map((usage) => usage.feature);
  return [...new Set(features)];
}

export function providerForKeyName(name: string): AgentProviderId | null {
  return (
    AGENT_PROVIDER_CATALOG.find(
      (option) =>
        (option.key && secretKeyNames(option.key).includes(name)) ||
        option.endpointKey === name,
    )?.id ?? null
  );
}

export type AddKeyTarget =
  | { kind: "empty" }
  | { kind: "provider"; provider: AgentProviderId }
  | { kind: "managed"; owner: string }
  | { kind: "registered"; key: AddableApiKey }
  | { kind: "custom"; name: string };

/** What saving a typed name would do, before the value is sent. */
export function addKeyTarget(
  rawName: string,
  listing: ApiKeysListing,
): AddKeyTarget {
  const name = normalizeKeyName(rawName);
  if (!name) return { kind: "empty" };
  const provider = providerForKeyName(name);
  if (provider) return { kind: "provider", provider };
  const managed = listing.managed.find((entry) => entry.name === name);
  if (managed?.managedBy) {
    return { kind: "managed", owner: managed.managedBy.owner };
  }
  const registered = listing.addable.find((key) => key.name === name);
  if (registered) return { kind: "registered", key: registered };
  const saved = listing.keys.find((entry) => entry.name === name);
  if (saved?.registered) {
    return {
      kind: "registered",
      key: {
        name,
        label: saved.label ?? name,
        ...(saved.docsUrl ? { docsUrl: saved.docsUrl } : {}),
        scope: saved.storedScope,
      },
    };
  }
  return { kind: "custom", name };
}

/** Registered keys matching a partly typed name, for the Name suggestions. */
export function addableSuggestions(
  rawName: string,
  listing: ApiKeysListing,
  limit = 4,
): AddableApiKey[] {
  const query = rawName.trim().toLowerCase();
  if (!query) return [];
  const normalized = normalizeKeyName(rawName);
  return listing.addable
    .filter(
      (key) =>
        key.name !== normalized &&
        (key.name.toLowerCase().includes(query) ||
          key.label.toLowerCase().includes(query)),
    )
    .slice(0, limit);
}

/** A `#secrets:KEY` hash names a key; the page scrolls to it or offers to add it. */
export function secretKeyFromHash(hash: string): string | null {
  const match = /^#?secrets:([A-Za-z0-9_-]+)$/.exec(hash.trim());
  return match?.[1] ?? null;
}
