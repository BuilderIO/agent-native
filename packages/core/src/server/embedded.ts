import type { H3Event } from "h3";

import {
  createIntegrationsPlugin,
  type IntegrationsPluginOptions,
} from "../integrations/index.js";
import { createOnboardingPlugin } from "../onboarding/plugin.js";
import type { OnboardingPluginOptions } from "../onboarding/plugin.js";
import { createOrgPlugin } from "../org/plugin.js";
import {
  createTerminalPlugin,
  type TerminalPluginOptions,
} from "../terminal/terminal-plugin.js";
import {
  createAgentChatPlugin,
  type AgentChatPluginOptions,
} from "./agent-chat-plugin.js";
import { createAuthPlugin } from "./auth-plugin.js";
import type { AuthOptions, AuthSession } from "./auth.js";
import {
  createCoreRoutesPlugin,
  type CoreRoutesPluginOptions,
} from "./core-routes-plugin.js";
import {
  awaitBootstrap,
  markDefaultPluginProvided,
  trackPluginInit,
} from "./framework-request-handler.js";
import { createResourcesPlugin } from "./resources-plugin.js";
import { createSentryPlugin } from "./sentry-plugin.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentNativeEmbeddedHostSession {
  email?: string | null;
  userId?: string | null;
  token?: string | null;
  name?: string | null;
  orgId?: string | null;
  orgRole?: string | null;
  /** Alias accepted from host products that use organizationId naming. */
  organizationId?: string | null;
  /** Alias accepted from host products that use role naming. */
  role?: string | null;
  [key: string]: unknown;
}

export type AgentNativeEmbeddedGetSession = (
  event: H3Event,
) =>
  | AgentNativeEmbeddedHostSession
  | null
  | Promise<AgentNativeEmbeddedHostSession | null>;

export interface AgentNativeEmbeddedAuthOptions extends Omit<
  AuthOptions,
  "getSession"
> {
  /**
   * Resolve the already-authenticated host user. Return null for anonymous
   * requests. No Agent-Native login is shown when this is supplied.
   */
  getSession: AgentNativeEmbeddedGetSession;
}

export interface AgentNativeEmbeddedPluginOptions {
  /**
   * Database used by Agent-Native managed tables. Defaults to the existing
   * DATABASE_URL environment variable. For embedded SaaS installs, prefer a
   * dedicated Agent-Native database/schema unless you explicitly want
   * framework-owned tables in the host product database.
   */
  databaseUrl?: string;
  /** Auth token for remote libsql/Turso databases. */
  databaseAuthToken?: string;
  /** Optional app name for per-app DATABASE_URL resolution and cookie scoping. */
  appName?: string;
  /**
   * Host auth adapter. Pass a function for the common case, or an object when
   * you need public path/auth-route options too.
   */
  auth?: AgentNativeEmbeddedGetSession | AgentNativeEmbeddedAuthOptions;
  /** Backend actions exposed to the agent and mounted under /_agent-native/actions. */
  actions?: AgentChatPluginOptions["actions"];
  /** Agent chat options. `actions` defaults to the top-level `actions`. */
  agentChat?: AgentChatPluginOptions | false;
  /** Core framework routes: poll, app-state, extensions, secrets, browser sessions. */
  coreRoutes?: CoreRoutesPluginOptions | false;
  /** Mount resource CRUD routes. Defaults to true. */
  resources?: boolean;
  /** Mount org-management routes. Defaults to false for host-auth embeds. */
  org?: boolean;
  /** Mount onboarding routes. Defaults to false for host-auth embeds. */
  onboarding?: boolean | OnboardingPluginOptions;
  /** Mount messaging integrations. Defaults to false. */
  integrations?: IntegrationsPluginOptions | false;
  /** Mount Sentry request/error hooks. Defaults to true. */
  sentry?: boolean;
  /** Mount terminal routes. Defaults to false for embedded SaaS installs. */
  terminal?: TerminalPluginOptions | false;
}

