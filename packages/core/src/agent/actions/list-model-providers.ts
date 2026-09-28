import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  AGENT_PROVIDER_CATALOG,
  type AgentProviderId,
} from "../../client/agent-provider-catalog.js";
import { canManageOrg } from "../../org/permissions.js";
import { secretKeyNames } from "../../secrets/key-aliases.js";
import {
  readAppSecrets,
  type ReadSecretResult,
} from "../../secrets/storage.js";
import { readProviderCredentialRejections } from "../../server/credential-provider.js";
import {
  isPersonalProviderKeyUseRestricted,
  readOrgMemberRole,
} from "../../server/personal-provider-key-policy.js";
import {
  readDefaultAgentEngineSettingDetailed,
  resolveDefaultAgentEngineAuthority,
  type DefaultAgentEngineSource,
} from "../default-agent-engine.js";

export type ModelProviderKeyScope = "user" | "org";

export interface ModelProviderKey {
  scope: ModelProviderKeyScope;
  /**
   * Last four characters behind a mask, e.g. "••••x9a2". Absent on
   * organization keys for members, who only see that one exists.
   */
  masked?: string;
  /**
   * Ollama's endpoint URL, or the OpenAI-compatible gateway saved with an
   * OpenAI key. Absent where `masked` is.
   */
  endpoint?: string;
  updatedAt: number | null;
  /** When the provider last rejected this key (ms); chats that use it stop. */
  rejectedAt?: number;
  /** The rejection markers couldn't be read, so nobody knows if it works. */
  rejectionUnknown?: true;
  /**
   * Stored in a legacy `workspace` row: the organization's (`workspace` /
   * orgId) for `scope: "org"`, the pre-organization solo row
   * (`workspace` / `solo:<email>`) for `scope: "user"`. Chats resolve it like
   * a key at `scope`, and removing the provider at `scope` deletes it.
   */
  legacyWorkspaceRow?: true;
}

export interface ModelProviderEntry {
  provider: AgentProviderId;
  label: string;
  /** The organization's key, or null when it has none. */
  org: ModelProviderKey | null;
  /** The caller's own key, or null when they have none. */
  personal: ModelProviderKey | null;
}

export interface ModelProvidersListing {
  providers: ModelProviderEntry[];
  hasOrganization: boolean;
  /** Owner or admin of the active organization. */
  canManageOrg: boolean;
  /**
   * The organization restricts personal API keys and the caller is a member,
   * so their personal keys are stored but not used, and they can't add more.
   */
  personalKeysRestricted: boolean;
  /** The stored default model, or null when chats fall back to detection. */
  defaultModel: { engine: string; model: string | null } | null;
  defaultModelSource: DefaultAgentEngineSource;
  canUpdateDefault: boolean;
}

interface ProviderKeyNames {
  option: (typeof AGENT_PROVIDER_CATALOG)[number];
  /** The key whose presence adds the provider: its API key, or Ollama's URL. */
  primary: readonly string[];
  endpoint?: string;
}

function providerKeyNames(): ProviderKeyNames[] {
  return AGENT_PROVIDER_CATALOG.map((option) => {
    if (option.id === "ollama") {
      return { option, primary: [option.endpointKey!] };
    }
    return {
      option,
      primary: secretKeyNames(option.key!),
      ...(option.endpointKey ? { endpoint: option.endpointKey } : {}),
    };
  });
}

function firstPresent(
  rows: Map<string, ReadSecretResult>,
  names: readonly string[],
): ReadSecretResult | null {
  for (const name of names) {
    const row = rows.get(name);
    if (row?.value) return row;
  }
  return null;
}

interface StoredRow {
  scope: "user" | "org" | "workspace";
  scopeId: string;
}

/**
 * The stored rows the credential resolver reads for one listing scope, in its
 * precedence order. Legacy `workspace` rows power chats like the first-class
 * row ahead of them, so a key there must list as present.
 */
function storedRowsFor(
  scope: ModelProviderKeyScope,
  scopeId: string,
): StoredRow[] {
  return scope === "org"
    ? [
        { scope: "org", scopeId },
        { scope: "workspace", scopeId },
      ]
    : [
        { scope: "user", scopeId },
        { scope: "workspace", scopeId: `solo:${scopeId}` },
      ];
}

