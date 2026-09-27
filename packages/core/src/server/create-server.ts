import {
  createApp,
  createRouter,
  defineEventHandler,
  getMethod,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getAppConfig } from "../app-config/index.js";
import { getEffectiveDatabaseEnvStatus } from "../db/runtime-diagnostics.js";
import { readBody } from "../server/h3-helpers.js";
import { EMBED_TARGET_HEADER } from "../shared/embed-auth.js";
import {
  EMBED_TRANSPLANT_HEADER,
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  shouldAllowMcpEmbedCredentials,
} from "../shared/mcp-embed-headers.js";
import { getRuntimeConfigReport } from "../shared/runtime-config.js";
import {
  getAllowedCorsOrigin,
  readCorsAllowedOrigins,
} from "./cors-origins.js";
import { runWithRequestContext } from "./request-context.js";
import type { ScopedKeySaveRequestScope } from "./scoped-key-storage.js";

const getSession: (typeof import("./auth.js"))["getSession"] = (...args) =>
  import("./auth.js").then(({ getSession }) => getSession(...args));

export interface EnvKeyConfig {
  key: string;
  label: string;
  required?: boolean;
  helpText?: string;
  secret?: boolean;
}

export interface CreateServerOptions {
  cors?: Record<string, unknown> | false;
  jsonLimit?: string;
  pingMessage?: string;
  disablePing?: boolean;
  envKeys?: EnvKeyConfig[];
}

export interface CreateServerResult {
  app: ReturnType<typeof createApp>;
  router: ReturnType<typeof createRouter>;
}

