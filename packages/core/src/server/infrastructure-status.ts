/**
 * What Settings › Infrastructure shows under Environment, and the setup tags
 * its Services rows carry: the database this deployment uses, where it is
 * hosted and at which addresses, which deploy variables are set, and what the
 * app profile requires. Values are never returned, only whether each is set.
 *
 * Read through the `get-infrastructure-status` action (owners and admins).
 */

import { getAppConfig } from "../app-config/index.js";
import { isLocalDatabase } from "../db/client.js";
import { getDatabaseRuntimeFingerprint } from "../db/runtime-diagnostics.js";
import { getOnboardingAppProfile } from "../onboarding/app-profile.js";
import type { OnboardingAppProfile } from "../onboarding/types.js";
import { readDeployCredentialEnv } from "./credential-provider.js";
import {
  resolveDeployEnvironment,
  resolveDeployPlatform,
  type DeployPlatform,
} from "./deploy-environment.js";

/** Secrets shorter than this are rejected by the production config check. */
const MIN_SECRET_LENGTH = 32;

export type InfrastructureDatabaseProvider =
  | "neon"
  | "supabase"
  | "aws-rds"
  | "postgres"
  | "pglite";

export interface InfrastructureDatabase {
  /** A database URL resolved for this process. */
  configured: boolean;
  /** A PGlite file on this machine, not a shared Postgres server. */
  local: boolean;
  provider: InfrastructureDatabaseProvider | null;
  /** The server's host name. Never the URL or its credentials. */
  host: string | null;
  /** The variable the URL came from, e.g. `DATABASE_URL`. */
  sourceKey: string | null;
  /** The variable that gives only this app its own database. */
  appDatabaseKey: string | null;
}

export interface InfrastructureApp {
  id: string;
  name: string;
  /** The app's public address, when the workspace manifest names one. */
  url: string | null;
  /** The app's mount path under the workspace gateway. */
  path: string | null;
}

export interface InfrastructureHosting {
  platform: DeployPlatform;
  /** Deploy environment, e.g. `production`, `preview`, or `local`. */
  environment: string;
  /** Every app of the workspace, or this app alone outside one. */
  apps: InfrastructureApp[];
  /** Where the workspace serves its apps; null outside a workspace. */
  gatewayUrl: string | null;
}

export type InfrastructureVariableKey =
  | "DATABASE_URL"
  | "A2A_SECRET"
  | "BETTER_AUTH_SECRET"
  | "APP_URL"
  | "SECRETS_ENCRYPTION_KEY";

export interface InfrastructureVariable {
  key: InfrastructureVariableKey;
  required: boolean;
  set: boolean;
  /** Set, but shorter than the 32 characters a secret needs. */
  weak?: true;
}

export type InfrastructureSetupTag = "required" | "recommended";

/** Setup tags from the app profile, keyed by the Services row they mark. */
export interface InfrastructureSetupTags {
  model: InfrastructureSetupTag | null;
  storage: InfrastructureSetupTag | null;
  voice: InfrastructureSetupTag | null;
  images: InfrastructureSetupTag | null;
  embeddings: InfrastructureSetupTag | null;
}

export interface InfrastructureStatus {
  /** The app runs inside a multi-app workspace. */
  workspace: boolean;
  database: InfrastructureDatabase;
  hosting: InfrastructureHosting;
  variables: InfrastructureVariable[];
  setupTags: InfrastructureSetupTags;
}

export function databaseProviderForHost(
  host: string | undefined,
): InfrastructureDatabaseProvider {
  const name = host?.toLowerCase() ?? "";
  if (name.endsWith(".neon.tech")) return "neon";
  if (name.endsWith(".supabase.co") || name.endsWith(".supabase.com")) {
    return "supabase";
  }
  if (name.endsWith(".rds.amazonaws.com")) return "aws-rds";
  return "postgres";
}

function appEnvPrefix(): string | null {
  const app = getAppConfig().app;
  const name = app.workspaceId || app.name;
  const prefix = name?.toUpperCase().replace(/-/g, "_");
  return prefix && /^[A-Z_][A-Z0-9_]*$/.test(prefix) ? prefix : null;
}

function readDatabase(): InfrastructureDatabase {
  const fingerprint = getDatabaseRuntimeFingerprint();
  // With no URL at all, a dev server falls back to a PGlite file.
  const local = isLocalDatabase();
  const prefix = appEnvPrefix();
  return {
    configured: fingerprint.configured,
    local,
    provider: local
      ? "pglite"
      : fingerprint.configured
        ? databaseProviderForHost(fingerprint.host)
        : null,
    host: local ? null : (fingerprint.host ?? null),
    sourceKey: fingerprint.configured ? fingerprint.source || null : null,
    appDatabaseKey: prefix ? `${prefix}_DATABASE_URL` : null,
  };
}

