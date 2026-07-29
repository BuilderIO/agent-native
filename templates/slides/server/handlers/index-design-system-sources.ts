import {
  FeatureNotConfiguredError,
  getSession,
  indexBuilderDesignSystem,
} from "@agent-native/core/server";
import { defineEventHandler, readBody, setResponseStatus } from "h3";

import { upsertBuilderProxyDesignSystem } from "../lib/builder-design-system-proxy.js";
import { withSlidesRequestContext } from "./request-auth-context.js";

/**
 * Finalizes Builder DSI indexing from upload tokens produced by the
 * browser-streamed resumable upload. The file bytes were streamed straight to
 * storage; this endpoint only forwards the opaque tokens.
 */
export const indexDesignSystemSources = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const body = (await readBody(event).catch(() => null)) as {
    projectName?: unknown;
    uploadTokens?: unknown;
  } | null;
  const uploadTokens = Array.isArray(body?.uploadTokens)
    ? body.uploadTokens.filter(
        (token): token is string =>
          typeof token === "string" && token.length > 0,
      )
    : [];
  if (uploadTokens.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No uploaded files to index." };
  }
  const projectName =
    typeof body?.projectName === "string"
      ? body.projectName.trim() || undefined
      : undefined;

  const sources = uploadTokens.map((uploadToken) => ({
    kind: "file" as const,
    uploadToken,
  }));

  try {
    return await withSlidesRequestContext(event, async ({ email, orgId }) => {
      const result = await indexBuilderDesignSystem({ sources, projectName });
      const proxy = await upsertBuilderProxyDesignSystem({
        result,
        ownerEmail: email ?? session.email,
        orgId: orgId ?? null,
        projectName,
      });
      return {
        ...result,
        ...proxy,
        uploadedFileCount: uploadTokens.length,
      };
    });
  } catch (err) {
    if (err instanceof FeatureNotConfiguredError) {
      setResponseStatus(event, 412);
      return {
        error: err.message,
        builderConnectUrl:
          err.builderConnectUrl ?? "/_agent-native/builder/connect",
      };
    }
    setResponseStatus(event, 502);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Builder design-system indexing failed.",
    };
  }
});