export function createServer(
  options: CreateServerOptions = {},
): CreateServerResult {
  const app = createApp({
    onError(error, event) {
      const err = error as NodeJS.ErrnoException;
      const code = err?.code || (err?.cause as NodeJS.ErrnoException)?.code;
      if (code === "ECONNRESET" || code === "ECONNABORTED") return;
      if (err?.message === "aborted") return;
      console.error(
        `[agent-native] Server error: ${event.method} ${event.path}`,
        error,
      );
    },
  });

  if (options.cors !== false) {
    const allowedOrigins = readCorsAllowedOrigins();
    const isProduction = process.env.NODE_ENV === "production";

    app.use(
      defineEventHandler((event) => {
        const requestOrigin = getRequestHeader(event, "origin");
        const method = getMethod(event);
        const requestedHeaders = String(
          getRequestHeader(event, "access-control-request-headers") ?? "",
        )
          .toLowerCase()
          .split(",")
          .map((header) => header.trim());
        const embedCorsRequest =
          isMcpEmbedCorsOrigin(requestOrigin) &&
          (requestedHeaders.includes(EMBED_TARGET_HEADER.toLowerCase()) ||
            requestedHeaders.includes(EMBED_TRANSPLANT_HEADER) ||
            Boolean(getRequestHeader(event, EMBED_TARGET_HEADER)) ||
            Boolean(getRequestHeader(event, EMBED_TRANSPLANT_HEADER)) ||
            Boolean(getRequestHeader(event, "authorization")));

        const allowedOrigin = embedCorsRequest
          ? requestOrigin
          : getAllowedCorsOrigin(requestOrigin, {
              allowedOrigins,
              allowAnyOriginWhenNoAllowlist: !isProduction,
              // Let the cors-origins default apply (dev-only). Passing `true`
              // here unconditionally would re-open the production localhost gap.
            });

        if (allowedOrigin) {
          setResponseHeader(
            event,
            "Access-Control-Allow-Origin",
            allowedOrigin,
          );
          setResponseHeader(event, "Vary", "Origin");
          if (shouldAllowMcpEmbedCredentials(allowedOrigin)) {
            setResponseHeader(
              event,
              "Access-Control-Allow-Credentials",
              "true",
            );
          }
        } else if (!requestOrigin) {
          setResponseHeader(event, "Access-Control-Allow-Origin", "*");
        }

        setResponseHeader(
          event,
          "Access-Control-Allow-Methods",
          "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        setResponseHeader(
          event,
          "Access-Control-Allow-Headers",
          MCP_EMBED_CORS_ALLOW_HEADERS,
        );

        if (method === "OPTIONS") {
          if (requestOrigin && !allowedOrigin) {
            return new Response(null, { status: 403 });
          }
          return new Response(null, { status: 204 });
        }
      }),
    );
  }

  const router = createRouter();

  if (!options.disablePing) {
    router.get(
      "/_agent-native/ping",
      defineEventHandler((event) => {
        const message = options.pingMessage ?? getAppConfig().app.pingMessage;
        const configuration =
          event.url?.searchParams.get("configuration") === "1" ||
          event.url?.searchParams.get("configuration") === "true";
        if (!configuration) return { message };

        const requirements = {
          ...(event.url?.searchParams.get("auth") === "0"
            ? { authEnabled: false }
            : {}),
          ...(event.url?.searchParams.get("database") === "0"
            ? { databaseRequired: false }
            : {}),
        };
        return {
          message,
          configuration: getRuntimeConfigReport(process.env, requirements, {
            phase: "runtime",
            appName: getAppConfig().app.name,
          }),
        };
      }),
    );
  }

  if (options.envKeys) {
    const envKeys = options.envKeys;
    const allowedEnvKeyNames = envKeys.map(({ key }) => key);

    router.get(
      "/_agent-native/env-status",
      defineEventHandler(async (event) => {
        const { resolveSecret } = await import("./credential-provider.js");
        const session = await getSession(event).catch(() => null);
        const userEmail = session?.email;
        let orgId: string | undefined;
        if (userEmail) {
          const { getOrgContext } = await import("../org/context.js");
          const orgCtx = await getOrgContext(event).catch(() => null);
          orgId = orgCtx?.orgId ?? undefined;
        }
        return Promise.all(
          envKeys.map(async (cfg) => {
            const effectiveDatabaseStatus = getEffectiveDatabaseEnvStatus(
              cfg.key,
            );
            const configured =
              effectiveDatabaseStatus ??
              (await runWithRequestContext({ userEmail, orgId }, () =>
                resolveSecret(cfg.key).then(Boolean),
              ));
            return {
              key: cfg.key,
              label: cfg.label,
              required: cfg.required ?? false,
              configured,
              ...(cfg.helpText ? { helpText: cfg.helpText } : {}),
              ...(cfg.secret === false ? { secret: false } : {}),
            };
          }),
        );
      }),
    );

    router.post(
      "/_agent-native/env-vars",
      defineEventHandler(async (event: H3Event) => {
        const body = await readBody(event);
        const { vars, scope } = body as {
          vars?: Array<{ key: string; value: string }>;
          scope?: ScopedKeySaveRequestScope;
        };
        const {
          findUnsupportedScopedKeyNames,
          saveKeyValuesToScopedSecrets,
          ScopedKeyStorageError,
        } = await import("./scoped-key-storage.js");
        const unsupportedKeys = findUnsupportedScopedKeyNames(
          vars,
          allowedEnvKeyNames,
        );
        if (unsupportedKeys.length > 0) {
          setResponseStatus(event, 400);
          return {
            error: `Unsupported env key${unsupportedKeys.length === 1 ? "" : "s"}: ${unsupportedKeys.join(", ")}`,
          };
        }
        try {
          const result = await saveKeyValuesToScopedSecrets(event, vars, scope);
          return { saved: result.saved, storage: "scoped-secrets" };
        } catch (err) {
          if (err instanceof ScopedKeyStorageError) {
            setResponseStatus(event, err.statusCode);
            return { error: err.message };
          }
          setResponseStatus(event, 500);
          return { error: "Failed to save keys" };
        }
      }),
    );
  }

  app.use(router);
  return { app, router };
}
