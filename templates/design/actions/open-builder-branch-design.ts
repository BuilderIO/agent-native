import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { canAccessBuilderProject } from "../server/lib/builder-identity.js";
import "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { upsertFusionScreens } from "../server/lib/fusion-screens.js";
import {
  APP_STARTING_MESSAGE,
  readFusionApp,
  writeFusionApp,
} from "../shared/full-app.js";

/** Milliseconds spent in each named stage since the previous one. */
function stageTimer() {
  const startedAt = Date.now();
  let last = startedAt;
  const stages: Record<string, number> = {};
  return {
    mark(name: string) {
      const now = Date.now();
      stages[name] = now - last;
      last = now;
    },
    done: () => ({ ...stages, totalMs: Date.now() - startedAt }),
  };
}

/**
 * The Builder-hosted entry point: "the user opened Builder project X, branch
 * Y". Returns the one design bound to that branch (creating it on first
 * open) right away, so the host can mount the ordinary production editor at
 * `/design/:id` while the branch's container is still waking. The editor
 * wakes it with sync-builder-app, whose container call carries the user's
 * own Builder credential under Builder identity (see
 * server/lib/builder-identity.ts).
 */
export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Open (or create) the design bound to a Builder project branch and point " +
    "its app screens at the branch's app, marked as starting until " +
    "sync-builder-app reports the container ready. Used by Builder when a " +
    "project opens into Design.",
  schema: z.object({
    projectId: z.string().min(1),
    branchName: z.string().min(1),
    title: z.string().optional(),
    builderOrgId: z.string().optional(),
    paths: z.array(z.string()).optional(),
    /** The host's current preview URL, used until the container reports its own. */
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
    const stages = stageTimer();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to open a Builder project in Design.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    // Builder decides who may open its project, before anything is bound
    // to it: otherwise a non-member could create the branch's design that a
    // real member later inherits. A local launch session has no Builder
    // project to ask about.
    // Builder being unreachable, or needing a fresh sign-in, surfaces as its
    // own typed error (503 / 401) rather than a denial.
    const builderAccess =
      projectId === "local"
        ? undefined
        : await canAccessBuilderProject(ownerEmail!, projectId);
    stages.mark("accessMs");
    if (builderAccess === false) {
      fail("You don't have access to this Builder project.", {
        errorCode: "builder_project_forbidden",
        statusCode: 403,
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
    stages.mark("lookupMs");

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
        // A local launch session is one person's machine: never org-shared.
        visibility: orgId && projectId !== "local" ? "org" : "private",
        createdAt: now,
        updatedAt: now,
      });
    }

    // The design never waits on the branch's container: a cold one takes
    // longer to wake than a request may stay open. Screens are bound to the
    // app's known URL now and, unless the app is already running there, it is
    // marked as starting; the editor wakes the container through
    // sync-builder-app and its screens load once that reports ready. A local
    // `builder.io launch` session has no cloud container: the host's preview
    // URL (the local dev-tools proxy) is the app.
    const local = projectId === "local";
    const existingApp = existing ? readFusionApp(existing.data) : null;
    const previewUrl =
      hostPreviewUrl ?? (local ? undefined : existingApp?.previewUrl);
    const running =
      local ||
      (existingApp?.status === "ready" &&
        existingApp.previewUrl === previewUrl);
    const status = running ? ("ready" as const) : ("building" as const);
    const statusMessage = running
      ? existingApp?.statusMessage
      : APP_STARTING_MESSAGE;

    stages.mark("createMs");
    if (previewUrl) {
      await upsertFusionScreens({
        designId,
        previewUrl,
        paths: paths && paths.length > 0 ? paths : ["/"],
      });
    }
    const isBound = (app: ReturnType<typeof readFusionApp>) =>
      app?.status === status &&
      app.statusMessage === statusMessage &&
      (!previewUrl || app.previewUrl === previewUrl);
    // Re-opening an app that is already bound this way writes nothing.
    if (!isBound(existingApp))
      await mutateDesignData({
        designId,
        mutate: (current) => {
          const app = readFusionApp(current);
          return app
            ? writeFusionApp(current, {
                ...app,
                ...(previewUrl ? { previewUrl } : {}),
                ...(statusMessage === undefined ? {} : { statusMessage }),
                status,
                updatedAt: now,
              })
            : current;
        },
        isApplied: (current) => isBound(readFusionApp(current)),
      });
    stages.mark("bindMs");
    console.info("[open-builder-branch-design] stage timings", {
      projectId,
      created: !existing,
      ...stages.done(),
    });

    return { designId, status, ...(previewUrl ? { previewUrl } : {}) };
  },
});
