import type { H3Event } from "h3";

import { markEmbeddedRuntimeAuthorized } from "../db/embedded-runtime.js";
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
import { bindEmbeddedHostOrgScope } from "./embedded-org-scope.js";
import {
  awaitBootstrap,
  markDefaultPluginProvided,
  trackPluginInit,
} from "./framework-request-handler.js";
import { createResourcesPlugin } from "./resources-plugin.js";
import { createSentryPlugin } from "./sentry-plugin.js";
import { sessionResolutionFailure } from "./session-resolution-errors.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface AgentNativeEmbeddedHostSession {
  email?: string | null;
  emailVerified?: boolean | null;
  userId?: string | null;
  token?: string | null;
  name?: string | null;
  orgId?: string | null;
  orgRole?: string | null;
  organizationId?: string | null;
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
  "getSession" | "getBrowserSession"
> {
  getSession: AgentNativeEmbeddedGetSession;
  getBrowserSession?: AgentNativeEmbeddedGetSession;
}

export interface AgentNativeEmbeddedPluginOptions {
  databaseUrl?: string;
  appName?: string;
  auth?: AgentNativeEmbeddedGetSession | AgentNativeEmbeddedAuthOptions;
  actions?: AgentChatPluginOptions["actions"];
  agentChat?: AgentChatPluginOptions | false;
  coreRoutes?: CoreRoutesPluginOptions | false;
  resources?: boolean;
  org?: boolean;
  onboarding?: boolean | OnboardingPluginOptions;
  integrations?: IntegrationsPluginOptions | false;
  sentry?: boolean;
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

function embeddedOrgId(
  session: AgentNativeEmbeddedHostSession | null | undefined,
): string | null | undefined {
  if (!session) return undefined;
  if (session.orgId === null) return null;
  const primary = readString(session.orgId);
  if (primary !== undefined) return primary;
  return session.organizationId === null
    ? null
    : readString(session.organizationId);
}

export function normalizeAgentNativeEmbeddedSession(
  session: AgentNativeEmbeddedHostSession | null | undefined,
): AuthSession | null {
  if (!session) return null;
  const userId = readString(session.userId);
  const email = readString(session.email) ?? userId;
  if (!email) return null;
  const orgId = embeddedOrgId(session);

  return {
    email,
    ...(typeof session.emailVerified === "boolean"
      ? { emailVerified: session.emailVerified }
      : {}),
    userId,
    token: readString(session.token),
    name: readString(session.name),
    orgId: orgId ?? undefined,
    orgRole:
      orgId == null || session.orgRole === null
        ? undefined
        : (readString(session.orgRole) ?? readString(session.role)),
  };
}

export function configureAgentNativeEmbeddedEnvironment(
  options: Pick<AgentNativeEmbeddedPluginOptions, "appName" | "databaseUrl">,
): void {
  if (options.appName) {
    process.env.APP_NAME = options.appName; // guard:allow-env-mutation — embedded plugin boot-time configuration, not request-scoped state
  }
  if (options.databaseUrl) {
    process.env.DATABASE_URL = options.databaseUrl; // guard:allow-env-mutation — embedded plugin boot-time configuration, not request-scoped state
    // A packaged/desktop host can legitimately run this with NODE_ENV=production
    // and a pglite: URL — exempt it from assertHostedRuntimeDatabase()'s guard,
    // which otherwise can't tell that apart from a deploy silently falling back
    // to PGlite because nobody configured DATABASE_URL.
    markEmbeddedRuntimeAuthorized();
  }
}

export function createAgentNativeEmbeddedAuthOptions(
  auth: AgentNativeEmbeddedPluginOptions["auth"],
): AuthOptions | undefined {
  if (!auth) return undefined;

  const authOptions: AgentNativeEmbeddedAuthOptions =
    typeof auth === "function" ? { getSession: auth } : auth;
  const { getSession, getBrowserSession, ...options } = authOptions;

  const resolve = async (
    event: H3Event,
    callback: AgentNativeEmbeddedGetSession,
  ) => {
    try {
      const hostSession = await callback(event);
      const session = normalizeAgentNativeEmbeddedSession(hostSession);
      if (session) {
        bindEmbeddedHostOrgScope(
          event,
          session,
          embeddedOrgId(hostSession) === null,
        );
      }
      return session;
    } catch (cause) {
      throw sessionResolutionFailure(cause);
    }
  };

  return {
    mountGoogleOAuthRoutes: false,
    ...options,
    getSession: (event) => resolve(event, getSession),
    ...(getBrowserSession
      ? {
          getBrowserSession: (event: H3Event) =>
            resolve(event, getBrowserSession),
        }
      : {}),
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

  void createAuthPlugin(createAgentNativeEmbeddedAuthOptions(options.auth))(
    nitroApp,
  );

  if (options.coreRoutes !== false) {
    await createCoreRoutesPlugin(options.coreRoutes ?? undefined)(nitroApp);
  }

  await awaitBootstrap(nitroApp);

  if (options.sentry !== false) {
    await createSentryPlugin()(nitroApp);
  }

  if (options.org === true) {
    await createOrgPlugin()(nitroApp);
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