async function readScopeKeys(
  scope: ModelProviderKeyScope,
  scopeId: string,
  reveal: boolean,
): Promise<Map<AgentProviderId, ModelProviderKey>> {
  const names = providerKeyNames();
  const keys = names.flatMap(({ primary, endpoint }) =>
    endpoint ? [...primary, endpoint] : primary,
  );
  const sources = storedRowsFor(scope, scopeId);
  const reads = await Promise.all(
    sources.map((source) => readAppSecrets({ keys, ...source })),
  );

  const found: Array<{
    names: ProviderKeyNames;
    row: ReadSecretResult;
    endpoint: ReadSecretResult | null;
    legacy: boolean;
  }> = [];
  for (const entry of names) {
    for (const [index, rows] of reads.entries()) {
      const row = firstPresent(rows, entry.primary);
      if (!row) continue;
      found.push({
        names: entry,
        row,
        endpoint: entry.endpoint ? firstPresent(rows, [entry.endpoint]) : null,
        legacy: sources[index]!.scope === "workspace",
      });
      break;
    }
  }

  // Markers are fingerprinted with the canonical key name, the one the
  // runtime records a rejection under, whichever alias the value is stored as.
  const checkable = found.filter(({ names }) => names.option.id !== "ollama");
  let rejections: Awaited<
    ReturnType<typeof readProviderCredentialRejections>
  > | null;
  try {
    rejections = await readProviderCredentialRejections(
      checkable.map(({ names, row }) => ({
        key: names.option.key!,
        value: row.value,
      })),
    );
  } catch (error) {
    console.warn("[list-model-providers] could not read rejection markers", {
      error: error instanceof Error ? error.message : String(error),
    });
    rejections = null;
  }

  const result = new Map<AgentProviderId, ModelProviderKey>();
  for (const { names: entry, row, endpoint, legacy } of found) {
    const id = entry.option.id;
    const isOllama = id === "ollama";
    const rejection =
      !isOllama && rejections ? rejections.get(entry.option.key!) : undefined;
    result.set(id, {
      scope,
      ...(reveal
        ? {
            ...(isOllama ? { endpoint: row.value } : { masked: row.last4 }),
            ...(endpoint?.value ? { endpoint: endpoint.value } : {}),
          }
        : {}),
      updatedAt: row.updatedAt || null,
      ...(rejection ? { rejectedAt: rejection.at } : {}),
      ...(!isOllama && !rejections ? { rejectionUnknown: true as const } : {}),
      ...(legacy ? { legacyWorkspaceRow: true as const } : {}),
    });
  }
  return result;
}

export default defineAction({
  description:
    "List the model providers on Settings › Model: for each provider (OpenRouter, Ollama, Anthropic, OpenAI, Google Gemini, Groq, Mistral, Cohere), the organization's key and the caller's personal key, masked, with the endpoint URL saved for Ollama or an OpenAI-compatible gateway and when the provider rejected the key (rejectedAt: chats that use it stop until someone replaces it). Members see only that an organization key exists, not its mask. A key in a legacy workspace row (the organization's, or the caller's pre-organization solo row) lists at the scope chats resolve it as, marked legacyWorkspaceRow; removing the provider at that scope deletes it. Also returns whether the caller can manage organization providers, whether personal API keys are restricted for them (their personal keys are then stored but unused), and the stored default model. Builder.io connections come from the Builder.io status, not here. Never returns a key value. Related: get-provider-models and manage-provider-models (which models each provider shows), manage-agent-engine (the default model), manage-provider-key-policy (Restrict personal API keys), preview-secret-removal (what removing a key stops).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx): Promise<ModelProvidersListing> => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    const orgId = ctx?.orgId?.trim() || null;

    const role = orgId ? await readOrgMemberRole(orgId, email) : null;
    const manages = orgId ? canManageOrg(role) : false;

    const [personal, org, restricted, defaultRead, authority] =
      await Promise.all([
        readScopeKeys("user", email, true),
        orgId
          ? readScopeKeys("org", orgId, manages)
          : Promise.resolve(new Map<AgentProviderId, ModelProviderKey>()),
        orgId
          ? isPersonalProviderKeyUseRestricted({ email, orgId, role })
          : Promise.resolve(false),
        readDefaultAgentEngineSettingDetailed({ userEmail: email, orgId }),
        resolveDefaultAgentEngineAuthority({ userEmail: email, orgId }),
      ]);

    const stored = defaultRead.value;
    const engine =
      typeof stored?.engine === "string" && stored.engine.trim()
        ? stored.engine.trim()
        : null;
    const model =
      typeof stored?.model === "string" && stored.model.trim()
        ? stored.model.trim()
        : null;

    return {
      providers: AGENT_PROVIDER_CATALOG.map((option) => ({
        provider: option.id,
        label: option.label,
        org: org.get(option.id) ?? null,
        personal: personal.get(option.id) ?? null,
      })),
      hasOrganization: !!orgId,
      canManageOrg: manages,
      personalKeysRestricted: restricted,
      defaultModel: engine ? { engine, model } : null,
      defaultModelSource: defaultRead.source,
      canUpdateDefault: authority.allowed,
    };
  },
});