const EMBEDDED_PLUGIN_STEMS = [
  "auth",
  "sentry",
  "org",
  "core-routes",
  "resources",
  "onboarding",
  "integrations",
  "terminal",
  "agent-chat",
] as const;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeAgentNativeEmbeddedSession(
  session: AgentNativeEmbeddedHostSession | null | undefined,
): AuthSession | null {
  if (!session) return null;
  const userId = readString(session.userId);
  const email = readString(session.email) ?? userId;
  if (!email) return null;

  return {
    email,
    userId,
    token: readString(session.token),
    name: readString(session.name),
    orgId:
      readString(session.orgId) ??
      readString(session.organizationId) ??
      undefined,
    orgRole:
      readString(session.orgRole) ?? readString(session.role) ?? undefined,
  };
}

export function configureAgentNativeEmbeddedEnvironment(
  options: Pick<
    AgentNativeEmbeddedPluginOptions,
    "appName" | "databaseAuthToken" | "databaseUrl"
  >,
): void {
  if (options.appName) {
    process.env.APP_NAME = options.appName; // guard:allow-env-mutation — embedded plugin boot-time configuration, not request-scoped state
  }
  if (options.databaseUrl) {
    process.env.DATABASE_URL = options.databaseUrl; // guard:allow-env-mutation — embedded plugin boot-time configuration, not request-scoped state
  }
  if (options.databaseAuthToken) {
    process.env.DATABASE_AUTH_TOKEN = options.databaseAuthToken; // guard:allow-env-mutation — embedded plugin boot-time configuration, not request-scoped state
  }
}

export function createAgentNativeEmbeddedAuthOptions(
  auth: AgentNativeEmbeddedPluginOptions["auth"],
): AuthOptions | undefined {
  if (!auth) return undefined;

  const authOptions =
    typeof auth === "function"
      ? ({ getSession: auth } satisfies AgentNativeEmbeddedAuthOptions)
      : auth;

  return {
    mountGoogleOAuthRoutes: false,
    ...authOptions,
    getSession: async (event) =>
      normalizeAgentNativeEmbeddedSession(await authOptions.getSession(event)),
  };
}

function markEmbeddedPluginStems(nitroApp: any): void {
  for (const stem of EMBEDDED_PLUGIN_STEMS) {
    markDefaultPluginProvided(nitroApp, stem);
  }
}

export async function mountAgentNativeEmbedded(
  nitroApp: any,
  options: AgentNativeEmbeddedPluginOptions = {},
): Promise<void> {
  configureAgentNativeEmbeddedEnvironment(options);
  markEmbeddedPluginStems(nitroApp);
  await awaitBootstrap(nitroApp);

  await createAuthPlugin(createAgentNativeEmbeddedAuthOptions(options.auth))(
    nitroApp,
  );

  if (options.sentry !== false) {
    await createSentryPlugin()(nitroApp);
  }

  if (options.org === true) {
    await createOrgPlugin()(nitroApp);
  }

  if (options.coreRoutes !== false) {
    await createCoreRoutesPlugin(options.coreRoutes ?? undefined)(nitroApp);
  }

  if (options.resources !== false) {
    await createResourcesPlugin()(nitroApp);
  }

  if (options.onboarding) {
    await createOnboardingPlugin(
      typeof options.onboarding === "object" ? options.onboarding : undefined,
    )(nitroApp);
  }

  if (options.integrations) {
    await createIntegrationsPlugin(options.integrations)(nitroApp);
  }

  if (options.terminal) {
    await createTerminalPlugin(options.terminal)(nitroApp);
  }

  if (options.agentChat !== false) {
    const hostResolveOrgId =
      options.agentChat?.resolveOrgId ??
      (options.auth
        ? async (event: H3Event) => {
            const session = await createAgentNativeEmbeddedAuthOptions(
              options.auth,
            )?.getSession?.(event);
            return session?.orgId ?? null;
          }
        : undefined);

    await createAgentChatPlugin({
      ...(options.agentChat ?? {}),
      actions: options.agentChat?.actions ?? options.actions,
      resolveOrgId: hostResolveOrgId,
    })(nitroApp);
  }
}

export function createAgentNativeEmbeddedPlugin(
  options: AgentNativeEmbeddedPluginOptions = {},
): NitroPluginDef {
  return (nitroApp: any) => {
    const init = mountAgentNativeEmbedded(nitroApp, options);
    trackPluginInit(nitroApp, init);
    return init;
  };
}
