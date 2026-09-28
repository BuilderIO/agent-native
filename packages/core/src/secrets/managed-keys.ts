/**
 * Keys another Settings surface creates and rotates. API keys lists them
 * read-only, and the secrets delete routes refuse them unless the owner
 * surface itself asks (see `isManagedDeleteAllowed`).
 */

import { listBuiltInChannelIntegrations } from "../integrations/catalog.js";
import { BUILDER_CREDENTIAL_KEYS } from "../server/builder-credential-keys.js";
import {
  getRequiredSecret,
  type SecretManagedBy,
  type SecretUsage,
} from "./register.js";

export const SECRET_MANAGERS = {
  builder: {
    id: "builder",
    owner: "Builder.io",
    route: "integrations/builder",
  },
  storage: {
    id: "storage",
    owner: "File uploads and storage",
    route: "infra",
  },
  channels: { id: "channels", owner: "Channels", route: "channels" },
  meetings: { id: "meetings", owner: "Meetings", route: "app/meetings" },
  integrations: {
    id: "integrations",
    owner: "Integrations",
    route: "integrations",
  },
  automations: {
    id: "automations",
    owner: "Automations",
    route: "automations",
  },
} as const satisfies Record<string, SecretManagedBy>;

export type SecretManagerId = keyof typeof SECRET_MANAGERS;

/** The S3-compatible storage fields the storage form reads and writes. */
export const S3_STORAGE_SECRET_KEYS = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_PUBLIC_BASE_URL",
] as const;

interface ManagedKeyRule {
  manager: SecretManagedBy;
  matches: (key: string) => boolean;
  usedFor: SecretUsage[];
}

function exact(keys: readonly string[]): (key: string) => boolean {
  const set = new Set(keys);
  return (key) => set.has(key);
}

function prefix(value: string): (key: string) => boolean {
  return (key) => key.startsWith(value);
}

// Email is left out on purpose: its Resend/SendGrid keys double as the app's
// transactional email, so removing one is not only a Channels change.
function channelCredentialKeys(): string[] {
  return listBuiltInChannelIntegrations()
    .filter((entry) => entry.id !== "email")
    .flatMap((entry) =>
      (entry.credentialRequirements ?? []).map((item) => item.key),
    );
}

let rules: ManagedKeyRule[] | null = null;

function managedKeyRules(): ManagedKeyRule[] {
  if (rules) return rules;
  const isChannelCredential = exact(channelCredentialKeys());
  rules = [
    {
      manager: SECRET_MANAGERS.builder,
      matches: exact(BUILDER_CREDENTIAL_KEYS),
      usedFor: [
        {
          feature: "Builder.io connection",
          effectWhenRemoved:
            "Disconnects Builder.io, and every service that runs on it stops or switches.",
        },
      ],
    },
    {
      manager: SECRET_MANAGERS.storage,
      matches: exact(S3_STORAGE_SECRET_KEYS),
      usedFor: [
        {
          feature: "File uploads and storage",
          effectWhenRemoved:
            "New uploads go to Builder.io storage, or fail until storage is set up again.",
        },
      ],
    },
    {
      manager: SECRET_MANAGERS.channels,
      matches: (key) =>
        isChannelCredential(key) ||
        (key.startsWith("integration:") &&
          key.endsWith(":oauth-token-bundle")) ||
        key.startsWith("clips-slack:"),
      usedFor: [
        {
          feature: "Channels",
          effectWhenRemoved: "The agent stops replying in that channel.",
        },
      ],
    },
    {
      manager: SECRET_MANAGERS.meetings,
      matches: prefix("clips-calendar:"),
      usedFor: [
        {
          appId: "clips",
          feature: "Meetings",
          effectWhenRemoved:
            "Upcoming meetings stop syncing from that calendar.",
        },
      ],
    },
    {
      manager: SECRET_MANAGERS.automations,
      matches: prefix("automation-webhook:"),
      usedFor: [
        {
          feature: "Automations",
          effectWhenRemoved: "The automation's webhook stops accepting calls.",
        },
      ],
    },
    {
      manager: SECRET_MANAGERS.integrations,
      matches: prefix("mcp_headers:"),
      usedFor: [
        {
          feature: "Custom integration",
          effectWhenRemoved: "The integration stops sending its saved headers.",
        },
      ],
    },
  ];
  return rules;
}

/**
 * Who owns a key, if anyone other than API keys does. A registered secret is
 * managed only when its registration says so: registering a key is how an app
 * puts it on API keys, and the map below covers keys written by owner flows.
 */
export function resolveSecretManagedBy(
  key: string,
): SecretManagedBy | undefined {
  const registered = getRequiredSecret(key);
  if (registered) return registered.managedBy;
  return managedKeyRules().find((rule) => rule.matches(key))?.manager;
}

/** Uses implied by a managed key's owner, for keys with no registration. */
export function managedSecretUsage(key: string): SecretUsage[] {
  if (getRequiredSecret(key)) return [];
  return managedKeyRules().find((rule) => rule.matches(key))?.usedFor ?? [];
}

/**
 * An owner surface deletes its own keys by naming itself (`managedBy=<id>`).
 * This is not an authorization check: scope and role checks still apply. It
 * keeps a managed key from being removed from API keys, where removing it
 * would leave its owner half-configured.
 */
export function isManagedDeleteAllowed(
  managedBy: SecretManagedBy,
  requestedBy: string | null | undefined,
): boolean {
  return !!requestedBy && requestedBy === managedBy.id;
}

export function managedDeleteRefusal(key: string, managedBy: SecretManagedBy) {
  return {
    error: `"${key}" is managed by ${managedBy.owner}. Remove it there.`,
    errorCode: "secret_managed_elsewhere" as const,
    managedBy,
  };
}
