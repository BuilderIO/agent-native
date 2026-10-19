import { defineAction, fail } from "@agent-native/core/action";
import { ensureFusionContainer } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import "../server/db/index.js";
import { upsertFusionScreens } from "../server/lib/fusion-screens.js";
import { readFusionApp, writeFusionApp } from "../shared/full-app.js";

/**
 * The Builder-hosted entry point: "the user opened Builder project X, branch
 * Y". Returns the one design bound to that branch (creating it on first
 * open) with its app screens pointed at the live branch container, so the
 * host can mount the ordinary production editor at `/design/:id`.
 *
 * The container is resolved through core's fusion-app client. Under Builder
 * identity that call carries the user's own Builder credential (see
 * server/lib/builder-identity.ts), so Builder authorizes it exactly as it
 * would a request from Builder.
 */
export default defineAction({
  description:
    "Open (or create) the design bound to a Builder project branch and point " +
    "its app screens at the branch's live container. Used by Builder when a " +
    "project opens into Design.",
  schema: z.object({
    projectId: z.string().min(1),
    branchName: z.string().min(1),
    title: z.string().optional(),
    builderOrgId: z.string().optional(),
    paths: z.array(z.string()).optional(),
    /** The host's current preview URL, used if the container lookup fails. */
    previewUrl: z.string().url().optional(),
  }),
  run: async ({
    projectId,
    branchName,
    title,
    builderOrgId,
    paths,
    previewUrl: hostPreviewUrl,
  }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to open a Builder project in Design.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const db = getDb();
    const now = new Date().toISOString();

    // One design per Builder branch, shared by everyone Builder lets in: the
    // binding is found regardless of who created it, and access is Builder's
    // call (host access resolver, server/lib/builder-identity.ts).
    // Spike: scan fusion-sourced designs. Production indexes the binding.
    const candidates = await db
      .select({
        id: schema.designs.id,
        data: schema.designs.data,
        ownerEmail: schema.designs.ownerEmail,
      })
      .from(schema.designs)
      .where(like(schema.designs.data, `%"projectId":"${projectId}"%`)); // guard:allow-blob-predicate — spike: first-open lookup only; a real branch index comes with the production design
    const existing = candidates.find((row) => {
      const app = readFusionApp(row.data);
      if (app?.projectId !== projectId || app.branchName !== branchName) {
        return false;
      }
      // A local `builder.io launch` session is one person's machine: its
      // binding is per user, never shared (there is no Builder project to
      // decide access).
      return projectId !== "local" || row.ownerEmail === ownerEmail;
    });
    if (existing) await assertAccess("design", existing.id, "editor");

    let designId = existing?.id;
    if (!designId) {
      designId = nanoid();
      const orgId = getRequestOrgId();
      await db.insert(schema.designs).values({
        id: designId,
        title: title || branchName,
        description: null,
        projectType: "prototype",
        designSystemId: null,
        data: JSON.stringify(
          writeFusionApp(
            { sourceType: "fusion" },
            {
              projectId,
              branchName,
              source: "design-app",
              ...(builderOrgId ? { builderOrgId } : {}),
              status: "building",
              createdAt: now,
              updatedAt: now,
            },
          ),
        ),
        ownerEmail,
        orgId,
        visibility: orgId ? "org" : "private",
        createdAt: now,
        updatedAt: now,
      });
    }

    // A local `builder.io launch` session has no cloud container; the host's
    // preview URL (the local dev-tools proxy) is the app.
    const container =
      projectId === "local"
        ? { status: "ready" as const, url: undefined, message: "local session" }
        : await ensureFusionContainer({
            projectId,
            branchName,
            timeoutMs: 20_000,
          }).catch((error: unknown) => ({
            status: "error" as const,
            url: undefined,
            message: error instanceof Error ? error.message : String(error),
          }));
    const previewUrl = container.url || hostPreviewUrl;
    if (!previewUrl) {
      return {
        designId,
        status: container.status,
        message: container.message,
      };
    }

    await upsertFusionScreens({
      designId,
      previewUrl,
      paths: paths && paths.length > 0 ? paths : ["/"],
    });
    await mutateDesignData({
      designId,
      mutate: (current) => {
        const app = readFusionApp(current);
        return app
          ? writeFusionApp(current, {
              ...app,
              previewUrl,
              status: "ready",
              updatedAt: now,
            })
          : current;
      },
      isApplied: (current) => readFusionApp(current)?.previewUrl === previewUrl,
    });

    return {
      designId,
      status: "ready" as const,
      previewUrl,
      containerSource: container.url ? "ai-services" : "host",
      containerMessage: container.message,
    };
  },
});