/**
 * The apps in a workspace manifest (`AGENT_NATIVE_WORKSPACE_APPS_JSON`). A
 * manifest that doesn't parse throws: an empty list would read as a workspace
 * with no apps.
 */
export function parseWorkspaceApps(raw: string): InfrastructureApp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error("Invalid workspace app manifest", { cause });
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "apps" in parsed
      ? (parsed as { apps?: unknown }).apps
      : null;
  if (!Array.isArray(entries)) {
    throw new Error("Invalid workspace app manifest: no apps list");
  }
  const apps: InfrastructureApp[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) continue;
    const text = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : null;
    apps.push({
      id,
      name: text(record.name) ?? id,
      url: text(record.url),
      path: text(record.path) ?? `/${id}`,
    });
  }
  return apps;
}

function readHosting(
  workspace: boolean,
  profile: OnboardingAppProfile,
): InfrastructureHosting {
  const config = getAppConfig();
  const environment = (() => {
    try {
      return resolveDeployEnvironment();
    } catch {
      // coercion-ok: an invalid AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT is reported by the startup check; the page shows it as unknown.
      return "unknown";
    }
  })();
  const apps =
    workspace && config.workspace.appsJson
      ? parseWorkspaceApps(config.workspace.appsJson)
      : [
          {
            id: config.app.id ?? profile.appId,
            name: profile.appName,
            url: config.app.url ?? null,
            path: null,
          },
        ];
  return {
    platform: resolveDeployPlatform(),
    environment,
    apps,
    gatewayUrl: workspace ? (config.workspace.gatewayUrl ?? null) : null,
  };
}

function secretVariable(
  key: InfrastructureVariableKey,
  required: boolean,
  value: string | undefined,
): InfrastructureVariable {
  const trimmed = value?.trim();
  return {
    key,
    required,
    set: Boolean(trimmed),
    ...(trimmed && trimmed.length < MIN_SECRET_LENGTH
      ? { weak: true as const }
      : {}),
  };
}

function readVariables(
  workspace: boolean,
  database: InfrastructureDatabase,
): InfrastructureVariable[] {
  const prefix = appEnvPrefix();
  const encryptionKey =
    (prefix
      ? readDeployCredentialEnv(`${prefix}_SECRETS_ENCRYPTION_KEY`)
      : undefined) ??
    readDeployCredentialEnv("WORKSPACE_SECRETS_ENCRYPTION_KEY") ??
    readDeployCredentialEnv("SECRETS_ENCRYPTION_KEY");
  return [
    {
      key: "DATABASE_URL",
      required: true,
      set: database.configured && !database.local,
    },
    // A workspace signs sessions with A2A_SECRET when BETTER_AUTH_SECRET isn't
    // set, so each is required in exactly one of the two layouts.
    secretVariable(
      "A2A_SECRET",
      workspace,
      readDeployCredentialEnv("A2A_SECRET"),
    ),
    secretVariable(
      "BETTER_AUTH_SECRET",
      !workspace,
      readDeployCredentialEnv("BETTER_AUTH_SECRET"),
    ),
    { key: "APP_URL", required: false, set: Boolean(getAppConfig().app.url) },
    secretVariable("SECRETS_ENCRYPTION_KEY", false, encryptionKey),
  ];
}

const PROFILE_CAPABILITY_IDS: Record<
  keyof InfrastructureSetupTags,
  readonly string[]
> = {
  model: ["llm"],
  storage: ["file-storage", "video-storage"],
  voice: ["voice-input"],
  images: ["image-generation", "media-generation"],
  embeddings: ["embeddings"],
};

function readSetupTags(profile: OnboardingAppProfile): InfrastructureSetupTags {
  const tag = (ids: readonly string[]): InfrastructureSetupTag | null => {
    const capability = profile.capabilities.find((item) =>
      ids.includes(item.id),
    );
    if (!capability) return null;
    if (capability.required) return "required";
    return capability.suggested ? "recommended" : null;
  };
  return {
    model: tag(PROFILE_CAPABILITY_IDS.model),
    storage: tag(PROFILE_CAPABILITY_IDS.storage),
    voice: tag(PROFILE_CAPABILITY_IDS.voice),
    images: tag(PROFILE_CAPABILITY_IDS.images),
    embeddings: tag(PROFILE_CAPABILITY_IDS.embeddings),
  };
}

export function getInfrastructureStatus(
  options: { appId?: string } = {},
): InfrastructureStatus {
  const config = getAppConfig();
  const workspace =
    config.workspace.isWorkspace === true ||
    typeof config.workspace.appsJson === "string";
  const database = readDatabase();
  const profile = getOnboardingAppProfile(options.appId);
  return {
    workspace,
    database,
    hosting: readHosting(workspace, profile),
    variables: readVariables(workspace, database),
    setupTags: readSetupTags(profile),
  };
}
